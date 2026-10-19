import type { Db, Row } from "./types";
import type { ClosureEvidence, EnrichedJob, JobRecord, Lifecycle } from "../jobs/types";
import type { ScoreResult } from "../matching/score";
import type { EligibilityResult } from "../matching/eligibility";
import { normalizeCompany } from "../dedupe/similarity";
import { newId, safeJson } from "../util";

export function rowToJob(r: Row): JobRecord {
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    applyUrl: r.apply_url,
    canonicalUrl: r.canonical_url,
    sourceKey: r.source_key,
    sourceKind: r.source_kind,
    sourceJobId: r.source_job_id,
    description: r.description,
    locationRaw: r.location_raw,
    countries: safeJson(r.countries, []),
    workMode: r.work_mode,
    employmentType: r.employment_type,
    seniority: r.seniority,
    yearsMin: r.years_min,
    yearsPreferred: r.years_preferred,
    requiredSkills: safeJson(r.required_skills, []),
    preferredSkills: safeJson(r.preferred_skills, []),
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    salaryCurrency: r.salary_currency,
    salaryPeriod: r.salary_period,
    postedAt: r.posted_at,
    deadlineAt: r.deadline_at,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    lastCheckedAt: r.last_checked_at,
    lastVerifiedOpenAt: r.last_verified_open_at,
    status: r.status,
    lifecycle: r.lifecycle,
    closedAt: r.closed_at,
    closureEvidence: safeJson<ClosureEvidence | null>(r.closure_evidence, null),
    completeness: r.completeness,
    facts: safeJson(r.facts, {} as any),
    contentHash: r.content_hash,
    isSynthetic: !!r.is_synthetic,
  };
}

export async function getJob(db: Db, id: string): Promise<JobRecord | null> {
  const rows = await db.query("SELECT * FROM jobs WHERE id = ?", [id]);
  return rows.length ? rowToJob(rows[0]) : null;
}

export async function insertJob(db: Db, e: EnrichedJob, now: string): Promise<JobRecord> {
  const id = newId("job_");
  await db.run(
    `INSERT INTO jobs (id, title, company, company_norm, apply_url, canonical_url, source_key, source_kind, source_job_id, description, location_raw, countries,
       work_mode, employment_type, seniority, years_min, years_preferred, required_skills, preferred_skills, salary_min, salary_max, salary_currency,
       salary_period, posted_at, deadline_at, first_seen_at, last_seen_at, last_checked_at, status, lifecycle, completeness, facts, content_hash, is_synthetic,
       created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, e.title, e.company, normalizeCompany(e.company), e.applyUrl, e.canonicalUrl, e.sourceKey, e.sourceKind, e.sourceJobId, e.description, e.locationRaw,
      JSON.stringify(e.countries), e.workMode, e.employmentType, e.seniority, e.yearsMin, e.yearsPreferred, JSON.stringify(e.requiredSkills),
      JSON.stringify(e.preferredSkills), e.salaryMin, e.salaryMax, e.salaryCurrency, e.salaryPeriod, e.postedAt, e.deadlineAt, now, now, now, "open", "new",
      e.completeness, JSON.stringify(e.facts), e.contentHash, e.isSynthetic ? 1 : 0, now, now,
    ],
  );
  return (await getJob(db, id))!;
}

/** Overwrite collector-owned content fields. Never touches the `applications` table. */
export async function updateJobContent(db: Db, id: string, e: EnrichedJob, now: string, lifecycle: Lifecycle): Promise<void> {
  await db.run(
    `UPDATE jobs SET title=?, company=?, company_norm=?, apply_url=?, canonical_url=?, description=?, location_raw=?, countries=?, work_mode=?, employment_type=?,
       seniority=?, years_min=?, years_preferred=?, required_skills=?, preferred_skills=?, salary_min=?, salary_max=?, salary_currency=?, salary_period=?,
       posted_at=?, deadline_at=?, completeness=?, facts=?, content_hash=?, lifecycle=?, updated_at=? WHERE id=?`,
    [
      e.title, e.company, normalizeCompany(e.company), e.applyUrl, e.canonicalUrl, e.description, e.locationRaw, JSON.stringify(e.countries), e.workMode, e.employmentType,
      e.seniority, e.yearsMin, e.yearsPreferred, JSON.stringify(e.requiredSkills), JSON.stringify(e.preferredSkills), e.salaryMin, e.salaryMax, e.salaryCurrency,
      e.salaryPeriod, e.postedAt, e.deadlineAt, e.completeness, JSON.stringify(e.facts), e.contentHash, lifecycle, now, id,
    ],
  );
}

export async function touchJobSeen(db: Db, id: string, now: string, lifecycle: Lifecycle): Promise<void> {
  await db.run("UPDATE jobs SET last_seen_at=?, last_checked_at=?, lifecycle=?, status='open', closed_at=NULL, closure_evidence=NULL WHERE id=?", [now, now, lifecycle, id]);
}

export async function markJobClosed(db: Db, id: string, now: string, evidence: ClosureEvidence): Promise<void> {
  await db.run("UPDATE jobs SET status='closed', lifecycle='closed', closed_at=?, closure_evidence=?, last_checked_at=?, updated_at=? WHERE id=?", [now, JSON.stringify(evidence), now, now, id]);
}

export async function markVerifiedOpen(db: Db, id: string, now: string): Promise<void> {
  await db.run("UPDATE jobs SET last_verified_open_at=?, last_checked_at=? WHERE id=?", [now, now, id]);
}

// ---- sightings ----
export interface Sighting {
  id: string;
  jobId: string;
  sourceKey: string;
  sourceKind: string;
  sourceJobId: string;
  url: string;
  canonicalUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  missedRuns: number;
}
const rowToSighting = (r: Row): Sighting => ({
  id: r.id, jobId: r.job_id, sourceKey: r.source_key, sourceKind: r.source_kind, sourceJobId: r.source_job_id, url: r.url, canonicalUrl: r.canonical_url,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, missedRuns: r.missed_runs,
});

export async function findSighting(db: Db, sourceKey: string, sourceJobId: string): Promise<Sighting | null> {
  const r = await db.query("SELECT * FROM job_sightings WHERE source_key=? AND source_job_id=?", [sourceKey, sourceJobId]);
  return r.length ? rowToSighting(r[0]) : null;
}
export async function sightingsForJob(db: Db, jobId: string): Promise<Sighting[]> {
  return (await db.query("SELECT * FROM job_sightings WHERE job_id=? ORDER BY first_seen_at", [jobId])).map(rowToSighting);
}
export async function addSighting(db: Db, jobId: string, e: Pick<EnrichedJob, "sourceKey" | "sourceKind" | "sourceJobId" | "applyUrl" | "canonicalUrl">, now: string): Promise<void> {
  await db.run(
    `INSERT INTO job_sightings (id, job_id, source_key, source_kind, source_job_id, url, canonical_url, first_seen_at, last_seen_at, missed_runs)
     VALUES (?,?,?,?,?,?,?,?,?,0) ON CONFLICT (source_key, source_job_id) DO NOTHING`,
    [newId("sg_"), jobId, e.sourceKey, e.sourceKind, e.sourceJobId, e.applyUrl, e.canonicalUrl, now, now],
  );
}
export async function touchSighting(db: Db, id: string, now: string): Promise<void> {
  await db.run("UPDATE job_sightings SET last_seen_at=?, missed_runs=0 WHERE id=?", [now, id]);
}

export async function findJobsByCanonicalUrl(db: Db, canonicalUrl: string): Promise<JobRecord[]> {
  const rows = await db.query(
    `SELECT DISTINCT j.* FROM jobs j LEFT JOIN job_sightings s ON s.job_id = j.id WHERE j.canonical_url = ? OR s.canonical_url = ?`,
    [canonicalUrl, canonicalUrl],
  );
  return rows.map(rowToJob);
}
export async function findJobsByCompany(db: Db, company: string): Promise<JobRecord[]> {
  return (await db.query("SELECT * FROM jobs WHERE company_norm = ? AND status = 'open'", [normalizeCompany(company)])).map(rowToJob);
}

// ---- scores ----
export async function upsertScore(db: Db, jobId: string, s: ScoreResult, elig: EligibilityResult, contentHash: string, profileHash: string, now: string): Promise<void> {
  await db.run(
    `INSERT INTO job_scores (job_id, score, technical_score, band, confidence, eligibility, actionable, eligibility_detail, breakdown, explanation, content_hash, profile_hash, scored_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (job_id) DO UPDATE SET score=excluded.score, technical_score=excluded.technical_score, band=excluded.band, confidence=excluded.confidence,
       eligibility=excluded.eligibility, actionable=excluded.actionable, eligibility_detail=excluded.eligibility_detail, breakdown=excluded.breakdown,
       explanation=excluded.explanation, content_hash=excluded.content_hash, profile_hash=excluded.profile_hash, scored_at=excluded.scored_at`,
    [
      jobId, s.score, s.technicalScore, s.band, s.confidence, s.eligibility, s.actionable ? 1 : 0,
      JSON.stringify({ skillMatches: s.skillMatches, capsApplied: s.capsApplied, confidenceLabel: s.confidenceLabel, eligibility: elig }),
      JSON.stringify(s.breakdown), JSON.stringify(s.explanation), contentHash, profileHash, now,
    ],
  );
}

export interface StoredScore {
  jobId: string;
  score: number;
  technicalScore: number;
  band: "high" | "good" | "review" | "low";
  confidence: number;
  eligibility: "eligible" | "potential" | "ineligible";
  actionable: boolean;
  detail: { skillMatches: ScoreResult["skillMatches"]; capsApplied: string[]; confidenceLabel: string; eligibility?: EligibilityResult };
  breakdown: ScoreResult["breakdown"];
  explanation: ScoreResult["explanation"];
  contentHash: string;
  profileHash: string;
  scoredAt: string;
}
export const rowToScore = (r: Row): StoredScore => ({
  jobId: r.job_id, score: r.score, technicalScore: r.technical_score, band: r.band, confidence: r.confidence, eligibility: r.eligibility, actionable: !!r.actionable,
  detail: safeJson(r.eligibility_detail, { skillMatches: [], capsApplied: [], confidenceLabel: "low" }), breakdown: safeJson(r.breakdown, []), explanation: safeJson(r.explanation, {} as any),
  contentHash: r.content_hash, profileHash: r.profile_hash, scoredAt: r.scored_at,
});
export async function getScore(db: Db, jobId: string): Promise<StoredScore | null> {
  const r = await db.query("SELECT * FROM job_scores WHERE job_id=?", [jobId]);
  return r.length ? rowToScore(r[0]) : null;
}

// ---- duplicate candidates ----
export async function addDupCandidate(db: Db, a: string, b: string, similarity: number, reason: string, now: string): Promise<boolean> {
  const [x, y] = a < b ? [a, b] : [b, a];
  const r = await db.run(
    "INSERT INTO dup_candidates (id, job_a, job_b, similarity, reason, status, created_at) VALUES (?,?,?,?,?,'pending',?) ON CONFLICT (job_a, job_b) DO NOTHING",
    [newId("dc_"), x, y, similarity, reason, now],
  );
  return r.changes === 1;
}
