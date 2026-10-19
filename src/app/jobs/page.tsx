import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { listJobs } from "@/lib/services/queries";
import { filtersFromParams } from "@/lib/ui/filters";
import { JobTable } from "@/components/JobCard";
import { listSources } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

function Sel({ name, label, cur, options, any = "Any" }: { name: string; label: string; cur?: string; options: [string, string][]; any?: string | null }) {
  return (
    <label>{label}
      <select name={name} defaultValue={cur ?? (any === null ? options[0][0] : "")}>
        {any !== null && <option value="">{any}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
const same = (xs: string[]): [string, string][] => xs.map((x) => [x, x.replace(/_/g, " ")]);

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = await getDb();
  const settings = await loadSettings(db);
  const filters = filtersFromParams(sp, { includeSynthetic: settings.search.showSynthetic, sort: "score", pageSize: 25 });
  const { items, total, page, pageSize } = await listJobs(db, filters);
  const sources = await listSources(db);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    for (const [k, v] of Object.entries(over)) p.set(k, v);
    return p.toString();
  };
  return (
    <>
      <div className="row"><div><h1>Search jobs</h1><p className="lead">{total} job{total === 1 ? "" : "s"} match.</p></div><span className="spacer" /><a className="btn" href={`/api/jobs/export?${qs({})}`}>Export CSV</a></div>
      <form className="filters" method="get">
        <label>Text<input name="q" defaultValue={sp.q} placeholder="title or company" /></label>
        <label>Min score<input name="minScore" type="number" min={0} max={100} defaultValue={sp.minScore} /></label>
        <Sel name="band" label="Band" cur={sp.band} options={[["high", "High"], ["good", "Good"], ["review", "Review"], ["low", "Low"]]} />
        <Sel name="eligibility" label="Eligibility" cur={sp.eligibility} options={[["actionable", "Actionable"], ["eligible", "Eligible"], ["potential", "Potential"], ["ineligible", "Ineligible"]]} />
        <Sel name="workMode" label="Work mode" cur={sp.workMode} options={[["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"], ["unknown", "Unknown"]]} />
        <Sel name="seniority" label="Seniority" cur={sp.seniority} options={same(["intern", "junior", "mid", "senior", "lead", "staff", "principal", "manager", "architect", "unknown"])} />
        <Sel name="employmentType" label="Type" cur={sp.employmentType} options={same(["full-time", "contract", "internship", "part-time", "unknown"])} />
        <label>Country<input name="country" defaultValue={sp.country} placeholder="e.g. Pakistan" /></label>
        <label>Skill id<input name="skill" defaultValue={sp.skill} placeholder="spring-boot" /></label>
        <label>Min salary<input name="minSalary" type="number" defaultValue={sp.minSalary} /></label>
        <Sel name="postedWithinDays" label="Posted within" cur={sp.postedWithinDays} any="Any time" options={[["1", "24 h"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]]} />
        <Sel name="source" label="Source" cur={sp.source} any="All" options={[...sources.map((s): [string, string] => [s.id, s.name]), ["synthetic:demo", "Synthetic samples"]]} />
        <Sel name="status" label="Availability" cur={sp.status ?? "open"} any={null} options={[["open", "Open"], ["closed", "No longer available"], ["all", "All"]]} />
        <Sel name="appStatus" label="Tracker" cur={sp.appStatus} options={[["none", "Untracked"], ...same(["to_review", "saved", "ready_to_apply", "applied", "interview", "rejected", "closed"])]} />
        <Sel name="sort" label="Sort" cur={sp.sort ?? "score"} any={null} options={[["score", "Score"], ["posted", "Posted date"], ["seen", "First discovered"], ["company", "Company"]]} />
        <button className="primary" type="submit">Apply</button> <Link href="/jobs" className="btn">Reset</Link>
      </form>
      <JobTable items={items} empty={<>No jobs match these filters. <Link href="/jobs">Clear filters</Link></>} />
      <div className="pager">
        {page > 1 ? <Link className="btn" href={`/jobs?${qs({ page: String(page - 1) })}`}>← Prev</Link> : <span />}
        <span className="sub">Page {page} of {pages}</span>
        {page < pages && <Link className="btn" href={`/jobs?${qs({ page: String(page + 1) })}`}>Next →</Link>}
      </div>
    </>
  );
}
