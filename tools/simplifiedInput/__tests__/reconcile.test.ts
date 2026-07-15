// reconcile.ts → excelParser.ts → baseline.ts → supabase.ts pulls in
// react-native-url-polyfill (ESM) which Jest can't parse. Mock supabase, as the
// other parser tests do (see tools/__tests__/excelParser.test.ts).
jest.mock('../../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { detectOthersConflicts, flagOthersConflicts } from '../reconcile';
import type { CatalogEntry } from '../../excelParser';
import type { StagingRowV2 } from '../../boqParserV2/types';

const catalog: CatalogEntry[] = [
  { code: 'SEM', name: 'Semen PC', category: 'x', tier: 2, unit: 'sak', aliases: [] },
  { code: 'PSR', name: 'Pasir pasang', category: 'x', tier: 2, unit: 'm3', aliases: [] },
];

function anchorWith(materials: any[]): StagingRowV2 {
  return {
    row_type: 'boq',
    row_number: 1,
    raw_data: { others_materials: materials },
    parsed_data: {},
    needs_review: false,
    confidence: 1,
    review_status: 'PENDING',
    cost_basis: 'inline_split',
    parent_ahs_staging_id: null,
    ref_cells: null,
    cost_split: null,
  } as unknown as StagingRowV2;
}

describe('detectOthersConflicts', () => {
  it('flags a tier mismatch (file Tier 3 vs catalog tier 2)', () => {
    const anchor = anchorWith([{ name: 'Pasir Pasang', tier: 3, unit: 'm3', volume: 10, unitPrice: 1 }]);
    const conflicts = detectOthersConflicts(anchor, catalog, new Map());
    expect(conflicts).toEqual([
      { name: 'Pasir Pasang', matched: true, fileTier: 3, catalogTier: 2, filePrice: 1, kind: 'tier' },
    ]);
  });
  it('reports no conflict when file tier equals catalog tier', () => {
    const anchor = anchorWith([{ name: 'Semen PC', tier: 2, unit: 'sak', volume: 1, unitPrice: 1 }]);
    expect(detectOthersConflicts(anchor, catalog, new Map())).toEqual([]);
  });
  it('flags an unmatched material', () => {
    const anchor = anchorWith([{ name: 'Widget X', tier: 2, unit: 'bh', volume: 1, unitPrice: 1 }]);
    const conflicts = detectOthersConflicts(anchor, catalog, new Map());
    expect(conflicts[0]).toMatchObject({ name: 'Widget X', matched: false, kind: 'unmatched' });
  });
});

describe('flagOthersConflicts', () => {
  it('sets needs_review and records conflicts when any exist', () => {
    const anchor = anchorWith([]);
    flagOthersConflicts(anchor, [
      { name: 'Pasir Pasang', matched: true, fileTier: 3, catalogTier: 2, filePrice: 1, kind: 'tier' },
    ]);
    expect(anchor.needs_review).toBe(true);
    expect((anchor.raw_data as any).material_conflicts).toHaveLength(1);
  });
  it('leaves needs_review untouched when there are no conflicts', () => {
    const anchor = anchorWith([]);
    flagOthersConflicts(anchor, []);
    expect(anchor.needs_review).toBe(false);
  });
});
