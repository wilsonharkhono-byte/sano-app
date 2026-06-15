// Builds a SANO-friendly simplified BoQ workbook using a subset of the
// AAL-5 data. Key differences from the original AAL-5 workbook:
//
//  1. Header row at ROW 1 (not row 7) — no decorative top matter.
//  2. No formulas anywhere. All numbers are literal so the parser doesn't
//     need a formula evaluator.
//  3. Chapter / sub-chapter are explicit TEXT columns. No roman numerals,
//     no single-letter sub-chapter codes mixed into NO column.
//  4. Every AHS reference is a stable code like "AHS-001" (column in RAB
//     plus a matching row in AHS sheet). No cross-sheet cell pointers.
//  5. Catalog references in AHS use a stable code like "M-001" or "L-001".
//     Eliminates the need for fuzzy material-name matching.
//  6. Inline cost split columns (Material/Upah/Peralatan) STAY in the RAB
//     because that's how SANO already classifies tiers. But each is a
//     literal number with no inter-cell math.
//  7. One RAB sheet, one Analisa-equivalent sheet, one Material, one Upah.
//     No REKAP takeoff plumbing — Tier 1 volumes are pre-computed.
//  8. UTF-8 column headers in English so foreign tooling has zero ambiguity.
//     Indonesian labels go in a header comment at the top of each sheet for
//     human readers.

import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
wb.creator = 'SANO parser team';
wb.created = new Date();

// ---------- Helpers ----------

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const ALT_FILL    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
const CHAPTER_FONT = { bold: true };
const CHAPTER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
const SUBCHAPTER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };

function styleHeader(ws, rowIdx, cols) {
  const row = ws.getRow(rowIdx);
  row.height = 22;
  row.eachCell({ includeEmpty: false }, cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  });
  for (const [i, c] of cols.entries()) {
    ws.getColumn(i + 1).width = c.width;
  }
}

function rupiah(n) {
  return n == null ? null : Number(n);
}

// ---------- Sheet 1: RAB ----------

const rab = wb.addWorksheet('RAB', {
  views: [{ state: 'frozen', ySplit: 1 }],
  properties: { defaultColWidth: 14 },
});

const rabCols = [
  { header: 'Code',         key: 'code',        width: 10 },
  { header: 'Chapter',      key: 'chapter',     width: 28 },
  { header: 'Sub-chapter',  key: 'subchapter',  width: 22 },
  { header: 'Item Name',    key: 'item',        width: 42 },
  { header: 'Unit',         key: 'unit',        width: 8  },
  { header: 'Volume',       key: 'volume',      width: 10 },
  { header: 'AHS Code',     key: 'ahs',         width: 12 },
  { header: 'Material',     key: 'material',    width: 14 },
  { header: 'Upah',         key: 'upah',        width: 12 },
  { header: 'Peralatan',    key: 'peralatan',   width: 12 },
  { header: 'Subkon',       key: 'subkon',      width: 12 },
  { header: 'Prelim',       key: 'prelim',      width: 12 },
  { header: 'Unit Price',   key: 'unitPrice',   width: 14 },
  { header: 'Total',        key: 'total',       width: 16 },
];
rab.columns = rabCols.map(c => ({ header: c.header, key: c.key, width: c.width }));
styleHeader(rab, 1, rabCols);

// Simplified data: 12 rows covering the patterns the parser must handle.
// Volumes + prices are TAKEN VERBATIM from the AAL-5 workbook where possible;
// where AAL-5 used a formula chain, the literal computed value is used.
const rabRows = [
  // I. Persiapan
  { code: '1.1',  chapter: 'I. Pekerjaan Persiapan', subchapter: '',                       item: 'Pagar pengaman',                                     unit: 'm2',  volume: 15,    ahs: '',          material: 0,        upah: 50_000,    peralatan: 0,    subkon: 0,        prelim: 150_000,  unitPrice: 200_000,    total: 3_000_000 },
  { code: '1.2',  chapter: 'I. Pekerjaan Persiapan', subchapter: '',                       item: 'Uitzet / Pasang bowplank',                           unit: 'ls',  volume: 1,     ahs: '',          material: 4_500_000, upah: 2_700_000, peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 7_200_000,  total: 7_200_000 },
  { code: '1.3',  chapter: 'I. Pekerjaan Persiapan', subchapter: '',                       item: 'Pengukuran dan penandaan titik pile',                unit: 'titik', volume: 108, ahs: '',          material: 0,        upah: 30_000,    peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 30_000,     total: 3_240_000 },

  // II. Tanah & Pondasi
  { code: '2.1',  chapter: 'II. Pekerjaan Tanah dan Pondasi', subchapter: 'A. Pekerjaan Tanah', item: 'Cut and fill, buangan sampah, perataan tanah',         unit: 'm3',  volume: 405,   ahs: '',          material: 0,        upah: 0,         peralatan: 0,    subkon: 70_000,   prelim: 0,        unitPrice: 70_000,     total: 28_350_000 },
  { code: '2.2',  chapter: 'II. Pekerjaan Tanah dan Pondasi', subchapter: 'A. Pekerjaan Tanah', item: 'Urugan sirtu untuk pekerjaan urugan',                   unit: 'm3',  volume: 270,   ahs: '',          material: 0,        upah: 0,         peralatan: 0,    subkon: 175_000,  prelim: 0,        unitPrice: 175_000,    total: 47_250_000 },
  { code: '2.3',  chapter: 'II. Pekerjaan Tanah dan Pondasi', subchapter: 'B. Pondasi Bored Pile', item: 'Bored pile diameter 30 cm, kedalaman 6 m',         unit: 'titik', volume: 108, ahs: 'AHS-001',   material: 1_750_000, upah: 0,         peralatan: 0,    subkon: 2_200_000, prelim: 0,        unitPrice: 3_950_000,  total: 426_600_000 },

  // III. Lantai 1 - Beton
  { code: '3.1',  chapter: 'III. Pekerjaan Fisik Lantai 1', subchapter: 'A. Pekerjaan Beton', item: 'Poer PC.1 (Readymix fc 30 MPa)',                       unit: 'm3',  volume: 12.5,  ahs: 'AHS-002',   material: 1_200_000, upah: 350_000,   peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 1_550_000,  total: 19_375_000 },
  { code: '3.2',  chapter: 'III. Pekerjaan Fisik Lantai 1', subchapter: 'A. Pekerjaan Beton', item: 'Pembesian poer (D13 + D16 + D19)',                     unit: 'kg',  volume: 2_450, ahs: 'AHS-003',   material: 17_500,    upah: 3_500,     peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 21_000,     total: 51_450_000 },
  { code: '3.3',  chapter: 'III. Pekerjaan Fisik Lantai 1', subchapter: 'A. Pekerjaan Beton', item: 'Bekisting poer',                                       unit: 'm2',  volume: 85,    ahs: 'AHS-004',   material: 95_000,    upah: 45_000,    peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 140_000,    total: 11_900_000 },

  // III. Lantai 1 - Pasangan
  { code: '3.4',  chapter: 'III. Pekerjaan Fisik Lantai 1', subchapter: 'B. Pasangan dan Plesteran', item: 'Pasangan dinding bata ringan tebal 10cm',         unit: 'm2',  volume: 320,   ahs: 'AHS-005',   material: 78_000,    upah: 48_000,    peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 126_000,    total: 40_320_000 },
  { code: '3.5',  chapter: 'III. Pekerjaan Fisik Lantai 1', subchapter: 'B. Pasangan dan Plesteran', item: 'Plesteran dinding 1:3 tebal 15 mm',               unit: 'm2',  volume: 640,   ahs: 'AHS-006',   material: 22_000,    upah: 32_000,    peralatan: 0,    subkon: 0,        prelim: 0,        unitPrice: 54_000,     total: 34_560_000 },

  // IV. Atap
  { code: '4.1',  chapter: 'IV. Pekerjaan Atap',     subchapter: '',                       item: 'Rangka atap baja ringan',                            unit: 'm2',  volume: 180,   ahs: '',          material: 0,        upah: 0,         peralatan: 0,    subkon: 245_000,   prelim: 0,        unitPrice: 245_000,    total: 44_100_000 },
];

let r = 2;
for (const row of rabRows) {
  const xlRow = rab.addRow(row);
  xlRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
    if (colIdx >= 6 && colIdx !== 7) { // numeric columns
      cell.numFmt = '#,##0;(#,##0)';
      cell.alignment = { horizontal: 'right' };
    }
    if (colIdx === 5) cell.alignment = { horizontal: 'center' };
    if (r % 2 === 0) cell.fill = ALT_FILL;
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
  });
  r++;
}

// Add a "TOTAL" footer
const totalSum = rabRows.reduce((s, x) => s + x.total, 0);
const footer = rab.addRow({ chapter: 'TOTAL', total: totalSum });
footer.font = { bold: true };
footer.getCell('total').numFmt = '#,##0';
footer.getCell('total').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

// ---------- Sheet 2: AHS ----------

const ahs = wb.addWorksheet('AHS', {
  views: [{ state: 'frozen', ySplit: 1 }],
  properties: { defaultColWidth: 14 },
});

const ahsCols = [
  { header: 'AHS Code',       key: 'ahsCode',        width: 12 },
  { header: 'AHS Name',       key: 'ahsName',        width: 38 },
  { header: 'Output Unit',    key: 'outputUnit',     width: 10 },
  { header: 'Component Type', key: 'componentType',  width: 14 },
  { header: 'Component Code', key: 'componentCode',  width: 14 },
  { header: 'Component Name', key: 'componentName',  width: 32 },
  { header: 'Coefficient',    key: 'coef',           width: 12 },
  { header: 'Unit',           key: 'unit',           width: 10 },
  { header: 'Unit Price',     key: 'unitPrice',      width: 14 },
  { header: 'Subtotal',       key: 'subtotal',       width: 14 },
];
ahs.columns = ahsCols.map(c => ({ header: c.header, key: c.key, width: c.width }));
styleHeader(ahs, 1, ahsCols);

// AHS recipes — one row per (AHS, component). AHS Code repeats per
// component so each row is fully self-describing.
const ahsRows = [
  // AHS-001 Bored pile D30 6m
  { ahsCode: 'AHS-001', ahsName: 'Bored pile D30 cm kedalaman 6 m', outputUnit: 'titik', componentType: 'material',  componentCode: 'M-001', componentName: 'Beton readymix fc 25 MPa',   coef: 0.42,  unit: 'm3',  unitPrice: 1_350_000, subtotal: 567_000 },
  { ahsCode: 'AHS-001', ahsName: 'Bored pile D30 cm kedalaman 6 m', outputUnit: 'titik', componentType: 'material',  componentCode: 'M-002', componentName: 'Besi ulir D13',              coef: 18,    unit: 'kg',  unitPrice: 17_500,    subtotal: 315_000 },
  { ahsCode: 'AHS-001', ahsName: 'Bored pile D30 cm kedalaman 6 m', outputUnit: 'titik', componentType: 'subkon',    componentCode: 'S-001', componentName: 'Bor pile (subkontraktor)',   coef: 1,     unit: 'titik', unitPrice: 2_200_000, subtotal: 2_200_000 },

  // AHS-002 Beton poer fc 30
  { ahsCode: 'AHS-002', ahsName: 'Beton poer fc 30 MPa',           outputUnit: 'm3',    componentType: 'material',  componentCode: 'M-003', componentName: 'Beton readymix fc 30 MPa',   coef: 1.05,  unit: 'm3',  unitPrice: 1_150_000, subtotal: 1_207_500 },
  { ahsCode: 'AHS-002', ahsName: 'Beton poer fc 30 MPa',           outputUnit: 'm3',    componentType: 'labor',     componentCode: 'L-001', componentName: 'Tukang batu',                coef: 0.5,   unit: 'org-hari', unitPrice: 175_000, subtotal: 87_500 },
  { ahsCode: 'AHS-002', ahsName: 'Beton poer fc 30 MPa',           outputUnit: 'm3',    componentType: 'labor',     componentCode: 'L-002', componentName: 'Pekerja',                    coef: 1.5,   unit: 'org-hari', unitPrice: 150_000, subtotal: 225_000 },

  // AHS-003 Pembesian poer
  { ahsCode: 'AHS-003', ahsName: 'Pembesian poer (campuran D13-D19)', outputUnit: 'kg',  componentType: 'material',  componentCode: 'M-004', componentName: 'Besi ulir D13',              coef: 0.35,  unit: 'kg',  unitPrice: 17_500,    subtotal: 6_125 },
  { ahsCode: 'AHS-003', ahsName: 'Pembesian poer (campuran D13-D19)', outputUnit: 'kg',  componentType: 'material',  componentCode: 'M-005', componentName: 'Besi ulir D16',              coef: 0.40,  unit: 'kg',  unitPrice: 17_500,    subtotal: 7_000 },
  { ahsCode: 'AHS-003', ahsName: 'Pembesian poer (campuran D13-D19)', outputUnit: 'kg',  componentType: 'material',  componentCode: 'M-006', componentName: 'Besi ulir D19',              coef: 0.25,  unit: 'kg',  unitPrice: 17_500,    subtotal: 4_375 },
  { ahsCode: 'AHS-003', ahsName: 'Pembesian poer (campuran D13-D19)', outputUnit: 'kg',  componentType: 'labor',     componentCode: 'L-003', componentName: 'Tukang besi',                coef: 0.018, unit: 'org-hari', unitPrice: 175_000, subtotal: 3_150 },
  { ahsCode: 'AHS-003', ahsName: 'Pembesian poer (campuran D13-D19)', outputUnit: 'kg',  componentType: 'material',  componentCode: 'M-007', componentName: 'Kawat bendrat',              coef: 0.020, unit: 'kg',  unitPrice: 17_500,    subtotal: 350 },

  // AHS-004 Bekisting poer
  { ahsCode: 'AHS-004', ahsName: 'Bekisting poer (plywood + kayu)',  outputUnit: 'm2',   componentType: 'material',  componentCode: 'M-008', componentName: 'Plywood 12mm',               coef: 0.35,  unit: 'lembar', unitPrice: 175_000, subtotal: 61_250 },
  { ahsCode: 'AHS-004', ahsName: 'Bekisting poer (plywood + kayu)',  outputUnit: 'm2',   componentType: 'material',  componentCode: 'M-009', componentName: 'Kayu kaso 5/7',              coef: 0.012, unit: 'm3',  unitPrice: 2_800_000, subtotal: 33_600 },
  { ahsCode: 'AHS-004', ahsName: 'Bekisting poer (plywood + kayu)',  outputUnit: 'm2',   componentType: 'labor',     componentCode: 'L-004', componentName: 'Tukang kayu',                coef: 0.30,  unit: 'org-hari', unitPrice: 150_000, subtotal: 45_000 },

  // AHS-005 Pasangan bata ringan
  { ahsCode: 'AHS-005', ahsName: 'Pasangan bata ringan tebal 10 cm', outputUnit: 'm2',   componentType: 'material',  componentCode: 'M-010', componentName: 'Bata ringan 60×20×10',       coef: 8.3,   unit: 'bh',  unitPrice: 8_500,     subtotal: 70_550 },
  { ahsCode: 'AHS-005', ahsName: 'Pasangan bata ringan tebal 10 cm', outputUnit: 'm2',   componentType: 'material',  componentCode: 'M-011', componentName: 'Mortar perekat bata ringan', coef: 7.5,   unit: 'kg',  unitPrice: 1_000,     subtotal: 7_500 },
  { ahsCode: 'AHS-005', ahsName: 'Pasangan bata ringan tebal 10 cm', outputUnit: 'm2',   componentType: 'labor',     componentCode: 'L-001', componentName: 'Tukang batu',                coef: 0.25,  unit: 'org-hari', unitPrice: 175_000, subtotal: 43_750 },

  // AHS-006 Plesteran 1:3
  { ahsCode: 'AHS-006', ahsName: 'Plesteran 1:3 tebal 15 mm',        outputUnit: 'm2',   componentType: 'material',  componentCode: 'M-012', componentName: 'Semen Portland',             coef: 8.0,   unit: 'kg',  unitPrice: 1_500,     subtotal: 12_000 },
  { ahsCode: 'AHS-006', ahsName: 'Plesteran 1:3 tebal 15 mm',        outputUnit: 'm2',   componentType: 'material',  componentCode: 'M-013', componentName: 'Pasir pasang',               coef: 0.024, unit: 'm3',  unitPrice: 350_000,   subtotal: 8_400 },
  { ahsCode: 'AHS-006', ahsName: 'Plesteran 1:3 tebal 15 mm',        outputUnit: 'm2',   componentType: 'labor',     componentCode: 'L-001', componentName: 'Tukang batu',                coef: 0.15,  unit: 'org-hari', unitPrice: 175_000, subtotal: 26_250 },
];

let row = 2;
let prevAhs = '';
for (const data of ahsRows) {
  const xlRow = ahs.addRow(data);
  // Group rows visually by AHS Code: bold top row of each new group
  const groupBreak = data.ahsCode !== prevAhs;
  if (groupBreak) {
    xlRow.eachCell({ includeEmpty: true }, cell => {
      cell.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    });
  }
  xlRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
    if ([7, 9, 10].includes(colIdx)) {
      cell.numFmt = '#,##0.000;(#,##0.000)';
      cell.alignment = { horizontal: 'right' };
    }
    if ([9, 10].includes(colIdx)) cell.numFmt = '#,##0';
  });
  if (groupBreak) {
    // Bold the AHS Name on group break
    xlRow.getCell('ahsName').font = { bold: true };
  } else {
    // Repeat fields but lighter to show grouping
    xlRow.getCell('ahsCode').font = { color: { argb: 'FF9CA3AF' } };
    xlRow.getCell('ahsName').font = { color: { argb: 'FF9CA3AF' } };
    xlRow.getCell('outputUnit').font = { color: { argb: 'FF9CA3AF' } };
  }
  prevAhs = data.ahsCode;
  row++;
}

// ---------- Sheet 3: Material ----------

const mat = wb.addWorksheet('Material', {
  views: [{ state: 'frozen', ySplit: 1 }],
});

const matCols = [
  { header: 'Code',        key: 'code',       width: 10 },
  { header: 'Name',        key: 'name',       width: 38 },
  { header: 'Unit',        key: 'unit',       width: 10 },
  { header: 'Unit Price',  key: 'unitPrice',  width: 14 },
  { header: 'Tier',        key: 'tier',       width: 8  },
  { header: 'Category',    key: 'category',   width: 16 },
];
mat.columns = matCols.map(c => ({ header: c.header, key: c.key, width: c.width }));
styleHeader(mat, 1, matCols);

const matRows = [
  { code: 'M-001', name: 'Beton readymix fc 25 MPa',     unit: 'm3',     unitPrice: 1_350_000, tier: 2, category: 'Beton'    },
  { code: 'M-002', name: 'Besi ulir D13',                unit: 'kg',     unitPrice:    17_500, tier: 1, category: 'Besi'     },
  { code: 'M-003', name: 'Beton readymix fc 30 MPa',     unit: 'm3',     unitPrice: 1_150_000, tier: 2, category: 'Beton'    },
  { code: 'M-004', name: 'Besi ulir D13',                unit: 'kg',     unitPrice:    17_500, tier: 1, category: 'Besi'     },
  { code: 'M-005', name: 'Besi ulir D16',                unit: 'kg',     unitPrice:    17_500, tier: 1, category: 'Besi'     },
  { code: 'M-006', name: 'Besi ulir D19',                unit: 'kg',     unitPrice:    17_500, tier: 1, category: 'Besi'     },
  { code: 'M-007', name: 'Kawat bendrat',                unit: 'kg',     unitPrice:    17_500, tier: 3, category: 'Pelengkap'},
  { code: 'M-008', name: 'Plywood 12 mm (1.22×2.44 m)',  unit: 'lembar', unitPrice:   175_000, tier: 2, category: 'Kayu'     },
  { code: 'M-009', name: 'Kayu kaso 5/7',                unit: 'm3',     unitPrice: 2_800_000, tier: 2, category: 'Kayu'     },
  { code: 'M-010', name: 'Bata ringan 60×20×10 cm',      unit: 'bh',     unitPrice:     8_500, tier: 2, category: 'Pasangan' },
  { code: 'M-011', name: 'Mortar perekat bata ringan',   unit: 'kg',     unitPrice:     1_000, tier: 2, category: 'Pasangan' },
  { code: 'M-012', name: 'Semen Portland 40 kg',         unit: 'kg',     unitPrice:     1_500, tier: 2, category: 'Semen'    },
  { code: 'M-013', name: 'Pasir pasang',                 unit: 'm3',     unitPrice:   350_000, tier: 2, category: 'Aggregat' },
];

let r2 = 2;
for (const m of matRows) {
  const xlRow = mat.addRow(m);
  xlRow.getCell('unitPrice').numFmt = '#,##0';
  xlRow.getCell('unitPrice').alignment = { horizontal: 'right' };
  xlRow.getCell('tier').alignment = { horizontal: 'center' };
  if (r2 % 2 === 0) {
    xlRow.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
  }
  r2++;
}

// ---------- Sheet 4: Upah ----------

const upah = wb.addWorksheet('Upah', { views: [{ state: 'frozen', ySplit: 1 }] });
const upahCols = [
  { header: 'Code',       key: 'code',      width: 10 },
  { header: 'Role',       key: 'role',      width: 28 },
  { header: 'Unit',       key: 'unit',      width: 12 },
  { header: 'Unit Price', key: 'unitPrice', width: 14 },
];
upah.columns = upahCols.map(c => ({ header: c.header, key: c.key, width: c.width }));
styleHeader(upah, 1, upahCols);

const upahRows = [
  { code: 'L-001', role: 'Tukang batu',  unit: 'org-hari', unitPrice: 175_000 },
  { code: 'L-002', role: 'Pekerja',      unit: 'org-hari', unitPrice: 150_000 },
  { code: 'L-003', role: 'Tukang besi',  unit: 'org-hari', unitPrice: 175_000 },
  { code: 'L-004', role: 'Tukang kayu',  unit: 'org-hari', unitPrice: 150_000 },
  { code: 'L-005', role: 'Mandor',       unit: 'org-hari', unitPrice: 225_000 },
];
let r3 = 2;
for (const u of upahRows) {
  const xlRow = upah.addRow(u);
  xlRow.getCell('unitPrice').numFmt = '#,##0';
  xlRow.getCell('unitPrice').alignment = { horizontal: 'right' };
  if (r3 % 2 === 0) {
    xlRow.eachCell({ includeEmpty: true }, c => { c.fill = ALT_FILL; });
  }
  r3++;
}

// ---------- Sheet 5: README ----------

const readme = wb.addWorksheet('README');
readme.columns = [{ width: 110 }];
const lines = [
  'SANO Simplified BoQ Template',
  '',
  'This workbook is a simplified version of a SANO-compatible BoQ.',
  'Use it as a reference when starting a new project or migrating an old workbook.',
  '',
  'Sheets:',
  '  • RAB       — the bill of quantities, one row per item, header at row 1.',
  '  • AHS       — recipes (Analisa Harga Satuan), flat layout with stable AHS Code.',
  '  • Material  — material catalog with stable codes (M-001 …).',
  '  • Upah      — labor catalog with stable codes (L-001 …).',
  '',
  'Why this layout is parser-friendly:',
  '  1. Header at row 1 on every sheet (no decorative banner rows).',
  '  2. No formulas. Every number is literal. Volume × Unit Price = Total computed offline.',
  '  3. Chapter and Sub-chapter are explicit columns. No roman numerals or single-letter sub-chapter mixed into NO.',
  '  4. AHS Code is a stable string. RAB references AHS by code; AHS references catalog by code.',
  '     The parser never has to fuzzy-match material names.',
  '  5. Cost split (Material / Upah / Peralatan / Subkon / Prelim) is on the RAB row directly, in plain numbers.',
  '     The Unit Price column is the sum of those five — but stored as a literal so the parser doesn\'t recompute.',
  '  6. Tier (1/2/3) is in the Material sheet on every row so envelope checks know which tier policy applies.',
  '  7. No REKAP / takeoff dependency sheets. Volume is pre-computed.',
  '',
  'Mapping back to SANO\'s current parser:',
  '  • RAB columns mirror the BoQ extract output. The parser can read this with header detection set to row 1.',
  '  • AHS uses one row per (recipe × component) — equivalent to the parsed StagingRow shape for AHS components.',
  '  • Material codes link AHS components to the catalog without any name normalization step.',
  '',
  'How to start a new project from this template:',
  '  1. Copy this file.',
  '  2. Replace the RAB rows with your project\'s actual items.',
  '  3. Add or remove AHS recipes as needed, keeping the Code column stable.',
  '  4. Keep the Material / Upah codes stable across projects so reporting can roll up.',
  '  5. Upload to SANO. The parser should produce zero "needs_review" rows on a workbook in this shape.',
];
lines.forEach((line, i) => {
  const c = readme.getCell(i + 1, 1);
  c.value = line;
  if (i === 0) c.font = { bold: true, size: 16 };
  else if (line.endsWith(':') || /^\s*Sheets:|Why this/.test(line)) c.font = { bold: true };
  c.alignment = { wrapText: true, vertical: 'top' };
});

// ---------- Save ----------

const outPath = 'assets/BOQ/SANO_Simplified_Template.xlsx';
await wb.xlsx.writeFile(outPath);
console.log('Wrote:', outPath);
