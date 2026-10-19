import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { overview } from "@/lib/services/queries";
import { JobTable } from "@/components/JobCard";
import { ago, fmtDateTime } from "@/lib/ui/format";
import { STATUS_LABELS, APPLICATION_STATUSES } from "@/lib/jobs/types";
import { nextRunAt } from "@/lib/scheduler/time";
import { RunNowButton } from "@/components/RunNowButton";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const db = await getDb();
  const settings = await loadSettings(db);
  const o = await overview(db, { includeSynthetic: settings.search.showSynthetic, timezone: settings.schedule.timezone });
  const next = settings.schedule.enabled ? nextRunAt(new Date(), settings.schedule.time, settings.schedule.timezone) : null;
  const onlySynthetic = o.totals.real === 0;
  return (
    <>
      <div className="row"><div><h1>Overview</h1><p className="lead">Your daily snapshot. Eligibility is shown separately from technical fit.</p></div><span className="spacer" /><RunNowButton /></div>

      {onlySynthetic && (
        <div className="note">
          Showing <strong>synthetic sample jobs</strong> only. They are labelled and use example.com links. Press <strong>Run now</strong> to collect real postings from the configured sources
          (<Link href="/sources">Sources &amp; Runs</Link>).
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{o.totals.open}</div><div className="l">Open jobs ({o.totals.real} real{o.totals.synthetic ? ` · ${o.totals.synthetic} sample` : ""})</div></div>
        <div className="stat"><div className="n">{o.newToday}</div><div className="l">New today ({o.newThisWeek} this week)</div></div>
        <div className="stat"><div className="n">{(o.bands.high ?? 0) + (o.bands.good ?? 0)}</div><div className="l">High + Good matches</div></div>
        <div className="stat"><div className="n">{o.eligibility.eligible ?? 0}<span style={{ fontSize: 14, color: "#6b7280" }}> / {o.eligibility.potential ?? 0} / {o.eligibility.ineligible ?? 0}</span></div><div className="l">Eligible / potential / ineligible</div></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Last run</h2>
          {o.lastRun ? (
            <dl className="kv">
              <dt>Status</dt><dd><strong>{o.lastRun.status}</strong>{o.lastRun.dryRun ? " (dry run)" : ""} · {o.lastRun.trigger}</dd>
              <dt>Started</dt><dd>{fmtDateTime(o.lastRun.startedAt, settings.schedule.timezone)} ({ago(o.lastRun.startedAt)})</dd>
              <dt>Duration</dt><dd>{o.lastRun.durationMs !== null ? `${(o.lastRun.durationMs / 1000).toFixed(1)} s` : "—"}</dd>
              <dt>Result</dt><dd>{Number((o.lastRun.counts as any)?.new ?? 0)} new · {Number((o.lastRun.counts as any)?.updated ?? 0)} updated · {Number((o.lastRun.counts as any)?.closed ?? 0)} closed · {Number((o.lastRun.counts as any)?.errors ?? 0)} errors</dd>
            </dl>
          ) : <p className="unknown">No run yet.</p>}
          <p className="sub">Next scheduled run: {next ? `${fmtDateTime(next.toISOString(), settings.schedule.timezone)} (${settings.schedule.timezone}) — requires the worker process` : "scheduling disabled"}</p>
        </div>
        <div className="card">
          <h2>Needs attention</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{o.followUpsDue} follow-up{o.followUpsDue === 1 ? "" : "s"} due — <Link href="/tracker">Tracker</Link></li>
            <li>{o.pendingDuplicateReviews} possible duplicate{o.pendingDuplicateReviews === 1 ? "" : "s"} to review — <Link href="/sources">Sources &amp; Runs</Link></li>
            <li>{o.tracker.to_review ?? 0} to review · {o.tracker.saved ?? 0} saved · {o.tracker.ready_to_apply ?? 0} ready to apply</li>
          </ul>
          <h3 style={{ marginTop: 14 }}>Tracker</h3>
          <div className="chips">{APPLICATION_STATUSES.map((s) => <span key={s} className="chip">{STATUS_LABELS[s]}: {o.tracker[s] ?? 0}</span>)}</div>
        </div>
      </div>

      <h2 style={{ marginTop: 8 }}>Top matches you can act on</h2>
      <JobTable items={o.topMatches} empty="No actionable matches yet. Run a collection or relax your preferences in Settings." />
      <p><Link href="/matches">See all best matches →</Link></p>
    </>
  );
}
