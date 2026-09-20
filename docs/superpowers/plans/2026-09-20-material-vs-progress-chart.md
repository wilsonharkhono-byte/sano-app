# Material vs Progres Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Material vs Progres" meters on every Beranda with a radial snapshot per material group (Diminta / Disetujui / Terpasang terverifikasi / Menurut laporan harian) and an inline weekly trend chart that draws the stock ribbon, the lead bracket and the cover run, per spec `docs/superpowers/specs/2026-09-20-material-vs-progress-chart-design.md`.

**Architecture:** One pure module `tools/analytics/materialChain.ts` turns request lines, verified claim lines, confirmed diary lines, stage weights and the BoQ material plan into weekly cumulative series and the relation numbers. `tools/analytics/data.ts` gains one read (verified claim lines) and one wrapper (`loadChainSupport`). Two chart pieces on the installed `react-native-svg`: a new `RadialRings` and an extended `LineChart` (bands, annotations, legend switches). A new `MaterialChainCard` composes them and replaces `MaterialCoverageCard` inside `ProjectAnalytics`. No SQL.

**Tech Stack:** Expo SDK 54 / React Native / TypeScript; Supabase through RLS; jest (ts-jest) + `@testing-library/react-native`; `react-native-svg` mocked in jest by `jest.svgMock.js` (every SVG element renders as a `View`, so component tests assert on text and accessibility, geometry is tested in `chartGeometry.test.ts`).

**Conventions (from the codebase):** files start with a `// path` line and a two-to-four-line comment saying what the module does and that it is pure when it is; Indonesian UI wording in sentence case; numbers through `qty()` (id-ID); every read pages with `fetchAllPaged`; commit after each task with `git commit -F <file>` (never a heredoc chained into git). Run jest with `npx jest <path>`; after the full run, `git restore assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx` (a parser test rewrites it).

**Branch:** `feat/material-progress-chart` (already created from main; the spec and mockup are its first commit).

---

## File structure

| File | Responsibility |
|---|---|
| `workflows/theme.ts` | `CHART` colour tokens (validated palette). |
| `workflows/components/charts/chartGeometry.ts` | + `polar`, `arcPath`, `bandPath`, `bandLabelIndex` (pure). |
| `tools/analytics/materialCoverage.ts` | Export `CATEGORY_WORK` and `materialGroupOf`; `RequestedLine.reviewed_at`. |
| `tools/analytics/materialChain.ts` | **New, pure.** Groups, weekly series, projection, relation, warnings. |
| `tools/analytics/data.ts` | `MaterialData` / `DiaryData` types; `reviewed_at` in the request read; `loadVerifiedClaimLines`; `loadChainSupport`. |
| `workflows/components/charts/RadialRings.tsx` | **New.** Concentric 270° rings with tint segment, end dot, hero figure. |
| `workflows/components/charts/LineChart.tsx` | + per-series width/opacity/endLabel, bands, annotations, legend as switches, dot surface ring. |
| `workflows/components/analytics/MaterialChainCard.tsx` | **New.** The card: chips, radial, value rows, legend switches, tiles, warnings, expander, trend, captions. |
| `workflows/components/analytics/ProjectAnalytics.tsx` | Mount the new card; `loadChain` in the shared cache. |
| `workflows/components/analytics/DiaryActivityCard.tsx` | Import `DiaryData` from `data.ts`. |
| Deleted | `workflows/components/analytics/MaterialCoverageCard.tsx`, `workflows/components/charts/Meter.tsx`. |
| Tests | `workflows/components/charts/__tests__/chartGeometry.test.ts` (+), `tools/__tests__/analyticsMaterialChain.test.ts` (new), `tools/__tests__/analyticsData.test.ts` (+), `workflows/components/charts/__tests__/RadialRings.test.tsx` (new), `workflows/components/charts/__tests__/LineChart.test.tsx` (new), `workflows/components/analytics/__tests__/MaterialChainCard.test.tsx` (new), `workflows/components/analytics/__tests__/ProjectAnalytics.test.tsx` (updated). |

---

### Task 1: Chart tokens and arc/band geometry

**Files:**
- Modify: `workflows/theme.ts` (after `RADIUS_LG`, line ~126)
- Modify: `workflows/components/charts/chartGeometry.ts`
- Test: `workflows/components/charts/__tests__/chartGeometry.test.ts`

- [ ] **Step 1: Write the failing geometry tests**

Append to `workflows/components/charts/__tests__/chartGeometry.test.ts` (add `polar, arcPath, bandPath, bandLabelIndex` to its import from `'../chartGeometry'`):

```ts
describe('polar and arcPath', () => {
  it('measures angles clockwise from 12 o’clock', () => {
    expect(polar(0, 0, 10, 0)).toEqual({ x: expect.closeTo(0, 6), y: -10 });
    expect(polar(0, 0, 10, 90)).toEqual({ x: 10, y: expect.closeTo(0, 6) });
    expect(polar(0, 0, 10, 180)).toEqual({ x: expect.closeTo(0, 6), y: 10 });
  });

  it('draws an arc from a0 to a1 with the large-arc flag past 180°, and nothing for an empty sweep', () => {
    expect(arcPath(50, 50, 10, 0, 90)).toBe('M 50.00 40.00 A 10 10 0 0 1 60.00 50.00');
    expect(arcPath(50, 50, 10, 225, 495)).toMatch(/^M 42\.93 57\.07 A 10 10 0 1 1 57\.07 57\.07$/);
    expect(arcPath(50, 50, 10, 90, 90)).toBe('');
    expect(arcPath(50, 50, 10, 90, 80)).toBe('');
  });
});

describe('bandPath and bandLabelIndex', () => {
  const area = { x0: 0, x1: 100, y0: 0, y1: 100 };
  it('fills the area between two series as one polygon per run where both are numbers', () => {
    const a = [null, 50, 60, null, 80, 90];
    const b = [null, 10, 20, null, null, 30];
    expect(bandPath(a, b, 100, area)).toBe('M 20.0 50.0 L 40.0 40.0 L 40.0 80.0 L 20.0 90.0 Z');
  });
  it('returns nothing for a lone point and picks the widest positive gap for the label', () => {
    expect(bandPath([null, 50], [null, 10], 100, { x0: 0, x1: 100, y0: 0, y1: 100 })).toBe('');
    expect(bandLabelIndex([10, 50, 60, 20], [5, 10, 55, 30])).toBe(1);
    expect(bandLabelIndex([10, 5], [20, 9])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx jest workflows/components/charts/__tests__/chartGeometry.test.ts`
Expected: FAIL — `polar is not a function` (and the others).

- [ ] **Step 3: Add the tokens and the geometry**

In `workflows/theme.ts`, after `export const RADIUS_LG = 14;` add:

```ts
// ── Chart series colours ─────────────────────────────────────────────────────
// Validated with the dataviz palette checker on COLORS.surface (all-pairs CVD
// ΔE 8.9, normal vision 25.9). The aqua sits at 2.71:1, so its label is always
// drawn beside it. Text never wears a series colour.
export const CHART = {
  procurement: '#D9662B',   // diminta / disetujui
  installed:   COLORS.info, // terpasang, terverifikasi + proyeksi
  diary:       '#1baf7a',   // menurut laporan harian (belum diverifikasi)
  track:       COLORS.trackBg,
  tintOpacity: 0.4,         // the pending part of a procurement ring or line
} as const;
```

Append to `workflows/components/charts/chartGeometry.ts`:

```ts
/** A point on a circle; `deg` runs clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path of the clockwise arc from `a0` to `a1` degrees; empty when a1 ≤ a0. Sweeps past 360° are capped just under a full circle. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (!(a1 > a0)) return '';
  const sweep = Math.min(359.99, a1 - a0);
  const s = polar(cx, cy, r, a0);
  const e = polar(cx, cy, r, a0 + sweep);
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/** The area between series `a` (top edge, drawn forward) and `b` (bottom edge, drawn back), one polygon per run where both are numbers. */
export function bandPath(a: ReadonlyArray<number | null>, b: ReadonlyArray<number | null>, yMax: number, area: { x0: number; x1: number; y0: number; y1: number }): string {
  const parts: string[] = [];
  let run: number[] = [];
  const pt = (i: number, v: number) => `${xAt(i, a.length, area.x0, area.x1).toFixed(1)} ${yAt(v, yMax, area.y0, area.y1).toFixed(1)}`;
  const flush = () => {
    if (run.length >= 2) {
      const fwd = run.map((i) => pt(i, a[i] as number));
      const back = [...run].reverse().map((i) => pt(i, b[i] as number));
      parts.push(`M ${fwd[0]} ${fwd.slice(1).map((p) => `L ${p}`).join(' ')} ${back.map((p) => `L ${p}`).join(' ')} Z`);
    }
    run = [];
  };
  a.forEach((v, i) => { if (typeof v === 'number' && typeof b[i] === 'number') run.push(i); else flush(); });
  flush();
  return parts.join(' ');
}

/** Index where `a` exceeds `b` by the most; null when it never does. */
export function bandLabelIndex(a: ReadonlyArray<number | null>, b: ReadonlyArray<number | null>): number | null {
  let best: number | null = null;
  let gap = 0;
  a.forEach((v, i) => {
    const w = b[i];
    if (typeof v === 'number' && typeof w === 'number' && v - w > gap) { gap = v - w; best = i; }
  });
  return best;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest workflows/components/charts/__tests__/chartGeometry.test.ts`
Expected: PASS (all, including the existing ones).

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(charts): chart colour tokens and arc/band geometry" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add workflows/theme.ts workflows/components/charts/chartGeometry.ts workflows/components/charts/__tests__/chartGeometry.test.ts
git commit -F /tmp/msg.txt
```

---

### Task 2: Material coverage exports and `reviewed_at`

**Files:**
- Modify: `tools/analytics/materialCoverage.ts`
- Modify: `tools/analytics/data.ts` (the header read in `loadMaterialData`)
- Test: `tools/__tests__/analyticsData.test.ts`

- [ ] **Step 1: Write the failing test**

In `tools/__tests__/analyticsData.test.ts`, in the existing `loadMaterialData` test (the one ending with `expect(res.requests).toEqual([...])`), change the mocked header row to carry `reviewed_at` and the expectation to include it. The header chain is the fourth `from.mockReturnValueOnce` in that test (order: `project_material_master`, `project_material_master_lines`, `material_catalog`, `material_request_headers`, `material_request_lines`). Change the header data to:

```ts
{ id: 'h1', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', overall_status: 'APPROVED' }
```

and the expectation to:

```ts
expect(res.requests).toEqual([{ material_id: 'besi', quantity: 500, status: 'APPROVED', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', allocations: [{ boq_item_id: 'k1', allocated_quantity: 500 }] }]);
```

Also add, in the same test after the `res` assertions, a check that the select asked for it:

```ts
const headerChain = from.mock.results[3].value as { calls: Array<[string, unknown[]]> };
expect(headerChain.calls).toEqual(expect.arrayContaining([['select', ['id, created_at, reviewed_at, overall_status']]]));
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest tools/__tests__/analyticsData.test.ts -t loadMaterialData`
Expected: FAIL — the request lacks `reviewed_at` and the select string differs.

- [ ] **Step 3: Export the group helpers and read `reviewed_at`**

In `tools/analytics/materialCoverage.ts`:

1. Change `const CATEGORY_WORK` to `export const CATEGORY_WORK`.
2. Add `reviewed_at?: string | null;` to `RequestedLine` right after `created_at: string;` with the comment `/** material_request_headers.reviewed_at; the decision time when APPROVED or REJECTED. */`.
3. Rename `function groupOf(` to `export function materialGroupOf(` and replace its three call sites (`groupOf(input.catalog, ...)` twice and `groupOf(input.catalog, materialId)` in `coverageByRow`) with `materialGroupOf(...)`. Add above it: `/** The (category, unit) group a catalogue material belongs to; null for assets, Peralatan, or an unknown material. */`.

In `tools/analytics/data.ts`, in `loadMaterialData`:

- headers read: `select('id, created_at, reviewed_at, overall_status')` and the type `{ id: string; created_at: string; reviewed_at: string | null; overall_status: string }`.
- when pushing: add `reviewed_at: header.reviewed_at ?? null,` after `created_at: header.created_at,`.

- [ ] **Step 4: Run the tests**

Run: `npx jest tools/__tests__/analyticsData.test.ts tools/__tests__/analyticsModules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(analytics): material groups exported, requests carry their decision time" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add tools/analytics/materialCoverage.ts tools/analytics/data.ts tools/__tests__/analyticsData.test.ts
git commit -F /tmp/msg.txt
```

---

### Task 3: `materialChain.ts` — groups, procurement series and the week axis

**Files:**
- Create: `tools/analytics/materialChain.ts`
- Test: `tools/__tests__/analyticsMaterialChain.test.ts`

- [ ] **Step 1: Write the failing tests (fixtures + groups + procurement + axis)**

Create `tools/__tests__/analyticsMaterialChain.test.ts`:

```ts
// tools/__tests__/analyticsMaterialChain.test.ts
import { buildMaterialChain, type MaterialChainInput } from '../analytics/materialChain';

export const catalog = new Map([
  ['besi13', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['besi16', { name: 'Besi beton ulir 16 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }],
  ['bata', { name: 'Bata ringan', category: 'Dinding', unit: 'pcs', is_asset: false }],
  ['scaf', { name: 'Scaffolding', category: 'Peralatan', unit: 'set', is_asset: true }],
]);
const planned = [
  { material_id: 'besi13', boq_item_id: 'k1', planned_quantity: 1000 },
  { material_id: 'besi16', boq_item_id: 'k2', planned_quantity: 3000 },
  { material_id: 'semen', boq_item_id: 'k1', planned_quantity: 200 },
  { material_id: 'bata', boq_item_id: 'd1', planned_quantity: 500 },
  { material_id: 'scaf', boq_item_id: null, planned_quantity: 10 },
];
const req = (material: string, quantity: number, status: string, created: string, reviewed: string | null = null) => ({
  material_id: material, quantity, status, created_at: `${created}T02:00:00Z`, reviewed_at: reviewed ? `${reviewed}T02:00:00Z` : null, allocations: [],
});
const requests = [
  req('besi13', 500, 'APPROVED', '2026-08-10', '2026-08-12'),
  req('besi16', 900, 'PENDING', '2026-08-20'),
  req('besi16', 300, 'REJECTED', '2026-08-21', '2026-08-22'),
  req('semen', 100, 'APPROVED', '2026-09-01'),
];
const weights = [{ boq_item_id: 'k1', weights: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 } }];
const vline = (row: string, pct: Record<string, number>, at: string) => ({ boq_item_id: row, verified_pct: pct, verified_at: `${at}T03:00:00Z` });
const dline = (id: string, row: string, stage: string | null, state: string, periodEnd: string, reportNo: number, lineIndex = 0) => ({
  id, boq_item_id: row, stage, activity_state: state, line_text: '', line_index: lineIndex, report_id: `r${reportNo}`, report_no: reportNo, revision: 1, period_end: periodEnd, issued_at: null,
});

export function input(over: Partial<MaterialChainInput> = {}): MaterialChainInput {
  return { today: '2026-09-17', planned, requests, catalog, weights, verifiedLines: [], diary: { lines: [], readable: true }, ...over };
}

describe('buildMaterialChain groups', () => {
  it('makes one chain per planned material group, largest plan first, with the work it feeds', () => {
    const { groups, unplannedRequested } = buildMaterialChain(input());
    expect(groups.map((g) => g.chipLabel)).toEqual(['Besi (kg) → Pembesian', 'Bata (pcs) → Pasangan', 'Semen (zak) → Pengecoran']);
    expect(groups[0]).toMatchObject({ key: 'Struktur · kg', category: 'Struktur', unit: 'kg', planned: 4000, rows: 2 });
    expect(unplannedRequested).toEqual([]);
  });

  it('lists requested groups without a plan instead of charting them', () => {
    const { groups, unplannedRequested } = buildMaterialChain(input({ planned: planned.filter((p) => p.material_id !== 'semen') }));
    expect(groups.map((g) => g.key)).toEqual(['Struktur · kg', 'Dinding · pcs']);
    expect(unplannedRequested).toEqual(['Material Beton (zak)']);
  });
});

describe('buildMaterialChain procurement series', () => {
  it('cumulates requests by the week made and approvals by the week decided, rejected left out, as % of plan', () => {
    const g = buildMaterialChain(input()).groups[0];
    expect(g.weeks.slice(0, 6)).toEqual(['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    expect(g.thisWeekIndex).toBe(5);
    expect(g.requested.slice(0, 6)).toEqual([12.5, 35, 35, 35, 35, 35]);
    expect(g.approved.slice(0, 6)).toEqual([12.5, 12.5, 12.5, 12.5, 12.5, 12.5]);
    expect(g.today).toMatchObject({ requested: 35, approved: 12.5, verified: null, diary: null });
  });

  it('falls back to the request week when an approved header has no decision time', () => {
    const g = buildMaterialChain(input({ requests: [req('besi13', 400, 'APPROVED', '2026-09-02')] })).groups[0];
    expect(g.weeks[0]).toBe('2026-08-31');
    expect(g.approved[0]).toBe(10);
  });

  it('starts the axis this week when nothing was ever recorded', () => {
    const g = buildMaterialChain(input({ requests: [] })).groups[0];
    expect(g.weeks).toEqual(['2026-09-14']);
    expect(g.requested).toEqual([0]);
    expect(g.projectionNote).toBe('Belum ada progres terverifikasi.');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest tools/__tests__/analyticsMaterialChain.test.ts`
Expected: FAIL — cannot find module `../analytics/materialChain`.

- [ ] **Step 3: Create the module (groups, procurement, axis; installed series come in Task 4)**

Create `tools/analytics/materialChain.ts`:

```ts
// tools/analytics/materialChain.ts
// SANO — Material vs progres (spec 2026-09-20 §5): per material group, what
// was requested and approved against what the verified claims and the daily
// reports say is installed, week by week, with the stock, lead and cover that
// follow. The BoQ material plan per work area is the bridge from a stage
// percent to a quantity. Pure; nothing here is estimated.
import type { DiaryLine } from '../progressClaims/diaryEvidence';
import { rowFraction, type StagePct } from '../progressClaims/stageMath';
import { pctOfStatus, statusOfActivity } from '../progressClaims/statusCredit';
import { isSingle, validateStageWeights, SINGLE_WEIGHTS, type StageKey, type StageWeights } from '../progressClaims/stageWeights';
import type { WeightBearingStage } from '../reportLineDraftValidate';
import { addCalendarDays } from '../timeWindow';
import { CATEGORY_WORK, materialGroupOf, type CatalogEntry, type PlannedLine, type RequestedLine } from './materialCoverage';
import { dateOf, daysBetween, weekOf, weeksBetween } from './weekBuckets';
import { WORK_TYPE_LABELS } from './workType';

export const PACE_WINDOW_WEEKS = 4;
export const PROJECTION_MAX_WEEKS = 16;
/** Terpasang may run this many points above Disetujui before the card warns (the claim flag's tolerance). */
export const OVERRUN_TOLERANCE_PTS = 10;

/** The claim stage a catalogue category feeds; other categories feed the row as a whole. */
const CATEGORY_STAGE: Record<string, WeightBearingStage> = { Struktur: 'PEMBESIAN', 'Kayu & Bekisting': 'BEKISTING', 'Material Beton': 'PENGECORAN' };
const SHORT_NAME: Record<string, string> = { Struktur: 'Besi', 'Kayu & Bekisting': 'Bekisting', Dinding: 'Bata', Plumbing: 'Pipa' };

export interface VerifiedClaimLine { boq_item_id: string; verified_pct: unknown; verified_at: string }
export interface StageWeightInput { boq_item_id: string; weights: unknown }

export interface MaterialChainInput {
  /** Today as a WIB date. */
  today: string;
  planned: ReadonlyArray<PlannedLine>;
  requests: ReadonlyArray<RequestedLine>;
  catalog: ReadonlyMap<string, CatalogEntry>;
  weights: ReadonlyArray<StageWeightInput>;
  verifiedLines: ReadonlyArray<VerifiedClaimLine>;
  diary: { lines: ReadonlyArray<DiaryLine>; readable: boolean };
}

export interface ChainRelation {
  /** Disetujui − Terpasang, in points and in the group's unit; null with a note when nothing is verified. */
  stockPts: number | null;
  stockQty: number | null;
  stockNote: string | null;
  leadWeeks: number | null;
  /** Index in `weeks` where Disetujui first reached today's Terpasang. */
  leadWeekIndex: number | null;
  leadNote: string | null;
  coverWeeks: number | null;
  coverNote: string | null;
  pacePerWeek: number | null;
  windowWeeks: number | null;
}

export interface ChainGroup {
  /** "Struktur · kg" */
  key: string;
  category: string;
  unit: string;
  shortName: string;
  workLabel: string | null;
  /** "Besi (kg) → Pembesian" */
  chipLabel: string;
  planned: number;
  /** Work areas with a planned quantity of this group. */
  rows: number;
  weeks: string[];
  thisWeekIndex: number;
  requested: Array<number | null>;
  approved: Array<number | null>;
  verified: Array<number | null>;
  diary: Array<number | null>;
  projected: Array<number | null>;
  today: { requested: number; approved: number; verified: number | null; diary: number | null };
  relation: ChainRelation;
  warnings: string[];
  projectionNote: string | null;
  diaryReadable: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const endOf = (week: string) => addCalendarDays(week, 6);
const fmt = (n: number) => round1(n).toLocaleString('id-ID');

export function shortGroupName(category: string, unit: string): string {
  if (category === 'Material Beton') return unit === 'zak' ? 'Semen' : unit === 'm3' || unit === 'm³' ? 'Readymix' : 'Beton';
  return SHORT_NAME[category] ?? category;
}

function parsePct(raw: unknown): StagePct {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: StagePct = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k as StageKey] = Math.min(100, Math.max(0, v));
  }
  return out;
}

/** The share of a row this group counts: its stage when the row is split and the group feeds a stage; the row as a whole otherwise. */
function rowPct(weights: StageWeights, pct: StagePct, stage: WeightBearingStage | null): number {
  if (isSingle(weights)) return pct.SINGLE ?? 0;
  if (stage) return pct[stage] ?? 0;
  return rowFraction(weights, pct) * 100;
}

interface RowState { planned: number; weights: StageWeights; verified: Array<{ at: string; pct: StagePct }>; diary: DiaryLine[] }

const diaryOrder = (l: DiaryLine) => `${l.period_end}|${String(l.report_no).padStart(6, '0')}|${String(l.line_index).padStart(4, '0')}`;

export function buildMaterialChain(input: MaterialChainInput): { groups: ChainGroup[]; unplannedRequested: string[] } {
  const thisWeek = weekOf(input.today);
  const weightsByRow = new Map<string, StageWeights>();
  for (const w of input.weights) { const v = validateStageWeights(w.weights); if (v.ok) weightsByRow.set(w.boq_item_id, v.weights); }

  // Plan per group and per row.
  const plans = new Map<string, { category: string; unit: string; rows: Map<string, RowState> }>();
  for (const p of input.planned) {
    const g = materialGroupOf(input.catalog, p.material_id);
    const q = Number(p.planned_quantity) || 0;
    if (!g || !p.boq_item_id || q <= 0) continue;
    if (!plans.has(g.key)) plans.set(g.key, { category: g.category, unit: g.unit, rows: new Map() });
    const rows = plans.get(g.key)!.rows;
    const row = rows.get(p.boq_item_id) ?? { planned: 0, weights: weightsByRow.get(p.boq_item_id) ?? SINGLE_WEIGHTS, verified: [], diary: [] };
    row.planned += q;
    rows.set(p.boq_item_id, row);
  }

  // Requests per group: (week, qty) events for Diminta and Disetujui.
  const events = new Map<string, { requested: Array<[string, number]>; approved: Array<[string, number]> }>();
  const unplanned = new Set<string>();
  for (const r of input.requests) {
    const g = materialGroupOf(input.catalog, r.material_id);
    if (!g || r.status === 'REJECTED') continue;
    if (!plans.has(g.key)) { unplanned.add(`${g.category} (${g.unit})`); continue; }
    if (!events.has(g.key)) events.set(g.key, { requested: [], approved: [] });
    const e = events.get(g.key)!;
    const qty = Number(r.quantity) || 0;
    e.requested.push([weekOf(r.created_at), qty]);
    if (r.status === 'APPROVED') e.approved.push([weekOf(r.reviewed_at ?? r.created_at), qty]);
  }

  const groups: ChainGroup[] = [];
  for (const [key, plan] of plans) {
    const stage = CATEGORY_STAGE[plan.category] ?? null;
    for (const v of input.verifiedLines) plan.rows.get(v.boq_item_id)?.verified.push({ at: v.verified_at, pct: parsePct(v.verified_pct) });
    for (const l of input.diary.lines) {
      const row = l.boq_item_id ? plan.rows.get(l.boq_item_id) : null;
      if (!row) continue;
      if (!isSingle(row.weights) && stage && l.stage !== stage) continue;
      row.diary.push(l);
    }
    for (const row of plan.rows.values()) {
      row.verified.sort((a, b) => a.at.localeCompare(b.at));
      row.diary.sort((a, b) => diaryOrder(a).localeCompare(diaryOrder(b)));
    }
    groups.push(buildGroup(key, plan, stage, events.get(key) ?? { requested: [], approved: [] }, thisWeek, input.diary.readable));
  }
  groups.sort((a, b) => b.planned - a.planned || a.key.localeCompare(b.key));
  return { groups, unplannedRequested: [...unplanned].sort() };
}

function buildGroup(
  key: string,
  plan: { category: string; unit: string; rows: Map<string, RowState> },
  stage: WeightBearingStage | null,
  events: { requested: Array<[string, number]>; approved: Array<[string, number]> },
  thisWeek: string,
  diaryReadable: boolean,
): ChainGroup {
  const rows = [...plan.rows.values()];
  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const pctOfPlan = (q: number) => (planned > 0 ? round1((100 * q) / planned) : 0);
  const hasVerified = rows.some((r) => r.verified.length > 0);
  const hasDiary = diaryReadable && rows.some((r) => r.diary.length > 0);

  const firstWeek = [
    ...events.requested.map(([w]) => w),
    ...rows.flatMap((r) => r.verified.map((v) => weekOf(v.at))),
    ...rows.flatMap((r) => r.diary.map((l) => weekOf(l.period_end))),
    thisWeek,
  ].sort()[0];

  // Cumulative figures at each week's end, up to this week.
  const cum = (list: Array<[string, number]>, w: string) => list.reduce((s, [ew, q]) => (ew <= w ? s + q : s), 0);
  const verifiedAt = (row: RowState, end: string) => {
    let latest: StagePct | null = null;
    for (const v of row.verified) { if (dateOf(v.at) <= end) latest = v.pct; else break; }
    return latest ? rowPct(row.weights, latest, stage) : 0;
  };
  const diaryAt = (row: RowState, end: string) => {
    let latest: DiaryLine | null = null;
    for (const l of row.diary) { if (l.period_end <= end) latest = l; else break; }
    return latest ? pctOfStatus(statusOfActivity(latest.activity_state)) : 0;
  };
  const installedAt = (end: string) => {
    let v = 0;
    let d = 0;
    for (const row of rows) {
      const vp = verifiedAt(row, end);
      v += (row.planned * vp) / 100;
      d += (row.planned * Math.max(vp, diaryAt(row, end))) / 100;
    }
    return { verified: pctOfPlan(v), diary: pctOfPlan(d) };
  };

  const pastWeeks = weeksBetween(firstWeek, thisWeek);
  const series = pastWeeks.map((w) => {
    const end = endOf(w);
    const inst = installedAt(end);
    return { week: w, requested: pctOfPlan(cum(events.requested, w)), approved: pctOfPlan(cum(events.approved, w)), verified: hasVerified ? inst.verified : null, diary: hasDiary || hasVerified ? (diaryReadable ? inst.diary : null) : null };
  });
  const now = series[series.length - 1];

  // Projection at the pace of the last four calendar weeks, as the S-curve does.
  const verifiedWeeks = [...new Set(rows.flatMap((r) => r.verified.map((v) => weekOf(v.at))))].sort();
  let pace: number | null = null;
  let windowWeeks: number | null = null;
  let projectionNote: string | null = null;
  if (!hasVerified) projectionNote = 'Belum ada progres terverifikasi.';
  else if (verifiedWeeks.length < 2) projectionNote = 'Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.';
  else if ((now.verified as number) < 100) {
    windowWeeks = Math.max(1, Math.min(PACE_WINDOW_WEEKS, Math.round(daysBetween(verifiedWeeks[0], thisWeek) / 7)));
    const before = series.find((s) => s.week === addCalendarDays(thisWeek, -7 * windowWeeks))?.verified ?? 0;
    const p = round1(((now.verified as number) - before) / windowWeeks);
    if (p > 0) pace = p; else projectionNote = `Tidak ada kenaikan progres terverifikasi dalam ${PACE_WINDOW_WEEKS} minggu terakhir.`;
  }
  const stepsToFull = pace ? Math.min(PROJECTION_MAX_WEEKS, Math.ceil((100 - (now.verified as number)) / pace)) : 0;
  const weeks = weeksBetween(firstWeek, addCalendarDays(thisWeek, 7 * stepsToFull));
  const thisWeekIndex = pastWeeks.length - 1;
  const at = <K extends 'requested' | 'approved' | 'verified' | 'diary'>(k: K) => weeks.map((w, i) => (i <= thisWeekIndex ? series[i][k] : null));
  const projected = weeks.map((w, i) => (pace === null || i < thisWeekIndex ? null : Math.min(100, round1((now.verified as number) + (i - thisWeekIndex) * pace))));

  // The relation between what was approved and what is installed.
  const A = now.approved;
  const T = now.verified;
  const relation: ChainRelation = {
    stockPts: null, stockQty: null, stockNote: null, leadWeeks: null, leadWeekIndex: null, leadNote: null,
    coverWeeks: null, coverNote: null, pacePerWeek: pace, windowWeeks,
  };
  if (T === null) {
    relation.stockNote = 'belum ada progres terverifikasi';
    relation.leadNote = 'belum bisa dihitung';
    relation.coverNote = 'belum ada laju';
  } else {
    relation.stockPts = round1(A - T);
    relation.stockQty = round1(((A - T) * planned) / 100);
    if (T <= 0 || A < T) relation.leadNote = 'belum bisa dihitung';
    else {
      const idx = series.findIndex((s) => s.approved >= T);
      relation.leadWeekIndex = idx;
      relation.leadWeeks = Math.round(daysBetween(series[idx].week, thisWeek) / 7);
    }
    if (pace === null) relation.coverNote = 'belum ada laju';
    else if (A <= T) relation.coverNote = 'tidak ada stok tersisa';
    else relation.coverWeeks = Math.round((A - T) / pace);
  }
  const warnings: string[] = [];
  if (T !== null && T - A > OVERRUN_TOLERANCE_PTS) warnings.push(`Pekerjaan melebihi material yang disetujui: terpasang ${fmt(T)} %, disetujui ${fmt(A)} %.`);

  const workType = CATEGORY_WORK[plan.category] ?? null;
  const workLabel = workType ? WORK_TYPE_LABELS[workType] : null;
  const shortName = shortGroupName(plan.category, plan.unit);
  return {
    key, category: plan.category, unit: plan.unit, shortName, workLabel,
    chipLabel: `${shortName} (${plan.unit})${workLabel ? ` → ${workLabel}` : ''}`,
    planned: round1(planned), rows: rows.length, weeks, thisWeekIndex,
    requested: at('requested'), approved: at('approved'), verified: at('verified'), diary: at('diary'), projected,
    today: { requested: now.requested, approved: now.approved, verified: now.verified, diary: now.diary },
    relation, warnings, projectionNote, diaryReadable,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tools/__tests__/analyticsMaterialChain.test.ts`
Expected: PASS (5 tests). If `WORK_TYPE_LABELS['PASANGAN']` is not `'Pasangan'`, check `tools/analytics/workType.ts` and adjust the expected chip label to what it says — do not change the label map.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
printf '%s\n' "feat(analytics): material chain — groups, procurement series and the week axis" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add tools/analytics/materialChain.ts tools/__tests__/analyticsMaterialChain.test.ts
git commit -F /tmp/msg.txt
```

---

### Task 4: `materialChain.ts` — installed series, projection and the relation (tests only; the code from Task 3 already implements them)

**Files:**
- Test: `tools/__tests__/analyticsMaterialChain.test.ts`
- Modify (only if a test fails): `tools/analytics/materialChain.ts`

- [ ] **Step 1: Write the tests**

Append to `tools/__tests__/analyticsMaterialChain.test.ts`:

```ts
const verifiedLines = [
  vline('k1', { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, '2026-08-26'),
  vline('k1', { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 0 }, '2026-09-02'),
  vline('k2', { SINGLE: 25 }, '2026-09-09'),
  vline('zz', { SINGLE: 100 }, '2026-09-09'),
];

describe('buildMaterialChain installed series', () => {
  it('reads each row’s stage percent as of the week, split rows by the group’s stage and single rows as a whole', () => {
    const g = buildMaterialChain(input({ verifiedLines })).groups[0];
    // k1: 50 % pembesian × 1 000 kg from the week of 24 Aug, 100 % from 31 Aug; k2 (SINGLE) 25 % × 3 000 kg from 7 Sep; zz is not in the plan.
    expect(g.verified.slice(0, 6)).toEqual([0, 0, 12.5, 25, 43.8, 43.8]);
    expect(g.today.verified).toBe(43.8);
  });

  it('projects the last weeks’ verified pace to 100 and extends the axis to the finish', () => {
    const g = buildMaterialChain(input({ verifiedLines })).groups[0];
    expect(g.relation).toMatchObject({ pacePerWeek: 10.4, windowWeeks: 3 });
    expect(g.weeks).toHaveLength(12);
    expect(g.weeks[11]).toBe('2026-10-26');
    expect(g.projected.slice(4)).toEqual([null, 43.8, 54.2, 64.6, 75, 85.4, 95.8, 100]);
    expect(g.verified.slice(6)).toEqual([null, null, null, null, null, null]);
    expect(g.projectionNote).toBeNull();
  });

  it('needs verified progress in two different weeks before it projects', () => {
    const g = buildMaterialChain(input({ verifiedLines: verifiedLines.slice(0, 1) })).groups[0];
    expect(g.projectionNote).toBe('Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.');
    expect(g.projected.every((v) => v === null)).toBe(true);
    expect(g.relation.coverNote).toBe('belum ada laju');
  });

  it('turns confirmed diary lines into Berjalan 50 / Selesai 100 on the group’s stage, floored at verified', () => {
    const lines = [
      dline('l1', 'k1', 'PEMBESIAN', 'SELESAI', '2026-08-20', 3),
      dline('l2', 'k1', 'BEKISTING', 'SELESAI', '2026-08-21', 4),
      dline('l3', 'k2', 'BEKISTING', 'MULAI', '2026-09-10', 9),
    ];
    const g = buildMaterialChain(input({ verifiedLines, diary: { lines, readable: true } })).groups[0];
    // 17 Aug: k1 selesai → 1 000 of 4 000. 7 Sep: k1 verified 100 %, k2 (single) mulai → 50 % of 3 000, above its verified 25 %.
    expect(g.diary.slice(0, 6)).toEqual([0, 25, 25, 25, 62.5, 62.5]);
    expect(g.today.diary).toBe(62.5);
    expect(g.diaryReadable).toBe(true);
  });

  it('draws no diary series when the diary cannot be read, and none before any diary or verified row exists', () => {
    const unreadable = buildMaterialChain(input({ verifiedLines, diary: { lines: [], readable: false } })).groups[0];
    expect(unreadable.diary.every((v) => v === null)).toBe(true);
    expect(unreadable.diaryReadable).toBe(false);
    const empty = buildMaterialChain(input()).groups[0];
    expect(empty.diary.every((v) => v === null)).toBe(true);
    expect(empty.verified.every((v) => v === null)).toBe(true);
  });
});

describe('buildMaterialChain relation', () => {
  it('reports stock, lead and cover when approvals run ahead of installation', () => {
    const more = [...requests, req('besi16', 2000, 'APPROVED', '2026-08-17', '2026-08-19')];
    const g = buildMaterialChain(input({ requests: more, verifiedLines })).groups[0];
    expect(g.approved.slice(0, 6)).toEqual([12.5, 62.5, 62.5, 62.5, 62.5, 62.5]);
    expect(g.requested.slice(0, 6)).toEqual([12.5, 85, 85, 85, 85, 85]);
    expect(g.relation).toMatchObject({ stockPts: 18.7, stockQty: 748, stockNote: null, leadWeeks: 4, leadWeekIndex: 1, leadNote: null, coverWeeks: 2, coverNote: null });
    expect(g.warnings).toEqual([]);
  });

  it('shows a negative stock and warns when installation outruns what was approved', () => {
    const g = buildMaterialChain(input({ verifiedLines })).groups[0];
    expect(g.relation).toMatchObject({ stockPts: -31.3, stockQty: -1252, leadWeeks: null, leadNote: 'belum bisa dihitung', coverWeeks: null, coverNote: 'tidak ada stok tersisa' });
    expect(g.warnings).toEqual(['Pekerjaan melebihi material yang disetujui: terpasang 43,8 %, disetujui 12,5 %.']);
  });

  it('says why each number is missing when nothing is verified', () => {
    const g = buildMaterialChain(input()).groups[0];
    expect(g.relation).toMatchObject({ stockPts: null, stockQty: null, stockNote: 'belum ada progres terverifikasi', leadNote: 'belum bisa dihitung', coverNote: 'belum ada laju', pacePerWeek: null });
    expect(g.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx jest tools/__tests__/analyticsMaterialChain.test.ts`
Expected: PASS. If a number differs, recompute by hand from the fixture before touching the module (the comments in the tests show the arithmetic); fix the module only when the hand calculation agrees with the test.

- [ ] **Step 3: Commit**

```bash
printf '%s\n' "test(analytics): material chain — installed series, projection and relation" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add tools/__tests__/analyticsMaterialChain.test.ts tools/analytics/materialChain.ts
git commit -F /tmp/msg.txt
```

---

### Task 5: Reads — verified claim lines and the chain support bundle

**Files:**
- Modify: `tools/analytics/data.ts`
- Test: `tools/__tests__/analyticsData.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tools/__tests__/analyticsData.test.ts` (add `loadChainSupport, loadVerifiedClaimLines` to the import from `'../analytics/data'`):

```ts
describe('loadVerifiedClaimLines and loadChainSupport', () => {
  it('reads the verified claims and their lines in chunks, stamping each line with its claim’s verification time', async () => {
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'c1', verified_at: '2026-08-26T03:00:00Z' }, { id: 'c2', verified_at: '2026-09-02T03:00:00Z' }] }))
      .mockReturnValueOnce(chain({ data: [
        { claim_id: 'c1', boq_item_id: 'k1', verified_pct: { PEMBESIAN: 50 } },
        { claim_id: 'c2', boq_item_id: 'k1', verified_pct: { PEMBESIAN: 100 } },
        { claim_id: 'c2', boq_item_id: 'k2', verified_pct: null },
      ] }));
    await expect(loadVerifiedClaimLines('p1')).resolves.toEqual([
      { boq_item_id: 'k1', verified_pct: { PEMBESIAN: 50 }, verified_at: '2026-08-26T03:00:00Z' },
      { boq_item_id: 'k1', verified_pct: { PEMBESIAN: 100 }, verified_at: '2026-09-02T03:00:00Z' },
    ]);
    expect(from).toHaveBeenNthCalledWith(1, 'progress_claims');
    expect(from).toHaveBeenNthCalledWith(2, 'progress_claim_lines');
    const claims = from.mock.results[0].value as { calls: Array<[string, unknown[]]> };
    expect(claims.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['eq', ['status', 'VERIFIED']], ['range', [0, 999]]]));
    const lines = from.mock.results[1].value as { calls: Array<[string, unknown[]]> };
    expect(lines.calls).toEqual(expect.arrayContaining([['in', ['claim_id', ['c1', 'c2']]]]));
  });

  it('reads nothing more when there is no verified claim', async () => {
    from.mockReturnValueOnce(chain({ data: [] }));
    await expect(loadVerifiedClaimLines('p1')).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('bundles the diary lines, the stage weights and the verified lines, keeping a diary read failure soft', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'client_report_lines') return chain({ error: { message: 'no view' } });
      if (table === 'boq_stage_weights') return chain({ data: [{ boq_item_id: 'k1', weights: { SINGLE: 1 }, source: 'reference', reference_class: 'balok', updated_at: 'x' }] });
      if (table === 'progress_claims') return chain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });
    const res = await loadChainSupport('p1');
    expect(res.diary).toEqual({ lines: [], readable: false });
    expect(res.weights).toEqual([{ boq_item_id: 'k1', weights: { SINGLE: 1 }, source: 'reference', reference_class: 'balok', updated_at: 'x' }]);
    expect(res.verified).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest tools/__tests__/analyticsData.test.ts`
Expected: FAIL — `loadVerifiedClaimLines is not a function`.

- [ ] **Step 3: Add the reads and the shared types**

In `tools/analytics/data.ts`:

1. Add imports: `import { listDiaryLines, listStageWeights, type StageWeightRow } from '../progressClaims/claims';` and `import type { DiaryLine } from '../progressClaims/diaryEvidence';` and `import type { VerifiedClaimLine } from './materialChain';`.
2. Below the `Page` type add the two shared types and use them as the return types of `loadDiaryData` and `loadMaterialData`:

```ts
export interface DiaryData { reports: DiaryReport[]; links: Map<string, string | null> }
export interface MaterialData { planned: PlannedLine[]; requests: RequestedLine[]; catalog: Map<string, CatalogEntry> }
```

(`loadDiaryData(...): Promise<DiaryData>` and `loadMaterialData(...): Promise<MaterialData>`; the `interface ReportRow` line must stay above `loadDiaryData`.)

3. After `loadApprovalData` add:

```ts
/** Every line of every VERIFIED claim, stamped with its claim's verification time; the chart reads the stage percents as of each week. */
export async function loadVerifiedClaimLines(projectId: string): Promise<VerifiedClaimLine[]> {
  const claims = await fetchAllPaged<{ id: string; verified_at: string }>((from, to) =>
    supabase.from('progress_claims').select('id, verified_at').eq('project_id', projectId).eq('status', 'VERIFIED').order('verified_at').order('id').range(from, to) as unknown as Page<{ id: string; verified_at: string }>);
  const verifiedAt = new Map(claims.map((c) => [c.id, c.verified_at]));
  const out: VerifiedClaimLine[] = [];
  for (let i = 0; i < claims.length; i += ID_CHUNK) {
    const ids = claims.slice(i, i + ID_CHUNK).map((c) => c.id);
    const rows = await fetchAllPaged<{ claim_id: string; boq_item_id: string; verified_pct: unknown }>((from, to) =>
      supabase.from('progress_claim_lines').select('claim_id, boq_item_id, verified_pct').in('claim_id', ids).order('id').range(from, to) as unknown as Page<{ claim_id: string; boq_item_id: string; verified_pct: unknown }>);
    for (const r of rows) {
      const at = verifiedAt.get(r.claim_id);
      if (at && r.verified_pct != null) out.push({ boq_item_id: r.boq_item_id, verified_pct: r.verified_pct, verified_at: at });
    }
  }
  return out;
}

export interface ChainSupport { diary: { lines: DiaryLine[]; readable: boolean }; weights: StageWeightRow[]; verified: VerifiedClaimLine[] }

/** What the material chain needs besides the material data: read together so the analytics cache holds one promise. A diary read failure is soft (listDiaryLines says `readable: false`); the others throw. */
export async function loadChainSupport(projectId: string): Promise<ChainSupport> {
  const [diary, weights, verified] = await Promise.all([listDiaryLines(projectId), listStageWeights(projectId), loadVerifiedClaimLines(projectId)]);
  return { diary, weights, verified };
}
```

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest tools/__tests__/analyticsData.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors. (`listDiaryLines` catches its own error and returns `readable: false`, which is what the third test checks.)

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(analytics): read verified claim lines and bundle the chain support reads" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add tools/analytics/data.ts tools/__tests__/analyticsData.test.ts
git commit -F /tmp/msg.txt
```

---

### Task 6: `RadialRings` chart

**Files:**
- Create: `workflows/components/charts/RadialRings.tsx`
- Test: `workflows/components/charts/__tests__/RadialRings.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `workflows/components/charts/__tests__/RadialRings.test.tsx`:

```tsx
// workflows/components/charts/__tests__/RadialRings.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import RadialRings, { START, SWEEP, ringSegments } from '../RadialRings';
import { arcPath, polar } from '../chartGeometry';

describe('ringSegments', () => {
  it('draws the track, the main arc to the value, and a tint segment after a gap up to the tint value', () => {
    const { segments, end } = ringSegments({ key: 'p', color: '#000', value: 30.9, tint: { value: 43.3, opacity: 0.4 } }, 120, 120, 100);
    expect(segments.map((s) => s.kind)).toEqual(['track', 'main', 'tint']);
    expect(segments[1].d).toBe(arcPath(120, 120, 100, START, START + (SWEEP * 30.9) / 100));
    expect(segments[2].opacity).toBe(0.4);
    const gapDeg = (12 / 100) * (180 / Math.PI);
    expect(segments[2].d).toBe(arcPath(120, 120, 100, START + (SWEEP * 30.9) / 100 + gapDeg, START + (SWEEP * 43.3) / 100));
    expect(end).toEqual(polar(120, 120, 100, START + (SWEEP * 30.9) / 100));
  });

  it('draws only the track for a null value, no main arc at zero, and no tint at or below the value', () => {
    expect(ringSegments({ key: 'p', color: '#000', value: null }, 120, 120, 100)).toEqual({ segments: [{ kind: 'track', d: arcPath(120, 120, 100, START, START + SWEEP) }], end: null });
    expect(ringSegments({ key: 'p', color: '#000', value: 0, tint: { value: 0, opacity: 0.4 } }, 120, 120, 100).segments.map((s) => s.kind)).toEqual(['track']);
    expect(ringSegments({ key: 'p', color: '#000', value: 50, tint: { value: 40, opacity: 0.4 } }, 120, 120, 100).segments.map((s) => s.kind)).toEqual(['track', 'main']);
  });

  it('anchors the tint at an explicit start when the main segment is hidden', () => {
    const { segments } = ringSegments({ key: 'p', color: '#000', value: 0, tint: { from: 30.9, value: 43.3, opacity: 0.4 } }, 120, 120, 100);
    expect(segments.map((s) => s.kind)).toEqual(['track', 'tint']);
    expect(segments[1].d).toBe(arcPath(120, 120, 100, START + (SWEEP * 30.9) / 100, START + (SWEEP * 43.3) / 100));
  });
});

describe('RadialRings', () => {
  it('renders the hero figure and the accessibility label', () => {
    const { getByText, getByLabelText } = render(
      <RadialRings
        rings={[{ key: 'a', color: '#D9662B', value: 30.9 }, { key: 'b', color: '#1565C0', value: 13, endDot: true }, { key: 'c', color: '#1baf7a', value: null, hidden: true }]}
        hero={{ value: '13,0 %', label: 'terpasang, terverifikasi' }}
        accessibilityLabel="Besi: diminta 43,3 persen, disetujui 30,9 persen, terpasang 13 persen"
      />,
    );
    expect(getByText('13,0 %')).toBeTruthy();
    expect(getByText('terpasang, terverifikasi')).toBeTruthy();
    expect(getByLabelText('Besi: diminta 43,3 persen, disetujui 30,9 persen, terpasang 13 persen')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest workflows/components/charts/__tests__/RadialRings.test.tsx`
Expected: FAIL — cannot find module `../RadialRings`.

- [ ] **Step 3: Create the component**

Create `workflows/components/charts/RadialRings.tsx`:

```tsx
// workflows/components/charts/RadialRings.tsx
// SANO — concentric rings for a snapshot of several shares of one plan, on
// react-native-svg (web and Android). Each ring sweeps 270° from the lower
// left, 0 % at its start and 100 % at its end, open at the bottom; a ring may
// carry a lighter segment after its main one (requests still waiting) and a
// dot at its end. The hero figure is plain React Native text so it wraps.
// Identity comes from the ring colour plus the legend the caller draws.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { CHART, COLORS, FONTS, TYPE } from '../../theme';
import { arcPath, polar } from './chartGeometry';

export interface Ring {
  key: string;
  color: string;
  /** 0–100; null draws the track only. */
  value: number | null;
  /** A lighter segment from `from` (the value when absent) to `tint.value`, drawn only when it lies beyond the main arc. */
  tint?: { from?: number; value: number; opacity: number } | null;
  endDot?: boolean;
  /** Skips the whole ring, track included. */
  hidden?: boolean;
}

interface Props {
  rings: Ring[];
  /** Outer diameter in px. */
  size?: number;
  hero: { value: string; label: string };
  accessibilityLabel: string;
}

export interface RingSegment { kind: 'track' | 'main' | 'tint'; d: string; opacity?: number }

export const SWEEP = 270;
/** Degrees clockwise from 12 o'clock: the lower left, so the open quarter sits at the bottom. */
export const START = 225;
const RING_WIDTH = 10;
const RING_GAP = 4;
/** Square caps overshoot by half the stroke; this arc length keeps a 2px visible gap between two segments of one ring. */
const SEGMENT_GAP_PX = RING_WIDTH + 2;

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const angleOf = (pct: number) => START + (SWEEP * clamp(pct)) / 100;

/** The arcs of one ring at radius `r`, and the end point of its main arc. Pure, for the tests. */
export function ringSegments(ring: Ring, cx: number, cy: number, r: number): { segments: RingSegment[]; end: { x: number; y: number } | null } {
  const segments: RingSegment[] = [{ kind: 'track', d: arcPath(cx, cy, r, START, START + SWEEP) }];
  if (ring.value === null) return { segments, end: null };
  const a1 = angleOf(ring.value);
  if (ring.value > 0) segments.push({ kind: 'main', d: arcPath(cx, cy, r, START, a1) });
  if (ring.tint && ring.tint.value > ring.value) {
    const from = ring.tint.from ?? ring.value;
    const gapDeg = ring.value > 0 && from <= ring.value ? (SEGMENT_GAP_PX / r) * (180 / Math.PI) : 0;
    const d = arcPath(cx, cy, r, angleOf(from) + gapDeg, angleOf(ring.tint.value));
    if (d) segments.push({ kind: 'tint', d, opacity: ring.tint.opacity });
  }
  return { segments, end: polar(cx, cy, r, a1) };
}

export default function RadialRings({ rings, size = 240, hero, accessibilityLabel }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 14;
  const innerRadius = outer - rings.length * (RING_WIDTH + RING_GAP);
  const label0 = polar(cx, cy, outer + 8, START);
  const label100 = polar(cx, cy, outer + 8, START + SWEEP);
  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size}>
        {rings.map((ring, i) => {
          if (ring.hidden) return null;
          const r = outer - i * (RING_WIDTH + RING_GAP) - RING_WIDTH / 2;
          const { segments, end } = ringSegments(ring, cx, cy, r);
          return (
            <React.Fragment key={ring.key}>
              {segments.map((s) => (
                <Path
                  key={s.kind}
                  d={s.d}
                  stroke={s.kind === 'track' ? CHART.track : ring.color}
                  strokeOpacity={s.opacity ?? 1}
                  strokeWidth={RING_WIDTH}
                  strokeLinecap="square"
                  fill="none"
                />
              ))}
              {ring.endDot && end && <Circle cx={end.x} cy={end.y} r={4} fill={ring.color} stroke={COLORS.surface} strokeWidth={2} />}
            </React.Fragment>
          );
        })}
        <SvgText x={label0.x} y={label0.y + 10} fontSize={10} fill={COLORS.textMuted} textAnchor="middle">0 %</SvgText>
        <SvgText x={label100.x} y={label100.y + 10} fontSize={10} fill={COLORS.textMuted} textAnchor="middle">100 %</SvgText>
      </Svg>
      <View style={styles.overlay} pointerEvents="none">
        <View style={{ width: Math.max(80, innerRadius * 2 - 8), alignItems: 'center' }}>
          <Text style={styles.heroValue}>{hero.value}</Text>
          <Text style={styles.heroLabel}>{hero.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroValue: { fontSize: TYPE.xl, lineHeight: Math.round(TYPE.xl * 1.2), fontFamily: FONTS.bold, color: COLORS.text, textAlign: 'center' },
  heroLabel: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.3), fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center' },
});
```

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest workflows/components/charts/__tests__/RadialRings.test.tsx && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(charts): RadialRings — concentric 270° rings with a pending tint and a hero figure" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add workflows/components/charts/RadialRings.tsx workflows/components/charts/__tests__/RadialRings.test.tsx
git commit -F /tmp/msg.txt
```

---

### Task 7: `LineChart` — bands, annotations, end labels, legend switches

**Files:**
- Modify: `workflows/components/charts/chartGeometry.ts` (+ `endLabelPoints`)
- Modify: `workflows/components/charts/LineChart.tsx`
- Test: `workflows/components/charts/__tests__/chartGeometry.test.ts`, `workflows/components/charts/__tests__/LineChart.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `workflows/components/charts/__tests__/chartGeometry.test.ts` (add `endLabelPoints` to the import):

```ts
describe('endLabelPoints', () => {
  const area = { x0: 0, x1: 100, y0: 0, y1: 100 };
  it('labels each series at its last real point and pushes near-coincident labels apart', () => {
    const points = endLabelPoints([
      { key: 'a', values: [10, 30, null] },
      { key: 'b', values: [5, 34, null] },
      { key: 'c', values: [null, null, null] },
    ], 100, area, 11);
    expect(points.map((p) => p.key)).toEqual(['b', 'a']);
    expect(points[0]).toMatchObject({ index: 1, value: 34, x: 50, y: 66 });
    expect(points[1]).toMatchObject({ index: 1, value: 30, x: 50, y: 77 });
  });
});
```

Create `workflows/components/charts/__tests__/LineChart.test.tsx`:

```tsx
// workflows/components/charts/__tests__/LineChart.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LineChart from '../LineChart';

const series = [
  { key: 'approved', label: 'Disetujui', color: '#D9662B', values: [0, 12.5, 30.9, 30.9], endLabel: true },
  { key: 'verified', label: 'Terpasang (terverifikasi)', color: '#1565C0', values: [null, 1, 8, 13], dots: true, endLabel: true },
  { key: 'diary', label: 'Menurut laporan harian', color: '#1baf7a', width: 1.5, values: [null, 2, 10, 16] },
];

describe('LineChart', () => {
  it('draws a plain legend when there is nothing to switch', () => {
    const { getByText, queryByLabelText } = render(<LineChart labels={['a', 'b', 'c', 'd']} series={series} yMax={100} unit="%" accessibilityLabel="x" />);
    expect(getByText('Disetujui')).toBeTruthy();
    expect(queryByLabelText('Tampilkan Disetujui')).toBeNull();
  });

  it('makes the legend items switches, reporting the hidden state and calling back with the key', () => {
    const onToggle = jest.fn();
    const { getByLabelText } = render(
      <LineChart
        labels={['a', 'b', 'c', 'd']}
        series={series}
        yMax={100}
        unit="%"
        hidden={new Set(['diary'])}
        onToggle={onToggle}
        bands={[{ key: 'stock', between: ['approved', 'verified'], color: '#D9662B', opacity: 0.1, label: 'stok teoretis' }]}
        annotations={[
          { key: 'lead', kind: 'bracket', level: 13, fromIndex: 1, toIndex: 3, label: '~2 minggu', requires: ['approved', 'verified'] },
          { key: 'cover', kind: 'run', level: 30.9, fromIndex: 3, toIndex: 3, label: 'cukup ~9 minggu', color: '#D9662B', requires: ['approved', 'diary'] },
        ]}
        accessibilityLabel="x"
      />,
    );
    expect(getByLabelText('Tampilkan Menurut laporan harian').props.accessibilityState).toEqual({ checked: false });
    expect(getByLabelText('Tampilkan Disetujui').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(getByLabelText('Tampilkan Disetujui'));
    expect(onToggle).toHaveBeenCalledWith('approved');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest workflows/components/charts/__tests__/`
Expected: FAIL — `endLabelPoints is not a function`; the LineChart switch test fails on the missing label.

- [ ] **Step 3: Add `endLabelPoints` to the geometry**

Append to `workflows/components/charts/chartGeometry.ts`:

```ts
/** Where to write each series' last real value; labels closer than `minGap` px are pushed down in order so they never overlap. */
export function endLabelPoints(
  series: ReadonlyArray<{ key: string; values: ReadonlyArray<number | null> }>,
  yMax: number,
  area: { x0: number; x1: number; y0: number; y1: number },
  minGap = 11,
): Array<{ key: string; index: number; value: number; x: number; y: number }> {
  const points: Array<{ key: string; index: number; value: number; x: number; y: number }> = [];
  for (const s of series) {
    let index = -1;
    s.values.forEach((v, i) => { if (typeof v === 'number') index = i; });
    if (index < 0) continue;
    const value = s.values[index] as number;
    points.push({ key: s.key, index, value, x: xAt(index, s.values.length, area.x0, area.x1), y: yAt(value, yMax, area.y0, area.y1) });
  }
  points.sort((a, b) => a.y - b.y);
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].x === points[i - 1].x && points[i].y - points[i - 1].y < minGap) points[i].y = points[i - 1].y + minGap;
  }
  return points;
}
```

- [ ] **Step 4: Extend `LineChart`**

Replace `workflows/components/charts/LineChart.tsx` with:

```tsx
// workflows/components/charts/LineChart.tsx
// SANO — a small line chart on react-native-svg (web and Android). One y-axis;
// series differ by colour, width and dash, never by colour alone, and the
// legend is always there (as switches when the caller passes onToggle). A
// band fills the space between two series, an annotation marks a level over
// a span of weeks. Missing values break the line instead of being drawn as 0.
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { bandLabelIndex, bandPath, endLabelPoints, labelIndices, linePath, niceMax, plotArea, xAt, yAt } from './chartGeometry';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** SVG dash pattern, e.g. "6 4"; solid when absent. */
  dash?: string;
  values: ReadonlyArray<number | null>;
  /** Draw a dot on every point (for sparse, real measurements). */
  dots?: boolean;
  /** Stroke width in px; 2 when absent. */
  width?: number;
  /** 0–1; 1 when absent. */
  opacity?: number;
  /** Write the last real value at the line's end. */
  endLabel?: boolean;
}

export interface Band {
  key: string;
  /** [top series key, bottom series key]; drawn where both are numbers and both visible. */
  between: [string, string];
  color: string;
  opacity: number;
  /** Written once, where the band is widest, when it is at least 16px tall there. */
  label?: string;
}

export interface Annotation {
  key: string;
  /** bracket: a hairline with end ticks and the label above its middle. run: a dotted hairline with the label above its end. */
  kind: 'bracket' | 'run';
  level: number;
  fromIndex: number;
  toIndex: number;
  label: string;
  color?: string;
  /** Series that must be visible for the annotation to show. */
  requires?: string[];
}

interface Props {
  labels: string[];
  series: LineSeries[];
  /** Fixed axis maximum (100 for percent); otherwise rounded up from the data. */
  yMax?: number;
  unit?: string;
  height?: number;
  /** Index of "today", drawn as a thin vertical rule. */
  markerIndex?: number | null;
  accessibilityLabel: string;
  bands?: Band[];
  annotations?: Annotation[];
  /** Series keys switched off; with onToggle the legend items become switches. */
  hidden?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];
const MIN_BAND_LABEL_PX = 16;

export default function LineChart({ labels, series, yMax, unit = '', height = 190, markerIndex = null, accessibilityLabel, bands = [], annotations = [], hidden, onToggle }: Props) {
  const [width, setWidth] = useState(0);
  const isVisible = (key: string) => !hidden?.has(key);
  const visible = series.filter((s) => isVisible(s.key));
  const dataMax = Math.max(0, ...visible.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number')));
  const max = yMax ?? niceMax(dataMax);
  const area = plotArea({ width, height, left: 38, right: 10, top: 8, bottom: 22 });
  const tick = (v: number) => `${Math.round(v * 10) / 10}${unit}`;
  const x = (i: number) => xAt(i, labels.length, area.x0, area.x1);
  const y = (v: number) => yAt(v, max, area.y0, area.y1);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const ends = endLabelPoints(visible.filter((s) => s.endLabel), max, area);

  return (
    <View>
      <View style={styles.legend}>
        {series.map((s) => {
          const key = <View style={[styles.legendLine, { borderTopColor: s.color, borderTopWidth: s.width ?? 2, borderStyle: s.dash ? 'dotted' : 'solid', opacity: s.opacity ?? 1 }]} />;
          const item = (
            <>
              {key}
              <Text style={styles.legendText}>{s.label}</Text>
            </>
          );
          if (!onToggle) return <View key={s.key} style={styles.legendItem}>{item}</View>;
          const on = isVisible(s.key);
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.legendItem, styles.legendSwitch, !on && styles.legendOff]}
              onPress={() => onToggle(s.key)}
              accessibilityRole="switch"
              accessibilityLabel={`Tampilkan ${s.label}`}
              accessibilityState={{ checked: on }}
            >
              {item}
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {TICKS.map((t) => (
              <React.Fragment key={t}>
                <Line x1={area.x0} x2={area.x1} y1={y(max * t)} y2={y(max * t)} stroke={COLORS.borderSub} strokeWidth={1} />
                <SvgText x={area.x0 - 6} y={y(max * t) + 4} fontSize={10} fill={COLORS.textMuted} textAnchor="end">{tick(max * t)}</SvgText>
              </React.Fragment>
            ))}
            {bands.map((b) => {
              const top = byKey.get(b.between[0]);
              const bottom = byKey.get(b.between[1]);
              if (!top || !bottom || !isVisible(top.key) || !isVisible(bottom.key)) return null;
              const d = bandPath(top.values, bottom.values, max, area);
              if (!d) return null;
              const li = b.label ? bandLabelIndex(top.values, bottom.values) : null;
              const tall = li !== null && y(bottom.values[li] as number) - y(top.values[li] as number) >= MIN_BAND_LABEL_PX;
              return (
                <React.Fragment key={b.key}>
                  <Path d={d} fill={b.color} fillOpacity={b.opacity} stroke="none" />
                  {tall && li !== null && (
                    <SvgText x={x(li)} y={(y(top.values[li] as number) + y(bottom.values[li] as number)) / 2 + 4} fontSize={10} fill={COLORS.textSec} textAnchor="middle">{b.label}</SvgText>
                  )}
                </React.Fragment>
              );
            })}
            {markerIndex != null && markerIndex >= 0 && markerIndex < labels.length && (
              <Line x1={x(markerIndex)} x2={x(markerIndex)} y1={area.y0} y2={area.y1} stroke={COLORS.textMuted} strokeWidth={1} strokeDasharray="2 3" />
            )}
            {visible.map((s) => (
              <React.Fragment key={s.key}>
                <Path d={linePath(s.values, max, area)} stroke={s.color} strokeOpacity={s.opacity ?? 1} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" fill="none" />
                {s.dots && s.values.map((v, i) => (typeof v === 'number'
                  ? <Circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke={COLORS.surface} strokeWidth={2} />
                  : null))}
              </React.Fragment>
            ))}
            {annotations.map((an) => {
              if ((an.requires ?? []).some((k) => !isVisible(k))) return null;
              if (an.fromIndex < 0 || an.toIndex >= labels.length || an.toIndex < an.fromIndex) return null;
              const yy = y(an.level);
              const xa = x(an.fromIndex);
              const xb = x(an.toIndex);
              const color = an.color ?? COLORS.textMuted;
              return (
                <React.Fragment key={an.key}>
                  <Line x1={xa} x2={xb} y1={yy} y2={yy} stroke={color} strokeWidth={1} strokeDasharray={an.kind === 'run' ? '2 3' : undefined} />
                  {an.kind === 'bracket' && <Line x1={xa} x2={xa} y1={yy - 3} y2={yy + 3} stroke={color} strokeWidth={1} />}
                  {an.kind === 'bracket' && <Line x1={xb} x2={xb} y1={yy - 3} y2={yy + 3} stroke={color} strokeWidth={1} />}
                  <SvgText x={an.kind === 'bracket' ? (xa + xb) / 2 : xb} y={yy - 5} fontSize={10} fill={COLORS.textSec} textAnchor={an.kind === 'bracket' ? 'middle' : 'end'}>{an.label}</SvgText>
                </React.Fragment>
              );
            })}
            {ends.map((p) => (
              <SvgText key={p.key} x={p.x + 5} y={p.y + 4} fontSize={10} fill={COLORS.textSec} textAnchor="start">{tick(p.value)}</SvgText>
            ))}
            {labelIndices(labels.length, width < 420 ? 4 : 7).map((i) => (
              <SvgText key={i} x={x(i)} y={height - 6} fontSize={10} fill={COLORS.textMuted} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
                {labels[i]}
              </SvgText>
            ))}
          </Svg>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, marginBottom: SPACE.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  legendSwitch: { minHeight: 32 },
  legendOff: { opacity: 0.4 },
  legendLine: { width: 18, height: 0, borderTopWidth: 2 },
  legendText: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.45), fontFamily: FONTS.regular, color: COLORS.textSec },
});
```

- [ ] **Step 5: Run the chart tests, the S-curve tests and the type check**

Run: `npx jest workflows/components/charts/__tests__/ workflows/components/analytics/__tests__/ProjectAnalytics.test.tsx && npx tsc --noEmit`
Expected: PASS (the S-curve card uses only the old props).

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "feat(charts): LineChart bands, annotations, end labels and legend switches" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add workflows/components/charts/chartGeometry.ts workflows/components/charts/LineChart.tsx workflows/components/charts/__tests__/chartGeometry.test.ts workflows/components/charts/__tests__/LineChart.test.tsx
git commit -F /tmp/msg.txt
```

---

### Task 8: `MaterialChainCard`

**Files:**
- Create: `workflows/components/analytics/MaterialChainCard.tsx`
- Test: `workflows/components/analytics/__tests__/MaterialChainCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `workflows/components/analytics/__tests__/MaterialChainCard.test.tsx`:

```tsx
// workflows/components/analytics/__tests__/MaterialChainCard.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
import MaterialChainCard, { qtyText } from '../MaterialChainCard';

const catalog = new Map([
  ['besi', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }],
]);
const material = {
  planned: [
    { material_id: 'besi', boq_item_id: 'k1', planned_quantity: 1000 },
    { material_id: 'besi', boq_item_id: 'k2', planned_quantity: 3000 },
    { material_id: 'semen', boq_item_id: 'k1', planned_quantity: 200 },
  ],
  requests: [
    { material_id: 'besi', quantity: 500, status: 'APPROVED', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', allocations: [] },
    { material_id: 'besi', quantity: 2000, status: 'APPROVED', created_at: '2026-08-17T02:00:00Z', reviewed_at: '2026-08-19T02:00:00Z', allocations: [] },
    { material_id: 'besi', quantity: 900, status: 'PENDING', created_at: '2026-08-20T02:00:00Z', reviewed_at: null, allocations: [] },
  ],
  catalog,
};
const diary = { reports: [], links: new Map() };
const chain = {
  diary: { lines: [], readable: true },
  weights: [{ boq_item_id: 'k1', weights: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 }, source: 'rab', reference_class: null, updated_at: 'x' }],
  verified: [
    { boq_item_id: 'k1', verified_pct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, verified_at: '2026-08-26T03:00:00Z' },
    { boq_item_id: 'k1', verified_pct: { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 0 }, verified_at: '2026-09-02T03:00:00Z' },
    { boq_item_id: 'k2', verified_pct: { SINGLE: 25 }, verified_at: '2026-09-09T03:00:00Z' },
  ],
};

const card = (over: { material?: typeof material; chain?: typeof chain; loadChain?: () => Promise<unknown> } = {}) => render(
  <MaterialChainCard
    loadMaterial={() => Promise.resolve(over.material ?? material)}
    loadDiary={() => Promise.resolve(diary)}
    loadChain={(over.loadChain ?? (() => Promise.resolve(over.chain ?? chain))) as never}
    today="2026-09-17"
  />,
);

describe('qtyText', () => {
  it('reads kilograms as tonnes from a thousand and keeps other units', () => {
    expect(qtyText(748, 'kg')).toBe('748 kg');
    expect(qtyText(41800, 'kg')).toBe('41,8 t');
    expect(qtyText(-1252, 'kg')).toBe('-1,3 t');
    expect(qtyText(42, 'lbr')).toBe('42 lbr');
  });
});

describe('MaterialChainCard', () => {
  it('opens on the largest plan with this week’s rings, the relation tiles and the caption', async () => {
    const { findAllByText, getByText, getByLabelText } = card();
    // The hero figure and the Terpasang row both read it.
    expect(await findAllByText('43,8 %')).toHaveLength(2);
    expect(getByText('terpasang, terverifikasi')).toBeTruthy();
    expect(getByLabelText('Besi (kg) → Pembesian').props.accessibilityState).toEqual({ selected: true });
    expect(getByText('85 %')).toBeTruthy();
    expect(getByText('62,5 %')).toBeTruthy();
    expect(getByText('748 kg')).toBeTruthy();
    expect(getByText('disetujui − terpasang · 18,7 poin')).toBeTruthy();
    expect(getByText('~4 minggu')).toBeTruthy();
    expect(getByText('~2 minggu')).toBeTruthy();
    expect(getByText('pada laju 10,4 poin/minggu')).toBeTruthy();
    expect(getByText(/^Rencana 4\.000 kg/)).toBeTruthy();
    expect(getByText('Belum pernah diminta: Material Beton (zak).')).toBeTruthy();
  });

  it('switches the group with the chips, switches rings off and on, and opens the weekly trend inline', async () => {
    const { findAllByText, getAllByText, getByLabelText, getByText, queryByLabelText } = card();
    await findAllByText('43,8 %');
    fireEvent.press(getByLabelText('Tampilkan cincin Diminta'));
    expect(getByLabelText('Tampilkan cincin Diminta').props.accessibilityState).toEqual({ checked: false });
    expect(queryByLabelText('Tampilkan Proyeksi laju 4 minggu (titik-titik)')).toBeNull();
    fireEvent.press(getByLabelText('Lihat tren mingguan'));
    expect(getByLabelText('Tampilkan Proyeksi laju 4 minggu (titik-titik)')).toBeTruthy();
    expect(getByLabelText('Tampilkan Menurut laporan harian (belum diverifikasi)').props.accessibilityState).toEqual({ checked: false });
    expect(getByText('Sembunyikan tren')).toBeTruthy();
    fireEvent.press(getByLabelText('Semen (zak) → Pengecoran'));
    expect(getByText(/^Rencana 200 zak/)).toBeTruthy();
    // Semen: k1's verified Pengecoran is 0 %, so the hero, the Terpasang row and the diary row all read 0 %.
    expect(getAllByText('0 %').length).toBeGreaterThanOrEqual(2);
  });

  it('says why the numbers are missing before anything is verified, and warns when work outruns approvals', async () => {
    const { findAllByText, getByText, getAllByText } = card({ chain: { ...chain, verified: [] } });
    // Under the hero and in the stock tile.
    expect(await findAllByText('belum ada progres terverifikasi')).toHaveLength(2);
    expect(getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(getByText('belum bisa dihitung')).toBeTruthy();
    expect(getByText('belum ada laju')).toBeTruthy();
    const over = card({ material: { ...material, requests: material.requests.slice(0, 1) } });
    expect(await over.findByText('Pekerjaan melebihi material yang disetujui: terpasang 43,8 %, disetujui 12,5 %.')).toBeTruthy();
  });

  it('keeps going without the diary and says so', async () => {
    const { findByText } = card({ chain: { ...chain, diary: { lines: [], readable: false } } });
    expect(await findByText(/^Laporan harian belum bisa dibaca\. /)).toBeTruthy();
  });

  it('shows a failed read with a retry, and the no-plan case', async () => {
    const boom = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(chain);
    const { findByText, findAllByText, getByLabelText } = card({ loadChain: boom });
    expect(await findByText('Material vs progres gagal dimuat: boom')).toBeTruthy();
    fireEvent.press(getByLabelText('Muat ulang Material vs progres'));
    expect(await findAllByText('43,8 %')).toHaveLength(2);
    const empty = card({ material: { ...material, planned: [] } });
    expect(await empty.findByText('Belum ada rencana material untuk proyek ini.')).toBeTruthy();
    expect(empty.getByText('Diminta tanpa rencana di BoQ terbit: Struktur (kg).')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest workflows/components/analytics/__tests__/MaterialChainCard.test.tsx`
Expected: FAIL — cannot find module `../MaterialChainCard`.

- [ ] **Step 3: Create the card**

Create `workflows/components/analytics/MaterialChainCard.tsx`:

```tsx
// workflows/components/analytics/MaterialChainCard.tsx
// SANO — Material vs progres (spec 2026-09-20 §4): per material group, a
// radial of this week's Diminta / Disetujui / Terpasang / menurut laporan
// harian, the stock, lead and cover in words, and the weekly trend chart on
// demand. Every figure comes from buildMaterialChain; this file only lays it
// out and keeps the switches.
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ChainSupport, DiaryData, MaterialData } from '../../../tools/analytics/data';
import { buildDiaryActivity } from '../../../tools/analytics/diaryActivity';
import { buildMaterialChain, type ChainGroup } from '../../../tools/analytics/materialChain';
import { WAITING_AFTER_DAYS, buildMaterialCoverage, type CoverageGroup } from '../../../tools/analytics/materialCoverage';
import { daysBetween } from '../../../tools/analytics/weekBuckets';
import { WORK_TYPE_LABELS } from '../../../tools/analytics/workType';
import { todayIsoWIB } from '../../../tools/timeWindow';
import { CHART, COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import LineChart, { type Annotation, type Band, type LineSeries } from '../charts/LineChart';
import RadialRings, { type Ring } from '../charts/RadialRings';
import LoadBody from './LoadBody';
import { a, lh, qty, shortLabel } from './analyticsStyles';
import { useLoad } from './useLoad';

interface Props {
  loadMaterial: () => Promise<MaterialData>;
  loadDiary: () => Promise<DiaryData>;
  loadChain: () => Promise<ChainSupport>;
  /** Today as a WIB date; tests pass a fixed one. */
  today?: string;
}

type RingKey = 'requested' | 'approved' | 'verified' | 'diary';
const RING_ITEMS: ReadonlyArray<{ key: RingKey; label: string; color: string; opacity: number }> = [
  { key: 'requested', label: 'Diminta', color: CHART.procurement, opacity: CHART.tintOpacity },
  { key: 'approved', label: 'Disetujui', color: CHART.procurement, opacity: 1 },
  { key: 'verified', label: 'Terpasang (terverifikasi)', color: CHART.installed, opacity: 1 },
  { key: 'diary', label: 'Menurut laporan harian (belum diverifikasi)', color: CHART.diary, opacity: 1 },
];
const LINES_OFF_BY_DEFAULT = ['requested', 'diary'];

const pctText = (v: number | null) => (v === null ? '—' : `${qty(v)} %`);
/** A quantity in the group's unit; kilograms read as tonnes from a thousand. */
export function qtyText(n: number, unit: string): string {
  return unit === 'kg' && Math.abs(n) >= 1000 ? `${qty(n / 1000)} t` : `${qty(n)} ${unit}`;
}

function useSetToggle(initial: string[]) {
  const [set, setSet] = useState<Set<string>>(() => new Set(initial));
  const toggle = useCallback((key: string) => setSet((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; }), []);
  return [set, toggle] as const;
}

export default function MaterialChainCard({ loadMaterial, loadDiary, loadChain, today = todayIsoWIB() }: Props) {
  const loadAll = useCallback(async () => {
    const [material, diary, chain] = await Promise.all([loadMaterial(), loadDiary(), loadChain()]);
    return { material, diary, chain };
  }, [loadMaterial, loadDiary, loadChain]);
  const state = useLoad(loadAll);
  const [selected, setSelected] = useState<string | null>(null);
  const [hiddenRings, toggleRing] = useSetToggle([]);
  const [hiddenLines, toggleLine] = useSetToggle(LINES_OFF_BY_DEFAULT);
  const [expanded, setExpanded] = useState(false);

  const view = useMemo(() => {
    if (state.status !== 'ready') return null;
    const { material, diary, chain } = state.data;
    const activity = buildDiaryActivity({ today, reports: diary.reports, links: diary.links });
    const coverage = buildMaterialCoverage({ ...material, firstMentions: activity.firstMentions, today });
    const chains = buildMaterialChain({ today, planned: material.planned, requests: material.requests, catalog: material.catalog, weights: chain.weights, verifiedLines: chain.verified, diary: chain.diary });
    return { coverage, chains };
  }, [state.status, state.data, today]);
  const group: ChainGroup | null = view ? view.chains.groups.find((g) => g.key === selected) ?? view.chains.groups[0] ?? null : null;
  const cov: CoverageGroup | null = view && group ? view.coverage.groups.find((c) => c.key === group.key) ?? null : null;

  return (
    <LoadBody status={state.status} error={state.error} onRetry={state.reload} label="Material vs progres">
      {view && (
        <View>
          <Text style={a.hint}>Posisi minggu ini, % dari rencana BoQ</Text>
          {view.chains.groups.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {view.chains.groups.map((g) => {
                const on = g.key === group?.key;
                return (
                  <TouchableOpacity key={g.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setSelected(g.key)} accessibilityRole="button" accessibilityLabel={g.chipLabel} accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.chipLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          {!group && <Text style={a.hint}>Belum ada rencana material untuk proyek ini.</Text>}
          {group && <GroupView group={group} cov={cov} today={today} hiddenRings={hiddenRings} toggleRing={toggleRing} hiddenLines={hiddenLines} toggleLine={toggleLine} expanded={expanded} setExpanded={setExpanded} />}
          {view.coverage.groups.some((g) => g.requested === 0 && g.planned > 0) && (
            <Text style={a.note}>{`Belum pernah diminta: ${view.coverage.groups.filter((g) => g.requested === 0 && g.planned > 0).map((g) => `${g.category} (${g.unit})`).join(', ')}.`}</Text>
          )}
          {view.chains.unplannedRequested.length > 0 && <Text style={a.note}>{`Diminta tanpa rencana di BoQ terbit: ${view.chains.unplannedRequested.join(', ')}.`}</Text>}
          <Text style={a.hint}>
            {`${group && !group.diaryReadable ? 'Laporan harian belum bisa dibaca. ' : ''}Diminta dan disetujui dari permintaan material; terpasang dari klaim terverifikasi × rencana material per area; laporan harian: Berjalan 50 · Selesai 100, belum diverifikasi. Permintaan yang ditolak tidak dihitung.`}
          </Text>
        </View>
      )}
    </LoadBody>
  );
}

interface GroupProps {
  group: ChainGroup;
  cov: CoverageGroup | null;
  today: string;
  hiddenRings: ReadonlySet<string>;
  toggleRing: (key: string) => void;
  hiddenLines: ReadonlySet<string>;
  toggleLine: (key: string) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

function GroupView({ group, cov, today, hiddenRings, toggleRing, hiddenLines, toggleLine, expanded, setExpanded }: GroupProps) {
  const { today: t, relation: rel } = group;
  const diaryValue = group.diaryReadable ? t.diary : null;
  const rings: Ring[] = [
    {
      key: 'approved', color: CHART.procurement,
      value: hiddenRings.has('approved') ? 0 : t.approved,
      tint: hiddenRings.has('requested') ? null : { from: t.approved, value: t.requested, opacity: CHART.tintOpacity },
      hidden: hiddenRings.has('approved') && hiddenRings.has('requested'),
    },
    { key: 'verified', color: CHART.installed, value: t.verified, endDot: true, hidden: hiddenRings.has('verified') },
    { key: 'diary', color: CHART.diary, value: diaryValue, hidden: hiddenRings.has('diary') || !group.diaryReadable },
  ];
  const values: Record<RingKey, number | null> = { requested: t.requested, approved: t.approved, verified: t.verified, diary: diaryValue };
  const hero = t.verified === null ? { value: '—', label: 'belum ada progres terverifikasi' } : { value: pctText(t.verified), label: 'terpasang, terverifikasi' };
  const workLower = group.workLabel ? group.workLabel.toLowerCase() : 'pekerjaan';

  const series: LineSeries[] = [
    { key: 'requested', label: 'Diminta', color: CHART.procurement, opacity: CHART.tintOpacity, values: group.requested },
    { key: 'approved', label: 'Disetujui', color: CHART.procurement, values: group.approved, endLabel: true },
    { key: 'verified', label: 'Terpasang (terverifikasi)', color: CHART.installed, values: group.verified, dots: true, endLabel: true },
    { key: 'diary', label: 'Menurut laporan harian (belum diverifikasi)', color: CHART.diary, width: 1.5, values: group.diary },
    { key: 'projected', label: 'Proyeksi laju 4 minggu (titik-titik)', color: CHART.installed, dash: '2 4', values: group.projected },
  ];
  const bands: Band[] = [{ key: 'stock', between: ['approved', 'verified'], color: CHART.procurement, opacity: 0.1, label: 'stok teoretis' }];
  const annotations: Annotation[] = [];
  if (rel.leadWeeks !== null && rel.leadWeekIndex !== null && t.verified !== null) {
    annotations.push({ key: 'lead', kind: 'bracket', level: t.verified, fromIndex: rel.leadWeekIndex, toIndex: group.thisWeekIndex, label: `~${rel.leadWeeks} minggu`, requires: ['approved', 'verified'] });
  }
  if (rel.coverWeeks !== null) {
    annotations.push({ key: 'cover', kind: 'run', level: t.approved, fromIndex: group.thisWeekIndex, toIndex: Math.min(group.weeks.length - 1, group.thisWeekIndex + rel.coverWeeks), label: `cukup ~${rel.coverWeeks} minggu`, color: CHART.procurement, requires: ['approved', 'projected'] });
  }

  return (
    <View>
      <RadialRings
        rings={rings}
        hero={hero}
        accessibilityLabel={`${group.shortName}: diminta ${pctText(t.requested)}, disetujui ${pctText(t.approved)}, terpasang ${pctText(t.verified)}, menurut laporan harian ${pctText(diaryValue)}`}
      />
      <View style={styles.rows}>
        {RING_ITEMS.map((item) => (
          <View key={item.key} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: item.color, opacity: item.opacity }]} />
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowValue}>{pctText(values[item.key])}</Text>
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        {RING_ITEMS.map((item) => {
          const on = !hiddenRings.has(item.key);
          return (
            <TouchableOpacity key={item.key} style={[styles.legendItem, !on && styles.legendOff]} onPress={() => toggleRing(item.key)} accessibilityRole="switch" accessibilityLabel={`Tampilkan cincin ${item.label}`} accessibilityState={{ checked: on }}>
              <View style={styles.swatchWrap}>
                <View style={[styles.swatch, { backgroundColor: item.color, opacity: item.opacity }]} />
                {!on && <View style={styles.strike} />}
              </View>
              <Text style={styles.legendText}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={a.tiles}>
        <View style={a.tile}>
          <Text style={a.tileLabel}>Stok teoretis</Text>
          <Text style={a.tileValue}>{rel.stockQty === null ? '—' : qtyText(rel.stockQty, group.unit)}</Text>
          <Text style={a.tileSub}>{rel.stockPts === null ? rel.stockNote : `disetujui − terpasang · ${qty(rel.stockPts)} poin`}</Text>
        </View>
        <View style={a.tile}>
          <Text style={a.tileLabel}>Jeda material → pekerjaan</Text>
          <Text style={a.tileValue}>{rel.leadWeeks === null ? '—' : `~${rel.leadWeeks} minggu`}</Text>
          <Text style={a.tileSub}>{rel.leadWeeks === null ? rel.leadNote : 'disetujui sebelum terpasang'}</Text>
        </View>
        <View style={a.tile}>
          <Text style={a.tileLabel}>Cukup untuk</Text>
          <Text style={a.tileValue}>{rel.coverWeeks === null ? '—' : rel.coverWeeks > 52 ? '> 52 minggu' : `~${rel.coverWeeks} minggu`}</Text>
          <Text style={a.tileSub}>{rel.coverWeeks === null ? rel.coverNote : `pada laju ${qty(rel.pacePerWeek ?? 0)} poin/minggu`}</Text>
        </View>
      </View>

      {group.warnings.map((w) => <Text key={w} style={a.warn}>{w}</Text>)}
      {cov?.waiting && cov.workType && cov.firstRequest && (
        <Text style={a.warn}>{`Material diminta ${daysBetween(cov.firstRequest, today)} hari lalu, ${WORK_TYPE_LABELS[cov.workType].toLowerCase()} belum muncul di laporan harian (batas ${WAITING_AFTER_DAYS} hari).`}</Text>
      )}

      <TouchableOpacity style={a.ghostBtn} onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'Sembunyikan tren' : 'Lihat tren mingguan'} accessibilityState={{ expanded }}>
        <Text style={a.ghostBtnText}>{expanded ? 'Sembunyikan tren' : 'Lihat tren mingguan'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.trend}>
          <Text style={a.hint}>Kumulatif per minggu, % dari rencana BoQ</Text>
          <LineChart
            labels={group.weeks.map(shortLabel)}
            yMax={100}
            unit="%"
            markerIndex={group.thisWeekIndex}
            series={series}
            bands={bands}
            annotations={annotations}
            hidden={hiddenLines}
            onToggle={toggleLine}
            accessibilityLabel={`Tren ${group.shortName} per minggu: disetujui ${pctText(t.approved)}, terpasang ${pctText(t.verified)}`}
          />
          {group.projectionNote ? <Text style={a.note}>{group.projectionNote}</Text> : null}
        </View>
      )}

      {cov?.workType && cov.firstRequest && cov.lagDays !== null && (
        <Text style={a.hint}>
          {cov.lagDays >= 0
            ? `Diminta pertama ${shortLabel(cov.firstRequest)}; ${WORK_TYPE_LABELS[cov.workType].toLowerCase()} muncul di laporan harian ${cov.lagDays} hari kemudian.`
            : `${WORK_TYPE_LABELS[cov.workType]} sudah berjalan ${-cov.lagDays} hari sebelum permintaan pertama (${shortLabel(cov.firstRequest)}).`}
        </Text>
      )}
      <Text style={a.hint}>{`Rencana ${qty(group.planned)} ${group.unit}${group.workLabel ? ` · ${group.rows} area ${workLower}` : ''}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: SPACE.sm, paddingVertical: SPACE.sm },
  chip: { minHeight: 32, paddingHorizontal: SPACE.md, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, justifyContent: 'center' },
  chipOn: { backgroundColor: COLORS.accentBg, borderColor: COLORS.accentDark },
  chipText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec },
  chipTextOn: { color: COLORS.text },
  rows: { marginTop: SPACE.sm, gap: SPACE.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  rowLabel: { flex: 1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  rowValue: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  swatchWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  strike: { position: 'absolute', width: 14, height: 1, backgroundColor: COLORS.textMuted, transform: [{ rotate: '45deg' }] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, marginTop: SPACE.md, marginBottom: SPACE.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 32 },
  legendOff: { opacity: 0.4 },
  legendText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  trend: { marginTop: SPACE.sm },
});
```

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest workflows/components/analytics/__tests__/MaterialChainCard.test.tsx && npx tsc --noEmit`
Expected: PASS. Values to double-check by hand if one fails: besi plan 4 000; requested 3 400 → 85 %; approved 2 500 → 62,5 %; verified 43,8 %; stock 18,7 points = 748 kg; lead 4 weeks (approved reached 43,8 % in the week of 17 Aug); pace 10,4/week over 3 weeks; cover round(18,7 / 10,4) = 2.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(analytics): Material vs progres card — radial snapshot, relation tiles and the weekly trend" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add workflows/components/analytics/MaterialChainCard.tsx workflows/components/analytics/__tests__/MaterialChainCard.test.tsx
git commit -F /tmp/msg.txt
```

---

### Task 9: Mount the card, retire the meters

**Files:**
- Modify: `workflows/components/analytics/ProjectAnalytics.tsx`
- Modify: `workflows/components/analytics/DiaryActivityCard.tsx` (line 13)
- Delete: `workflows/components/analytics/MaterialCoverageCard.tsx`, `workflows/components/charts/Meter.tsx`
- Test: `workflows/components/analytics/__tests__/ProjectAnalytics.test.tsx`

- [ ] **Step 1: Update the ProjectAnalytics test**

In `workflows/components/analytics/__tests__/ProjectAnalytics.test.tsx`:

1. In the `jest.mock('../../../../tools/analytics/data', …)` factory add `loadChainSupport: jest.fn(),`.
2. Add `loadChainSupport` to the import from `'../../../../tools/analytics/data'`.
3. In `beforeEach` add: `(loadChainSupport as jest.Mock).mockResolvedValue({ diary: { lines: [], readable: true }, weights: [], verified: [] });`
4. In the test "opens every card on a wide screen, sharing one diary read between cards", replace the line `expect(await findByText('310 disetujui (31%) · 310 diminta (31%) · rencana 1.000 kg')).toBeTruthy();` with:

```ts
    expect(await findByText('Besi (kg) → Pembesian')).toBeTruthy();
    expect(getAllByText('31 %').length).toBeGreaterThanOrEqual(2);
    expect(getAllByText('belum ada progres terverifikasi').length).toBeGreaterThanOrEqual(1);
    expect(getByText(/^Rencana 1\.000 kg/)).toBeTruthy();
    expect(loadChainSupport).toHaveBeenCalledWith('p1');
```

and destructure `getAllByText` from the render result on that test's `const { findByText, getByText } = block(true);` line. The requests fixture in that test has no `reviewed_at`; add `reviewed_at: null` to it. In the first ProjectAnalytics test add, after `expect(loadMaterialData).not.toHaveBeenCalled();`, the line `expect(loadChainSupport).not.toHaveBeenCalled();`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest workflows/components/analytics/__tests__/ProjectAnalytics.test.tsx`
Expected: FAIL — the chip text is not found (the old card is still mounted).

- [ ] **Step 3: Wire the card and delete the old files**

In `workflows/components/analytics/ProjectAnalytics.tsx`:

- import line 10 becomes `import { loadApprovalData, loadChainSupport, loadDiaryData, loadMaterialData, loadProgressEntries } from '../../../tools/analytics/data';`
- replace `import MaterialCoverageCard from './MaterialCoverageCard';` with `import MaterialChainCard from './MaterialChainCard';`
- after `const loadHeaders = …` add `const loadChain = useCallback(shared('chain', loadChainSupport), [shared]);`
- replace `{s.key === 'material' && <MaterialCoverageCard loadMaterial={loadMaterial} loadDiary={loadDiary} />}` with `{s.key === 'material' && <MaterialChainCard loadMaterial={loadMaterial} loadDiary={loadDiary} loadChain={loadChain} />}`

In `workflows/components/analytics/DiaryActivityCard.tsx` line 13: `import type { DiaryData } from '../../../tools/analytics/data';`

Then:

```bash
git rm -q workflows/components/analytics/MaterialCoverageCard.tsx workflows/components/charts/Meter.tsx
grep -rn "MaterialCoverageCard\|charts/Meter" workflows office tools --include='*.ts' --include='*.tsx'
```

Expected: the grep prints nothing.

- [ ] **Step 4: Run the analytics tests and the type check**

Run: `npx jest workflows/components/analytics tools/__tests__/analyticsModules.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(analytics): Material vs Progres on every Beranda is the chain card; meters retired" "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/msg.txt
git add -A workflows/components/analytics workflows/components/charts
git commit -F /tmp/msg.txt
```

---

### Task 10: Full verification and hand-off

**Files:** none new.

- [ ] **Step 1: Type check, full jest, web export**

```bash
npx tsc --noEmit
npx jest 2>&1 | tail -30
git restore assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx
npx expo export --platform web 2>&1 | tail -5
```

Expected: no type errors; every suite green except the two pre-existing `.env`-dependent suites (`materialAliasesRls`, `publishBreakdownTrial`) when the worktree has no `.env`; the export ends with the bundle summary and no "Unable to resolve" line. `git status` must not list the workbook or `dist/` (dist is ignored).

- [ ] **Step 2: Look at it**

Start the web app (`npx expo start --web` or the existing launch config), sign in as an office user, open Home → Analitik Proyek → Material vs Progres on Bukit Darmo: three rings, the chips, the tiles, "Lihat tren mingguan" opening the chart with the ribbon. Check a phone width (360px) for overflow. Fix anything that looks wrong before the final commit; compare with `docs/superpowers/specs/2026-09-20-material-vs-progress-chart-mockup.html`.

- [ ] **Step 3: OTA-safety check (for the later phone update)**

```bash
git diff b7ed876 -- package.json | grep -E '^[+-] +"' || echo "no dependency change"
```

Expected: only the earlier `jest` moduleNameMapper line (no dependency added, removed or changed).

- [ ] **Step 4: Stop and report**

Do not push or open a pull request unless the owner asks. Report: the commits on `feat/material-progress-chart`, the test counts, what the live check showed, and that the phone update (`eas update --branch preview` from main after merge) and the web deploy (automatic from main) are the remaining steps.
