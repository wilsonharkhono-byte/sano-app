import type { HarvestedCell, HarvestLookup, CostBasis, RefCells, CostSplit } from './types';

export type FormulaRef =
  | { kind: 'literal' }
  | { kind: 'cross_sheet_abs'; sheet: string; address: string }
  | { kind: 'intra_sheet_abs'; sheet: string; address: string }
  | { kind: 'aggregation' }
  | { kind: 'cross_multiply' }
  | { kind: 'simple_multiply' }
  | { kind: 'unknown' };

const CROSS_SHEET_ABS = /^=\s*(?:'([^']+)'|([A-Za-z0-9_\- ]+))!\$?([A-Z]+)\$?(\d+)\s*$/;
const INTRA_SHEET_ABS = /^=\s*\$([A-Z]+)\$(\d+)\s*$/;
const AGGREGATION = /^=\s*(SUMIFS|SUM|VLOOKUP)\s*\(/i;
const SIMPLE_MULTIPLY = /^=\s*[A-Z]+\d+\s*\*\s*[A-Z]+\d+\s*$/;
const CROSS_MULTIPLY = /^=\s*\$[A-Z]+\$\d+\s*\*\s*[A-Z]+\d+\s*$/;

export function parseFormulaRef(formula: string | null, currentSheet: string): FormulaRef {
  if (!formula) return { kind: 'literal' };
  const f = formula.trim();

  const cross = CROSS_SHEET_ABS.exec(f);
  if (cross) {
    const sheet = cross[1] ?? cross[2];
    const address = `${cross[3]}${cross[4]}`;
    return { kind: 'cross_sheet_abs', sheet, address };
  }

  const intra = INTRA_SHEET_ABS.exec(f);
  if (intra) {
    const address = `${intra[1]}${intra[2]}`;
    return { kind: 'intra_sheet_abs', sheet: currentSheet, address };
  }

  if (AGGREGATION.test(f)) return { kind: 'aggregation' };
  if (CROSS_MULTIPLY.test(f)) return { kind: 'cross_multiply' };
  if (SIMPLE_MULTIPLY.test(f)) return { kind: 'simple_multiply' };

  return { kind: 'unknown' };
}

const AGGREGATOR_SHEET_PATTERN =
  /^(REKAP|Data[-\s]|Hasil[-\s]|Besi |Detail |Plat|Tangga|COVER|Proses|TABEL)/i;

export function isCatalogSheet(sheetName: string): boolean {
  return !AGGREGATOR_SHEET_PATTERN.test(sheetName);
}

export interface ComponentClassification {
  cost_basis: CostBasis;
  ref_cells: RefCells | null;
  cost_split: CostSplit | null;
}

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function classifyComponent(
  eCell: HarvestedCell,
  fCell: HarvestedCell | null,
  gCell: HarvestedCell | null,
  hCell: HarvestedCell | null,
  lookup: HarvestLookup,
): ComponentClassification {
  const eRef = parseFormulaRef(eCell.formula, eCell.sheet);
  const fRef = parseFormulaRef(fCell?.formula ?? null, fCell?.sheet ?? eCell.sheet);

  // Rebar split: F column uses a cross-cell multiply to another block's material cell
  if (fRef.kind === 'cross_multiply') {
    return {
      cost_basis: 'cross_ref',
      ref_cells: {
        unit_price: {
          sheet: eCell.sheet,
          cell: eCell.address,
          cached_value: toNumber(eCell.value),
        },
      },
      cost_split: {
        material: toNumber(fCell?.value),
        labor: toNumber(gCell?.value),
        equipment: toNumber(hCell?.value),
        prelim: 0,
      },
    };
  }

  // E column intra-sheet absolute → nested_ahs
  if (eRef.kind === 'intra_sheet_abs') {
    const target = lookup.get(`${eRef.sheet}!${eRef.address}`);
    return {
      cost_basis: 'nested_ahs',
      ref_cells: {
        unit_price: {
          sheet: eRef.sheet,
          cell: eRef.address,
          cached_value: target ? toNumber(target.value) : null,
        },
      },
      cost_split: null,
    };
  }

  // E column cross-sheet absolute → catalog or takeoff_ref
  if (eRef.kind === 'cross_sheet_abs') {
    const basis: CostBasis = isCatalogSheet(eRef.sheet) ? 'catalog' : 'takeoff_ref';
    const target = lookup.get(`${eRef.sheet}!${eRef.address}`);
    return {
      cost_basis: basis,
      ref_cells: {
        unit_price: {
          sheet: eRef.sheet,
          cell: eRef.address,
          cached_value: target ? toNumber(target.value) : null,
        },
      },
      cost_split: null,
    };
  }

  // E column aggregation → takeoff_ref
  if (eRef.kind === 'aggregation') {
    return {
      cost_basis: 'takeoff_ref',
      ref_cells: {
        unit_price: {
          sheet: eCell.sheet,
          cell: eCell.address,
          cached_value: toNumber(eCell.value),
        },
      },
      cost_split: null,
    };
  }

  // Literal — E column is a typed number, no formula
  return {
    cost_basis: 'literal',
    ref_cells: {
      unit_price: {
        sheet: eCell.sheet,
        cell: eCell.address,
        cached_value: toNumber(eCell.value),
      },
    },
    cost_split: null,
  };
}
