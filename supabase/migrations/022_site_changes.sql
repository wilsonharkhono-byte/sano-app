-- 022_site_changes.sql
-- Unified "Catatan Perubahan" table — replaces separate defects + vo_entries
-- with a single entry point for all site changes.
--
-- Supervisor captures quickly (location, photo, type, impact).
-- Estimator/admin reviews and adds cost + decision.
-- Principal auto-alerted on 'berat' impact items.

-- ============================================================================
-- 1. TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_changes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- ── Supervisor capture ──
  location         TEXT NOT NULL,
  description      TEXT NOT NULL,
  photo_urls       TEXT[] NOT NULL DEFAULT '{}',
  change_type      TEXT NOT NULL
    CHECK (change_type IN ('permintaan_owner', 'kondisi_lapangan', 'rework', 'revisi_desain', 'catatan_mutu')),
  boq_item_id      UUID REFERENCES boq_items(id) ON DELETE SET NULL,
  contract_id      UUID REFERENCES mandor_contracts(id) ON DELETE SET NULL,
  impact           TEXT NOT NULL DEFAULT 'ringan'
    CHECK (impact IN ('ringan', 'sedang', 'berat')),
  is_urgent        BOOLEAN NOT NULL DEFAULT false,
  reported_by      UUID NOT NULL REFERENCES profiles(id),

  -- ── Estimator / admin review ──
  est_cost         NUMERIC,
  cost_bearer      TEXT
    CHECK (cost_bearer IS NULL OR cost_bearer IN ('mandor', 'owner', 'kontraktor')),
  needs_owner_approval BOOLEAN NOT NULL DEFAULT false,
  decision         TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'disetujui', 'ditolak', 'selesai')),
  reviewed_by      UUID REFERENCES profiles(id),
  reviewed_at      TIMESTAMPTZ,
  estimator_note   TEXT,

  -- ── Resolution ──
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES profiles(id),
  resolution_note  TEXT,

  -- ── Meta ──
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS site_changes_project_idx
  ON site_changes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_changes_type_idx
  ON site_changes (project_id, change_type, decision);
CREATE INDEX IF NOT EXISTS site_changes_impact_idx
  ON site_changes (project_id, impact)
  WHERE decision = 'pending';

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_site_changes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_site_changes_updated_at ON site_changes;
CREATE TRIGGER trg_site_changes_updated_at
  BEFORE UPDATE ON site_changes
  FOR EACH ROW EXECUTE FUNCTION set_site_changes_updated_at();

-- ============================================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE site_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_changes_select ON site_changes;
DROP POLICY IF EXISTS site_changes_insert ON site_changes;
DROP POLICY IF EXISTS site_changes_update ON site_changes;
DROP POLICY IF EXISTS site_changes_delete ON site_changes;

CREATE POLICY site_changes_select ON site_changes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid() AND pa.project_id = site_changes.project_id
    )
  );

CREATE POLICY site_changes_insert ON site_changes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.user_id = auth.uid() AND pa.project_id = site_changes.project_id
    )
  );

CREATE POLICY site_changes_update ON site_changes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = site_changes.project_id
        AND pr.role IN ('supervisor', 'estimator', 'admin', 'principal')
    )
  );

CREATE POLICY site_changes_delete ON site_changes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM project_assignments pa
      JOIN profiles pr ON pr.id = auth.uid()
      WHERE pa.user_id = auth.uid()
        AND pa.project_id = site_changes.project_id
        AND pr.role IN ('admin', 'principal')
    )
  );

-- ============================================================================
-- 3. SUMMARY VIEW (dashboard card counts)
-- ============================================================================

CREATE OR REPLACE VIEW v_site_change_summary AS
SELECT
  project_id,
  COUNT(*) FILTER (WHERE decision = 'pending')                                  AS pending_count,
  COUNT(*) FILTER (WHERE decision = 'pending' AND impact = 'berat')             AS pending_berat,
  COUNT(*) FILTER (WHERE decision = 'pending' AND impact = 'sedang')            AS pending_sedang,
  COUNT(*) FILTER (WHERE decision = 'disetujui' AND resolved_at IS NULL)        AS approved_unresolved,
  COUNT(*) FILTER (WHERE change_type = 'rework' AND decision <> 'selesai')      AS open_rework,
  COUNT(*) FILTER (WHERE change_type = 'catatan_mutu' AND decision <> 'selesai') AS open_quality_notes,
  COALESCE(SUM(est_cost) FILTER (WHERE decision = 'disetujui'), 0)              AS approved_cost_total,
  COUNT(*)                                                                       AS total_count
FROM site_changes
GROUP BY project_id;

GRANT SELECT ON v_site_change_summary TO authenticated;
