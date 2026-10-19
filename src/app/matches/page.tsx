import Link from "next/link";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { listJobs } from "@/lib/services/queries";
import { JobTable } from "@/components/JobCard";

export const dynamic = "force-dynamic";

export default async function Matches({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const db = await getDb();
  const settings = await loadSettings(db);
  const showAll = sp.all === "1";
  const { items, total } = await listJobs(db, {
    includeSynthetic: settings.search.showSynthetic,
    eligibility: showAll ? undefined : "actionable",
    minScore: settings.scoring.bands.review,
    sort: "score",
    pageSize: 50,
  });
  return (
    <>
      <h1>Best matches</h1>
      <p className="lead">Open jobs scoring {settings.scoring.bands.review}+ (<strong>High</strong> {settings.scoring.bands.high}+, <strong>Good</strong> {settings.scoring.bands.good}+, <strong>Review</strong> {settings.scoring.bands.review}+).
        {showAll ? " Including ineligible and preference-excluded roles." : " Ineligible roles and roles excluded by your preferences are hidden."}{" "}
        <Link href={showAll ? "/matches" : "/matches?all=1"}>{showAll ? "Hide them" : "Show them anyway"}</Link></p>
      <JobTable items={items} empty="No matches at or above the review threshold. Try Run now, or lower the threshold in Settings." />
      {total > items.length && <p className="sub">Showing the top {items.length} of {total}. Use <Link href="/jobs">Search</Link> for the full list.</p>}
    </>
  );
}
