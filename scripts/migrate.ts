import { getDb } from "../src/lib/db";
import { databaseUrl } from "../src/lib/db";
import { listSources } from "../src/lib/db/sources";

(async () => {
  const db = await getDb(); // opens, migrates, seeds defaults
  const rows = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM jobs");
  console.log(`Database ready (${databaseUrl().replace(/:[^:@/]*@/, ":***@")}) — ${rows[0].n} jobs, ${(await listSources(db)).length} sources.`);
  await db.close();
})().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
