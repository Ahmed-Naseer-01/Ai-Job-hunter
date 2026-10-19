import { z } from "zod";
import { getJson } from "./http";
import { NormalizedJobInputSchema, type NormalizedJobInput } from "../jobs/types";
import { htmlToText } from "../extract/text";
import type { FetchResult, SourceAdapter } from "./types";

const ConfigSchema = z.object({
  /** The board token from boards.greenhouse.io/<token>. Restricted charset prevents path injection. */
  boardToken: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Board token may only contain letters, digits, '-' and '_'"),
  companyName: z.string().max(200).optional(),
  titleKeywords: z.array(z.string().max(80)).max(50).optional(),
});
export type GreenhouseConfig = z.infer<typeof ConfigSchema>;

const GhJob = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  company_name: z.string().nullish(),
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
  pay_input_ranges: z
    .array(z.object({ min_cents: z.number().nullish(), max_cents: z.number().nullish(), currency_type: z.string().nullish() }))
    .nullish(),
});

const BASE = "https://boards-api.greenhouse.io/v1/boards";
export const GREENHOUSE_API = BASE;

export type GhJobRaw = z.infer<typeof GhJob>;
export const parseGhJob = (raw: unknown) => GhJob.safeParse(raw);

/** Map one Greenhouse posting to our normalised input. Shared by the scheduled adapter and single-URL import. */
export function ghToInput(j: GhJobRaw, sourceKey: string, company: string): NormalizedJobInput {
  const pay = j.pay_input_ranges?.find((r) => r.min_cents != null || r.max_cents != null);
  return {
    sourceKey,
    sourceKind: "greenhouse",
    sourceJobId: String(j.id),
    title: j.title,
    company,
    applyUrl: j.absolute_url,
    descriptionText: htmlToText(j.content),
    locationRaw: j.location?.name ?? null,
    postedAt: j.first_published ?? j.updated_at ?? null,
    updatedAt: j.updated_at ?? null,
    salary: pay
      ? { min: pay.min_cents != null ? pay.min_cents / 100 : null, max: pay.max_cents != null ? pay.max_cents / 100 : null, currency: pay.currency_type ?? null, period: null }
      : null,
  };
}


export const greenhouseAdapter: SourceAdapter<GreenhouseConfig> = {
  kind: "greenhouse",
  info: {
    kind: "greenhouse",
    title: "Greenhouse Job Board API",
    scheduled: true,
    setup: "Add a source with the company's board token (the <token> in boards.greenhouse.io/<token> or job-boards.greenhouse.io/<token>).",
    access: "Public, unauthenticated GET endpoints documented at developers.greenhouse.io/job-board.html. No API key. Only boards the employer has published.",
    limits: "No published hard rate limit for the Job Board API; this app makes one request per board per run (plus one per saved job for verification) and backs off on 429/5xx.",
    attribution: "Keep the original absolute_url as the application link. Content belongs to the employer; it is stored for personal matching only.",
    fields: ["id", "title", "absolute_url", "location.name", "updated_at", "first_published", "company_name", "content (HTML)", "departments", "pay_input_ranges (when published)"],
    docsUrl: "https://developers.greenhouse.io/job-board.html",
  },
  configSchema: ConfigSchema,
  sourceKey: (c) => `greenhouse:${c.boardToken.toLowerCase()}`,

  async fetchJobs(config, ctx): Promise<FetchResult> {
    const url = `${BASE}/${encodeURIComponent(config.boardToken)}/jobs?content=true`;
    const { status, data } = await getJson(url, ctx);
    const top = z.object({ jobs: z.array(z.unknown()) }).safeParse(data);
    if (!top.success) throw new Error("Greenhouse returned an unexpected response shape (missing `jobs` array)");

    const key = greenhouseAdapter.sourceKey(config);
    const jobs: NormalizedJobInput[] = [];
    const seenIds: string[] = [];
    let skipped = 0;
    for (const raw of top.data.jobs) {
      const p = GhJob.safeParse(raw);
      if (p.success) seenIds.push(String(p.data.id));
      if (!p.success) {
        skipped++;
        continue;
      }
      const j = p.data;
      const candidate = ghToInput(j, key, j.company_name || config.companyName || config.boardToken);
      if (NormalizedJobInputSchema.safeParse(candidate).success) jobs.push(candidate);
      else skipped++;
    }
    return {
      jobs,
      complete: true,
      httpStatus: status,
      totalListed: top.data.jobs.length,
      seenIds,
      notes: skipped ? [`Skipped ${skipped} posting(s) that failed validation`] : [],
    };
  },

  async verifyJob(config, sourceJobId, ctx) {
    if (!/^\d+$/.test(sourceJobId)) return { open: null, evidence: "Non-numeric Greenhouse job id", httpStatus: null };
    const url = `${BASE}/${encodeURIComponent(config.boardToken)}/jobs/${sourceJobId}`;
    try {
      const { status } = await getJson(url, ctx, [404, 410]);
      if (status === 404 || status === 410) return { open: false, evidence: `GET ${url} → HTTP ${status}`, httpStatus: status };
      return { open: true, evidence: `GET ${url} → HTTP ${status}`, httpStatus: status };
    } catch (e: any) {
      return { open: null, evidence: `Verification failed: ${e?.message ?? e}`, httpStatus: e?.status ?? null };
    }
  },
};
