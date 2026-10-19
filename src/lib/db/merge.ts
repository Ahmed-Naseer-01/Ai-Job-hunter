import type { Db } from "./types";
import { furtherAlong, getApplication } from "./applications";

/**
 * Merge `dropId` into `keepId`: sightings move over, tracker data is combined (never lost), the duplicate row
 * and its score are removed. Runs in one transaction.
 */
export async function mergeJobs(db: Db, keepId: string, dropId: string, now = new Date().toISOString()): Promise<void> {
  if (keepId === dropId) return;
  await db.transaction(async (tx) => {
    // sightings: keep unique (source_key, source_job_id)
    await tx.run("UPDATE job_sightings SET job_id=? WHERE job_id=?", [keepId, dropId]);

    const keepApp = await getApplication(tx, keepId);
    const dropApp = await getApplication(tx, dropId);
    if (dropApp) {
      if (!keepApp) {
        await tx.run("UPDATE applications SET job_id=? WHERE job_id=?", [keepId, dropId]);
      } else {
        const status = furtherAlong(keepApp.status, dropApp.status);
        const notes = [keepApp.notes, dropApp.notes && dropApp.notes !== keepApp.notes ? `(merged) ${dropApp.notes}` : ""].filter(Boolean).join("\n");
        await tx.run("UPDATE applications SET status=?, applied_at=?, follow_up_at=?, notes=?, updated_at=? WHERE job_id=?", [
          status, keepApp.appliedAt ?? dropApp.appliedAt, keepApp.followUpAt ?? dropApp.followUpAt, notes, now, keepId,
        ]);
        await tx.run("DELETE FROM applications WHERE job_id=?", [dropId]);
      }
    }
    await tx.run("DELETE FROM job_scores WHERE job_id=?", [dropId]);
    await tx.run("DELETE FROM notified_jobs WHERE job_id=?", [dropId]);
    await tx.run("DELETE FROM jobs WHERE id=?", [dropId]);
    await tx.run(
      "UPDATE dup_candidates SET status='merged', resolved_at=? WHERE (job_a=? AND job_b=?) OR (job_a=? AND job_b=?)",
      [now, keepId, dropId, dropId, keepId],
    );
    // any other pending candidates that referenced the dropped job now point at the kept one
    await tx.run("DELETE FROM dup_candidates WHERE status='pending' AND (job_a=? OR job_b=?)", [dropId, dropId]);
  });
}
