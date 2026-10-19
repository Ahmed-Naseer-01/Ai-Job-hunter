import { describe, it, expect } from "vitest";
import { canonicalizeUrl } from "@/lib/dedupe/url";
import { classifyPair, normalizeCompany, type DedupeView } from "@/lib/dedupe/similarity";

describe("canonicalizeUrl", () => {
  it("strips tracking params, fragments, www, trailing slash and sorts params", () => {
    const a = canonicalizeUrl("https://www.Example.com/jobs/123/?utm_source=x&gh_src=abc&b=2&a=1#apply");
    const b = canonicalizeUrl("http://example.com/jobs/123?a=1&b=2");
    expect(a).toBe(b);
    expect(a).toBe("https://example.com/jobs/123?a=1&b=2");
  });
  it("keeps meaningful params such as gh_jid", () => {
    expect(canonicalizeUrl("https://boards.greenhouse.io/acme/jobs/1?gh_jid=1&utm_medium=x")).toContain("gh_jid=1");
  });
  it("does not throw on garbage", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

const DESC = "We are looking for a Java engineer to build Spring Boot microservices. You will design REST APIs, work with MySQL, deploy with Docker and own production services end to end. ".repeat(4);
const job = (over: Partial<DedupeView> = {}): DedupeView => ({
  company: "Acme Inc.", title: "Java Backend Engineer", locationRaw: "Remote - Worldwide", description: DESC, canonicalUrl: "https://acme.com/jobs/1", ...over,
});

describe("normalizeCompany", () => {
  it("ignores legal suffixes and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe(normalizeCompany("ACME"));
    expect(normalizeCompany("Foo Technologies Ltd")).toBe(normalizeCompany("foo technologies"));
  });
});

describe("classifyPair", () => {
  it("same canonical URL is a duplicate", () => {
    expect(classifyPair(job(), job({ title: "Totally different", description: "x" })).verdict).toBe("duplicate");
  });
  it("cross-posted job (same company/title/location/description, different URL) is a duplicate", () => {
    const r = classifyPair(job(), job({ canonicalUrl: "https://board.example/xyz" }));
    expect(r.verdict).toBe("duplicate");
  });
  it("small title variation + similar description is flagged for human review, not auto-merged", () => {
    const r = classifyPair(job(), job({ canonicalUrl: "https://other/1", title: "Java Backend Developer", description: DESC.slice(0, 380) + " Different closing paragraph about perks and benefits and team culture and offices." }));
    expect(["review", "duplicate"]).toContain(r.verdict);
  });
  it("same role in a different location is distinct", () => {
    expect(classifyPair(job(), job({ canonicalUrl: "https://acme.com/jobs/2", locationRaw: "Berlin, Germany" })).verdict).toBe("distinct");
  });
  it("different companies are distinct even with identical text", () => {
    expect(classifyPair(job(), job({ canonicalUrl: "https://x/1", company: "Globex" })).verdict).toBe("distinct");
  });
  it("different titles are distinct", () => {
    expect(classifyPair(job(), job({ canonicalUrl: "https://x/1", title: "Sales Manager" })).verdict).toBe("distinct");
  });
  it("same title/location but empty description needs review rather than a silent merge", () => {
    expect(classifyPair(job(), job({ canonicalUrl: "https://x/1", description: "" })).verdict).toBe("review");
  });
});
