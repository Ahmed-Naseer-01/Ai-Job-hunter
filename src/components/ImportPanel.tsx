"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "urls" | "json" | "csv" | "eml";
const KINDS: { kind: Kind; label: string; hint: string; accept: string }[] = [
  { kind: "urls", label: "Job URLs / LinkedIn links", hint: "One link per line. Optional: url | Job title | Company. Greenhouse and Lever links are read from their public APIs; every other link (including LinkedIn) is saved as a bookmark and never requested.", accept: ".txt" },
  { kind: "json", label: "JSON export", hint: 'An array of jobs, or {"jobs": [...]}. Recognised fields: title, company, url, description, location, posted date, salary, employment type, work mode, id.', accept: ".json" },
  { kind: "csv", label: "CSV export", hint: "A header row with the same field names (comma, semicolon or tab separated). Title and URL are required.", accept: ".csv,.txt" },
  { kind: "eml", label: "Job-alert email (.eml)", hint: "Save the alert email as .eml and load it here. Job links are extracted from the message; nothing is fetched.", accept: ".eml,.txt" },
];

interface Preview {
  kind: string;
  notes: string[];
  rejected: { row: string; reason: string }[];
  items: { title: string; company: string; url: string; location: string | null; hasDescription: boolean }[];
}

export function ImportPanel() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("urls");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const k = KINDS.find((x) => x.kind === kind)!;

  async function post(commit: boolean) {
    setBusy(commit ? "commit" : "preview");
    setMsg(null);
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, content, commit }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      if (commit) {
        const c = b.counts;
        setMsg({ ok: !c.errors, text: `Imported: ${c.new} new, ${c.seen} already known, ${c.updated} updated, ${c.merged} merged into existing jobs, ${c.rejected} rejected${c.errors ? `, ${c.errors} errors` : ""}.` });
        setPreview(null);
        router.refresh();
      } else setPreview(b);
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) return setMsg({ ok: false, text: "File is larger than 2 MB." });
    setContent(await f.text());
    setPreview(null);
    setMsg(null);
  }

  return (
    <div>
      <div className="card">
        <div className="row">
          <label>Import type<select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); }}>{KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}</select></label>
          <label>Load a file<input type="file" accept={k.accept} onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
        <p className="sub">{k.hint}</p>
        <textarea value={content} onChange={(e) => { setContent(e.target.value); setPreview(null); }} style={{ minHeight: 180, fontFamily: "monospace", fontSize: 12 }} placeholder="Paste here…" spellCheck={false} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => post(false)} disabled={!content.trim() || !!busy}>{busy === "preview" ? "Reading…" : "Preview"}</button>
          <button className="primary" onClick={() => post(true)} disabled={!preview || preview.items.length === 0 || !!busy}>{busy === "commit" ? "Importing…" : `Import ${preview?.items.length ?? 0} job(s)`}</button>
          <span className="sub">Preview first. Nothing is stored until you import. Imported jobs are scored and de-duplicated like any other.</span>
        </div>
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"} role="status">{msg.text}</div>}
      {preview && (
        <div className="card">
          {preview.notes.map((n, i) => <p key={i} className="sub">{n}</p>)}
          <h2>{preview.items.length} ready · {preview.rejected.length} rejected</h2>
          {preview.items.length > 0 && (
            <div className="tablewrap"><table>
              <thead><tr><th>Title</th><th>Company</th><th>Location</th><th>Text</th><th>Link</th></tr></thead>
              <tbody>{preview.items.slice(0, 100).map((i, n) => (
                <tr key={n}><td>{i.title}</td><td>{i.company}</td><td>{i.location ?? <span className="unknown">unknown</span>}</td>
                  <td>{i.hasDescription ? "full" : <span className="badge muted">bookmark</span>}</td>
                  <td className="sub" style={{ maxWidth: 280, overflowWrap: "anywhere" }}>{i.url}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {preview.rejected.length > 0 && (
            <details open style={{ marginTop: 10 }}><summary>Rejected rows</summary>
              <ul>{preview.rejected.slice(0, 50).map((r, i) => <li key={i}><code>{r.row}</code>: {r.reason}</li>)}</ul></details>
          )}
        </div>
      )}
    </div>
  );
}
