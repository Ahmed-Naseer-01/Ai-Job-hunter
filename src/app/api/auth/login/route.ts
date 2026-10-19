import { NextResponse } from "next/server";
import { authMode, clearLoginFailures, createSessionToken, loginThrottle, passwordMatches, recordLoginFailure, safeNext, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";

export const dynamic = "force-dynamic";

const clientKey = (req: Request) => (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim().slice(0, 64) || "local";
const wantsJson = (req: Request) => (req.headers.get("content-type") ?? "").includes("application/json");

async function readCredentials(req: Request): Promise<{ password: string; next: string | null }> {
  try {
    if (wantsJson(req)) {
      const b = await req.json();
      return { password: typeof b?.password === "string" ? b.password : "", next: typeof b?.next === "string" ? b.next : null };
    }
    const f = await req.formData();
    const p = f.get("password");
    const n = f.get("next");
    return { password: typeof p === "string" ? p : "", next: typeof n === "string" ? n : null };
  } catch {
    return { password: "", next: null };
  }
}

export async function POST(req: Request) {
  const auth = authMode();
  const asJson = wantsJson(req);
  const fail = (status: number, error: string, headers: Record<string, string> = {}) =>
    asJson ? NextResponse.json({ error }, { status, headers }) : NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url), { status: 303, headers });

  if (auth.mode === "misconfigured") return fail(503, "Authentication is not configured on the server");
  if (auth.mode === "open_dev") return asJson ? NextResponse.json({ ok: true, note: "Authentication is not configured (development mode)" }) : NextResponse.redirect(new URL("/", req.url), 303);

  const key = clientKey(req);
  const t = loginThrottle(key);
  if (t.blocked) return fail(429, "Too many failed attempts. Try again later.", { "retry-after": String(t.retryAfterSeconds) });

  const { password, next } = await readCredentials(req);
  if (!(await passwordMatches(password, process.env.DASHBOARD_PASSWORD!))) {
    recordLoginFailure(key);
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return fail(401, "Incorrect password");
  }
  clearLoginFailures(key);

  const token = await createSessionToken(process.env.AUTH_SECRET!);
  const res = asJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL(safeNext(next), req.url), 303);
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL_SECONDS });
  res.headers.set("cache-control", "no-store");
  return res;
}
