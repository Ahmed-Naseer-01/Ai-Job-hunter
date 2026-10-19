import { BAND_LABEL, ELIG_LABEL } from "@/lib/ui/format";

export function ScoreBadge({ score, band }: { score: number | null | undefined; band?: string }) {
  if (score === null || score === undefined) return <span className="badge muted">Not scored</span>;
  return <span className={`badge band-${band ?? "low"}`} title={`${BAND_LABEL[band ?? "low"]} match`}>{Math.round(score)}</span>;
}

export function EligBadge({ state }: { state: string | undefined }) {
  if (!state) return null;
  return <span className={`badge elig-${state}`}>{ELIG_LABEL[state] ?? state}</span>;
}

export function SyntheticBadge() {
  return <span className="badge synthetic" title="Sample data seeded for demonstration. Not a real posting.">SYNTHETIC SAMPLE</span>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{status.replace(/_/g, " ")}</span>;
}
