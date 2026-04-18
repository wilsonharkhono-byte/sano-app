jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import * as XLSX from 'xlsx';
import {
  buildOpnameProgressImportPlan,
  buildContractRateImportPlan,
  mergeContractRates,
  parseOpnameProgressWorkbook,
  type MandorContractRate,
  type OpnameLine,
} from '../opname';
import type { ParsedWorkbook } from '../excelParser';

function makeRate(overrides: Partial<MandorContractRate> = {}): MandorContractRate {
  return {
    id: 'rate-1',
    contract_id: 'contract-1',
    boq_item_id: 'boq-1',
    contracted_rate: 170000,
    boq_labor_rate: 155000,
    unit: 'm3',
    notes: null,
    boq_code: 'I-01',
    boq_label: 'Balok B173-1 — Lantai 1',
    boq_volume: 10,
    variance_pct: undefined,
    ...overrides,
  };
}

function makeLine(overrides: Partial<OpnameLine> = {}): OpnameLine {
  return {
    id: 'line-1',
    header_id: 'header-1',
    boq_item_id: 'boq-1',
    description: 'Balok B173-1 — Lantai 1',
    boq_code: 'I-01',
    boq_label: 'Balok B173-1 — Lantai 1',
    unit: 'm3',
    budget_volume: 10,
    contracted_rate: 170000,
    boq_labor_rate: 155000,
    cumulative_pct: 25,
    verified_pct: null,
    prev_cumulative_pct: 10,
    this_week_pct: 15,
    cumulative_amount: 425000,
    this_week_amount: 255000,
    is_tdk_acc: false,
    tdk_acc_reason: null,
    notes: null,
    ...overrides,
  };
}

describe('opname contract rates', () => {
  it('keeps saved boq_labor_rate instead of adding live AHS values on top', () => {
    const existing = [makeRate()];
    const merged = mergeContractRates('contract-1', existing, [
      {
        boq_item_id: 'boq-1',
        boq_code: 'I-01',
        boq_label: 'Balok B173-1 — Lantai 1',
        unit: 'm3',
        budget_volume: 10,
        labor_rate_per_unit: 120000,
      },
      {
        boq_item_id: 'boq-1',
        boq_code: 'I-01',
        boq_label: 'Balok B173-1 — Lantai 1',
        unit: 'm3',
        budget_volume: 10,
        labor_rate_per_unit: 35000,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].boq_labor_rate).toBe(155000);
  });

  it('builds a bulk import plan by matching BoQ code first', () => {
    const currentRates = [makeRate({ contracted_rate: 0, boq_labor_rate: 150000 })];
    const parsed = {
      projectInfo: {
        fileName: 'mandor.xlsx',
        sheetNames: ['RAB'],
        rabSheets: ['RAB'],
        ahsSheet: null,
        materialSheet: null,
        upahSheet: null,
      },
      boqItems: [
        {
          code: 'I-01',
          label: 'Balok B173-1 — Lantai 1',
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
            labor: 185000,
            equipment: 0,
            subkon: 0,
            prelim: 0,
          },
          internalUnitPrice: 0,
          clientUnitPrice: 0,
          sourceRow: 25,
          sourceSheet: 'RAB',
          compositeFactors: null,
          ahsReferences: [],
        },
      ],
      ahsBlocks: [],
      materials: [],
      laborRates: [],
      markupFactors: [],
      anomalies: [],
      ahsRowMap: new Map(),
      rabToAhsLinks: new Map(),
    } as ParsedWorkbook;

    const plan = buildContractRateImportPlan(currentRates, parsed);

    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({
      boq_item_id: 'boq-1',
      contracted_rate: 185000,
      boq_labor_rate: 150000,
      source_field: 'labor_breakdown',
    });
  });
});

describe('opname progress import', () => {
  it('parses progress workbook rows and matches by code first', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['TEMPLATE IMPORT PROGRESS OPNAME'],
      ['Isi kolom Progress (%) lalu upload kembali'],
      ['Status', 'DRAFT', '', 'Minggu', 10],
      [],
      ['Kode BoQ', 'Uraian Pekerjaan', 'Progress (%)'],
      ['I-01', 'Balok B173-1 — Lantai 1', '26%'],
      ['I-02', 'Kolom K1', '0.375'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Progress');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const importedRows = await parseOpnameProgressWorkbook(buffer, 'Progress');
    expect(importedRows).toEqual([
      expect.objectContaining({
        boq_code: 'I-01',
        description: 'Balok B173-1 — Lantai 1',
        progress_pct: 26,
        source_row: 6,
      }),
      expect.objectContaining({
        boq_code: 'I-02',
        description: 'Kolom K1',
        progress_pct: 37.5,
        source_row: 7,
      }),
    ]);

    const plan = buildOpnameProgressImportPlan([
      makeLine(),
      makeLine({
        id: 'line-2',
        boq_item_id: 'boq-2',
        boq_code: 'I-02',
        boq_label: 'Kolom K1',
        description: 'Kolom K1',
      }),
    ], importedRows);

    expect(plan.matches).toHaveLength(2);
    expect(plan.matchCounts.boq_code).toBe(2);
    expect(plan.matches[1]).toMatchObject({
      line_id: 'line-2',
      progress_pct: 37.5,
      match_by: 'boq_code',
    });
  });
});
