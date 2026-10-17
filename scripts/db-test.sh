#!/usr/bin/env bash
# Applies all migrations + seed to a throwaway Postgres cluster and runs tests/db/*.test.sql.
# Requires Postgres 15+ binaries (initdb, pg_ctl, psql). Usage: npm run db:test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl | sort -V | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"

# Postgres refuses to run as root; drop to the postgres OS user when needed.
RUN=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

psql_run() { "${RUN[@]}" "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

echo "→ shim"
psql_run -f "$ROOT/tests/db/00_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  psql_run -f "$f"
done
for f in "$ROOT"/supabase/seed/*.sql; do
  echo "→ seed $(basename "$f")"
  psql_run -f "$f"
done
# Seeds must be re-runnable.
for f in "$ROOT"/supabase/seed/*.sql; do psql_run -f "$f"; done

status=0
for f in "$ROOT"/tests/db/*.test.sql; do
  echo "→ test $(basename "$f")"
  if ! psql_run -f "$f"; then status=1; fi
done
[ $status -eq 0 ] && echo "✓ all database tests passed"
exit $status
