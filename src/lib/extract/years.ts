import { parseSections } from "./sections";

export interface YearsExtraction {
  /** Largest "minimum years" figure found in required context, or null if the posting states none. */
  min: number | null;
  /** Years mentioned only as preferred. */
  preferred: number | null;
  mentions: { years: number; line: string; kind: "required" | "preferred" }[];
}

const RANGE = /(\d{1,2})\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
const AT_LEAST = /(?:at least|minimum(?: of)?|min\.?|over|more than)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
const PLAIN = /(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)/gi;
const NOT_EXPERIENCE = /\b(?:years? old|years? ago|since \d{4}|founded|in business|for over \d+ years)\b/i;

function yearsIn(line: string): number[] {
  const nums: number[] = [];
  const consumed = new Set<number>();
  for (const re of [RANGE, AT_LEAST, PLAIN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (consumed.has(m.index)) continue;
      // mark the span so the PLAIN regex does not re-read digits already consumed
      for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
      const n = Number(m[1]); // for ranges, the lower bound is the minimum
      if (n >= 0 && n <= 30) nums.push(n);
    }
  }
  return nums;
}

export function extractYears(text: string): YearsExtraction {
  const mentions: YearsExtraction["mentions"] = [];
  for (const { section, line } of parseSections(text)) {
    if (section === "other") continue;
    if (NOT_EXPERIENCE.test(line)) continue;
    const inRequirements = section === "requirements";
    if (!inRequirements && section !== "preferred" && !/experience/i.test(line)) continue;
    for (const years of yearsIn(line)) {
      mentions.push({ years, line: line.slice(0, 200), kind: section === "preferred" ? "preferred" : "required" });
    }
  }
  const req = mentions.filter((m) => m.kind === "required").map((m) => m.years);
  const pref = mentions.filter((m) => m.kind === "preferred").map((m) => m.years);
  return {
    min: req.length ? Math.max(...req) : null,
    preferred: pref.length ? Math.max(...pref) : null,
    mentions,
  };
}
