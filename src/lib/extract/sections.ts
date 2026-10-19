export type Section = "requirements" | "preferred" | "responsibilities" | "other" | "intro";

export interface SectionLine {
  section: Section;
  line: string;
}

const OTHER = /^(?:benefits|perks|about (?:us|the company|our)|who we are|our (?:company|values|mission|culture|story)|compensation|salary|why (?:join|work|you)|how to apply|equal opportunit|what we offer|life at|diversity|privacy|location)\b/i;
const PREF = /\b(?:nice[- ]to[- ]haves?|preferred|bonus(?: points)?|good to have|desirable|a plus|extra credit|what (?:will )?sets? you apart|ideal(?:ly)?)\b/i;
const REQ = /^(?:(?:minimum|basic|key|required|core|essential)\s+)?(?:requirements?|qualifications?|what you(?:'ll| will)? (?:bring|need|have)|who you are|you have|you are|must[- ]haves?|about you|skills(?: (?:and|&) experience)?|your (?:background|profile|experience|skills)|what we(?:'re| are) looking for|experience|ideal candidate|technical skills)\b/i;
const RESP = /^(?:responsibilities|what you(?:'ll| will) (?:do|be doing|work on)|the role|about the (?:role|job|position|team)|your (?:role|impact|mission)|in this role|key duties|day[- ]to[- ]day|duties|what you(?:'ll| will) own|the opportunity)\b/i;
const INLINE_PREF = /\b(?:nice[- ]to[- ]have|is a plus|are a plus|a plus|would be a plus|bonus|preferred|desirable|good to have|ideally|big plus)\b/i;

function isHeader(line: string): boolean {
  if (line.length > 80 || line.startsWith("-")) return false;
  if (/[.!?]$/.test(line) && !/:$/.test(line)) return false;
  return true;
}

/** Split description text into lines annotated with the section they sit in. */
export function parseSections(text: string): SectionLine[] {
  const out: SectionLine[] = [];
  let current: Section = "intro";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeader(line)) {
      const h = line.replace(/:$/, "");
      if (OTHER.test(h)) {
        current = "other";
        continue;
      }
      if (PREF.test(h) && h.length <= 60) {
        current = "preferred";
        continue;
      }
      if (REQ.test(h)) {
        current = "requirements";
        continue;
      }
      if (RESP.test(h)) {
        current = "responsibilities";
        continue;
      }
    }
    let section = current;
    if ((section === "requirements" || section === "responsibilities" || section === "intro") && INLINE_PREF.test(line)) section = "preferred";
    out.push({ section, line });
  }
  return out;
}
