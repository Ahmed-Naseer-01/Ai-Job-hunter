import { htmlToText } from "../extract/text";
import { extractSkills } from "../extract/skills";
import { extractYears } from "../extract/years";
import { extractSalary } from "../extract/salary";
import { detectEmploymentType, detectSeniority, detectWorkMode } from "../extract/classify";
import { detectModernization, extractDomains } from "../extract/domain";
import { scanPlaces, homeRegex } from "../matching/places";
import { canonicalizeUrl } from "../dedupe/url";
import { sha256 } from "../util";
import { NormalizedJobInputSchema, type EnrichedJob, type NormalizedJobInput, type Provenance } from "./types";

/**
 * Validate + normalise + extract. Everything extracted is either a published fact (copied from the source)
 * or an inference we label as such. Unknown stays unknown (null / "unknown").
 */
export function enrichJob(input: NormalizedJobInput, _now = new Date()): EnrichedJob {
  const i = NormalizedJobInputSchema.parse(input);
  const description = (i.descriptionText ?? htmlToText(i.descriptionHtml)).trim();
  const published: string[] = ["title", "company", "applyUrl", "sourceJobId"];
  const inferred: string[] = [];
  const unknown: string[] = [];

  const loc = i.locationRaw?.trim() || null;
  loc ? published.push("location") : unknown.push("location");
  const wm = detectWorkMode(loc, description, i.workModeHint);
  wm.source === "published" ? published.push("workMode") : wm.source === "inferred" ? inferred.push("workMode") : unknown.push("workMode");

  const employmentType = detectEmploymentType(i.employmentTypeHint, description);
  const seniority = detectSeniority(i.title);
  const empFinal = employmentType === "unknown" && seniority === "intern" ? "internship" : employmentType;
  if (i.employmentTypeHint && employmentType !== "unknown") published.push("employmentType");
  else empFinal !== "unknown" ? inferred.push("employmentType") : unknown.push("employmentType");
  seniority !== "unspecified" ? inferred.push("seniority") : unknown.push("seniority");

  const years = extractYears(description);
  years.min !== null ? inferred.push("yearsMin") : unknown.push("yearsMin");

  const skills = extractSkills(description, i.title);
  skills.required.length ? inferred.push("requiredSkills") : unknown.push("requiredSkills");

  // Salary: structured field wins (published), otherwise a range found in the text (still published by the employer).
  let salaryMin: number | null = null;
  let salaryMax: number | null = null;
  let salaryCurrency: string | null = null;
  let salaryPeriod: "year" | "month" | "hour" | null = null;
  let salaryEvidence: string | undefined;
  if (i.salary && (i.salary.min != null || i.salary.max != null)) {
    salaryMin = i.salary.min ?? i.salary.max ?? null;
    salaryMax = i.salary.max ?? i.salary.min ?? null;
    salaryCurrency = i.salary.currency ?? null;
    salaryPeriod = i.salary.period ?? null;
    salaryEvidence = "structured field from source";
  } else {
    const s = extractSalary(description);
    if (s) {
      salaryMin = s.min;
      salaryMax = s.max;
      salaryCurrency = s.currency;
      salaryPeriod = s.period;
      salaryEvidence = s.evidence;
    }
  }
  salaryMin !== null ? published.push("salary") : unknown.push("salary");
  i.postedAt ? published.push("postedAt") : unknown.push("postedAt");
  if (i.deadlineAt) published.push("deadlineAt");

  const countries = loc ? scanPlaces(loc, homeRegex("Pakistan"), undefined).countries : [];
  const home = loc && homeRegex("Pakistan").test(loc);
  if (home && !countries.includes("Pakistan")) countries.push("Pakistan");

  const known = [description.length >= 300, !!loc, wm.value !== "unknown", empFinal !== "unknown", years.min !== null, salaryMin !== null, !!i.postedAt, skills.required.length > 0];
  const completeness = known.filter(Boolean).length / known.length;

  const facts: Provenance = {
    published,
    inferred,
    unknown,
    domains: extractDomains(`${i.title}\n${description}`),
    modernization: detectModernization(description),
    workModeSource: wm.source,
    salaryEvidence,
    yearsMentions: years.mentions.slice(0, 10),
  };

  const canonicalUrl = canonicalizeUrl(i.applyUrl);
  const contentHash = sha256(
    JSON.stringify([i.title, i.company, description, loc, wm.value, empFinal, salaryMin, salaryMax, i.deadlineAt, canonicalUrl]),
  );

  return {
    title: i.title,
    company: i.company,
    applyUrl: i.applyUrl,
    canonicalUrl,
    sourceKey: i.sourceKey,
    sourceKind: i.sourceKind,
    sourceJobId: i.sourceJobId,
    description,
    locationRaw: loc,
    countries,
    workMode: wm.value,
    employmentType: empFinal,
    seniority,
    yearsMin: years.min,
    yearsPreferred: years.preferred,
    requiredSkills: skills.required,
    preferredSkills: skills.preferred,
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    postedAt: i.postedAt ?? null,
    deadlineAt: i.deadlineAt ?? null,
    completeness,
    facts,
    contentHash,
    isSynthetic: !!i.isSynthetic,
  };
}
