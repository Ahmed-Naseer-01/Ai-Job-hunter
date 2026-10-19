"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@/lib/config/schema";

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, color: "inherit" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        {label}
        {hint && <span className="sub"><br />{hint}</span>}
      </span>
    </label>
  );
}

const num = (v: string) => (v === "" ? 0 : Number(v));

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [s, setS] = useState<AppSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sch = (patch: Partial<AppSettings["schedule"]>) => setS((x) => ({ ...x, schedule: { ...x.schedule, ...patch } }));
  const search = (patch: Partial<AppSettings["search"]>) => setS((x) => ({ ...x, search: { ...x.search, ...patch } }));
  const bands = (patch: Partial<AppSettings["scoring"]["bands"]>) => setS((x) => ({ ...x, scoring: { bands: { ...x.scoring.bands, ...patch } } }));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: `Settings saved. ${b.rescored} job${b.rescored === 1 ? "" : "s"} re-scored. Schedule changes apply to the worker on its next check.` });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Schedule</h2>
        <div className="grid g4">
          <label>Daily run time<input type="time" value={s.schedule.time} onChange={(e) => sch({ time: e.target.value })} /></label>
          <label>Time zone (IANA)<input value={s.schedule.timezone} onChange={(e) => sch({ timezone: e.target.value })} /></label>
          <label>Lookback (days)<input type="number" min={1} max={365} value={s.schedule.lookbackDays} onChange={(e) => sch({ lookbackDays: num(e.target.value) })} /></label>
          <label>Min score for email<input type="number" min={0} max={100} value={s.schedule.minMatchScore} onChange={(e) => sch({ minMatchScore: num(e.target.value) })} /></label>
          <label>Max notifications / day<input type="number" min={0} max={100} value={s.schedule.maxNotificationsPerDay} onChange={(e) => sch({ maxNotificationsPerDay: num(e.target.value) })} /></label>
          <label>Close after N missed runs<input type="number" min={1} max={30} value={s.schedule.closeAfterMissedRuns} onChange={(e) => sch({ closeAfterMissedRuns: num(e.target.value) })} /></label>
          <label>Re-notify reminder (days, 0 = never)<input type="number" min={0} max={90} value={s.schedule.reminderDays} onChange={(e) => sch({ reminderDays: num(e.target.value) })} /></label>
        </div>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <Check label="Scheduled runs enabled" checked={s.schedule.enabled} onChange={(v) => sch({ enabled: v })} hint="Requires the worker process (npm run worker) to be running." />
          <Check label="Scheduled runs are dry runs" checked={s.schedule.dryRun} onChange={(v) => sch({ dryRun: v })} hint="Fetches and scores but saves nothing and sends no email." />
          <Check label="Include “potentially eligible” roles in email" checked={s.schedule.notifyPotentiallyEligible} onChange={(v) => sch({ notifyPotentiallyEligible: v })} />
        </div>
      </div>

      <div className="card">
        <h2>What counts as a match for you</h2>
        <p className="sub">Remote roles open to Pakistan are always included. Everything else below is opt-in; excluded roles stay in the database, just out of your best matches and email.</p>
        <div className="grid g2">
          <Check label="On-site roles in Pakistan" checked={s.search.includeOnsitePakistan} onChange={(v) => search({ includeOnsitePakistan: v })} />
          <Check label="Hybrid roles in Pakistan" checked={s.search.includeHybridPakistan} onChange={(v) => search({ includeHybridPakistan: v })} />
          <Check label="Relocation (on-site abroad)" checked={s.search.includeRelocation} onChange={(v) => search({ includeRelocation: v })} hint="Roles remain flagged “confirm visa/sponsorship”." />
          <Check label="Contract roles" checked={s.search.includeContract} onChange={(v) => search({ includeContract: v })} />
          <Check label="Internships" checked={s.search.includeInternships} onChange={(v) => search({ includeInternships: v })} />
          <Check label="Show synthetic sample jobs" checked={s.search.showSynthetic} onChange={(v) => search({ showSynthetic: v })} hint="Clearly labelled demo data. Never emailed." />
        </div>
      </div>

      <div className="card">
        <h2>Score bands</h2>
        <div className="row">
          <label>High ≥<input type="number" value={s.scoring.bands.high} onChange={(e) => bands({ high: num(e.target.value) })} /></label>
          <label>Good ≥<input type="number" value={s.scoring.bands.good} onChange={(e) => bands({ good: num(e.target.value) })} /></label>
          <label>Review ≥<input type="number" value={s.scoring.bands.review} onChange={(e) => bands({ review: num(e.target.value) })} /></label>
          <span className="sub">Below “Review” is Low. Must satisfy High &gt; Good &gt; Review.</span>
        </div>
      </div>

      <div className="card">
        <h2>Email</h2>
        <div className="row">
          <Check label="Send the daily digest" checked={s.email.enabled} onChange={(v) => setS((x) => ({ ...x, email: { ...x.email, enabled: v } }))} />
          <label style={{ minWidth: 280 }}>Recipient<input type="email" value={s.email.to} onChange={(e) => setS((x) => ({ ...x, email: { ...x.email, to: e.target.value } }))} /></label>
        </div>
        <p className="sub">Provider credentials are read from environment variables only; they are never stored in the database or shown here. The AI assistant is off: your CV is never sent to an external AI service.</p>
      </div>

      <div className="row">
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
        {msg && <div className={msg.ok ? "ok" : "error"} role="status" style={{ margin: 0 }}>{msg.text}</div>}
      </div>
    </div>
  );
}
