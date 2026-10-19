import type { Db } from "../db/types";
import { loadProfile, loadSettings, scoringFingerprint } from "../db/config";
import { createRun, finishRun, writeLogs } from "../db/runs";
import { enrichJob } from "../jobs/enrich";
import { ingestJob, rescoreStale, type IngestEnv } from "../pipeline/ingest";
import { IMPORT_KINDS, parseImport, type ImportKind, type ParsedImport, type UrlImportDeps } from "../sources/import";
import { ValidationError } from "./actions";

export function assertKind(kind: unknown): ImportKind {
  if (typeof kind !== "string" || !(IMPORT_KINDS as readonly string[]).includes(kind)) throw new ValidationError(`kind must be one of: ${IMPORT_KINDS.join(", ")}`);
  return kind as ImportKind;
}

async function safeParse(kind: ImportKind, text: unknown, deps: UrlImportDeps): Promise<ParsedImport> {
  if (typeof text !== "string" || !text.trim()) throw new ValidationError("content is empty");
  try {
    return await parseImport(kind, text, deps);
  } catch (e: any) {
    throw new ValidationError(String(e?.message ?? e).slice(0, 300));
  }
}

/** Parse and validate without storing anything. */
export async function previewImport(kind: unknown, text: unknown, deps: UrlImportDeps = {}) {
  const k = assertKind(kind);
  const parsed = await safeParse(k, text, deps);
  return {
    kind: k,
    notes: parsed.notes,
    rejected: parsed.rejected,
    items: parsed.items.map((i) => ({ title: i.title, company: i.company, url: i.applyUrl, location: i.locationRaw ?? null, hasDescription: (i.descriptionText ?? "").length > 200, sourceKey: i.sourceKey })),
  };
}

/**
 * Store parsed rows through the same ingest path as scheduled collection: canonical-URL/ID/fuzzy dedupe, scoring, eligibility.
 * Existing tracker status is never touched. Idempotent: re-importing the same data creates nothing new.
 */
export async function commitImport(db: Db, kind: unknown, text: unknown, deps: UrlImportDeps = {}) {
  const k = assertKind(kind);
  const parsed = await safeParse(k, text, deps);
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const runId = await createRun(db, { trigger: "import", dryRun: false, params: { kind: k, rows: parsed.items.length }, startedAt });
  const counts = { parsed: parsed.items.length, rejected: parsed.rejected.length, new: 0, updated: 0, seen: 0, merged: 0, reviewQueued: 0, errors: 0 };
  const logs: { ts: string; level: "info" | "warn" | "error"; sourceKey?: string | null; message: string }[] = [{ ts: startedAt, level: "info", message: `Import (${k}) started: ${parsed.items.length} row(s), ${parsed.rejected.length} rejected` }];
  const ids: string[] = [];
  try {
    const profile = await loadProfile(db);
    const settings = await loadSettings(db);
    const now = new Date().toISOString();
    const env: IngestEnv = { profile, settings, fingerprint: scoringFingerprint(profile, settings), nowIso: now, runStartIso: now };
    await db.transaction(async (tx) => {
      for (const item of parsed.items) {
        try {
          const out = await ingestJob(tx, enrichJob(item), env);
          ids.push(out.jobId);
          if (out.kind === "review") {
            counts.new++;
            counts.reviewQueued++;
          } else counts[out.kind]++;
        } catch (e: any) {
          counts.errors++;
          logs.push({ ts: new Date().toISOString(), level: "error", message: `Row "${item.title.slice(0, 60)}" failed: ${String(e?.message ?? e).slice(0, 160)}` });
        }
      }
      await rescoreStale(tx, env);
    });
    logs.push({ ts: new Date().toISOString(), level: "info", message: `Import finished: ${counts.new} new, ${counts.updated} updated, ${counts.seen} already known, ${counts.merged} merged` });
    await writeLogs(db, runId, logs);
    await finishRun(db, runId, { status: counts.errors ? "partial" : "success", finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, counts });
  } catch (e: any) {
    logs.push({ ts: new Date().toISOString(), level: "error", message: `Import aborted: ${String(e?.message ?? e).slice(0, 200)}` });
    await writeLogs(db, runId, logs);
    await finishRun(db, runId, { status: "failed", finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, counts, error: String(e?.message ?? e).slice(0, 300) });
    throw e;
  }
  return { runId, counts, notes: parsed.notes, rejected: parsed.rejected, jobIds: ids };
}
