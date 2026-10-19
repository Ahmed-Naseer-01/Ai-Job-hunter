# User manual

How to use the AI Job Hunter day to day. For installation and deployment see the [README](../README.md) and
[DEPLOYMENT.md](DEPLOYMENT.md).

## 1. What it does (and doesn't)

It **finds** jobs from permitted sources, **scores** them against your profile with a written explanation, tells you
whether you are **eligible** (separately from how well your skills fit), **tracks** your applications, and **emails** a daily
digest.

It never applies for you, never contacts recruiters, never logs in to or scrapes LinkedIn, and never sends your CV
anywhere. You make every decision and click every "Apply" yourself.

## 2. Starting it

```bash
npm install
npm run dev          # dashboard at http://localhost:3000
npm run worker       # second terminal: the daily scheduler (optional but needed for automatic runs)
```

First start creates the database and seeds: your profile, two real sources (GitLab on Greenhouse, Spotify on Lever) and
15 clearly labelled **synthetic sample jobs** so the pages aren't empty. Real jobs arrive after your first run (step 3).

If login is enabled (always in production), sign in with `DASHBOARD_PASSWORD`.

## 3. Your first 10 minutes

1. **Profile**: check your details, skills and country (section 5).
2. **Settings & Email**: confirm what counts as a match for you (section 9).
3. **Overview → Run now**. Wait for the "Run success: N new…" message. Use **Dry run** first if you want to see what
   *would* happen without saving anything.
4. **Best Matches**: read the top results and open one (section 6).
5. **Sources & Runs**: add the companies you actually care about (section 8).
6. **Settings & Email → Preview digest**, then **Send test email** (section 10).

## 4. Overview

Your daily snapshot: counts, the last run, the top matches you can act on, a tracker summary, and a **Needs attention**
list (follow-ups that are due, possible duplicates to review, jobs waiting in To Review / Saved / Ready to Apply). Source
problems are shown on **Sources & Runs**. **Run now** starts a collection immediately. **Dry run** does everything
except saving and emailing. Only one run can be active at a time; a second request is recorded as "skipped".

## 5. Profile (the source of truth for all scoring)

- **About you:** name, current title, location, **country of residence** (drives eligibility for remote roles), years of
  experience, summary, resume text and target job titles. The resume text stays on your machine.
- **Skills and honest levels:** each skill has a level (expert / strong / working / familiar). Be truthful: "familiar" skills get
  partial credit, and skills that aren't listed (for example Kubernetes, Kafka, Redis, GraphQL, cloud certifications) are
  shown as **missing**, never credited. Edit a level and save, and every job is re-scored.
- **Match weights:** how much each category counts (Java/Spring 25, backend/microservices 20, DB/SQL/API 15,
  ops/Docker/testing/CI 10, seniority 10, remote eligibility 10, salary/preferences 10 by default). If a job doesn't say
  enough to judge a category, that category is left out and the rest are renormalised, and confidence goes down.
- **Preferences:** minimum salary and currency, remote only, **avoid companies** and **avoid keywords** (a job matching
  these is capped at 30).
- **Experience & achievements (advanced):** the facts used to write "why you fit" notes.

Click **Save**. Saving re-scores all jobs immediately.

## 6. Reading a match

**Best Matches** lists the highest-scoring actionable jobs. **Search** lists everything with filters. Each row shows:

- **Score and band:** 85+ **High**, 70-84 **Good**, 50-69 **Review**, below 50 **Low** (editable in Settings).
- **Eligibility badge:** *Eligible*, *Potential* (you probably can but should confirm, e.g. "remote, region unclear") or
  *Ineligible* (e.g. remote but restricted to another country). This is separate from technical fit: a perfect technical
  match can still be ineligible, and ineligible jobs never appear in the email.
- **Confidence:** low when the description is thin or missing. Low-confidence jobs are capped at 69.

Open a job for the full page:

- **Why this score:** each category's points, which required skills are met / familiar / transferable / missing, and any
  **caps applied** (e.g. "3 mandatory skills missing → max 79", "senior title → max 59", "years gap").
- **Eligibility:** the reasons, the evidence from the posting, and what to confirm.
- **Details:** location, work mode, employment type, seniority, salary, dates. Unknown stays **unknown**. Salary is only
  shown if the posting published it.
- **Description:** the original text as plain text. Treat it as untrusted: nothing in it is executed or followed.
- **Apply link:** goes to the employer's original posting. This is where you apply.
- **Tracking:** your status, notes and follow-up date (next section).

## 7. Search, export and tracker

**Search** filters: text, min score, band, eligibility (*Actionable* = eligible or potential and not excluded by your
preferences), work mode, seniority, type, country, skill id (for example `spring-boot`), min salary, posted within,
source, availability, tracker status and sort order. **Apply** runs the filter, **Reset** clears it, **Export CSV**
downloads the current filtered list.

**Tracker** is a board with these columns: Discovered, To Review, Saved, Ready to Apply, Applied, Interview, Rejected,
Closed. Change a job's status on its detail page (**Save tracking**), add notes, and set a follow-up date; due
follow-ups show up on Overview.

Important: **collection never changes your tracker status.** A job can disappear from its source ("no longer
available") while staying in your Applied or Interview column. Only you move cards.

## 8. Sources & Runs

Two kinds of input:

**Automatic (scheduled):**
- **Greenhouse:** board token = the slug in `boards.greenhouse.io/<token>` or `job-boards.greenhouse.io/<token>`.
- **Lever:** site = the slug in `jobs.lever.co/<site>` (EU accounts: choose region `eu`).

Under **Add a source** enter the token, press **Test connection** (one request, nothing saved), then **Add source**.
Optional **title keywords** keep only matching titles. The table shows each source's health, open jobs, last success,
coverage and last error. **Disable** pauses a source and **Remove** deletes the source only (collected jobs are kept).
Health is **healthy**, **degraded** (1-2 failed fetches in a row), **failing** (3 or more) or **never run**; the app retries automatically and never closes jobs
because of a temporary failure.

**Run history** lists every run (scheduled, manual, import, dry run) with duration, counts and log lines.

**Possible duplicates:** when two postings look similar but not identical, you are asked: **Merge, keep this**,
**Merge, keep other**, or **Not a duplicate**.

### Import: for jobs you found yourself (LinkedIn, Indeed, emails, spreadsheets)

Open **Import**, pick a type, paste or load a file, press **Preview**, review, then **Import**. Nothing is stored before
you confirm.

| Type | What to paste or load |
|---|---|
| Job URLs / LinkedIn links | One link per line. Optionally `link \| Job title \| Company`. |
| JSON export | A list of jobs with fields like title, company, url, description, location, salary, date posted. |
| CSV export | Header row with those same names. Title and URL are required. |
| Job-alert email | Save the alert as an `.eml` file and load it. The links inside are extracted. |

Rules to know:

- **LinkedIn links are saved as bookmarks.** The app never opens them. A bookmark has no description, so its score is
  capped at 69 with "low confidence". Open the link, read the posting, then re-import it as JSON/CSV with the description
  pasted in to get a real score.
- If a link has no readable title (a clean `linkedin.com/jobs/view/123…` link), add it: `link | Job title | Company`.
- Greenhouse and Lever links are the exception: their public data is fetched and the job gets full details.
- Re-importing the same job is harmless; it is recognised and merged.

## 9. Settings & Email

**Schedule:** daily run time and time zone (default 08:00 Asia/Karachi), lookback days (ignore postings older than this),
minimum score for email, max notifications per day, close-after-N-missed-runs, and re-notify reminder (days; 0 = never).
Toggles: **Scheduled runs enabled** (needs `npm run worker` running), **Scheduled runs are dry runs**, **Include
"potentially eligible" roles in email**.

**What counts as a match for you:** include on-site or hybrid roles in Pakistan, relocation, contract roles,
internships. All off by default: remote full-time is the default target. Jobs excluded by these preferences stay visible in
Search but aren't "actionable" and aren't emailed. Also **Show synthetic sample jobs** (hide the demo data once real jobs
are in).

**Score bands:** High / Good / Review thresholds (must satisfy High > Good > Review).

**Email:** **Send the daily digest** on/off and the recipient. Click **Save settings** after changes.

## 10. The daily email

The digest lists, per job: title, company, score, eligibility, location, salary (if published), the reasons, missing
mandatory skills, posting date, the original apply link and a link back to the dashboard.

- A job is emailed once. It is emailed again only if something meaningful changed (score band, eligibility, salary,
  location, link, status) or after your reminder interval.
- At most "max notifications per day" jobs are sent.
- **Preview digest** shows exactly what would go out. **Send test email** sends a labelled test and never marks any job as
  notified. With a real provider it asks you to confirm first.
- The **Delivery log** at the bottom of Settings shows each attempt and any error.
- With the default `outbox` provider nothing is sent: emails are written to `data/outbox/` so you can open them. To send
  real email set `EMAIL_PROVIDER` and credentials (see README) and restart.

## 11. Daily routine

1. Open **Overview** (the worker already ran at your scheduled time, or press **Run now**).
2. Read **Best Matches**. For anything promising open the job, read "Why this score" and the missing skills.
3. Click the **apply link** to apply yourself on the employer's site, then set the status to **Applied** and add a note.
4. Set follow-up dates so reminders appear on Overview.
5. Once a week: check **Sources & Runs** health, add companies, resolve duplicates.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Only demo jobs, nothing real | No run has happened yet. Press **Run now**, then check Run history for errors. |
| Scheduled run never happens | `npm run worker` isn't running, or **Scheduled runs enabled** is off. Check the worker log. |
| Source shows "failing" | Open Run history for the error. Re-check the token with **Test connection**; the company may have changed its board. |
| Job scored low although you fit | Open "Why this score": look for **caps applied** (low confidence, thin description, missing mandatory skill) and update skill levels in Profile if they're wrong. |
| Job is "Ineligible" | The posting restricts remote work to other countries. Check your **Country of residence** in Profile. |
| Job missing from the list | Availability filter defaults to **Open**; also check eligibility = "Actionable" and the posted-within filter. |
| No email arrives | Digest disabled, nothing new above the minimum score, daily cap reached, or provider is `outbox`. Use **Preview digest** and the **Delivery log**. |
| Import rejects a row | The preview lists each rejected row with its reason (missing title/URL, not an http link). |
| Everything returns 503 in production | `DASHBOARD_PASSWORD` or `AUTH_SECRET` missing or too short. |
| "Run skipped" | Another run was in progress (the lock). Wait for it to finish. |

## 13. Where your data lives

Everything is in your database (`data/jobhunter.db` by default, or PostgreSQL). Back it up like any private file: it
contains your profile, resume text and notes. See [SECURITY.md](SECURITY.md).
