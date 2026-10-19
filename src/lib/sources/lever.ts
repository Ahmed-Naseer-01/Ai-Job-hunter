import { z } from "zod";
import { getJson } from "./http";
import { NormalizedJobInputSchema, type NormalizedJobInput } from "../jobs/types";
import { htmlToText } from "../extract/text";
import type { FetchResult, SourceAdapter } from "./types";

const ConfigSchema = z.object({
  /** Site name from jobs.lever.co/<site>. */
  site: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Site may only contain letters, digits, '-' and '_'"),
  region: z.enum(["global", "eu"]).default("global"),
  companyName: z.string().max(200).optional(),
  titleKeywords: z.array(z.string().max(80)).max(50).optional(),
});
export type LeverConfig = z.infer<typeof ConfigSchema>;

const LeverPosting = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      commitment: z.string().nullish(),
      department: z.string().nullish(),
      location: z.string().nullish(),
      team: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  descriptionPlain: z.string().nullish(),
  description: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additionalPlain: z.string().nullish(),
  additional: z.string().nullish(),
  salaryRange: z
    .object({ currency: z.string().nullish(), interval: z.string().nullish(), min: z.number().nullish(), max: z.number().nullish() })
    .nullish(),
});

export type LeverPostingRaw = z.infer<typeof LeverPosting>;
export const parseLeverPosting = (raw: unknown) => LeverPosting.safeParse(raw);

/** Map one Lever posting to our normalised input. Shared by the scheduled adapter and single-URL import. */
export function leverToInput(j: LeverPostingRaw, sourceKey: string, company: string): NormalizedJobInput {
  const parts = [j.descriptionPlain ?? htmlToText(j.description)];
  for (const l of j.lists ?? []) {
    // Keep the list heading ("Requirements") directly above its bullets so section parsing works.
    parts.push([l.text ?? "", l.content ? htmlToText(l.content) : ""].filter(Boolean).join("\n"));
  }
  parts.push(j.additionalPlain ?? htmlToText(j.additional));
  const locs = j.categories?.allLocations?.filter(Boolean) ?? [];
  const sr = j.salaryRange;
  return {
    sourceKey,
    sourceKind: "lever",
    sourceJobId: j.id,
    title: j.text,
    company,
    applyUrl: j.hostedUrl,
    descriptionText: parts.filter(Boolean).join("\n\n"),
    locationRaw: locs.length > 1 ? locs.join("; ") : (j.categories?.location ?? locs[0] ?? null),
    workModeHint: j.workplaceType ?? null,
    employmentTypeHint: j.categories?.commitment ?? null,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    salary: sr && (sr.min != null || sr.max != null) ? { min: sr.min ?? null, max: sr.max ?? null, currency: sr.currency ?? null, period: intervalToPeriod(sr.interval) } : null,
  };
}

export const leverHost = (region: "global" | "eu") => (region === "eu" ? "https://api.eu.lever.co" : "https://api.lever.co");

function intervalToPeriod(i?: string | null): "year" | "month" | "hour" | null {
  if (!i) return null;
  if (/year/i.test(i)) return "year";
  if (/month/i.test(i)) return "month";
  if (/hour/i.test(i)) return "hour";
  return null;
}

export const leverAdapter: SourceAdapter<LeverConfig> = {
  kind: "lever",
  info: {
    kind: "lever",
    title: "Lever Postings API",
    scheduled: true,
    setup: "Add a source with the Lever site name (the <site> in jobs.lever.co/<site>). Use region 'eu' for api.eu.lever.co accounts.",
    access: "Public, unauthenticated GET endpoint documented at github.com/lever/postings-api. Returns only postings the employer published.",
    limits: "No published hard rate limit for public postings; one request per site per run, exponential backoff on 429/5xx.",
    attribution: "Keep hostedUrl as the application link. Content belongs to the employer; stored for personal matching only.",
    fields: ["id", "text (title)", "categories.location/commitment/department/team", "workplaceType", "createdAt", "hostedUrl", "descriptionPlain", "lists", "additionalPlain", "salaryRange (when published)"],
    docsUrl: "https://github.com/lever/postings-api",
  },
  configSchema: ConfigSchema,
  sourceKey: (c) => `lever:${c.site.toLowerCase()}`,

  async fetchJobs(config, ctx): Promise<FetchResult> {
    const url = `${leverHost(config.region)}/v0/postings/${encodeURIComponent(config.site)}?mode=json`;
    const { status, data } = await getJson(url, ctx);
    if (!Array.isArray(data)) throw new Error("Lever returned an unexpected response shape (expected an array of postings)");
    const key = leverAdapter.sourceKey(config);
    const jobs: NormalizedJobInput[] = [];
    const seenIds: string[] = [];
    let skipped = 0;
    for (const raw of data) {
      const p = LeverPosting.safeParse(raw);
      if (!p.success) {
        skipped++;
        continue;
      }
      const j = p.data;
      seenIds.push(j.id);
      const candidate = leverToInput(j, key, config.companyName || config.site);
      if (NormalizedJobInputSchema.safeParse(candidate).success) jobs.push(candidate);
      else skipped++;
    }
    return { jobs, complete: true, httpStatus: status, totalListed: data.length, seenIds, notes: skipped ? [`Skipped ${skipped} posting(s) that failed validation`] : [] };
  },

  async verifyJob(config, sourceJobId, ctx) {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(sourceJobId)) return { open: null, evidence: "Unexpected Lever posting id format", httpStatus: null };
    const url = `${leverHost(config.region)}/v0/postings/${encodeURIComponent(config.site)}/${sourceJobId}`;
    try {
      const { status } = await getJson(url, ctx, [404, 410]);
      if (status === 404 || status === 410) return { open: false, evidence: `GET ${url} → HTTP ${status}`, httpStatus: status };
      return { open: true, evidence: `GET ${url} → HTTP ${status}`, httpStatus: status };
    } catch (e: any) {
      return { open: null, evidence: `Verification failed: ${e?.message ?? e}`, httpStatus: e?.status ?? null };
    }
  },
};
