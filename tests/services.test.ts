import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { ensureDefaults, seedSyntheticJobs } from "@/lib/seed";
import { listJobs, getJobDetail, overview, toCsv, csvCell, trackerBoard, dueFollowUps, sourceStatuses, notificationLog } from "@/lib/services/queries";
import { updateProfile, updateSettings, updateApplication, resolveDuplicate, addSource, testSource, previewDigest, sendTestEmail, ValidationError, rescoreAll } from "@/lib/services/actions";
import { loadProfile, loadSettings } from "@/lib/db/config";
import { memoryProvider } from "@/lib/notify/providers";
import { getScore, insertJob } from "@/lib/db/jobs";
import { enrichJob } from "@/lib/jobs/enrich";
import { makeJob } from "./helpers/fake-source";

async function seeded() {
  const db = await testDb();
  await ensureDefaults(db);
  return db;
}

describe("seed & bootstrap", () => {
  it("seeds profile, settings, default sources and clearly labelled synthetic jobs", async () => {
    const db = await seeded();
    const { items, total } = await listJobs(db, { includeSynthetic: true, pageSize: 100 });
    expect(total).toBe(14); // 15 synthetic inputs, one is a cross-posted duplicate that must merge
    expect(items.every((i) => i.job.isSynthetic)).toBe(true);
    expect(items.every((i) => i.job.description.startsWith("[SYNTHETIC SAMPLE"))).toBe(true);
    expect(items.every((i) => i.job.applyUrl.startsWith("https://example.com/synthetic/"))).toBe(true);
    expect(items.every((i) => i.score)).toBe(true);
    expect((await sourceStatuses(db)).map((s) => s.id).sort()).toEqual(["greenhouse:gitlab", "lever:spotify"]);
  });

  it("is idempotent: a second bootstrap adds nothing and deleted default sources stay deleted", async () => {
    const db = await seeded();
    await db.run("DELETE FROM sources WHERE id='lever:spotify'");
    await ensureDefaults(db);
    expect((await listJobs(db, { includeSynthetic: true, pageSize: 100 })).total).toBe(14);
    expect((await sourceStatuses(db)).map((s) => s.id)).toEqual(["greenhouse:gitlab"]);
  });

  it("hides synthetic jobs unless asked", async () => {
    const db = await seeded();
    expect((await listJobs(db, {})).total).toBe(0);
  });
});

describe("listJobs filters", () => {
  it("filters by band, eligibility, score, text, skill and salary; sorts by score", async () => {
    const db = await seeded();
    const f = (x: object) => listJobs(db, { includeSynthetic: true, pageSize: 100, ...x });
    const all = await f({});
    const scores = all.items.map((i) => i.score!.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    expect((await f({ band: "high" })).items.every((i) => i.score!.band === "high")).toBe(true);
    expect((await f({ eligibility: "ineligible" })).items.every((i) => i.score!.eligibility === "ineligible")).toBe(true);
    expect((await f({ eligibility: "actionable" })).items.every((i) => i.score!.actionable)).toBe(true);
    expect((await f({ minScore: 90 })).items.every((i) => i.score!.score >= 90)).toBe(true);
    expect((await f({ q: "telecom" })).total).toBeGreaterThan(0);
    expect((await f({ q: "%" })).total).toBe(0); // LIKE wildcards are escaped
    const kafka = await f({ skill: "kafka" });
    expect(kafka.total).toBeGreaterThan(0);
    expect(kafka.items.every((i) => [...i.job.requiredSkills, ...i.job.preferredSkills].some((s) => s.id === "kafka"))).toBe(true);
    // Unknown salary never satisfies a salary filter
    const paid = await f({ minSalary: 1 });
    expect(paid.total).toBeGreaterThan(0);
    expect(paid.items.every((i) => (i.job.salaryMax ?? i.job.salaryMin) !== null)).toBe(true);
    expect(paid.total).toBeLessThan(all.total);
  });

  it("paginates", async () => {
    const db = await seeded();
    const p1 = await listJobs(db, { includeSynthetic: true, pageSize: 5, page: 1 });
    const p3 = await listJobs(db, { includeSynthetic: true, pageSize: 5, page: 3 });
    expect(p1.items).toHaveLength(5);
    expect(p3.items).toHaveLength(4);
    expect(p1.total).toBe(14);
  });

  it("is not vulnerable to SQL injection through filters", async () => {
    const db = await seeded();
    const r = await listJobs(db, { includeSynthetic: true, q: "'; DROP TABLE jobs; --", skill: '"%\'', country: "' OR 1=1 --" });
    expect(r.total).toBe(0);
    expect((await listJobs(db, { includeSynthetic: true })).total).toBe(14);
  });
});

describe("job detail", () => {
  it("returns score breakdown, sightings and tracker state", async () => {
    const db = await seeded();
    const top = (await listJobs(db, { includeSynthetic: true, pageSize: 1 })).items[0];
    const d = await getJobDetail(db, top.job.id);
    expect(d!.score!.breakdown.length).toBeGreaterThan(0);
    expect(d!.sightings.length).toBeGreaterThan(0);
    expect(d!.application).toBeNull();
    expect(await getJobDetail(db, "nope")).toBeNull();
  });
});

describe("tracker", () => {
  it("validates and persists status, notes and follow-ups; board groups by status; due follow-ups surface", async () => {
    const db = await seeded();
    const [a, b] = (await listJobs(db, { includeSynthetic: true, pageSize: 2 })).items;
    await updateApplication(db, a.job.id, { status: "saved", notes: "Looks great" });
    await updateApplication(db, b.job.id, { status: "applied", followUpAt: "2026-10-01T00:00:00Z" });
    const board = await trackerBoard(db, true);
    expect(board.saved.map((i) => i.job.id)).toEqual([a.job.id]);
    expect(board.applied[0].application!.appliedAt).toBeTruthy(); // auto-stamped
    expect((await dueFollowUps(db, new Date("2026-10-19T00:00:00Z"))).map((i) => i.job.id)).toEqual([b.job.id]);
    await expect(updateApplication(db, a.job.id, { status: "hired" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateApplication(db, a.job.id, { followUpAt: "tomorrow" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateApplication(db, "missing", { status: "saved" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("profile & settings editing", () => {
  it("persists profile edits and re-scores jobs; weights change scores", async () => {
    const db = await seeded();
    const before = (await listJobs(db, { includeSynthetic: true, q: "Backend Engineer (Python)" })).items[0];
    const profile = await loadProfile(db);
    const edited = { ...profile, yearsExperience: 3, skills: [...profile.skills.filter((s) => s.id !== "python"), { id: "python", level: "expert" }] };
    const r = await updateProfile(db, edited);
    expect(r.rescored).toBeGreaterThan(0);
    expect((await loadProfile(db)).yearsExperience).toBe(3);
    const after = (await listJobs(db, { includeSynthetic: true, q: "Backend Engineer (Python)" })).items[0];
    expect(after.score!.score).toBeGreaterThanOrEqual(before.score!.score);
    expect(after.score!.profileHash).not.toBe(before.score!.profileHash);
    expect(await rescoreAll(db)).toBe(0); // nothing stale now
  });

  it("rejects invalid profile data without changing anything", async () => {
    const db = await seeded();
    const profile = await loadProfile(db);
    await expect(updateProfile(db, { ...profile, yearsExperience: -4 })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateProfile(db, { ...profile, weights: { ...profile.weights, javaSpring: 0, backendMicroservices: 0, dataApi: 0, opsTooling: 0, seniorityFit: 0, eligibility: 0, preferences: 0 } })).rejects.toBeInstanceOf(ValidationError);
    expect((await loadProfile(db)).yearsExperience).toBe(profile.yearsExperience);
  });

  it("re-bands jobs when thresholds change and validates ordering and timezone", async () => {
    const db = await seeded();
    const s = await loadSettings(db);
    const highBefore = (await listJobs(db, { includeSynthetic: true, band: "high", pageSize: 100 })).total;
    await updateSettings(db, { scoring: { bands: { high: 99, good: 70, review: 50 } } });
    const highAfter = (await listJobs(db, { includeSynthetic: true, band: "high", pageSize: 100 })).total;
    expect(highAfter).toBeLessThan(highBefore);
    await expect(updateSettings(db, { scoring: { bands: { high: 60, good: 70, review: 50 } } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSettings(db, { schedule: { ...s.schedule, timezone: "Mars/Olympus" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSettings(db, { schedule: { ...s.schedule, time: "25:99" } })).rejects.toBeInstanceOf(ValidationError);
    const ok = await updateSettings(db, { schedule: { ...s.schedule, time: "06:30", timezone: "Asia/Karachi" } });
    expect(ok.settings.schedule.time).toBe("06:30");
  });

  it("enabling on-site Pakistan changes preference exclusion without touching eligibility", async () => {
    const db = await seeded();
    const lahore = async () => (await listJobs(db, { includeSynthetic: true, q: "Synthetic Logistics" })).items[0].score!;
    const off = await lahore();
    expect(off.actionable).toBe(false);
    await updateSettings(db, { search: { includeHybridPakistan: true } });
    const on = await lahore();
    expect(on.actionable).toBe(true);
    expect(on.eligibility).toBe(off.eligibility);
  });
});

describe("overview", () => {
  it("summarises counts, bands, top matches and last run", async () => {
    const db = await seeded();
    const o = await overview(db, { includeSynthetic: true, timezone: "Asia/Karachi" });
    expect(o.totals.open).toBe(14);
    expect(o.totals.synthetic).toBe(14);
    expect(Object.values(o.bands).reduce((a, b) => a + b, 0)).toBe(14);
    expect(o.topMatches.length).toBeGreaterThan(0);
    expect(o.topMatches.every((m) => m.score!.actionable)).toBe(true);
    expect(o.newToday).toBe(14);
    const empty = await overview(db, { includeSynthetic: false, timezone: "Asia/Karachi" });
    expect(empty.totals.open).toBe(0);
    expect(empty.topMatches).toEqual([]);
  });
});

describe("CSV export", () => {
  it("quotes properly and neutralises spreadsheet formulas from untrusted job text", () => {
    expect(csvCell('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toMatch(/^"'=HYPERLINK/);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
  it("exports a header and one row per job", async () => {
    const db = await seeded();
    const { items } = await listJobs(db, { includeSynthetic: true, pageSize: 100 });
    const csv = toCsv(items);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(15);
    expect(lines[0].split(",")[0]).toBe("id");
    expect(csv).toContain("example.com/synthetic");
  });
});

describe("sources", () => {
  it("validates adapter config and rejects unknown kinds / path injection", async () => {
    const db = await seeded();
    await expect(addSource(db, { kind: "greenhouse", config: { boardToken: "../../etc" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(addSource(db, { kind: "linkedin", config: {} })).rejects.toBeInstanceOf(ValidationError);
    expect(await addSource(db, { kind: "greenhouse", config: { boardToken: "Acme-Corp", companyName: "Acme" } })).toEqual({ id: "greenhouse:acme-corp" });
    await expect(addSource(db, { kind: "greenhouse", config: { boardToken: "acme-corp" } })).rejects.toThrow(/already exists/);
  });

  it("testSource reports success with a sample, and failures with the HTTP status, storing nothing", async () => {
    const db = await seeded();
    const ok = await testSource(
      { kind: "greenhouse", config: { boardToken: "acme" } },
      { fetchImpl: (async () => new Response(JSON.stringify({ jobs: [{ id: 1, title: "Java Dev", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: "Remote" }, content: "<p>Java</p>" }] }), { status: 200 })) as typeof fetch },
    );
    expect(ok).toMatchObject({ ok: true, listed: 1, valid: 1, httpStatus: 200 });
    const bad = await testSource({ kind: "greenhouse", config: { boardToken: "nope" } }, { fetchImpl: (async () => new Response("no", { status: 404 })) as typeof fetch, sleep: async () => {} });
    expect(bad).toMatchObject({ ok: false, httpStatus: 404 });
    expect((await sourceStatuses(db)).length).toBe(2);
  });
});

describe("duplicate review", () => {
  it("merges or dismisses a pending candidate; tracker data survives a merge", async () => {
    const db = await seeded();
    const now = new Date().toISOString();
    const a = await insertJob(db, enrichJob(makeJob("a1", { title: "Dup Candidate One", sourceKey: "fake:x" })), now);
    const b = await insertJob(db, enrichJob(makeJob("b1", { title: "Dup Candidate Two", sourceKey: "fake:y" })), now);
    await db.run("INSERT INTO dup_candidates (id, job_a, job_b, similarity, reason, status, created_at) VALUES ('dc1',?,?,0.5,'test','pending',?)", [a.id, b.id, now]);
    await updateApplication(db, b.id, { status: "interview", notes: "phone screen" });
    expect((await resolveDuplicate(db, "dc1", "merge", a.id)).status).toBe("merged");
    expect(await getJobDetail(db, b.id)).toBeNull();
    expect((await getJobDetail(db, a.id))!.application).toMatchObject({ status: "interview", notes: "phone screen" });
    await expect(resolveDuplicate(db, "dc1", "distinct")).rejects.toMatchObject({ status: 404 });
  });
});

describe("email preview and test-send", () => {
  it("previews a digest with required fields without recording notifications", async () => {
    const db = await seeded();
    const p = await previewDigest(db);
    expect(p.empty).toBe(false);
    expect(p.subject).toContain("[PREVIEW]");
    for (const needle of ["Score", "Eligible", "Location:", "Salary:", "Posted:", "Missing mandatory", "Original application link", "Open in dashboard", "SYNTHETIC SAMPLE"]) expect(p.html).toContain(needle);
    expect((await db.query("SELECT COUNT(*) n FROM notified_jobs"))[0].n).toBe(0);
    expect(await previewDigest(db, { includeSynthetic: false })).toMatchObject({ empty: true });
  });

  it("test-send uses the provider, is logged, masks the recipient and never marks jobs notified", async () => {
    const db = await seeded();
    const provider = memoryProvider();
    const r = await sendTestEmail(db, { provider, to: "someone@example.com" });
    expect(r).toMatchObject({ ok: true, provider: "memory" });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].subject).toContain("[TEST]");
    const log = await notificationLog(db);
    expect(log[0]).toMatchObject({ kind: "test", status: "sent" });
    expect(log[0].recipient).not.toContain("someone@");
    expect((await db.query("SELECT COUNT(*) n FROM notified_jobs"))[0].n).toBe(0);
  });

  it("reports provider failure and logs it; rejects invalid recipients", async () => {
    const db = await seeded();
    const failing = memoryProvider({ failTimes: 10 });
    const r = await sendTestEmail(db, { provider: failing, to: "a@b.co" });
    expect(r.ok).toBe(false);
    expect((await notificationLog(db))[0]).toMatchObject({ status: "failed" });
    await expect(sendTestEmail(db, { provider: memoryProvider(), to: "not-an-email" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("scores stay consistent", () => {
  it("every stored score has an explanation and eligibility separate from technical score", async () => {
    const db = await seeded();
    const { items } = await listJobs(db, { includeSynthetic: true, pageSize: 100 });
    for (const i of items) {
      const s = (await getScore(db, i.job.id))!;
      expect(s.explanation.verdict).toBeTruthy();
      expect(["eligible", "potential", "ineligible"]).toContain(s.eligibility);
      expect(typeof s.technicalScore).toBe("number");
    }
  });
});
