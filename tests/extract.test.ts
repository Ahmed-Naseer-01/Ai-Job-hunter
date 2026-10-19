import { describe, it, expect } from "vitest";
import { htmlToText } from "@/lib/extract/text";
import { extractSkills } from "@/lib/extract/skills";
import { extractYears } from "@/lib/extract/years";
import { extractSalary } from "@/lib/extract/salary";
import { detectWorkMode, detectSeniority, detectEmploymentType } from "@/lib/extract/classify";
import { extractDomains, detectModernization } from "@/lib/extract/domain";

const JD = `
About the role
We are building a payments platform. You will work on Spring Boot microservices.

Requirements
- 3+ years of experience with Java and Spring Boot
- Experience with REST APIs and MySQL or PostgreSQL
- Kubernetes experience in production
- Strong knowledge of JUnit and Mockito

Nice to have
- Experience with Kafka
- Docker and CI/CD pipelines

About us
We love JavaScript conferences and free snacks.
`;

describe("htmlToText", () => {
  it("decodes entity-encoded HTML (Greenhouse style) and keeps list structure", () => {
    const encoded = "&lt;p&gt;&lt;strong&gt;Requirements&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Java &amp;amp; Spring&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;";
    const t = htmlToText(encoded);
    expect(t).toContain("Requirements");
    expect(t).toContain("- Java & Spring");
    expect(t).toContain("- SQL");
    expect(t).not.toContain("<");
  });
  it("strips scripts and never returns markup", () => {
    expect(htmlToText("<p>Hi</p><script>alert(1)</script><style>x{}</style>")).toBe("Hi");
  });
});

describe("extractSkills", () => {
  const r = extractSkills(JD, "Backend Engineer");
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("classifies required vs preferred by section", () => {
    expect(ids(r.required)).toEqual(expect.arrayContaining(["java", "spring-boot", "rest", "mysql", "postgresql", "kubernetes", "junit", "mockito"]));
    expect(ids(r.preferred)).toEqual(expect.arrayContaining(["kafka", "docker", "ci-cd"]));
    expect(ids(r.required)).not.toContain("kafka");
  });
  it("does not treat JavaScript as Java, nor 'about us' mentions as requirements", () => {
    expect(ids(r.required)).not.toContain("javascript");
    expect(ids(r.mentioned)).not.toContain("java");
    const only = extractSkills("We use JavaScript every day.", "Engineer");
    expect(ids([...only.required, ...only.preferred, ...only.mentioned])).not.toContain("java");
  });
  it("carries evidence text", () => {
    const k = r.required.find((s) => s.id === "kubernetes")!;
    expect(k.evidence).toMatch(/Kubernetes/);
  });
  it("does not count NoSQL as SQL", () => {
    const x = extractSkills("Requirements\n- Experience with NoSQL databases like MongoDB", "Engineer");
    expect(ids(x.required)).toContain("mongodb");
    expect(ids(x.required)).not.toContain("sql");
  });
  it("treats spring as java", () => {
    const x = extractSkills("Requirements\n- Spring Boot", "Engineer");
    expect(ids(x.required)).toContain("spring-boot");
  });
});

describe("extractYears", () => {
  it("reads minimum years from required context", () => {
    expect(extractYears(JD).min).toBe(3);
  });
  it("handles ranges and 'at least'", () => {
    expect(extractYears("Requirements\n- 2-4 years of backend experience").min).toBe(2);
    expect(extractYears("Requirements\n- At least 5 years of professional experience").min).toBe(5);
    expect(extractYears("Requirements\n- Minimum of 7 years experience").min).toBe(7);
  });
  it("returns unknown (null) rather than guessing", () => {
    expect(extractYears("We build things. Join us.").min).toBeNull();
  });
  it("puts preferred years under preferred", () => {
    const y = extractYears("Requirements\n- 2+ years Java\nNice to have\n- 5+ years leading teams");
    expect(y.min).toBe(2);
    expect(y.preferred).toBe(5);
  });
});

describe("extractSalary", () => {
  it("parses published ranges", () => {
    expect(extractSalary("Salary: $120,000 - $150,000 per year")).toMatchObject({ min: 120000, max: 150000, currency: "USD" });
    expect(extractSalary("Compensation range: €60k–€80k")).toMatchObject({ min: 60000, max: 80000, currency: "EUR" });
    expect(extractSalary("PKR 400,000 - 600,000 per month")).toMatchObject({ min: 400000, max: 600000, currency: "PKR", period: "month" });
  });
  it("keeps salary unknown when not published", () => {
    expect(extractSalary("Competitive salary and great benefits. 401k match up to 5%")).toBeNull();
  });
});

describe("classification", () => {
  it("detects work mode", () => {
    expect(detectWorkMode("Remote - Worldwide", "")).toMatchObject({ value: "remote", source: "published" });
    expect(detectWorkMode("Lahore, Pakistan", "This is a hybrid role, 3 days in office")).toMatchObject({ value: "hybrid" });
    expect(detectWorkMode("Berlin", "")).toMatchObject({ value: "unknown" });
  });
  it("detects seniority from the title only", () => {
    expect(detectSeniority("Senior Backend Engineer")).toBe("senior");
    expect(detectSeniority("Staff Software Engineer")).toBe("staff");
    expect(detectSeniority("Engineering Manager")).toBe("manager");
    expect(detectSeniority("Junior Java Developer")).toBe("junior");
    expect(detectSeniority("Software Engineer")).toBe("unspecified");
    expect(detectSeniority("Software Engineer II")).toBe("mid");
    expect(detectSeniority("Solutions Architect")).toBe("architect");
  });
  it("detects employment type", () => {
    expect(detectEmploymentType("Full-time", "")).toBe("full_time");
    expect(detectEmploymentType(undefined, "This is a 6-month contract role")).toBe("contract");
    expect(detectEmploymentType(undefined, "Summer internship program")).toBe("internship");
    expect(detectEmploymentType(undefined, "Build great things")).toBe("unknown");
  });
});

describe("domain + modernization", () => {
  it("finds telecom/payments domains", () => {
    expect(extractDomains("We build mobile top-up and airtime recharge for telecom operators")).toEqual(expect.arrayContaining(["telecom"]));
    expect(extractDomains("Payment gateway and transaction processing at high throughput")).toEqual(expect.arrayContaining(["payments", "transaction-processing"]));
    expect(extractDomains("We sell shoes")).toEqual([]);
  });
  it("detects Java modernization work", () => {
    expect(detectModernization("Migrate legacy Java 8 services to Java 17")).toBe(true);
    expect(detectModernization("Write Java services")).toBe(false);
  });
});
