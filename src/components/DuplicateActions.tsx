"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DuplicateActions({ id, thisId, otherId }: { id: string; thisId: string; otherId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(action: "merge" | "distinct", keepId?: string) {
    if (action === "merge" && !confirm("Merge these two postings? Tracker data is combined and the other record is removed.")) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/duplicates/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, keepId }) });
    setBusy(false);
    if (!res.ok) return setErr((await res.json()).error ?? "Failed");
    if (action === "merge" && keepId !== thisId) router.push(`/jobs/${keepId}`);
    else router.refresh();
  }
  return (
    <div className="row" style={{ marginTop: 6 }}>
      <button disabled={busy} onClick={() => act("merge", thisId)}>Merge, keep this</button>
      <button disabled={busy} onClick={() => act("merge", otherId)}>Merge, keep other</button>
      <button disabled={busy} onClick={() => act("distinct")}>Not a duplicate</button>
      {err && <span className="error">{err}</span>}
    </div>
  );
}
