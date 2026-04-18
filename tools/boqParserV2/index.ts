import { harvestWorkbook } from './harvest';
import { detectAhsBlocks } from './detectBlocks';
import { classifyComponent, toNumber } from './classifyComponent';
import { extractCatalogRows, type CatalogRow } from './extractCatalog';
import { extractBoqRows, type BoqRowV2 } from './extractTakeoffs';
import { validateBlocks } from './validate';
import type {
  HarvestedCell,
  HarvestLookup,
  ValidationReport,
  StagingRowV2,
} from './types';
import type { AhsBlock } from './detectBlocks';

export interface ParseBoqV2Options {
  analisaSheet?: string;
  boqSheet?: string;
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
  const boqSheet = options.boqSheet ?? 'RAB (A)';
  const catalogSheets = options.catalogSheets ?? ['Material', 'Upah'];

  const { cells, lookup } = await harvestWorkbook(fileBuffer);
  const materialRows = extractCatalogRows(cells, catalogSheets);
  const ahsBlocks = detectAhsBlocks(cells, analisaSheet);
  const boqRows = extractBoqRows(cells, lookup, boqSheet);
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
    while ((m = ANALISA_REF_RE.exec(formula)) !== null) {
      const sheet = m[1] ?? m[2];
      if (sheet === target) refs.push({ sheet, addr: `${m[3]}${m[4]}` });
    }
    return refs;
  }

  function collectSameSheetRefs(formula: string): string[] {
    const out: string[] = [];
    SAME_SHEET_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SAME_SHEET_REF_RE.exec(formula)) !== null) {
      out.push(`${m[1]}${m[2]}`);
    }
    return out;
  }

  for (const b of boqRows) {
    const rowCells: HarvestedCell[] = [];
    for (const c of cells) {
      if (c.sheet === boqSheet && c.row === b.sourceRow && c.formula) rowCells.push(c);
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
      const hopCell = lookup.get(`${boqSheet}!${addr}`);
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
        linked_boq_code: resolveLinkedBoqCode(block),
        // True when no BoQ row in the workbook references any cell within
        // the block's row range. These are leftover templates from the
        // master Analisa sheet that aren't used by this project. The UI
        // can surface them so estimators can decide to keep or prune.
        is_orphan: (() => {
          if (resolveLinkedBoqCode(block) != null) return false;
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
      needs_review: resolveLinkedBoqCode(block) == null,
      confidence: resolveLinkedBoqCode(block) == null ? 0.5 : 1,
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
          ? b.cost_split.material + b.cost_split.labor + b.cost_split.equipment + (b.subkon_cost_per_unit ?? 0)
          : null,
        subkon_cost_per_unit: b.subkon_cost_per_unit,
        total_cost: b.total_cost,
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
