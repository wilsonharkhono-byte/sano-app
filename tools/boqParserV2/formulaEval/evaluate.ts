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
      if (node.name !== 'SUM') {
        if (!WARNED_FN_NAMES.has(node.name)) {
          WARNED_FN_NAMES.add(node.name);
          console.warn(`[boqParserV2/evaluate] Unknown Excel function: ${node.name}`);
        }
        return { value: 0, components: [], confidence: 0.5, unknownFunctions: [node.name] };
      }
      return { value: 0, components: [], confidence: 0.5 };
    }
  }
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
  const cached = toNumber(cell.value);
  const evaluated = peeled ? branch.value * peeled.markup.factor : branch.value;
  let conf = branch.confidence;
  if (Math.abs(cached - evaluated) > Math.max(1, Math.abs(cached) * 1e-4)) {
    conf = Math.min(conf, 0.7);
  }
  const unknownFunctions = branch.unknownFunctions?.length ? branch.unknownFunctions : undefined;
  return {
    evaluatedValue: cached || evaluated,
    components: branch.components,
    markup: peeled ? peeled.markup : null,
    confidence: conf,
    ...(unknownFunctions ? { unknownFunctions } : {}),
  };
}
