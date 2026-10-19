import type { Db } from "./types";
import { MIGRATIONS } from "./migrations";

export async function migrate(db: Db): Promise<string[]> {
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set((await db.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const s of m.statements) await tx.run(s);
      await tx.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [m.id, new Date().toISOString()]);
    });
    applied.push(m.id);
  }
  return applied;
}
