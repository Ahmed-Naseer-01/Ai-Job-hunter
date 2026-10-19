import type { Db } from "./types";

/**
 * Cross-process lock stored in the DB. A lock that has passed `expires_at` is considered stale
 * (crashed holder) and can be taken over.
 */
export async function acquireLock(db: Db, name: string, holder: string, ttlMs: number, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ holder: string; expires_at: string }>("SELECT holder, expires_at FROM locks WHERE name = ?", [name]);
    const expires = new Date(now.getTime() + ttlMs).toISOString();
    if (!rows.length) {
      const r = await tx.run(
        "INSERT INTO locks (name, holder, acquired_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO NOTHING",
        [name, holder, now.toISOString(), expires],
      );
      return r.changes === 1;
    }
    const cur = rows[0];
    if (cur.holder === holder || new Date(cur.expires_at).getTime() <= now.getTime()) {
      await tx.run("UPDATE locks SET holder = ?, acquired_at = ?, expires_at = ? WHERE name = ?", [holder, now.toISOString(), expires, name]);
      return true;
    }
    return false;
  });
}

export async function extendLock(db: Db, name: string, holder: string, ttlMs: number, now = new Date()): Promise<void> {
  await db.run("UPDATE locks SET expires_at = ? WHERE name = ? AND holder = ?", [new Date(now.getTime() + ttlMs).toISOString(), name, holder]);
}

export async function releaseLock(db: Db, name: string, holder: string): Promise<void> {
  await db.run("DELETE FROM locks WHERE name = ? AND holder = ?", [name, holder]);
}
