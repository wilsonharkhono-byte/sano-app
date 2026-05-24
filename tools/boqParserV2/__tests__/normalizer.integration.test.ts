// tools/boqParserV2/__tests__/normalizer.integration.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '../index';
import { normalizeWorkbook } from '../../normalizer';
import type { BlockSchema } from '../../normalizer/types';

// See tools/normalizer/index.ts findBlockIdsFor — bekisting is re-anchored
// to the block's first component row (F47 = Multipleks) so the Opus context
// window captures all sub-items above the Harga-per-m² cell at F55.
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

describe('Normalizer → parseBoqV2 end-to-end', () => {
  const WORKBOOK = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ', 'RAB R1 Pakuwon Indah AAL-5.xlsx');
  const skip = !fs.existsSync(WORKBOOK);
  const itx = skip ? it.skip : it;
  const ORIGINAL_FLAG = process.env.SANO_BOQ_RECIPE_DETAIL;
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.SANO_BOQ_RECIPE_DETAIL;
    else process.env.SANO_BOQ_RECIPE_DETAIL = ORIGINAL_FLAG;
  });

  itx('IV.A.2.7 ends up with 13+ components matching spec Appendix A', async () => {
    delete process.env.SANO_BOQ_RECIPE_DETAIL;  // Off during dry parse
    const buf = fs.readFileSync(WORKBOOK);
    const normalized = await normalizeWorkbook(buf, {
      analyzeBlock: async (id) => FIXED_SCHEMAS[id] ?? null,
    });

    // Now run parseBoqV2 with flag ON over the normalized buffer.
    process.env.SANO_BOQ_RECIPE_DETAIL = 'on';
    const result = await parseBoqV2(normalized.workbookBuffer);
    const row = result.boqRows.find((r) => r.code === 'IV.A.2.7');
    expect(row).toBeDefined();
    expect(row!.recipe).toBeTruthy();
    expect(row!.recipe!.components.length).toBeGreaterThanOrEqual(13);

    const byName = (n: string) => row!.recipe!.components.find((c) => c.materialName?.includes(n));
    expect(byName('Beton readymix K-350')?.quantityPerUnit).toBeCloseTo(1.05, 4);
    expect(byName('Multipleks 15 mm')?.quantityPerUnit).toBeCloseTo(5.0, 4);
    expect(byName('Besi beton D8')?.quantityPerUnit).toBeCloseTo(75.2587, 3);
    expect(byName('Besi beton D13')?.quantityPerUnit).toBeCloseTo(91.9190, 3);
    expect(byName('Bendrat')?.quantityPerUnit).toBeCloseTo(3.5107, 3);
  });
});
