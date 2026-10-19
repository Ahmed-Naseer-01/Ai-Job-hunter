import type { Db } from "../db/types";
import type { AppSettings, Profile } from "../config/schema";
import type { EnrichedJob, Lifecycle } from "../jobs/types";
import { evaluateEligibility } from "../matching/eligibility";
import { scoreJob } from "../matching/score";
import { classifyPair } from "../dedupe/similarity";
import {
  addDupCandidate, addSighting, findJobsByCanonicalUrl, findJobsByCompany, findSighting, getJob, insertJob, rowToJob, touchJobSeen, touchSighting, updateJobContent, upsertScore,
} from "../db/jobs";

export interface IngestEnv {
  profile: Profile;
  settings: AppSettings;
  fingerprint: string;
  nowIso: string;
  runStartIso: string;
}

export type IngestOutcome = { kind: "new" | "updated" | "seen" | "merged" | "review"; jobId: string; note?: string };

export async function scoreAndStore(db: Db, jobId: string, job: EnrichedJob, env: IngestEnv): Promise<void> {
  const elig = evaluateEligibility(job, env.profile, env.settings.search);
  const result = scoreJob(job, elig, env.profile, env.settings);
  await upsertScore(db, jobId, result, elig, job.contentHash, env.fingerprint, env.nowIso);
}

/** Re-score every job whose score is missing or was computed with a different profile/settings/content. */
export async function rescoreStale(db: Db, env: IngestEnv): Promise<number> {
  const rows = await db.query(
    `SELECT j.* FROM jobs j LEFT JOIN job_scores s ON s.job_id = j.id
     WHERE s.job_id IS NULL OR s.profile_hash <> ? OR s.content_hash <> j.content_hash`,
    [env.fingerprint],
  );
  for (const r of rows) {
    const job = rowToJob(r);
    await scoreAndStore(db, job.id, job, env);
  }
  return rows.length;
}

/**
 * Persist one enriched job. Order of identity checks:
 *  1. exact (source, source job id) sighting
 *  2. canonical URL
 *  3. fuzzy company/title/location/description match (auto-merge when confident, otherwise queue for human review)
 * The `applications` table is never touched here.
 */
export async function ingestJob(db: Db, e: EnrichedJob, env: IngestEnv): Promise<IngestOutcome> {
  const { nowIso, runStartIso } = env;

  // 1. exact source id
  const sg = await findSighting(db, e.sourceKey, e.sourceJobId);
  if (sg) {
    const job = await getJob(db, sg.jobId);
    if (job) {
      await touchSighting(db, sg.id, nowIso);
      if (job.contentHash !== e.contentHash) {
        await updateJobContent(db, job.id, e, nowIso, "updated");
        await touchJobSeen(db, job.id, nowIso, "updated");
        await scoreAndStore(db, job.id, e, env);
        return { kind: "updated", jobId: job.id };
      }
      const stale = job.lastSeenAt < runStartIso;
      const lifecycle: Lifecycle = job.status === "closed" ? "updated" : stale ? "seen" : job.lifecycle;
      await touchJobSeen(db, job.id, nowIso, lifecycle);
      const sc = await db.query<{ profile_hash: string }>("SELECT profile_hash FROM job_scores WHERE job_id=?", [job.id]);
      if (!sc.length || sc[0].profile_hash !== env.fingerprint) await scoreAndStore(db, job.id, job, env);
      return { kind: job.status === "closed" ? "updated" : "seen", jobId: job.id, note: job.status === "closed" ? "reopened" : undefined };
    }
  }

  // 2. canonical URL (same posting reached through another source/link)
  const byUrl = await findJobsByCanonicalUrl(db, e.canonicalUrl);
  if (byUrl.length) {
    const target = byUrl[0];
    await addSighting(db, target.id, e, nowIso);
    await touchJobSeen(db, target.id, nowIso, target.lastSeenAt < runStartIso ? "seen" : target.lifecycle);
    return { kind: "merged", jobId: target.id, note: "same canonical URL" };
  }

  // 3. fuzzy
  const candidates = await findJobsByCompany(db, e.company);
  const reviews: { id: string; sim: number; reason: string }[] = [];
  for (const c of candidates) {
    const r = classifyPair(c, e);
    if (r.verdict === "duplicate") {
      await addSighting(db, c.id, e, nowIso);
      await touchJobSeen(db, c.id, nowIso, c.lastSeenAt < runStartIso ? "seen" : c.lifecycle);
      return { kind: "merged", jobId: c.id, note: r.reason };
    }
    if (r.verdict === "review") reviews.push({ id: c.id, sim: r.similarity, reason: r.reason });
  }

  // 4. new job
  const job = await insertJob(db, e, nowIso);
  await addSighting(db, job.id, e, nowIso);
  await scoreAndStore(db, job.id, e, env);
  for (const r of reviews) await addDupCandidate(db, job.id, r.id, r.sim, r.reason, nowIso);
  return { kind: reviews.length ? "review" : "new", jobId: job.id, note: reviews.length ? "possible duplicate queued for review" : undefined };
}
