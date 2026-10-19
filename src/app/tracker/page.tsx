import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { trackerBoard, dueFollowUps } from "@/lib/services/queries";
import { APPLICATION_STATUSES, STATUS_LABELS } from "@/lib/jobs/types";
import { ScoreBadge, SyntheticBadge } from "@/components/Badges";
import { fmtDate } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function Tracker() {
  const db = await getDb();
  const settings = await loadSettings(db);
  const tz = settings.schedule.timezone;
  const board = await trackerBoard(db, settings.search.showSynthetic);
  const due = await dueFollowUps(db);
  const total = APPLICATION_STATUSES.reduce((n, s) => n + board[s].length, 0);
  return (
    <>
      <h1>Application tracker</h1>
      <p className="lead">Your own record. Collection runs never change these statuses. Open a job to move it between columns.</p>
      {due.length > 0 && (
        <div className="note"><strong>{due.length} follow-up{due.length === 1 ? "" : "s"} due:</strong>{" "}
          {due.map((d) => <span key={d.job.id}><Link href={`/jobs/${d.job.id}`}>{d.job.title} ({d.job.company})</Link> · {fmtDate(d.application!.followUpAt, tz)}; </span>)}</div>
      )}
      {total === 0 && <div className="empty">Nothing tracked yet. Open a job and set its status to “Saved” or “To Review”.<br /><Link href="/matches">Browse best matches</Link></div>}
      <div className="kanban" style={{ marginTop: 12 }}>
        {APPLICATION_STATUSES.map((s) => (
          <div className="col" key={s}>
            <h3>{STATUS_LABELS[s]} <span className="badge muted">{board[s].length}</span></h3>
            {board[s].map(({ job, score, application }) => (
              <div className="kcard" key={job.id}>
                <Link href={`/jobs/${job.id}`} className="title">{job.title}</Link>
                <div className="sub">{job.company} {job.isSynthetic && <SyntheticBadge />}</div>
                <div className="row" style={{ marginTop: 4 }}><ScoreBadge score={score?.score} band={score?.band} />{job.status === "closed" && <span className="badge muted">No longer available</span>}</div>
                {application!.appliedAt && <div className="sub">Applied {fmtDate(application!.appliedAt, tz)}</div>}
                {application!.followUpAt && <div className="sub">Follow up {fmtDate(application!.followUpAt, tz)}</div>}
                {application!.notes && <div className="sub" style={{ marginTop: 4 }}>{application!.notes.slice(0, 120)}</div>}
              </div>
            ))}
            {!board[s].length && <div className="sub">Empty</div>}
          </div>
        ))}
      </div>
    </>
  );
}
