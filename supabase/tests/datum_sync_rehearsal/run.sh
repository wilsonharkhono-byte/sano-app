#!/usr/bin/env bash
# Rehearses migration 107 on a disposable local Supabase Postgres, as the
# roles that will meet it (supervisor, estimator, admin, principal, an
# outsider, the datum-sync function's service_role, and postgres for the
# Dashboard). Needs Docker and a supabase/postgres image; touches nothing but
# the container. The first run applies 001-106 to a fresh container (a few
# storage-policy statements may report errors there; that is expected), after
# the storage stub the closure rehearsal already carries. Every run pastes
# 107 twice, rebuilds the fixture, runs every check, re-pastes 097 and 096 to
# prove 107's guards survive them (then 100 and 105 to undo 097's revert),
# re-pastes 101 then 107 to prove the gate-word hazard and its cure, and
# pastes 107 with and without pg_cron.
#
#   supabase/tests/datum_sync_rehearsal/run.sh            # keep the container
#   supabase/tests/datum_sync_rehearsal/run.sh --stop     # remove it afterwards
set -euo pipefail
IMAGE="${SANO_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.131}"
NAME=sano-pg-datum-rehearsal
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
M="$ROOT/supabase/migrations"
STUB="$ROOT/supabase/tests/site_event_closure_rehearsal/storage_stub.sql"
pg() { docker exec -i "$NAME" psql -d postgres "$@"; }
paste_strict() { pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/$1.sql" >/dev/null 2>&1; }
paste_loose() { pg -U postgres -q < "$M/$1.sql" >/dev/null 2>&1 || true; }

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  until docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1 from pg_proc where proname = 'uid'" 2>/dev/null | grep -q 1; do sleep 1; done
  pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$STUB" >/dev/null
  for f in "$M"/[0-9][0-9][0-9]_*.sql; do
    n="$(basename "$f")"
    [ "${n:0:3}" -ge 107 ] && continue
    pg -U postgres -q < "$f" >/dev/null 2>&1 || true
  done
fi
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$STUB" >/dev/null
# A schedule left from the previous run must not fire into this one.
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

echo "pasting role: $(pg -U postgres -tAc "select current_user || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname = current_user")"

for pass in first second; do
  if ! paste_strict 107_datum_sync; then
    echo "107 failed on the $pass paste:"
    pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/107_datum_sync.sql" 2>&1 | grep -E 'ERROR' | head -5
    exit 1
  fi
done
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/fixture.sql" >/dev/null

out="$(pg -U supabase_admin -q < "$DIR/rehearse_107.sql" 2>&1)"

# Re-paste hazards: 097 and 096 leave 107's guards and wide CHECK in place.
paste_loose 097_site_events
paste_loose 096_rooms_gates_phase
out="$out"$'\n'"$(pg -U supabase_admin -q < "$DIR/rehearse_repaste.sql" 2>&1)"
for m in 100_confirm_vo_evidence_recheck 105_close_site_event_evidence; do
  paste_strict "$m" || { echo "$m failed on the re-paste after 097"; exit 1; }
done

# Re-pasting 101 restores the old words; re-pasting 107 brings DATUM's back.
paste_strict 101_gate_labels_descriptions || { echo "101 failed on its re-paste"; exit 1; }
word="$(pg -U postgres -tAc "select short_label from gate_refs where code = 'B'")"
if [ "$word" = "Waterproofing + kamar mandi" ]; then
  out="$out"$'\n'"PASS re-pasting 101 after 107 restores SANO's old word for B"
else
  out="$out"$'\n'"FAIL re-pasting 101 after 107 :: B reads '$word'"
fi
paste_strict 107_datum_sync || { echo "107 failed on its re-paste after 101"; exit 1; }
word="$(pg -U postgres -tAc "select short_label from gate_refs where code = 'B'")"
if [ "$word" = "Pekerjaan Basah" ]; then
  out="$out"$'\n'"PASS re-pasting 107 after 101 brings DATUM's word for B back"
else
  out="$out"$'\n'"FAIL re-pasting 107 after 101 :: B reads '$word'"
fi

# Scheduler, without pg_cron: two clean pastes, each printing the NOTICE.
for pass in first second; do
  if notice="$(pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/107_datum_sync.sql" 2>&1 >/dev/null)"; then
    if printf '%s' "$notice" | grep -q '107: pg_cron belum aktif'; then
      out="$out"$'\n'"PASS 107 without pg_cron pastes cleanly and prints the NOTICE ($pass paste)"
    else
      out="$out"$'\n'"FAIL 107 without pg_cron printed no NOTICE ($pass paste)"
    fi
  else
    out="$out"$'\n'"FAIL 107 without pg_cron failed on the $pass paste :: $(printf '%s' "$notice" | grep -m1 ERROR)"
  fi
done

# Scheduler, with pg_cron: created the way the Dashboard does it, as postgres.
if ! pg -U postgres -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS pg_cron' >/dev/null 2>&1; then
  echo "CREATE EXTENSION pg_cron failed: this image does not preload pg_cron, so the Dashboard's branch cannot be rehearsed."
  exit 1
fi
for pass in first second; do
  paste_strict 107_datum_sync || { echo "107 with pg_cron failed on the $pass paste"; exit 1; }
done
jobs="$(pg -U postgres -tAc "select count(*) || '|' || coalesce(string_agg(schedule, ','), '') from cron.job where jobname = 'datum_sync_hourly'")"
if [ "$jobs" = "1|0 * * * *" ]; then
  out="$out"$'\n'"PASS 107 with pg_cron schedules exactly one datum_sync_hourly job at 0 * * * *"
else
  out="$out"$'\n'"FAIL 107 with pg_cron :: $jobs"
fi
# Run the job's own command once, as its owner would, and count what it queued.
pg -U postgres -q -c "DO \$\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'datum_sync_hourly'); END \$\$;" >/dev/null
queued="$(pg -U postgres -tAc "select string_agg(p.code || '=' || (select count(*) from datum_sync_requests r where r.project_id = p.id and r.requested_at > now() - interval '1 minute'), ',' order by p.code) from projects p where p.code like 'REH-DS-%'")"
if [ "$queued" = "REH-DS-A=1,REH-DS-B=0,REH-DS-C=0,REH-DS-D=0" ]; then
  out="$out"$'\n'"PASS 107 the hourly command queues one request per paired ACTIVE project and none for ON_HOLD or unpaired ones"
else
  out="$out"$'\n'"FAIL 107 the hourly command queued :: $queued"
fi
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

printf '%s\n' "$out" | grep -E '^FAIL|ERROR' || true
pass="$(printf '%s\n' "$out" | grep -c '^PASS' || true)"
fail="$(printf '%s\n' "$out" | grep -c '^FAIL' || true)"
err="$(printf '%s\n' "$out" | grep -c 'ERROR' || true)"
echo "PASS=$pass FAIL=$fail ERROR=$err"
[ "${1:-}" = "--stop" ] && docker stop "$NAME" >/dev/null
[ "$fail" -eq 0 ] && [ "$err" -eq 0 ]
