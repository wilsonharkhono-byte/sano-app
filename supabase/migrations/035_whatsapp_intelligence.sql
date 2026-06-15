-- 035_whatsapp_intelligence.sql
--
-- WHAstudio Project Intelligence layer — Phase 1 (Core Logging Pipeline).
--
-- Adds the structured tables that consolidate scattered project information
-- (client decisions, finishing checklists, drawings, vendor quotes) into the
-- existing SANO Supabase project. Reuses the existing `projects`, `profiles`
-- (staff), and `project_assignments` (membership) tables — does NOT duplicate
-- them. See docs blueprint: WHAstudio AI Project Intelligence System v1.0.
--
-- Server-truth philosophy (mirrors migrations 033/034): the WhatsApp ingest
-- Edge Function writes with the service-role key and bypasses RLS. The policies
-- below govern the authenticated dashboard, not the ingest pipeline.
--
-- Deployment:
--   1. Apply via Supabase dashboard SQL editor (idempotent).
--   2. Seed `profiles.whatsapp_number` for pilot staff so the ingest webhook
--      can resolve senders.
--
-- Idempotent: safe to re-run.

-- =========================================================================
-- 0. PROFILES extension — WhatsApp sender identity
-- =========================================================================
-- The ingest webhook matches an incoming WhatsApp number to a staff row.
-- `phone` already exists but is free-form; `whatsapp_number` is the
-- normalized, unique key used for sender lookup.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT true;

-- Unique only when present (multiple NULLs allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_whatsapp_number
  ON profiles(whatsapp_number) WHERE whatsapp_number IS NOT NULL;

-- =========================================================================
-- 1. ROOMS (project-scoped)
-- =========================================================================

CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_code   TEXT,
  room_name   TEXT NOT NULL,
  floor       TEXT,
  area_sqm    NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_project_code
  ON rooms(project_id, room_code) WHERE room_code IS NOT NULL;

-- =========================================================================
-- 2. VENDORS (global catalog)
-- =========================================================================

CREATE TABLE IF NOT EXISTS vendors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name  TEXT NOT NULL,
  category     TEXT,
  contact      TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);

-- =========================================================================
-- 3. MESSAGE_LOG (audit trail of all WhatsApp ingest)
-- =========================================================================
-- Defined before `decisions` because decisions.source_message_id references it.
-- Every inbound WhatsApp message lands here regardless of parse outcome — this
-- is the dataset for tuning prompts in later phases.

CREATE TABLE IF NOT EXISTS message_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number          TEXT NOT NULL,
  sender_staff_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  raw_message          TEXT,
  has_attachment       BOOLEAN NOT NULL DEFAULT false,
  parsed_payload       JSONB,
  claude_model_used    TEXT,
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  project_id_resolved  UUID REFERENCES projects(id) ON DELETE SET NULL,
  confidence           NUMERIC,
  status               TEXT NOT NULL DEFAULT 'parsed'
                       CHECK (status IN ('parsed', 'flagged', 'ambiguous', 'rejected', 'clarify')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_log_created   ON message_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_log_status    ON message_log(status);
CREATE INDEX IF NOT EXISTS idx_message_log_from      ON message_log(from_number);

-- =========================================================================
-- 4. DECISIONS (the main event log)
-- =========================================================================

CREATE TABLE IF NOT EXISTS decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_id            UUID REFERENCES rooms(id) ON DELETE SET NULL,
  decision_type      TEXT NOT NULL DEFAULT 'material'
                     CHECK (decision_type IN
                       ('material', 'vendor', 'approval', 'change_order', 'scope', 'schedule')),
  item_category      TEXT,
  current_spec       TEXT,
  proposed_spec      TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'confirmed', 'rejected', 'superseded')),
  logged_by_staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  logged_via         TEXT NOT NULL DEFAULT 'whatsapp'
                     CHECK (logged_via IN ('whatsapp', 'dashboard', 'email')),
  raw_input_text     TEXT,
  ai_confidence      NUMERIC,
  needs_review       BOOLEAN NOT NULL DEFAULT false,
  source_message_id  UUID REFERENCES message_log(id) ON DELETE SET NULL,
  attachments        TEXT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decisions_project        ON decisions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_status         ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_needs_review   ON decisions(project_id) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_decisions_room           ON decisions(room_id);

-- =========================================================================
-- 5. VENDOR_DECISIONS (links a decision to selected vendor + quote)
-- =========================================================================

CREATE TABLE IF NOT EXISTS vendor_decisions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id    UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  vendor_id      UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  quote_amount   NUMERIC,
  currency       TEXT NOT NULL DEFAULT 'IDR',
  quote_date     DATE,
  attachment_url TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_decisions_decision ON vendor_decisions(decision_id);
CREATE INDEX IF NOT EXISTS idx_vendor_decisions_vendor   ON vendor_decisions(vendor_id);

-- =========================================================================
-- 6. DRAWINGS (uploaded design files + AI extraction draft)
-- =========================================================================

CREATE TABLE IF NOT EXISTS drawings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  drawing_code   TEXT,
  drawing_type   TEXT CHECK (drawing_type IN
                   ('floor_plan', 'finishing_schedule', 'detail', 'room_data_sheet')),
  revision       TEXT,
  file_url       TEXT NOT NULL,
  uploaded_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  parsed         BOOLEAN NOT NULL DEFAULT false,
  ai_extraction  JSONB
);

CREATE INDEX IF NOT EXISTS idx_drawings_project ON drawings(project_id);

-- =========================================================================
-- 7. CHECKLIST_ITEMS (auto-generated from drawing parsing; field-completed)
-- =========================================================================

CREATE TABLE IF NOT EXISTS checklist_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_id              UUID REFERENCES rooms(id) ON DELETE SET NULL,
  item_category        TEXT,
  specified_value      TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'done', 'blocked')),
  assigned_to_staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date             DATE,
  completed_at         TIMESTAMPTZ,
  completion_photo_url TEXT,
  completion_logged_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  source_drawing_id    UUID REFERENCES drawings(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_project ON checklist_items(project_id, status);
CREATE INDEX IF NOT EXISTS idx_checklist_room    ON checklist_items(room_id);

-- =========================================================================
-- 8. REMINDERS (proactive nudges — Phase 3 populates, schema lands now)
-- =========================================================================

CREATE TABLE IF NOT EXISTS reminders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  related_decision_id       UUID REFERENCES decisions(id) ON DELETE CASCADE,
  related_checklist_item_id UUID REFERENCES checklist_items(id) ON DELETE CASCADE,
  reminder_type             TEXT,
  scheduled_for             TIMESTAMPTZ,
  sent_at                   TIMESTAMPTZ,
  recipient_staff_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  message_template          TEXT,
  status                    TEXT NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('scheduled', 'sent', 'cancelled')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
  ON reminders(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_reminders_project ON reminders(project_id);

-- =========================================================================
-- Row-level security
-- =========================================================================
-- Conventions (mirrors 002/023):
--   • Project-scoped read/write: row's project_id ∈ caller's assigned projects.
--   • Office-only delete:        profiles.role IN ('admin','principal','estimator').
--   • Global catalog (vendors):  any authenticated read; office write.
--   • message_log:               office read only; inserts via service-role only.

ALTER TABLE rooms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders        ENABLE ROW LEVEL SECURITY;

-- ── Helper: is the caller assigned to this project? ──────────────────────
CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION is_project_member(UUID) TO authenticated;

-- ── Helper: is the caller an office role? ────────────────────────────────
CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;

GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

-- ── rooms ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rooms_member_read   ON rooms;
CREATE POLICY rooms_member_read   ON rooms FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS rooms_member_insert ON rooms;
CREATE POLICY rooms_member_insert ON rooms FOR INSERT WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS rooms_member_update ON rooms;
CREATE POLICY rooms_member_update ON rooms FOR UPDATE USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS rooms_office_delete ON rooms;
CREATE POLICY rooms_office_delete ON rooms FOR DELETE USING (is_project_member(project_id) AND is_office_role());

-- ── vendors (global catalog) ──────────────────────────────────────────────
DROP POLICY IF EXISTS vendors_auth_read     ON vendors;
CREATE POLICY vendors_auth_read     ON vendors FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS vendors_office_insert ON vendors;
CREATE POLICY vendors_office_insert ON vendors FOR INSERT WITH CHECK (is_office_role());
DROP POLICY IF EXISTS vendors_office_update ON vendors;
CREATE POLICY vendors_office_update ON vendors FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role());
DROP POLICY IF EXISTS vendors_office_delete ON vendors;
CREATE POLICY vendors_office_delete ON vendors FOR DELETE USING (is_office_role());

-- ── message_log (office read only; service-role inserts) ──────────────────
DROP POLICY IF EXISTS message_log_office_read ON message_log;
CREATE POLICY message_log_office_read ON message_log FOR SELECT USING (is_office_role());
-- (No INSERT/UPDATE/DELETE policy → blocked for non-service-role.)

-- ── decisions ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS decisions_member_read   ON decisions;
CREATE POLICY decisions_member_read   ON decisions FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS decisions_member_insert ON decisions;
CREATE POLICY decisions_member_insert ON decisions FOR INSERT WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS decisions_member_update ON decisions;
CREATE POLICY decisions_member_update ON decisions FOR UPDATE USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS decisions_office_delete ON decisions;
CREATE POLICY decisions_office_delete ON decisions FOR DELETE USING (is_project_member(project_id) AND is_office_role());

-- ── vendor_decisions (scoped via parent decision's project) ───────────────
DROP POLICY IF EXISTS vendor_decisions_member_read ON vendor_decisions;
CREATE POLICY vendor_decisions_member_read ON vendor_decisions FOR SELECT USING (
  EXISTS (SELECT 1 FROM decisions d WHERE d.id = decision_id AND is_project_member(d.project_id))
);
DROP POLICY IF EXISTS vendor_decisions_member_write ON vendor_decisions;
CREATE POLICY vendor_decisions_member_write ON vendor_decisions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM decisions d WHERE d.id = decision_id AND is_project_member(d.project_id))
);
DROP POLICY IF EXISTS vendor_decisions_member_update ON vendor_decisions;
CREATE POLICY vendor_decisions_member_update ON vendor_decisions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM decisions d WHERE d.id = decision_id AND is_project_member(d.project_id))
);
DROP POLICY IF EXISTS vendor_decisions_office_delete ON vendor_decisions;
CREATE POLICY vendor_decisions_office_delete ON vendor_decisions FOR DELETE USING (is_office_role());

-- ── drawings ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS drawings_member_read   ON drawings;
CREATE POLICY drawings_member_read   ON drawings FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS drawings_member_insert ON drawings;
CREATE POLICY drawings_member_insert ON drawings FOR INSERT WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS drawings_member_update ON drawings;
CREATE POLICY drawings_member_update ON drawings FOR UPDATE USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS drawings_office_delete ON drawings;
CREATE POLICY drawings_office_delete ON drawings FOR DELETE USING (is_project_member(project_id) AND is_office_role());

-- ── checklist_items ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS checklist_member_read   ON checklist_items;
CREATE POLICY checklist_member_read   ON checklist_items FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS checklist_member_insert ON checklist_items;
CREATE POLICY checklist_member_insert ON checklist_items FOR INSERT WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS checklist_member_update ON checklist_items;
CREATE POLICY checklist_member_update ON checklist_items FOR UPDATE USING (is_project_member(project_id)) WITH CHECK (is_project_member(project_id));
DROP POLICY IF EXISTS checklist_office_delete ON checklist_items;
CREATE POLICY checklist_office_delete ON checklist_items FOR DELETE USING (is_project_member(project_id) AND is_office_role());

-- ── reminders (read for members; writes via service-role / office) ────────
DROP POLICY IF EXISTS reminders_member_read   ON reminders;
CREATE POLICY reminders_member_read   ON reminders FOR SELECT USING (is_project_member(project_id));
DROP POLICY IF EXISTS reminders_office_insert ON reminders;
CREATE POLICY reminders_office_insert ON reminders FOR INSERT WITH CHECK (is_project_member(project_id) AND is_office_role());
DROP POLICY IF EXISTS reminders_office_update ON reminders;
CREATE POLICY reminders_office_update ON reminders FOR UPDATE USING (is_project_member(project_id) AND is_office_role());
DROP POLICY IF EXISTS reminders_office_delete ON reminders;
CREATE POLICY reminders_office_delete ON reminders FOR DELETE USING (is_project_member(project_id) AND is_office_role());
