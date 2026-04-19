# BoQ Parser Recipes — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a formula interpreter + recipe assembler for the v2 BoQ parser so composite BoQ rows (e.g., Pakuwon AAL-5 "- Poer PC.5") expose their AHS block contributions with coefficients and markup, fully reconciled to the workbook's cached totals. Ship the PARSER_AI_GUIDE.md constitution alongside.

**Architecture:** Two new modules (`formulaEval.ts`, `recipeBuilder.ts`) plus a type extension (`CostSplit.prelim`) and an orchestration update in `index.ts`. `extractTakeoffs.ts` also extracts the `M` (Prelim) column. Output: every `BoqRowV2` gains an optional `recipe: BoqRowRecipe` field with components, markup, and reconciliation. A new `docs/PARSER_AI_GUIDE.md` documents the contract for future AI helpers.

**Tech Stack:** TypeScript, Jest, ts-jest, xlsx (SheetJS), exceljs (for test fixtures only).

**Spec:** [docs/superpowers/specs/2026-04-19-boq-parser-robust-recipes-design.md](../specs/2026-04-19-boq-parser-robust-recipes-design.md)

## File Map

| File | Role |
|---|---|
| `tools/boqParserV2/types.ts` | Extend `CostSplit` with `prelim`; add `RecipeComponent`, `Markup`, `BoqRowRecipe` |
| `tools/boqParserV2/formulaEval/tokenize.ts` | Lex an Excel formula string into tokens |
| `tools/boqParserV2/formulaEval/parse.ts` | Turn tokens into an AST |
| `tools/boqParserV2/formulaEval/evaluate.ts` | Walk AST symbolically; emit components + markup |
| `tools/boqParserV2/formulaEval/index.ts` | Public API: `evaluateFormula(cell, lookup, opts)` |
| `tools/boqParserV2/recipeBuilder.ts` | Assemble `BoqRowRecipe` per BoQ row from multiple cost cells |
| `tools/boqParserV2/extractTakeoffs.ts` | Detect `Prelim` column; extract `prelim` into `CostSplit`; call recipe builder |
| `tools/boqParserV2/index.ts` | Propagate `recipe` into staging rows |
| `tools/boqParserV2/__tests__/formulaEval.test.ts` | Unit tests for tokenize/parse/evaluate |
| `tools/boqParserV2/__tests__/recipeBuilder.test.ts` | Unit tests for recipe assembly + reconciliation |
| `tools/boqParserV2/__tests__/prelim.test.ts` | Prelim column detection/extraction |
| `tools/boqParserV2/__tests__/snapshots/aal5_poer_pc5.json` | Golden recipe snapshot |
| `tools/boqParserV2/__tests__/recipeSnapshot.test.ts` | Asserts AAL-5 recipe matches snapshot |
| `tmp/parseV2.smoke.test.ts` | Extended with recipe coverage + reconciliation assertions |
| `docs/PARSER_AI_GUIDE.md` | Constitution doc loaded by future AI helpers |

All v1 code (`tools/excelParser.ts`) is untouched per the parallel-rebuild memory.

---

### Task 1: Extend CostSplit with `prelim` and add recipe types

**Files:**
- Modify: `tools/boqParserV2/types.ts`
- Modify: `tools/auditPivot.ts` (consumers of CostSplit)

- [ ] **Step 1: Write the failing test**

Create `tools/boqParserV2/__tests__/prelim.test.ts`:

```typescript
import { extractBoqRows } from '../extractTakeoffs';
import { harvestWorkbook } from '../harvest';
import { buildFixtureBuffer } from './fixtures';

describe('Prelim column support', () => {
  it('captures M=Prelim value in cost_split.prelim', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          { address: 'L7', value: 'Subkon' },
          { address: 'M7', value: 'Prelim' },
          { address: 'A11', value: 1 },
          { address: 'B11', value: 'Pagar pengaman' },
          { address: 'C11', value: 'm1' },
          { address: 'D11', value: 15 },
          { address: 'J11', value: 50000 },
          { address: 'M11', value: 150000 },
        ],
      },
    ]);
    const { cells, lookup } = await harvestWorkbook(wb);
    const rows = extractBoqRows(cells, lookup, 'RAB (A)');
    expect(rows.length).toBe(1);
    expect(rows[0].cost_split).toEqual({
      material: 0,
      labor: 50000,
      equipment: 0,
      prelim: 150000,
    });
  });
});
```

- [ ] **Step 2: Run the test — should fail on type or value**

Run: `npx jest tools/boqParserV2/__tests__/prelim.test.ts --no-coverage`
Expected: FAIL — either `prelim` is missing from the CostSplit type, or the extractor returns `cost_split` without it.

- [ ] **Step 3: Extend CostSplit in `tools/boqParserV2/types.ts`**

Replace the existing `CostSplit` interface:

```typescript
export interface CostSplit {
  material: number;
  labor: number;
  equipment: number;
  prelim: number;
}
```

- [ ] **Step 4: Add recipe types to `tools/boqParserV2/types.ts`** (append at end of file, before any trailing closing braces)

```typescript
export interface RecipeComponent {
  sourceCell: { sheet: string; address: string };
  referencedCell: { sheet: string; address: string };
  referencedBlockTitle: string | null;
  referencedBlockRow: number | null;
  quantityPerUnit: number;
  unitPrice: number;
  costContribution: number;
  lineType: 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim';
  confidence: number;
}

export interface Markup {
  factor: number;
  sourceCell: { sheet: string; address: string };
  sourceLabel: string | null;
}

export interface BoqRowRecipe {
  perUnit: CostSplit;
  subkonPerUnit: number;
  components: RecipeComponent[];
  markup: Markup | null;
  totalCached: number;
}
```

- [ ] **Step 5: Update extractTakeoffs column detector and extractor**

In `tools/boqParserV2/extractTakeoffs.ts`, find `detectCostSplitColumns` and add a `prelim` field:

```typescript
function detectCostSplitColumns(
  byRow: Map<number, Map<string, HarvestedCell>>,
  headerRow: number,
): { material: string; labor: string; equipment: string; subkon: string | null; prelim: string | null } | null {
  if (headerRow === -1) return null;
  const hdr = byRow.get(headerRow);
  if (!hdr) return null;

  let material = '', labor = '', equipment = '';
  let subkon: string | null = null;
  let prelim: string | null = null;
  const sortedCols = Array.from(hdr.entries()).sort((a, b) => {
    const toIdx = (s: string) => s.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    return toIdx(a[0]) - toIdx(b[0]);
  });
  for (const [col, cell] of sortedCols) {
    const txt = String(cell.value ?? '').trim().toLowerCase();
    if (!txt) continue;
    if (!material && /^material$|^bahan$/.test(txt)) material = col;
    else if (!labor && /^upah$|^labor$|^tukang$/.test(txt)) labor = col;
    else if (!equipment && /^peralatan$|^alat$|^equipment$/.test(txt)) equipment = col;
    else if (!subkon && /^sub[- ]?kon/.test(txt)) subkon = col;
    else if (!prelim && /^prelim|^persiapan/.test(txt)) prelim = col;
  }
  if (material || labor || equipment) {
    return {
      material: material || 'I',
      labor: labor || 'J',
      equipment: equipment || 'K',
      subkon,
      prelim,
    };
  }
  return null;
}
```

Then in the row loop where `cost_split` is populated, replace the existing block with:

```typescript
let cost_split: CostSplit | null = null;
let subkon_cost_per_unit: number | null = null;
if (splitCols) {
  const m = cellNumber(map.get(splitCols.material));
  const l = cellNumber(map.get(splitCols.labor));
  const e = cellNumber(map.get(splitCols.equipment));
  const s = splitCols.subkon ? cellNumber(map.get(splitCols.subkon)) : 0;
  const p = splitCols.prelim ? cellNumber(map.get(splitCols.prelim)) : 0;
  if (m > 0 || l > 0 || e > 0 || s > 0 || p > 0) {
    cost_split = { material: m, labor: l, equipment: e, prelim: p };
    if (s > 0) subkon_cost_per_unit = s;
    if (cost_basis === null) cost_basis = 'inline_split';
    ref_cells = ref_cells ?? {};
    ref_cells.material_cost = { sheet: boqSheetName, cell: `${splitCols.material}${row}`, cached_value: m };
    ref_cells.labor_cost = { sheet: boqSheetName, cell: `${splitCols.labor}${row}`, cached_value: l };
    ref_cells.equipment_cost = { sheet: boqSheetName, cell: `${splitCols.equipment}${row}`, cached_value: e };
  }
}
```

- [ ] **Step 6: Update existing fixtures that construct CostSplit objects**

Any test building a `CostSplit` without `prelim` now breaks type inference. Run `npx jest tools/boqParserV2 --no-coverage` and fix each failure by adding `prelim: 0` to the fixture.

- [ ] **Step 7: Run the prelim test**

Run: `npx jest tools/boqParserV2/__tests__/prelim.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 8: Run full suite**

Run: `npx jest tools/boqParserV2 --no-coverage`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add tools/boqParserV2/types.ts tools/boqParserV2/extractTakeoffs.ts tools/boqParserV2/__tests__/prelim.test.ts tools/boqParserV2/__tests__/
git commit -m "feat(boq-v2): add Prelim column to CostSplit, define recipe types"
```

---

### Task 2: Formula tokenizer

**Files:**
- Create: `tools/boqParserV2/formulaEval/tokenize.ts`
- Create: `tools/boqParserV2/__tests__/formulaEval.tokenize.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tools/boqParserV2/__tests__/formulaEval.tokenize.test.ts
import { tokenize } from '../formulaEval/tokenize';

describe('tokenize', () => {
  it('strips leading =', () => {
    expect(tokenize('=A1').map(t => t.kind)).toEqual(['ref']);
  });

  it('handles cell ref with absolute markers', () => {
    const t = tokenize('=$A$1');
    expect(t).toEqual([{ kind: 'ref', value: '$A$1' }]);
  });

  it('handles cross-sheet ref with quoted sheet name', () => {
    const t = tokenize("='REKAP RAB'!$O$4");
    expect(t).toEqual([{ kind: 'ref', value: "'REKAP RAB'!$O$4" }]);
  });

  it('handles cross-sheet ref without quotes', () => {
    const t = tokenize('=Analisa!$F$82');
    expect(t).toEqual([{ kind: 'ref', value: 'Analisa!$F$82' }]);
  });

  it('handles operators + - * / and parens', () => {
    const kinds = tokenize('=(A1+B1)*C1').map(t => t.kind);
    expect(kinds).toEqual(['lparen','ref','op','ref','rparen','op','ref']);
  });

  it('handles numeric literals including decimals', () => {
    const t = tokenize('=1.5*A1');
    expect(t).toEqual([{ kind: 'num', value: '1.5' }, { kind: 'op', value: '*' }, { kind: 'ref', value: 'A1' }]);
  });

  it('handles function calls with args', () => {
    const kinds = tokenize('=SUM(A1,B1)').map(t => t.kind);
    expect(kinds).toEqual(['fn','lparen','ref','comma','ref','rparen']);
  });

  it('handles range reference inside SUM', () => {
    const t = tokenize('=SUM(F13:F18)');
    expect(t.map(x => x.value)).toEqual(['SUM','(','F13:F18',')']);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.tokenize.test.ts --no-coverage`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `tools/boqParserV2/formulaEval/tokenize.ts`**

```typescript
// Tokenizer for the subset of Excel formula syntax used by Indonesian RAB
// workbooks. Supports cell refs (optional sheet prefix, absolute markers),
// numeric literals, the four arithmetic operators, parentheses, commas,
// ranges (A1:B2), and function calls like SUM/SUMIFS/VLOOKUP.

export type TokenKind =
  | 'ref' | 'num' | 'op' | 'lparen' | 'rparen' | 'comma' | 'fn' | 'colon';

export interface Token {
  kind: TokenKind;
  value: string;
}

const FN_NAME_RE = /^[A-Z][A-Z0-9]*/;
const CELL_ADDR_RE = /^\$?[A-Z]+\$?\d+/;
const NUM_RE = /^\d+(?:\.\d+)?/;
const SHEET_QUOTED_RE = /^'([^']+)'!/;
const SHEET_BARE_RE = /^([A-Za-z_][A-Za-z0-9_\- .]*)!/;

export function tokenize(input: string): Token[] {
  let s = input.trim();
  if (s.startsWith('=')) s = s.slice(1).trim();
  const out: Token[] = [];

  while (s.length > 0) {
    // skip whitespace
    if (/^\s/.test(s)) { s = s.trimStart(); continue; }

    // quoted sheet ref: 'Sheet Name'!$A$1  OR  'Sheet Name'!A1:B2
    let m = s.match(SHEET_QUOTED_RE);
    if (m) {
      const prefix = m[0];
      const rest = s.slice(prefix.length);
      const rangeMatch = rest.match(/^(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/);
      if (rangeMatch) {
        out.push({ kind: 'ref', value: prefix + rangeMatch[0] });
        s = rest.slice(rangeMatch[0].length);
        continue;
      }
    }

    // unquoted sheet ref
    m = s.match(SHEET_BARE_RE);
    if (m) {
      const prefix = m[0];
      const rest = s.slice(prefix.length);
      const rangeMatch = rest.match(/^(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?/);
      if (rangeMatch) {
        out.push({ kind: 'ref', value: prefix + rangeMatch[0] });
        s = rest.slice(rangeMatch[0].length);
        continue;
      }
    }

    // function call: identifier followed by '('
    m = s.match(FN_NAME_RE);
    if (m && s[m[0].length] === '(') {
      out.push({ kind: 'fn', value: m[0] });
      s = s.slice(m[0].length);
      continue;
    }

    // cell ref with optional range
    m = s.match(CELL_ADDR_RE);
    if (m) {
      const first = m[0];
      const rest = s.slice(first.length);
      const rangeMatch = rest.match(/^:(\$?[A-Z]+\$?\d+)/);
      if (rangeMatch) {
        out.push({ kind: 'ref', value: first + rangeMatch[0] });
        s = rest.slice(rangeMatch[0].length);
      } else {
        out.push({ kind: 'ref', value: first });
        s = rest;
      }
      continue;
    }

    // number
    m = s.match(NUM_RE);
    if (m) {
      out.push({ kind: 'num', value: m[0] });
      s = s.slice(m[0].length);
      continue;
    }

    // single-char tokens
    const c = s[0];
    if (c === '(') { out.push({ kind: 'lparen', value: c }); s = s.slice(1); continue; }
    if (c === ')') { out.push({ kind: 'rparen', value: c }); s = s.slice(1); continue; }
    if (c === ',') { out.push({ kind: 'comma', value: c }); s = s.slice(1); continue; }
    if ('+-*/'.includes(c)) { out.push({ kind: 'op', value: c }); s = s.slice(1); continue; }

    throw new Error(`tokenize: unexpected character "${c}" in formula "${input}"`);
  }

  return out;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.tokenize.test.ts --no-coverage`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/formulaEval/tokenize.ts tools/boqParserV2/__tests__/formulaEval.tokenize.test.ts
git commit -m "feat(boq-v2): formula tokenizer"
```

---

### Task 3: Formula AST parser

**Files:**
- Create: `tools/boqParserV2/formulaEval/parse.ts`
- Create: `tools/boqParserV2/__tests__/formulaEval.parse.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tools/boqParserV2/__tests__/formulaEval.parse.test.ts
import { tokenize } from '../formulaEval/tokenize';
import { parse } from '../formulaEval/parse';

describe('parse', () => {
  it('parses a bare cell ref', () => {
    const ast = parse(tokenize('=A1'));
    expect(ast).toEqual({ kind: 'ref', value: 'A1' });
  });

  it('respects precedence: * before +', () => {
    const ast = parse(tokenize('=A1+B1*C1'));
    expect(ast.kind).toBe('binop');
    if (ast.kind !== 'binop') throw new Error();
    expect(ast.op).toBe('+');
    expect(ast.left).toEqual({ kind: 'ref', value: 'A1' });
    expect(ast.right.kind).toBe('binop');
  });

  it('respects parentheses', () => {
    const ast = parse(tokenize('=(A1+B1)*C1'));
    expect(ast.kind).toBe('binop');
    if (ast.kind !== 'binop') throw new Error();
    expect(ast.op).toBe('*');
    expect(ast.left.kind).toBe('binop');
  });

  it('parses function call with args', () => {
    const ast = parse(tokenize('=SUM(A1,B1)'));
    expect(ast).toEqual({
      kind: 'fn',
      name: 'SUM',
      args: [ { kind: 'ref', value: 'A1' }, { kind: 'ref', value: 'B1' } ],
    });
  });

  it('parses unary minus', () => {
    const ast = parse(tokenize('=-A1'));
    expect(ast).toEqual({ kind: 'unary', op: '-', operand: { kind: 'ref', value: 'A1' } });
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.parse.test.ts --no-coverage`
Expected: FAIL — parse module not found.

- [ ] **Step 3: Implement `tools/boqParserV2/formulaEval/parse.ts`**

```typescript
// Pratt-style precedence parser over tokenize() output. Produces a minimal
// AST the evaluator can walk symbolically.

import type { Token } from './tokenize';

export type AstNode =
  | { kind: 'ref'; value: string }                                 // A1, $A$1, 'Sheet'!A1, A1:B2
  | { kind: 'num'; value: number }                                  // 1.5
  | { kind: 'binop'; op: '+' | '-' | '*' | '/'; left: AstNode; right: AstNode }
  | { kind: 'unary'; op: '-'; operand: AstNode }
  | { kind: 'fn'; name: string; args: AstNode[] };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

export function parse(tokens: Token[]): AstNode {
  const state = { i: 0, tokens };
  const node = parseExpression(state, 0);
  if (state.i !== tokens.length) {
    throw new Error(`parse: unexpected token at position ${state.i}: ${tokens[state.i]?.value}`);
  }
  return node;
}

type State = { i: number; tokens: Token[] };

function peek(s: State): Token | undefined {
  return s.tokens[s.i];
}

function consume(s: State): Token {
  const t = s.tokens[s.i];
  if (!t) throw new Error('parse: unexpected end of input');
  s.i++;
  return t;
}

function parseExpression(s: State, minPrec: number): AstNode {
  let left = parsePrimary(s);
  while (true) {
    const t = peek(s);
    if (!t || t.kind !== 'op') break;
    const prec = PRECEDENCE[t.value];
    if (prec === undefined || prec < minPrec) break;
    consume(s);
    const right = parseExpression(s, prec + 1);
    left = { kind: 'binop', op: t.value as '+' | '-' | '*' | '/', left, right };
  }
  return left;
}

function parsePrimary(s: State): AstNode {
  const t = peek(s);
  if (!t) throw new Error('parse: unexpected end of input');

  if (t.kind === 'op' && t.value === '-') {
    consume(s);
    const operand = parsePrimary(s);
    return { kind: 'unary', op: '-', operand };
  }

  if (t.kind === 'num') { consume(s); return { kind: 'num', value: Number(t.value) }; }
  if (t.kind === 'ref') { consume(s); return { kind: 'ref', value: t.value }; }

  if (t.kind === 'lparen') {
    consume(s);
    const node = parseExpression(s, 0);
    const close = consume(s);
    if (close.kind !== 'rparen') throw new Error('parse: expected closing paren');
    return node;
  }

  if (t.kind === 'fn') {
    consume(s);
    const open = consume(s);
    if (open.kind !== 'lparen') throw new Error('parse: expected ( after function name');
    const args: AstNode[] = [];
    if (peek(s)?.kind !== 'rparen') {
      args.push(parseExpression(s, 0));
      while (peek(s)?.kind === 'comma') {
        consume(s);
        args.push(parseExpression(s, 0));
      }
    }
    const close = consume(s);
    if (close.kind !== 'rparen') throw new Error('parse: expected ) to close function call');
    return { kind: 'fn', name: t.value, args };
  }

  throw new Error(`parse: unexpected token "${t.value}"`);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.parse.test.ts --no-coverage`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/formulaEval/parse.ts tools/boqParserV2/__tests__/formulaEval.parse.test.ts
git commit -m "feat(boq-v2): formula AST parser"
```

---

### Task 4: Symbolic evaluator — direct cross-sheet refs

**Files:**
- Create: `tools/boqParserV2/formulaEval/evaluate.ts`
- Create: `tools/boqParserV2/formulaEval/index.ts`
- Create: `tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts
import { evaluateFormula } from '../formulaEval';
import type { HarvestLookup, HarvestedCell } from '../types';

function mkLookup(cells: HarvestedCell[]): HarvestLookup {
  const m = new Map<string, HarvestedCell>();
  for (const c of cells) m.set(`${c.sheet}!${c.address}`, c);
  return m;
}

describe('evaluateFormula — direct refs', () => {
  it('emits a component for a bare cross-sheet ref', () => {
    const lookup = mkLookup([
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 1232100, formula: null },
    ]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'R59', row: 59, col: 18, value: 1232100, formula: '=Analisa!$F$82' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.components).toEqual([
      {
        sourceCell: { sheet: 'RAB (A)', address: 'R59' },
        referencedCell: { sheet: 'Analisa', address: 'F82' },
        coefficient: 1,
        unitPrice: 1232100,
        costContribution: 1232100,
        confidence: 1,
      },
    ]);
    expect(result.markup).toBeNull();
    expect(result.evaluatedValue).toBe(1232100);
  });

  it('returns no components when formula has no target-sheet refs', () => {
    const lookup = mkLookup([]);
    const result = evaluateFormula(
      { sheet: 'RAB (A)', address: 'X1', row: 1, col: 24, value: 5, formula: '=2+3' },
      lookup,
      { targetSheet: 'Analisa' },
    );
    expect(result.components).toEqual([]);
    expect(result.evaluatedValue).toBe(5);
  });
});
```

- [ ] **Step 2: Run — verify it fails (module missing)**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts --no-coverage`
Expected: FAIL.

- [ ] **Step 3: Create `tools/boqParserV2/formulaEval/index.ts`**

```typescript
export { evaluateFormula } from './evaluate';
export type { EvalResult, EvalComponent, EvalOptions } from './evaluate';
```

- [ ] **Step 4: Create `tools/boqParserV2/formulaEval/evaluate.ts`**

```typescript
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
  targetSheet: string;         // e.g. "Analisa" — cross-sheet refs to this sheet become components
  maxDepth?: number;           // default 10
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

      // Cross-sheet ref into the target sheet → this is a component leaf.
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

      // Same-sheet ref: if the referenced cell has a formula, recurse.
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
        // coefficient × refBranch: scale the components.
        // If neither side has components, produce a constant.
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
        // Both or neither side has components → return value, drop components
        // (ambiguous: can't attribute multiplier). Downgrade confidence.
        if (l.components.length > 0 && r.components.length > 0) {
          return { value: l.value * r.value, components: [], confidence: 0.5 };
        }
        return { value: l.value * r.value, components: [], confidence: conf };
      }
      // op === '/'
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
      // SUM / SUMIFS / VLOOKUP: evaluate numerically via cached value of the
      // enclosing cell. Don't attempt to decompose — treat opaquely.
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
  // When cached value and evaluated value disagree by more than 1 rupiah,
  // trust the cached value and lower confidence: workbook may have been
  // edited without recalculation, or the interpreter missed something.
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
```

- [ ] **Step 5: Run — verify it passes**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts --no-coverage`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/boqParserV2/formulaEval/ tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts
git commit -m "feat(boq-v2): symbolic formula evaluator — direct refs and arithmetic"
```

---

### Task 5: Evaluator — same-sheet hop + composite AF pattern

**Files:**
- Modify: `tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts` (append tests)

- [ ] **Step 1: Add the failing tests**

Append to the existing `formulaEval.evaluate.test.ts`:

```typescript
describe('evaluateFormula — composite AF pattern', () => {
  it('resolves I=AF, AF=R+V*W+Z*AA into three components', () => {
    // Setup: a BoQ-like arrangement matching AAL-5 row 59 layout
    const lookup = mkLookup([
      // AF59 = R59 + V59*W59 + Z59*AA59
      { sheet: 'RAB (A)', address: 'AF59', row: 59, col: 32, value: 2428240.77, formula: '=R59+V59*W59+Z59*AA59' },
      // R59 = Analisa!$F$82, cached 1232100
      { sheet: 'RAB (A)', address: 'R59', row: 59, col: 18, value: 1232100, formula: '=Analisa!$F$82' },
      // V59 = 'REKAP-PC'!T16, cached 2.1333 (coefficient)
      { sheet: 'RAB (A)', address: 'V59', row: 59, col: 22, value: 2.1333, formula: "='REKAP-PC'!T16" },
      // W59 = Analisa!$F$35, cached 166705.668
      { sheet: 'RAB (A)', address: 'W59', row: 59, col: 23, value: 166705.668, formula: '=Analisa!$F$35' },
      // Z59 = 'REKAP-PC'!U16, cached 84.749 (coefficient)
      { sheet: 'RAB (A)', address: 'Z59', row: 59, col: 26, value: 84.749, formula: "='REKAP-PC'!U16" },
      // AA59 = Analisa!$F$132, cached 9917.5
      { sheet: 'RAB (A)', address: 'AA59', row: 59, col: 27, value: 9917.5, formula: '=Analisa!$F$132' },
      // Referenced cells (target sheet)
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 1232100, formula: null },
      { sheet: 'Analisa', address: 'F35', row: 35, col: 6, value: 166705.668, formula: null },
      { sheet: 'Analisa', address: 'F132', row: 132, col: 6, value: 9917.5, formula: null },
      // Coefficient source cells — not on Analisa, so they stay opaque
      { sheet: 'REKAP-PC', address: 'T16', row: 16, col: 20, value: 2.1333, formula: null },
      { sheet: 'REKAP-PC', address: 'U16', row: 16, col: 21, value: 84.749, formula: null },
    ]);

    // Simulate I59 = AF59 — the evaluator recurses and resolves to 3 components.
    const i59: HarvestedCell = { sheet: 'RAB (A)', address: 'I59', row: 59, col: 9, value: 2428240.77, formula: '=AF59' };
    const result = evaluateFormula(i59, lookup, { targetSheet: 'Analisa' });

    expect(result.components).toHaveLength(3);
    const byRef = Object.fromEntries(result.components.map(c => [c.referencedCell.address, c]));
    expect(byRef['F82'].coefficient).toBeCloseTo(1.0, 4);
    expect(byRef['F82'].costContribution).toBeCloseTo(1232100, 2);
    expect(byRef['F35'].coefficient).toBeCloseTo(2.1333, 4);
    expect(byRef['F35'].costContribution).toBeCloseTo(2.1333 * 166705.668, 2);
    expect(byRef['F132'].coefficient).toBeCloseTo(84.749, 4);
    expect(byRef['F132'].costContribution).toBeCloseTo(84.749 * 9917.5, 2);

    // Total should match cached I59 value within rupiah drift
    const total = result.components.reduce((s, c) => s + c.costContribution, 0);
    expect(Math.abs(total - 2428240.77)).toBeLessThan(1);
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts --no-coverage`
Expected: PASS. The existing evaluate.ts already handles this case via recursion and the `coefficient × ref` scaling logic.

If it fails: check that `walk` correctly routes the multiplication when one side's components are non-empty. Inspect diagnostic logs to find which branch returns empty.

- [ ] **Step 3: Commit**

```bash
git add tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts
git commit -m "test(boq-v2): golden test for AF composite pattern resolution"
```

---

### Task 6: Evaluator — markup extraction

**Files:**
- Modify: `tools/boqParserV2/formulaEval/evaluate.ts` (post-process)
- Modify: `tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts` (append tests)

- [ ] **Step 1: Write the failing test**

Append to `formulaEval.evaluate.test.ts`:

```typescript
describe('evaluateFormula — markup', () => {
  it('peels off *REKAP_RAB!$O$4 as markup, leaves components pre-markup', () => {
    const lookup = mkLookup([
      { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 3303241, formula: null },
      { sheet: 'REKAP RAB', address: 'O4', row: 4, col: 15, value: 1.2, formula: null },
      { sheet: 'Analisa', address: 'F82', row: 82, col: 6, value: 3303241, formula: null },
      { sheet: 'RAB (A)', address: 'R59', row: 59, col: 18, value: 3303241, formula: '=Analisa!$F$82' },
    ]);
    // Pretend N59 references R59 directly for this simplified test
    lookup.set('RAB (A)!N59', { sheet: 'RAB (A)', address: 'N59', row: 59, col: 14, value: 3303241, formula: '=R59' });

    const e59: HarvestedCell = {
      sheet: 'RAB (A)', address: 'E59', row: 59, col: 5, value: 3963889,
      formula: "=N59*'REKAP RAB'!$O$4",
    };
    const result = evaluateFormula(e59, lookup, { targetSheet: 'Analisa' });

    expect(result.markup).toEqual({
      factor: 1.2,
      sourceCell: { sheet: 'REKAP RAB', address: 'O4' },
    });
    // Components stay pre-markup
    expect(result.components).toHaveLength(1);
    expect(result.components[0].costContribution).toBeCloseTo(3303241, 0);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts --no-coverage`
Expected: FAIL — `result.markup` is null (current implementation doesn't detect markup).

- [ ] **Step 3: Update `tools/boqParserV2/formulaEval/evaluate.ts`**

Replace the top-level `evaluateFormula` function with markup detection. Add this helper above `evaluateFormula`:

```typescript
// Detects the "= X * 'REKAP RAB'!$O$Y" (or Y*X) markup wrap at the AST root.
// Returns the peeled-off markup + the remainder branch that should walk
// without the markup factor applied.
function peelMarkupAtRoot(ast: AstNode, ctx: Ctx): { inner: AstNode; markup: EvalMarkup } | null {
  if (ast.kind !== 'binop' || ast.op !== '*') return null;
  for (const [side, other] of [[ast.right, ast.left], [ast.left, ast.right]] as const) {
    if (side.kind !== 'ref') continue;
    const ref = parseRef(side.value);
    // Markup lives on a REKAP-family sheet, one cell reference, not the target sheet.
    if (!ref.sheet) continue;
    if (ref.sheet === ctx.targetSheet) continue;
    if (!/rekap/i.test(ref.sheet)) continue;
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
```

Then modify `evaluateFormula`:

```typescript
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
  const preMarkup = peeled ? branch.value : branch.value;
  const evaluated = peeled ? preMarkup * peeled.markup.factor : branch.value;
  let conf = branch.confidence;
  if (Math.abs(cached - evaluated) > Math.max(1, Math.abs(cached) * 1e-4)) {
    conf = Math.min(conf, 0.7);
  }
  return {
    evaluatedValue: cached || evaluated,
    components: branch.components,
    markup: peeled ? peeled.markup : null,
    confidence: conf,
  };
}
```

- [ ] **Step 4: Run — verify all evaluator tests pass**

Run: `npx jest tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/boqParserV2/formulaEval/evaluate.ts tools/boqParserV2/__tests__/formulaEval.evaluate.test.ts
git commit -m "feat(boq-v2): extract markup factor from =N*REKAP_RAB wrap"
```

---

> **Plan continues in a second file.** The remaining tasks (recipe builder, extractTakeoffs wiring, orchestrator propagation, PARSER_AI_GUIDE, golden snapshot, smoke test assertions) are covered in [2026-04-19-boq-parser-recipes-phase1-part2.md](./2026-04-19-boq-parser-recipes-phase1-part2.md). Complete Tasks 1–6 first, then pick up from Task 7 in the companion file.
