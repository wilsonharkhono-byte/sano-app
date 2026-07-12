-- 077 — Immutable baseline snapshots: the anchor for Signal 2 (plan drift)
--        (Task 2.10, Phase 2 — HIGH)
--
-- Design authority: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md
--   §4 "Signal 2 — plan drift". Table shape and INSERT-only semantics below
--   are binding per that spec.
--
-- NUMBERING: this is 077. 074/075 are RESERVED for Phase 3 of the remediation
--   plan; 076 (overage_reason) is Task 2.4, logically independent of this one.
--   Apply via the Dashboard SQL Editor (remote history diverged — see project
--   memory "Migration history divergence"). Idempotent, safe to re-paste.
--
-- ── The problem ─────────────────────────────────────────────────────────
--   Signal 1 (ordering overage) compares ordered/requested against the
--   CURRENT published plan — by design, a re-publish moves the goalposts.
--   That's correct for "are we about to over-order right now", but it means
--   nothing today records what was FIRST planned per material, so a chain of
--   re-publishes that quietly ratchets a material's planned qty up (or down)
--   leaves no trace an estimator or principal can audit. Signal 2 needs an
--   anchor that re-publish cannot move.
--
-- ── The fix ─────────────────────────────────────────────────────────────
--   material_baseline_snapshots holds ONE row per (project, material): the
--   planned quantity (base units) as of the FIRST publish in which that
--   material appeared in project_material_master_lines. Materials introduced
--   in a later re-publish get their snapshot then — their "first published"
--   is the first publish that contains them, not necessarily the project's
--   first publish overall.
--
--   IMMUTABILITY CONTRACT (non-negotiable, per spec §4: "Inserts only; no
--   UPDATE/DELETE path"):
--     - No UPDATE policy, no DELETE policy — enforced at the RLS layer, not
--       just by app-code discipline. Even an office-role/estimator caller
--       cannot UPDATE or DELETE a snapshot row through the app's Supabase
--       client; RLS with no matching policy for a command denies it
--       outright for any non-owner role.
--     - The app never issues an UPDATE/DELETE against this table (verify:
--       grep tools/ workflows/ for material_baseline_snapshots — the only
--       write is the ON CONFLICT DO NOTHING upsert in publishBaselineV2.ts,
--       right after the project_material_master_lines insert).
--     - UNIQUE (project_id, material_id) + ON CONFLICT DO NOTHING is what
--       makes "first publish wins, forever" hold: a re-publish's upsert for
--       an already-snapshotted material silently no-ops; only a material's
--       FIRST appearance ever lands a row.
--
-- ── Aggregation ─────────────────────────────────────────────────────────
--   project_material_master_lines is per-(boq_item, material). A material's
--   baseline_planned_qty is the SUM of planned_quantity across every
--   boq_item line for that material in the snapshotting master (base units;
--   see tools/publishBaselineV2.ts buildBaselineSnapshotRows, the pure
--   helper this migration's backfill mirrors in SQL).
--
-- ── Backfill ────────────────────────────────────────────────────────────
--   Existing projects published before this migration have no baseline
--   anchor yet. Seed one from each project's EARLIEST project_material_master
--   (ORDER BY created_at ASC, id ASC — ties broken by id so the pick is
--   deterministic) so they get an anchor consistent with "first publish
--   wins" rather than silently starting blank. ON CONFLICT DO NOTHING makes
--   this idempotent — re-pasting the migration is a no-op the second time.
--   A material group whose lines disagree on unit (should not happen — a
--   material's unit is fixed in material_catalog, but this is defense
--   against stale/mixed data) is skipped rather than guessed at
--   (CLAUDE.md §1.1: wrong numbers are worse than absent numbers).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS material_baseline_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_id          UUID NOT NULL REFERENCES material_catalog(id),
  baseline_planned_qty NUMERIC NOT NULL,
  unit                 TEXT NOT NULL,
  source_master_id     UUID NOT NULL REFERENCES project_material_master(id),
  snapshotted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, material_id)
);

COMMENT ON TABLE material_baseline_snapshots IS
  'Immutable per-material anchor for Signal 2 (plan drift): the planned qty '
  '(base units) as of the FIRST publish in which the material appeared. '
  'INSERT-only — no UPDATE/DELETE policy exists on this table by design. '
  'See docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §4.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS — read for assigned ∪ office; INSERT for office (publish path) only;
--    no UPDATE/DELETE policies at all.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE material_baseline_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT — any user assigned to the project (any role), mirrors the
-- <assigned> subquery used across the schema (e.g. 059_boq_items_write_split.sql).
DROP POLICY IF EXISTS "material_baseline_snapshots_assigned_read" ON material_baseline_snapshots;
CREATE POLICY "material_baseline_snapshots_assigned_read" ON material_baseline_snapshots
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_assignments WHERE user_id = auth.uid())
  );

-- SELECT — office roles (admin/principal/estimator) read across every
-- project, not just ones they're assigned to (mirrors 036's global office
-- access model).
DROP POLICY IF EXISTS "material_baseline_snapshots_office_read" ON material_baseline_snapshots;
CREATE POLICY "material_baseline_snapshots_office_read" ON material_baseline_snapshots
  FOR SELECT USING (is_office_role());

-- INSERT — office roles only. Publish runs as the estimator (office role),
-- so this is the only write path this table ever needs. No assigned-only
-- INSERT policy exists — a supervisor's client can never write here.
DROP POLICY IF EXISTS "material_baseline_snapshots_office_insert" ON material_baseline_snapshots;
CREATE POLICY "material_baseline_snapshots_office_insert" ON material_baseline_snapshots
  FOR INSERT WITH CHECK (is_office_role());

-- No UPDATE policy. No DELETE policy. RLS-enabled + zero matching policies
-- for a command denies that command outright for every non-owner role —
-- this IS the immutability enforcement, not just app-code discipline.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Backfill — seed existing projects from their EARLIEST published master.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO material_baseline_snapshots
  (project_id, material_id, baseline_planned_qty, unit, source_master_id)
SELECT
  earliest.project_id,
  pml.material_id,
  SUM(pml.planned_quantity) AS baseline_planned_qty,
  MIN(pml.unit)             AS unit,
  earliest.master_id        AS source_master_id
FROM (
  -- One row per project: its earliest master (created_at, then id, breaks ties).
  SELECT DISTINCT ON (project_id)
    project_id,
    id AS master_id
  FROM project_material_master
  ORDER BY project_id, created_at ASC, id ASC
) earliest
JOIN project_material_master_lines pml ON pml.master_id = earliest.master_id
WHERE pml.material_id IS NOT NULL
GROUP BY earliest.project_id, earliest.master_id, pml.material_id
HAVING COUNT(DISTINCT pml.unit) = 1
ON CONFLICT (project_id, material_id) DO NOTHING;
