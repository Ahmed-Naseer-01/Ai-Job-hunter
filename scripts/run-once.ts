/**
 * Run the collection pipeline once from the command line.
 *   npm run run:once                      # real run
 *   npm run run:once -- --dry-run         # no writes, no email
 *   npm run run:once -- --lookback 90 --source greenhouse:gitlab
 */
import { getDb } from "../src/lib/db";
import { runPipeline } from "../src/lib/pipeline/run";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const db = await getDb();
  const dryRun = process.argv.includes("--dry-run");
  const lookback = arg("lookback");
  const source = arg("source");
  const t0 = Date.now();
  const r = await runPipeline(db, {
    trigger: "cli",
    dryRun,
    lookbackDays: lookback ? Number(lookback) : undefined,
    sourceKeys: source ? [source] : undefined,
    skipNotifications: process.argv.includes("--no-notify"),
  });
  console.log(JSON.stringify({ status: r.status, dryRun: r.dryRun, runId: r.runId, ms: Date.now() - t0, counts: r.counts, errors: r.errors, notify: r.notify }, null, 2));
  await db.close();
  process.exit(r.status === "failed" ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
