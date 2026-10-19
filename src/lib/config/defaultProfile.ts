import { DEFAULT_WEIGHTS, type Profile } from "./schema";

/**
 * Verified profile for Muhammad Ahmed Naseer — the source of truth for matching.
 * Anything not listed in `skills` is treated as UNVERIFIED (never assumed).
 * Levels: strong = core daily skills, working = used in projects/prior roles, familiar = exposure only.
 */
export const DEFAULT_PROFILE: Profile = {
  name: "Muhammad Ahmed Naseer",
  email: "ahmed.naseer.contact@gmail.com",
  location: "Lahore, Pakistan",
  countryOfResidence: "Pakistan",
  currentTitle: "Software Engineer",
  yearsExperience: 2,
  summary:
    "Java backend engineer with 2+ years on Spring Boot microservices inside a 100+ service telecom recharge platform. Ships features and change requests for operators across Africa, South Asia, and the Middle East, taking work from requirement analysis through deployment and production support.",
  resumeText: `Muhammad Ahmed Naseer — Java Backend Engineer | Spring Boot · Microservices
Lahore, Pakistan

Seamless Distribution Systems — Software Engineer (Nov 2024 – Present)
- Build and maintain Spring Boot microservices in a 100+ service electronic recharge platform running at 35–40 TPS for Ooredoo Algeria, Sudani Sudan, Telenor Pakistan, Ufone (CBS), MTN Afghanistan, and AsiaCell Iraq.
- Deliver client Change Requests and production defect fixes across these accounts, covering requirement analysis, development, and release.
- Led the migration of 10+ production services from Java 8 to Java 21, replacing deprecated APIs and resolving compatibility breaks.
- Package services with Docker and run Bamboo pipelines that build RPMs for Linux deployment.
- Wrote cron-driven aggregation jobs that replaced a recurring manual reconciliation process.
- Cover new service logic with JUnit and Mockito tests, and trace live incidents through application logs and SQL.

Electronic Recharge System (ERS) – AsiaCell Iraq (Oct 2025 – Present, engagement within the same employment)
- National reseller platform for Top-Up, Bundle, and Airtime Stock/Transfer operations.
- Deliver features across Dealer Management, Contract Management, Product Management, Batch Scheduling, and USSD services, integrating internal and third-party APIs.
- Build REST APIs with Spring Data JPA over MySQL, including transactional logic for recharge workflows.
- Write Elasticsearch queries feeding the BI Aggregator and operational reporting.
- Diagnose live transaction issues alongside operations and support teams.

Arbisoft — Full Stack Apprentice (Aug 2023 – Oct 2023): Django / DRF backend services and authentication; Scrapy data extraction.
Data Science Lab, PIEAS — Student Researcher (Sep 2023 – Jul 2024): fine-tuned Stable Diffusion in PyTorch for textile design generation; demo app for designers.
Education: BS Computer and Information Sciences, PIEAS (CGPA 3.33/4.00), graduated July 2024.
Project: Expense Reimbursement System (Spring Boot, Spring Security, MySQL, Docker).`,
  preferredTitles: [
    "Java Backend Engineer",
    "Java Software Engineer",
    "Spring Boot Developer",
    "Backend Software Engineer",
    "Microservices Engineer",
    "Java API Engineer",
    "Software Engineer - Java",
    "Backend Platform Engineer",
    "Integration Engineer",
    "Full-Stack Engineer",
  ],
  skills: [
    // strongest
    { id: "java", level: "strong", note: "Java 8 and Java 21; led 10+ service migration" },
    { id: "spring-boot", level: "strong" },
    { id: "spring", level: "strong", note: "Spring MVC / Core" },
    { id: "spring-data-jpa", level: "strong" },
    { id: "hibernate", level: "strong" },
    { id: "rest", level: "strong" },
    { id: "microservices", level: "strong", note: "100+ service platform" },
    { id: "mysql", level: "strong" },
    { id: "sql", level: "strong" },
    { id: "elasticsearch", level: "strong" },
    { id: "docker", level: "strong" },
    { id: "maven", level: "strong" },
    { id: "git", level: "strong" },
    { id: "bitbucket", level: "strong" },
    { id: "bamboo", level: "strong" },
    { id: "ci-cd", level: "strong" },
    { id: "linux", level: "strong" },
    { id: "junit", level: "strong" },
    { id: "mockito", level: "strong" },
    { id: "unit-testing", level: "strong" },
    { id: "production-support", level: "strong" },
    { id: "transaction-management", level: "strong" },
    { id: "soap", level: "strong" },
    { id: "xml", level: "strong" },
    { id: "json", level: "strong" },
    { id: "api-integration", level: "strong" },
    { id: "distributed-systems", level: "strong" },
    { id: "multithreading", level: "strong" },
    { id: "query-optimization", level: "working" },
    { id: "spring-security", level: "working", note: "Expense Reimbursement System" },
    { id: "mariadb", level: "working" },
    { id: "sqlite", level: "working" },
    // additional
    { id: "python", level: "working" },
    { id: "django", level: "working" },
    { id: "flask", level: "working" },
    { id: "pytorch", level: "working" },
    { id: "scikit-learn", level: "working" },
    { id: "pandas", level: "working" },
    { id: "numpy", level: "working" },
    { id: "stable-diffusion", level: "working" },
    { id: "scrapy", level: "working" },
    { id: "cpp", level: "working", note: "C / C++" },
    // familiar rather than expert
    { id: "aws", level: "familiar" },
    { id: "react", level: "familiar" },
    { id: "javascript", level: "familiar" },
    { id: "bootstrap", level: "familiar" },
  ],
  experience: [
    {
      company: "Seamless Distribution Systems",
      title: "Software Engineer",
      start: "2024-11",
      end: null,
      withinEmployment: false,
      highlights: [
        "Spring Boot microservices in a 100+ service recharge platform at 35–40 TPS",
        "Led migration of 10+ production services from Java 8 to Java 21",
        "Docker packaging and Bamboo pipelines building RPMs for Linux deployment",
      ],
    },
    {
      company: "Seamless Distribution Systems — ERS, AsiaCell Iraq engagement",
      title: "Software Engineer",
      start: "2025-10",
      end: null,
      withinEmployment: true,
      highlights: ["Dealer, Contract, Product, Batch Scheduling and USSD services", "REST APIs with Spring Data JPA over MySQL", "Elasticsearch queries for BI aggregation"],
    },
    { company: "Arbisoft", title: "Full Stack Apprentice", start: "2023-08", end: "2023-10", withinEmployment: false, highlights: ["Django/DRF backend and authentication", "Scrapy data extraction"] },
    { company: "Data Science Lab, PIEAS", title: "Student Researcher", start: "2023-09", end: "2024-07", withinEmployment: false, highlights: ["Fine-tuned Stable Diffusion with PyTorch", "Demo app for non-technical designers"] },
  ],
  achievements: [
    { id: "migration", text: "Led the migration of 10+ production services from Java 8 to Java 21, replacing deprecated APIs and resolving compatibility breaks.", tags: ["java", "java-modernization", "maven"] },
    { id: "platform", text: "Build and maintain Spring Boot microservices in a 100+ service electronic recharge platform running at 35–40 TPS.", tags: ["spring-boot", "microservices", "distributed-systems", "transaction-processing", "telecom", "payments"] },
    { id: "cr", text: "Deliver client change requests and production fixes for telecom operators across Africa, South Asia and the Middle East — from requirement analysis through release.", tags: ["production-support", "api-integration", "telecom"] },
    { id: "devops", text: "Package services with Docker and run Bamboo pipelines that build RPMs for Linux deployment.", tags: ["docker", "bamboo", "ci-cd", "linux"] },
    { id: "jobs", text: "Wrote cron-driven aggregation jobs that replaced a recurring manual reconciliation process.", tags: ["sql", "transaction-processing", "payments", "telecom"] },
    { id: "tests", text: "Cover new service logic with JUnit and Mockito tests; trace live incidents through application logs and SQL.", tags: ["junit", "mockito", "unit-testing", "production-support", "sql"] },
    { id: "ers-api", text: "AsiaCell Iraq ERS: REST APIs with Spring Data JPA over MySQL, including transactional logic for recharge workflows.", tags: ["rest", "spring-data-jpa", "hibernate", "mysql", "transaction-management", "telecom", "payments"] },
    { id: "ers-es", text: "AsiaCell Iraq ERS: Elasticsearch queries feeding the BI Aggregator and operational reporting.", tags: ["elasticsearch"] },
    { id: "ers-integration", text: "AsiaCell Iraq ERS: integrate internal and third-party APIs across Dealer, Contract, Product, Batch Scheduling and USSD services.", tags: ["api-integration", "rest", "soap"] },
    { id: "expense", text: "Expense Reimbursement System: Spring Boot app with Spring Security role-based auto-approval, MySQL status tracking, Dockerized setup.", tags: ["spring-boot", "spring-security", "mysql", "docker"] },
    { id: "django", text: "Arbisoft apprenticeship: Django/DRF backend services and user authentication; Scrapy data extraction.", tags: ["django", "python", "scrapy"] },
  ],
  salary: { min: null, currency: "USD", period: "year" },
  preferences: { remoteOnly: false, avoidCompanies: [], avoidKeywords: [] },
  weights: { ...DEFAULT_WEIGHTS },
};
