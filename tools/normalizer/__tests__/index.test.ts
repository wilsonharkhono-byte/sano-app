import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { normalizeWorkbook, makeAnalyzeBlockFromAnalyzer } from '../index';
import type { BlockSchema } from '../types';

const AAL5 = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ', 'RAB R1 Pakuwon Indah AAL-5.xlsx');
const skip = !fs.existsSync(AAL5);
const itx = skip ? it.skip : it;

// Bekisting key is the FIRST COMPONENT ROW of the Bekisting Balok block
// (Analisa!F47 = Multipleks row), not the Harga-per-m² summary cell at F55.
// findBlockIdsFor re-anchors to the block's first component row so the Opus
// context window captures all sub-items above the bekisting cost cell.
const FIXED_SCHEMAS: Record<string, BlockSchema> = {
  'Analisa!F47': {
    blockId: 'Analisa!F47', blockType: 'bekisting', elementHint: 'Balok',
    cycleFactor: 4, ratioBasis: 'per_m2_form_per_cycle', rolledUpTotalPerNativeUnit: 251113,
    confidence: 'high', notes: null,
    subItems: [
      { materialName: 'Multipleks 15 mm', specNote: null, qtyPerNativeUnit: 2.0, nativeUnit: 'lbr', unitPrice: 200000, includedInRolledUpTotal: true },
      { materialName: 'Usuk 5/7 (vertikal)', specNote: null, qtyPerNativeUnit: 9.0, nativeUnit: 'btg', unitPrice: 47600, includedInRolledUpTotal: true },
      { materialName: 'Usuk 5/7 (horizontal)', specNote: null, qtyPerNativeUnit: 3.0, nativeUnit: 'btg', unitPrice: 47600, includedInRolledUpTotal: true },
      { materialName: 'Paku', specNote: null, qtyPerNativeUnit: 1.5, nativeUnit: 'kg', unitPrice: 13000, includedInRolledUpTotal: true },
      { materialName: 'Form oil', specNote: null, qtyPerNativeUnit: 0.5, nativeUnit: 'ltr', unitPrice: 27500, includedInRolledUpTotal: true },
      { materialName: 'Perancah Bekisting Balok', specNote: null, qtyPerNativeUnit: 1.0, nativeUnit: 'm2', unitPrice: 150000, includedInRolledUpTotal: false },
    ],
  },
  'Analisa!F128': {
    blockId: 'Analisa!F128', blockType: 'pembesian', elementHint: null,
    cycleFactor: null, ratioBasis: 'per_kg_finished_rebar', rolledUpTotalPerNativeUnit: 9918,
    confidence: 'high', notes: null,
    subItems: [
      { materialName: 'Besi beton', specNote: null, qtyPerNativeUnit: 1.05, nativeUnit: 'kg', unitPrice: 9000, includedInRolledUpTotal: true },
      { materialName: 'Beton decking', specNote: null, qtyPerNativeUnit: 1.0, nativeUnit: 'kg', unitPrice: 100, includedInRolledUpTotal: true },
      { materialName: 'Bendrat', specNote: null, qtyPerNativeUnit: 0.02, nativeUnit: 'kg', unitPrice: 17500, includedInRolledUpTotal: true },
    ],
  },
  'Analisa!F103': {
    blockId: 'Analisa!F103', blockType: 'concrete', elementHint: 'Balok',
    cycleFactor: null, ratioBasis: 'per_m3_concrete', rolledUpTotalPerNativeUnit: 2670570,
    confidence: 'high', notes: null,
    subItems: [
      { materialName: 'Beton readymix K-350', specNote: 'slump 18', qtyPerNativeUnit: 1.05, nativeUnit: 'm3', unitPrice: 1043400, includedInRolledUpTotal: true },
      { materialName: 'Sewa peralatan', specNote: null, qtyPerNativeUnit: 1.0, nativeUnit: 'm3', unitPrice: 75000, includedInRolledUpTotal: true },
      { materialName: 'Upah cor, besi, bekisting borongan', specNote: null, qtyPerNativeUnit: 1.0, nativeUnit: 'm3', unitPrice: 1500000, includedInRolledUpTotal: true },
    ],
  },
};

describe('makeAnalyzeBlockFromAnalyzer', () => {
  it('caches schemas per blockId — only one call to the underlying analyzer per id', async () => {
    const mockSchema: BlockSchema = {
      blockId: 'Analisa!F55', blockType: 'bekisting', elementHint: 'Balok',
      cycleFactor: 4, ratioBasis: 'per_m2_form_per_cycle', rolledUpTotalPerNativeUnit: 251113,
      confidence: 'high', notes: null, subItems: [],
    };
    const underlyingFn = jest.fn().mockResolvedValue(mockSchema);
    const analyze = makeAnalyzeBlockFromAnalyzer(underlyingFn, [
      { sheet: 'Analisa', address: 'F55', row: 55, col: 5, value: 'X', formula: null },
    ]);
    const a = await analyze('Analisa!F55');
    const b = await analyze('Analisa!F55');
    expect(underlyingFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('different blockIds → separate calls', async () => {
    const underlyingFn = jest.fn()
      .mockResolvedValueOnce({ blockId: 'Analisa!F55', blockType: 'bekisting' } as any)
      .mockResolvedValueOnce({ blockId: 'Analisa!F128', blockType: 'pembesian' } as any);
    const analyze = makeAnalyzeBlockFromAnalyzer(underlyingFn, [
      { sheet: 'Analisa', address: 'F55', row: 55, col: 5, value: 'X', formula: null },
      { sheet: 'Analisa', address: 'F128', row: 128, col: 5, value: 'Y', formula: null },
    ]);
    await analyze('Analisa!F55');
    await analyze('Analisa!F128');
    expect(underlyingFn).toHaveBeenCalledTimes(2);
  });
});

describe('normalizeWorkbook (Opus mocked)', () => {
  const ORIGINAL_FLAG = process.env.SANO_BOQ_RECIPE_DETAIL;
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.SANO_BOQ_RECIPE_DETAIL;
    else process.env.SANO_BOQ_RECIPE_DETAIL = ORIGINAL_FLAG;
  });

  itx('produces a workbook with Breakdown IV.A.2.7', async () => {
    delete process.env.SANO_BOQ_RECIPE_DETAIL;
    const buf = fs.readFileSync(AAL5);
    const result = await normalizeWorkbook(buf, {
      analyzeBlock: async (blockId: string) => FIXED_SCHEMAS[blockId] ?? null,
    });

    const wbOut = XLSX.read(result.workbookBuffer);
    expect(wbOut.SheetNames).toContain('Breakdown IV.A.2.7');
    expect(wbOut.SheetNames).toContain('Recipe Index');

    expect(result.summary.rows_normalized).toBeGreaterThan(0);
    const iv = result.breakdowns.find((b) => b.boqCode === 'IV.A.2.7');
    expect(iv).toBeDefined();
    expect(iv!.components.length).toBeGreaterThanOrEqual(13);
  });
});
