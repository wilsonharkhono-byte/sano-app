import {
  ADD_LINE_MESSAGES,
  addProjectMaterialLine,
  findIncrementalAddsMissingFromStaging,
  mapAddLineError,
  validateAddLineInput,
  parseIdNumber,
  formatIdNumber,
  type AddLineInput,
} from '../addProjectMaterialLine';

const base: AddLineInput = {
  materialId: 'm-1',
  tier: 2,
  isAsset: false,
  unit: 'sak',
  plannedQty: 10,
  unitPrice: null,
};

describe('validateAddLineInput', () => {
  it('accepts a Tier 2 line without a price', () => {
    expect(validateAddLineInput(base)).toEqual({ ok: true });
  });

  it('accepts a Tier 3 line with a positive price', () => {
    expect(validateAddLineInput({ ...base, tier: 3, unitPrice: 2500000 })).toEqual({ ok: true });
  });

  it.each<[Partial<AddLineInput>, string]>([
    [{ materialId: null }, 'ADD_LINE_MATERIAL'],
    [{ isAsset: true }, 'ADD_LINE_ASSET'],
    [{ tier: 1 }, 'ADD_LINE_TIER1'],
    [{ unit: '  ' }, 'ADD_LINE_UNIT'],
    [{ unit: null }, 'ADD_LINE_UNIT'],
    [{ plannedQty: 0 }, 'ADD_LINE_QTY'],
    [{ plannedQty: -3 }, 'ADD_LINE_QTY'],
    [{ plannedQty: Number.NaN }, 'ADD_LINE_QTY'],
    [{ plannedQty: null }, 'ADD_LINE_QTY'],
    [{ tier: 3, unitPrice: null }, 'ADD_LINE_PRICE_REQUIRED'],
    [{ tier: 3, unitPrice: 0 }, 'ADD_LINE_PRICE'],
    [{ tier: 2, unitPrice: -1 }, 'ADD_LINE_PRICE'],
    [{ tier: 2, unitPrice: Number.NaN }, 'ADD_LINE_PRICE'],
  ])('rejects %o with %s', (patch, code) => {
    const result = validateAddLineInput({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.message).toBe(ADD_LINE_MESSAGES[result.code]);
    }
  });

  it('checks asset before tier and tier before unit (server order)', () => {
    const r = validateAddLineInput({ ...base, isAsset: true, tier: 1, unit: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ADD_LINE_ASSET');
  });
});

describe('mapAddLineError', () => {
  it('maps every prefix to its Indonesian copy', () => {
    for (const code of Object.keys(ADD_LINE_MESSAGES) as Array<keyof typeof ADD_LINE_MESSAGES>) {
      expect(mapAddLineError(new Error(`${code}: some server detail`))).toBe(ADD_LINE_MESSAGES[code]);
    }
  });

  it('maps a unique-index violation to the EXISTS copy', () => {
    expect(
      mapAddLineError({ message: 'duplicate key value violates unique constraint "uq_pmml_project_level_material"' }),
    ).toBe(ADD_LINE_MESSAGES.ADD_LINE_EXISTS);
  });

  it('passes an unknown error message through verbatim', () => {
    expect(mapAddLineError(new Error('network down'))).toBe('network down');
    expect(mapAddLineError('plain string')).toBe('plain string');
  });
});

describe('addProjectMaterialLine', () => {
  it('calls the RPC with p_-prefixed params and returns the jsonb result', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return {
          data: {
            line_id: 'l1', revision_id: 'r1', master_id: 'ms1', material_name: 'Cat tembok',
            unit: 'ltr', tier: 3, planned_after: 40, price_book_written: 'inserted', snapshot_written: true,
          },
          error: null,
        };
      },
    };
    const result = await addProjectMaterialLine(client, {
      projectId: 'p1', materialId: 'm1', plannedQty: 40, unitPrice: 85000, note: 'tambahan lantai 2',
    });
    expect(calls).toEqual([{
      fn: 'add_project_material_line',
      args: { p_project_id: 'p1', p_material_id: 'm1', p_planned_qty: 40, p_unit_price: 85000, p_note: 'tambahan lantai 2' },
    }]);
    expect(result.material_name).toBe('Cat tembok');
    expect(result.snapshot_written).toBe(true);
  });

  it('sends null for an omitted price and note, and throws the RPC error', async () => {
    const client = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        expect(args.p_unit_price).toBeNull();
        expect(args.p_note).toBeNull();
        return { data: null, error: { message: 'ADD_LINE_EXISTS: already planned' } };
      },
    };
    await expect(
      addProjectMaterialLine(client, { projectId: 'p1', materialId: 'm1', plannedQty: 1, unitPrice: null, note: null }),
    ).rejects.toMatchObject({ message: 'ADD_LINE_EXISTS: already planned' });
  });
});

describe('findIncrementalAddsMissingFromStaging', () => {
  const revisions = [
    { summary: { kind: 'INCREMENTAL_ADD', material_id: 'a', material_name: 'Cat tembok' } },
    { summary: { kind: 'INCREMENTAL_ADD', material_id: 'b', material_name: 'Fitting dan aksesoris pipa' } },
    { summary: { kind: 'INCREMENTAL_ADD', material_id: 'b', material_name: 'Fitting dan aksesoris pipa' } },
    { summary: { added: 2, raised: 0 } },
    { summary: null },
    { summary: { kind: 'INCREMENTAL_ADD' } },
  ];

  it('returns only incremental adds absent from the staged ids, deduplicated', () => {
    expect(findIncrementalAddsMissingFromStaging(revisions, ['a', 'zzz'])).toEqual([
      { material_id: 'b', material_name: 'Fitting dan aksesoris pipa' },
    ]);
  });

  it('returns nothing when every incremental add is staged', () => {
    expect(findIncrementalAddsMissingFromStaging(revisions, ['a', 'b'])).toEqual([]);
  });

  it('falls back to the id when the name is missing', () => {
    expect(findIncrementalAddsMissingFromStaging(
      [{ summary: { kind: 'INCREMENTAL_ADD', material_id: 'c' } }], [],
    )).toEqual([{ material_id: 'c', material_name: 'c' }]);
  });
});

describe('parseIdNumber (Indonesian convention: "." thousands, "," decimal)', () => {
  it('returns null for blank input', () => {
    expect(parseIdNumber('')).toBeNull();
    expect(parseIdNumber('   ')).toBeNull();
  });

  it.each<[string, number]>([
    ['2500000', 2500000],
    ['2.500.000', 2500000],
    ['2.500.000,50', 2500000.5],
    ['Rp 2.500.000', 2500000],
    ['Rp2.500.000', 2500000],
    ['12,5', 12.5],
    ['0,5', 0.5],
    ['1.000', 1000],
    ['1.000,5', 1000.5],
    ['7', 7],
    ['-5', -5],
  ])('parses %s as %d', (raw, expected) => {
    expect(parseIdNumber(raw)).toBe(expected);
  });

  it.each<string>([
    '12.5',      // single dot with a non-3-digit group: decimal typed with the wrong key — ambiguous
    '1.0000',    // malformed grouping
    '1,2,3',     // two decimal separators
    '1.000,',    // dangling decimal separator
    'abc',
    '1..000',
  ])('refuses ambiguous or malformed input %s with NaN', raw => {
    expect(Number.isNaN(parseIdNumber(raw) as number)).toBe(true);
  });
});

describe('formatIdNumber', () => {
  it.each<[number, string]>([
    [2500000, '2.500.000'],
    [12.5, '12,5'],
    [0.5, '0,5'],
    [1000.25, '1.000,25'],
    [2, '2'],
    [1000, '1.000'],
    [1234567.891, '1.234.567,891'],
  ])('formats %d as %s', (n, expected) => {
    expect(formatIdNumber(n)).toBe(expected);
  });
});
