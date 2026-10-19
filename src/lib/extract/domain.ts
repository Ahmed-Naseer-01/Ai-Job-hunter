export type Domain = "telecom" | "payments" | "transaction-processing";

const DOMAINS: { id: Domain; patterns: RegExp[] }[] = [
  {
    id: "telecom",
    patterns: [/\btelecom(?:munications?)?\b/i, /\btelco\b/i, /\bmobile (?:network )?operators?\b/i, /\bairtime\b/i, /\btop[- ]?ups?\b/i, /\brecharge\b/i, /\bprepaid\b/i, /\bussd\b/i, /\boss\/?bss\b/i, /\bsms gateway\b/i, /\b(?:mno|mvno)\b/i, /\bcarrier billing\b/i],
  },
  {
    id: "payments",
    patterns: [/\bpayments?\b/i, /\bfintech\b/i, /\bbanking\b/i, /\bbilling\b/i, /\bledger\b/i, /\bwallets?\b/i, /\bmobile money\b/i, /\bremittances?\b/i, /\bcard (?:issuing|processing)\b/i],
  },
  {
    id: "transaction-processing",
    patterns: [/transaction processing/i, /high[- ]throughput/i, /\btps\b/i, /real[- ]time (?:processing|transactions?)/i, /\bhigh[- ]volume transactions?\b/i],
  },
];

export function extractDomains(text: string): Domain[] {
  return DOMAINS.filter((d) => d.patterns.some((p) => p.test(text))).map((d) => d.id);
}

/** True when the posting describes Java/Spring upgrade, migration or modernisation work. */
export function detectModernization(text: string): boolean {
  const sentences = text.split(/[.\n]/);
  return sentences.some(
    (s) =>
      /\b(?:migrat\w*|upgrad\w*|moderni[sz]\w*|re-?platform\w*|re-?architect\w*|legacy)\b/i.test(s) &&
      /\b(?:java|jdk|jvm|spring|monolith|microservices?)\b/i.test(s),
  );
}
