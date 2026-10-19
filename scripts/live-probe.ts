/**
 * Live smoke test for source adapters. Makes real HTTP requests to the public APIs.
 *   npm run probe -- greenhouse gitlab
 *   npm run probe -- lever <site>
 */
import { greenhouseAdapter } from "../src/lib/sources/greenhouse";
import { leverAdapter } from "../src/lib/sources/lever";
import { withRetry } from "../src/lib/sources/retry";
import { enrichJob } from "../src/lib/jobs/enrich";

const [kind, id] = process.argv.slice(2);
const ctx = { fetch, now: () => new Date(), log: (l: string, m: string) => console.log(`[${l}] ${m}`), timeoutMs: 30_000 };

async function main() {
  const adapter: any = kind === "greenhouse" ? greenhouseAdapter : kind === "lever" ? leverAdapter : null;
  if (!adapter || !id) throw new Error("usage: probe <greenhouse|lever> <token>");
  const cfg = adapter.configSchema.parse(kind === "greenhouse" ? { boardToken: id } : { site: id });
  const t0 = Date.now();
  const { value: res, attempts } = await withRetry<any>(() => adapter.fetchJobs(cfg, ctx), { retries: 2, baseMs: 1000, maxMs: 5000 });
  console.log(`${kind}:${id} → HTTP ${res.httpStatus}, listed=${res.totalListed}, normalised=${res.jobs.length}, attempts=${attempts}, ${Date.now() - t0}ms`);
  if (res.notes.length) console.log("notes:", res.notes.join("; "));
  const enriched = res.jobs.map((j: any) => enrichJob(j));
  const withDesc = enriched.filter((e: any) => e.description.length > 200).length;
  const withLoc = enriched.filter((e: any) => e.locationRaw).length;
  const withSalary = enriched.filter((e: any) => e.salaryMin !== null).length;
  console.log(`enriched=${enriched.length}, withDescription=${withDesc}, withLocation=${withLoc}, withPublishedSalary=${withSalary}`);
  const sample = enriched.find((e: any) => /java|backend|software/i.test(e.title)) ?? enriched[0];
  if (sample) {
    console.log("sample:", JSON.stringify({ title: sample.title, company: sample.company, url: sample.applyUrl, location: sample.locationRaw, workMode: sample.workMode, posted: sample.postedAt, req: sample.requiredSkills.map((s: any) => s.id), yearsMin: sample.yearsMin }, null, 2));
    if (res.seenIds[0]) {
      const v = await adapter.verifyJob(cfg, String(res.jobs[0].sourceJobId), ctx);
      console.log("verifyJob(first):", v);
    }
  }
}
main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
