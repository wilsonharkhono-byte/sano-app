-- ═══════════════════════════════════════════════════════════════════════════
-- 098 - Daily log room links, and the SITE_EVENT_ASSIGNED notification type.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §4.3, §11
-- Plan: docs/superpowers/plans/2026-09-10-site-event-capture-ai.md (task 5)
--
-- PASTE ORDER. After 097: the new columns reference site_events and
-- site_event_media. Paste this before any event is confirmed, because
-- confirm_site_event enqueues SITE_EVENT_ASSIGNED, and the enqueue helpers turn
-- a CHECK violation into a WARNING nobody reads: without this file the owner is
-- never told, and nothing fails.
--
-- RE-PASTE SAFETY. Column adds are IF NOT EXISTS; the type CHECK is dropped by
-- shape and re-added identically, so a second paste is a no-op.
--
-- 1. DAILY LOG ROOM LINKS. Plan 4's "Tarik dari kejadian ruangan" writes these.
--    All nullable, so every existing log and the Struktur-phase report path are
--    unchanged. ON DELETE SET NULL on the event and media links: a curated
--    client-report line must never block, or vanish with, an event row.
--    gate_code needs no ON DELETE: 096 makes gate codes undeletable.
--
-- 2. NOTIFICATION TYPE. Strict superset of 088 section 8 (the latest swap; 089
--    and later only use types already in it). Nothing dropped.
--    Client side: tools/notificationRouting.ts resolves the SiteEventDetail
--    deeplink, and the detail screen is registered in all three navigators.
-- ═══════════════════════════════════════════════════════════════════════════

-- A stalled transaction on daily_log_highlights, daily_log_photos or
-- notifications makes this paste fail and roll back after 5 s instead of
-- queueing app reads behind it; re-paste later (096's pattern).
SET lock_timeout = '5s';

-- 1. Daily log room links ------------------------------------------------------

ALTER TABLE daily_log_highlights
  ADD COLUMN IF NOT EXISTS room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE daily_log_highlights
  ADD COLUMN IF NOT EXISTS gate_code       TEXT REFERENCES gate_refs(code);
ALTER TABLE daily_log_highlights
  ADD COLUMN IF NOT EXISTS source_event_id UUID REFERENCES site_events(id) ON DELETE SET NULL;

ALTER TABLE daily_log_photos
  ADD COLUMN IF NOT EXISTS room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE daily_log_photos
  ADD COLUMN IF NOT EXISTS source_media_id UUID REFERENCES site_event_media(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_log_highlights_source_event
  ON daily_log_highlights(source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_log_highlights_room
  ON daily_log_highlights(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_log_photos_source_media
  ON daily_log_photos(source_media_id) WHERE source_media_id IS NOT NULL;

-- 2. notifications.type admits SITE_EVENT_ASSIGNED ---------------------------
-- Widened by shape, exactly as 067/078/079/088 do: the type CHECK is the only
-- CHECK constraint on notifications, so matching '%type%' finds it whatever
-- name it carries today.

DO $$
DECLARE c record;
BEGIN
  -- A loop, not SELECT ... INTO: contype = 'c' means only a CHECK is ever
  -- dropped (never the primary key or a foreign key, whatever its definition
  -- happens to spell), and every match goes rather than an arbitrary first row,
  -- so the ADD below cannot collide with a second CHECK left behind. An empty
  -- result is simply zero iterations, which is what a second paste sees.
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
      'SITE_EVENT_ASSIGNED'
    ));
END $$;

-- Hand a reused editor connection back with its default lock timeout.
RESET lock_timeout;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; writes nothing)
--
-- 1. Columns landed, all nullable:
--      SELECT table_name, column_name, is_nullable FROM information_schema.columns
--      WHERE (table_name = 'daily_log_highlights' AND column_name IN ('room_id', 'gate_code', 'source_event_id'))
--         OR (table_name = 'daily_log_photos' AND column_name IN ('room_id', 'source_media_id'))
--      ORDER BY 1, 2;
--    EXPECTED: five rows, is_nullable = YES.
--
-- 2. The type list is the old twelve plus one:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';
--    EXPECTED: 13 quoted types, RETURNED and SITE_EVENT_ASSIGNED among them.
--
-- 3. Re-paste this whole file.
--    EXPECTED: no error, and check 2 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
