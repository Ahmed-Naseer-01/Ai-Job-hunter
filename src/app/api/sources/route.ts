import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { sourceStatuses } from "@/lib/services/queries";
import { addSource } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ sources: await sourceStatuses(await getDb()) }));
export const POST = route(async (req: Request) => addSource(await getDb(), await readJson(req)));
