import { route } from "@/lib/api";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { listJobs, toCsv } from "@/lib/services/queries";
import { filtersFromParams } from "@/lib/ui/filters";

export const dynamic = "force-dynamic";
export const GET = route(async (req: Request) => {
  const db = await getDb();
  const settings = await loadSettings(db);
  const f = filtersFromParams(new URL(req.url).searchParams, { includeSynthetic: settings.search.showSynthetic });
  const { items } = await listJobs(db, { ...f, page: 1, pageSize: 200 });
  // Export respects the active filters (first 200 rows, highest score first by default).
  return new Response(toCsv(items), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="jobs-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
