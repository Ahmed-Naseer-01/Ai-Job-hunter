import { authMode, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const auth = authMode();
  return (
    <div className="card" style={{ maxWidth: 380, margin: "60px auto" }}>
      <h1>Sign in</h1>
      {auth.mode === "misconfigured" && <div className="error" role="alert">Server authentication is not configured: {auth.problem}.</div>}
      {auth.mode === "open_dev" && <div className="note">Development mode: no password is configured, so the dashboard is open. Set DASHBOARD_PASSWORD and AUTH_SECRET to require sign-in.</div>}
      {sp.error && <div className="error" role="alert">{sp.error}</div>}
      <form method="post" action="/api/auth/login">
        <input type="hidden" name="next" value={safeNext(sp.next)} />
        <label>Password<input type="password" name="password" autoComplete="current-password" autoFocus required style={{ width: "100%" }} /></label>
        <p><button className="primary" type="submit">Sign in</button></p>
      </form>
    </div>
  );
}
