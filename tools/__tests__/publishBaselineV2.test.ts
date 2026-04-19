jest.mock('../supabase', () => ({ supabase: {} }));

import { topoSortBlocks, flattenBlock, type FlattenedLine } from '../publishBaselineV2';

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

describe('flattenBlock', () => {
  it('emits a single ahs_line for a catalog component', () => {
    const components = [
      {
        row_number: 10,
        row_type: 'ahs' as const,
        parsed_data: { material_name: 'Semen', unit_price: 75000 },
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
