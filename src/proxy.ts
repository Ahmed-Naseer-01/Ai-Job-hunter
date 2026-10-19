import { NextResponse, type NextRequest } from "next/server";
import { authMode, sameOrigin, SESSION_COOKIE, verifySessionToken } from "./lib/auth";

/** Paths reachable without a session. Everything else (pages and /api/*) requires one. */
const PUBLIC = new Set(["/login", "/api/auth/login"]);

const json = (body: object, status: number, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const auth = authMode();

  if (auth.mode === "misconfigured") {
    // Fail closed: never serve data when production auth is missing or weak.
    const msg = `Authentication is not configured: ${auth.problem}. Set DASHBOARD_PASSWORD and AUTH_SECRET.`;
    return isApi ? json({ error: msg }, 503) : new NextResponse(`<h1>503</h1><p>${msg.replace(/[<>&]/g, "")}</p>`, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  if (!sameOrigin(req)) return json({ error: "Cross-origin request blocked" }, 403);

  if (auth.mode === "open_dev" || PUBLIC.has(pathname)) return NextResponse.next();

  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET!);
  if (ok) return NextResponse.next();

  if (isApi) return json({ error: "Authentication required" }, 401, { "www-authenticate": 'Cookie realm="job-hunter"' });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
