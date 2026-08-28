// publishBaselineV2 → supabase pulls in react-native-url-polyfill (ESM) which
// Jest can't parse. Mock supabase, as the other publish tests do.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { buildProjectMaterialLines, buildProjectPriceBook } from '../publishBaselineV2';
import type { StagingRowV2 } from '../boqParserV2/types';

type Cat = { id: string; code: string; name: string; category: string; tier: 1 | 2 | 3 | 4; unit: string };
const catalog: Cat[] = [
  { id: 'mat-semen', code: 'CEM', name: 'Semen PC', category: 'x', tier: 2, unit: 'sak' },
  { id: 'mat-pasir', code: 'PSR', name: 'Pasir pasang', category: 'x', tier: 3, unit: 'm3' },
];

function materialRow(pd: Record<string, unknown>, review: 'PENDING' | 'REJECTED' = 'PENDING'): StagingRowV2 {
  return {
    row_type: 'material', row_number: 1, raw_data: {}, parsed_data: pd,
    needs_review: false, confidence: 1, review_status: review,
    cost_basis: null, parent_ahs_staging_id: null, ref_cells: null, cost_split: null,
  } as unknown as StagingRowV2;
}

describe('buildProjectMaterialLines', () => {
  it('builds NULL-boq master lines with the sheet\'s absolute Volume', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak 40 kg', volume: 5456, project_material: true }),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 347.45, project_material: true }),
    ];
    const { lines } = buildProjectMaterialLines(rows, 'master-1', catalog as never, new Map());
    expect(lines).toEqual([
      { master_id: 'master-1', material_id: 'mat-semen', boq_item_id: null, planned_quantity: 5456, unit: 'sak 40 kg' },
      { master_id: 'master-1', material_id: 'mat-pasir', boq_item_id: null, planned_quantity: 347.45, unit: 'm3' },
    ]);
  });

  it('skips REJECTED rows and rows that are not project_material', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 100, project_material: true }, 'REJECTED'),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 50 /* no project_material flag */ }),
    ];
    const { lines } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());
    expect(lines).toHaveLength(0);
  });

  it('sums duplicate materials and reports unresolved ones', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 100, project_material: true }),
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 25, project_material: true }),
      materialRow({ name: 'Unobtanium X', unit: 'kg', volume: 5, project_material: true }),
    ];
    const { lines, unresolved } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ material_id: 'mat-semen', planned_quantity: 125, boq_item_id: null });
    expect(unresolved).toEqual(['Unobtanium X']);
  });

  // The 2026-08-15 incident: a column shift made every Others row parse with
  // volume 0, and the `continue` below dropped all 13 project materials while
  // publish still reported success. A dropped row must now be reported.
  it('reports rows dropped for zero/absent volume instead of dropping them silently', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 0, project_material: true }),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', project_material: true }),
      materialRow({ name: 'Besi', unit: 'kg', volume: -5, project_material: true }),
    ];
    const { lines, skipped } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());
    expect(lines).toHaveLength(0);
    expect(skipped).toEqual([
      'Semen PC: volume 0',
      'Pasir Pasang: volume 0',
      'Besi: volume -5',
    ]);
  });

  it('reports a blank material name (row identified by its staging row number)', () => {
    const row = materialRow({ name: '   ', unit: 'sak', volume: 10, project_material: true });
    row.row_number = 7;
    const { lines, skipped } = buildProjectMaterialLines([row], 'm', catalog as never, new Map());
    expect(lines).toHaveLength(0);
    expect(skipped).toEqual(['row 7: blank material name']);
  });

  it('reports nothing when every row lands', () => {
    const rows = [materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, project_material: true })];
    const { lines, skipped } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());
    expect(lines).toHaveLength(1);
    expect(skipped).toEqual([]);
  });
});

describe('buildProjectPriceBook', () => {
  it('builds price-book rows (price + tier from the file, material_id resolved)', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak 40 kg', volume: 5456, reference_unit_price: 60000, tier: 2, project_material: true }),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 347.45, reference_unit_price: 350000, tier: 3, project_material: true }),
    ];
    const { rows: pb } = buildProjectPriceBook(rows, 'proj-1', catalog as never, new Map());
    expect(pb).toEqual([
      { project_id: 'proj-1', material_id: 'mat-semen', material_name: 'Semen PC', unit: 'sak 40 kg', unit_price: 60000, tier: 2 },
      { project_id: 'proj-1', material_id: 'mat-pasir', material_name: 'Pasir Pasang', unit: 'm3', unit_price: 350000, tier: 3 },
    ]);
  });

  // A name the catalog does not know can never join v_material_budget_status
  // (047:75-82 joins on material_id), and nothing backfills material_id on this
  // table — so a material_id NULL row was inert AND read as a real price. It is
  // now skipped, matching buildProjectMaterialLines, and reported.
  it('skips a material the catalog does not know instead of writing a NULL-material_id row', () => {
    const rows = [
      materialRow({ name: 'Unobtanium X', unit: 'kg', volume: 5, reference_unit_price: 1000, tier: 3, project_material: true }),
    ];
    const { rows: pb, skipped } = buildProjectPriceBook(rows, 'p', catalog as never, new Map());
    expect(pb).toEqual([]);
    expect(skipped).toEqual(['Unobtanium X: not in material catalog (no envelope to price)']);
  });

  // SBY-001 (2026-08): the Others sheet carried two junk rows whose Material
  // cell held a WORK-ITEM label ("Kolom Balok Praktis") over a copy of the Semen
  // PC / Batako figures. Master lines dropped them (unresolved); the price book
  // kept them, so the live book showed 15 rows including two phantom materials
  // priced identically to real ones. The two builders must agree on which rows
  // are real.
  it('drops the exact junk rows that master lines drop (SBY-001 "Kolom Balok Praktis" shape)', () => {
    const rows = [
      materialRow({ name: 'Kolom Balok Praktis', unit: 'sak 40 kg', volume: 4582, reference_unit_price: 75000, tier: 1, project_material: true }),
      materialRow({ name: 'Kolom Balok Praktis', unit: 'm3', volume: 8628, reference_unit_price: 350000, tier: 1, project_material: true }),
      materialRow({ name: 'Semen PC', unit: 'sak 40 kg', volume: 4582, reference_unit_price: 75000, tier: 2, project_material: true }),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 369.97, reference_unit_price: 350000, tier: 3, project_material: true }),
    ];
    const { rows: pb, skipped } = buildProjectPriceBook(rows, 'p', catalog as never, new Map());
    const { lines } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());

    expect(pb.map(r => r.material_name)).toEqual(['Semen PC', 'Pasir Pasang']);
    expect(pb.every(r => r.material_id != null)).toBe(true);
    // Same membership as the master lines for these rows — the two builders no
    // longer disagree about which NAMES are real. (They still differ on the
    // other axes by design: master lines need volume > 0, price rows need a
    // price + tier.)
    expect(pb.map(r => r.material_id).sort()).toEqual(lines.map(l => l.material_id).sort());
    expect(skipped).toEqual([
      'Kolom Balok Praktis: not in material catalog (no envelope to price)',
      'Kolom Balok Praktis: not in material catalog (no envelope to price)',
    ]);
  });

  it('skips rows with no positive price, invalid tier, REJECTED review, or missing flag', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 0, tier: 2, project_material: true }),   // no price
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 500, tier: 9, project_material: true }),  // bad tier
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 500, tier: 2, project_material: true }, 'REJECTED'),
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 500, tier: 2 }),                          // not project_material
    ];
    expect(buildProjectPriceBook(rows, 'p', catalog as never, new Map()).rows).toHaveLength(0);
  });

  // A price-book row that never lands means no Tier-3 Rupiah envelope for that
  // material (Gate-1 shows TIER3_NO_BUDGET) — the estimator has to hear about it.
  it('reports each skipped row with its reason (price / tier / blank name)', () => {
    const badTier = materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 500, tier: 9, project_material: true });
    const blank = materialRow({ name: '', unit: 'sak', volume: 10, reference_unit_price: 500, tier: 2, project_material: true });
    blank.row_number = 4;
    const rows = [
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 10, reference_unit_price: 0, tier: 3, project_material: true }),
      badTier,
      blank,
      materialRow({ name: 'Besi', unit: 'kg', volume: 10, reference_unit_price: 0, tier: 0, project_material: true }),
    ];
    const { rows: pb, skipped } = buildProjectPriceBook(rows, 'p', catalog as never, new Map());
    expect(pb).toHaveLength(0);
    expect(skipped).toEqual([
      'Pasir Pasang: no unit price',
      'Semen PC: tier 9 is not 1–4',
      'row 4: blank material name',
      'Besi: no unit price, tier 0 is not 1–4',
    ]);
  });

  it('reports nothing for REJECTED or non-project rows (deliberately out of scope)', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 0, tier: 2, project_material: true }, 'REJECTED'),
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 10, reference_unit_price: 0, tier: 2 }),
    ];
    expect(buildProjectPriceBook(rows, 'p', catalog as never, new Map()).skipped).toEqual([]);
  });
});
