import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { parseBoqV2 } from '../boqParserV2';
import type { BoqRowV2 } from '../boqParserV2/extractTakeoffs';
import type { RowBreakdown } from '../boqParserV2/breakdownSheetReader.types';
import type { AhsBlock } from '../boqParserV2/detectBlocks';
import type { HarvestedCell } from '../boqParserV2/types';
import { needsExpansion } from './needsExpansion';
import { buildRowBreakdown } from './buildBreakdown';
import { writeBreakdownSheets } from './writeWorkbook';
import type { BlockSchema, RowExpansionInput, RebarDiameterWeight } from './types';
import { analyzeBlockWithOpus, extractBlockCellContext } from './blockAnalyzer';

export interface NormalizeOptions {
  // ahsBlocks is optional — when supplied, the analyzer can scope the cell-
  // context window to the containing block (avoids cross-block leakage on
  // sheets that pack multiple adjacent AHS blocks together).
  analyzeBlock: (blockId: string, ahsBlocks?: AhsBlock[]) => Promise<BlockSchema | null>;
  boqSheet?: string;
  analisaSheet?: string;
}

export interface NormalizeResult {
  workbookBuffer: Buffer;
  breakdowns: RowBreakdown[];
  summary: {
    rows_total: number;
    rows_normalized: number;
    rows_skipped: number;
    rows_with_mismatch: number;
    blocks_analyzed: number;
  };
  warnings: Array<{ code: string; message: string }>;
}

/**
 * Resolve block IDs for a BoQ row using recipe component metadata and ahsBlocks lookup.
 *
 * Three resolution strategies:
 * - Concrete: recipe component whose referencedBlockTitle matches /^Pengecoran Beton/i,
 *   pointing directly at an Analisa F-column cell.
 * - Bekisting: recipe component whose referencedBlockTitle starts with "Bekisting"
 *   (e.g. "Bekisting Balok", "Bekisting Plat", "1 m2 Bekisting Batako ...").
 *   `detectAhsBlocks`'s TITLE_WORK_RE now matches `bekisting` so verb-style headers
 *   are captured. A defensive null-title fallback remains for legacy workbooks
 *   where the AHS header doesn't match either regex.
 * - Pembesian: recipe component whose referencedBlockTitle matches /^Pembesian/i;
 *   prefers a direct Analisa cell reference, falls back to ahsBlocks title lookup.
 */
function findBlockIdsFor(
  row: BoqRowV2,
  ahsBlocks: AhsBlock[],
  analisaSheet: string,
): { bekisting?: string; pembesian?: string; concrete?: string } {
  const out: { bekisting?: string; pembesian?: string; concrete?: string } = {};
  if (!row.recipe) return out;

  for (const c of row.recipe.components) {
    const cellSheet = c.referencedCell.sheet;
    const cellAddr = c.referencedCell.address;
    const title = c.referencedBlockTitle;

    // Concrete: direct Analisa reference with a "Pengecoran Beton" title.
    if (title && /^Pengecoran Beton/i.test(title) && cellSheet === analisaSheet && !out.concrete) {
      out.concrete = `${cellSheet}!${cellAddr}`;
    }

    // Bekisting (primary): identify by title prefix now that detectAhsBlocks
    // recognises "Bekisting Balok" / "Bekisting Plat" / "1 m2 Bekisting ..." as
    // block headers. The TITLE_UNIT_RE pattern captures unit-prefixed titles
    // (e.g. "1 m2 Bekisting Batako ...") and TITLE_WORK_RE now captures verb-
    // style headers (e.g. "Bekisting Balok").
    if (title && /^(?:\d+\s+m[123²³]\s+)?Bekisting/i.test(title) && cellSheet === analisaSheet && !out.bekisting) {
      out.bekisting = `${cellSheet}!${cellAddr}`;
    }

    // Pembesian: title matches /^Pembesian/i.
    if (title && /^Pembesian/i.test(title) && !out.pembesian) {
      if (cellSheet === analisaSheet) {
        // Direct Analisa reference — use as-is.
        out.pembesian = `${cellSheet}!${cellAddr}`;
      } else {
        // Fallback: when a workbook uses a REKAP cell as the unit-cost reference
        // instead of an Analisa cell. NOT exercised by AAL-5; kept for forward-
        // compatibility with workbooks that have different formula patterns.
        // TODO: add a test fixture if a workbook of this shape is observed.
        const match = ahsBlocks.find((b) => b.title === title);
        if (match && match.componentRows.length > 0) {
          out.pembesian = `${analisaSheet}!F${match.componentRows[0]}`;
        }
      }
    }
  }

  // Fallback: defensive lookup for legacy workbooks where the bekisting AHS
  // header doesn't match either title regex and the component lands with a
  // null `referencedBlockTitle`. If no titled "Bekisting" block was found via
  // the primary path above, pick the first null-title Analisa recipe component.
  // This is intentionally secondary — the primary title match is preferred so
  // unrelated null-title references (e.g. Plat/Sloof/Kolom raw F-row picks)
  // can't be misclassified as bekisting.
  if (!out.bekisting) {
    for (const c of row.recipe.components) {
      if (!c.referencedBlockTitle && c.referencedCell.sheet === analisaSheet) {
        out.bekisting = `${c.referencedCell.sheet}!${c.referencedCell.address}`;
        break;
      }
    }
  }

  // Re-anchor: bekisting cost cells often point to the "Harga per m²" summary
  // row, which sits AFTER the block's Jumlah line. The default cell-context
  // extractor's ROWS_BEFORE=3 window starting from F55 would miss the bekisting
  // sub-items at rows 47–51 (Multipleks, Usuk, Paku, Form oil), and Opus would
  // return an empty / partial schema. Look up the AhsBlock whose Bekisting
  // title is just above this cell and re-anchor to the block's first component
  // row so the context window captures all sub-items.
  if (out.bekisting) {
    const bangIdx = out.bekisting.indexOf('!');
    const sheet = out.bekisting.slice(0, bangIdx);
    const addr = out.bekisting.slice(bangIdx + 1);
    const rowMatch = /^[A-Z]+(\d+)$/.exec(addr);
    if (rowMatch) {
      const cellRow = parseInt(rowMatch[1], 10);
      const containingBlock = ahsBlocks.find((b) =>
        /^(?:\d+\s+m[123²³]\s+)?Bekisting/i.test(b.title) &&
        b.titleRow <= cellRow &&
        cellRow <= b.jumlahRow + 3, // allow Harga-per-... row a few lines after Jumlah
      );
      if (containingBlock && containingBlock.componentRows.length > 0) {
        out.bekisting = `${sheet}!F${containingBlock.componentRows[0]}`;
      }
    }
  }

  return out;
}

function extractDiameters(row: BoqRowV2): RebarDiameterWeight[] {
  if (!row.recipe) return [];
  return row.recipe.components
    .filter((c) => c.materialName && /^Besi /i.test(c.materialName))
    .map((c) => ({ diameter: c.materialName!.replace(/^Besi\s+/i, ''), qtyPerBoqUnit: c.quantityPerUnit }));
}

export async function normalizeWorkbook(
  fileBuffer: Buffer | ArrayBuffer,
  options: NormalizeOptions,
): Promise<NormalizeResult> {
  const analisaSheet = options.analisaSheet ?? 'Analisa';
  const dry = await parseBoqV2(fileBuffer, {
    boqSheet: options.boqSheet ?? 'RAB (A)',
    analisaSheet,
  });

  const candidates = dry.boqRows.filter(needsExpansion);
  const uniqueBlockIds = new Set<string>();
  for (const row of candidates) {
    const ids = findBlockIdsFor(row, dry.ahsBlocks, analisaSheet);
    if (ids.bekisting) uniqueBlockIds.add(ids.bekisting);
    if (ids.pembesian) uniqueBlockIds.add(ids.pembesian);
    if (ids.concrete) uniqueBlockIds.add(ids.concrete);
  }

  const schemas = new Map<string, BlockSchema | null>();
  for (const id of uniqueBlockIds) {
    schemas.set(id, await options.analyzeBlock(id, dry.ahsBlocks));
  }

  const breakdowns: RowBreakdown[] = [];
  const warnings: Array<{ code: string; message: string }> = [];
  let skipped = 0;
  let mismatched = 0;

  for (const row of candidates) {
    if (!row.recipe) { skipped++; continue; }
    const ids = findBlockIdsFor(row, dry.ahsBlocks, analisaSheet);
    const bek = ids.bekisting ? schemas.get(ids.bekisting) ?? null : null;
    const pem = ids.pembesian ? schemas.get(ids.pembesian) ?? null : null;
    const con = ids.concrete ? schemas.get(ids.concrete) ?? null : null;

    if (!bek && !pem && !con) {
      skipped++;
      warnings.push({
        code: 'NO_SCHEMA_RESOLVED',
        message: `${row.code}: needsExpansion but no block schemas resolved — skipped`,
      });
      continue;
    }

    // Pull the bekisting ratio-per-m³ from the recipe.
    // Primary: component whose title explicitly mentions "Bekisting" (matches
    // both "Bekisting Balok"-style verb headers and "1 m2 Bekisting ..."-style
    // unit-prefixed headers — both are now detected by detectAhsBlocks).
    // Fallback: the null-title Analisa component (legacy workbooks where the
    // AHS header doesn't match either title regex; the workbook stores the
    // per-cycle cost at a raw F-row without a labelled title and its
    // quantityPerUnit IS the bekisting ratio in m²/m³).
    const bekistingComponent =
      row.recipe.components.find((c) => c.referencedBlockTitle && /^(?:\d+\s+m[123²³]\s+)?Bekisting/i.test(c.referencedBlockTitle)) ??
      row.recipe.components.find((c) => !c.referencedBlockTitle && c.referencedCell.sheet === analisaSheet);
    const ratioPerM3 = bekistingComponent?.quantityPerUnit ?? null;

    const diameters = extractDiameters(row);

    const input: RowExpansionInput = {
      boqCode: row.code,
      description: row.label,
      unit: row.unit,
      volume: row.planned,
      sourceUnitCost: (row.cost_split ? row.cost_split.material + row.cost_split.labor + row.cost_split.equipment + row.cost_split.prelim : 0) + (row.subkon_cost_per_unit ?? 0),
      sourceLineTotal: row.total_cost ?? 0,
      bekistingSchema: bek,
      bekistingRatioPerM3: ratioPerM3,
      pembesianSchema: pem,
      pembesianKgPerM3: diameters.reduce((s, d) => s + d.qtyPerBoqUnit, 0),
      pembesianDiameters: diameters,
      concreteSchema: con,
    };

    const bd = buildRowBreakdown(input);
    if (!bd.reconciliation.reconciles) {
      mismatched++;
      warnings.push({
        code: 'RECONCILIATION_MISMATCH',
        message: `${row.code}: reconciles=false, lineTotalVariance=${bd.reconciliation.lineTotalVariance}`,
      });
    }
    breakdowns.push(bd);
  }

  const wb = XLSX.read(fileBuffer instanceof ArrayBuffer ? Buffer.from(fileBuffer) : fileBuffer, { cellFormula: true, cellStyles: false });
  writeBreakdownSheets(wb, breakdowns);
  const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return {
    workbookBuffer: outBuffer,
    breakdowns,
    summary: {
      rows_total: dry.boqRows.length,
      rows_normalized: breakdowns.length,
      rows_skipped: skipped,
      rows_with_mismatch: mismatched,
      blocks_analyzed: schemas.size,
    },
    warnings,
  };
}

export interface MakeAnalyzeBlockOptions {
  apiKey: string;
  cells: HarvestedCell[];
}

/**
 * Internal factory exposed for tests: builds an analyzeBlock function from a
 * caller-supplied "analyzer" (typically `analyzeBlockWithOpus` bound to a client),
 * adding a per-blockId cache. The production entry point is `makeAnalyzeBlock` below.
 */
export function makeAnalyzeBlockFromAnalyzer(
  analyzer: (blockId: string, ctx: ReturnType<typeof extractBlockCellContext>) => Promise<BlockSchema>,
  cells: HarvestedCell[],
): NormalizeOptions['analyzeBlock'] {
  const cache = new Map<string, BlockSchema>();
  return async (blockId: string, ahsBlocks?: AhsBlock[]) => {
    const hit = cache.get(blockId);
    if (hit) return hit;
    const ctx = extractBlockCellContext(blockId, cells, ahsBlocks);
    const schema = await analyzer(blockId, ctx);
    cache.set(blockId, schema);
    return schema;
  };
}

/**
 * Production factory: builds an analyzeBlock function backed by the real
 * Anthropic SDK (claude-opus-4-7). The API key is required.
 */
export function makeAnalyzeBlock(opts: MakeAnalyzeBlockOptions): NormalizeOptions['analyzeBlock'] {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return makeAnalyzeBlockFromAnalyzer(
    (blockId, ctx) => analyzeBlockWithOpus(blockId, ctx, client),
    opts.cells,
  );
}
