import { getDb } from "../src/lib/db";
import { seedSyntheticJobs } from "../src/lib/seed";

(async () => {
  const db = await getDb();
  const n = await seedSyntheticJobs(db);
  console.log(`Synthetic jobs inserted this call: ${n} (existing ones are left untouched).`);
  await db.close();
})();
