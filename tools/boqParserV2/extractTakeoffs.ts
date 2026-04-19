import type { HarvestedCell, HarvestLookup, CostBasis, RefCells, CostSplit, BoqRowRecipe } from './types';
import { parseFormulaRef, toNumber } from './classifyComponent';

export interface BoqRowV2 {
  code: string;
  label: string;
  unit: string;
  planned: number;
  sourceRow: number;
  cost_basis: CostBasis | null;
  ref_cells: RefCells | null;
  // Cached per-unit cost split pulled directly from the BoQ row when the
  // workbook stores material / labor / equipment / subkon columns (common
  // layout for large projects like Pakuwon AAL-5). Null when the layout
  // has no such columns.
  cost_split: CostSplit | null;
  subkon_cost_per_unit: number | null;
  total_cost: number | null;      // F column (D × E) cached total, for audit display
  // Derived context for code generation and display grouping.
  chapter: string | null;          // e.g. "PEKERJAAN PERSIAPAN"
  chapter_index: string | null;    // e.g. "I", "II"
  sub_chapter: string | null;      // e.g. "Poer (Readymix fc' 30 MPa) :"
  sub_chapter_letter: string | null; // e.g. "A"
  is_sub_item: boolean;            // true when B starts with "-" under a sub-chapter
  recipe: BoqRowRecipe | null;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  return toNumber(c.value);
}

const SUM_ARG_RE = /'([^']+)'!(\$?[A-Z]+\$?\d+)/g;

function extractSumIfsRefs(formula: string | null): RefCells['quantity'] {
  if (!formula) return undefined;
  const out: NonNullable<RefCells['quantity']> = [];
  let m: RegExpExecArray | null;
  while ((m = SUM_ARG_RE.exec(formula)) !== null) {
    const sheet = m[1];
    const cell = m[2].replace(/\$/g, '');
    out.push({ sheet, cell, cached_value: null });
  }
  return out.length > 0 ? out : undefined;
}

export function findHeaderRow(byRow: Map<number, Map<string, HarvestedCell>>): number {
  const sorted = Array.from(byRow.keys()).sort((a, b) => a - b);
  for (const row of sorted) {
    const b = byRow.get(row)?.get('B');
    if (b && /uraian/i.test(String(b.value ?? ''))) return row;
  }
  return -1;
}

// Detect which columns on the BoQ sheet hold the pre-computed cost split.
// AAL-5 uses I=Material, J=Upah, K=Peralatan (labels are in the header row).
// We scan the header row for these labels and fall back to the canonical
// AAL-5 positions when no labels are present. Returns null when the sheet
// has no split columns at all.
export function detectCostSplitColumns(
  byRow: Map<number, Map<string, HarvestedCell>>,
  headerRow: number,
): { material: string; labor: string; equipment: string; subkon: string | null; prelim: string | null } | null {
  if (headerRow === -1) return null;
  const hdr = byRow.get(headerRow);
  if (!hdr) return null;

  // Large workbooks like AAL-5 label many cost breakdown columns with the
  // same words (Material appears at I, R, W, AA, AD — the latter are
  // intermediate aggregations for rebar/bekisting/readymix). The primary
  // per-unit split always sits in the leftmost occurrence, so we sort
  // columns and pick the first match per label type.
  let material = '', labor = '', equipment = '';
  let subkon: string | null = null;
  let prelim: string | null = null;
  const sortedCols = Array.from(hdr.entries()).sort((a, b) => {
    const toIdx = (s: string) => s.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    return toIdx(a[0]) - toIdx(b[0]);
  });
  for (const [col, cell] of sortedCols) {
    const txt = String(cell.value ?? '').trim().toLowerCase();
    if (!txt) continue;
    if (!material && /^material$|^bahan$/.test(txt)) material = col;
    else if (!labor && /^upah$|^labor$|^tukang$/.test(txt)) labor = col;
    else if (!equipment && /^peralatan$|^alat$|^equipment$/.test(txt)) equipment = col;
    else if (!subkon && /^sub[- ]?kon/.test(txt)) subkon = col;
    else if (!prelim && /^prelim|^persiapan/.test(txt)) prelim = col;
  }
  // Fall back to AAL-5 canonical layout if we found at least one label but
  // not all of them — workbooks often leave peralatan/subkon unlabeled.
  if (material || labor || equipment) {
    return {
      material: material || 'I',
      labor: labor || 'J',
      equipment: equipment || 'K',
      subkon,
      prelim,
    };
  }
  return null;
}

export function extractBoqRows(
  cells: HarvestedCell[],
  lookup: HarvestLookup,
  boqSheetName: string,
): BoqRowV2[] {
  const byRow = new Map<number, Map<string, HarvestedCell>>();
  for (const c of cells) {
    if (c.sheet !== boqSheetName) continue;
    const colLetter = c.address.replace(/\d+/g, '');
    const map = byRow.get(c.row) ?? new Map();
    map.set(colLetter, c);
    byRow.set(c.row, map);
  }

  // Detect header row to skip it and all rows before it. RAB (A) typically
  // has a header like: A=NO  B=URAIAN PEKERJAAN  C=SAT  D=VOLUME  ...
  // We look for a row with B containing "uraian" — the real header keyword.
  // Must search in ascending row order so we find the actual header, not
  // a section heading like "PEKERJAAN PERSIAPAN" that also matches.
  const sortedRowNums = Array.from(byRow.keys()).sort((a, b) => a - b);
  const headerRow = findHeaderRow(byRow);

  const splitCols = detectCostSplitColumns(byRow, headerRow);

  // Iterate in row order so we can track chapter / sub-chapter state and
  // derive hierarchical codes like "II.A.5" for real line items.
  const ROMAN_RE = /^(I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3}|X{0,3}V?I{0,3})\.?$/;
  const SUBCHAPTER_LETTER_RE = /^[A-Z]\.?$/;

  let chapterLabel: string | null = null;
  let chapterIndex: string | null = null;
  let subChapterLabel: string | null = null;
  let subChapterLetter: string | null = null;
  let itemCounter = 0;       // reset on new sub-chapter or new chapter
  let subItemCounter = 0;    // reset on new sub-chapter parent item
  // AAL-5 uses sub-sub-chapter rows like "Poer (Readymix) :", "Sloof :",
  // "Kolom :" under a single sub-chapter (e.g. III.A). Each group restarts
  // the "1, 2, 3..." numbering in column A, so without this counter every
  // group's items collide on the same code (III.A.1 five times). Including
  // it as the third segment keeps codes unique across groups.
  let subSubChapterCounter = 0;
  // AAL-5 (VII chapter) re-uses the same sub-chapter letter ("B") for two
  // consecutive sub-chapters, which would otherwise produce duplicate codes
  // across both groups. Track how many times we've seen each letter in the
  // current chapter and append the ordinal ("B2") for second+ occurrences.
  let lettersInChapter = new Map<string, number>();

  const out: BoqRowV2[] = [];
  for (const row of sortedRowNums) {
    if (row <= headerRow) continue;
    const map = byRow.get(row)!;
    const label = cellText(map.get('B'));   // description
    const unit = cellText(map.get('C'));    // satuan
    if (!label) continue;
    const aText = cellText(map.get('A'));
    const aNorm = aText.trim().replace(/\.$/, '');

    const planned = cellNumber(map.get('D'));

    // Chapter header: A has Roman numeral, B has a title, no unit, no volume.
    if (aNorm.length > 0 && ROMAN_RE.test(aNorm) && !unit && planned <= 0) {
      chapterIndex = aNorm;
      chapterLabel = label;
      subChapterLetter = null;
      subChapterLabel = null;
      itemCounter = 0;
      subItemCounter = 0;
      subSubChapterCounter = 0;
      lettersInChapter = new Map();
      continue;
    }

    // Sub-chapter header: A has single capital letter, no unit, no volume.
    if (SUBCHAPTER_LETTER_RE.test(aNorm) && !unit && planned <= 0) {
      const baseLetter = aNorm.replace(/\.$/, '');
      const prev = lettersInChapter.get(baseLetter) ?? 0;
      const next = prev + 1;
      lettersInChapter.set(baseLetter, next);
      subChapterLetter = next > 1 ? `${baseLetter}${next}` : baseLetter;
      subChapterLabel = label;
      itemCounter = 0;
      subItemCounter = 0;
      subSubChapterCounter = 0;
      continue;
    }

    // Subtotal row — skip silently.
    if (/^sub\s*total|^jumlah/i.test(label)) continue;

    // Text row with no unit and no volume. Two distinct shapes:
    //   A empty (or non-numeric): sub-sub-chapter decorator like
    //     "Poer (Readymix fc' 30 MPa) :" above a block of sub-items.
    //   A numeric: parent item like "1 Rangka atap utama" that has no value
    //     itself because its sub-items hold the quantities. Treat numeric A
    //     as setting itemCounter directly so sub-items below encode under
    //     that number (e.g. VII.B.1.1, VII.B.1.2, ...) without inventing a
    //     spurious sub-sub-chapter segment.
    if (!unit && planned <= 0) {
      if (/^\d+$/.test(aText)) {
        itemCounter = parseInt(aText, 10);
        subItemCounter = 0;
        continue;
      }
      subChapterLabel = label;
      subSubChapterCounter++;
      itemCounter = 0;
      subItemCounter = 0;
      continue;
    }

    // A real line item must have a unit or positive volume (checked above).

    // Sub-items: description starts with "-" and appears under a
    // sub-chapter parent. Assign sequential sub-item numbers.
    const isSubItem = /^\s*[-–—]\s/.test(label);
    let code: string;
    if (isSubItem) {
      subItemCounter++;
      const parts = [chapterIndex ?? 'I'];
      if (subChapterLetter) parts.push(subChapterLetter);
      if (subSubChapterCounter > 0) parts.push(String(subSubChapterCounter));
      if (itemCounter > 0) parts.push(String(itemCounter));
      parts.push(`${subItemCounter}`);
      code = parts.join('.');
    } else {
      itemCounter++;
      subItemCounter = 0;
      const parts = [chapterIndex ?? 'I'];
      if (subChapterLetter) parts.push(subChapterLetter);
      if (subSubChapterCounter > 0) parts.push(String(subSubChapterCounter));
      if (/^\d+$/.test(aText)) {
        parts.push(aText);
      } else {
        parts.push(String(itemCounter));
      }
      code = parts.join('.');
    }

    const dCell = map.get('D');
    const ref = parseFormulaRef(dCell?.formula ?? null, boqSheetName);
    let cost_basis: CostBasis | null = null;
    let ref_cells: RefCells | null = null;
    if (ref.kind === 'aggregation') {
      cost_basis = 'takeoff_ref';
      const refs = extractSumIfsRefs(dCell?.formula ?? null);
      if (refs) ref_cells = { quantity: refs };
    }

    // Pull per-unit cost split directly from the BoQ row when the workbook
    // exposes Material/Upah/Peralatan/Subkon columns. The cached values
    // here already encode whatever multi-hop formula chain the workbook
    // uses (e.g. =AF51, AF51=R51+V51*W51+..., R51=Analisa!$F$82), so the
    // parser does not need to follow those hops to surface numbers.
    let cost_split: CostSplit | null = null;
    let subkon_cost_per_unit: number | null = null;
    if (splitCols) {
      const m = cellNumber(map.get(splitCols.material));
      const l = cellNumber(map.get(splitCols.labor));
      const e = cellNumber(map.get(splitCols.equipment));
      const s = splitCols.subkon ? cellNumber(map.get(splitCols.subkon)) : 0;
      const p = splitCols.prelim ? cellNumber(map.get(splitCols.prelim)) : 0;
      if (m > 0 || l > 0 || e > 0 || s > 0 || p > 0) {
        cost_split = { material: m, labor: l, equipment: e, prelim: p };
        if (s > 0) subkon_cost_per_unit = s;
        if (cost_basis === null) cost_basis = 'inline_split';
        ref_cells = ref_cells ?? {};
        ref_cells.material_cost = { sheet: boqSheetName, cell: `${splitCols.material}${row}`, cached_value: m };
        ref_cells.labor_cost = { sheet: boqSheetName, cell: `${splitCols.labor}${row}`, cached_value: l };
        ref_cells.equipment_cost = { sheet: boqSheetName, cell: `${splitCols.equipment}${row}`, cached_value: e };
      }
    }

    const total_cost = map.has('F') ? cellNumber(map.get('F')) : null;

    out.push({
      code,
      label,
      unit,
      planned,
      sourceRow: row,
      cost_basis,
      ref_cells,
      cost_split,
      subkon_cost_per_unit,
      total_cost,
      chapter: chapterLabel,
      chapter_index: chapterIndex,
      sub_chapter: subChapterLabel,
      sub_chapter_letter: subChapterLetter,
      is_sub_item: isSubItem,
      recipe: null,
    });
  }
  // sortedRowNums iteration is already in row order, but keep the sort as
  // a safety net if callers compose rows from multiple sources.
  return out.sort((a, b) => a.sourceRow - b.sourceRow);
}
