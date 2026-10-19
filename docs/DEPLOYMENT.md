# Deployment

Two processes share one database: **web** (`next start`) and **worker** (`npm run worker`).

## Verification status

| Item | Status |
|---|---|
| Production build (`npm run build`) + `next start` with auth | Verified (`scripts/api-smoke.sh` against a real production server) |
| Worker as a real process (scheduled run, restart without re-running, graceful stop) | Verified (`scripts/worker-smoke.sh`) |
| Test suite on SQLite and on PostgreSQL 17 | Verified (`npm test`, `./scripts/test-postgres.sh`) |
| Dockerfile / docker-compose.yml | **Written, not built** (no Docker daemon was available while developing). Treat the first `docker compose up --build` as a test |
| Real SMTP / Resend delivery | **Not verified against a live provider.** Message construction is tested (nodemailer JSON transport, fake `fetch`); you must do a real test-send (below) |

## Option A: Docker Compose (web + worker + PostgreSQL)

```bash
cp .env.example .env
# edit .env: DASHBOARD_PASSWORD, AUTH_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD, APP_BASE_URL,
#            EMAIL_PROVIDER / SMTP_* or RESEND_API_KEY, EMAIL_FROM, EMAIL_TO
docker compose up -d --build
docker compose logs -f worker web
```

The web port is bound to `127.0.0.1:3000`. Put a TLS reverse proxy in front before exposing it; the session cookie is
`Secure` over HTTPS. Caddy example:

```
jobs.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Set `APP_BASE_URL=https://jobs.example.com` so the links in the digest point at the dashboard. The app checks the `Origin`
header on state-changing requests (CSRF), so the proxy must pass the original `Host`/`X-Forwarded-Host` unchanged.

## Option B: any host with Node ≥ 22.5 and PostgreSQL

```bash
npm ci && npm run build
export DATABASE_URL=postgres://user:pw@host:5432/jobhunter DASHBOARD_PASSWORD=… AUTH_SECRET=… APP_BASE_URL=https://…
npm run db:migrate
npm run start      # process 1 (supervise with systemd/pm2)
npm run worker     # process 2
```

Migrations also run automatically on first connection; `db:migrate` is for doing it explicitly.
SQLite (`sqlite:./data/jobhunter.db`) also works and is fine for one person on one machine, but both processes
must then run on the same machine/volume.

## Going live checklist

1. `DASHBOARD_PASSWORD` (≥ 8 chars) and `AUTH_SECRET` (≥ 32 chars) set. Without them production returns 503 for everything.
2. Served only over HTTPS.
3. Email: set `EMAIL_PROVIDER` and credentials, then **Settings → Email → Preview** (renders the digest, sends nothing) and
   **Send test** (a real provider requires an explicit confirmation; test sends are labelled and never mark jobs as notified).
   Check the **Delivery log** at the bottom of the Settings page.
4. Click **Run now** once with *dry run* enabled, check the run history, then disable dry run.
5. Confirm the worker log shows `started` and, after your scheduled time, a completed run.
6. Back up the database (below).

## Backups and upgrades

- PostgreSQL: `docker compose exec db pg_dump -U jobhunter jobhunter > backup.sql`.
- SQLite: copy `data/jobhunter.db` while the app is stopped.
- The database contains your profile/CV text and application notes: treat backups as private.
- Upgrade: pull, `docker compose up -d --build` (or rebuild and restart both processes). Schema changes are applied
  by the built-in migrations on startup.

## Monitoring

- Worker log lines are timestamped and contain no secrets (database URL passwords are masked, run logs are redacted).
- **Sources & Runs** shows every run, per-source status and last error.
- If runs stop: check that the worker is alive; a run holding the lock for more than 30 minutes is considered stale and
  taken over automatically.
