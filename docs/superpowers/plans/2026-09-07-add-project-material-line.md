# Tambah Material Proyek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an estimator add one new Tier 2/3/4 project-level material to an already-published project's plan atomically, without a full re-publish, and warn at publish time when such a material is missing from the next uploaded file.

**Architecture:** Migration 095 adds a partial unique index and a SECURITY DEFINER RPC `add_project_material_line` that performs every write (master line, price book, snapshot, plan revision + line, supervisor notification) in one transaction under a per-project advisory lock with a post-insert latest-master race check. A small pure module `tools/addProjectMaterialLine.ts` mirrors the server guards client-side, maps error prefixes to Indonesian copy, wraps the RPC, and detects incrementally-added materials missing from a staged workbook. `BaselineScreen` gains an inline card/form and the publish-time guard, and its Panduan text stops pointing at the unrelated "Catatan Perubahan".

**Tech Stack:** Postgres/plpgsql (Supabase, hand-pasted migrations), TypeScript, React Native (Expo), jest + ts-jest (static SQL guard tests in `tools/__tests__/`).

**Spec:** `docs/superpowers/specs/2026-09-02-add-project-material-line-design.md`

**Worktree:** `.claude/worktrees/add-project-material-line` (branch `feat/add-project-material-line`). The repo jest config ignores every path containing `/.claude/worktrees/` — that matches the worktree itself, so plain `npx jest` finds NO tests here. Always override the ignore list:

- Single file: `npx jest <path> --testPathIgnorePatterns='/node_modules/'`
- Full suite: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='__tests__/fixtures\\.ts$' --testPathIgnorePatterns='__tests__/_serverGateHarness\\.ts$' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/'`

Use the `=` form; a bare `--testPathIgnorePatterns a b <file>` swallows the file path as another pattern and runs everything. The worktree needs a copy of the main checkout's `.env` (gitignored): two suites read it at import and otherwise fail with ENOENT while being skipped in the main checkout.

**Commit identity:** use `git -c user.name="Test User" -c user.email="test@example.com" commit ...` (matches the repo's existing commits). End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/095_add_project_material_line.sql` (create) | Partial unique index + the RPC. Header documents concurrency, access rule, non-durability across re-publish. Self-check queries at the end. |
| `tools/__tests__/migration095.test.ts` (create) | Static guards on the SQL text (pattern: `tools/__tests__/migration094.test.ts`). |
| `tools/addProjectMaterialLine.ts` (create) | `validateAddLineInput`, `mapAddLineError`, `addProjectMaterialLine`, `findIncrementalAddsMissingFromStaging`, shared types and Indonesian messages. No React, no direct supabase import (client injected). |
| `tools/__tests__/addProjectMaterialLine.test.ts` (create) | Unit tests for the module. |
| `workflows/screens/BaselineScreen.tsx` (modify) | Card + inline form in the `sessions` view; Panduan text fix; publish-time guard in `handlePublish`; `fetchCurrentMaster` also returns the master's `ahs_version_id`. |

---

### Task 1: Migration 095 with static guard test

**Files:**
- Create: `supabase/migrations/095_add_project_material_line.sql`
- Test: `tools/__tests__/migration095.test.ts`

- [ ] **Step 1: Confirm the columns the SQL relies on**

Run from the worktree root:

```bash
grep -n "CREATE TABLE IF NOT EXISTS ahs_versions" -A 10 supabase/migrations/002_baseline_tables.sql | head -14
grep -n "is_current" supabase/migrations/032_*.sql | head -5
grep -n "CREATE TABLE IF NOT EXISTS project_material_master_lines" -A 9 supabase/migrations/002_baseline_tables.sql
grep -n "CREATE OR REPLACE FUNCTION notify_plan_revised" -A 6 supabase/migrations/078_plan_revisions.sql
```

Expected: `ahs_versions` has `project_id` and `is_current`; `project_material_master_lines` has `master_id, material_id, boq_item_id, planned_quantity, unit`; `notify_plan_revised(p_project_id UUID, p_revision_id UUID, p_summary TEXT, p_raise_count INT DEFAULT 0)`. If any differs, adjust the SQL in Step 3 to the real names and note the change in the commit body.

- [ ] **Step 2: Write the failing static guard test**

Create `tools/__tests__/migration095.test.ts`:

```ts
/**
 * Static guard for migration 095 (Tambah material proyek — incremental plan line).
 *
 * Migrations are pasted into the Supabase Dashboard (remote history diverged),
 * so the DB half cannot run under jest. The guard is the SQL text itself. Each
 * assertion protects a decision that a later "tidy-up" could silently undo:
 *
 *  • The advisory lock + partial unique index: without them two concurrent adds
 *    of the same material both pass the EXISTS probe and v_material_envelopes
 *    SUMs a doubled ceiling.
 *  • The post-insert latest-master re-read: publish inserts a NEW master from
 *    the client with no lock this function can share, so a line added onto a
 *    master that was replaced mid-call is invisible to every reader.
 *  • boq_item_id NULL and tier 1 refused: the line is project-level by design.
 *  • Snapshot ON CONFLICT DO NOTHING: first-publish-wins (077).
 *  • No DELETE on ahs_price_book (publish's delete-then-insert must not leak in).
 *  • No ceiling gate call: a brand-new material cannot breach; documented.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/095_add_project_material_line.sql'),
  'utf8',
);

function rpcBody(): string {
  const re = /CREATE OR REPLACE FUNCTION add_project_material_line\([\s\S]*?\n\$\$;/;
  const m = SQL.match(re);
  if (!m) throw new Error('add_project_material_line not found in 095');
  return m[0];
}

describe('migration 095 §1 — partial unique index', () => {
  it('creates the project-level (master_id, material_id) unique index idempotently', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_pmml_project_level_material/);
    expect(SQL).toMatch(/ON project_material_master_lines \(master_id, material_id\)/);
    expect(SQL).toMatch(/WHERE boq_item_id IS NULL AND material_id IS NOT NULL/);
  });
});

describe('migration 095 §2 — add_project_material_line', () => {
  const body = rpcBody();

  it('is SECURITY DEFINER with a pinned search_path', () => {
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/SET search_path = public/);
  });

  it('gates access: office role for JWT callers, assert_project_access, service role allowed', () => {
    expect(body).toMatch(/IF v_uid IS NOT NULL AND NOT is_office_role\(\) THEN/);
    expect(body).toMatch(/PERFORM assert_project_access\(p_project_id\)/);
  });

  it('serializes per project with an advisory transaction lock BEFORE the exists probe', () => {
    const lock = body.indexOf('pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0))');
    const probe = body.indexOf('ADD_LINE_EXISTS');
    expect(lock).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(lock);
  });

  it('resolves the current master with the 084/094 tiebreak', () => {
    const matches = body.match(/ORDER BY created_at DESC, id DESC\s+LIMIT 1/g) ?? [];
    // once to pick the master, once for the post-insert race re-read
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('raises every documented prefix', () => {
    for (const code of [
      'ADD_LINE_AUTH', 'ADD_LINE_NO_MASTER', 'ADD_LINE_MATERIAL', 'ADD_LINE_ASSET',
      'ADD_LINE_TIER1', 'ADD_LINE_UNIT', 'ADD_LINE_EXISTS', 'ADD_LINE_QTY',
      'ADD_LINE_PRICE_REQUIRED', 'ADD_LINE_PRICE', 'ADD_LINE_RACE',
    ]) {
      expect(body).toContain(`'${code}:`);
    }
  });

  it('inserts a project-level line with the catalogue base unit, never a client unit', () => {
    expect(body).toMatch(/INSERT INTO project_material_master_lines\s*\(master_id, material_id, boq_item_id, planned_quantity, unit\)/);
    expect(body).toMatch(/VALUES \(v_master_id, p_material_id, NULL, p_planned_qty, v_mat\.unit\)/);
  });

  it('updates an existing price-book row instead of inserting a tie, and never deletes', () => {
    expect(body).toMatch(/UPDATE ahs_price_book/);
    expect(body).toMatch(/INSERT INTO ahs_price_book/);
    expect(SQL).not.toMatch(/DELETE FROM ahs_price_book/);
  });

  it('keeps first-publish-wins on snapshots', () => {
    expect(body).toMatch(/INSERT INTO material_baseline_snapshots[\s\S]*?ON CONFLICT \(project_id, material_id\) DO NOTHING/);
  });

  it('records an ADDED revision within the current version and notifies supervisors only', () => {
    expect(body).toMatch(/'kind', 'INCREMENTAL_ADD'/);
    expect(body).toMatch(/INSERT INTO plan_revisions/);
    expect(body).toMatch(/VALUES \(p_project_id, v_version_id, v_version_id, v_uid, now\(\), v_summary\)/);
    expect(body).toMatch(/INSERT INTO plan_revision_lines[\s\S]*?'ADDED'\)/);
    expect(body).toMatch(/notify_plan_revised\(p_project_id, v_revision_id, v_body, 0\)/);
  });

  it('re-reads the latest master after the writes and raises ADD_LINE_RACE if it moved', () => {
    const insertPos = body.indexOf('INSERT INTO project_material_master_lines');
    const racePos = body.indexOf('ADD_LINE_RACE');
    expect(insertPos).toBeGreaterThan(-1);
    expect(racePos).toBeGreaterThan(insertPos);
    expect(body).toMatch(/IF v_master_after IS DISTINCT FROM v_master_id THEN/);
  });

  it('does not call the ceiling gate (documented: a new material cannot breach)', () => {
    expect(body).not.toMatch(/assert_ceiling_raise_gate/);
    expect(SQL).toMatch(/cannot be an overage-absolving raise/i);
  });

  it('revokes PUBLIC and grants authenticated + service_role', () => {
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION add_project_material_line\(UUID, UUID, NUMERIC, NUMERIC, TEXT\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION add_project_material_line\(UUID, UUID, NUMERIC, NUMERIC, TEXT\) TO authenticated, service_role;/);
  });

  it('documents non-durability across re-publish in the header', () => {
    expect(SQL).toMatch(/NOT DURABLE ACROSS RE-PUBLISH/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest tools/__tests__/migration095.test.ts --testPathIgnorePatterns='/node_modules/' 2>&1 | tail -15`
Expected: FAIL with `ENOENT: no such file or directory ... 095_add_project_material_line.sql`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/095_add_project_material_line.sql`:

```sql
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
-- area → workbook). Materials already in the current master are refused (change
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
--       beats a silently ignored plan line (CLAUDE.md §1.1).
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

  -- Serialize adds per project (header: CONCURRENCY (a)).
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
    'snapshot_written', v_snap_written
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION add_project_material_line(UUID, UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_project_material_line(UUID, UUID, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run in the Dashboard after pasting; replace placeholders).
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
--    snapshot_written true unless the material had a prior baseline.
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tools/__tests__/migration095.test.ts --testPathIgnorePatterns='/node_modules/' 2>&1 | tail -20`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/095_add_project_material_line.sql tools/__tests__/migration095.test.ts
git -c user.name="Test User" -c user.email="test@example.com" commit -m "chore(db): migration 095 — add_project_material_line RPC + project-level unique index

One transaction appends a Tier 2/3/4 project-level line to the CURRENT
master, upserts the price-book benchmark, writes the first-publish-wins
snapshot, records an ADDED plan revision within the current version, and
notifies supervisors. Per-project advisory lock + partial unique index
close the double-add race; a post-insert latest-master re-read raises
ADD_LINE_RACE if a re-publish landed mid-call. Static guard test.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Client module `tools/addProjectMaterialLine.ts`

**Files:**
- Create: `tools/addProjectMaterialLine.ts`
- Test: `tools/__tests__/addProjectMaterialLine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tools/__tests__/addProjectMaterialLine.test.ts`:

```ts
import {
  ADD_LINE_MESSAGES,
  addProjectMaterialLine,
  findIncrementalAddsMissingFromStaging,
  mapAddLineError,
  validateAddLineInput,
  type AddLineInput,
} from '../addProjectMaterialLine';

const base: AddLineInput = {
  materialId: 'm-1',
  tier: 2,
  isAsset: false,
  unit: 'sak',
  plannedQty: 10,
  unitPrice: null,
};

describe('validateAddLineInput', () => {
  it('accepts a Tier 2 line without a price', () => {
    expect(validateAddLineInput(base)).toEqual({ ok: true });
  });

  it('accepts a Tier 3 line with a positive price', () => {
    expect(validateAddLineInput({ ...base, tier: 3, unitPrice: 2500000 })).toEqual({ ok: true });
  });

  it.each<[Partial<AddLineInput>, string]>([
    [{ materialId: null }, 'ADD_LINE_MATERIAL'],
    [{ isAsset: true }, 'ADD_LINE_ASSET'],
    [{ tier: 1 }, 'ADD_LINE_TIER1'],
    [{ unit: '  ' }, 'ADD_LINE_UNIT'],
    [{ unit: null }, 'ADD_LINE_UNIT'],
    [{ plannedQty: 0 }, 'ADD_LINE_QTY'],
    [{ plannedQty: -3 }, 'ADD_LINE_QTY'],
    [{ plannedQty: Number.NaN }, 'ADD_LINE_QTY'],
    [{ plannedQty: null }, 'ADD_LINE_QTY'],
    [{ tier: 3, unitPrice: null }, 'ADD_LINE_PRICE_REQUIRED'],
    [{ tier: 3, unitPrice: 0 }, 'ADD_LINE_PRICE'],
    [{ tier: 2, unitPrice: -1 }, 'ADD_LINE_PRICE'],
    [{ tier: 2, unitPrice: Number.NaN }, 'ADD_LINE_PRICE'],
  ])('rejects %o with %s', (patch, code) => {
    const result = validateAddLineInput({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.message).toBe(ADD_LINE_MESSAGES[result.code]);
    }
  });

  it('checks asset before tier and tier before unit (server order)', () => {
    const r = validateAddLineInput({ ...base, isAsset: true, tier: 1, unit: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ADD_LINE_ASSET');
  });
});

describe('mapAddLineError', () => {
  it('maps every prefix to its Indonesian copy', () => {
    for (const code of Object.keys(ADD_LINE_MESSAGES) as Array<keyof typeof ADD_LINE_MESSAGES>) {
      expect(mapAddLineError(new Error(`${code}: some server detail`))).toBe(ADD_LINE_MESSAGES[code]);
    }
  });

  it('maps a unique-index violation to the EXISTS copy', () => {
    expect(
      mapAddLineError({ message: 'duplicate key value violates unique constraint "uq_pmml_project_level_material"' }),
    ).toBe(ADD_LINE_MESSAGES.ADD_LINE_EXISTS);
  });

  it('passes an unknown error message through verbatim', () => {
    expect(mapAddLineError(new Error('network down'))).toBe('network down');
    expect(mapAddLineError('plain string')).toBe('plain string');
  });
});

describe('addProjectMaterialLine', () => {
  it('calls the RPC with p_-prefixed params and returns the jsonb result', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return {
          data: {
            line_id: 'l1', revision_id: 'r1', master_id: 'ms1', material_name: 'Cat tembok',
            unit: 'ltr', tier: 3, planned_after: 40, price_book_written: 'inserted', snapshot_written: true,
          },
          error: null,
        };
      },
    };
    const result = await addProjectMaterialLine(client, {
      projectId: 'p1', materialId: 'm1', plannedQty: 40, unitPrice: 85000, note: 'tambahan lantai 2',
    });
    expect(calls).toEqual([{
      fn: 'add_project_material_line',
      args: { p_project_id: 'p1', p_material_id: 'm1', p_planned_qty: 40, p_unit_price: 85000, p_note: 'tambahan lantai 2' },
    }]);
    expect(result.material_name).toBe('Cat tembok');
    expect(result.snapshot_written).toBe(true);
  });

  it('sends null for an omitted price and note, and throws the RPC error', async () => {
    const client = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        expect(args.p_unit_price).toBeNull();
        expect(args.p_note).toBeNull();
        return { data: null, error: { message: 'ADD_LINE_EXISTS: already planned' } };
      },
    };
    await expect(
      addProjectMaterialLine(client, { projectId: 'p1', materialId: 'm1', plannedQty: 1, unitPrice: null, note: null }),
    ).rejects.toMatchObject({ message: 'ADD_LINE_EXISTS: already planned' });
  });
});

describe('findIncrementalAddsMissingFromStaging', () => {
  const revisions = [
    { summary: { kind: 'INCREMENTAL_ADD', material_id: 'a', material_name: 'Cat tembok' } },
    { summary: { kind: 'INCREMENTAL_ADD', material_id: 'b', material_name: 'Fitting dan aksesoris pipa' } },
    { summary: { kind: 'INCREMENTAL_ADD', material_id: 'b', material_name: 'Fitting dan aksesoris pipa' } },
    { summary: { added: 2, raised: 0 } },
    { summary: null },
    { summary: { kind: 'INCREMENTAL_ADD' } },
  ];

  it('returns only incremental adds absent from the staged ids, deduplicated', () => {
    expect(findIncrementalAddsMissingFromStaging(revisions, ['a', 'zzz'])).toEqual([
      { material_id: 'b', material_name: 'Fitting dan aksesoris pipa' },
    ]);
  });

  it('returns nothing when every incremental add is staged', () => {
    expect(findIncrementalAddsMissingFromStaging(revisions, ['a', 'b'])).toEqual([]);
  });

  it('falls back to the id when the name is missing', () => {
    expect(findIncrementalAddsMissingFromStaging(
      [{ summary: { kind: 'INCREMENTAL_ADD', material_id: 'c' } }], [],
    )).toEqual([{ material_id: 'c', material_name: 'c' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tools/__tests__/addProjectMaterialLine.test.ts --testPathIgnorePatterns='/node_modules/' 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '../addProjectMaterialLine'`.

- [ ] **Step 3: Write the module**

Create `tools/addProjectMaterialLine.ts`:

```ts
// SANO — Tambah material proyek: client half of migration 095.
//
// Spec: docs/superpowers/specs/2026-09-02-add-project-material-line-design.md
//
// The server RPC add_project_material_line is the authority. This module
// (1) mirrors its guards so the form can refuse before a round trip,
// (2) maps its RAISE prefixes to Indonesian copy, (3) wraps the RPC with a
// minimal injected client so it is testable without supabase-js, and
// (4) detects incrementally-added materials that a staged re-publish workbook
// omits — publish rebuilds the plan from the file, so those would vanish.
// No React, no direct supabase import.

export type AddLineErrorCode =
  | 'ADD_LINE_AUTH'
  | 'ADD_LINE_NO_MASTER'
  | 'ADD_LINE_MATERIAL'
  | 'ADD_LINE_ASSET'
  | 'ADD_LINE_TIER1'
  | 'ADD_LINE_UNIT'
  | 'ADD_LINE_EXISTS'
  | 'ADD_LINE_QTY'
  | 'ADD_LINE_PRICE_REQUIRED'
  | 'ADD_LINE_PRICE'
  | 'ADD_LINE_RACE';

/** Indonesian copy per server prefix (spec §4.2). */
export const ADD_LINE_MESSAGES: Record<AddLineErrorCode, string> = {
  ADD_LINE_AUTH: 'Hanya estimator/admin yang dapat menambah material proyek.',
  ADD_LINE_NO_MASTER: 'Proyek belum dipublish. Gunakan Publish untuk rencana pertama.',
  ADD_LINE_MATERIAL: 'Material tidak ditemukan di katalog.',
  ADD_LINE_ASSET: 'Alat/aset dicatat di tab Alat, bukan di rencana material.',
  ADD_LINE_TIER1: 'Material Tier 1 harus lewat file SANO Input (butuh area kerja).',
  ADD_LINE_UNIT: 'Satuan material di katalog kosong. Perbaiki katalog dulu.',
  ADD_LINE_EXISTS: 'Material sudah ada di rencana. Ubah jumlah lewat re-publish.',
  ADD_LINE_QTY: 'Jumlah rencana harus lebih dari 0.',
  ADD_LINE_PRICE_REQUIRED: 'Tier 3 adalah anggaran Rupiah: harga satuan wajib diisi.',
  ADD_LINE_PRICE: 'Harga satuan harus lebih dari 0.',
  ADD_LINE_RACE: 'Rencana proyek berubah saat menyimpan (ada publish lain). Coba lagi.',
};

const ERROR_CODES = Object.keys(ADD_LINE_MESSAGES) as AddLineErrorCode[];

/** Name of the partial unique index created by 095 §1. */
export const PROJECT_LEVEL_LINE_INDEX = 'uq_pmml_project_level_material';

export interface AddLineInput {
  materialId: string | null;
  tier: number | null;
  isAsset: boolean;
  unit: string | null;
  /** Parsed number; NaN or null means "not a valid number". */
  plannedQty: number | null;
  /** null = not provided; NaN = provided but unparseable. */
  unitPrice: number | null;
}

export type AddLineValidation =
  | { ok: true }
  | { ok: false; code: AddLineErrorCode; message: string };

function fail(code: AddLineErrorCode): AddLineValidation {
  return { ok: false, code, message: ADD_LINE_MESSAGES[code] };
}

/**
 * Client twin of the server guards, in the server's order, so the form shows
 * the same reason the RPC would. Access, master, and race checks are server-only.
 */
export function validateAddLineInput(input: AddLineInput): AddLineValidation {
  if (!input.materialId) return fail('ADD_LINE_MATERIAL');
  if (input.isAsset) return fail('ADD_LINE_ASSET');
  if (input.tier === 1) return fail('ADD_LINE_TIER1');
  if (!input.unit || input.unit.trim() === '') return fail('ADD_LINE_UNIT');
  if (input.plannedQty == null || !Number.isFinite(input.plannedQty) || input.plannedQty <= 0) {
    return fail('ADD_LINE_QTY');
  }
  if (input.tier === 3 && input.unitPrice == null) return fail('ADD_LINE_PRICE_REQUIRED');
  if (input.unitPrice != null && (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0)) {
    return fail('ADD_LINE_PRICE');
  }
  return { ok: true };
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

/**
 * Prefix → copy. A unique-index violation is the concurrent-add case and reads
 * as ADD_LINE_EXISTS. Anything unrecognized is returned verbatim — never swallowed.
 */
export function mapAddLineError(err: unknown): string {
  const raw = messageOf(err);
  if (raw.includes(PROJECT_LEVEL_LINE_INDEX)) return ADD_LINE_MESSAGES.ADD_LINE_EXISTS;
  for (const code of ERROR_CODES) {
    if (raw.includes(`${code}:`)) return ADD_LINE_MESSAGES[code];
  }
  return raw;
}

export interface AddProjectMaterialLineResult {
  line_id: string;
  revision_id: string;
  master_id: string;
  material_name: string;
  unit: string;
  tier: number;
  planned_after: number;
  price_book_written: 'inserted' | 'updated' | 'skipped';
  snapshot_written: boolean;
}

export interface AddProjectMaterialLineParams {
  projectId: string;
  materialId: string;
  plannedQty: number;
  unitPrice: number | null;
  note: string | null;
}

/** The slice of supabase-js this module needs; tests pass a stub. */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function addProjectMaterialLine(
  client: RpcClient,
  params: AddProjectMaterialLineParams,
): Promise<AddProjectMaterialLineResult> {
  const { data, error } = await client.rpc('add_project_material_line', {
    p_project_id: params.projectId,
    p_material_id: params.materialId,
    p_planned_qty: params.plannedQty,
    p_unit_price: params.unitPrice ?? null,
    p_note: params.note ?? null,
  });
  if (error) throw error;
  return data as AddProjectMaterialLineResult;
}

export interface IncrementalAddMissing {
  material_id: string;
  material_name: string;
}

/**
 * From plan_revisions rows (any shape), pick the INCREMENTAL_ADD ones whose
 * material is absent from the staged workbook's resolved material ids.
 * Deduplicated by material id, in first-seen order. Non-incremental or
 * malformed summaries are ignored.
 */
export function findIncrementalAddsMissingFromStaging(
  revisions: ReadonlyArray<{ summary: unknown }>,
  stagedMaterialIds: Iterable<string>,
): IncrementalAddMissing[] {
  const staged = new Set(stagedMaterialIds);
  const seen = new Set<string>();
  const missing: IncrementalAddMissing[] = [];
  for (const rev of revisions) {
    const s = rev.summary as { kind?: unknown; material_id?: unknown; material_name?: unknown } | null;
    if (!s || s.kind !== 'INCREMENTAL_ADD') continue;
    const id = typeof s.material_id === 'string' ? s.material_id : null;
    if (!id || staged.has(id) || seen.has(id)) continue;
    seen.add(id);
    missing.push({
      material_id: id,
      material_name: typeof s.material_name === 'string' && s.material_name ? s.material_name : id,
    });
  }
  return missing;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/addProjectMaterialLine.test.ts --testPathIgnorePatterns='/node_modules/' 2>&1 | tail -15`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/addProjectMaterialLine.ts tools/__tests__/addProjectMaterialLine.test.ts
git -c user.name="Test User" -c user.email="test@example.com" commit -m "feat(plan): client module for Tambah material proyek

Client twin of the 095 guards, prefix→Indonesian error mapping (incl. the
unique-index violation), injected-client RPC wrapper, and the pure
detector for incrementally-added materials missing from a staged file.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: BaselineScreen card, inline form, and Panduan fix

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` (imports ~:14-62; state after ~:340; helpers before `loadSessions` ~:345; markup in the `sessions` view after the Panduan card ~:1680-1692; PUBLISHED hint ~:1786; styles ~:2084+)

There is no screen-test infrastructure in this repo (documented norm), so this task is verified by `tsc --noEmit`, the existing jest suite, and the manual checklist in Step 7.

- [ ] **Step 1: Add the imports**

After the line `import { supabase } from '../../tools/supabase';` add:

```ts
import {
  addProjectMaterialLine,
  mapAddLineError,
  validateAddLineInput,
  type AddProjectMaterialLineResult,
} from '../../tools/addProjectMaterialLine';
```

- [ ] **Step 2: Add the type and state**

Directly above `type ScreenView = 'sessions' | 'review' | 'anomalies' | 'detail';` add:

```ts
/** Catalogue row as picked in the "Tambah material proyek" form. */
type CatalogPickRow = {
  id: string;
  code: string;
  name: string;
  tier: number;
  unit: string;
  is_asset: boolean;
  aliases: string[];
};
```

After the line `const [currentStoragePath, setCurrentStoragePath] = useState<string | null>(null);` add:

```ts
  // Tambah material proyek (spec 2026-09-02-add-project-material-line-design.md §6).
  // The card renders only when a current master exists. fetchCurrentMaster is a
  // publish-time diff helper without an id, so the card keeps its own state.
  const [currentMasterId, setCurrentMasterId] = useState<string | null>(null);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addLineCatalog, setAddLineCatalog] = useState<CatalogPickRow[]>([]);
  const [addLineCatalogLoading, setAddLineCatalogLoading] = useState(false);
  const [addLineSearch, setAddLineSearch] = useState('');
  const [addLineMaterial, setAddLineMaterial] = useState<CatalogPickRow | null>(null);
  const [addLineQty, setAddLineQty] = useState('');
  const [addLinePrice, setAddLinePrice] = useState('');
  const [addLineNote, setAddLineNote] = useState('');
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineDone, setAddLineDone] = useState<AddProjectMaterialLineResult | null>(null);
```

- [ ] **Step 3: Add the helpers**

Directly above `const loadSessions = useCallback(async () => {` add:

```ts
  const loadCurrentMasterId = useCallback(async () => {
    if (!project) { setCurrentMasterId(null); return; }
    const { data } = await supabase
      .from('project_material_master')
      .select('id')
      .eq('project_id', project.id)
      // Same tiebreak as the envelope views (created_at DESC, id DESC).
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    setCurrentMasterId(data?.id ?? null);
  }, [project?.id]);

  // Re-read after every publish so the card appears on a fresh first publish.
  useEffect(() => { loadCurrentMasterId(); }, [loadCurrentMasterId, publishedJustNow]);

  const openAddLine = async () => {
    setAddLineOpen(true);
    setAddLineDone(null);
    if (addLineCatalog.length > 0 || addLineCatalogLoading) return;
    setAddLineCatalogLoading(true);
    try {
      const [{ data: mats, error: matErr }, { data: aliases, error: aliasErr }] = await Promise.all([
        supabase.from('material_catalog').select('id, code, name, tier, unit, is_asset').eq('is_asset', false).order('name'),
        supabase.from('material_aliases').select('material_id, alias'),
      ]);
      if (matErr) throw matErr;
      if (aliasErr) throw aliasErr;
      const aliasMap = new Map<string, string[]>();
      for (const a of aliases ?? []) {
        const list = aliasMap.get(a.material_id) ?? [];
        list.push(a.alias);
        aliasMap.set(a.material_id, list);
      }
      setAddLineCatalog((mats ?? []).map(m => ({
        id: m.id,
        code: m.code ?? '',
        name: m.name ?? '',
        tier: Number(m.tier) || 0,
        unit: m.unit ?? '',
        is_asset: !!m.is_asset,
        aliases: aliasMap.get(m.id) ?? [],
      })));
    } catch (err: any) {
      toast(`Gagal memuat katalog: ${err?.message ?? String(err)}`, 'critical');
    } finally {
      setAddLineCatalogLoading(false);
    }
  };

  const addLineMatches = useMemo(() => {
    const q = addLineSearch.trim().toLowerCase();
    if (q.length < 2) return [] as CatalogPickRow[];
    return addLineCatalog
      .filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        m.aliases.some(a => a.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [addLineCatalog, addLineSearch]);

  const parseDecimal = (raw: string): number | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = parseFloat(t.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const handleAddLine = async () => {
    if (!project || !addLineMaterial || addLineSaving) return;
    const qty = parseDecimal(addLineQty);
    const price = parseDecimal(addLinePrice);
    const check = validateAddLineInput({
      materialId: addLineMaterial.id,
      tier: addLineMaterial.tier,
      isAsset: addLineMaterial.is_asset,
      unit: addLineMaterial.unit,
      plannedQty: qty,
      unitPrice: price,
    });
    if (!check.ok) { toast(check.message, 'critical'); return; }
    setAddLineSaving(true);
    try {
      const result = await addProjectMaterialLine(supabase, {
        projectId: project.id,
        materialId: addLineMaterial.id,
        plannedQty: qty as number,
        unitPrice: price,
        note: addLineNote.trim() || null,
      });
      setAddLineDone(result);
      setAddLineMaterial(null);
      setAddLineSearch('');
      setAddLineQty('');
      setAddLinePrice('');
      setAddLineNote('');
      toast('Material ditambahkan ke rencana. Supervisor diberi tahu.', 'ok');
    } catch (err) {
      toast(mapAddLineError(err), 'critical');
    } finally {
      setAddLineSaving(false);
    }
  };
```

- [ ] **Step 4: Replace the Panduan card and add the new card**

Replace the existing Panduan card:

```tsx
            <Card borderColor={COLORS.border}>
              <Text style={styles.previewTitle}>Panduan Penggunaan</Text>
              <Text style={styles.hint}>
                Upload baseline dipakai untuk RAB awal atau revisi penuh sebelum baseline live dipakai operasional.
              </Text>
              <Text style={styles.hint}>
                Jika ada tambahan scope setelah baseline sudah berjalan, lebih aman masuk lewat Catatan Perubahan agar audit trail perubahan tetap jelas.
              </Text>
            </Card>
```

with:

```tsx
            <Card borderColor={COLORS.border}>
              <Text style={styles.previewTitle}>Panduan Penggunaan</Text>
              <Text style={styles.hint}>
                Upload baseline dipakai untuk RAB awal atau revisi penuh dari file master SANO Input proyek.
              </Text>
              <Text style={styles.hint}>
                Satu material baru Tier 2/3/4 setelah baseline berjalan: pakai kartu Tambah material proyek di bawah, lalu tambahkan baris yang sama ke file master. Perubahan jumlah, penghapusan, material Tier 1, atau mutu beton: re-publish dari file master.
              </Text>
            </Card>

            {currentMasterId && (
              <Card borderColor={COLORS.info}>
                <Text style={styles.previewTitle}>Tambah material proyek</Text>
                <Text style={styles.hint}>
                  Untuk satu material baru Tier 2/3/4 tanpa area kerja. Perubahan jumlah, penghapusan, atau material Tier 1 tetap lewat re-publish file SANO Input.
                </Text>

                {!addLineOpen && (
                  <TouchableOpacity style={styles.ghostBtn} onPress={openAddLine}>
                    <Text style={styles.ghostBtnText}>Tambah material</Text>
                  </TouchableOpacity>
                )}

                {addLineOpen && (
                  <View style={{ marginTop: SPACE.sm }}>
                    <Text style={styles.addLineLabel}>Cari material (nama, kode, atau alias)</Text>
                    <TextInput
                      style={styles.addLineInput}
                      value={addLineSearch}
                      onChangeText={t => { setAddLineSearch(t); setAddLineMaterial(null); }}
                      placeholder={addLineCatalogLoading ? 'Memuat katalog...' : 'mis. cat tembok, PIP-PVC, knee'}
                      placeholderTextColor={COLORS.textMuted}
                      editable={!addLineCatalogLoading}
                      autoCapitalize="none"
                    />
                    {!addLineMaterial && addLineMatches.map(m => {
                      const tier1 = m.tier === 1;
                      return (
                        <TouchableOpacity
                          key={m.id}
                          style={[styles.addLineOption, tier1 && styles.disabledBtn]}
                          disabled={tier1}
                          onPress={() => { setAddLineMaterial(m); setAddLineSearch(m.name); }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.addLineOptionName}>{m.name}</Text>
                            <Text style={styles.hint}>
                              {m.code} · satuan {m.unit}{tier1 ? ' · lewat file SANO Input' : ''}
                            </Text>
                          </View>
                          <Badge flag={tier1 ? 'WARNING' : 'INFO'} label={`Tier ${m.tier}`} />
                        </TouchableOpacity>
                      );
                    })}
                    {!addLineMaterial && addLineSearch.trim().length >= 2 && addLineMatches.length === 0 && !addLineCatalogLoading && (
                      <Text style={styles.hint}>Tidak ada material yang cocok. Buat dulu di Office → Materials, atau tambah alias di Laporan → Katalog.</Text>
                    )}

                    {addLineMaterial && (
                      <>
                        <View style={styles.addLineChosen}>
                          <Text style={styles.addLineOptionName}>{addLineMaterial.name}</Text>
                          <Badge flag="INFO" label={`Tier ${addLineMaterial.tier}`} />
                        </View>
                        <Text style={styles.addLineLabel}>Jumlah rencana ({addLineMaterial.unit}, satuan dasar katalog)</Text>
                        <TextInput
                          style={styles.addLineInput}
                          value={addLineQty}
                          onChangeText={setAddLineQty}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={COLORS.textMuted}
                        />
                        <Text style={styles.addLineLabel}>
                          Harga satuan (Rp){addLineMaterial.tier === 3 ? ' — wajib untuk Tier 3' : ' — opsional'}
                        </Text>
                        <TextInput
                          style={styles.addLineInput}
                          value={addLinePrice}
                          onChangeText={setAddLinePrice}
                          keyboardType="number-pad"
                          placeholder="0"
                          placeholderTextColor={COLORS.textMuted}
                        />
                        <Text style={styles.addLineLabel}>Catatan (opsional)</Text>
                        <TextInput
                          style={styles.addLineInput}
                          value={addLineNote}
                          onChangeText={setAddLineNote}
                          placeholder="mis. tambahan lantai 2"
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </>
                    )}

                    <View style={styles.revisionBtnRow}>
                      <TouchableOpacity
                        style={styles.ghostBtn}
                        onPress={() => { setAddLineOpen(false); setAddLineMaterial(null); setAddLineSearch(''); }}
                        disabled={addLineSaving}
                      >
                        <Text style={styles.ghostBtnText}>Batal</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primaryBtn, { flex: 1, marginTop: SPACE.sm + 2 }, (!addLineMaterial || addLineSaving) && styles.disabledBtn]}
                        onPress={handleAddLine}
                        disabled={!addLineMaterial || addLineSaving}
                      >
                        <Text style={styles.primaryBtnText}>{addLineSaving ? 'Menyimpan...' : 'Simpan ke rencana'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {addLineDone && (
                  <View style={styles.addLineDoneBox}>
                    <Text style={styles.msLabel}>
                      {addLineDone.material_name} — {addLineDone.planned_after} {addLineDone.unit} (Tier {addLineDone.tier}) masuk rencana.
                    </Text>
                    <Text style={[styles.hint, { color: COLORS.text }]}>
                      Tambahkan juga baris ini ke file master SANO Input proyek. Re-publish hanya membaca file.
                    </Text>
                    {!addLineDone.snapshot_written && (
                      <Text style={styles.hint}>
                        Baseline awal material ini sudah pernah dicatat; angka drift mengikuti baseline lama.
                      </Text>
                    )}
                  </View>
                )}
              </Card>
            )}
```

- [ ] **Step 5: Fix the PUBLISHED session hint**

Replace:

```tsx
                    Sudah menjadi baseline live. Tambahan scope sesudah ini sebaiknya masuk lewat Catatan Perubahan, bukan menghapus baseline ini.
```

with:

```tsx
                    Sudah menjadi baseline live. Material baru: kartu Tambah material proyek. Perubahan lain: re-publish dari file master, bukan menghapus baseline ini.
```

- [ ] **Step 6: Add the styles**

Inside the `StyleSheet.create({ ... })` block, directly after the line `hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: SPACE.xs },` add:

```ts
  addLineLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.sm },
  addLineInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingHorizontal: 10, paddingVertical: 8, marginTop: SPACE.xs, fontSize: TYPE.sm, color: COLORS.text, minHeight: 40 },
  addLineOption: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 10, marginTop: SPACE.xs },
  addLineOptionName: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  addLineChosen: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, marginTop: SPACE.sm },
  addLineDoneBox: { marginTop: SPACE.sm, padding: 10, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.ok },
```

- [ ] **Step 7: Type-check and run the suite**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no output (clean). If a pre-existing error unrelated to this task appears, note it in the commit body and do not fix it here.

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='__tests__/fixtures\\.ts$' --testPathIgnorePatterns='__tests__/_serverGateHarness\\.ts$' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/' 2>&1 | tail -6`
Expected: all suites pass.

Manual checklist (after 095 is pasted and the app runs): the card appears only for a project with a published master; typing two letters of an alias finds the item; a Tier 1 row is disabled with the reason; Tier 3 without a price is refused with the Indonesian copy before any network call; success shows the "tambahkan ke file master" notice; the same material a second time is refused with the EXISTS copy.

- [ ] **Step 8: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git -c user.name="Test User" -c user.email="test@example.com" commit -m "feat(baseline): Tambah material proyek card + inline form; Panduan no longer points at Catatan Perubahan

Estimator adds one Tier 2/3/4 project-level material to the current master
via add_project_material_line (095) without a re-publish. Catalogue search
covers aliases; Tier 1 rows are disabled with the reason; client-side guard
copy matches the server prefixes. Success notice tells the estimator to
append the row to the master file.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Publish-time guard for incrementally added materials

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` (`fetchCurrentMaster` ~:781-806; `handlePublish` ~:922-935; import line from Task 3)

- [ ] **Step 1: Extend the import**

Change the Task 3 import to also bring in the detector:

```ts
import {
  addProjectMaterialLine,
  findIncrementalAddsMissingFromStaging,
  mapAddLineError,
  validateAddLineInput,
  type AddProjectMaterialLineResult,
  type IncrementalAddMissing,
} from '../../tools/addProjectMaterialLine';
```

- [ ] **Step 2: Make `fetchCurrentMaster` return the master's version id**

Change its signature and body:

```ts
  const fetchCurrentMaster = async (
    projectId: string,
  ): Promise<{ isRepublish: boolean; ahsVersionId: string | null; lines: Array<{ material_id: string; planned_quantity: number }> }> => {
    const { data: master } = await supabase
      .from('project_material_master')
      .select('id, ahs_version_id')
      .eq('project_id', projectId)
      // id DESC is the tiebreak (054 convention): a re-publish batch can create
      // more than one master within the same wall-clock second, so created_at
      // alone is not a deterministic "latest". Match the view's ordering exactly
      // (v_material_envelopes: ORDER BY created_at DESC, id DESC) so the client
      // diffs against the SAME master the envelope view scopes to.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!master) return { isRepublish: false, ahsVersionId: null, lines: [] };
    const { data: lines } = await supabase
      .from('project_material_master_lines')
      .select('material_id, planned_quantity')
      .eq('master_id', master.id);
    const rows = (lines ?? [])
      .filter((l): l is { material_id: string; planned_quantity: number } => !!l.material_id)
      .map(l => ({ material_id: l.material_id as string, planned_quantity: Number(l.planned_quantity) || 0 }));
    return { isRepublish: true, ahsVersionId: (master.ahs_version_id as string) ?? null, lines: rows };
  };
```

- [ ] **Step 3: Add the guard helpers**

Directly below `fetchCurrentMaster` add:

```ts
  // Materials added via "Tambah material proyek" exist only in the DB; publish
  // rebuilds the plan from the file. Before a re-publish, list the ones the
  // staged file omits so the estimator can stop and append them to the file.
  // Scoped to revisions recorded within the CURRENT version — an add that was
  // later carried into the file belongs to an older version and is not flagged.
  const fetchIncrementalAddsMissing = async (
    projectId: string,
    ahsVersionId: string | null,
    stagedMaterialIds: Iterable<string>,
  ): Promise<IncrementalAddMissing[] | null> => {
    let query = supabase
      .from('plan_revisions')
      .select('summary')
      .eq('project_id', projectId)
      .filter('summary->>kind', 'eq', 'INCREMENTAL_ADD');
    if (ahsVersionId) query = query.eq('new_ahs_version_id', ahsVersionId);
    const { data, error } = await query;
    if (error) {
      console.warn('fetchIncrementalAddsMissing failed:', error.message);
      return null;
    }
    return findIncrementalAddsMissingFromStaging((data ?? []) as Array<{ summary: unknown }>, stagedMaterialIds);
  };

  const confirmDropIncremental = (missing: IncrementalAddMissing[]): Promise<boolean> => {
    const list = missing.map(m => `• ${m.material_name}`).join('\n');
    const message =
      `Material berikut ditambahkan lewat Tambah material proyek tetapi tidak ada di file yang diunggah:\n\n${list}\n\n` +
      'Lanjut publish berarti material ini dihapus dari rencana.';
    if (Platform.OS === 'web') {
      return Promise.resolve(typeof window !== 'undefined' && window.confirm(message));
    }
    return new Promise(resolve => {
      Alert.alert(
        'Material tambahan tidak ada di file',
        message,
        [
          { text: 'Batal', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Lanjut, hapus dari rencana', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  };
```

- [ ] **Step 4: Wire the guard into `handlePublish`**

In `handlePublish`, directly after the block

```ts
      if (preview.error) {
        toast(`Gagal menghitung perubahan rencana: ${preview.error}`, 'critical');
        return;
      }
```

insert:

```ts
      // Guard: incrementally added materials absent from the staged file.
      const missingIncremental = await fetchIncrementalAddsMissing(project.id, current.ahsVersionId, preview.totals.keys());
      if (missingIncremental === null) {
        toast('Tidak bisa memeriksa material yang ditambahkan lewat Tambah material proyek. Periksa file master secara manual.', 'warning');
      } else if (missingIncremental.length > 0) {
        const proceed = await confirmDropIncremental(missingIncremental);
        if (!proceed) return;
      }
```

- [ ] **Step 5: Type-check and run the suite**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='__tests__/fixtures\\.ts$' --testPathIgnorePatterns='__tests__/_serverGateHarness\\.ts$' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/' 2>&1 | tail -6`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git -c user.name="Test User" -c user.email="test@example.com" commit -m "feat(baseline): warn before a re-publish drops incrementally added materials

Publish rebuilds the plan from the file, so a material added via Tambah
material proyek and not appended to the master file would vanish. Before
computing the diff, list INCREMENTAL_ADD revisions of the current version
whose material is absent from the staged rows and require an explicit
confirm. A failed lookup warns and proceeds rather than blocking publish.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

**Files:** none new.

- [ ] **Step 1: Full suite and type-check from the worktree root**

```bash
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='__tests__/fixtures\\.ts$' --testPathIgnorePatterns='__tests__/_serverGateHarness\\.ts$' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/' 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: all suites pass; tsc clean.

- [ ] **Step 2: Confirm the branch contents**

```bash
git log --oneline origin/main..HEAD
git status --short
```

Expected: five commits (docs, 095, client module, card, guard); clean tree.

- [ ] **Step 3: Report**

Report the commit list, test counts, and the deploy order: paste 095 in the Dashboard first, then merge/deploy the app. Do not push or open a PR in this task; that is the finishing step handled by the controller.

---

## Self-review

- **Spec coverage.** §4.1 index → Task 1. §4.2 guards and prefixes → Task 1 SQL + Task 2 messages. §4.3 concurrency → Task 1 (lock, index, race re-read). §4.4 writes 1–6 → Task 1. §4.5 non-durability → Task 1 header, Task 3 success notice, Task 4 guard. §5 client module (four functions) → Task 2. §6.1–6.2 card/form → Task 3. §6.3 guard → Task 4. §6.4 Panduan → Task 3 Steps 4–5. §8 tests → Tasks 1, 2. §9 deploy order → Task 5 report.
- **Placeholders.** None; every code step is complete.
- **Type consistency.** `AddProjectMaterialLineResult`, `IncrementalAddMissing`, `validateAddLineInput`, `mapAddLineError`, `addProjectMaterialLine`, `findIncrementalAddsMissingFromStaging` are defined in Task 2 and used with the same names in Tasks 3–4. `fetchCurrentMaster` gains `ahsVersionId` in Task 4 and its only caller is updated there. RPC parameter names `p_project_id, p_material_id, p_planned_qty, p_unit_price, p_note` match between Task 1 SQL and Task 2 wrapper/tests.
