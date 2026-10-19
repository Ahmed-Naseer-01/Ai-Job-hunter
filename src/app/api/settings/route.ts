import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { updateSettings } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ settings: await loadSettings(await getDb()) }));
export const PUT = route(async (req: Request) => updateSettings(await getDb(), await readJson(req)));
