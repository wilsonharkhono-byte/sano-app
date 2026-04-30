import { harvestWorkbook } from './harvest';
import { detectAhsBlocks } from './detectBlocks';
import { classifyComponent, toNumber } from './classifyComponent';
import { extractCatalogRows, type CatalogRow } from './extractCatalog';
import { extractBoqRows, type BoqRowV2, detectCostSplitColumns, findHeaderRow } from './extractTakeoffs';
import { buildRecipe } from './recipeBuilder';
import { validateBlocks } from './validate';
import { disaggregateRebar } from './rebarDisaggregator';
import { resolveBoqSheets, type BoqSheetOption } from './multiSheetScanner';
import type {
  HarvestedCell,
  HarvestLookup,
  ValidationReport,
  StagingRowV2,
} from './types';
import type { AhsBlock } from './detectBlocks';

export interface ParseBoqV2Options {
  analisaSheet?: string;
  boqSheet?: BoqSheetOption;
  catalogSheets?: string[];
}

export interface ParseBoqV2Result {
  cells: HarvestedCell[];
  lookup: HarvestLookup;
  materialRows: CatalogRow[];
  ahsBlocks: AhsBlock[];
  boqRows: BoqRowV2[];
  validationReport: ValidationReport;
  stagingRows: StagingRowV2[];
}

export async function parseBoqV2(
  fileBuffer: Buffer | ArrayBuffer,
  options: ParseBoqV2Options = {},
): Promise<ParseBoqV2Result> {
  const analisaSheet = options.analisaSheet ?? 'Analisa';
  const boqSheetOption: BoqSheetOption = options.boqSheet ?? 'RAB (A)';
  const catalogSheets = options.catalogSheets ?? ['Material', 'Upah'];

  const { cells, lookup, workbook } = await harvestWorkbook(fileBuffer);
  const sheets = resolveBoqSheets(workbook, boqSheetOption);

  const materialRows = extractCatalogRows(cells, catalogSheets);
  const ahsBlocks = detectAhsBlocks(cells, analisaSheet);

  // Collect BoQ rows from all resolved sheets
  const boqRows: BoqRowV2[] = [];
  for (const sheet of sheets) {
    const rows = extractBoqRows(cells, lookup, sheet);
    for (const r of rows) boqRows.push(r);
  }

  // Namespace codes when multiple sheets are parsed: prefix each row's code
  // with the bracketed letter from its source_sheet, e.g. "(A) I.1".
  if (sheets.length > 1) {
    for (const b of boqRows) {
      const m = /^RAB\s*\(([A-Z])\)$/i.exec(b.source_sheet);
      if (m) b.code = `(${m[1].toUpperCase()}) ${b.code}`;
    }
  }

  // Recipe assembly: for every BoQ row that already has a cost_split, run
  // the formula interpreter across I/J/K/L/M columns to produce a composite
  // recipe. When the column detector returns null (no split columns in
  // this workbook), skip — each row's recipe stays null.
  // Loop per sheet so byRow and splitCols are scoped correctly.
  for (const sheet of sheets) {
    const byRow = new Map<number, Map<string, HarvestedCell>>();
    for (const c of cells) {
      if (c.sheet !== sheet) continue;
      const colLetter = c.address.replace(/\d+/g, '');
      const map = byRow.get(c.row) ?? new Map();
      map.set(colLetter, c);
      byRow.set(c.row, map);
    }
    const headerRow = findHeaderRow(byRow);
    const splitCols = detectCostSplitColumns(byRow, headerRow);

    if (splitCols) {
      for (const b of boqRows) {
        if (b.source_sheet !== sheet) continue;
        if (!b.cost_split) continue;
        b.recipe = buildRecipe({
          sourceRow: b.sourceRow,
          sourceSheet: sheet,
          costSplit: b.cost_split,
          subkonPerUnit: b.subkon_cost_per_unit ?? 0,
          splitColumns: splitCols,
          markupCell: 'E',
          totalCell: 'F',
          lookup,
          blocks: ahsBlocks,
          analisaSheet,
        });
      }
    }
  }

  // Existing per-sheet recipeBuilder loop ends here.
  // Now disaggregate rebar components for any BoQ row whose label matches
  // an element prefix (Sloof|Balok|Kolom|Poer|Plat) and whose recipe has
  // a Pembesian aggregate. Non-rebar rows pass through unchanged.
  const disaggregateResult = disaggregateRebar(boqRows, cells);
  boqRows.length = 0;
  boqRows.push(...disaggregateResult.boqRows);
  // Note: disaggregateResult.warnings is collected here for future surfacing
  // in validationReport. For now we keep it scoped — Task 9+ may include
  // them in the parsed result.

  const validationReport = validateBlocks(ahsBlocks);

  const stagingRows: StagingRowV2[] = [];
  let rowNumber = 0;

  for (const m of materialRows) {
    stagingRows.push({
      row_type: 'material',
      row_number: ++rowNumber,
      raw_data: { sourceRow: m.sourceRow },
      parsed_data: {
        code: m.code,
        name: m.name,
        unit: m.unit,
        reference_unit_price: m.reference_unit_price,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: null,
      parent_ahs_staging_id: null,
      ref_cells: null,
      cost_split: null,
    });
  }

  // Build BoQ → AHS linkage by scanning ALL formula cells in each BoQ row
  // for direct references to the Analisa sheet, plus a shallow one-hop
  // trace through same-sheet cells. AAL-5 routinely chains
  //   D=H, E=N*markup, N=SUM(I:M), I=AF, AF=R+V*W+Z*AA, R=Analisa!F82
  // so looking only at column I/J misses nearly all links. We scan every
  // column of the row, and for each same-sheet reference we inspect its
  // formula too (one hop). That is enough to catch R51/W51/AA51-style
  // references that sit one indirection removed from the BoQ row.
  const ANALISA_REF_RE = /(?:'([^']+)'|([A-Za-z0-9_\- ]+))!\$?([A-Z]+)\$?(\d+)/g;
  const SAME_SHEET_REF_RE = /(?<![!:'"A-Za-z0-9_])\$?([A-Z]+)\$?(\d+)/g;

  const boqCodeByAnalisaAddress = new Map<string, string>();

  function collectAnalisaRefs(formula: string, target: string): Array<{ sheet: string; addr: string }> {
    const refs: Array<{ sheet: string; addr: string }> = [];
    ANALISA_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    try {
      while ((m = ANALISA_REF_RE.exec(formula)) !== null) {
        const sheet = m[1] ?? m[2];
        if (sheet === target) refs.push({ sheet, addr: `${m[3]}${m[4]}` });
      }
    } finally {
      ANALISA_REF_RE.lastIndex = 0;
    }
    return refs;
  }

  function collectSameSheetRefs(formula: string): string[] {
    const out: string[] = [];
    SAME_SHEET_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    try {
      while ((m = SAME_SHEET_REF_RE.exec(formula)) !== null) {
        out.push(`${m[1]}${m[2]}`);
      }
    } finally {
      SAME_SHEET_REF_RE.lastIndex = 0;
    }
    return out;
  }

  for (const b of boqRows) {
    const rowCells: HarvestedCell[] = [];
    for (const c of cells) {
      if (c.sheet === b.source_sheet && c.row === b.sourceRow && c.formula) rowCells.push(c);
    }
    const seen = new Set<string>();
    const queue: string[] = [];
    // Seed: every direct formula on the BoQ row
    for (const c of rowCells) {
      const direct = collectAnalisaRefs(c.formula!, analisaSheet);
      for (const r of direct) {
        boqCodeByAnalisaAddress.set(`${r.sheet}!${r.addr}`, b.code);
      }
      // Follow same-sheet references for a single hop so chains like
      // I=AF, AF=R+... resolve to the Analisa address R points at.
      for (const addr of collectSameSheetRefs(c.formula!)) {
        if (!seen.has(addr)) { seen.add(addr); queue.push(addr); }
      }
    }
    let hops = 0;
    while (queue.length > 0 && hops < 100) {
      hops++;
      const addr = queue.shift()!;
      const hopCell = lookup.get(`${b.source_sheet}!${addr}`);
      if (!hopCell?.formula) continue;
      const direct = collectAnalisaRefs(hopCell.formula, analisaSheet);
      for (const r of direct) {
        boqCodeByAnalisaAddress.set(`${r.sheet}!${r.addr}`, b.code);
      }
      // Second level of hop — catches intermediate aggregator columns like
      // N=SUM(I:M) → I=AF → AF=R+V*W. Bounded by `hops < 100`.
      for (const a of collectSameSheetRefs(hopCell.formula)) {
        if (!seen.has(a)) { seen.add(a); queue.push(a); }
      }
    }
  }

  // Resolve the linked BoQ code for a block. Primary: exact match on the
  // block's grand-total or jumlah cells. Fallback: any Analisa reference
  // whose row falls inside [titleRow, jumlahRow] — this catches BoQ rows
  // that reference the block's F/G/H columns directly (e.g. R59=Analisa!F82
  // where row 82 is inside the POER block).
  function resolveLinkedBoqCode(block: AhsBlock): string | null {
    const primary =
      (block.grandTotalAddress
        ? boqCodeByAnalisaAddress.get(`${analisaSheet}!${block.grandTotalAddress}`)
        : undefined) ??
      boqCodeByAnalisaAddress.get(`${analisaSheet}!F${block.jumlahRow}`) ??
      boqCodeByAnalisaAddress.get(`${analisaSheet}!I${block.jumlahRow}`);
    if (primary) return primary;
    for (const [key, code] of boqCodeByAnalisaAddress) {
      if (!key.startsWith(`${analisaSheet}!`)) continue;
      const addr = key.slice(analisaSheet.length + 1);
      const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(addr);
      if (!m) continue;
      const refRow = parseInt(m[2], 10);
      if (refRow >= block.titleRow && refRow <= block.jumlahRow) return code;
    }
    return null;
  }

  for (const block of ahsBlocks) {
    const linkedBoqCode = resolveLinkedBoqCode(block);
    const blockRowNumber = ++rowNumber;
    stagingRows.push({
      row_type: 'ahs_block',
      row_number: blockRowNumber,
      raw_data: {
        titleRow: block.titleRow,
        jumlahRow: block.jumlahRow,
        grandTotalAddress: block.grandTotalAddress,
      },
      parsed_data: {
        title: block.title,
        jumlah_cached_value: block.jumlahCachedValue,
        linked_boq_code: linkedBoqCode,
        // True when no BoQ row in the workbook references any cell within
        // the block's row range. These are leftover templates from the
        // master Analisa sheet that aren't used by this project. The UI
        // can surface them so estimators can decide to keep or prune.
        is_orphan: (() => {
          if (linkedBoqCode != null) return false;
          for (const key of boqCodeByAnalisaAddress.keys()) {
            if (!key.startsWith(`${analisaSheet}!`)) continue;
            const addr = key.slice(analisaSheet.length + 1);
            const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(addr);
            if (!m) continue;
            const r = parseInt(m[2], 10);
            if (r >= block.titleRow && r <= block.jumlahRow) return false;
          }
          return true;
        })(),
      },
      needs_review: linkedBoqCode == null,
      confidence: linkedBoqCode == null ? 0.5 : 1,
      review_status: 'PENDING',
      cost_basis: null,
      parent_ahs_staging_id: null,
      ref_cells: null,
      cost_split: null,
    });

    for (let idx = 0; idx < block.components.length; idx++) {
      const eCell = block.components[idx];
      const compRow = block.componentRows[idx];
      const fCell = lookup.get(`${eCell.sheet}!F${compRow}`) ?? null;
      const gCell = lookup.get(`${eCell.sheet}!G${compRow}`) ?? null;
      const hCell = lookup.get(`${eCell.sheet}!H${compRow}`) ?? null;
      const classification = classifyComponent(eCell, fCell, gCell, hCell, lookup);

      // Analisa layout: B=coefficient, C=unit, D=material name, E=unit price
      const bCell = lookup.get(`${eCell.sheet}!B${compRow}`);
      const cCell = lookup.get(`${eCell.sheet}!C${compRow}`);
      const dCell = lookup.get(`${eCell.sheet}!D${compRow}`);
      const coefficient = bCell ? toNumber(bCell.value) : 0;
      const unit = cCell && typeof cCell.value === 'string' ? cCell.value.trim() : '';
      const materialName =
        dCell && typeof dCell.value === 'string' ? dCell.value.trim() : '';
      const unitPrice =
        typeof eCell.value === 'number' ? eCell.value : toNumber(eCell.value);

      stagingRows.push({
        row_type: 'ahs',
        row_number: ++rowNumber,
        raw_data: { sourceRow: compRow, blockTitle: block.title },
        parsed_data: {
          material_name: materialName,
          unit: unit,
          coefficient: coefficient,
          unit_price: unitPrice,
        },
        needs_review: classification.cost_basis === 'literal',
        confidence: classification.cost_basis === 'literal' ? 0.5 : 1,
        review_status: 'PENDING',
        cost_basis: classification.cost_basis,
        parent_ahs_staging_id: null,
        ref_cells: classification.ref_cells,
        cost_split: classification.cost_split,
      });
    }
  }

  for (const b of boqRows) {
    stagingRows.push({
      row_type: 'boq',
      row_number: ++rowNumber,
      raw_data: {
        sourceRow: b.sourceRow,
        chapter: b.chapter,
        chapterIndex: b.chapter_index,
        subChapter: b.sub_chapter,
        subChapterLetter: b.sub_chapter_letter,
        isSubItem: b.is_sub_item,
      },
      parsed_data: {
        code: b.code,
        label: b.label,
        unit: b.unit,
        planned: b.planned,
        // Expose cached totals so the audit UI can render numbers even
        // when AHS-component pivoting hasn't wired up.
        unit_price: b.cost_split
          ? b.cost_split.material + b.cost_split.labor + b.cost_split.equipment + b.cost_split.prelim + (b.subkon_cost_per_unit ?? 0)
          : null,
        subkon_cost_per_unit: b.subkon_cost_per_unit,
        total_cost: b.total_cost,
        recipe: b.recipe,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: b.cost_basis,
      parent_ahs_staging_id: null,
      ref_cells: b.ref_cells,
      cost_split: b.cost_split,
    });
  }

  // parent key format: "block:<blockRowNumber>" — the DB insert phase
  // translates these to real UUIDs after inserts complete.
  const blockByGrandTotalAddress = new Map<string, number>();
  for (const r of stagingRows) {
    if (r.row_type !== 'ahs_block') continue;
    const raw = r.raw_data as { grandTotalAddress?: string | null };
    if (raw.grandTotalAddress) {
      blockByGrandTotalAddress.set(`${analisaSheet}!${raw.grandTotalAddress}`, r.row_number);
    }
  }
  for (const r of stagingRows) {
    if (r.cost_basis !== 'nested_ahs') continue;
    const up = r.ref_cells?.unit_price;
    if (!up) continue;
    const key = `${up.sheet}!${up.cell}`;
    const blockRowNumber = blockByGrandTotalAddress.get(key);
    if (blockRowNumber != null) {
      r.parent_ahs_staging_id = `block:${blockRowNumber}`;
    }
  }

  return { cells, lookup, materialRows, ahsBlocks, boqRows, validationReport, stagingRows };
}
