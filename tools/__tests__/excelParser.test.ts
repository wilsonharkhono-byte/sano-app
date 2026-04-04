// Mock supabase to prevent react-native-url-polyfill ESM import in Jest
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { disambiguateBoqLabels, type ParsedBoqItem } from '../excelParser';

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
