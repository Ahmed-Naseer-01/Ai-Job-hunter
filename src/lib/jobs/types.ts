import { z } from "zod";
import type { SkillHit } from "../extract/skills";
import type { EmploymentType, Seniority, WorkMode } from "../extract/classify";
import type { Domain } from "../extract/domain";

const isoOrNull = z
  .string()
  .nullish()
  .transform((v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  });

/** What every source adapter must produce. Validated with zod before touching the pipeline. */
export const NormalizedJobInputSchema = z.object({
  sourceKey: z.string().min(1),
  sourceKind: z.string().min(1),
  sourceJobId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(200),
  applyUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Only http(s) apply URLs are allowed"),
  descriptionText: z.string().max(200_000).optional(),
  descriptionHtml: z.string().max(400_000).optional(),
  locationRaw: z.string().max(500).nullish(),
  workModeHint: z.string().max(50).nullish(),
  employmentTypeHint: z.string().max(50).nullish(),
  postedAt: isoOrNull,
  updatedAt: isoOrNull,
  deadlineAt: isoOrNull,
  salary: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: z.string().nullable(),
      period: z.enum(["year", "month", "hour"]).nullable(),
    })
    .nullish(),
  isSynthetic: z.boolean().optional(),
});
export type NormalizedJobInput = z.input<typeof NormalizedJobInputSchema>;

export interface Provenance {
  /** Fields whose values come straight from the source. */
  published: string[];
  /** Fields we classified from free text. */
  inferred: string[];
  /** Fields the posting did not give us. */
  unknown: string[];
  domains: Domain[];
  modernization: boolean;
  workModeSource: "published" | "inferred" | "unknown";
  salaryEvidence?: string;
  yearsMentions: { years: number; line: string; kind: "required" | "preferred" }[];
}

/** Enriched job (no DB identity yet). */
export interface EnrichedJob {
  title: string;
  company: string;
  applyUrl: string;
  canonicalUrl: string;
  sourceKey: string;
  sourceKind: string;
  sourceJobId: string;
  description: string;
  locationRaw: string | null;
  countries: string[];
  workMode: WorkMode;
  employmentType: EmploymentType;
  seniority: Seniority;
  yearsMin: number | null;
  yearsPreferred: number | null;
  requiredSkills: SkillHit[];
  preferredSkills: SkillHit[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "year" | "month" | "hour" | null;
  postedAt: string | null;
  deadlineAt: string | null;
  completeness: number;
  facts: Provenance;
  contentHash: string;
  isSynthetic: boolean;
}

export type Lifecycle = "new" | "seen" | "updated" | "closed";

/** A job as stored in the database. */
export interface JobRecord extends EnrichedJob {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string | null;
  lastVerifiedOpenAt: string | null;
  status: "open" | "closed";
  lifecycle: Lifecycle;
  closedAt: string | null;
  closureEvidence: ClosureEvidence | null;
}

export interface ClosureEvidence {
  at: string;
  method: "verify_endpoint" | "missing_from_listing";
  detail: string;
  missedRuns?: number;
}

export const APPLICATION_STATUSES = ["discovered", "to_review", "saved", "ready_to_apply", "applied", "interview", "rejected", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  discovered: "Discovered",
  to_review: "To Review",
  saved: "Saved",
  ready_to_apply: "Ready to Apply",
  applied: "Applied",
  interview: "Interview",
  rejected: "Rejected",
  closed: "Closed",
};
