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

  it('summary carries every PlanRevisionSummary numeric key (added = 1) plus the incremental tags', () => {
    for (const key of [
      'raisedAbsolvingOverage', 'raised', 'loweredBelowOrdered', 'removedWithActivity',
      'lowered', 'noActivityChanged', 'warningCount',
    ]) {
      expect(body).toContain(`'${key}', 0`);
    }
    expect(body).toContain("'added', 1");
    for (const tag of ['material_id', 'material_name', 'unit', 'tier', 'planned_after', 'unit_price', 'note']) {
      expect(body).toContain(`'${tag}', `);
    }
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
