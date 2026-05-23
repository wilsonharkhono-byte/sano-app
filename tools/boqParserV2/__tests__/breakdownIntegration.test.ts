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

  itx('with flag off, IV.A.2.7 keeps existing 7-component (rolled-up) recipe', async () => {
    delete process.env.SANO_BOQ_RECIPE_DETAIL;
    const buf = fs.readFileSync(WORKBOOK);
    const result = await parseBoqV2(buf);
    const row = result.boqRows.find((r) => r.code === 'IV.A.2.7');
    expect(row).toBeDefined();
    expect(row!.recipe).toBeTruthy();
    expect(row!.recipe!.components.length).toBeLessThan(13);
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
