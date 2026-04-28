import type { HarvestedCell } from './types';
import { ELEMENT_RE, MATERIAL_RE } from './vocab';
import { toNumber } from './classifyComponent';

export interface InlineRecipeChildRow {
  sourceRow: number;
  materialName: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  total: number;
}

export interface InlineRecipeGroup {
  parentRow: number;
  parentLabel: string;
  parentTotalCost: number;
  childRows: InlineRecipeChildRow[];
  consumedRows: Set<number>;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  return toNumber(c.value);
}

function stripDashPrefix(label: string): string {
  return label.replace(/^[\s\-–—]+/, '').trim();
}

function isCandidateParent(map: Map<string, HarvestedCell>): boolean {
  const label = cellText(map.get('B'));
  if (!label) return false;
  if (!ELEMENT_RE.test(label)) return false;
  if (label.trim().endsWith(':')) return false;
  // Must be label-only: C/D/E/F empty
  if (cellText(map.get('C'))) return false;
  if (cellText(map.get('D'))) return false;
  if (cellText(map.get('E'))) return false;
  if (cellText(map.get('F'))) return false;
  return true;
}

function isMaterialChild(map: Map<string, HarvestedCell>): boolean {
  const label = cellText(map.get('B'));
  if (!label) return false;
  if (!MATERIAL_RE.test(label)) return false;
  // Must have at least a unit OR a quantity to count as a real component.
  const hasUnit = !!cellText(map.get('C'));
  const hasQty = cellNumber(map.get('D')) > 0;
  return hasUnit || hasQty;
}

function isChapterOrSubChapter(map: Map<string, HarvestedCell>): boolean {
  const a = cellText(map.get('A'));
  if (!a) return false;
  if (/^(I{1,3}|IV|VI{0,3}|IX|X{0,3}I{0,3})\.?$/.test(a)) return true;
  if (/^[A-Z]\.?$/.test(a)) return true;
  return false;
}

function isEmpty(map: Map<string, HarvestedCell>): boolean {
  return !cellText(map.get('A')) && !cellText(map.get('B')) && !cellText(map.get('C'));
}

export function detectInlineRecipes(
  cells: HarvestedCell[],
  boqSheetName: string,
): InlineRecipeGroup[] {
  const byRow = new Map<number, Map<string, HarvestedCell>>();
  for (const c of cells) {
    if (c.sheet !== boqSheetName) continue;
    const colLetter = c.address.replace(/\d+/g, '');
    const map = byRow.get(c.row) ?? new Map<string, HarvestedCell>();
    map.set(colLetter, c);
    byRow.set(c.row, map);
  }
  const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);

  const groups: InlineRecipeGroup[] = [];
  let i = 0;
  while (i < sortedRows.length) {
    const row = sortedRows[i];
    const map = byRow.get(row)!;
    if (!isCandidateParent(map)) { i++; continue; }

    // Walk forward collecting material children until boundary.
    const children: InlineRecipeChildRow[] = [];
    let totalCost = 0;
    let j = i + 1;
    while (j < sortedRows.length) {
      const childRow = sortedRows[j];
      const childMap = byRow.get(childRow)!;
      if (isEmpty(childMap)) break;
      if (isChapterOrSubChapter(childMap)) break;
      if (isCandidateParent(childMap)) break;
      if (!isMaterialChild(childMap)) break;
      const total = cellNumber(childMap.get('F'));
      children.push({
        sourceRow: childRow,
        materialName: stripDashPrefix(cellText(childMap.get('B'))),
        unit: cellText(childMap.get('C')),
        coefficient: cellNumber(childMap.get('D')),
        unitPrice: cellNumber(childMap.get('E')),
        total,
      });
      totalCost += total;
      j++;
    }

    if (children.length >= 2) {
      const consumed = new Set<number>();
      consumed.add(row);
      for (const c of children) consumed.add(c.sourceRow);
      groups.push({
        parentRow: row,
        parentLabel: stripDashPrefix(cellText(map.get('B'))),
        parentTotalCost: totalCost,
        childRows: children,
        consumedRows: consumed,
      });
      i = j;        // skip past consumed children
    } else {
      i++;          // candidate rejected — try next row
    }
  }

  return groups;
}
