import * as fs from 'fs';
import * as path from 'path';
import { parseSimplifiedInput, isSimplifiedInputWorkbook } from '../index';

const ASSET = path.resolve(__dirname, '../../../assets/BOQ/20260713 SANO Input - BDG D-18.xlsx');

// Guard: skip when the asset isn't present (it's an untracked local workbook,
// absent in CI). The read MUST be lazy (beforeAll, not the describe body):
// describe.skip still executes the describe callback to collect tests, so a
// top-level fs.readFileSync would throw ENOENT even when skipped.
const maybe = fs.existsSync(ASSET) ? describe : describe.skip;

maybe('BDG D-18 simplified workbook', () => {
  let buf: Buffer;
  beforeAll(() => {
    buf = fs.readFileSync(ASSET);
  });

  it('is detected as a simplified-input workbook', () => {
    expect(isSimplifiedInputWorkbook(buf)).toBe(true);
  });

  it('parses to Tier-1 boq rows + project-level Others material rows (no anchor)', () => {
    const { stagingRows } = parseSimplifiedInput(buf);
    const boq = stagingRows.filter((r) => r.row_type === 'boq');
    const others = stagingRows.filter((r) => r.row_type === 'material');
    expect(boq.length).toBeGreaterThan(1); // 42 Tier-1 work areas
    expect(others.length).toBe(13); // 13 Tier-2/3 Others materials, project-level
    expect(others.every((r) => (r.parsed_data as any).project_material === true)).toBe(true);
    // No synthetic MATERIAL-UMUM anchor exists anymore.
    expect(stagingRows.some((r) => (r.parsed_data as { code?: string }).code === 'MATERIAL-UMUM')).toBe(false);
    // Row numbers are contiguous 1..N.
    expect(stagingRows.map((r) => r.row_number)).toEqual(stagingRows.map((_, i) => i + 1));
  });

  it('every Tier-1 row has a beton component (coeff 1.0) and only batang rebar components', () => {
    const { stagingRows } = parseSimplifiedInput(buf);
    const tier1 = stagingRows.filter((r) => String((r.parsed_data as { code?: string }).code).startsWith('T1-'));
    expect(tier1.length).toBeGreaterThan(0);
    for (const r of tier1) {
      const comps = (r.parsed_data.recipe as { components: any[] }).components;
      const beton = comps.find((c) => c.materialName === 'Beton Readymix');
      expect(beton?.quantityPerUnit).toBe(1.0);
      for (const c of comps.filter((x) => x.materialName !== 'Beton Readymix')) {
        expect(c.unit).toBe('batang');
        expect(c.materialName).toMatch(/^Besi beton (polos|ulir) \d+ mm$/);
      }
    }
  });

  it("reproduces a known work area's rebar lonjor via planned × coefficient", () => {
    const { stagingRows } = parseSimplifiedInput(buf);
    const kolom = stagingRows.find(
      (r) => r.raw_data.chapter === 'Lt. Basement' && r.raw_data.subChapter === 'Kolom',
    )!;
    const planned = (kolom.parsed_data as { planned: number }).planned;
    const d10 = (kolom.parsed_data.recipe as { components: any[] }).components.find(
      (c) => c.materialName === 'Besi beton ulir 10 mm',
    );
    expect(Math.round(planned * d10.quantityPerUnit)).toBe(517);
  });
});
