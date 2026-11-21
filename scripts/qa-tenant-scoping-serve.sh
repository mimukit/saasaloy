#!/usr/bin/env bash
# Bring the .dev/playground api up on a clean database, ready for
# scripts/qa-tenant-scoping.sh. It drops and recreates the Postgres schema and re-applies
# the migration. Set PG to the connection string of the qa128-pg container's database.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PG=${PG:-}
if [ -z "$PG" ]; then
  echo "Set PG to the Postgres connection string the playground api uses." >&2
  exit 1
fi

# Stop the old server AND its workerd children, then wait for them to actually exit.
# The bracket in "[v]ite" keeps the pattern from matching this script's own command line.
# Match on the port, not on "vite dev": pnpm re-execs the CLI as `vite.js dev --port
# 4000`, so a pattern written the obvious way misses the very process that has to die. An
# orphan on :4000 keeps serving the database this script is about to delete, and every
# later failure then reads like a module bug.
pkill -9 -f "port 4000" 2>/dev/null || true
pkill -9 -f "[w]orkerd" 2>/dev/null || true
sleep 6

# `drizzle` goes too. The migration journal lives there, not in `public`, so dropping
# `public` alone leaves `drizzle-kit migrate` reporting "already applied" against an
# empty database.
docker exec qa128-pg psql -U pg -d pg -q \
  -c 'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;'
DATABASE_URL="$PG" pnpm -C "$ROOT/.dev/playground/packages/db" db:migrate >/dev/null

cd "$ROOT/.dev/playground/apps/api"
nohup pnpm dev --port 4000 >/tmp/api-dev.log 2>&1 &
for _ in $(seq 1 40); do
  sleep 2
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health)" = 200 ]; then
    echo "api up on :4000"
    exit 0
  fi
done
echo "api did not come up"
tail -30 /tmp/api-dev.log
exit 1
