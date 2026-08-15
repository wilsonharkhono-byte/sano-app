// publishBaselineV2 → supabase pulls in react-native-url-polyfill (ESM) which
// Jest can't parse. Mock supabase, as the other publish tests do.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { malformedRecipeBoqCodes } from '../publishBaselineV2';
import type { StagingRowV2 } from '../boqParserV2/types';

function boqRow(pd: Record<string, unknown>): StagingRowV2 {
  return {
    row_type: 'boq', row_number: 1, raw_data: {}, parsed_data: pd,
    needs_review: false, confidence: 1, review_status: 'PENDING',
    cost_basis: 'inline_split', parent_ahs_staging_id: null, ref_cells: null, cost_split: null,
  } as unknown as StagingRowV2;
}

const goodRecipe = { perUnit: {}, subkonPerUnit: 0, components: [{ materialName: 'Beton Readymix' }], markup: null, totalCached: 0 };

describe('malformedRecipeBoqCodes', () => {
  // The correction editor used to stringify parsed_data.recipe to
  // "[object Object]" on save (see tools/stagingCorrection.ts). Publish read
  // `recipe?.components ?? []` off that string, found nothing, and published the
  // row with zero materials. Rows already corrupted in the DB still carry it, so
  // publish must SAY so rather than quietly plan nothing for them.
  it('flags a recipe that was flattened to a string by a bad edit', () => {
    const rows = [
      boqRow({ code: 'T1-001', recipe: '[object Object]' }),
      boqRow({ code: 'T1-002', recipe: goodRecipe }),
    ];
    expect(malformedRecipeBoqCodes(rows)).toEqual(['T1-001']);
  });

  it('flags an array-valued recipe (never a valid recipe object)', () => {
    expect(malformedRecipeBoqCodes([boqRow({ code: 'IV.A.2.7', recipe: [] })])).toEqual(['IV.A.2.7']);
  });

  it('accepts an absent recipe — prelim/earthwork rows legitimately have none', () => {
    expect(malformedRecipeBoqCodes([
      boqRow({ code: 'I-02' }),
      boqRow({ code: 'I-03', recipe: null }),
      boqRow({ code: 'I-04', recipe: { components: [] } }),
    ])).toEqual([]);
  });

  it('ignores non-boq staging rows', () => {
    const material = { ...boqRow({ code: 'OTH-001', recipe: 'x' }), row_type: 'material' } as StagingRowV2;
    expect(malformedRecipeBoqCodes([material])).toEqual([]);
  });
});
