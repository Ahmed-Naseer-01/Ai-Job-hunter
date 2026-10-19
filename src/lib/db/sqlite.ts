import fs from "node:fs";
import path from "node:path";
import { isRollbackSignal, type Db, type Row } from "./types";

// Loaded via getBuiltinModule so bundlers never try to resolve it.
type SqliteModule = typeof import("node:sqlite");
function loadSqlite(): SqliteModule {
  const mod = (process as any).getBuiltinModule?.("node:sqlite") as SqliteModule | undefined;
  if (!mod) throw new Error("node:sqlite is unavailable. Use Node.js >= 22.5 or set DATABASE_URL to a postgres:// URL.");
  return mod;
}

function norm(params: unknown[] = []): any[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    return p as any;
  });
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export function openSqlite(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const mutex = new Mutex();

  const exec = {
    query: (sql: string, params?: unknown[]) => raw.prepare(sql).all(...norm(params)) as Row[],
    run: (sql: string, params?: unknown[]) => {
      const r = raw.prepare(sql).run(...norm(params));
      return { changes: Number(r.changes) };
    },
  };

  const make = (inTx: boolean): Db => ({
    dialect: "sqlite",
    query: async <T = Row>(sql: string, params?: unknown[]) =>
      (inTx ? exec.query(sql, params) : await mutex.run(async () => exec.query(sql, params))) as T[],
    run: async (sql, params) => (inTx ? exec.run(sql, params) : mutex.run(async () => exec.run(sql, params))),
    transaction: async <T>(fn: (tx: Db) => Promise<T>) => {
      if (inTx) return fn(txDb);
      return mutex.run(async () => {
        raw.exec("BEGIN IMMEDIATE");
        try {
          const out = await fn(txDb);
          raw.exec("COMMIT");
          return out;
        } catch (e) {
          raw.exec("ROLLBACK");
          if (isRollbackSignal(e)) return e.value as T;
          throw e;
        }
      });
    },
    close: async () => {
      if (!inTx) raw.close();
    },
  });

  const txDb = make(true);
  return make(false);
}
