import type { ZodType } from "zod";
import type { NormalizedJobInput } from "../jobs/types";

export interface FetchContext {
  fetch: typeof fetch;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string) => void;
  timeoutMs: number;
}

export interface SourceInfo {
  kind: string;
  title: string;
  setup: string;
  access: string;
  limits: string;
  attribution: string;
  fields: string[];
  docsUrl: string;
  /** Can this source be polled on a schedule? (Imports and link bookmarks cannot.) */
  scheduled: boolean;
}

export interface FetchResult {
  jobs: NormalizedJobInput[];
  /** True when `jobs`/`seenIds` represent the source's complete current listing (required before inferring closures). */
  complete: boolean;
  httpStatus: number | null;
  /** How many postings the source listed before validation/filters. */
  totalListed: number;
  /** All source job ids listed (for closure detection), independent of validation skips. */
  seenIds: string[];
  notes: string[];
}

export interface VerifyResult {
  /** true = confirmed open, false = confirmed gone, null = could not tell. */
  open: boolean | null;
  evidence: string;
  httpStatus: number | null;
}

export interface SourceAdapter<C = any> {
  kind: string;
  info: SourceInfo;
  configSchema: ZodType<C>;
  /** Stable id for a configured source, e.g. "greenhouse:acme". */
  sourceKey(config: C): string;
  fetchJobs(config: C, ctx: FetchContext): Promise<FetchResult>;
  verifyJob?(config: C, sourceJobId: string, ctx: FetchContext): Promise<VerifyResult>;
}

/** Fields shared by every source config and handled by the pipeline, not the adapter. */
export interface CommonSourceConfig {
  /** Only keep jobs whose title contains one of these (case-insensitive). Empty = keep all. */
  titleKeywords?: string[];
}
