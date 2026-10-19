export interface Salary {
  min: number;
  max: number;
  currency: string;
  period: "year" | "month" | "hour" | null;
  /** The matched text, kept as evidence that this is a published figure. */
  evidence: string;
}

const CUR = "US\\$|USD|\\$|€|EUR|£|GBP|PKR|Rs\\.?|INR|₹|CAD|CA\\$|AUD|AED|SAR|CHF|PLN|SEK|NOK|DKK";
const NUM = "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?";
const RANGE = new RegExp(`(${CUR})\\s?(${NUM})\\s?(k)?\\s*(?:-|–|—|to)\\s*(?:(?:${CUR})\\s?)?(${NUM})\\s?(k)?`, "i");

const CURRENCY_MAP: Record<string, string> = {
  "$": "USD", "us$": "USD", usd: "USD", "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP", pkr: "PKR", rs: "PKR", "rs.": "PKR",
  inr: "INR", "₹": "INR", cad: "CAD", "ca$": "CAD", aud: "AUD", aed: "AED", sar: "SAR", chf: "CHF", pln: "PLN", sek: "SEK", nok: "NOK", dkk: "DKK",
};

function toNumber(raw: string, k: string | undefined): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  return k ? n * 1000 : n;
}

/** Parse a published salary *range* from free text. Returns null when no range is published (never guesses). */
export function extractSalary(text: string): Salary | null {
  const m = RANGE.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
  if (/^\s*(?:million|billion|mm\b|bn\b|m\b)/i.test(after)) return null; // e.g. "$50-100 million revenue"
  let min = toNumber(m[2], m[3]);
  let max = toNumber(m[4], m[5] ?? m[3]);
  // "$120-150k": the k applies to both sides
  if (!m[3] && m[5] && min < 1000) min = min * 1000;
  if (!(min > 0 && max >= min)) return null;
  const currency = CURRENCY_MAP[m[1].toLowerCase()] ?? m[1].toUpperCase();
  const ctx = (text.slice(Math.max(0, m.index - 20), m.index) + " " + after).toLowerCase();
  let period: Salary["period"] = null;
  if (/(per|a|\/)\s*(?:year|yr|annum)|annual|yearly|p\.a\./.test(ctx)) period = "year";
  else if (/(per|a|\/)\s*month|monthly/.test(ctx)) period = "month";
  else if (/(per|a|\/)\s*(?:hour|hr)|hourly/.test(ctx)) period = "hour";
  // Implausibly small yearly numbers (e.g. "$5 - $10") are not salaries.
  if (max < 100) return null;
  return { min, max, currency, period, evidence: m[0] };
}
