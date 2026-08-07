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

  it('uses a FULL OUTER JOIN so an over-ordered material with no plan still surfaces', () => {
    // A LEFT JOIN here would silently drop any material_id present only in
    // allocation_rows (ordered/requested beyond, or outside, the current
    // plan) instead of returning it with planned = 0.
    expect(SQL).toMatch(/FULL OUTER JOIN allocation_rows x ON x\.mat_id = p\.mat_id/);
  });

  it('caps the live-PO probe at one row so a line split across POs is not double-counted', () => {
    // Losing this LIMIT 1 would let the LATERAL join fan out one allocation
    // row per matching purchase_order_lines row, so SUM(a.allocated_quantity)
    // would count that allocation once per matching PO line instead of once.
    expect(SQL).toMatch(
      /LEFT JOIN LATERAL \(\s*\n\s*SELECT pol\.request_line_id[\s\S]*?LIMIT 1\s*\n\s*\) po_link ON true/,
    );
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
