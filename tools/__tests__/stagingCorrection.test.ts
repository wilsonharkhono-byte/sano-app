import { draftFromParsedData, editableParsedFields, applyCorrectionDraft } from '../stagingCorrection';

/** A Tier-1 staged row's parsed_data: scalar fields plus the structural recipe. */
const tier1ParsedData = {
  code: 'T1-001',
  label: 'Pagar Belakang elv. -7.40 ; Pile Cap, Sloof, Plat Lajur',
  unit: 'm³',
  planned: 10.4447,
  chapter: 'Pagar Belakang elv. -7.40',
  sub_chapter: 'Pile Cap, Sloof, Plat Lajur',
  unit_price: null,
  subkon_cost_per_unit: 0,
  total_cost: 0,
  recipe: {
    perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
    subkonPerUnit: 0,
    components: [
      { materialName: 'Beton Readymix', quantityPerUnit: 1, unit: 'm³' },
      { materialName: 'Besi beton polos 8 mm', quantityPerUnit: 2.585, unit: 'batang' },
    ],
    markup: null,
    totalCached: 0,
  },
};

describe('correction editor field selection', () => {
  it('never offers a structural (object/array) field as a text input', () => {
    expect(editableParsedFields(tier1ParsedData)).toEqual([
      'code', 'label', 'unit', 'planned', 'chapter', 'sub_chapter',
      'unit_price', 'subkon_cost_per_unit', 'total_cost',
    ]);
  });

  it('builds the draft from scalars only — no "[object Object]" ever reaches a field', () => {
    const draft = draftFromParsedData(tier1ParsedData);
    expect(draft.recipe).toBeUndefined();
    expect(Object.values(draft)).not.toContain('[object Object]');
    expect(draft.planned).toBe('10.4447');
    expect(draft.unit_price).toBe('');
  });
});

describe('applyCorrectionDraft', () => {
  it('REGRESSION: an estimator edit no longer wipes recipe.components', () => {
    // The old editor stringified every parsed_data value into the draft, so
    // `recipe` came back as the string "[object Object]"; publish then read
    // `recipe?.components ?? []` off a string and staged the row with ZERO
    // materials. Staged row T1-001 landed in exactly that state.
    const draft = draftFromParsedData(tier1ParsedData);
    draft.planned = '11';
    const next = applyCorrectionDraft(tier1ParsedData, draft) as typeof tier1ParsedData;
    expect(next.planned).toBe(11);
    expect(next.recipe).toEqual(tier1ParsedData.recipe);
    expect(next.recipe.components).toHaveLength(2);
  });

  it('keeps the original coercion: numbers, booleans, nulls, comma decimals', () => {
    const original = { planned: 1, is_orphan: false, note: null, label: 'X' };
    const next = applyCorrectionDraft(original, {
      planned: '2,5', is_orphan: 'ya', note: '  ', label: 'Y',
    });
    expect(next).toEqual({ planned: 2.5, is_orphan: true, note: null, label: 'Y' });
  });

  it('keeps the previous number when the draft is not a number (never NaN)', () => {
    expect(applyCorrectionDraft({ planned: 3 }, { planned: 'abc' })).toEqual({ planned: 3 });
  });

  it('ignores draft keys the row does not have, so an edit cannot invent fields', () => {
    expect(applyCorrectionDraft({ label: 'X' }, { label: 'Y', injected: 'Z' })).toEqual({ label: 'Y' });
  });

  it('leaves a field absent from the draft untouched', () => {
    expect(applyCorrectionDraft({ label: 'X', unit: 'm³' }, { label: 'Y' }))
      .toEqual({ label: 'Y', unit: 'm³' });
  });
});
