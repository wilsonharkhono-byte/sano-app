import {
  isRebarCode,
  sortRebarMaterials,
  buildRebarCells,
  groupsWithRebarDemand,
  groupRebarSisaBatang,
  buildMatrixRows,
  splitBasisFor,
  largestRemainderSplit,
  defaultSplit,
  expandRebarMatrix,
  type RebarMaterial,
  type RebarGroupEnvelope,
  type RebarCell,
} from '../rebarMatrix';

const bar = (id: string, code: string, kgPerBatang: number, name = code): RebarMaterial => ({
  id, code, name, unit: 'kg', supplierUnit: 'batang', kgPerBatang,
});

const D13 = bar('m-d13', 'REB-DE13', 12.5, 'Besi beton ulir 13 mm');
const D16 = bar('m-d16', 'REB-DE16', 18.94, 'Besi beton ulir 16 mm');
const P08 = bar('m-p08', 'REB-PL08', 4.74, 'Besi beton polos 8 mm');
const BARS = [P08, D16, D13];

const env = (groupKey: string, rows: RebarGroupEnvelope['rows']): RebarGroupEnvelope => ({
  groupKey, groupLabel: groupKey, rows,
});

describe('isRebarCode', () => {
  it('accepts REB- codes only', () => {
    expect(isRebarCode('REB-DE13')).toBe(true);
    expect(isRebarCode('CEM-PCC40')).toBe(false);
    expect(isRebarCode(null)).toBe(false);
  });
});

describe('sortRebarMaterials', () => {
  it('orders ulir before polos, then diameter ascending', () => {
    expect(sortRebarMaterials(BARS).map(m => m.code))
      .toEqual(['REB-DE13', 'REB-DE16', 'REB-PL08']);
  });

  it('parks an unrecognized REB- shape last', () => {
    const odd = bar('m-odd', 'REB-WRM01', 1);
    expect(sortRebarMaterials([odd, D13]).map(m => m.code))
      .toEqual(['REB-DE13', 'REB-WRM01']);
  });
});

describe('buildRebarCells', () => {
  const groups = [
    env('pondasi', [
      { material_id: 'm-d13', planned: 1000, ordered: 200, requested: 100 },
      { material_id: 'm-semen', planned: 500, ordered: 0, requested: 0 },
    ]),
    env('kolom-1', [
      { material_id: 'm-d13', planned: 500, ordered: 600, requested: 0 },
      { material_id: 'm-d16', planned: 0, ordered: 0, requested: 0 },
    ]),
  ];

  it('keeps only rebar materials and floors remaining at zero', () => {
    const cells = buildRebarCells(BARS, groups);
    expect(cells).toEqual([
      { materialId: 'm-d13', groupKey: 'pondasi', plannedBase: 1000, remainingBase: 700 },
      { materialId: 'm-d13', groupKey: 'kolom-1', plannedBase: 500, remainingBase: 0 },
      { materialId: 'm-d16', groupKey: 'kolom-1', plannedBase: 0, remainingBase: 0 },
    ]);
  });

  it('lists only groups with planned rebar demand as the default scope', () => {
    expect(groupsWithRebarDemand(buildRebarCells(BARS, groups))).toEqual(['pondasi', 'kolom-1']);
  });

  it('reports a group total sisa in whole batang, rounded up per diameter', () => {
    // pondasi: D13 700 kg / 12.5 = 56 batang exactly; nothing else has sisa.
    expect(groupRebarSisaBatang(BARS, buildRebarCells(BARS, groups), 'pondasi')).toBe(56);
    expect(groupRebarSisaBatang(BARS, buildRebarCells(BARS, groups), 'kolom-1')).toBe(0);
  });
});

describe('buildMatrixRows', () => {
  const cells = buildRebarCells(BARS, [
    env('pondasi', [{ material_id: 'm-d13', planned: 1000, ordered: 0, requested: 0 }]),
    env('kolom-1', [{ material_id: 'm-d13', planned: 500, ordered: 0, requested: 0 }]),
    env('kolom-1', [{ material_id: 'm-p08', planned: 100, ordered: 95, requested: 0 }]),
  ]);

  it('aggregates only the selected groups, sorted ulir → polos', () => {
    const rows = buildMatrixRows(BARS, cells, ['pondasi']);
    expect(rows.map(r => r.material.code)).toEqual(['REB-DE13', 'REB-DE16', 'REB-PL08']);
    expect(rows[0].plannedBase).toBe(1000);
    expect(rows[0].remainingBase).toBe(1000);
  });

  it('rounds remaining UP to whole batang — you cannot buy 0.4 lonjor', () => {
    const [d13] = buildMatrixRows(BARS, cells, ['pondasi', 'kolom-1']);
    expect(d13.remainingBase).toBe(1500);
    expect(d13.remainingBatang).toBe(120); // 1500 / 12.5 = 120 exactly
    const p08 = buildMatrixRows(BARS, cells, ['kolom-1']).find(r => r.material.code === 'REB-PL08')!;
    expect(p08.remainingBase).toBe(5);
    expect(p08.remainingBatang).toBe(2); // 5 / 4.74 = 1.05 → 2
  });

  it('flags a diameter with no planned demand in scope as baseline-less', () => {
    const d16 = buildMatrixRows(BARS, cells, ['pondasi']).find(r => r.material.code === 'REB-DE16')!;
    expect(d16.hasBaseline).toBe(false);
    expect(d16.plannedBase).toBe(0);
  });
});

describe('toBatang ceiling semantics for a factorless (kgPerBatang: null) material', () => {
  const nullFactorMaterial: RebarMaterial = {
    id: 'm-null', code: 'REB-DE99', name: 'Besi tanpa faktor', unit: 'kg', supplierUnit: 'batang', kgPerBatang: null,
  };

  it('buildMatrixRows rounds a fractional factorless remaining UP, not to nearest', () => {
    const cells: RebarCell[] = [
      { materialId: 'm-null', groupKey: 'pondasi', plannedBase: 5.3, remainingBase: 5.3 },
    ];
    const row = buildMatrixRows([nullFactorMaterial], cells, ['pondasi'])[0];
    expect(row.remainingBatang).toBe(6);
  });

  it('groupRebarSisaBatang rounds a fractional factorless remaining UP, not to nearest', () => {
    const cells: RebarCell[] = [
      { materialId: 'm-null', groupKey: 'pondasi', plannedBase: 5.3, remainingBase: 5.3 },
    ];
    expect(groupRebarSisaBatang([nullFactorMaterial], cells, 'pondasi')).toBe(6);
  });
});

describe('largestRemainderSplit', () => {
  it('sums exactly to the total', () => {
    expect(largestRemainderSplit(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderSplit(7, [500, 300, 200])).toEqual([4, 2, 1]);
  });

  it('always sums exactly, for every total in a sweep', () => {
    for (let total = 0; total <= 60; total += 1) {
      const parts = largestRemainderSplit(total, [7, 11, 3, 29])!;
      expect(parts.reduce((s, n) => s + n, 0)).toBe(total);
      expect(parts.every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    }
  });

  it('returns null when there is no weight to divide by — never an even guess', () => {
    expect(largestRemainderSplit(10, [0, 0, 0])).toBeNull();
    expect(largestRemainderSplit(10, [])).toBeNull();
  });

  it('rejects a non-integer or negative total (batang are whole)', () => {
    expect(largestRemainderSplit(10.5, [1, 1])).toBeNull();
    expect(largestRemainderSplit(-1, [1, 1])).toBeNull();
  });

  it('treats a NaN weight among valid ones as zero, never poisoning the split', () => {
    expect(largestRemainderSplit(10, [5, NaN, 5])).toEqual([5, 0, 5]);
  });

  it('returns null when every weight is NaN — never fabricated garbage', () => {
    expect(largestRemainderSplit(10, [NaN, NaN])).toBeNull();
  });
});

describe('defaultSplit', () => {
  const basis = [
    { groupKey: 'pondasi', plannedBase: 1000, remainingBase: 300 },
    { groupKey: 'kolom-1', plannedBase: 1000, remainingBase: 100 },
  ];

  it('divides in proportion to remaining demand', () => {
    expect(defaultSplit(40, basis)).toEqual([
      { groupKey: 'pondasi', batang: 30 },
      { groupKey: 'kolom-1', batang: 10 },
    ]);
  });

  it('falls back to planned when nothing remains anywhere', () => {
    const spent = [
      { groupKey: 'pondasi', plannedBase: 1500, remainingBase: 0 },
      { groupKey: 'kolom-1', plannedBase: 500, remainingBase: 0 },
    ];
    expect(defaultSplit(40, spent)).toEqual([
      { groupKey: 'pondasi', batang: 30 },
      { groupKey: 'kolom-1', batang: 10 },
    ]);
  });

  it('returns null with no baseline at all — the user assigns manually', () => {
    expect(defaultSplit(40, [
      { groupKey: 'pondasi', plannedBase: 0, remainingBase: 0 },
      { groupKey: 'kolom-1', plannedBase: 0, remainingBase: 0 },
    ])).toBeNull();
  });
});

describe('splitBasisFor', () => {
  it('returns one basis entry per selected group, in scope order', () => {
    const cells = buildRebarCells(BARS, [
      env('pondasi', [{ material_id: 'm-d13', planned: 1000, ordered: 100, requested: 0 }]),
      env('kolom-1', [{ material_id: 'm-d13', planned: 400, ordered: 0, requested: 0 }]),
    ]);
    expect(splitBasisFor(cells, 'm-d13', ['kolom-1', 'pondasi'])).toEqual([
      { groupKey: 'kolom-1', plannedBase: 400, remainingBase: 400 },
      { groupKey: 'pondasi', plannedBase: 1000, remainingBase: 900 },
    ]);
  });
});

describe('expandRebarMatrix', () => {
  it('emits one draft per (diameter × group) with a positive amount', () => {
    expect(expandRebarMatrix([
      { materialId: 'm-d13', splits: [
        { groupKey: 'pondasi', batang: 30 },
        { groupKey: 'kolom-1', batang: 0 },
      ] },
      { materialId: 'm-d16', splits: [{ groupKey: 'pondasi', batang: 12 }] },
    ])).toEqual([
      { materialId: 'm-d13', workGroupKey: 'pondasi', quantityBatang: 30 },
      { materialId: 'm-d16', workGroupKey: 'pondasi', quantityBatang: 12 },
    ]);
  });

  it('drops a group edited to zero or below', () => {
    expect(expandRebarMatrix([
      { materialId: 'm-d13', splits: [{ groupKey: 'pondasi', batang: -5 }] },
    ])).toEqual([]);
  });
});
