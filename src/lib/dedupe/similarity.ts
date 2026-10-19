export interface DedupeView {
  company: string;
  title: string;
  locationRaw: string | null;
  description: string;
  canonicalUrl: string;
}

export type PairVerdict = "duplicate" | "review" | "distinct";
export interface PairResult {
  verdict: PairVerdict;
  similarity: number;
  reason: string;
}

const COMPANY_SUFFIX = /\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pvt|private|pte|sa|ag|bv|oy|ab)\b\.?/g;

export function normalizeCompany(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

const TITLE_SYNONYMS: Record<string, string> = { developer: "engineer", programmer: "engineer", sr: "senior", jr: "junior", swe: "engineer", "back-end": "backend", "front-end": "frontend" };
const TITLE_STOP = new Set(["software", "the", "a", "an", "of", "and", "-", "–", "remote", "hybrid", "m", "f", "d", "w"]);

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop "(Remote)", "(Lahore)" tags
    .replace(/back[- ]end/g, "backend")
    .replace(/front[- ]end/g, "frontend")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => TITLE_SYNONYMS[t] ?? t)
    .filter((t) => !TITLE_STOP.has(t));
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function titleSimilarity(a: string, b: string): number {
  return jaccard(new Set(titleTokens(a)), new Set(titleTokens(b)));
}

function shingles(text: string, n = 4, maxChars = 5000): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, Math.ceil(maxChars / 5));
  const out = new Set<string>();
  if (words.length < n) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

export function descriptionSimilarity(a: string, b: string): number {
  return jaccard(shingles(a), shingles(b));
}

export function locationKey(loc: string | null | undefined): string {
  return (loc ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !["remote", "hybrid", "onsite", "on", "site"].includes(w)).sort().join(" ");
}

function sameLocation(a: string | null, b: string | null): boolean {
  const ka = locationKey(a);
  const kb = locationKey(b);
  if (ka === kb) return true;
  // Unknown on one side is not evidence of difference.
  return !ka || !kb;
}

/** Decide whether two job records describe the same posting. Conservative: ambiguous cases go to human review. */
export function classifyPair(a: DedupeView, b: DedupeView): PairResult {
  if (a.canonicalUrl && a.canonicalUrl === b.canonicalUrl) return { verdict: "duplicate", similarity: 1, reason: "Same canonical URL" };
  if (normalizeCompany(a.company) !== normalizeCompany(b.company)) return { verdict: "distinct", similarity: 0, reason: "Different company" };
  const t = titleSimilarity(a.title, b.title);
  if (t < 0.8) return { verdict: "distinct", similarity: t * 0.5, reason: "Titles differ" };
  if (!sameLocation(a.locationRaw, b.locationRaw)) return { verdict: "distinct", similarity: t * 0.5, reason: "Different location (separate opening)" };
  const thin = a.description.length < 100 || b.description.length < 100;
  if (thin) return { verdict: "review", similarity: t * 0.6, reason: "Same company, title and location but a description is missing" };
  const d = descriptionSimilarity(a.description, b.description);
  const sim = Math.round((0.4 * t + 0.6 * d) * 1000) / 1000;
  if (t >= 0.9 && d >= 0.8) return { verdict: "duplicate", similarity: sim, reason: `Same company/title/location, description ${(d * 100).toFixed(0)}% similar` };
  if (d >= 0.4) return { verdict: "review", similarity: sim, reason: `Similar title and location, description ${(d * 100).toFixed(0)}% similar` };
  return { verdict: "distinct", similarity: sim, reason: "Descriptions differ" };
}
