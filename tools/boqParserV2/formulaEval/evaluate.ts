import type { HarvestedCell, HarvestLookup } from '../types';
import { tokenize } from './tokenize';
import { parse, type AstNode } from './parse';

export interface EvalComponent {
  sourceCell: { sheet: string; address: string };
  referencedCell: { sheet: string; address: string };
  coefficient: number;
  unitPrice: number;
  costContribution: number;
  confidence: number;
}

export interface EvalMarkup {
  factor: number;
  sourceCell: { sheet: string; address: string };
}

export interface EvalResult {
  evaluatedValue: number;
  components: EvalComponent[];
  markup: EvalMarkup | null;
  confidence: number;
  unknownFunctions?: string[];   // list of fn names encountered that the evaluator couldn't decompose
}

export interface EvalOptions {
  targetSheet: string;
  maxDepth?: number;
}

interface Ctx {
  lookup: HarvestLookup;
  targetSheet: string;
  sourceCell: { sheet: string; address: string };
  depth: number;
  maxDepth: number;
}

function parseRef(raw: string): { sheet: string | null; address: string } {
  const m = raw.match(/^(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_\- .]*))!(\$?[A-Z]+\$?\d+)(?::\$?[A-Z]+\$?\d+)?$/);
  if (m) {
    const sheet = m[1] ?? m[2];
    const addr = m[3].replace(/\$/g, '');
    return { sheet, address: addr };
  }
  const m2 = raw.match(/^(\$?[A-Z]+\$?\d+)(?::\$?[A-Z]+\$?\d+)?$/);
  if (m2) return { sheet: null, address: m2[1].replace(/\$/g, '') };
  return { sheet: null, address: raw };
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// --- Range / cell-address helpers (used by SUM / SUMIF / SUMIFS) --------------

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n; // 1-based
}

function indexToColLetters(index: number): string {
  let n = index;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface ParsedRange {
  sheet: string | null;
  cells: string[]; // ordered list of A1-style addresses (no sheet prefix, no $)
}

// Parses a raw ref string that may be a single cell ("A1") or a range
// ("A1:B10"), optionally sheet-qualified ("'Sheet'!A1:A9"). Returns the sheet
// (null when unqualified) and the enumerated cell addresses. For very large
// ranges we cap enumeration to keep evaluation bounded; real RAB criteria
// ranges are a few hundred rows.
const MAX_RANGE_CELLS = 100_000;

function parseRange(raw: string): ParsedRange {
  // Strip optional sheet prefix.
  let sheet: string | null = null;
  let body = raw;
  const sheetM = raw.match(/^(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_\- .]*))!(.+)$/);
  if (sheetM) {
    sheet = sheetM[1] ?? sheetM[2];
    body = sheetM[3];
  }
  body = body.replace(/\$/g, '');

  const rangeM = body.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!rangeM) {
    // Single cell.
    return { sheet, cells: [body] };
  }
  const c1 = colLettersToIndex(rangeM[1]);
  const r1 = parseInt(rangeM[2], 10);
  const c2 = colLettersToIndex(rangeM[3]);
  const r2 = parseInt(rangeM[4], 10);
  const colLo = Math.min(c1, c2);
  const colHi = Math.max(c1, c2);
  const rowLo = Math.min(r1, r2);
  const rowHi = Math.max(r1, r2);
  const cells: string[] = [];
  outer: for (let r = rowLo; r <= rowHi; r++) {
    for (let c = colLo; c <= colHi; c++) {
      cells.push(`${indexToColLetters(c)}${r}`);
      if (cells.length >= MAX_RANGE_CELLS) break outer;
    }
  }
  return { sheet, cells };
}

// Resolves the raw cached value (number | string | null) of a single cell ref,
// using the SAME lookup the rest of the evaluator uses. Returns undefined when
// the cell is not present in the harvested set.
function resolveCellRaw(
  rawRef: string,
  ctx: Ctx,
): unknown {
  const ref = parseRef(rawRef);
  const sheet = ref.sheet ?? ctx.sourceCell.sheet;
  const cached = ctx.lookup.get(`${sheet}!${ref.address}`);
  return cached ? cached.value : undefined;
}

// --- SUMIF / SUMIFS criteria handling ----------------------------------------

type Comparator = '=' | '<>' | '>' | '>=' | '<' | '<=';

interface Criteria {
  op: Comparator;
  // The comparison target. When numeric, `num` is set; otherwise `text` holds
  // the case-folded string form.
  num: number | null;
  text: string;
}

// Parses an Excel criteria value (already resolved to a JS primitive) into a
// {operator, target} pair. Handles leading operators embedded in strings like
// ">=5", "<>0", or plain values like "Besi" / 5.
function parseCriteria(value: unknown): Criteria {
  if (typeof value === 'number') {
    return { op: '=', num: value, text: String(value) };
  }
  const s = value == null ? '' : String(value);
  const m = s.match(/^\s*(<>|>=|<=|>|<|=)?\s*(.*)$/);
  const op = (m?.[1] as Comparator | undefined) ?? '=';
  const rest = (m?.[2] ?? '').trim();
  const asNum = rest === '' ? NaN : Number(rest.replace(',', '.'));
  if (Number.isFinite(asNum) && rest !== '') {
    return { op, num: asNum, text: rest };
  }
  return { op, num: null, text: rest };
}

function criteriaMatches(crit: Criteria, cellValue: unknown): boolean {
  // Numeric comparison when both sides are numeric.
  const cellNum =
    typeof cellValue === 'number'
      ? cellValue
      : typeof cellValue === 'string' && cellValue.trim() !== '' && Number.isFinite(Number(cellValue.replace(',', '.')))
        ? Number(cellValue.replace(',', '.'))
        : null;

  if (crit.num !== null && cellNum !== null) {
    switch (crit.op) {
      case '=': return cellNum === crit.num;
      case '<>': return cellNum !== crit.num;
      case '>': return cellNum > crit.num;
      case '>=': return cellNum >= crit.num;
      case '<': return cellNum < crit.num;
      case '<=': return cellNum <= crit.num;
    }
  }

  // Text comparison (case-insensitive), used for BoQ-code style labels.
  const cellText = cellValue == null ? '' : String(cellValue);
  const a = cellText.trim().toLowerCase();
  const b = crit.text.trim().toLowerCase();
  switch (crit.op) {
    case '=': return a === b;
    case '<>': return a !== b;
    // Ordering comparators on non-numeric values fall back to string ordering,
    // matching Excel's lexicographic behaviour closely enough for our needs.
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
  }
}

// Resolves a function-argument AST node to a criteria value WITHOUT producing
// components. Criteria are literals or (most commonly in RAB) a cell ref that
// resolves to a label/number.
function evalCriteriaValue(node: AstNode, ctx: Ctx): unknown {
  if (node.kind === 'str') return node.value;
  if (node.kind === 'num') return node.value;
  if (node.kind === 'ref') return resolveCellRaw(node.value, ctx);
  // Anything more complex: fall back to numeric evaluation.
  return walk(node, ctx).value;
}

// Resolves a range argument (e.g. $B$6:$B$264) to the ordered list of raw
// cell values, resolved through the shared lookup. Missing cells become
// undefined so positional alignment with sibling ranges is preserved.
function resolveRangeValues(node: AstNode, ctx: Ctx): unknown[] {
  if (node.kind !== 'ref') {
    // Not a plain range/ref — evaluate as a single scalar.
    return [walk(node, ctx).value];
  }
  const { sheet, cells } = parseRange(node.value);
  const sh = sheet ?? ctx.sourceCell.sheet;
  return cells.map(addr => {
    const cached = ctx.lookup.get(`${sh}!${addr}`);
    return cached ? cached.value : undefined;
  });
}

// Module-level set to dedupe console.warn calls per process
const WARNED_FN_NAMES = new Set<string>();

interface Branch {
  value: number;
  components: EvalComponent[];
  confidence: number;
  unknownFunctions?: string[];
}

function walk(node: AstNode, ctx: Ctx): Branch {
  switch (node.kind) {
    case 'num':
      return { value: node.value, components: [], confidence: 1 };

    case 'str':
      // A bare string in a numeric context coerces to its numeric form (Excel
      // does the same for things like "5"); non-numeric strings become 0.
      return { value: toNumber(node.value), components: [], confidence: 1 };

    case 'ref': {
      const ref = parseRef(node.value);
      const sheet = ref.sheet ?? ctx.sourceCell.sheet;
      const cached = ctx.lookup.get(`${sheet}!${ref.address}`);
      const value = cached ? toNumber(cached.value) : 0;

      if (sheet === ctx.targetSheet) {
        const comp: EvalComponent = {
          sourceCell: { ...ctx.sourceCell },
          referencedCell: { sheet, address: ref.address },
          coefficient: 1,
          unitPrice: value,
          costContribution: value,
          confidence: 1,
        };
        return { value, components: [comp], confidence: 1 };
      }

      if (cached?.formula && ctx.depth < ctx.maxDepth) {
        try {
          const subAst = parse(tokenize(cached.formula));
          const subCtx: Ctx = { ...ctx, sourceCell: { sheet, address: ref.address }, depth: ctx.depth + 1 };
          return walk(subAst, subCtx);
        } catch {
          return { value, components: [], confidence: 0.5 };
        }
      }
      return { value, components: [], confidence: 1 };
    }

    case 'unary': {
      const sub = walk(node.operand, ctx);
      return {
        value: -sub.value,
        components: sub.components.map(c => ({
          ...c,
          coefficient: -c.coefficient,
          costContribution: -c.costContribution,
        })),
        confidence: sub.confidence,
        ...(sub.unknownFunctions?.length ? { unknownFunctions: sub.unknownFunctions } : {}),
      };
    }

    case 'binop': {
      const l = walk(node.left, ctx);
      const r = walk(node.right, ctx);
      const conf = Math.min(l.confidence, r.confidence);
      const mergedUnknown = [...(l.unknownFunctions ?? []), ...(r.unknownFunctions ?? [])];
      const unkSpread = mergedUnknown.length ? { unknownFunctions: mergedUnknown } : {};
      if (node.op === '+') {
        return { value: l.value + r.value, components: [...l.components, ...r.components], confidence: conf, ...unkSpread };
      }
      if (node.op === '-') {
        return {
          value: l.value - r.value,
          components: [
            ...l.components,
            ...r.components.map(c => ({ ...c, coefficient: -c.coefficient, costContribution: -c.costContribution })),
          ],
          confidence: conf,
          ...unkSpread,
        };
      }
      if (node.op === '*') {
        if (l.components.length > 0 && r.components.length === 0) {
          const scale = r.value;
          return {
            value: l.value * scale,
            components: l.components.map(c => ({
              ...c,
              coefficient: c.coefficient * scale,
              costContribution: c.costContribution * scale,
            })),
            confidence: conf,
            ...unkSpread,
          };
        }
        if (r.components.length > 0 && l.components.length === 0) {
          const scale = l.value;
          return {
            value: l.value * r.value,
            components: r.components.map(c => ({
              ...c,
              coefficient: c.coefficient * scale,
              costContribution: c.costContribution * scale,
            })),
            confidence: conf,
            ...unkSpread,
          };
        }
        if (l.components.length > 0 && r.components.length > 0) {
          return { value: l.value * r.value, components: [], confidence: 0.5, ...unkSpread };
        }
        return { value: l.value * r.value, components: [], confidence: conf, ...unkSpread };
      }
      if (r.value === 0) return { value: 0, components: [], confidence: 0.5, ...unkSpread };
      if (l.components.length > 0 && r.components.length === 0) {
        const scale = 1 / r.value;
        return {
          value: l.value / r.value,
          components: l.components.map(c => ({
            ...c,
            coefficient: c.coefficient * scale,
            costContribution: c.costContribution * scale,
          })),
          confidence: conf,
          ...unkSpread,
        };
      }
      return { value: l.value / r.value, components: [], confidence: conf, ...unkSpread };
    }

    case 'fn': {
      const name = node.name.toUpperCase();

      if (name === 'SUM') {
        // SUM(arg1, arg2, ...) where each arg may be a range or scalar. We
        // resolve ranges to their cached cell values and add them. Components
        // are not produced for ranges (they aggregate many cells); the numeric
        // value is what downstream quantity math needs.
        let total = 0;
        for (const arg of node.args) {
          if (arg.kind === 'ref') {
            for (const v of resolveRangeValues(arg, ctx)) total += toNumber(v);
          } else {
            total += walk(arg, ctx).value;
          }
        }
        return { value: total, components: [], confidence: 1 };
      }

      if (name === 'SUMIF') {
        // SUMIF(range, criteria, [sum_range])
        const rangeNode = node.args[0];
        const critNode = node.args[1];
        const sumNode = node.args[2] ?? rangeNode;
        if (!rangeNode || !critNode) {
          return unresolvedFn(node.name);
        }
        const critValues = resolveRangeValues(rangeNode, ctx);
        const sumValues = resolveRangeValues(sumNode, ctx);
        const crit = parseCriteria(evalCriteriaValue(critNode, ctx));
        let total = 0;
        const n = Math.min(critValues.length, sumValues.length);
        for (let i = 0; i < n; i++) {
          if (criteriaMatches(crit, critValues[i])) total += toNumber(sumValues[i]);
        }
        return { value: total, components: [], confidence: 1 };
      }

      if (name === 'SUMIFS') {
        // SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2, ...])
        const sumNode = node.args[0];
        if (!sumNode || node.args.length < 3) {
          return unresolvedFn(node.name);
        }
        const sumValues = resolveRangeValues(sumNode, ctx);
        const pairs: Array<{ range: unknown[]; crit: Criteria }> = [];
        for (let i = 1; i + 1 < node.args.length; i += 2) {
          const range = resolveRangeValues(node.args[i], ctx);
          const crit = parseCriteria(evalCriteriaValue(node.args[i + 1], ctx));
          pairs.push({ range, crit });
        }
        let total = 0;
        for (let i = 0; i < sumValues.length; i++) {
          let all = true;
          for (const { range, crit } of pairs) {
            if (i >= range.length || !criteriaMatches(crit, range[i])) { all = false; break; }
          }
          if (all) total += toNumber(sumValues[i]);
        }
        return { value: total, components: [], confidence: 1 };
      }

      // Any other function is unsupported: surface a NaN sentinel + the name so
      // the caller can treat the quantity as UNRESOLVED rather than a fake 0.
      return unresolvedFn(node.name);
    }
  }
}

// Sentinel branch for functions we cannot decompose. value is NaN so any
// arithmetic propagates the unresolved-ness; unknownFunctions records the name.
function unresolvedFn(name: string): Branch {
  if (!WARNED_FN_NAMES.has(name)) {
    WARNED_FN_NAMES.add(name);
    console.warn(`[boqParserV2/evaluate] Unknown Excel function: ${name}`);
  }
  return { value: NaN, components: [], confidence: 0.5, unknownFunctions: [name] };
}

// Detects the "= X * 'REKAP RAB'!$O$Y" (or Y*X) markup wrap at the AST root.
// Returns the peeled-off markup + the remainder branch that should walk
// without the markup factor applied.
function peelMarkupAtRoot(ast: AstNode, ctx: Ctx): { inner: AstNode; markup: EvalMarkup } | null {
  if (ast.kind !== 'binop' || ast.op !== '*') return null;
  for (const [side, other] of [[ast.right, ast.left], [ast.left, ast.right]] as const) {
    if (side.kind !== 'ref') continue;
    const ref = parseRef(side.value);
    if (!ref.sheet) continue;
    if (ref.sheet === ctx.targetSheet) continue;
    // I5: accept as markup only when the sheet is specifically "REKAP RAB" (case-insensitive),
    // OR when it starts with REKAP and the referenced cell is in column N or O (canonical markup columns).
    const colIdx = ref.address.replace(/\d+$/, '').toUpperCase();
    const isRekapRab = /^REKAP\s+RAB$/i.test(ref.sheet);
    const isRekapWithMarkupCol = /^REKAP/i.test(ref.sheet) && (colIdx === 'N' || colIdx === 'O');
    if (!isRekapRab && !isRekapWithMarkupCol) continue;
    const cached = ctx.lookup.get(`${ref.sheet}!${ref.address}`);
    if (!cached) continue;
    const factor = toNumber(cached.value);
    if (!Number.isFinite(factor) || factor <= 0 || factor > 10) continue;
    return {
      inner: other,
      markup: { factor, sourceCell: { sheet: ref.sheet, address: ref.address } },
    };
  }
  return null;
}

export function evaluateFormula(
  cell: HarvestedCell,
  lookup: HarvestLookup,
  opts: EvalOptions,
): EvalResult {
  if (!cell.formula) {
    return { evaluatedValue: toNumber(cell.value), components: [], markup: null, confidence: 1 };
  }
  let ast: AstNode;
  try {
    ast = parse(tokenize(cell.formula));
  } catch {
    return { evaluatedValue: toNumber(cell.value), components: [], markup: null, confidence: 0.5 };
  }
  const ctx: Ctx = {
    lookup,
    targetSheet: opts.targetSheet,
    sourceCell: { sheet: cell.sheet, address: cell.address },
    depth: 0,
    maxDepth: opts.maxDepth ?? 10,
  };
  const peeled = peelMarkupAtRoot(ast, ctx);
  const branch = peeled ? walk(peeled.inner, ctx) : walk(ast, ctx);
  const hasCached = typeof cell.value === 'number' && Number.isFinite(cell.value as number);
  const cached = toNumber(cell.value);
  const evaluated = peeled ? branch.value * peeled.markup.factor : branch.value;
  const evaluatedResolved = Number.isFinite(evaluated);
  let conf = branch.confidence;
  if (evaluatedResolved && Math.abs(cached - evaluated) > Math.max(1, Math.abs(cached) * 1e-4)) {
    conf = Math.min(conf, 0.7);
  }
  const unknownFunctions = branch.unknownFunctions?.length ? branch.unknownFunctions : undefined;

  // Resolution policy honoring the truth-correctness contract: never coerce an
  // unresolvable computation to a confident 0.
  //  - Prefer the workbook's own cached numeric value when present (exceljs has
  //    already computed the formula result there).
  //  - Otherwise use our symbolic evaluation when it resolved to a number.
  //  - If neither is available (e.g. an unknown function with no cached value),
  //    surface NaN so the caller sees an UNRESOLVED quantity, not a fake 0.
  let evaluatedValue: number;
  if (hasCached && cached !== 0) {
    evaluatedValue = cached;
  } else if (evaluatedResolved) {
    evaluatedValue = evaluated;
  } else if (hasCached) {
    evaluatedValue = cached; // genuinely-cached 0
  } else {
    evaluatedValue = NaN; // unresolved — caller must treat as unknown, not 0
  }

  return {
    evaluatedValue,
    components: branch.components,
    markup: peeled ? peeled.markup : null,
    confidence: conf,
    ...(unknownFunctions ? { unknownFunctions } : {}),
  };
}
