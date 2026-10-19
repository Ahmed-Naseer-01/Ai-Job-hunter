import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { resolveDuplicate, ValidationError } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const b = (await readJson(req)) as { action?: string; keepId?: string };
  if (b.action !== "merge" && b.action !== "distinct") throw new ValidationError("action must be 'merge' or 'distinct'");
  return resolveDuplicate(await getDb(), id, b.action, b.keepId);
});
