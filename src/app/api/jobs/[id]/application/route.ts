import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { updateApplication } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return { application: await updateApplication(await getDb(), id, await readJson(req)) };
});
