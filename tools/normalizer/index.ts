import * as XLSX from 'xlsx';
import { parseBoqV2 } from '../boqParserV2';
import type { BoqRowV2 } from '../boqParserV2/extractTakeoffs';
import type { RowBreakdown } from '../boqParserV2/breakdownSheetReader.types';
import type { AhsBlock } from '../boqParserV2/detectBlocks';
import { needsExpansion } from './needsExpansion';
import { buildRowBreakdown } from './buildBreakdown';
import { writeBreakdownSheets } from './writeWorkbook';
import type { BlockSchema, RowExpansionInput, RebarDiameterWeight } from './types';

export interface NormalizeOptions {
  analyzeBlock: (blockId: string) => Promise<BlockSchema | null>;
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
 * - Bekisting: recipe component on the Analisa sheet with a null referencedBlockTitle
 *   (see bekisting branch comment below for why the title is null).
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

    // Bekisting: the recipe component's referencedBlockTitle is null because
    // `detectAhsBlocks`'s TITLE_WORK_RE pattern (pekerjaan|pasangan|pengecoran|
    // pembetonan|pembesian) does not match "Bekisting Balok" / "Bekisting Plat".
    // We identify the bekisting component by its position: the first Analisa-
    // sheet recipe component with a null block title.
    if (!title && cellSheet === analisaSheet && !out.bekisting) {
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
    schemas.set(id, await options.analyzeBlock(id));
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
    // Primary: component whose title explicitly mentions "Bekisting".
    // Fallback: the null-title Analisa component (workbook stores the per-cycle
    // cost at a raw F-row without a labelled title; its quantityPerUnit IS the
    // bekisting ratio in m²/m³).
    const bekistingComponent =
      row.recipe.components.find((c) => c.referencedBlockTitle && /^Bekisting/i.test(c.referencedBlockTitle)) ??
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
