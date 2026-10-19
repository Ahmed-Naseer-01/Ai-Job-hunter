import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  authMode, createSessionToken, verifySessionToken, passwordMatches, sameOrigin, safeNext, loginThrottle, recordLoginFailure, clearLoginFailures, _resetThrottleForTests, SESSION_COOKIE,
} from "@/lib/auth";
import { proxy } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";

const SECRET = "x".repeat(40);
const PW = "correct horse battery";

function env(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
}
afterEach(() => {
  vi.unstubAllEnvs();
  _resetThrottleForTests();
});

const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) => new NextRequest(`http://localhost:3000${url}`, init);
const isPassThrough = (r: Response) => r.headers.get("x-middleware-next") === "1";

describe("authMode", () => {
  it("fails closed in production when unset or weak", () => {
    expect(authMode({ NODE_ENV: "production" } as any).mode).toBe("misconfigured");
    expect(authMode({ NODE_ENV: "production", DASHBOARD_PASSWORD: "short", AUTH_SECRET: SECRET } as any)).toMatchObject({ mode: "misconfigured" });
    expect(authMode({ NODE_ENV: "production", DASHBOARD_PASSWORD: PW, AUTH_SECRET: "tooshort" } as any)).toMatchObject({ mode: "misconfigured" });
    expect(authMode({ NODE_ENV: "production", DASHBOARD_PASSWORD: PW } as any).mode).toBe("misconfigured");
  });
  it("is open only in development with nothing configured; enforced when configured anywhere", () => {
    expect(authMode({ NODE_ENV: "development" } as any).mode).toBe("open_dev");
    expect(authMode({ NODE_ENV: "development", DASHBOARD_PASSWORD: PW, AUTH_SECRET: SECRET } as any).mode).toBe("enforced");
    expect(authMode({ NODE_ENV: "production", DASHBOARD_PASSWORD: PW, AUTH_SECRET: SECRET } as any).mode).toBe("enforced");
    expect(authMode({ NODE_ENV: "development", DASHBOARD_PASSWORD: PW } as any).mode).toBe("misconfigured"); // half-configured is never "open"
  });
});

describe("session tokens", () => {
  it("round-trips and rejects tampering, wrong secret, expiry and garbage", async () => {
    const t = await createSessionToken(SECRET, 1_000_000, 60);
    expect(await verifySessionToken(t, SECRET, 1_000_000 + 30_000)).toBe(true);
    expect(await verifySessionToken(t, SECRET, 1_000_000 + 61_000)).toBe(false); // expired
    expect(await verifySessionToken(t, "y".repeat(40), 1_000_000)).toBe(false);
    const [p, s] = t.split(".");
    expect(await verifySessionToken(`${p}.${s.slice(0, -2)}AA`, SECRET, 1_000_000)).toBe(false);
    const forged = Buffer.from(JSON.stringify({ v: 1, iat: 0, exp: 9_999_999_999 })).toString("base64url");
    expect(await verifySessionToken(`${forged}.${s}`, SECRET, 1_000_000)).toBe(false); // valid sig for another payload
    for (const bad of ["", "abc", "a.b.c", "....", undefined, null, "x".repeat(600)]) expect(await verifySessionToken(bad as any, SECRET)).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("matches only the exact password and never an empty one", async () => {
    expect(await passwordMatches(PW, PW)).toBe(true);
    expect(await passwordMatches(PW + " ", PW)).toBe(false);
    expect(await passwordMatches("", "")).toBe(false);
    expect(await passwordMatches("a", PW)).toBe(false);
  });
});

describe("CSRF origin check", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("allows safe methods and same-origin writes; blocks cross-origin writes", () => {
    expect(sameOrigin({ method: "GET", headers: h({ origin: "https://evil.example" }) })).toBe(true);
    expect(sameOrigin({ method: "POST", headers: h({ origin: "http://localhost:3000", host: "localhost:3000" }) })).toBe(true);
    expect(sameOrigin({ method: "POST", headers: h({ origin: "https://evil.example", host: "localhost:3000" }) })).toBe(false);
    expect(sameOrigin({ method: "PUT", headers: h({ origin: "not a url", host: "localhost:3000" }) })).toBe(false);
    expect(sameOrigin({ method: "POST", headers: h({ "sec-fetch-site": "cross-site", host: "localhost:3000" }) })).toBe(false);
    expect(sameOrigin({ method: "POST", headers: h({ host: "localhost:3000" }) })).toBe(true); // non-browser client (curl)
  });
});

describe("safeNext", () => {
  it("blocks open redirects", () => {
    expect(safeNext("/jobs?q=1")).toBe("/jobs?q=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=1", "", null, undefined]) expect(safeNext(bad as any)).toBe("/");
  });
});

describe("login throttle", () => {
  it("blocks after 5 failures within the window and resets after it or on success", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(loginThrottle("ip", t0).blocked).toBe(false);
      recordLoginFailure("ip", t0);
    }
    expect(loginThrottle("ip", t0 + 1000).blocked).toBe(true);
    expect(loginThrottle("other", t0).blocked).toBe(false);
    expect(loginThrottle("ip", t0 + 16 * 60_000).blocked).toBe(false);
    for (let i = 0; i < 5; i++) recordLoginFailure("ip2", t0);
    clearLoginFailures("ip2");
    expect(loginThrottle("ip2", t0).blocked).toBe(false);
  });
});

describe("proxy: protected routes (production, auth configured)", () => {
  beforeEach(() => env({ NODE_ENV: "production", DASHBOARD_PASSWORD: PW, AUTH_SECRET: SECRET }));

  // Every API route file in the repo, discovered from disk so new routes cannot silently ship unprotected.
  const apiDir = path.join(process.cwd(), "src/app/api");
  const routes: string[] = [];
  (function walk(dir: string, rel: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`);
      else if (e.name === "route.ts") routes.push(rel.replace(/\[[^\]]+\]/g, "x"));
    }
  })(apiDir, "/api");
  const PUBLIC = new Set(["/api/auth/login"]);

  it("discovers the API routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(14);
    expect(routes).toContain("/api/profile");
    expect(routes).toContain("/api/runs");
  });

  it("rejects every non-public API route without a session (401), for every method", async () => {
    for (const r of routes.filter((r) => !PUBLIC.has(r))) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const res = await proxy(req(r, { method }));
        expect(res.status, `${method} ${r}`).toBe(401);
      }
    }
  });

  it("logout also needs a session (cannot be triggered anonymously)", async () => {
    expect((await proxy(req("/api/auth/logout", { method: "POST" }))).status).toBe(401);
  });

  it("redirects pages to /login with a safe next parameter", async () => {
    for (const p of ["/", "/jobs", "/jobs/abc", "/profile", "/settings", "/sources", "/tracker", "/matches"]) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(307);
      expect(res.headers.get("location")).toContain("/login?next=");
    }
    expect((await proxy(req("/jobs?q=java"))).headers.get("location")).toContain(encodeURIComponent("/jobs?q=java"));
  });

  it("keeps login reachable", async () => {
    expect(isPassThrough(await proxy(req("/login")))).toBe(true);
    expect(isPassThrough(await proxy(req("/api/auth/login", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } })))).toBe(true);
  });

  it("accepts a valid session, rejects tampered/expired/foreign-secret sessions", async () => {
    const good = await createSessionToken(SECRET);
    const cookie = (t: string) => ({ cookie: `${SESSION_COOKIE}=${t}` });
    expect(isPassThrough(await proxy(req("/api/jobs", { headers: cookie(good) })))).toBe(true);
    expect(isPassThrough(await proxy(req("/jobs", { headers: cookie(good) })))).toBe(true);
    expect((await proxy(req("/api/jobs", { headers: cookie(good.slice(0, -3) + "abc") }))).status).toBe(401);
    expect((await proxy(req("/api/jobs", { headers: cookie(await createSessionToken("z".repeat(40))) }))).status).toBe(401);
    expect((await proxy(req("/api/jobs", { headers: cookie(await createSessionToken(SECRET, Date.now() - 30 * 86_400_000)) }))).status).toBe(401);
  });

  it("blocks cross-origin state changes even with a valid session (CSRF)", async () => {
    const good = await createSessionToken(SECRET);
    const res = await proxy(req("/api/runs", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${good}`, origin: "https://evil.example", host: "localhost:3000" } }));
    expect(res.status).toBe(403);
    const ok = await proxy(req("/api/runs", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${good}`, origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(isPassThrough(ok)).toBe(true);
  });

  it("does not leak details in 401 bodies and disables caching", async () => {
    const res = await proxy(req("/api/profile"));
    expect(await res.json()).toEqual({ error: "Authentication required" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("proxy: misconfiguration and dev mode", () => {
  it("production without credentials refuses everything with 503 (fail closed)", async () => {
    env({ NODE_ENV: "production", DASHBOARD_PASSWORD: undefined, AUTH_SECRET: undefined });
    for (const p of ["/", "/login", "/api/jobs", "/api/auth/login"]) expect((await proxy(req(p))).status, p).toBe(503);
  });
  it("development without credentials is open (local use)", async () => {
    env({ NODE_ENV: "development", DASHBOARD_PASSWORD: undefined, AUTH_SECRET: undefined });
    expect(isPassThrough(await proxy(req("/api/jobs")))).toBe(true);
  });
});

describe("login route", () => {
  const post = (body: object | string, headers: Record<string, string> = {}, form = false) =>
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": form ? "application/x-www-form-urlencoded" : "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  beforeEach(() => env({ NODE_ENV: "production", DASHBOARD_PASSWORD: PW, AUTH_SECRET: SECRET }));

  it("rejects a wrong password without setting a cookie", async () => {
    const res = await login(post({ password: "nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("issues an HttpOnly, SameSite=Lax session cookie that the proxy accepts", async () => {
    const res = await login(post({ password: PW }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const token = /jh_session=([^;]+)/.exec(setCookie)![1];
    expect(await verifySessionToken(token, SECRET)).toBe(true);
    expect(isPassThrough(await proxy(req("/api/jobs", { headers: { cookie: `jh_session=${token}` } })))).toBe(true);
  });

  it("marks the cookie Secure behind https", async () => {
    const res = await login(post({ password: PW }, { "x-forwarded-proto": "https" }));
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("form login redirects only to same-site paths", async () => {
    const ok = await login(post(`password=${encodeURIComponent(PW)}&next=${encodeURIComponent("/jobs?q=java")}`, {}, true));
    expect(ok.status).toBe(303);
    expect(new URL(ok.headers.get("location")!).pathname).toBe("/jobs");
    const evil = await login(post(`password=${encodeURIComponent(PW)}&next=${encodeURIComponent("https://evil.example")}`, {}, true));
    expect(new URL(evil.headers.get("location")!).host).toBe("localhost:3000");
    const bad = await login(post("password=wrong", {}, true));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toContain("/login?error=");
  });

  it("throttles repeated failures per client and then rejects even the right password until the window passes", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post({ password: "bad" }, { "x-forwarded-for": "203.0.113.9" }))).status).toBe(401);
    const blocked = await login(post({ password: PW }, { "x-forwarded-for": "203.0.113.9" }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await login(post({ password: PW }, { "x-forwarded-for": "198.51.100.7" }))).status).toBe(200); // other clients unaffected
  }, 20_000);

  it("refuses to log in when the server is misconfigured", async () => {
    env({ NODE_ENV: "production", DASHBOARD_PASSWORD: undefined, AUTH_SECRET: undefined });
    expect((await login(post({ password: PW }))).status).toBe(503);
  });

  it("logout clears the cookie", async () => {
    const res = await logout(new Request("http://localhost:3000/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/jh_session=;/);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});
