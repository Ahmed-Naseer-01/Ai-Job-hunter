import type { Db, Row } from "./types";
import { safeJson } from "../util";

export interface SourceRow {
  id: string;
  kind: string;
  name: string;
  config: any;
  enabled: boolean;
  createdAt: string;
}
const row = (r: Row): SourceRow => ({ id: r.id, kind: r.kind, name: r.name, config: safeJson(r.config, {}), enabled: !!r.enabled, createdAt: r.created_at });

export async function listSources(db: Db): Promise<SourceRow[]> {
  return (await db.query("SELECT * FROM sources ORDER BY created_at, id")).map(row);
}
export async function getSource(db: Db, id: string): Promise<SourceRow | null> {
  const r = await db.query("SELECT * FROM sources WHERE id=?", [id]);
  return r.length ? row(r[0]) : null;
}
export async function upsertSource(db: Db, s: { id: string; kind: string; name: string; config: unknown; enabled?: boolean }): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO sources (id, kind, name, config, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET kind=excluded.kind, name=excluded.name, config=excluded.config, enabled=excluded.enabled, updated_at=excluded.updated_at`,
    [s.id, s.kind, s.name, JSON.stringify(s.config), s.enabled === false ? 0 : 1, now, now],
  );
}
export async function setSourceEnabled(db: Db, id: string, enabled: boolean): Promise<void> {
  await db.run("UPDATE sources SET enabled=?, updated_at=? WHERE id=?", [enabled ? 1 : 0, new Date().toISOString(), id]);
}
export async function deleteSource(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM sources WHERE id=?", [id]);
}
