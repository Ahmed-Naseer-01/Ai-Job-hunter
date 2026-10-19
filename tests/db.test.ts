import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { getSetting, setSetting } from "@/lib/db/settings";
import { acquireLock, releaseLock } from "@/lib/db/locks";

describe("db: sqlite driver + migrations", () => {
  it("runs on the intended backend (guards against silently testing the wrong database)", async () => {
    const db = await testDb();
    expect(db.dialect).toBe(process.env.TEST_PG_URL ? "postgres" : "sqlite");
    if (db.dialect === "postgres") {
      const v = await db.query<{ v: string }>("SELECT version() AS v");
      expect(v[0].v).toMatch(/PostgreSQL/);
      // COUNT(*) must come back as a JS number, not an int8 string
      expect(typeof (await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM jobs"))[0].n).toBe("number");
    }
  });

  it("applies migrations idempotently", async () => {
    const db = await testDb();
    const { migrate } = await import("@/lib/db/migrate");
    await migrate(db); // second run must be a no-op
    const rows = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM schema_migrations");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("rolls back and returns the value on a RollbackSignal, even if the class identity differs (bundler-duplicated module)", async () => {
    const { RollbackSignal } = await import("@/lib/db/types");
    const db = await testDb();
    const out = await db.transaction(async (tx) => {
      await setSetting(tx, "k", "inside");
      throw new RollbackSignal("planned");
    });
    expect(out).toBe("planned");
    expect(await getSetting(db, "k")).toBeNull();

    // A look-alike from a duplicated module copy: different class, same marker.
    class OtherCopy extends Error {
      readonly isRollbackSignal = true;
      constructor(public readonly value?: unknown) {
        super("rollback");
      }
    }
    const out2 = await db.transaction(async (tx) => {
      await setSetting(tx, "k2", "inside");
      throw new OtherCopy("dup-class");
    });
    expect(out2).toBe("dup-class");
    expect(await getSetting(db, "k2")).toBeNull();

    // Real errors still propagate and roll back
    await expect(
      db.transaction(async (tx) => {
        await setSetting(tx, "k3", "x");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await getSetting(db, "k3")).toBeNull();
  });

  it("persists and reads JSON settings", async () => {
    const db = await testDb();
    expect(await getSetting(db, "profile")).toBeNull();
    await setSetting(db, "profile", { name: "Ahmed", skills: [1, 2] });
    await setSetting(db, "profile", { name: "Ahmed N", skills: [1, 2, 3] });
    expect(await getSetting(db, "profile")).toEqual({ name: "Ahmed N", skills: [1, 2, 3] });
  });

  it("rolls back a failed transaction", async () => {
    const db = await testDb();
    await expect(
      db.transaction(async (tx) => {
        await setSetting(tx, "k", { a: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await getSetting(db, "k")).toBeNull();
  });
});

describe("db: locks", () => {
  it("prevents overlapping holders and allows stale takeover", async () => {
    const db = await testDb();
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect(await acquireLock(db, "run", "A", 60_000, t0)).toBe(true);
    expect(await acquireLock(db, "run", "B", 60_000, new Date(t0.getTime() + 1000))).toBe(false);
    // after expiry B may take over
    expect(await acquireLock(db, "run", "B", 60_000, new Date(t0.getTime() + 61_000))).toBe(true);
    // A can no longer release B's lock
    await releaseLock(db, "run", "A");
    expect(await acquireLock(db, "run", "C", 60_000, new Date(t0.getTime() + 62_000))).toBe(false);
    await releaseLock(db, "run", "B");
    expect(await acquireLock(db, "run", "C", 60_000, new Date(t0.getTime() + 63_000))).toBe(true);
  });
});
