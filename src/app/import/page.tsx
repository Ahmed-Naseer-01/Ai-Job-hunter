import { ImportPanel } from "@/components/ImportPanel";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <>
      <h1>Import jobs</h1>
      <p className="lead">Bring in postings you found yourself: links (including LinkedIn), exports, or saved job-alert emails. LinkedIn is never scraped, logged into, or contacted, and passwords/cookies are never stored.</p>
      <ImportPanel />
    </>
  );
}
