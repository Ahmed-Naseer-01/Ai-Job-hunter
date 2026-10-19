"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const s = body.summary;
      const c = s.counts;
      if (s.status === "skipped") setMsg({ ok: false, text: s.errors?.[0] ?? "Another run is already in progress." });
      else setMsg({ ok: s.status !== "failed", text: `${dryRun ? "Dry run" : "Run"} ${s.status}: ${c.new} new, ${c.updated} updated, ${c.closed} closed, ${c.errors} errors${s.errors?.length ? ` — ${s.errors[0]}` : ""}` });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button onClick={() => run(true)} disabled={busy} title="Fetch and score without saving anything or sending email">Dry run</button>
        <button className="primary" onClick={() => run(false)} disabled={busy}>{busy ? "Running…" : "Run now"}</button>
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"} role="status" style={{ marginTop: 8, textAlign: "left", maxWidth: 520 }}>{msg.text}</div>}
    </div>
  );
}
