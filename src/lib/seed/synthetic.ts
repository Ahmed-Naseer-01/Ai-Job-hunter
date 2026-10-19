import type { NormalizedJobInput } from "../jobs/types";

const NOTE = "[SYNTHETIC SAMPLE — not a real job posting. Seeded so the dashboard works without credentials.]\n\n";
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const base = (id: string, o: Partial<NormalizedJobInput> & { title: string; company: string; descriptionText: string }): NormalizedJobInput => ({
  sourceKey: "synthetic:demo",
  sourceKind: "synthetic",
  sourceJobId: id,
  applyUrl: `https://example.com/synthetic/jobs/${id}`,
  locationRaw: "Remote - Worldwide",
  postedAt: day(2),
  isSynthetic: true,
  ...o,
  descriptionText: NOTE + o.descriptionText,
});

/** Clearly-labelled sample jobs covering every eligibility/score situation the UI needs to demonstrate. */
export function syntheticJobs(): NormalizedJobInput[] {
  return [
    base("s01", {
      title: "Java Backend Engineer", company: "Synthetic Telecom Co.", postedAt: day(1),
      descriptionText: `About the role\nBuild Spring Boot microservices powering mobile top-up and airtime recharge for telecom operators.\n\nRequirements\n- 2-4 years of experience with Java and Spring Boot\n- REST APIs, third-party integrations, MySQL and SQL, Spring Data JPA / Hibernate\n- Docker, Maven, Linux and CI/CD pipelines\n- JUnit and Mockito; production troubleshooting\n\nNice to have\n- Elasticsearch\n- Experience migrating legacy Java 8 services to Java 21\n\nSalary: USD 60,000 - 85,000 per year. We hire anywhere in the world.`,
    }),
    base("s02", {
      title: "Spring Boot Developer", company: "Synthetic Payments Ltd", postedAt: day(3),
      descriptionText: `Requirements\n- 3+ years of Java and Spring Boot microservices\n- SQL databases, REST APIs, Docker\n- Unit testing with JUnit\n\nNice to have\n- Kubernetes\n\nThis is a remote role open to candidates in Pakistan, India and the UAE.`,
      locationRaw: "Remote - Pakistan, India, UAE",
    }),
    base("s03", {
      title: "Senior Java Engineer", company: "Synthetic Cloud Inc", locationRaw: "Remote - US",
      descriptionText: `Requirements\n- 5+ years of Java and Spring Boot\n- Microservices, Kafka, Kubernetes, AWS\n- You must be authorized to work in the United States without sponsorship.`,
    }),
    base("s04", {
      title: "Java Software Engineer", company: "Synthetic Banking GmbH", locationRaw: "Berlin, Germany", workModeHint: "onsite",
      descriptionText: `Requirements\n- 2+ years of Java, Spring Boot, SQL\n- On-site in Berlin. No visa sponsorship available.`,
    }),
    base("s05", {
      title: "Backend Software Engineer", company: "Synthetic Logistics", locationRaw: "Lahore, Pakistan", workModeHint: "hybrid",
      descriptionText: `Requirements\n- 1-3 years of Java or Python backend development\n- REST APIs, PostgreSQL, Docker\nHybrid: 3 days per week in our Lahore office.`,
    }),
    base("s06", {
      title: "Staff Software Engineer, Java Platform", company: "Synthetic Scale Corp",
      descriptionText: `Requirements\n- 10+ years building distributed systems in Java\n- Kafka, Kubernetes, Terraform\n- Technical leadership across teams`,
    }),
    base("s07", {
      title: "Microservices Engineer", company: "Synthetic Streaming", locationRaw: "Remote",
      descriptionText: `Requirements\n- 3 years of experience with Java, Spring Boot and microservices\n- Kafka, Redis, GraphQL\n- Docker and Kubernetes in production\n\nNice to have\n- AWS`,
    }),
    base("s08", {
      title: "Backend Engineer (Python)", company: "Synthetic Data Labs",
      descriptionText: `Requirements\n- 2+ years of Python and Django\n- PostgreSQL, Docker, REST APIs\n\nNice to have\n- Java`,
    }),
    base("s09", {
      title: "Java Developer (6-month contract)", company: "Synthetic Staffing", employmentTypeHint: "Contract",
      descriptionText: `Requirements\n- 2+ years Java, Spring Boot, MySQL\n- REST API development\nThis is a 6-month contract role.`,
    }),
    base("s10", {
      title: "Java Engineering Intern", company: "Synthetic Startups", employmentTypeHint: "Internship",
      descriptionText: `Requirements\n- Knowledge of Java\n- Eager to learn Spring Boot\nSummer internship program.`,
    }),
    base("s11", {
      title: "Java Developer", company: "Synthetic Mystery Co", locationRaw: null, postedAt: null,
      descriptionText: `Great opportunity. Apply now.`,
    }),
    base("s12", {
      title: "Integration Engineer", company: "Synthetic Telecom Co.", postedAt: day(5),
      descriptionText: `About the role\nIntegrate telecom operator systems with third-party APIs (SOAP and REST, XML/JSON).\n\nRequirements\n- 2+ years of experience with Java and Spring\n- SOAP, XML, JSON and REST\n- MySQL or Oracle; Linux\n- Experience with transaction processing and production support\n\nCompensation: EUR 45,000 - 60,000 per year.`,
    }),
    base("s13", {
      title: "Java Backend Engineer - Migration", company: "Synthetic Legacy Systems", postedAt: day(4),
      descriptionText: `About the role\nYou will lead the migration of legacy Java 8 services to Java 21 across a large microservices estate.\n\nRequirements\n- 2-3 years of experience with Java, Spring Boot, Maven\n- Docker and CI/CD (Jenkins or Bamboo)\n- Strong debugging and unit testing (JUnit)\n- MySQL / SQL\n\nTime zone: you must overlap with US Eastern working hours.`,
    }),
    base("s14", {
      title: "Backend Engineer", company: "Synthetic Remote Co", locationRaw: "Remote",
      descriptionText: `Requirements\n- 2+ years of backend experience in any JVM language (Java preferred)\n- REST APIs, SQL, Docker\n\nWe are fully distributed and hire anywhere in the world.`,
    }),
    // A cross-posted duplicate pair: same company/title/location/description via a different URL => auto-merged by the pipeline.
    base("s15", {
      title: "Java Backend Engineer", company: "Synthetic Telecom Co.", postedAt: day(1),
      applyUrl: "https://example.com/synthetic/board2/java-backend-engineer",
      descriptionText: `About the role\nBuild Spring Boot microservices powering mobile top-up and airtime recharge for telecom operators.\n\nRequirements\n- 2-4 years of experience with Java and Spring Boot\n- REST APIs, third-party integrations, MySQL and SQL, Spring Data JPA / Hibernate\n- Docker, Maven, Linux and CI/CD pipelines\n- JUnit and Mockito; production troubleshooting\n\nNice to have\n- Elasticsearch\n- Experience migrating legacy Java 8 services to Java 21\n\nSalary: USD 60,000 - 85,000 per year. We hire anywhere in the world.`,
    }),
  ];
}
