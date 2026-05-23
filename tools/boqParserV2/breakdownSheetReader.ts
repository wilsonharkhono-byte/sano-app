import * as XLSX from 'xlsx';
import { toNumber } from './classifyComponent';

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
