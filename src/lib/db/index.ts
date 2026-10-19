import path from "node:path";
import type { Db } from "./types";
import { openSqlite } from "./sqlite";
import { openPostgres } from "./postgres";
import { migrate } from "./migrate";
import { ensureDefaults } from "../seed";

export function openFromUrl(url: string): Db {
  if (/^postgres(ql)?:\/\//i.test(url)) return openPostgres(url);
  const m = /^sqlite:(?:\/\/)?(.*)$/i.exec(url);
  if (!m) throw new Error(`Unsupported DATABASE_URL "${url.replace(/:[^:@/]*@/, ":***@")}". Use sqlite:./data/jobhunter.db or postgres://...`);
  const file = m[1] === ":memory:" ? ":memory:" : path.resolve(/*turbopackIgnore: true*/ process.cwd(), m[1] || "./data/jobhunter.db");
  return openSqlite(file);
}

export const databaseUrl = () => process.env.DATABASE_URL || "sqlite:./data/jobhunter.db";

const g = globalThis as unknown as { __jobhunterDb?: Promise<Db> };

/** Process-wide database handle: opens, migrates and seeds defaults exactly once. */
export function getDb(): Promise<Db> {
  if (!g.__jobhunterDb) {
    g.__jobhunterDb = (async () => {
      const db = openFromUrl(databaseUrl());
      await migrate(db);
      await ensureDefaults(db);
      return db;
    })().catch((e) => {
      g.__jobhunterDb = undefined;
      throw e;
    });
  }
  return g.__jobhunterDb;
}
