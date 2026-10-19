/**
 * Persistent scheduler worker. Runs independently of the dashboard and of Cursor.
 *
 *   npm run worker
 *
 * Every WORKER_TICK_SECONDS (default 30) it asks `schedulerTick` whether a scheduled run is due. The schedule
 * (time, timezone, enabled, dry-run) is read from the database on every tick, so changes made in the dashboard
 * take effect without restarting. Catch-up semantics: if the machine slept through the scheduled time, the run
 * happens as soon as the worker is awake. Multiple workers are safe: the pipeline takes a DB lock.
 */
import { getDb, databaseUrl } from "../src/lib/db";
import { schedulerTick } from "../src/lib/scheduler/tick";

const tickMs = Math.max(5, Number(process.env.WORKER_TICK_SECONDS) || 30) * 1000;
const log = (msg: string) => console.log(`${new Date().toISOString()} [worker] ${msg}`);

let stopping = false;
let wake: (() => void) | null = null;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1); // second signal: stop now
    stopping = true;
    log(`${sig} received; finishing the current step then exiting (press again to force)`);
    wake?.();
  });
}

(async () => {
  const db = await getDb();
  log(`started. db=${databaseUrl().replace(/:[^:@/]*@/, ":***@")} tick=${tickMs / 1000}s`);
  let lastLine = "";
  while (!stopping) {
    try {
      const r = await schedulerTick(db);
      const line =
        r.action === "ran"
          ? `run ${r.summary.runId} ${r.summary.status}${r.summary.dryRun ? " (dry)" : ""}: ${r.summary.counts.new} new, ${r.summary.counts.updated} updated, ${r.summary.counts.closed} closed, ${r.summary.counts.errors} errors — ${r.reason}`
          : r.action === "waiting_retry"
            ? `${r.reason}; retry at ${r.retryAt.toISOString()}`
            : `${r.action}: ${r.reason} (today's slot: ${r.scheduledFor.toISOString()})`;
      // Only print when something changed, so a 30 s tick doesn't flood the log.
      if (r.action === "ran" || line !== lastLine) log(line);
      lastLine = line;
    } catch (e: any) {
      log(`tick failed: ${String(e?.message ?? e).slice(0, 300)}`);
    }
    if (!stopping) await sleep(tickMs);
  }
  await db.close();
  log("stopped");
})().catch((e) => {
  console.error("worker crashed:", e?.message ?? e);
  process.exit(1);
});
