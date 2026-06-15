import * as XLSX from 'xlsx';
import * as crypto from 'crypto';
import type { RowBreakdown } from '../boqParserV2/breakdownSheetReader.types';

const MAX_SHEET_NAME = 31;

function sheetNameFor(code: string): string {
  const desired = `Breakdown ${code}`;
  if (desired.length <= MAX_SHEET_NAME) return desired;
  const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 6);
  // 'Breakdown ~XXXXXX' base length = 17; remaining budget for code = MAX - 17 = 14
  const baseLen = 'Breakdown '.length + 1 + hash.length;
  const room = MAX_SHEET_NAME - baseLen;
  return `Breakdown ${code.slice(0, room)}~${hash}`;
}

function emptyRow(n: number): unknown[] {
  return Array.from({ length: n }, () => '');
}

function makeBreakdownSheet(bd: RowBreakdown): XLSX.WorkSheet {
  const rows: unknown[][] = [];
  rows.push([`BREAKDOWN — ${bd.boqCode} ${bd.description} (At-Cost)`]);
  rows.push([`Source: RAB (A) + Analisa AHS blocks (auto-generated)`]);
  rows.push(emptyRow(12));
  rows.push(['Description', bd.description]);
  rows.push(['Unit', bd.unit]);
  rows.push(['Volume', bd.volume]);
  rows.push([`Unit cost (Rp/${bd.unit})`, bd.unitCost]);
  rows.push([`Line total at-cost (Rp)`, bd.lineTotal]);
  rows.push(emptyRow(12));
  rows.push(['No', 'Component group', 'Material / Item', 'Spec / Note', 'Qty per native unit', 'Native unit', 'Native basis', 'Unit price (Rp)', `Qty per ${bd.unit}`, `Cost per ${bd.unit}`, 'Total qty (× vol)', 'Total cost (Rp)']);

  let no = 0;
  let lastGroup: string | null = null;
  for (const c of bd.components) {
    if (c.componentGroup !== lastGroup) {
      no++;
      rows.push([no, c.componentGroup, '', '', '', '', '', '', '', '', '', '']);
      lastGroup = c.componentGroup;
    }
    rows.push([
      '', '',
      c.materialName,
      c.specNote ?? '',
      c.qtyPerNativeUnit, c.nativeUnit, c.nativeBasis ?? '',
      c.unitPrice, c.qtyPerBoqUnit, c.costPerBoqUnit,
      c.totalQty, c.totalCost,
    ]);
  }

  rows.push(emptyRow(12));
  rows.push(['', 'SUBTOTAL — At-cost', '', '', '', '', '', '', bd.unitCost, '', '', bd.lineTotal]);
  rows.push(emptyRow(12));
  rows.push(['RECONCILIATION']);
  rows.push(['Computed unit cost', bd.reconciliation.computedUnitCost]);
  rows.push(['RAB (A) source unit cost', bd.reconciliation.sourceUnitCost]);
  rows.push(['Variance', bd.reconciliation.unitCostVariance, bd.reconciliation.reconciles ? '✓ OK' : '⚠ MISMATCH']);
  rows.push(emptyRow(12));
  rows.push(['Computed line total', bd.reconciliation.computedLineTotal]);
  rows.push(['RAB (A) source line total', bd.reconciliation.sourceLineTotal]);
  rows.push(['Variance', bd.reconciliation.lineTotalVariance, bd.reconciliation.reconciles ? '✓ OK' : '⚠ MISMATCH']);

  return XLSX.utils.aoa_to_sheet(rows);
}

function makeRecipeIndexSheet(breakdowns: RowBreakdown[]): XLSX.WorkSheet {
  const rows: unknown[][] = [
    ['Recipe Index — auto-generated'],
    [`Normalizer version: 1.0  |  Generated: ${new Date().toISOString()}`],
    [],
    ['BoQ Code', 'Description', 'Sheet Name', 'Volume', 'Components', 'Reconciles?', 'Variance (Rp)', 'Notes'],
  ];
  for (const bd of breakdowns) {
    rows.push([
      bd.boqCode,
      bd.description,
      bd.sourceSheet,
      bd.volume,
      bd.components.length,
      bd.reconciliation.reconciles ? '✓' : '⚠',
      bd.reconciliation.lineTotalVariance,
      [bd.reconciliation.reconciles ? '' : 'Cost mismatch — review', bd.codeNote ?? '']
        .filter(Boolean)
        .join(' | '),
    ]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

export function writeBreakdownSheets(workbook: XLSX.WorkBook, breakdowns: RowBreakdown[]): void {
  // Recipe Index first so it shows as the leftmost new tab.
  const indexSheet = makeRecipeIndexSheet(breakdowns);
  XLSX.utils.book_append_sheet(workbook, indexSheet, 'Recipe Index');

  for (const bd of breakdowns) {
    const sheetName = sheetNameFor(bd.boqCode);
    bd.sourceSheet = sheetName;
    const sheet = makeBreakdownSheet(bd);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
}
