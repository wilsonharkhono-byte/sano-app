import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '../index';

describe('parseBoqV2 with Breakdown sheets', () => {
  const WORKBOOK = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ', 'RAB R1 Pakuwon Indah AAL-5_Claude Override.xlsx');
  const skip = !fs.existsSync(WORKBOOK);
  const itx = skip ? it.skip : it;
  const ORIGINAL_FLAG = process.env.SANO_BOQ_RECIPE_DETAIL;
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.SANO_BOQ_RECIPE_DETAIL;
    else process.env.SANO_BOQ_RECIPE_DETAIL = ORIGINAL_FLAG;
  });

  itx('with flag on, IV.A.2.7 recipe has 13 components from Breakdown sheet', async () => {
    process.env.SANO_BOQ_RECIPE_DETAIL = 'on';
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    const row = result.boqRows.find((r) => r.code === 'IV.A.2.7');
    expect(row).toBeDefined();
    expect(row!.recipe).toBeTruthy();
    expect(row!.recipe!.components.length).toBeGreaterThanOrEqual(13);
    const names = row!.recipe!.components.map((c) => c.materialName ?? '');
    expect(names).toEqual(expect.arrayContaining([
      expect.stringMatching(/Beton readymix K-350/),
      expect.stringMatching(/Multipleks 15 mm/),
      expect.stringMatching(/Besi beton D8/),
      expect.stringMatching(/Bendrat/),
    ]));
  });

  itx('auto-enables when Breakdown sheets are present (no flag set) — IV.A.2.7 gets full breakdown', async () => {
    // The whole point of uploading a normalized workbook is for SANO to
    // consume its Breakdown sheets. When they're present, breakdown reading
    // turns on without the operator setting an env flag.
    delete process.env.SANO_BOQ_RECIPE_DETAIL;
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    const row = result.boqRows.find((r) => r.code === 'IV.A.2.7');
    expect(row).toBeDefined();
    expect(row!.recipe!.components.length).toBeGreaterThanOrEqual(13);
  });

  itx('explicit SANO_BOQ_RECIPE_DETAIL=off forces the rolled-up recipe even when sheets present', async () => {
    process.env.SANO_BOQ_RECIPE_DETAIL = 'off';
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    const row = result.boqRows.find((r) => r.code === 'IV.A.2.7');
    expect(row).toBeDefined();
    expect(row!.recipe).toBeTruthy();
    expect(row!.recipe!.components.length).toBeLessThan(13);
  });

  itx('with explicit =off and Breakdown sheets present, still warns they are being ignored', async () => {
    process.env.SANO_BOQ_RECIPE_DETAIL = 'off';
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    expect(result.breakdownWarnings.some((w) => w.code === 'BREAKDOWN_SHEETS_PRESENT_BUT_FLAG_OFF')).toBe(true);
  });

  itx('preserves document order — IV.A.2.7 stays before V.A.2.6 with flag on', async () => {
    process.env.SANO_BOQ_RECIPE_DETAIL = 'on';
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    const codes = result.boqRows.map((r) => r.code);
    const ivIdx = codes.indexOf('IV.A.2.7');
    const vIdx = codes.indexOf('V.A.2.6');
    expect(ivIdx).toBeGreaterThanOrEqual(0);
    expect(vIdx).toBeGreaterThan(ivIdx);
  });
});

describe('parseBoqV2 — prefix-robust Breakdown matching (PD3)', () => {
  // PD3 was normalized in multi-sheet (auto) mode, so its Breakdown sheets are
  // named "Breakdown (A) III.B.1.14". SANO re-parses single-sheet ('RAB (A)'),
  // producing boqRow.code "III.B.1.14" with no "(A)" prefix. The override must
  // still match across that prefix difference.
  const WORKBOOK = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ', 'RAB R2 Pakuwon Indah PD3 no. 23_normalized.xlsx');
  const skip = !fs.existsSync(WORKBOOK);
  const itx = skip ? it.skip : it;
  const ORIGINAL_FLAG = process.env.SANO_BOQ_RECIPE_DETAIL;
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.SANO_BOQ_RECIPE_DETAIL;
    else process.env.SANO_BOQ_RECIPE_DETAIL = ORIGINAL_FLAG;
  });

  itx('every Poer row (III.B.1.*) gets a full breakdown recipe, not just the last', async () => {
    delete process.env.SANO_BOQ_RECIPE_DETAIL; // rely on auto-enable
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    const poer = result.boqRows.filter((r) => /^III\.B\.1\.\d+$/.test(r.code));
    expect(poer.length).toBeGreaterThanOrEqual(14);
    // Each Poer row must have its own multi-component breakdown (the bug was
    // that only the block's single linked row got detail).
    for (const r of poer) {
      expect(r.recipe!.components.length).toBeGreaterThanOrEqual(7);
      const names = r.recipe!.components.map((c) => c.materialName ?? '');
      // Breakdown-derived recipes name the concrete + rebar materials.
      expect(names.some((n) => /Beton readymix/i.test(n))).toBe(true);
    }
  });
});
