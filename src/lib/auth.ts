/**
 * Single-user session authentication. Works in both the Next proxy and route handlers (Web Crypto only).
 *
 * - DASHBOARD_PASSWORD: the login password. AUTH_SECRET: >= 32 chars, signs session cookies (rotate to log everyone out).
 * - Session cookie = base64url(payload).base64url(HMAC-SHA256). HttpOnly, SameSite=Lax, Secure when served over https.
 * - Fail closed: in production, if either variable is missing/weak, every request is refused with 503.
 *   In development (NODE_ENV !== "production") with nothing configured, the dashboard is open for local use.
 */
export const SESSION_COOKIE = "jh_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const MIN_SECRET = 32;
const MIN_PASSWORD = 8;

export type AuthMode = "enforced" | "open_dev" | "misconfigured";

export function authMode(env: NodeJS.ProcessEnv = process.env): { mode: AuthMode; problem?: string } {
  const pw = env.DASHBOARD_PASSWORD ?? "";
  const secret = env.AUTH_SECRET ?? "";
  const production = env.NODE_ENV === "production";
  if (!pw && !secret) return production ? { mode: "misconfigured", problem: "DASHBOARD_PASSWORD and AUTH_SECRET are not set" } : { mode: "open_dev" };
  if (pw.length < MIN_PASSWORD) return { mode: "misconfigured", problem: `DASHBOARD_PASSWORD must be at least ${MIN_PASSWORD} characters` };
  if (secret.length < MIN_SECRET) return { mode: "misconfigured", problem: `AUTH_SECRET must be at least ${MIN_SECRET} characters (try: openssl rand -hex 32)` };
  return { mode: "enforced" };
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const hmacKey = (secret: string, usage: "sign" | "verify") => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export async function createSessionToken(secret: string, now = Date.now(), ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySessionToken(token: string | undefined | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 512) return false;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return false;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64url(sig) as BufferSource, enc.encode(payload)); // constant-time
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data?.v === 1 && typeof data.exp === "number" && data.exp * 1000 > now;
  } catch {
    return false;
  }
}

/** Constant-time password check (hash both sides so length does not leak). */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const key = await hmacKey("jh-password-compare", "sign");
  const [a, b] = await Promise.all([crypto.subtle.sign("HMAC", key, enc.encode(given)), crypto.subtle.sign("HMAC", key, enc.encode(expected))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && given.length > 0;
}

/** CSRF defence for cookie auth: state-changing requests must come from our own origin. */
export function sameOrigin(req: { method: string; headers: Headers }): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) {
    // Browsers always send Origin on cross-site POSTs. A missing Origin means a non-browser client (curl, tests):
    // still require a Sec-Fetch-Site that is not cross-site if the browser provided one.
    const site = req.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  }
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return "/";
  return next;
}

// ---- login throttling (in-memory, per process; the dashboard is a single instance) ----
const attempts = new Map<string, { fails: number; first: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;

export function loginThrottle(key: string, now = Date.now()) {
  const e = attempts.get(key);
  if (e && now - e.first > WINDOW_MS) attempts.delete(key);
  const cur = attempts.get(key);
  return { blocked: !!cur && cur.fails >= MAX_FAILS, retryAfterSeconds: cur ? Math.max(1, Math.ceil((cur.first + WINDOW_MS - now) / 1000)) : 0 };
}
export function recordLoginFailure(key: string, now = Date.now()) {
  const cur = attempts.get(key);
  if (!cur || now - cur.first > WINDOW_MS) attempts.set(key, { fails: 1, first: now });
  else cur.fails++;
  if (attempts.size > 1000) for (const [k, v] of attempts) if (now - v.first > WINDOW_MS) attempts.delete(k);
}
export const clearLoginFailures = (key: string) => void attempts.delete(key);
export const _resetThrottleForTests = () => attempts.clear();
