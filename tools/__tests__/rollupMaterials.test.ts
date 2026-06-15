import {
  rollupMaterials,
  groupKeyForCode,
  type RollupInput,
} from '../rollupMaterials';

// Small helper to build a bullet with sensible defaults so each test only
// states the fields it cares about.
function bullet(overrides: Partial<RollupInput> & { code: string }): RollupInput {
  return {
    label: overrides.label ?? `Bullet ${overrides.code}`,
    subChapter: overrides.subChapter ?? null,
    chapter: overrides.chapter ?? null,
    volume: overrides.volume ?? 1,
    reconciled: overrides.reconciled ?? true,
    components: overrides.components ?? [],
    ...overrides,
  };
}

describe('groupKeyForCode', () => {
  it('drops the final dot-segment', () => {
    expect(groupKeyForCode('III.A.3.2.1')).toBe('III.A.3.2');
    expect(groupKeyForCode('III.A.4.1')).toBe('III.A.4');
  });

  it('leaves a single-segment code unchanged', () => {
    expect(groupKeyForCode('IX')).toBe('IX');
  });
});

describe('rollupMaterials — grouping', () => {
  it('groups bullets that share a parent prefix and labels by subChapter', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'III.A.3.2.1',
        label: 'Kolom K174',
        subChapter: 'Kolom Lantai 1',
        chapter: 'PEKERJAAN STRUKTUR',
        volume: 2,
        components: [{ materialName: 'Besi D13', unit: 'kg', quantityPerUnit: 90 }],
      }),
      bullet({
        code: 'III.A.3.2.2',
        label: 'Kolom K212',
        subChapter: 'Kolom Lantai 1',
        chapter: 'PEKERJAAN STRUKTUR',
        volume: 3,
        components: [{ materialName: 'Besi D13', unit: 'kg', quantityPerUnit: 90 }],
      }),
    ]);

    expect(groups.length).toBe(1);
    expect(groups[0].key).toBe('III.A.3.2');
    expect(groups[0].label).toBe('Kolom Lantai 1');
    expect(groups[0].chapter).toBe('PEKERJAAN STRUKTUR');
    expect(groups[0].bulletCount).toBe(2);
    expect(groups[0].reconciledCount).toBe(2);
  });

  it('returns multiple groups sorted by key', () => {
    const groups = rollupMaterials([
      bullet({ code: 'III.A.4.1', subChapter: 'Plat' }),
      bullet({ code: 'III.A.3.2.1', subChapter: 'Kolom' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['III.A.3.2', 'III.A.4']);
  });
});

describe('rollupMaterials — summation', () => {
  it('sums the same (material, unit) across two reconciled bullets as Σ qty×vol', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'IV.A.2.1',
        subChapter: 'Balok Lantai Atas',
        volume: 2,
        components: [{ materialName: 'Besi D8', unit: 'kg', quantityPerUnit: 75 }], // 150
      }),
      bullet({
        code: 'IV.A.2.2',
        subChapter: 'Balok Lantai Atas',
        volume: 3,
        components: [{ materialName: 'Besi D8', unit: 'kg', quantityPerUnit: 100 }], // 300
      }),
    ]);

    expect(groups.length).toBe(1);
    expect(groups[0].materials).toEqual([
      { materialName: 'Besi D8', unit: 'kg', totalQty: 450 },
    ]);
    expect(groups[0].totalVolume).toBe(5);
  });

  it('keeps a different unit for the same material as a separate line', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'IV.A.2.1',
        volume: 1,
        components: [
          { materialName: 'Multipleks', unit: 'm2', quantityPerUnit: 5 }, // 5 m2
          { materialName: 'Multipleks', unit: 'lembar', quantityPerUnit: 1.7 }, // 1.7 lembar
        ],
      }),
      bullet({
        code: 'IV.A.2.2',
        volume: 2,
        components: [
          { materialName: 'Multipleks', unit: 'm2', quantityPerUnit: 5 }, // 10 m2
        ],
      }),
    ]);

    expect(groups[0].materials).toEqual([
      { materialName: 'Multipleks', unit: 'lembar', totalQty: 1.7 },
      { materialName: 'Multipleks', unit: 'm2', totalQty: 15 },
    ]);
  });

  it('sorts materials within a group by materialName', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'IV.A.2.1',
        volume: 1,
        components: [
          { materialName: 'Usuk', unit: 'm3', quantityPerUnit: 1 },
          { materialName: 'Besi D8', unit: 'kg', quantityPerUnit: 1 },
          { materialName: 'Multipleks', unit: 'm2', quantityPerUnit: 1 },
        ],
      }),
    ]);
    expect(groups[0].materials.map((m) => m.materialName)).toEqual([
      'Besi D8',
      'Multipleks',
      'Usuk',
    ]);
  });
});

describe('rollupMaterials — exclusion (truth-correctness contract)', () => {
  it('excludes an unreconciled bullet with a reason and contributes zero', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'III.A.3.2.1',
        label: 'Kolom K174',
        subChapter: 'Kolom Lantai 1',
        volume: 2,
        reconciled: true,
        components: [{ materialName: 'Besi D13', unit: 'kg', quantityPerUnit: 90 }], // 180
      }),
      bullet({
        code: 'III.A.3.2.2',
        label: 'Kolom K212',
        subChapter: 'Kolom Lantai 1',
        volume: 5,
        reconciled: false,
        components: [{ materialName: 'Besi D13', unit: 'kg', quantityPerUnit: 90 }],
      }),
    ]);

    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.bulletCount).toBe(2);
    expect(g.reconciledCount).toBe(1);
    // Only the reconciled bullet's volume + materials count.
    expect(g.totalVolume).toBe(2);
    expect(g.materials).toEqual([
      { materialName: 'Besi D13', unit: 'kg', totalQty: 180 },
    ]);
    // The unreconciled bullet is listed with a reason.
    expect(g.excluded.length).toBe(1);
    expect(g.excluded[0].code).toBe('III.A.3.2.2');
    expect(g.excluded[0].label).toBe('Kolom K212');
    expect(g.excluded[0].reason).toMatch(/not reconciled/i);
  });

  it('excludes a reconciled bullet that has a zero-qty component', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'III.A.4.1',
        label: 'Plat P1',
        subChapter: 'Plat Lantai',
        volume: 4,
        reconciled: true,
        components: [
          { materialName: 'Readymix', unit: 'm3', quantityPerUnit: 1.05 },
          { materialName: 'Besi D10', unit: 'kg', quantityPerUnit: 0 }, // SUMIF→0 case
        ],
      }),
      bullet({
        code: 'III.A.4.2',
        label: 'Plat P2',
        subChapter: 'Plat Lantai',
        volume: 1,
        reconciled: true,
        components: [{ materialName: 'Readymix', unit: 'm3', quantityPerUnit: 1.05 }], // 1.05
      }),
    ]);

    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.reconciledCount).toBe(1); // only P2 contributes
    expect(g.totalVolume).toBe(1);
    // The zero-qty bullet contributes NOTHING — not even its Readymix line.
    expect(g.materials).toEqual([
      { materialName: 'Readymix', unit: 'm3', totalQty: 1.05 },
    ]);
    expect(g.excluded.length).toBe(1);
    expect(g.excluded[0].code).toBe('III.A.4.1');
    expect(g.excluded[0].reason).toMatch(/zero\/missing quantity/i);
    expect(g.excluded[0].reason).toContain('Besi D10');
  });

  it('excludes a bullet with a component missing a material name', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'V.A.1.1',
        label: 'Mystery item',
        volume: 1,
        reconciled: true,
        components: [
          { materialName: '', unit: 'kg', quantityPerUnit: 10 },
        ],
      }),
    ]);
    const g = groups[0];
    expect(g.reconciledCount).toBe(0);
    expect(g.totalVolume).toBe(0);
    expect(g.materials).toEqual([]);
    expect(g.excluded[0].reason).toMatch(/missing\/empty material name/i);
  });
});

describe('rollupMaterials — edge cases', () => {
  it('groups a single-segment code under itself', () => {
    const groups = rollupMaterials([
      bullet({
        code: 'IX',
        label: 'Lump-sum item',
        subChapter: 'Pekerjaan Lain-lain',
        volume: 1,
        components: [{ materialName: 'Misc', unit: 'ls', quantityPerUnit: 1 }],
      }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].key).toBe('IX');
    expect(groups[0].label).toBe('Pekerjaan Lain-lain');
    expect(groups[0].materials).toEqual([
      { materialName: 'Misc', unit: 'ls', totalQty: 1 },
    ]);
  });

  it('returns an empty array for no input', () => {
    expect(rollupMaterials([])).toEqual([]);
  });

  it('takes the group label from the first bullet that has one', () => {
    const groups = rollupMaterials([
      bullet({ code: 'III.A.4.1', subChapter: null }),
      bullet({ code: 'III.A.4.2', subChapter: 'Plat Lantai' }),
    ]);
    expect(groups[0].label).toBe('Plat Lantai');
  });
});
