import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { normalizeWorkbook } from '../index';
import type { BlockSchema } from '../types';

const AAL5 = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ', 'RAB R1 Pakuwon Indah AAL-5.xlsx');
const skip = !fs.existsSync(AAL5);
const itx = skip ? it.skip : it;

const FIXED_SCHEMAS: Record<string, BlockSchema> = {
  'Analisa!F55': {
    blockId: 'Analisa!F55', blockType: 'bekisting', elementHint: 'Balok',
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
