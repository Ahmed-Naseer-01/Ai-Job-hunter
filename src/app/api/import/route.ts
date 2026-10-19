import { route } from "@/lib/api";
import { getDb } from "@/lib/db";
import { commitImport, previewImport } from "@/lib/services/import";
import { MAX_IMPORT_BYTES } from "@/lib/sources/import";
import { ValidationError } from "@/lib/services/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST {kind: json|csv|eml|urls, content: string, commit?: boolean}
 * Without commit=true this only previews. Imports never contact LinkedIn and never fetch anything except
 * Greenhouse/Lever public API endpoints.
 */
export const POST = route(async (req: Request) => {
  const raw = await req.text();
  if (raw.length > MAX_IMPORT_BYTES * 1.5) throw new ValidationError("Request body too large");
  let body: { kind?: unknown; content?: unknown; commit?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
  if (body.commit === true) return commitImport(await getDb(), body.kind, body.content);
  return previewImport(body.kind, body.content);
});
