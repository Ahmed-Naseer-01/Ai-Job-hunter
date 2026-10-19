export type SkillGroup =
  | "java_spring"
  | "backend"
  | "data"
  | "api"
  | "ops"
  | "testing"
  | "language"
  | "frontend"
  | "cloud"
  | "ml"
  | "messaging"
  | "other";

export interface SkillDef {
  id: string;
  label: string;
  group: SkillGroup;
  patterns: RegExp[];
  /** Profile skills that make this one "transferable" (partial credit, still reported as unverified). */
  related?: string[];
}

const S = (id: string, label: string, group: SkillGroup, patterns: RegExp[], related?: string[]): SkillDef => ({ id, label, group, patterns, related });

export const TAXONOMY: SkillDef[] = [
  // --- Java / Spring ---
  S("java", "Java", "java_spring", [/\bjava\b(?!\s*-?\s*script)/i, /\bjvm\b/i, /\bjdk\b/i, /\bj2ee\b/i, /\bjakarta ee\b/i]),
  S("spring-boot", "Spring Boot", "java_spring", [/spring[\s-]?boot/i]),
  S("spring", "Spring Framework (Core/MVC)", "java_spring", [/\bspring\s+(?:framework|mvc|core|webflux|integration)\b/i, /\b(?:java|jvm)\b.{0,25}\bspring\b(?![\s-]*(?:boot|security|data|cloud|batch))/i, /\bspring\b(?![\s-]*(?:boot|security|data|cloud|batch)).{0,25}\b(?:java|jvm)\b/i]),
  S("spring-security", "Spring Security", "java_spring", [/spring[\s-]?security/i]),
  S("spring-data-jpa", "Spring Data JPA", "java_spring", [/spring[\s-]?data/i, /\bjpa\b/i]),
  S("hibernate", "Hibernate", "java_spring", [/\bhibernate\b/i]),
  S("spring-cloud", "Spring Cloud", "java_spring", [/spring[\s-]?cloud/i], ["spring-boot", "microservices"]),
  S("spring-batch", "Spring Batch", "java_spring", [/spring[\s-]?batch/i], ["spring-boot"]),
  S("maven", "Maven", "java_spring", [/\bmaven\b/i]),
  S("gradle", "Gradle", "java_spring", [/\bgradle\b/i], ["maven"]),
  S("kotlin", "Kotlin", "language", [/\bkotlin\b/i], ["java"]),
  S("scala", "Scala", "language", [/\bscala\b/i], ["java"]),

  // --- Backend architecture ---
  S("microservices", "Microservices", "backend", [/micro[\s-]?services?/i, /service[- ]oriented/i]),
  S("distributed-systems", "Distributed systems", "backend", [/distributed (?:systems?|architectures?|computing|services)/i]),
  S("multithreading", "Multithreading / concurrency", "backend", [/multi[\s-]?thread/i, /\bconcurrency\b/i, /concurrent (?:programming|systems?)/i]),
  S("transaction-management", "Transaction management", "backend", [/transaction(?:al)? (?:management|processing|handling|integrity)/i, /\bacid\b/i, /\btransactional\b/i]),
  S("event-driven", "Event-driven architecture", "backend", [/event[- ]driven/i, /event sourcing/i, /\bcqrs\b/i], ["microservices"]),

  // --- APIs ---
  S("rest", "REST APIs", "api", [/\brest(?:ful)?\s*(?:api|apis|service|services|web\s*services?|endpoints?)/i, /\brestful\b/i, /\bapi development\b/i, /\bweb services?\b/i]),
  S("soap", "SOAP", "api", [/\bsoap\b/i, /\bwsdl\b/i]),
  S("xml", "XML", "api", [/\bxml\b/i]),
  S("json", "JSON", "api", [/\bjson\b/i]),
  S("api-integration", "API / third-party integrations", "api", [/(?:third[- ]party|external|partner)\s+(?:apis?|integrations?)/i, /\bapi integrations?\b/i, /\bsystem integrations?\b/i, /integrat(?:e|es|ing|ion)\s+(?:with\s+)?(?:external |third[- ]party )?(?:apis|systems|services)/i]),
  S("grpc", "gRPC", "api", [/\bgrpc\b/i], ["rest"]),
  S("graphql", "GraphQL", "api", [/\bgraphql\b/i]),

  // --- Data ---
  S("sql", "SQL", "data", [/(?<!no[-\s]?)(?<![a-z])sql\b(?!\s*(?:server|lite))/i, /relational databases?/i, /\brdbms\b/i]),
  S("mysql", "MySQL", "data", [/\bmysql\b/i]),
  S("mariadb", "MariaDB", "data", [/\bmariadb\b/i]),
  S("sqlite", "SQLite", "data", [/\bsqlite\b/i]),
  S("postgresql", "PostgreSQL", "data", [/\bpostgres(?:ql)?\b/i], ["mysql", "sql"]),
  S("oracle", "Oracle DB", "data", [/\boracle\s*(?:db|database|sql|11g|12c|19c)?\b(?!\s*cloud)/i, /\bpl\/sql\b/i], ["sql"]),
  S("sqlserver", "SQL Server", "data", [/sql server/i, /\bmssql\b/i, /\bt-sql\b/i], ["sql"]),
  S("elasticsearch", "Elasticsearch", "data", [/elastic\s?search/i, /\bopensearch\b/i, /\belk\b/i]),
  S("nosql", "NoSQL", "data", [/\bno[-\s]?sql\b/i]),
  S("mongodb", "MongoDB", "data", [/\bmongo(?:db)?\b/i]),
  S("cassandra", "Cassandra", "data", [/\bcassandra\b/i]),
  S("dynamodb", "DynamoDB", "data", [/\bdynamo\s?db\b/i]),
  S("redis", "Redis", "data", [/\bredis\b/i]),
  S("query-optimization", "Query optimization", "data", [/query (?:optimi[sz]ation|tuning)/i, /performance tuning/i]),

  // --- Messaging ---
  S("kafka", "Kafka", "messaging", [/\bkafka\b/i]),
  S("rabbitmq", "RabbitMQ", "messaging", [/\brabbit\s?mq\b/i]),
  S("activemq-jms", "ActiveMQ / JMS", "messaging", [/\bactivemq\b/i, /\bjms\b/i]),
  S("message-queues", "Message queues", "messaging", [/message (?:queues?|brokers?|bus)/i, /\bsqs\b/i, /\bpub\/?sub\b/i]),

  // --- Ops / tooling ---
  S("docker", "Docker", "ops", [/\bdocker\b/i, /container(?:s|i[sz]ation|i[sz]ed)\b/i]),
  S("kubernetes", "Kubernetes", "ops", [/\bkubernetes\b/i, /\bk8s\b/i, /\bhelm\b/i, /\beks\b/i, /\bgke\b/i, /\baks\b/i], ["docker"]),
  S("ci-cd", "CI/CD", "ops", [/\bci\s*\/?\s*cd\b/i, /continuous (?:integration|delivery|deployment)/i, /\bcicd\b/i, /(?:build|deployment|release) pipelines?/i]),
  S("bamboo", "Bamboo", "ops", [/\bbamboo\b/i]),
  S("jenkins", "Jenkins", "ops", [/\bjenkins\b/i], ["ci-cd"]),
  S("github-actions", "GitHub Actions", "ops", [/github actions/i], ["ci-cd"]),
  S("gitlab-ci", "GitLab CI", "ops", [/gitlab[- ]ci/i], ["ci-cd"]),
  S("linux", "Linux", "ops", [/\blinux\b/i, /\bunix\b/i, /(?:bash|shell) scripting/i]),
  S("git", "Git", "ops", [/\bgit\b/i]),
  S("bitbucket", "Bitbucket", "ops", [/\bbitbucket\b/i]),
  S("terraform", "Terraform / IaC", "ops", [/\bterraform\b/i, /infrastructure[- ]as[- ]code/i, /\bansible\b/i, /\bcloudformation\b/i]),
  S("monitoring-tools", "Monitoring tools (Prometheus/Grafana/Datadog)", "ops", [/\bprometheus\b/i, /\bgrafana\b/i, /\bdatadog\b/i, /\bnew relic\b/i, /\bsplunk\b/i]),
  S("production-support", "Production support / troubleshooting", "ops", [/production (?:support|issues?|incidents?|systems?|troubleshooting|debugging)/i, /on[- ]call/i, /incident (?:response|management)/i, /\btroubleshoot(?:ing)?\b/i, /root[- ]cause/i, /observability/i]),

  // --- Testing ---
  S("junit", "JUnit", "testing", [/\bjunit\b/i, /\btestng\b/i]),
  S("mockito", "Mockito", "testing", [/\bmockito\b/i, /\bmocking\b/i]),
  S("unit-testing", "Unit / integration testing", "testing", [/unit[- ]test(?:s|ing)?/i, /integration test(?:s|ing)?/i, /test[- ]driven/i, /\btdd\b/i, /automated tests?/i, /automated testing/i]),

  // --- Cloud ---
  S("aws", "AWS", "cloud", [/\baws\b/i, /amazon web services/i, /\bec2\b/i, /\bs3\b/i, /\blambda\b/i]),
  S("azure", "Azure", "cloud", [/\bazure\b/i], ["aws"]),
  S("gcp", "GCP", "cloud", [/\bgcp\b/i, /google cloud/i], ["aws"]),

  // --- Languages / frameworks ---
  S("python", "Python", "language", [/\bpython\b/i]),
  S("django", "Django / DRF", "language", [/\bdjango\b/i]),
  S("flask", "Flask", "language", [/\bflask\b/i]),
  S("fastapi", "FastAPI", "language", [/\bfastapi\b/i], ["flask", "django"]),
  S("javascript", "JavaScript", "language", [/\bjavascript\b/i, /\bnode\.?js\b/i, /\bexpress\.?js\b/i]),
  S("typescript", "TypeScript", "language", [/\btypescript\b/i], ["javascript"]),
  S("go", "Go", "language", [/\bgolang\b/i, /\bgo (?:programming|developer|engineer|language)\b/i, /\bgo\s*\/\s*golang\b/i]),
  S("csharp", "C# / .NET", "language", [/\bc#/i, /\.net\b/i, /\basp\.net\b/i]),
  S("ruby", "Ruby", "language", [/\bruby\b/i, /\brails\b/i]),
  S("php", "PHP", "language", [/\bphp\b/i, /\blaravel\b/i]),
  S("rust", "Rust", "language", [/\brust\b/i]),
  S("cpp", "C / C++", "language", [/\bc\+\+/i]),

  // --- Frontend ---
  S("react", "React", "frontend", [/\breact(?:\.?js)?\b/i]),
  S("angular", "Angular", "frontend", [/\bangular(?:js)?\b/i]),
  S("vue", "Vue", "frontend", [/\bvue(?:\.?js)?\b/i]),
  S("html-css", "HTML/CSS", "frontend", [/\bhtml5?\b/i, /\bcss3?\b/i]),
  S("bootstrap", "Bootstrap", "frontend", [/\bbootstrap\b/i]),

  // --- ML ---
  S("pytorch", "PyTorch", "ml", [/\bpytorch\b/i]),
  S("tensorflow", "TensorFlow", "ml", [/\btensorflow\b/i], ["pytorch"]),
  S("scikit-learn", "scikit-learn", "ml", [/scikit[- ]learn/i, /\bsklearn\b/i]),
  S("pandas", "Pandas", "ml", [/\bpandas\b/i]),
  S("numpy", "NumPy", "ml", [/\bnumpy\b/i]),
  S("scrapy", "Scrapy", "ml", [/\bscrapy\b/i]),
  S("stable-diffusion", "Stable Diffusion / GenAI", "ml", [/stable diffusion/i, /generative ai/i, /\bllms?\b/i], []),
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(TAXONOMY.map((s) => [s.id, s]));
export const SKILL_IDS = TAXONOMY.map((s) => s.id);
