"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/config/schema";
import { SKILL_LEVELS } from "@/lib/config/schema";

const WEIGHT_LABELS: Record<keyof Profile["weights"], string> = {
  javaSpring: "Java & Spring Boot", backendMicroservices: "Backend / microservices", dataApi: "Database, SQL & API", opsTooling: "Ops, Docker, testing, CI/CD",
  seniorityFit: "Seniority & experience fit", eligibility: "Remote eligibility", preferences: "Salary & preferences",
};
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function ProfileForm({ initial, skillOptions }: { initial: Profile; skillOptions: { id: string; label: string }[] }) {
  const router = useRouter();
  const [p, setP] = useState<Profile>(initial);
  const [titles, setTitles] = useState(initial.preferredTitles.join("\n"));
  const [avoidCo, setAvoidCo] = useState(initial.preferences.avoidCompanies.join("\n"));
  const [avoidKw, setAvoidKw] = useState(initial.preferences.avoidKeywords.join("\n"));
  const [exp, setExp] = useState(JSON.stringify(initial.experience, null, 2));
  const [ach, setAch] = useState(JSON.stringify(initial.achievements, null, 2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const weightSum = Object.values(p.weights).reduce((a, b) => a + b, 0);

  async function save() {
    setMsg(null);
    let experience: unknown, achievements: unknown;
    try { experience = JSON.parse(exp); } catch { return setMsg({ ok: false, text: "Experience is not valid JSON." }); }
    try { achievements = JSON.parse(ach); } catch { return setMsg({ ok: false, text: "Achievements are not valid JSON." }); }
    setBusy(true);
    try {
      const body = { ...p, preferredTitles: lines(titles), preferences: { ...p.preferences, avoidCompanies: lines(avoidCo), avoidKeywords: lines(avoidKw) }, experience, achievements };
      const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: `Profile saved. ${out.rescored} job${out.rescored === 1 ? "" : "s"} re-scored.` });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const updSkill = (i: number, patch: Partial<Profile["skills"][number]>) => set("skills", p.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSkill = () => set("skills", [...p.skills, { id: "", level: "familiar" }]);
  const dupIds = new Set(p.skills.map((s) => s.id).filter((id, i, a) => id && a.indexOf(id) !== i));

  return (
    <div>
      <div className="card">
        <h2>About you</h2>
        <div className="grid g3">
          <label>Name<input value={p.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label>Email<input value={p.email} onChange={(e) => set("email", e.target.value)} /></label>
          <label>Current title<input value={p.currentTitle} onChange={(e) => set("currentTitle", e.target.value)} /></label>
          <label>Location<input value={p.location} onChange={(e) => set("location", e.target.value)} /></label>
          <label>Country of residence (drives eligibility)<input value={p.countryOfResidence} onChange={(e) => set("countryOfResidence", e.target.value)} /></label>
          <label>Years of professional experience<input type="number" min={0} step={0.5} value={p.yearsExperience} onChange={(e) => set("yearsExperience", Number(e.target.value))} /></label>
        </div>
        <label style={{ marginTop: 10 }}>Summary<textarea value={p.summary} onChange={(e) => set("summary", e.target.value)} /></label>
        <label style={{ marginTop: 10 }}>Resume text (stays on this machine; used only for local matching)<textarea style={{ minHeight: 220 }} value={p.resumeText} onChange={(e) => set("resumeText", e.target.value)} /></label>
        <label style={{ marginTop: 10 }}>Target job titles (one per line)<textarea value={titles} onChange={(e) => setTitles(e.target.value)} /></label>
      </div>

      <div className="card">
        <h2>Skills and honest levels</h2>
        <p className="sub">Anything not listed here is treated as <strong>unverified</strong> and is never claimed. “Familiar” means exposure only (a posting requiring it still counts as a gap).</p>
        <datalist id="skill-ids">{skillOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</datalist>
        <div className="tablewrap"><table>
          <thead><tr><th>Skill id</th><th>Level</th><th>Note</th><th /></tr></thead>
          <tbody>
            {p.skills.map((s, i) => (
              <tr key={i}>
                <td><input list="skill-ids" value={s.id} onChange={(e) => updSkill(i, { id: e.target.value })} aria-label="Skill id" style={dupIds.has(s.id) || !s.id ? { borderColor: "#b91c1c" } : undefined} /></td>
                <td><select value={s.level} onChange={(e) => updSkill(i, { level: e.target.value as any })} aria-label="Level">{SKILL_LEVELS.map((l) => <option key={l}>{l}</option>)}</select></td>
                <td><input value={s.note ?? ""} onChange={(e) => updSkill(i, { note: e.target.value })} aria-label="Note" style={{ width: "100%" }} /></td>
                <td><button className="danger" onClick={() => set("skills", p.skills.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row" style={{ marginTop: 8 }}><button onClick={addSkill}>+ Add skill</button>{dupIds.size > 0 && <span className="error">Duplicate skill ids: {[...dupIds].join(", ")}</span>}</div>
      </div>

      <div className="card">
        <h2>Match weights</h2>
        <p className="sub">Relative importance of each category. Categories a posting can’t be assessed for are renormalised and lower confidence. Total: <strong>{weightSum}</strong> (any total works; it is normalised).</p>
        <div className="grid g4">
          {(Object.keys(WEIGHT_LABELS) as (keyof Profile["weights"])[]).map((k) => (
            <label key={k}>{WEIGHT_LABELS[k]}<input type="number" min={0} max={100} value={p.weights[k]} onChange={(e) => set("weights", { ...p.weights, [k]: Number(e.target.value) })} /></label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Preferences</h2>
        <div className="row">
          <label>Minimum salary<input type="number" value={p.salary.min ?? ""} onChange={(e) => set("salary", { ...p.salary, min: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          <label>Currency<input maxLength={3} style={{ width: 70 }} value={p.salary.currency} onChange={(e) => set("salary", { ...p.salary, currency: e.target.value.toUpperCase() })} /></label>
          <label>Per<select value={p.salary.period} onChange={(e) => set("salary", { ...p.salary, period: e.target.value as any })}><option>year</option><option>month</option></select></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" checked={p.preferences.remoteOnly} onChange={(e) => set("preferences", { ...p.preferences, remoteOnly: e.target.checked })} /> Remote only</label>
        </div>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <label>Avoid companies (one per line)<textarea value={avoidCo} onChange={(e) => setAvoidCo(e.target.value)} /></label>
          <label>Avoid keywords in title/description (one per line)<textarea value={avoidKw} onChange={(e) => setAvoidKw(e.target.value)} /></label>
        </div>
      </div>

      <div className="card">
        <h2>Experience &amp; achievements (advanced)</h2>
        <p className="sub">JSON, validated on save. Engagements inside one employment (e.g. AsiaCell) should keep <code>withinEmployment: true</code> so duration is never double-counted.</p>
        <div className="grid g2">
          <label>Experience<textarea style={{ minHeight: 260, fontFamily: "monospace", fontSize: 12 }} value={exp} onChange={(e) => setExp(e.target.value)} spellCheck={false} /></label>
          <label>Achievements (text + skill tags)<textarea style={{ minHeight: 260, fontFamily: "monospace", fontSize: 12 }} value={ach} onChange={(e) => setAch(e.target.value)} spellCheck={false} /></label>
        </div>
      </div>

      <div className="row">
        <button className="primary" onClick={save} disabled={busy || dupIds.size > 0}>{busy ? "Saving…" : "Save profile"}</button>
        {msg && <div className={msg.ok ? "ok" : "error"} role="status" style={{ margin: 0 }}>{msg.text}</div>}
      </div>
    </div>
  );
}
