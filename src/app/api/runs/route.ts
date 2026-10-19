import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listRuns } from "@/lib/db/runs";
import { runNow } from "@/lib/services/actions";
import { z } from "zod";
import { ValidationError } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ dryRun: z.boolean().optional(), lookbackDays: z.number().int().min(1).max(365).optional() });

export const GET = route(async () => ({ runs: await listRuns(await getDb(), 30) }));

/** "Run Now": runs the pipeline in-process and returns the summary. Concurrent runs are refused by the DB lock. */
export const POST = route(async (req: Request) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const summary = await runNow(await getDb(), parsed.data);
  return { summary };
});
