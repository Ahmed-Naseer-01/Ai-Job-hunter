import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { getJobDetail } from "@/lib/services/queries";
import { ScoreBadge, EligBadge, SyntheticBadge } from "@/components/Badges";
import { TrackerForm } from "@/components/TrackerForm";
import { DuplicateActions } from "@/components/DuplicateActions";
import { fmtDate, fmtDateTime, salaryText } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = {
  sourceJobId: "Source job ID", title: "Title", company: "Company", applyUrl: "Apply link", locationRaw: "Location", description: "Description", postedAt: "Posting date", salary: "Salary", workMode: "Work mode",
  employmentType: "Employment type", seniority: "Seniority", yearsMin: "Years required", requiredSkills: "Required skills", preferredSkills: "Preferred skills", deadlineAt: "Deadline",
};

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const d = await getJobDetail(db, decodeURIComponent(id));
  if (!d) notFound();
  const tz = (await loadSettings(db)).schedule.timezone;
  const { job, score, application } = d;
  const salary = salaryText(job);
  const safeApply = /^https?:\/\//i.test(job.applyUrl) ? job.applyUrl : null;
  const x = score?.explanation;
  const elig = score?.detail.eligibility;
  const f = job.facts;
  return (
    <>
      <p><Link href="/jobs">← Search</Link></p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>{job.title}</h1>
          <p className="lead">{job.company} {job.isSynthetic && <SyntheticBadge />} {job.status === "closed" && <span className="badge muted">No longer available</span>}</p>
        </div>
        <span className="spacer" />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}><ScoreBadge score={score?.score} band={score?.band} /></div>
          <EligBadge state={score?.eligibility} />
          {score && <div className="sub">Technical fit {Math.round(score.technicalScore)} · confidence {score.detail.confidenceLabel}</div>}
        </div>
      </div>

      {job.isSynthetic && <div className="note">This is a <strong>synthetic sample</strong> used for demonstration. The link below is not a real application page.</div>}
      {job.status === "closed" && job.closureEvidence && (
        <div className="note"><strong>No longer available</strong> since {fmtDateTime(job.closedAt, tz)}. Evidence: {job.closureEvidence.detail} ({job.closureEvidence.method.replace(/_/g, " ")}).</div>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        {safeApply ? <a className="btn primary" href={safeApply} target="_blank" rel="noopener noreferrer nofollow">Open original posting ↗</a> : <span className="badge muted">No valid link</span>}
        <span className="sub">Applications are never submitted for you.</span>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Why this score</h2>
          {x ? (
            <>
              <p><strong>{x.verdict}</strong></p>
              {x.whyFit.length > 0 && <ul>{x.whyFit.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              {score!.detail.capsApplied.length > 0 && <div className="note"><strong>Score limits applied:</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{score!.detail.capsApplied.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
              {x.caveats.length > 0 && <ul>{x.caveats.map((c, i) => <li key={i} className="sub">{c}</li>)}</ul>}
            </>
          ) : <p className="unknown">Not scored yet.</p>}
          <h3>Breakdown (weights are editable in Profile)</h3>
          {score?.breakdown.map((c) => (
            <div key={c.key} style={{ marginBottom: 8 }}>
              <div className="row"><span>{c.label}</span><span className="spacer" /><span className="sub">{c.score === null ? "not assessable — weight redistributed" : `${Math.round(c.score * 100)}% × ${c.appliedWeight.toFixed(1)}`}</span></div>
              <div className="bar"><i style={{ width: `${c.score === null ? 0 : c.score * 100}%` }} /></div>
              {c.notes.map((n, i) => <div key={i} className="sub">{n}</div>)}
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Eligibility <span className="sub">(separate from technical fit)</span></h2>
          <p><EligBadge state={score?.eligibility} /></p>
          {x && <p>{x.eligibilityNote}</p>}
          {elig && elig.reasons.length > 0 && <ul>{elig.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {elig && elig.evidence.length > 0 && <><h3>Evidence from the posting</h3>{elig.evidence.map((e, i) => <blockquote key={i} className="sub" style={{ margin: "4px 0" }}>“{e}”</blockquote>)}</>}
          {elig && elig.requiresConfirmation.length > 0 && <><h3>Confirm with the employer</h3><ul>{elig.requiresConfirmation.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
          {elig?.preferenceExcluded && <div className="note">Hidden from your best matches by a preference: {elig.preferenceExcluded}. Change it in Settings.</div>}

          <h3>Skills</h3>
          <div className="chips">
            {score?.detail.skillMatches.map((m) => (
              <span key={m.id + m.required} className={`chip ${m.status}`} title={`${m.required ? "Required" : "Preferred"} · ${m.status}${m.via ? ` (via ${m.via})` : ""}\n${m.evidence}`}>
                {m.label}{m.required ? "" : " (nice)"} · {m.status}
              </span>
            ))}
            {!score?.detail.skillMatches.length && <span className="unknown">No skills detected in the posting.</span>}
          </div>
          {x && x.missingRequirements.length > 0 && <p style={{ marginTop: 10 }}><strong>Missing mandatory:</strong> {x.missingRequirements.join(", ")}</p>}
          {x && x.unverified.length > 0 && <p className="sub">Unverified on your resume (not claimed): {x.unverified.join(", ")}</p>}
          {x && x.relevantAchievements.length > 0 && <><h3>Resume points worth emphasising</h3><ul>{x.relevantAchievements.map((a) => <li key={a.id}>{a.text}<div className="sub">{a.why}</div></li>)}</ul></>}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Details</h2>
          <dl className="kv">
            <dt>Location</dt><dd>{job.locationRaw ?? <span className="unknown">Not stated</span>}</dd>
            <dt>Countries</dt><dd>{job.countries.length ? job.countries.join(", ") : <span className="unknown">Unknown</span>}</dd>
            <dt>Work mode</dt><dd>{job.workMode} <span className="sub">({f.workModeSource})</span></dd>
            <dt>Employment type</dt><dd>{job.employmentType}</dd>
            <dt>Seniority</dt><dd>{job.seniority}</dd>
            <dt>Experience</dt><dd>{job.yearsMin !== null ? `${job.yearsMin}+ years required` : <span className="unknown">Not stated</span>}{job.yearsPreferred !== null ? `, ${job.yearsPreferred}+ preferred` : ""}</dd>
            <dt>Salary</dt><dd>{salary ?? <span className="unknown">Not published</span>}{f.salaryEvidence && <div className="sub">“{f.salaryEvidence}”</div>}</dd>
            <dt>Posted</dt><dd>{fmtDate(job.postedAt, tz)}</dd>
            <dt>Deadline</dt><dd>{job.deadlineAt ? fmtDate(job.deadlineAt, tz) : <span className="unknown">Not stated</span>}</dd>
            <dt>Description completeness</dt><dd>{Math.round(job.completeness * 100)}%</dd>
          </dl>
          <h3 style={{ marginTop: 12 }}>Provenance</h3>
          <p className="sub"><strong>Published by the source:</strong> {f.published.map((k) => FIELD_LABEL[k] ?? k).join(", ") || "—"}<br />
            <strong>Inferred by us:</strong> {f.inferred.map((k) => FIELD_LABEL[k] ?? k).join(", ") || "—"}<br />
            <strong>Unknown:</strong> {f.unknown.map((k) => FIELD_LABEL[k] ?? k).join(", ") || "—"}</p>
        </div>
        <div className="card">
          <h2>Tracking</h2>
          <TrackerForm jobId={job.id} initial={application ? { status: application.status, notes: application.notes, followUpAt: application.followUpAt, appliedAt: application.appliedAt } : null} />
          <h3 style={{ marginTop: 14 }}>Freshness</h3>
          <dl className="kv">
            <dt>First discovered</dt><dd>{fmtDateTime(job.firstSeenAt, tz)}</dd>
            <dt>Last seen in feed</dt><dd>{fmtDateTime(job.lastSeenAt, tz)}</dd>
            <dt>Last checked</dt><dd>{fmtDateTime(job.lastCheckedAt, tz)}</dd>
            <dt>Last verified open</dt><dd>{job.lastVerifiedOpenAt ? fmtDateTime(job.lastVerifiedOpenAt, tz) : <span className="unknown">Not verified yet</span>}</dd>
            <dt>Lifecycle</dt><dd>{job.lifecycle}</dd>
            <dt>Source</dt><dd>{d.sightings.map((s) => `${s.sourceKey} #${s.sourceJobId}`).join(", ") || job.sourceKey}</dd>
          </dl>
          {d.duplicates.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Possible duplicates</h3>
              {d.duplicates.map((dup) => (
                <div key={dup.id} className="kcard">
                  <Link href={`/jobs/${dup.other.id}`}>{dup.other.title}</Link> — {dup.other.company}
                  <div className="sub">{Math.round(dup.similarity * 100)}% similar · {dup.reason} · {dup.status}</div>
                  {dup.status === "pending" && <DuplicateActions id={dup.id} thisId={job.id} otherId={dup.other.id} />}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Description <span className="sub">(untrusted text from the source, shown as plain text)</span></h2>
        <div className="desc">{job.description || "No description available."}</div>
      </div>
    </>
  );
}
