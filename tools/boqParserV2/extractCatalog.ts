import type { HarvestedCell } from './types';
import { toNumber } from './classifyComponent';

export interface CatalogRow {
  code: string;
  name: string;
  unit: string;
  reference_unit_price: number;
  sourceRow: number;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function colIndex(addr: string): number {
  const letters = addr.replace(/\d+/g, '');
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx;
}

function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface ColMap {
  name: number;
  spec: number;
  unit: number;
  price: number;
}

function detectHeaderAndColumns(
  byRow: Map<number, Map<number, HarvestedCell>>,
  sortedRows: number[],
): { headerRow: number; colMap: ColMap } | null {
  const defaults: ColMap = { name: 2, spec: -1, unit: 6, price: 7 };

  for (const row of sortedRows) {
    if (row > 11) break;
    const cols = byRow.get(row);
    if (!cols) continue;
    let found = false;
    const colMap: ColMap = { ...defaults };

    for (const [col, cell] of cols) {
      const raw = cellText(cell);
      if (!raw) continue;
      const fp = normalizeHeader(raw);
      if ((/material|bahan|uraian|nama/.test(fp) && !/sub/.test(fp)) || fp === 'nama') {
        colMap.name = col;
        found = true;
      }
      if (/produk|model|tipe|spec/.test(fp)) colMap.spec = col;
      if (/^sat$|^unit$/.test(fp) || fp === 'sat' || fp === 'satuan') colMap.unit = col;
      if (/harga|price|net/.test(fp)) colMap.price = col;
    }

    if (!found) {
      let rowFp = '';
      for (const [, cell] of cols) {
        rowFp += ' ' + normalizeHeader(cellText(cell));
      }
      if (/harganet|harga/.test(rowFp) && /sat|unit/.test(rowFp)) {
        found = true;
      }
    }

    if (found) return { headerRow: row, colMap };
  }
  return null;
}

export function extractCatalogRows(
  cells: HarvestedCell[],
  sheetNames: string[],
): CatalogRow[] {
  const out: CatalogRow[] = [];

  for (const sheet of sheetNames) {
    const byRow = new Map<number, Map<number, HarvestedCell>>();
    for (const c of cells) {
      if (c.sheet !== sheet) continue;
      const col = colIndex(c.address);
      const map = byRow.get(c.row) ?? new Map();
      map.set(col, c);
      byRow.set(c.row, map);
    }

    const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);
    const detected = detectHeaderAndColumns(byRow, sortedRows);
    if (!detected) continue;

    const { headerRow, colMap } = detected;

    for (const row of sortedRows) {
      if (row <= headerRow) continue;
      const cols = byRow.get(row);
      if (!cols) continue;

      const name = cellText(cols.get(colMap.name));
      if (!name || name.length < 2) continue;

      const unit = cellText(cols.get(colMap.unit));
      const priceCell = cols.get(colMap.price);
      const price = priceCell ? toNumber(priceCell.value) : 0;

      const codeCell = cols.get(1);
      const code = codeCell ? cellText(codeCell) : '';

      out.push({
        code: code || name,
        name,
        unit,
        reference_unit_price: price,
        sourceRow: row,
      });
    }
  }

  return out;
}
