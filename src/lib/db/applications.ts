import type { Db, Row } from "./types";
import { APPLICATION_STATUSES, type ApplicationStatus } from "../jobs/types";

export interface Application {
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  followUpAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
const row = (r: Row): Application => ({ jobId: r.job_id, status: r.status, appliedAt: r.applied_at, followUpAt: r.follow_up_at, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at });

export async function getApplication(db: Db, jobId: string): Promise<Application | null> {
  const r = await db.query("SELECT * FROM applications WHERE job_id=?", [jobId]);
  return r.length ? row(r[0]) : null;
}

export interface ApplicationPatch {
  status?: ApplicationStatus;
  appliedAt?: string | null;
  followUpAt?: string | null;
  notes?: string;
}

/** The ONLY writer of the applications table. Collection code must never call this. */
export async function saveApplication(db: Db, jobId: string, patch: ApplicationPatch, now = new Date().toISOString()): Promise<Application> {
  if (patch.status && !APPLICATION_STATUSES.includes(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
  const cur = await getApplication(db, jobId);
  const status = patch.status ?? cur?.status ?? "to_review";
  let appliedAt = patch.appliedAt !== undefined ? patch.appliedAt : (cur?.appliedAt ?? null);
  if (status === "applied" && !appliedAt) appliedAt = now;
  const followUpAt = patch.followUpAt !== undefined ? patch.followUpAt : (cur?.followUpAt ?? null);
  const notes = patch.notes ?? cur?.notes ?? "";
  await db.run(
    `INSERT INTO applications (job_id, status, applied_at, follow_up_at, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (job_id) DO UPDATE SET status=excluded.status, applied_at=excluded.applied_at, follow_up_at=excluded.follow_up_at, notes=excluded.notes, updated_at=excluded.updated_at`,
    [jobId, status, appliedAt, followUpAt, notes, cur?.createdAt ?? now, now],
  );
  return (await getApplication(db, jobId))!;
}

/** Progress order used when two records for the same job are merged: the most advanced status wins. */
const ORDER: ApplicationStatus[] = ["discovered", "to_review", "saved", "ready_to_apply", "closed", "rejected", "applied", "interview"];
export const furtherAlong = (a: ApplicationStatus, b: ApplicationStatus) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
