import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getSource } from "@/lib/db/sources";
import { removeSource, toggleSource, ValidationError } from "@/lib/services/actions";

export const dynamic = "force-dynamic";

async function load(ctx: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await ctx.params).id);
  const db = await getDb();
  if (!(await getSource(db, id))) throw Object.assign(new Error("Source not found"), { status: 404 });
  return { id, db };
}

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id, db } = await load(ctx);
  const body = (await readJson(req)) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") throw new ValidationError("`enabled` must be a boolean");
  await toggleSource(db, id, body.enabled);
  return { ok: true };
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id, db } = await load(ctx);
  await removeSource(db, id);
  return { ok: true };
});
