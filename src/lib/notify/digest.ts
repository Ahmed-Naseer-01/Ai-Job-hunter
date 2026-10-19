import { sha256 } from "../util";

export interface DigestItem {
  jobId: string;
  title: string;
  company: string;
  applyUrl: string;
  locationRaw: string | null;
  salaryText: string | null;
  postedAt: string | null;
  score: number;
  band: string;
  eligibility: "eligible" | "potential" | "ineligible";
  reasons: string[];
  missing: string[];
  verdict: string;
  /** Why this appears in the digest: new / changed / reminder. */
  reason: "new" | "changed" | "reminder";
  synthetic?: boolean;
}

export interface Digest {
  subject: string;
  html: string;
  text: string;
  jobIds: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeUrl = (u: string): string | null => (/^https?:\/\//i.test(u) ? u : null);

const ELIG_LABEL = { eligible: "Eligible", potential: "Potentially eligible — confirm first", ineligible: "Ineligible" } as const;
const BAND_LABEL: Record<string, string> = { high: "High priority", good: "Good match", review: "Review manually", low: "Low priority" };
const REASON_LABEL = { new: "New", changed: "Updated", reminder: "Reminder" } as const;

/** Fingerprint of the facts a user cares about. Same fingerprint => same notification already sent. */
export function notificationFingerprint(j: { id: string; band: string; eligibility: string; salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; locationRaw: string | null; canonicalUrl: string; title: string; status: string }): string {
  return sha256(JSON.stringify([j.id, j.title, j.band, j.eligibility, j.salaryMin, j.salaryMax, j.salaryCurrency, j.locationRaw, j.canonicalUrl, j.status]));
}

export function formatSalary(min: number | null, max: number | null, cur: string | null, period: string | null): string | null {
  if (min === null && max === null) return null;
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const range = min !== null && max !== null && min !== max ? `${f(min)}–${f(max)}` : f((min ?? max) as number);
  return `${cur ?? ""} ${range}${period ? ` / ${period}` : ""}`.trim();
}

export function buildDigest(items: DigestItem[], o: { dashboardUrl: string; now: Date; label?: string }): Digest {
  const date = o.now.toISOString().slice(0, 10);
  const prefix = o.label ? `[${o.label}] ` : "";
  const subject = `${prefix}Job Hunter: ${items.length} job${items.length === 1 ? "" : "s"} worth a look (${date})`;
  const base = o.dashboardUrl.replace(/\/+$/, "");

  const textParts: string[] = [`${prefix}Your daily job digest — ${date}`, ""];
  const htmlParts: string[] = [];
  items.forEach((j, i) => {
    const apply = safeUrl(j.applyUrl);
    const dash = `${base}/jobs/${encodeURIComponent(j.jobId)}`;
    const salary = j.salaryText ?? "Not published";
    const posted = j.postedAt ? j.postedAt.slice(0, 10) : "Not stated";
    const tag = j.synthetic ? " [SYNTHETIC SAMPLE]" : "";
    textParts.push(
      `${i + 1}. ${j.title} — ${j.company}${tag}`,
      `   [${REASON_LABEL[j.reason]}] Score ${Math.round(j.score)} (${BAND_LABEL[j.band] ?? j.band}) · ${ELIG_LABEL[j.eligibility]}`,
      `   Location: ${j.locationRaw ?? "Not stated"} · Salary: ${salary} · Posted: ${posted}`,
      ...j.reasons.slice(0, 4).map((r) => `   + ${r}`),
      ...(j.missing.length ? [`   Missing mandatory: ${j.missing.slice(0, 6).join(", ")}`] : ["   Missing mandatory: none identified"]),
      `   Apply: ${apply ?? "(link unavailable)"}`,
      `   Details: ${dash}`,
      "",
    );
    htmlParts.push(`
<tr><td style="padding:16px 0;border-bottom:1px solid #e5e7eb">
  <div style="font-size:12px;color:#6b7280">${esc(REASON_LABEL[j.reason])}${j.synthetic ? " · SYNTHETIC SAMPLE" : ""}</div>
  <div style="font-size:16px;font-weight:600"><a href="${esc(dash)}" style="color:#111827;text-decoration:none">${esc(j.title)}</a> <span style="font-weight:400;color:#374151">— ${esc(j.company)}</span></div>
  <div style="margin:6px 0"><strong>Score ${Math.round(j.score)}</strong> (${esc(BAND_LABEL[j.band] ?? j.band)}) · ${esc(ELIG_LABEL[j.eligibility])}</div>
  <div style="color:#374151;font-size:13px">Location: ${esc(j.locationRaw ?? "Not stated")} · Salary: ${esc(salary)} · Posted: ${esc(posted)}</div>
  <ul style="margin:8px 0;padding-left:18px;color:#111827">${j.reasons.slice(0, 4).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  <div style="font-size:13px;color:#92400e">Missing mandatory: ${j.missing.length ? esc(j.missing.slice(0, 6).join(", ")) : "none identified"}</div>
  <div style="margin-top:8px;font-size:13px">${apply ? `<a href="${esc(apply)}">Original application link</a>` : "Application link unavailable"} · <a href="${esc(dash)}">Open in dashboard</a></div>
</td></tr>`);
  });
  textParts.push(`Dashboard: ${base}`, "", "You are receiving this because you enabled the daily digest. No applications are submitted automatically.");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;padding:16px;color:#111827">
<h2 style="margin:0 0 4px">${esc(prefix)}Your daily job digest</h2><div style="color:#6b7280;margin-bottom:8px">${esc(date)} · ${items.length} job${items.length === 1 ? "" : "s"}</div>
<table style="width:100%;border-collapse:collapse">${htmlParts.join("")}</table>
<p style="color:#6b7280;font-size:12px;margin-top:16px"><a href="${esc(base)}">Open dashboard</a> · No applications are submitted automatically.</p></body></html>`;
  return { subject, html, text: textParts.join("\n"), jobIds: items.map((i) => i.jobId) };
}
