-- ═══════════════════════════════════════════════════════════════════════════
-- 095 — Tambah material proyek: add ONE project-level plan line without a
--       full re-publish.
--
-- Spec: docs/superpowers/specs/2026-09-02-add-project-material-line-design.md
--
-- WHY. A published project's plan could only change through a whole-plan
-- re-publish of the SANO Input workbook (tools/publishBaselineV2.ts). Planned
-- rows come only from the file, and when the file carries Others rows the
-- project's ahs_price_book is deleted and rebuilt (:1558-1563). The common case
-- — one Tier 2/3/4 material the estimator forgot that a supervisor needs now —
-- therefore forced the riskiest operation in the app (cf. the 2026-08-15
-- Others column-shift incident). This RPC appends ONE project-level line to the
-- CURRENT master, atomically, with audit + notification.
--
-- SCOPE. Tier 2/3/4 only, boq_item_id NULL. Tier 1 is refused (needs a work
-- area → workbook). p_planned_qty is in the catalogue BASE unit (kg for rebar,
-- never batang/supplier units) — the same unit the line is stored with. Materials already in the current master are refused (change
-- quantities via re-publish so the diff + ceiling gate apply). Assets refused.
--
-- CONCURRENCY. Two writers can collide here in two different ways.
--   (a) Two adds of the same material: the ADD_LINE_EXISTS probe is a read, and
--       project_material_master_lines had no unique key (002:98-106), so under
--       READ COMMITTED both would insert and v_material_envelopes (084:211-230)
--       would SUM a doubled ceiling. We take
--       pg_advisory_xact_lock(hashtextextended(project_id::text,0)) before the
--       probe, and back it with the partial unique index in §1.
--   (b) An add racing a re-publish: publish inserts its new master from the
--       CLIENT (publishBaselineV2.ts:1481-1484), so it takes no lock this
--       function could share, and SELECT ... FOR UPDATE on the current master
--       cannot block the INSERT of a newer one. We therefore re-read the latest
--       master AFTER the line lands and RAISE ADD_LINE_RACE if it moved — the
--       line would otherwise be invisible to every reader, all of which scope to
--       latest-master (084:224-229, 094:277-283, 094:310-315). Losing loudly
--       beats a silently ignored plan line (CLAUDE.md §1.1). BEST-EFFORT: this
--       closes the window where the publish COMMITTED between our master pick
--       and the re-read; a publish that commits after the re-read but before
--       this transaction commits is invisible under READ COMMITTED. That
--       residual is milliseconds wide, and the outcome (a line on a superseded
--       master) is still surfaced by the plan_revisions audit row and by the
--       publish-time guard in BaselineScreen.
--   (c) An add during the WIDER publish window: publish flips is_current and
--       inserts the new ahs_versions row (publishBaselineV2.ts:1256-1267) several
--       round-trips BEFORE it inserts the new master (:1481). In that window —
--       or forever, if publish crashed between the two — the current version and
--       the latest master disagree. A line added then would land on a master
--       about to be superseded and (b) would not notice, because the master id
--       has not moved yet. We compare the versions and RAISE
--       ADD_LINE_PUBLISH_IN_PROGRESS before writing anything.
--
-- NOT DURABLE ACROSS RE-PUBLISH. Publish rebuilds master lines from the file
-- alone and deletes the project's ahs_price_book when the file carries Others
-- rows (publishBaselineV2.ts:1531-1536, :1558-1563). The estimator MUST append
-- this row to the project's SANO Input master file; otherwise the next publish
-- drops it and the diff reports it as REMOVED_WITH_ACTIVITY (or silently, with
-- no activity). BaselineScreen warns before that publish using the
-- plan_revisions rows this function writes (summary->>'kind' = 'INCREMENTAL_ADD').
--
-- ACCESS RULE. Office-only, ANY project — deliberately: is_office_role()
-- (036:33-45) is global, so the assert_project_access(p_project_id) call below
-- can never fail for a caller who passed ADD_LINE_AUTH. It is kept as
-- belt-and-suspenders against a future narrowing of is_office_role(), not as a
-- live second gate. Service role / Dashboard (auth.uid() IS NULL) is ALLOWED,
-- matching 061:99-102 / 079:159-162 / 088:421; published_by is then NULL, which
-- plan_revisions permits (078:66).
--
-- CEILING GATE. Not called. A material absent from the current master has no
-- v_material_envelope_status row, and compute_ceiling_breaches (079:207-213)
-- requires total_planned > 0, so it cannot be an overage-absolving raise; a
-- material already present is refused above. Adding cannot lower or raise an
-- existing ceiling.
--
-- SNAPSHOT. material_baseline_snapshots is first-publish-wins (077). If this
-- material existed in a PRIOR master and was removed since, its old baseline
-- stands and Signal-2 drift may show at once; the result reports
-- snapshot_written = false so the UI can say so.
--
-- PRICE BOOK. UPDATE-if-exists rather than a second row: v_material_budget_status
-- picks ORDER BY effective_from DESC LIMIT 1 (047:75-82), non-deterministic on
-- ties. committed_rupiah is recomputed live, so either path re-prices history.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS; CREATE OR REPLACE FUNCTION.
-- Depends on 036 (is_office_role), 061 (assert_project_access), 077, 078
-- (notify_plan_revised), 082 (boq_item_id nullable), 084 (is_asset).
-- PASTE ORDER: creates only new objects and re-creates no existing function, so
-- its position relative to 088–094 is irrelevant and re-pasting any of those
-- cannot revert it.
-- ═══════════════════════════════════════════════════════════════════════════

-- §1 Durable backstop for concurrent adds. Publish already merges same-material
-- Others rows into one line per material (publishBaselineV2.ts:682-693), so
-- existing masters satisfy this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pmml_project_level_material
  ON project_material_master_lines (master_id, material_id)
  WHERE boq_item_id IS NULL AND material_id IS NOT NULL;

-- §2 The RPC.
CREATE OR REPLACE FUNCTION add_project_material_line(
  p_project_id  UUID,
  p_material_id UUID,
  p_planned_qty NUMERIC,
  p_unit_price  NUMERIC DEFAULT NULL,
  p_note        TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_master_id       UUID;
  v_master_version  UUID;
  v_current_version UUID;
  v_version_id      UUID;
  v_master_after    UUID;
  v_mat             RECORD;
  v_line_id         UUID;
  v_revision_id     UUID;
  v_pb_id           UUID;
  v_pb_result       TEXT := 'skipped';
  v_snap_written    BOOLEAN := FALSE;
  v_notified        BOOLEAN := FALSE;
  v_summary         JSONB;
  v_qty_text        TEXT;
  v_body            TEXT;
BEGIN
  -- Access (see header: service role passes; JWT callers must be office).
  IF v_uid IS NOT NULL AND NOT is_office_role() THEN
    RAISE EXCEPTION 'ADD_LINE_AUTH: only estimator/admin/principal may add project material lines'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM assert_project_access(p_project_id);

  -- Serialize adds per project (header: CONCURRENCY (a)). hashtextextended and
  -- 084's hashtext share the bigint lock space; a collision only serializes an
  -- unrelated equipment-ledger write against this add — benign.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));

  -- Current master: latest, with the 084/094 tiebreak.
  SELECT id, ahs_version_id INTO v_master_id, v_master_version
  FROM project_material_master
  WHERE project_id = p_project_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_master_id IS NULL THEN
    RAISE EXCEPTION 'ADD_LINE_NO_MASTER: project % has no published material master', p_project_id;
  END IF;

  -- Revision is recorded within the current version (no new ahs_versions row).
  SELECT id INTO v_current_version
  FROM ahs_versions
  WHERE project_id = p_project_id AND is_current = TRUE
  LIMIT 1;
  v_version_id := COALESCE(v_current_version, v_master_version);

  -- Header: CONCURRENCY (c). Refuse while a publish is between its version flip
  -- and its master insert (or was interrupted there). Projects published before
  -- 032 have no is_current row and skip this check via the COALESCE above.
  IF v_current_version IS NOT NULL AND v_current_version IS DISTINCT FROM v_master_version THEN
    RAISE EXCEPTION 'ADD_LINE_PUBLISH_IN_PROGRESS: current ahs_version % does not match the latest master version % — a publish is in progress or was interrupted; retry after it completes',
      v_current_version, v_master_version;
  END IF;

  -- Material guards.
  SELECT id, name, unit, tier, COALESCE(is_asset, FALSE) AS is_asset
  INTO v_mat
  FROM material_catalog
  WHERE id = p_material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADD_LINE_MATERIAL: material % not in catalog', p_material_id;
  END IF;
  IF v_mat.is_asset THEN
    RAISE EXCEPTION 'ADD_LINE_ASSET: % is an asset (equipment ledger), not a plan material', v_mat.name;
  END IF;
  IF v_mat.tier = 1 THEN
    RAISE EXCEPTION 'ADD_LINE_TIER1: % is Tier 1 and needs a work area — use the SANO Input workbook', v_mat.name;
  END IF;
  IF v_mat.unit IS NULL OR btrim(v_mat.unit) = '' THEN
    RAISE EXCEPTION 'ADD_LINE_UNIT: catalog unit for % is blank', v_mat.name;
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_material_master_lines
    WHERE master_id = v_master_id AND material_id = p_material_id
  ) THEN
    RAISE EXCEPTION 'ADD_LINE_EXISTS: % is already planned in the current master', v_mat.name;
  END IF;

  -- Value guards.
  IF p_planned_qty IS NULL OR p_planned_qty <= 0 THEN
    RAISE EXCEPTION 'ADD_LINE_QTY: planned quantity must be > 0';
  END IF;
  IF v_mat.tier = 3 AND p_unit_price IS NULL THEN
    RAISE EXCEPTION 'ADD_LINE_PRICE_REQUIRED: Tier 3 is a Rupiah budget — unit price is required';
  END IF;
  IF p_unit_price IS NOT NULL AND p_unit_price <= 0 THEN
    RAISE EXCEPTION 'ADD_LINE_PRICE: unit price must be > 0';
  END IF;

  -- 1. Master line (project-level; unit is the catalogue base unit).
  INSERT INTO project_material_master_lines
    (master_id, material_id, boq_item_id, planned_quantity, unit)
  VALUES (v_master_id, p_material_id, NULL, p_planned_qty, v_mat.unit)
  RETURNING id INTO v_line_id;

  -- 2. Price book: update-if-exists, else insert (header: PRICE BOOK).
  IF p_unit_price IS NOT NULL THEN
    SELECT id INTO v_pb_id
    FROM ahs_price_book
    WHERE project_id = p_project_id AND material_id = p_material_id
    ORDER BY effective_from DESC
    LIMIT 1;
    IF v_pb_id IS NOT NULL THEN
      UPDATE ahs_price_book
      SET unit_price = p_unit_price,
          unit = v_mat.unit,
          tier = v_mat.tier,
          material_name = v_mat.name,
          effective_from = now()
      WHERE id = v_pb_id;
      v_pb_result := 'updated';
    ELSE
      INSERT INTO ahs_price_book (project_id, material_id, material_name, unit, unit_price, tier)
      VALUES (p_project_id, p_material_id, v_mat.name, v_mat.unit, p_unit_price, v_mat.tier);
      v_pb_result := 'inserted';
    END IF;
  END IF;

  -- 3. Baseline snapshot: first-publish-wins (077).
  INSERT INTO material_baseline_snapshots
    (project_id, material_id, baseline_planned_qty, unit, source_master_id)
  VALUES (p_project_id, p_material_id, p_planned_qty, v_mat.unit, v_master_id)
  ON CONFLICT (project_id, material_id) DO NOTHING;
  v_snap_written := FOUND;

  -- 4. Revision header: full PlanRevisionSummary numeric keys + incremental tags.
  v_summary := jsonb_build_object(
    'raisedAbsolvingOverage', 0,
    'raised', 0,
    'loweredBelowOrdered', 0,
    'removedWithActivity', 0,
    'added', 1,
    'lowered', 0,
    'noActivityChanged', 0,
    'warningCount', 0,
    'kind', 'INCREMENTAL_ADD',
    'material_id', p_material_id,
    'material_name', v_mat.name,
    'unit', v_mat.unit,
    'tier', v_mat.tier,
    'planned_after', p_planned_qty,
    'unit_price', p_unit_price,
    'note', p_note
  );
  -- acknowledged_at = now(): nothing to acknowledge (warningCount 0); the row
  -- records WHO added WHAT and WHEN, not a checklist sign-off.
  INSERT INTO plan_revisions
    (project_id, old_ahs_version_id, new_ahs_version_id, published_by, acknowledged_at, summary)
  VALUES (p_project_id, v_version_id, v_version_id, v_uid, now(), v_summary)
  RETURNING id INTO v_revision_id;

  -- 5. Revision line.
  INSERT INTO plan_revision_lines
    (revision_id, material_id, planned_before, planned_after, ordered_at_time, requested_at_time, classification)
  VALUES (v_revision_id, p_material_id, 0, p_planned_qty, 0, 0, 'ADDED');

  -- Race check (header: CONCURRENCY (b)). Everything above rolls back on RAISE.
  SELECT id INTO v_master_after
  FROM project_material_master
  WHERE project_id = p_project_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_master_after IS DISTINCT FROM v_master_id THEN
    RAISE EXCEPTION 'ADD_LINE_RACE: a re-publish replaced the current master during this call — retry';
  END IF;

  -- 6. Notify supervisors (PLAN_REVISED, raise count 0 → no principal FYI).
  -- Non-fatal: the plan line is the truth; a notification hiccup must not undo it.
  v_qty_text := CASE
    WHEN position('.' IN p_planned_qty::text) > 0
      THEN regexp_replace(p_planned_qty::text, '\.?0+$', '')
    ELSE p_planned_qty::text
  END;
  v_body := format('Material baru ditambahkan ke rencana: %s %s %s', v_mat.name, v_qty_text, v_mat.unit);
  BEGIN
    PERFORM notify_plan_revised(p_project_id, v_revision_id, v_body, 0);
    v_notified := TRUE;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'add_project_material_line: notify_plan_revised failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'line_id', v_line_id,
    'revision_id', v_revision_id,
    'master_id', v_master_id,
    'material_name', v_mat.name,
    'unit', v_mat.unit,
    'tier', v_mat.tier,
    'planned_after', p_planned_qty,
    'price_book_written', v_pb_result,
    'snapshot_written', v_snap_written,
    'notified', v_notified
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION add_project_material_line(UUID, UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_project_material_line(UUID, UUID, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (replace placeholders).
--
-- 0. BEFORE PASTING — the §1 unique index must build on existing data. Probe:
--      SELECT master_id, material_id, count(*)
--      FROM project_material_master_lines
--      WHERE boq_item_id IS NULL AND material_id IS NOT NULL
--      GROUP BY 1, 2 HAVING count(*) > 1;
--    EXPECTED: no rows. If any appear, they are publish-era duplicates; merge
--    them (sum planned_quantity into one row, delete the rest) before pasting.
--
-- 0b. BEFORE PASTING — no live project may already sit in the state this RPC
--     refuses as ADD_LINE_PUBLISH_IN_PROGRESS (current version ≠ latest master):
--      SELECT lm.project_id, lm.ahs_version_id AS master_version, v.id AS current_version
--      FROM (
--        SELECT DISTINCT ON (project_id) project_id, id, ahs_version_id
--        FROM project_material_master
--        ORDER BY project_id, created_at DESC, id DESC
--      ) lm
--      JOIN ahs_versions v ON v.project_id = lm.project_id AND v.is_current
--      WHERE v.id <> lm.ahs_version_id;
--    EXPECTED: no rows. A row is an interrupted publish — re-publish that
--    project from its master file before estimators use this button on it.
--
-- Run the rest AFTER pasting.
--
-- 1. Index exists:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename = 'project_material_master_lines'
--        AND indexname = 'uq_pmml_project_level_material';
--    EXPECTED: one row.
--
-- 2. Function exists with the 5-arg signature and is SECURITY DEFINER:
--      SELECT proname, prosecdef FROM pg_proc
--      WHERE proname = 'add_project_material_line';
--    EXPECTED: one row, prosecdef = true.
--
-- 3. Happy path on a TEST project (Tier-3 material not yet in its plan):
--      SELECT add_project_material_line(
--        '<PROJECT_UUID>'::uuid, '<TIER3_MATERIAL_UUID>'::uuid, 1, 2500000, 'self-check');
--    EXPECTED: jsonb with price_book_written = 'inserted' (or 'updated'),
--    snapshot_written true unless the material had a prior baseline, notified true.
--
-- 3b. The supervisor notification landed:
--      SELECT type, title FROM notifications
--      WHERE related_entity_id = '<REVISION_ID_FROM_STEP_3>'::uuid;
--    EXPECTED: one PLAN_REVISED row per supervisor member of the project.
--
-- 4. The line is visible to the envelope view immediately:
--      SELECT total_planned FROM v_material_envelopes
--      WHERE project_id = '<PROJECT_UUID>'::uuid AND material_id = '<TIER3_MATERIAL_UUID>'::uuid;
--    EXPECTED: 1.
--
-- 5. Second call with the same material:
--    EXPECTED: ERROR  ADD_LINE_EXISTS: ...
--
-- 6. A Tier-1 material:
--    EXPECTED: ERROR  ADD_LINE_TIER1: ...
--
-- 7. A supervisor JWT (Dashboard "Run as" or the app):
--    EXPECTED: ERROR  ADD_LINE_AUTH: ...
--
-- 8. Cleanup on the TEST project if needed:
--      DELETE FROM plan_revision_lines WHERE revision_id IN
--        (SELECT id FROM plan_revisions WHERE project_id = '<PROJECT_UUID>'::uuid
--           AND summary->>'kind' = 'INCREMENTAL_ADD' AND summary->>'note' = 'self-check');
--      DELETE FROM plan_revisions WHERE project_id = '<PROJECT_UUID>'::uuid
--        AND summary->>'kind' = 'INCREMENTAL_ADD' AND summary->>'note' = 'self-check';
--      DELETE FROM project_material_master_lines WHERE id = '<LINE_ID_FROM_STEP_3>'::uuid;
--    (plan_revisions has no DELETE policy for authenticated — run as service role.)
-- ═══════════════════════════════════════════════════════════════════════════
