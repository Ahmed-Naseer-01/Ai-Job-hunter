import type { Db, Row } from "../db/types";
import { rowToJob, rowToScore, sightingsForJob, type StoredScore } from "../db/jobs";
import { getApplication, type Application } from "../db/applications";
import type { JobRecord } from "../jobs/types";
import { APPLICATION_STATUSES, type ApplicationStatus } from "../jobs/types";
import { listRuns, getSourceHealth, recentSourceRuns, type SourceHealth, type SourceRunRow } from "../db/runs";
import { listSources } from "../db/sources";
import { startOfLocalDay } from "../scheduler/time";

export interface JobFilters {
  q?: string;
  minScore?: number;
  band?: string;
  /** eligible | potential | ineligible | actionable (eligible+potential and no excluded preference) */
  eligibility?: string;
  workMode?: string;
  seniority?: string;
  employmentType?: string;
  country?: string;
  source?: string;
  skill?: string;
  minSalary?: number;
  postedWithinDays?: number;
  /** open (default) | closed | all */
  status?: string;
  appStatus?: string;
  includeSynthetic?: boolean;
  sort?: "score" | "posted" | "seen" | "company";
  page?: number;
  pageSize?: number;
}

export interface JobListItem {
  job: JobRecord;
  score: StoredScore | null;
  application: Application | null;
}

const SCORE_COLS = `s.score AS s_score, s.technical_score AS s_tech, s.band AS s_band, s.confidence AS s_conf, s.eligibility AS s_elig, s.actionable AS s_act,
  s.eligibility_detail AS s_detail, s.breakdown AS s_breakdown, s.explanation AS s_expl, s.content_hash AS s_ch, s.profile_hash AS s_ph, s.scored_at AS s_at`;
const APP_COLS = `a.status AS a_status, a.applied_at AS a_applied, a.follow_up_at AS a_follow, a.notes AS a_notes, a.created_at AS a_created, a.updated_at AS a_updated`;

function mapRow(r: Row): JobListItem {
  const job = rowToJob(r);
  const score = r.s_band
    ? rowToScore({ job_id: job.id, score: r.s_score, technical_score: r.s_tech, band: r.s_band, confidence: r.s_conf, eligibility: r.s_elig, actionable: r.s_act, eligibility_detail: r.s_detail, breakdown: r.s_breakdown, explanation: r.s_expl, content_hash: r.s_ch, profile_hash: r.s_ph, scored_at: r.s_at })
    : null;
  const application: Application | null = r.a_status
    ? { jobId: job.id, status: r.a_status, appliedAt: r.a_applied, followUpAt: r.a_follow, notes: r.a_notes ?? "", createdAt: r.a_created, updatedAt: r.a_updated }
    : null;
  return { job, score, application };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function buildWhere(f: JobFilters): { where: string; params: unknown[] } {
  const w: string[] = [];
  const p: unknown[] = [];
  const status = f.status ?? "open";
  if (status !== "all") {
    w.push("j.status = ?");
    p.push(status);
  }
  if (!f.includeSynthetic) w.push("j.is_synthetic = 0");
  if (f.q?.trim()) {
    w.push("(LOWER(j.title) LIKE ? ESCAPE '\\' OR LOWER(j.company) LIKE ? ESCAPE '\\')");
    const q = `%${likeEscape(f.q.trim().toLowerCase())}%`;
    p.push(q, q);
  }
  if (f.minScore !== undefined && !Number.isNaN(f.minScore)) {
    w.push("s.score >= ?");
    p.push(f.minScore);
  }
  if (f.band) {
    w.push("s.band = ?");
    p.push(f.band);
  }
  if (f.eligibility === "actionable") w.push("s.actionable = 1");
  else if (f.eligibility) {
    w.push("s.eligibility = ?");
    p.push(f.eligibility);
  }
  if (f.workMode) {
    w.push("j.work_mode = ?");
    p.push(f.workMode);
  }
  if (f.seniority) {
    w.push("j.seniority = ?");
    p.push(f.seniority);
  }
  if (f.employmentType) {
    w.push("j.employment_type = ?");
    p.push(f.employmentType);
  }
  if (f.country?.trim()) {
    w.push("(LOWER(j.countries) LIKE ? ESCAPE '\\' OR LOWER(j.location_raw) LIKE ? ESCAPE '\\')");
    const c = `%${likeEscape(f.country.trim().toLowerCase())}%`;
    p.push(c, c);
  }
  if (f.source) {
    w.push("j.source_key = ?");
    p.push(f.source);
  }
  if (f.skill?.trim()) {
    w.push("(j.required_skills LIKE ? ESCAPE '\\' OR j.preferred_skills LIKE ? ESCAPE '\\')");
    const k = `%"id":"${likeEscape(f.skill.trim().toLowerCase().replace(/"/g, ""))}"%`;
    p.push(k, k);
  }
  if (f.minSalary !== undefined && !Number.isNaN(f.minSalary)) {
    // Unknown salary never matches a salary filter: unknown stays unknown.
    w.push("COALESCE(j.salary_max, j.salary_min) >= ?");
    p.push(f.minSalary);
  }
  if (f.postedWithinDays) {
    w.push("j.posted_at >= ?");
    p.push(new Date(Date.now() - f.postedWithinDays * 86_400_000).toISOString());
  }
  if (f.appStatus) {
    if (f.appStatus === "none") w.push("a.status IS NULL");
    else {
      w.push("a.status = ?");
      p.push(f.appStatus);
    }
  }
  return { where: w.length ? `WHERE ${w.join(" AND ")}` : "", params: p };
}

const ORDER: Record<NonNullable<JobFilters["sort"]>, string> = {
  score: "s.score DESC NULLS LAST, j.posted_at DESC, j.id",
  posted: "j.posted_at DESC NULLS LAST, s.score DESC, j.id",
  seen: "j.first_seen_at DESC, s.score DESC, j.id",
  company: "j.company ASC, s.score DESC, j.id",
};

export async function listJobs(db: Db, f: JobFilters = {}): Promise<{ items: JobListItem[]; total: number; page: number; pageSize: number }> {
  const { where, params } = buildWhere(f);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const from = `FROM jobs j LEFT JOIN job_scores s ON s.job_id = j.id LEFT JOIN applications a ON a.job_id = j.id`;
  const total = Number((await db.query<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${where}`, params))[0]?.n ?? 0);
  const rows = await db.query(
    `SELECT j.*, ${SCORE_COLS}, ${APP_COLS} ${from} ${where} ORDER BY ${ORDER[f.sort ?? "score"] ?? ORDER.score} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(mapRow), total, page, pageSize };
}

export interface JobDetail extends JobListItem {
  sightings: Awaited<ReturnType<typeof sightingsForJob>>;
  duplicates: { id: string; other: { id: string; title: string; company: string }; similarity: number; reason: string; status: string }[];
}

export async function getJobDetail(db: Db, id: string): Promise<JobDetail | null> {
  const rows = await db.query(`SELECT j.*, ${SCORE_COLS}, ${APP_COLS} FROM jobs j LEFT JOIN job_scores s ON s.job_id = j.id LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?`, [id]);
  if (!rows.length) return null;
  const base = mapRow(rows[0]);
  const dups = await db.query(
    `SELECT d.*, o.id AS o_id, o.title AS o_title, o.company AS o_company FROM dup_candidates d
     JOIN jobs o ON o.id = CASE WHEN d.job_a = ? THEN d.job_b ELSE d.job_a END WHERE d.job_a = ? OR d.job_b = ?`,
    [id, id, id],
  );
  return {
    ...base,
    sightings: await sightingsForJob(db, id),
    duplicates: dups.map((d) => ({ id: d.id, other: { id: d.o_id, title: d.o_title, company: d.o_company }, similarity: d.similarity, reason: d.reason, status: d.status })),
  };
}

export async function getApplicationFor(db: Db, id: string) {
  return getApplication(db, id);
}

// ---- tracker ----
export async function trackerBoard(db: Db, includeSynthetic: boolean): Promise<Record<ApplicationStatus, JobListItem[]>> {
  const rows = await db.query(
    `SELECT j.*, ${SCORE_COLS}, ${APP_COLS} FROM jobs j JOIN applications a ON a.job_id = j.id LEFT JOIN job_scores s ON s.job_id = j.id
     ${includeSynthetic ? "" : "WHERE j.is_synthetic = 0"} ORDER BY a.updated_at DESC`,
  );
  const board = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, [] as JobListItem[]])) as Record<ApplicationStatus, JobListItem[]>;
  for (const r of rows) {
    const it = mapRow(r);
    board[it.application!.status]?.push(it);
  }
  return board;
}

export async function dueFollowUps(db: Db, now = new Date()): Promise<JobListItem[]> {
  const rows = await db.query(
    `SELECT j.*, ${SCORE_COLS}, ${APP_COLS} FROM jobs j JOIN applications a ON a.job_id = j.id LEFT JOIN job_scores s ON s.job_id = j.id
     WHERE a.follow_up_at IS NOT NULL AND a.follow_up_at <= ? AND a.status NOT IN ('rejected','closed') ORDER BY a.follow_up_at`,
    [now.toISOString()],
  );
  return rows.map(mapRow);
}

// ---- overview ----
export interface Overview {
  totals: { open: number; closed: number; synthetic: number; real: number };
  bands: Record<string, number>;
  eligibility: Record<string, number>;
  newToday: number;
  newThisWeek: number;
  tracker: Record<string, number>;
  topMatches: JobListItem[];
  lastRun: Awaited<ReturnType<typeof listRuns>>[number] | null;
  pendingDuplicateReviews: number;
  followUpsDue: number;
  sourceCount: number;
}

export async function overview(db: Db, o: { includeSynthetic: boolean; timezone: string; now?: Date }): Promise<Overview> {
  const now = o.now ?? new Date();
  const syn = o.includeSynthetic ? "" : "AND j.is_synthetic = 0";
  const count = async (sql: string, p: unknown[] = []) => Number((await db.query<{ n: number }>(sql, p))[0]?.n ?? 0);
  const group = async (sql: string) => Object.fromEntries((await db.query<{ k: string; n: number }>(sql)).map((r) => [r.k, Number(r.n)]));
  const today = startOfLocalDay(now, o.timezone).toISOString();
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const top = await listJobs(db, { includeSynthetic: o.includeSynthetic, eligibility: "actionable", sort: "score", pageSize: 5, status: "open" });
  return {
    totals: {
      open: await count(`SELECT COUNT(*) AS n FROM jobs j WHERE j.status='open' ${syn}`),
      closed: await count(`SELECT COUNT(*) AS n FROM jobs j WHERE j.status='closed' ${syn}`),
      synthetic: await count("SELECT COUNT(*) AS n FROM jobs WHERE is_synthetic=1 AND status='open'"),
      real: await count("SELECT COUNT(*) AS n FROM jobs WHERE is_synthetic=0 AND status='open'"),
    },
    bands: await group(`SELECT s.band AS k, COUNT(*) AS n FROM job_scores s JOIN jobs j ON j.id=s.job_id WHERE j.status='open' ${syn} GROUP BY s.band`),
    eligibility: await group(`SELECT s.eligibility AS k, COUNT(*) AS n FROM job_scores s JOIN jobs j ON j.id=s.job_id WHERE j.status='open' ${syn} GROUP BY s.eligibility`),
    newToday: await count(`SELECT COUNT(*) AS n FROM jobs j WHERE j.first_seen_at >= ? ${syn}`, [today]),
    newThisWeek: await count(`SELECT COUNT(*) AS n FROM jobs j WHERE j.first_seen_at >= ? ${syn}`, [week]),
    tracker: await group(`SELECT a.status AS k, COUNT(*) AS n FROM applications a JOIN jobs j ON j.id=a.job_id WHERE 1=1 ${syn} GROUP BY a.status`),
    topMatches: top.items,
    lastRun: (await listRuns(db, 1))[0] ?? null,
    pendingDuplicateReviews: await count("SELECT COUNT(*) AS n FROM dup_candidates WHERE status='pending'"),
    followUpsDue: (await dueFollowUps(db, now)).length,
    sourceCount: (await listSources(db)).length,
  };
}

// ---- sources & runs ----
export interface SourceStatus {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: unknown;
  health: SourceHealth;
  recent: SourceRunRow[];
  jobCount: number;
}
export async function sourceStatuses(db: Db): Promise<SourceStatus[]> {
  const out: SourceStatus[] = [];
  for (const s of await listSources(db)) {
    const n = Number((await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE source_key=? AND status='open'", [s.id]))[0]?.n ?? 0);
    out.push({ id: s.id, kind: s.kind, name: s.name, enabled: s.enabled, config: s.config, health: await getSourceHealth(db, s.id), recent: await recentSourceRuns(db, s.id, 5), jobCount: n });
  }
  return out;
}

export async function notificationLog(db: Db, limit = 30) {
  return (await db.query("SELECT * FROM notification_log ORDER BY ts DESC, id LIMIT ?", [limit])).map((r) => ({
    id: r.id as string, ts: r.ts as string, kind: r.kind as string, provider: r.provider as string, recipient: r.recipient as string, subject: r.subject as string,
    status: r.status as string, error: r.error as string | null, jobCount: (JSON.parse(r.job_ids || "[]") as string[]).length, dryRun: !!r.dry_run,
  }));
}

export async function pendingDuplicates(db: Db) {
  const rows = await db.query(
    `SELECT d.*, a.title AS a_title, a.company AS a_company, a.location_raw AS a_loc, a.apply_url AS a_url, b.title AS b_title, b.company AS b_company, b.location_raw AS b_loc, b.apply_url AS b_url
     FROM dup_candidates d JOIN jobs a ON a.id=d.job_a JOIN jobs b ON b.id=d.job_b WHERE d.status='pending' ORDER BY d.similarity DESC`,
  );
  return rows.map((r) => ({
    id: r.id as string, similarity: r.similarity as number, reason: r.reason as string,
    a: { id: r.job_a as string, title: r.a_title as string, company: r.a_company as string, location: r.a_loc as string | null, url: r.a_url as string },
    b: { id: r.job_b as string, title: r.b_title as string, company: r.b_company as string, location: r.b_loc as string | null, url: r.b_url as string },
  }));
}

// ---- CSV ----
const CSV_COLS = [
  "id", "title", "company", "score", "band", "eligibility", "confidence", "location", "work_mode", "employment_type", "seniority", "salary_min", "salary_max", "salary_currency", "salary_period",
  "posted_at", "first_seen_at", "last_seen_at", "last_verified_open_at", "job_status", "lifecycle", "tracker_status", "follow_up_at", "source", "source_job_id", "apply_url", "required_skills", "missing_mandatory", "synthetic",
] as const;

/** Spreadsheet formula injection guard + RFC 4180 quoting. Job text is untrusted. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items: JobListItem[]): string {
  const lines = [CSV_COLS.join(",")];
  for (const { job: j, score: s, application: a } of items) {
    lines.push(
      [
        j.id, j.title, j.company, s ? Math.round(s.score) : "", s?.band ?? "", s?.eligibility ?? "", s ? s.confidence.toFixed(2) : "", j.locationRaw, j.workMode, j.employmentType, j.seniority,
        j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod, j.postedAt, j.firstSeenAt, j.lastSeenAt, j.lastVerifiedOpenAt, j.status, j.lifecycle, a?.status ?? "", a?.followUpAt ?? "",
        j.sourceKey, j.sourceJobId, j.applyUrl, j.requiredSkills.map((k) => k.label).join("; "), s?.explanation.missingRequirements.join("; ") ?? "", j.isSynthetic ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
