"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Preview {
  empty: boolean;
  count: number;
  candidates: number;
  subject: string | null;
  html: string | null;
  text: string | null;
}

export function EmailPanel({ provider, external, recipient }: { provider: string; external: boolean; recipient: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setBusy("preview");
    setMsg(null);
    try {
      const res = await fetch("/api/email/preview");
      const b = await res.json();
      if (!res.ok) throw new Error(b.error);
      setPreview(b);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (external && !confirm(`This will send a REAL test email to ${recipient} via ${provider}. Continue?`)) return;
    setBusy("send");
    setMsg(null);
    try {
      const res = await fetch("/api/email/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: external }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error);
      setMsg(
        b.ok
          ? { ok: true, text: b.deliversExternally ? `Test email sent via ${b.provider}.` : `Provider "${b.provider}" does not deliver externally. Preview written to ${b.location}` }
          : { ok: false, text: `Send failed: ${b.error}` },
      );
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>Digest preview &amp; test</h2>
      <p className="sub">
        Provider: <strong>{provider}</strong>{" "}
        {external ? "(delivers real email)" : "(writes to data/outbox; nothing leaves this machine — set EMAIL_PROVIDER=smtp|resend for real delivery)"}. Preview includes labelled sample jobs and never marks anything as notified.
      </p>
      <div className="row">
        <button onClick={load} disabled={!!busy}>{busy === "preview" ? "Building…" : "Preview digest"}</button>
        <button className="primary" onClick={send} disabled={!!busy}>{busy === "send" ? "Sending…" : "Send test email"}</button>
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"} role="status">{msg.text}</div>}
      {preview?.empty && <div className="empty" style={{ marginTop: 10 }}>No jobs currently qualify for a digest (need actionable matches scoring above your minimum).</div>}
      {preview && !preview.empty && (
        <div style={{ marginTop: 10 }}>
          <p>
            <strong>{preview.subject}</strong> <span className="sub">· {preview.count} of {preview.candidates} qualifying</span>
          </p>
          <iframe className="preview" sandbox="" srcDoc={preview.html ?? ""} title="Email preview" />
        </div>
      )}
    </div>
  );
}
