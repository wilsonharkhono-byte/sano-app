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
