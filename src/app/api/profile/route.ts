import { route, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/db/config";
import { updateProfile } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ profile: await loadProfile(await getDb()) }));
export const PUT = route(async (req: Request) => updateProfile(await getDb(), await readJson(req)));
