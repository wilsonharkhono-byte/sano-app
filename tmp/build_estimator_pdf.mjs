// Build a PDF for estimators explaining how the SANO BoQ parser reads
// their workbook. Uses pdf-lib (already in package.json).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const fontReg = await doc.embedFont(StandardFonts.Helvetica);
const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
const fontMono = await doc.embedFont(StandardFonts.Courier);

const PAGE_W = 595, PAGE_H = 842;           // A4
const MARGIN_L = 50, MARGIN_R = 50, MARGIN_T = 60, MARGIN_B = 50;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

const NAVY = rgb(0.07, 0.16, 0.27);
const SLATE = rgb(0.39, 0.44, 0.52);
const LIGHT = rgb(0.93, 0.96, 0.98);
const ACCENT = rgb(0.04, 0.59, 0.41);
const RED = rgb(0.86, 0.15, 0.15);
const AMBER = rgb(0.85, 0.46, 0.02);

let page = doc.addPage([PAGE_W, PAGE_H]);
let y = PAGE_H - MARGIN_T;

function newPage() {
  page = doc.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - MARGIN_T;
}

function ensureSpace(needed) {
  if (y - needed < MARGIN_B) newPage();
}

// WinAnsi-safe sanitizer — pdf-lib's StandardFonts can't render outside
// Latin-1. Replace common typographic chars with ASCII equivalents.
function asciiSafe(s) {
  return String(s)
    .replace(/[²]/g, '2')
    .replace(/[³]/g, '3')
    .replace(/[→]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/[↑]/g, '^')
    .replace(/[↓]/g, 'v')
    .replace(/[•]/g, '-')
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[…]/g, '...')
    .replace(/[≤≥]/g, '<=')
    .replace(/[×]/g, 'x')
    // Strip anything else outside printable ASCII to keep pdf-lib happy.
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function text(s, opts = {}) {
  s = asciiSafe(s);
  const size = opts.size ?? 10;
  const font = opts.bold ? fontBold : (opts.mono ? fontMono : fontReg);
  const color = opts.color ?? rgb(0, 0, 0);
  const indent = opts.indent ?? 0;
  // Wrap by approximate char width
  const charW = size * (opts.mono ? 0.6 : 0.5);
  const maxChars = Math.floor((CONTENT_W - indent) / charW);
  const words = s.split(/(\s+)/);
  let line = '';
  const lines = [];
  for (const w of words) {
    if ((line + w).length > maxChars && line.length > 0) {
      lines.push(line);
      line = w.trimStart();
    } else {
      line += w;
    }
  }
  if (line) lines.push(line);
  for (const ln of lines) {
    ensureSpace(size + 4);
    page.drawText(ln, { x: MARGIN_L + indent, y: y - size, size, font, color });
    y -= size * 1.4;
  }
  y -= opts.gap ?? 2;
}

function heading(s, level = 1) {
  s = asciiSafe(s);
  ensureSpace(level === 1 ? 28 : 22);
  if (level === 1) {
    y -= 8;
    page.drawText(s, { x: MARGIN_L, y: y - 18, size: 18, font: fontBold, color: NAVY });
    y -= 26;
    page.drawLine({ start: { x: MARGIN_L, y: y }, end: { x: MARGIN_L + CONTENT_W, y }, thickness: 1, color: NAVY });
    y -= 12;
  } else if (level === 2) {
    y -= 4;
    page.drawText(s, { x: MARGIN_L, y: y - 14, size: 14, font: fontBold, color: NAVY });
    y -= 22;
  } else {
    page.drawText(s, { x: MARGIN_L, y: y - 12, size: 12, font: fontBold, color: SLATE });
    y -= 18;
  }
}

function bullet(s, opts = {}) {
  ensureSpace(14);
  page.drawText('-', { x: MARGIN_L + (opts.indent ?? 0), y: y - 10, size: 10, font: fontReg, color: NAVY });
  text(s, { ...opts, indent: (opts.indent ?? 0) + 14 });
}

function box(textInside, opts = {}) {
  const safe = asciiSafe(textInside);
  const lines = safe.split('\n');
  const boxH = lines.length * 14 + 14;
  ensureSpace(boxH + 6);
  page.drawRectangle({
    x: MARGIN_L, y: y - boxH, width: CONTENT_W, height: boxH,
    color: opts.fill ?? LIGHT, borderColor: opts.border ?? SLATE, borderWidth: 0.5,
  });
  let yi = y - 14;
  for (const ln of lines) {
    page.drawText(ln, { x: MARGIN_L + 8, y: yi, size: 9, font: opts.mono ? fontMono : fontReg, color: opts.color ?? rgb(0, 0, 0) });
    yi -= 14;
  }
  y -= boxH + 6;
}

// ============================================================================
// CONTENT
// ============================================================================

// Cover
y -= 60;
page.drawText('How SANO Reads Your BoQ', { x: MARGIN_L, y, size: 28, font: fontBold, color: NAVY });
y -= 36;
page.drawText('A guide for estimators: from your Excel workbook to the SANO app', { x: MARGIN_L, y, size: 13, font: fontReg, color: SLATE });
y -= 30;
page.drawRectangle({ x: MARGIN_L, y: y - 4, width: CONTENT_W, height: 2, color: NAVY });
y -= 28;
text('This document explains, in plain language, exactly what happens when you upload a BoQ workbook to the SANO app. Use it to understand why some items appear correctly and why some need manual review.', { size: 11 });
y -= 12;
text('Tested against:  RAB R1 Pakuwon Indah AAL-5.xlsx', { size: 10, mono: true, color: SLATE });
text('Parser version:  boqParserV2 (tools/boqParserV2/)', { size: 10, mono: true, color: SLATE });
text('Date:           ' + new Date().toISOString().slice(0, 10), { size: 10, mono: true, color: SLATE });

newPage();

// Section 1
heading('1. The big picture', 1);
text('The parser reads your Excel workbook in three passes, builds a tree of items and recipes, and writes it as 459 staging rows to a database table called import_staging_rows. From there, an estimator reviews each row in the BaselineScreen and approves or rejects it. Approved rows become the project\'s baseline — used by every downstream feature (material requests, MTN, opname, reporting).', { size: 11 });

heading('What gets extracted', 2);
bullet('66 catalog rows from Material + Upah sheets — these are your material and labor price references.');
bullet('33 AHS blocks from the Analisa sheet — these are your recipes (e.g., "1 m3 Beton fc 30 MPa" with its component breakdown).');
bullet('222 BoQ rows from RAB (A) — these are the billable line items.');
bullet('138 recipe components — the flattened material-by-material breakdown of every BoQ row that uses an AHS recipe.');
bullet('33 validation reports — one per AHS block, confirming that subtotals add up correctly.');

heading('What the parser does NOT do', 2);
bullet('It does NOT change your numbers. Every Volume, Unit Price, and Total in your workbook is preserved exactly as cached by Excel.');
bullet('It does NOT invent material names. If a recipe references "Pasir Lmj" and your Material sheet has "Pasir Lumajang", the parser keeps "Pasir Lmj" — it won\'t silently fix the mismatch.');
bullet('It does NOT decide for you. Rows it can\'t classify cleanly are flagged needs_review and shown in the BaselineScreen for your decision.');

newPage();

// Section 2
heading('2. The 9 pipeline steps', 1);

heading('Step 1: harvestWorkbook — read every cell', 3);
text('The parser opens your .xlsx file, walks every sheet, and captures the value AND the formula of every non-empty cell. Stored as a flat array; no transformations yet. This is faithful — what your Excel sees is what we see.');

heading('Step 2: detectAhsBlocks — find your recipes', 3);
text('In the Analisa sheet, the parser looks for rows that match one of two patterns:');
box('Pattern A:  "1 m3 Beton fc 30 MPa"\nPattern B:  "Pekerjaan Persiapan"  ("Pasangan Bata", "Pengecoran ...")', { mono: true });
text('When it finds a match, that\'s the START of an AHS block. The block continues row-by-row until it hits a "Jumlah" row, which marks the END. Everything between is the recipe.');
text('From AAL-5, this step finds 33 blocks. Each block carries: title row, Jumlah row, and a list of component rows.');

heading('Step 3: extractCatalogRows — your material price list', 3);
text('Walks the Material and Upah sheets row by row. Each row becomes a catalog entry with: code, name, unit, reference unit price. This is your "what we expect to pay for X" sheet.');
text('From AAL-5, this gives 66 catalog rows. Notice: this is the parser\'s reference. If a recipe uses a price that differs from the catalog, the parser respects the recipe (treats the catalog as advisory).');

heading('Step 4: extractBoqRows — your billable items', 3);
text('For each RAB sheet, walks row by row from row 8 downward. Distinguishes:');
bullet('Chapter headers (Roman numeral I, II, III in column A) — context only, no money.');
bullet('Sub-chapter headers (single letter A, B, C in column A) — context only, no money.');
bullet('Data rows (integer code in column A) — billable items with volume + unit price.');
bullet('Sub-items (column A empty, description starts with "- ") — children of the previous data row.');
text('Each data row is captured with its full cost split: Material / Upah / Peralatan / Subkon / Prelim from columns I–M. From AAL-5: 222 BoQ rows.', { size: 10 });

heading('Step 5: buildRecipe — link each row to its recipe', 3);
text('This is the magic step. For each BoQ row, the parser walks ALL its formulas (columns I, J, K, L, M, N) looking for references to the Analisa sheet. It follows references up to 100 hops — so a chain like:');
box('N{row} = SUM(I:M)\nI{row} = AF{row}\nAF{row} = R{row} + V{row}*W{row}\nR{row} = Analisa!F$82', { mono: true });
text('is fully resolved to "this BoQ row uses the AHS block whose Jumlah is at row 82". Without this, the AAL-5 workbook\'s 25+ AF-composite rows would be lost.');

heading('Step 6: disaggregateRebar — split rebar by diameter', 3);
text('If a BoQ row\'s description matches structural element prefixes (Sloof, Balok, Kolom, Poer, Plat) AND its recipe contains a Pembesian aggregate, the parser looks up the corresponding REKAP sheet and splits "Pembesian total kg" into D8 / D10 / D13 / D16 / D19 lines.');
text('This means a single "Pembesian Poer 2,450 kg" line becomes 5 lines: 858 kg D13, 980 kg D16, 612 kg D19, etc. — exactly the procurement view a buyer needs.');

heading('Step 7: validateBlocks — check the math', 3);
text('For every AHS block, the parser sums the component subtotals (column F on component rows) and compares to the Jumlah cached value. If they match within 1 IDR / 1000 of jumlah, the block is balanced (status: ok). Otherwise: imbalanced — flagged for review.');
text('AAL-5 result: 33 / 33 blocks balanced. Zero issues at validation time.');

heading('Step 8: build StagingRowV2 — the DB-ready payload', 3);
text('Everything captured is packed into 459 StagingRowV2 records, one per material / AHS block / AHS component / BoQ row. Each carries: row_type, row_number, raw_data, parsed_data, cost_basis, needs_review flag, confidence score.');

heading('Step 9: INSERT into the database', 3);
text('The 459 staging rows go straight to the import_staging_rows table. The BaselineScreen UI loads them, you review them, and when you publish, they get flattened and written to ahs_versions / boq_items / ahs_lines.');

newPage();

// Section 3: cost_basis classification
heading('3. Cost-basis classification', 1);
text('Every BoQ row gets tagged with ONE of six cost_basis values. This tells SANO how to think about that row\'s money.');

const basisTable = [
  ['catalog',       'The row references a material from your Material sheet directly. e.g., "Pasangan dinding bata merah" pulling its material cost from a catalog row.'],
  ['nested_ahs',    'The row uses an AHS recipe that itself references another AHS block. e.g., "Pengecoran lantai" uses "Beton fc 30 MPa" which uses "Semen + Pasir + Split".'],
  ['literal',       'The cost is a hardcoded number with no formula link. e.g., a one-off allowance like "Direksi keet" = Rp 30M.'],
  ['takeoff_ref',   'The row pulls its volume or cost from a REKAP sheet (Balok / Kolom / etc.). Common for rebar.'],
  ['cross_ref',     'The row references another RAB row directly. Less common — a sort of "see line 41" pattern.'],
  ['inline_split',  'The row\'s per-unit cost split (Material / Upah / Peralatan / Subkon / Prelim columns) is filled in directly with literal numbers, no formula traversal needed.'],
];
for (const [b, d] of basisTable) {
  ensureSpace(34);
  page.drawText(b, { x: MARGIN_L, y: y - 12, size: 11, font: fontBold, color: ACCENT });
  y -= 18;
  text(d, { size: 10 });
  y -= 4;
}

newPage();

heading('4. Common patterns that work', 1);

heading('A. Clean AHS reference', 2);
box('RAB row col I formula:   =Analisa!$F$150\n\nWhat the parser sees:    block ending at row 150 → linked. Recipe expanded.', { mono: true, fill: rgb(0.91, 0.97, 0.93) });
text('This is the simplest reference pattern. The parser handles it perfectly.');

heading('B. AF-composite (AAL-5 pattern)', 2);
box('RAB col I:   =AF51\nRAB col AF:  =R51+V51*W51+Z51*AA51\nRAB col R:   =Analisa!F$82\nRAB col V:   =Analisa!F$155\n\nWhat the parser sees:    100-hop traversal finds blocks at row 82 and 155.\n                         Both linked to this BoQ row.', { mono: true, fill: rgb(0.91, 0.97, 0.93) });
text('Complex but supported. The parser builds the multi-block recipe and shows it in the BaselineScreen.');

heading('C. Inline split (no recipe needed)', 2);
box('RAB col I:  4,500,000        (Material per unit — literal)\nRAB col J:  2,700,000        (Upah per unit — literal)\nRAB col K:  0\nRAB col N:  =SUM(I:M)  →  7,200,000\n\ncost_basis: inline_split\n\nWhat the parser does:   Use these numbers verbatim. No AHS needed.', { mono: true, fill: rgb(0.91, 0.97, 0.93) });
text('Lump-sum and direct-cost items work this way. Perfectly fine — not every row needs a recipe.');

newPage();

heading('5. Common patterns that confuse the parser', 1);

heading('A. AHS title without unit prefix', 2);
box('Analisa title:   "Beton fc 30 MPa"      (no quantity, no unit)\n\nParser reaction: NOT recognized as a title. Block silently dropped.', { mono: true, fill: rgb(0.99, 0.92, 0.92) });
text('Fix:  prepend "1 m3 " (or whatever the output unit is). Becomes "1 m3 Beton fc 30 MPa". Now the parser sees it.', { size: 10 });

heading('B. Material name typo / abbreviation', 2);
box('Material sheet:  "Bata Merah"\nAnalisa recipe:  "Bata Mrh"          (typo / abbreviation)\n\nParser reaction: name doesn\'t match catalog. Flagged needs_review.', { mono: true, fill: rgb(0.99, 0.92, 0.92) });
text('Fix:  rename either side to match. Best practice — give every material a CODE in the Material sheet (e.g., M-002) and reference by code in Analisa.', { size: 10 });

heading('C. Wrong unit', 2);
box('Volume unit:    "m²"  (Excel\'s superscript)\nCanonical:      "m2"  (ASCII)\n\nParser reaction: depends — the regex usually catches both, but other code paths may not.', { mono: true, fill: rgb(0.99, 0.92, 0.92) });
text('Fix:  use ASCII units throughout. The canonical set is m, m2, m3, kg, ls, bh, titik, set, lembar, sak, org-hari.', { size: 10 });

heading('D. Missing Jumlah row', 2);
box('Analisa AHS block ends without a "Jumlah" row. Two blocks run into each other.\n\nParser reaction: Block boundary not detected. Two blocks merged into one with wrong total.', { mono: true, fill: rgb(0.99, 0.92, 0.92) });
text('Fix:  Every AHS block must end with a row whose column E says "Jumlah" and column F holds the total. No exceptions.', { size: 10 });

heading('E. Two blocks with the same title', 2);
box('"1 m2 Bekisting Bata Merah"  (appears twice at rows 13 and 145)\n\nParser reaction: which one does the RAB row reference? Ambiguous.', { mono: true, fill: rgb(0.99, 0.92, 0.92) });
text('Fix:  Disambiguate. "1 m2 Bekisting Bata Merah (campuran 1:4)" vs "1 m2 Bekisting Bata Merah (campuran 1:3)".', { size: 10 });

heading('F. Header row in the wrong place', 2);
box('RAB sheet:  header on row 1 instead of row 7.\n\nParser reaction: row 7 is empty → parser thinks header is missing → no columns detected.', { mono: true, fill: rgb(0.99, 0.92, 0.92) });
text('Fix:  Put your header on row 7. Insert blank rows above or move things down. The parser is hardcoded to expect row 7.', { size: 10 });

newPage();

heading('6. Quick checklist before uploading', 1);

const checklist = [
  'Sheet names match the canonical list: RAB (A), Analisa, Material, Upah, optionally REKAP RAB.',
  'RAB header row is at row 7. Data starts at row 8.',
  'Every AHS block in Analisa starts with a title row matching either "<qty> <unit> <desc>" or "Pekerjaan ..." / "Pasangan ..." / "Pembesian ..." patterns.',
  'Every AHS block ends with a "Jumlah" row that has its total in column F.',
  'Every material name in Analisa appears in the Material sheet, spelled identically.',
  'Units are ASCII: m, m2, m3, kg, ls, bh, titik, set, lembar, sak, org-hari.',
  'AHS block titles are unique within the Analisa sheet.',
  'BoQ rows in RAB either reference an AHS block (via column I formula) OR have direct numbers in columns I/J/K/L/M.',
  'No formula errors anywhere (#REF!, #NAME?, #DIV/0!).',
  'AHS block subtotals balance: sum of component F values equals the Jumlah F value.',
];
for (let i = 0; i < checklist.length; i++) {
  ensureSpace(28);
  const label = String(i + 1).padStart(2, '0') + '.';
  page.drawText(label, { x: MARGIN_L, y: y - 12, size: 11, font: fontBold, color: ACCENT });
  y -= 4;
  text(checklist[i], { size: 10, indent: 22 });
  y -= 6;
}

newPage();

heading('7. What happens after the parser finishes', 1);
text('Once parseBoqV2 returns, the 459 staging rows are inserted into the import_staging_rows database table. The BaselineScreen in the SANO app reads from this table and displays:');
bullet('A tab for Catalog rows — your material and labor list.');
bullet('A tab for AHS blocks — your recipes, expandable to show components.');
bullet('A tab for BoQ rows — every line item, grouped by chapter.');
bullet('A flag column showing which rows are flagged needs_review.');
text('You review each row. You can:');
bullet('Approve a row as-is.');
bullet('Reject a row (it won\'t be published).');
bullet('Mark for human review (saved but doesn\'t publish until you decide).');
text('When you click Publish, the publishBaselineV2 function reads approved rows and writes them to:');
bullet('ahs_versions — one row per import; marks this as the new "current" baseline for the project.');
bullet('boq_items — every approved BoQ row.');
bullet('ahs_lines — every flattened recipe component.');
text('From this point, every other SANO feature (Permintaan, MTN, Opname, Reporting) uses these tables as the project\'s source of truth.');

heading('8. Pipeline summary diagram', 1);
box(
  'Your .xlsx workbook\n'+
  '       |\n'+
  '       v\n'+
  '  parseBoqV2()\n'+
  '       |  • harvestWorkbook   (every cell)\n'+
  '       |  • detectAhsBlocks   (33 blocks from Analisa)\n'+
  '       |  • extractCatalog    (66 material/upah rows)\n'+
  '       |  • extractBoqRows    (222 BoQ rows)\n'+
  '       |  • buildRecipe       (formula traversal, 100-hop)\n'+
  '       |  • disaggregateRebar (rebar split by diameter)\n'+
  '       |  • validateBlocks    (subtotal balance check)\n'+
  '       v\n'+
  '  StagingRowV2[]    (459 rows)\n'+
  '       |\n'+
  '       v\n'+
  '  import_staging_rows  table (per session_id)\n'+
  '       |\n'+
  '       v\n'+
  '  BaselineScreen  — estimator reviews\n'+
  '       |   (approve / reject / under review)\n'+
  '       v\n'+
  '  publishBaselineV2()\n'+
  '       |   topoSort, flatten\n'+
  '       v\n'+
  '  ahs_versions  +  boq_items  +  ahs_lines\n'+
  '       |\n'+
  '       v\n'+
  '  Permintaan / MTN / Opname / Reporting',
  { mono: true, fill: LIGHT }
);

text('That\'s the whole journey. From your Excel file to a SANO project baseline.', { size: 11 });
y -= 16;
text('Questions, edge cases, or new patterns? Talk to the SANO team — every pattern we add to the parser makes life easier for the next project.', { size: 10, color: SLATE });

// Save
const bytes = await doc.save();
writeFileSync('docs/SANO_BOQ_PARSER_GUIDE.pdf', bytes);
console.log('Wrote docs/SANO_BOQ_PARSER_GUIDE.pdf  (' + (bytes.length / 1024).toFixed(1) + ' KB)');
