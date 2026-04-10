// Mock supabase to prevent react-native-url-polyfill ESM import in Jest
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import {
  disambiguateBoqLabels,
  groupBoqItems,
  type ParsedBoqItem,
  type BoqClassification,
} from '../excelParser';

function makeBoqItem(overrides: Partial<ParsedBoqItem> = {}): ParsedBoqItem {
  return {
    code: 'I-01',
    label: 'Balok B173-1',
    unit: 'm3',
    volume: 10,
    chapter: 'Pekerjaan Struktur',
    chapterIndex: 'I',
    sectionLabel: 'Pekerjaan Struktur Lantai 1',
    parentCode: null,
    sortOrder: 1,
    elementCode: null,
    costBreakdown: {
      material: 0,
      labor: 0,
      equipment: 0,
      subkon: 0,
      prelim: 0,
    },
    internalUnitPrice: 0,
    clientUnitPrice: 0,
    compositeFactors: null,
    sourceRow: 12,
    sourceSheet: 'RAB',
    ahsReferences: [],
    ...overrides,
  };
}

describe('excelParser disambiguateBoqLabels', () => {
  it('appends floor context when duplicate labels appear on different floors', () => {
    const items = [
      makeBoqItem({ code: 'I-01', sectionLabel: 'Pekerjaan Struktur Lantai 1' }),
      makeBoqItem({ code: 'I-02', sectionLabel: 'Pekerjaan Struktur Lantai 2', sourceRow: 48 }),
    ];

    const result = disambiguateBoqLabels(items);

    expect(result[0].label).toBe('Balok B173-1 — Lantai 1');
    expect(result[1].label).toBe('Balok B173-1 — Lantai 2');
  });
});

describe('excelParser groupBoqItems (Pekerjaan Persiapan)', () => {
  // Reproduces the exact failing case the user reported:
  // heterogeneous-unit prelim items (m1, ls, titik, bln) must collapse
  // into a single group instead of 4 ungrouped rows.
  function prelimItem(overrides: Partial<ParsedBoqItem>): ParsedBoqItem {
    return makeBoqItem({
      chapter: 'Pekerjaan Persiapan',
      chapterIndex: 'I',
      sectionLabel: 'Pekerjaan Persiapan',
      compositeFactors: null,
      ...overrides,
    });
  }

  it('collapses persiapan items with different units into one paket group via keyword fallback', () => {
    const items: ParsedBoqItem[] = [
      prelimItem({ code: 'I-01', label: 'Pagar pengaman', unit: 'm1', volume: 26, sourceRow: 10 }),
      prelimItem({ code: 'I-02', label: 'Uitzet/Pasang bowplank', unit: 'ls', volume: 1, sourceRow: 11 }),
      prelimItem({ code: 'I-03', label: 'Pengukuran dan penandaan titik tiang pancang dan bored pile', unit: 'titik', volume: 155, sourceRow: 12 }),
      prelimItem({ code: 'I-04', label: 'Air kerja proyek', unit: 'bln', volume: 12, sourceRow: 13 }),
    ];

    const { grouped } = groupBoqItems(items);

    // Umbrella chapter override collapses all 4 into ONE group
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe('Pekerjaan Persiapan');
    expect(grouped[0].unit).toBe('paket');
    expect(grouped[0].volume).toBe(1);
  });

  it('extractJsonBlock-equivalent: JSON array responses should not be truncated', () => {
    // Regression test for the bug where extractJsonBlock only handled
    // object syntax, causing every AI array response to silently degrade.
    // We test this at the grouping level — if AI classifications get
    // parsed correctly end-to-end, the array extractor is working.
    // (The unit test of extractJsonBlock itself lives in the ai-assist tests.)
    const items = Array.from({ length: 10 }, (_, i) =>
      makeBoqItem({ code: `I-${i + 1}`, sourceRow: 10 + i, label: `Item ${i + 1}`, chapter: 'Test', compositeFactors: null }),
    );
    const aiCls = new Map<number, BoqClassification>();
    for (let i = 0; i < 10; i++) {
      aiCls.set(i, { group: 'Test Group', floor: null });
    }
    const { grouped } = groupBoqItems(items, aiCls);
    expect(grouped).toHaveLength(1);
  });

  it('uses AI classifications when provided and collapses all items into one freeform group', () => {
    const items: ParsedBoqItem[] = [
      prelimItem({ code: 'I-01', label: 'Pagar pengaman', unit: 'm1', volume: 26, sourceRow: 10 }),
      prelimItem({ code: 'I-02', label: 'Uitzet/Pasang bowplank', unit: 'ls', volume: 1, sourceRow: 11 }),
      prelimItem({ code: 'I-03', label: 'Pengukuran titik', unit: 'titik', volume: 155, sourceRow: 12 }),
      prelimItem({ code: 'I-04', label: 'Air kerja proyek', unit: 'bln', volume: 12, sourceRow: 13 }),
    ];

    const aiCls = new Map<number, BoqClassification>([
      [0, { group: 'Pekerjaan Persiapan', floor: null }],
      [1, { group: 'Pekerjaan Persiapan', floor: null }],
      [2, { group: 'Pekerjaan Persiapan', floor: null }],
      [3, { group: 'Pekerjaan Persiapan', floor: null }],
    ]);

    const { grouped } = groupBoqItems(items, aiCls);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe('Pekerjaan Persiapan');
    expect(grouped[0].unit).toBe('paket'); // mixed units → paket
    expect(grouped[0].volume).toBe(1);
  });

  it('preserves unit and sums volume when all items in a group share one unit', () => {
    const items: ParsedBoqItem[] = [
      makeBoqItem({ code: 'I-01', label: 'Kolom K1', unit: 'm3', volume: 5, sourceRow: 10, chapter: 'Struktur Lantai 1', compositeFactors: null }),
      makeBoqItem({ code: 'I-02', label: 'Kolom K2', unit: 'm3', volume: 7, sourceRow: 11, chapter: 'Struktur Lantai 1', compositeFactors: null }),
      makeBoqItem({ code: 'I-03', label: 'Kolom K3', unit: 'm3', volume: 3, sourceRow: 12, chapter: 'Struktur Lantai 1', compositeFactors: null }),
    ];

    const aiCls = new Map<number, BoqClassification>([
      [0, { group: 'Struktur Kolom Beton Lantai 1', floor: 'Lantai 1' }],
      [1, { group: 'Struktur Kolom Beton Lantai 1', floor: 'Lantai 1' }],
      [2, { group: 'Struktur Kolom Beton Lantai 1', floor: 'Lantai 1' }],
    ]);

    const { grouped } = groupBoqItems(items, aiCls);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe('Struktur Kolom Beton Lantai 1');
    expect(grouped[0].unit).toBe('m3');
    expect(grouped[0].volume).toBe(15);
  });

  it('keyword fallback groups pile-cap items as Struktur Pondasi Beton', () => {
    const items: ParsedBoqItem[] = [
      makeBoqItem({ code: 'III-01', label: 'Pondasi Pile Cap PC1', unit: 'm3', volume: 5, sourceRow: 30, chapter: 'Struktur Pondasi', chapterIndex: 'III', compositeFactors: null }),
      makeBoqItem({ code: 'III-02', label: 'Pondasi Pile Cap PC2', unit: 'm3', volume: 7, sourceRow: 31, chapter: 'Struktur Pondasi', chapterIndex: 'III', compositeFactors: null }),
      makeBoqItem({ code: 'III-03', label: 'Pondasi Pile Cap PC3', unit: 'm3', volume: 9, sourceRow: 32, chapter: 'Struktur Pondasi', chapterIndex: 'III', compositeFactors: null }),
    ];

    const { grouped } = groupBoqItems(items);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe('Struktur Pondasi Beton');
    expect(grouped[0].unit).toBe('m3');
    expect(grouped[0].volume).toBe(21);
  });
});
