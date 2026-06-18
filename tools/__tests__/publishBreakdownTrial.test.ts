/**
 * Runs the ACTUAL publishBaselineV2 (service client injected) against the real
 * DB, seeded with normalized-breakdown staging rows, and asserts the published
 * material master is per-diameter and equals planned-volume × qty/unit — i.e.
 * matches the material take-off, not the generic Analisa coefficients.
 */
jest.mock('../supabase', () => {
  const { createClient } = require('@supabase/supabase-js');
  const fs = require('node:fs');
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { supabase: createClient(url, key, { auth: { persistSession: false } }) };
});

import { publishBaselineV2 } from '../publishBaselineV2';
import { adminClient, createTestProject, cleanupTestData, type TestProject } from './_serverGateHarness';

jest.setTimeout(60000);

const comp = (materialName: string, quantityPerUnit: number, lineType = 'material', unit = 'kg') =>
  ({ materialName, quantityPerUnit, unitPrice: 1000, lineType, unit, referencedBlockTitle: null });

// Two foundation rows with per-diameter breakdown (the normalizer's output shape).
const ROWS = [
  { code: 'TRIAL.POER.1', label: 'Poer PC.1', unit: 'm3', planned: 10, components: [
    comp('Beton readymix K-350 slump 18 ± 2 cm', 1.05, 'material', 'm3'),
    comp('Besi beton D13', 50), comp('Besi beton D16', 30),
    comp('Bendrat (kawat ikat)', 3), comp('Beton decking', 100),
    comp('Sewa vibrator', 1, 'equipment', 'm3'),
    // cost-split residue with no material name — publish must skip it, not crash
    { quantityPerUnit: 1, unitPrice: 1000, lineType: 'material', unit: 'm3', referencedBlockTitle: null },
  ] },
  { code: 'TRIAL.SLOOF.1', label: 'Sloof S1', unit: 'm3', planned: 4, components: [
    comp('Besi beton D13', 60), comp('Batako', 10, 'material', 'pcs'),
  ] },
];

let project: TestProject;
let boqIds: Record<string, string> = {};

beforeAll(async () => {
  project = await createTestProject();
  const { data: session } = await adminClient.from('import_sessions').insert({
    project_id: project.id, uploaded_by: project.ownerProfileId,
    original_file_path: 'test://trial', original_file_name: 'trial.xlsx', status: 'REVIEW',
  }).select('id').single();

  const staging = ROWS.map((r, i) => ({
    session_id: session!.id, row_number: i + 1, row_type: 'boq', review_status: 'APPROVED',
    parsed_data: { code: r.code, label: r.label, unit: r.unit, planned: r.planned, recipe: { components: r.components } },
  }));
  await adminClient.from('import_staging_rows').insert(staging);

  const result = await publishBaselineV2(session!.id, project.id);
  // eslint-disable-next-line no-console
  console.log('publish result:', JSON.stringify({ success: result.success, boqCount: result.boqCount, ahsCount: result.ahsCount, masterLineCount: result.masterLineCount, unresolved: result.unresolvedComponentCount }));
  expect(result.success).toBe(true);

  const { data: boqs } = await adminClient.from('boq_items').select('id, code').eq('project_id', project.id);
  for (const b of boqs ?? []) boqIds[b.code as string] = b.id as string;
});

afterAll(async () => { await cleanupTestData(); });

it('master_lines are per-diameter and equal volume × qty/unit (matches take-off math)', async () => {
  const { data: master } = await adminClient.from('project_material_master').select('id').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1).single();
  const { data: lines } = await adminClient
    .from('project_material_master_lines')
    .select('planned_quantity, material_catalog(name)')
    .eq('master_id', master!.id);
  const byName = new Map<string, number>();
  for (const r of lines ?? []) {
    const name = (r as unknown as { material_catalog?: { name: string } }).material_catalog?.name;
    if (name) byName.set(name, (byName.get(name) ?? 0) + Number(r.planned_quantity ?? 0));
  }
  for (const [n, q] of byName) console.log(`   ${n}: ${q}`); // eslint-disable-line no-console

  // D13 = 10×50 + 4×60 = 740 ; D16 = 10×30 = 300 ; readymix = 10×1.05 = 10.5 ; bendrat = 10×3 = 30 ; batako = 4×10 = 40
  expect(byName.get('Besi beton ulir 13 mm')).toBeCloseTo(740, 5);
  expect(byName.get('Besi beton ulir 16 mm')).toBeCloseTo(300, 5);
  expect(byName.get('Ready mix kelas 35')).toBeCloseTo(10.5, 5);
  expect(byName.get('Kawat bendrat')).toBeCloseTo(30, 5);
  expect(byName.get('Batako semen 10 cm')).toBeCloseTo(40, 5);
});

it('work-group envelope for Besi 13mm across both rows returns 740 (not "no baseline")', async () => {
  const { data: d13 } = await adminClient.from('material_catalog').select('id').eq('code', 'REB-DE13').single();
  const { data, error } = await adminClient.rpc('get_workgroup_envelope', {
    p_project_id: project.id, p_material_id: d13!.id, p_boq_item_ids: [boqIds['TRIAL.POER.1'], boqIds['TRIAL.SLOOF.1']],
  }).single();
  expect(error).toBeNull();
  expect((data as { total_planned: number }).total_planned).toBeCloseTo(740, 5);
});
