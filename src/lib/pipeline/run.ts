import type { Db } from "../db/types";
import { RollbackSignal } from "../db/types";
import { acquireLock, extendLock, releaseLock } from "../db/locks";
import { loadProfile, loadSettings, scoringFingerprint } from "../db/config";
import { listSources, type SourceRow } from "../db/sources";
import { createRun, failOrphanedRuns, finishRun, insertSourceRun, updateSourceRunCounts, writeLogs, type LogLine } from "../db/runs";
import { markJobClosed, markVerifiedOpen, touchSighting } from "../db/jobs";
import { enrichJob } from "../jobs/enrich";
import type { NormalizedJobInput } from "../jobs/types";
import { ingestJob, rescoreStale, type IngestEnv } from "./ingest";
import { getAdapter } from "../sources/registry";
import { RetryExhaustedError, withRetry } from "../sources/retry";
import type { FetchContext, FetchResult, SourceAdapter } from "../sources/types";
import type { AppSettings, Profile } from "../config/schema";
import { newId } from "../util";
import { planDigest, runNotifyStage, type DigestPlan, type NotifyStageResult } from "../notify/stage";
import type { EmailProvider } from "../notify/providers";

export interface RunOptions {
  trigger: "manual" | "scheduled" | "cli" | "test";
  dryRun?: boolean;
  lookbackDays?: number;
  minMatchScore?: number;
  maxNotifications?: number;
  sourceKeys?: string[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  adapters?: Record<string, SourceAdapter>;
  emailProvider?: EmailProvider;
  skipNotifications?: boolean;
  lockTtlMs?: number;
}

export interface RunSummary {
  runId: string;
  status: "success" | "partial" | "failed" | "skipped";
  dryRun: boolean;
  counts: Record<string, number>;
  errors: string[];
  notify?: NotifyStageResult;
}

const LOCK = "pipeline";
const ZERO = () => ({
  sources: 0, sourcesFailed: 0, listed: 0, kept: 0, filteredKeywords: 0, filteredLookback: 0, invalid: 0,
  new: 0, updated: 0, seen: 0, merged: 0, reviewQueued: 0, closed: 0, closureInconclusive: 0, scored: 0, recheckedSaved: 0,
  highPriorityNew: 0, notified: 0, errors: 0,
});

interface Fetched {
  src: SourceRow;
  adapter: SourceAdapter;
  config: any;
  fetched: FetchResult;
  sourceRunId: string;
}

interface ClosureCandidate {
  jobId: string;
  sourceJobId: string;
  sightingId: string;
  missedRuns: number;
}

export async function runPipeline(db: Db, opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const startIso = startedAt.toISOString();
  const dryRun = !!opts.dryRun;
  const settings = await loadSettings(db);
  const profile = await loadProfile(db);
  const lookbackDays = opts.lookbackDays ?? settings.schedule.lookbackDays;
  const params = {
    lookbackDays,
    minMatchScore: opts.minMatchScore ?? settings.schedule.minMatchScore,
    maxNotifications: opts.maxNotifications ?? settings.schedule.maxNotificationsPerDay,
    sourceKeys: opts.sourceKeys ?? null,
  };

  const holder = `run-${process.pid}-${newId()}`;
  const ttl = opts.lockTtlMs ?? 30 * 60_000;
  if (!(await acquireLock(db, LOCK, holder, ttl, startedAt))) {
    const runId = await createRun(db, { trigger: opts.trigger, dryRun, params, startedAt: startIso, status: "skipped", error: "Another run is already in progress" });
    await finishRun(db, runId, { status: "skipped", finishedAt: startIso, durationMs: 0, counts: {}, error: "Another run is already in progress" });
    return { runId, status: "skipped", dryRun, counts: {}, errors: ["Another run is already in progress"] };
  }

  const logs: LogLine[] = [];
  const log = (level: LogLine["level"], message: string, sourceKey?: string) => logs.push({ ts: now().toISOString(), level, message, sourceKey });
  const flush = async (runId: string) => {
    const batch = logs.splice(0, logs.length);
    if (batch.length) await writeLogs(db, runId, batch);
  };

  await failOrphanedRuns(db, startIso);
  const runId = await createRun(db, { trigger: opts.trigger, dryRun, params, startedAt: startIso });
  const counts = ZERO();
  const errors: string[] = [];
  let notify: NotifyStageResult | undefined;
  let fatal: string | null = null;

  try {
    log("info", `Run started (${opts.trigger}${dryRun ? ", dry-run" : ""}); lookback ${lookbackDays}d`);
    const env: IngestEnv = { profile, settings, fingerprint: scoringFingerprint(profile, settings), nowIso: startIso, runStartIso: startIso };
    const ctx: FetchContext = { fetch: opts.fetchImpl ?? fetch, now, log: (l, m) => log(l, m), timeoutMs: 30_000 };

    let sources = (await listSources(db)).filter((s) => s.enabled);
    if (opts.sourceKeys?.length) sources = sources.filter((s) => opts.sourceKeys!.includes(s.id));
    if (!sources.length) log("warn", "No enabled sources configured");

    const verifiedThisRun = new Set<string>(); // source keys whose complete listing we saw
    const fetchedList: Fetched[] = [];
    const closureWork: { source: SourceRow; adapter: SourceAdapter; config: any; candidates: ClosureCandidate[]; sourceRunId: string }[] = [];

    // ---------------- fetch + process each source ----------------
    for (const src of sources) {
      counts.sources++;
      const adapter = getAdapter(src.kind, opts.adapters);
      const sourceStart = now().toISOString();
      if (!adapter) {
        counts.sourcesFailed++;
        counts.errors++;
        const msg = `Source ${src.id}: unknown adapter kind "${src.kind}"`;
        errors.push(msg);
        log("error", msg, src.id);
        await insertSourceRun(db, { runId, sourceKey: src.id, status: "failed", attempts: 0, startedAt: sourceStart, finishedAt: now().toISOString(), fetched: 0, kept: 0, newCount: 0, updatedCount: 0, closedCount: 0, error: msg, httpStatus: null });
        continue;
      }
      let config: any;
      try {
        config = adapter.configSchema.parse(src.config);
      } catch (e: any) {
        counts.sourcesFailed++;
        counts.errors++;
        const msg = `Source ${src.id}: invalid configuration (${e?.issues?.[0]?.message ?? e?.message ?? e})`;
        errors.push(msg);
        log("error", msg, src.id);
        await insertSourceRun(db, { runId, sourceKey: src.id, status: "failed", attempts: 0, startedAt: sourceStart, finishedAt: now().toISOString(), fetched: 0, kept: 0, newCount: 0, updatedCount: 0, closedCount: 0, error: msg, httpStatus: null });
        continue;
      }

      let fetched: FetchResult;
      let attempts = 0;
      try {
        const r = await withRetry(() => adapter.fetchJobs(config, ctx), {
          retries: opts.retries ?? 3,
          baseMs: opts.backoffBaseMs ?? 1000,
          maxMs: opts.backoffMaxMs ?? 20_000,
          sleep: opts.sleep,
          onRetry: ({ attempt, delayMs, error }) => log("warn", `Attempt ${attempt} failed (${(error as Error)?.message}); retrying in ${delayMs}ms`, src.id),
        });
        fetched = r.value;
        attempts = r.attempts;
      } catch (e: any) {
        // A failed fetch is recorded as failed health evidence. It never closes or modifies any job.
        const re = e as RetryExhaustedError;
        counts.sourcesFailed++;
        counts.errors++;
        const msg = `Source ${src.id} failed after ${re.attempts ?? 1} attempt(s): ${re.message ?? e}`;
        errors.push(msg);
        log("error", msg, src.id);
        await insertSourceRun(db, { runId, sourceKey: src.id, status: "failed", attempts: re.attempts ?? 1, startedAt: sourceStart, finishedAt: now().toISOString(), fetched: 0, kept: 0, newCount: 0, updatedCount: 0, closedCount: 0, error: msg.slice(0, 500), httpStatus: re.status ?? null });
        await flush(runId);
        continue;
      }

      counts.listed += fetched.totalListed;
      for (const n of fetched.notes) log("warn", n, src.id);
      log("info", `Fetched ${fetched.totalListed} posting(s) in ${attempts} attempt(s)`, src.id);
      const sourceRunId = await insertSourceRun(db, {
        runId, sourceKey: src.id, status: "ok", attempts, startedAt: sourceStart, finishedAt: now().toISOString(), fetched: fetched.totalListed, kept: 0, newCount: 0, updatedCount: 0, closedCount: 0, error: null, httpStatus: fetched.httpStatus,
      });
      if (fetched.complete) verifiedThisRun.add(src.id);

      fetchedList.push({ src, adapter, config, fetched, sourceRunId });
      await extendLock(db, LOCK, holder, ttl, now());
      await flush(runId);
    }

    // ---------------- apply fetched data to the database ----------------
    const pparams = { lookbackDays, closeAfter: settings.schedule.closeAfterMissedRuns, now: startedAt };
    const applied: { w: Fetched; local: ReturnType<typeof ZERO>; candidates: ClosureCandidate[] }[] = [];
    const planInput = { now, settings, minScore: params.minMatchScore, maxPerDay: params.maxNotifications, dryRun };
    let dryPlan: DigestPlan | undefined;

    if (!dryRun) {
      for (const w of fetchedList) {
        const local = ZERO();
        try {
          const candidates = await db.transaction((tx) => processSource(tx, w.src, w.config, w.fetched, env, pparams, local, log));
          applied.push({ w, local, candidates });
        } catch (e: any) {
          counts.errors++;
          errors.push(`Source ${w.src.id}: could not save results (${e?.message ?? e})`);
          log("error", `Could not save results: ${e?.message ?? e}`, w.src.id);
        }
      }
      counts.scored = await db.transaction((tx) => rescoreStale(tx, env));
    } else {
      // Dry run: apply everything inside ONE transaction, plan the digest against that state, then roll back.
      await db.transaction(async (tx) => {
        for (const w of fetchedList) {
          const local = ZERO();
          const candidates = await processSource(tx, w.src, w.config, w.fetched, env, pparams, local, log);
          applied.push({ w, local, candidates });
        }
        counts.scored = await rescoreStale(tx, env);
        if (!opts.skipNotifications) dryPlan = await planDigest(tx, planInput);
        throw new RollbackSignal();
      });
    }
    for (const a of applied) {
      for (const k of ["kept", "filteredKeywords", "filteredLookback", "invalid", "new", "updated", "seen", "merged", "reviewQueued"] as const) counts[k] += a.local[k];
      await updateSourceRunCounts(db, a.w.sourceRunId, { kept: a.local.kept, newCount: a.local.new, updatedCount: a.local.updated, closedCount: 0 });
      closureWork.push({ source: a.w.src, adapter: a.w.adapter, config: a.w.config, candidates: a.candidates, sourceRunId: a.w.sourceRunId });
    }
    await flush(runId);

    // ---------------- closure verification (network, outside any transaction) ----------------
    for (const w of closureWork) {
      for (const c of w.candidates) {
        if (!w.adapter.verifyJob) {
          if (!dryRun) await markJobClosed(db, c.jobId, now().toISOString(), { at: now().toISOString(), method: "missing_from_listing", detail: `Absent from ${w.candidates.length ? "" : ""}${w.source.id} listing for ${c.missedRuns} consecutive complete runs`, missedRuns: c.missedRuns });
          counts.closed++;
          continue;
        }
        const v = await w.adapter.verifyJob(w.config, c.sourceJobId, ctx);
        if (v.open === false) {
          log("info", `Closing job ${c.jobId}: ${v.evidence}`, w.source.id);
          if (!dryRun) {
            await markJobClosed(db, c.jobId, now().toISOString(), { at: now().toISOString(), method: "verify_endpoint", detail: `${v.evidence}; absent from ${c.missedRuns} consecutive complete listings`, missedRuns: c.missedRuns });
          }
          counts.closed++;
        } else if (v.open === true) {
          log("info", `Job ${c.jobId} missing from listing but still verifiable as open (${v.evidence}); keeping open`, w.source.id);
          if (!dryRun) {
            await touchSighting(db, c.sightingId, now().toISOString());
            await markVerifiedOpen(db, c.jobId, now().toISOString());
          }
        } else {
          counts.closureInconclusive++;
          log("warn", `Could not verify job ${c.jobId} (${v.evidence}); not closing`, w.source.id);
        }
      }
    }

    // ---------------- recheck saved/applied jobs not covered by a complete listing ----------------
    const recheck = await db.query<{ id: string; source_key: string; source_job_id: string }>(
      `SELECT j.id, s.source_key, s.source_job_id FROM jobs j
       JOIN applications a ON a.job_id = j.id
       JOIN job_sightings s ON s.job_id = j.id
       WHERE j.status = 'open' AND a.status IN ('to_review','saved','ready_to_apply','applied','interview')`,
    );
    const rechecked = new Set<string>();
    const allSources = new Map((await listSources(db)).map((s) => [s.id, s]));
    for (const r of recheck) {
      if (rechecked.has(r.id) || verifiedThisRun.has(r.source_key)) continue;
      const src = allSources.get(r.source_key);
      const adapter = src && getAdapter(src.kind, opts.adapters);
      if (!src || !adapter?.verifyJob) continue;
      let cfg: any;
      try {
        cfg = adapter.configSchema.parse(src.config);
      } catch {
        continue;
      }
      rechecked.add(r.id);
      counts.recheckedSaved++;
      const v = await adapter.verifyJob(cfg, r.source_job_id, ctx);
      if (v.open === false) {
        if (!dryRun) await markJobClosed(db, r.id, now().toISOString(), { at: now().toISOString(), method: "verify_endpoint", detail: v.evidence });
        counts.closed++;
        log("info", `Saved job ${r.id} no longer available: ${v.evidence}`, r.source_key);
      } else if (v.open === true && !dryRun) await markVerifiedOpen(db, r.id, now().toISOString());
    }

    // ---------------- notifications (digest) ----------------
    if (!opts.skipNotifications) {
      notify = await runNotifyStage(db, {
        runId, now, dryRun, settings, profile, minScore: params.minMatchScore, maxPerDay: params.maxNotifications, lookbackDays,
        provider: opts.emailProvider, runStartIso: startIso, sleep: opts.sleep,
      }, dryRun ? dryPlan : undefined);
      counts.highPriorityNew = notify.candidates;
      counts.notified = notify.sent;
      for (const e of notify.errors) {
        counts.errors++;
        errors.push(e);
        log("error", e);
      }
    }
  } catch (e: any) {
    fatal = e?.message ?? String(e);
    counts.errors++;
    errors.push(`Run aborted: ${fatal}`);
    log("error", `Run aborted: ${fatal}`);
  }

  const finished = now();
  const status: RunSummary["status"] = fatal ? "failed" : counts.sources > 0 && counts.sourcesFailed === counts.sources ? "failed" : counts.sourcesFailed > 0 || counts.errors > 0 ? "partial" : "success";
  log("info", `Run finished: ${status} — new ${counts.new}, updated ${counts.updated}, seen ${counts.seen}, merged ${counts.merged}, closed ${counts.closed}`);
  await flush(runId);
  await finishRun(db, runId, { status, finishedAt: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), counts, error: errors.length ? errors.join(" | ").slice(0, 1500) : null });
  await releaseLock(db, LOCK, holder);
  return { runId, status, dryRun, counts, errors, notify };
}

interface ProcessParams {
  lookbackDays: number;
  closeAfter: number;
  now: Date;
}

/** Apply one source's fetch result using `tx` (the caller owns the transaction). Returns closure candidates. */
async function processSource(
  tx: Db, src: SourceRow, config: any, fetched: FetchResult, env: IngestEnv, p: ProcessParams, counts: ReturnType<typeof ZERO>,
  log: (l: "info" | "warn" | "error", m: string, k?: string) => void,
): Promise<ClosureCandidate[]> {
  const keywords: string[] = (config?.titleKeywords ?? []).map((k: string) => k.toLowerCase()).filter(Boolean);
  const cutoff = p.now.getTime() - p.lookbackDays * 86_400_000;

  const work = async (): Promise<ClosureCandidate[]> => {
    const sightings = await tx.query<{ id: string; source_job_id: string; job_id: string }>("SELECT id, source_job_id, job_id FROM job_sightings WHERE source_key=?", [src.id]);
    const known = new Map(sightings.map((s) => [s.source_job_id, s]));
    const seen = new Set(fetched.seenIds);
    const processed = new Set<string>();

    for (const job of fetched.jobs as NormalizedJobInput[]) {
      const isKnown = known.has(String(job.sourceJobId));
      if (!isKnown) {
        if (keywords.length && !keywords.some((k) => job.title.toLowerCase().includes(k))) {
          counts.filteredKeywords++;
          continue;
        }
        const ts = job.postedAt ?? job.updatedAt;
        if (ts) {
          const t = new Date(ts).getTime();
          if (!Number.isNaN(t) && t < cutoff) {
            counts.filteredLookback++;
            continue;
          }
        }
      }
      let enriched;
      try {
        enriched = enrichJob(job, p.now);
      } catch (e: any) {
        counts.invalid++;
        log("warn", `Skipped invalid job ${job.sourceJobId}: ${e?.issues?.[0]?.message ?? e?.message}`, src.id);
        continue;
      }
      counts.kept++;
      processed.add(String(job.sourceJobId));
      const out = await ingestJob(tx, enriched, env);
      if (out.kind === "new") counts.new++;
      else if (out.kind === "review") {
        counts.new++;
        counts.reviewQueued++;
      } else if (out.kind === "updated") counts.updated++;
      else if (out.kind === "merged") counts.merged++;
      else counts.seen++;
    }

    // Known jobs the source still lists but we skipped re-processing: still counts as seen.
    for (const [id, sg] of known) {
      if (!processed.has(id) && seen.has(id)) await touchSighting(tx, sg.id, env.nowIso);
    }
    // Missing from a COMPLETE listing: record one more missed run. Failed/partial fetches never reach here.
    if (fetched.complete) {
      for (const [id, sg] of known) {
        if (!seen.has(id)) await tx.run("UPDATE job_sightings SET missed_runs = missed_runs + 1 WHERE id=?", [sg.id]);
      }
    }
    // Jobs whose every sighting has been missing for N complete runs are candidates for verification/closure.
    const cands = await tx.query<{ job_id: string; sighting_id: string; source_job_id: string; missed_runs: number }>(
      `SELECT s.job_id AS job_id, s.id AS sighting_id, s.source_job_id AS source_job_id, s.missed_runs AS missed_runs
       FROM job_sightings s JOIN jobs j ON j.id = s.job_id
       WHERE s.source_key = ? AND s.missed_runs >= ? AND j.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM job_sightings o WHERE o.job_id = s.job_id AND o.missed_runs < ?)`,
      [src.id, p.closeAfter, p.closeAfter],
    );
    return cands.map((c) => ({ jobId: c.job_id, sightingId: c.sighting_id, sourceJobId: c.source_job_id, missedRuns: c.missed_runs }));
  };

  return work();
}
