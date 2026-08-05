/**
 * Static guard for migration 086 (get_workgroup_material_envelopes).
 *
 * Does NOT touch a database — it asserts the frozen contract the client wrapper
 * (tools/envelopes.ts getWorkGroupMaterialEnvelopes) and the BoQ-first screens
 * depend on: the signature, the four OUT columns, SECURITY INVOKER + the
 * project-access guard, the latest-master scoping rule, the non-rejected /
 * non-cancelled burn predicates, the GRANT, and the documented verification
 * query. If someone edits 086 and drops one of these, the TS wiring would
 * silently diverge — this fails first.
 */
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/086_workgroup_material_envelopes.sql'),
  'utf8',
);

describe('migration 086 — frozen contract surface', () => {
  it('is re-paste-safe (drops the function before creating it)', () => {
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS get_workgroup_material_envelopes\(UUID, UUID\[\]\)/);
  });

  it('declares the exact signature and OUT columns', () => {
    expect(SQL).toMatch(/CREATE FUNCTION get_workgroup_material_envelopes\(\s*\n\s*p_project_id UUID,\s*\n\s*p_boq_item_ids UUID\[\]/);
    expect(SQL).toMatch(/RETURNS TABLE \(\s*\n\s*material_id UUID,\s*\n\s*planned NUMERIC,\s*\n\s*ordered NUMERIC,\s*\n\s*requested NUMERIC\s*\n\s*\)/);
  });

  it('is read-only and RLS-composed, with the project-access guard', () => {
    expect(SQL).toMatch(/\bSTABLE\b/);
    expect(SQL).toMatch(/\bSECURITY INVOKER\b/);
    expect(SQL).toMatch(/PERFORM assert_project_access\(p_project_id\)/);
    expect(SQL).not.toMatch(/\bSECURITY DEFINER\b/);
  });

  it('scopes planned to the latest project_material_master, deterministically', () => {
    expect(SQL).toMatch(/FROM project_material_master\s*\n\s*WHERE project_id = p_project_id\s*\n\s*ORDER BY created_at DESC, id DESC\s*\n\s*LIMIT 1/);
  });

  it('burns on non-rejected requests and treats only live POs as fulfilled', () => {
    expect(SQL).toMatch(/h\.overall_status NOT IN \('REJECTED'\)/);
    expect(SQL).toMatch(/po\.status <> 'CANCELLED'/);
    expect(SQL).toMatch(/pol\.request_line_id = l\.id/);
  });

  it('grants execute to authenticated', () => {
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION get_workgroup_material_envelopes\(UUID, UUID\[\]\)\s*\n?\s*TO authenticated/);
  });

  it('documents the get_workgroup_envelope consistency check', () => {
    expect(SQL).toMatch(/VERIFICATION/);
    expect(SQL).toMatch(/get_workgroup_envelope/);
    expect(SQL).toMatch(/many\.ordered \+ many\.requested/);
  });
});
