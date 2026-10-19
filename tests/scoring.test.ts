import { describe, it, expect } from "vitest";
import { enrichJob } from "@/lib/jobs/enrich";
import { scoreJob } from "@/lib/matching/score";
import { evaluateEligibility } from "@/lib/matching/eligibility";
import { DEFAULT_PROFILE } from "@/lib/config/defaultProfile";
import { DEFAULT_SETTINGS, type Profile } from "@/lib/config/schema";
import type { NormalizedJobInput } from "@/lib/jobs/types";

const NOW = new Date("2026-10-19T00:00:00Z");

function run(input: Partial<NormalizedJobInput> & { title: string; descriptionText: string }, profile: Profile = DEFAULT_PROFILE, settings = DEFAULT_SETTINGS) {
  const job = enrichJob(
    { sourceKey: "t", sourceKind: "greenhouse", sourceJobId: "1", company: "Acme", applyUrl: "https://example.com/j/1", locationRaw: "Remote - Worldwide", ...input },
    NOW,
  );
  const elig = evaluateEligibility(job, profile, settings.search);
  return { job, elig, result: scoreJob(job, elig, profile, settings) };
}

const IDEAL = `
About the role
Join our telecom payments platform team building Spring Boot microservices that process high-throughput recharge transactions.

Requirements
- 2-4 years of experience with Java and Spring Boot
- Experience with REST APIs and third-party integrations
- Strong knowledge of MySQL and SQL, Spring Data JPA / Hibernate
- Docker, Maven, Linux and CI/CD pipelines
- JUnit and Mockito for unit testing
- Experience troubleshooting production issues

Nice to have
- Elasticsearch
- Experience migrating legacy Java 8 services to Java 21
`;

describe("scoreJob: strong match", () => {
  const { result } = run({ title: "Java Backend Engineer", descriptionText: IDEAL });
  it("lands in the high-priority band", () => {
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.band).toBe("high");
    expect(result.actionable).toBe(true);
  });
  it("explains the fit with resume achievements and met requirements", () => {
    const ex = result.explanation;
    expect(ex.relevantAchievements.map((a) => a.id)).toEqual(expect.arrayContaining(["platform"]));
    expect(ex.metRequirements.join(" ")).toMatch(/Spring Boot/);
    expect(ex.verdict).toBe("Worth applying");
    expect(ex.eligibilityNote).toMatch(/Worldwide|worldwide/);
  });
  it("surfaces the Java 8->21 migration differentiator when the job is about modernization", () => {
    const m = run({ title: "Java Backend Engineer", descriptionText: IDEAL + "\nYou will migrate legacy Java 8 services to Java 21." });
    expect(m.result.explanation.relevantAchievements.map((a) => a.id)).toContain("migration");
    expect(m.result.explanation.emphasize.join(" ")).toMatch(/Java 8/);
  });
  it("has a breakdown whose applied weights are renormalised to 100", () => {
    const applied = result.breakdown.filter((b) => b.score !== null).reduce((s, b) => s + b.appliedWeight, 0);
    expect(applied).toBeCloseTo(100, 5);
  });
});

describe("scoreJob: eligibility is separate from technical fit", () => {
  it("an excellent job restricted to the US is not actionable and not high priority", () => {
    const { result } = run({ title: "Java Backend Engineer", descriptionText: IDEAL, locationRaw: "Remote - US" });
    expect(result.technicalScore).toBeGreaterThanOrEqual(85);
    expect(result.score).toBeLessThanOrEqual(69);
    expect(result.actionable).toBe(false);
    expect(result.eligibility).toBe("ineligible");
  });
  it("preference-excluded roles are not actionable", () => {
    const { result } = run({ title: "Java Backend Engineer", descriptionText: IDEAL, locationRaw: "Lahore, Pakistan", workModeHint: "onsite" });
    expect(result.actionable).toBe(false);
    expect(result.explanation.eligibilityNote).toMatch(/on-site/i);
  });
});

describe("scoreJob: caps and unverified skills", () => {
  it("never marks unverified technologies as met and caps heavy gaps", () => {
    const { result } = run({
      title: "Java Backend Engineer",
      descriptionText: `Requirements\n- 3+ years Java and Spring Boot\n- Kafka\n- Kubernetes\n- Redis\n- GraphQL\n- Terraform`,
    });
    const missing = result.skillMatches.filter((s) => s.required && s.status === "missing").map((s) => s.id);
    expect(missing).toEqual(expect.arrayContaining(["kafka", "redis", "graphql", "terraform"]));
    expect(result.skillMatches.find((s) => s.id === "kubernetes")!.status).toBe("transferable"); // via Docker, still unverified
    expect(result.explanation.unverified.join(" ")).toMatch(/Kafka/);
    expect(result.score).toBeLessThanOrEqual(64);
  });
  it("records the cap when missing mandatory skills actually bind the score", () => {
    const { result } = run({ title: "Java Backend Engineer", descriptionText: IDEAL.replace("Requirements\n", "Requirements\n- Kafka\n- Redis\n") });
    expect(result.score).toBeLessThanOrEqual(79);
    expect(result.capsApplied.join(" ")).toMatch(/missing 2 mandatory skills/i);
  });
  it("does not invent Kubernetes/Kafka as familiar skills", () => {
    const ids = DEFAULT_PROFILE.skills.map((s) => s.id);
    for (const bad of ["kubernetes", "kafka", "redis", "graphql"]) expect(ids).not.toContain(bad);
  });
  it("caps non-Java stacks at 'review manually'", () => {
    const { result } = run({ title: "Backend Engineer", descriptionText: `Requirements\n- 3 years of Go\n- gRPC and PostgreSQL\n- Docker` });
    expect(result.score).toBeLessThanOrEqual(64);
  });
  it("caps staff/principal/manager titles", () => {
    expect(run({ title: "Staff Java Engineer", descriptionText: IDEAL }).result.score).toBeLessThanOrEqual(59);
    expect(run({ title: "Engineering Manager, Java Platform", descriptionText: IDEAL }).result.score).toBeLessThanOrEqual(59);
  });
  it("treats a reasonable stretch (5 years) as a Good match at most, not a rejection", () => {
    const { result } = run({ title: "Java Software Engineer", descriptionText: IDEAL.replace("2-4 years", "5+ years") });
    expect(result.score).toBeLessThanOrEqual(79);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });
  it("ignores generic terms mentioned outside requirements", () => {
    const { job } = run({ title: "Operations Associate", descriptionText: "Requirements\n- Excel skills\n\nAbout us\nWe are a Java and Spring Boot shop with microservices everywhere." });
    expect(job.requiredSkills.map((s) => s.id)).not.toContain("java");
  });
});

describe("scoreJob: incomplete data", () => {
  it("lowers confidence and caps score when the description is thin", () => {
    const { result } = run({ title: "Java Developer", descriptionText: "Great job. Apply now." });
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.score).toBeLessThanOrEqual(69);
    expect(result.confidenceLabel).toBe("low");
  });
  it("missing salary is neither penalised nor invented", () => {
    const { job, result } = run({ title: "Java Backend Engineer", descriptionText: IDEAL });
    expect(job.salaryMin).toBeNull();
    const prefs = result.breakdown.find((b) => b.key === "preferences")!;
    expect(prefs.notes.join(" ")).toMatch(/salary not published/i);
  });
  it("compares published salary with expectations when currencies match", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, salary: { min: 100000, currency: "USD", period: "year" } };
    const lo = run({ title: "Java Backend Engineer", descriptionText: IDEAL + "\nSalary: $40,000 - $50,000 per year" }, profile).result;
    const hi = run({ title: "Java Backend Engineer", descriptionText: IDEAL + "\nSalary: $110,000 - $140,000 per year" }, profile).result;
    expect(hi.score).toBeGreaterThan(lo.score);
  });
  it("categories that cannot be assessed are excluded and weights renormalised", () => {
    const { result } = run({ title: "Software Engineer", descriptionText: "Requirements\n- Java\n- Spring Boot\n" + "x ".repeat(500) });
    const unassessed = result.breakdown.filter((b) => b.score === null).map((b) => b.key);
    expect(unassessed).toEqual(expect.arrayContaining(["dataApi", "opsTooling"]));
    const applied = result.breakdown.filter((b) => b.score !== null).reduce((s, b) => s + b.appliedWeight, 0);
    expect(applied).toBeCloseTo(100, 5);
  });
});

describe("scoreJob: editable weights and bands", () => {
  it("responds to weight changes", () => {
    const base = run({ title: "Java Backend Engineer", descriptionText: IDEAL, locationRaw: "Remote" });
    const heavyElig: Profile = { ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, eligibility: 60 } };
    const changed = run({ title: "Java Backend Engineer", descriptionText: IDEAL, locationRaw: "Remote" }, heavyElig);
    expect(changed.result.score).toBeLessThan(base.result.score); // 'potential' eligibility is only half credit
  });
  it("respects custom band thresholds", () => {
    const s = { ...DEFAULT_SETTINGS, scoring: { bands: { high: 101, good: 99, review: 90 } } };
    const { result } = run({ title: "Java Backend Engineer", descriptionText: IDEAL }, DEFAULT_PROFILE, s);
    expect(result.band).not.toBe("high");
  });
  it("is deterministic", () => {
    const a = run({ title: "Java Backend Engineer", descriptionText: IDEAL }).result;
    const b = run({ title: "Java Backend Engineer", descriptionText: IDEAL }).result;
    expect(a).toEqual(b);
  });
});
