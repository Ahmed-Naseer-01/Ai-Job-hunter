#!/usr/bin/env bash
# Runs the full test suite against a throwaway local PostgreSQL cluster (needs initdb/pg_ctl on PATH).
#   ./scripts/test-postgres.sh
# Or point at your own server:  TEST_PG_URL=postgres://user:pw@host:5432/dbname npm test
set -eu
cd "$(dirname "$0")/.."
if [ -n "${TEST_PG_URL:-}" ]; then
  exec ./node_modules/.bin/vitest run
fi
DIR=$(mktemp -d /tmp/jh-pg.XXXXXX)
PORT=${PGTEST_PORT:-55432}
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
initdb -D "$DIR" -U jh --auth=trust --encoding=UTF8 >/dev/null
pg_ctl -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=200" -w -l "$DIR/log" start >/dev/null
createdb -h 127.0.0.1 -p "$PORT" -U jh jhtest
echo "PostgreSQL: $(psql -h 127.0.0.1 -p "$PORT" -U jh -d jhtest -tAc 'select version()' | cut -c1-40)"
TEST_PG_URL="postgres://jh@127.0.0.1:$PORT/jhtest" PG_POOL_MAX=3 ./node_modules/.bin/vitest run
