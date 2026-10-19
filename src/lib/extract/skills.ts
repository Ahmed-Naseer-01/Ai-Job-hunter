import { TAXONOMY, type SkillGroup } from "./taxonomy";
import { parseSections, type Section } from "./sections";
import { truncate } from "./text";

export interface SkillHit {
  id: string;
  label: string;
  group: SkillGroup;
  section: Section | "title";
  /** The sentence the skill was found in. Evidence for every match. */
  evidence: string;
}

export interface SkillExtraction {
  required: SkillHit[];
  preferred: SkillHit[];
  /** Mentioned only outside requirements (e.g. company blurb). Never scored. */
  mentioned: SkillHit[];
}

const EXPERIENCE_CUE = /\b(?:experience|proficien\w*|knowledge|expertise|skilled|strong|hands-on|familiar\w*|background|working with|understanding|ability to|comfortable)\b/i;

function matchSkills(text: string): { id: string; label: string; group: SkillGroup }[] {
  const hits: { id: string; label: string; group: SkillGroup }[] = [];
  for (const def of TAXONOMY) {
    if (def.patterns.some((p) => p.test(text))) hits.push({ id: def.id, label: def.label, group: def.group });
  }
  return hits;
}

const RANK = { required: 3, preferred: 2, mentioned: 1 } as const;
type Kind = keyof typeof RANK;

/**
 * Extract skills from a job description + title and classify each as required / preferred / mentioned.
 * Classification is driven by the section the text sits in; generic repeated terms in marketing text
 * ("About us") land in `mentioned` and are never scored.
 */
export function extractSkills(description: string, title: string): SkillExtraction {
  const best = new Map<string, { kind: Kind; hit: SkillHit }>();
  const consider = (kind: Kind, hit: SkillHit) => {
    const cur = best.get(hit.id);
    if (!cur || RANK[kind] > RANK[cur.kind]) best.set(hit.id, { kind, hit });
  };

  for (const m of matchSkills(title)) {
    consider("required", { ...m, section: "title", evidence: truncate(title, 200) });
  }
  for (const { section, line } of parseSections(description)) {
    const found = matchSkills(line);
    if (!found.length) continue;
    let kind: Kind;
    switch (section) {
      case "requirements":
        kind = "required";
        break;
      case "preferred":
        kind = "preferred";
        break;
      case "responsibilities":
      case "intro":
        kind = EXPERIENCE_CUE.test(line) || section === "responsibilities" ? "required" : "mentioned";
        break;
      default:
        kind = "mentioned";
    }
    for (const m of found) consider(kind, { ...m, section, evidence: truncate(line.replace(/^-\s*/, ""), 200) });
  }

  const out: SkillExtraction = { required: [], preferred: [], mentioned: [] };
  for (const { kind, hit } of best.values()) {
    (kind === "required" ? out.required : kind === "preferred" ? out.preferred : out.mentioned).push(hit);
  }
  return out;
}
