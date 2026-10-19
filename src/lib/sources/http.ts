import { HttpError } from "./retry";
import type { FetchContext } from "./types";

const MAX_BODY_BYTES = 40 * 1024 * 1024;
const UA = "AIJobHunter/0.1 (personal job search tool; contact: see repository)";

export interface JsonResponse {
  status: number;
  data: unknown;
}

/** GET a JSON document with a timeout, a size cap and status-aware errors. */
export async function getJson(url: string, ctx: FetchContext, allowedStatuses: number[] = []): Promise<JsonResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: ac.signal, redirect: "follow" });
    if (!res.ok && !allowedStatuses.includes(res.status)) {
      const ra = res.headers.get("retry-after");
      let retryAfterMs: number | undefined;
      if (ra) {
        const secs = Number(ra);
        retryAfterMs = Number.isFinite(secs) ? secs * 1000 : Math.max(0, new Date(ra).getTime() - Date.now());
      }
      throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, res.status, retryAfterMs);
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BODY_BYTES) throw new HttpError("Response too large", 413);
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new HttpError("Response too large", 413);
    if (!res.ok) return { status: res.status, data: null };
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      throw new HttpError("Response was not valid JSON", 502);
    }
  } finally {
    clearTimeout(timer);
  }
}
