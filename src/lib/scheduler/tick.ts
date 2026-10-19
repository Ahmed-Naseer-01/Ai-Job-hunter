import type { Db } from "../db/types";
import { loadSettings } from "../db/config";
import { runPipeline, type RunOptions, type RunSummary } from "../pipeline/run";
import { shouldRunNow } from "./time";

export const MAX_ATTEMPTS_PER_SLOT = 3;
export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_MAX_MS = 60 * 60_000;

/** Bounded exponential backoff between failed scheduled attempts: 5 min, 10 min, … capped at 60 min. */
export const retryDelayMs = (failedAttempts: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failedAttempts - 1));

export type TickResult =
  | { action: "idle"; reason: string; scheduledFor: Date }
  | { action: "ran"; reason: string; scheduledFor: Date; summary: RunSummary; attempt: number }
  | { action: "waiting_retry"; reason: string; scheduledFor: Date; retryAt: Date; attempt: number }
  | { action: "gave_up"; reason: string; scheduledFor: Date; attempts: number };

interface Attempt {
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
}

/** Scheduled attempts since `since` (lock-contention "skipped" rows are not real attempts). */
async function attemptsSince(db: Db, since: Date): Promise<Attempt[]> {
  const rows = await db.query(
    "SELECT started_at, finished_at, status FROM runs WHERE trigger = 'scheduled' AND status <> 'skipped' AND started_at >= ? ORDER BY started_at ASC",
    [since.toISOString()],
  );
  return rows.map((r) => ({ startedAt: new Date(r.started_at), finishedAt: r.finished_at ? new Date(r.finished_at) : null, status: r.status }));
}

/**
 * One scheduler decision. Safe to call as often as you like (the worker calls it every few seconds):
 * a slot (one per local day) is run at most once successfully, failed runs are retried with bounded backoff,
 * and concurrent processes are serialised by the pipeline's DB lock.
 */
export async function schedulerTick(db: Db, o: { now?: () => Date; runOptions?: Partial<RunOptions> } = {}): Promise<TickResult> {
  const now = (o.now ?? (() => new Date()))();
  const settings = await loadSettings(db);
  const s = settings.schedule;
  const last = (await db.query("SELECT started_at FROM runs WHERE trigger = 'scheduled' AND status <> 'skipped' ORDER BY started_at DESC LIMIT 1"))[0];
  const decision = shouldRunNow(now, s, last ? new Date(last.started_at) : null);

  const runOpts: RunOptions = {
    trigger: "scheduled",
    dryRun: s.dryRun,
    lookbackDays: s.lookbackDays,
    minMatchScore: s.minMatchScore,
    maxNotifications: s.maxNotificationsPerDay,
    ...o.runOptions,
    now: o.now,
  };

  if (decision.due) {
    const summary = await runPipeline(db, runOpts);
    return { action: "ran", reason: decision.reason, scheduledFor: decision.scheduledFor, summary, attempt: 1 };
  }

  // Not due by slot. Was today's slot attempted and did it fail? Then consider a bounded retry.
  if (s.enabled && now.getTime() >= decision.scheduledFor.getTime()) {
    const attempts = await attemptsSince(db, decision.scheduledFor);
    const lastAttempt = attempts[attempts.length - 1];
    if (lastAttempt && lastAttempt.status === "failed") {
      const failed = attempts.filter((a) => a.status === "failed").length;
      if (attempts.length >= MAX_ATTEMPTS_PER_SLOT) {
        return { action: "gave_up", reason: `Gave up after ${attempts.length} failed attempts today`, scheduledFor: decision.scheduledFor, attempts: attempts.length };
      }
      const retryAt = new Date((lastAttempt.finishedAt ?? lastAttempt.startedAt).getTime() + retryDelayMs(failed));
      if (now.getTime() < retryAt.getTime()) {
        return { action: "waiting_retry", reason: "Previous scheduled run failed; waiting before retry", scheduledFor: decision.scheduledFor, retryAt, attempt: attempts.length + 1 };
      }
      const summary = await runPipeline(db, runOpts);
      return { action: "ran", reason: `Retry ${attempts.length + 1} of ${MAX_ATTEMPTS_PER_SLOT}`, scheduledFor: decision.scheduledFor, summary, attempt: attempts.length + 1 };
    }
  }
  return { action: "idle", reason: decision.reason, scheduledFor: decision.scheduledFor };
}
