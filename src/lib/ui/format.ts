export const fmtDate = (iso: string | null | undefined, tz = "Asia/Karachi") =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium" }).format(new Date(iso)) : "—";

export const fmtDateTime = (iso: string | null | undefined, tz = "Asia/Karachi") =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function salaryText(j: { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; salaryPeriod: string | null }): string | null {
  if (j.salaryMin === null && j.salaryMax === null) return null;
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const range = j.salaryMin !== null && j.salaryMax !== null && j.salaryMin !== j.salaryMax ? `${f(j.salaryMin)}–${f(j.salaryMax)}` : f((j.salaryMin ?? j.salaryMax) as number);
  return `${j.salaryCurrency ?? ""} ${range}${j.salaryPeriod ? ` / ${j.salaryPeriod}` : ""}`.trim();
}

export const BAND_LABEL: Record<string, string> = { high: "High", good: "Good", review: "Review", low: "Low" };
export const ELIG_LABEL: Record<string, string> = { eligible: "Eligible", potential: "Potentially eligible", ineligible: "Ineligible" };
