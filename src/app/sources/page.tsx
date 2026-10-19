import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { listRuns, getRunLogs } from "@/lib/db/runs";
import { sourceStatuses, pendingDuplicates } from "@/lib/services/queries";
import { SourcesPanel } from "@/components/SourcesPanel";
import { RunNowButton } from "@/components/RunNowButton";
import { DuplicateActions } from "@/components/DuplicateActions";
import { SCHEDULED_ADAPTERS } from "@/lib/sources/registry";
import { fmtDateTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const db = await getDb();
  const tz = (await loadSettings(db)).schedule.timezone;
  const [sources, runs, dups] = await Promise.all([sourceStatuses(db), listRuns(db, 15), pendingDuplicates(db)]);
  const latestLogs = runs[0] ? await getRunLogs(db, runs[0].id, 80) : [];
  return (
    <>
      <div className="row">
        <div>
          <h1>Sources &amp; runs</h1>
          <p className="lead">Only sources with a documented public API are polled. Nothing is scraped, and no logins are used.</p>
        </div>
        <span className="spacer" />
        <RunNowButton />
      </div>

      <SourcesPanel
        sources={sources.map((s) => ({
          id: s.id, name: s.name, kind: s.kind, enabled: s.enabled, jobCount: s.jobCount, status: s.health.status, lastSuccessAt: s.health.lastSuccessAt, lastAttemptAt: s.health.lastAttemptAt,
          lastError: s.health.lastError, consecutiveFailures: s.health.consecutiveFailures, coverage: s.health.coverage, lastFetched: s.health.lastFetched, lastKept: s.health.lastKept,
        }))}
      />

      {dups.length > 0 && (
        <div className="card">
          <h2>Possible duplicates to review ({dups.length})</h2>
          {dups.map((d) => (
            <div key={d.id} className="kcard">
              <div><Link href={`/jobs/${d.a.id}`}>{d.a.title}</Link> — {d.a.company} <span className="sub">({d.a.location ?? "no location"})</span></div>
              <div><Link href={`/jobs/${d.b.id}`}>{d.b.title}</Link> — {d.b.company} <span className="sub">({d.b.location ?? "no location"})</span></div>
              <div className="sub">{Math.round(d.similarity * 100)}% similar · {d.reason}</div>
              <DuplicateActions id={d.id} thisId={d.a.id} otherId={d.b.id} />
            </div>
          ))}
        </div>
      )}

      <h2>Run history</h2>
      {runs.length === 0 ? (
        <div className="empty">No runs yet. Press “Run now”.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Started</th><th>Trigger</th><th>Status</th><th>Duration</th><th>Listed / kept</th><th>New</th><th>Updated</th><th>Closed</th><th>Errors</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.startedAt, tz)}</td>
                  <td>{r.trigger}{r.dryRun ? " (dry)" : ""}</td>
                  <td>
                    <span className={`badge ${r.status === "success" ? "elig-eligible" : r.status === "partial" || r.status === "skipped" ? "elig-potential" : r.status === "running" ? "muted" : "elig-ineligible"}`}>{r.status}</span>
                    {r.error && <div className="sub">{r.error.slice(0, 120)}</div>}
                  </td>
                  <td>{r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)} s` : "—"}</td>
                  <td>{r.counts.listed ?? 0} / {r.counts.kept ?? 0}</td>
                  <td>{r.counts.new ?? 0}</td>
                  <td>{r.counts.updated ?? 0}</td>
                  <td>{r.counts.closed ?? 0}</td>
                  <td>{r.counts.errors ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {latestLogs.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Log of the latest run ({latestLogs.length} lines)</summary>
          <pre className="log">{latestLogs.map((l) => `${l.ts.slice(11, 19)} ${l.level.toUpperCase().padEnd(5)} ${l.sourceKey ? `[${l.sourceKey}] ` : ""}${l.message}`).join("\n")}</pre>
        </details>
      )}

      <h2 style={{ marginTop: 22 }}>Supported source types</h2>
      <div className="grid g2">
        {Object.values(SCHEDULED_ADAPTERS).map((a) => (
          <div className="card" key={a.kind}>
            <h3>{a.info.title}</h3>
            <dl className="kv" style={{ gridTemplateColumns: "90px 1fr" }}>
              <dt>Setup</dt><dd>{a.info.setup}</dd>
              <dt>Access</dt><dd>{a.info.access}</dd>
              <dt>Limits</dt><dd>{a.info.limits}</dd>
              <dt>Attribution</dt><dd>{a.info.attribution}</dd>
              <dt>Fields</dt><dd>{a.info.fields.join(", ")}</dd>
              <dt>Docs</dt><dd><a href={a.info.docsUrl} target="_blank" rel="noopener noreferrer">{a.info.docsUrl}</a></dd>
            </dl>
          </div>
        ))}
      </div>
      <p className="sub">LinkedIn is never scraped. Job alert emails, JSON/CSV exports and individual links you supply are planned import paths (not yet available).</p>
    </>
  );
}
