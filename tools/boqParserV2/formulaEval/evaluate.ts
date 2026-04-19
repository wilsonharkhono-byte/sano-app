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

interface Branch {
  value: number;
  components: EvalComponent[];
  confidence: number;
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
      };
    }

    case 'binop': {
      const l = walk(node.left, ctx);
      const r = walk(node.right, ctx);
      const conf = Math.min(l.confidence, r.confidence);
      if (node.op === '+') {
        return { value: l.value + r.value, components: [...l.components, ...r.components], confidence: conf };
      }
      if (node.op === '-') {
        return {
          value: l.value - r.value,
          components: [
            ...l.components,
            ...r.components.map(c => ({ ...c, coefficient: -c.coefficient, costContribution: -c.costContribution })),
          ],
          confidence: conf,
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
          };
        }
        if (l.components.length > 0 && r.components.length > 0) {
          return { value: l.value * r.value, components: [], confidence: 0.5 };
        }
        return { value: l.value * r.value, components: [], confidence: conf };
      }
      if (r.value === 0) return { value: 0, components: [], confidence: 0.5 };
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
        };
      }
      return { value: l.value / r.value, components: [], confidence: conf };
    }

    case 'fn': {
      return { value: 0, components: [], confidence: 0.5 };
    }
  }
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
  const branch = walk(ast, ctx);
  const cached = toNumber(cell.value);
  const evaluated = branch.value;
  let conf = branch.confidence;
  if (Math.abs(cached - evaluated) > Math.max(1, Math.abs(cached) * 1e-4)) {
    conf = Math.min(conf, 0.7);
  }
  return {
    evaluatedValue: cached || evaluated,
    components: branch.components,
    markup: null,
    confidence: conf,
  };
}
