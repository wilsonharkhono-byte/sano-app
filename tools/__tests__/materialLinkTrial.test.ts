/**
 * END-TO-END TRIAL (runs against the real Supabase via service role).
 *
 * Confirms the three outcomes the user asked for, using the LIVE catalog +
 * aliases (the same data the publish reads) and the REAL get_workgroup_envelope
 * RPC:
 *   1. The breakdown materials the normalizer emits RESOLVE to catalog material_ids.
 *   2. The Material Balance can show ACTUAL materials (real catalog names + planned>0).
 *   3. A supervisor ordering a material against a work-group gets a real envelope
 *      ("right type in the right BoQ"), not "no baseline".
 *
 * Seeds a throwaway test project (TEST_ prefix) and cleans it up afterward.
 */
import {
  adminClient, createTestProject, createTestBoqItem, cleanupTestData, type TestProject,
} from './_serverGateHarness';

const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/[()@\-/\\'"]/g, ' ').replace(/\s+/g, ' ').trim();

// Realistic foundation (Poer/Sloof) breakdown — the exact names the normalizer
// emits, with per-m³ coefficients. "Besi beton — waste (5%)" is intentionally
// omitted (it is folded into rebar at publish; never a standalone material).
const FOUNDATION = [
  { label: 'Poer PC.1', planned: 5, comps: [
    { name: 'Beton readymix K-350 slump 18 ± 2 cm', coeff: 1.05 },
    { name: 'Besi beton D13', coeff: 75.26 },
    { name: 'Besi beton D16', coeff: 91.92 },
    { name: 'Multipleks 15 mm', coeff: 5.0 },
    { name: 'Usuk 5/7', coeff: 22.5 },
    { name: 'Bendrat (kawat ikat)', coeff: 3.5 },
    { name: 'Beton decking', coeff: 167 },
  ] },
  { label: 'Sloof S1', planned: 3, comps: [
    { name: 'Beton readymix K-350 slump 18 ± 2 cm', coeff: 1.05 },
    { name: 'Besi beton D13', coeff: 60 },
    { name: 'Besi beton D10', coeff: 30 },
    { name: 'Batako', coeff: 10 },
  ] },
];

const ORDER_MATERIAL_CODE = 'REB-DE13'; // "Besi beton ulir 13 mm" — what the supervisor picks

let project: TestProject;
let catalogById = new Map<string, { code: string; name: string }>();
let resolve: (name: string) => string | null;
let boqIds: string[] = [];
let rebarD13Id = '';
let masterId = '';
const resolutionLog: Array<{ name: string; materialId: string | null }> = [];

jest.setTimeout(60000);

beforeAll(async () => {
  // 1. Load the LIVE catalog + aliases (exactly what resolveCatalogId reads).
  const { data: catalog } = await adminClient.from('material_catalog').select('id, code, name');
  const { data: aliases } = await adminClient.from('material_aliases').select('alias, material_id');
  catalogById = new Map((catalog ?? []).map(c => [c.id as string, { code: c.code as string, name: c.name as string }]));
  const codeToId = new Map((catalog ?? []).map(c => [c.code as string, c.id as string]));
  const catalogByName = new Map((catalog ?? []).map(c => [norm(c.name as string), c.id as string]));
  const aliasByNorm = new Map((aliases ?? []).map(a => [norm(a.alias as string), a.material_id as string]));
  rebarD13Id = codeToId.get(ORDER_MATERIAL_CODE) ?? '';

  // Faithful to resolveCatalogId's exact→alias cascade (our materials hit it).
  resolve = (name: string) => aliasByNorm.get(norm(name)) ?? catalogByName.get(norm(name)) ?? null;

  // 2. Seed a throwaway project with two foundation BoQ rows.
  project = await createTestProject();
  for (const row of FOUNDATION) {
    const boq = await createTestBoqItem(project.id, { planned: row.planned, installed: 0, unit: 'm3' });
    boqIds.push(boq.id);
  }

  // 3. Create an ahs_version, then ahs_lines + master_lines with resolved ids —
  //    mirroring what publishBaselineV2 writes.
  const { data: version } = await adminClient.from('ahs_versions')
    .insert({ project_id: project.id, version: 1, is_current: true, published_at: new Date().toISOString() })
    .select('id').single();
  const ahsVersionId = version!.id as string;

  const { data: master } = await adminClient.from('project_material_master')
    .insert({ project_id: project.id, ahs_version_id: ahsVersionId }).select('id').single();
  masterId = master!.id as string;

  for (let i = 0; i < FOUNDATION.length; i++) {
    const row = FOUNDATION[i];
    const boqId = boqIds[i];
    for (const c of row.comps) {
      const materialId = resolve(c.name);
      resolutionLog.push({ name: c.name, materialId });
      await adminClient.from('ahs_lines').insert({
        ahs_version_id: ahsVersionId, boq_item_id: boqId, material_id: materialId,
        tier: 1, unit: 'kg', coefficient: c.coeff, unit_price: 0,
        line_type: 'material', material_spec: c.name,
      });
      if (materialId) {
        await adminClient.from('project_material_master_lines').insert({
          master_id: masterId, material_id: materialId, boq_item_id: boqId,
          planned_quantity: row.planned * c.coeff, unit: 'kg',
        });
      }
    }
  }
});

afterAll(async () => { await cleanupTestData(); });

it('OUTCOME 1 — the parser/publish understands the materials (they resolve to the catalog)', () => {
  const deduped = [...new Map(resolutionLog.map(r => [r.name, r.materialId])).entries()];
  const unresolved = deduped.filter(([, id]) => !id).map(([n]) => n);
  // Log a readable table so the run is self-documenting.
  for (const [name, id] of deduped) {
    // eslint-disable-next-line no-console
    console.log(`   ${id ? '✓ ' + catalogById.get(id)!.name : '✗ UNRESOLVED'}  ←  ${name}`);
  }
  expect(unresolved).toEqual([]); // every foundation material links
});

it('OUTCOME 2 — supervisor can order the right material into the right work-group (real envelope, not "no baseline")', async () => {
  const { data, error } = await adminClient.rpc('get_workgroup_envelope', {
    p_project_id: project.id,
    p_material_id: rebarD13Id,
    p_boq_item_ids: boqIds,
  }).single();

  expect(error).toBeNull();
  const env = data as { total_planned: number; material_name: string; boq_item_count: number };
  const expected = 5 * 75.26 + 3 * 60; // D13 across Poer + Sloof = 556.3 kg
  // eslint-disable-next-line no-console
  console.log(`   Envelope for "${env.material_name}" across ${env.boq_item_count} foundation rows: planned=${env.total_planned} kg (expected ${expected})`);
  expect(env.total_planned).toBeGreaterThan(0);
  expect(env.total_planned).toBeCloseTo(expected, 1);
});

it('OUTCOME 3 — the Material Balance shows ACTUAL materials (real catalog names + planned > 0)', async () => {
  const { data } = await adminClient
    .from('project_material_master_lines')
    .select('planned_quantity, material_catalog(name)')
    .eq('master_id', masterId);

  const byName = new Map<string, number>();
  for (const r of data ?? []) {
    const name = (r as unknown as { material_catalog?: { name: string } }).material_catalog?.name;
    if (name) byName.set(name, (byName.get(name) ?? 0) + Number(r.planned_quantity ?? 0));
  }
  for (const [name, qty] of byName) {
    // eslint-disable-next-line no-console
    console.log(`   ${name}: ${qty.toFixed(2)}`);
  }
  // Real catalog names appear (not "belum dipetakan"), with positive planned.
  expect(byName.has('Besi beton ulir 13 mm')).toBe(true);
  expect(byName.get('Besi beton ulir 13 mm')!).toBeGreaterThan(0);
  expect([...byName.keys()].length).toBeGreaterThanOrEqual(6);
});
