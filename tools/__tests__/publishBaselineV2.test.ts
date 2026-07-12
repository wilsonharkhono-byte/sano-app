jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { topoSortBlocks, flattenBlock, findDuplicateBoqCodes, zeroPlannedBoqCodes, buildBoqItemInsert, type FlattenedLine } from '../publishBaselineV2';
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
import { classifyRebar } from '../publishBaselineV2';

describe('classifyRebar', () => {
  it('flags rebar names as rebar, non-waste', () => {
    expect(classifyRebar('Besi beton D13')).toEqual({ isRebar: true, isWaste: false });
    expect(classifyRebar('Besi beton ulir 16 mm')).toEqual({ isRebar: true, isWaste: false });
  });

  it('flags a rebar waste line as both rebar and waste', () => {
    expect(classifyRebar('Besi beton — waste (5%)')).toEqual({ isRebar: true, isWaste: true });
  });

  it('does not flag non-rebar materials (even if they mention waste) as rebar or waste', () => {
    expect(classifyRebar('Semen PC @50kg')).toEqual({ isRebar: false, isWaste: false });
    // "waste" alone must not set isWaste without rebar — isWaste is gated on isRebar
    expect(classifyRebar('Construction waste disposal')).toEqual({ isRebar: false, isWaste: false });
  });
});

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

import { buildBaselineSnapshotRows, type MasterLineRecord } from '../publishBaselineV2';

describe('buildBaselineSnapshotRows', () => {
  it('aggregates per material by summing planned_quantity across boq_items', () => {
    const masterLines: MasterLineRecord[] = [
      { master_id: 'm1', material_id: 'id-d13', boq_item_id: 'boq-1', planned_quantity: 100, unit: 'kg' },
      { master_id: 'm1', material_id: 'id-d13', boq_item_id: 'boq-2', planned_quantity: 50, unit: 'kg' },
      { master_id: 'm1', material_id: 'id-pcc', boq_item_id: 'boq-1', planned_quantity: 30, unit: 'zak' },
    ];
    const rows = buildBaselineSnapshotRows(masterLines, 'proj-1', 'm1');
    expect(rows).toHaveLength(2);
    const d13 = rows.find(r => r.material_id === 'id-d13')!;
    expect(d13.baseline_planned_qty).toBeCloseTo(150, 6);
    expect(d13.unit).toBe('kg');
    const pcc = rows.find(r => r.material_id === 'id-pcc')!;
    expect(pcc.baseline_planned_qty).toBeCloseTo(30, 6);
  });

  it('carries project_id and source_master_id onto every row', () => {
    const masterLines: MasterLineRecord[] = [
      { master_id: 'm1', material_id: 'id-d13', boq_item_id: 'boq-1', planned_quantity: 100, unit: 'kg' },
    ];
    const rows = buildBaselineSnapshotRows(masterLines, 'proj-42', 'master-77');
    expect(rows).toEqual([
      { project_id: 'proj-42', material_id: 'id-d13', baseline_planned_qty: 100, unit: 'kg', source_master_id: 'master-77' },
    ]);
  });

  it('skips lines with no resolved material_id rather than fabricating a snapshot', () => {
    const masterLines = [
      { master_id: 'm1', material_id: null, boq_item_id: 'boq-1', planned_quantity: 100, unit: 'kg' },
      { master_id: 'm1', material_id: 'id-d13', boq_item_id: 'boq-1', planned_quantity: 25, unit: 'kg' },
    ] as unknown as MasterLineRecord[];
    const rows = buildBaselineSnapshotRows(masterLines, 'proj-1', 'm1');
    expect(rows).toHaveLength(1);
    expect(rows[0].material_id).toBe('id-d13');
  });

  it('drops a material whose lines disagree on unit rather than guessing which is right', () => {
    const masterLines: MasterLineRecord[] = [
      { master_id: 'm1', material_id: 'id-mixed', boq_item_id: 'boq-1', planned_quantity: 10, unit: 'kg' },
      { master_id: 'm1', material_id: 'id-mixed', boq_item_id: 'boq-2', planned_quantity: 5, unit: 'zak' },
      { master_id: 'm1', material_id: 'id-clean', boq_item_id: 'boq-3', planned_quantity: 8, unit: 'm3' },
    ];
    const rows = buildBaselineSnapshotRows(masterLines, 'proj-1', 'm1');
    expect(rows.find(r => r.material_id === 'id-mixed')).toBeUndefined();
    expect(rows.find(r => r.material_id === 'id-clean')).toBeDefined();
  });

  it('returns an empty array for empty input', () => {
    expect(buildBaselineSnapshotRows([], 'proj-1', 'm1')).toEqual([]);
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

  it('drops the waste line when there are no resolved rebar lines to absorb it', () => {
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

  it('sums multiple waste lines before distributing onto rebar targets', () => {
    const drafts: MasterLineDraft[] = [
      { material_id: 'id-d13', material_name: 'Besi beton D13', coefficient: 60, isRebar: true, isWaste: false },
      { material_id: null, material_name: 'Besi beton — waste (5%)', coefficient: 3, isRebar: true, isWaste: true },
      { material_id: null, material_name: 'Besi beton — waste extra', coefficient: 2, isRebar: true, isWaste: true },
    ];
    const out = foldRebarWaste(drafts);
    expect(out.filter(d => d.isWaste)).toHaveLength(0);
    const d13 = out.find(d => d.material_id === 'id-d13')!;
    expect(d13.coefficient).toBeCloseTo(65, 6); // 60 + (3+2) onto the only target
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

describe('buildBoqItemInsert', () => {
  const boqRow = (raw: Record<string, unknown>, pd: Record<string, unknown> = {}) => ({
    row_type: 'boq' as const,
    raw_data: raw,
    parsed_data: { code: 'III.A.1.2', label: 'Poer PC.2', unit: 'm3', planned: 1.65, ...pd },
  });

  it('carries chapter and sub_chapter through onto the upsert record', () => {
    const row = boqRow({ chapter: 'PEKERJAAN FISIK LANTAI 1', subChapter: '- Poer PC.1' });
    const insert = buildBoqItemInsert(row as never, 'proj-1');
    expect(insert).toEqual({
      project_id: 'proj-1',
      code: 'III.A.1.2',
      label: 'Poer PC.2',
      unit: 'm3',
      planned: 1.65,
      chapter: 'PEKERJAAN FISIK LANTAI 1',
      sub_chapter: '- Poer PC.1',
    });
  });

  it('defaults chapter/sub_chapter to null when raw_data omits them (never undefined)', () => {
    const row = boqRow({});
    const insert = buildBoqItemInsert(row as never, 'proj-1');
    expect(insert?.chapter).toBeNull();
    expect(insert?.sub_chapter).toBeNull();
    expect('chapter' in (insert as object)).toBe(true);
    expect('sub_chapter' in (insert as object)).toBe(true);
  });

  it('defaults chapter/sub_chapter to null when raw_data is missing entirely', () => {
    const row = { row_type: 'boq' as const, parsed_data: { code: 'A.1', label: 'X', unit: 'm3', planned: 1 } };
    const insert = buildBoqItemInsert(row as never, 'proj-1');
    expect(insert?.chapter).toBeNull();
    expect(insert?.sub_chapter).toBeNull();
  });

  it('returns null (quarantine candidate) when a required field is missing, regardless of chapter data', () => {
    const row = boqRow({ chapter: 'X', subChapter: 'Y' }, { label: undefined });
    expect(buildBoqItemInsert(row as never, 'proj-1')).toBeNull();
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

// ─── loadCatalogAndAliases ─────────────────────────────────────────────
//
// publishBaselineV2 links each disaggregated breakdown component to a real
// material_catalog row. Both material_catalog and material_aliases can
// exceed Supabase's 1000-row cap on a mature catalog; an unpaginated select
// silently drops rows past page 1, so components whose material happens to
// live past row 1000 fail to link with no visible error — exactly the
// "confident-looking wrong number" CLAUDE.md forbids (here: a wrong/absent
// material_id, not a wrong Rp figure, but the same silent-truncation shape).

import { loadCatalogAndAliases } from '../publishBaselineV2';
import { supabase } from '../supabase';

const mockSupabase = supabase as unknown as { from: jest.Mock };

/**
 * Range-aware `.from(table)` stub. Mirrors real PostgREST behavior: with no
 * explicit `.range()` call the server still caps results at 1000 rows from
 * 0, which is what makes an unpaginated select truncate. A fresh chain is
 * returned per `.from()` call (fetchAllPaged calls it once per page).
 */
function makeTableMock(tables: Record<string, unknown[] | { error: string }>) {
  return jest.fn((table: string) => {
    const fixture = tables[table];
    if (!fixture) throw new Error(`Unexpected supabase.from('${table}') in test — add a fixture`);
    const chain: Record<string, unknown> = {};
    let range: [number, number] = [0, 999];
    for (const method of ['select', 'eq', 'order']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.range = jest.fn((from: number, to: number) => {
      range = [from, to];
      return chain;
    });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      if (!Array.isArray(fixture)) {
        return Promise.resolve({ data: null, error: { message: fixture.error } }).then(resolve);
      }
      const [from, to] = range;
      return Promise.resolve({ data: fixture.slice(from, to + 1), error: null }).then(resolve);
    };
    return chain;
  });
}

const makeCatalogRow = (n: number): CatalogRow => ({
  id: `mat-${n}`,
  code: `CODE-${n}`,
  name: `Material ${n}`,
  category: 'Struktur',
  tier: 2,
  unit: 'kg',
});

describe('loadCatalogAndAliases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ALL catalog rows across more than one page (past the 1000-row cap)', async () => {
    const catalog = Array.from({ length: 1200 }, (_, i) => makeCatalogRow(i + 1));
    mockSupabase.from.mockImplementation(
      makeTableMock({
        material_catalog: catalog,
        material_aliases: [{ alias: 'semen pc', material_catalog: { code: 'CODE-1' } }],
      }),
    );

    const { catalog: result, aliasMap } = await loadCatalogAndAliases();

    expect(result).toHaveLength(1200);
    expect(aliasMap.get('semen pc')).toBe('CODE-1');
  });

  it('paginates material_aliases past the 1000-row cap too', async () => {
    const aliases = Array.from({ length: 1050 }, (_, i) => ({
      alias: `alias ${i + 1}`,
      material_catalog: { code: `CODE-${i + 1}` },
    }));
    mockSupabase.from.mockImplementation(
      makeTableMock({
        material_catalog: [makeCatalogRow(1)],
        material_aliases: aliases,
      }),
    );

    const { aliasMap } = await loadCatalogAndAliases();

    expect(aliasMap.size).toBe(1050);
    expect(aliasMap.get('alias 1050')).toBe('CODE-1050');
  });

  it('throws on a material_catalog query error instead of proceeding with a partial catalog', async () => {
    mockSupabase.from.mockImplementation(
      makeTableMock({
        material_catalog: { error: 'connection reset' },
        material_aliases: [],
      }),
    );

    await expect(loadCatalogAndAliases()).rejects.toThrow('connection reset');
  });

  it('throws on a material_aliases query error', async () => {
    mockSupabase.from.mockImplementation(
      makeTableMock({
        material_catalog: [makeCatalogRow(1)],
        material_aliases: { error: 'alias table unavailable' },
      }),
    );

    await expect(loadCatalogAndAliases()).rejects.toThrow('alias table unavailable');
  });
});

// ─── publishBaselineV2 — re-publish wiring (Task 2.11 review Fix 3) ──────────
//
// Integration tests over the full publish path with a mocked supabase. They
// lock in the four wiring guarantees the 2.11 review called out:
//   (a) a re-publish (a current ahs_version exists) WITHOUT revisionContext is
//       refused fail-loud, BEFORE any mutation — zero writes.
//   (b) a plan_revisions header insert failure is non-fatal: the publish still
//       succeeds and surfaces the failure as a warning.
//   (c) the 2.10 snapshot gating holds: a material whose master line failed is
//       excluded from material_baseline_snapshots (wrong anchor > absent one).
//   (d) a FIRST publish (no current version) attempts NO plan_revisions write.
//   (e) the principal-FYI raise-count (Fix 5b) is threaded into notify_plan_revised.

import { publishBaselineV2, type RevisionContext } from '../publishBaselineV2';
import type { PlanRevisionLine, PlanRevisionSummary } from '../planRevisionDiff';

const mockRpc = (supabase as unknown as { rpc: jest.Mock }).rpc;

// Two catalog materials; recipe component names match EXACTLY so resolveCatalogId
// resolves them without relying on fuzzy matching (kept deterministic).
const PUB_CATALOG: CatalogRow[] = [
  { id: 'id-d13', code: 'REB-DE13', name: 'Besi beton ulir 13 mm', category: 'Struktur', tier: 1, unit: 'kg' },
  { id: 'id-pcc', code: 'CEM-PCC50', name: 'Semen PCC 50 kg', category: 'Material Beton', tier: 2, unit: 'zak' },
];

// Two BoQ rows, each with one resolvable material component.
function pubStagingRows(): unknown[] {
  return [
    {
      id: 'srow-1', row_number: 1, row_type: 'boq', raw_data: {},
      parsed_data: {
        code: 'A.1', label: 'Item 1', unit: 'm3', planned: 2,
        recipe: { components: [{ materialName: 'Besi beton ulir 13 mm', quantityPerUnit: 10, unitPrice: 9000, lineType: 'material', unit: 'kg' }] },
      },
    },
    {
      id: 'srow-2', row_number: 2, row_type: 'boq', raw_data: {},
      parsed_data: {
        code: 'A.2', label: 'Item 2', unit: 'm3', planned: 3,
        recipe: { components: [{ materialName: 'Semen PCC 50 kg', quantityPerUnit: 5, unitPrice: 75000, lineType: 'material', unit: 'zak' }] },
      },
    },
  ];
}

interface PubCfg {
  stagingRows: unknown[];
  catalog: CatalogRow[];
  oldCurrentVersion: { id: string } | null;
  latestVersion: { version: number } | null;
  failMasterMaterialIds?: Set<string>;
  failRevisionInsert?: boolean;
}

interface PubHarness {
  fromImpl: (table: string) => unknown;
  mutations: Array<{ table: string; op: string; payload: unknown }>;
  tablesTouched: Set<string>;
  captured: { snapshotBatch?: unknown; revisionInsert?: unknown; revisionLineBatch?: unknown };
}

// Chainable builder + per-table resolver. Records every mutating op (insert /
// update / upsert) so tests can assert "zero writes", and captures the batches
// the assertions inspect (snapshots, revision lines).
function makePubHarness(cfg: PubCfg): PubHarness {
  const mutations: PubHarness['mutations'] = [];
  const tablesTouched = new Set<string>();
  const captured: PubHarness['captured'] = {};

  const resolve = (table: string, ctx: {
    op: string; payload: any; selectStr?: string; range?: [number, number];
  }): { data: unknown; error: unknown } => {
    switch (table) {
      case 'import_staging_rows':
        return { data: cfg.stagingRows, error: null };
      case 'material_catalog': {
        const [from, to] = ctx.range ?? [0, 999];
        return { data: cfg.catalog.slice(from, to + 1), error: null };
      }
      case 'material_aliases': {
        const [from, to] = ctx.range ?? [0, 999];
        return { data: ([] as unknown[]).slice(from, to + 1), error: null };
      }
      case 'ahs_versions': {
        if (ctx.op === 'update') return { data: null, error: null };      // demote
        if (ctx.op === 'insert') return { data: { id: 'ahsv-new' }, error: null };
        if (ctx.selectStr === 'id') return { data: cfg.oldCurrentVersion, error: null };
        if (ctx.selectStr === 'version') return { data: cfg.latestVersion, error: null };
        return { data: null, error: null };
      }
      case 'boq_items': {
        const batch = (ctx.payload ?? []) as Array<{ code: string }>;
        return { data: batch.map(b => ({ id: `boqitem-${b.code}`, code: b.code })), error: null };
      }
      case 'ahs_lines':
        return { data: null, error: null };
      case 'project_material_master':
        return { data: { id: 'master-1' }, error: null };
      case 'project_material_master_lines': {
        const batch = (ctx.payload ?? []) as Array<{ material_id: string }>;
        const hasFail = batch.some(r => cfg.failMasterMaterialIds?.has(r.material_id));
        return hasFail
          ? { data: null, error: { message: 'master line insert failed' } }
          : { data: null, error: null };
      }
      case 'material_baseline_snapshots':
        captured.snapshotBatch = ctx.payload;
        return { data: null, error: null };
      case 'plan_revisions':
        captured.revisionInsert = ctx.payload;
        return cfg.failRevisionInsert
          ? { data: null, error: { message: 'revision header insert failed' } }
          : { data: { id: 'rev-1' }, error: null };
      case 'plan_revision_lines':
        captured.revisionLineBatch = ctx.payload;
        return { data: null, error: null };
      default:
        throw new Error(`Unhandled supabase.from('${table}') op=${ctx.op} select=${ctx.selectStr}`);
    }
  };

  const makeBuilder = (table: string) => {
    const ctx: { op: string; payload: any; selectStr?: string; range?: [number, number] } = { op: 'select', payload: undefined };
    const chain: Record<string, any> = {};
    chain.select = (s?: string) => { ctx.selectStr = s; return chain; };
    const setOp = (op: string) => (arg?: unknown) => {
      ctx.op = op; ctx.payload = arg;
      mutations.push({ table, op, payload: arg });
      return chain;
    };
    chain.insert = setOp('insert');
    chain.update = setOp('update');
    chain.upsert = setOp('upsert');
    chain.delete = setOp('delete');
    for (const m of ['eq', 'neq', 'in', 'order', 'limit']) chain[m] = () => chain;
    chain.range = (from: number, to: number) => { ctx.range = [from, to]; return chain; };
    const settle = () => Promise.resolve(resolve(table, ctx));
    chain.single = () => settle();
    chain.maybeSingle = () => settle();
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle().then(res, rej);
    return chain;
  };

  return {
    fromImpl: (table: string) => { tablesTouched.add(table); return makeBuilder(table); },
    mutations,
    tablesTouched,
    captured,
  };
}

const REV_SUMMARY = (over = 0, raise = 0): PlanRevisionSummary => ({
  raisedAbsolvingOverage: over,
  raised: raise,
  loweredBelowOrdered: 0,
  removedWithActivity: 0,
  added: 0,
  lowered: 0,
  noActivityChanged: 0,
  warningCount: over + raise,
});

const REV_LINE: PlanRevisionLine = {
  material_id: 'id-d13',
  planned_before: 10,
  planned_after: 20,
  ordered_at_time: 15,
  requested_at_time: 0,
  classification: 'RAISE_ABSOLVING_OVERAGE',
};

const revCtx = (over: number, raise: number, lines: PlanRevisionLine[]): RevisionContext => ({
  diffLines: lines,
  summary: REV_SUMMARY(over, raise),
  acknowledgedAt: '2026-07-12T00:00:00Z',
  acknowledgedBy: 'user-1',
  notifySummaryText: 'Rencana material diperbarui.',
});

describe('publishBaselineV2 — re-publish wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('(a) refuses a re-publish with no revisionContext BEFORE any mutation (zero writes)', async () => {
    const h = makePubHarness({
      stagingRows: pubStagingRows(),
      catalog: PUB_CATALOG,
      oldCurrentVersion: { id: 'ahsv-old' }, // a current version exists → re-publish
      latestVersion: { version: 1 },
    });
    mockSupabase.from.mockImplementation(h.fromImpl as never);

    const result = await publishBaselineV2('sess-1', 'proj-1'); // no options

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/acknowledge/i);
    // Fail-loud is BEFORE demote/insert — nothing was written.
    expect(h.mutations).toHaveLength(0);
    expect(h.tablesTouched.has('plan_revisions')).toBe(false);
  });

  it('(b) a plan_revisions header insert failure is non-fatal: publish succeeds with a warning', async () => {
    const h = makePubHarness({
      stagingRows: pubStagingRows(),
      catalog: PUB_CATALOG,
      oldCurrentVersion: { id: 'ahsv-old' },
      latestVersion: { version: 1 },
      failRevisionInsert: true,
    });
    mockSupabase.from.mockImplementation(h.fromImpl as never);

    const result = await publishBaselineV2('sess-1', 'proj-1', {
      revisionContext: revCtx(0, 1, [REV_LINE]),
    });

    expect(result.success).toBe(true);
    expect(result.warnings?.some(w => /plan_revisions header failed/i.test(w))).toBe(true);
    // Header failed → no lines written, no notification dispatched.
    expect(h.tablesTouched.has('plan_revision_lines')).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('(c) excludes a failed-master-line material from the baseline snapshot (2.10 gating)', async () => {
    const h = makePubHarness({
      stagingRows: pubStagingRows(),
      catalog: PUB_CATALOG,
      oldCurrentVersion: null,          // first publish — no acknowledgment needed
      latestVersion: null,
      failMasterMaterialIds: new Set(['id-pcc']), // pcc's master line fails
    });
    mockSupabase.from.mockImplementation(h.fromImpl as never);

    const result = await publishBaselineV2('sess-1', 'proj-1');

    expect(result.success).toBe(true);
    const snapshot = (h.captured.snapshotBatch ?? []) as Array<{ material_id: string }>;
    const ids = snapshot.map(s => s.material_id);
    expect(ids).toContain('id-d13');      // clean material anchored
    expect(ids).not.toContain('id-pcc');  // failed material excluded
  });

  it('(d) a first publish attempts NO plan_revisions write', async () => {
    const h = makePubHarness({
      stagingRows: pubStagingRows(),
      catalog: PUB_CATALOG,
      oldCurrentVersion: null,  // no current version → first publish
      latestVersion: null,
    });
    mockSupabase.from.mockImplementation(h.fromImpl as never);

    const result = await publishBaselineV2('sess-1', 'proj-1');

    expect(result.success).toBe(true);
    expect(h.tablesTouched.has('plan_revisions')).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('(e) threads the raise-class count into notify_plan_revised (Fix 5b principal gate)', async () => {
    const h = makePubHarness({
      stagingRows: pubStagingRows(),
      catalog: PUB_CATALOG,
      oldCurrentVersion: { id: 'ahsv-old' },
      latestVersion: { version: 1 },
    });
    mockSupabase.from.mockImplementation(h.fromImpl as never);

    const result = await publishBaselineV2('sess-1', 'proj-1', {
      revisionContext: revCtx(1, 2, [REV_LINE]), // 1 absolving + 2 plain raises = 3
    });

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'notify_plan_revised',
      expect.objectContaining({ p_project_id: 'proj-1', p_raise_count: 3 }),
    );
  });
});
