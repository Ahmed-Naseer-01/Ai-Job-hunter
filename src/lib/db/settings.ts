import type { Db } from "./types";

export async function getSetting<T = unknown>(db: Db, key: string): Promise<T | null> {
  const rows = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return rows.length ? (JSON.parse(rows[0].value) as T) : null;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), now],
  );
}
