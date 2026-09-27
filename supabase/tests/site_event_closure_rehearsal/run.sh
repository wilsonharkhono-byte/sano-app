#!/usr/bin/env bash
# Rehearses migrations 105 and 106 on a disposable local Supabase Postgres, as
# the roles that will meet them (supervisor, second supervisor, estimator,
# admin, principal, a removed owner, an outsider). Needs Docker and a
# supabase/postgres image; touches nothing but the container. That image has
# no storage schema, so storage_stub.sql builds storage.buckets and
# storage.objects the way production has them (owned by
# supabase_storage_admin, RLS on) before any migration. The first run applies
# 001-104 to a fresh container (a few storage-policy statements in 006 and 097
# may report errors there; that is expected). Every run pastes 105 and 106
# twice each, rebuilds the fixture, runs every check, re-pastes 097 to prove
# the revert hazard, and pastes 106 with and without pg_cron.
#
#   supabase/tests/site_event_closure_rehearsal/run.sh            # keep the container
#   supabase/tests/site_event_closure_rehearsal/run.sh --stop     # remove it afterwards
set -euo pipefail
IMAGE="${SANO_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.131}"
NAME=sano-pg-closure-rehearsal
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
M="$ROOT/supabase/migrations"
pg() { docker exec -i "$NAME" psql -d postgres "$@"; }
paste_strict() { pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/$1.sql" >/dev/null 2>&1; }

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  until docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1 from pg_proc where proname = 'uid'" 2>/dev/null | grep -q 1; do sleep 1; done
  pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/storage_stub.sql" >/dev/null
  for f in "$M"/[0-9][0-9][0-9]_*.sql; do
    n="$(basename "$f")"
    [ "${n:0:3}" -ge 105 ] && continue
    pg -U postgres -q < "$f" >/dev/null 2>&1 || true
  done
fi
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/storage_stub.sql" >/dev/null
# A schedule left from the previous run must not fire into this one.
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

echo "pasting role:    $(pg -U postgres -tAc "select current_user || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname = current_user")"
echo "storage.objects: $(pg -U postgres -tAc "select c.relowner::regrole || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' select=' || has_table_privilege('storage.objects', 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'")"

for pass in first second; do
  for m in 105_close_site_event_evidence 106_site_event_digest; do
    if ! paste_strict "$m"; then
      echo "${m:0:3} failed on the $pass paste:"
      pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/$m.sql" 2>&1 | grep -E 'ERROR|MIGRATION_105_PRECONDITION' | head -5
      exit 1
    fi
  done
done
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/fixture.sql" >/dev/null

out="$(cat "$DIR/rehearse_105.sql" "$DIR/rehearse_106.sql" | pg -U postgres -q 2>&1)"

# Re-paste hazard: 097 alone reverts 100 and 105; 100 then 105 restores both.
pg -U postgres -q < "$M/097_site_events.sql" >/dev/null 2>&1 || true
out="$out"$'\n'"$(pg -U postgres -q < "$DIR/rehearse_repaste_097.sql" 2>&1)"
for m in 100_confirm_vo_evidence_recheck 105_close_site_event_evidence; do
  paste_strict "$m" || { echo "$m failed on the re-paste after 097"; exit 1; }
done
out="$out"$'\n'"$(pg -U postgres -q < "$DIR/rehearse_repaste_105.sql" 2>&1)"

# Scheduler, without pg_cron: two clean pastes, each printing the NOTICE.
for pass in first second; do
  if notice="$(pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/106_site_event_digest.sql" 2>&1 >/dev/null)"; then
    if printf '%s' "$notice" | grep -q '106: pg_cron belum aktif'; then
      out="$out"$'\n'"PASS 106 without pg_cron pastes cleanly and prints the NOTICE ($pass paste)"
    else
      out="$out"$'\n'"FAIL 106 without pg_cron printed no NOTICE ($pass paste)"
    fi
  else
    out="$out"$'\n'"FAIL 106 without pg_cron failed on the $pass paste :: $(printf '%s' "$notice" | grep -m1 ERROR)"
  fi
done

# Scheduler, with pg_cron: created the way the Dashboard does it, as postgres.
if ! pg -U postgres -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS pg_cron' >/dev/null 2>&1; then
  echo "CREATE EXTENSION pg_cron failed: this image does not preload pg_cron, so the Dashboard's branch cannot be rehearsed."
  exit 1
fi
for pass in first second; do
  paste_strict 106_site_event_digest || { echo "106 with pg_cron failed on the $pass paste"; exit 1; }
done
jobs="$(pg -U postgres -tAc "select count(*) || '|' || coalesce(string_agg(schedule || '|' || command, ','), '') from cron.job where jobname = 'site_event_digest'")"
if [ "$jobs" = "1|0 0 * * 1-6|SELECT public.enqueue_site_event_digests()" ]; then
  out="$out"$'\n'"PASS 106 with pg_cron schedules exactly one site_event_digest job at 0 0 * * 1-6"
else
  out="$out"$'\n'"FAIL 106 with pg_cron :: $jobs"
fi
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

printf '%s\n' "$out" | grep -E '^FAIL|ERROR' || true
pass="$(printf '%s\n' "$out" | grep -c '^PASS' || true)"
fail="$(printf '%s\n' "$out" | grep -c '^FAIL' || true)"
err="$(printf '%s\n' "$out" | grep -c 'ERROR' || true)"
echo "PASS=$pass FAIL=$fail ERROR=$err"
[ "${1:-}" = "--stop" ] && docker stop "$NAME" >/dev/null
[ "$fail" -eq 0 ] && [ "$err" -eq 0 ]
