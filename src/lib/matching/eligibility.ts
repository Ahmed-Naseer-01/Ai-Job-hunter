import type { AppSettings } from "../config/schema";
import type { EmploymentType, WorkMode } from "../extract/classify";
import { homeRegex, scanPlaces } from "./places";

export type EligibilityState = "eligible" | "potential" | "ineligible";

export interface EligibilityInput {
  title: string;
  locationRaw: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  description: string;
}

export interface EligibilityResult {
  state: EligibilityState;
  /** Human-readable reasons. */
  reasons: string[];
  /** Verbatim snippets from the posting supporting the decision. */
  evidence: string[];
  /** Things the user must confirm with the employer. */
  requiresConfirmation: string[];
  /** Set when the role is eligible but filtered by the user's search settings (on-site/hybrid/contract/internship). */
  preferenceExcluded: string | null;
  countries: string[];
}

const CLAUSES: RegExp[] = [
  /(?:authori[sz]ed|eligible|legally|right|permitted) to work (?:in|within) (?:the )?([^.;\n]{2,60})/i,
  /(?:must|need to|required to|should|have to|will need to) (?:be )?(?:located|based|reside|residing|living|live|resident)\s+(?:in|within)\s+(?:the )?([^.;\n]{2,80})/i,
  /(?:open to|only (?:accepting|considering|hiring)|accepting applications from|available (?:to|for)|hiring (?:only )?in|applicants? (?:must|should) be (?:from|in))\s+(?:candidates|applicants|residents|people|individuals)?\s*(?:who (?:are )?(?:located|based|live)\s+)?(?:in|from|of)?\s*([^.;\n]{2,80})/i,
  /(?:residents? of|citizens? of)\s+(?:the )?([^.;\n]{2,60}?)\s+only/i,
];

const HARD_NEGATIVE: { re: RegExp; label: string }[] = [
  { re: /security clearance|\bTS\/SCI\b|\bpublic trust\b/i, label: "security clearance required" },
  { re: /\bmust be an? (?:U\.?S\.?|American|UK|British|Canadian|EU) (?:citizen|national|resident|person)\b/i, label: "citizenship/residency requirement" },
  { re: /\b(?:U\.?S\.?|UK|Canadian|EU) citizen(?:s|ship)? (?:only|required)\b/i, label: "citizenship requirement" },
];

const TIMEZONE_RE = [
  /(?:[Oo]verlap|[Ww]orking hours|[Tt]ime ?[Zz]one|[Hh]ours)\b[^.\n]{0,80}?\b(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT|ET|PT|CET|CEST|GMT|UTC|BST|US|UK|EU)\b/,
  /(?:overlap|time ?zone|working hours)[^.\n]{0,80}?\b(?:pacific|eastern|central|mountain|european|british|north american)\b/i,
];

const NO_SPONSOR_RE = /\b(?:no (?:visa )?sponsorship|(?:cannot|can't|unable to|will not|won't|do not|don't|does not) (?:offer |provide )?(?:visa )?sponsor\w*)/i;
const SPONSOR_OFFER_RE = /visa sponsorship|relocation (?:assistance|support|package|bonus|help)|we (?:will )?sponsor|sponsorship (?:is )?(?:available|provided)/i;
const POSITIVE_GLOBAL_RE = /(?:work|hire|hiring|recruit(?:ing)?)\s+(?:from\s+)?(?:anywhere|worldwide|globally)|(?:anywhere|any country) in the world|fully distributed|global(?:ly)? (?:remote|distributed)|(?:open to|hiring) (?:candidates|applicants|people)? ?(?:from )?(?:any|all) (?:country|countries|location)/i;

const snip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

export function evaluateEligibility(
  job: EligibilityInput,
  profile: { countryOfResidence: string },
  search: AppSettings["search"],
): EligibilityResult {
  const home = homeRegex(profile.countryOfResidence);
  const homeName = profile.countryOfResidence;
  const reasons: string[] = [];
  const evidence: string[] = [];
  const confirm: string[] = [];
  const negatives: string[] = [];
  let positive = false;

  const loc = job.locationRaw?.trim() ?? "";
  const locScan = loc ? scanPlaces(loc, home, homeName) : null;
  const isRemote = job.workMode === "remote";
  const isOnsiteLike = job.workMode === "onsite" || job.workMode === "hybrid" || (job.workMode === "unknown" && !!loc && !isRemote);

  // --- location field ---
  if (locScan) {
    if (locScan.home) {
      positive = true;
      evidence.push(`Location: "${snip(loc)}"`);
      reasons.push(`Location field names ${homeName}.`);
    } else if (locScan.global) {
      positive = true;
      evidence.push(`Location: "${snip(loc)}"`);
      reasons.push("Location field says worldwide / anywhere.");
    } else if (locScan.places.length && !isOnsiteLike) {
      // Remote roles tied to a place are a hard restriction; on-site abroad goes through the relocation logic below.
      negatives.push(`Location restricted to ${locScan.places.join(", ")}`);
      evidence.push(`Location: "${snip(loc)}"`);
    } else if (locScan.asia) {
      confirm.push(`Location says "${snip(loc)}" — confirm ${homeName} is included.`);
    }
  }

  // --- description clauses ---
  const desc = job.description;
  let descPositive = false;
  for (const re of CLAUSES) {
    const m = re.exec(desc);
    if (!m) continue;
    const scan = scanPlaces(m[1], home, homeName);
    if (scan.home || scan.global) {
      descPositive = true;
      evidence.push(snip(m[0]));
    } else if (scan.places.length) {
      negatives.push(`Posting restricts applicants to ${scan.places.join(", ")}`);
      evidence.push(snip(m[0]));
    }
  }
  for (const h of HARD_NEGATIVE) {
    const m = h.re.exec(desc);
    if (m) {
      negatives.push(`Posting states ${h.label}`);
      evidence.push(snip(m[0]));
    }
  }
  if (POSITIVE_GLOBAL_RE.test(desc)) {
    const m = POSITIVE_GLOBAL_RE.exec(desc)!;
    descPositive = true;
    evidence.push(snip(m[0]));
  }
  positive = positive || descPositive;

  // --- time zone / sponsorship ---
  let tzNote = false;
  for (const re of TIMEZONE_RE) {
    const m = re.exec(desc);
    if (m) {
      tzNote = true;
      confirm.push(`Time-zone requirement: "${snip(m[0])}" — confirm it works from ${homeName}.`);
      evidence.push(snip(m[0]));
      break;
    }
  }
  const noSponsor = NO_SPONSOR_RE.exec(desc);
  const sponsorOffer = SPONSOR_OFFER_RE.test(desc) && !noSponsor;

  // --- decide ---
  let state: EligibilityState;
  let preferenceExcluded: string | null = null;

  const abroadOnsite = isOnsiteLike && !locScan?.home && !positive;
  if (negatives.length) {
    state = "ineligible";
    reasons.push(...negatives);
  } else if (abroadOnsite) {
    if (!loc) {
      state = "potential";
      confirm.push("No location is stated; confirm whether the role is remote and open to your country.");
    } else if (search.includeRelocation && !noSponsor) {
      state = "potential";
      confirm.push(sponsorOffer ? "Relocation/visa sponsorship appears to be offered — confirm details." : "On-site abroad; relocation enabled in settings — confirm sponsorship before applying.");
      reasons.push(`On-site/hybrid outside ${homeName}.`);
    } else {
      state = "ineligible";
      reasons.push(noSponsor && search.includeRelocation ? "On-site abroad and the posting says it does not sponsor visas." : `On-site/hybrid outside ${homeName}; relocation is not enabled.`);
      if (noSponsor) evidence.push(snip(noSponsor[0]));
    }
  } else if (positive) {
    state = tzNote ? "potential" : "eligible";
    if (tzNote) reasons.push("Open to your country, but a time-zone requirement needs confirmation.");
    else reasons.push(`Posting explicitly accepts applicants from ${homeName} / worldwide.`);
  } else if (isRemote || job.workMode === "unknown") {
    state = "potential";
    reasons.push(isRemote ? "Remote, but the posting does not state which countries are accepted." : "Work location/eligibility is not stated.");
    confirm.push(`Confirm the employer accepts applicants residing in ${homeName}.`);
  } else {
    state = "potential";
  }
  if (noSponsor && state !== "ineligible" && isRemote) confirm.push("Posting says it cannot sponsor visas — confirm that you can be engaged from your country.");
  if (noSponsor && state === "eligible" && !isRemote) evidence.push(snip(noSponsor[0]));

  // --- preference filters (kept separate from eligibility) ---
  if (state !== "ineligible") {
    const inHomeOnsite = !!locScan?.home && !isRemote;
    if (inHomeOnsite) {
      if (job.workMode === "hybrid" && !search.includeHybridPakistan) preferenceExcluded = `Hybrid role in ${homeName} (hybrid roles are disabled in settings).`;
      else if (job.workMode !== "hybrid" && !search.includeOnsitePakistan) preferenceExcluded = `On-site role in ${homeName} (on-site roles are disabled in settings).`;
    }
    if (!preferenceExcluded && job.employmentType === "contract" && !search.includeContract) preferenceExcluded = "Contract role (contract roles are disabled in settings).";
    if (!preferenceExcluded && job.employmentType === "internship" && !search.includeInternships) preferenceExcluded = "Internship/apprenticeship (disabled in settings).";
    if (!preferenceExcluded && job.employmentType === "part_time") preferenceExcluded = "Part-time role (full-time roles only).";
  }

  return {
    state,
    reasons: [...new Set(reasons)],
    evidence: [...new Set(evidence)],
    requiresConfirmation: [...new Set(confirm)],
    preferenceExcluded,
    countries: locScan?.countries ?? [],
  };
}
