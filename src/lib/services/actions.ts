import { z } from "zod";
import type { Db } from "../db/types";
import { loadProfile, loadSettings, saveProfile, saveSettings, scoringFingerprint } from "../db/config";
import { rescoreStale, type IngestEnv } from "../pipeline/ingest";
import { saveApplication } from "../db/applications";
import { mergeJobs } from "../db/merge";
import { APPLICATION_STATUSES } from "../jobs/types";
import { deleteSource, getSource, setSourceEnabled, upsertSource } from "../db/sources";
import { SCHEDULED_ADAPTERS } from "../sources/registry";
import { RetryExhaustedError, withRetry } from "../sources/retry";
import { runPipeline, type RunOptions, type RunSummary } from "../pipeline/run";
import { buildDigest } from "../notify/digest";
import { selectDigestCandidates, logDelivery } from "../notify/stage";
import { fromAddress, providerFromEnv, type EmailProvider } from "../notify/providers";
import { getJob } from "../db/jobs";

export class ValidationError extends Error {
  status = 400;
}

async function env(db: Db): Promise<IngestEnv> {
  const profile = await loadProfile(db);
  const settings = await loadSettings(db);
  const now = new Date().toISOString();
  return { profile, settings, fingerprint: scoringFingerprint(profile, settings), nowIso: now, runStartIso: now };
}

/** Re-score every job whose score was computed with different profile/settings. Returns how many were re-scored. */
export async function rescoreAll(db: Db): Promise<number> {
  const e = await env(db);
  return db.transaction((tx) => rescoreStale(tx, e));
}

function wrapZod<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof z.ZodError) throw new ValidationError(e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "));
    if (e instanceof Error && /^(Band thresholds|At least one match weight)/.test(e.message)) throw new ValidationError(e.message);
    throw e;
  });
}

export async function updateProfile(db: Db, input: unknown) {
  return wrapZod(async () => {
    const profile = await saveProfile(db, input);
    const rescored = await rescoreAll(db);
    return { profile, rescored };
  });
}

export async function updateSettings(db: Db, input: unknown) {
  return wrapZod(async () => {
    const settings = await saveSettings(db, input);
    const rescored = await rescoreAll(db);
    return { settings, rescored };
  });
}

// ---- tracker ----
const ApplicationPatchSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: z.string().max(10_000).optional(),
  appliedAt: z.string().datetime({ offset: true }).nullable().optional(),
  followUpAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function updateApplication(db: Db, jobId: string, input: unknown) {
  return wrapZod(async () => {
    if (!(await getJob(db, jobId))) throw Object.assign(new Error("Job not found"), { status: 404 });
    const patch = ApplicationPatchSchema.parse(input);
    return saveApplication(db, jobId, patch);
  });
}

// ---- duplicates ----
export async function resolveDuplicate(db: Db, id: string, action: "merge" | "distinct", keepId?: string) {
  const rows = await db.query("SELECT * FROM dup_candidates WHERE id=? AND status='pending'", [id]);
  if (!rows.length) throw Object.assign(new Error("Duplicate candidate not found or already resolved"), { status: 404 });
  const { job_a: a, job_b: b } = rows[0];
  const now = new Date().toISOString();
  if (action === "distinct") {
    await db.run("UPDATE dup_candidates SET status='distinct', resolved_at=? WHERE id=?", [now, id]);
    return { status: "distinct" };
  }
  const keep = keepId ?? a;
  if (keep !== a && keep !== b) throw new ValidationError("keepId must be one of the two jobs");
  await mergeJobs(db, keep, keep === a ? b : a, now);
  return { status: "merged", keepId: keep };
}

// ---- sources ----
const AddSourceSchema = z.object({
  kind: z.string(),
  config: z.record(z.string(), z.unknown()),
  name: z.string().max(200).optional(),
});

export async function addSource(db: Db, input: unknown) {
  return wrapZod(async () => {
    const { kind, config, name } = AddSourceSchema.parse(input);
    const adapter = SCHEDULED_ADAPTERS[kind];
    if (!adapter) throw new ValidationError(`Unsupported source kind "${kind}". Supported: ${Object.keys(SCHEDULED_ADAPTERS).join(", ")}`);
    const cfg = adapter.configSchema.parse(config);
    const id = adapter.sourceKey(cfg);
    if (await getSource(db, id)) throw new ValidationError(`Source ${id} already exists`);
    await upsertSource(db, { id, kind, name: name || `${(cfg as any).companyName ?? id} (${adapter.info.title})`, config: cfg, enabled: true });
    return { id };
  });
}

export const toggleSource = (db: Db, id: string, enabled: boolean) => setSourceEnabled(db, id, enabled);
export const removeSource = (db: Db, id: string) => deleteSource(db, id);

/** Live check of a source configuration. Fetches once and reports; stores nothing. */
export async function testSource(input: unknown, opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
  return wrapZod(async () => {
    const { kind, config } = AddSourceSchema.pick({ kind: true, config: true }).parse(input);
    const adapter = SCHEDULED_ADAPTERS[kind];
    if (!adapter) throw new ValidationError(`Unsupported source kind "${kind}"`);
    const cfg = adapter.configSchema.parse(config);
    const logs: string[] = [];
    const t0 = Date.now();
    try {
      const { value, attempts } = await withRetry(
        () => adapter.fetchJobs(cfg, { fetch: opts.fetchImpl ?? fetch, now: () => new Date(), log: (l, m) => logs.push(`${l}: ${m}`), timeoutMs: 30_000 }),
        { retries: 1, baseMs: 500, maxMs: 2000, sleep: opts.sleep },
      );
      return { ok: true as const, attempts, ms: Date.now() - t0, listed: value.totalListed, valid: value.jobs.length, httpStatus: value.httpStatus, complete: value.complete, sample: value.jobs.slice(0, 3).map((j) => ({ title: j.title, location: j.locationRaw ?? null, url: j.applyUrl })), notes: [...value.notes, ...logs] };
    } catch (e: any) {
      const status = e instanceof RetryExhaustedError ? e.status : e?.status;
      return { ok: false as const, error: String(e?.message ?? e).slice(0, 300), httpStatus: status ?? null, ms: Date.now() - t0, notes: logs };
    }
  });
}

// ---- runs ----
export async function runNow(db: Db, o: { dryRun?: boolean; lookbackDays?: number; minMatchScore?: number; maxNotifications?: number } = {}, extra: Partial<RunOptions> = {}): Promise<RunSummary> {
  const settings = await loadSettings(db);
  return runPipeline(db, {
    trigger: "manual",
    dryRun: o.dryRun ?? settings.schedule.dryRun,
    lookbackDays: o.lookbackDays ?? settings.schedule.lookbackDays,
    minMatchScore: o.minMatchScore ?? settings.schedule.minMatchScore,
    maxNotifications: o.maxNotifications ?? settings.schedule.maxNotificationsPerDay,
    ...extra,
  });
}

// ---- email ----
/** Build a digest of the best current matches without sending or recording anything. Includes labelled samples so it is never empty on a fresh install. */
export async function previewDigest(db: Db, o: { includeSynthetic?: boolean } = {}) {
  const settings = await loadSettings(db);
  const now = new Date();
  const candidates = await selectDigestCandidates(db, { settings, minScore: settings.schedule.minMatchScore, now, includeSynthetic: o.includeSynthetic ?? true, ignoreNotified: true });
  const chosen = candidates.slice(0, Math.max(1, Math.min(settings.schedule.maxNotificationsPerDay || 10, 10)));
  if (!chosen.length) return { empty: true as const, count: 0, subject: null, html: null, text: null, candidates: 0 };
  const digest = buildDigest(chosen.map((c) => c.item), { dashboardUrl: process.env.APP_BASE_URL || "http://localhost:3000", now, label: "PREVIEW" });
  return { empty: false as const, count: chosen.length, candidates: candidates.length, subject: digest.subject, html: digest.html, text: digest.text };
}

/**
 * Explicit, user-initiated test send. Uses the configured provider (outbox by default = nothing leaves the machine).
 * Does NOT mark any job as notified, so it never suppresses a real notification.
 */
export async function sendTestEmail(db: Db, o: { provider?: EmailProvider; to?: string } = {}) {
  const settings = await loadSettings(db);
  const to = o.to || settings.email.to || process.env.EMAIL_TO || "";
  if (!to) throw new ValidationError("No recipient configured. Set a recipient in Settings or EMAIL_TO.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ValidationError("Recipient is not a valid email address");
  const preview = await previewDigest(db);
  const now = new Date();
  const provider = o.provider ?? providerFromEnv();
  const subject = preview.empty ? "[TEST] Job Hunter test message" : preview.subject!.replace("[PREVIEW]", "[TEST]");
  const text = preview.empty ? "This is a test message from your Job Hunter. There are no matching jobs yet." : preview.text!;
  const html = preview.empty ? "<p>This is a test message from your Job Hunter. There are no matching jobs yet.</p>" : preview.html!;
  try {
    const { value } = await withRetry(() => provider.send({ to, from: fromAddress(), subject, html, text }), { retries: 1, baseMs: 500, maxMs: 2000 });
    await logDelivery(db, { kind: "test", provider: provider.name, recipient: to, subject, status: "sent", now });
    return { ok: true as const, provider: provider.name, deliversExternally: provider.deliversExternally, location: value.location ?? null };
  } catch (e: any) {
    await logDelivery(db, { kind: "test", provider: provider.name, recipient: to, subject, status: "failed", error: e?.message ?? String(e), now });
    return { ok: false as const, provider: provider.name, deliversExternally: provider.deliversExternally, error: String(e?.message ?? e).slice(0, 300) };
  }
}
