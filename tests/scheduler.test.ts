import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { addFakeSource, clock, fakeAdapter, makeJob, newState, serverError } from "./helpers/fake-source";
import { nextRunAt, scheduledInstantToday, shouldRunNow, startOfLocalDay, zonedParts, zonedTimeToUtc, parseHHmm, localDate } from "@/lib/scheduler/time";
import { schedulerTick, retryDelayMs, MAX_ATTEMPTS_PER_SLOT } from "@/lib/scheduler/tick";
import { saveSettings } from "@/lib/db/config";
import { listRuns } from "@/lib/db/runs";
import { acquireLock, releaseLock } from "@/lib/db/locks";
import { memoryProvider } from "@/lib/notify/providers";
import type { RunOptions } from "@/lib/pipeline/run";

const KHI = "Asia/Karachi"; // UTC+5, no DST
const sched = { enabled: true, time: "08:00", timezone: KHI };

describe("time maths", () => {
  it("computes the scheduled instant in the configured timezone", () => {
    expect(scheduledInstantToday(new Date("2026-10-19T04:00:00Z"), "08:00", KHI).toISOString()).toBe("2026-10-19T03:00:00.000Z");
    expect(scheduledInstantToday(new Date("2026-10-19T04:00:00Z"), "08:00", "Asia/Tokyo").toISOString()).toBe("2026-10-18T23:00:00.000Z");
    expect(scheduledInstantToday(new Date("2026-10-19T04:00:00Z"), "08:00", "UTC").toISOString()).toBe("2026-10-19T08:00:00.000Z");
  });

  it("uses the LOCAL calendar day, not the UTC day", () => {
    // 01:00 on 20 Oct in Karachi is still 19 Oct in UTC
    const d = new Date("2026-10-19T20:00:00Z");
    expect(localDate(d, KHI)).toBe("2026-10-20");
    expect(localDate(d, "UTC")).toBe("2026-10-19");
    expect(startOfLocalDay(d, KHI).toISOString()).toBe("2026-10-19T19:00:00.000Z");
  });

  it("nextRunAt is strictly in the future, today or tomorrow", () => {
    expect(nextRunAt(new Date("2026-10-19T02:00:00Z"), "08:00", KHI).toISOString()).toBe("2026-10-19T03:00:00.000Z");
    expect(nextRunAt(new Date("2026-10-19T03:00:00Z"), "08:00", KHI).toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(nextRunAt(new Date("2026-10-19T10:00:00Z"), "08:00", KHI).toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });

  it("handles daylight-saving transitions (America/New_York)", () => {
    const tz = "America/New_York";
    // Spring forward: 8 Mar 2026. 7 Mar 08:00 = EST (UTC-5) -> 13:00Z. 8 Mar 08:00 = EDT (UTC-4) -> 12:00Z.
    expect(scheduledInstantToday(new Date("2026-03-07T15:00:00Z"), "08:00", tz).toISOString()).toBe("2026-03-07T13:00:00.000Z");
    expect(scheduledInstantToday(new Date("2026-03-08T15:00:00Z"), "08:00", tz).toISOString()).toBe("2026-03-08T12:00:00.000Z");
    // Fall back: 1 Nov 2026. 8:00 is EST again -> 13:00Z.
    expect(scheduledInstantToday(new Date("2026-11-01T15:00:00Z"), "08:00", tz).toISOString()).toBe("2026-11-01T13:00:00.000Z");
    // Nonexistent wall time (02:30 on spring-forward day) must not throw and must stay within that day
    const t = zonedTimeToUtc(2026, 3, 8, 2, 30, tz);
    expect(Number.isNaN(t.getTime())).toBe(false);
    expect(zonedParts(t, tz).day).toBe(8);
    // The day after a spring-forward is 23h long: next run from just after today's slot is ~24h later on the wall clock
    const next = nextRunAt(new Date("2026-03-08T12:00:00Z"), "08:00", tz);
    expect(next.toISOString()).toBe("2026-03-09T12:00:00.000Z");
  });

  it("parses HH:mm strictly", () => {
    expect(parseHHmm("07:05")).toEqual({ h: 7, m: 5 });
    expect(() => parseHHmm("7pm")).toThrow();
    expect(() => parseHHmm("24:00")).toThrow();
  });
});

describe("shouldRunNow (catch-up semantics)", () => {
  const at = (iso: string) => new Date(iso);
  it("is not due before the scheduled time", () => {
    expect(shouldRunNow(at("2026-10-19T02:59:59Z"), sched, null).due).toBe(false);
  });
  it("is due once the scheduled time has passed and nothing has run today", () => {
    expect(shouldRunNow(at("2026-10-19T03:00:00Z"), sched, null).due).toBe(true);
  });
  it("catches up when the machine was asleep through the slot", () => {
    expect(shouldRunNow(at("2026-10-19T18:30:00Z"), sched, at("2026-10-18T03:00:05Z")).due).toBe(true);
  });
  it("is not due again after today's slot has been run", () => {
    expect(shouldRunNow(at("2026-10-19T12:00:00Z"), sched, at("2026-10-19T03:00:05Z")).due).toBe(false);
  });
  it("a run before today's slot (e.g. yesterday evening) does not satisfy today's slot", () => {
    expect(shouldRunNow(at("2026-10-19T03:30:00Z"), sched, at("2026-10-19T02:00:00Z")).due).toBe(true);
  });
  it("is never due when disabled", () => {
    expect(shouldRunNow(at("2026-10-19T12:00:00Z"), { ...sched, enabled: false }, null).due).toBe(false);
  });
  it("rolls over at LOCAL midnight, not UTC midnight", () => {
    // 19 Oct 20:00Z = 20 Oct 01:00 PKT: the 20 Oct slot (08:00 PKT = 03:00Z on the 20th) has not arrived
    expect(shouldRunNow(at("2026-10-19T20:00:00Z"), sched, at("2026-10-19T03:00:05Z")).due).toBe(false);
    expect(shouldRunNow(at("2026-10-20T03:00:00Z"), sched, at("2026-10-19T03:00:05Z")).due).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("doubles and is capped", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map((n) => retryDelayMs(n) / 60_000)).toEqual([5, 10, 20, 40, 60, 60, 60]);
  });
});

async function setup(opts: { jobs?: ReturnType<typeof makeJob>[]; settings?: object } = {}) {
  const db = await testDb();
  const state = newState(opts.jobs ?? [makeJob("1")]);
  await addFakeSource(db);
  if (opts.settings) await saveSettings(db, opts.settings);
  const c = clock("2026-10-19T02:00:00Z"); // 07:00 Karachi, before the 08:00 slot
  const email = memoryProvider();
  const runOptions: Partial<RunOptions> = { sleep: async () => {}, adapters: { fake: fakeAdapter(state) }, backoffBaseMs: 1, backoffMaxMs: 2, emailProvider: email };
  const tick = () => schedulerTick(db, { now: c.now, runOptions });
  const advanceMin = (m: number) => c.advanceHours(m / 60);
  return { db, state, c, tick, email, advanceMin };
}

describe("schedulerTick", () => {
  it("does nothing before the scheduled time, runs once when due, and never twice in a slot", async () => {
    const { db, c, tick } = await setup();
    expect((await tick()).action).toBe("idle");
    c.advanceHours(1.5); // 08:30 Karachi
    const r = await tick();
    expect(r.action).toBe("ran");
    for (let i = 0; i < 10; i++) {
      c.advanceHours(0.5);
      expect((await tick()).action).toBe("idle");
    }
    const runs = await listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "scheduled", status: "success" });
  });

  it("runs again the next local day and the data stays idempotent", async () => {
    const { db, c, tick } = await setup();
    c.advanceHours(2);
    await tick();
    c.advanceDays(1);
    const r = await tick();
    expect(r.action).toBe("ran");
    if (r.action === "ran") expect(r.summary.counts).toMatchObject({ new: 0, seen: 1 });
    expect(Number((await db.query("SELECT COUNT(*) n FROM jobs"))[0].n)).toBe(1);
    expect(await listRuns(db)).toHaveLength(2);
  });

  it("survives a worker restart: state lives in the database, so no duplicate run", async () => {
    const { db, c, tick, state } = await setup();
    c.advanceHours(2);
    await tick();
    const fresh = (await import("@/lib/scheduler/tick")).schedulerTick; // simulate a new process using the same DB
    const r = await fresh(db, { now: c.now, runOptions: { sleep: async () => {}, adapters: { fake: fakeAdapter(state) } } });
    expect(r.action).toBe("idle");
    expect(await listRuns(db)).toHaveLength(1);
  });

  it("catches up after sleeping through the slot", async () => {
    const { c, tick } = await setup();
    c.advanceHours(14); // 21:00 Karachi
    expect((await tick()).action).toBe("ran");
  });

  it("honours disabled schedules and dashboard changes to time/timezone without restart", async () => {
    const { db, c, tick } = await setup({ settings: { schedule: { enabled: false } } });
    c.advanceHours(3);
    expect((await tick()).action).toBe("idle");
    await saveSettings(db, { schedule: { enabled: true, time: "11:00", timezone: KHI } }); // 11:00 Karachi = 06:00Z; now 05:00Z
    expect((await tick()).action).toBe("idle");
    c.advanceHours(1.1);
    expect((await tick()).action).toBe("ran");
  });

  it("respects the dry-run schedule setting: records the run, saves no jobs, sends no email", async () => {
    const { db, c, tick, email } = await setup({ settings: { schedule: { dryRun: true }, email: { enabled: true, to: "me@example.com" } } });
    c.advanceHours(2);
    const r = await tick();
    expect(r.action).toBe("ran");
    expect((await listRuns(db))[0]).toMatchObject({ dryRun: true, trigger: "scheduled", status: "success" });
    expect(Number((await db.query("SELECT COUNT(*) n FROM jobs"))[0].n)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("a manual run does not consume the scheduled slot", async () => {
    const { db, c, tick } = await setup();
    const { runPipeline } = await import("@/lib/pipeline/run");
    c.advanceHours(2);
    await runPipeline(db, { trigger: "manual", now: c.now, sleep: async () => {}, adapters: { fake: fakeAdapter(newState([makeJob("1")])) }, skipNotifications: true });
    expect((await tick()).action).toBe("ran");
    expect((await listRuns(db)).map((r) => r.trigger).sort()).toEqual(["manual", "scheduled"]);
  });

  describe("failures", () => {
    it("retries a failed run with bounded exponential backoff, then gives up after the attempt limit", async () => {
      const { db, c, tick, state, advanceMin } = await setup();
      state.fail = serverError();
      c.advanceHours(2);
      const first = await tick();
      expect(first.action === "ran" && first.summary.status).toBe("failed");

      // immediately after: waiting
      const w1 = await tick();
      expect(w1.action).toBe("waiting_retry");
      advanceMin(4);
      expect((await tick()).action).toBe("waiting_retry");
      advanceMin(1.1); // 5 min elapsed
      const second = await tick();
      expect(second.action === "ran" && second.attempt).toBe(2);

      const w2 = await tick();
      expect(w2.action === "waiting_retry" && w2.retryAt.getTime() - c.now().getTime()).toBeGreaterThan(9 * 60_000); // 10 min backoff now
      advanceMin(10.1);
      const third = await tick();
      expect(third.action === "ran" && third.attempt).toBe(3);

      advanceMin(120);
      const done = await tick();
      expect(done.action).toBe("gave_up");
      expect((await listRuns(db)).filter((r) => r.trigger === "scheduled")).toHaveLength(MAX_ATTEMPTS_PER_SLOT);
    });

    it("stops retrying as soon as a retry succeeds, and tomorrow starts fresh", async () => {
      const { db, c, tick, state, advanceMin } = await setup();
      state.fail = serverError();
      c.advanceHours(2);
      await tick();
      state.fail = null; // source recovers
      advanceMin(5.1);
      const r = await tick();
      expect(r.action === "ran" && r.summary.status).toBe("success");
      advanceMin(600);
      expect((await tick()).action).toBe("idle");
      c.advanceDays(1);
      expect((await tick()).action).toBe("ran");
      expect((await listRuns(db)).map((x) => x.status).sort()).toEqual(["failed", "success", "success"]);
    });

    it("a partial failure (one source down, one healthy) keeps the good data and is not retried as a whole", async () => {
      const { db, c, state } = await setup();
      await addFakeSource(db, {}, "fake2");
      const down = newState([]);
      down.fail = serverError();
      const runOptions: Partial<RunOptions> = { sleep: async () => {}, backoffBaseMs: 1, backoffMaxMs: 2, adapters: { fake: fakeAdapter(state), fake2: fakeAdapter(down, "fake2") }, skipNotifications: true };
      c.advanceHours(2);
      const r = await schedulerTick(db, { now: c.now, runOptions });
      expect(r.action === "ran" && r.summary.status).toBe("partial");
      expect(r.action === "ran" && r.summary.counts).toMatchObject({ sources: 2, sourcesFailed: 1, new: 1 });
      expect(Number((await db.query("SELECT COUNT(*) n FROM jobs"))[0].n)).toBe(1);
      expect((await schedulerTick(db, { now: c.now, runOptions })).action).toBe("idle");
      expect(down.fetchCalls).toBeGreaterThan(1); // the source-level retries did happen
    });
  });

  describe("overlap protection", () => {
    it("a tick that finds the pipeline locked is recorded as skipped and does not consume the slot", async () => {
      const { db, c, tick } = await setup();
      c.advanceHours(2);
      expect(await acquireLock(db, "pipeline", "another-process", 10 * 60_000, c.now())).toBe(true);
      const r = await tick();
      expect(r.action === "ran" && r.summary.status).toBe("skipped");
      // still due: after the other process releases the lock, the scheduled run goes ahead
      await releaseLock(db, "pipeline", "another-process");
      const r2 = await tick();
      expect(r2.action === "ran" && r2.summary.status).toBe("success");
    });

    it("two concurrent ticks produce exactly one real run", async () => {
      const { db, c, tick } = await setup();
      c.advanceHours(2);
      const [a, b] = await Promise.all([tick(), tick()]);
      const statuses = [a, b].map((r) => (r.action === "ran" ? r.summary.status : r.action));
      expect(statuses.filter((s) => s === "success")).toHaveLength(1);
      expect(Number((await db.query("SELECT COUNT(*) n FROM jobs"))[0].n)).toBe(1);
    });

    it("a stale lock from a crashed worker is taken over", async () => {
      const { db, c, tick } = await setup();
      c.advanceHours(2);
      await acquireLock(db, "pipeline", "crashed", 60_000, c.now());
      c.advanceHours(1); // lock expired
      const r = await tick();
      expect(r.action === "ran" && r.summary.status).toBe("success");
    });
  });

  describe("notifications across scheduled runs", () => {
    it("emails a new match once; the next day's unchanged listing is not re-sent", async () => {
      const { c, tick, email } = await setup({ settings: { email: { enabled: true, to: "me@example.com" } } });
      c.advanceHours(2);
      const day1 = await tick();
      expect(day1.action === "ran" && day1.summary.notify?.status).toBe("sent");
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0].text).toContain("Java Backend Engineer");
      c.advanceDays(1);
      const day2 = await tick();
      expect(day2.action === "ran" && day2.summary.notify?.status).toBe("none");
      expect(email.sent).toHaveLength(1);
    });

    it("a provider outage does not mark the job as notified; the next scheduled day retries delivery", async () => {
      const { db, c, tick, state } = await setup({ settings: { email: { enabled: true, to: "me@example.com" } } });
      const flaky = memoryProvider({ failTimes: 99 });
      const run = (p: ReturnType<typeof memoryProvider>) => schedulerTick(db, { now: c.now, runOptions: { sleep: async () => {}, adapters: { fake: fakeAdapter(state) }, emailProvider: p } });
      c.advanceHours(2);
      const d1 = await run(flaky);
      expect(d1.action === "ran" && d1.summary.notify?.status).toBe("failed");
      expect(Number((await db.query("SELECT COUNT(*) n FROM notified_jobs"))[0].n)).toBe(0);
      c.advanceDays(1);
      const good = memoryProvider();
      const d2 = await run(good);
      expect(d2.action === "ran" && d2.summary.notify?.status).toBe("sent");
      expect(good.sent).toHaveLength(1);
      void tick;
    });
  });
});
