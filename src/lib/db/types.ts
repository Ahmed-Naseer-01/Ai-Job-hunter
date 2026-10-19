export type Row = Record<string, any>;

/**
 * Minimal async database interface. SQL is written once in a portable subset
 * (`?` placeholders, TEXT timestamps, TEXT JSON, INTEGER booleans,
 * `ON CONFLICT ... DO UPDATE`) and runs on SQLite and PostgreSQL.
 */
export interface Db {
  readonly dialect: "sqlite" | "postgres";
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Run `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Thrown inside a transaction callback to roll back without surfacing an error (dry runs). */
export class RollbackSignal extends Error {
  /** Marker used instead of `instanceof`: bundlers can duplicate this module across chunks, which breaks instanceof. */
  readonly isRollbackSignal = true;
  constructor(public readonly value?: unknown) {
    super("rollback");
  }
}

export const isRollbackSignal = (e: unknown): e is RollbackSignal => !!e && typeof e === "object" && (e as { isRollbackSignal?: unknown }).isRollbackSignal === true;
