import type { AppSettings, Profile, Weights } from "../config/schema";
import { SKILL_BY_ID, type SkillGroup } from "../extract/taxonomy";
import type { SkillHit } from "../extract/skills";
import type { EnrichedJob } from "../jobs/types";
import type { EligibilityResult, EligibilityState } from "./eligibility";
import { clamp } from "../util";

export type Band = "high" | "good" | "review" | "low";
export type SkillStatus = "met" | "familiar" | "transferable" | "missing";

export interface CategoryResult {
  key: keyof Weights;
  label: string;
  weight: number;
  /** Weight after renormalisation over assessable categories (0 when not assessable). */
  appliedWeight: number;
  /** 0..1, or null when the posting does not give enough information. */
  score: number | null;
  notes: string[];
}

export interface SkillMatch {
  id: string;
  label: string;
  group: SkillGroup;
  required: boolean;
  status: SkillStatus;
  level: string | null;
  evidence: string;
  via?: string;
}

export interface Explanation {
  verdict: "Worth applying" | "Worth reviewing" | "Confirm eligibility first" | "Not actionable" | "Probably skip";
  whyFit: string[];
  relevantAchievements: { id: string; text: string; why: string }[];
  metRequirements: string[];
  missingRequirements: string[];
  unverified: string[];
  eligibilityNote: string;
  emphasize: string[];
  caveats: string[];
}

export interface ScoreResult {
  score: number;
  technicalScore: number;
  band: Band;
  confidence: number;
  confidenceLabel: "low" | "medium" | "high";
  breakdown: CategoryResult[];
  skillMatches: SkillMatch[];
  capsApplied: string[];
  eligibility: EligibilityState;
  actionable: boolean;
  explanation: Explanation;
}

const LABELS: Record<keyof Weights, string> = {
  javaSpring: "Java & Spring Boot alignment",
  backendMicroservices: "Backend / microservices experience",
  dataApi: "Database, SQL & API requirements",
  opsTooling: "Production ops, Docker, testing & CI/CD",
  seniorityFit: "Seniority & experience fit",
  eligibility: "Remote eligibility & work authorization",
  preferences: "Salary & other preferences",
};

const LEVEL_CREDIT: Record<string, number> = { expert: 1, strong: 1, working: 0.75, familiar: 0.4 };
const STATUS_CREDIT: Record<SkillStatus, number> = { met: 1, familiar: 0.4, transferable: 0.3, missing: 0 };
/** Generic terms that should not move the score much. */
const GENERIC_WEIGHT: Record<string, number> = { json: 0.3, xml: 0.3, git: 0.3 };
const skillWeight = (id: string) => GENERIC_WEIGHT[id] ?? 1;

const SPRING_IDS = ["spring-boot", "spring", "spring-security", "spring-data-jpa", "spring-cloud", "spring-batch"];
const OTHER_LANGS = ["python", "go", "csharp", "ruby", "php", "rust", "javascript", "typescript", "cpp"];

export function resolveSkill(id: string, profile: Profile): { status: SkillStatus; level: string | null; via?: string } {
  const p = profile.skills.find((s) => s.id === id);
  if (p) {
    if (p.level === "familiar") return { status: "familiar", level: p.level };
    return { status: "met", level: p.level };
  }
  const rel = SKILL_BY_ID[id]?.related ?? [];
  for (const r of rel) {
    const rp = profile.skills.find((s) => s.id === r);
    if (rp && rp.level !== "familiar") return { status: "transferable", level: null, via: SKILL_BY_ID[r]?.label ?? r };
  }
  return { status: "missing", level: null };
}

function credit(m: SkillMatch, profile: Profile): number {
  if (m.status === "met") return LEVEL_CREDIT[m.level ?? "strong"] ?? 1;
  return STATUS_CREDIT[m.status];
}

/** Weighted coverage of required (weight 1) and preferred (weight 0.4) skills in a set. Null when none present. */
function coverage(matches: SkillMatch[], profile: Profile, pred: (m: SkillMatch) => boolean): { value: number | null; n: number } {
  let num = 0;
  let den = 0;
  let n = 0;
  for (const m of matches) {
    if (!pred(m)) continue;
    const w = skillWeight(m.id) * (m.required ? 1 : 0.4);
    num += w * credit(m, profile);
    den += w;
    n++;
  }
  return { value: den > 0 ? num / den : null, n };
}

function roleFit(title: string): number {
  const t = title.toLowerCase();
  if (/\b(java|spring|jvm)\b/.test(t)) return 1;
  const target = /\b(backend|back-end|back end|platform|integration|api|microservices?|server[- ]side)\b/.test(t);
  const generic = /\b(software|developer|engineer|programmer|full[- ]?stack)\b/.test(t);
  if (/\b(devops|sre|site reliability|data engineer)\b/.test(t) && !target) return 0.3;
  const anti = /\b(front[- ]?end|ios|android|mobile|data scien\w+|data analyst|machine learning|ml|ai|qa|quality|test|sdet|designer|product|sales|support|security|embedded|firmware|game|marketing|recruit\w*|account|customer|analyst|writer)\b/.test(t);
  if (anti && !target) return 0.2;
  if (target && generic) return 1;
  if (target) return 0.9;
  if (generic) return 0.6;
  return 0.3;
}

function titleSimilarity(jobTitle: string, preferred: string[]): number {
  const stop = new Set(["and", "of", "the", "-", "–", "a", "in", "for"]);
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9+#. ]/g, " ").split(/\s+/).filter((w) => w && !stop.has(w)));
  const jt = tok(jobTitle);
  let best = 0;
  for (const p of preferred) {
    const pt = tok(p);
    if (!pt.size) continue;
    const inter = [...pt].filter((w) => jt.has(w)).length;
    if (inter === pt.size) return 1;
    const union = new Set([...pt, ...jt]).size;
    best = Math.max(best, inter / union);
  }
  return best;
}

function yearsScore(yearsMin: number, have: number): number {
  const d = yearsMin - have;
  if (d <= 1) return 1;
  if (d <= 2) return 0.8;
  if (d <= 3) return 0.5;
  if (d <= 4) return 0.3;
  if (d >= 8) return 0;
  return 0.1;
}

const TITLE_SENIORITY_SCORE: Record<string, number | null> = {
  intern: 0.6, junior: 0.85, mid: 1, unspecified: null, senior: 0.4, lead: 0.25, staff: 0.15, principal: 0.1, architect: 0.15, manager: 0.1,
};

function yearlyAmount(v: number, period: "year" | "month" | "hour" | null): number | null {
  if (period === "year") return v;
  if (period === "month") return v * 12;
  if (period === "hour") return v * 2080;
  return null;
}

export function bandFor(score: number, bands: AppSettings["scoring"]["bands"]): Band {
  if (score >= bands.high) return "high";
  if (score >= bands.good) return "good";
  if (score >= bands.review) return "review";
  return "low";
}

export function scoreJob(job: EnrichedJob, elig: EligibilityResult, profile: Profile, settings: AppSettings): ScoreResult {
  // ---------- skill matches (evidence-backed) ----------
  const toMatch = (h: SkillHit, required: boolean): SkillMatch => {
    const r = resolveSkill(h.id, profile);
    return { id: h.id, label: h.label, group: h.group, required, status: r.status, level: r.level, evidence: h.evidence, via: r.via };
  };
  const skillMatches = [...job.requiredSkills.map((h) => toMatch(h, true)), ...job.preferredSkills.map((h) => toMatch(h, false))];
  const reqIds = new Set(job.requiredSkills.map((s) => s.id));
  const prefIds = new Set(job.preferredSkills.map((s) => s.id));
  const have = profile.yearsExperience;
  const cats: Record<keyof Weights, { score: number | null; notes: string[] }> = {} as any;

  // ---------- 1. Java & Spring ----------
  {
    const notes: string[] = [];
    const springReq = SPRING_IDS.filter((s) => reqIds.has(s));
    const javaEff = reqIds.has("java") || springReq.length > 0;
    let s: number | null;
    if (javaEff) {
      s = 0.7;
      notes.push(reqIds.has("java") ? "Java is required" : "Spring stack implies Java");
      if (reqIds.has("spring-boot") || reqIds.has("spring")) {
        s += 0.2;
        notes.push("Spring Boot / Spring required");
      } else if (springReq.length) s += 0.1;
      if (reqIds.has("hibernate") || reqIds.has("spring-data-jpa")) {
        s += 0.05;
        notes.push("Spring Data JPA / Hibernate required");
      }
      if (job.facts.modernization) {
        s += 0.1;
        notes.push("Java migration/modernization work — matches your Java 8→21 migration");
      } else if (/\b(?:java|jdk)\s*(?:17|21)\b/i.test(job.description)) {
        s += 0.05;
        notes.push("Modern Java (17/21) mentioned");
      }
    } else if (prefIds.has("java") || prefIds.has("spring-boot") || SPRING_IDS.some((x) => prefIds.has(x))) {
      s = 0.45;
      notes.push("Java/Spring only listed as preferred");
    } else if (reqIds.has("kotlin") || reqIds.has("scala")) {
      s = 0.3;
      notes.push("JVM language other than Java required");
    } else {
      const langs = OTHER_LANGS.filter((l) => reqIds.has(l));
      if (langs.length) {
        const best = Math.max(
          ...langs.map((l) => {
            const r = resolveSkill(l, profile);
            return r.status === "met" ? (LEVEL_CREDIT[r.level ?? "strong"] ?? 1) : STATUS_CREDIT[r.status];
          }),
        );
        s = 0.05 + 0.2 * best;
        notes.push(`No Java/Spring requirement; primary stack: ${langs.join(", ")}`);
      } else if (reqIds.size === 0 && prefIds.size === 0) {
        s = null;
        notes.push("No technology stack could be read from the posting");
      } else {
        s = 0.1;
        notes.push("No Java/Spring requirement found");
      }
    }
    cats.javaSpring = { score: s === null ? null : clamp(s, 0, 1), notes };
  }

  // ---------- 2. Backend / microservices (+ other required stack) ----------
  {
    const notes: string[] = [];
    const rf = roleFit(job.title);
    notes.push(`Title fit ${(rf * 100).toFixed(0)}%`);
    const covArch = coverage(skillMatches, profile, (m) => ["backend", "messaging", "language", "frontend", "ml", "other"].includes(m.group) && !["java", "kotlin", "scala"].includes(m.id));
    let base = covArch.value === null ? rf : 0.45 * rf + 0.55 * covArch.value;
    if (covArch.value !== null) notes.push(`Architecture/stack coverage ${(covArch.value * 100).toFixed(0)}%`);
    let bonus = 0;
    const d = job.facts.domains;
    if (d.includes("telecom")) { bonus += 0.15; notes.push("Telecom/recharge domain — direct domain match"); }
    if (d.includes("payments")) { bonus += 0.1; notes.push("Payments/billing domain match"); }
    if (d.includes("transaction-processing")) { bonus += 0.05; notes.push("Transaction-processing / throughput focus"); }
    bonus = Math.min(bonus, 0.25);
    if (reqIds.has("microservices") && (reqIds.has("distributed-systems") || /scal(?:e|able)|high[- ]throughput|high[- ]volume/i.test(job.description))) {
      bonus += 0.1;
      notes.push("Microservices at scale — relevant to your 100+ service platform");
    }
    cats.backendMicroservices = { score: clamp(base + bonus, 0, 1), notes };
  }

  // ---------- 3. Data & API ----------
  {
    const c = coverage(skillMatches, profile, (m) => m.group === "data" || m.group === "api");
    cats.dataApi = { score: c.value, notes: c.value === null ? ["No database/API requirements stated"] : [`${c.n} database/API items, coverage ${(c.value * 100).toFixed(0)}%`] };
  }
  // ---------- 4. Ops / tooling ----------
  {
    const c = coverage(skillMatches, profile, (m) => m.group === "ops" || m.group === "testing" || m.group === "cloud" || m.id === "maven" || m.id === "gradle");
    cats.opsTooling = { score: c.value, notes: c.value === null ? ["No ops/testing requirements stated"] : [`${c.n} ops/testing items, coverage ${(c.value * 100).toFixed(0)}%`] };
  }
  // ---------- 5. Seniority ----------
  {
    const notes: string[] = [];
    const ts = TITLE_SENIORITY_SCORE[job.seniority];
    const ys = job.yearsMin === null ? null : yearsScore(job.yearsMin, have);
    if (ts !== null && ts !== undefined) notes.push(`Title level: ${job.seniority}`);
    if (ys !== null) notes.push(`Requires ${job.yearsMin}+ years vs your ${have}`);
    const parts = [ts ?? null, ys].filter((x): x is number => x !== null);
    cats.seniorityFit = { score: parts.length ? Math.min(...parts) : null, notes: parts.length ? notes : ["Seniority and years not stated"] };
  }
  // ---------- 6. Eligibility ----------
  {
    const s = elig.state === "eligible" ? 1 : elig.state === "potential" ? 0.5 : 0;
    cats.eligibility = { score: s, notes: [elig.state === "eligible" ? "Eligible based on available evidence" : elig.state === "potential" ? "Potentially eligible — confirmation needed" : "Ineligible based on explicit restrictions"] };
  }
  // ---------- 7. Preferences ----------
  let avoidHit: string | null = null;
  {
    const notes: string[] = [];
    const signals: number[] = [];
    const ts = titleSimilarity(job.title, profile.preferredTitles);
    signals.push(ts);
    notes.push(`Title similarity to preferred titles ${(ts * 100).toFixed(0)}%`);
    const hay = `${job.title} ${job.company} ${job.description}`.toLowerCase();
    const avoidCo = profile.preferences.avoidCompanies.find((c) => c && job.company.toLowerCase().includes(c.toLowerCase()));
    const avoidKw = profile.preferences.avoidKeywords.find((k) => k && hay.includes(k.toLowerCase()));
    if (avoidCo || avoidKw) {
      avoidHit = avoidCo ? `company "${avoidCo}"` : `keyword "${avoidKw}"`;
      signals.push(0);
      notes.push(`Matches your avoid list: ${avoidHit}`);
    }
    if (profile.preferences.remoteOnly && job.workMode !== "remote") {
      signals.push(0.2);
      notes.push("You prefer remote-only and this role is not confirmed remote");
    }
    if (job.salaryMin === null) {
      notes.push(profile.salary.min ? "Salary not published — not scored" : "Salary not published");
    } else if (profile.salary.min) {
      const exp = yearlyAmount(profile.salary.min, profile.salary.period);
      const jobMax = yearlyAmount(job.salaryMax ?? job.salaryMin, job.salaryPeriod);
      if ((job.salaryCurrency ?? "").toUpperCase() !== profile.salary.currency.toUpperCase()) {
        notes.push(`Salary published in ${job.salaryCurrency ?? "unknown currency"}; your expectation is in ${profile.salary.currency} — not compared`);
      } else if (exp === null || jobMax === null) {
        notes.push("Salary period unknown — not compared");
      } else {
        const r = clamp(jobMax / exp, 0, 1);
        signals.push(r);
        notes.push(`Published salary max ${Math.round(jobMax).toLocaleString("en-US")} vs expectation ${Math.round(exp).toLocaleString("en-US")} (${job.salaryCurrency}/year)`);
      }
    } else {
      notes.push("Salary published; you have not set an expectation");
    }
    cats.preferences = { score: signals.reduce((a, b) => a + b, 0) / signals.length, notes };
  }

  // ---------- combine ----------
  const weights = profile.weights;
  const keys = Object.keys(LABELS) as (keyof Weights)[];
  const totalWeight = keys.reduce((s, k) => s + weights[k], 0);
  const assessable = keys.filter((k) => cats[k].score !== null && weights[k] > 0);
  const assessableWeight = assessable.reduce((s, k) => s + weights[k], 0);
  const breakdown: CategoryResult[] = keys.map((k) => ({
    key: k,
    label: LABELS[k],
    weight: weights[k],
    appliedWeight: assessable.includes(k) && assessableWeight > 0 ? (weights[k] / assessableWeight) * 100 : 0,
    score: cats[k].score,
    notes: cats[k].notes,
  }));
  const weighted = (ks: (keyof Weights)[]) => {
    const a = ks.filter((k) => assessable.includes(k));
    const w = a.reduce((s, k) => s + weights[k], 0);
    return w > 0 ? (a.reduce((s, k) => s + weights[k] * (cats[k].score as number), 0) / w) * 100 : 0;
  };
  let score = weighted(keys);
  const technicalScore = weighted(["javaSpring", "backendMicroservices", "dataApi", "opsTooling", "seniorityFit"]);

  // ---------- confidence ----------
  const coverageW = totalWeight > 0 ? assessableWeight / totalWeight : 0;
  const len = job.description.length;
  const descFactor = len < 200 ? 0.4 : len < 600 ? 0.7 : len < 1200 ? 0.9 : 1;
  const confidence = clamp(coverageW * descFactor, 0, 1);
  const confidenceLabel = confidence < 0.5 ? "low" : confidence < 0.75 ? "medium" : "high";

  // ---------- deterministic caps (an LLM can never lift these) ----------
  const caps: { limit: number; reason: string }[] = [];
  if (confidence < 0.5) caps.push({ limit: 69, reason: "Limited information in the posting (low confidence)" });
  if (["manager", "architect", "principal", "staff"].includes(job.seniority)) caps.push({ limit: 59, reason: `Title level is ${job.seniority}` });
  else if (job.seniority === "lead") caps.push({ limit: 69, reason: "Title level is lead" });
  if (job.yearsMin !== null) {
    if (job.yearsMin >= have + 8) caps.push({ limit: 49, reason: `Requires ${job.yearsMin}+ years (you have ${have})` });
    else if (job.yearsMin >= have + 5) caps.push({ limit: 64, reason: `Requires ${job.yearsMin}+ years (you have ${have})` });
    else if (job.yearsMin >= have + 3) caps.push({ limit: 79, reason: `Requires ${job.yearsMin}+ years — a stretch (you have ${have})` });
  }
  if (cats.javaSpring.score !== null && cats.javaSpring.score < 0.2) caps.push({ limit: 64, reason: "No Java/Spring requirement — outside your primary stack" });
  const unmet = skillMatches.filter((m) => m.required && (m.status === "missing" || m.status === "transferable") && skillWeight(m.id) >= 1);
  if (unmet.length >= 4) caps.push({ limit: 64, reason: `Missing ${unmet.length} mandatory skills not on your resume (${unmet.map((m) => m.label).join(", ")})` });
  else if (unmet.length >= 2) caps.push({ limit: 79, reason: `Missing ${unmet.length} mandatory skills not on your resume (${unmet.map((m) => m.label).join(", ")})` });
  if (elig.state === "ineligible") caps.push({ limit: 69, reason: "Ineligible based on explicit restrictions" });
  if (avoidHit) caps.push({ limit: 30, reason: `Matches your avoid list: ${avoidHit}` });
  const capsApplied: string[] = [];
  for (const c of caps) {
    if (score > c.limit) {
      score = c.limit;
      capsApplied.push(`${c.reason} → capped at ${c.limit}`);
    }
  }
  score = Math.round(clamp(score, 0, 100) * 10) / 10;
  const techRounded = Math.round(clamp(technicalScore, 0, 100) * 10) / 10;
  const band = bandFor(score, settings.scoring.bands);
  const actionable = elig.state !== "ineligible" && !elig.preferenceExcluded;

  const explanation = buildExplanation({ job, elig, profile, skillMatches, score, band, actionable, caps: capsApplied, cats, unmet });
  return { score, technicalScore: techRounded, band, confidence: Math.round(confidence * 100) / 100, confidenceLabel, breakdown, skillMatches, capsApplied, eligibility: elig.state, actionable, explanation };
}

// ---------------------------------------------------------------------------

function buildExplanation(a: {
  job: EnrichedJob;
  elig: EligibilityResult;
  profile: Profile;
  skillMatches: SkillMatch[];
  score: number;
  band: Band;
  actionable: boolean;
  caps: string[];
  cats: Record<keyof Weights, { score: number | null; notes: string[] }>;
  unmet: SkillMatch[];
}): Explanation {
  const { job, elig, profile, skillMatches, band, actionable } = a;
  const req = skillMatches.filter((m) => m.required);
  const met = req.filter((m) => m.status === "met" || m.status === "familiar");
  const metLabels = met.map((m) => `${m.label} (${m.status === "familiar" ? "familiar — not expert" : m.level})`);
  const missingReq = req.filter((m) => m.status === "missing" || m.status === "transferable");
  const missingPref = skillMatches.filter((m) => !m.required && (m.status === "missing" || m.status === "transferable"));

  const unverified = [
    ...missingReq.map((m) => `${m.label} — required, not on your resume${m.via ? ` (related: ${m.via})` : ""}`),
    ...missingPref.map((m) => `${m.label} — preferred, not on your resume${m.via ? ` (related: ${m.via})` : ""}`),
  ];
  const missingRequirements = missingReq.map((m) => m.label);

  // relevant achievements: overlap between achievement tags and what this job asks for
  const jobTags = new Map<string, number>();
  for (const m of met) jobTags.set(m.id, 1);
  for (const d of job.facts.domains) jobTags.set(d, 1.5);
  if (job.facts.modernization) jobTags.set("java-modernization", 4);
  const ranked = profile.achievements
    .map((ach) => {
      const hits = ach.tags.filter((t) => jobTags.has(t));
      return { ach, hits, w: hits.reduce((s, t) => s + (jobTags.get(t) ?? 0), 0) };
    })
    .filter((x) => x.w > 0)
    .sort((x, y) => y.w - x.w || x.ach.id.localeCompare(y.ach.id))
    .slice(0, 4);
  const relevantAchievements = ranked.map((r) => ({ id: r.ach.id, text: r.ach.text, why: `Matches: ${r.hits.map((h) => SKILL_BY_ID[h]?.label ?? h).join(", ")}` }));

  const whyFit: string[] = [];
  for (const n of [...a.cats.javaSpring.notes, ...a.cats.backendMicroservices.notes.filter((x) => !x.startsWith("Title fit") && !x.startsWith("Architecture")), ...a.cats.dataApi.notes.slice(0, 0)]) whyFit.push(n);
  if (met.length) whyFit.push(`Meets ${met.length} of ${req.length} mandatory skills found in the posting`);
  if (job.facts.domains.length) whyFit.push(`Domain overlap: ${job.facts.domains.join(", ")}`);

  const emphasize: string[] = [];
  if (job.facts.modernization || reqHas(req, "java")) emphasize.push(job.facts.modernization ? "Lead with your Java 8 → Java 21 migration of 10+ production services." : "Mention your Java 8 and Java 21 experience (migration of 10+ production services).");
  if (reqHas(req, "microservices") || reqHas(req, "spring-boot")) emphasize.push("Spring Boot microservices in a 100+ service platform running at 35–40 TPS.");
  if (job.facts.domains.includes("telecom") || job.facts.domains.includes("payments")) emphasize.push("Recharge / top-up / transaction workflows for telecom operators across Africa, South Asia and the Middle East.");
  if (reqHas(req, "elasticsearch") || skillMatches.some((m) => m.id === "elasticsearch")) emphasize.push("Elasticsearch queries powering BI aggregation and operational reporting (AsiaCell ERS).");
  if (reqHas(req, "docker") || reqHas(req, "ci-cd")) emphasize.push("Docker packaging and Bamboo pipelines producing RPMs for Linux deployment.");
  if (reqHas(req, "production-support")) emphasize.push("Incident tracing through application logs and SQL; production support with operations teams.");
  for (const r of relevantAchievements.slice(0, 2)) if (!emphasize.length) emphasize.push(r.text);

  const caveats: string[] = [...a.caps];
  if (job.yearsMin !== null && job.yearsMin > profile.yearsExperience) caveats.push(`Posting asks for ${job.yearsMin}+ years; you have about ${profile.yearsExperience}.`);
  if (job.completeness < 0.5) caveats.push("Posting is missing several fields (salary, dates, experience, etc.).");
  for (const f of elig.requiresConfirmation) caveats.push(f);

  const eligibilityNote = [
    elig.state === "eligible" ? "Eligible based on available evidence." : elig.state === "potential" ? "Potentially eligible — confirmation needed." : "Ineligible based on explicit restrictions.",
    ...elig.reasons,
    ...(elig.preferenceExcluded ? [elig.preferenceExcluded] : []),
  ].join(" ");

  let verdict: Explanation["verdict"];
  if (!actionable) verdict = "Not actionable";
  else if (band === "low") verdict = "Probably skip";
  else if (band === "review") verdict = "Worth reviewing";
  else verdict = elig.state === "eligible" ? "Worth applying" : "Confirm eligibility first";

  return { verdict, whyFit, relevantAchievements, metRequirements: metLabels, missingRequirements, unverified, eligibilityNote, emphasize, caveats };
}

const reqHas = (req: SkillMatch[], id: string) => req.some((m) => m.id === id);
