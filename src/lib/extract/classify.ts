export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";
export type Seniority = "intern" | "junior" | "mid" | "unspecified" | "senior" | "lead" | "staff" | "principal" | "architect" | "manager";
export type EmploymentType = "full_time" | "contract" | "internship" | "part_time" | "unknown";

export interface Classified<T> {
  value: T;
  /** "published" = taken from a source-provided field; "inferred" = classified by us from free text. */
  source: "published" | "inferred" | "unknown";
}

export function detectWorkMode(location: string | null | undefined, description: string, hint?: string | null): Classified<WorkMode> {
  const fromField = (s: string): WorkMode | null => {
    if (/\bhybrid\b/i.test(s)) return "hybrid";
    if (/\bon[- ]?site\b|\bin[- ]office\b/i.test(s)) return "onsite";
    if (/\bremote\b|\bwork from (?:home|anywhere)\b|\banywhere\b|\bworldwide\b/i.test(s)) return "remote";
    return null;
  };
  if (hint) {
    const h = hint.toLowerCase();
    if (h.includes("hybrid")) return { value: "hybrid", source: "published" };
    if (h.includes("remote")) return { value: "remote", source: "published" };
    if (h.includes("on-site") || h.includes("onsite") || h.includes("on_site")) return { value: "onsite", source: "published" };
  }
  const loc = location ? fromField(location) : null;
  if (loc) return { value: loc, source: "published" };
  if (/\bhybrid (?:role|position|work|model|schedule|setup|environment)\b|\b\d\s*days?\s*(?:a|per)?\s*(?:week\s*)?(?:in|at)\s*(?:the\s*)?office\b/i.test(description)) return { value: "hybrid", source: "inferred" };
  if (/\bon[- ]?site (?:role|position|only)\b|\bin[- ]office (?:role|position)\b|\bmust (?:work|be) (?:on[- ]?site|in[- ]office)\b/i.test(description)) return { value: "onsite", source: "inferred" };
  if (/\b(?:fully|100%|completely|entirely)\s+remote\b|\bremote[- ]first\b|\bthis is a remote (?:role|position|job|opportunity)\b|\bwork from anywhere\b/i.test(description)) return { value: "remote", source: "inferred" };
  return { value: "unknown", source: "unknown" };
}

/** Seniority is read from the title only; descriptions are too noisy. */
export function detectSeniority(title: string): Seniority {
  const t = title.toLowerCase();
  if (/\b(?:engineering manager|manager|director|head of|vp|vice president|chief)\b/.test(t)) return "manager";
  if (/\barchitect\b/.test(t)) return "architect";
  if (/\bprincipal\b/.test(t)) return "principal";
  if (/\bstaff\b/.test(t)) return "staff";
  if (/\b(?:tech(?:nical)? lead|team lead|lead)\b/.test(t)) return "lead";
  if (/\b(?:senior|sr\.?)\b|\b(?:iii|iv|3|4)\b$/.test(t)) return "senior";
  if (/\bintern(?:ship)?\b|\bapprentice\b|\bworking student\b/.test(t)) return "intern";
  if (/\b(?:junior|jr\.?|entry[- ]level|graduate|associate|trainee)\b|\b(?:i|1)\b$/.test(t)) return "junior";
  if (/\b(?:ii|2)\b$/.test(t)) return "mid";
  return "unspecified";
}

export function detectEmploymentType(structured: string | null | undefined, description: string): EmploymentType {
  const norm = (s: string): EmploymentType | null => {
    const x = s.toLowerCase();
    if (/intern|apprentic/.test(x)) return "internship";
    if (/contract|temporary|temp\b|freelance|fixed[- ]term|consult/.test(x)) return "contract";
    if (/part[- ]?time/.test(x)) return "part_time";
    if (/full[- ]?time|permanent|regular/.test(x)) return "full_time";
    return null;
  };
  if (structured) {
    const n = norm(structured);
    if (n) return n;
  }
  const d = description;
  if (/\b(?:\d+[- ]month contract|contract (?:role|position|basis|opportunity)|contractor|freelance|fixed[- ]term)\b/i.test(d)) return "contract";
  if (/\b(?:internship|intern\b|apprenticeship)\b/i.test(d)) return "internship";
  if (/\bpart[- ]time\b/i.test(d)) return "part_time";
  if (/\bfull[- ]time\b/i.test(d)) return "full_time";
  return "unknown";
}
