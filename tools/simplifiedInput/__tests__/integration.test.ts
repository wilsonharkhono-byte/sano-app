// publishBaselineV2 → ../supabase pulls in react-native-url-polyfill (ESM) that
// Jest can't parse. Mock it, as the other publish tests do; nothing in this file
// touches the network.
jest.mock('../../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseSimplifiedInput, isSimplifiedInputWorkbook } from '../index';
import { TIER1_SHEET_NAME } from '../tier1';
import { OTHERS_SHEET_NAME } from '../others';
import {
  zeroPlannedBoqCodes,
  buildBoqItemInsert,
  buildSessionLineInputs,
  buildMasterLinesV2,
  type CatalogRow,
} from '../../publishBaselineV2';
import { buildWorkGroups } from '../../boqWorkGroups';

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

// ── rebar-only work area, upload → publish → work group ────────────────────
// Synthetic workbook rather than an asset: the BDG D-18 file predates this case
// ("Umum ; Kolom Balok Praktis", 684 lonjor ø8 + 805 lonjor ø10, Beton Readymix
// blank). Built in memory so the whole chain is exercised without a fixture the
// repo doesn't have.

/** Real curated-catalogue shape: rebar is stored in kg, ordered in batang. */
const REBAR_CATALOG: CatalogRow[] = [
  { id: 'mat-d8', code: 'BSI-P8', name: 'Besi beton polos 8 mm', category: 'Besi', tier: 1, unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 4.74 },
  { id: 'mat-d10', code: 'BSI-U10', name: 'Besi beton ulir 10 mm', category: 'Besi', tier: 1, unit: 'kg', supplier_unit: 'batang', base_qty_per_supplier_unit: 7.4 },
];

function simplifiedWorkbook(): Buffer {
  const tier1 = XLSX.utils.aoa_to_sheet([
    ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
    [null, null, 8, 10, 13, 16, 19, 22],
    [],
    ['Lantai 1 ; Kolom', 36.5, 0, 472, 17, 135, 161, 86],
    ['Umum ; Kolom Balok Praktis', null, 684, 805, 0, 0, 0, 0],
  ]);
  const others = XLSX.utils.aoa_to_sheet([
    ['Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan'],
    [],
    ['Semen PC', 3, 'sak', 100, 65000],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, tier1, TIER1_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, others, OTHERS_SHEET_NAME);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('rebar-only work area reaches the published baseline', () => {
  const { stagingRows } = parseSimplifiedInput(simplifiedWorkbook());
  const rebarOnly = stagingRows.find((r) => r.raw_data.subChapter === 'Kolom Balok Praktis')!;
  const code = (rebarOnly.parsed_data as { code: string }).code;

  it('is not filtered out by the publish path (zero-planned / quarantine)', () => {
    expect(zeroPlannedBoqCodes(stagingRows)).not.toContain(code);
    const insert = buildBoqItemInsert(rebarOnly, 'proj-1');
    expect(insert).not.toBeNull();
    expect(insert).toMatchObject({ code, planned: 1, unit: 'ls', chapter: 'Umum', sub_chapter: 'Kolom Balok Praktis' });
  });

  it('lands the full lonjor count as kg demand — the sheet count × the catalog factor', () => {
    const catalogById = new Map(REBAR_CATALOG.map((c) => [c.id, c]));
    const { masterLineInputs, unresolvedComponents } = buildSessionLineInputs(
      [rebarOnly],
      REBAR_CATALOG,
      catalogById,
      new Map(),
      null,
      (c) => (c === code ? 'boq-uuid' : undefined),
    );
    expect(unresolvedComponents).toEqual([]);
    const lines = buildMasterLinesV2(masterLineInputs, 'master-1');
    const kgFor = (id: string) => lines.find((l) => l.material_id === id)!.planned_quantity;
    expect(kgFor('mat-d8')).toBeCloseTo(684 * 4.74, 9);
    expect(kgFor('mat-d10')).toBeCloseTo(805 * 7.4, 9);
    // ~9,200 kg of rebar that used to vanish from every envelope.
    expect(kgFor('mat-d8') + kgFor('mat-d10')).toBeCloseTo(9199.16, 6);
    expect(lines.every((l) => l.unit === 'kg')).toBe(true);
  });

  it('surfaces as its own work group in Permintaan', () => {
    const boqRows = stagingRows.filter((r) => r.row_type === 'boq');
    const groups = buildWorkGroups(
      boqRows.map((r, i) => {
        const pd = r.parsed_data as { code: string; label: string; chapter: string; sub_chapter: string | null };
        return { id: `item-${i}`, sort_order: i, code: pd.code, label: pd.label, chapter: pd.chapter, sub_chapter: pd.sub_chapter };
      }),
    );
    expect(groups.map((g) => g.label)).toContain('Umum ; Kolom Balok Praktis');
  });
});
