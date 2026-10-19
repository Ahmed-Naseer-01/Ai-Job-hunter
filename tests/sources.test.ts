import { describe, it, expect, vi } from "vitest";
import { withRetry, HttpError, isRetryable } from "@/lib/sources/retry";
import { greenhouseAdapter } from "@/lib/sources/greenhouse";
import { leverAdapter } from "@/lib/sources/lever";
import { NormalizedJobInputSchema } from "@/lib/jobs/types";
import type { FetchContext } from "@/lib/sources/types";

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ctxWith = (fetchImpl: typeof fetch): FetchContext => ({ fetch: fetchImpl, now: () => new Date("2026-10-19T00:00:00Z"), log: () => {}, timeoutMs: 2000 });

describe("withRetry", () => {
  const noSleep = async () => {};
  it("retries transient failures with bounded exponential backoff", async () => {
    const delays: number[] = [];
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 4) throw new HttpError("boom", 503);
        return "ok";
      },
      { retries: 5, baseMs: 100, maxMs: 350, sleep: async (ms) => void delays.push(ms), random: () => 0 },
    );
    expect(r.value).toBe("ok");
    expect(r.attempts).toBe(4);
    expect(delays).toEqual([100, 200, 350]); // doubled, then capped at maxMs
  });
  it("gives up after the retry budget and reports attempts", async () => {
    const fn = vi.fn(async () => {
      throw new HttpError("down", 500);
    });
    await expect(withRetry(fn, { retries: 2, baseMs: 1, maxMs: 2, sleep: noSleep })).rejects.toMatchObject({ attempts: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("does not retry permanent errors (404, 401, 400)", async () => {
    for (const status of [404, 401, 400]) {
      const fn = vi.fn(async () => {
        throw new HttpError("nope", status);
      });
      await expect(withRetry(fn, { retries: 3, baseMs: 1, maxMs: 2, sleep: noSleep })).rejects.toMatchObject({ attempts: 1 });
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });
  it("honours Retry-After on 429 but never beyond maxMs", async () => {
    const delays: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        if (++n < 3) throw new HttpError("rate", 429, 60_000);
        return 1;
      },
      { retries: 3, baseMs: 10, maxMs: 500, sleep: async (ms) => void delays.push(ms), random: () => 0 },
    );
    expect(delays).toEqual([500, 500]);
  });
  it("classifies errors", () => {
    expect(isRetryable(new HttpError("x", 429))).toBe(true);
    expect(isRetryable(new HttpError("x", 502))).toBe(true);
    expect(isRetryable(new HttpError("x", 404))).toBe(false);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });
});

const GH_LIST = {
  jobs: [
    {
      id: 4001,
      title: "Senior Java Engineer",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/4001?gh_src=x",
      location: { name: "Remote - Worldwide" },
      updated_at: "2026-10-10T10:00:00-04:00",
      first_published: "2026-10-01T10:00:00-04:00",
      company_name: "Acme Corp",
      departments: [{ name: "Engineering" }],
      content: "&lt;p&gt;&lt;strong&gt;Requirements&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Java &amp;amp; Spring Boot&lt;/li&gt;&lt;/ul&gt;",
    },
    { id: 4002, title: "Account Executive", absolute_url: "https://boards.greenhouse.io/acme/jobs/4002", location: { name: "New York" }, updated_at: "2026-10-09T10:00:00-04:00", content: "&lt;p&gt;Sell things&lt;/p&gt;" },
  ],
  meta: { total: 2 },
};

describe("greenhouse adapter", () => {
  it("requests the documented public board endpoint and normalises jobs", async () => {
    const calls: string[] = [];
    const f = (async (url: any) => {
      calls.push(String(url));
      return jsonResponse(GH_LIST);
    }) as typeof fetch;
    const cfg = greenhouseAdapter.configSchema.parse({ boardToken: "acme" });
    const res = await greenhouseAdapter.fetchJobs(cfg, ctxWith(f));
    expect(calls[0]).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    expect(res.complete).toBe(true);
    expect(res.totalListed).toBe(2);
    expect(res.jobs).toHaveLength(2);
    const j = NormalizedJobInputSchema.parse(res.jobs[0]);
    expect(j).toMatchObject({ sourceKind: "greenhouse", sourceKey: "greenhouse:acme", sourceJobId: "4001", company: "Acme Corp", locationRaw: "Remote - Worldwide" });
    expect(j.descriptionText).toContain("- Java & Spring Boot");
    expect(j.postedAt).toBe("2026-10-01T14:00:00.000Z");
  });
  it("rejects hostile board tokens (no SSRF through config)", () => {
    expect(() => greenhouseAdapter.configSchema.parse({ boardToken: "acme/../../x" })).toThrow();
    expect(() => greenhouseAdapter.configSchema.parse({ boardToken: "http://evil" })).toThrow();
  });
  it("marks the result incomplete and throws a typed error on malformed payloads", async () => {
    const f = (async () => jsonResponse({ nope: true })) as typeof fetch;
    await expect(greenhouseAdapter.fetchJobs(greenhouseAdapter.configSchema.parse({ boardToken: "acme" }), ctxWith(f))).rejects.toThrow(/unexpected response/i);
  });
  it("skips jobs that fail validation but keeps the rest", async () => {
    const f = (async () => jsonResponse({ jobs: [{ id: 1, title: "", absolute_url: "javascript:alert(1)" }, GH_LIST.jobs[0]] })) as typeof fetch;
    const res = await greenhouseAdapter.fetchJobs(greenhouseAdapter.configSchema.parse({ boardToken: "acme" }), ctxWith(f));
    expect(res.jobs).toHaveLength(1);
    expect(res.notes.join(" ")).toMatch(/skipped 1/i);
  });
  it("verifyJob: 200 = open, 404 = closed, 500 = unknown", async () => {
    const cfg = greenhouseAdapter.configSchema.parse({ boardToken: "acme" });
    const mk = (status: number) => ctxWith((async () => new Response("{}", { status })) as typeof fetch);
    expect((await greenhouseAdapter.verifyJob!(cfg, "4001", mk(200))).open).toBe(true);
    expect((await greenhouseAdapter.verifyJob!(cfg, "4001", mk(404))).open).toBe(false);
    expect((await greenhouseAdapter.verifyJob!(cfg, "4001", mk(500))).open).toBeNull();
  });
});

const LEVER = [
  {
    id: "abc-123",
    text: "Backend Engineer (Java)",
    categories: { commitment: "Full-time", department: "Eng", location: "Remote", team: "Platform", allLocations: ["Remote"] },
    createdAt: 1790000000000,
    hostedUrl: "https://jobs.lever.co/acme/abc-123",
    applyUrl: "https://jobs.lever.co/acme/abc-123/apply",
    workplaceType: "remote",
    descriptionPlain: "Build services.",
    lists: [{ text: "Requirements", content: "<li>Java</li><li>Spring Boot</li>" }],
    additionalPlain: "Salary: $90,000 - $120,000 per year",
    salaryRange: { currency: "USD", interval: "per-year-salary", min: 90000, max: 120000 },
  },
];

describe("lever adapter", () => {
  it("requests the documented postings endpoint and normalises", async () => {
    const calls: string[] = [];
    const f = (async (u: any) => (calls.push(String(u)), jsonResponse(LEVER))) as typeof fetch;
    const cfg = leverAdapter.configSchema.parse({ site: "acme", companyName: "Acme" });
    const res = await leverAdapter.fetchJobs(cfg, ctxWith(f));
    expect(calls[0]).toBe("https://api.lever.co/v0/postings/acme?mode=json");
    const j = NormalizedJobInputSchema.parse(res.jobs[0]);
    expect(j).toMatchObject({ sourceKind: "lever", sourceKey: "lever:acme", sourceJobId: "abc-123", company: "Acme", workModeHint: "remote", employmentTypeHint: "Full-time" });
    expect(j.salary).toMatchObject({ min: 90000, max: 120000, currency: "USD", period: "year" });
    expect(j.descriptionText).toMatch(/Requirements\n- Java\n- Spring Boot/);
    expect(j.applyUrl).toBe("https://jobs.lever.co/acme/abc-123");
  });
  it("uses the EU endpoint when configured", async () => {
    const calls: string[] = [];
    const f = (async (u: any) => (calls.push(String(u)), jsonResponse([]))) as typeof fetch;
    await leverAdapter.fetchJobs(leverAdapter.configSchema.parse({ site: "acme", region: "eu" }), ctxWith(f));
    expect(calls[0]).toBe("https://api.eu.lever.co/v0/postings/acme?mode=json");
  });
  it("rejects non-array payloads", async () => {
    const f = (async () => jsonResponse({ ok: false })) as typeof fetch;
    await expect(leverAdapter.fetchJobs(leverAdapter.configSchema.parse({ site: "acme" }), ctxWith(f))).rejects.toThrow(/unexpected response/i);
  });
});
