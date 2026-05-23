import * as XLSX from 'xlsx';
import { toNumber } from './classifyComponent';
import type { BreakdownGroup, BreakdownRow, ReaderWarning } from './breakdownSheetReader.types';

export interface BreakdownHeader {
  boqCode: string;
  description: string;
  unit: string;
  volume: number;
  unitCost: number;
  lineTotal: number;
}

function getRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
}

function findLabelledRow(rows: unknown[][], label: string): unknown[] | undefined {
  return rows.find((r) => typeof r[0] === 'string' && r[0].trim().toLowerCase() === label.toLowerCase());
}

const SHEET_NAME_TO_CODE = /^Breakdown\s+(.+)$/;

export function readBreakdownHeader(sheet: XLSX.WorkSheet, sheetName: string): BreakdownHeader {
  const m = SHEET_NAME_TO_CODE.exec(sheetName);
  const boqCode = m ? m[1].trim() : sheetName;
  const rows = getRows(sheet);

  const description = (findLabelledRow(rows, 'Description')?.[1] as string | undefined)?.trim() ?? '';
  const unit = (findLabelledRow(rows, 'Unit')?.[1] as string | undefined)?.trim() ?? '';
  const volumeRow = findLabelledRow(rows, 'Volume');
  if (!volumeRow) throw new Error(`Breakdown ${sheetName}: missing Volume row`);
  const volume = toNumber(volumeRow[1]);

  const unitCostRow = rows.find((r) => typeof r[0] === 'string' && /^Unit cost/i.test(r[0]));
  const lineTotalRow = rows.find((r) => typeof r[0] === 'string' && /^Line total/i.test(r[0]));

  if (!unitCostRow) throw new Error(`Breakdown ${sheetName}: missing Unit cost row`);
  if (!lineTotalRow) throw new Error(`Breakdown ${sheetName}: missing Line total row`);

  return {
    boqCode,
    description,
    unit,
    volume,
    unitCost: toNumber(unitCostRow[1]),
    lineTotal: toNumber(lineTotalRow[1]),
  };
}

const GROUP_FROM_LABEL: Array<[RegExp, BreakdownGroup]> = [
  [/\(Material\)/i, 'material'],
  [/\(Labor\)/i, 'labor'],
  [/\(Equipment\)/i, 'equipment'],
];

function inferGroup(componentGroupLabel: string): BreakdownGroup {
  for (const [re, g] of GROUP_FROM_LABEL) if (re.test(componentGroupLabel)) return g;
  return 'material';
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === 'No' && typeof r[2] === 'string' && /Material/i.test(r[2] as string)) return i;
  }
  return -1;
}

export interface ComponentParseResult {
  components: BreakdownRow[];
  warnings: ReaderWarning[];
}

export function readBreakdownComponents(sheet: XLSX.WorkSheet, sheetName: string): ComponentParseResult {
  const rows = getRows(sheet);
  const headerIdx = findHeaderRowIndex(rows);
  const warnings: ReaderWarning[] = [];
  if (headerIdx < 0) {
    warnings.push({ sheet: sheetName, code: 'MALFORMED_HEADER', message: 'Component header row not found' });
    return { components: [], warnings };
  }

  const components: BreakdownRow[] = [];
  let currentGroupLabel = '';
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const colA = r[0];
    const colC = r[2];
    // A row with column A non-empty AND column B non-empty AND column C empty is a group-header row.
    const isGroupHeader =
      colA !== '' && colA != null &&
      typeof r[1] === 'string' && (r[1] as string).trim() !== '' &&
      (colC == null || colC === '');
    if (isGroupHeader) {
      currentGroupLabel = (r[1] as string).trim();
      continue;
    }
    if (colC == null || (typeof colC === 'string' && colC.trim() === '')) continue;
    if (typeof colC === 'string' && /^SUBTOTAL|^RECONCILIATION/i.test(colC)) break;

    const qtyPerNative = toNumber(r[4]);
    const unitPrice = toNumber(r[7]);
    const qtyPerBoq = toNumber(r[8]);
    const costPerBoq = toNumber(r[9]);
    const totalQty = toNumber(r[10]);
    const totalCost = toNumber(r[11]);

    if (!Number.isFinite(qtyPerNative) || !Number.isFinite(unitPrice)) {
      warnings.push({ sheet: sheetName, code: 'MALFORMED_COMPONENT_ROW', message: `Row ${i + 1}: non-numeric qty/price` });
      continue;
    }

    const component: BreakdownRow = {
      group: inferGroup(currentGroupLabel),
      componentGroup: currentGroupLabel,
      materialName: String(colC).trim(),
      specNote: r[3] != null && String(r[3]).trim() !== '' ? String(r[3]).trim() : null,
      qtyPerNativeUnit: qtyPerNative,
      nativeUnit: String(r[5] ?? '').trim(),
      nativeBasis: r[6] != null && String(r[6]).trim() !== '' ? String(r[6]).trim() : null,
      unitPrice,
      qtyPerBoqUnit: qtyPerBoq,
      costPerBoqUnit: costPerBoq,
      totalQty,
      totalCost,
    };

    // Conservation: costPerBoqUnit should equal qtyPerBoqUnit × unitPrice within ±1 Rp.
    // This check is rounding-stable because it does not depend on volume (which the
    // workbook author rounds to 4 decimals on the totalQty column).
    const recomputedCostPerBoqUnit = qtyPerBoq * unitPrice;
    if (Math.abs(recomputedCostPerBoqUnit - costPerBoq) > 1) {
      warnings.push({
        sheet: sheetName,
        code: 'COST_MISMATCH',
        message: `${component.materialName}: declared cost/unit ${costPerBoq} vs recomputed ${recomputedCostPerBoqUnit.toFixed(0)}`,
      });
    }

    components.push(component);
  }

  return { components, warnings };
}
