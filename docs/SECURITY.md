# Security and privacy

## Data handling

- Your profile/CV and application notes live only in your database. **Nothing is sent to any AI or third-party service.**
  There is no LLM integration; scoring and explanations are local deterministic code.
- The only outbound requests are: Greenhouse/Lever public API calls for the sources you enable (job data only; no profile
  data in the request), and email delivery if you configure an external provider.
- Credentials (`DASHBOARD_PASSWORD`, `AUTH_SECRET`, SMTP/Resend, `DATABASE_URL`) come from environment variables only.
  `.env` is git-ignored; `.env.example` has placeholders. They are never stored in the database or rendered in the UI.
- No LinkedIn (or any other site) passwords, cookies or session tokens are collected or stored. LinkedIn is never contacted.
- **Never automated:** applying to jobs, messaging recruiters, or any external action. The digest links to the original posting;
  you decide.

## Authentication (single user)

- Production **fails closed**: if `DASHBOARD_PASSWORD` (≥ 8) or `AUTH_SECRET` (≥ 32) is missing or weak, every request gets 503.
  Only `next dev` with *neither* configured runs open.
- Session cookie `jh_session`: HMAC-SHA256-signed, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, 7-day lifetime.
  Password comparison is constant-time.
- Login throttle: 5 failed attempts per 15 minutes per client, plus a small delay on each failure.
- All pages and all `/api/*` routes are behind `src/proxy.ts`. Only `/login` and `/api/auth/login` are public. Anonymous API
  calls get 401, anonymous pages redirect to `/login?next=…` (with an open-redirect guard).
- State-changing API requests are checked against the `Origin`/`Host` headers (CSRF).
- Security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

## Untrusted input

Job descriptions, imported files and email bodies are **data**, never instructions:

- Rendered as plain text (React escaping). The email-preview iframe uses `sandbox=""` (no scripts).
- Nothing in a description or import is executed, downloaded, or followed. Only Greenhouse/Lever API hosts chosen by the
  app are ever requested for imports, never a host taken from user input, so internal addresses cannot be reached (SSRF).
- All external data is validated with zod; request bodies are size-limited (1 MB JSON, 2 MB imports), SQL is parameterised,
  `LIKE` input is escaped.
- CSV export neutralises spreadsheet formula injection (`=`, `+`, `-`, `@` prefixes).
- Application status is written only by explicit user action, never by collection or import.

## Logging

Run logs and delivery logs pass through a redactor (secrets like `password=`, `api_key=`, `Authorization: Bearer …`, and
email addresses are masked). The notification log stores a masked recipient. Resume text is never logged. The worker prints
the database URL with the password masked. Unexpected API errors return a generic 500 to the client; details go to the
server log only.

## Known gaps / for you to decide

- Single shared password, no 2FA, no per-device session revocation (rotate `AUTH_SECRET` to invalidate all sessions).
- The login throttle is in-process memory: it resets on restart and is per instance.
- Data at rest is not encrypted by the app; use disk/database encryption on your host.
- Tests cover these controls (`tests/auth.test.ts`, `tests/import.test.ts`, `tests/providers.test.ts`), but this has not had
  an independent security review.
