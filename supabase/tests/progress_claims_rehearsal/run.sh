#!/usr/bin/env bash
# Rehearses migrations 103 and 104 on a disposable local Supabase Postgres, as
# the roles that will call them (supervisor, estimator, admin, principal,
# outsider). Needs Docker and a supabase/postgres image; touches nothing but the
# container. The first run applies 001-102 to a fresh container (the storage
# schema is absent there, so 003, 006 and 097 report a few storage errors; that
# is expected). Every later run re-pastes 103 and 104 twice, rebuilds the
# fixture and runs every check.
#
#   supabase/tests/progress_claims_rehearsal/run.sh            # keep the container
#   supabase/tests/progress_claims_rehearsal/run.sh --stop     # remove it afterwards
set -euo pipefail
IMAGE="${SANO_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.131}"
NAME=sano-pg-rehearsal
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
pg() { docker exec -i "$NAME" psql -d postgres "$@"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  until docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1 from pg_proc where proname = 'uid'" 2>/dev/null | grep -q 1; do sleep 1; done
  for f in "$ROOT"/supabase/migrations/[0-9][0-9][0-9]_*.sql; do
    n="$(basename "$f")"
    [ "${n:0:3}" -ge 103 ] && continue
    pg -U postgres -q < "$f" >/dev/null 2>&1 || true
  done
fi

for pass in first second; do
  pg -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/migrations/103_boq_stage_weights.sql" >/dev/null 2>&1 || { echo "103 failed on the $pass paste"; exit 1; }
  pg -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/migrations/104_progress_claims.sql" >/dev/null 2>&1 || { echo "104 failed on the $pass paste"; exit 1; }
done
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/fixture.sql" >/dev/null

out="$(cat "$DIR/rehearse_103.sql" "$DIR/rehearse_104.sql" | pg -U postgres -q 2>&1)"
printf '%s\n' "$out" | grep -E '^FAIL|ERROR' || true
pass="$(printf '%s\n' "$out" | grep -c '^PASS' || true)"
fail="$(printf '%s\n' "$out" | grep -c '^FAIL' || true)"
err="$(printf '%s\n' "$out" | grep -c 'ERROR' || true)"
echo "PASS=$pass FAIL=$fail ERROR=$err"
[ "${1:-}" = "--stop" ] && docker stop "$NAME" >/dev/null
[ "$fail" -eq 0 ] && [ "$err" -eq 0 ]
