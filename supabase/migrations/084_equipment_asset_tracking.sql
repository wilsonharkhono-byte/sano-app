-- 084_equipment_asset_tracking.sql
-- Equipment asset pool: company-owned scaffolding parts circulate project →
-- project instead of being consumed. Spec:
-- docs/superpowers/specs/2026-07-16-equipment-asset-tracking-design.md
--
-- NUMBERING/DEPLOY ORDER: after 083_simplified_input_material_aliases.sql.
-- Idempotent; Dashboard-pasteable; safe to re-paste.
--
-- Model (append-only events → derived truth, like receipts/progress):
--   material_catalog.is_asset      routes an item OUT of tier/budget/envelope
--   equipment_dispositions         VOCABULARY IS DATA — admins add rows anytime;
--                                  only ledger_effect is fixed (3 values)
--   equipment_ledger               the single source of truth; balances are
--                                  always recomputed, never stored
--   Yard = project NULL, buckets READY (deployable) / REPAIR (returned damaged)
--
-- ENFORCEMENT BOUNDARY (server twin of tools/equipment.ts client gate):
--   CHECK constraints pin each event type's from/to shape; an AFTER INSERT
--   trigger (advisory-locked per material) re-derives balances INCLUDING the
--   new row and raises on any negative bucket — overdraw is impossible even
--   under concurrency or a buggy client. No UPDATE/DELETE policies exist:
--   the ledger is immutable (077-style immutability via absent policies).

-- 1) Asset flag ---------------------------------------------------------------
ALTER TABLE material_catalog ADD COLUMN IF NOT EXISTS is_asset BOOLEAN NOT NULL DEFAULT false;

UPDATE material_catalog SET is_asset = true
WHERE code IN ('FMW-SCAF', 'FMW-JACK', 'FMW-TIE01') AND is_asset IS DISTINCT FROM true;

-- 2) Dispositions (flexible vocabulary, fixed effects) ------------------------
CREATE TABLE IF NOT EXISTS equipment_dispositions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  ledger_effect TEXT NOT NULL CHECK (ledger_effect IN ('RETURN_OK', 'RETURN_HOLD', 'WRITE_OFF')),
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO equipment_dispositions (name, ledger_effect, sort_order) VALUES
  ('OK — kembali',            'RETURN_OK',   10),
  ('Rusak — bisa perbaikan',  'RETURN_HOLD', 20),
  ('Rusak — scrap',           'WRITE_OFF',   30),
  ('Hilang',                  'WRITE_OFF',   40)
ON CONFLICT (name) DO NOTHING;

-- 3) Ledger -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_ledger (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id          UUID NOT NULL REFERENCES material_catalog(id),
  event_type           TEXT NOT NULL CHECK (event_type IN ('OPENING', 'DEPLOY', 'TRANSFER', 'RETURN', 'WRITE_OFF', 'REPAIRED')),
  from_project_id      UUID REFERENCES projects(id),  -- NULL = yard
  to_project_id        UUID REFERENCES projects(id),  -- NULL = yard
  qty                  NUMERIC NOT NULL CHECK (qty > 0),
  disposition_id       UUID REFERENCES equipment_dispositions(id),
  yard_bucket          TEXT CHECK (yard_bucket IN ('READY', 'REPAIR')),
  reconciliation_group TEXT,        -- ties the lines of one count-&-close
  note                 TEXT,
  photo_path           TEXT,
  moved_by             UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Shape per event type (yard = NULL):
  CONSTRAINT equipment_ledger_event_shape CHECK (
       (event_type = 'OPENING'   AND from_project_id IS NULL     AND to_project_id IS NULL)
    OR (event_type = 'DEPLOY'    AND from_project_id IS NULL     AND to_project_id IS NOT NULL)
    OR (event_type = 'TRANSFER'  AND from_project_id IS NOT NULL AND to_project_id IS NOT NULL
                                 AND from_project_id <> to_project_id)
    OR (event_type = 'RETURN'    AND from_project_id IS NOT NULL AND to_project_id IS NULL)
    OR (event_type = 'WRITE_OFF' AND to_project_id IS NULL)
    OR (event_type = 'REPAIRED'  AND from_project_id IS NULL     AND to_project_id IS NULL)
  ),
  -- RETURN/WRITE_OFF must say WHY (disposition); yard-side write-off must say
  -- WHICH bucket it debits.
  CONSTRAINT equipment_ledger_disposition_required CHECK (
    event_type NOT IN ('RETURN', 'WRITE_OFF') OR disposition_id IS NOT NULL
  ),
  CONSTRAINT equipment_ledger_yard_bucket_required CHECK (
    NOT (event_type = 'WRITE_OFF' AND from_project_id IS NULL) OR yard_bucket IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_equipment_ledger_material ON equipment_ledger(material_id);
CREATE INDEX IF NOT EXISTS idx_equipment_ledger_from     ON equipment_ledger(from_project_id) WHERE from_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_ledger_to       ON equipment_ledger(to_project_id)   WHERE to_project_id IS NOT NULL;

-- 4) Server guard: no negative bucket, ever -----------------------------------
CREATE OR REPLACE FUNCTION equipment_ledger_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_asset    BOOLEAN;
  v_effect      TEXT;
  v_yard_ready  NUMERIC;
  v_yard_repair NUMERIC;
  v_deployed    NUMERIC;
BEGIN
  -- Serialize per material: concurrent movements of the same part queue here,
  -- so the balance re-derivation below can never race past overdraw.
  PERFORM pg_advisory_xact_lock(hashtext('equipment_ledger:' || NEW.material_id::text));

  SELECT is_asset INTO v_is_asset FROM material_catalog WHERE id = NEW.material_id;
  IF v_is_asset IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'material bukan alat (is_asset = false) — pakai alur material biasa';
  END IF;

  -- Disposition effect must match the event type (vocabulary is flexible; the
  -- accounting effect is not).
  IF NEW.event_type IN ('RETURN', 'WRITE_OFF') THEN
    SELECT ledger_effect INTO v_effect FROM equipment_dispositions WHERE id = NEW.disposition_id;
    IF v_effect IS NULL THEN
      RAISE EXCEPTION 'disposisi tidak dikenal';
    END IF;
    IF NEW.event_type = 'RETURN' AND v_effect NOT IN ('RETURN_OK', 'RETURN_HOLD') THEN
      RAISE EXCEPTION 'RETURN butuh disposisi kembali/perbaikan, bukan efek %', v_effect;
    END IF;
    IF NEW.event_type = 'WRITE_OFF' AND v_effect <> 'WRITE_OFF' THEN
      RAISE EXCEPTION 'WRITE_OFF butuh disposisi dengan efek WRITE_OFF, bukan %', v_effect;
    END IF;
  END IF;

  -- Re-derive yard buckets for this material INCLUDING the new row (AFTER
  -- trigger → all rows of the current statement are visible).
  SELECT
    COALESCE(SUM(CASE
      WHEN l.event_type = 'OPENING'  THEN l.qty
      WHEN l.event_type = 'REPAIRED' THEN l.qty
      WHEN l.event_type = 'RETURN'   AND d.ledger_effect = 'RETURN_OK' THEN l.qty
      WHEN l.event_type = 'DEPLOY'   THEN -l.qty
      WHEN l.event_type = 'WRITE_OFF' AND l.from_project_id IS NULL AND l.yard_bucket = 'READY' THEN -l.qty
      ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN l.event_type = 'RETURN'   AND d.ledger_effect = 'RETURN_HOLD' THEN l.qty
      WHEN l.event_type = 'REPAIRED' THEN -l.qty
      WHEN l.event_type = 'WRITE_OFF' AND l.from_project_id IS NULL AND l.yard_bucket = 'REPAIR' THEN -l.qty
      ELSE 0 END), 0)
  INTO v_yard_ready, v_yard_repair
  FROM equipment_ledger l
  LEFT JOIN equipment_dispositions d ON d.id = l.disposition_id
  WHERE l.material_id = NEW.material_id;

  IF v_yard_ready < 0 THEN
    RAISE EXCEPTION 'stok gudang (siap) tidak cukup — saldo akan menjadi %', v_yard_ready;
  END IF;
  IF v_yard_repair < 0 THEN
    RAISE EXCEPTION 'stok perbaikan di gudang tidak cukup — saldo akan menjadi %', v_yard_repair;
  END IF;

  -- Outflow from a project can't exceed what is deployed there.
  IF NEW.from_project_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE
      WHEN l.to_project_id   = NEW.from_project_id AND l.event_type IN ('DEPLOY', 'TRANSFER') THEN l.qty
      WHEN l.from_project_id = NEW.from_project_id AND l.event_type IN ('TRANSFER', 'RETURN', 'WRITE_OFF') THEN -l.qty
      ELSE 0 END), 0)
    INTO v_deployed
    FROM equipment_ledger l
    WHERE l.material_id = NEW.material_id
      AND (l.from_project_id = NEW.from_project_id OR l.to_project_id = NEW.from_project_id);

    IF v_deployed < 0 THEN
      RAISE EXCEPTION 'jumlah alat terpasang di proyek asal tidak cukup — saldo akan menjadi %', v_deployed;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS equipment_ledger_guard_trg ON equipment_ledger;
CREATE TRIGGER equipment_ledger_guard_trg
  AFTER INSERT ON equipment_ledger
  FOR EACH ROW EXECUTE FUNCTION equipment_ledger_guard();

-- 5) RLS ------------------------------------------------------------------------
ALTER TABLE equipment_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_ledger       ENABLE ROW LEVEL SECURITY;

-- Dispositions: everyone signed-in reads (pickers); office manages vocabulary.
DROP POLICY IF EXISTS "equipment_dispositions_authenticated_read" ON equipment_dispositions;
CREATE POLICY "equipment_dispositions_authenticated_read" ON equipment_dispositions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "equipment_dispositions_office_insert" ON equipment_dispositions;
CREATE POLICY "equipment_dispositions_office_insert" ON equipment_dispositions
  FOR INSERT WITH CHECK (is_office_role());

DROP POLICY IF EXISTS "equipment_dispositions_office_update" ON equipment_dispositions;
CREATE POLICY "equipment_dispositions_office_update" ON equipment_dispositions
  FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role());

-- Ledger: pool state is company-wide (yard math needs ALL events), so every
-- signed-in role reads; office records movements. No UPDATE/DELETE policies —
-- append-only by construction.
DROP POLICY IF EXISTS "equipment_ledger_authenticated_read" ON equipment_ledger;
CREATE POLICY "equipment_ledger_authenticated_read" ON equipment_ledger
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "equipment_ledger_office_insert" ON equipment_ledger;
CREATE POLICY "equipment_ledger_office_insert" ON equipment_ledger
  FOR INSERT WITH CHECK (is_office_role());

-- 6) Route assets OUT of the consumable/budget layer -------------------------
-- (a) v_material_envelopes is THE chokepoint: v_material_envelope_status (072)
--     and v_material_budget_status (047) both build on it, so one is_asset
--     filter here excludes equipment from the Tier-2 envelope gate, the Tier-3
--     Rupiah budget, the PO quantity gate (071), and the office envelope
--     screens in a single place. Column list stays byte-identical to 054, so
--     dependent views need no re-create (same guarantee 054 documented).
CREATE OR REPLACE VIEW v_material_envelopes AS
SELECT
  pmml.material_id,
  pmm.project_id,
  mc.code AS material_code,
  mc.name AS material_name,
  mc.tier,
  mc.unit,
  SUM(pmml.planned_quantity) AS total_planned,
  COUNT(DISTINCT pmml.boq_item_id) AS boq_item_count
FROM project_material_master_lines pmml
JOIN project_material_master pmm ON pmm.id = pmml.master_id
JOIN material_catalog mc ON mc.id = pmml.material_id
WHERE pmml.master_id = (
  SELECT id FROM project_material_master
  WHERE project_id = pmm.project_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
  AND mc.is_asset IS DISTINCT FROM true
GROUP BY pmml.material_id, pmm.project_id, mc.code, mc.name, mc.tier, mc.unit;

-- (b) Server twin of the picker filters (dual-layer, like the tier gates):
--     no client path — stale bundle, Gate2, direct RPC — can put an asset on a
--     material request or purchase order.
CREATE OR REPLACE FUNCTION reject_asset_material_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.material_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM material_catalog mc WHERE mc.id = NEW.material_id AND mc.is_asset
  ) THEN
    RAISE EXCEPTION 'material ini alat milik perusahaan (is_asset) — kelola lewat pool Alat, bukan permintaan/PO material';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_request_lines_asset_guard_trg ON material_request_lines;
CREATE TRIGGER material_request_lines_asset_guard_trg
  BEFORE INSERT OR UPDATE OF material_id ON material_request_lines
  FOR EACH ROW EXECUTE FUNCTION reject_asset_material_line();

DROP TRIGGER IF EXISTS purchase_order_lines_asset_guard_trg ON purchase_order_lines;
CREATE TRIGGER purchase_order_lines_asset_guard_trg
  BEFORE INSERT OR UPDATE OF material_id ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION reject_asset_material_line();
