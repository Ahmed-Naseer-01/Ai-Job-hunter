import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { addFakeSource, clock, fakeAdapter, GOOD_DESC, makeJob, newState, serverError } from "./helpers/fake-source";
import { runPipeline, type RunOptions } from "@/lib/pipeline/run";
import { saveApplication, getApplication } from "@/lib/db/applications";
import { getSourceHealth, listRuns, getRunLogs } from "@/lib/db/runs";
import { listSources, upsertSource } from "@/lib/db/sources";
import { saveSettings, loadSettings } from "@/lib/db/config";
import { acquireLock } from "@/lib/db/locks";
import { memoryProvider } from "@/lib/notify/providers";
import { fakeAdapter as fa } from "./helpers/fake-source";
import type { Db } from "@/lib/db/types";

const noSleep = async () => {};
async function setup(jobs = [makeJob("1"), makeJob("2", { title: "Spring Boot Developer" })]) {
  const db = await testDb();
  const state = newState(jobs);
  await addFakeSource(db);
  const c = clock();
  const base: RunOptions = { trigger: "test", now: c.now, sleep: noSleep, adapters: { fake: fakeAdapter(state) }, backoffBaseMs: 1, backoffMaxMs: 2, skipNotifications: true };
  return { db, state, c, base };
}
const count = async (db: Db, table: string) => Number((await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);

describe("pipeline: collection", () => {
  it("fetches, normalises, scores and persists jobs; records the run and source health", async () => {
    const { db, base } = await setup();
    const r = await runPipeline(db, base);
    expect(r.status).toBe("success");
    expect(r.counts).toMatchObject({ sources: 1, listed: 2, kept: 2, new: 2, updated: 0 });
    expect(await count(db, "jobs")).toBe(2);
    expect(await count(db, "job_scores")).toBe(2);
    const runs = await listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "success", trigger: "test", dryRun: false });
    expect(runs[0].durationMs).toBeGreaterThanOrEqual(0);
    const h = await getSourceHealth(db, "fake:x");
    expect(h).toMatchObject({ status: "healthy", consecutiveFailures: 0, lastFetched: 2, lastKept: 2 });
    expect(h.lastSuccessAt).not.toBeNull();
    expect((await getRunLogs(db, runs[0].id)).length).toBeGreaterThan(0);
  });

  it("is idempotent: repeating a run creates no duplicates and changes nothing", async () => {
    const { db, base, c } = await setup();
    await runPipeline(db, base);
    const before = await db.query("SELECT id, content_hash FROM jobs ORDER BY id");
    c.advanceDays(1);
    const r2 = await runPipeline(db, base);
    expect(r2.counts).toMatchObject({ new: 0, updated: 0, seen: 2 });
    expect(await db.query("SELECT id, content_hash FROM jobs ORDER BY id")).toEqual(before);
    expect(await count(db, "job_sightings")).toBe(2);
    const lc = await db.query<{ lifecycle: string }>("SELECT lifecycle FROM jobs");
    expect(lc.every((x) => x.lifecycle === "seen")).toBe(true); // 'new' -> 'seen' on the following run
  });

  it("detects updates, rescoring changed postings", async () => {
    const { db, base, state, c } = await setup([makeJob("1")]);
    await runPipeline(db, base);
    const scoreBefore = (await db.query<{ score: number }>("SELECT score FROM job_scores"))[0].score;
    state.jobs = [makeJob("1", { descriptionText: GOOD_DESC + "\n- Kafka\n- Kubernetes\n- Redis\n- GraphQL" })];
    c.advanceDays(1);
    const r = await runPipeline(db, base);
    expect(r.counts.updated).toBe(1);
    const row = (await db.query<{ lifecycle: string }>("SELECT lifecycle FROM jobs"))[0];
    expect(row.lifecycle).toBe("updated");
    const scoreAfter = (await db.query<{ score: number }>("SELECT score FROM job_scores"))[0].score;
    expect(scoreAfter).toBeLessThan(scoreBefore);
  });

  it("NEVER overwrites application tracking during routine collection", async () => {
    const { db, base, state, c } = await setup([makeJob("1")]);
    await runPipeline(db, base);
    const jobId = (await db.query<{ id: string }>("SELECT id FROM jobs"))[0].id;
    await saveApplication(db, jobId, { status: "interview", notes: "Spoke with recruiter", followUpAt: "2026-11-01T00:00:00Z" });
    state.jobs = [makeJob("1", { title: "Java Backend Engineer II", descriptionText: GOOD_DESC + "\nUpdated text" })];
    c.advanceDays(1);
    await runPipeline(db, base);
    state.jobs = []; // vanishes from the listing
    for (let i = 0; i < 3; i++) {
      c.advanceDays(1);
      await runPipeline(db, base);
    }
    const app = await getApplication(db, jobId);
    expect(app).toMatchObject({ status: "interview", notes: "Spoke with recruiter", followUpAt: "2026-11-01T00:00:00Z" });
  });

  it("applies keyword and lookback filters to new jobs only", async () => {
    const { db, base } = await setup([
      makeJob("1"),
      makeJob("2", { title: "Account Executive" }),
      makeJob("3", { postedAt: "2025-01-01T00:00:00Z" }),
      makeJob("4", { postedAt: null, title: "Spring Boot Software Engineer" }), // no posting date => kept (unknown stays unknown)
    ]);
    await upsertSource(db, { id: "fake:x", kind: "fake", name: "Fake", config: { titleKeywords: ["engineer"] } });
    const r = await runPipeline(db, { ...base, lookbackDays: 30 });
    expect(r.counts).toMatchObject({ listed: 4, filteredKeywords: 1, filteredLookback: 1, kept: 2, new: 2 });
  });

  it("skips invalid postings without failing the run", async () => {
    const { db, base } = await setup([makeJob("1"), makeJob("2", { applyUrl: "javascript:alert(1)" } as any)]);
    const r = await runPipeline(db, base);
    expect(r.counts).toMatchObject({ new: 1, invalid: 1 });
    expect(r.status).toBe("success");
  });
});

describe("pipeline: failure handling", () => {
  it("retries transient failures with backoff and then succeeds", async () => {
    const { db, base, state } = await setup();
    state.fail = serverError();
    state.failTimes = 2;
    const delays: number[] = [];
    const r = await runPipeline(db, { ...base, retries: 3, backoffBaseMs: 100, backoffMaxMs: 150, sleep: async (ms) => void delays.push(ms) });
    expect(r.status).toBe("success");
    expect(state.fetchCalls).toBe(3);
    expect(delays).toHaveLength(2);
    expect(Math.max(...delays)).toBeLessThanOrEqual(150);
    expect(await count(db, "jobs")).toBe(2);
  });

  it("a source that keeps failing is recorded as failed and never touches or closes existing jobs", async () => {
    const { db, base, state, c } = await setup();
    await runPipeline(db, base);
    state.fail = serverError();
    state.failTimes = Infinity;
    for (let i = 0; i < 4; i++) {
      c.advanceDays(1);
      const r = await runPipeline(db, { ...base, retries: 1 });
      expect(r.status).toBe("failed");
      expect(r.errors.join(" ")).toMatch(/failed after 2 attempt/);
    }
    expect((await db.query<{ status: string }>("SELECT status FROM jobs")).every((j) => j.status === "open")).toBe(true);
    expect((await db.query<{ n: number }>("SELECT MAX(missed_runs) AS n FROM job_sightings"))[0].n).toBe(0);
    const h = await getSourceHealth(db, "fake:x");
    expect(h).toMatchObject({ status: "failing", consecutiveFailures: 4 });
    expect(h.lastSuccessAt).not.toBeNull(); // last good run remembered
    expect(h.lastError).toMatch(/503/);
  });

  it("one failing source does not block another (partial run)", async () => {
    const { db, base, state } = await setup([makeJob("1")]);
    const state2 = newState([makeJob("9", { sourceKey: "fake2:x" })]);
    state2.fail = serverError();
    await addFakeSource(db, {}, "fake2");
    const r = await runPipeline(db, { ...base, retries: 0, adapters: { fake: fakeAdapter(state), fake2: fa(state2, "fake2") } });
    expect(r.status).toBe("partial");
    expect(r.counts).toMatchObject({ sources: 2, sourcesFailed: 1, new: 1 });
  });

  it("invalid source config fails that source with a clear error", async () => {
    const { db, base } = await setup();
    await upsertSource(db, { id: "fake:x", kind: "fake", name: "Fake", config: { titleKeywords: "not-an-array" } });
    const r = await runPipeline(db, base);
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatch(/invalid configuration/);
  });
});

describe("pipeline: job lifecycle and closure", () => {
  it("closes a job only after N complete listings without it AND a verify endpoint confirming it is gone, storing evidence", async () => {
    const { db, base, state, c } = await setup([makeJob("1"), makeJob("2", { title: "Spring Boot Developer" })]);
    await runPipeline(db, base);
    state.jobs = [makeJob("2", { title: "Spring Boot Developer" })];
    state.verify["1"] = false;
    c.advanceDays(1);
    await runPipeline(db, base); // missed once: below closeAfterMissedRuns (2)
    expect((await db.query<{ status: string }>("SELECT status FROM jobs WHERE title = 'Java Backend Engineer' ORDER BY id"))[0].status).toBe("open");
    expect(state.verifyCalls).toEqual([]);
    c.advanceDays(1);
    const r = await runPipeline(db, base); // missed twice -> verify -> closed
    expect(r.counts.closed).toBe(1);
    const closed = (await db.query<any>("SELECT * FROM jobs WHERE status='closed'"))[0];
    expect(closed.lifecycle).toBe("closed");
    expect(closed.closed_at).not.toBeNull();
    const ev = JSON.parse(closed.closure_evidence);
    expect(ev).toMatchObject({ method: "verify_endpoint", missedRuns: 2 });
    expect(ev.detail).toMatch(/fake verify 1/);
  });

  it("does not close when verification is inconclusive or says the job is still open", async () => {
    const { db, base, state, c } = await setup([makeJob("1"), makeJob("2", { title: "Spring Boot Developer" })]);
    await runPipeline(db, base);
    state.jobs = [makeJob("2", { title: "Spring Boot Developer" })];
    state.verify["1"] = null; // e.g. verify endpoint returned 500
    for (let i = 0; i < 3; i++) {
      c.advanceDays(1);
      await runPipeline(db, base);
    }
    expect((await db.query<{ status: string }>("SELECT status FROM jobs")).every((j) => j.status === "open")).toBe(true);
    state.verify["1"] = true;
    c.advanceDays(1);
    await runPipeline(db, base);
    expect((await db.query<{ status: string }>("SELECT status FROM jobs")).every((j) => j.status === "open")).toBe(true);
  });

  it("reopens a closed job that reappears", async () => {
    const { db, base, state, c } = await setup([makeJob("1")]);
    await runPipeline(db, base);
    state.jobs = [];
    state.verify["1"] = false;
    for (let i = 0; i < 2; i++) {
      c.advanceDays(1);
      await runPipeline(db, base);
    }
    expect((await db.query<{ status: string }>("SELECT status FROM jobs"))[0].status).toBe("closed");
    state.jobs = [makeJob("1")];
    c.advanceDays(1);
    const r = await runPipeline(db, base);
    expect(r.counts.updated).toBe(1);
    const row = (await db.query<any>("SELECT status, closure_evidence FROM jobs"))[0];
    expect(row.status).toBe("open");
    expect(row.closure_evidence).toBeNull();
  });

  it("rechecks saved jobs through the verify endpoint when the source listing is unavailable", async () => {
    const { db, base, state, c } = await setup([makeJob("1")]);
    await runPipeline(db, base);
    const jobId = (await db.query<{ id: string }>("SELECT id FROM jobs"))[0].id;
    await saveApplication(db, jobId, { status: "saved" });
    state.fail = serverError();
    state.verify["1"] = false;
    c.advanceDays(1);
    const r = await runPipeline(db, { ...base, retries: 0 });
    expect(r.counts.recheckedSaved).toBe(1);
    expect((await db.query<{ status: string }>("SELECT status FROM jobs"))[0].status).toBe("closed");
    expect((await getApplication(db, jobId))!.status).toBe("saved"); // tracker untouched
  });
});

describe("pipeline: dry-run, locking", () => {
  it("dry-run persists nothing but records the run and reports what would happen", async () => {
    const { db, base } = await setup();
    const r = await runPipeline(db, { ...base, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.counts.new).toBe(2);
    expect(await count(db, "jobs")).toBe(0);
    expect(await count(db, "job_scores")).toBe(0);
    const runs = await listRuns(db);
    expect(runs[0]).toMatchObject({ dryRun: true, status: "success" });
  });

  it("refuses to overlap with a run that holds the lock", async () => {
    const { db, base, c } = await setup();
    await acquireLock(db, "pipeline", "someone-else", 60_000, c.now());
    const r = await runPipeline(db, base);
    expect(r.status).toBe("skipped");
    expect(await count(db, "jobs")).toBe(0);
    expect((await listRuns(db))[0].status).toBe("skipped");
  });

  it("takes over a stale lock (crashed holder) and releases its own", async () => {
    const { db, base, c } = await setup();
    await acquireLock(db, "pipeline", "crashed", 1000, new Date(c.now().getTime() - 3600_000));
    const r = await runPipeline(db, base);
    expect(r.status).toBe("success");
    expect(await count(db, "locks")).toBe(0);
  });
});

describe("pipeline: cross-source deduplication", () => {
  it("merges the same posting arriving from two sources into one job with two sightings", async () => {
    const { db, base, state } = await setup([makeJob("1")]);
    const other = newState([makeJob("zz", { applyUrl: "https://other-board.test/p/9", company: "Acme, Inc." })]);
    await addFakeSource(db, {}, "fake2");
    const r = await runPipeline(db, { ...base, adapters: { fake: fakeAdapter(state), fake2: fa(other, "fake2") } });
    expect(await count(db, "jobs")).toBe(1);
    expect(await count(db, "job_sightings")).toBe(2);
    expect(r.counts).toMatchObject({ new: 1, merged: 1 });
  });

  it("queues an ambiguous match for human review instead of merging", async () => {
    const { db, base, state } = await setup([makeJob("1")]);
    const other = newState([makeJob("zz", { applyUrl: "https://other-board.test/p/9", descriptionText: "" })]);
    await addFakeSource(db, {}, "fake2");
    const r = await runPipeline(db, { ...base, adapters: { fake: fakeAdapter(state), fake2: fa(other, "fake2") } });
    expect(await count(db, "jobs")).toBe(2);
    expect(r.counts.reviewQueued).toBe(1);
    expect(await count(db, "dup_candidates")).toBe(1);
  });
});

describe("pipeline: notifications", () => {
  async function withEmail(opts: { max?: number } = {}) {
    const s = await setup([makeJob("1"), makeJob("2", { title: "Spring Boot Developer" })]);
    const settings = await loadSettings(s.db);
    await saveSettings(s.db, { ...settings, email: { enabled: true, to: "me@example.com" }, schedule: { ...settings.schedule, maxNotificationsPerDay: opts.max ?? 10 } });
    const provider = memoryProvider();
    return { ...s, provider, run: (extra: Partial<RunOptions> = {}) => runPipeline(s.db, { ...s.base, skipNotifications: false, emailProvider: provider, ...extra }) };
  }

  it("emails a digest of new high-priority matches once, never again for the same unchanged listing", async () => {
    const t = await withEmail();
    const r1 = await t.run();
    expect(r1.notify).toMatchObject({ status: "sent", sent: 2 });
    expect(t.provider.sent).toHaveLength(1);
    const msg = t.provider.sent[0];
    expect(msg.html).toContain("https://careers.acme.test/jobs/1");
    expect(msg.text).toMatch(/Score \d+/);
    expect(msg.text).toMatch(/Eligible/);
    t.c.advanceDays(1);
    const r2 = await t.run();
    expect(r2.notify).toMatchObject({ status: "none", sent: 0 });
    expect(t.provider.sent).toHaveLength(1);
  });

  it("notifies again for a meaningful change (published salary appears)", async () => {
    const t = await withEmail();
    await t.run();
    t.state.jobs = [makeJob("1", { salary: { min: 90000, max: 120000, currency: "USD", period: "year" } }), t.state.jobs[1]];
    t.c.advanceDays(1);
    const r = await t.run();
    expect(r.notify).toMatchObject({ status: "sent", sent: 1 });
    expect(t.provider.sent[1].text).toMatch(/Updated/);
  });

  it("respects the maximum notifications per day and carries the rest over", async () => {
    const t = await withEmail({ max: 1 });
    const r1 = await t.run();
    expect(r1.notify).toMatchObject({ candidates: 2, selected: 1, sent: 1 });
    const r1b = await t.run(); // same day again
    expect(r1b.notify).toMatchObject({ status: "skipped", sent: 0 });
    expect(r1b.notify!.skippedReason).toMatch(/cap/i);
    t.c.advanceDays(1);
    const r2 = await t.run();
    expect(r2.notify).toMatchObject({ sent: 1 });
    expect(t.provider.sent).toHaveLength(2);
  });

  it("never notifies about ineligible, synthetic, applied or below-threshold jobs", async () => {
    const t = await withEmail();
    t.state.jobs = [
      makeJob("1", { locationRaw: "Remote - US" }), // ineligible
      makeJob("2", { title: "Java Backend Engineer" }),
      makeJob("3", { descriptionText: "Short.", title: "Account Executive" }), // low score
      makeJob("4", { isSynthetic: true } as any),
    ];
    await runPipeline(t.db, { ...t.base, skipNotifications: true }); // ingest only
    const two = (await t.db.query<{ id: string }>("SELECT id FROM jobs WHERE source_job_id='2'"))[0].id;
    await saveApplication(t.db, two, { status: "applied" });
    const r = await t.run();
    expect(r.notify!.candidates).toBe(0);
    expect(t.provider.sent).toHaveLength(0);
  });

  it("dry-run builds nothing external and does not mark jobs as notified", async () => {
    const t = await withEmail();
    const r = await t.run({ dryRun: true });
    expect(r.notify).toMatchObject({ status: "dry_run", sent: 0 });
    expect(t.provider.sent).toHaveLength(0);
    expect(await count(t.db, "notified_jobs")).toBe(0);
    expect(await count(t.db, "jobs")).toBe(0); // and nothing persisted
  });

  it("retries a temporary provider failure and logs delivery", async () => {
    const t = await withEmail();
    const flaky = memoryProvider({ failTimes: 2 });
    const r = await t.run({ emailProvider: flaky });
    expect(r.notify).toMatchObject({ status: "sent", sent: 2 });
    expect(flaky.attempts).toBe(3);
    const logs = await t.db.query<{ status: string; recipient: string }>("SELECT status, recipient FROM notification_log");
    expect(logs).toEqual([{ status: "sent", recipient: "m***@example.com" }]); // recipient is masked in logs
  });

  it("a provider that keeps failing leaves jobs un-notified so the next run retries", async () => {
    const t = await withEmail();
    const dead = memoryProvider({ failTimes: 99 });
    const r1 = await t.run({ emailProvider: dead });
    expect(r1.notify!.status).toBe("failed");
    expect(await count(t.db, "notified_jobs")).toBe(0);
    t.c.advanceDays(1);
    const r2 = await t.run(); // healthy provider
    expect(r2.notify).toMatchObject({ status: "sent", sent: 2 });
  });

  it("with email disabled, builds the digest but sends and records nothing", async () => {
    const t = await withEmail();
    const s = await loadSettings(t.db);
    await saveSettings(t.db, { ...s, email: { enabled: false, to: "me@example.com" } });
    const r = await t.run();
    expect(r.notify).toMatchObject({ status: "skipped", sent: 0 });
    expect(await count(t.db, "notified_jobs")).toBe(0);
  });

  it("repeats a reminder after the configured number of days for jobs the user hasn't acted on", async () => {
    const t = await withEmail();
    const s = await loadSettings(t.db);
    await saveSettings(t.db, { ...s, email: { enabled: true, to: "me@example.com" }, schedule: { ...s.schedule, reminderDays: 3 } });
    await t.run();
    t.c.advanceDays(2);
    expect((await t.run()).notify!.sent).toBe(0);
    t.c.advanceDays(2);
    expect((await t.run()).notify!.sent).toBe(2);
  });
});

describe("sources listing", () => {
  it("lists configured sources", async () => {
    const { db } = await setup();
    expect((await listSources(db)).map((s) => s.id)).toEqual(["fake:x"]);
  });
});
