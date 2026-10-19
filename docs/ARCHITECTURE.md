# AI Job Hunter — Architecture

Personal, single-user job-hunting app for Muhammad Ahmed Naseer. One repo, one codebase, two processes
(web + worker) sharing one database. No microservices.

## Process model

```
 ┌─────────────┐   reads/writes   ┌───────────────┐   reads/writes   ┌──────────────┐
 │ Next.js web │ ───────────────► │  SQLite (dev) │ ◄─────────────── │ Worker       │
 │ (dashboard, │                  │  Postgres     │                  │ (scheduler   │
 │  API routes)│                  │  (production) │                  │  loop)       │
 └──────┬──────┘                  └───────────────┘                  └──────┬───────┘
        │ "Run now" (in-process)                                           │ daily run
        └──────────────────────► runPipeline() ◄───────────────────────────┘
                                   (shared lib, DB lock prevents overlap)
```

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Web | Next.js (App Router) + TypeScript | Requested. Server components read the DB directly. |
| DB access | Thin `Db` interface, two drivers (`node:sqlite`, `pg`), portable SQL | No native build, no ORM lock-in; dev on SQLite, prod on Postgres, both tested. |
| Timestamps / JSON | ISO-8601 `TEXT`, JSON as `TEXT` | Portable across SQLite and Postgres. |
| Validation | `zod` on all external data (ATS payloads, imports) | Required by spec; untrusted input. |
| Scheduler | Worker loop with *catch-up* semantics, timezone via `Intl` | Survives sleeping laptops / restarts; no Cursor dependency; pure function is unit-testable. |
| Overlap protection | DB lock row with TTL + stale takeover | Works across web + worker processes. |
| Matching | Deterministic, explainable, editable weights | Code enforces caps and hard eligibility; explanations are template-based. |
| LLM | **Not implemented.** Scoring and explanations are deterministic; nothing is sent to any AI service | Spec: never send the CV out without explicit consent. If an LLM is added later it must be opt-in, zod-validated, and unable to change caps/eligibility. |
| Email | `EmailProvider` interface: `outbox` (file), `smtp`, `resend` | Preview/dry-run/test-send/delivery log. |
| Auth | Password + HMAC-signed session cookie via Next middleware | Required before public exposure. |

## Module layout (`src/lib`)

- `db/` – driver interface, sqlite + postgres drivers, SQL migrations, repositories.
- `profile/` – verified profile (seed from resume), settings schema + defaults.
- `sources/` – adapter interface; `greenhouse`, `lever`, `manual-url`, `import-json/csv`, `email-import`, `linkedin-link`; retry/backoff; health.
- `extract/` – HTML→text, skill taxonomy + extraction, years-of-experience, salary, work-mode, seniority.
- `matching/` – eligibility engine, scoring engine, bands, explanation.
- `dedupe/` – URL canonicalisation, similarity, merge.
- `pipeline/` – run orchestration (fetch → normalise → dedupe → eligibility → score → persist → recheck → digest).
- `notify/` – digest builder, providers, notification dedupe, delivery log.
- `scheduler/` – schedule maths, lock, worker loop.
- `auth/` – session signing/verification.

## Lifecycle vs. tracker (kept separate on purpose)

- `jobs.lifecycle`: `new | seen | updated | closed` — owned by the collector.
- `applications.status`: `discovered | to_review | saved | ready_to_apply | applied | interview | rejected | closed` — owned by the user.
  Collection never writes to `applications`. Closure evidence (timestamp + method) is stored on the job.

## Source policy

Only documented public/authorised endpoints: Greenhouse Job Board API, Lever Postings API, user-supplied URLs,
JSON/CSV exports, job-alert `.eml` imports, and LinkedIn *links the user supplies* (stored as bookmarks; the app never
fetches LinkedIn). A source is only called "integrated" in `docs/SOURCES.md` after a recorded successful live request.

## Phases

1. Architecture (this doc) 2. Profile + schema + dashboard + synthetic seed 3. One real source (Greenhouse) + Lever
4. Matching, eligibility, dedupe 5. Extra sources + health 6. Scheduler, run history, notifications 7. Tests, hardening, deploy docs.
