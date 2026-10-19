import { route, readJson } from "@/lib/api";
import { testSource } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const POST = route(async (req: Request) => testSource(await readJson(req)));
