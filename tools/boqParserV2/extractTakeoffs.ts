import type { HarvestedCell, HarvestLookup, CostBasis, RefCells } from './types';
import { parseFormulaRef, toNumber } from './classifyComponent';

export interface BoqRowV2 {
  code: string;
  label: string;
  unit: string;
  planned: number;
  sourceRow: number;
  cost_basis: CostBasis | null;
  ref_cells: RefCells | null;
}

function cellText(c: HarvestedCell | undefined): string {
  if (!c || c.value == null) return '';
  return String(c.value).trim();
}

function cellNumber(c: HarvestedCell | undefined): number {
  if (!c || c.value == null) return 0;
  return toNumber(c.value);
}

const SUM_ARG_RE = /'([^']+)'!(\$?[A-Z]+\$?\d+)/g;

function extractSumIfsRefs(formula: string | null): RefCells['quantity'] {
  if (!formula) return undefined;
  const out: NonNullable<RefCells['quantity']> = [];
  let m: RegExpExecArray | null;
  while ((m = SUM_ARG_RE.exec(formula)) !== null) {
    const sheet = m[1];
    const cell = m[2].replace(/\$/g, '');
    out.push({ sheet, cell, cached_value: null });
  }
  return out.length > 0 ? out : undefined;
}

export function extractBoqRows(
  cells: HarvestedCell[],
  lookup: HarvestLookup,
  boqSheetName: string,
): BoqRowV2[] {
  const byRow = new Map<number, Map<string, HarvestedCell>>();
  for (const c of cells) {
    if (c.sheet !== boqSheetName) continue;
    const colLetter = c.address.replace(/\d+/g, '');
    const map = byRow.get(c.row) ?? new Map();
    map.set(colLetter, c);
    byRow.set(c.row, map);
  }

  const out: BoqRowV2[] = [];
  for (const [row, map] of byRow) {
    const code = cellText(map.get('B'));
    const label = cellText(map.get('C'));
    if (!code || !label) continue;
    const planned = cellNumber(map.get('D'));
    const unit = cellText(map.get('G'));

    const dCell = map.get('D');
    const ref = parseFormulaRef(dCell?.formula ?? null, boqSheetName);
    let cost_basis: CostBasis | null = null;
    let ref_cells: RefCells | null = null;
    if (ref.kind === 'aggregation') {
      cost_basis = 'takeoff_ref';
      const refs = extractSumIfsRefs(dCell?.formula ?? null);
      if (refs) ref_cells = { quantity: refs };
    }

    out.push({ code, label, unit, planned, sourceRow: row, cost_basis, ref_cells });
  }
  return out.sort((a, b) => a.sourceRow - b.sourceRow);
}
