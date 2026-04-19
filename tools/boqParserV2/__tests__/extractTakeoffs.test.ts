import { extractBoqRows } from '../extractTakeoffs';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('extractBoqRows', () => {
  it('extracts BoQ rows with literal quantities', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          // Header row (skipped by parser)
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          // Data row: B=label, C=unit, D=volume
          { address: 'A11', value: 1 },
          { address: 'B11', value: 'Pekerjaan Galian' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 100, formula: 'H11', result: 100 },
          { address: 'E11', value: 50000, formula: 'N11', result: 50000 },
          { address: 'F11', value: 5000000, formula: 'D11*E11', result: 5000000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    // With no Roman numeral chapter row above, the parser uses the
    // default chapter 'I' and composes a hierarchical code.
    expect(rows[0]).toMatchObject({
      code: 'I.1',
      label: 'Pekerjaan Galian',
      unit: 'm3',
      planned: 100,
    });
  });

  it('parses Indonesian-formatted string quantities (decimal comma)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B15', value: 'Pekerjaan Beton' },
          { address: 'C15', value: 'm3' },
          { address: 'D15', value: '5.000,50' },
          { address: 'E15', value: 750000 },
          { address: 'F15', value: 937500000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0].planned).toBe(5000.5);
  });

  it('attaches takeoff_ref provenance when quantity is SUMIFS', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B20', value: 'Besi tulangan' },
          { address: 'C20', value: 'kg' },
          {
            address: 'D20',
            value: 5000,
            formula: "SUM('REKAP Balok'!K526, 'REKAP-PC'!G21)",
            result: 5000,
          },
          { address: 'E20', value: 12000 },
          { address: 'F20', value: 60000000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows[0].cost_basis).toBe('takeoff_ref');
    expect(rows[0].ref_cells?.quantity?.length).toBeGreaterThan(0);
  });

  it('extracts inline cost_split from Material/Upah/Peralatan columns', async () => {
    // Mirrors the Pakuwon AAL-5 layout where row 7 labels I=Material,
    // J=Upah, K=Peralatan — and each BoQ row stores cached per-unit
    // values in those columns.
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          { address: 'A11', value: 1 },
          { address: 'B11', value: 'Beton fc 25' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 10 },
          { address: 'F11', value: 50000000 },
          { address: 'I11', value: 3500000 },
          { address: 'J11', value: 1200000 },
          { address: 'K11', value: 300000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0].cost_basis).toBe('inline_split');
    expect(rows[0].cost_split).toEqual({ material: 3500000, labor: 1200000, equipment: 300000, prelim: 0 });
    expect(rows[0].total_cost).toBe(50000000);
    // ref_cells should pin the source cells so the audit UI can show provenance
    expect(rows[0].ref_cells?.material_cost?.cell).toBe('I11');
    expect(rows[0].ref_cells?.labor_cost?.cell).toBe('J11');
    expect(rows[0].ref_cells?.equipment_cost?.cell).toBe('K11');
  });

  it('derives hierarchical codes from chapter + subchapter + counter', async () => {
    // Mirrors AAL-5 structure:
    //   row 9:  A="I"   B="PEKERJAAN PERSIAPAN"        (chapter)
    //   row 11: A=1     B="Pagar pengaman"              (item → "I.1")
    //   row 24: A="II"  B="PEKERJAAN STRUKTUR"          (chapter)
    //   row 26: A="A"   B="Pondasi"                     (subchapter)
    //   row 27: A=1     B="Galian"                      (item → "II.A.1")
    //   row 28:         B=" - Poer PC.1"                (sub-item → "II.A.1.1")
    //   row 29:         B=" - Poer PC.2"                (sub-item → "II.A.1.2")
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A9', value: 'I' },
          { address: 'B9', value: 'PEKERJAAN PERSIAPAN' },
          { address: 'A11', value: 1 },
          { address: 'B11', value: 'Pagar pengaman' },
          { address: 'C11', value: 'm1' },
          { address: 'D11', value: 15 },
          { address: 'A24', value: 'II' },
          { address: 'B24', value: 'PEKERJAAN STRUKTUR' },
          { address: 'A26', value: 'A' },
          { address: 'B26', value: 'Pondasi' },
          { address: 'A27', value: 1 },
          { address: 'B27', value: 'Galian' },
          { address: 'C27', value: 'm3' },
          { address: 'D27', value: 100 },
          { address: 'B28', value: ' - Poer PC.1' },
          { address: 'C28', value: 'm3' },
          { address: 'D28', value: 1.62 },
          { address: 'B29', value: ' - Poer PC.2' },
          { address: 'C29', value: 'm3' },
          { address: 'D29', value: 3.6 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    const byLabel = Object.fromEntries(rows.map(r => [r.label.trim(), r]));
    expect(byLabel['Pagar pengaman'].code).toBe('I.1');
    expect(byLabel['Galian'].code).toBe('II.A.1');
    expect(byLabel['- Poer PC.1'].code).toBe('II.A.1.1');
    expect(byLabel['- Poer PC.2'].code).toBe('II.A.1.2');
    expect(byLabel['- Poer PC.1'].is_sub_item).toBe(true);
    expect(byLabel['- Poer PC.1'].chapter).toBe('PEKERJAAN STRUKTUR');
    expect(byLabel['- Poer PC.1'].sub_chapter).toBe('Pondasi');
    expect(byLabel['- Poer PC.1'].sub_chapter_letter).toBe('A');
  });

  it('disambiguates sub-items across sub-sub-chapter groups (AAL-5)', async () => {
    // Mirrors the AAL-5 structure where a single sub-chapter (III.A)
    // contains multiple unnumbered group headers ("Poer :", "Sloof :",
    // "Kolom :"), each restarting "1, 2, 3..." sub-item numbering in
    // column A. Without a sub-sub-chapter counter these collide on the
    // same code (III.A.1 five times).
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A10', value: 'III' },
          { address: 'B10', value: 'PEKERJAAN BETON' },
          { address: 'A12', value: 'A' },
          { address: 'B12', value: 'Beton Struktur' },
          // First sub-sub-chapter group
          { address: 'B14', value: 'Poer (fc 30 MPa) :' },
          { address: 'B15', value: ' - Poer PC.1' },
          { address: 'C15', value: 'm3' },
          { address: 'D15', value: 1.62 },
          { address: 'B16', value: ' - Poer PC.2' },
          { address: 'C16', value: 'm3' },
          { address: 'D16', value: 3.6 },
          // Second sub-sub-chapter group — numbering restarts
          { address: 'B20', value: 'Sloof :' },
          { address: 'B21', value: ' - Sloof TB24-1' },
          { address: 'C21', value: 'm3' },
          { address: 'D21', value: 12.8 },
          { address: 'B22', value: ' - Sloof TB24-2' },
          { address: 'C22', value: 'm3' },
          { address: 'D22', value: 1.24 },
          // Third group
          { address: 'B26', value: 'Kolom :' },
          { address: 'B27', value: ' - Kolom K174-1' },
          { address: 'C27', value: 'm3' },
          { address: 'D27', value: 0.19 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    const byLabel = Object.fromEntries(rows.map(r => [r.label.trim(), r]));
    expect(byLabel['- Poer PC.1'].code).toBe('III.A.1.1');
    expect(byLabel['- Poer PC.2'].code).toBe('III.A.1.2');
    expect(byLabel['- Sloof TB24-1'].code).toBe('III.A.2.1');
    expect(byLabel['- Sloof TB24-2'].code).toBe('III.A.2.2');
    expect(byLabel['- Kolom K174-1'].code).toBe('III.A.3.1');
    // All codes must be unique
    const codes = rows.map(r => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('treats numeric-A rows without value as parent items (not sub-sub-chapters)', async () => {
    // Mirrors AAL-5 VII.A:
    //   row 5:  A="VII" chapter
    //   row 6:  A="A"   sub-chapter "Kanopi"
    //   row 7:  A=1     "Kanopi elv. +3.15" (no unit, no volume — parent item)
    //   row 8:          "- WF 200" sub-item       → VII.A.1.1
    //   row 9:          "- WF 150" sub-item       → VII.A.1.2
    //   row 10: A=2     "Sambungan" regular item  → VII.A.2  (must NOT collide)
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B2', value: 'URAIAN PEKERJAAN' },
          { address: 'A5', value: 'VII' },
          { address: 'B5', value: 'PEKERJAAN BAJA' },
          { address: 'A6', value: 'A' },
          { address: 'B6', value: 'Kanopi' },
          { address: 'A7', value: 1 },
          { address: 'B7', value: 'Kanopi elv. +3.15' },
          { address: 'B8', value: ' - WF 200' },
          { address: 'C8', value: 'kg' },
          { address: 'D8', value: 776 },
          { address: 'B9', value: ' - WF 150' },
          { address: 'C9', value: 'kg' },
          { address: 'D9', value: 272 },
          { address: 'A10', value: 2 },
          { address: 'B10', value: 'Sambungan' },
          { address: 'C10', value: 'ls' },
          { address: 'D10', value: 1 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    const byLabel = Object.fromEntries(rows.map(r => [r.label.trim(), r]));
    expect(byLabel['- WF 200'].code).toBe('VII.A.1.1');
    expect(byLabel['- WF 150'].code).toBe('VII.A.1.2');
    expect(byLabel['Sambungan'].code).toBe('VII.A.2');
    const codes = rows.map(r => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('disambiguates repeated sub-chapter letters within a chapter', async () => {
    // AAL-5 VII uses letter "B" twice — the second time it refers to a
    // different group ("Pekerjaan Penutup Atap" vs "Pekerjaan Struktur
    // Baja Rangka Fasad"). Codes must remain unique.
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B2', value: 'URAIAN PEKERJAAN' },
          { address: 'A5', value: 'VII' },
          { address: 'B5', value: 'PEKERJAAN BAJA' },
          { address: 'A6', value: 'B' },
          { address: 'B6', value: 'Rangka Fasad' },
          { address: 'A7', value: 1 },
          { address: 'B7', value: 'Rangka fasad elv. +6.70' },
          { address: 'B8', value: ' - WF 200' },
          { address: 'C8', value: 'kg' },
          { address: 'D8', value: 751 },
          { address: 'A10', value: 'B' },
          { address: 'B10', value: 'Penutup Atap' },
          { address: 'A11', value: 1 },
          { address: 'B11', value: 'Rangka atap utama' },
          { address: 'B12', value: ' - WF 200' },
          { address: 'C12', value: 'kg' },
          { address: 'D12', value: 1308 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    const codes = rows.map(r => r.code);
    // Codes from the first B and the second B must not collide
    expect(new Set(codes).size).toBe(codes.length);
    // And the second B group uses "B2" as the letter segment
    expect(codes).toContain('VII.B.1.1');
    expect(codes).toContain('VII.B2.1.1');
  });

  it('ignores duplicate later "Material" columns (R, W, AA, AD)', async () => {
    // AAL-5 labels Material at I, R, W, AA, AD — the latter four are
    // intermediate aggregators. The leftmost occurrence wins.
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          { address: 'R7', value: 'Material' },      // second "Material"
          { address: 'W7', value: 'Material' },      // third "Material"
          { address: 'B11', value: 'Pengecoran' },
          { address: 'C11', value: 'm3' },
          { address: 'D11', value: 5 },
          { address: 'I11', value: 1000 },           // primary material value
          { address: 'R11', value: 999999 },         // secondary — must be ignored
          { address: 'W11', value: 999999 },         // tertiary — must be ignored
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows[0].cost_split?.material).toBe(1000);
  });
});
