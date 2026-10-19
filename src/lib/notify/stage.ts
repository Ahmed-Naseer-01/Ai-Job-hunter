import type { Db } from "../db/types";
import type { AppSettings, Profile } from "../config/schema";
import { rowToJob, rowToScore } from "../db/jobs";
import { buildDigest, formatSalary, notificationFingerprint, type Digest, type DigestItem } from "./digest";
import { fromAddress, providerFromEnv, type EmailProvider } from "./providers";
import { startOfLocalDay } from "../scheduler/time";
import { newId, maskEmail, redact } from "../util";
import { withRetry } from "../sources/retry";

export interface NotifyStageInput {
  runId?: string | null;
  now: () => Date;
  dryRun: boolean;
  settings: AppSettings;
  profile: Profile;
  minScore: number;
  maxPerDay: number;
  lookbackDays: number;
  provider?: EmailProvider;
  runStartIso: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface NotifyStageResult {
  /** Jobs that qualify for notification (before the daily cap). */
  candidates: number;
  selected: number;
  sent: number;
  status: "none" | "sent" | "skipped" | "dry_run" | "failed";
  errors: string[];
  subject?: string;
  location?: string;
  skippedReason?: string;
}

const ACTIVE_TRACKER = new Set(["discovered", "to_review", "saved", "ready_to_apply"]);

interface Candidate {
  item: DigestItem;
  fingerprint: string;
  score: number;
}

/** Select jobs that deserve a (new) notification. Pure DB read; does not record anything. */
export async function selectDigestCandidates(db: Db, o: { settings: AppSettings; minScore: number; now: Date; /** Preview only: include clearly-labelled synthetic jobs. */ includeSynthetic?: boolean; /** Preview only: ignore previous notifications. */ ignoreNotified?: boolean }): Promise<Candidate[]> {
  const rows = await db.query(
    `SELECT j.*, s.score AS s_score, s.technical_score AS s_tech, s.band AS s_band, s.confidence AS s_conf, s.eligibility AS s_elig, s.actionable AS s_act,
            s.eligibility_detail AS s_detail, s.breakdown AS s_breakdown, s.explanation AS s_expl, s.content_hash AS s_ch, s.profile_hash AS s_ph, s.scored_at AS s_at,
            a.status AS a_status, n.fingerprint AS n_fp, n.notified_at AS n_at
     FROM jobs j JOIN job_scores s ON s.job_id = j.id
     LEFT JOIN applications a ON a.job_id = j.id
     LEFT JOIN notified_jobs n ON n.job_id = j.id
     WHERE j.status = 'open' AND (j.is_synthetic = 0 OR ?) AND s.actionable = 1 AND s.score >= ?
     ORDER BY s.score DESC, j.id`,
    [o.includeSynthetic ? 1 : 0, o.minScore],
  );
  const out: Candidate[] = [];
  const reminderMs = o.settings.schedule.reminderDays * 86_400_000;
  for (const r of rows) {
    if (r.a_status && !ACTIVE_TRACKER.has(r.a_status)) continue; // already applied / interviewing / rejected / closed
    if (r.s_elig === "ineligible") continue;
    if (r.s_elig === "potential" && !o.settings.schedule.notifyPotentiallyEligible) continue;
    const job = rowToJob(r);
    const score = rowToScore({ job_id: job.id, score: r.s_score, technical_score: r.s_tech, band: r.s_band, confidence: r.s_conf, eligibility: r.s_elig, actionable: r.s_act, eligibility_detail: r.s_detail, breakdown: r.s_breakdown, explanation: r.s_expl, content_hash: r.s_ch, profile_hash: r.s_ph, scored_at: r.s_at });
    const fp = notificationFingerprint({ id: job.id, band: score.band, eligibility: score.eligibility, salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, locationRaw: job.locationRaw, canonicalUrl: job.canonicalUrl, title: job.title, status: job.status });
    let reason: DigestItem["reason"] | null = null;
    if (!r.n_fp || o.ignoreNotified) reason = "new";
    else if (r.n_fp !== fp) reason = "changed";
    else if (reminderMs > 0 && o.now.getTime() - new Date(r.n_at).getTime() >= reminderMs) reason = "reminder";
    if (!reason) continue;
    out.push({
      fingerprint: fp,
      score: score.score,
      item: {
        jobId: job.id, title: job.title, company: job.company, applyUrl: job.applyUrl, locationRaw: job.locationRaw,
        salaryText: formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod), postedAt: job.postedAt, score: score.score, band: score.band,
        eligibility: score.eligibility, reasons: [...score.explanation.whyFit.slice(0, 3), ...score.explanation.relevantAchievements.slice(0, 1).map((a) => a.text)],
        missing: score.explanation.missingRequirements, verdict: score.explanation.verdict, reason, synthetic: job.isSynthetic,
      },
    });
  }
  return out;
}

export async function logDelivery(db: Db, r: { kind: "digest" | "test"; provider: string; recipient: string; subject: string; status: "sent" | "dry_run" | "preview" | "failed" | "skipped"; error?: string | null; jobIds?: string[]; dryRun?: boolean; runId?: string | null; now: Date }): Promise<void> {
  await db.run(
    "INSERT INTO notification_log (id, ts, kind, provider, recipient, subject, status, error, job_ids, dry_run, run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [newId("nl_"), r.now.toISOString(), r.kind, r.provider, maskEmail(r.recipient), r.subject, r.status, r.error ? redact(r.error).slice(0, 500) : null, JSON.stringify(r.jobIds ?? []), r.dryRun ? 1 : 0, r.runId ?? null],
  );
}

export async function sentToday(db: Db, now: Date, tz: string): Promise<number> {
  const since = startOfLocalDay(now, tz).toISOString();
  const r = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM notified_jobs WHERE notified_at >= ?", [since]);
  return Number(r[0]?.n ?? 0);
}

export async function sendDigest(db: Db, digest: Digest, o: { provider: EmailProvider; to: string; runId?: string | null; now: Date; sleep?: (ms: number) => Promise<void> }) {
  return withRetry(() => o.provider.send({ to: o.to, from: fromAddress(), subject: digest.subject, html: digest.html, text: digest.text }), {
    retries: 2, baseMs: 500, maxMs: 4000, sleep: o.sleep,
  });
}

export interface DigestPlan {
  candidates: number;
  chosen: Candidate[];
  digest: Digest | null;
  skippedReason?: string;
}

/** Read-only: decide what would be sent. Safe to call inside a transaction that will be rolled back (dry-run). */
export async function planDigest(db: Db, i: Pick<NotifyStageInput, "now" | "settings" | "minScore" | "maxPerDay" | "dryRun">): Promise<DigestPlan> {
  const now = i.now();
  const all = await selectDigestCandidates(db, { settings: i.settings, minScore: i.minScore, now });
  if (!all.length) return { candidates: 0, chosen: [], digest: null };
  const already = await sentToday(db, now, i.settings.schedule.timezone);
  const remaining = Math.max(0, i.maxPerDay - already);
  const chosen = all.slice(0, remaining);
  if (!chosen.length) return { candidates: all.length, chosen: [], digest: null, skippedReason: `Daily notification cap reached (${i.maxPerDay})` };
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  const digest = buildDigest(chosen.map((c) => c.item), { dashboardUrl: base, now, label: i.dryRun ? "DRY RUN" : undefined });
  return { candidates: all.length, chosen, digest };
}

/** Deliver (or log) a previously planned digest. Never throws; failures are reported in the result. */
export async function runNotifyStage(db: Db, i: NotifyStageInput, planned?: DigestPlan): Promise<NotifyStageResult> {
  const now = i.now();
  const result: NotifyStageResult = { candidates: 0, selected: 0, sent: 0, status: "none", errors: [] };
  try {
    const plan = planned ?? (await planDigest(db, i));
    result.candidates = plan.candidates;
    result.selected = plan.chosen.length;
    if (!plan.candidates) return result;
    if (!plan.digest) {
      result.status = "skipped";
      result.skippedReason = plan.skippedReason;
      return result;
    }
    const { digest, chosen } = plan;
    result.subject = digest.subject;
    const to = i.settings.email.to || process.env.EMAIL_TO || "";

    if (i.dryRun) {
      await logDelivery(db, { kind: "digest", provider: "none", recipient: to || "(none)", subject: digest.subject, status: "dry_run", jobIds: digest.jobIds, dryRun: true, runId: i.runId, now });
      result.status = "dry_run";
      return result;
    }
    if (!i.settings.email.enabled) {
      await logDelivery(db, { kind: "digest", provider: "none", recipient: to || "(none)", subject: digest.subject, status: "skipped", error: "Email notifications are disabled", jobIds: digest.jobIds, runId: i.runId, now });
      result.status = "skipped";
      result.skippedReason = "Email notifications are disabled in settings";
      return result;
    }
    if (!to) throw new Error("No recipient configured (settings.email.to / EMAIL_TO)");
    const provider = i.provider ?? providerFromEnv();
    try {
      const { value } = await sendDigest(db, digest, { provider, to, runId: i.runId, now, sleep: i.sleep });
      await logDelivery(db, { kind: "digest", provider: provider.name, recipient: to, subject: digest.subject, status: "sent", jobIds: digest.jobIds, runId: i.runId, now });
      for (const c of chosen) {
        await db.run(
          `INSERT INTO notified_jobs (job_id, fingerprint, notified_at, score, times_notified) VALUES (?,?,?,?,1)
           ON CONFLICT (job_id) DO UPDATE SET fingerprint=excluded.fingerprint, notified_at=excluded.notified_at, score=excluded.score, times_notified=notified_jobs.times_notified+1`,
          [c.item.jobId, c.fingerprint, now.toISOString(), c.score],
        );
      }
      result.sent = chosen.length;
      result.status = "sent";
      result.location = value.location;
    } catch (e: any) {
      // Not recorded as notified, so the next run retries.
      await logDelivery(db, { kind: "digest", provider: provider.name, recipient: to, subject: digest.subject, status: "failed", error: e?.message ?? String(e), jobIds: digest.jobIds, runId: i.runId, now });
      result.status = "failed";
      result.errors.push(`Email delivery failed: ${e?.message ?? e}`);
    }
  } catch (e: any) {
    result.status = "failed";
    result.errors.push(`Notification stage error: ${e?.message ?? e}`);
  }
  return result;
}
