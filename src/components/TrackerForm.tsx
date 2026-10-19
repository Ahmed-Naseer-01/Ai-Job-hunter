"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/jobs/types";

interface Initial { status: ApplicationStatus; notes: string; followUpAt: string | null; appliedAt: string | null }
const toLocalDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function TrackerForm({ jobId, initial }: { jobId: string; initial: Initial | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<ApplicationStatus>(initial?.status ?? "to_review");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [follow, setFollow] = useState(toLocalDate(initial?.followUpAt ?? null));
  const [applied, setApplied] = useState(toLocalDate(initial?.appliedAt ?? null));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/application`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status, notes,
          followUpAt: follow ? `${follow}T00:00:00Z` : null,
          appliedAt: applied ? `${applied}T00:00:00Z` : status === "applied" ? undefined : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!initial && <p className="sub">Not tracked yet. Saving creates a tracker entry; collection runs never change it.</p>}
      <div className="row">
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>{APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
        <label>Applied on<input type="date" value={applied} onChange={(e) => setApplied(e.target.value)} /></label>
        <label>Follow up on<input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></label>
      </div>
      <label style={{ marginTop: 8 }}>Notes<textarea value={notes} maxLength={10000} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter, referral, interview dates…" /></label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save tracking"}</button>
        {msg && <span className={msg.ok ? "sub" : "error"} role="status">{msg.text}</span>}
      </div>
    </div>
  );
}
