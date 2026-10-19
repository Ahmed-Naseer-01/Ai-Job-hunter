import type { Db, Row } from "./types";
import { newId, redact, safeJson } from "../util";

export interface RunRow {
  id: string;
  trigger: string;
  dryRun: boolean;
  status: "running" | "success" | "partial" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  params: Record<string, any>;
  counts: Record<string, number>;
  error: string | null;
}
const runRow = (r: Row): RunRow => ({
  id: r.id, trigger: r.trigger, dryRun: !!r.dry_run, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms,
  params: safeJson(r.params, {}), counts: safeJson(r.counts, {}), error: r.error,
});

export async function createRun(db: Db, r: { trigger: string; dryRun: boolean; params: unknown; startedAt: string; status?: RunRow["status"]; error?: string }): Promise<string> {
  const id = newId("run_");
  await db.run("INSERT INTO runs (id, trigger, dry_run, status, started_at, params, counts, error) VALUES (?,?,?,?,?,?,?,?)", [
    id, r.trigger, r.dryRun ? 1 : 0, r.status ?? "running", r.startedAt, JSON.stringify(r.params), "{}", r.error ?? null,
  ]);
  return id;
}
export async function finishRun(db: Db, id: string, f: { status: RunRow["status"]; finishedAt: string; durationMs: number; counts: unknown; error?: string | null }): Promise<void> {
  await db.run("UPDATE runs SET status=?, finished_at=?, duration_ms=?, counts=?, error=? WHERE id=?", [f.status, f.finishedAt, f.durationMs, JSON.stringify(f.counts), f.error ?? null, id]);
}
export async function listRuns(db: Db, limit = 30): Promise<RunRow[]> {
  return (await db.query("SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT ?", [limit])).map(runRow);
}
export async function getRun(db: Db, id: string): Promise<RunRow | null> {
  const r = await db.query("SELECT * FROM runs WHERE id=?", [id]);
  return r.length ? runRow(r[0]) : null;
}
/** Mark runs left in `running` by a crashed process as failed (called when we hold the lock). */
export async function failOrphanedRuns(db: Db, now: string): Promise<number> {
  const r = await db.run("UPDATE runs SET status='failed', finished_at=?, error='Process stopped before the run finished' WHERE status='running'", [now]);
  return r.changes;
}

export interface LogLine {
  ts: string;
  level: "info" | "warn" | "error";
  sourceKey?: string | null;
  message: string;
}
export async function writeLogs(db: Db, runId: string, lines: LogLine[]): Promise<void> {
  for (const l of lines) {
    await db.run("INSERT INTO run_logs (id, run_id, ts, level, source_key, message) VALUES (?,?,?,?,?,?)", [newId("lg_"), runId, l.ts, l.level, l.sourceKey ?? null, redact(l.message).slice(0, 2000)]);
  }
}
export async function getRunLogs(db: Db, runId: string, limit = 500): Promise<LogLine[]> {
  return (await db.query("SELECT * FROM run_logs WHERE run_id=? ORDER BY ts, id LIMIT ?", [runId, limit])).map((r) => ({ ts: r.ts, level: r.level, sourceKey: r.source_key, message: r.message }));
}

export interface SourceRunRow {
  id: string;
  runId: string;
  sourceKey: string;
  status: "ok" | "failed";
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  fetched: number;
  kept: number;
  newCount: number;
  updatedCount: number;
  closedCount: number;
  error: string | null;
  httpStatus: number | null;
}
const srRow = (r: Row): SourceRunRow => ({
  id: r.id, runId: r.run_id, sourceKey: r.source_key, status: r.status, attempts: r.attempts, startedAt: r.started_at, finishedAt: r.finished_at, fetched: r.fetched,
  kept: r.kept, newCount: r.new_count, updatedCount: r.updated_count, closedCount: r.closed_count, error: r.error, httpStatus: r.http_status,
});
export async function insertSourceRun(db: Db, s: Omit<SourceRunRow, "id">): Promise<string> {
  const id = newId("sr_");
  await db.run(
    `INSERT INTO source_runs (id, run_id, source_key, status, attempts, started_at, finished_at, fetched, kept, new_count, updated_count, closed_count, error, http_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, s.runId, s.sourceKey, s.status, s.attempts, s.startedAt, s.finishedAt, s.fetched, s.kept, s.newCount, s.updatedCount, s.closedCount, s.error, s.httpStatus],
  );
  return id;
}
export async function updateSourceRunCounts(db: Db, id: string, c: { kept: number; newCount: number; updatedCount: number; closedCount: number }): Promise<void> {
  await db.run("UPDATE source_runs SET kept=?, new_count=?, updated_count=?, closed_count=? WHERE id=?", [c.kept, c.newCount, c.updatedCount, c.closedCount, id]);
}

export interface SourceHealth {
  sourceKey: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  lastFetched: number | null;
  lastKept: number | null;
  /** Share of listed postings that were kept after filters in the last successful run. */
  coverage: number | null;
  status: "healthy" | "degraded" | "failing" | "never_run";
}

export async function getSourceHealth(db: Db, sourceKey: string): Promise<SourceHealth> {
  const rows = (await db.query("SELECT * FROM source_runs WHERE source_key=? ORDER BY started_at DESC, id DESC LIMIT 50", [sourceKey])).map(srRow);
  if (!rows.length) return { sourceKey, lastAttemptAt: null, lastSuccessAt: null, lastError: null, consecutiveFailures: 0, totalRuns: 0, lastFetched: null, lastKept: null, coverage: null, status: "never_run" };
  const lastOk = rows.find((r) => r.status === "ok");
  let consecutive = 0;
  for (const r of rows) {
    if (r.status === "failed") consecutive++;
    else break;
  }
  const lastFail = rows.find((r) => r.status === "failed");
  return {
    sourceKey,
    lastAttemptAt: rows[0].startedAt,
    lastSuccessAt: lastOk?.finishedAt ?? null,
    lastError: lastFail?.error ?? null,
    consecutiveFailures: consecutive,
    totalRuns: rows.length,
    lastFetched: lastOk?.fetched ?? null,
    lastKept: lastOk?.kept ?? null,
    coverage: lastOk && lastOk.fetched > 0 ? lastOk.kept / lastOk.fetched : null,
    status: consecutive >= 3 ? "failing" : consecutive >= 1 ? "degraded" : "healthy",
  };
}
export async function recentSourceRuns(db: Db, sourceKey: string, limit = 10): Promise<SourceRunRow[]> {
  return (await db.query("SELECT * FROM source_runs WHERE source_key=? ORDER BY started_at DESC, id DESC LIMIT ?", [sourceKey, limit])).map(srRow);
}
