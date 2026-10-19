import { openSqlite } from "@/lib/db/sqlite";
import { openPostgres } from "@/lib/db/postgres";
import { migrate } from "@/lib/db/migrate";
import type { Db } from "@/lib/db/types";

const opened: { db: Db; drop?: () => Promise<void> }[] = [];

/**
 * Fresh, isolated database with all migrations applied.
 * Default: in-memory SQLite. With TEST_PG_URL set, the SAME tests run against PostgreSQL, each test in its own schema.
 */
export async function testDb(): Promise<Db> {
  const url = process.env.TEST_PG_URL;
  if (!url) {
    const db = openSqlite(":memory:");
    await migrate(db);
    return db;
  }
  const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = openPostgres(url);
  await admin.run(`CREATE SCHEMA ${schema}`);
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  const db = openPostgres(u.toString());
  await migrate(db);
  opened.push({
    db,
    drop: async () => {
      await admin.run(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  });
  return db;
}

/** Called from the vitest setup file after each test file. */
export async function closeTestDbs() {
  while (opened.length) {
    const o = opened.pop()!;
    try {
      await o.db.close();
      await o.drop?.();
    } catch {
      /* best effort cleanup on a throwaway database */
    }
  }
}
