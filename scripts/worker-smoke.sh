#!/usr/bin/env bash
# End-to-end check of the real worker process against the live sources, on a throwaway database.
#   ./scripts/worker-smoke.sh
set -u
cd "$(dirname "$0")/.."
export DATABASE_URL="sqlite:./data/worker.db"
export WORKER_TICK_SECONDS=5
export EMAIL_PROVIDER=outbox
rm -f data/worker.db data/worker.db-wal data/worker.db-shm

# schedule = one minute ago in Asia/Karachi, so the slot is already due
TIME=$(node -e 'const f=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Karachi",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(Date.now()-60000));const g=t=>f.find(p=>p.type===t).value;console.log(g("hour")+":"+g("minute"))')
echo "Scheduling for $TIME Asia/Karachi (already passed)"
./node_modules/.bin/tsx -e "
import {getDb} from './src/lib/db'; import {saveSettings} from './src/lib/db/config';
(async()=>{const db=await getDb(); await saveSettings(db,{schedule:{time:'$TIME',timezone:'Asia/Karachi',lookbackDays:90}, search:{showSynthetic:false}}); await db.close();})()"

summary() {
  ./node_modules/.bin/tsx -e "
  import {getDb} from './src/lib/db'; import {listRuns} from './src/lib/db/runs';
  (async()=>{const db=await getDb(); const r=await listRuns(db,10);
   console.log('runs:',JSON.stringify(r.map(x=>({trigger:x.trigger,status:x.status,dry:x.dryRun,new:x.counts.new,errors:x.counts.errors,ms:x.durationMs}))));
   console.log('jobs:',(await db.query('SELECT COUNT(*) n FROM jobs'))[0].n); await db.close();})()"
}

echo "=== worker start #1 (35s) ==="
./node_modules/.bin/tsx scripts/worker.ts > /tmp/worker1.log 2>&1 &
W=$!
sleep 35
kill -TERM $W; wait $W 2>/dev/null
cat /tmp/worker1.log
summary

echo "=== worker start #2 (restart, 15s): must NOT run again ==="
./node_modules/.bin/tsx scripts/worker.ts > /tmp/worker2.log 2>&1 &
W=$!
sleep 15
kill -TERM $W; wait $W 2>/dev/null
cat /tmp/worker2.log
summary
