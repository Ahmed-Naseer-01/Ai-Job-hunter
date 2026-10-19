# Sources

A source is described as **integrated** only after a real request succeeded. Status below is from live requests
made with `npm run probe` on **2026-10-19** (reproduce it yourself at any time; the **Sources** page also has a
"Test" button that does the same thing and reports the result).

| Source | Kind | Integrated? | Evidence (live, 2026-10-19) |
|---|---|---|---|
| Greenhouse Job Board API | scheduled | **Yes** | `greenhouse:gitlab` → HTTP 200, 229 postings listed, 229 normalised, all with description and location, 104 with published salary; `verifyJob` → HTTP 200 |
| Lever Postings API | scheduled | **Yes** | `lever:spotify` → HTTP 200, 81 postings, all normalised with description and location, 19 with published salary; `verifyJob` → HTTP 200 |
| Greenhouse / Lever single-URL import | import | **Yes** (fake-fetch tested in CI; same code path as above) | `tests/import.test.ts` |
| JSON / CSV import | import | **Yes** (tested, no network) | `tests/import.test.ts` |
| Job-alert `.eml` import | import | **Yes** (tested on a synthetic multipart/base64/quoted-printable message; **not** yet tried on a real LinkedIn alert email) | `tests/import.test.ts` |
| LinkedIn links you provide | import (bookmark only) | **Yes, as bookmarks only** | never fetched, by design |
| Indeed and other aggregators | import (bookmark only) | Bookmark only | never fetched |

No other automatic source is claimed. Adding one is a new adapter (`src/lib/sources/types.ts` shows the interface).

## Greenhouse Job Board API

- **Access:** public, unauthenticated, no key. Endpoint `https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`.
  The board token is the slug in `boards.greenhouse.io/<token>` or `job-boards.greenhouse.io/<token>`.
- **Setup:** Sources → add → kind `greenhouse`, board token, optional `companyName`, optional `titleKeywords`
  (case-insensitive title pre-filter).
- **Limits / etiquette:** one list request per source per run (daily by default), 20 s timeout, bounded retry with
  exponential backoff and jitter; `Retry-After` is honoured but capped. No parallel hammering.
- **Fields obtained:** id, title, location, absolute URL, HTML description (converted to plain text), updated/first-published
  time, departments, pay ranges. Company comes from the payload when present.
  Salary comes from `pay_input_ranges` when the employer publishes it, otherwise from salary text in the description
  (104 of 229 GitLab postings ended up with a salary by either route). **Not provided by the API** (stay *unknown* unless the text says it): employment type,
  years of experience (extracted from the description when written).
- **Attribution / terms:** these are the public job-board feeds companies expose for exactly this purpose; each job keeps its
  original apply URL and source id. Review the terms of the individual employer if you redistribute data.

## Lever Postings API

- **Access:** public, unauthenticated. `https://api.lever.co/v0/postings/<site>?mode=json` (EU: `api.eu.lever.co`).
- **Setup:** kind `lever`, site slug (`jobs.lever.co/<site>`), `region` `global` or `eu`, optional `companyName`/`titleKeywords`.
  Set `companyName` (the seed does); otherwise the company shows as the lower-case site slug.
- **Fields:** id, title, categories (location/team/commitment), description (plain and lists), hosted/apply URL, created time,
  workplaceType, `salaryRange` when the employer publishes it.
- Same limits and retry behaviour as Greenhouse.

## Closure (when a job is marked "no longer available")

A job is only closed when **both**: every source that has seen it has missed it for at least
`closeAfterMissedRuns` consecutive *complete* listings (a failed or truncated fetch never counts), **and**
`verifyJob` gets a 404/410 from the source. Closure records the evidence (request + status) and timestamp. A temporary
source failure never closes anything, and closing never touches your Tracker status.

## Importing things you found yourself (Import page, `POST /api/import`)

Always preview first; nothing is stored until you confirm. Limits: 2 MB, 500 rows.

| Type | Input | Notes |
|---|---|---|
| URLs | one link per line, optional `url \| title \| company` | Greenhouse/Lever links are fetched from their **public API hosts only** (the host is chosen by the app, never taken from the link, so it cannot be pointed at internal addresses). Everything else becomes a bookmark. |
| JSON | array or `{ "jobs": [...] }` | Flexible field names (title/job title/position, company/employer, url/link/apply url, description, location, salary, date posted, …). |
| CSV | header row; comma, semicolon or tab | Same field names. RFC 4180 quoting, BOM, embedded newlines. |
| .eml | a saved job-alert email | Job links are extracted; footer/unsubscribe/settings links and non-http schemes are ignored; attachments are ignored. |

**LinkedIn:** links are normalised to `https://www.linkedin.com/jobs/view/<id>/` (tracking parameters removed) and stored
as **bookmarks**. The app never requests LinkedIn, never logs in, and stores no LinkedIn credentials, cookies or tokens.
Bookmarks carry no description, so they have *low confidence* and their score is capped at 69. Open the link, read the
posting yourself, and paste the description via JSON/CSV import if you want a real score.

Imported rows go through the same normalisation, de-duplication (canonical URL, exact source id, fuzzy match with a human
review queue for ambiguous cases) and scoring as scheduled jobs. Re-importing is idempotent and never changes Tracker status.

## Source health (Sources page)

Per source: last attempt, last success, last error, consecutive failures, jobs seen/kept in the last run, and per-run logs.
