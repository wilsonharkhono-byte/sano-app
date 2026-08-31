/**
 * Unit tests for tools/derivation.ts — deriveMaterialBalance.
 *
 * CRITICAL: these tests must NOT hit any real database. We mock the supabase
 * module (`jest.mock('../supabase')`) and feed canned `{ data, error }` per
 * table, following the same idiom as queryHelpers.test.ts / opname.test.ts.
 * We deliberately do NOT import the _serverGateHarness (it connects to PROD).
 *
 * deriveMaterialBalance is entirely DB-coupled (its only non-exported helper,
 * normalizeMaterialKey, is private), so we exercise it end-to-end against small
 * fixtures and assert real derived numbers.
 */

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { deriveMaterialBalance } from '../derivation';
import { supabase } from '../supabase';
import { needsProcurement } from '../materialThresholds';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

/**
 * Build a chainable, awaitable query stub. Every builder method (select, eq,
 * order, limit, in) returns the same object; awaiting it (or any of its
 * returned chains) resolves to the supplied `{ data, error }`. This mirrors how
 * the real PostgREST builder is thenable while still chainable.
 */
function makeQuery(result: { data: unknown; error?: unknown }) {
  const payload = { data: result.data, error: result.error ?? null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'in', 'neq', 'gte', 'lte', 'range', 'is']) {
    chain[method] = jest.fn(() => chain);
  }
  // Make the chain awaitable.
  (chain as { then: unknown }).then = (resolve: (v: typeof payload) => unknown) =>
    Promise.resolve(payload).then(resolve);
  return chain;
}

/**
 * Wire up supabase.from / supabase.rpc from a table->result map. Each call to
 * .from(table) gets a fresh chain so call-order between tables does not matter.
 */
function wireSupabase(opts: {
  tables: Record<string, { data: unknown; error?: unknown }>;
  rpc?: Record<string, { data: unknown; error?: unknown }>;
}) {
  // deriveMaterialBalance now always probes the material master for project-level
  // (NULL-boq) Tier-2/3 lines. Default both to empty so structured-path tests that
  // don't care about them still pass; a test can override by naming them.
  const tables: Record<string, { data: unknown; error?: unknown }> = {
    project_material_master: { data: [] },
    project_material_master_lines: { data: [] },
    // deriveMaterialBalance always queries material_catalog for asset names
    // (is_asset exclusion), even when no bucket carries a material_id.
    material_catalog: { data: [] },
    // deriveMaterialBalance always queries the on-order leg (v_material_envelope_status).
    // Default empty — the same "no envelope row" fallback the report itself
    // uses (ordered/requested/on_order all default to 0) — so every existing
    // fixture that doesn't care about on-order still passes unchanged.
    v_material_envelope_status: { data: [] },
    ...opts.tables,
  };
  (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
    const result = tables[table];
    if (!result) {
      throw new Error(`Unexpected supabase.from('${table}') in test — add a fixture`);
    }
    return makeQuery(result);
  });

  (mockSupabase.rpc as jest.Mock).mockImplementation((fn: string) => {
    const result = opts.rpc?.[fn] ?? { data: [], error: null };
    return Promise.resolve({ data: result.data, error: result.error ?? null });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deriveMaterialBalance — structured (ahs_lines) baseline', () => {
  it('prefers coefficient over usage_rate (locks the planned=0 v2 bug)', async () => {
    wireSupabase({
      rpc: {
        // No installed progress for this row.
        derive_boq_installed: { data: [] },
      },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1',
              // v2 leaves usage_rate at 0 and writes coefficient. If the code
              // (wrongly) read usage_rate, planned would be 0.
              usage_rate: 0,
              coefficient: 2.5,
              waste_factor: 0,
              unit: 'kg',
              boq_item_id: 'boq-1',
              material_spec: 'Besi beton',
              line_type: 'material',
              material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: {
          data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    // planned = boqPlanned(10) * coefficient(2.5) * (1 + waste 0) = 25
    expect(balances[0]).toMatchObject({
      material_name: 'Besi D8',
      material_id: 'mat-1',
      planned: 25,
      installed: 0,
      unit: 'kg',
    });
  });

  it('adds project-level (NULL-boq) Tier-2/3 materials with their absolute planned', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: { data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }] },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [{
            material_id: 'mat-1', usage_rate: 0, coefficient: 2.5, waste_factor: 0, unit: 'kg',
            boq_item_id: 'boq-1', material_spec: 'Besi', line_type: 'material', material_catalog: { name: 'Besi D8' },
          }],
        },
        // A Tier-2 project-level material: NULL boq_item_id, absolute planned_quantity.
        project_material_master: { data: [{ id: 'master-1' }] },
        project_material_master_lines: { data: [{ material_id: 'mat-2', boq_item_id: null, planned_quantity: 500, unit: 'sak' }] },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }, { id: 'mat-2', name: 'Semen PC', unit: 'sak' }] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');
    const byId = Object.fromEntries(balances.map((b) => [b.material_id, b]));
    expect(byId['mat-1']).toMatchObject({ planned: 25 }); // boq-derived, unchanged
    expect(byId['mat-2']).toMatchObject({ planned: 500, installed: 0 }); // project-level, absolute qty
  });

  it('falls back to usage_rate when coefficient is absent/zero (v1 path)', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 4, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1',
              usage_rate: 3,
              coefficient: 0, // falsy → fall back to usage_rate
              waste_factor: 0.05,
              unit: 'kg',
              boq_item_id: 'boq-1',
              material_spec: 'Besi beton',
              line_type: 'material',
              material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    // planned = 4 * usage_rate(3) * (1 + waste 0.05) = 12.6
    expect(balances).toHaveLength(1);
    expect(balances[0].planned).toBe(12.6);
  });

  it('falls back to material_spec when catalog name is missing', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 2, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: null, // unlinked → no catalog row
              usage_rate: 0,
              coefficient: 1.05,
              waste_factor: 0,
              unit: 'm3',
              boq_item_id: 'boq-1',
              material_spec: 'Beton readymix K-350',
              line_type: 'material',
              material_catalog: null,
            },
          ],
        },
        // material_catalog is not queried because no material_id present.
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    // Real spec name, NOT the generic "Material belum dipetakan" bucket.
    expect(balances[0].material_name).toBe('Beton readymix K-350');
    expect(balances[0].material_id).toBeNull();
    // planned = 2 * 1.05 = 2.1
    expect(balances[0].planned).toBe(2.1);
  });

  it('filters to line_type = material via the .eq filter', async () => {
    const ahsChain = makeQuery({
      data: [
        {
          material_id: 'mat-1',
          usage_rate: 0,
          coefficient: 1,
          waste_factor: 0,
          unit: 'kg',
          boq_item_id: 'boq-1',
          material_spec: 'Besi beton',
          line_type: 'material',
          material_catalog: { name: 'Besi D8' },
        },
      ],
    });

    (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
      switch (table) {
        case 'boq_items':
          return makeQuery({
            data: [{ id: 'boq-1', planned: 1, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
          });
        case 'ahs_versions':
          return makeQuery({ data: [{ id: 'ahs-v1' }] });
        case 'purchase_orders':
          return makeQuery({ data: [] });
        case 'receipts':
          return makeQuery({ data: [] });
        case 'ahs_lines':
          return ahsChain;
        case 'material_catalog':
          return makeQuery({ data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] });
        case 'project_material_master':
        case 'project_material_master_lines':
          return makeQuery({ data: [] }); // no project-level (NULL-boq) lines in this fixture
        case 'v_material_envelope_status':
          return makeQuery({ data: [] }); // no on-order rows in this fixture
        default:
          throw new Error(`Unexpected from('${table}')`);
      }
    });
    (mockSupabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    await deriveMaterialBalance('proj-1');

    // The ahs_lines query must constrain line_type to 'material'.
    expect(ahsChain.eq).toHaveBeenCalledWith('line_type', 'material');
  });

  it('aggregates the same material across multiple BoQ rows', async () => {
    wireSupabase({
      rpc: {
        derive_boq_installed: {
          data: [{ boq_item_id: 'boq-1', total_installed: 5, entry_count: 1, last_entry_at: null }],
        },
      },
      tables: {
        boq_items: {
          data: [
            { id: 'boq-1', planned: 10, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null },
            { id: 'boq-2', planned: 20, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null },
          ],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 2, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 3, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-2', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    // planned = boq1(10*2) + boq2(20*3) = 20 + 60 = 80
    expect(balances[0].planned).toBe(80);
    // installed: derived 5 on boq-1 only → 5*2 = 10; boq-2 installed 0.
    expect(balances[0].installed).toBe(10);
  });
});

describe('deriveMaterialBalance — received & on_site', () => {
  it('sums receipt_lines by material name and computes on_site = received - installed', async () => {
    wireSupabase({
      rpc: {
        derive_boq_installed: {
          data: [{ boq_item_id: 'boq-1', total_installed: 2, entry_count: 1, last_entry_at: null }],
        },
      },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [{ id: 'po-1', material_name: 'Besi D8' }] },
        receipts: {
          data: [
            {
              id: 'r-1',
              po_id: 'po-1',
              receipt_lines: [
                { material_name: 'Besi D8', quantity_actual: 7 },
                { material_name: 'Besi D8', quantity_actual: 3 },
              ],
            },
          ],
        },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 1, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    const b = balances[0];
    expect(b.planned).toBe(10); // 10 * 1
    expect(b.installed).toBe(2); // derived 2 * coeff 1
    expect(b.received).toBe(10); // 7 + 3
    expect(b.on_site).toBe(8); // received 10 - installed 2
  });

  it('displays rebar in WHOLE batang, rounded up (÷ factor, ceil), not stored kg', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [{ id: 'po-1', material_name: 'Besi beton ulir 10 mm' }] },
        receipts: {
          data: [
            {
              id: 'r-1',
              po_id: 'po-1',
              receipt_lines: [{ material_id: 'mat-1', material_name: 'Besi beton ulir 10 mm', quantity_actual: 371 }],
            },
          ],
        },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 74.05, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton ulir 10 mm',
              line_type: 'material', material_catalog: { name: 'Besi beton ulir 10 mm' },
            },
          ],
        },
        material_catalog: {
          data: [{ id: 'mat-1', name: 'Besi beton ulir 10 mm', unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4 }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    const b = balances[0];
    // Stored in kg; report shows WHOLE batang (you can't stock a partial 12 m bar).
    expect(b.unit).toBe('batang');
    // planned 10 m3 × 74.05 kg/m3 = 740.5 kg ÷ 7.4 = 100.07 → ceil 101.
    expect(b.planned).toBe(101);
    // received 371 kg ÷ 7.4 = 50.14 → ceil 51; installed 0; on_site = 51.
    expect(b.received).toBe(51);
    expect(b.installed).toBe(0);
    expect(b.on_site).toBe(51);
  });

  it('excludes is_asset materials (equipment pool tracks them, not the balance)', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-scaf', usage_rate: 0, coefficient: 2, waste_factor: 0,
              unit: 'set', boq_item_id: 'boq-1', material_spec: 'Perancah Bekisting Balok',
              line_type: 'material', material_catalog: { name: 'Scaffolding set' },
            },
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 74, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi beton ulir 10 mm' },
            },
          ],
        },
        material_catalog: {
          data: [
            { id: 'mat-scaf', name: 'Scaffolding set', unit: 'set', supplier_unit: 'set', base_qty_per_supplier_unit: null, is_asset: true },
            { id: 'mat-1', name: 'Besi beton ulir 10 mm', unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4, is_asset: false },
          ],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    // The scaffolding (company asset) must NOT appear — it is not consumed.
    expect(balances.map((b) => b.material_id)).toEqual(['mat-1']);
  });

  it('excludes NAME-keyed asset buckets too (unlinked spec-name lines)', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              // Unlinked asset line: NO material_id, only the free-text spec
              // name. Must still be excluded by name.
              material_id: null, usage_rate: 0, coefficient: 2, waste_factor: 0,
              unit: 'set', boq_item_id: 'boq-1', material_spec: 'Scaffolding set',
              line_type: 'material', material_catalog: null,
            },
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 74, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi beton ulir 10 mm' },
            },
          ],
        },
        material_catalog: {
          data: [
            { id: 'mat-scaf', name: 'Scaffolding set', unit: 'set', supplier_unit: 'set', base_qty_per_supplier_unit: null, is_asset: true },
            { id: 'mat-1', name: 'Besi beton ulir 10 mm', unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4, is_asset: false },
          ],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    // The name-keyed scaffolding bucket must be excluded just like an id-linked one.
    expect(balances.map((b) => b.material_name)).toEqual(['Besi beton ulir 10 mm']);
  });

  it('leaves non-rebar (no supplier factor) in its base unit, unrounded', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 3, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-2', usage_rate: 0, coefficient: 1.05, waste_factor: 0,
              unit: 'm3', boq_item_id: 'boq-1', material_spec: 'Beton Readymix',
              line_type: 'material', material_catalog: { name: 'Beton Readymix' },
            },
          ],
        },
        material_catalog: {
          data: [{ id: 'mat-2', name: 'Beton Readymix', unit: 'm3', supplier_unit: 'm3', base_qty_per_supplier_unit: null }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');
    expect(balances).toHaveLength(1);
    // 3 × 1.05 = 3.15 m3 — stays fractional in m3 (no batang rounding).
    expect(balances[0].unit).toBe('m3');
    expect(balances[0].planned).toBe(3.15);
  });

  it('matches received by name case-insensitively (normalizeMaterialKey)', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 5, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: {
          data: [
            {
              id: 'r-1',
              po_id: 'po-1',
              receipt_lines: [{ material_name: '  BESI D8 ', quantity_actual: 4 }],
            },
          ],
        },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 1, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    // "  BESI D8 " normalizes to the same key as "Besi D8".
    expect(balances[0].received).toBe(4);
  });

  it('joins an id-keyed receipt to a balance row whose name differs (the 055 fix)', async () => {
    // The receipt line carries material_id='mat-1' but a FREE-TEXT name
    // ("Besi Ulir 8mm") that does NOT match the catalog name ("Besi D8").
    // The old name-only join silently dropped this (received=0); the id join
    // must reconcile it.
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 5, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: {
          data: [
            {
              id: 'r-1',
              po_id: 'po-1',
              receipt_lines: [{ material_id: 'mat-1', material_name: 'Besi Ulir 8mm', quantity_actual: 6 }],
            },
          ],
        },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 1, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    // Balance row is named 'Besi D8' (catalog), receipt says 'Besi Ulir 8mm' —
    // only the material_id link can bridge them.
    expect(balances[0].material_name).toBe('Besi D8');
    expect(balances[0].received).toBe(6);
  });
});

describe('deriveMaterialBalance — on-order leg (v_material_envelope_status)', () => {
  it('credits a fully-ordered-but-not-yet-received material: on_order = ordered, and it no longer needs procurement', async () => {
    // The live-verified bug this task fixes: the report never read purchase
    // orders, so a material fully covered by an open PO still looked like a
    // bare-shelf shortage. Here on_site is 0 (nothing received yet) but the
    // envelope view shows the full 100 already on order.
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 10, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
        v_material_envelope_status: {
          data: [{ material_id: 'mat-1', material_name: 'Besi D8', total_ordered: 100, total_requested: 100 }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    const b = balances[0];
    expect(b.planned).toBe(100); // 10 * coeff 10
    expect(b.received).toBe(0);
    expect(b.on_site).toBe(0);
    expect(b.ordered).toBe(100);
    expect(b.requested).toBe(100);
    // on_order = max(0, ordered − received) = 100 − 0 = 100
    expect(b.on_order).toBe(100);

    // Integration with the (now on_order-aware) threshold predicate: without
    // crediting the order this would flag ("Perlu Pengadaan"); with it, the
    // shortage reads as already covered.
    expect(needsProcurement({ planned: b.planned, on_site: b.on_site })).toBe(true); // old behavior, uncredited
    expect(needsProcurement({ planned: b.planned, on_site: b.on_site, on_order: b.on_order })).toBe(false); // covered
  });

  it('caps on_order at 0 once the order has actually arrived (received >= ordered)', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [{ id: 'po-1', material_name: 'Besi D8' }] },
        receipts: {
          data: [{ id: 'r-1', po_id: 'po-1', receipt_lines: [{ material_id: 'mat-1', material_name: 'Besi D8', quantity_actual: 100 }] }],
        },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 10, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
        v_material_envelope_status: {
          data: [{ material_id: 'mat-1', material_name: 'Besi D8', total_ordered: 100, total_requested: 100 }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');
    expect(balances[0].received).toBe(100);
    expect(balances[0].on_order).toBe(0); // fully received — nothing still "in flight"
  });

  it('falls back to on_order/ordered/requested = 0 when there is no envelope row for the material — behavior identical to today', async () => {
    wireSupabase({
      rpc: {
        derive_boq_installed: {
          data: [{ boq_item_id: 'boq-1', total_installed: 2, entry_count: 1, last_entry_at: null }],
        },
      },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'kg', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [{ id: 'po-1', material_name: 'Besi D8' }] },
        receipts: {
          data: [{ id: 'r-1', po_id: 'po-1', receipt_lines: [{ material_name: 'Besi D8', quantity_actual: 7 }, { material_name: 'Besi D8', quantity_actual: 3 }] }],
        },
        ahs_lines: {
          data: [
            {
              material_id: 'mat-1', usage_rate: 0, coefficient: 1, waste_factor: 0,
              unit: 'kg', boq_item_id: 'boq-1', material_spec: 'Besi beton',
              line_type: 'material', material_catalog: { name: 'Besi D8' },
            },
          ],
        },
        material_catalog: { data: [{ id: 'mat-1', name: 'Besi D8', unit: 'kg' }] },
        // No fixture entry for v_material_envelope_status — wireSupabase's
        // default (empty data) applies, exercising the "no envelope row" path.
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    const b = balances[0];
    // Unchanged from the pre-existing "received & on_site" test with this
    // exact fixture shape — the on-order leg must not perturb the rest.
    expect(b.planned).toBe(10);
    expect(b.installed).toBe(2);
    expect(b.received).toBe(10);
    expect(b.on_site).toBe(8);
    expect(b.ordered).toBe(0);
    expect(b.requested).toBe(0);
    expect(b.on_order).toBe(0);
  });

  it('matches ordered/requested by name when the balance bucket has no material_id (mirrors the received-by-name fallback)', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 2, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [{ id: 'ahs-v1' }] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        ahs_lines: {
          data: [
            {
              material_id: null, usage_rate: 0, coefficient: 1.05, waste_factor: 0,
              unit: 'm3', boq_item_id: 'boq-1', material_spec: 'Beton readymix K-350',
              line_type: 'material', material_catalog: null,
            },
          ],
        },
        // material_id is null on the envelope row too — name is the only link.
        v_material_envelope_status: {
          data: [{ material_id: null, material_name: 'Beton readymix K-350', total_ordered: 5, total_requested: 5 }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    expect(balances[0].material_name).toBe('Beton readymix K-350');
    expect(balances[0].ordered).toBe(5);
    expect(balances[0].on_order).toBe(5); // received 0
  });
});

describe('deriveMaterialBalance — fallbacks when no structured baseline', () => {
  it('falls back to boq_items tier1/tier2 materials when no ahs_lines exist', async () => {
    wireSupabase({
      rpc: {
        derive_boq_installed: {
          data: [{ boq_item_id: 'boq-1', total_installed: 3, entry_count: 1, last_entry_at: null }],
        },
      },
      tables: {
        boq_items: {
          data: [
            {
              id: 'boq-1', planned: 6, installed: 0, unit: 'm3',
              tier1_material: 'Beton K-350', tier2_material: 'Besi Beton',
            },
          ],
        },
        // No current baseline → ahs_lines branch skipped entirely.
        ahs_versions: { data: [] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        // master-master fallback also empty.
        project_material_master: { data: [] },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    // Two buckets, one per tier material. Sorted by name.
    expect(balances.map((b) => b.material_name)).toEqual(['Besi Beton', 'Beton K-350']);
    for (const b of balances) {
      expect(b.planned).toBe(6);
      expect(b.installed).toBe(3); // derived installed used directly (rate 1)
      expect(b.unit).toBe('m3');
    }
  });

  it('uses project_material_master_lines when present and no ahs baseline', async () => {
    wireSupabase({
      rpc: {
        derive_boq_installed: {
          data: [{ boq_item_id: 'boq-1', total_installed: 5, entry_count: 1, last_entry_at: null }],
        },
      },
      tables: {
        boq_items: {
          data: [{ id: 'boq-1', planned: 10, installed: 0, unit: 'm3', tier1_material: null, tier2_material: null }],
        },
        ahs_versions: { data: [] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        project_material_master: { data: [{ id: 'master-1' }] },
        project_material_master_lines: {
          data: [{ material_id: null, boq_item_id: 'boq-1', planned_quantity: 40, unit: 'kg' }],
        },
      },
    });

    const balances = await deriveMaterialBalance('proj-1');

    expect(balances).toHaveLength(1);
    expect(balances[0].planned).toBe(40);
    // installed = planned_quantity * (installed/planned ratio) = 40 * (5/10) = 20
    expect(balances[0].installed).toBe(20);
  });
});

describe('deriveMaterialBalance — edge cases', () => {
  it('returns an empty array for a project with no data at all', async () => {
    wireSupabase({
      rpc: { derive_boq_installed: { data: [] } },
      tables: {
        boq_items: { data: [] },
        ahs_versions: { data: [] },
        purchase_orders: { data: [] },
        receipts: { data: [] },
        project_material_master: { data: [] },
      },
    });

    const balances = await deriveMaterialBalance('proj-empty');
    expect(balances).toEqual([]);
  });
});
