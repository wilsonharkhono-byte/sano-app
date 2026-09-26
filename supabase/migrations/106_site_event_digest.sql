-- ═══════════════════════════════════════════════════════════════════════════
-- 106 - The morning attention digest, and the list it counts.
--
-- Spec: docs/superpowers/specs/2026-09-26-closure-evidence-and-digest-design.md §5
-- Plan: docs/superpowers/plans/2026-09-26-closure-evidence-and-digest.md (Lane 3, Task 2)
--
-- WHY. An overdue item waits in silence until someone opens the board. This
-- file adds ONE "needs attention" predicate, as the view
-- v_site_event_attention, read both by a 07:00 WIB digest and by the app's
-- "Perlu ditindak" list, so the number in a push and the rows seen on tapping
-- it can never disagree:
--   * v_site_event_attention: open events that are past due on the Jakarta
--     calendar, or blocking since before 00:00 WIB today. security_invoker, so
--     097's RLS on site_events decides who sees which row.
--   * site_event_digest_log: one row per (project, person, WIB day) a digest
--     LANDED for. The UNIQUE key is the idempotence guard (a second run the
--     same day inserts nothing) and the same rows are the only evidence the
--     reminders went out, read by v_site_event_digest_health.
--   * enqueue_site_event_digests(): one message per person per project.
--     Someone who is both an owner and an admin or principal there gets only
--     the office summary, which says "n milik Anda". Each message is counted
--     and worded before its log row is written, and a person whose items all
--     closed while the run was under way is skipped: never a "0 tugas" push.
--     Delivery rides the existing notifications INSERT webhook (034);
--     nothing to deploy. Only postgres, the owner (pg_cron and the
--     Dashboard), executes it or its day label: EXECUTE is revoked from
--     PUBLIC, anon, authenticated and service_role, which Supabase's default
--     privileges would otherwise hand every new function.
--   * The SITE_EVENT_DIGEST notification type, and a pg_cron schedule,
--     Monday to Saturday at 00:00 UTC = 07:00 WIB (WIB has no daylight saving).
--
-- PASTE ORDER. After 104 and 105. It widens the notifications type CHECK that
-- 104 last swapped, and reads site_events and rooms (097) and projects.status.
--
-- RE-PASTE SAFETY. CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY / VIEW IF
-- EXISTS before each create, DROP FUNCTION IF EXISTS by exact signature
-- before each CREATE OR REPLACE, the type CHECK dropped by shape and re-added
-- (the 098/104 pattern), and the cron job unscheduled before it is scheduled
-- again: a second paste changes nothing. SET/RESET lock_timeout bracket every
-- statement.
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. Re-pasting 098 or 104 after this
-- file re-creates the type CHECK without SITE_EVENT_DIGEST: every digest then
-- fails inside its own block, is logged as a WARNING nobody reads, and nobody
-- is told. Re-paste 106 after any re-paste of 098 or 104.
--
-- SCHEDULER. The last block schedules the job only when pg_cron is enabled.
-- Without it the paste still succeeds and prints a NOTICE: enable Cron once
-- (Dashboard, Integrations → Cron) and paste this file again.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The blocking half of the predicate gets its own partial index. The
--    overdue half already has 097's idx_site_events_project_due_open.
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_site_events_blocking_open
  ON site_events(project_id) WHERE status = 'open' AND is_blocking;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. v_site_event_attention - the one "needs attention" predicate
--    owner_on_project is exact for office roles, for the owner, and inside
--    the digest (current_user is the function owner there, the distinction
--    097's guards use). A supervisor reads only their own assignment row
--    (023), so for a colleague's item the answer is unknowable to them: NULL,
--    never a false "no".
-- ───────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_site_event_attention;
CREATE OR REPLACE VIEW v_site_event_attention WITH (security_invoker = true) AS
SELECT e.id AS event_id, e.project_id, e.room_id, r.room_code, r.room_name, r.floor,
       e.gate_code, e.event_type, e.title, e.summary, e.owner_id, pr.full_name AS owner_name,
       CASE WHEN e.owner_id IS NULL THEN FALSE
            WHEN current_user NOT IN ('authenticated', 'anon') OR is_office_role() OR e.owner_id = auth.uid()
              THEN EXISTS (SELECT 1 FROM project_assignments pa
                           WHERE pa.project_id = e.project_id AND pa.user_id = e.owner_id)
            ELSE NULL END AS owner_on_project,
       e.due_date, e.is_blocking, e.confirmed_at,
       COALESCE(e.due_date < t.today, FALSE) AS is_overdue,
       CASE WHEN e.due_date < t.today THEN t.today - e.due_date ELSE 0 END AS days_overdue
FROM site_events e
JOIN rooms r ON r.id = e.room_id
LEFT JOIN profiles pr ON pr.id = e.owner_id
CROSS JOIN (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS today) t
WHERE e.status = 'open'
  AND (e.due_date < t.today
       OR (e.is_blocking AND e.confirmed_at < (t.today::timestamp AT TIME ZONE 'Asia/Jakarta')));

GRANT SELECT ON v_site_event_attention TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. site_event_digest_log - idempotence key and health source in one.
--    Read by office roles only; written only by enqueue_site_event_digests
--    (SECURITY DEFINER), so there is deliberately no write policy.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_event_digest_log (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  run_date    DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('owner', 'office')),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_event_digest_log_once UNIQUE (project_id, profile_id, run_date)
);

ALTER TABLE site_event_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_event_digest_log_office_read ON site_event_digest_log;
CREATE POLICY site_event_digest_log_office_read ON site_event_digest_log
  FOR SELECT USING (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 4. v_site_event_digest_health - the scheduler, not one project: no row, or
--    one row for the latest run_date across all projects. The log records
--    sends, not runs, so "never sent" is the only empty state it can prove.
-- ───────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_site_event_digest_health;
CREATE OR REPLACE VIEW v_site_event_digest_health WITH (security_invoker = true) AS
SELECT l.run_date AS last_run_date,
       max(l.sent_at) AS last_sent_at,
       count(DISTINCT l.profile_id)::int AS recipients
FROM site_event_digest_log l
WHERE l.run_date = (SELECT max(x.run_date) FROM site_event_digest_log x)
GROUP BY l.run_date;

GRANT SELECT ON v_site_event_digest_health TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. site_event_digest_day - "12 Sep", the app's formatWibShort month list.
--    STABLE, not IMMUTABLE, because to_char is only STABLE.
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS site_event_digest_day(DATE);
CREATE OR REPLACE FUNCTION site_event_digest_day(d DATE)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(d, 'FMDD') || ' ' ||
         (ARRAY['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'])[extract(month FROM d)::int]
$$;

REVOKE ALL ON FUNCTION site_event_digest_day(DATE) FROM PUBLIC, anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. enqueue_site_event_digests - one message per person per project
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS enqueue_site_event_digests(DATE);
CREATE OR REPLACE FUNCTION enqueue_site_event_digests(
  p_run_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today  DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_sent   INTEGER := 0;
  r        RECORD;
  v_old    RECORD;
  v_n      INTEGER;
  v_a      INTEGER;
  v_b      INTEGER;
  v_c      INTEGER;
  v_d      INTEGER;
  v_title  TEXT;
  v_body   TEXT;
  v_logged INTEGER;
BEGIN
  -- The view reads events as they are NOW; a digest labelled with another
  -- day would describe today's state under that day's name.
  IF p_run_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'DIGEST_RUN_DATE: tanggal kiriman harus hari ini (WIB), %', v_today;
  END IF;

  FOR r IN
    WITH items AS (
      SELECT a.project_id, a.owner_id
      FROM v_site_event_attention a
      JOIN projects p ON p.id = a.project_id
      WHERE p.status = 'ACTIVE'
    ),
    office AS (
      -- Only people who hold an assignment row on the project: the 092
      -- membership rule. Principals are members of every project by 093.
      SELECT DISTINCT pa.project_id, pa.user_id AS profile_id
      FROM project_assignments pa
      JOIN profiles pf ON pf.id = pa.user_id
      WHERE pf.role IN ('admin', 'principal')
        AND pa.project_id IN (SELECT i.project_id FROM items i)
    ),
    owners AS (
      SELECT DISTINCT i.project_id, i.owner_id AS profile_id
      FROM items i
      JOIN project_assignments pa ON pa.project_id = i.project_id AND pa.user_id = i.owner_id
      WHERE NOT EXISTS (
        SELECT 1 FROM office o WHERE o.project_id = i.project_id AND o.profile_id = i.owner_id
      )
    )
    SELECT o.project_id, o.profile_id, 'office'::text AS kind FROM office o
    UNION ALL
    SELECT w.project_id, w.profile_id, 'owner'::text AS kind FROM owners w
    ORDER BY 1, 2
  LOOP
    BEGIN
      -- Count first. The recipient query above and these counts are separate
      -- snapshots, so every item this person was picked for may have closed
      -- in between. Then there is nothing true to say: no log row, no
      -- message, no WARNING (an office "0 tugas" push logged as sent, or an
      -- owner's NULL body failing NOT NULL, would both be wrong).
      IF r.kind = 'office' THEN
        SELECT count(*),
               count(*) FILTER (WHERE a.is_overdue),
               count(*) FILTER (WHERE a.is_blocking),
               count(*) FILTER (WHERE a.owner_on_project IS FALSE),
               count(*) FILTER (WHERE a.owner_id = r.profile_id)
          INTO v_n, v_a, v_b, v_c, v_d
        FROM v_site_event_attention a
        WHERE a.project_id = r.project_id;
      ELSE
        SELECT count(*),
               count(*) FILTER (WHERE a.is_overdue),
               count(*) FILTER (WHERE a.is_blocking)
          INTO v_n, v_a, v_b
        FROM v_site_event_attention a
        WHERE a.project_id = r.project_id AND a.owner_id = r.profile_id;
      END IF;

      IF v_n = 0 THEN
        CONTINUE;
      END IF;

      IF r.kind = 'office' THEN
        v_body := concat_ws(', ',
                    CASE WHEN v_a > 0 THEN v_a || ' lewat tenggat' END,
                    CASE WHEN v_b > 0 THEN v_b || ' menghambat' END) || '.'
               || CASE WHEN v_c > 0 THEN ' ' || v_c || ' tanpa penanggung jawab.' ELSE '' END
               || CASE WHEN v_d > 0 THEN ' ' || v_d || ' milik Anda.' ELSE '' END;
      ELSE
        -- "Terlama": the overdue item with the earliest due date, else the
        -- blocking item blocking the longest.
        SELECT a.room_code, a.room_name, a.title, a.due_date, a.confirmed_at, a.is_overdue
          INTO v_old
        FROM v_site_event_attention a
        WHERE a.project_id = r.project_id AND a.owner_id = r.profile_id
        ORDER BY a.is_overdue DESC,
                 CASE WHEN a.is_overdue THEN a.due_date END ASC,
                 a.confirmed_at ASC,
                 a.event_id ASC
        LIMIT 1;

        v_body := concat_ws(', ',
                    CASE WHEN v_a > 0 THEN v_a || ' lewat tenggat' END,
                    CASE WHEN v_b > 0 THEN v_b || ' menghambat' END) || '.'
               || ' Terlama: ' || COALESCE(v_old.room_code, v_old.room_name) || ' – '
               || left(COALESCE(v_old.title, 'Kejadian lapangan'), 60)
               || CASE WHEN v_old.is_overdue
                       THEN ' (tenggat ' || site_event_digest_day(v_old.due_date) || ').'
                       ELSE ' (menghambat sejak '
                            || site_event_digest_day((v_old.confirmed_at AT TIME ZONE 'Asia/Jakarta')::date) || ').'
                  END;
      END IF;

      SELECT left(v_n || ' tugas lapangan perlu ditindak · ' || p.code, 200) INTO v_title
      FROM projects p WHERE p.id = r.project_id;

      -- Once per person, project and WIB day: a second run finds the row and
      -- sends nothing.
      INSERT INTO site_event_digest_log (project_id, profile_id, run_date, kind)
      VALUES (r.project_id, r.profile_id, p_run_date, r.kind)
      ON CONFLICT (project_id, profile_id, run_date) DO NOTHING;
      GET DIAGNOSTICS v_logged = ROW_COUNT;

      IF v_logged > 0 THEN
        PERFORM enqueue_notification_user(
          r.project_id,
          r.profile_id,
          'SITE_EVENT_DIGEST',
          v_title,
          left(v_body, 240),
          'RoomBoard',
          jsonb_build_object('projectId', r.project_id, 'attention', true, 'mine', r.kind = 'owner'),
          NULL,
          NULL,
          NULL
        );

        -- enqueue_notification_user inserts zero rows for a non-member and
        -- raises nothing. created_at >= now() bounds the read-back to THIS
        -- transaction (097's pattern). Nothing landed: roll this recipient's
        -- log row back with the block, so a log row exists if and only if its
        -- notification does.
        IF NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.recipient_user_id = r.profile_id
            AND n.project_id = r.project_id
            AND n.type = 'SITE_EVENT_DIGEST'
            AND n.created_at >= now()
        ) THEN
          RAISE EXCEPTION 'DIGEST_NOT_LANDED: notifikasi untuk % di proyek % tidak tersimpan', r.profile_id, r.project_id;
        END IF;

        v_sent := v_sent + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_site_event_digests: % pada proyek %: %', r.profile_id, r.project_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_sent;
END;
$$;

-- No grant to any app role, and none to service_role, the key edge functions
-- hold (Supabase's default privileges grant it EXECUTE on every new
-- function): only pg_cron and the Dashboard, both postgres, the owner, run
-- it, so neither an app user nor a leaked service key can trigger a round of
-- pushes.
REVOKE ALL ON FUNCTION enqueue_site_event_digests(DATE) FROM PUBLIC, anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. notifications.type: 104's sixteen plus SITE_EVENT_DIGEST
--    Widened by shape, exactly as 098 and 104 do.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED',
      'PLAN_CEILING_RAISE',
      'RETURNED',
      'SITE_EVENT_ASSIGNED',
      'PROGRESS_CLAIM_SUBMITTED',
      'PROGRESS_CLAIM_RETURNED',
      'PROGRESS_CLAIM_VERIFIED',
      'SITE_EVENT_DIGEST'
    ));
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Scheduler: 07:00 WIB, Monday to Saturday. pg_cron evaluates schedules
--    in UTC, and WIB is a fixed UTC+7, so '0 0 * * 1-6' is exact all year.
--    The cron.* statements are planned only when their branch runs, so this
--    block pastes cleanly on a project without pg_cron.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'site_event_digest') THEN
      PERFORM cron.unschedule('site_event_digest');
    END IF;
    PERFORM cron.schedule('site_event_digest', '0 0 * * 1-6',
                          $cmd$SELECT public.enqueue_site_event_digests()$cmd$);
  ELSE
    RAISE NOTICE '106: pg_cron belum aktif. Aktifkan Cron di Dashboard (Integrations → Cron), lalu paste 106 lagi. Tanpa itu pengingat pagi tidak pernah berjalan.';
  END IF;
END $$;

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

SELECT proname, prosecdef,
       has_function_privilege('authenticated', oid, 'EXECUTE') AS app_exec,
       has_function_privilege('service_role', oid, 'EXECUTE') AS service_exec
FROM pg_proc
WHERE proname IN ('enqueue_site_event_digests', 'site_event_digest_day')
ORDER BY proname;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-6 write nothing)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: two rows, enqueue_site_event_digests with prosecdef = true, and
--    app_exec = false and service_exec = false on both.
--
-- 2. The views run as the caller, and the log is readable by office only:
--      SELECT relname, reloptions FROM pg_class
--      WHERE relname IN ('v_site_event_attention', 'v_site_event_digest_health') ORDER BY 1;
--    EXPECTED: two rows, each with {security_invoker=true}.
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'site_event_digest_log';
--    EXPECTED: one row, site_event_digest_log_office_read, SELECT.
--
-- 3. The type list is 104's sixteen plus one:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';
--    EXPECTED: 17 quoted types, SITE_EVENT_DIGEST and PROGRESS_CLAIM_VERIFIED among them.
--
-- 4. The schedule exists (after Cron is enabled):
--      SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'site_event_digest';
--    EXPECTED: one row, 0 0 * * 1-6, SELECT public.enqueue_site_event_digests().
--    An error "relation cron.job does not exist" means pg_cron is not enabled:
--    enable it (Integrations → Cron) and paste this file again.
--
-- 5. Today's attention list for one project, as the Dashboard sees it:
--      SELECT room_code, title, owner_name, owner_on_project, days_overdue, is_blocking
--      FROM v_site_event_attention WHERE project_id = '<PROJECT_UUID>' ORDER BY days_overdue DESC;
--    EXPECTED: the open items past due or blocking since before today, and
--    owner_on_project exact (true or false, never NULL) for every row.
--
-- 6. A wrong run date is refused:
--      SELECT enqueue_site_event_digests(((now() AT TIME ZONE 'Asia/Jakarta')::date + 1));
--    EXPECTED: ERROR starting DIGEST_RUN_DATE.
--
-- 7. A manual run sends only what was not sent today (this one WRITES: it
--    sends real pushes, exactly as the 07:00 job would):
--      SELECT enqueue_site_event_digests();
--    EXPECTED: the number of people told; run it again and it returns 0.
--      SELECT * FROM v_site_event_digest_health;
--    EXPECTED: one row with today's date once anybody was told.
--
-- 8. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-4 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
