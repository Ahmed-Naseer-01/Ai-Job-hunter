import { route } from "@/lib/api";
import { getDb } from "@/lib/db";
import { previewDigest } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const GET = route(async (req: Request) => {
  const real = new URL(req.url).searchParams.get("synthetic") === "false";
  return previewDigest(await getDb(), { includeSynthetic: !real });
});
