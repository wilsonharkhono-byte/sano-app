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

  const boqCodeByAnalisaAddress = new Map<string, string>();
  for (const b of boqRows) {
    const iCell = lookup.get(`${boqSheet}!I${b.sourceRow}`);
    const jCell = lookup.get(`${boqSheet}!J${b.sourceRow}`);
    for (const c of [iCell, jCell]) {
      if (!c?.formula) continue;
      const m = /^=?\s*(?:'([^']+)'|([A-Za-z0-9_\- ]+))!\$?([A-Z]+)\$?(\d+)/.exec(c.formula);
      if (m) {
        const sheet = m[1] ?? m[2];
        const addr = `${m[3]}${m[4]}`;
        boqCodeByAnalisaAddress.set(`${sheet}!${addr}`, b.code);
      }
    }
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
        linked_boq_code:
          (block.grandTotalAddress
            ? boqCodeByAnalisaAddress.get(`${analisaSheet}!${block.grandTotalAddress}`)
            : undefined) ??
          boqCodeByAnalisaAddress.get(`${analisaSheet}!F${block.jumlahRow}`) ??
          boqCodeByAnalisaAddress.get(`${analisaSheet}!I${block.jumlahRow}`) ??
          null,
      },
      needs_review: false,
      confidence: 1,
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
      const bCell = lookup.get(`${eCell.sheet}!B${compRow}`);
      const materialName =
        bCell && typeof bCell.value === 'string' ? bCell.value : '';

      stagingRows.push({
        row_type: 'ahs',
        row_number: ++rowNumber,
        raw_data: { sourceRow: compRow, blockTitle: block.title },
        parsed_data: {
          material_name: materialName,
          unit_price:
            typeof eCell.value === 'number' ? eCell.value : toNumber(eCell.value),
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
      raw_data: { sourceRow: b.sourceRow },
      parsed_data: {
        code: b.code,
        label: b.label,
        unit: b.unit,
        planned: b.planned,
      },
      needs_review: false,
      confidence: 1,
      review_status: 'PENDING',
      cost_basis: b.cost_basis,
      parent_ahs_staging_id: null,
      ref_cells: b.ref_cells,
      cost_split: null,
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
