import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/db/config";
import { notificationLog } from "@/lib/services/queries";
import { SettingsForm } from "@/components/SettingsForm";
import { EmailPanel } from "@/components/EmailPanel";
import { providerFromEnv } from "@/lib/notify/providers";
import { fmtDateTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await getDb();
  const settings = await loadSettings(db);
  const log = await notificationLog(db, 20);
  const provider = providerFromEnv();
  return (
    <>
      <h1>Settings &amp; email</h1>
      <p className="lead">Schedule, match preferences, score bands and the daily digest.</p>
      <SettingsForm initial={settings} />
      <EmailPanel provider={provider.name} external={provider.deliversExternally} recipient={settings.email.to} />
      <div className="card">
        <h2>Delivery log</h2>
        {log.length === 0 ? (
          <p className="unknown">Nothing sent or previewed yet.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>When</th><th>Kind</th><th>Provider</th><th>Recipient</th><th>Subject</th><th>Jobs</th><th>Status</th></tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtDateTime(l.ts, settings.schedule.timezone)}</td>
                    <td>{l.kind}{l.dryRun ? " (dry)" : ""}</td>
                    <td>{l.provider}</td>
                    <td>{l.recipient}</td>
                    <td>{l.subject}</td>
                    <td>{l.jobCount}</td>
                    <td>
                      <span className={`badge ${l.status === "sent" ? "elig-eligible" : l.status === "failed" ? "elig-ineligible" : "muted"}`}>{l.status}</span>
                      {l.error && <div className="sub">{l.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
