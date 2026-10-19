#!/usr/bin/env bash
# Starts the production server on a throwaway DB, exercises the HTTP API and prints real results.
#   ./scripts/api-smoke.sh            (requires `npm run build` first)
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-3100}
export DATABASE_URL="sqlite:./data/smoke.db"
rm -f data/smoke.db data/smoke.db-wal data/smoke.db-shm
DASHBOARD_PASSWORD="smoke-test-password" AUTH_SECRET="smoke-secret-smoke-secret-smoke-secret-0123456789" EMAIL_PROVIDER=outbox ./node_modules/.bin/next start -p "$PORT" > /tmp/next-smoke.out 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null "localhost:$PORT/api/profile" && break; sleep 0.5; done
B=localhost:$PORT
J='content-type: application/json'
js() { node -e "let buf='';process.stdin.on('data',d=>buf+=d).on('end',()=>{const j=JSON.parse(buf);$1})"; }


echo "--- auth (anonymous)"
for p in /api/jobs /api/profile /api/settings /api/runs /api/sources /api/email/preview /api/jobs/export; do printf "%-24s %s\n" "GET $p" "$(curl -s -o /dev/null -w '%{http_code}' $B$p)"; done
printf "%-24s %s\n" "POST /api/import" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/import -H "$J" -d '{"kind":"urls","content":"https://example.com/x"}')"
printf "%-24s %s\n" "POST /api/runs" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/runs -H "$J" -d '{}')"
printf "%-24s %s -> %s\n" "GET /jobs (page)" "$(curl -s -o /dev/null -w '%{http_code}' $B/jobs)" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/jobs)"
printf "%-24s %s\n" "GET /login" "$(curl -s -o /dev/null -w '%{http_code}' $B/login)"
printf "%-24s %s\n" "wrong password" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/auth/login -H "$J" -d '{"password":"nope-nope"}')"
printf "%-24s %s\n" "cross-origin login" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/auth/login -H "$J" -H 'Origin: https://evil.example' -d '{"password":"smoke-test-password"}')"
JAR=/tmp/smoke.jar; rm -f $JAR
curl -s -c $JAR -o /dev/null -w "login (correct)           %{http_code}\n" -X POST $B/api/auth/login -H "$J" -d '{"password":"smoke-test-password"}'
grep -o "HttpOnly" $JAR | head -1 | sed 's/^/cookie flag: /'
printf "%-24s %s\n" "cross-origin w/ session" "$(curl -s -b $JAR -o /dev/null -w '%{http_code}' -X POST $B/api/runs -H "$J" -H 'Origin: https://evil.example' -d '{"dryRun":true}')"
printf "%-24s %s\n" "tampered cookie" "$(curl -s -H 'Cookie: jh_session=abc.def' -o /dev/null -w '%{http_code}' $B/api/jobs)"

sed_curl=1
echo "--- pages (authenticated)"
printf "unknown job body has not-found UI: "; curl -s -b $JAR $B/jobs/does-not-exist | grep -c "does not exist (it may have been merged"
for p in / /matches /jobs /tracker /import /profile /sources /settings /jobs/does-not-exist; do printf "%-22s %s\n" "$p" "$(curl -s -b $JAR -o /dev/null -w '%{http_code}' $B$p)"; done
echo "--- jobs API (score>=90)"
curl -s -b $JAR "$B/api/jobs?minScore=90&pageSize=3" | js 'console.log("total",j.total,JSON.stringify(j.items.map(i=>Math.round(i.score.score)+" "+i.job.title)))'
echo "--- validation"
printf "invalid profile        "; curl -s -b $JAR -X PUT $B/api/profile -H "$J" -d '{"name":""}' -w ' [%{http_code}]\n' | cut -c1-140
printf "malformed json         "; curl -s -b $JAR -X PUT $B/api/settings -H "$J" -d '{bad' -w ' [%{http_code}]\n'
printf "bad band order         "; curl -s -b $JAR -X PUT $B/api/settings -H "$J" -d '{"scoring":{"bands":{"high":10,"good":70,"review":50}}}' -w ' [%{http_code}]\n'
printf "bad timezone           "; curl -s -b $JAR -X PUT $B/api/settings -H "$J" -d '{"schedule":{"timezone":"Nope/Zone"}}' -w ' [%{http_code}]\n' | cut -c1-140
ID=$(curl -s -b $JAR "$B/api/jobs?pageSize=1" | js 'console.log(j.items[0].job.id)')
echo "--- tracker ($ID)"
printf "save                   "; curl -s -b $JAR -X PUT $B/api/jobs/$ID/application -H "$J" -d '{"status":"saved","notes":"promising","followUpAt":"2026-10-25T00:00:00Z"}' -w ' [%{http_code}]\n' | cut -c1-200
printf "bad status             "; curl -s -b $JAR -X PUT $B/api/jobs/$ID/application -H "$J" -d '{"status":"hired"}' -w ' [%{http_code}]\n' | cut -c1-120
printf "unknown job            "; curl -s -b $JAR -X PUT $B/api/jobs/nope/application -H "$J" -d '{"status":"saved"}' -w ' [%{http_code}]\n'
echo "--- csv export"
curl -s -b $JAR "$B/api/jobs/export?minScore=90" -D /tmp/csv.hdr -o /tmp/smoke.csv; grep -i "content-type\|content-disposition" /tmp/csv.hdr | tr -d '\r'; wc -l < /tmp/smoke.csv; head -c 300 /tmp/smoke.csv; echo
echo "--- email preview"
curl -s -b $JAR $B/api/email/preview | js 'console.log(j.subject, "|", j.count, "of", j.candidates)'
echo "--- email test-send (outbox provider)"
curl -s -b $JAR -X POST $B/api/email/test -H "$J" -d '{}' -w ' [%{http_code}]\n'
ls data/outbox 2>/dev/null | tail -2
echo "--- profile edit round trip"
curl -s -b $JAR $B/api/profile | js 'const p=j.profile;p.yearsExperience=3;require("fs").writeFileSync("/tmp/p.json",JSON.stringify(p))'
curl -s -b $JAR -X PUT $B/api/profile -H "$J" --data @/tmp/p.json | js 'console.log("saved; rescored",j.rescored,"years",j.profile.yearsExperience)'
curl -s -b $JAR $B/api/profile | js 'console.log("persisted years",j.profile.yearsExperience)'
echo "--- source test (live)"
curl -s -b $JAR -X POST $B/api/sources/test -H "$J" -d '{"kind":"lever","config":{"site":"spotify"}}' | js 'console.log(j.ok, "listed",j.listed,"valid",j.valid,"http",j.httpStatus, j.ms+"ms")'
printf "path-injection token   "; curl -s -b $JAR -X POST $B/api/sources/test -H "$J" -d '{"kind":"greenhouse","config":{"boardToken":"../../x"}}' -w ' [%{http_code}]\n' | cut -c1-160
printf "unknown kind           "; curl -s -b $JAR -X POST $B/api/sources -H "$J" -d '{"kind":"linkedin","config":{}}' -w ' [%{http_code}]\n' | cut -c1-160
echo "--- run now (dry) then real"
curl -s -b $JAR -X POST $B/api/runs -H "$J" -d '{"dryRun":true,"lookbackDays":90}' | js 'const s=j.summary;console.log("dry:",s.status,JSON.stringify({listed:s.counts.listed,new:s.counts.new,errors:s.counts.errors}))'
curl -s -b $JAR -X POST $B/api/runs -H "$J" -d '{"lookbackDays":90}' | js 'const s=j.summary;console.log("real:",s.status,JSON.stringify({listed:s.counts.listed,new:s.counts.new,errors:s.counts.errors}))'
curl -s -b $JAR -X POST $B/api/runs -H "$J" -d '{"lookbackDays":90}' | js 'const s=j.summary;console.log("again:",s.status,JSON.stringify({new:s.counts.new,seen:s.counts.seen}))'
curl -s -b $JAR $B/api/runs | js 'console.log("runs persisted:",j.runs.length, JSON.stringify(j.runs.map(r=>r.status+(r.dryRun?"(dry)":""))))'
curl -s -b $JAR "$B/api/jobs?pageSize=200&status=open" | js 'const c={};j.items.forEach(i=>{const k=i.job.isSynthetic?"synthetic":i.job.sourceKind;c[k]=(c[k]||0)+1});console.log("jobs by source:",JSON.stringify(c))'
echo "--- import (LinkedIn link, CSV, validation)"
printf "preview linkedin       "; curl -s -b $JAR -X POST $B/api/import -H "$J" -d '{"kind":"urls","content":"https://www.linkedin.com/jobs/view/senior-java-engineer-at-acme-3812345678/?trackingId=abc"}' | js 'console.log(JSON.stringify(j.items.map(i=>[i.title,i.company,i.url,i.hasDescription])))'
printf "commit linkedin        "; curl -s -b $JAR -X POST $B/api/import -H "$J" -d '{"kind":"urls","commit":true,"content":"https://www.linkedin.com/jobs/view/senior-java-engineer-at-acme-3812345678/?trackingId=abc"}' | js 'console.log(JSON.stringify(j.counts))'
printf "commit again (idem.)   "; curl -s -b $JAR -X POST $B/api/import -H "$J" -d '{"kind":"urls","commit":true,"content":"https://linkedin.com/jobs/view/3812345678/?trk=other | Senior Java Engineer | Acme"}' | js 'console.log(JSON.stringify({parsed:j.counts.parsed,new:j.counts.new,seen:j.counts.seen}))'
curl -s -b $JAR "$B/api/jobs?q=Acme&pageSize=5" | js 'console.log("bookmark in jobs:",JSON.stringify(j.items.filter(i=>i.job.sourceKind==="import-urls").map(i=>[i.job.applyUrl,Math.round(i.score.score),i.score.band,i.score.detail.confidenceLabel])))'
printf "csv commit             "; curl -s -b $JAR -X POST $B/api/import -H "$J" -d '{"kind":"csv","commit":true,"content":"title,company,url,description\nJava Backend Engineer,SmokeCo,https://smoke.example/jobs/1,\"Requirements: 3 years of Java and Spring Boot, MySQL, Docker. Remote worldwide.\"\n,NoTitle,https://smoke.example/2,x"}' | js 'console.log(JSON.stringify(j.counts),JSON.stringify(j.rejected))'
printf "bad kind               "; curl -s -b $JAR -X POST $B/api/import -H "$J" -d '{"kind":"pdf","content":"x"}' -w ' [%{http_code}]\n' | cut -c1-120
printf "empty content          "; curl -s -b $JAR -X POST $B/api/import -H "$J" -d '{"kind":"json","content":""}' -w ' [%{http_code}]\n' | cut -c1-120
printf "oversized body         "; node -e 'process.stdout.write(JSON.stringify({kind:"json",content:"x".repeat(4000000)}))' > /tmp/big.json; curl -s -b $JAR -X POST $B/api/import -H "$J" --data @/tmp/big.json -w ' [%{http_code}]\n' | cut -c1-120
echo "--- tracker survived the real runs?"
curl -s -b $JAR "$B/api/jobs?appStatus=saved" | js 'console.log(j.items.map(i=>i.application.status+" / "+i.application.notes))'
echo "--- sources health"
curl -s -b $JAR $B/api/sources | js 'j.sources.forEach(s=>console.log(s.id,s.health.status,"jobs",s.jobCount,"coverage",s.health.coverage&&s.health.coverage.toFixed(2)))'
echo "--- server log errors:"; grep -ci "error" /tmp/next-smoke.out || true
