import { route } from "@/lib/api";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { listJobs } from "@/lib/services/queries";
import { filtersFromParams } from "@/lib/ui/filters";

export const dynamic = "force-dynamic";
export const GET = route(async (req: Request) => {
  const db = await getDb();
  const settings = await loadSettings(db);
  const f = filtersFromParams(new URL(req.url).searchParams, { includeSynthetic: settings.search.showSynthetic });
  return listJobs(db, f);
});
