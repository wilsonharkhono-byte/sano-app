jest.mock('../supabase', () => ({ supabase: {} }));

import { topoSortBlocks, flattenBlock, findDuplicateBoqCodes, zeroPlannedBoqCodes, type FlattenedLine } from '../publishBaselineV2';
import { resolveCatalogId, type CatalogRow } from '../publishBaselineV2';

describe('resolveCatalogId', () => {
  const catalog: CatalogRow[] = [
    { id: 'id-d13', code: 'REB-DE13', name: 'Besi beton ulir 13 mm', category: 'Struktur', tier: 1, unit: 'kg' },
    { id: 'id-pcc', code: 'CEM-PCC50', name: 'Semen PCC 50 kg', category: 'Material Beton', tier: 2, unit: 'zak' },
    { id: 'id-bdr', code: 'KWD-BDR01', name: 'Kawat bendrat', category: 'Struktur', tier: 3, unit: 'kg' },
  ];
  const aliases = new Map<string, string>([
    ['besi beton d13', 'REB-DE13'],
    ['semen pc 50kg', 'CEM-PCC50'],
  ]);

  it('resolves an exact catalog name to its id', () => {
    expect(resolveCatalogId('Besi beton ulir 13 mm', catalog, aliases)).toBe('id-d13');
  });

  it('resolves an aliased breakdown name to the canonical id', () => {
    expect(resolveCatalogId('Besi beton D13', catalog, aliases)).toBe('id-d13');
    expect(resolveCatalogId('Semen PC @50kg', catalog, aliases)).toBe('id-pcc');
  });

  it('returns null for an unresolved name rather than fabricating a link', () => {
    expect(resolveCatalogId('Beton decking', catalog, aliases)).toBeNull();
    expect(resolveCatalogId('Besi beton — waste (5%)', catalog, aliases)).toBeNull();
  });
});

import { foldRebarWaste, type MasterLineDraft } from '../publishBaselineV2';
import { buildMasterLinesV2, type MasterLineInput } from '../publishBaselineV2';

describe('buildMasterLinesV2', () => {
  it('computes planned = boq.planned × coefficient per resolved material line', () => {
    const input: MasterLineInput[] = [
      { boq_item_id: 'poer', boq_planned: 1.65, material_id: 'id-d13', material_name: 'Besi beton D13', coefficient: 71.20, unit: 'kg', line_type: 'material' },
      { boq_item_id: 'poer', boq_planned: 1.65, material_id: 'id-pcc', material_name: 'Semen PC @50kg', coefficient: 0.0897831, unit: 'zak', line_type: 'material' },
    ];
    const lines = buildMasterLinesV2(input, 'master-1');
    const d13 = lines.find(l => l.material_id === 'id-d13')!;
    expect(d13.master_id).toBe('master-1');
    expect(d13.boq_item_id).toBe('poer');
    expect(d13.planned_quantity).toBeCloseTo(117.48, 2);
    expect(d13.unit).toBe('kg');
  });

  it('excludes labor/equipment and material lines with null material_id', () => {
    const input: MasterLineInput[] = [
      { boq_item_id: 'poer', boq_planned: 1.65, material_id: 'id-d13', material_name: 'Besi beton D13', coefficient: 71.20, unit: 'kg', line_type: 'material' },
      { boq_item_id: 'poer', boq_planned: 1.65, material_id: null, material_name: 'Upah cor', coefficient: 1, unit: 'm3', line_type: 'labor' },
      { boq_item_id: 'poer', boq_planned: 1.65, material_id: null, material_name: 'Beton decking', coefficient: 111.76, unit: 'kg', line_type: 'material' },
    ];
    const lines = buildMasterLinesV2(input, 'master-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].material_id).toBe('id-d13');
  });

  it('merges duplicate (boq_item, material) pairs by summing planned', () => {
    const input: MasterLineInput[] = [
      { boq_item_id: 'b', boq_planned: 2, material_id: 'm', material_name: 'X', coefficient: 3, unit: 'kg', line_type: 'material' },
      { boq_item_id: 'b', boq_planned: 2, material_id: 'm', material_name: 'X', coefficient: 4, unit: 'kg', line_type: 'material' },
    ];
    const lines = buildMasterLinesV2(input, 'master-1');
    expect(lines).toHaveLength(1);
    expect(lines[0].planned_quantity).toBeCloseTo(14, 6);
  });
});

describe('foldRebarWaste', () => {
  it('distributes a waste line proportionally onto resolved rebar lines and drops the waste line', () => {
    const drafts: MasterLineDraft[] = [
      { material_id: 'id-d13', material_name: 'Besi beton D13', coefficient: 71.20, isRebar: true, isWaste: false },
      { material_id: 'id-d16', material_name: 'Besi beton D16', coefficient: 40.56, isRebar: true, isWaste: false },
      { material_id: null,     material_name: 'Besi beton — waste (5%)', coefficient: 5.588, isRebar: true, isWaste: true },
    ];
    const out = foldRebarWaste(drafts);
    expect(out.find(d => d.isWaste)).toBeUndefined();
    const d13 = out.find(d => d.material_id === 'id-d13')!;
    const d16 = out.find(d => d.material_id === 'id-d16')!;
    expect(d13.coefficient).toBeCloseTo(74.760, 2);
    expect(d16.coefficient).toBeCloseTo(42.588, 2);
    expect(d13.coefficient + d16.coefficient).toBeCloseTo(71.20 + 40.56 + 5.588, 2);
  });

  it('leaves a waste line untouched (kept) when there are no resolved rebar lines to absorb it', () => {
    const drafts: MasterLineDraft[] = [
      { material_id: null, material_name: 'Besi beton — waste (5%)', coefficient: 5.588, isRebar: true, isWaste: true },
    ];
    const out = foldRebarWaste(drafts);
    expect(out).toHaveLength(0);
  });

  it('is a no-op for groups with no waste line', () => {
    const drafts: MasterLineDraft[] = [
      { material_id: 'id-d13', material_name: 'Besi beton D13', coefficient: 71.20, isRebar: true, isWaste: false },
    ];
    expect(foldRebarWaste(drafts)).toEqual(drafts);
  });
});

describe('topoSortBlocks', () => {
  it('orders children after parents (deepest-first via reverse)', () => {
    // Block A references B (A is child of B).
    // Staging row order matters: components belong to the most recent ahs_block.
    // So A's component (which references B) must appear between A and B.
    const stagingRows = [
      { row_number: 1, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'A' } },
      // Component in block A with nested_ahs → block B (via synthetic parent key)
      { row_number: 2, row_type: 'ahs' as const, parent_ahs_staging_id: 'block:3', parsed_data: {} },
      { row_number: 3, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'B' } },
    ];
    const ordered = topoSortBlocks(stagingRows as never);
    const titles = ordered.map(b => (b.parsed_data as { title: string }).title);
    // Parent B must be processed before child A
    expect(titles.indexOf('B')).toBeLessThan(titles.indexOf('A'));
  });

  it('throws when AHS nested references form a cycle', () => {
    // Block A (row 1) has a component referencing block B (row 2)
    // Block B (row 2) has a component referencing block A (row 1) — cycle.
    const stagingRows = [
      { row_number: 1, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'A' } },
      { row_number: 10, row_type: 'ahs' as const, parent_ahs_staging_id: 'block:2', parsed_data: {} },
      { row_number: 2, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'B' } },
      { row_number: 20, row_type: 'ahs' as const, parent_ahs_staging_id: 'block:1', parsed_data: {} },
    ];
    expect(() => topoSortBlocks(stagingRows as never)).toThrow(/cycle/i);
  });
});

describe('findDuplicateBoqCodes', () => {
  const boq = (code: string) => ({
    row_type: 'boq' as const,
    parsed_data: { code },
  });

  it('returns empty when all BoQ codes are unique', () => {
    const rows = [boq('III.A.2.1.1'), boq('III.A.2.2.1'), boq('IV.A.2.7')];
    expect(findDuplicateBoqCodes(rows as never)).toEqual([]);
  });

  it('flags codes that appear more than once (stale-staging signature)', () => {
    // Old parser collapsed "Sloof Elevasi -0.80" and "Sloof & Balok Lantai 1"
    // onto the same codes — the exact shape that breaks the ON CONFLICT upsert.
    const rows = [
      boq('III.A.1.1'),
      boq('III.A.1.1'),
      boq('III.A.1.2'),
      boq('III.A.1.2'),
      boq('IV.A.2.7'),
    ];
    const dupes = findDuplicateBoqCodes(rows as never);
    expect(dupes).toContain('III.A.1.1 (×2)');
    expect(dupes).toContain('III.A.1.2 (×2)');
    expect(dupes).not.toContain('IV.A.2.7 (×2)');
  });

  it('ignores non-boq staging rows', () => {
    const rows = [
      boq('III.A.2.1'),
      { row_type: 'ahs' as const, parsed_data: { code: 'III.A.2.1' } },
      { row_type: 'material' as const, parsed_data: { code: 'III.A.2.1' } },
    ];
    expect(findDuplicateBoqCodes(rows as never)).toEqual([]);
  });
});

describe('zeroPlannedBoqCodes', () => {
  const boq = (code: string, planned: unknown) => ({
    row_type: 'boq' as const,
    parsed_data: { code, planned },
  });

  it('returns empty when every BoQ row has a positive take-off volume', () => {
    const rows = [boq('VII.A.1', 3540.78), boq('VII.A.3', 1215.5), boq('VII.A.6', 1)];
    expect(zeroPlannedBoqCodes(rows as never)).toEqual([]);
  });

  it('flags rows whose planned volume is 0 (CHECK planned > 0 would reject)', () => {
    // WF.150.75 — a steel profile listed in the RAB but with zero take-off.
    const rows = [boq('VII.A.1', 3540.78), boq('VII.A.2', 0), boq('VII.A.3', 1215.5)];
    expect(zeroPlannedBoqCodes(rows as never)).toEqual(['VII.A.2']);
  });

  it('treats negative / null / non-numeric planned as non-positive', () => {
    const rows = [
      boq('A.1', -5),
      boq('A.2', null),
      boq('A.3', undefined),
      boq('A.4', 'abc'),
      boq('A.5', 2),
    ];
    expect(zeroPlannedBoqCodes(rows as never)).toEqual(['A.1', 'A.2', 'A.3', 'A.4']);
  });

  it('parses Indonesian-formatted numeric strings via toNumber', () => {
    // "1.234,56" → 1234.56 (positive) must NOT be flagged.
    const rows = [boq('A.1', '1.234,56'), boq('A.2', '0')];
    expect(zeroPlannedBoqCodes(rows as never)).toEqual(['A.2']);
  });

  it('ignores non-boq staging rows', () => {
    const rows = [
      boq('A.1', 0),
      { row_type: 'ahs' as const, parsed_data: { code: 'X', planned: 0 } },
      { row_type: 'material' as const, parsed_data: { code: 'Y', planned: 0 } },
    ];
    expect(zeroPlannedBoqCodes(rows as never)).toEqual(['A.1']);
  });
});

describe('flattenBlock', () => {
  it('emits a single ahs_line for a catalog component', () => {
    const components = [
      {
        row_number: 10,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Semen', unit: 'zak', unit_price: 75000 },
        cost_basis: 'catalog' as const,
        ref_cells: {
          unit_price: { sheet: 'Material', cell: 'D2', cached_value: 75000 },
        },
        cost_split: null,
        parent_ahs_staging_id: null,
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, new Map());
    expect(lines.length).toBe(1);
    expect(lines[0].unit_price).toBe(75000);
    expect(lines[0].line_type).toBe('material');
    expect(lines[0].unit).toBe('zak'); // unit carried through for the NOT NULL ahs_lines.unit column
  });

  it('emits 3 ahs_lines from a cross_ref cost_split', () => {
    const components = [
      {
        row_number: 20,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Rebar' },
        cost_basis: 'cross_ref' as const,
        ref_cells: null,
        cost_split: { material: 1000, labor: 500, equipment: 200, prelim: 0 },
        parent_ahs_staging_id: null,
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, new Map());
    expect(lines.length).toBe(3);
    const byType = Object.fromEntries(
      lines.map(l => [l.line_type, l.unit_price]),
    );
    expect(byType.material).toBe(1000);
    expect(byType.labor).toBe(500);
    expect(byType.equipment).toBe(200);
  });

  it('parses Indonesian-formatted numeric strings in parsed_data via toNumber', () => {
    // "1,5" → 1.5 and "50.000" → 50000 under Indonesian locale conventions.
    // ref_cells is absent so unit_price must come from parsed_data.unit_price.
    const components = [
      {
        row_number: 40,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Pasir', coefficient: '1,5', unit_price: '50.000' },
        cost_basis: 'catalog' as const,
        ref_cells: null,
        cost_split: null,
        parent_ahs_staging_id: null,
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, new Map());
    expect(lines.length).toBe(1);
    expect(lines[0].coefficient).toBe(1.5);
    expect(lines[0].unit_price).toBe(50000);
  });

  it('inlines parent block lines when nested_ahs component resolves', () => {
    const parentCache = new Map<number, FlattenedLine[]>();
    parentCache.set(99, [
      {
        line_type: 'material',
        material_name: 'Semen',
        unit: 'zak',
        unit_price: 75000,
        coefficient: 1,
        origin_parent_ahs_id: null,
      },
    ]);
    const components = [
      {
        row_number: 30,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Beton ready-mix' },
        cost_basis: 'nested_ahs' as const,
        ref_cells: null,
        cost_split: null,
        parent_ahs_staging_id: 'block:99',
        raw_data: {},
        needs_review: false,
        confidence: 1,
        review_status: 'APPROVED' as const,
      },
    ];
    const lines = flattenBlock(components, parentCache);
    expect(lines.length).toBe(1);
    expect(lines[0].material_name).toBe('Semen');
    expect(lines[0].origin_parent_ahs_id).toBe('block:99');
  });
});
