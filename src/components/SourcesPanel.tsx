"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Src {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  jobCount: number;
  status: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  coverage: number | null;
  lastFetched: number | null;
  lastKept: number | null;
}

const KINDS = [
  { kind: "greenhouse", label: "Greenhouse board", field: "boardToken", hint: "token from boards.greenhouse.io/<token>" },
  { kind: "lever", label: "Lever site", field: "site", hint: "site from jobs.lever.co/<site>" },
];

export function SourcesPanel({ sources }: { sources: Src[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("greenhouse");
  const [token, setToken] = useState("");
  const [company, setCompany] = useState("");
  const [keywords, setKeywords] = useState("backend, java, software engineer, platform, api, developer");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const k = KINDS.find((x) => x.kind === kind)!;
  const cfg = () => ({
    [k.field]: token.trim(),
    ...(company.trim() ? { companyName: company.trim() } : {}),
    titleKeywords: keywords.split(",").map((s) => s.trim()).filter(Boolean),
  });

  async function call(label: string, url: string, init: RequestInit, onOk: (b: any) => string) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      setMsg({ ok: b.ok !== false, text: onOk(b) });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const test = () =>
    call("test", "/api/sources/test", { method: "POST", body: JSON.stringify({ kind, config: cfg() }) }, (b) =>
      b.ok
        ? `Reachable: ${b.listed} postings listed, ${b.valid} valid (HTTP ${b.httpStatus}, ${b.ms} ms${b.attempts > 1 ? `, ${b.attempts} attempts` : ""}). Sample: ${b.sample.map((s: any) => s.title).join(" | ") || "none"}`
        : `Failed: ${b.error}${b.httpStatus ? ` (HTTP ${b.httpStatus})` : ""}`,
    );
  const add = () =>
    call("add", "/api/sources", { method: "POST", body: JSON.stringify({ kind, config: cfg(), name: company ? `${company} (${k.label})` : undefined }) }, (b) => `Added ${b.id}. It will be collected on the next run.`);

  return (
    <div>
      {sources.length === 0 ? (
        <div className="empty">No sources configured. Add one below.</div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Source</th><th>Health</th><th>Open jobs</th><th>Last success</th><th>Coverage</th><th>Last error</th><th /></tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="sub">{s.id}{s.enabled ? "" : " · disabled"}</div></td>
                  <td>
                    <span className={`badge ${s.status === "healthy" ? "elig-eligible" : s.status === "never_run" ? "muted" : s.status === "degraded" ? "elig-potential" : "elig-ineligible"}`}>{s.status.replace("_", " ")}</span>
                    {s.consecutiveFailures > 0 && <div className="sub">{s.consecutiveFailures} consecutive failure(s)</div>}
                  </td>
                  <td>{s.jobCount}</td>
                  <td>{s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : <span className="unknown">never</span>}</td>
                  <td>{s.coverage !== null ? <>{s.lastKept}/{s.lastFetched} kept<div className="sub">after title filter</div></> : <span className="unknown">—</span>}</td>
                  <td className="sub" style={{ maxWidth: 260 }}>{s.lastError ?? "—"}</td>
                  <td>
                    <div className="row">
                      <button disabled={!!busy} onClick={() => call("toggle", `/api/sources/${encodeURIComponent(s.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }, () => `${s.name} ${s.enabled ? "disabled" : "enabled"}.`)}>{s.enabled ? "Disable" : "Enable"}</button>
                      <button className="danger" disabled={!!busy} onClick={() => confirm(`Remove ${s.name}? Jobs already collected are kept.`) && call("rm", `/api/sources/${encodeURIComponent(s.id)}`, { method: "DELETE" }, () => `${s.name} removed.`)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Add a source</h2>
        <div className="row">
          <label>Type<select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}</select></label>
          <label>{k.field}<input value={token} onChange={(e) => setToken(e.target.value)} placeholder={k.hint} /></label>
          <label>Company name (optional)<input value={company} onChange={(e) => setCompany(e.target.value)} /></label>
          <label style={{ flex: 1, minWidth: 260 }}>Title keywords (comma separated; empty = keep all)<input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={test} disabled={!token.trim() || !!busy}>{busy === "test" ? "Testing…" : "Test connection"}</button>
          <button className="primary" onClick={add} disabled={!token.trim() || !!busy}>{busy === "add" ? "Adding…" : "Add source"}</button>
          <span className="sub">Test fetches the public endpoint once and stores nothing. Test before adding.</span>
        </div>
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"} role="status">{msg.text}</div>}
    </div>
  );
}
