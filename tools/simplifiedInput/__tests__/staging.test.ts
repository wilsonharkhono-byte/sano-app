import { splitLabel, makeBoqStagingRow } from '../staging';
import type { BoqRowRecipe } from '../../boqParserV2/types';

const emptyRecipe: BoqRowRecipe = {
  perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
  subkonPerUnit: 0,
  components: [],
  markup: null,
  totalCached: 0,
};

describe('splitLabel', () => {
  it('splits "Zone ; Element" into chapter + sub_chapter', () => {
    expect(splitLabel('Lt. Basement ; Kolom')).toEqual({ chapter: 'Lt. Basement', subChapter: 'Kolom' });
  });
  it('treats a label with no semicolon as chapter-only', () => {
    expect(splitLabel('Bunker')).toEqual({ chapter: 'Bunker', subChapter: null });
  });
  it('handles a trailing semicolon as null sub_chapter', () => {
    expect(splitLabel('Foo ;')).toEqual({ chapter: 'Foo', subChapter: null });
  });
});

describe('makeBoqStagingRow', () => {
  const base = {
    code: 'T1-001',
    label: 'Lt. Basement ; Kolom',
    chapter: 'Lt. Basement',
    subChapter: 'Kolom',
    unit: 'm³',
    planned: 39.02,
    recipe: emptyRecipe,
    sourceSheet: 'SANO Input Tier 1',
    sourceRow: 14,
    rowNumber: 1,
  };
  it('emits a boq row with chapter/subChapter in raw_data (where publish reads them)', () => {
    const row = makeBoqStagingRow(base);
    expect(row.row_type).toBe('boq');
    expect(row.raw_data.chapter).toBe('Lt. Basement');
    expect(row.raw_data.subChapter).toBe('Kolom');
    expect(row.parsed_data.code).toBe('T1-001');
    expect(row.parsed_data.planned).toBe(39.02);
    expect(row.parsed_data.recipe).toBe(emptyRecipe);
    expect(row.needs_review).toBe(false);
  });
  it('flags needs_review when planned is not > 0', () => {
    expect(makeBoqStagingRow({ ...base, planned: 0 }).needs_review).toBe(true);
  });
});
