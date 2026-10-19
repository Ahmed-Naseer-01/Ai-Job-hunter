# AI Job Hunter

A personal, single-user job-hunting tool for a Java backend engineer. It collects postings from permitted
sources, normalises and de-duplicates them, scores each against an editable profile with a fully explained
0–100 score, keeps **eligibility separate from technical fit**, tracks applications, and emails a daily digest.

It **never** applies to jobs, contacts recruiters, scrapes LinkedIn, logs in anywhere, or sends your CV to an
external service. Scoring is deterministic code, not an LLM.

| Doc | Contents |
|---|---|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | **How to use it day to day** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design, data model, scoring/eligibility rules |
| [docs/SOURCES.md](docs/SOURCES.md) | Each source: access, limits, fields, how it was tested, imports |
| [docs/SCHEDULING.md](docs/SCHEDULING.md) | Daily schedule, worker, local (launchd/cron) and production setup |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Postgres, Docker Compose, reverse proxy, backups |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, data handling, untrusted-input rules |

## Quick start (local, SQLite)

Requires Node ≥ 22.5 (developed and tested on Node 26; uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env          # optional locally; see "Configuration"
npm run dev                   # http://localhost:3000
```

On first start the database is created in `./data/jobhunter.db` and seeded with:

- the profile (editable at **Profile**),
- two real, enabled sources (`greenhouse:gitlab`, `lever:spotify`) for demonstration (change them in **Sources**),
- 15 **synthetic sample jobs**, clearly labelled `[SYNTHETIC SAMPLE]` with `example.com` links, so the dashboard is
  not empty before the first real run. Hide them in **Settings → Show synthetic**, or start with `SEED_SYNTHETIC=false`.
  Synthetic jobs are never emailed in the real digest.

Then click **Run now** on the Overview page (or `npm run run:once`). Real postings are fetched from the enabled sources (the first run takes a few seconds to a minute, depending on the network).

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Dashboard |
| `npm run worker` | Persistent scheduler (daily run, retries); independent of the dashboard |
| `npm run run:once -- --dry-run` | One pipeline run now. Flags: `--dry-run` (stores nothing), `--lookback N`, `--source <key>`, `--no-notify` |
| `npm run probe -- greenhouse gitlab` | Live request to a source and a field-coverage report |
| `npm run db:migrate` / `db:seed` | Apply schema / seed defaults |
| `npm test` | Test suite on SQLite |
| `./scripts/test-postgres.sh` | Test suite on a throwaway local PostgreSQL (or `TEST_PG_URL=… npm test`) |
| `npm run typecheck` | `tsc --noEmit` |

## Pages

Overview · Best Matches · Jobs (search/filters, CSV export) · Job Details · Tracker (Discovered → To Review → Saved →
Ready to Apply → Applied → Interview → Rejected → Closed, with dates, notes, follow-up reminders) · Import ·
Profile · Sources & Runs · Settings (schedule, thresholds, search preferences, email).

## Configuration

Everything except credentials is edited in the UI and stored in the database. Credentials come **only** from
environment variables ([.env.example](.env.example)):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | no | `sqlite:./data/jobhunter.db` (default) or `postgres://user:pw@host:5432/db` |
| `DASHBOARD_PASSWORD` | **production** | ≥ 8 chars. Single-user login |
| `AUTH_SECRET` | **production** | ≥ 32 chars; signs session cookies (`openssl rand -hex 32`) |
| `APP_BASE_URL` | for email links | e.g. `https://jobs.example.com` |
| `EMAIL_PROVIDER` | no | `outbox` (default, writes `./data/outbox`, sends nothing), `smtp`, `resend` |
| `EMAIL_FROM`, `EMAIL_TO` | for email | sender / recipient (recipient can also be set in Settings) |
| `SMTP_HOST/PORT/USER/PASS/SECURE` | if `smtp` | SMTP credentials |
| `RESEND_API_KEY` | if `resend` | Resend API key |
| `WORKER_TICK_SECONDS` | no | Scheduler check interval, default 30 |
| `PG_POOL_MAX` | no | Postgres pool size, default 10 |
| `SEED_SYNTHETIC` | no | `false` skips the synthetic sample jobs on first start |

In **production** (`NODE_ENV=production`) the app **refuses all requests (HTTP 503)** unless `DASHBOARD_PASSWORD` and
`AUTH_SECRET` are set and strong. It only runs unauthenticated in `next dev` with nothing configured.

## How scoring works (short version)

Weights (editable): Java/Spring 25 · backend/microservices 20 · DB/SQL/API 15 · ops/Docker/testing/CI 10 ·
seniority fit 10 · remote eligibility 10 · salary/preferences 10. Categories that cannot be assessed from the posting
are dropped and the rest renormalised, which also lowers the confidence shown. Deterministic caps keep a score honest
(e.g. thin descriptions ≤ 69, senior/lead titles, large years-of-experience gaps, missing mandatory skills, ineligible
country, no Java/Spring). Bands: **85+ High, 70–84 Good, 50–69 Review, < 50 Low** (editable).
Skills are classed *met / familiar / transferable / missing*. AWS, React, JavaScript and Bootstrap count as
"familiar, not expert", and technologies absent from the profile (Kubernetes, Kafka, Redis, GraphQL, certifications)
are never credited. Eligibility (*eligible / potential / ineligible*) is computed and displayed separately.

## Known limitations

- **Sources:** only Greenhouse and Lever public boards are polled automatically. LinkedIn, Indeed and other
  aggregators are supported only through user-supplied imports (links become *bookmarks*: never fetched, scored with low
  confidence). See [docs/SOURCES.md](docs/SOURCES.md).
- **No LLM** features. Explanations are template-based from the deterministic score.
- Requests for a non-existent `/jobs/<id>` render the "not found" page but with HTTP 200 (Next.js streaming with
  `loading.tsx`). Cosmetic; the API returns a proper 404.
- Salary is only recorded when the posting publishes it; it is never guessed.
- The Dockerfile / Compose file were written but **not built** in the development environment (no Docker daemon).
- Single-user by design: one password, one profile.
