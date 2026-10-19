import Link from "next/link";
import type { JobListItem } from "@/lib/services/queries";
import { ScoreBadge, EligBadge, SyntheticBadge, StatusPill } from "./Badges";
import { fmtDate, salaryText } from "@/lib/ui/format";
import { STATUS_LABELS } from "@/lib/jobs/types";

export function JobRow({ item }: { item: JobListItem }) {
  const { job, score, application } = item;
  const salary = salaryText(job);
  return (
    <tr className={job.status === "closed" ? "closed" : ""}>
      <td className="num"><ScoreBadge score={score?.score} band={score?.band} /></td>
      <td>
        <Link href={`/jobs/${job.id}`} className="title">{job.title}</Link>
        <div className="sub">{job.company}{job.isSynthetic && <> <SyntheticBadge /></>}{job.status === "closed" && <> <span className="badge muted">No longer available</span></>}</div>
      </td>
      <td><EligBadge state={score?.eligibility} />{score && !score.actionable && score.eligibility !== "ineligible" && <div className="sub">Excluded by your preferences</div>}</td>
      <td>{job.locationRaw ?? <span className="unknown">Not stated</span>}<div className="sub">{job.workMode !== "unknown" ? job.workMode : "work mode unknown"} · {job.employmentType !== "unknown" ? job.employmentType : "type unknown"}</div></td>
      <td>{salary ?? <span className="unknown">Not published</span>}</td>
      <td>{fmtDate(job.postedAt)}</td>
      <td>{application ? <StatusPill status={application.status} /> : <span className="unknown">—</span>}<span className="sr-only">{application ? STATUS_LABELS[application.status] : ""}</span></td>
    </tr>
  );
}

export function JobTable({ items, empty }: { items: JobListItem[]; empty?: React.ReactNode }) {
  if (!items.length) return <div className="empty">{empty ?? "No jobs to show."}</div>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr><th>Score</th><th>Job</th><th>Eligibility</th><th>Location</th><th>Salary</th><th>Posted</th><th>Tracker</th></tr>
        </thead>
        <tbody>{items.map((i) => <JobRow key={i.job.id} item={i} />)}</tbody>
      </table>
    </div>
  );
}
