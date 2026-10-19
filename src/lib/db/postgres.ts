import pg from "pg";
import { isRollbackSignal, type Db, type Row } from "./types";

// COUNT(*) etc. come back as int8 strings by default; we only store small numbers.
pg.types.setTypeParser(20, (v: string) => Number(v));
pg.types.setTypeParser(1700, (v: string) => Number(v));

/** Convert `?` placeholders to `$1..$n`. Our SQL never contains a literal `?`. */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function norm(params: unknown[] = []): any[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p instanceof Date ? p.toISOString() : p));
}

export function openPostgres(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX) || 10 });

  const make = (client: pg.PoolClient | null): Db => {
    const target = (): pg.Pool | pg.PoolClient => client ?? pool;
    const self: Db = {
      dialect: "postgres",
      query: async <T = Row>(sql: string, params?: unknown[]) => {
        const r = await target().query(toPgPlaceholders(sql), norm(params));
        return r.rows as T[];
      },
      run: async (sql, params) => {
        const r = await target().query(toPgPlaceholders(sql), norm(params));
        return { changes: r.rowCount ?? 0 };
      },
      transaction: async <T>(fn: (tx: Db) => Promise<T>) => {
        if (client) return fn(self);
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const out = await fn(make(c));
          await c.query("COMMIT");
          return out;
        } catch (e) {
          await c.query("ROLLBACK");
          if (isRollbackSignal(e)) return e.value as T;
          throw e;
        } finally {
          c.release();
        }
      },
      close: async () => {
        if (!client) await pool.end();
      },
    };
    return self;
  };
  return make(null);
}
