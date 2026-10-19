# Scheduling

The scheduler is a separate long-running process, **independent of the dashboard and of Cursor**:

```bash
npm run worker
```

Every `WORKER_TICK_SECONDS` (default 30, minimum 5) it reads the schedule from the database and asks whether a run is due.
Changing the time/timezone/enabled flag in **Settings** takes effect without restarting the worker.

## Semantics

- **Daily, in a configurable IANA timezone** (default `Asia/Karachi`, 08:00).
- **Catch-up:** exactly one scheduled run per local calendar day once the slot has passed. If the computer was asleep at
  08:00, the run happens when the worker wakes. A restart after a successful run does *not* run again.
- **Retries:** a failed scheduled run is retried with bounded exponential backoff (5, 10, 20, 40, 60 min cap), up to 3
  attempts per daily slot, then marked *gave up* until the next day. A run skipped because another run holds the lock is
  not counted as an attempt.
- **No overlap:** the pipeline takes a database lock (`pipeline`, 30-minute TTL, stale locks are taken over). Web "Run now",
  `npm run run:once` and the worker can all run safely together; the later one is recorded as *skipped*.
- **Steps per run:** fetch → normalise → dedupe → eligibility → score → save → recheck saved/applied jobs (availability) →
  pick high-priority matches → digest → record duration, counts and errors. One failing source does not stop the others.
- **Configurable (Settings):** time, timezone, enabled, lookback days, minimum score for emails, max notifications per day,
  dry-run, close-after-missed-runs, reminder days.
- **Dry run:** does everything, including scoring and building the digest, then rolls the database back. Nothing is stored
  and nothing is sent. The run is still shown in history as a dry run.
- **Run Now:** button on Overview, `POST /api/runs`, or `npm run run:once` (`--dry-run`, `--lookback N`, `--source key`,
  `--no-notify`).
- **History:** every run (scheduled, manual, import) is persisted with status, duration, counts, error and log lines.

## Local: keep the worker running on a Mac

Simplest: leave a terminal open with `npm run worker`. For a persistent background job use launchd. This plist is an
**example, not tested here**; adjust the paths (find `npm` with `which npm`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.jobhunter.worker</string>
  <key>WorkingDirectory</key><string>/Users/YOU/Desktop/myBucket</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/npm</string><string>run</string><string>worker</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/jobhunter-worker.log</string>
  <key>StandardErrorPath</key><string>/tmp/jobhunter-worker.err</string>
</dict></plist>
```

```bash
cp local.jobhunter.worker.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/local.jobhunter.worker.plist
```

The worker reads `.env` only if your launcher exports it. With launchd put the variables in `EnvironmentVariables`
(or use Docker, below). Because of catch-up semantics a sleeping laptop is fine, but a laptop that is *off* all day cannot
run anything, so for guaranteed delivery use the production option.

Cron is possible (`0 8 * * * cd /path/myBucket && npm run -s run:once`), but `run:once` is an unconditional run with none of
the catch-up/retry logic. Prefer the worker.

## Production

Run the worker next to the web app against the same PostgreSQL database; see [DEPLOYMENT.md](DEPLOYMENT.md)
(`docker compose up -d` starts `web`, `worker`, `db`). Multiple worker replicas are safe because of the lock, but one is enough.

Shutdown is graceful: `SIGTERM`/`SIGINT` lets the current step finish; a second signal exits immediately.
