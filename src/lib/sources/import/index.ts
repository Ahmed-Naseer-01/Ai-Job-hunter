import { NormalizedJobInputSchema, type NormalizedJobInput } from "../../jobs/types";
import { canonicalizeUrl } from "../../dedupe/url";
import { sha256 } from "../../util";
import { csvToRecords } from "./csv";
import { extractLinks, parseEml } from "./eml";
import { getJson } from "../http";
import { withRetry } from "../retry";
import { GREENHOUSE_API, ghToInput, parseGhJob } from "../greenhouse";
import { leverHost, leverToInput, parseLeverPosting } from "../lever";
import type { FetchContext } from "../types";

export const IMPORT_KINDS = ["json", "csv", "eml", "urls"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const MAX_IMPORT_BYTES = 2_000_000;
const MAX_ITEMS = 500;

export interface ParsedImport {
  kind: ImportKind;
  items: NormalizedJobInput[];
  rejected: { row: string; reason: string }[];
  notes: string[];
}

const BOOKMARK_NOTE = "[Bookmark only — the posting text was NOT fetched. Open the link to read the full description; this entry has low confidence until you add details.]";

// ---------- field aliasing ----------
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string[]> = {
  title: ["title", "jobtitle", "position", "role", "name", "jobname"],
  company: ["company", "companyname", "employer", "organization", "organisation", "firm"],
  url: ["url", "link", "applyurl", "joburl", "applicationlink", "applylink", "posting", "postingurl", "href", "jobposting"],
  description: ["description", "jobdescription", "details", "summary", "body", "text", "content", "descriptiontext"],
  location: ["location", "city", "place", "locations", "region", "country"],
  postedAt: ["postedat", "posted", "dateposted", "date", "published", "publisheddate", "postingdate", "createdat"],
  deadlineAt: ["deadline", "deadlineat", "closingdate", "applyby", "expires"],
  salary: ["salary", "compensation", "pay", "salaryrange", "remuneration"],
  employmentType: ["employmenttype", "type", "jobtype", "commitment", "contracttype"],
  workMode: ["workmode", "worktype", "remote", "workplace", "workplacetype", "remotepolicy"],
  id: ["id", "jobid", "sourcejobid", "reference", "ref", "requisitionid", "reqid"],
};

function pick(rec: Record<string, unknown>, field: keyof typeof ALIASES): string | null {
  const byNorm = new Map(Object.entries(rec).map(([k, v]) => [norm(k), v]));
  for (const a of ALIASES[field]) {
    const v = byNorm.get(a);
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? "" : String(v);
    if (s.trim()) return s.trim();
  }
  return null;
}

/** Strip tracking/session noise; collapse known aggregator URLs to a stable identity. Never fetches anything. */
export function canonicalJobLink(raw: string): { url: string; kind: "linkedin" | "indeed" | "greenhouse" | "lever" | "other"; id?: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const m = /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/.exec(u.pathname) ?? /\/comm\/jobs\/view\/(\d{6,})/.exec(u.pathname);
    const cur = u.searchParams.get("currentJobId");
    const id = m?.[1] ?? (cur && /^\d{6,}$/.test(cur) ? cur : undefined);
    if (id) return { url: `https://www.linkedin.com/jobs/view/${id}/`, kind: "linkedin", id };
    return { url: canonicalizeUrl(raw), kind: "linkedin" };
  }
  if (host.endsWith("indeed.com")) {
    const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk");
    if (jk && /^[0-9a-f]{8,32}$/i.test(jk)) return { url: `https://${host}/viewjob?jk=${jk}`, kind: "indeed", id: jk };
  }
  const gh = /^(?:job-)?boards\.greenhouse\.io$/.exec(host) && /^\/([A-Za-z0-9_-]{1,100})\/jobs\/(\d+)/.exec(u.pathname);
  if (gh) return { url: `https://boards.greenhouse.io/${gh[1]}/jobs/${gh[2]}`, kind: "greenhouse", id: `${gh[1]}/${gh[2]}` };
  const lv = /^jobs(\.eu)?\.lever\.co$/.exec(host);
  const lm = lv && /^\/([A-Za-z0-9_-]{1,100})\/([A-Za-z0-9-]{8,64})/.exec(u.pathname);
  if (lv && lm) return { url: `https://${host}/${lm[1]}/${lm[2]}`, kind: "lever", id: `${lv[1] ? "eu:" : ""}${lm[1]}/${lm[2]}` };
  return { url: canonicalizeUrl(raw), kind: "other" };
}

const slugTitle = (u: string): { title: string | null; company: string | null } => {
  try {
    const seg = new URL(u).pathname.split("/").filter(Boolean).pop() ?? "";
    const base = decodeURIComponent(seg).replace(/-?\d{6,}.*$/, "").replace(/[-_]+/g, " ").trim();
    if (!base || /^\d+$/.test(base) || base.length < 4) return { title: null, company: null };
    const at = / at (.+)$/i.exec(base);
    const title = (at ? base.slice(0, at.index) : base).replace(/\b\w/g, (c) => c.toUpperCase());
    return { title, company: at ? at[1].replace(/\b\w/g, (c) => c.toUpperCase()) : null };
  } catch {
    return { title: null, company: null };
  }
};

/** ISO timestamp or undefined: unparseable dates stay unknown rather than being guessed. */
function isoDate(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) && t < Date.UTC(2100, 0, 1) ? new Date(t).toISOString() : undefined;
}

function fromRecord(rec: Record<string, unknown>, kind: ImportKind): NormalizedJobInput | { error: string } {
  const title = pick(rec, "title");
  const rawUrl = pick(rec, "url");
  if (!title) return { error: "missing title" };
  if (!rawUrl) return { error: "missing url (the original apply link is required)" };
  const link = canonicalJobLink(rawUrl);
  if (!link) return { error: `url is not a valid http(s) link: ${rawUrl.slice(0, 80)}` };
  const company = pick(rec, "company") ?? "Unknown company";
  let description = pick(rec, "description") ?? "";
  const salary = pick(rec, "salary");
  if (salary && !/salary|compensation/i.test(description)) description += `${description ? "\n\n" : ""}Salary: ${salary}`;
  const id = pick(rec, "id") ?? link.id ?? sha256(link.url).slice(0, 16);
  const item: NormalizedJobInput = {
    sourceKey: `import:${kind}`,
    sourceKind: `import-${kind}`,
    sourceJobId: id,
    title: title.slice(0, 300),
    company: company.slice(0, 200),
    applyUrl: link.url,
    descriptionText: (link.kind === "linkedin" && !description ? BOOKMARK_NOTE : description).slice(0, 200_000),
    locationRaw: pick(rec, "location"),
    workModeHint: pick(rec, "workMode"),
    employmentTypeHint: pick(rec, "employmentType"),
    postedAt: isoDate(pick(rec, "postedAt")),
    deadlineAt: isoDate(pick(rec, "deadlineAt")),
  };
  const ok = NormalizedJobInputSchema.safeParse(item);
  return ok.success ? item : { error: ok.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

function finish(kind: ImportKind, results: (NormalizedJobInput | { error: string })[], labels: string[], notes: string[] = []): ParsedImport {
  const items: NormalizedJobInput[] = [];
  const rejected: ParsedImport["rejected"] = [];
  const seen = new Set<string>();
  results.slice(0, MAX_ITEMS).forEach((r, i) => {
    if ("error" in r) return void rejected.push({ row: labels[i], reason: r.error });
    const key = canonicalizeUrl(r.applyUrl);
    if (seen.has(key)) return void rejected.push({ row: labels[i], reason: "duplicate link within this import" });
    seen.add(key);
    items.push(r);
  });
  if (results.length > MAX_ITEMS) notes.push(`Only the first ${MAX_ITEMS} of ${results.length} rows were read.`);
  return { kind, items, rejected, notes };
}

function guardSize(text: string) {
  if (text.length > MAX_IMPORT_BYTES) throw new Error(`Import is too large (limit ${MAX_IMPORT_BYTES / 1_000_000} MB)`);
}

// ---------- parsers ----------
export function parseJsonImport(text: string): ParsedImport {
  guardSize(text);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`Not valid JSON: ${e.message}`);
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? ((data as any).jobs ?? (data as any).results ?? (data as any).items ?? (data as any).data) : null;
  if (!Array.isArray(list)) throw new Error('Expected a JSON array of jobs, or an object with a "jobs" array');
  const results = list.map((r) => (r && typeof r === "object" ? fromRecord(r as Record<string, unknown>, "json") : { error: "not an object" }));
  return finish("json", results, list.map((_, i) => `#${i + 1}`));
}

export function parseCsvImport(text: string): ParsedImport {
  guardSize(text);
  const recs = csvToRecords(text);
  if (!recs.length) throw new Error("CSV needs a header row and at least one data row");
  return finish("csv", recs.map((r) => fromRecord(r, "csv")), recs.map((_, i) => `row ${i + 2}`));
}

const JOBISH_PATH = /(\/jobs?\/|\/careers?\/|\/viewjob|\/comm\/jobs\/|\/vacanc|\/positions?\/|\/opening|\/apply\b|gh_jid=|\/postings\/)/i;
const JOBISH_HOST = /(linkedin\.com|indeed\.com|greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|smartrecruiters\.com|glassdoor\.com|wellfound\.com|rozee\.pk|bayt\.com|remoteok\.com|weworkremotely\.com|himalayas\.app)/i;
const NOISE = /(unsubscribe|privacy|preferences|settings|help|terms|notification|view[-_ ]?in[-_ ]?browser|manage|feedback|blog|logo|\.(png|jpe?g|gif)(\?|$))/i;

export function parseEmlImport(text: string): ParsedImport {
  guardSize(text);
  const mail = parseEml(text);
  const links = extractLinks(mail.html, mail.text);
  const results: (NormalizedJobInput | { error: string })[] = [];
  const labels: string[] = [];
  const bestText = new Map<string, string>();
  const originals = new Map<string, string>(); // canonical -> first original link (its slug may carry the title)
  for (const l of links) {
    const c = canonicalJobLink(l.url);
    if (!c) continue;
    if (c.kind === "linkedin" && !c.id) continue; // unsubscribe, saved-search, settings, "see all jobs"...: not a specific job
    if (NOISE.test(l.url) && !JOBISH_HOST.test(l.url)) continue;
    if (!(c.kind !== "other" || JOBISH_HOST.test(c.url) || JOBISH_PATH.test(l.url))) continue;
    if (NOISE.test(l.text) && !l.text) continue;
    const prev = bestText.get(c.url);
    if (!originals.has(c.url)) originals.set(c.url, l.url);
    if (!prev || (l.text.length > prev.length && l.text.length < 140)) bestText.set(c.url, l.text);
  }
  const uniqueUrls = [...bestText.keys()];
  for (const url of uniqueUrls) {
    const label = (bestText.get(url) ?? "").replace(/\s+/g, " ").trim();
    const slug = slugTitle(originals.get(url) ?? url);
    const usable = label.length >= 5 && label.length <= 140 && !/^(view|apply|see|click|job|jobs|more|open)\b/i.test(label);
    const title = usable ? label : (slug.title ?? "Job from email alert");
    const r = fromRecord({ title, company: slug.company ?? "Unknown company", url, description: BOOKMARK_NOTE, id: undefined }, "eml");
    results.push(r);
    labels.push(url.slice(0, 90));
  }
  const notes = [`Email "${mail.subject.slice(0, 100)}" from ${mail.from.slice(0, 80) || "unknown sender"} — found ${uniqueUrls.length} job link(s). Links were NOT fetched.`];
  if (!uniqueUrls.length) notes.push("No job links recognised. Paste links in the “URLs” import instead.");
  if (mail.date) notes.push(`Email date: ${mail.date.slice(0, 10)}`);
  return finish("eml", results, labels, notes);
}

export interface UrlImportDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One URL per line, optionally `url | title | company`. Only Greenhouse and Lever links are fetched, and only from their
 * documented public APIs (host allowlist: SSRF-safe). Everything else, including every LinkedIn link, is saved as a bookmark
 * that is never requested.
 */
export async function parseUrlImport(text: string, deps: UrlImportDeps = {}): Promise<ParsedImport> {
  guardSize(text);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) throw new Error("Paste at least one URL (one per line)");
  const ctx: FetchContext = { fetch: deps.fetch ?? fetch, now: () => new Date(), log: () => {}, timeoutMs: deps.timeoutMs ?? 20_000 };
  const results: (NormalizedJobInput | { error: string })[] = [];
  const labels: string[] = [];
  const notes: string[] = [];
  let fetched = 0;
  let bookmarks = 0;
  for (const line of lines.slice(0, MAX_ITEMS)) {
    const [rawUrl, titleIn, companyIn] = line.split("|").map((s) => s.trim());
    labels.push(rawUrl.slice(0, 90));
    const c = canonicalJobLink(rawUrl);
    if (!c) {
      results.push({ error: "not a valid http(s) URL" });
      continue;
    }
    try {
      if (c.kind === "greenhouse") {
        const [token, id] = c.id!.split("/");
        const { value } = await withRetry(() => getJson(`${GREENHOUSE_API}/${token}/jobs/${id}`, ctx, [404, 410]), { retries: 1, baseMs: 400, maxMs: 2000, sleep: deps.sleep });
        if (value.status === 404 || value.status === 410) {
          results.push({ error: "Greenhouse reports this posting no longer exists (HTTP 404)" });
          continue;
        }
        const p = parseGhJob(value.data);
        if (!p.success) {
          results.push({ error: "Greenhouse returned an unexpected shape" });
          continue;
        }
        const item = ghToInput(p.data, `greenhouse:${token.toLowerCase()}`, p.data.company_name || companyIn || token);
        item.applyUrl = p.data.absolute_url || c.url;
        results.push(item);
        fetched++;
        continue;
      }
      if (c.kind === "lever") {
        const eu = c.id!.startsWith("eu:");
        const [site, id] = c.id!.replace(/^eu:/, "").split("/");
        const { value } = await withRetry(() => getJson(`${leverHost(eu ? "eu" : "global")}/v0/postings/${site}/${id}`, ctx, [404, 410]), { retries: 1, baseMs: 400, maxMs: 2000, sleep: deps.sleep });
        if (value.status === 404 || value.status === 410) {
          results.push({ error: "Lever reports this posting no longer exists (HTTP 404)" });
          continue;
        }
        const p = parseLeverPosting(value.data);
        if (!p.success) {
          results.push({ error: "Lever returned an unexpected shape" });
          continue;
        }
        results.push(leverToInput(p.data, `lever:${site.toLowerCase()}`, companyIn || site));
        fetched++;
        continue;
      }
    } catch (e: any) {
      results.push({ error: `Could not fetch from the public API: ${String(e?.message ?? e).slice(0, 120)}` });
      continue;
    }
    // Bookmark (LinkedIn, Indeed, company sites, anything else): never requested.
    const slug = slugTitle(rawUrl);
    const title = titleIn || slug.title;
    if (!title) {
      results.push({ error: "No title available. Add it after the URL: url | Job title | Company" });
      continue;
    }
    results.push(fromRecord({ title, company: companyIn || slug.company || "Unknown company", url: c.url, description: BOOKMARK_NOTE }, "urls"));
    bookmarks++;
  }
  notes.push(`${fetched} fetched from Greenhouse/Lever public APIs, ${bookmarks} saved as bookmarks (never fetched; LinkedIn is never contacted).`);
  if (lines.length > MAX_ITEMS) notes.push(`Only the first ${MAX_ITEMS} lines were read.`);
  return finish("urls", results, labels, notes);
}

export async function parseImport(kind: ImportKind, text: string, deps: UrlImportDeps = {}): Promise<ParsedImport> {
  switch (kind) {
    case "json":
      return parseJsonImport(text);
    case "csv":
      return parseCsvImport(text);
    case "eml":
      return parseEmlImport(text);
    case "urls":
      return parseUrlImport(text, deps);
  }
}
