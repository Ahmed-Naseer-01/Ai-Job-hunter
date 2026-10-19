const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", bull: "•", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™", middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * Convert (possibly entity-encoded) HTML to plain text. The output never contains markup and is
 * treated everywhere as untrusted data: it is only ever displayed (escaped) or pattern-matched.
 */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // Greenhouse returns HTML as entity-encoded text (&lt;p&gt;...). Decode once to get real tags.
  if (/&lt;\/?[a-z]/i.test(s) && !/<\/?[a-z][^>]*>/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|tr|section|article|table|blockquote)\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6]|ul|ol|tr|section|article|table|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}
