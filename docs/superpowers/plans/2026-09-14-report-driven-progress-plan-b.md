# Report-Driven Progress — Plan B1 (Weekly stage claim and verification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The supervisor's Tambah progres records a percent per construction stage for each work area into a weekly claim; an estimator verifies it; only then does verified progress reach `boq_items` and the project's overall percentage, with stage weights derived from real RABs and adjustable per row.

**Architecture:** Pure TypeScript modules under `tools/progressClaims/` classify work areas, hold the reference weight profile generated from five RAB workbooks, compute row completion and validate input. Migration 103 stores weights per BoQ row (seeded from a class, edited by estimators); migration 104 adds claims and claim lines with read policies only and five SECURITY DEFINER RPCs, where `verify_progress_claim` is the single writer of progress and records each change as the difference from existing `progress_entries` (negative for a correction). Screens: the Progres tab's claim panel with an inline stage form, the office verification panel, Bobot Tahapan in Baseline, and a principal status card.

**Tech Stack:** Expo SDK 54 / React Native, TypeScript, Supabase Postgres (RLS, PL/pgSQL RPCs), jest (ts-jest) with @testing-library/react-native, a Docker `supabase/postgres` rehearsal harness, xlsx (Node-only derivation script).

**Spec:** `docs/superpowers/specs/2026-09-13-report-driven-progress-design.md` §5.3-5.5, §6.2-6.3, §7, §11, §16, §17, and §18 (Plan B1 as built, which wins where it differs). Plan A (`2026-09-13-report-driven-progress-plan-a.md`) must be merged first: it created `tools/progressClaims/stages.ts`, `progress_ai_runs` and migration 102.

**Out of scope (Plan B2):** the AI `prefill` stage, weight columns on the SANO Input sheet, weights derived from AHS lines, and the ClientReportBuilderScreen split. **Plan C:** evidence cross-check flags.

**Migrations:** 103 (stage weights) and 104 (claims, notifications). Paste order after 102: 103, then 104. Re-pasting 098, 059 or 002 later undoes part of 104; re-paste 104 afterwards (its header and self-checks say which part).

**Reviews:** two independent reviews (database layer, UI and wiring) followed the first build; every confirmed finding is fixed in the code below (commits 39f8497..3d4c5c3) and pinned by tests or rehearsal checks.

**Worktree / branch:** `feat/report-driven-progress`. Inside a worktree `package.json`'s `testPathIgnorePatterns` matches the worktree path, so ALWAYS run jest as `npx jest <paths> --testPathIgnorePatterns='/node_modules/'`.

---

## File map

| File | Responsibility |
|---|---|
| `tools/boqWorkGroups.ts` (modify) | Export `extractFloorContext` and `floorRank`. |
| `tools/progressClaims/workAreaClass.ts` | Work-area class per row, basement-first ground rule. |
| `tools/progressClaims/stageWeights.ts` | Weight shapes, validation, reference lookup. |
| `tools/progressClaims/stageMath.ts` | Row fraction (normalized) and claim delta preview. |
| `tools/progressClaims/referenceStageWeights.ts`, `loadReferenceWorkbooks.ts`, `deriveReferenceWeights.ts`, `referenceStageWeights.data.ts` | Reference profile from five RABs; Node-only loader and script; generated data. |
| `tools/progressClaims/week.ts` | WIB Monday and week label. |
| `tools/progressClaims/claimRules.ts` | Roles, states, percent validation, refusal copy. |
| `tools/progressClaims/claimView.ts` | Pure view model for the claim screens. |
| `tools/progressClaims/claims.ts` | Reads through RLS, writes through the 103/104 RPCs. |
| `tools/notificationRouting.ts` (modify) | Claim deeplinks per role. |
| `supabase/migrations/103_boq_stage_weights.sql` | `boq_stage_weights`, actor check, seed/set/reset RPCs. |
| `supabase/migrations/104_progress_claims.sql` | Claims, lines, five RPCs, verified-row shape lock, notification types, read views, single writer of progress. |
| `supabase/tests/progress_claims_rehearsal/` | Docker rehearsal: fixture, 117 checks, `run.sh`. |
| `workflows/components/StoragePhoto.tsx` | Read-only photo (same file as the photo-fix branch). |
| `workflows/screens/progressClaim/StageClaimForm.tsx` | Inline stage form for one row. |
| `workflows/screens/progressClaim/ProgressClaimPanel.tsx` | Weekly claim panel (Progres, Laporan). |
| `office/screens/progressClaim/ProgressClaimVerifyPanel.tsx` | Estimator verification; principal read-only. |
| `workflows/screens/progressClaim/StageWeightsPanel.tsx` | Bobot Tahapan (Baseline). |
| `workflows/screens/progressClaim/ProgressClaimStatusCard.tsx` | Principal home card. |
| `workflows/screens/ProgresScreen.tsx`, `LaporanScreen.tsx`, `BaselineScreen.tsx`, `workflows/navigation.tsx` (modify) | Supervisor and Baseline entry points. |
| `office/screens/OfficeReportsScreen.tsx`, `PrincipalHomeScreen.tsx`, `NotificationsScreen.tsx`, `office/navigation.tsx`, `office/PrincipalNavigation.tsx`, `workflows/screens/components/NotificationList.tsx` (modify) | Office entry points and notifications. |
| `tools/derivation.ts`, `tools/progressMath.ts`, `tools/audit.ts` (modify) | One writer of installed; audit reads claim activity. |

---


---

### Task 1: Export the floor helpers from the work-group classifier

**Files:**
- Modify: `tools/boqWorkGroups.ts`
- Test: `tools/__tests__/boqWorkGroups.floor.test.ts`

The work-area classifier must read floors exactly as the work-group classifier does, so the two never disagree about "Lantai 1" or "Basement". Export the two existing functions; do not copy them.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/boqWorkGroups.floor.test.ts` (new file):

```ts
// tools/__tests__/boqWorkGroups.floor.test.ts
import { extractFloorContext, floorRank } from '../boqWorkGroups';

describe('extractFloorContext and floorRank (shared with the work-area classifier)', () => {
  it.each([
    ['Lt. Basement', 'Basement', -2],
    ['PEKERJAAN FISIK LANTAI BASEMENT', 'Basement', -2],
    ['Lantai Dasar', 'Lantai Dasar', -1],
    ['Lantai 1', 'Lantai 1', 1],
    ['PEKERJAAN FISIK LANTAI 2', 'Lantai 2', 2],
    ['Lantai Atap', 'Dak / Atap', 90],
    ['Umum', null, 0],
    ['Kolam Renang', null, 0],
  ])('%s → %s (rank %d)', (raw, floor, rank) => {
    expect(extractFloorContext(raw)).toBe(floor);
    expect(floorRank(extractFloorContext(raw))).toBe(rank);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/boqWorkGroups.floor.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Module '"../boqWorkGroups"' has no exported member 'extractFloorContext'`.

- [ ] **Step 3: Write the implementation**

`tools/boqWorkGroups.ts` (apply this change):

```diff
diff --git a/tools/boqWorkGroups.ts b/tools/boqWorkGroups.ts
index e217cf4..a2c6f3b 100644
--- a/tools/boqWorkGroups.ts
+++ b/tools/boqWorkGroups.ts
@@ -75,7 +75,7 @@ function formatFloorToken(token: string): string {
   return cleaned.toUpperCase();
 }
 
-function extractFloorContext(raw: string | null | undefined): string | null {
+export function extractFloorContext(raw: string | null | undefined): string | null {
   const compact = (raw ?? '').replace(/\s+/g, ' ').trim();
   if (!compact) return null;
   if (/\bsemi\s*basement\b/i.test(compact)) return 'Semi Basement';
@@ -95,7 +95,7 @@ function extractFloor(item: ClassifyInput): string | null {
 }
 
 // Floor ordering for stable group sort (basement < dasar < numbered < atap).
-function floorRank(floor: string | null): number {
+export function floorRank(floor: string | null): number {
   if (!floor) return 0;
   if (/semi\s*basement/i.test(floor)) return -3;
   if (/basement/i.test(floor)) return -2;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/boqWorkGroups.floor.test.ts tools/__tests__/envelopes.workgroup.test.ts tools/__tests__/workGroupDemand.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 3 suites, 30 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/boqWorkGroups.ts tools/__tests__/boqWorkGroups.floor.test.ts
git commit -m "refactor(boq): export floor helpers for the work-area classifier"
```

---

### Task 2: Work-area class (element × floor, basement-first)

**Files:**
- Create: `tools/progressClaims/workAreaClass.ts`
- Test: `tools/__tests__/progressClaimsWorkAreaClass.test.ts`

Order inside `elementOf` is the rule: the first element named wins, so "Pile Cap, Sloof, Plat" is a pile-cap row and "Balok, Plat Lantai, Dinding Beton" is a wall row (Bukit Darmo T1-021, kolam renang). Ground is decided across all rows of a project: with a basement, Lantai 1 is a suspended slab (spec §17). The estimator can override any row in Bobot Tahapan (Task 18).

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsWorkAreaClass.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsWorkAreaClass.test.ts
import { classifyWorkAreas, elementOf, groundRank, isGroundFloor, splitWorkArea } from '../progressClaims/workAreaClass';

describe('elementOf', () => {
  it.each([
    ['Pile Cap, Sloof, Plat Lantai', 'PILECAP'],
    ['Sloof S1', 'SLOOF'],
    ['Kolom Balok Praktis', 'KOLOM'],
    ['Balok, Plat Lantai', 'BALOK'],
    ['Plat Lantai', 'PLAT'],
    ['Dinding Beton', 'DINDING'],
    ['Retaining Wall Belakang', 'DINDING'],
    ['Balok, Plat Lantai, Dinding Beton', 'DINDING'],
    ['Tangga', 'TANGGA'],
    ['Boredpile', 'BOREDPILE'],
    ['Strauss pile dia. 30', 'BOREDPILE'],
    ['Lantai kerja t=5cm', 'LANTAI_KERJA'],
    ['Balok, Plat Lantai, Janggutan, Tanggulan', 'BALOK'],
    ['Planter Box', null],
    ['', null],
  ])('%s → %s', (text, kind) => {
    expect(elementOf(text)).toBe(kind);
  });
});

describe('splitWorkArea', () => {
  it('prefers the published chapter and sub_chapter', () => {
    expect(splitWorkArea({ label: 'x ; y', chapter: 'Lantai 2', sub_chapter: 'Kolom' })).toEqual({ floor: 'Lantai 2', element: 'Kolom' });
  });

  it('falls back to the two halves of "<lantai> ; <elemen>"', () => {
    expect(splitWorkArea({ label: 'Lt. Basement ; Tandon Air Bawah' })).toEqual({ floor: 'Lt. Basement', element: 'Tandon Air Bawah' });
  });

  it('treats a label without a separator as the element', () => {
    expect(splitWorkArea({ label: '- Balok B24-1' })).toEqual({ floor: '', element: '- Balok B24-1' });
  });
});

describe('ground floor, basement-first', () => {
  it('Lantai 1 is ground when no basement is named', () => {
    expect(groundRank(['Umum', 'Lantai 1', 'Lantai 2', 'Lantai Atap'])).toBe(1);
  });

  it('a basement makes Lantai 1 a suspended floor', () => {
    const ground = groundRank(['Lt. Basement', 'Lantai 1', 'Kolam Renang']);
    expect(ground).toBe(-2);
    expect(isGroundFloor('Lt. Basement', ground)).toBe(true);
    expect(isGroundFloor('Lantai 1', ground)).toBe(false);
  });

  it('a foundation chapter is always ground, and only upper floors named means no ground at all', () => {
    expect(isGroundFloor('PEKERJAAN TANAH DAN PONDASI', null)).toBe(true);
    expect(groundRank(['Lantai 2', 'Lantai 3'])).toBeNull();
  });
});

describe('classifyWorkAreas', () => {
  const rows = (pairs: Array<[string, string]>) =>
    pairs.map(([chapter, sub]) => ({ label: `${chapter} ; ${sub}`, chapter, sub_chapter: sub }));

  it('classifies the Citraland K2-7 work areas', () => {
    expect(classifyWorkAreas(rows([
      ['Umum', 'Kolom Balok Praktis'],
      ['Lantai 1', 'Pile Cap, Sloof, Plat Lantai'],
      ['Lantai 1', 'Kolom'],
      ['Lantai 1', 'Dinding Beton'],
      ['Lantai 1', 'Tangga'],
      ['Lantai 1', 'Boredpile'],
      ['Lantai 2', 'Balok, Plat Lantai'],
      ['Lantai Atap', 'Kolom'],
    ]))).toEqual(['KOLOM', 'PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'DINDING', 'TANGGA', 'BOREDPILE', 'BALOK_PLAT', 'KOLOM']);
  });

  it('puts a basement slab in the ground class, a Lantai 1 slab above it in balok & plat, and an unknown element in lainnya', () => {
    expect(classifyWorkAreas(rows([
      ['Lt. Basement', 'Plat Lantai'],
      ['Lantai 1', 'Plat Lantai'],
      ['Lantai 2', 'Planter Box'],
    ]))).toEqual(['PILECAP_SLOOF_PLAT_DASAR', 'BALOK_PLAT', 'LAINNYA']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsWorkAreaClass.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/workAreaClass'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/workAreaClass.ts` (new file):

```ts
// tools/progressClaims/workAreaClass.ts
// SANO — which element class a work-area row belongs to, so the right stage
// weights apply (spec §7.3, §17). Pure.
//
// A SANO Input row is labelled "<lantai> ; <elemen>" (and published with
// chapter = lantai, sub_chapter = elemen); a full-RAB row has a chapter title,
// a section and its own label. Floors come from tools/boqWorkGroups.ts so the
// two classifiers never disagree about what "Lantai 1" or "Basement" is.
import { extractFloorContext, floorRank } from '../boqWorkGroups';

export const WORK_AREA_CLASSES = [
  'PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING', 'TANGGA', 'BOREDPILE', 'LAINNYA',
] as const;
export type WorkAreaClass = (typeof WORK_AREA_CLASSES)[number];

export type ElementKind =
  | 'LANTAI_KERJA' | 'BOREDPILE' | 'PILECAP' | 'SLOOF' | 'TANGGA' | 'DINDING' | 'KOLOM' | 'BALOK' | 'PLAT';

/** The element a label fragment names. Order matters: the first match wins ("Pile Cap, Sloof, Plat" is a pile cap row). */
export function elementOf(text: string | null | undefined): ElementKind | null {
  const t = (text ?? '').toLowerCase();
  if (!t) return null;
  if (/lantai kerja|lean concrete/.test(t)) return 'LANTAI_KERJA';
  if (/bored?\s*pile|boredpile|tiang bor|strauss|mini\s*pile|spun\s*pile|tiang pancang/.test(t)) return 'BOREDPILE';
  if (/pile\s*cap|pilecap|\bpoer\b|\bpc[.\s-]?\d|pondasi|foot\s*plate|\btapak\b/.test(t)) return 'PILECAP';
  if (/sloof|tie\s*beam|\bs\d/.test(t)) return 'SLOOF';
  if (/tangga|bordes|\bstair/.test(t)) return 'TANGGA';
  if (/dinding|retaining|\bwall\b|\bgwt\b|ground\s*water|pit\s*lift|kolam|\bsw\d/.test(t)) return 'DINDING';
  if (/kolom|column|\bk\d/.test(t)) return 'KOLOM';
  if (/balok|\bbeam\b|ring\s*balk|\bb\d/.test(t)) return 'BALOK';
  if (/\bplat\b|pelat|\bslab\b|\bdak\b/.test(t)) return 'PLAT';
  return null;
}

export interface WorkAreaRow {
  label: string;
  chapter?: string | null;
  sub_chapter?: string | null;
}

/** Floor and element text of a row: chapter/sub_chapter when published, else the two halves of "<lantai> ; <elemen>". */
export function splitWorkArea(row: WorkAreaRow): { floor: string; element: string } {
  const parts = row.label.split(';');
  const labelFloor = parts.length > 1 ? parts[0].trim() : '';
  const labelElement = parts.length > 1 ? parts.slice(1).join(';').trim() : row.label.trim();
  return {
    floor: (row.chapter ?? '').trim() || labelFloor,
    element: (row.sub_chapter ?? '').trim() || labelElement,
  };
}

const FOUNDATION_RE = /pondasi|sub\s*struktur/i;
/** A floor ranked above Lantai 1 is never "ground", even when it is the lowest one named. */
const GROUND_MAX_RANK = 1;

/**
 * Basement-first ground rule (spec §17): among the floors the rows name, the
 * lowest-ranked one is ground — so with a basement, "Lantai 1" is a suspended
 * slab. Returns null when no row names a floor at or below Lantai 1.
 */
export function groundRank(floors: Array<string | null | undefined>): number | null {
  const ranks = floors
    .map((f) => extractFloorContext(f))
    .filter((f): f is string => f !== null)
    .map((f) => floorRank(f));
  if (ranks.length === 0) return null;
  const lowest = Math.min(...ranks);
  return lowest <= GROUND_MAX_RANK ? lowest : null;
}

export function isGroundFloor(floor: string, ground: number | null): boolean {
  if (FOUNDATION_RE.test(floor)) return true;
  const ctx = extractFloorContext(floor);
  return ctx !== null && ground !== null && floorRank(ctx) === ground;
}

/** Classify every row of one project (or one RAB sheet): ground is decided across all of them. */
export function classifyWorkAreas(rows: WorkAreaRow[]): WorkAreaClass[] {
  const split = rows.map(splitWorkArea);
  const ground = groundRank(split.map((s) => s.floor));
  return rows.map((row, i) => {
    const { floor, element } = split[i];
    const kind = elementOf(element) ?? elementOf(row.label) ?? elementOf(floor);
    switch (kind) {
      case 'PILECAP':
      case 'SLOOF':
        return 'PILECAP_SLOOF_PLAT_DASAR';
      case 'PLAT':
        return isGroundFloor(floor, ground) ? 'PILECAP_SLOOF_PLAT_DASAR' : 'BALOK_PLAT';
      case 'BALOK':
        return 'BALOK_PLAT';
      case 'KOLOM':
        return 'KOLOM';
      case 'DINDING':
        return 'DINDING';
      case 'TANGGA':
        return 'TANGGA';
      case 'BOREDPILE':
        return 'BOREDPILE';
      default:
        return 'LAINNYA';
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsWorkAreaClass.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/workAreaClass.ts tools/__tests__/progressClaimsWorkAreaClass.test.ts
git commit -m "feat(progress): classify work-area rows into stage-weight classes (basement-first ground)"
```

---

### Task 3: Stage weights (shapes, validation, reference lookup)

**Files:**
- Create: `tools/progressClaims/stageWeights.ts`
- Test: `tools/__tests__/progressClaimsStageWeights.test.ts`

A row either splits across bekisting, pembesian and pengecoran (fractions summing to 1 ± 0.001) or is `{"SINGLE": 1}`. `referenceWeightsFor` takes the profile as a parameter so this module never imports the generated data file. Migration 103 `stage_weights_valid` repeats the same rule; its static test pins the tolerance.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsStageWeights.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsStageWeights.test.ts
import {
  SINGLE_WEIGHTS, isSingle, referenceWeightsFor, stagesOf, validateStageWeights, weightOf, weightsFromAmounts,
  type ReferenceProfile,
} from '../progressClaims/stageWeights';

describe('validateStageWeights', () => {
  it('accepts SINGLE and a three-stage split summing to 1', () => {
    expect(validateStageWeights({ SINGLE: 1 })).toEqual({ ok: true, weights: { SINGLE: 1 } });
    expect(validateStageWeights({ BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 }).ok).toBe(true);
    expect(validateStageWeights({ BEKISTING: 0.3334, PEMBESIAN: 0.3333, PENGECORAN: 0.3333 }).ok).toBe(true);
  });

  it.each([
    [null],
    [[0.5, 0.5]],
    [{ SINGLE: 0.9 }],
    [{ BEKISTING: 0.5, PEMBESIAN: 0.5 }],
    [{ BEKISTING: 0.5, PEMBESIAN: 0.3, PENGECORAN: 0.3 }],
    [{ BEKISTING: -0.1, PEMBESIAN: 0.6, PENGECORAN: 0.5 }],
    [{ BEKISTING: 0.4, PEMBESIAN: 0.4, PENGECORAN: 0.2, SINGLE: 1 }],
    [{ BEKISTING: '0.4', PEMBESIAN: 0.4, PENGECORAN: 0.2 }],
  ])('refuses %j', (raw) => {
    expect(validateStageWeights(raw).ok).toBe(false);
  });
});

describe('weightsFromAmounts', () => {
  it('turns Rupiah subtotals into fractions that sum to 1 (spec §7.1 worked example, Citraland Balok lt 2)', () => {
    expect(weightsFromAmounts({ BEKISTING: 5_235_945, PEMBESIAN: 3_205_034, PENGECORAN: 1_299_533 }))
      .toEqual({ BEKISTING: 0.538, PEMBESIAN: 0.329, PENGECORAN: 0.133 });
  });

  it('accepts percents and refuses all-zero or negative input', () => {
    expect(weightsFromAmounts({ BEKISTING: 37, PEMBESIAN: 38, PENGECORAN: 25 })).toEqual({ BEKISTING: 0.37, PEMBESIAN: 0.38, PENGECORAN: 0.25 });
    expect(weightsFromAmounts({ BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 })).toBeNull();
    expect(weightsFromAmounts({ BEKISTING: -1, PEMBESIAN: 1, PENGECORAN: 1 })).toBeNull();
  });
});

describe('shape helpers', () => {
  const split = { BEKISTING: 0.2, PEMBESIAN: 0.5, PENGECORAN: 0.3 };

  it('lists stages and reads weights for both shapes', () => {
    expect(isSingle(SINGLE_WEIGHTS)).toBe(true);
    expect(isSingle(split)).toBe(false);
    expect(stagesOf(SINGLE_WEIGHTS)).toEqual(['SINGLE']);
    expect(stagesOf(split)).toEqual(['BEKISTING', 'PEMBESIAN', 'PENGECORAN']);
    expect(weightOf(split, 'PEMBESIAN')).toBe(0.5);
    expect(weightOf(split, 'SINGLE')).toBe(0);
    expect(weightOf(SINGLE_WEIGHTS, 'SINGLE')).toBe(1);
    expect(weightOf(SINGLE_WEIGHTS, 'BEKISTING')).toBe(0);
  });

  it('uses the profile for a stage-priced class and SINGLE for every other class', () => {
    const profile: ReferenceProfile = {
      KOLOM: { weights: { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 }, workbooks: 5, rows: 208, volume_m3: 313 },
    };
    expect(referenceWeightsFor('KOLOM', profile)).toEqual({ BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 });
    expect(referenceWeightsFor('TANGGA', profile)).toEqual({ SINGLE: 1 });
    expect(referenceWeightsFor('LAINNYA', profile)).toEqual({ SINGLE: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsStageWeights.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/stageWeights'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/stageWeights.ts` (new file):

```ts
// tools/progressClaims/stageWeights.ts
// SANO — stage weights of a work-area row (spec §5.3, §7, §17). Pure.
//
// A row either splits its value across the three weight-bearing stages
// (bekisting, pembesian, pengecoran; fractions summing to 1) or carries the
// single stage {"SINGLE": 1} because its BoQ price is not split by stage
// (tangga, piles, lainnya). Weights are never guessed: each stored row records
// its source, and the reference profile is generated from real RABs.
import { WEIGHT_BEARING_STAGES, type WeightBearingStage } from '../reportLineDraftValidate';
import type { WorkAreaClass } from './workAreaClass';

export type StageKey = WeightBearingStage | 'SINGLE';
export type SplitWeights = Record<WeightBearingStage, number>;
export type StageWeights = { SINGLE: 1 } | SplitWeights;
export type WeightSource = 'rab' | 'input_sheet' | 'reference' | 'manual';

export const SINGLE_WEIGHTS: StageWeights = { SINGLE: 1 };
export const WEIGHT_SUM_TOLERANCE = 0.001;

export interface ReferenceEntry {
  weights: SplitWeights;
  workbooks: number;
  rows: number;
  volume_m3: number;
}
export type ReferenceProfile = Partial<Record<WorkAreaClass, ReferenceEntry>>;

export function isSingle(w: StageWeights): w is { SINGLE: 1 } {
  return Object.prototype.hasOwnProperty.call(w, 'SINGLE');
}

export function stagesOf(w: StageWeights): StageKey[] {
  return isSingle(w) ? ['SINGLE'] : [...WEIGHT_BEARING_STAGES];
}

export function weightOf(w: StageWeights, stage: StageKey): number {
  if (isSingle(w)) return stage === 'SINGLE' ? 1 : 0;
  return stage === 'SINGLE' ? 0 : w[stage];
}

/**
 * Three non-negative amounts (Rupiah subtotals or percents) → fractions rounded
 * to 3 decimals, the rounding remainder landing on pengecoran so they sum to 1.
 * Null when an amount is invalid or all are zero.
 */
export function weightsFromAmounts(amounts: SplitWeights): SplitWeights | null {
  const values = WEIGHT_BEARING_STAGES.map((s) => amounts[s]);
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const bekisting = Math.round((amounts.BEKISTING / total) * 1000) / 1000;
  const pembesian = Math.round((amounts.PEMBESIAN / total) * 1000) / 1000;
  const pengecoran = Math.max(0, Math.round((1 - bekisting - pembesian) * 1000) / 1000);
  return { BEKISTING: bekisting, PEMBESIAN: pembesian, PENGECORAN: pengecoran };
}

export type WeightValidation = { ok: true; weights: StageWeights } | { ok: false; reason: string };

/** The only accepted shapes are {"SINGLE": 1} or exactly the three stages, each 0..1, summing to 1 ± 0.001. */
export function validateStageWeights(raw: unknown): WeightValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'bobot harus berupa objek' };
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length === 1 && keys[0] === 'SINGLE') {
    return r.SINGLE === 1 ? { ok: true, weights: { SINGLE: 1 } } : { ok: false, reason: 'SINGLE harus bernilai 1' };
  }
  if (keys.length !== WEIGHT_BEARING_STAGES.length || !WEIGHT_BEARING_STAGES.every((s) => keys.includes(s))) {
    return { ok: false, reason: 'bobot harus berisi tepat BEKISTING, PEMBESIAN dan PENGECORAN' };
  }
  const values = WEIGHT_BEARING_STAGES.map((s) => r[s]);
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) {
    return { ok: false, reason: 'setiap bobot harus angka antara 0 dan 1' };
  }
  const sum = (values as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) return { ok: false, reason: `jumlah bobot ${sum.toFixed(3)}, harus 1` };
  return { ok: true, weights: { BEKISTING: r.BEKISTING as number, PEMBESIAN: r.PEMBESIAN as number, PENGECORAN: r.PENGECORAN as number } };
}

/** Spec §7.3: a class the RABs price by stage gets its profile weights; every other class is SINGLE. */
export function referenceWeightsFor(cls: WorkAreaClass, profile: ReferenceProfile): StageWeights {
  return profile[cls]?.weights ?? SINGLE_WEIGHTS;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsStageWeights.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/stageWeights.ts tools/__tests__/progressClaimsStageWeights.test.ts
git commit -m "feat(progress): stage-weight shapes, validation and reference lookup"
```

---

### Task 4: Stage math (row completion and claim delta)

**Files:**
- Create: `tools/progressClaims/stageMath.ts`
- Test: `tools/__tests__/progressClaimsStageMath.test.ts`

This is the client-side preview. `rowFraction` divides by the weights' own sum, so weights of 0.333 × 3 still reach 1 when every stage is complete (spec §18). Migration 104 `stage_row_fraction` computes the same number, and the rehearsal (Task 12) checks the same cases in SQL. `deltaFromInstalled` previews what verification writes: the difference from the entry totals of the row, so a weight or planned-volume change since the last verification shows up before anyone presses Verifikasi.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsStageMath.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsStageMath.test.ts
import { clampPct, claimDelta, deltaFromInstalled, rowFraction, workStatusFor } from '../progressClaims/stageMath';

const split = { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 };

describe('clampPct', () => {
  it('clamps to 0..100 with one decimal and refuses non-numbers', () => {
    expect(clampPct(42.26)).toBe(42.3);
    expect(clampPct(140)).toBe(100);
    expect(clampPct(-3)).toBe(0);
    expect(clampPct('40')).toBeNull();
    expect(clampPct(Number.NaN)).toBeNull();
  });
});

describe('rowFraction', () => {
  it('weights each stage percent and counts a missing stage as zero', () => {
    expect(rowFraction(split, { BEKISTING: 100, PEMBESIAN: 50 })).toBe(0.558);
    expect(rowFraction(split, {})).toBe(0);
    expect(rowFraction(split, { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 })).toBe(1);
  });

  it('uses the single percent for a SINGLE row and ignores stage keys on it', () => {
    expect(rowFraction({ SINGLE: 1 }, { SINGLE: 40, BEKISTING: 100 })).toBe(0.4);
  });

  it('clamps out-of-range percents', () => {
    expect(rowFraction(split, { BEKISTING: 150, PEMBESIAN: -5 })).toBe(0.368);
  });
});

describe('claimDelta', () => {
  it('adds planned × the fraction gained', () => {
    expect(claimDelta(216.25, 0.2, 0.558)).toEqual({
      deltaQuantity: 77.4175, installedAfter: 120.6675, progressAfter: 55.8, regression: false, unchanged: false,
    });
  });

  it('flags a regression and an unchanged row', () => {
    expect(claimDelta(10, 0.5, 0.4)).toMatchObject({ deltaQuantity: -1, installedAfter: 4, progressAfter: 40, regression: true, unchanged: false });
    expect(claimDelta(10, 0.5, 0.5)).toMatchObject({ deltaQuantity: 0, regression: false, unchanged: true });
  });
});

describe('workStatusFor', () => {
  it('is COMPLETE only at 100%', () => {
    expect(workStatusFor(1)).toBe('COMPLETE');
    expect(workStatusFor(0.999)).toBe('IN_PROGRESS');
  });
});

describe('rowFraction normalization', () => {
  it('reaches 1 when every stage is complete even if the weights sum to 0.999', () => {
    expect(rowFraction({ BEKISTING: 0.333, PEMBESIAN: 0.333, PENGECORAN: 0.333 }, { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 100 })).toBe(1);
  });
});

describe('deltaFromInstalled', () => {
  it('writes the difference from what the entries already sum to', () => {
    expect(deltaFromInstalled(100, 32.6, 0.6176)).toMatchObject({ installedAfter: 61.76, deltaQuantity: 29.16, regression: false });
    expect(deltaFromInstalled(100, 52.04, 0.4)).toMatchObject({ installedAfter: 40, deltaQuantity: -12.04, regression: true });
    expect(deltaFromInstalled(10, 0, 0.5)).toMatchObject({ installedAfter: 5, deltaQuantity: 5, progressAfter: 50, unchanged: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsStageMath.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/stageMath'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/stageMath.ts` (new file):

```ts
// tools/progressClaims/stageMath.ts
// SANO — a work-area row's completion from its stage percents, and the
// quantity a verified claim adds (spec §6.2 step 5, §7.5). Pure. The verify
// RPC recomputes the same numbers server-side; this module is the preview.
import { stagesOf, weightOf, type StageKey, type StageWeights } from './stageWeights';

export type StagePct = Partial<Record<StageKey, number>>;

/** Percent input → 0..100 with one decimal; null when not a finite number. */
export function clampPct(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/**
 * Row completion as a fraction 0..1: Σ weight × percent / 100 over the weights' own stages, divided by the
 * weights' sum so weights that sum to 0.999 still reach 1 when every stage is complete. A missing percent
 * counts as 0. Migration 104 stage_row_fraction() computes the same number.
 */
export function rowFraction(weights: StageWeights, pct: StagePct): number {
  const stages = stagesOf(weights);
  const total = stages.reduce((acc, stage) => acc + weightOf(weights, stage), 0);
  if (total <= 0) return 0;
  const weighted = stages.reduce((acc, stage) => acc + weightOf(weights, stage) * ((clampPct(pct[stage]) ?? 0) / 100), 0);
  return Math.round(Math.min(1, Math.max(0, weighted / total)) * 1e6) / 1e6;
}

export interface ClaimDelta {
  /** planned × (new − previous) fraction, 4 decimals; negative for a regression. */
  deltaQuantity: number;
  installedAfter: number;
  /** 0..100, one decimal — what boq_items.progress becomes. */
  progressAfter: number;
  regression: boolean;
  unchanged: boolean;
}

export function claimDelta(planned: number, previousFraction: number, newFraction: number): ClaimDelta {
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const deltaQuantity = round4((newFraction - previousFraction) * planned);
  return {
    deltaQuantity: deltaQuantity === 0 ? 0 : deltaQuantity,
    installedAfter: round4(planned * newFraction),
    progressAfter: Math.round(newFraction * 1000) / 10,
    regression: deltaQuantity < 0,
    unchanged: deltaQuantity === 0,
  };
}

/**
 * What verify_progress_claim writes for a row (migration 104): installed
 * becomes planned x newFraction (4 decimals), and the entry is the difference
 * from what the row's entries already sum to. Unlike claimDelta, this follows
 * weight or planned-volume changes made since the last verification.
 */
export function deltaFromInstalled(planned: number, installedBefore: number, newFraction: number): ClaimDelta {
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const installedAfter = round4(planned * newFraction);
  const deltaQuantity = round4(installedAfter - installedBefore);
  return {
    deltaQuantity: deltaQuantity === 0 ? 0 : deltaQuantity,
    installedAfter,
    progressAfter: Math.round(newFraction * 1000) / 10,
    regression: deltaQuantity < 0,
    unchanged: deltaQuantity === 0,
  };
}

export function workStatusFor(fraction: number): 'COMPLETE' | 'IN_PROGRESS' {
  return fraction >= 1 - 1e-6 ? 'COMPLETE' : 'IN_PROGRESS';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsStageMath.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/stageMath.ts tools/__tests__/progressClaimsStageMath.test.ts
git commit -m "feat(progress): row completion from stage percents and claim delta"
```

---

### Task 5: Reference stage-weight profile derived from the RAB workbooks

**Files:**
- Create: `tools/progressClaims/referenceStageWeights.ts`
- Create: `tools/progressClaims/loadReferenceWorkbooks.ts`
- Create: `tools/progressClaims/deriveReferenceWeights.ts`
- Create: `tools/progressClaims/referenceStageWeights.data.ts`
- Test: `tools/__tests__/progressClaimsReferenceWeights.test.ts`

Method (spec §7.3, §17): per concrete RAB row, bekisting Rp = volume × V × W, pembesian Rp = volume × Z × AA, pengecoran Rp = volume × R; the borongan line S + T is left out because apportioning it pro rata leaves the shares unchanged; only rows priced on all three stages count; each workbook counts once. `loadReferenceWorkbooks.ts` is Node-only (fs + xlsx) and never imported by app code. Loading only the `RAB (A)` / `RAB (B)` sheets keeps the golden test at about 1.5 s. The data file is generated: never edit it by hand.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsReferenceWeights.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsReferenceWeights.test.ts
import * as path from 'path';
import { hasStageColumns, rabConcreteRows, referenceProfile, sheetClassTotals } from '../progressClaims/referenceStageWeights';
import { loadReferenceWorkbooks, referenceWorkbooksAvailable } from '../progressClaims/loadReferenceWorkbooks';
import { REFERENCE_PROFILE } from '../progressClaims/referenceStageWeights.data';

// Column indexes of the SANO RAB layout: A=0 B=1 D=3 R=17 V=21 W=22 Z=25 AA=26.
function row(cells: Record<number, unknown>): unknown[] {
  const r: unknown[] = [];
  for (const [k, v] of Object.entries(cells)) r[Number(k)] = v;
  return r;
}
const header = (): unknown[][] => [[], [], [], [], [], row({ 17: 'Beton', 21: 'Bekisting', 25: 'Besi' }), []];
const concrete = (label: string, volume: number, R: number, V: number, W: number, Z: number, AA: number) =>
  row({ 1: label, 3: volume, 17: R, 21: V, 22: W, 25: Z, 26: AA });

describe('rabConcreteRows', () => {
  it('reads chapters, sections and stage Rupiah, and skips rows no stage prices', () => {
    const rows = [
      ...header(),
      row({ 0: 'III', 1: 'PEKERJAAN FISIK LANTAI 1' }),
      row({ 0: '3', 1: 'Kolom (Readymix)' }),
      concrete('- Kolom K1', 2, 1_000_000, 10, 100_000, 200, 10_000),
      row({ 1: 'Uitzet', 3: 5, 4: 1000 }),
    ];
    expect(hasStageColumns(rows)).toBe(true);
    expect(rabConcreteRows(rows)).toEqual([{
      chapterTitle: 'PEKERJAAN FISIK LANTAI 1', section: 'Kolom (Readymix)', label: '- Kolom K1',
      volume: 2, bekisting: 2_000_000, pembesian: 4_000_000, pengecoran: 2_000_000,
    }]);
  });
});

describe('sheetClassTotals', () => {
  it('counts only rows priced on all three stages and puts a basement slab in the ground class', () => {
    const rows = [
      ...header(),
      row({ 0: 'III', 1: 'PEKERJAAN FISIK LANTAI BASEMENT' }),
      concrete('- Plat lantai basement', 10, 1_000_000, 1, 100_000, 100, 10_000),
      row({ 0: 'IV', 1: 'PEKERJAAN FISIK LANTAI 1' }),
      concrete('- Plat lantai', 10, 1_000_000, 8, 150_000, 110, 12_000),
      concrete('- Tangga', 3, 5_250_000, 0, 0, 0, 0),
    ];
    const totals = sheetClassTotals(rows);
    expect(totals.get('PILECAP_SLOOF_PLAT_DASAR')).toEqual({ rows: 1, volume: 10, bekisting: 1_000_000, pembesian: 10_000_000, pengecoran: 10_000_000 });
    expect(totals.get('BALOK_PLAT')).toEqual({ rows: 1, volume: 10, bekisting: 12_000_000, pembesian: 13_200_000, pengecoran: 10_000_000 });
    expect(totals.has('TANGGA')).toBe(false);
  });
});

describe('referenceProfile', () => {
  it('averages per-workbook shares, so one large workbook cannot dominate', () => {
    const small = [...header(), row({ 0: 'III', 1: 'LANTAI 1' }), concrete('- Kolom K1', 1, 2_000_000, 1, 1_000_000, 1, 1_000_000)];
    const large = [...header(), row({ 0: 'III', 1: 'LANTAI 1' }), concrete('- Kolom K1', 100, 1_000_000, 1, 1_000_000, 1, 2_000_000)];
    // small 25/25/50, large 25/50/25 → 25/37.5/37.5 whatever the volumes
    const profile = referenceProfile([{ name: 'a', sheets: [small] }, { name: 'b', sheets: [large] }]);
    expect(profile.KOLOM).toEqual({ weights: { BEKISTING: 0.25, PEMBESIAN: 0.375, PENGECORAN: 0.375 }, workbooks: 2, rows: 2, volume_m3: 101 });
    expect(profile.TANGGA).toBeUndefined();
  });

  it('ignores sheets without the stage columns', () => {
    const noHeader = [row({ 0: 'III', 1: 'LANTAI 1' }), concrete('- Kolom K1', 1, 2_000_000, 1, 1_000_000, 1, 1_000_000)];
    expect(referenceProfile([{ name: 'x', sheets: [noHeader] }])).toEqual({});
  });
});

describe('REFERENCE_PROFILE (generated file)', () => {
  const boqDir = path.join(process.cwd(), 'assets', 'BOQ');

  (referenceWorkbooksAvailable(boqDir) ? it : it.skip)('equals a fresh derivation from the reference RAB workbooks', () => {
    expect(referenceProfile(loadReferenceWorkbooks(boqDir))).toEqual(REFERENCE_PROFILE);
  }, 60_000);

  it('covers the four stage-priced classes with weights summing to 1', () => {
    for (const cls of ['PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING'] as const) {
      const w = REFERENCE_PROFILE[cls]?.weights;
      expect(w).toBeDefined();
      expect(w!.BEKISTING + w!.PEMBESIAN + w!.PENGECORAN).toBeCloseTo(1, 3);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsReferenceWeights.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/referenceStageWeights'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/referenceStageWeights.ts` (new file):

```ts
// tools/progressClaims/referenceStageWeights.ts
// SANO — derive the reference stage-weight profile from SANO RAB workbooks
// (spec §7.3, §17). Pure over sheet rows; the xlsx reading lives in
// deriveReferenceWeights.ts.
//
// Method: per concrete RAB row, bekisting Rp = volume × V × W, pembesian Rp =
// volume × Z × AA, pengecoran Rp = volume × R. The borongan line S + T is left
// out on purpose: apportioning it pro rata to material Rp leaves the shares
// unchanged. Only rows priced on all three stages count. Each workbook counts
// once: a class's weights are the mean of its per-workbook shares.
import { classifyWorkAreas, elementOf, type WorkAreaClass } from './workAreaClass';
import { weightsFromAmounts, type ReferenceProfile } from './stageWeights';

export const REFERENCE_WORKBOOKS = [
  'SPH 4 Sonny Citraland Selat Golf.xlsx',
  'RAB R1 Pakuwon Indah AAL-5.xlsx',
  'RAB R2 Pakuwon Indah PD3 no. 23.xlsx',
  'RAB Nusa Golf I4 no. 29_R3.xlsx',
  'RAB ERNAWATI edit.xlsx',
] as const;

/** Classes every reference RAB prices by stage. Tangga and piles are package-priced; lainnya is too mixed. */
export const PROFILE_CLASSES: readonly WorkAreaClass[] = ['PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING'];

const COL = { A: 0, B: 1, D: 3, R: 17, V: 21, W: 22, Z: 25, AA: 26 } as const;
const ROMAN = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

export interface RabConcreteRow {
  chapterTitle: string;
  section: string;
  label: string;
  volume: number;
  bekisting: number;
  pembesian: number;
  pengecoran: number;
}

/** The SANO RAB layout: a header in the first 12 rows names Bekisting at column V and Besi/Pembesian at Z. */
export function hasStageColumns(rows: unknown[][]): boolean {
  return rows.slice(0, 12).some((r) => /bekisting/i.test(text(r[COL.V])) && /besi|pembesian/i.test(text(r[COL.Z])));
}

/** Rows with a volume and at least one stage priced; a volume-less row with a label becomes the current section. */
export function rabConcreteRows(rows: unknown[][]): RabConcreteRow[] {
  const out: RabConcreteRow[] = [];
  let chapterTitle = '';
  let section = '';
  for (const r of rows) {
    const a = text(r[COL.A]);
    const b = text(r[COL.B]);
    if (ROMAN.test(a)) {
      chapterTitle = b;
      section = '';
      continue;
    }
    const volume = num(r[COL.D]);
    const bekisting = volume * num(r[COL.V]) * num(r[COL.W]);
    const pembesian = volume * num(r[COL.Z]) * num(r[COL.AA]);
    const pengecoran = volume * num(r[COL.R]);
    if (volume > 0 && (bekisting > 0 || pembesian > 0 || pengecoran > 0)) {
      out.push({ chapterTitle, section, label: b, volume, bekisting, pembesian, pengecoran });
    } else if (b && volume === 0) {
      section = b;
    }
  }
  return out;
}

export interface ClassTotals {
  rows: number;
  volume: number;
  bekisting: number;
  pembesian: number;
  pengecoran: number;
}

/** One sheet: classify every concrete row (ground decided across them), then total the fully priced rows per class. */
export function sheetClassTotals(rows: unknown[][]): Map<WorkAreaClass, ClassTotals> {
  const concrete = rabConcreteRows(rows);
  const classes = classifyWorkAreas(concrete.map((r) => {
    const label = r.label.replace(/^-\s*/, '');
    // A row label that names its element ("- Balok B24-1") beats the section it sits under ("Sloof & Balok").
    return { label, chapter: r.chapterTitle, sub_chapter: elementOf(label) ? label : (r.section || null) };
  }));
  const totals = new Map<WorkAreaClass, ClassTotals>();
  concrete.forEach((r, i) => {
    if (r.bekisting <= 0 || r.pembesian <= 0 || r.pengecoran <= 0) return;
    const t = totals.get(classes[i]) ?? { rows: 0, volume: 0, bekisting: 0, pembesian: 0, pengecoran: 0 };
    t.rows += 1;
    t.volume += r.volume;
    t.bekisting += r.bekisting;
    t.pembesian += r.pembesian;
    t.pengecoran += r.pengecoran;
    totals.set(classes[i], t);
  });
  return totals;
}

export interface WorkbookSheets {
  name: string;
  /** Every sheet's rows as arrays of cell values; sheets without the stage columns are skipped. */
  sheets: unknown[][][];
}

export function referenceProfile(workbooks: WorkbookSheets[]): ReferenceProfile {
  const perWorkbook = workbooks.map((wb) => {
    const totals = new Map<WorkAreaClass, ClassTotals>();
    for (const rows of wb.sheets) {
      if (!hasStageColumns(rows)) continue;
      for (const [cls, t] of sheetClassTotals(rows)) {
        const into = totals.get(cls) ?? { rows: 0, volume: 0, bekisting: 0, pembesian: 0, pengecoran: 0 };
        into.rows += t.rows;
        into.volume += t.volume;
        into.bekisting += t.bekisting;
        into.pembesian += t.pembesian;
        into.pengecoran += t.pengecoran;
        totals.set(cls, into);
      }
    }
    return totals;
  });

  const profile: ReferenceProfile = {};
  for (const cls of PROFILE_CLASSES) {
    const shares = perWorkbook
      .map((totals) => totals.get(cls))
      .filter((t): t is ClassTotals => t !== undefined)
      .map((t) => {
        const total = t.bekisting + t.pembesian + t.pengecoran;
        return { t, bekisting: t.bekisting / total, pembesian: t.pembesian / total, pengecoran: t.pengecoran / total };
      });
    if (shares.length === 0) continue;
    const mean = (key: 'bekisting' | 'pembesian' | 'pengecoran') => shares.reduce((a, s) => a + s[key], 0) / shares.length;
    const weights = weightsFromAmounts({ BEKISTING: mean('bekisting'), PEMBESIAN: mean('pembesian'), PENGECORAN: mean('pengecoran') });
    if (!weights) continue;
    profile[cls] = {
      weights,
      workbooks: shares.length,
      rows: shares.reduce((a, s) => a + s.t.rows, 0),
      volume_m3: Math.round(shares.reduce((a, s) => a + s.t.volume, 0)),
    };
  }
  return profile;
}
```

`tools/progressClaims/loadReferenceWorkbooks.ts` (new file):

```ts
// tools/progressClaims/loadReferenceWorkbooks.ts
// Node-only: reads the reference RAB workbooks for deriveReferenceWeights.ts
// and its golden test. Never import this from app code (it uses fs and xlsx).
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { REFERENCE_WORKBOOKS, type WorkbookSheets } from './referenceStageWeights';

export function referenceWorkbookPaths(boqDir: string): string[] {
  return REFERENCE_WORKBOOKS.map((file) => path.join(boqDir, file));
}

export function referenceWorkbooksAvailable(boqDir: string): boolean {
  return referenceWorkbookPaths(boqDir).every((p) => fs.existsSync(p));
}

/** The only sheets the derivation reads; parsing just these is about 4x faster and yields identical rows. */
const RAB_SHEETS = ['RAB (A)', 'RAB (B)'];

/** Every `RAB (A)` / `RAB (B)` sheet of each reference workbook, as raw cell rows. */
export function loadReferenceWorkbooks(boqDir: string): WorkbookSheets[] {
  return REFERENCE_WORKBOOKS.map((file) => {
    const wb = XLSX.readFile(path.join(boqDir, file), { cellFormula: false, sheets: RAB_SHEETS });
    return {
      name: file,
      sheets: wb.SheetNames
        .filter((n) => /^RAB \((?:A|B)\)$/.test(n))
        .map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: '' })),
    };
  });
}
```

`tools/progressClaims/deriveReferenceWeights.ts` (new file):

```ts
// tools/progressClaims/deriveReferenceWeights.ts
// Regenerates referenceStageWeights.data.ts from the RAB workbooks in
// assets/BOQ. Run from the repo root:
//   npx tsx tools/progressClaims/deriveReferenceWeights.ts
import * as fs from 'fs';
import * as path from 'path';
import { referenceProfile } from './referenceStageWeights';
import { loadReferenceWorkbooks, referenceWorkbooksAvailable } from './loadReferenceWorkbooks';

const root = process.cwd();
const boqDir = path.join(root, 'assets', 'BOQ');
if (!referenceWorkbooksAvailable(boqDir)) {
  console.error('Reference RAB workbooks not found under assets/BOQ; run from the repo root.');
  process.exit(1);
}

const profile = referenceProfile(loadReferenceWorkbooks(boqDir));
const out = process.argv[2] ?? path.join(root, 'tools', 'progressClaims', 'referenceStageWeights.data.ts');
fs.writeFileSync(
  out,
  [
    '// GENERATED by tools/progressClaims/deriveReferenceWeights.ts from the RAB workbooks',
    '// listed in referenceStageWeights.ts REFERENCE_WORKBOOKS. Do not edit by hand; re-run:',
    '//   npx tsx tools/progressClaims/deriveReferenceWeights.ts',
    "import type { ReferenceProfile } from './stageWeights';",
    '',
    `export const REFERENCE_PROFILE: ReferenceProfile = ${JSON.stringify(profile, null, 2)};`,
    '',
  ].join('\n'),
);
console.log(`wrote ${path.relative(root, out)}`);
for (const [cls, entry] of Object.entries(profile)) {
  if (!entry) continue;
  const w = entry.weights;
  console.log(`${cls.padEnd(26)} bek ${(w.BEKISTING * 100).toFixed(1)}%  pem ${(w.PEMBESIAN * 100).toFixed(1)}%  cor ${(w.PENGECORAN * 100).toFixed(1)}%  (${entry.workbooks} workbooks, ${entry.rows} rows, ${entry.volume_m3} m3)`);
}
```

`tools/progressClaims/referenceStageWeights.data.ts` (new file):

```ts
// GENERATED by tools/progressClaims/deriveReferenceWeights.ts from the RAB workbooks
// listed in referenceStageWeights.ts REFERENCE_WORKBOOKS. Do not edit by hand; re-run:
//   npx tsx tools/progressClaims/deriveReferenceWeights.ts
import type { ReferenceProfile } from './stageWeights';

export const REFERENCE_PROFILE: ReferenceProfile = {
  "PILECAP_SLOOF_PLAT_DASAR": {
    "weights": {
      "BEKISTING": 0.131,
      "PEMBESIAN": 0.476,
      "PENGECORAN": 0.393
    },
    "workbooks": 5,
    "rows": 125,
    "volume_m3": 608
  },
  "KOLOM": {
    "weights": {
      "BEKISTING": 0.326,
      "PEMBESIAN": 0.486,
      "PENGECORAN": 0.188
    },
    "workbooks": 5,
    "rows": 208,
    "volume_m3": 313
  },
  "BALOK_PLAT": {
    "weights": {
      "BEKISTING": 0.368,
      "PEMBESIAN": 0.38,
      "PENGECORAN": 0.252
    },
    "workbooks": 5,
    "rows": 441,
    "volume_m3": 1143
  },
  "DINDING": {
    "weights": {
      "BEKISTING": 0.312,
      "PEMBESIAN": 0.356,
      "PENGECORAN": 0.332
    },
    "workbooks": 5,
    "rows": 54,
    "volume_m3": 464
  }
};
```

- [ ] **Step 4: Confirm the profile regenerates identically**

Run: `npx tsx tools/progressClaims/deriveReferenceWeights.ts /tmp/referenceStageWeights.check.ts && diff /tmp/referenceStageWeights.check.ts tools/progressClaims/referenceStageWeights.data.ts`
Expected output (and no diff):

```text
wrote ../../../../../../../../tmp/referenceStageWeights.check.ts
PILECAP_SLOOF_PLAT_DASAR   bek 13.1%  pem 47.6%  cor 39.3%  (5 workbooks, 125 rows, 608 m3)
KOLOM                      bek 32.6%  pem 48.6%  cor 18.8%  (5 workbooks, 208 rows, 313 m3)
BALOK_PLAT                 bek 36.8%  pem 38.0%  cor 25.2%  (5 workbooks, 441 rows, 1143 m3)
DINDING                    bek 31.2%  pem 35.6%  cor 33.2%  (5 workbooks, 54 rows, 464 m3)
```

These are the spec §17 numbers. Any difference means the classifier or the RAB reading changed; stop and find out why before committing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsReferenceWeights.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/progressClaims/referenceStageWeights.ts tools/progressClaims/loadReferenceWorkbooks.ts tools/progressClaims/deriveReferenceWeights.ts tools/progressClaims/referenceStageWeights.data.ts tools/__tests__/progressClaimsReferenceWeights.test.ts
git commit -m "feat(progress): reference stage-weight profile derived from five RAB workbooks"
```

---

### Task 6: WIB week helpers

**Files:**
- Create: `tools/progressClaims/week.ts`
- Test: `tools/__tests__/progressClaimsWeek.test.ts`

A claim's week is the WIB Monday, whatever the device zone, built on `tools/timeWindow.ts` (`todayIsoWIB`, `addCalendarDays`). Migration 104 dates claims with `date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')`.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsWeek.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsWeek.test.ts
import { shortDateId, weekEndWIB, weekLabel, weekStartWIB } from '../progressClaims/week';

describe('WIB week helpers', () => {
  it('starts the week on Monday 00:00 WIB whatever the device zone', () => {
    expect(weekStartWIB(new Date('2026-09-13T16:59:59.000Z'))).toBe('2026-09-07'); // Sunday 23:59:59 WIB
    expect(weekStartWIB(new Date('2026-09-13T17:00:00.000Z'))).toBe('2026-09-14'); // Monday 00:00 WIB
    expect(weekStartWIB(new Date('2026-09-19T10:00:00.000Z'))).toBe('2026-09-14'); // Saturday
    expect(weekStartWIB(new Date('2026-03-01T03:00:00.000Z'))).toBe('2026-02-23'); // across a month
  });

  it('ends the week on Sunday and labels it in Indonesian', () => {
    expect(weekEndWIB('2026-09-14')).toBe('2026-09-20');
    expect(shortDateId('2026-08-01')).toBe('1 Agu');
    expect(weekLabel('2026-09-14')).toBe(`Minggu 14${String.fromCharCode(0x2013)}20 Sep`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsWeek.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/week'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/week.ts` (new file):

```ts
// tools/progressClaims/week.ts
// SANO — the WIB (Asia/Jakarta) week a progress claim belongs to. Pure.
// Built on tools/timeWindow.ts so the device zone never decides the week;
// migration 104 computes the same Monday with date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta').
import { addCalendarDays, todayIsoWIB } from '../timeWindow';

const SHORT_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Monday (YYYY-MM-DD) of the WIB week containing `now`. */
export function weekStartWIB(now: Date = new Date()): string {
  const today = todayIsoWIB(now);
  const [y, m, d] = today.split('-').map(Number);
  const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addCalendarDays(today, -daysSinceMonday);
}

/** Sunday (YYYY-MM-DD) of the week that starts on `weekStart`. */
export function weekEndWIB(weekStart: string): string {
  return addCalendarDays(weekStart, 6);
}

/** "2026-09-14" → "14 Sep". */
export function shortDateId(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS_ID[m - 1]}`;
}

/** "Minggu 14–20 Sep" for the week starting on `weekStart`. */
export function weekLabel(weekStart: string): string {
  return `Minggu ${shortDateId(weekStart).split(' ')[0]}–${shortDateId(weekEndWIB(weekStart))}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsWeek.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/week.ts tools/__tests__/progressClaimsWeek.test.ts
git commit -m "feat(progress): WIB week helpers for weekly claims"
```

---

### Task 7: Claim rules and refusal copy

**Files:**
- Create: `tools/progressClaims/claimRules.ts`
- Test: `tools/__tests__/progressClaimsRules.test.ts`

Roles, editable states, percent validation and the Indonesian sentence for every refusal code migrations 103 and 104 raise. Separation of duties lives here as `canVerifyClaimAs`: whoever submitted the claim or filled one of its lines never verifies it. The static test of Task 12 fails when a code is raised without copy or copy exists for a code nothing raises.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsRules.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsRules.test.ts
import {
  CLAIM_RPC_ERROR_COPY, canEditStageWeights, canSaveClaimLine, canVerifyClaim, canVerifyClaimAs, claimLineView, isClaimEditable,
  isRegression, mapClaimRpcError, validateClaimPct,
} from '../progressClaims/claimRules';

const split = { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 };

describe('roles and states', () => {
  it('lets supervisors, estimators and admins save lines, and never the principal', () => {
    expect(canSaveClaimLine('supervisor')).toBe(true);
    expect(canSaveClaimLine('estimator')).toBe(true);
    expect(canSaveClaimLine('principal')).toBe(false);
    expect(canSaveClaimLine(undefined)).toBe(false);
  });

  it('lets only estimators and admins verify or edit weights', () => {
    expect(canVerifyClaim('estimator')).toBe(true);
    expect(canVerifyClaim('admin')).toBe(true);
    expect(canVerifyClaim('principal')).toBe(false);
    expect(canVerifyClaim('supervisor')).toBe(false);
    expect(canEditStageWeights('estimator')).toBe(true);
    expect(canEditStageWeights('supervisor')).toBe(false);
  });

  it('never lets the submitter verify their own claim', () => {
    expect(canVerifyClaimAs('estimator', 'u-est', 'u-sup')).toBe(true);
    expect(canVerifyClaimAs('estimator', 'u-est', 'u-est')).toBe(false);
    expect(canVerifyClaimAs('admin', null, 'u-sup')).toBe(false);
    expect(canVerifyClaimAs('supervisor', 'u-sup2', 'u-sup')).toBe(false);
    expect(canVerifyClaimAs('estimator', 'u-est', 'u-sup', ['u-sup', 'u-est'])).toBe(false);
    expect(canVerifyClaimAs('estimator', 'u-est2', 'u-sup', ['u-sup', 'u-est'])).toBe(true);
  });

  it('allows editing a draft or returned claim only', () => {
    expect(isClaimEditable('DRAFT')).toBe(true);
    expect(isClaimEditable('RETURNED')).toBe(true);
    expect(isClaimEditable('SUBMITTED')).toBe(false);
    expect(isClaimEditable('VERIFIED')).toBe(false);
  });
});

describe('validateClaimPct', () => {
  it('accepts exactly the stages of the weights, keeping one decimal', () => {
    expect(validateClaimPct(split, { BEKISTING: 100, PEMBESIAN: 42.26, PENGECORAN: 0 }))
      .toEqual({ ok: true, pct: { BEKISTING: 100, PEMBESIAN: 42.3, PENGECORAN: 0 } });
    expect(validateClaimPct({ SINGLE: 1 }, { SINGLE: 55 })).toEqual({ ok: true, pct: { SINGLE: 55 } });
  });

  it.each([
    [split, { BEKISTING: 100, PEMBESIAN: 40 }],
    [split, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0, SINGLE: 10 }],
    [split, { BEKISTING: 101, PEMBESIAN: 40, PENGECORAN: 0 }],
    [split, { BEKISTING: '100', PEMBESIAN: 40, PENGECORAN: 0 }],
    [{ SINGLE: 1 as const }, { BEKISTING: 50 }],
    [split, null],
  ])('refuses %j with %j', (weights, raw) => {
    expect(validateClaimPct(weights, raw).ok).toBe(false);
  });
});

describe('claimLineView', () => {
  it('shows the fraction before, after, the quantity added and no regression', () => {
    const view = claimLineView(split, { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, 216.25);
    expect(view.previousFraction).toBe(0.368);
    expect(view.claimedFraction).toBe(0.558);
    expect(view.delta.deltaQuantity).toBe(41.0875);
    expect(view.regression).toBe(false);
  });

  it('flags a stage that goes below what was verified, even when the row total rises', () => {
    expect(isRegression(split, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, { BEKISTING: 90, PEMBESIAN: 60, PENGECORAN: 0 })).toBe(true);
    expect(isRegression(split, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 })).toBe(false);
  });
});

describe('mapClaimRpcError', () => {
  it('maps every code to its sentence and never collides', () => {
    for (const [code, copy] of CLAIM_RPC_ERROR_COPY) {
      expect(mapClaimRpcError(`${code}: detail from SQL`)).toBe(copy);
    }
    expect(new Set(CLAIM_RPC_ERROR_COPY.map(([code]) => code)).size).toBe(CLAIM_RPC_ERROR_COPY.length);
  });

  it('falls back to the raw text, then to a generic sentence', () => {
    expect(mapClaimRpcError('connection reset')).toBe('Gagal menyimpan: connection reset');
    expect(mapClaimRpcError(null)).toBe('Gagal menyimpan. Coba lagi.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsRules.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/claimRules'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/claimRules.ts` (new file):

```ts
// tools/progressClaims/claimRules.ts
// SANO — progress-claim rules shared by the screens and mirrored by the
// migration 104 RPCs (spec §6.2, §18). Pure.
//
// A project has at most one claim in progress (DRAFT, SUBMITTED or RETURNED).
// The supervisor edits DRAFT and RETURNED claims; the estimator or admin
// verifies a SUBMITTED one; the principal only reads. Every percent is per
// stage of the row's stored weights, 0..100 with one decimal.
import { claimDelta, clampPct, rowFraction, type ClaimDelta, type StagePct } from './stageMath';
import { stagesOf, type StageWeights } from './stageWeights';

export const CLAIM_STATUSES = ['DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export function isClaimEditable(status: ClaimStatus): boolean {
  return status === 'DRAFT' || status === 'RETURNED';
}

/** Supervisors record progress; estimators and admins may too (they sit on site visits). The principal reads. */
export function canSaveClaimLine(role: string | null | undefined): boolean {
  return role === 'supervisor' || role === 'estimator' || role === 'admin';
}

export function canVerifyClaim(role: string | null | undefined): boolean {
  return role === 'estimator' || role === 'admin';
}

/**
 * Separation of duties: whoever submitted a claim, or filled any of its lines,
 * never verifies it, whatever their role. verify_progress_claim refuses it too.
 */
export function canVerifyClaimAs(
  role: string | null | undefined,
  uid: string | null | undefined,
  submittedBy: string | null | undefined,
  lineAuthors: ReadonlyArray<string | null | undefined> = [],
): boolean {
  return canVerifyClaim(role) && !!uid && uid !== submittedBy && !lineAuthors.includes(uid);
}

export function canEditStageWeights(role: string | null | undefined): boolean {
  return role === 'estimator' || role === 'admin';
}

export type PctValidation = { ok: true; pct: StagePct } | { ok: false; reason: string };

/** Exactly the weights' own stages, each a number 0..100 (one decimal kept). */
export function validateClaimPct(weights: StageWeights, raw: unknown): PctValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'persentase harus berupa objek' };
  const r = raw as Record<string, unknown>;
  const stages = stagesOf(weights);
  const keys = Object.keys(r);
  if (keys.length !== stages.length || !stages.every((s) => keys.includes(s))) {
    return { ok: false, reason: 'isi persentase untuk setiap tahap, tidak lebih' };
  }
  const pct: StagePct = {};
  for (const s of stages) {
    const v = r[s];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return { ok: false, reason: 'persentase harus angka 0 sampai 100' };
    pct[s] = clampPct(v) as number;
  }
  return { ok: true, pct };
}

/** True when any stage would go below what was already verified. */
export function isRegression(weights: StageWeights, previous: StagePct, next: StagePct): boolean {
  return stagesOf(weights).some((s) => (next[s] ?? 0) < (previous[s] ?? 0));
}

export interface ClaimLineView {
  previousFraction: number;
  claimedFraction: number;
  delta: ClaimDelta;
  regression: boolean;
}

export function claimLineView(weights: StageWeights, previous: StagePct, claimed: StagePct, planned: number): ClaimLineView {
  const previousFraction = rowFraction(weights, previous);
  const claimedFraction = rowFraction(weights, claimed);
  return {
    previousFraction,
    claimedFraction,
    delta: claimDelta(planned, previousFraction, claimedFraction),
    regression: isRegression(weights, previous, claimed),
  };
}

/** Migration 104 raises `CODE: …`; each code maps to one Indonesian sentence. A static test pins both lists together. */
export const CLAIM_RPC_ERROR_COPY: ReadonlyArray<[string, string]> = [
  ['CLAIM_AUTH', 'Anda tidak ditugaskan ke proyek ini.'],
  ['CLAIM_ROLE', 'Peran Anda tidak dapat melakukan aksi ini.'],
  ['CLAIM_NOT_FOUND', 'Klaim tidak ditemukan. Muat ulang halaman.'],
  ['CLAIM_ROW', 'Baris BoQ bukan milik proyek ini atau sudah tidak berlaku.'],
  ['CLAIM_NO_WEIGHTS', 'Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.'],
  ['CLAIM_PCT', 'Persentase tahap tidak valid.'],
  ['CLAIM_LOCKED', 'Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.'],
  ['CLAIM_STATE', 'Status klaim sudah berubah. Muat ulang halaman.'],
  ['CLAIM_EMPTY', 'Klaim belum berisi baris progres.'],
  ['CLAIM_REGRESS_REASON', 'Penurunan progres wajib disertai alasan.'],
  ['CLAIM_NO_PLANNED', 'Volume rencana baris ini 0, jadi progresnya tidak bisa diklaim. Minta estimator memeriksa BoQ.'],
  ['CLAIM_EVIDENCE', 'Lampiran foto tidak valid. Ambil ulang fotonya dari aplikasi.'],
  ['CLAIM_RETURN_NOTE', 'Tulis alasan pengembalian klaim.'],
  ['CLAIM_LINES', 'Daftar baris verifikasi tidak cocok dengan klaim. Muat ulang halaman.'],
  ['CLAIM_SELF_VERIFY', 'Klaim yang Anda kirim atau isi sendiri harus diverifikasi estimator atau admin lain.'],
  ['WEIGHTS_INVALID', 'Bobot tahapan tidak valid. Jumlah ketiga tahap harus 100%.'],
  ['WEIGHTS_CLASS', 'Kelas referensi bobot tidak dikenal.'],
  ['WEIGHTS_SHAPE_LOCKED', 'Baris ini sudah punya klaim terverifikasi, jadi jenis bobotnya (satu tahap atau tiga tahap) tidak bisa diubah. Ubah nilainya saja.'],
  ['PROGRESS_SINGLE_WRITER', 'Progres BoQ hanya berubah lewat verifikasi klaim progres.'],
];

export function mapClaimRpcError(message: string | null | undefined): string {
  const text = message ?? '';
  for (const [code, copy] of CLAIM_RPC_ERROR_COPY) {
    if (text.includes(`${code}:`)) return copy;
  }
  return text ? `Gagal menyimpan: ${text}` : 'Gagal menyimpan. Coba lagi.';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsRules.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/claimRules.ts tools/__tests__/progressClaimsRules.test.ts
git commit -m "feat(progress): claim roles, states, percent validation and refusal copy"
```

---

### Task 8: Claim view model (pure)

**Files:**
- Create: `tools/progressClaims/claimView.ts`
- Test: `tools/__tests__/progressClaimsView.test.ts`

Everything the claim screens compute without I/O: which rows are claimable (live, planned > 0, only T1 work areas on a SANO Input project), which rows need reference weights and of which class, the latest verified figure per row, the latest-revision rule for report evidence (spec §17), per-row views, status copy, percent and weight input parsing with a decimal comma, the entry-total ledger per row, and a project filter that ignores rows of the previous project during a switch.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsView.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsView.test.ts
import {
  buildRowViews, claimStatusSummary, claimableRows, countLinesByRow, formatPercent, formatQty, latestRevisionReportIds,
  missingWeightSeeds, parsePercentInput, pctInputs, readPctInputs, readWeightPercentInputs,
  regressedStages, stageKeyLabel, weightPercentInputs, weightSourceLabel, type ClaimableItem,
} from '../progressClaims/claimView';
import { REFERENCE_PROFILE } from '../progressClaims/referenceStageWeights.data';

const row = (over: Partial<ClaimableItem> & Pick<ClaimableItem, 'id' | 'code' | 'label'>): ClaimableItem => ({
  unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: 0, chapter: null, sub_chapter: null, superseded_at: null, ...over,
});
const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const EN_DASH = String.fromCharCode(0x2013);

describe('claimableRows', () => {
  it('keeps live T1 work areas with planned volume in BoQ order and drops the Others anchor', () => {
    const rows = claimableRows([
      row({ id: 'b', code: 'T1-002', label: 'Lantai 1 ; Kolom', sort_order: 2 }),
      row({ id: 'a', code: 'T1-001', label: 'Lantai 1 ; Pile Cap', sort_order: 1 }),
      row({ id: 'm', code: 'MATERIAL-UMUM', label: 'Material umum', sort_order: 0 }),
      row({ id: 's', code: 'T1-003', label: 'Lantai 2 ; Balok', superseded_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'z', code: 'T1-004', label: 'Tangga', planned: 0 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('drops rows of another project still in hand after a project switch', () => {
    const rows = claimableRows([
      row({ id: 'a', code: 'T1-001', label: 'Lantai 1 ; Kolom', project_id: 'p1' }),
      row({ id: 'b', code: 'T1-001', label: 'Lantai 1 ; Kolom', project_id: 'p2' }),
    ], 'p1');
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('keeps every live planned row of a full-RAB project', () => {
    const rows = claimableRows([
      row({ id: 'x', code: 'IV.A.2.7', label: 'Balok B24-1', sort_order: 5 }),
      row({ id: 'y', code: 'III.A.1.1', label: 'Poer PC.1', sort_order: 1 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['y', 'x']);
  });
});

describe('weights', () => {
  it('seeds only rows without weights, classified across the project (basement-first ground)', () => {
    const rows = [
      row({ id: 'p1', code: 'T1-001', label: 'Lantai 1 ; Plat Lantai' }),
      row({ id: 'p2', code: 'T1-002', label: 'Lantai 2 ; Plat Lantai' }),
      row({ id: 'k1', code: 'T1-003', label: 'Lantai 1 ; Kolom' }),
    ];
    expect(missingWeightSeeds(rows, [{ boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM' }])).toEqual([
      { boq_item_id: 'p1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' },
      { boq_item_id: 'p2', reference_class: 'BALOK_PLAT' },
    ]);
  });

  it('labels the source of a row weights', () => {
    expect(weightSourceLabel('reference', 'KOLOM')).toBe('Bobot referensi (Kolom)');
    expect(weightSourceLabel('manual', null)).toBe('Bobot diatur estimator');
    expect(weightSourceLabel(null, null)).toBe('Bobot belum diatur');
  });

  it('turns stored weights into percent inputs and three percents back into weights', () => {
    expect(weightPercentInputs(REFERENCE_PROFILE.BALOK_PLAT!.weights)).toEqual({ BEKISTING: '36,8', PEMBESIAN: '38', PENGECORAN: '25,2' });
    expect(weightPercentInputs({ SINGLE: 1 })).toEqual({ BEKISTING: '', PEMBESIAN: '', PENGECORAN: '' });
    expect(readWeightPercentInputs({ BEKISTING: '36,8', PEMBESIAN: '38', PENGECORAN: '25,2' }))
      .toEqual({ ok: true, weights: { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 } });
    const short = readWeightPercentInputs({ BEKISTING: '30', PEMBESIAN: '40', PENGECORAN: '29' });
    expect(short.ok).toBe(false);
    expect(!short.ok && short.reason).toBe('Jumlah bobot 99%, harus 100%.');
    expect(readWeightPercentInputs({ BEKISTING: '30', PEMBESIAN: 'x', PENGECORAN: '70' }).ok).toBe(false);
  });
});

describe('verified figures and report evidence', () => {
  it('counts confirmed lines of the latest revision of each report only', () => {
    const ids = latestRevisionReportIds([
      { id: 'r1v1', report_no: 1, revision: 1 },
      { id: 'r1v2', report_no: 1, revision: 2 },
      { id: 'r2', report_no: 2, revision: 1 },
    ]);
    expect([...ids].sort()).toEqual(['r1v2', 'r2']);
    expect(countLinesByRow([
      { boq_item_id: 'k1', report_id: 'r1v1' },
      { boq_item_id: 'k1', report_id: 'r1v2' },
      { boq_item_id: 'k1', report_id: 'r2' },
      { boq_item_id: null, report_id: 'r2' },
    ], ids)).toEqual(new Map([['k1', 2]]));
  });
});

describe('buildRowViews', () => {
  it('joins weights, verified figures and this claim line into one view per row', () => {
    const rows = [
      row({ id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom', installed: 32.6 }),
      row({ id: 't1', code: 'T1-002', label: 'Tangga', planned: 10 }),
      row({ id: 'x', code: 'T1-003', label: 'Lantai 2 ; Dinding', installed: 5 }),
    ];
    const views = buildRowViews(
      rows,
      [
        { boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM' },
        { boq_item_id: 't1', weights: { SINGLE: 2 }, source: 'manual', reference_class: null },
      ],
      new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]),
      [{
        id: 'l1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
        claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, note: 'Begel', regress_reason: null,
        evidence: { photo_refs: ['progress/p/1.jpg'] },
      }],
      new Map([['k1', 3]]),
      new Map([['k1', 32.6]]),
    );
    expect(views[0]).toMatchObject({ lineId: 'l1', source: 'reference', prevFraction: 0.326, claimedFraction: 0.6176, photoRefs: ['progress/p/1.jpg'], linkedLines: 3, note: 'Begel', installedLedger: 32.6, installedMismatch: false });
    expect(views[1]).toMatchObject({ weights: null, source: null, claimedFraction: null, prevFraction: 0 });
    expect(views[2]).toMatchObject({ weights: null, prevPct: {}, lineId: null, linkedLines: 0, installedLedger: 0, installedMismatch: true });
  });
});

describe('claimStatusSummary', () => {
  const base = { week_start: '2026-09-14', verified_at: null, return_note: null };
  it('reads each state in Indonesian with its week', () => {
    const week = `Minggu 14${EN_DASH}20 Sep`;
    expect(claimStatusSummary(null).label).toBe('Belum ada klaim');
    expect(claimStatusSummary({ ...base, status: 'DRAFT' })).toEqual({ label: 'Belum dikirim', flag: 'WARNING', detail: week });
    expect(claimStatusSummary({ ...base, status: 'SUBMITTED' })).toEqual({ label: 'Menunggu verifikasi', flag: 'INFO', detail: week });
    expect(claimStatusSummary({ ...base, status: 'RETURNED', return_note: 'Foto kurang' })).toEqual({ label: 'Dikembalikan', flag: 'HIGH', detail: `${week}: Foto kurang` });
    expect(claimStatusSummary({ ...base, status: 'VERIFIED', verified_at: '2026-09-15T20:00:00Z' }))
      .toEqual({ label: 'Terverifikasi', flag: 'OK', detail: `${week}, diverifikasi 16 Sep` });
  });
});

describe('percent inputs', () => {
  it.each([
    ['42,5', 42.5], ['42.5', 42.5], [' 100 ', 100], ['33,33', 33.3], ['0', 0],
  ])('parses %j as %d', (raw, expected) => {
    expect(parsePercentInput(raw)).toBe(expected);
  });

  it.each(['101', '-1', 'abc', '1.2.3', '1000'])('refuses %j', (raw) => {
    expect(parsePercentInput(raw)).toBeNaN();
  });

  it('reads blank as missing', () => {
    expect(parsePercentInput('  ')).toBeNull();
  });

  it('prefills inputs and reads them back per stage of the weights', () => {
    expect(pctInputs(kolom, { BEKISTING: 100, PEMBESIAN: 42.5, PENGECORAN: 0 })).toEqual({ BEKISTING: '100', PEMBESIAN: '42,5', PENGECORAN: '0' });
    expect(pctInputs({ SINGLE: 1 }, null)).toEqual({ SINGLE: '' });
    expect(readPctInputs({ SINGLE: 1 }, { SINGLE: '40' })).toEqual({ ok: true, pct: { SINGLE: 40 } });
    expect(readPctInputs(kolom, { BEKISTING: '100', PEMBESIAN: '40' })).toEqual({ ok: false, reason: 'Isi persentase pengecoran.' });
    expect(readPctInputs(kolom, { BEKISTING: '120', PEMBESIAN: '40', PENGECORAN: '0' })).toEqual({ ok: false, reason: 'Persentase bekisting harus angka 0 sampai 100.' });
  });

  it('names the stages that go below the verified figure', () => {
    expect(regressedStages(kolom, { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, { BEKISTING: 90, PEMBESIAN: 60, PENGECORAN: 0 })).toEqual(['BEKISTING']);
    expect(stageKeyLabel('SINGLE')).toBe('Progres');
    expect(stageKeyLabel('PEMBESIAN')).toBe('Pembesian');
  });

  it('formats percents and quantities with a decimal comma', () => {
    expect(formatPercent(61.76)).toBe('61,8%');
    expect(formatPercent(null)).toBe('—');
    expect(formatQty(41.0875, 'm³')).toBe('41,09 m³');
    expect(formatQty(-9.72, 'm³')).toBe('-9,72 m³');
    expect(formatQty(38, 'm³')).toBe('38 m³');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsView.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/claimView'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/claimView.ts` (new file):

```ts
// tools/progressClaims/claimView.ts
// SANO — pure view model for the weekly stage claim screens (spec §6.2, §16, §17).
// No I/O: the screens load rows, weights, verified figures and claim lines
// through tools/progressClaims/claims.ts and hand them here.
import { todayIsoWIB } from '../timeWindow';
import type { ClaimStatus } from './claimRules';
import { rowFraction, type StagePct } from './stageMath';
import { stageLabel } from './stages';
import {
  isSingle, stagesOf, validateStageWeights, weightsFromAmounts,
  type StageKey, type StageWeights, type WeightSource,
} from './stageWeights';
import { shortDateId, weekLabel } from './week';
import { classifyWorkAreas, type WorkAreaClass } from './workAreaClass';

/** The BoQ fields these screens read; tools/types.ts BoqItem satisfies it. */
export interface ClaimableItem {
  id: string;
  project_id?: string | null;
  code: string;
  label: string;
  unit: string;
  planned: number;
  installed: number;
  progress: number;
  sort_order?: number | null;
  chapter?: string | null;
  sub_chapter?: string | null;
  superseded_at?: string | null;
}

const SIMPLIFIED_CODE_RE = /^T1-\d+$/;

/**
 * The rows a claim can name: live, planned > 0, in BoQ order. On a SANO Input
 * project only its T1 work areas count, exactly as buildWorkGroups treats them
 * (the Others anchor is not a work area).
 */
export function claimableRows<T extends ClaimableItem>(items: T[], projectId?: string | null): T[] {
  // Project data loads in steps: just after a project switch the previous
  // project's rows are still in hand. Never show or seed those.
  const own = projectId ? items.filter((b) => b.project_id == null || b.project_id === projectId) : items;
  const live = own.filter((b) => (b.superseded_at ?? null) == null);
  const simplified = live.filter((b) => SIMPLIFIED_CODE_RE.test((b.code ?? '').trim()));
  const base = simplified.length > 0 ? simplified : live;
  return base
    .filter((b) => Number(b.planned) > 0)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
}

export const WORK_AREA_CLASS_LABELS: Record<WorkAreaClass, string> = {
  PILECAP_SLOOF_PLAT_DASAR: 'Pile cap, sloof & plat dasar',
  KOLOM: 'Kolom',
  BALOK_PLAT: 'Balok & plat',
  DINDING: 'Dinding',
  TANGGA: 'Tangga',
  BOREDPILE: 'Bored pile',
  LAINNYA: 'Lainnya',
};

export function stageKeyLabel(stage: StageKey): string {
  return stage === 'SINGLE' ? 'Progres' : stageLabel(stage);
}

export function weightSourceLabel(source: WeightSource | null, referenceClass: string | null): string {
  switch (source) {
    case 'reference': {
      const name = referenceClass && referenceClass in WORK_AREA_CLASS_LABELS
        ? WORK_AREA_CLASS_LABELS[referenceClass as WorkAreaClass]
        : referenceClass ?? '-';
      return `Bobot referensi (${name})`;
    }
    case 'manual':
      return 'Bobot diatur estimator';
    case 'rab':
      return 'Bobot dari RAB';
    case 'input_sheet':
      return 'Bobot dari SANO Input';
    default:
      return 'Bobot belum diatur';
  }
}

/** A boq_stage_weights row as read; weights stay unknown until validated. */
export interface WeightRowLike {
  boq_item_id: string;
  weights: unknown;
  source: WeightSource;
  reference_class: string | null;
}

/** Classes are decided across all the rows given, so the basement-first ground rule sees every floor. */
export function classifyRows(rows: ClaimableItem[]): Map<string, WorkAreaClass> {
  const classes = classifyWorkAreas(rows.map((r) => ({ label: r.label, chapter: r.chapter ?? null, sub_chapter: r.sub_chapter ?? null })));
  return new Map(rows.map((r, i) => [r.id, classes[i]]));
}

/** Rows that have no stored weights yet, each with the reference class its label implies. */
export function missingWeightSeeds(
  rows: ClaimableItem[],
  weights: WeightRowLike[],
): Array<{ boq_item_id: string; reference_class: WorkAreaClass }> {
  const have = new Set(weights.map((w) => w.boq_item_id));
  const classes = classifyRows(rows);
  return rows
    .filter((r) => !have.has(r.id))
    .map((r) => ({ boq_item_id: r.id, reference_class: classes.get(r.id) ?? 'LAINNYA' }));
}

/** Spec §17: only the latest revision of each report number counts, so a re-issued report never counts twice. */
export function latestRevisionReportIds(reports: Array<{ id: string; report_no: number; revision: number }>): Set<string> {
  const best = new Map<number, { id: string; revision: number }>();
  for (const r of reports) {
    const current = best.get(r.report_no);
    if (!current || r.revision > current.revision) best.set(r.report_no, { id: r.id, revision: r.revision });
  }
  return new Set([...best.values()].map((v) => v.id));
}

export function countLinesByRow(
  lines: Array<{ boq_item_id: string | null; report_id: string }>,
  reportIds: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (!l.boq_item_id || !reportIds.has(l.report_id)) continue;
    counts.set(l.boq_item_id, (counts.get(l.boq_item_id) ?? 0) + 1);
  }
  return counts;
}

/** A progress_claim_lines row as the screens need it. */
export interface ClaimLineLike {
  id: string;
  boq_item_id: string;
  prev_verified: StagePct;
  claimed_pct: StagePct;
  note: string | null;
  regress_reason: string | null;
  evidence: { photo_refs?: string[] } | null;
}

export interface ClaimRowView {
  item: ClaimableItem;
  weights: StageWeights | null;
  source: WeightSource | null;
  referenceClass: string | null;
  prevPct: StagePct;
  claimedPct: StagePct | null;
  lineId: string | null;
  note: string | null;
  regressReason: string | null;
  photoRefs: string[];
  /** 0..1; 0 when the row has no usable weights. */
  prevFraction: number;
  /** 0..1; null when this claim has no line for the row. */
  claimedFraction: number | null;
  linkedLines: number;
  /** What the row's progress entries sum to; verification writes the difference from this. */
  installedLedger: number;
  /** boq_items.installed differs from the entries (legacy data); verification follows the entries. */
  installedMismatch: boolean;
}

export function zeroPct(weights: StageWeights): StagePct {
  return Object.fromEntries(stagesOf(weights).map((s) => [s, 0])) as StagePct;
}

export function buildRowViews(
  rows: ClaimableItem[],
  weights: WeightRowLike[],
  verified: Map<string, StagePct>,
  lines: ClaimLineLike[],
  linked: Map<string, number> = new Map(),
  ledger: Map<string, number> | null = null,
): ClaimRowView[] {
  const weightByRow = new Map(weights.map((w) => [w.boq_item_id, w]));
  const lineByRow = new Map(lines.map((l) => [l.boq_item_id, l]));
  return rows.map((item) => {
    const stored = weightByRow.get(item.id);
    const checked = stored ? validateStageWeights(stored.weights) : null;
    const usable = checked && checked.ok ? checked.weights : null;
    const line = lineByRow.get(item.id) ?? null;
    const prevPct = verified.get(item.id) ?? line?.prev_verified ?? (usable ? zeroPct(usable) : {});
    const refs = line?.evidence?.photo_refs;
    return {
      item,
      weights: usable,
      source: usable && stored ? stored.source : null,
      referenceClass: usable && stored ? stored.reference_class : null,
      prevPct,
      claimedPct: line?.claimed_pct ?? null,
      lineId: line?.id ?? null,
      note: line?.note ?? null,
      regressReason: line?.regress_reason ?? null,
      photoRefs: Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [],
      prevFraction: usable ? rowFraction(usable, prevPct) : 0,
      claimedFraction: usable && line ? rowFraction(usable, line.claimed_pct) : null,
      linkedLines: linked.get(item.id) ?? 0,
      installedLedger: ledger ? ledger.get(item.id) ?? 0 : Number(item.installed) || 0,
      installedMismatch: ledger ? Math.abs((Number(item.installed) || 0) - (ledger.get(item.id) ?? 0)) > 0.0001 : false,
    };
  });
}

export type ClaimFlag = 'OK' | 'INFO' | 'WARNING' | 'HIGH';

export interface ClaimHeader {
  status: ClaimStatus;
  week_start: string;
  verified_at: string | null;
  return_note: string | null;
}

export function claimStatusSummary(claim: ClaimHeader | null): { label: string; flag: ClaimFlag; detail: string } {
  if (!claim) {
    return { label: 'Belum ada klaim', flag: 'INFO', detail: 'Klaim minggu ini dibuka saat progres pertama disimpan.' };
  }
  const week = weekLabel(claim.week_start);
  switch (claim.status) {
    case 'DRAFT':
      return { label: 'Belum dikirim', flag: 'WARNING', detail: week };
    case 'SUBMITTED':
      return { label: 'Menunggu verifikasi', flag: 'INFO', detail: week };
    case 'RETURNED':
      return { label: 'Dikembalikan', flag: 'HIGH', detail: claim.return_note ? `${week}: ${claim.return_note}` : week };
    case 'VERIFIED':
    default:
      return {
        label: 'Terverifikasi',
        flag: 'OK',
        detail: claim.verified_at ? `${week}, diverifikasi ${shortDateId(todayIsoWIB(new Date(claim.verified_at)))}` : week,
      };
  }
}

/** "42,5" or "42.5" gives 42.5 (one decimal kept); blank gives null; anything else or above 100 gives NaN. */
export function parsePercentInput(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  if (!/^\d{1,3}(\.\d+)?$/.test(t)) return Number.NaN;
  const n = Number(t);
  return n <= 100 ? Math.round(n * 10) / 10 : Number.NaN;
}

const decimalText = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

export function formatPercent(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${decimalText(n)}%`;
}

export function formatFraction(fraction: number | null | undefined): string {
  return fraction == null ? '—' : formatPercent(fraction * 100);
}

/** Quantity with an Indonesian decimal comma, at most two decimals: 41.0875 m³ reads "41,09 m³". */
export function formatQty(n: number, unit: string): string {
  const text = (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `${text} ${unit}`.trim();
}

export function pctInputs(weights: StageWeights, pct: StagePct | null): Record<string, string> {
  return Object.fromEntries(stagesOf(weights).map((s) => {
    const v = pct?.[s];
    return [s, typeof v === 'number' ? decimalText(v) : ''];
  }));
}

export type PctRead = { ok: true; pct: StagePct } | { ok: false; reason: string };

export function readPctInputs(weights: StageWeights, inputs: Record<string, string>): PctRead {
  const pct: StagePct = {};
  for (const s of stagesOf(weights)) {
    const v = parsePercentInput(inputs[s] ?? '');
    const name = stageKeyLabel(s).toLowerCase();
    if (v === null) return { ok: false, reason: `Isi persentase ${name}.` };
    if (Number.isNaN(v)) return { ok: false, reason: `Persentase ${name} harus angka 0 sampai 100.` };
    pct[s] = v;
  }
  return { ok: true, pct };
}

export function regressedStages(weights: StageWeights, prev: StagePct, next: StagePct): StageKey[] {
  return stagesOf(weights).filter((s) => (next[s] ?? 0) < (prev[s] ?? 0));
}

export const SPLIT_STAGES = ['BEKISTING', 'PEMBESIAN', 'PENGECORAN'] as const;
export type SplitStage = (typeof SPLIT_STAGES)[number];

export function weightPercentInputs(weights: StageWeights | null): Record<SplitStage, string> {
  if (!weights || isSingle(weights)) return { BEKISTING: '', PEMBESIAN: '', PENGECORAN: '' };
  return {
    BEKISTING: decimalText(weights.BEKISTING * 100),
    PEMBESIAN: decimalText(weights.PEMBESIAN * 100),
    PENGECORAN: decimalText(weights.PENGECORAN * 100),
  };
}

export type WeightRead = { ok: true; weights: StageWeights } | { ok: false; reason: string };

/** Three percents that must add up to 100 (± 0.1), stored as fractions with the remainder on pengecoran. */
export function readWeightPercentInputs(inputs: Record<string, string>): WeightRead {
  const values = SPLIT_STAGES.map((s) => parsePercentInput(inputs[s] ?? ''));
  if (values.some((v) => v === null || Number.isNaN(v))) {
    return { ok: false, reason: 'Isi ketiga bobot dengan angka 0 sampai 100.' };
  }
  const [bekisting, pembesian, pengecoran] = values as number[];
  const sum = bekisting + pembesian + pengecoran;
  if (Math.abs(sum - 100) > 0.1) return { ok: false, reason: `Jumlah bobot ${formatPercent(sum)}, harus 100%.` };
  const weights = weightsFromAmounts({ BEKISTING: bekisting, PEMBESIAN: pembesian, PENGECORAN: pengecoran });
  if (!weights) return { ok: false, reason: 'Bobot tidak valid.' };
  const checked = validateStageWeights(weights);
  return checked.ok ? { ok: true, weights: checked.weights } : { ok: false, reason: checked.reason };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsView.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/claimView.ts tools/__tests__/progressClaimsView.test.ts
git commit -m "feat(progress): pure view model for the weekly stage claim screens"
```

---

### Task 9: Claim data module

**Files:**
- Create: `tools/progressClaims/claims.ts`
- Test: `tools/__tests__/progressClaimsData.test.ts`

Reads go through RLS (the latest verified figures and the entry totals come from two one-row-per-item views); every write is an RPC of migrations 103 and 104, and a refusal comes back as an Error whose message is the Indonesian sentence. Report evidence is advisory: when report lines cannot be read (migration 102 not pasted) the count is empty rather than an error. Task 12 pins the RPC parameter names here to the SQL signatures.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/progressClaimsData.test.ts` (new file):

```ts
// tools/__tests__/progressClaimsData.test.ts
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
import { supabase } from '../supabase';
import {
  countLinkedLinesByRow, countSubmittedClaims, getOpenClaim, listEntryTotals, listVerifiedStagePct, removeClaimLine, resetStageWeights,
  returnClaim, saveClaimLine, seedReferenceWeights, setStageWeights, submitClaim, verifyClaim,
} from '../progressClaims/claims';

type Result = { data?: unknown; error?: unknown; count?: number | null };

function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const settled = { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
  const q: Record<string, unknown> = { calls };
  for (const m of ['select', 'eq', 'in', 'gte', 'not', 'order', 'limit']) {
    q[m] = jest.fn((...args: unknown[]) => { calls.push([m, args]); return q; });
  }
  q.maybeSingle = jest.fn(async () => settled);
  q.then = (resolve: (v: typeof settled) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(settled).then(resolve, reject);
  return q as typeof q & { calls: typeof calls };
}

const from = supabase.from as jest.Mock;
const rpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
});

describe('reads', () => {
  it('asks for the project claim in progress', async () => {
    const q = chain({ data: { id: 'c1', status: 'DRAFT' } });
    from.mockReturnValueOnce(q);
    await expect(getOpenClaim('p1')).resolves.toMatchObject({ id: 'c1' });
    expect(from).toHaveBeenCalledWith('progress_claims');
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['in', ['status', ['DRAFT', 'SUBMITTED', 'RETURNED']]]]));
  });

  it('throws a query error instead of reading it as no claim', async () => {
    from.mockReturnValueOnce(chain({ error: { message: 'boom' } }));
    await expect(getOpenClaim('p1')).rejects.toMatchObject({ message: 'boom' });
  });

  it('counts submitted claims for the verify badge', async () => {
    const q = chain({ count: 1 });
    from.mockReturnValueOnce(q);
    await expect(countSubmittedClaims('p1')).resolves.toBe(1);
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['status', 'SUBMITTED']]]));
  });

  it('reads the latest verified figures from the one-row-per-item view', async () => {
    const q = chain({ data: [{ boq_item_id: 'k1', verified_pct: { SINGLE: 50 } }] });
    from.mockReturnValueOnce(q);
    await expect(listVerifiedStagePct('p1')).resolves.toEqual(new Map([['k1', { SINGLE: 50 }]]));
    expect(from).toHaveBeenCalledWith('progress_claim_latest_verified');
    expect(q.calls).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']]]));
  });

  it('reads what each row entries sum to, as numbers', async () => {
    from.mockReturnValueOnce(chain({ data: [{ boq_item_id: 'k1', installed_total: '52.04' }, { boq_item_id: 'k2', installed_total: 5 }] }));
    await expect(listEntryTotals('p1')).resolves.toEqual(new Map([['k1', 52.04], ['k2', 5]]));
    expect(from).toHaveBeenCalledWith('progress_entry_totals');
  });

  it('counts linked report lines from the latest revision since the week start', async () => {
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'r1v1', report_no: 1, revision: 1 }, { id: 'r1v2', report_no: 1, revision: 2 }] }))
      .mockReturnValueOnce(chain({ data: [{ boq_item_id: 'k1', report_id: 'r1v2' }] }));
    await expect(countLinkedLinesByRow('p1', '2026-09-14')).resolves.toEqual(new Map([['k1', 1]]));
    expect(from.mock.calls.map((c) => c[0])).toEqual(['client_progress_reports', 'client_report_lines']);
  });

  it('treats unreadable report lines as no evidence rather than an error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    from
      .mockReturnValueOnce(chain({ data: [{ id: 'r1', report_no: 1, revision: 1 }] }))
      .mockReturnValueOnce(chain({ error: { message: 'relation "client_report_lines" does not exist' } }));
    await expect(countLinkedLinesByRow('p1', '2026-09-14')).resolves.toEqual(new Map());
    warn.mockRestore();
  });
});

describe('writes', () => {
  it('saves a line with the argument names migration 104 declares', async () => {
    rpc.mockResolvedValueOnce({ data: { claim_id: 'c1', claim_status: 'DRAFT' }, error: null });
    await saveClaimLine({ projectId: 'p1', boqItemId: 'k1', claimedPct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, photoRefs: ['progress/p1/1.jpg'] });
    expect(rpc).toHaveBeenCalledWith('save_progress_claim_line', {
      p_project_id: 'p1', p_boq_item_id: 'k1', p_claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 },
      p_note: null, p_photo_refs: ['progress/p1/1.jpg'], p_regress_reason: null,
    });
  });

  it.each([
    ['submit_progress_claim', () => submitClaim('c1'), { p_claim_id: 'c1' }],
    ['return_progress_claim', () => returnClaim('c1', 'Foto kurang'), { p_claim_id: 'c1', p_note: 'Foto kurang' }],
    ['verify_progress_claim', () => verifyClaim('c1', [{ line_id: 'l1', verified_pct: { SINGLE: 40 } }]), { p_claim_id: 'c1', p_lines: [{ line_id: 'l1', verified_pct: { SINGLE: 40 } }], p_note: null }],
    ['remove_progress_claim_line', () => removeClaimLine('l1'), { p_line_id: 'l1' }],
    ['set_boq_stage_weights', () => setStageWeights('k1', { SINGLE: 1 }), { p_boq_item_id: 'k1', p_weights: { SINGLE: 1 } }],
    ['reset_boq_stage_weights', () => resetStageWeights('k1', 'KOLOM'), { p_boq_item_id: 'k1', p_reference_class: 'KOLOM' }],
    ['seed_reference_stage_weights', () => seedReferenceWeights('p1', [{ boq_item_id: 'k1', reference_class: 'KOLOM' }]), { p_project_id: 'p1', p_rows: [{ boq_item_id: 'k1', reference_class: 'KOLOM' }] }],
  ])('calls %s with its arguments', async (name, call, args) => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await (call as () => Promise<unknown>)();
    expect(rpc).toHaveBeenCalledWith(name, args);
  });

  it('turns a refusal into its Indonesian sentence', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'CLAIM_LOCKED: klaim x sedang menunggu verifikasi' } });
    await expect(submitClaim('c1')).rejects.toThrow('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.');
  });

  it('skips the seed call when no row is missing weights', async () => {
    await expect(seedReferenceWeights('p1', [])).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/progressClaimsData.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../progressClaims/claims'`.

- [ ] **Step 3: Write the implementation**

`tools/progressClaims/claims.ts` (new file):

```ts
// tools/progressClaims/claims.ts
// SANO — data access for stage weights and the weekly stage claim (migrations
// 103 and 104; spec §6.2, §16, §18). Reads go through RLS. Every write is an
// RPC that re-checks the rules, and a refusal comes back as an Error whose
// message is the Indonesian sentence from mapClaimRpcError.
import { supabase } from '../supabase';
import { mapClaimRpcError, type ClaimStatus } from './claimRules';
import { countLinesByRow, latestRevisionReportIds } from './claimView';
import type { StagePct } from './stageMath';
import type { StageWeights, WeightSource } from './stageWeights';
import type { WorkAreaClass } from './workAreaClass';

export const OPEN_CLAIM_STATUSES: ReadonlyArray<ClaimStatus> = ['DRAFT', 'SUBMITTED', 'RETURNED'];

export interface ProgressClaim {
  id: string;
  project_id: string;
  week_start: string;
  status: ClaimStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verifier_note: string | null;
}

export interface ProgressClaimLine {
  id: string;
  claim_id: string;
  project_id: string;
  boq_item_id: string;
  prev_verified: StagePct;
  claimed_pct: StagePct;
  verified_pct: StagePct | null;
  weights_snapshot: StageWeights | null;
  row_pct_prev: number | null;
  row_pct_new: number | null;
  installed_before: number | null;
  delta_quantity: number | null;
  regress_reason: string | null;
  note: string | null;
  evidence: { photo_refs?: string[]; report_line_ids?: string[] } | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface StageWeightRow {
  boq_item_id: string;
  weights: unknown;
  source: WeightSource;
  reference_class: string | null;
  updated_at: string;
}

const CLAIM_COLUMNS =
  'id, project_id, week_start, status, created_by, created_at, updated_at, submitted_by, submitted_at, returned_by, returned_at, return_note, verified_by, verified_at, verifier_note';
const LINE_COLUMNS =
  'id, claim_id, project_id, boq_item_id, prev_verified, claimed_pct, verified_pct, weights_snapshot, row_pct_prev, row_pct_new, installed_before, delta_quantity, regress_reason, note, evidence, created_by, updated_by, created_at, updated_at';

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(mapClaimRpcError(error.message));
  return data as T;
}

// ── Reads ────────────────────────────────────────────────────────────────

/** The project's claim in progress (DRAFT, SUBMITTED or RETURNED); migration 104 allows at most one. */
export async function getOpenClaim(projectId: string): Promise<ProgressClaim | null> {
  const { data, error } = await supabase
    .from('progress_claims')
    .select(CLAIM_COLUMNS)
    .eq('project_id', projectId)
    .in('status', [...OPEN_CLAIM_STATUSES])
    .maybeSingle();
  if (error) throw error;
  return (data as ProgressClaim | null) ?? null;
}

/** The most recently opened claim of any status, for the status cards. */
export async function getLatestClaim(projectId: string): Promise<ProgressClaim | null> {
  const { data, error } = await supabase
    .from('progress_claims')
    .select(CLAIM_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ProgressClaim | null) ?? null;
}

export async function countSubmittedClaims(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('progress_claims')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'SUBMITTED');
  if (error) throw error;
  return count ?? 0;
}

export async function listClaimLines(claimId: string): Promise<ProgressClaimLine[]> {
  const { data, error } = await supabase
    .from('progress_claim_lines')
    .select(LINE_COLUMNS)
    .eq('claim_id', claimId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ProgressClaimLine[];
}

/** Each row's most recently verified stage percents, one row per BoQ item (migration 104 view). */
export async function listVerifiedStagePct(projectId: string): Promise<Map<string, StagePct>> {
  const { data, error } = await supabase
    .from('progress_claim_latest_verified')
    .select('boq_item_id, verified_pct')
    .eq('project_id', projectId);
  if (error) throw error;
  return new Map(((data ?? []) as Array<{ boq_item_id: string; verified_pct: StagePct }>).map((r) => [r.boq_item_id, r.verified_pct]));
}

/** What each row's progress entries sum to, one row per BoQ item (migration 104 view). Verification writes the difference from this. */
export async function listEntryTotals(projectId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('progress_entry_totals')
    .select('boq_item_id, installed_total')
    .eq('project_id', projectId);
  if (error) throw error;
  return new Map(((data ?? []) as Array<{ boq_item_id: string; installed_total: number | string }>).map((r) => [r.boq_item_id, Number(r.installed_total) || 0]));
}

export async function listStageWeights(projectId: string): Promise<StageWeightRow[]> {
  const { data, error } = await supabase
    .from('boq_stage_weights')
    .select('boq_item_id, weights, source, reference_class, updated_at')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []) as StageWeightRow[];
}

/**
 * Confirmed Blueprint report lines per row since a date, from the latest
 * revision of each report only. Evidence is advisory: when the lines cannot
 * be read (for example migration 102 not pasted yet) this returns an empty
 * map instead of failing the claim screen.
 */
export async function countLinkedLinesByRow(projectId: string, sinceDate: string): Promise<Map<string, number>> {
  try {
    const { data: reports, error } = await supabase
      .from('client_progress_reports')
      .select('id, report_no, revision')
      .eq('project_id', projectId)
      .gte('period_start', sinceDate)
      .not('issued_at', 'is', null);
    if (error) throw error;
    const reportIds = latestRevisionReportIds((reports ?? []) as Array<{ id: string; report_no: number; revision: number }>);
    if (reportIds.size === 0) return new Map();
    const { data: lines, error: linesError } = await supabase
      .from('client_report_lines')
      .select('boq_item_id, report_id')
      .in('report_id', [...reportIds])
      .eq('status', 'CONFIRMED');
    if (linesError) throw linesError;
    return countLinesByRow((lines ?? []) as Array<{ boq_item_id: string | null; report_id: string }>, reportIds);
  } catch (err) {
    console.warn('countLinkedLinesByRow failed:', (err as { message?: string })?.message ?? err);
    return new Map();
  }
}

// ── Stage weights (migration 103) ────────────────────────────────────────

export async function seedReferenceWeights(
  projectId: string,
  rows: Array<{ boq_item_id: string; reference_class: WorkAreaClass }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  return callRpc<number>('seed_reference_stage_weights', { p_project_id: projectId, p_rows: rows });
}

export async function setStageWeights(boqItemId: string, weights: StageWeights): Promise<void> {
  await callRpc('set_boq_stage_weights', { p_boq_item_id: boqItemId, p_weights: weights });
}

export async function resetStageWeights(boqItemId: string, referenceClass: WorkAreaClass): Promise<void> {
  await callRpc('reset_boq_stage_weights', { p_boq_item_id: boqItemId, p_reference_class: referenceClass });
}

// ── The weekly claim (migration 104) ─────────────────────────────────────

export interface SaveClaimLineInput {
  projectId: string;
  boqItemId: string;
  claimedPct: StagePct;
  note?: string | null;
  photoRefs: string[];
  regressReason?: string | null;
}

export interface SaveClaimLineResult {
  claim_id: string;
  claim_status: ClaimStatus;
  week_start: string;
  line_id: string;
  prev_verified: StagePct;
  claimed_pct: StagePct;
  row_fraction_prev: number;
  row_fraction_claimed: number;
}

export async function saveClaimLine(input: SaveClaimLineInput): Promise<SaveClaimLineResult> {
  return callRpc<SaveClaimLineResult>('save_progress_claim_line', {
    p_project_id: input.projectId,
    p_boq_item_id: input.boqItemId,
    p_claimed_pct: input.claimedPct,
    p_note: input.note ?? null,
    p_photo_refs: input.photoRefs,
    p_regress_reason: input.regressReason ?? null,
  });
}

export async function removeClaimLine(lineId: string): Promise<{ claim_id: string; lines_left: number }> {
  return callRpc('remove_progress_claim_line', { p_line_id: lineId });
}

export async function submitClaim(claimId: string): Promise<{ claim_id: string; status: ClaimStatus; lines: number; notified: number; verifiers_notified: number }> {
  return callRpc('submit_progress_claim', { p_claim_id: claimId });
}

export async function returnClaim(claimId: string, note: string): Promise<{ claim_id: string; status: ClaimStatus; notified: number }> {
  return callRpc('return_progress_claim', { p_claim_id: claimId, p_note: note });
}

export interface VerifyLineInput {
  line_id: string;
  verified_pct: StagePct;
  regress_reason?: string | null;
}

export interface VerifyClaimResult {
  claim_id: string;
  status: ClaimStatus;
  lines: number;
  entries: number;
  regressions: number;
  notified: number;
}

export async function verifyClaim(claimId: string, lines: VerifyLineInput[], note?: string | null): Promise<VerifyClaimResult> {
  return callRpc<VerifyClaimResult>('verify_progress_claim', { p_claim_id: claimId, p_lines: lines, p_note: note ?? null });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/progressClaimsData.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/progressClaims/claims.ts tools/__tests__/progressClaimsData.test.ts
git commit -m "feat(progress): data access for stage weights and weekly claims"
```

---

### Task 10: Notification routing for claim deeplinks

**Files:**
- Modify: `tools/notificationRouting.ts`
- Test: `tools/__tests__/notificationRouting.test.ts`

`PROGRESS_CLAIM_SUBMITTED` deeplinks `ProgressClaimVerify` (office Reports, Klaim section); `PROGRESS_CLAIM_RETURNED` and `_VERIFIED` deeplink `ProgressClaim` (supervisor Progres tab). Each navigator registers a different route, so the resolver maps them per role.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/notificationRouting.test.ts` (apply this change):

```diff
diff --git a/tools/__tests__/notificationRouting.test.ts b/tools/__tests__/notificationRouting.test.ts
index 153ccea..ce27c5a 100644
--- a/tools/__tests__/notificationRouting.test.ts
+++ b/tools/__tests__/notificationRouting.test.ts
@@ -83,3 +83,24 @@ describe('resolveNotificationRoute - SiteEventDetail', () => {
     }
   });
 });
+
+// ── Progress claims (2026-09-14 report-driven progress, migration 104) ─────
+describe('resolveNotificationRoute - progress claims', () => {
+  it('declares both claim deeplinks', () => {
+    expect(KNOWN_DEEPLINK_SCREENS).toEqual(expect.arrayContaining(['ProgressClaimVerify', 'ProgressClaim']));
+  });
+
+  it('sends a submitted claim to Reports for office roles and to Laporan for a supervisor', () => {
+    for (const role of ['estimator', 'admin', 'principal', undefined, null]) {
+      expect(resolveNotificationRoute('ProgressClaimVerify', role)).toBe('Reports');
+    }
+    expect(resolveNotificationRoute('ProgressClaimVerify', 'supervisor')).toBe('Laporan');
+  });
+
+  it('sends a returned or verified claim to Progres for a supervisor and to Reports elsewhere', () => {
+    expect(resolveNotificationRoute('ProgressClaim', 'supervisor')).toBe('Progres');
+    for (const role of ['estimator', 'admin', 'principal', undefined, null]) {
+      expect(resolveNotificationRoute('ProgressClaim', role)).toBe('Reports');
+    }
+  });
+});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/notificationRouting.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — the three new progress-claim cases fail (`ProgressClaimVerify` is not declared).

- [ ] **Step 3: Write the implementation**

`tools/notificationRouting.ts` (apply this change):

```diff
diff --git a/tools/notificationRouting.ts b/tools/notificationRouting.ts
index 8e235e1..c6a1206 100644
--- a/tools/notificationRouting.ts
+++ b/tools/notificationRouting.ts
@@ -41,6 +41,13 @@ const BASE_ROUTE_MAP: Record<string, string> = {
   // registered under this exact name in all three navigators, so it maps to
   // itself; listed so the deeplink is declared rather than implied.
   SiteEventDetail: 'SiteEventDetail',
+  // PROGRESS_CLAIM_SUBMITTED (migration 104 submit_progress_claim) reaches the
+  // estimators: the Verifikasi Klaim section of the office Reports tab, which
+  // reads deeplink_params.initialSection = 'klaim'.
+  ProgressClaimVerify: 'Reports',
+  // PROGRESS_CLAIM_RETURNED / PROGRESS_CLAIM_VERIFIED (104) reach whoever
+  // submitted: the supervisor's Progres tab, which reads module = 'progress'.
+  ProgressClaim: 'Progres',
 };
 
 /** Every deeplink_screen a server-side notification is known to use. */
@@ -55,5 +62,10 @@ export function resolveNotificationRoute(
   // Permintaan tab. Keyed on the resolved route (not notification type) so
   // any current or future type that deeplinks to Approvals is covered.
   if (role === 'supervisor' && target === 'Approvals') return 'Permintaan';
+  // The supervisor navigator registers Progres and Laporan; the office and
+  // principal navigators register Reports instead. Both claim deeplinks carry
+  // initialSection = 'klaim', which Laporan and Reports both read.
+  if (role === 'supervisor' && target === 'Reports') return 'Laporan';
+  if (role !== 'supervisor' && target === 'Progres') return 'Reports';
   return target;
 }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/notificationRouting.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/notificationRouting.ts tools/__tests__/notificationRouting.test.ts
git commit -m "feat(notifications): route progress-claim deeplinks per role"
```

---

### Task 11: Migration 103: stage weights

**Files:**
- Create: `supabase/migrations/103_boq_stage_weights.sql`
- Test: `tools/__tests__/migration103.test.ts`

`boq_stage_weights` with a read policy only, and three writers: `seed_reference_stage_weights` (supervisor, estimator, admin; class only; insert-only), `set_boq_stage_weights` and `reset_boq_stage_weights` (estimator, admin). `progress_actor_role` is the shared membership and role check that 104 reuses. Behaviour is rehearsed in Task 12, once both migrations exist.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/migration103.test.ts` (new file):

```ts
/**
 * Static guard for migration 103 (stage weights per BoQ row).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so the header or the self-check can never satisfy a guard the SQL
 * fails. Behaviour as real roles is rehearsed on Postgres by
 * supabase/tests/progress_claims_rehearsal/run.sh.
 *
 *  • reference_stage_weights() holds the generated profile, class for class,
 *    so the app and the database never apply different weights to one row.
 *  • The client sends a class, never numbers, and seeding never overwrites.
 *  • Every refusal code has an Indonesian sentence in claimRules.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLAIM_RPC_ERROR_COPY } from '../progressClaims/claimRules';
import { REFERENCE_PROFILE } from '../progressClaims/referenceStageWeights.data';
import { WEIGHT_SUM_TOLERANCE, referenceWeightsFor } from '../progressClaims/stageWeights';
import { WORK_AREA_CLASSES } from '../progressClaims/workAreaClass';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '103_boq_stage_weights.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL);

function fnBody(name: string): string {
  const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined in ${FILE}`);
  const open = CODE.indexOf('$$', start);
  const close = CODE.indexOf('$$;', open + 2);
  return CODE.slice(start, close + 3);
}

const WRITERS = ['seed_reference_stage_weights', 'set_boq_stage_weights', 'reset_boq_stage_weights'];

describe('migration 103 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-13-report-driven-progress-design\.md/);
    expect(SQL).toMatch(/2026-09-14-report-driven-progress-plan-b\.md/);
  });

  it('names its place in the paste order, after 102 and before 104', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 102\./);
    expect(SQL).toMatch(/paste 104 after this file/);
  });

  it('says what makes a second paste safe and names this suite', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/migration103\.test\.ts/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting; writes nothing\)/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(6);
  });
});

describe('migration 103 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid showing each function, its security mode and that anon cannot run it', () => {
    expect(CODE.trimEnd()).toMatch(
      /SELECT proname, prosecdef, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname IN \([^)]*\)\s+ORDER BY proname;$/,
    );
  });
});

describe('migration 103 - a second paste cannot fail', () => {
  it('creates its table only when missing and never drops a table or function', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS boq_stage_weights \(/);
    expect(CODE).not.toMatch(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(CODE).not.toMatch(/\bDROP\s+(?:TABLE|FUNCTION)\b/i);
  });

  it('defines all eight functions with CREATE OR REPLACE', () => {
    const all = CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? [];
    expect(all).toHaveLength(8);
    expect(CODE.match(/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/gi) ?? []).toHaveLength(8);
  });

  it('drops its one policy before creating it', () => {
    const drop = CODE.indexOf('DROP POLICY IF EXISTS boq_stage_weights_select ON boq_stage_weights;');
    const create = CODE.indexOf('CREATE POLICY boq_stage_weights_select ON boq_stage_weights');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });
});

describe('migration 103 - the reference profile is the generated one', () => {
  const body = fnBody('reference_stage_weights');
  const sqlProfile: Record<string, unknown> = Object.fromEntries(
    [...body.matchAll(/WHEN '(\w+)'\s+THEN '(\{[^']+\})'::jsonb/g)].map((m) => [m[1], JSON.parse(m[2]) as unknown]),
  );

  it('names every work-area class once and nothing else', () => {
    expect(Object.keys(sqlProfile).sort()).toEqual([...WORK_AREA_CLASSES].sort());
  });

  it('gives each class exactly the weights the app applies', () => {
    for (const cls of WORK_AREA_CLASSES) {
      expect({ cls, weights: sqlProfile[cls] }).toEqual({ cls, weights: referenceWeightsFor(cls, REFERENCE_PROFILE) });
    }
  });

  it('returns NULL for an unknown class, so a caller cannot invent one', () => {
    expect(body).toMatch(/ELSE NULL\s+END;/);
  });
});

describe('migration 103 - the shape rule matches validateStageWeights', () => {
  const body = fnBody('stage_weights_valid');

  it('accepts SINGLE only as the number 1', () => {
    expect(body).toMatch(/= ARRAY\['SINGLE'\] THEN\s+CASE WHEN jsonb_typeof\(p_weights -> 'SINGLE'\) = 'number'\s+THEN \(p_weights ->> 'SINGLE'\)::numeric = 1/);
  });

  it('requires exactly the three stages, each 0 to 1, summing to 1 within the app tolerance', () => {
    expect(body).toMatch(/= ARRAY\['BEKISTING', 'PEMBESIAN', 'PENGECORAN'\] THEN/);
    expect(body).toMatch(/BETWEEN 0 AND 1\)/);
    expect(body).toContain(`- 1) <= ${WEIGHT_SUM_TOLERANCE}`);
    expect(CODE).toMatch(/CONSTRAINT boq_stage_weights_shape CHECK \(stage_weights_valid\(weights\)\)/);
  });

  it('is a pure function', () => {
    expect(body).toMatch(/LANGUAGE sql IMMUTABLE/);
  });
});

describe('migration 103 - who may write weights', () => {
  it('runs the actor check and every writer as SECURITY DEFINER with search_path pinned', () => {
    for (const fn of ['progress_actor_role', ...WRITERS]) {
      expect(fnBody(fn)).toMatch(/SECURITY DEFINER SET search_path = public/);
    }
  });

  it('refuses a session-less caller outright, service role included', () => {
    const body = fnBody('progress_actor_role');
    expect(body).toMatch(/IF v_uid IS NULL THEN\s+RAISE EXCEPTION 'CLAIM_AUTH:/);
    expect(body).not.toMatch(/service_role/);
  });

  it('checks membership or office role before the role list', () => {
    const body = fnBody('progress_actor_role');
    const member = body.indexOf('IF NOT (is_project_member(p_project_id) OR is_office_role()) THEN');
    const role = body.indexOf('IF v_role IS NULL OR NOT (v_role = ANY (p_allowed_roles)) THEN');
    expect(member).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(member);
  });

  it('lets supervisors seed but only estimators and admins set or reset', () => {
    expect(fnBody('seed_reference_stage_weights')).toContain("PERFORM progress_actor_role(p_project_id, ARRAY['supervisor', 'estimator', 'admin']);");
    for (const fn of ['set_boq_stage_weights', 'reset_boq_stage_weights']) {
      expect(fnBody(fn)).toContain("PERFORM progress_actor_role(v_item.project_id, ARRAY['estimator', 'admin']);");
    }
  });

  it('seeds from a class only and never overwrites a row', () => {
    const body = fnBody('seed_reference_stage_weights');
    expect(body).toContain('v_weights := reference_stage_weights(v_class);');
    expect(body).toContain('ON CONFLICT DO NOTHING;');
    expect(body).not.toMatch(/DO UPDATE/);
    expect(body).not.toMatch(/->>?\s*'weights'/);
  });

  it('refuses a row of another project or a superseded row', () => {
    expect(fnBody('seed_reference_stage_weights')).toContain('v_item.project_id <> p_project_id OR v_item.superseded_at IS NOT NULL');
    for (const fn of ['set_boq_stage_weights', 'reset_boq_stage_weights']) {
      expect(fnBody(fn)).toMatch(/IF v_item\.superseded_at IS NOT NULL THEN\s+RAISE EXCEPTION 'CLAIM_ROW:/);
      expect(fnBody(fn)).toContain('VALUES (v_item.project_id, v_item.id,');
    }
  });

  it('gives the table a read policy and no write policy', () => {
    expect(CODE.match(/\bCREATE POLICY\b/g) ?? []).toHaveLength(1);
    expect(CODE).toMatch(
      /CREATE POLICY boq_stage_weights_select ON boq_stage_weights\s+FOR SELECT TO authenticated\s+USING \(is_project_member\(project_id\) OR is_office_role\(\)\);/,
    );
  });
});

describe('migration 103 - privileges', () => {
  it.each([
    'stage_weights_valid(JSONB)',
    'reference_stage_weights(TEXT)',
    'seed_reference_stage_weights(UUID, JSONB)',
    'set_boq_stage_weights(UUID, JSONB)',
    'reset_boq_stage_weights(UUID, TEXT)',
  ])('revokes %s from PUBLIC and anon, then grants authenticated and service_role', (sig) => {
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('keeps the actor check away from every client role', () => {
    expect(CODE).toContain('REVOKE ALL ON FUNCTION progress_actor_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;');
    expect(CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION progress_actor_role\(UUID, TEXT\[\]\) TO [^;]*authenticated/);
  });
});

describe('migration 103 - refusals the app can explain', () => {
  it('raises only codes that claimRules.ts turns into a sentence', () => {
    const copy = new Set(CLAIM_RPC_ERROR_COPY.map(([code]) => code));
    const raised = [...new Set([...CODE.matchAll(/RAISE EXCEPTION '([A-Z_]+):/g)].map((m) => m[1]))];
    expect(raised.length).toBeGreaterThan(0);
    expect(raised.filter((code) => !copy.has(code))).toEqual([]);
  });
});

describe('migration 103 - nothing later reverts it', () => {
  it('no migration above 103 redefines a 103 function other than the shared inlined helpers', () => {
    const names = ['progress_actor_role', 'stage_weights_valid', 'reference_stage_weights', ...WRITERS];
    const re = new RegExp(
      `\\b(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+)FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?(?:${names.join('|')})\\b`,
      'i',
    );
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 103);
    expect(later.filter((f) => re.test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/migration103.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `ENOENT: no such file or directory` for `103_boq_stage_weights.sql`.

- [ ] **Step 3: Write the implementation**

`supabase/migrations/103_boq_stage_weights.sql` (new file):

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 103_boq_stage_weights.sql
--
-- Spec: docs/superpowers/specs/2026-09-13-report-driven-progress-design.md §5.3, §7, §17, §18
-- Plan: docs/superpowers/plans/2026-09-14-report-driven-progress-plan-b.md (Task 8)
--
-- WHY. A weekly progress claim (migration 104) is a percent per construction
-- stage of a work-area row: bekisting, pembesian, pengecoran. Turning those
-- percents into an installed quantity needs the share of the row's value each
-- stage carries. Neither live project stores it (both are simplified-input
-- publishes with no costs, spec §17), so this file adds:
--   * boq_stage_weights: one row per BoQ row with the weights, their source
--     (reference or manual now; rab and input_sheet later) and, for reference
--     weights, the class they came from.
--   * seed_reference_stage_weights(project, rows): a supervisor, estimator or
--     admin fills rows that have NO weights yet with the reference profile of
--     a class. The client sends only the class. The numbers live in
--     reference_stage_weights() below, pinned to
--     tools/progressClaims/referenceStageWeights.data.ts by
--     tools/__tests__/migration103.test.ts. It never overwrites a row.
--   * set_boq_stage_weights(row, weights): estimator or admin, source manual.
--   * reset_boq_stage_weights(row, class): estimator or admin, back to the
--     reference profile of a class.
-- Nothing here writes progress. A row without weights cannot be claimed (104
-- refuses it), so no percent is ever turned into quantity with guessed weights.
--
-- PASTE ORDER. After 102. Needs projects, profiles, project_assignments and
-- boq_items (001, 074). Migration 104 adds a trigger to this table and calls
-- progress_actor_role(), so paste 104 after this file.
--
-- RE-PASTE SAFETY. CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS before CREATE POLICY, REVOKE before GRANT: a second
-- paste changes nothing. The reference numbers are data inside a function
-- body. When the profile is regenerated, update this file in the same change
-- (tools/__tests__/migration103.test.ts fails until you do) and re-paste it.
-- Stored rows keep the numbers they were seeded with until an estimator
-- resets them.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 096 / 102 pattern)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION is_project_member(UUID) TO authenticated;

-- Who may act on a project's progress data. Every progress RPC in 103 and 104
-- calls this first, so the refusals read the same everywhere:
--   CLAIM_AUTH  no session, or a session that is neither a project member nor
--               an office role;
--   CLAIM_ROLE  a caller whose role is not in p_allowed_roles (the principal
--               reads progress and never writes it).
-- A session-less caller is refused outright, service role included: every
-- progress write carries the name of the person who made it.
CREATE OR REPLACE FUNCTION progress_actor_role(p_project_id UUID, p_allowed_roles TEXT[])
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CLAIM_AUTH: sesi tidak dikenali'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (is_project_member(p_project_id) OR is_office_role()) THEN
    RAISE EXCEPTION 'CLAIM_AUTH: Anda tidak ditugaskan ke proyek ini'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR NOT (v_role = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'CLAIM_ROLE: peran % tidak dapat melakukan aksi ini', COALESCE(v_role, '-')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_role;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Weight shape and the reference profile (pure)
-- ───────────────────────────────────────────────────────────────────────────

-- The accepted shapes, identical to validateStageWeights in
-- tools/progressClaims/stageWeights.ts: {"SINGLE": 1}, or exactly BEKISTING,
-- PEMBESIAN and PENGECORAN, each a number from 0 to 1, summing to 1 ± 0.001.
-- Nested CASE, not AND: SQL does not promise to short-circuit, and casting a
-- JSON string to numeric would raise instead of returning false.
CREATE OR REPLACE FUNCTION stage_weights_valid(p_weights JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_weights IS NULL OR jsonb_typeof(p_weights) <> 'object' THEN false
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_weights) AS k) = ARRAY['SINGLE'] THEN
      CASE WHEN jsonb_typeof(p_weights -> 'SINGLE') = 'number'
           THEN (p_weights ->> 'SINGLE')::numeric = 1
           ELSE false END
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_weights) AS k) = ARRAY['BEKISTING', 'PEMBESIAN', 'PENGECORAN'] THEN
      CASE WHEN (SELECT bool_and(jsonb_typeof(v) = 'number') FROM jsonb_each(p_weights) AS e(k, v))
           THEN (SELECT bool_and((v #>> '{}')::numeric BETWEEN 0 AND 1) FROM jsonb_each(p_weights) AS e(k, v))
                AND abs((SELECT sum((v #>> '{}')::numeric) FROM jsonb_each(p_weights) AS e(k, v)) - 1) <= 0.001
           ELSE false END
    ELSE false
  END;
$$;

-- Reference profile per work-area class (spec §17 table). GENERATED numbers:
-- copy them from tools/progressClaims/referenceStageWeights.data.ts, never by
-- hand. Classes the RABs do not price by stage are {"SINGLE": 1}, the same as
-- referenceWeightsFor() in tools/progressClaims/stageWeights.ts.
CREATE OR REPLACE FUNCTION reference_stage_weights(p_class TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE p_class
    WHEN 'PILECAP_SLOOF_PLAT_DASAR' THEN '{"BEKISTING": 0.131, "PEMBESIAN": 0.476, "PENGECORAN": 0.393}'::jsonb
    WHEN 'KOLOM'                    THEN '{"BEKISTING": 0.326, "PEMBESIAN": 0.486, "PENGECORAN": 0.188}'::jsonb
    WHEN 'BALOK_PLAT'               THEN '{"BEKISTING": 0.368, "PEMBESIAN": 0.38, "PENGECORAN": 0.252}'::jsonb
    WHEN 'DINDING'                  THEN '{"BEKISTING": 0.312, "PEMBESIAN": 0.356, "PENGECORAN": 0.332}'::jsonb
    WHEN 'TANGGA'                   THEN '{"SINGLE": 1}'::jsonb
    WHEN 'BOREDPILE'                THEN '{"SINGLE": 1}'::jsonb
    WHEN 'LAINNYA'                  THEN '{"SINGLE": 1}'::jsonb
    ELSE NULL
  END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. boq_stage_weights
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boq_stage_weights (
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id     UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  weights         JSONB NOT NULL,
  source          TEXT NOT NULL,
  reference_class TEXT,
  basis           JSONB,
  updated_by      UUID REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, boq_item_id),
  CONSTRAINT boq_stage_weights_item_unique UNIQUE (boq_item_id),
  CONSTRAINT boq_stage_weights_shape CHECK (stage_weights_valid(weights)),
  CONSTRAINT boq_stage_weights_source CHECK (source IN ('rab', 'input_sheet', 'reference', 'manual')),
  CONSTRAINT boq_stage_weights_reference_class CHECK ((source = 'reference') = (reference_class IS NOT NULL))
);

-- Read for members and office roles. No write policy at all: every write goes
-- through the three functions below, which derive project_id from the row.
ALTER TABLE boq_stage_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boq_stage_weights_select ON boq_stage_weights;
CREATE POLICY boq_stage_weights_select ON boq_stage_weights
  FOR SELECT TO authenticated
  USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Writers
-- ───────────────────────────────────────────────────────────────────────────

-- p_rows: [{"boq_item_id": "<uuid>", "reference_class": "KOLOM"}, ...].
-- Insert-only: a row that already has weights (reference or manual) is left
-- untouched, so a supervisor opening the claim form can never undo an
-- estimator's decision. Returns the number of rows inserted.
CREATE OR REPLACE FUNCTION seed_reference_stage_weights(p_project_id UUID, p_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_entry    JSONB;
  v_item     boq_items%ROWTYPE;
  v_class    TEXT;
  v_weights  JSONB;
  v_count    INTEGER;
  v_inserted INTEGER := 0;
BEGIN
  PERFORM progress_actor_role(p_project_id, ARRAY['supervisor', 'estimator', 'admin']);

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'WEIGHTS_INVALID: daftar baris harus berupa array';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_class := v_entry ->> 'reference_class';
    v_weights := reference_stage_weights(v_class);
    IF v_weights IS NULL THEN
      RAISE EXCEPTION 'WEIGHTS_CLASS: kelas referensi % tidak dikenal', COALESCE(v_class, '-');
    END IF;

    IF COALESCE(v_entry ->> 'boq_item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % tidak dikenal', COALESCE(v_entry ->> 'boq_item_id', '-');
    END IF;
    SELECT * INTO v_item FROM boq_items WHERE id = (v_entry ->> 'boq_item_id')::uuid;
    IF NOT FOUND OR v_item.project_id <> p_project_id OR v_item.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % bukan baris aktif proyek ini', v_entry ->> 'boq_item_id';
    END IF;

    INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source, reference_class, updated_by)
    VALUES (p_project_id, v_item.id, v_weights, 'reference', v_class, v_uid)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_inserted := v_inserted + v_count;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION set_boq_stage_weights(p_boq_item_id UUID, p_weights JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_item boq_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM boq_items WHERE id = p_boq_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % tidak ditemukan', p_boq_item_id;
  END IF;
  PERFORM progress_actor_role(v_item.project_id, ARRAY['estimator', 'admin']);
  IF v_item.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', v_item.code;
  END IF;
  IF NOT stage_weights_valid(p_weights) THEN
    RAISE EXCEPTION 'WEIGHTS_INVALID: %', COALESCE(p_weights::text, 'null');
  END IF;

  INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source, reference_class, basis, updated_by, updated_at)
  VALUES (v_item.project_id, v_item.id, p_weights, 'manual', NULL, NULL, v_uid, now())
  ON CONFLICT (project_id, boq_item_id) DO UPDATE
    SET weights         = EXCLUDED.weights,
        source          = 'manual',
        reference_class = NULL,
        updated_by      = EXCLUDED.updated_by,
        updated_at      = now();

  RETURN jsonb_build_object('boq_item_id', v_item.id, 'weights', p_weights, 'source', 'manual');
END;
$$;

CREATE OR REPLACE FUNCTION reset_boq_stage_weights(p_boq_item_id UUID, p_reference_class TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_item    boq_items%ROWTYPE;
  v_weights JSONB := reference_stage_weights(p_reference_class);
BEGIN
  SELECT * INTO v_item FROM boq_items WHERE id = p_boq_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % tidak ditemukan', p_boq_item_id;
  END IF;
  PERFORM progress_actor_role(v_item.project_id, ARRAY['estimator', 'admin']);
  IF v_item.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', v_item.code;
  END IF;
  IF v_weights IS NULL THEN
    RAISE EXCEPTION 'WEIGHTS_CLASS: kelas referensi % tidak dikenal', COALESCE(p_reference_class, '-');
  END IF;

  INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source, reference_class, basis, updated_by, updated_at)
  VALUES (v_item.project_id, v_item.id, v_weights, 'reference', p_reference_class, NULL, v_uid, now())
  ON CONFLICT (project_id, boq_item_id) DO UPDATE
    SET weights         = EXCLUDED.weights,
        source          = 'reference',
        reference_class = EXCLUDED.reference_class,
        basis           = NULL,
        updated_by      = EXCLUDED.updated_by,
        updated_at      = now();

  RETURN jsonb_build_object('boq_item_id', v_item.id, 'weights', v_weights, 'source', 'reference', 'reference_class', p_reference_class);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Privileges: anon reaches nothing; the actor check is internal only
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION progress_actor_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION progress_actor_role(UUID, TEXT[]) TO service_role;

REVOKE ALL ON FUNCTION stage_weights_valid(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_weights_valid(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION reference_stage_weights(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reference_stage_weights(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION seed_reference_stage_weights(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION seed_reference_stage_weights(UUID, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION set_boq_stage_weights(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_boq_stage_weights(UUID, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION reset_boq_stage_weights(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reset_boq_stage_weights(UUID, TEXT) TO authenticated, service_role;

RESET lock_timeout;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; writes nothing)
--
-- 1. The table and its rules landed:
--      SELECT conname FROM pg_constraint
--      WHERE conrelid = 'public.boq_stage_weights'::regclass ORDER BY 1;
--    EXPECTED: eight rows: boq_stage_weights_boq_item_id_fkey,
--    boq_stage_weights_item_unique, boq_stage_weights_pkey,
--    boq_stage_weights_project_id_fkey, boq_stage_weights_reference_class,
--    boq_stage_weights_shape, boq_stage_weights_source,
--    boq_stage_weights_updated_by_fkey.
--
-- 2. Members read, nobody writes directly:
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'boq_stage_weights';
--    EXPECTED: one row, boq_stage_weights_select, SELECT.
--
-- 3. The reference profile matches spec §17:
--      SELECT c, reference_stage_weights(c)
--      FROM unnest(ARRAY['PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING',
--                        'TANGGA', 'BOREDPILE', 'LAINNYA']) AS c;
--    EXPECTED: 13.1/47.6/39.3, 32.6/48.6/18.8, 36.8/38/25.2, 31.2/35.6/33.2
--    as fractions, then three {"SINGLE": 1}.
--
-- 4. The shape rule:
--      SELECT stage_weights_valid('{"SINGLE": 1}'),
--             stage_weights_valid('{"BEKISTING": 0.5, "PEMBESIAN": 0.3, "PENGECORAN": 0.2}'),
--             stage_weights_valid('{"BEKISTING": 0.5, "PEMBESIAN": 0.3, "PENGECORAN": 0.1}'),
--             stage_weights_valid('{"SINGLE": "1"}');
--    EXPECTED: t, t, f, f.
--
-- 5. A supervisor cannot set manual weights (rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_SUPERVISOR_UUID>","role":"authenticated"}', true);
--        SELECT set_boq_stage_weights('<A_ROW_OF_THEIR_PROJECT>', '{"SINGLE": 1}');
--      ROLLBACK;
--    EXPECTED: ERROR starting CLAIM_ROLE.
--
-- 6. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-4 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname IN ('progress_actor_role', 'stage_weights_valid', 'reference_stage_weights',
                  'seed_reference_stage_weights', 'set_boq_stage_weights', 'reset_boq_stage_weights')
ORDER BY proname;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/migration103.test.ts tools/__tests__/migration096.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 2 suites, 69 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/103_boq_stage_weights.sql tools/__tests__/migration103.test.ts
git commit -m "feat(db): migration 103 stage weights per BoQ row with reference seeding"
```

---

### Task 12: Migration 104: weekly claims, verification and notifications, rehearsed

**Files:**
- Create: `supabase/migrations/104_progress_claims.sql`
- Create: `supabase/tests/progress_claims_rehearsal/fixture.sql`
- Create: `supabase/tests/progress_claims_rehearsal/rehearse_103.sql`
- Create: `supabase/tests/progress_claims_rehearsal/rehearse_104.sql`
- Create: `supabase/tests/progress_claims_rehearsal/run.sh`
- Test: `tools/__tests__/migration104.test.ts`

Claims and lines with read policies only; save, remove, submit, return and verify RPCs; verification as the only writer of progress, writing the difference from existing entries (negative for a correction) so entries always sum to `installed`; the weight shape lock; three notification types on top of 098; the supervisor progress write policies of 002 and 059 dropped. A trigger keeps verification the only writer of `installed` and `progress` (office roles included), the office write access 036 granted on entries and photos becomes read-only, `sync_boq_progress` is revoked, principals hear about claims nobody assigned can verify, and two security-invoker views serve one row per BoQ item. The rehearsal applies 001-102 to a disposable local `supabase/postgres` container and runs the role checks, including every confirmed review finding.

- [ ] **Step 1: Write the failing test**

`tools/__tests__/migration104.test.ts` (new file):

```ts
/**
 * Static guard for migration 104 (the weekly stage claim).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so a comment can never satisfy a guard the SQL fails. Behaviour as
 * real roles (submit, return, verify, corrections, notifications) is
 * rehearsed on Postgres by supabase/tests/progress_claims_rehearsal/run.sh.
 *
 *  • verify_progress_claim is the only writer of progress, and it writes the
 *    difference from the row's existing entries, so their sum always equals
 *    boq_items.installed.
 *  • The notification type list is 098's thirteen plus exactly three.
 *  • The app calls every RPC with the parameter names the SQL declares, and
 *    every refusal code has app copy and the reverse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KNOWN_DEEPLINK_SCREENS } from '../notificationRouting';
import { CLAIM_RPC_ERROR_COPY } from '../progressClaims/claimRules';

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const FILE = '104_progress_claims.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL);
const CODE_103 = stripComments(read('103_boq_stage_weights.sql'));
const FILES = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fnBody(name: string, code = CODE): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = code.indexOf('$$', start);
  const close = code.indexOf('$$;', open + 2);
  return code.slice(start, close + 3);
}

const typeList = (sql: string): string[] => {
  const code = stripComments(sql);
  const at = code.lastIndexOf('ADD CONSTRAINT notifications_type_check');
  const block = code.slice(at, code.indexOf('));', at));
  return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
};

const RPCS: Record<string, { sig: string; roles: string }> = {
  save_progress_claim_line: { sig: 'save_progress_claim_line(UUID, UUID, JSONB, TEXT, JSONB, TEXT)', roles: "ARRAY['supervisor', 'estimator', 'admin']" },
  remove_progress_claim_line: { sig: 'remove_progress_claim_line(UUID)', roles: "ARRAY['supervisor', 'estimator', 'admin']" },
  submit_progress_claim: { sig: 'submit_progress_claim(UUID)', roles: "ARRAY['supervisor', 'estimator', 'admin']" },
  return_progress_claim: { sig: 'return_progress_claim(UUID, TEXT)', roles: "ARRAY['estimator', 'admin']" },
  verify_progress_claim: { sig: 'verify_progress_claim(UUID, JSONB, TEXT)', roles: "ARRAY['estimator', 'admin']" },
};
const HELPERS = ['stage_pct_valid(JSONB, JSONB)', 'stage_pct_round(JSONB)', 'stage_row_fraction(JSONB, JSONB)', 'zero_stage_pct(JSONB)'];
const CLAIM_TYPES = ['PROGRESS_CLAIM_SUBMITTED', 'PROGRESS_CLAIM_RETURNED', 'PROGRESS_CLAIM_VERIFIED'];

describe('migration 104 - header states why, paste order and what a re-paste undoes', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-13-report-driven-progress-design\.md/);
    expect(SQL).toMatch(/2026-09-14-report-driven-progress-plan-b\.md/);
  });

  it('names its place in the paste order, after 103', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 103/);
  });

  it('names what a later re-paste of 098, 059 or 002 undoes', () => {
    expect(SQL).toMatch(/WHAT A LATER RE-PASTE OF AN OLDER FILE UNDOES/);
    for (const f of ['098', '059', '002', '036']) expect(SQL).toMatch(new RegExp(`--\\s+\\* ${f}:`));
  });

  it('says what makes a second paste safe and names this suite', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/migration104\.test\.ts/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting; writes nothing\)/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(12);
  });
});

describe('migration 104 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on the privileges grid', () => {
    expect(CODE.trimEnd()).toMatch(
      /SELECT proname, prosecdef, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname IN \([^)]*\)\s+ORDER BY proname;$/,
    );
  });
});

describe('migration 104 - a second paste cannot fail', () => {
  it('creates tables and indexes only when missing and drops no table or function', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS progress_claims \(/);
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS progress_claim_lines \(/);
    expect(CODE).not.toMatch(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(CODE).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(CODE).not.toMatch(/\bDROP\s+(?:TABLE|FUNCTION)\b/i);
  });

  it('defines every function with CREATE OR REPLACE', () => {
    const all = CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(CODE.match(/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/gi) ?? []).toHaveLength(all.length);
  });

  it('drops every policy and trigger before creating it', () => {
    for (const m of CODE.matchAll(/CREATE POLICY (\w+) ON (\w+)/g)) {
      const drop = CODE.indexOf(`DROP POLICY IF EXISTS ${m[1]} ON ${m[2]};`);
      expect({ policy: m[1], dropFirst: drop > -1 && drop < (m.index ?? 0) }).toEqual({ policy: m[1], dropFirst: true });
    }
    expect(CODE).toMatch(/DROP TRIGGER IF EXISTS boq_stage_weights_shape_lock_trg ON boq_stage_weights;\s+CREATE TRIGGER boq_stage_weights_shape_lock_trg/);
  });

  it('adds the progress_ai_runs foreign key only when it is missing', () => {
    expect(CODE).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'progress_ai_runs_claim_id_fkey'\) THEN/);
  });
});

describe('migration 104 - one claim in progress per project', () => {
  it('enforces it with a partial unique index', () => {
    expect(CODE).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS progress_claims_one_open\s+ON progress_claims \(project_id\) WHERE status IN \('DRAFT', 'SUBMITTED', 'RETURNED'\);/);
  });

  it('dates a claim by the WIB Monday of the week it opened', () => {
    expect(CODE).toMatch(/CONSTRAINT progress_claims_week_monday CHECK \(extract\(isodow FROM week_start\) = 1\)/);
    expect(fnBody('save_progress_claim_line')).toMatch(/v_week\s+DATE := date_trunc\('week', now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date;/);
  });

  it('requires a verifier and a time on every verified claim', () => {
    expect(CODE).toMatch(/CONSTRAINT progress_claims_verified_fields CHECK \(\(status = 'VERIFIED'\) = \(verified_by IS NOT NULL AND verified_at IS NOT NULL\)\)/);
  });
});

describe('migration 104 - the tables are read-only to the app', () => {
  it('has exactly two policies, both SELECT for members and office roles', () => {
    const policies = [...CODE.matchAll(/CREATE POLICY (\w+) ON (\w+)\s+FOR (\w+) TO authenticated\s+USING \(is_project_member\(project_id\) OR is_office_role\(\)\);/g)];
    expect(policies.map((m) => [m[1], m[2], m[3]])).toEqual([
      ['progress_claims_select', 'progress_claims', 'SELECT'],
      ['progress_claim_lines_select', 'progress_claim_lines', 'SELECT'],
    ]);
    expect(CODE.match(/\bCREATE POLICY\b/g) ?? []).toHaveLength(4);
  });
});

describe('migration 104 - the direct supervisor paths into progress close', () => {
  it('drops the supervisor insert policies of 002 and the boq_items progress policy of 059', () => {
    expect(CODE).toContain('DROP POLICY IF EXISTS "progress_entries_assigned_insert" ON progress_entries;');
    expect(CODE).toContain('DROP POLICY IF EXISTS "progress_photos_assigned_insert" ON progress_photos;');
    expect(CODE).toContain('DROP POLICY IF EXISTS "boq_items_assigned_progress_update" ON boq_items;');
  });

  it('turns 036 office access to progress entries and photos into read-only policies', () => {
    for (const t of ['progress_entries', 'progress_photos']) {
      expect(CODE).toContain(`DROP POLICY IF EXISTS ${t}_office_all ON ${t};`);
      expect(CODE).toMatch(new RegExp(`CREATE POLICY ${t}_office_read ON ${t}\\s+FOR SELECT TO authenticated\\s+USING \\(is_office_role\\(\\)\\);`));
    }
  });

  it('revokes sync_boq_progress from every client role', () => {
    expect(CODE).toContain("IF to_regprocedure('public.sync_boq_progress(uuid)') IS NOT NULL THEN");
    expect(CODE).toContain("EXECUTE 'REVOKE ALL ON FUNCTION public.sync_boq_progress(uuid) FROM PUBLIC, anon, authenticated';");
  });

  it('refuses any other change to installed or progress with a trigger only verification unlocks', () => {
    const guard = fnBody('boq_items_progress_single_writer');
    expect(guard).toContain("IF auth.uid() IS NULL OR current_setting('sano.progress_writer', true) IS NOT DISTINCT FROM 'verify' THEN");
    expect(guard).toContain('NEW.installed IS DISTINCT FROM OLD.installed OR NEW.progress IS DISTINCT FROM OLD.progress');
    expect(guard).toMatch(/RAISE EXCEPTION 'PROGRESS_SINGLE_WRITER:/);
    expect(CODE).toMatch(/DROP TRIGGER IF EXISTS boq_items_progress_single_writer_trg ON boq_items;\s+CREATE TRIGGER boq_items_progress_single_writer_trg\s+BEFORE INSERT OR UPDATE ON boq_items/);
    const verify = fnBody('verify_progress_claim');
    const unlock = verify.indexOf("PERFORM set_config('sano.progress_writer', 'verify', true);");
    expect(unlock).toBeGreaterThan(-1);
    expect(verify.indexOf('FOR v_line IN SELECT * FROM progress_claim_lines')).toBeGreaterThan(unlock);
    expect(verify.indexOf("PERFORM set_config('sano.progress_writer', '', true);")).toBeGreaterThan(verify.indexOf('END LOOP;'));
    const names = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]);
    expect(names.filter((n) => fnBody(n).includes("'sano.progress_writer', 'verify'"))).toEqual(['verify_progress_claim']);
    expect(CODE_103).not.toContain('sano.progress_writer');
  });

  it('lets a correction entry be negative but never zero', () => {
    expect(CODE).toMatch(/conrelid = 'public\.progress_entries'::regclass\s+AND con\.contype = 'c'\s+AND pg_get_constraintdef\(con\.oid\) ILIKE '%quantity%'/);
    expect(CODE).toContain('ADD CONSTRAINT progress_entries_quantity_nonzero CHECK (quantity <> 0);');
  });

  it('writes progress only inside verify_progress_claim, and 103 never does', () => {
    const names = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]);
    expect(names.filter((n) => /INSERT INTO progress_entries|UPDATE boq_items\b/.test(fnBody(n)))).toEqual(['verify_progress_claim']);
    expect(CODE_103).not.toMatch(/INSERT INTO progress_entries|UPDATE boq_items\b/);
  });
});

describe('migration 104 - each RPC', () => {
  it.each(Object.entries(RPCS))('%s is SECURITY DEFINER, pins search_path and checks the caller with its roles', (name, { roles }) => {
    const body = fnBody(name);
    expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(body).toMatch(new RegExp(`PERFORM progress_actor_role\\((?:p_project_id|v_claim\\.project_id), ${esc(roles)}\\);`));
  });

  it('locks the claim before reading its status', () => {
    for (const fn of ['submit_progress_claim', 'return_progress_claim', 'verify_progress_claim']) {
      const body = fnBody(fn);
      const lock = body.indexOf('SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;');
      expect(lock).toBeGreaterThan(-1);
      expect(body.indexOf('v_claim.status')).toBeGreaterThan(lock);
    }
    expect(fnBody('remove_progress_claim_line')).toContain('SELECT * INTO v_claim FROM progress_claims WHERE id = v_line.claim_id FOR UPDATE;');
    expect(fnBody('save_progress_claim_line')).toMatch(/WHERE project_id = p_project_id AND status IN \('DRAFT', 'SUBMITTED', 'RETURNED'\)\s+FOR UPDATE;/);
  });

  it('adds to a draft or returned claim only, and verifies or returns a submitted one only', () => {
    expect(fnBody('save_progress_claim_line')).toMatch(/IF v_claim\.status = 'SUBMITTED' THEN\s+RAISE EXCEPTION 'CLAIM_LOCKED:/);
    for (const fn of ['remove_progress_claim_line', 'submit_progress_claim']) {
      expect(fnBody(fn)).toMatch(/IF v_claim\.status NOT IN \('DRAFT', 'RETURNED'\) THEN\s+RAISE EXCEPTION 'CLAIM_STATE:/);
    }
    for (const fn of ['return_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toMatch(/IF v_claim\.status <> 'SUBMITTED' THEN\s+RAISE EXCEPTION 'CLAIM_STATE:/);
    }
  });

  it('refuses rows without weights or planned volume at save, submit and verify', () => {
    for (const fn of ['save_progress_claim_line', 'submit_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toMatch(/RAISE EXCEPTION 'CLAIM_NO_WEIGHTS:/);
      expect(fnBody(fn)).toMatch(/RAISE EXCEPTION 'CLAIM_NO_PLANNED:/);
    }
  });

  it('keeps photos inside the project progress folder, twelve at most', () => {
    const body = fnBody('save_progress_claim_line');
    expect(body).toContain("starts_with(r #>> '{}', 'progress/' || p_project_id::text || '/')");
    expect(body).toContain("position('..' IN r #>> '{}') > 0");
    expect(body).toContain('jsonb_array_length(v_refs) > 12');
  });

  it('needs a reason for any lower figure: a dropped stage at save, and a dropped stage or quantity at verify', () => {
    expect(fnBody('save_progress_claim_line')).toMatch(/IF v_reason IS NULL AND EXISTS \(/);
    const verify = fnBody('verify_progress_claim');
    expect(verify).toContain('v_needs_reason := v_regressed OR v_delta < 0;');
    expect(verify.indexOf('v_delta := v_after - v_before;')).toBeLessThan(verify.indexOf('v_needs_reason := v_regressed OR v_delta < 0;'));
    expect(verify).toMatch(/IF v_needs_reason AND v_reason IS NULL THEN\s+RAISE EXCEPTION 'CLAIM_REGRESS_REASON:/);
  });

  it('needs a note to return a claim', () => {
    expect(fnBody('return_progress_claim')).toMatch(/IF v_note IS NULL THEN\s+RAISE EXCEPTION 'CLAIM_RETURN_NOTE:/);
  });
});

describe('migration 104 - verification', () => {
  const body = fnBody('verify_progress_claim');

  it('never lets the submitter, or anyone who filled a line, verify', () => {
    expect(body).toMatch(/IF v_claim\.submitted_by = v_uid OR EXISTS \(\s+SELECT 1 FROM progress_claim_lines l\s+WHERE l\.claim_id = p_claim_id AND \(l\.created_by = v_uid OR l\.updated_by = v_uid\)\s+\) THEN\s+RAISE EXCEPTION 'CLAIM_SELF_VERIFY:/);
  });

  it('verifies every line of the claim exactly once', () => {
    expect(body).toContain('jsonb_array_length(p_lines) <> v_lines');
    expect(body).toContain("count(DISTINCT e ->> 'line_id')");
    expect(body).toMatch(/RAISE EXCEPTION 'CLAIM_LINES: daftar baris tidak cocok/);
  });

  it('locks each BoQ row before writing it', () => {
    expect(body).toContain('SELECT * INTO v_item FROM boq_items WHERE id = v_line.boq_item_id FOR UPDATE;');
  });

  it('writes the difference from the existing entries, so they always sum to installed', () => {
    expect(body).toContain('SELECT COALESCE(sum(quantity), 0) INTO v_before FROM progress_entries WHERE boq_item_id = v_item.id;');
    expect(body).toContain('v_after := round(v_item.planned * v_frac_new, 4);');
    expect(body).toContain('v_delta := v_after - v_before;');
    expect(body).toMatch(/IF v_delta <> 0 THEN\s+INSERT INTO progress_entries/);
    expect(body).toContain('UPDATE boq_items SET installed = v_after, progress = round(v_frac_new * 100, 1) WHERE id = v_item.id;');
  });

  it('credits the entry to the submitter and attaches the claim photos to increases only', () => {
    expect(body).toContain('v_claim.project_id, v_item.id, v_claim.submitted_by, v_delta, v_item.unit,');
    expect(body).toMatch(/IF v_delta > 0 THEN\s+INSERT INTO progress_photos/);
  });

  it('freezes the weights and records on the line what it wrote', () => {
    expect(body).toMatch(/weights_snapshot\s+= v_weights/);
    expect(body).toMatch(/installed_before\s+= v_before/);
    expect(body).toMatch(/delta_quantity\s+= v_delta/);
    expect(body).toMatch(/progress_entry_id = v_entry_id/);
  });

  it('keeps installed as it stood and logs a mismatch with the entries instead of overwriting it silently', () => {
    expect(CODE).toContain('  installed_cached_before NUMERIC,');
    expect(CODE).toContain('ALTER TABLE progress_claim_lines ADD COLUMN IF NOT EXISTS installed_cached_before NUMERIC;');
    expect(body).toContain('v_cached_before := v_item.installed;');
    expect(body).toMatch(/IF abs\(COALESCE\(v_cached_before, 0\) - v_before\) > 0\.0001 THEN\s+INSERT INTO activity_log/);
    expect(body).toMatch(/installed_cached_before = v_cached_before/);
  });

  it('uses the same percent math as tools/progressClaims/stageMath.ts', () => {
    const frac = fnBody('stage_row_fraction');
    expect(frac).toContain("/ sum((w.v #>> '{}')::numeric)");
    expect(frac).toContain(', 6)');
    expect(fnBody('stage_pct_valid')).toContain('BETWEEN 0 AND 100');
    expect(fnBody('stage_pct_round')).toContain("round((v #>> '{}')::numeric, 1)");
  });
});

describe('migration 104 - notifications', () => {
  it('builds on 098, the latest migration before 104 that swapped the type CHECK', () => {
    const swappers = FILES.filter((f) => Number(f.slice(0, 3)) < 104).filter((f) => read(f).includes('ADD CONSTRAINT notifications_type_check'));
    expect(swappers[swappers.length - 1]).toBe('098_daily_log_room_link.sql');
  });

  it('carries forward every type 098 allowed and adds exactly the three claim types', () => {
    const before = typeList(read('098_daily_log_room_link.sql'));
    expect(before).toHaveLength(13);
    expect(typeList(SQL)).toEqual([...before, ...CLAIM_TYPES]);
  });

  it('drops whichever type CHECK it replaces', () => {
    expect(CODE).toMatch(/conrelid = 'public\.notifications'::regclass\s+AND con\.contype = 'c'\s+AND pg_get_constraintdef\(con\.oid\) ILIKE '%type%'/);
  });

  it.each([
    ['submit_progress_claim', 'enqueue_notification(', "'PROGRESS_CLAIM_SUBMITTED'", "'ProgressClaimVerify',"],
    ['return_progress_claim', 'enqueue_notification_user(', "'PROGRESS_CLAIM_RETURNED'", "'ProgressClaim',"],
    ['verify_progress_claim', 'enqueue_notification_user(', "'PROGRESS_CLAIM_VERIFIED'", "'ProgressClaim',"],
  ])('%s enqueues inside a handler that cannot roll the claim back', (fn, call, type, screen) => {
    const body = fnBody(fn);
    const start = body.indexOf(`PERFORM ${call}`);
    const handler = body.search(new RegExp(`EXCEPTION WHEN OTHERS THEN\\s+RAISE WARNING '${fn}: notification failed: %', SQLERRM;`));
    expect(start).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(start);
    expect(body.slice(0, start).trimEnd().endsWith('BEGIN')).toBe(true);
    expect(body.slice(start, handler)).toContain(type);
    expect(body.slice(start, handler)).toContain(screen);
  });

  it('tells the estimators, or the admins when the project has none, and never the submitter', () => {
    const body = fnBody('submit_progress_claim');
    expect(body).toMatch(/p\.role = 'estimator' AND pa\.user_id <> v_uid\s+\) THEN 'estimator' ELSE 'admin' END;/);
    expect(body).toMatch(/v_uid,\s+-- p_exclude_user_id/);
  });

  it('tells the principals when nobody assigned can verify, and reports both counts', () => {
    const body = fnBody('submit_progress_claim');
    expect(body).toMatch(/IF v_verifiers = 0 THEN\s+PERFORM enqueue_notification\(/);
    expect(body).toMatch(/v_uid,\s+'principal'\s+\);/);
    expect(body).toMatch(/'notified', v_notified, 'verifiers_notified', v_verifiers/);
  });

  it('tells the submitter on return and verify, never the actor', () => {
    for (const fn of ['return_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toMatch(/v_claim\.submitted_by,[\s\S]*ARRAY\[v_uid\],\s+NULL\s+\);/);
    }
  });

  it('uses deeplinks the app declares, carrying the section each navigator reads', () => {
    expect(KNOWN_DEEPLINK_SCREENS).toEqual(expect.arrayContaining(['ProgressClaimVerify', 'ProgressClaim']));
    expect(fnBody('submit_progress_claim')).toContain("jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'initialSection', 'klaim')");
    for (const fn of ['return_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toContain("jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'module', 'progress', 'initialSection', 'klaim')");
    }
  });
});

describe('migration 104 - weights stay consistent with claims', () => {
  it('refuses to switch a claimed row between one and three stages', () => {
    const body = fnBody('boq_stage_weights_shape_lock');
    expect(body).toContain("(NEW.weights ? 'SINGLE') IS DISTINCT FROM (OLD.weights ? 'SINGLE')");
    expect(body).toMatch(/JOIN progress_claims c ON c\.id = l\.claim_id\s+WHERE l\.boq_item_id = NEW\.boq_item_id AND c\.status = 'VERIFIED'/);
    expect(body).toMatch(/RAISE EXCEPTION 'WEIGHTS_SHAPE_LOCKED:/);
    expect(CODE).toMatch(/CREATE TRIGGER boq_stage_weights_shape_lock_trg\s+BEFORE UPDATE OF weights ON boq_stage_weights/);
  });
});

describe('migration 104 - read views', () => {
  it.each(['progress_claim_latest_verified', 'progress_entry_totals'])("%s applies the caller's RLS and anon cannot read it", (view) => {
    expect(CODE).toMatch(new RegExp(`CREATE OR REPLACE VIEW ${view} WITH \\(security_invoker = on\\) AS`));
    expect(CODE).toMatch(new RegExp(`REVOKE ALL ON [^;]*\\b${view}\\b[^;]* FROM PUBLIC, anon;`));
    expect(CODE).toMatch(new RegExp(`GRANT SELECT ON [^;]*\\b${view}\\b[^;]* TO authenticated, service_role;`));
  });

  it('keeps one row per BoQ item, the newest verification first', () => {
    expect(CODE).toMatch(/SELECT DISTINCT ON \(l\.boq_item_id\)/);
    expect(CODE).toMatch(/ORDER BY l\.boq_item_id, c\.verified_at DESC, l\.updated_at DESC;/);
  });

  it('never creates a view without OR REPLACE', () => {
    expect(CODE).not.toMatch(/\bCREATE\s+VIEW\b/i);
  });
});

describe('migration 104 - privileges', () => {
  it.each([...Object.values(RPCS).map((r) => r.sig), ...HELPERS])('revokes %s from PUBLIC and anon, then grants authenticated and service_role', (sig) => {
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('keeps the internal lookup and the trigger function away from clients', () => {
    expect(CODE).toContain('REVOKE ALL ON FUNCTION latest_verified_stage_pct(UUID) FROM PUBLIC, anon, authenticated;');
    expect(CODE).toContain('REVOKE ALL ON FUNCTION boq_stage_weights_shape_lock() FROM PUBLIC, anon, authenticated;');
    expect(CODE).toContain('REVOKE ALL ON FUNCTION boq_items_progress_single_writer() FROM PUBLIC, anon, authenticated;');
    expect(CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION latest_verified_stage_pct\(UUID\) TO [^;]*authenticated/);
  });
});

describe('migration 104 - the app and the database agree', () => {
  const CLAIMS_TS = fs.readFileSync(path.join(ROOT, 'tools', 'progressClaims', 'claims.ts'), 'utf8');
  const sqlParams = (name: string, code: string): string[] => {
    const start = code.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    const header = code.slice(start, code.indexOf('RETURNS', start));
    return [...header.matchAll(/\b(p_\w+)\s+[A-Z]/g)].map((m) => m[1]).sort();
  };

  it('calls every claim and weight RPC with exactly the parameters the SQL declares', () => {
    const calls = [...CLAIMS_TS.matchAll(/callRpc(?:<[^>]+>)?\('(\w+)', \{([^}]*)\}/g)];
    expect(calls.map((m) => m[1]).sort()).toEqual(
      [...Object.keys(RPCS), 'reset_boq_stage_weights', 'seed_reference_stage_weights', 'set_boq_stage_weights'].sort(),
    );
    for (const [, name, args] of calls) {
      const code = name.includes('stage_weights') ? CODE_103 : CODE;
      expect({ name, params: [...args.matchAll(/\b(p_\w+):/g)].map((m) => m[1]).sort() }).toEqual({ name, params: sqlParams(name, code) });
    }
  });

  it('raises exactly the codes claimRules.ts explains, across 103 and 104', () => {
    const raised = [...new Set([...`${CODE_103}\n${CODE}`.matchAll(/RAISE EXCEPTION '([A-Z_]+):/g)].map((m) => m[1]))].sort();
    expect(raised).toEqual(CLAIM_RPC_ERROR_COPY.map(([code]) => code).sort());
  });
});

describe('migration 104 - nothing later reverts it', () => {
  it('no migration above 104 redefines a claim function', () => {
    const names = [...Object.keys(RPCS), 'stage_pct_valid', 'stage_pct_round', 'stage_row_fraction', 'zero_stage_pct', 'latest_verified_stage_pct', 'boq_stage_weights_shape_lock'];
    const re = new RegExp(`\\b(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+)FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?(?:${names.join('|')})\\b`, 'i');
    const later = FILES.filter((f) => Number(f.slice(0, 3)) > 104);
    expect(later.filter((f) => re.test(stripComments(read(f))))).toEqual([]);
  });

  it('a later swap of the notification type CHECK keeps the three claim types', () => {
    const later = FILES.filter((f) => Number(f.slice(0, 3)) > 104 && read(f).includes('ADD CONSTRAINT notifications_type_check'));
    for (const f of later) expect(typeList(read(f))).toEqual(expect.arrayContaining(CLAIM_TYPES));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tools/__tests__/migration104.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `ENOENT: no such file or directory` for `104_progress_claims.sql`.

- [ ] **Step 3: Write the implementation**

`supabase/migrations/104_progress_claims.sql` (new file):

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 104_progress_claims.sql
--
-- Spec: docs/superpowers/specs/2026-09-13-report-driven-progress-design.md §5.4, §5.5, §6.2, §11, §16, §18
-- Plan: docs/superpowers/plans/2026-09-14-report-driven-progress-plan-b.md (Task 9)
--
-- WHY. Tambah progres becomes a weekly stage claim per work area (spec §16),
-- and nothing counts until an estimator verifies it. This file adds:
--   * progress_claims: one claim in progress per project, DRAFT, then
--     SUBMITTED, then VERIFIED or back to RETURNED. week_start is the WIB
--     Monday of the week the claim was opened.
--   * progress_claim_lines: per work-area row, the supervisor's percent per
--     stage, the estimator's verified percent, and what verification wrote.
--   * save_progress_claim_line, remove_progress_claim_line,
--     submit_progress_claim, return_progress_claim, verify_progress_claim:
--     the only doors in. Both tables have read policies only.
--   * verify_progress_claim is the only writer of progress. Per line it sets
--     boq_items.installed to planned x row fraction and progress to the row
--     fraction in percent, and records the change as one progress_entries row
--     whose quantity is the difference from the sum of the row's existing
--     entries. A lower figure becomes a negative correction entry carrying its
--     reason. The entries of a claimed row therefore always sum to
--     boq_items.installed, and every reader of either agrees (spec §18).
--   * Three notification types: PROGRESS_CLAIM_SUBMITTED to the project's
--     estimators other than the submitter (its admins when it has none, and
--     its principals when it has neither, so someone can assign a verifier),
--     PROGRESS_CLAIM_RETURNED and PROGRESS_CLAIM_VERIFIED to the submitter.
--   * Progress gets exactly one writer. The supervisor insert policies on
--     progress_entries and progress_photos (002) and the supervisor progress
--     policy on boq_items (059) are dropped; 036's office FOR ALL policies on
--     progress_entries and progress_photos become read-only; 002's
--     sync_boq_progress() is revoked; and a trigger refuses any change to
--     boq_items.installed or progress unless verify_progress_claim marked its
--     own transaction. Office roles still edit every other boq_items column,
--     which publishing a BoQ needs. progress_entries.quantity may now be
--     negative but never 0.
--   * A row's weights cannot switch between one stage and three once the row
--     has a VERIFIED claim line. An open line is re-checked against the
--     current weights at submit and verify instead, so an estimator can still
--     correct a shape a supervisor seeded.
--   * Two read views with one row per BoQ item (latest verified percents,
--     entry totals), so the claim screens never meet PostgREST's row cap.
--
-- PASTE ORDER. After 103 (progress_actor_role, boq_stage_weights) and 102
-- (progress_ai_runs). It re-creates the notifications type CHECK as 098's
-- thirteen types plus three.
--
-- WHAT A LATER RE-PASTE OF AN OLDER FILE UNDOES. Re-paste 104 after any of:
--   * 098: the three claim types leave the CHECK and every claim notification
--     is dropped with only a WARNING (self-check 4 shows it).
--   * 059: supervisors can write boq_items.installed and progress directly
--     again (self-check 3 shows it).
--   * 002: supervisors can insert progress_entries and progress_photos
--     directly again (self-check 3 shows it).
--   * 036: office roles regain full write access to progress_entries and
--     progress_photos (self-check 3 shows it).
--
-- RE-PASTE SAFETY. CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, DROP POLICY / TRIGGER IF EXISTS before CREATE, and constraint swaps
-- inside DO blocks that drop whichever CHECK they replace: a second paste
-- changes nothing. tools/__tests__/migration104.test.ts pins the rules below.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 096 / 102 / 103 pattern)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION is_project_member(UUID) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS progress_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start    DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  created_by    UUID NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by  UUID REFERENCES profiles(id),
  submitted_at  TIMESTAMPTZ,
  returned_by   UUID REFERENCES profiles(id),
  returned_at   TIMESTAMPTZ,
  return_note   TEXT,
  verified_by   UUID REFERENCES profiles(id),
  verified_at   TIMESTAMPTZ,
  verifier_note TEXT,
  ai_run_id     UUID REFERENCES progress_ai_runs(id) ON DELETE SET NULL,
  CONSTRAINT progress_claims_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED')),
  CONSTRAINT progress_claims_week_monday CHECK (extract(isodow FROM week_start) = 1),
  CONSTRAINT progress_claims_submitted_fields CHECK (status = 'DRAFT' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CONSTRAINT progress_claims_verified_fields CHECK ((status = 'VERIFIED') = (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

-- One claim in progress per project: the supervisor always edits the same
-- draft, and verification never races a second claim over the same rows.
CREATE UNIQUE INDEX IF NOT EXISTS progress_claims_one_open
  ON progress_claims (project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED');
CREATE INDEX IF NOT EXISTS idx_progress_claims_project_week
  ON progress_claims (project_id, week_start DESC);

CREATE TABLE IF NOT EXISTS progress_claim_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          UUID NOT NULL REFERENCES progress_claims(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_item_id       UUID NOT NULL REFERENCES boq_items(id),
  prev_verified     JSONB NOT NULL,
  claimed_pct       JSONB NOT NULL,
  verified_pct      JSONB,
  weights_snapshot  JSONB,
  row_pct_prev      NUMERIC,
  row_pct_new       NUMERIC,
  installed_before  NUMERIC,
  installed_cached_before NUMERIC,
  delta_quantity    NUMERIC,
  regress_reason    TEXT,
  note              TEXT,
  evidence          JSONB NOT NULL DEFAULT '{"photo_refs": [], "report_line_ids": []}'::jsonb,
  flags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_pct            JSONB,
  ai_confidence     TEXT,
  ai_quotes         JSONB,
  ai_flags          JSONB,
  ai_run_id         UUID REFERENCES progress_ai_runs(id) ON DELETE SET NULL,
  progress_entry_id UUID REFERENCES progress_entries(id) ON DELETE SET NULL,
  created_by        UUID NOT NULL REFERENCES profiles(id),
  updated_by        UUID NOT NULL REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT progress_claim_lines_claim_row UNIQUE (claim_id, boq_item_id),
  CONSTRAINT progress_claim_lines_evidence CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_progress_claim_lines_row ON progress_claim_lines (boq_item_id);
CREATE INDEX IF NOT EXISTS idx_progress_claim_lines_project ON progress_claim_lines (project_id);
-- A database that ran an earlier draft of this file lacks the column.
ALTER TABLE progress_claim_lines ADD COLUMN IF NOT EXISTS installed_cached_before NUMERIC;

-- 102 left progress_ai_runs.claim_id without a foreign key: this table did not exist yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progress_ai_runs_claim_id_fkey') THEN
    ALTER TABLE progress_ai_runs
      ADD CONSTRAINT progress_ai_runs_claim_id_fkey
      FOREIGN KEY (claim_id) REFERENCES progress_claims(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Stage percent math (pure), the SQL twin of tools/progressClaims
-- ───────────────────────────────────────────────────────────────────────────

-- Exactly the weights' own stages, each a number from 0 to 100
-- (validateClaimPct in claimRules.ts). Nested CASE: SQL does not promise to
-- short-circuit, and casting a JSON string to numeric would raise.
CREATE OR REPLACE FUNCTION stage_pct_valid(p_weights JSONB, p_pct JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_weights IS NULL OR p_pct IS NULL
      OR jsonb_typeof(p_weights) <> 'object' OR jsonb_typeof(p_pct) <> 'object' THEN false
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_pct) AS k)
         IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_weights) AS k) THEN false
    ELSE COALESCE((SELECT bool_and(CASE WHEN jsonb_typeof(v) = 'number'
                                        THEN (v #>> '{}')::numeric BETWEEN 0 AND 100
                                        ELSE false END)
                   FROM jsonb_each(p_pct) AS e(k, v)), false)
  END;
$$;

-- One decimal per stage, as clampPct in stageMath.ts. Call only on a valid percent.
CREATE OR REPLACE FUNCTION stage_pct_round(p_pct JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(k, round((v #>> '{}')::numeric, 1)), '{}'::jsonb)
  FROM jsonb_each(p_pct) AS e(k, v);
$$;

-- Row completion 0..1: Σ weight x percent / 100, divided by the weights' sum
-- so 0.333 / 0.333 / 0.333 still reaches 1, rounded to 6 decimals. Same
-- number as rowFraction in stageMath.ts.
CREATE OR REPLACE FUNCTION stage_row_fraction(p_weights JSONB, p_pct JSONB)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(sum((w.v #>> '{}')::numeric), 0) <= 0 THEN 0::numeric
    ELSE round(LEAST(1, GREATEST(0,
           sum((w.v #>> '{}')::numeric * LEAST(100, GREATEST(0, COALESCE((p_pct ->> w.k)::numeric, 0))) / 100)
           / sum((w.v #>> '{}')::numeric))), 6)
  END
  FROM jsonb_each(p_weights) AS w(k, v);
$$;

CREATE OR REPLACE FUNCTION zero_stage_pct(p_weights JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(k, 0), '{}'::jsonb) FROM jsonb_object_keys(p_weights) AS k;
$$;

-- The stage percents of the row's most recent verified claim line, or NULL.
CREATE OR REPLACE FUNCTION latest_verified_stage_pct(p_boq_item_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.verified_pct
  FROM progress_claim_lines l
  JOIN progress_claims c ON c.id = l.claim_id
  WHERE l.boq_item_id = p_boq_item_id
    AND c.status = 'VERIFIED'
    AND l.verified_pct IS NOT NULL
  ORDER BY c.verified_at DESC, l.updated_at DESC
  LIMIT 1;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. A verified row keeps its weight shape
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION boq_stage_weights_shape_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (NEW.weights ? 'SINGLE') IS DISTINCT FROM (OLD.weights ? 'SINGLE')
     AND EXISTS (
       SELECT 1 FROM progress_claim_lines l
       JOIN progress_claims c ON c.id = l.claim_id
       WHERE l.boq_item_id = NEW.boq_item_id AND c.status = 'VERIFIED'
     ) THEN
    RAISE EXCEPTION 'WEIGHTS_SHAPE_LOCKED: baris % sudah punya klaim progres terverifikasi', NEW.boq_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boq_stage_weights_shape_lock_trg ON boq_stage_weights;
CREATE TRIGGER boq_stage_weights_shape_lock_trg
  BEFORE UPDATE OF weights ON boq_stage_weights
  FOR EACH ROW EXECUTE FUNCTION boq_stage_weights_shape_lock();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Read policies (no write policy: the RPCs below are the only writers)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE progress_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_claim_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS progress_claims_select ON progress_claims;
CREATE POLICY progress_claims_select ON progress_claims
  FOR SELECT TO authenticated
  USING (is_project_member(project_id) OR is_office_role());

DROP POLICY IF EXISTS progress_claim_lines_select ON progress_claim_lines;
CREATE POLICY progress_claim_lines_select ON progress_claim_lines
  FOR SELECT TO authenticated
  USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 4b. Read views, one row per BoQ item
-- ───────────────────────────────────────────────────────────────────────────

-- security_invoker = on, or a view reads with its owner's rights and skips the
-- caller's RLS (061's lesson).
CREATE OR REPLACE VIEW progress_claim_latest_verified WITH (security_invoker = on) AS
SELECT DISTINCT ON (l.boq_item_id)
  l.project_id, l.boq_item_id, l.verified_pct, c.verified_at
FROM progress_claim_lines l
JOIN progress_claims c ON c.id = l.claim_id
WHERE c.status = 'VERIFIED' AND l.verified_pct IS NOT NULL
ORDER BY l.boq_item_id, c.verified_at DESC, l.updated_at DESC;

CREATE OR REPLACE VIEW progress_entry_totals WITH (security_invoker = on) AS
SELECT project_id, boq_item_id, sum(quantity) AS installed_total, count(*) AS entry_count
FROM progress_entries
GROUP BY project_id, boq_item_id;

REVOKE ALL ON progress_claim_latest_verified, progress_entry_totals FROM PUBLIC, anon;
GRANT SELECT ON progress_claim_latest_verified, progress_entry_totals TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Progress has one writer: verify_progress_claim
-- ───────────────────────────────────────────────────────────────────────────

-- Supervisors: no direct insert into progress_entries or progress_photos (002)
-- and no direct update of boq_items.installed or progress (059).
DROP POLICY IF EXISTS "progress_entries_assigned_insert" ON progress_entries;
DROP POLICY IF EXISTS "progress_photos_assigned_insert" ON progress_photos;
DROP POLICY IF EXISTS "boq_items_assigned_progress_update" ON boq_items;

-- Office roles: 036 gave them FOR ALL on both tables; they only read them.
DROP POLICY IF EXISTS progress_entries_office_all ON progress_entries;
DROP POLICY IF EXISTS progress_entries_office_read ON progress_entries;
CREATE POLICY progress_entries_office_read ON progress_entries
  FOR SELECT TO authenticated
  USING (is_office_role());

DROP POLICY IF EXISTS progress_photos_office_all ON progress_photos;
DROP POLICY IF EXISTS progress_photos_office_read ON progress_photos;
CREATE POLICY progress_photos_office_read ON progress_photos
  FOR SELECT TO authenticated
  USING (is_office_role());

-- 002's sync_boq_progress() rewrote installed and progress from the entries
-- for any caller, rounding progress to whole percents.
DO $$
BEGIN
  IF to_regprocedure('public.sync_boq_progress(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.sync_boq_progress(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Office roles still edit boq_items (publishing writes label, planned,
-- superseded_at and more), so the last door is a trigger: installed and
-- progress change only inside verify_progress_claim, which sets
-- sano.progress_writer = 'verify' for its own transaction. PostgREST gives a
-- client no way to set that setting. A session without a JWT (the Dashboard
-- SQL editor, the service role) stays trusted, the same exception 059 makes.
CREATE OR REPLACE FUNCTION boq_items_progress_single_writer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_setting('sano.progress_writer', true) IS NOT DISTINCT FROM 'verify' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.installed, 0) <> 0 OR COALESCE(NEW.progress, 0) <> 0 THEN
      RAISE EXCEPTION 'PROGRESS_SINGLE_WRITER: baris BoQ baru dimulai dari progres 0';
    END IF;
  ELSIF NEW.installed IS DISTINCT FROM OLD.installed OR NEW.progress IS DISTINCT FROM OLD.progress THEN
    RAISE EXCEPTION 'PROGRESS_SINGLE_WRITER: progres baris % hanya berubah lewat verifikasi klaim progres', OLD.code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boq_items_progress_single_writer_trg ON boq_items;
CREATE TRIGGER boq_items_progress_single_writer_trg
  BEFORE INSERT OR UPDATE ON boq_items
  FOR EACH ROW EXECUTE FUNCTION boq_items_progress_single_writer();

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.progress_entries'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%quantity%'
  LOOP
    EXECUTE format('ALTER TABLE public.progress_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.progress_entries
    ADD CONSTRAINT progress_entries_quantity_nonzero CHECK (quantity <> 0);
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. notifications.type: 098's thirteen plus the three claim types
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED',
      'PLAN_CEILING_RAISE',
      'RETURNED',
      'SITE_EVENT_ASSIGNED',
      'PROGRESS_CLAIM_SUBMITTED',
      'PROGRESS_CLAIM_RETURNED',
      'PROGRESS_CLAIM_VERIFIED'
    ));
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. The claim RPCs
-- ───────────────────────────────────────────────────────────────────────────

-- Saves the caller's percent per stage for one row into the project's claim in
-- progress, opening a DRAFT for this WIB week when there is none. Saving the
-- same row again edits the same line; p_photo_refs replaces the line's photos.
CREATE OR REPLACE FUNCTION save_progress_claim_line(
  p_project_id     UUID,
  p_boq_item_id    UUID,
  p_claimed_pct    JSONB,
  p_note           TEXT DEFAULT NULL,
  p_photo_refs     JSONB DEFAULT '[]'::jsonb,
  p_regress_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_item    boq_items%ROWTYPE;
  v_weights JSONB;
  v_claim   progress_claims%ROWTYPE;
  v_line    progress_claim_lines%ROWTYPE;
  v_prev    JSONB;
  v_pct     JSONB;
  v_refs    JSONB := COALESCE(p_photo_refs, '[]'::jsonb);
  v_reason  TEXT := NULLIF(btrim(COALESCE(p_regress_reason, '')), '');
  v_week    DATE := date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  PERFORM progress_actor_role(p_project_id, ARRAY['supervisor', 'estimator', 'admin']);

  SELECT * INTO v_item FROM boq_items WHERE id = p_boq_item_id;
  IF NOT FOUND OR v_item.project_id <> p_project_id OR v_item.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_ROW: baris % bukan baris aktif proyek ini', p_boq_item_id;
  END IF;
  IF COALESCE(v_item.planned, 0) <= 0 THEN
    RAISE EXCEPTION 'CLAIM_NO_PLANNED: volume rencana baris % adalah 0', v_item.code;
  END IF;

  SELECT weights INTO v_weights FROM boq_stage_weights WHERE boq_item_id = p_boq_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NO_WEIGHTS: baris % belum punya bobot tahapan', v_item.code;
  END IF;
  IF NOT stage_pct_valid(v_weights, p_claimed_pct) THEN
    RAISE EXCEPTION 'CLAIM_PCT: persentase % tidak cocok dengan bobot %', COALESCE(p_claimed_pct::text, 'null'), v_weights;
  END IF;
  v_pct := stage_pct_round(p_claimed_pct);

  -- Photos are storage paths the app uploaded for this project
  -- (pickAndUploadPhoto('progress/<project id>') in tools/storage.ts), at most 12.
  IF jsonb_typeof(v_refs) <> 'array' THEN
    RAISE EXCEPTION 'CLAIM_EVIDENCE: lampiran foto harus berupa array';
  END IF;
  IF jsonb_array_length(v_refs) > 12 OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_refs) AS r
       WHERE jsonb_typeof(r) <> 'string'
          OR NOT starts_with(r #>> '{}', 'progress/' || p_project_id::text || '/')
          OR position('..' IN r #>> '{}') > 0
     ) THEN
    RAISE EXCEPTION 'CLAIM_EVIDENCE: lampiran foto tidak valid';
  END IF;

  SELECT * INTO v_claim FROM progress_claims
  WHERE project_id = p_project_id AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO progress_claims (project_id, week_start, status, created_by)
    VALUES (p_project_id, v_week, 'DRAFT', v_uid)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_claim;
    IF v_claim.id IS NULL THEN
      -- A concurrent save opened the claim first; use that one.
      SELECT * INTO v_claim FROM progress_claims
      WHERE project_id = p_project_id AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')
      FOR UPDATE;
    END IF;
  END IF;
  IF v_claim.status = 'SUBMITTED' THEN
    RAISE EXCEPTION 'CLAIM_LOCKED: klaim % sedang menunggu verifikasi', v_claim.id;
  END IF;

  v_prev := COALESCE(latest_verified_stage_pct(p_boq_item_id), zero_stage_pct(v_weights));
  IF v_reason IS NULL AND EXISTS (
       SELECT 1 FROM jsonb_each(v_prev) AS e(k, v)
       WHERE (v #>> '{}')::numeric > COALESCE((v_pct ->> k)::numeric, 0)
     ) THEN
    RAISE EXCEPTION 'CLAIM_REGRESS_REASON: baris % turun dari progres terverifikasi', v_item.code;
  END IF;

  INSERT INTO progress_claim_lines AS l
    (claim_id, project_id, boq_item_id, prev_verified, claimed_pct, note, regress_reason, evidence, created_by, updated_by)
  VALUES
    (v_claim.id, p_project_id, p_boq_item_id, v_prev, v_pct,
     NULLIF(btrim(COALESCE(p_note, '')), ''), v_reason,
     jsonb_build_object('photo_refs', v_refs, 'report_line_ids', '[]'::jsonb), v_uid, v_uid)
  ON CONFLICT (claim_id, boq_item_id) DO UPDATE
    SET prev_verified  = EXCLUDED.prev_verified,
        claimed_pct    = EXCLUDED.claimed_pct,
        note           = EXCLUDED.note,
        regress_reason = EXCLUDED.regress_reason,
        evidence       = jsonb_set(l.evidence, '{photo_refs}', EXCLUDED.evidence -> 'photo_refs'),
        updated_by     = EXCLUDED.updated_by,
        updated_at     = now()
  RETURNING * INTO v_line;

  UPDATE progress_claims SET updated_at = now() WHERE id = v_claim.id;

  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'claim_status', v_claim.status,
    'week_start', v_claim.week_start,
    'line_id', v_line.id,
    'prev_verified', v_line.prev_verified,
    'claimed_pct', v_line.claimed_pct,
    'row_fraction_prev', stage_row_fraction(v_weights, v_line.prev_verified),
    'row_fraction_claimed', stage_row_fraction(v_weights, v_line.claimed_pct)
  );
END;
$$;

CREATE OR REPLACE FUNCTION remove_progress_claim_line(p_line_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line  progress_claim_lines%ROWTYPE;
  v_claim progress_claims%ROWTYPE;
  v_left  INTEGER;
BEGIN
  SELECT * INTO v_line FROM progress_claim_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: baris klaim % tidak ditemukan', p_line_id;
  END IF;
  SELECT * INTO v_claim FROM progress_claims WHERE id = v_line.claim_id FOR UPDATE;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['supervisor', 'estimator', 'admin']);
  IF v_claim.status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;

  DELETE FROM progress_claim_lines WHERE id = p_line_id;
  SELECT count(*) INTO v_left FROM progress_claim_lines WHERE claim_id = v_claim.id;
  UPDATE progress_claims SET updated_at = now() WHERE id = v_claim.id;

  RETURN jsonb_build_object('claim_id', v_claim.id, 'lines_left', v_left);
END;
$$;

CREATE OR REPLACE FUNCTION submit_progress_claim(p_claim_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_claim    progress_claims%ROWTYPE;
  v_row      RECORD;
  v_lines    INTEGER;
  v_project  TEXT;
  v_target   TEXT;
  v_notified INTEGER := 0;
  v_verifiers INTEGER := 0;
BEGIN
  SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: klaim % tidak ditemukan', p_claim_id;
  END IF;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['supervisor', 'estimator', 'admin']);
  IF v_claim.status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;

  SELECT count(*) INTO v_lines FROM progress_claim_lines WHERE claim_id = p_claim_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'CLAIM_EMPTY: klaim % belum berisi baris', p_claim_id;
  END IF;

  -- Every line again, against the rows and weights as they are now.
  FOR v_row IN
    SELECT l.claimed_pct, b.code, b.planned, b.superseded_at, b.project_id AS row_project, w.weights
    FROM progress_claim_lines l
    JOIN boq_items b ON b.id = l.boq_item_id
    LEFT JOIN boq_stage_weights w ON w.boq_item_id = l.boq_item_id
    WHERE l.claim_id = p_claim_id
    ORDER BY l.created_at, l.id
  LOOP
    IF v_row.superseded_at IS NOT NULL OR v_row.row_project <> v_claim.project_id THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', v_row.code;
    END IF;
    IF COALESCE(v_row.planned, 0) <= 0 THEN
      RAISE EXCEPTION 'CLAIM_NO_PLANNED: volume rencana baris % adalah 0', v_row.code;
    END IF;
    IF v_row.weights IS NULL THEN
      RAISE EXCEPTION 'CLAIM_NO_WEIGHTS: baris % belum punya bobot tahapan', v_row.code;
    END IF;
    IF NOT stage_pct_valid(v_row.weights, v_row.claimed_pct) THEN
      RAISE EXCEPTION 'CLAIM_PCT: persentase baris % tidak cocok dengan bobotnya', v_row.code;
    END IF;
  END LOOP;

  UPDATE progress_claims
  SET status = 'SUBMITTED', submitted_by = v_uid, submitted_at = now(), updated_at = now()
  WHERE id = p_claim_id;

  SELECT name INTO v_project FROM projects WHERE id = v_claim.project_id;
  v_target := CASE WHEN EXISTS (
      SELECT 1 FROM project_assignments pa JOIN profiles p ON p.id = pa.user_id
      WHERE pa.project_id = v_claim.project_id AND p.role = 'estimator' AND pa.user_id <> v_uid
    ) THEN 'estimator' ELSE 'admin' END;

  BEGIN
    PERFORM enqueue_notification(
      v_claim.project_id,
      'PROGRESS_CLAIM_SUBMITTED',
      'Klaim progres menunggu verifikasi',
      format('%s: %s baris, minggu %s', COALESCE(v_project, 'Proyek'), v_lines, to_char(v_claim.week_start, 'DD/MM/YYYY')),
      'ProgressClaimVerify',
      jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'initialSection', 'klaim'),
      p_claim_id,
      v_uid,     -- p_exclude_user_id: the submitter is never told about their own claim
      v_target   -- p_target_role (066): estimators, or admins when the project has none
    );
    SELECT count(*) INTO v_verifiers FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_SUBMITTED' AND n.created_at >= now();
    -- Nobody assigned can verify. Notifications are readable only by project
    -- members (092), so an unassigned estimator would never see one; tell the
    -- principals instead (093 makes them members of every project), who can
    -- assign an estimator.
    IF v_verifiers = 0 THEN
      PERFORM enqueue_notification(
        v_claim.project_id,
        'PROGRESS_CLAIM_SUBMITTED',
        'Klaim progres belum punya verifikator',
        format('%s: belum ada estimator atau admin di proyek ini untuk memverifikasi klaim minggu %s. Tugaskan estimator.', COALESCE(v_project, 'Proyek'), to_char(v_claim.week_start, 'DD/MM/YYYY')),
        'ProgressClaimVerify',
        jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'initialSection', 'klaim'),
        p_claim_id,
        v_uid,
        'principal'
      );
    END IF;
    SELECT count(*) INTO v_notified FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_SUBMITTED' AND n.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'submit_progress_claim: notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'claim_id', p_claim_id, 'status', 'SUBMITTED', 'lines', v_lines,
    'notified', v_notified, 'verifiers_notified', v_verifiers
  );
END;
$$;

CREATE OR REPLACE FUNCTION return_progress_claim(p_claim_id UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_claim    progress_claims%ROWTYPE;
  v_note     TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_notified INTEGER := 0;
BEGIN
  SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: klaim % tidak ditemukan', p_claim_id;
  END IF;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['estimator', 'admin']);
  IF v_claim.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'CLAIM_RETURN_NOTE: alasan pengembalian wajib diisi';
  END IF;

  UPDATE progress_claims
  SET status = 'RETURNED', returned_by = v_uid, returned_at = now(), return_note = v_note, updated_at = now()
  WHERE id = p_claim_id;

  BEGIN
    PERFORM enqueue_notification_user(
      v_claim.project_id,
      v_claim.submitted_by,
      'PROGRESS_CLAIM_RETURNED',
      'Klaim progres dikembalikan',
      v_note,
      'ProgressClaim',
      jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'module', 'progress', 'initialSection', 'klaim'),
      p_claim_id,
      ARRAY[v_uid],
      NULL
    );
    SELECT count(*) INTO v_notified FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_RETURNED' AND n.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'return_progress_claim: notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('claim_id', p_claim_id, 'status', 'RETURNED', 'notified', v_notified);
END;
$$;

-- p_lines: [{"line_id": "<uuid>", "verified_pct": {...}, "regress_reason": "..."}]
-- covering every line of the claim exactly once.
CREATE OR REPLACE FUNCTION verify_progress_claim(p_claim_id UUID, p_lines JSONB, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_claim     progress_claims%ROWTYPE;
  v_line      progress_claim_lines%ROWTYPE;
  v_item      boq_items%ROWTYPE;
  v_input     JSONB;
  v_weights   JSONB;
  v_pct       JSONB;
  v_prev      JSONB;
  v_reason    TEXT;
  v_regressed BOOLEAN;
  v_frac_prev NUMERIC;
  v_frac_new  NUMERIC;
  v_before    NUMERIC;
  v_after     NUMERIC;
  v_delta     NUMERIC;
  v_entry_id  UUID;
  v_week      TEXT;
  v_lines     INTEGER;
  v_entries   INTEGER := 0;
  v_regress   INTEGER := 0;
  v_notified  INTEGER := 0;
  v_needs_reason  BOOLEAN;
  v_cached_before NUMERIC;
BEGIN
  SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: klaim % tidak ditemukan', p_claim_id;
  END IF;
  PERFORM progress_actor_role(v_claim.project_id, ARRAY['estimator', 'admin']);
  IF v_claim.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'CLAIM_STATE: klaim berstatus %', v_claim.status;
  END IF;
  IF v_claim.submitted_by = v_uid OR EXISTS (
       SELECT 1 FROM progress_claim_lines l
       WHERE l.claim_id = p_claim_id AND (l.created_by = v_uid OR l.updated_by = v_uid)
     ) THEN
    RAISE EXCEPTION 'CLAIM_SELF_VERIFY: klaim ini berisi angka yang Anda kirim atau isi sendiri';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'CLAIM_LINES: daftar baris harus berupa array';
  END IF;
  SELECT count(*) INTO v_lines FROM progress_claim_lines WHERE claim_id = p_claim_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'CLAIM_EMPTY: klaim % belum berisi baris', p_claim_id;
  END IF;
  IF jsonb_array_length(p_lines) <> v_lines
     OR (SELECT count(DISTINCT e ->> 'line_id') FROM jsonb_array_elements(p_lines) AS e) <> v_lines
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) AS e
       WHERE NOT EXISTS (SELECT 1 FROM progress_claim_lines l WHERE l.claim_id = p_claim_id AND l.id::text = e ->> 'line_id')
     ) THEN
    RAISE EXCEPTION 'CLAIM_LINES: daftar baris tidak cocok dengan klaim %', p_claim_id;
  END IF;

  v_week := to_char(v_claim.week_start, 'DD/MM/YYYY');

  -- Unlocks boq_items_progress_single_writer for this transaction only.
  PERFORM set_config('sano.progress_writer', 'verify', true);

  FOR v_line IN SELECT * FROM progress_claim_lines WHERE claim_id = p_claim_id ORDER BY created_at, id LOOP
    SELECT e INTO v_input FROM jsonb_array_elements(p_lines) AS e WHERE e ->> 'line_id' = v_line.id::text;

    SELECT * INTO v_item FROM boq_items WHERE id = v_line.boq_item_id FOR UPDATE;
    IF NOT FOUND OR v_item.project_id <> v_claim.project_id OR v_item.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'CLAIM_ROW: baris % sudah tidak berlaku', COALESCE(v_item.code, v_line.boq_item_id::text);
    END IF;
    IF COALESCE(v_item.planned, 0) <= 0 THEN
      RAISE EXCEPTION 'CLAIM_NO_PLANNED: volume rencana baris % adalah 0', v_item.code;
    END IF;
    SELECT weights INTO v_weights FROM boq_stage_weights WHERE boq_item_id = v_item.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLAIM_NO_WEIGHTS: baris % belum punya bobot tahapan', v_item.code;
    END IF;
    IF NOT stage_pct_valid(v_weights, v_input -> 'verified_pct') THEN
      RAISE EXCEPTION 'CLAIM_PCT: persentase verifikasi baris % tidak cocok dengan bobotnya', v_item.code;
    END IF;
    v_pct := stage_pct_round(v_input -> 'verified_pct');

    v_prev := COALESCE(latest_verified_stage_pct(v_item.id), zero_stage_pct(v_weights));
    v_regressed := EXISTS (
      SELECT 1 FROM jsonb_each(v_prev) AS e(k, v)
      WHERE (v #>> '{}')::numeric > COALESCE((v_pct ->> k)::numeric, 0)
    );

    v_frac_prev := stage_row_fraction(v_weights, v_prev);
    v_frac_new  := stage_row_fraction(v_weights, v_pct);
    SELECT COALESCE(sum(quantity), 0) INTO v_before FROM progress_entries WHERE boq_item_id = v_item.id;
    v_cached_before := v_item.installed;
    v_after := round(v_item.planned * v_frac_new, 4);
    v_delta := v_after - v_before;
    v_entry_id := NULL;

    -- A lower figure needs a reason, whether a stage percent dropped or the
    -- quantity fell because the weights or the planned volume changed since
    -- the last verification.
    v_needs_reason := v_regressed OR v_delta < 0;
    v_reason := COALESCE(NULLIF(btrim(COALESCE(v_input ->> 'regress_reason', '')), ''), v_line.regress_reason);
    IF v_needs_reason AND v_reason IS NULL THEN
      RAISE EXCEPTION 'CLAIM_REGRESS_REASON: baris % turun dari progres terverifikasi', v_item.code;
    END IF;

    -- installed set outside the entries (legacy data): the entries win, and
    -- the difference is logged so it is never overwritten silently.
    IF abs(COALESCE(v_cached_before, 0) - v_before) > 0.0001 THEN
      INSERT INTO activity_log (project_id, user_id, type, label, flag)
      VALUES (
        v_claim.project_id, v_uid, 'progres',
        format('%s: terpasang tercatat %s berbeda dari riwayat progres %s; verifikasi mengikuti riwayat',
               v_item.code, trim_scale(COALESCE(v_cached_before, 0)), trim_scale(v_before)),
        'WARNING'
      );
    END IF;

    IF v_delta <> 0 THEN
      INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status, note)
      VALUES (
        v_claim.project_id, v_item.id, v_claim.submitted_by, v_delta, v_item.unit,
        CASE WHEN v_frac_new >= 1 THEN 'COMPLETE' ELSE 'IN_PROGRESS' END,
        CASE WHEN v_delta < 0
          THEN format('Koreksi klaim progres minggu %s: %s', v_week, COALESCE(v_reason, '-'))
          ELSE format('Klaim progres minggu %s, diverifikasi', v_week)
        END
      )
      RETURNING id INTO v_entry_id;
      v_entries := v_entries + 1;

      IF v_delta > 0 THEN
        INSERT INTO progress_photos (progress_entry_id, storage_path)
        SELECT v_entry_id, ref
        FROM jsonb_array_elements_text(COALESCE(v_line.evidence -> 'photo_refs', '[]'::jsonb)) AS ref;
      END IF;

      INSERT INTO activity_log (project_id, user_id, type, label, flag)
      VALUES (
        v_claim.project_id, v_uid, 'progres',
        format('%s: progres %s%% menjadi %s%% (klaim diverifikasi)', v_item.code, round(v_frac_prev * 100, 1), round(v_frac_new * 100, 1)),
        CASE WHEN v_delta < 0 THEN 'WARNING' ELSE 'OK' END
      );
    END IF;
    IF v_needs_reason THEN
      v_regress := v_regress + 1;
    END IF;

    UPDATE boq_items SET installed = v_after, progress = round(v_frac_new * 100, 1) WHERE id = v_item.id;

    UPDATE progress_claim_lines
    SET verified_pct      = v_pct,
        weights_snapshot  = v_weights,
        prev_verified     = v_prev,
        row_pct_prev      = v_frac_prev,
        row_pct_new       = v_frac_new,
        installed_before  = v_before,
        installed_cached_before = v_cached_before,
        delta_quantity    = v_delta,
        regress_reason    = v_reason,
        progress_entry_id = v_entry_id,
        updated_by        = v_uid,
        updated_at        = now()
    WHERE id = v_line.id;
  END LOOP;
  PERFORM set_config('sano.progress_writer', '', true);

  UPDATE progress_claims
  SET status = 'VERIFIED', verified_by = v_uid, verified_at = now(),
      verifier_note = NULLIF(btrim(COALESCE(p_note, '')), ''), updated_at = now()
  WHERE id = p_claim_id;

  BEGIN
    PERFORM enqueue_notification_user(
      v_claim.project_id,
      v_claim.submitted_by,
      'PROGRESS_CLAIM_VERIFIED',
      'Klaim progres diverifikasi',
      format('%s baris, minggu %s', v_lines, v_week),
      'ProgressClaim',
      jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'module', 'progress', 'initialSection', 'klaim'),
      p_claim_id,
      ARRAY[v_uid],
      NULL
    );
    SELECT count(*) INTO v_notified FROM notifications n
    WHERE n.related_entity_id = p_claim_id AND n.type = 'PROGRESS_CLAIM_VERIFIED' AND n.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verify_progress_claim: notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'claim_id', p_claim_id, 'status', 'VERIFIED', 'lines', v_lines,
    'entries', v_entries, 'regressions', v_regress, 'notified', v_notified
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Privileges: anon reaches nothing; internal helpers stay internal
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION stage_pct_valid(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_pct_valid(JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION stage_pct_round(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_pct_round(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION stage_row_fraction(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stage_row_fraction(JSONB, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION zero_stage_pct(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION zero_stage_pct(JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION latest_verified_stage_pct(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION latest_verified_stage_pct(UUID) TO service_role;

REVOKE ALL ON FUNCTION boq_stage_weights_shape_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION boq_items_progress_single_writer() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION save_progress_claim_line(UUID, UUID, JSONB, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_progress_claim_line(UUID, UUID, JSONB, TEXT, JSONB, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION remove_progress_claim_line(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION remove_progress_claim_line(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION submit_progress_claim(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_progress_claim(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION return_progress_claim(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION return_progress_claim(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION verify_progress_claim(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION verify_progress_claim(UUID, JSONB, TEXT) TO authenticated, service_role;

RESET lock_timeout;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; writes nothing)
--
-- 1. Tables, the one-open-claim index and the line uniqueness landed:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename IN ('progress_claims', 'progress_claim_lines') ORDER BY 1;
--    EXPECTED: seven rows: idx_progress_claim_lines_project,
--    idx_progress_claim_lines_row, idx_progress_claims_project_week,
--    progress_claim_lines_claim_row, progress_claim_lines_pkey,
--    progress_claims_one_open, progress_claims_pkey.
--
-- 2. The claim tables are read-only to the app, and the views apply the
--    caller's RLS:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('progress_claims', 'progress_claim_lines');
--    EXPECTED: two rows, both SELECT.
--      SELECT relname, reloptions FROM pg_class
--      WHERE relname IN ('progress_claim_latest_verified', 'progress_entry_totals') ORDER BY 1;
--    EXPECTED: two rows, each with {security_invoker=on}.
--
-- 3. Progress has one writer:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('progress_entries', 'progress_photos') ORDER BY 1, 2;
--    EXPECTED: SELECT rows only. An INSERT or ALL row means 002 or 036 was
--    re-pasted: re-paste 104.
--      SELECT count(*) FROM pg_policies WHERE policyname = 'boq_items_assigned_progress_update';
--    EXPECTED: 0. A 1 means 059 was re-pasted: re-paste 104.
--      SELECT has_function_privilege('authenticated', 'sync_boq_progress(uuid)', 'EXECUTE'),
--             (SELECT count(*) FROM pg_trigger WHERE tgname = 'boq_items_progress_single_writer_trg');
--    EXPECTED: f, 1.
--
-- 4. The type list is 098's thirteen plus three:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';
--    EXPECTED: 16 quoted types, PROGRESS_CLAIM_SUBMITTED, PROGRESS_CLAIM_RETURNED,
--    PROGRESS_CLAIM_VERIFIED and SITE_EVENT_ASSIGNED among them.
--
-- 5. A correction entry may be negative, never zero:
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conrelid = 'public.progress_entries'::regclass AND contype = 'c';
--    EXPECTED: the work_status check and progress_entries_quantity_nonzero,
--    CHECK ((quantity <> (0)::numeric)).
--
-- 6. The row math matches tools/progressClaims/stageMath.ts:
--      SELECT stage_row_fraction('{"BEKISTING": 0.368, "PEMBESIAN": 0.38, "PENGECORAN": 0.252}',
--                                '{"BEKISTING": 100, "PEMBESIAN": 50, "PENGECORAN": 0}');
--    EXPECTED: 0.558000.
--
-- 7. A supervisor cannot verify (rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_SUPERVISOR_UUID>","role":"authenticated"}', true);
--        SELECT verify_progress_claim('<ANY_CLAIM_UUID_OF_THEIR_PROJECT>', '[]');
--      ROLLBACK;
--    EXPECTED: ERROR starting CLAIM_ROLE.
--
-- 8. An office role cannot set installed outside verification (rolled back):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<AN_ESTIMATOR_UUID>","role":"authenticated"}', true);
--        UPDATE boq_items SET installed = installed + 1 WHERE id = '<ANY_BOQ_ROW_UUID>';
--      ROLLBACK;
--    EXPECTED: ERROR starting PROGRESS_SINGLE_WRITER.
--
-- 9. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-6 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname IN ('stage_pct_valid', 'stage_pct_round', 'stage_row_fraction', 'zero_stage_pct',
                  'latest_verified_stage_pct', 'save_progress_claim_line', 'remove_progress_claim_line',
                  'submit_progress_claim', 'return_progress_claim', 'verify_progress_claim',
                  'boq_items_progress_single_writer')
ORDER BY proname;
```

`supabase/tests/progress_claims_rehearsal/fixture.sql` (new file):

```sql
-- supabase/tests/progress_claims_rehearsal/fixture.sql
-- Disposable fixture for run.sh: one project, six people, six BoQ rows. Run as supabase_admin.
CREATE SCHEMA IF NOT EXISTS rehearsal;
GRANT USAGE ON SCHEMA rehearsal TO authenticated, postgres;

CREATE OR REPLACE FUNCTION rehearsal.u(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'sup' THEN 'a001' WHEN 'est' THEN 'a002' WHEN 'est2' THEN 'a003'
    WHEN 'adm' THEN 'a004' WHEN 'pri' THEN 'a005' WHEN 'out' THEN 'a006' END)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.p() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT '00000000-0000-4000-8000-00000000b001'::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.row(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000c00' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.as_user(p_name TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rehearsal.u(p_name)::text, true)
      || set_config('request.jwt.claim.role', 'authenticated', true)
      || set_config('request.jwt.claims', json_build_object('sub', rehearsal.u(p_name), 'role', 'authenticated')::text, true) $$;
CREATE OR REPLACE FUNCTION rehearsal.expect(p_label TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN p_ok THEN 'PASS ' ELSE 'FAIL ' END || p_label || COALESCE(' :: ' || p_detail, '') $$;
CREATE OR REPLACE FUNCTION rehearsal.expect_error(p_label TEXT, p_sql TEXT, p_prefix TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FAIL ' || p_label || ' :: no error';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE p_prefix || '%' THEN 'PASS ' ELSE 'FAIL ' END || p_label || ' :: ' || SQLERRM;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rehearsal TO authenticated, postgres;

DELETE FROM projects WHERE id = rehearsal.p();

INSERT INTO auth.users (id, email)
SELECT rehearsal.u(n), n || '@rehearsal.test' FROM unnest(ARRAY['sup', 'est', 'est2', 'adm', 'pri', 'out']) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role) VALUES
  (rehearsal.u('sup'), 'Rehearsal Supervisor', 'supervisor'),
  (rehearsal.u('est'), 'Rehearsal Estimator', 'estimator'),
  (rehearsal.u('est2'), 'Rehearsal Estimator Two', 'estimator'),
  (rehearsal.u('adm'), 'Rehearsal Admin', 'admin'),
  (rehearsal.u('pri'), 'Rehearsal Principal', 'principal'),
  (rehearsal.u('out'), 'Rehearsal Outsider', 'supervisor')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

INSERT INTO projects (id, code, name) VALUES (rehearsal.p(), 'REH-1', 'Rehearsal Project');

INSERT INTO project_assignments (project_id, user_id) VALUES
  (rehearsal.p(), rehearsal.u('sup')), (rehearsal.p(), rehearsal.u('est')),
  (rehearsal.p(), rehearsal.u('est2')), (rehearsal.p(), rehearsal.u('pri'))
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO boq_items (id, project_id, code, label, unit, planned, sort_order) VALUES
  (rehearsal.row(1), rehearsal.p(), 'T1-001', 'Lantai 1 ; Kolom', 'm3', 100, 1),
  (rehearsal.row(2), rehearsal.p(), 'T1-002', 'Lantai 2 ; Balok, Plat Lantai', 'm3', 200, 2),
  (rehearsal.row(3), rehearsal.p(), 'T1-003', 'Tangga', 'm3', 10, 3),
  (rehearsal.row(4), rehearsal.p(), 'T1-004', 'Lantai 1 ; Kolom lama', 'm3', 50, 4),
  (rehearsal.row(5), rehearsal.p(), 'T1-005', 'Lantai 3 ; Dinding', 'm3', 0, 5),
  (rehearsal.row(6), rehearsal.p(), 'T1-006', 'Lantai 3 ; Pile Cap', 'm3', 30, 6);
UPDATE boq_items SET superseded_at = now() WHERE id = rehearsal.row(4);

SELECT 'fixture ready: ' || (SELECT count(*) FROM boq_items WHERE project_id = rehearsal.p()) || ' rows, '
  || (SELECT count(*) FROM project_assignments WHERE project_id = rehearsal.p()) || ' members';
```

`supabase/tests/progress_claims_rehearsal/rehearse_103.sql` (new file):

```sql
-- supabase/tests/progress_claims_rehearsal/rehearse_103.sql
-- Behaviour checks for migration 103 as real roles. Every line prints PASS or FAIL. Run by run.sh.
\pset tuples_only on
\pset format unaligned

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup');
SELECT rehearsal.expect('103 supervisor seeds three rows', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(
  jsonb_build_object('boq_item_id', rehearsal.row(1), 'reference_class', 'KOLOM'),
  jsonb_build_object('boq_item_id', rehearsal.row(2), 'reference_class', 'BALOK_PLAT'),
  jsonb_build_object('boq_item_id', rehearsal.row(3), 'reference_class', 'TANGGA'))) = 3);
SELECT rehearsal.expect('103 a second seed inserts nothing and keeps the class', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(
  jsonb_build_object('boq_item_id', rehearsal.row(1), 'reference_class', 'DINDING'))) = 0);
SELECT rehearsal.expect('103 the seeded kolom row carries the KOLOM profile', (SELECT weights = reference_stage_weights('KOLOM') AND source = 'reference' AND reference_class = 'KOLOM' AND updated_by = rehearsal.u('sup') FROM boq_stage_weights WHERE boq_item_id = rehearsal.row(1)));
SELECT rehearsal.expect_error('103 a superseded row cannot be seeded', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(4), 'reference_class', 'KOLOM'))), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('103 an unknown class is refused', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'ATAP'))), 'WEIGHTS_CLASS:');
SELECT rehearsal.expect_error('103 a malformed row id is refused', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), '[{"boq_item_id":"nope","reference_class":"KOLOM"}]'), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('103 a non-array payload is refused', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), '{"boq_item_id":"x"}'), 'WEIGHTS_INVALID:');
SELECT rehearsal.expect_error('103 a supervisor cannot set manual weights', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.2}'), 'CLAIM_ROLE:');
SELECT rehearsal.expect_error('103 a supervisor cannot reset weights', format('SELECT reset_boq_stage_weights(%L, %L)', rehearsal.row(2), 'KOLOM'), 'CLAIM_ROLE:');
SELECT rehearsal.expect_error('103 a supervisor cannot insert weights directly', format('INSERT INTO boq_stage_weights (project_id, boq_item_id, weights, source) VALUES (%L, %L, %L, %L)', rehearsal.p(), rehearsal.row(5), '{"SINGLE":1}', 'manual'), 'new row violates row-level security');
SELECT rehearsal.expect_error('103 a supervisor cannot call the internal actor check', format('SELECT progress_actor_role(%L, ARRAY[%L])', rehearsal.p(), 'supervisor'), 'permission denied');
WITH u AS (UPDATE boq_stage_weights SET source = 'manual', reference_class = NULL RETURNING 1)
SELECT rehearsal.expect('103 a supervisor direct update touches no row', count(*) = 0) FROM u;
SELECT rehearsal.expect('103 a member sees the project weights', (SELECT count(*) FROM boq_stage_weights) = 3);
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out');
SELECT rehearsal.expect_error('103 an outsider cannot seed', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'DINDING'))), 'CLAIM_AUTH:');
SELECT rehearsal.expect('103 an outsider sees no weights', (SELECT count(*) FROM boq_stage_weights) = 0);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri');
SELECT rehearsal.expect_error('103 the principal cannot seed', format('SELECT seed_reference_stage_weights(%L, %L)', rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'DINDING'))), 'CLAIM_ROLE:');
SELECT rehearsal.expect('103 the principal reads the weights', (SELECT count(*) FROM boq_stage_weights) = 3);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est');
SELECT rehearsal.expect('103 an estimator sets manual weights', (set_boq_stage_weights(rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.2}') ->> 'source') = 'manual');
SELECT rehearsal.expect('103 manual weights clear the reference class', (SELECT source = 'manual' AND reference_class IS NULL AND updated_by = rehearsal.u('est') FROM boq_stage_weights WHERE boq_item_id = rehearsal.row(2)));
SELECT rehearsal.expect_error('103 weights must sum to one', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.1}'), 'WEIGHTS_INVALID:');
SELECT rehearsal.expect_error('103 weights must name exactly the three stages', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(2), '{"BEKISTING":0.5,"PEMBESIAN":0.5}'), 'WEIGHTS_INVALID:');
SELECT rehearsal.expect_error('103 a superseded row cannot get weights', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(4), '{"SINGLE":1}'), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('103 reset refuses an unknown class', format('SELECT reset_boq_stage_weights(%L, %L)', rehearsal.row(2), 'ATAP'), 'WEIGHTS_CLASS:');
SELECT rehearsal.expect('103 an estimator resets a row to its reference class', (reset_boq_stage_weights(rehearsal.row(2), 'BALOK_PLAT') ->> 'source') = 'reference');
SELECT rehearsal.expect('103 the reset row carries the BALOK_PLAT profile', (SELECT weights = reference_stage_weights('BALOK_PLAT') AND reference_class = 'BALOK_PLAT' FROM boq_stage_weights WHERE boq_item_id = rehearsal.row(2)));
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('adm');
SELECT rehearsal.expect('103 an unassigned admin sets weights as an office role', (set_boq_stage_weights(rehearsal.row(5), '{"SINGLE":1}') ->> 'source') = 'manual');
ROLLBACK;

SELECT rehearsal.expect('103 shape: SINGLE 1', stage_weights_valid('{"SINGLE":1}'));
SELECT rehearsal.expect('103 shape: SINGLE 1.0', stage_weights_valid('{"SINGLE":1.0}'));
SELECT rehearsal.expect('103 shape: SINGLE 2 refused', NOT stage_weights_valid('{"SINGLE":2}'));
SELECT rehearsal.expect('103 shape: SINGLE string refused', NOT stage_weights_valid('{"SINGLE":"1"}'));
SELECT rehearsal.expect('103 shape: scalar refused', NOT stage_weights_valid('"x"'));
SELECT rehearsal.expect('103 shape: empty object refused', NOT stage_weights_valid('{}'));
SELECT rehearsal.expect('103 shape: string stage refused', NOT stage_weights_valid('{"BEKISTING":"0.5","PEMBESIAN":0.3,"PENGECORAN":0.2}'));
SELECT rehearsal.expect('103 shape: sum 0.9995 accepted', stage_weights_valid('{"BEKISTING":0.333,"PEMBESIAN":0.333,"PENGECORAN":0.3335}'));
SELECT rehearsal.expect('103 shape: sum 0.998 refused', NOT stage_weights_valid('{"BEKISTING":0.333,"PEMBESIAN":0.333,"PENGECORAN":0.332}'));
SELECT rehearsal.expect('103 shape: negative refused', NOT stage_weights_valid('{"BEKISTING":-0.1,"PEMBESIAN":0.6,"PENGECORAN":0.5}'));
SELECT rehearsal.expect('103 shape: extra key refused', NOT stage_weights_valid('{"BEKISTING":0.5,"PEMBESIAN":0.3,"PENGECORAN":0.2,"SINGLE":1}'));
SELECT rehearsal.expect('103 reference: every class is a valid shape', (SELECT bool_and(stage_weights_valid(reference_stage_weights(c))) FROM unnest(ARRAY['PILECAP_SLOOF_PLAT_DASAR','KOLOM','BALOK_PLAT','DINDING','TANGGA','BOREDPILE','LAINNYA']) AS c));
SELECT rehearsal.expect('103 reference: unknown class is null', reference_stage_weights('ATAP') IS NULL);
SELECT rehearsal.expect('103 privileges: anon cannot run any 103 function', NOT bool_or(has_function_privilege('anon', oid, 'EXECUTE'))) FROM pg_proc WHERE proname IN ('progress_actor_role','stage_weights_valid','reference_stage_weights','seed_reference_stage_weights','set_boq_stage_weights','reset_boq_stage_weights');
SELECT rehearsal.expect('103 privileges: authenticated cannot run progress_actor_role', NOT has_function_privilege('authenticated', 'progress_actor_role(uuid, text[])', 'EXECUTE'));
```

`supabase/tests/progress_claims_rehearsal/rehearse_104.sql` (new file):

```sql
-- supabase/tests/progress_claims_rehearsal/rehearse_104.sql
-- Behaviour checks for migration 104 as real roles, after rehearse_103.sql. Run by run.sh.
\pset tuples_only on
\pset format unaligned

-- A. The supervisor builds this week's draft
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}', 'Kolom lantai 1', jsonb_build_array('progress/' || rehearsal.p() || '/1.jpg')) ->> 'claim_id' AS claim1 \gset
SELECT rehearsal.expect('104 the first save opens a DRAFT claim for this WIB week', (SELECT status = 'DRAFT' AND week_start = date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta')::date AND created_by = rehearsal.u('sup') FROM progress_claims WHERE id = :'claim1'));
SELECT rehearsal.expect('104 saving the same row again edits the same line', (save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}', 'Kolom lantai 1', jsonb_build_array('progress/' || rehearsal.p() || '/2.jpg', 'progress/' || rehearsal.p() || '/3.jpg')) ->> 'row_fraction_claimed')::numeric = 0.6176);
SELECT rehearsal.expect('104 one line whose percents and photos were replaced', (SELECT count(*) = 1 AND bool_and(claimed_pct = '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb AND jsonb_array_length(evidence -> 'photo_refs') = 2 AND prev_verified = '{"BEKISTING":0,"PEMBESIAN":0,"PENGECORAN":0}'::jsonb) FROM progress_claim_lines WHERE claim_id = :'claim1'));
SELECT rehearsal.expect('104 a percent with two decimals keeps one', ((save_progress_claim_line(rehearsal.p(), rehearsal.row(3), '{"SINGLE":40.26}') -> 'claimed_pct') ->> 'SINGLE')::numeric = 40.3);
SELECT rehearsal.expect_error('104 a split percent on a SINGLE row is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(3), '{"BEKISTING":10,"PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_PCT:');
SELECT rehearsal.expect_error('104 a percent above 100 is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(2), '{"BEKISTING":101,"PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_PCT:');
SELECT rehearsal.expect_error('104 a string percent is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(2), '{"BEKISTING":"50","PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_PCT:');
SELECT rehearsal.expect_error('104 a row with planned 0 is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(5), '{"SINGLE":10}'), 'CLAIM_NO_PLANNED:');
SELECT rehearsal.expect_error('104 a row without weights is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(6), '{"SINGLE":10}'), 'CLAIM_NO_WEIGHTS:');
SELECT rehearsal.expect_error('104 a superseded row is refused', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(4), '{"SINGLE":10}'), 'CLAIM_ROW:');
SELECT rehearsal.expect_error('104 a photo of another project is refused', format('SELECT save_progress_claim_line(%L, %L, %L, NULL, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":40}', '["progress/00000000-0000-4000-8000-000000000000/x.jpg"]'), 'CLAIM_EVIDENCE:');
SELECT rehearsal.expect_error('104 a path that climbs out of the folder is refused', format('SELECT save_progress_claim_line(%L, %L, %L, NULL, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":40}', jsonb_build_array('progress/' || rehearsal.p() || '/../x.jpg')), 'CLAIM_EVIDENCE:');
SELECT rehearsal.expect_error('104 thirteen photos are refused', format('SELECT save_progress_claim_line(%L, %L, %L, NULL, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":40}', (SELECT jsonb_agg('progress/' || rehearsal.p() || '/' || g || '.jpg') FROM generate_series(1, 13) AS g)), 'CLAIM_EVIDENCE:');
SELECT rehearsal.expect_error('104 a supervisor cannot write a claim directly', format('INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (%L, %L, %L)', rehearsal.p(), '2026-09-14', rehearsal.u('sup')), 'new row violates row-level security');
SELECT rehearsal.expect_error('104 a supervisor cannot insert progress directly', format('INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status) VALUES (%L, %L, %L, 5, %L, %L)', rehearsal.p(), rehearsal.row(1), rehearsal.u('sup'), 'm3', 'IN_PROGRESS'), 'new row violates row-level security');
WITH u AS (UPDATE boq_items SET installed = 99 WHERE project_id = rehearsal.p() RETURNING 1)
SELECT rehearsal.expect('104 a supervisor cannot update installed directly', count(*) = 0) FROM u;
COMMIT;

SELECT id AS line_row3 FROM progress_claim_lines WHERE claim_id = :'claim1' AND boq_item_id = rehearsal.row(3) \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 the principal cannot claim', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":10}'), 'CLAIM_ROLE:');
SELECT rehearsal.expect('104 the principal reads the claim', (SELECT count(*) FROM progress_claims WHERE project_id = rehearsal.p()) = 1);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 an outsider cannot claim', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(3), '{"SINGLE":10}'), 'CLAIM_AUTH:');
SELECT rehearsal.expect('104 an outsider sees no claim and no line', (SELECT count(*) FROM progress_claims) = 0 AND (SELECT count(*) FROM progress_claim_lines) = 0);
ROLLBACK;

-- B. Submit, return, fix, resubmit
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 submit tells both estimators', (submit_progress_claim(:'claim1') ->> 'notified')::int = 2);
SELECT rehearsal.expect_error('104 a submitted claim takes no new line', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(2), '{"BEKISTING":10,"PEMBESIAN":0,"PENGECORAN":0}'), 'CLAIM_LOCKED:');
SELECT rehearsal.expect_error('104 a submitted claim cannot lose a line', format('SELECT remove_progress_claim_line(%L)', :'line_row3'), 'CLAIM_STATE:');
SELECT rehearsal.expect_error('104 a claim cannot be submitted twice', format('SELECT submit_progress_claim(%L)', :'claim1'), 'CLAIM_STATE:');
SELECT rehearsal.expect_error('104 a supervisor cannot return a claim', format('SELECT return_progress_claim(%L, %L)', :'claim1', 'x'), 'CLAIM_ROLE:');
SELECT rehearsal.expect_error('104 a supervisor cannot verify a claim', format('SELECT verify_progress_claim(%L, %L)', :'claim1', '[]'), 'CLAIM_ROLE:');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 a return needs a note', format('SELECT return_progress_claim(%L, %L)', :'claim1', '   '), 'CLAIM_RETURN_NOTE:');
SELECT rehearsal.expect('104 an estimator returns the claim and the supervisor is told', (return_progress_claim(:'claim1', 'Foto pembesian kurang jelas') ->> 'notified')::int = 1);
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 a returned claim takes edits and stays RETURNED', (save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":0,"PENGECORAN":0}') ->> 'claim_status') = 'RETURNED');
SELECT rehearsal.expect('104 a line can be removed from a returned claim', (remove_progress_claim_line(:'line_row3') ->> 'lines_left')::int = 2);
SELECT rehearsal.expect('104 resubmitting works', (submit_progress_claim(:'claim1') ->> 'status') = 'SUBMITTED');
COMMIT;

SELECT id AS line_row1 FROM progress_claim_lines WHERE claim_id = :'claim1' AND boq_item_id = rehearsal.row(1) \gset
SELECT id AS line_row2 FROM progress_claim_lines WHERE claim_id = :'claim1' AND boq_item_id = rehearsal.row(2) \gset

-- C. Verification
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 verify needs every line', format('SELECT verify_progress_claim(%L, %L)', :'claim1', jsonb_build_array(jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb))), 'CLAIM_LINES:');
SELECT rehearsal.expect_error('104 verify refuses a line listed twice', format('SELECT verify_progress_claim(%L, %L)', :'claim1', jsonb_build_array(jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb))), 'CLAIM_LINES:');
SELECT rehearsal.expect_error('104 verify refuses a wrong-shaped percent', format('SELECT verify_progress_claim(%L, %L)', :'claim1', jsonb_build_array(jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'line_row2', 'verified_pct', '{"SINGLE":50}'::jsonb))), 'CLAIM_PCT:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est2') IS NOT NULL AS ok \gset
SELECT verify_progress_claim(:'claim1', jsonb_build_array(
  jsonb_build_object('line_id', :'line_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'line_row2', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":0,"PENGECORAN":0}'::jsonb)), 'Sesuai foto') AS verify1 \gset
COMMIT;

SELECT rehearsal.expect('104 verify reports two entries, no regression, one notification', (:'verify1'::jsonb ->> 'entries')::int = 2 AND (:'verify1'::jsonb ->> 'regressions')::int = 0 AND (:'verify1'::jsonb ->> 'notified')::int = 1, :'verify1');
SELECT rehearsal.expect('104 kolom row installed 61.76 = 100 x (0.326 + 0.486 x 0.6), progress 61.8', (SELECT installed = 61.76 AND progress = 61.8 FROM boq_items WHERE id = rehearsal.row(1)));
SELECT rehearsal.expect('104 balok row installed 73.6 = 200 x 0.368, progress 36.8', (SELECT installed = 73.6 AND progress = 36.8 FROM boq_items WHERE id = rehearsal.row(2)));
SELECT rehearsal.expect('104 each verified row has one entry by the submitter equal to installed', (SELECT count(*) = 2 AND bool_and(e.reported_by = rehearsal.u('sup') AND e.quantity = b.installed AND e.work_status = 'IN_PROGRESS') FROM progress_entries e JOIN boq_items b ON b.id = e.boq_item_id WHERE e.project_id = rehearsal.p()));
SELECT rehearsal.expect('104 the kolom entry carries the two claim photos', (SELECT count(*) = 2 FROM progress_photos ph JOIN progress_entries e ON e.id = ph.progress_entry_id WHERE e.boq_item_id = rehearsal.row(1)));
SELECT rehearsal.expect('104 the claim is VERIFIED by the second estimator with the note', (SELECT status = 'VERIFIED' AND verified_by = rehearsal.u('est2') AND verifier_note = 'Sesuai foto' AND return_note = 'Foto pembesian kurang jelas' FROM progress_claims WHERE id = :'claim1'));
SELECT rehearsal.expect('104 the lines record what verification wrote', (SELECT bool_and(weights_snapshot IS NOT NULL AND verified_pct IS NOT NULL AND installed_before = 0 AND delta_quantity > 0 AND progress_entry_id IS NOT NULL) FROM progress_claim_lines WHERE claim_id = :'claim1'));
SELECT rehearsal.expect('104 two activity rows were logged', (SELECT count(*) = 2 FROM activity_log WHERE project_id = rehearsal.p() AND type = 'progres'));
SELECT rehearsal.expect('104 the supervisor was told of the return and the verification', (SELECT count(*) FILTER (WHERE type = 'PROGRESS_CLAIM_RETURNED') = 1 AND count(*) FILTER (WHERE type = 'PROGRESS_CLAIM_VERIFIED') = 1 FROM notifications WHERE recipient_user_id = rehearsal.u('sup') AND related_entity_id = :'claim1'));
SELECT rehearsal.expect('104 both estimators were told of both submissions', (SELECT count(*) = 4 FROM notifications WHERE type = 'PROGRESS_CLAIM_SUBMITTED' AND related_entity_id = :'claim1'));

-- D. A second claim: a correction, an estimator submitter, self-verify
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}') AS save2 \gset
SELECT rehearsal.expect('104 after verification the previous figures are the verified ones', (:'save2'::jsonb -> 'prev_verified') = '{"BEKISTING":100,"PEMBESIAN":0,"PENGECORAN":0}'::jsonb);
SELECT rehearsal.expect('104 a new claim opened after the verified one', (:'save2'::jsonb ->> 'claim_id') <> :'claim1');
SELECT rehearsal.expect_error('104 claiming below the verified figure needs a reason', format('SELECT save_progress_claim_line(%L, %L, %L)', rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'), 'CLAIM_REGRESS_REASON:');
SELECT rehearsal.expect('104 with a reason the lower figure is saved', (save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}', NULL, '[]', 'Salah hitung begel minggu lalu') ->> 'claim_id') = (:'save2'::jsonb ->> 'claim_id'));
COMMIT;

SELECT :'save2'::jsonb ->> 'claim_id' AS claim2 \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator may submit', (submit_progress_claim(:'claim2') ->> 'status') = 'SUBMITTED');
COMMIT;
SELECT rehearsal.expect('104 the estimator who submits is not told, the other estimator is', (SELECT count(*) = 1 AND bool_and(recipient_user_id = rehearsal.u('est2')) FROM notifications WHERE related_entity_id = :'claim2' AND type = 'PROGRESS_CLAIM_SUBMITTED'));

SELECT id AS c2_row1 FROM progress_claim_lines WHERE claim_id = :'claim2' AND boq_item_id = rehearsal.row(1) \gset
SELECT id AS c2_row2 FROM progress_claim_lines WHERE claim_id = :'claim2' AND boq_item_id = rehearsal.row(2) \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 whoever submitted cannot verify', format('SELECT verify_progress_claim(%L, %L)', :'claim2', jsonb_build_array(jsonb_build_object('line_id', :'c2_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'c2_row2', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_SELF_VERIFY:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est2') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 the verifier cannot lower a figure without a reason', format('SELECT verify_progress_claim(%L, %L)', :'claim2', jsonb_build_array(jsonb_build_object('line_id', :'c2_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb), jsonb_build_object('line_id', :'c2_row2', 'verified_pct', '{"BEKISTING":80,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_REGRESS_REASON:');
SELECT verify_progress_claim(:'claim2', jsonb_build_array(
  jsonb_build_object('line_id', :'c2_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'c2_row2', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))) AS verify2 \gset
COMMIT;

SELECT rehearsal.expect('104 verify 2 reports two entries and one regression', (:'verify2'::jsonb ->> 'entries')::int = 2 AND (:'verify2'::jsonb ->> 'regressions')::int = 1, :'verify2');
SELECT rehearsal.expect('104 the kolom correction is one negative entry of -9.72 carrying the reason', (SELECT count(*) = 1 AND bool_and(quantity = -9.72 AND note LIKE '%Salah hitung begel%') FROM progress_entries WHERE boq_item_id = rehearsal.row(1) AND quantity < 0));
SELECT rehearsal.expect('104 kolom installed 52.04, progress 52.0', (SELECT installed = 52.04 AND progress = 52.0 FROM boq_items WHERE id = rehearsal.row(1)));
SELECT rehearsal.expect('104 balok installed 111.6 = 200 x (0.368 + 0.38 x 0.5), progress 55.8', (SELECT installed = 111.6 AND progress = 55.8 FROM boq_items WHERE id = rehearsal.row(2)));
SELECT rehearsal.expect('104 for every claimed row the entries sum to installed', (SELECT bool_and(b.installed = COALESCE((SELECT sum(quantity) FROM progress_entries e WHERE e.boq_item_id = b.id), 0)) FROM boq_items b WHERE b.id IN (SELECT boq_item_id FROM progress_claim_lines WHERE project_id = rehearsal.p())));
SELECT rehearsal.expect('104 the correction was logged as a WARNING', (SELECT count(*) = 1 FROM activity_log WHERE project_id = rehearsal.p() AND flag = 'WARNING'));
SELECT rehearsal.expect('104 the correction entry has no photos', (SELECT count(*) = 0 FROM progress_photos ph JOIN progress_entries e ON e.id = ph.progress_entry_id WHERE e.quantity < 0));

-- E. Weights, uniqueness, the math, the catalog
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 a claimed row cannot switch to a single stage', format('SELECT set_boq_stage_weights(%L, %L)', rehearsal.row(1), '{"SINGLE":1}'), 'WEIGHTS_SHAPE_LOCKED:');
SELECT rehearsal.expect('104 a claimed row can still change its split', (set_boq_stage_weights(rehearsal.row(1), '{"BEKISTING":0.3,"PEMBESIAN":0.5,"PENGECORAN":0.2}') ->> 'source') = 'manual');
SELECT rehearsal.expect('104 a row whose only line was removed can switch shape', (set_boq_stage_weights(rehearsal.row(3), '{"BEKISTING":0.3,"PEMBESIAN":0.4,"PENGECORAN":0.3}') ->> 'source') = 'manual');
ROLLBACK;

BEGIN;
INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (rehearsal.p(), '2026-09-14', rehearsal.u('sup'));
SELECT rehearsal.expect_error('104 a second open claim for one project is impossible', format('INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (%L, %L, %L)', rehearsal.p(), '2026-09-14', rehearsal.u('sup')), 'duplicate key value violates unique constraint "progress_claims_one_open"');
ROLLBACK;
SELECT rehearsal.expect_error('104 week_start must be a Monday', format('INSERT INTO progress_claims (project_id, week_start, created_by) VALUES (%L, %L, %L)', rehearsal.p(), '2026-09-15', rehearsal.u('sup')), 'new row for relation "progress_claims" violates check constraint "progress_claims_week_monday"');
SELECT rehearsal.expect_error('104 a progress entry of zero is refused', format('INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status) VALUES (%L, %L, %L, 0, %L, %L)', rehearsal.p(), rehearsal.row(1), rehearsal.u('sup'), 'm3', 'IN_PROGRESS'), 'new row for relation "progress_entries" violates check constraint "progress_entries_quantity_nonzero"');

SELECT rehearsal.expect('104 fraction: 0.368 + 0.38 x 0.5 = 0.558 (stageMath test)', stage_row_fraction('{"BEKISTING":0.368,"PEMBESIAN":0.38,"PENGECORAN":0.252}', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}') = 0.558);
SELECT rehearsal.expect('104 fraction: weights summing to 0.999 still reach 1', stage_row_fraction('{"BEKISTING":0.333,"PEMBESIAN":0.333,"PENGECORAN":0.333}', '{"BEKISTING":100,"PEMBESIAN":100,"PENGECORAN":100}') = 1);
SELECT rehearsal.expect('104 fraction: SINGLE 55 = 0.55', stage_row_fraction('{"SINGLE":1}', '{"SINGLE":55}') = 0.55);
SELECT rehearsal.expect('104 pct: keys must match the weights', NOT stage_pct_valid('{"SINGLE":1}', '{"BEKISTING":10}'));
SELECT rehearsal.expect('104 pct: scalar refused', NOT stage_pct_valid('{"SINGLE":1}', '5'));
SELECT rehearsal.expect('104 pct: negative refused', NOT stage_pct_valid('{"SINGLE":1}', '{"SINGLE":-1}'));
SELECT rehearsal.expect('104 pct: empty against empty refused', NOT stage_pct_valid('{}', '{}'));
SELECT rehearsal.expect('104 notifications: sixteen types with the three claim types', (SELECT array_length(regexp_split_to_array(d, '::text'), 1) - 1 = 16 AND d LIKE '%PROGRESS_CLAIM_SUBMITTED%' AND d LIKE '%PROGRESS_CLAIM_RETURNED%' AND d LIKE '%PROGRESS_CLAIM_VERIFIED%' AND d LIKE '%SITE_EVENT_ASSIGNED%' FROM (SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'notifications_type_check') t));
SELECT rehearsal.expect('104 policies: the supervisor progress write policies are gone', (SELECT count(*) = 0 FROM pg_policies WHERE policyname IN ('progress_entries_assigned_insert', 'boq_items_assigned_progress_update')));
SELECT rehearsal.expect('104 privileges: anon runs none of the 104 functions', NOT bool_or(has_function_privilege('anon', oid, 'EXECUTE'))) FROM pg_proc WHERE proname IN ('stage_pct_valid', 'stage_pct_round', 'stage_row_fraction', 'zero_stage_pct', 'latest_verified_stage_pct', 'save_progress_claim_line', 'remove_progress_claim_line', 'submit_progress_claim', 'return_progress_claim', 'verify_progress_claim');
SELECT rehearsal.expect('104 privileges: authenticated cannot call latest_verified_stage_pct', NOT has_function_privilege('authenticated', 'latest_verified_stage_pct(uuid)', 'EXECUTE'));

-- F. Review fixes: one writer of progress, re-weighting between verifications,
--    a verifier-less project, line authors, legacy installed, the read views.

-- F1. Nobody but verification writes progress, and publishing still works
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 the principal cannot insert a progress entry', format('INSERT INTO progress_entries (project_id, boq_item_id, reported_by, quantity, unit, work_status) VALUES (%L, %L, %L, 50, %L, %L)', rehearsal.p(), rehearsal.row(2), rehearsal.u('pri'), 'm3', 'IN_PROGRESS'), 'new row violates row-level security');
SELECT rehearsal.expect_error('104 the principal cannot set installed', format('UPDATE boq_items SET installed = 9.5, progress = 95 WHERE id = %L', rehearsal.row(2)), 'PROGRESS_SINGLE_WRITER:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 an estimator cannot call sync_boq_progress', format('SELECT sync_boq_progress(%L)', rehearsal.p()), 'permission denied');
SELECT rehearsal.expect_error('104 an estimator cannot insert a progress photo', format('INSERT INTO progress_photos (progress_entry_id, storage_path) SELECT id, %L FROM progress_entries WHERE project_id = %L LIMIT 1', 'progress/x.jpg', rehearsal.p()), 'new row violates row-level security');
SELECT rehearsal.expect_error('104 a new BoQ row cannot start with progress', format('INSERT INTO boq_items (project_id, code, label, unit, planned, installed) VALUES (%L, %L, %L, %L, 10, 5)', rehearsal.p(), 'T1-099', 'Uji', 'm3'), 'PROGRESS_SINGLE_WRITER:');
WITH u AS (UPDATE boq_items SET label = label || ' (uji)' WHERE id = rehearsal.row(2) RETURNING 1)
SELECT rehearsal.expect('104 an estimator still edits other BoQ columns, as publishing needs', count(*) = 1) FROM u;
ROLLBACK;

-- F2. Claim 3: re-weighting, an estimator reshaping a supervisor seed, a line author, legacy installed
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator re-weights a verified row without changing its shape', (set_boq_stage_weights(rehearsal.row(1), '{"BEKISTING":0.2,"PEMBESIAN":0.5,"PENGECORAN":0.3}') ->> 'source') = 'manual');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 a supervisor seeds a one-stage class on a row without weights', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(6), 'reference_class', 'LAINNYA'))) = 1);
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(6), '{"SINGLE":100}') ->> 'claim_id' AS claim3 \gset
SELECT rehearsal.expect('104 the same stage percents on the re-weighted row save without a reason', (save_progress_claim_line(rehearsal.p(), rehearsal.row(1), '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}') ->> 'claim_id') = :'claim3');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator reshapes a row whose only claim line is still open', (reset_boq_stage_weights(rehearsal.row(6), 'PILECAP_SLOOF_PLAT_DASAR') ->> 'source') = 'reference');
SELECT rehearsal.expect('104 an estimator may also fill a line', (save_progress_claim_line(rehearsal.p(), rehearsal.row(3), '{"SINGLE":50}') ->> 'claim_id') = :'claim3');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 submit re-checks an open line against reshaped weights', format('SELECT submit_progress_claim(%L)', :'claim3'), 'CLAIM_PCT:');
SELECT rehearsal.expect('104 the supervisor re-enters the reshaped row', (save_progress_claim_line(rehearsal.p(), rehearsal.row(6), '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}') ->> 'claim_id') = :'claim3');
COMMIT;

UPDATE boq_items SET installed = 4 WHERE id = rehearsal.row(3);
SELECT rehearsal.expect('104 a session without a JWT (the SQL editor) may still set installed', (SELECT installed = 4 FROM boq_items WHERE id = rehearsal.row(3)));

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 claim 3 submits and reaches both estimators', (submit_progress_claim(:'claim3') ->> 'verifiers_notified')::int = 2);
COMMIT;

SELECT id AS c3_row1 FROM progress_claim_lines WHERE claim_id = :'claim3' AND boq_item_id = rehearsal.row(1) \gset
SELECT id AS c3_row3 FROM progress_claim_lines WHERE claim_id = :'claim3' AND boq_item_id = rehearsal.row(3) \gset
SELECT id AS c3_row6 FROM progress_claim_lines WHERE claim_id = :'claim3' AND boq_item_id = rehearsal.row(6) \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 an estimator who filled a line cannot verify the claim', format('SELECT verify_progress_claim(%L, %L)', :'claim3', jsonb_build_array(
  jsonb_build_object('line_id', :'c3_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'c3_row3', 'verified_pct', '{"SINGLE":50}'::jsonb),
  jsonb_build_object('line_id', :'c3_row6', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_SELF_VERIFY:');
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est2') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('104 a quantity drop from re-weighting needs a reason even when no percent dropped', format('SELECT verify_progress_claim(%L, %L)', :'claim3', jsonb_build_array(
  jsonb_build_object('line_id', :'c3_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb),
  jsonb_build_object('line_id', :'c3_row3', 'verified_pct', '{"SINGLE":50}'::jsonb),
  jsonb_build_object('line_id', :'c3_row6', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))), 'CLAIM_REGRESS_REASON:');
SELECT verify_progress_claim(:'claim3', jsonb_build_array(
  jsonb_build_object('line_id', :'c3_row1', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":40,"PENGECORAN":0}'::jsonb, 'regress_reason', 'Bobot kolom diubah estimator'),
  jsonb_build_object('line_id', :'c3_row3', 'verified_pct', '{"SINGLE":50}'::jsonb),
  jsonb_build_object('line_id', :'c3_row6', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":50,"PENGECORAN":0}'::jsonb))) AS verify3 \gset
COMMIT;

SELECT rehearsal.expect('104 re-weighting writes a -12.04 correction that carries its reason', (SELECT count(*) = 1 AND bool_and(note LIKE '%Bobot kolom diubah estimator%') FROM progress_entries WHERE boq_item_id = rehearsal.row(1) AND quantity = -12.04));
SELECT rehearsal.expect('104 kolom installed 40 = 100 x (0.2 + 0.5 x 0.4)', (SELECT installed = 40 FROM boq_items WHERE id = rehearsal.row(1)));
SELECT rehearsal.expect('104 the reshaped pile cap row installed 11.07 = 30 x (0.131 + 0.476 x 0.5)', (SELECT installed = 11.07 FROM boq_items WHERE id = rehearsal.row(6)));
SELECT rehearsal.expect('104 legacy installed 4 gives way to the entries and the difference is logged',
  (SELECT installed = 5 FROM boq_items WHERE id = rehearsal.row(3))
  AND (SELECT count(*) = 1 FROM activity_log WHERE project_id = rehearsal.p() AND flag = 'WARNING' AND label LIKE 'T1-003: terpasang tercatat 4 berbeda dari riwayat progres 0%')
  AND (SELECT installed_cached_before = 4 AND installed_before = 0 FROM progress_claim_lines WHERE id = :'c3_row3'));
SELECT rehearsal.expect('104 after claim 3 every claimed row still sums its entries to installed', (SELECT bool_and(b.installed = COALESCE((SELECT sum(quantity) FROM progress_entries e WHERE e.boq_item_id = b.id), 0)) FROM boq_items b WHERE b.id IN (SELECT boq_item_id FROM progress_claim_lines WHERE project_id = rehearsal.p())));

-- F3. No estimator or admin assigned: the principal hears about the claim
BEGIN;
DELETE FROM project_assignments WHERE project_id = rehearsal.p() AND user_id IN (rehearsal.u('est'), rehearsal.u('est2'));
SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') ->> 'claim_id' AS claim4 \gset
SELECT submit_progress_claim(:'claim4') AS submit4 \gset
RESET ROLE;
SELECT rehearsal.expect('104 with no verifier assigned the principal is told instead',
  (:'submit4'::jsonb ->> 'verifiers_notified')::int = 0
  AND (:'submit4'::jsonb ->> 'notified')::int = 1
  AND (SELECT count(*) = 1 FROM notifications WHERE related_entity_id = :'claim4' AND type = 'PROGRESS_CLAIM_SUBMITTED' AND recipient_user_id = rehearsal.u('pri')));
ROLLBACK;

-- F4. Removing the last line, an admin verifying, the principal reading, estimator seeding, the views
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') AS save5 \gset
SELECT rehearsal.expect('104 removing the last line leaves an empty claim', (remove_progress_claim_line((:'save5'::jsonb ->> 'line_id')::uuid) ->> 'lines_left')::int = 0);
SELECT rehearsal.expect_error('104 an empty claim cannot be submitted', format('SELECT submit_progress_claim(%L)', :'save5'::jsonb ->> 'claim_id'), 'CLAIM_EMPTY:');
SELECT rehearsal.expect('104 the emptied claim takes a line again', (save_progress_claim_line(rehearsal.p(), rehearsal.row(2), '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}') ->> 'claim_id') = (:'save5'::jsonb ->> 'claim_id'));
SELECT rehearsal.expect('104 and submits', (submit_progress_claim((:'save5'::jsonb ->> 'claim_id')::uuid) ->> 'status') = 'SUBMITTED');
COMMIT;

SELECT id AS c5_line FROM progress_claim_lines WHERE claim_id = (:'save5'::jsonb ->> 'claim_id')::uuid \gset

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an unassigned admin verifies as an office role', (verify_progress_claim((:'save5'::jsonb ->> 'claim_id')::uuid, jsonb_build_array(jsonb_build_object('line_id', :'c5_line', 'verified_pct', '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb))) ->> 'status') = 'VERIFIED');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 the principal reads claim lines', (SELECT count(*) > 0 FROM progress_claim_lines WHERE project_id = rehearsal.p()));
SELECT rehearsal.expect('104 the latest verified view has one row per verified BoQ row', (SELECT count(*) = 4 FROM progress_claim_latest_verified WHERE project_id = rehearsal.p()));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 the entry totals view equals installed for every claimed row', (SELECT bool_and(t.installed_total = b.installed) FROM progress_entry_totals t JOIN boq_items b ON b.id = t.boq_item_id WHERE t.project_id = rehearsal.p()));
SELECT rehearsal.expect('104 the latest verified view shows row 2 at its newest figure', (SELECT verified_pct = '{"BEKISTING":100,"PEMBESIAN":60,"PENGECORAN":0}'::jsonb FROM progress_claim_latest_verified WHERE boq_item_id = rehearsal.row(2)));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an outsider reads nothing through the views', (SELECT count(*) FROM progress_claim_latest_verified) = 0 AND (SELECT count(*) FROM progress_entry_totals) = 0);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('104 an estimator seeds reference weights too', seed_reference_stage_weights(rehearsal.p(), jsonb_build_array(jsonb_build_object('boq_item_id', rehearsal.row(5), 'reference_class', 'DINDING'))) = 1);
ROLLBACK;

SELECT rehearsal.expect('104 privileges: anon cannot read the views', NOT has_table_privilege('anon', 'progress_claim_latest_verified', 'SELECT') AND NOT has_table_privilege('anon', 'progress_entry_totals', 'SELECT'));
SELECT rehearsal.expect('104 privileges: the views run with the caller rights', (SELECT bool_and(reloptions @> ARRAY['security_invoker=on']) FROM pg_class WHERE relname IN ('progress_claim_latest_verified', 'progress_entry_totals')));
```

`supabase/tests/progress_claims_rehearsal/run.sh` (new file):

```bash
#!/usr/bin/env bash
# Rehearses migrations 103 and 104 on a disposable local Supabase Postgres, as
# the roles that will call them (supervisor, estimator, admin, principal,
# outsider). Needs Docker and a supabase/postgres image; touches nothing but the
# container. The first run applies 001-102 to a fresh container (the storage
# schema is absent there, so 003, 006 and 097 report a few storage errors; that
# is expected). Every later run re-pastes 103 and 104 twice, rebuilds the
# fixture and runs every check.
#
#   supabase/tests/progress_claims_rehearsal/run.sh            # keep the container
#   supabase/tests/progress_claims_rehearsal/run.sh --stop     # remove it afterwards
set -euo pipefail
IMAGE="${SANO_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.131}"
NAME=sano-pg-rehearsal
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
pg() { docker exec -i "$NAME" psql -d postgres "$@"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  until docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1 from pg_proc where proname = 'uid'" 2>/dev/null | grep -q 1; do sleep 1; done
  for f in "$ROOT"/supabase/migrations/[0-9][0-9][0-9]_*.sql; do
    n="$(basename "$f")"
    [ "${n:0:3}" -ge 103 ] && continue
    pg -U postgres -q < "$f" >/dev/null 2>&1 || true
  done
fi

for pass in first second; do
  pg -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/migrations/103_boq_stage_weights.sql" >/dev/null 2>&1 || { echo "103 failed on the $pass paste"; exit 1; }
  pg -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/migrations/104_progress_claims.sql" >/dev/null 2>&1 || { echo "104 failed on the $pass paste"; exit 1; }
done
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/fixture.sql" >/dev/null

out="$(cat "$DIR/rehearse_103.sql" "$DIR/rehearse_104.sql" | pg -U postgres -q 2>&1)"
printf '%s\n' "$out" | grep -E '^FAIL|ERROR' || true
pass="$(printf '%s\n' "$out" | grep -c '^PASS' || true)"
fail="$(printf '%s\n' "$out" | grep -c '^FAIL' || true)"
err="$(printf '%s\n' "$out" | grep -c 'ERROR' || true)"
echo "PASS=$pass FAIL=$fail ERROR=$err"
[ "${1:-}" = "--stop" ] && docker stop "$NAME" >/dev/null
[ "$fail" -eq 0 ] && [ "$err" -eq 0 ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tools/__tests__/migration104.test.ts tools/__tests__/migration096.test.ts tools/__tests__/migration098.test.ts tools/__tests__/migration099.test.ts tools/__tests__/migration100.test.ts tools/__tests__/migration101.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 6 suites, 238 tests.

- [ ] **Step 5: Rehearse both migrations as real roles**

Needs Docker and the `public.ecr.aws/supabase/postgres` image the Supabase CLI already pulled (override with `SANO_PG_IMAGE`). The first run starts a disposable container named `sano-pg-rehearsal` and applies 001-102; 003, 006 and 097 print a few storage-schema errors there, which is expected.

Run: `supabase/tests/progress_claims_rehearsal/run.sh`
Expected last line:

```text
PASS=153 FAIL=0 ERROR=0
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/104_progress_claims.sql supabase/tests/progress_claims_rehearsal/fixture.sql supabase/tests/progress_claims_rehearsal/rehearse_103.sql supabase/tests/progress_claims_rehearsal/rehearse_104.sql supabase/tests/progress_claims_rehearsal/run.sh tools/__tests__/migration104.test.ts
git commit -m "feat(db): migration 104 weekly progress claims, verification and notifications"
```

---

### Task 13: Read-only storage photo

**Files:**
- Create: `workflows/components/StoragePhoto.tsx`
- Test: `workflows/components/__tests__/StoragePhoto.test.tsx`

The verification view shows claim photos read-only. This is the same component, byte for byte, as `workflows/components/StoragePhoto.tsx` on `fix/principal-site-change-photos-v2`, so whichever branch merges first the other merges cleanly.

- [ ] **Step 1: Write the failing test**

`workflows/components/__tests__/StoragePhoto.test.tsx` (new file):

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// react-native's own jest mock for Image (jest/mocks/Image.js) requires the RN
// preset's haste platform resolution to reach Image.ios.js; under this ts-jest
// config Image.js resolves to itself and the mock throws. Substitute a host View
// that carries every prop (source, style, testID, onError) through — the same
// precedent NotificationList.test.tsx uses for FlatList.
jest.mock('react-native/Libraries/Image/Image', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const ImageMock = (props: Record<string, unknown>) => ReactLocal.createElement(View, props);
  return { __esModule: true, default: ImageMock };
});

// tools/storage pulls in supabase + expo-image-picker; substitute the resolver only.
jest.mock('../../../tools/storage', () => ({
  resolvePhotoUrl: jest.fn(),
}));

import { resolvePhotoUrl } from '../../../tools/storage';
import StoragePhoto from '../StoragePhoto';

const mockResolve = resolvePhotoUrl as jest.MockedFunction<typeof resolvePhotoUrl>;

describe('StoragePhoto', () => {
  beforeEach(() => {
    mockResolve.mockReset();
  });

  it('shows a loading placeholder, then renders the resolved URL (never the raw path)', async () => {
    const signed = 'https://project.supabase.co/storage/v1/object/sign/photos/site-changes/p1/1.jpg?token=abc';
    mockResolve.mockResolvedValue(signed);

    const { getByTestId, queryByTestId, getByText } = render(
      <StoragePhoto path="site-changes/p1/1.jpg" testID="photo" />,
    );

    expect(getByTestId('photo-placeholder')).toBeTruthy();
    expect(getByText('Memuat foto')).toBeTruthy();
    expect(queryByTestId('photo')).toBeNull();

    await waitFor(() => expect(getByTestId('photo')).toBeTruthy());
    expect(getByTestId('photo').props.source).toEqual({ uri: signed });
    expect(queryByTestId('photo-placeholder')).toBeNull();
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith('site-changes/p1/1.jpg');
  });

  it('hands prefixed values to resolvePhotoUrl untouched (site-media:<path> routing lives in storage.ts)', async () => {
    mockResolve.mockResolvedValue('https://signed.example/x');
    const { findByTestId } = render(
      <StoragePhoto path="site-media:site-events/p1/e1/m1.jpg" testID="photo" />,
    );
    await findByTestId('photo');
    expect(mockResolve).toHaveBeenCalledWith('site-media:site-events/p1/e1/m1.jpg');
  });

  it('shows the unavailable placeholder when resolution rejects', async () => {
    mockResolve.mockRejectedValue(new Error('storage down'));
    const { findByText, queryByTestId } = render(
      <StoragePhoto path="site-changes/p1/2.jpg" testID="photo" />,
    );
    expect(await findByText('Foto tidak tersedia')).toBeTruthy();
    expect(queryByTestId('photo')).toBeNull();
  });

  it('falls back to the unavailable placeholder when the image itself fails to load', async () => {
    mockResolve.mockResolvedValue('https://signed.example/expired');
    const { findByTestId, findByText, queryByTestId } = render(
      <StoragePhoto path="site-changes/p1/3.jpg" testID="photo" />,
    );
    const image = await findByTestId('photo');
    fireEvent(image, 'error');
    expect(await findByText('Foto tidak tersedia')).toBeTruthy();
    expect(queryByTestId('photo')).toBeNull();
  });

  it('re-resolves when the path prop changes and drops the stale URL meanwhile', async () => {
    mockResolve.mockResolvedValueOnce('https://signed.example/first');
    const { findByTestId, getByTestId, rerender } = render(
      <StoragePhoto path="a.jpg" testID="photo" />,
    );
    await findByTestId('photo');

    mockResolve.mockResolvedValueOnce('https://signed.example/second');
    rerender(<StoragePhoto path="b.jpg" testID="photo" />);
    expect(getByTestId('photo-placeholder')).toBeTruthy();

    await waitFor(() => expect(getByTestId('photo').props.source).toEqual({ uri: 'https://signed.example/second' }));
    expect(mockResolve).toHaveBeenLastCalledWith('b.jpg');
  });

  it('honours custom labels and applies the given style to both states', async () => {
    mockResolve.mockResolvedValue('https://signed.example/x');
    const style = { width: 160, height: 120 };
    const { getByTestId, getByText, findByTestId } = render(
      <StoragePhoto path="a.jpg" testID="photo" style={style} loadingLabel="Memuat foto 2" />,
    );
    expect(getByText('Memuat foto 2')).toBeTruthy();
    expect(getByTestId('photo-placeholder').props.style).toEqual(
      expect.arrayContaining([style]),
    );
    const image = await findByTestId('photo');
    expect(image.props.style).toEqual(style);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest workflows/components/__tests__/StoragePhoto.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../StoragePhoto'`.

- [ ] **Step 3: Write the implementation**

`workflows/components/StoragePhoto.tsx` (new file):

```tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
  type ImageResizeMode,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPE } from '../theme';
import { resolvePhotoUrl } from '../../tools/storage';

/**
 * Read-only thumbnail for a photo kept in Supabase Storage.
 *
 * Columns such as site_changes.photo_urls and defects.photo_path store bucket
 * PATHS ("site-changes/{projectId}/{ts}.jpg"), not URLs — pickAndUploadPhoto
 * returns the path it uploaded to. Feeding that raw value to <Image> renders a
 * broken image. Every value is therefore handed to resolvePhotoUrl (signed URL
 * with an in-memory cache); storage.ts owns any prefix routing (for example the
 * upcoming "site-media:<path>" private bucket), so nothing here builds a URL.
 *
 * Editable galleries keep using PhotoGalleryField / PhotoSlot; this is the
 * display-only counterpart for office/principal detail views.
 */

type Status = 'loading' | 'ready' | 'error';

interface Props {
  /** Stored Storage path, passed to resolvePhotoUrl verbatim. */
  path: string;
  /** Applied to the image and to the placeholder box, so both take the same space. */
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  loadingLabel?: string;
  errorLabel?: string;
  /** Image gets `testID`; the placeholder gets `${testID}-placeholder`. */
  testID?: string;
}

export default function StoragePhoto({
  path,
  style,
  resizeMode = 'cover',
  loadingLabel = 'Memuat foto',
  errorLabel = 'Foto tidak tersedia',
  testID,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setStatus('loading');

    resolvePhotoUrl(path)
      .then((resolved) => {
        if (!alive) return;
        setUrl(resolved);
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });

    return () => {
      alive = false;
    };
  }, [path]);

  if (status === 'ready' && url) {
    return (
      <Image
        source={{ uri: url }}
        style={style}
        resizeMode={resizeMode}
        onError={() => setStatus('error')}
        testID={testID}
      />
    );
  }

  return (
    <View
      style={[style as StyleProp<ViewStyle>, styles.fallback]}
      testID={testID ? `${testID}-placeholder` : undefined}
    >
      <Ionicons
        name={status === 'error' ? 'alert-circle-outline' : 'image-outline'}
        size={22}
        color={COLORS.textSec}
      />
      <Text style={styles.fallbackText}>{status === 'error' ? errorLabel : loadingLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 6,
  },
  fallbackText: {
    fontSize: TYPE.xs,
    color: COLORS.textSec,
    textAlign: 'center',
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest workflows/components/__tests__/StoragePhoto.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add workflows/components/StoragePhoto.tsx workflows/components/__tests__/StoragePhoto.test.tsx
git commit -m "feat(ui): read-only StoragePhoto thumbnail (same file as the photo-fix branch)"
```

---

### Task 14: Stage claim form (inline, one row)

**Files:**
- Create: `workflows/screens/progressClaim/StageClaimForm.tsx`
- Test: `workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx`

Expands under the tapped row (project convention). Starts from the verified figures, offers 0/25/50/75/100 chips per stage, previews the row fraction and quantity change, asks for a photo when the figure rises and for a reason when a stage drops below its verified value, and saves through `save_progress_claim_line`. Android line heights are 1.45 × font size so Space Grotesk never clips.

- [ ] **Step 1: Write the failing test**

`workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx` (new file):

```tsx
// workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  saveClaimLine: jest.fn(),
  removeClaimLine: jest.fn(),
}));
jest.mock('../../../../tools/storage', () => ({ pickAndUploadPhoto: jest.fn() }));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../components/PhotoGalleryField', () => {
  const ReactLocal = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { photoPaths: string[]; onAdd: () => void }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(TouchableOpacity, { onPress: props.onAdd, accessibilityLabel: 'Tambah foto' }, ReactLocal.createElement(Text, null, 'Tambah foto')),
        ReactLocal.createElement(Text, null, `${props.photoPaths.length} foto dipilih`),
      ),
  };
});

import { removeClaimLine, saveClaimLine } from '../../../../tools/progressClaims/claims';
import { pickAndUploadPhoto } from '../../../../tools/storage';
import StageClaimForm, { type WeightedRowView } from '../StageClaimForm';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const makeRow = (over: Partial<WeightedRowView> = {}): WeightedRowView => ({
  item: { id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 32.6, progress: 32.6 },
  weights: kolom,
  source: 'reference',
  referenceClass: 'KOLOM',
  prevPct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimedPct: null,
  lineId: null,
  note: null,
  regressReason: null,
  photoRefs: [],
  prevFraction: 0.326,
  claimedFraction: null,
  linkedLines: 0,
  installedLedger: 32.6,
  installedMismatch: false,
  ...over,
});

const setup = (over: Partial<WeightedRowView> = {}, editable = true) => {
  const props = { onSaved: jest.fn(), onRemoved: jest.fn(), onClose: jest.fn(), toast: jest.fn() };
  const utils = render(<StageClaimForm projectId="p1" row={makeRow(over)} editable={editable} {...props} />);
  return { ...utils, ...props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (saveClaimLine as jest.Mock).mockResolvedValue({ claim_id: 'c1', claim_status: 'DRAFT' });
  (pickAndUploadPhoto as jest.Mock).mockResolvedValue('progress/p1/1.jpg');
});

describe('StageClaimForm', () => {
  it('starts from the verified figures and previews what the row becomes', () => {
    const { getByLabelText, getByText } = setup();
    expect(getByLabelText('Persentase Bekisting').props.value).toBe('100');
    expect(getByText('Bobot referensi (Kolom)')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Persentase Pembesian'), '60');
    expect(getByText('Progres baris 32,6% menjadi 61,8% (+29,16 m³)')).toBeTruthy();
  });

  it('saves the stage percents, note and photos into this week claim', async () => {
    const { getByLabelText, onSaved } = setup();
    fireEvent.press(getByLabelText('Pembesian 50 persen'));
    fireEvent.changeText(getByLabelText('Catatan progres'), 'Begel K1-K8');
    fireEvent.press(getByLabelText('Tambah foto'));
    await waitFor(() => expect(pickAndUploadPhoto).toHaveBeenCalledWith('progress/p1'));
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(saveClaimLine).toHaveBeenCalledWith({
      projectId: 'p1', boqItemId: 'k1', claimedPct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 },
      note: 'Begel K1-K8', photoRefs: ['progress/p1/1.jpg'], regressReason: null,
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('asks for a photo before saving an increase', async () => {
    const { getByLabelText, toast } = setup();
    fireEvent.changeText(getByLabelText('Persentase Pembesian'), '60');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Tambahkan minimal satu foto sebagai bukti.', 'critical');
    expect(saveClaimLine).not.toHaveBeenCalled();
  });

  it('asks for a reason before saving a figure below the verified one', async () => {
    const { getByLabelText, toast } = setup({ prevPct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, prevFraction: 0.5204, installedLedger: 52.04 });
    fireEvent.changeText(getByLabelText('Persentase Bekisting'), '90');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Penurunan progres wajib disertai alasan.', 'critical');
    fireEvent.changeText(getByLabelText('Alasan penurunan'), 'Bekisting K3 dibongkar ulang');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(saveClaimLine).toHaveBeenCalledWith(expect.objectContaining({
      claimedPct: { BEKISTING: 90, PEMBESIAN: 40, PENGECORAN: 0 }, regressReason: 'Bekisting K3 dibongkar ulang',
    })));
  });

  it('asks for a reason when re-weighting lowers the quantity although no stage dropped', () => {
    const { getByLabelText, getByText, toast } = setup({
      weights: { BEKISTING: 0.2, PEMBESIAN: 0.5, PENGECORAN: 0.3 },
      prevPct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 },
      prevFraction: 0.4,
      installedLedger: 52.04,
    });
    expect(getByText('Progres baris 40% menjadi 40% (-12,04 m³)')).toBeTruthy();
    expect(getByText('Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.')).toBeTruthy();
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Penurunan progres wajib disertai alasan.', 'critical');
    expect(saveClaimLine).not.toHaveBeenCalled();
  });

  it('says when installed on the BoQ differs from the progress history', () => {
    const { getByText } = setup({
      item: { id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 10, progress: 10 },
      installedLedger: 0,
      installedMismatch: true,
    });
    expect(getByText('Terpasang di BoQ 10 m³ berbeda dari riwayat progres 0 m³; verifikasi mengikuti riwayat.')).toBeTruthy();
  });

  it('refuses an invalid percent with the reason', () => {
    const { getByLabelText, getByText, toast } = setup();
    fireEvent.changeText(getByLabelText('Persentase Pengecoran'), '120');
    expect(getByText('Persentase pengecoran harus angka 0 sampai 100.')).toBeTruthy();
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Persentase pengecoran harus angka 0 sampai 100.', 'critical');
  });

  it('shows the server refusal sentence', async () => {
    (saveClaimLine as jest.Mock).mockRejectedValueOnce(new Error('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.'));
    const { getByLabelText, toast } = setup({ photoRefs: ['progress/p1/0.jpg'] });
    fireEvent.changeText(getByLabelText('Persentase Pembesian'), '10');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.', 'critical'));
  });

  it('removes the row from the claim', async () => {
    const { getByLabelText, onRemoved } = setup({ lineId: 'l1', claimedPct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 } });
    expect(getByLabelText('Persentase Pembesian').props.value).toBe('60');
    fireEvent.press(getByLabelText('Hapus T1-001 dari klaim'));
    await waitFor(() => expect(removeClaimLine).toHaveBeenCalledWith('l1'));
    expect(onRemoved).toHaveBeenCalled();
  });

  it('only reads when the claim is waiting for verification', () => {
    const { getByLabelText, queryByLabelText, getByText } = setup({ photoRefs: ['a', 'b'] }, false);
    expect(getByLabelText('Persentase Bekisting').props.editable).toBe(false);
    expect(queryByLabelText('Simpan progres T1-001')).toBeNull();
    expect(queryByLabelText('Bekisting 100 persen')).toBeNull();
    expect(getByText('2 foto terlampir')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../StageClaimForm'`.

- [ ] **Step 3: Write the implementation**

`workflows/screens/progressClaim/StageClaimForm.tsx` (new file):

```tsx
// workflows/screens/progressClaim/StageClaimForm.tsx
// SANO — the supervisor's stage claim for one work-area row (spec §16). It
// expands under the tapped row (project convention: inline, never a modal)
// and saves one line of the project's claim in progress through
// save_progress_claim_line, which re-checks every rule on the server.
import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import PhotoGalleryField from '../../components/PhotoGalleryField';
import { pickAndUploadPhoto } from '../../../tools/storage';
import { removeClaimLine, saveClaimLine, type SaveClaimLineResult } from '../../../tools/progressClaims/claims';
import {
  formatFraction, formatPercent, formatQty, pctInputs, readPctInputs, regressedStages, stageKeyLabel, weightSourceLabel,
  type ClaimRowView,
} from '../../../tools/progressClaims/claimView';
import { deltaFromInstalled, rowFraction } from '../../../tools/progressClaims/stageMath';
import { stagesOf, weightOf, type StageWeights } from '../../../tools/progressClaims/stageWeights';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

export const MAX_CLAIM_PHOTOS = 12;
const QUICK_PCT = [0, 25, 50, 75, 100];
const lh = (size: number) => Math.round(size * 1.45);

export type WeightedRowView = ClaimRowView & { weights: StageWeights };

interface Props {
  projectId: string;
  row: WeightedRowView;
  /** False while the claim waits for verification, or for a role that only reads. */
  editable: boolean;
  onSaved: (result: SaveClaimLineResult) => void;
  onRemoved: () => void;
  onClose: () => void;
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

export default function StageClaimForm({ projectId, row, editable, onSaved, onRemoved, onClose, toast }: Props) {
  const { weights, item } = row;
  const [inputs, setInputs] = useState<Record<string, string>>(() => pctInputs(weights, row.claimedPct ?? row.prevPct));
  const [photos, setPhotos] = useState<string[]>(row.photoRefs);
  const [note, setNote] = useState(row.note ?? '');
  const [reason, setReason] = useState(row.regressReason ?? '');
  const [busy, setBusy] = useState(false);

  const read = useMemo(() => readPctInputs(weights, inputs), [weights, inputs]);
  const preview = useMemo(() => {
    if (!read.ok) return null;
    const next = rowFraction(weights, read.pct);
    return {
      next,
      // What verification will write: the difference from what the row's entries already sum to.
      delta: deltaFromInstalled(item.planned, row.installedLedger, next),
      regressed: regressedStages(weights, row.prevPct, read.pct),
    };
  }, [read, weights, item.planned, row.installedLedger, row.prevPct]);
  const quantityDrops = !!preview && preview.delta.deltaQuantity < 0;
  const needsReason = !!preview && (preview.regressed.length > 0 || quantityDrops);

  const setStage = (stage: string, value: string) => setInputs((prev) => ({ ...prev, [stage]: value }));

  const addPhoto = async (replaceIndex?: number) => {
    try {
      const path = await pickAndUploadPhoto(`progress/${projectId}`);
      if (!path) return;
      setPhotos((prev) => (replaceIndex == null
        ? [...prev, path].slice(0, MAX_CLAIM_PHOTOS)
        : prev.map((p, i) => (i === replaceIndex ? path : p))));
    } catch (err) {
      toast((err as Error)?.message ?? 'Foto gagal diunggah.', 'critical');
    }
  };

  const save = async () => {
    if (!read.ok) {
      toast(read.reason, 'critical');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast('Penurunan progres wajib disertai alasan.', 'critical');
      return;
    }
    const rises = !!preview && preview.next > row.prevFraction;
    if (rises && photos.length === 0 && Platform?.OS !== 'web') {
      toast('Tambahkan minimal satu foto sebagai bukti.', 'critical');
      return;
    }
    setBusy(true);
    try {
      const result = await saveClaimLine({
        projectId,
        boqItemId: item.id,
        claimedPct: read.pct,
        note: note.trim() || null,
        photoRefs: photos,
        regressReason: needsReason ? reason.trim() : null,
      });
      toast(`${item.code} disimpan ke klaim minggu ini.`, 'ok');
      onSaved(result);
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal menyimpan.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!row.lineId) return;
    setBusy(true);
    try {
      await removeClaimLine(row.lineId);
      toast(`${item.code} dihapus dari klaim minggu ini.`, 'warning');
      onRemoved();
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal menghapus.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box} testID={`claim-form-${item.id}`}>
      <Text style={styles.meta}>{weightSourceLabel(row.source, row.referenceClass)}</Text>

      {stagesOf(weights).map((stage) => (
        <View key={stage} style={styles.stage}>
          <View style={styles.stageHead}>
            <Text style={styles.stageName}>
              {stageKeyLabel(stage)}{stage === 'SINGLE' ? '' : ` (bobot ${formatFraction(weightOf(weights, stage))})`}
            </Text>
            <Text style={styles.prev}>Terverifikasi {formatPercent(row.prevPct[stage] ?? 0)}</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, !editable && styles.inputDisabled]}
              value={inputs[stage] ?? ''}
              onChangeText={(v) => setStage(stage, v)}
              editable={editable}
              keyboardType="decimal-pad"
              placeholder="0-100"
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel={`Persentase ${stageKeyLabel(stage)}`}
            />
            <Text style={styles.pctSign}>%</Text>
            {editable && QUICK_PCT.map((q) => (
              <TouchableOpacity
                key={q}
                style={styles.chip}
                onPress={() => setStage(stage, String(q))}
                accessibilityRole="button"
                accessibilityLabel={`${stageKeyLabel(stage)} ${q} persen`}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              >
                <Text style={styles.chipText}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {preview ? (
        <Text style={styles.preview}>
          {`Progres baris ${formatFraction(row.prevFraction)} menjadi ${formatFraction(preview.next)} (${preview.delta.deltaQuantity > 0 ? '+' : ''}${formatQty(preview.delta.deltaQuantity, item.unit)})`}
        </Text>
      ) : (
        <Text style={styles.error}>{read.ok ? '' : read.reason}</Text>
      )}
      {row.installedMismatch && (
        <Text style={styles.meta}>
          {`Terpasang di BoQ ${formatQty(item.installed, item.unit)} berbeda dari riwayat progres ${formatQty(row.installedLedger, item.unit)}; verifikasi mengikuti riwayat.`}
        </Text>
      )}

      {needsReason && (
        <>
          <Text style={styles.warn}>
            {preview!.regressed.length > 0
              ? `Turun dari angka terverifikasi: ${preview!.regressed.map((s) => stageKeyLabel(s)).join(', ')}.`
              : 'Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.'}
          </Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={reason}
            onChangeText={setReason}
            editable={editable}
            multiline
            placeholder="Jelaskan kenapa progres turun"
            placeholderTextColor={COLORS.textMuted}
            accessibilityLabel="Alasan penurunan"
          />
        </>
      )}

      <Text style={styles.label}>Catatan</Text>
      <TextInput
        style={[styles.input, styles.textarea, !editable && styles.inputDisabled]}
        value={note}
        onChangeText={setNote}
        editable={editable}
        multiline
        placeholder="Contoh: kolom K1-K8 zona utara sudah dicor"
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel="Catatan progres"
      />

      <Text style={styles.label}>Foto bukti</Text>
      {editable ? (
        <PhotoGalleryField
          photoPaths={photos}
          onAdd={() => void addPhoto()}
          onReplace={(index) => void addPhoto(index)}
          onRemove={(index) => setPhotos((prev) => prev.filter((_, i) => i !== index))}
          maxPhotos={MAX_CLAIM_PHOTOS}
          emptyLabel="Tambah Foto Progres"
          helperText="Foto menjadi bukti untuk estimator saat verifikasi."
        />
      ) : (
        <Text style={styles.meta}>{`${photos.length} foto terlampir`}</Text>
      )}

      <View style={styles.btnRow}>
        {editable && (
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnBusy]}
            onPress={() => void save()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Simpan progres ${item.code}`}
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text style={styles.primaryBtnText}>{busy ? 'Menyimpan...' : 'Simpan'}</Text>
          </TouchableOpacity>
        )}
        {editable && row.lineId && (
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => void remove()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Hapus ${item.code} dari klaim`}
          >
            <Text style={styles.ghostBtnText}>Hapus dari klaim</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.ghostBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Tutup form progres">
          <Text style={styles.ghostBtnText}>Tutup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: SPACE.md, marginBottom: SPACE.sm, borderRadius: RADIUS, borderTopLeftRadius: 0, borderTopRightRadius: 0,
    backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  meta: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.xs },
  stage: { marginTop: SPACE.sm },
  stageHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: SPACE.xs },
  stageName: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  prev: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  inputRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xs },
  input: {
    minWidth: 72, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, fontSize: TYPE.md, lineHeight: lh(TYPE.md),
    fontFamily: FONTS.regular, color: COLORS.text,
  },
  inputDisabled: { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea: { minHeight: 64, textAlignVertical: 'top', alignSelf: 'stretch', marginTop: SPACE.xs },
  pctSign: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textSec, marginRight: SPACE.xs },
  chip: {
    minWidth: 40, minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text },
  preview: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.accentDark, marginTop: SPACE.md },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.sm },
  warn: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm },
  label: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.md },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, paddingHorizontal: SPACE.base, borderRadius: RADIUS, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/progressClaim/StageClaimForm.tsx workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx
git commit -m "feat(progress): inline stage claim form for one work-area row"
```

---

### Task 15: Weekly claim panel

**Files:**
- Create: `workflows/screens/progressClaim/ProgressClaimPanel.tsx`
- Test: `workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx`

Lists every claimable row with its verified and this-week figures, seeds reference weights for rows without them (roles that can claim only), opens the form under a row, locks while the claim waits for verification, and submits the week after an inline confirmation. Stale loads are dropped with a sequence ref.

- [ ] **Step 1: Write the failing test**

`workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx` (new file):

```tsx
// workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  listStageWeights: jest.fn(),
  seedReferenceWeights: jest.fn(),
  getOpenClaim: jest.fn(),
  listClaimLines: jest.fn(),
  listVerifiedStagePct: jest.fn(),
  countLinkedLinesByRow: jest.fn(),
  listEntryTotals: jest.fn(),
  submitClaim: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../StageClaimForm', () => {
  const ReactLocal = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { row: { item: { id: string } }; editable: boolean; onSaved: () => void }) =>
      ReactLocal.createElement(
        View,
        { testID: `claim-form-${props.row.item.id}` },
        ReactLocal.createElement(Text, null, props.editable ? 'editable' : 'read-only'),
        ReactLocal.createElement(TouchableOpacity, { onPress: props.onSaved, accessibilityLabel: 'Simulasi simpan' }, ReactLocal.createElement(Text, null, 'Simulasi simpan')),
      ),
  };
});

import {
  countLinkedLinesByRow, getOpenClaim, listClaimLines, listEntryTotals, listStageWeights, listVerifiedStagePct, seedReferenceWeights,
  submitClaim,
} from '../../../../tools/progressClaims/claims';
import ProgressClaimPanel from '../ProgressClaimPanel';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const item = (id: string, code: string, label: string, sort: number, projectId = 'p1') => ({
  id, project_id: projectId, code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const kolomWeights = { boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' };
const claim = (status: string, over: Record<string, unknown> = {}) => ({
  id: 'c1', project_id: 'p1', week_start: '2026-09-14', status, created_by: 'sup', created_at: 'x', updated_at: 'x',
  submitted_by: status === 'DRAFT' ? null : 'sup', submitted_at: null, returned_by: null, returned_at: null, return_note: null,
  verified_by: null, verified_at: null, verifier_note: null, ...over,
});
const line = {
  id: 'l1', claim_id: 'c1', project_id: 'p1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, verified_pct: null, weights_snapshot: null, row_pct_prev: null,
  row_pct_new: null, installed_before: null, delta_quantity: null, regress_reason: null, note: null, evidence: { photo_refs: [] },
  created_by: 'sup', updated_by: 'sup', created_at: 'x', updated_at: 'x',
};
const renderPanel = (over: Partial<React.ComponentProps<typeof ProgressClaimPanel>> = {}) => {
  const toast = jest.fn();
  const props = { projectId: 'p1', role: 'supervisor', boqItems: ITEMS, toast, ...over };
  return { ...render(<ProgressClaimPanel {...props} />), toast, props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (listStageWeights as jest.Mock).mockResolvedValue([kolomWeights]);
  (seedReferenceWeights as jest.Mock).mockResolvedValue(1);
  (getOpenClaim as jest.Mock).mockResolvedValue(claim('DRAFT'));
  (listClaimLines as jest.Mock).mockResolvedValue([line]);
  (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]));
  (countLinkedLinesByRow as jest.Mock).mockResolvedValue(new Map([['k1', 2]]));
  (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 32.6]]));
  (submitClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'SUBMITTED', lines: 1, notified: 2, verifiers_notified: 2 });
});

describe('ProgressClaimPanel', () => {
  it('seeds reference weights for rows without them, then lists verified and claimed figures', async () => {
    (listStageWeights as jest.Mock)
      .mockResolvedValueOnce([kolomWeights])
      .mockResolvedValueOnce([kolomWeights, { boq_item_id: 'pc1', weights: { BEKISTING: 0.131, PEMBESIAN: 0.476, PENGECORAN: 0.393 }, source: 'reference', reference_class: 'PILECAP_SLOOF_PLAT_DASAR', updated_at: 'x' }]);
    const { findByText, getByText } = renderPanel();
    expect(await findByText('Belum dikirim')).toBeTruthy();
    expect(seedReferenceWeights).toHaveBeenCalledWith('p1', [{ boq_item_id: 'pc1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' }]);
    expect(getByText('Minggu ini 61,8%')).toBeTruthy();
    expect(getByText('Terverifikasi 32,6%')).toBeTruthy();
    expect(getByText('0 foto · 2 baris laporan')).toBeTruthy();
    expect(countLinkedLinesByRow).toHaveBeenCalledWith('p1', '2026-09-14');
    expect(listEntryTotals).toHaveBeenCalledWith('p1');
  });

  it('never seeds weights for a role that only reads, and explains a row without them', async () => {
    const { findByLabelText, toast } = renderPanel({ role: 'principal' });
    fireEvent.press(await findByLabelText('T1-002 Lantai 1 ; Pile Cap'));
    expect(seedReferenceWeights).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.', 'warning');
  });

  it('opens the stage form under the tapped row and reloads after a save', async () => {
    const { findByLabelText, getByLabelText, getByTestId, getByText } = renderPanel();
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByTestId('claim-form-k1')).toBeTruthy();
    expect(getByText('editable')).toBeTruthy();
    fireEvent.press(getByLabelText('Simulasi simpan'));
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
  });

  it('opens the row it was asked to open', async () => {
    const { findByTestId } = renderPanel({ initialRowId: 'k1' });
    expect(await findByTestId('claim-form-k1')).toBeTruthy();
  });

  it('submits the week after an inline confirmation, names who was told, and reloads', async () => {
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Kirim klaim'));
    fireEvent.press(getByLabelText('Ya, kirim'));
    await waitFor(() => expect(submitClaim).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith('Klaim dikirim. 2 estimator atau admin diberi tahu untuk verifikasi.', 'ok');
  });

  it.each([
    [{ notified: 1, verifiers_notified: 0 }, 'Klaim dikirim, tetapi belum ada estimator atau admin di proyek ini. Prinsipal diberi tahu agar menugaskan verifikator.'],
    [{ notified: 0, verifiers_notified: 0 }, 'Klaim dikirim, tetapi belum ada yang bisa diberi tahu. Minta admin menugaskan estimator ke proyek ini.'],
  ])('warns when no verifier could be told (%j)', async (counts, message) => {
    (submitClaim as jest.Mock).mockResolvedValueOnce({ claim_id: 'c1', status: 'SUBMITTED', lines: 1, ...counts });
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Kirim klaim'));
    fireEvent.press(getByLabelText('Ya, kirim'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(message, 'warning'));
  });

  it('locks a submitted claim: a banner, no Kirim, and a read-only form', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(claim('SUBMITTED'));
    const { findByText, queryByLabelText, getByLabelText, getByText } = renderPanel();
    expect(await findByText('Menunggu verifikasi estimator. Baris baru bisa ditambah setelah klaim diverifikasi atau dikembalikan.')).toBeTruthy();
    expect(queryByLabelText('Kirim klaim')).toBeNull();
    fireEvent.press(getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByText('read-only')).toBeTruthy();
  });

  it('lets the supervisor edit and resend a returned claim, showing why it came back', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(claim('RETURNED', { return_note: 'Foto pembesian kurang jelas' }));
    const { findByText, getByLabelText, getByText } = renderPanel();
    expect(await findByText('Dikembalikan')).toBeTruthy();
    expect(getByText(`Minggu 14${String.fromCharCode(0x2013)}20 Sep: Foto pembesian kurang jelas`)).toBeTruthy();
    expect(getByLabelText('Kirim klaim')).toBeTruthy();
    fireEvent.press(getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByText('editable')).toBeTruthy();
  });

  it('reloads when asked to, as a notification tap does', async () => {
    const { findByText, rerender, props } = renderPanel();
    await findByText('Belum dikirim');
    rerender(<ProgressClaimPanel {...props} reloadKey={1} />);
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
  });

  it("never shows the previous project's claim or rows after a project switch", async () => {
    const { findByText, rerender, props, getByLabelText, queryByText } = renderPanel();
    await findByText('Belum dikirim');
    rerender(<ProgressClaimPanel {...props} projectId="p2" />);
    expect(getByLabelText('Memuat klaim progres')).toBeTruthy();
    expect(queryByText('Belum dikirim')).toBeNull();
    expect(listStageWeights).not.toHaveBeenCalledWith('p2');
  });

  it('says so when the project has no BoQ rows to claim', () => {
    const { getByText } = renderPanel({ boqItems: EMPTY });
    expect(getByText('Belum ada baris BoQ yang bisa diklaim. BoQ proyek ini belum dipublikasikan atau belum punya volume rencana.')).toBeTruthy();
    expect(listStageWeights).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../ProgressClaimPanel'`.

- [ ] **Step 3: Write the implementation**

`workflows/screens/progressClaim/ProgressClaimPanel.tsx` (new file):

```tsx
// workflows/screens/progressClaim/ProgressClaimPanel.tsx
// SANO — Tambah progres as the weekly stage claim (spec §16): every work-area
// row with its verified and this week's figures, the stage form inline under
// the tapped row, and Kirim for the week. Mounted in the Progres tab and in
// Laporan. Nothing here writes progress: verify_progress_claim does, after
// an estimator checks the claim.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import StageClaimForm, { type WeightedRowView } from './StageClaimForm';
import { canSaveClaimLine, isClaimEditable } from '../../../tools/progressClaims/claimRules';
import {
  countLinkedLinesByRow, getOpenClaim, listClaimLines, listEntryTotals, listStageWeights, listVerifiedStagePct, seedReferenceWeights, submitClaim,
  type ProgressClaim, type ProgressClaimLine, type StageWeightRow,
} from '../../../tools/progressClaims/claims';
import {
  buildRowViews, claimStatusSummary, claimableRows, formatFraction, missingWeightSeeds,
  type ClaimRowView, type ClaimableItem,
} from '../../../tools/progressClaims/claimView';
import type { StagePct } from '../../../tools/progressClaims/stageMath';
import { weekStartWIB } from '../../../tools/progressClaims/week';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);

interface Props {
  projectId: string;
  role: string | null | undefined;
  boqItems: ClaimableItem[];
  /** Row to open on arrival, e.g. from "Tambah progres untuk item ini". */
  initialRowId?: string | null;
  /** Bump to reload, e.g. when a claim notification brings the user back to a panel already on screen. */
  reloadKey?: number;
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

interface Loaded {
  projectId: string;
  claim: ProgressClaim | null;
  lines: ProgressClaimLine[];
  weights: StageWeightRow[];
  verified: Map<string, StagePct>;
  linked: Map<string, number>;
  ledger: Map<string, number>;
}

export default function ProgressClaimPanel({ projectId, role, boqItems, initialRowId, reloadKey = 0, toast }: Props) {
  const rows = useMemo(() => claimableRows(boqItems, projectId), [boqItems, projectId]);
  // Just after a project switch the context still holds the previous project's rows.
  const switching = rows.length === 0 && boqItems.some((b) => b.project_id != null && b.project_id !== projectId);
  const canSave = canSaveClaimLine(role);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialRowId ?? null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      let weights = await listStageWeights(projectId);
      const seeds = canSave ? missingWeightSeeds(rows, weights) : [];
      if (seeds.length > 0) {
        try {
          await seedReferenceWeights(projectId, seeds);
          weights = await listStageWeights(projectId);
        } catch (err) {
          toast((err as Error)?.message ?? 'Bobot referensi gagal diterapkan.', 'warning');
        }
      }
      const claim = await getOpenClaim(projectId);
      const [lines, verified, linked, ledger] = await Promise.all([
        claim ? listClaimLines(claim.id) : Promise.resolve([] as ProgressClaimLine[]),
        listVerifiedStagePct(projectId),
        countLinkedLinesByRow(projectId, claim?.week_start ?? weekStartWIB()),
        listEntryTotals(projectId),
      ]);
      if (mine === seq.current) setData({ projectId, claim, lines, weights, verified, linked, ledger });
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? 'Klaim progres gagal dimuat.');
    }
  }, [projectId, rows, canSave, toast]);

  useEffect(() => {
    if (rows.length === 0) return undefined;
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load, rows.length, reloadKey]);

  useEffect(() => {
    setExpandedId(initialRowId ?? null);
    setConfirming(false);
  }, [projectId, initialRowId]);

  // Never render another project's claim, with its Kirim still live.
  const current = data && data.projectId === projectId ? data : null;
  const views = useMemo(
    () => (current ? buildRowViews(rows, current.weights, current.verified, current.lines, current.linked, current.ledger) : []),
    [current, rows],
  );

  const claim = current?.claim ?? null;
  const summary = claimStatusSummary(claim);
  const editable = canSave && (claim === null || isClaimEditable(claim.status));
  const lineCount = current?.lines.length ?? 0;

  const submit = async () => {
    if (!claim) return;
    setSubmitting(true);
    try {
      const result = await submitClaim(claim.id);
      setConfirming(false);
      if (result.verifiers_notified > 0) {
        toast(`Klaim dikirim. ${result.verifiers_notified} estimator atau admin diberi tahu untuk verifikasi.`, 'ok');
      } else if (result.notified > 0) {
        toast('Klaim dikirim, tetapi belum ada estimator atau admin di proyek ini. Prinsipal diberi tahu agar menugaskan verifikator.', 'warning');
      } else {
        toast('Klaim dikirim, tetapi belum ada yang bisa diberi tahu. Minta admin menugaskan estimator ke proyek ini.', 'warning');
      }
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal mengirim klaim.', 'critical');
    } finally {
      setSubmitting(false);
    }
  };

  const openRow = (view: ClaimRowView) => {
    if (!view.weights) {
      toast('Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.', 'warning');
      return;
    }
    setExpandedId((prev) => (prev === view.item.id ? null : view.item.id));
  };

  const afterLineChange = () => {
    setExpandedId(null);
    void load();
  };

  if (switching) {
    return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;
  }

  if (rows.length === 0) {
    return (
      <Card title="Klaim Progres Mingguan">
        <Text style={styles.hint}>
          Belum ada baris BoQ yang bisa diklaim. BoQ proyek ini belum dipublikasikan atau belum punya volume rencana.
        </Text>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Klaim Progres Mingguan">
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Muat ulang klaim">
          <Text style={styles.ghostBtnText}>Coba lagi</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (!current) {
    return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;
  }

  return (
    <View>
      <Card title="Klaim Progres Mingguan" rightAction={<Badge flag={summary.flag} label={summary.label} />}>
        <Text style={styles.detail}>{summary.detail}</Text>
        <Text style={styles.hint}>
          {`${lineCount} baris diklaim. Progres proyek baru bertambah setelah estimator memverifikasi klaim.`}
        </Text>
        {claim?.status === 'SUBMITTED' && (
          <Text style={styles.banner}>
            Menunggu verifikasi estimator. Baris baru bisa ditambah setelah klaim diverifikasi atau dikembalikan.
          </Text>
        )}
        {editable && claim && lineCount > 0 && !confirming && (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setConfirming(true)} accessibilityRole="button" accessibilityLabel="Kirim klaim">
            <Text style={styles.primaryBtnText}>Kirim klaim</Text>
          </TouchableOpacity>
        )}
        {confirming && (
          <View style={styles.confirmBox}>
            <Text style={styles.detail}>{`Kirim ${lineCount} baris ke estimator untuk diverifikasi?`}</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, submitting && styles.btnBusy]}
                onPress={() => void submit()}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Ya, kirim"
                accessibilityState={{ disabled: submitting, busy: submitting }}
              >
                <Text style={styles.primaryBtnText}>{submitting ? 'Mengirim...' : 'Ya, kirim'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => setConfirming(false)} accessibilityRole="button" accessibilityLabel="Batal kirim">
                <Text style={styles.ghostBtnText}>Batal</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Card>

      {views.map((view) => (
        <View key={view.item.id} style={styles.rowWrap}>
          <TouchableOpacity
            style={[styles.row, expandedId === view.item.id && styles.rowActive]}
            onPress={() => openRow(view)}
            accessibilityRole="button"
            accessibilityLabel={`${view.item.code} ${view.item.label}`}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowCode}>{view.item.code}</Text>
              <Text style={styles.rowLabel}>{view.item.label}</Text>
              <Text style={[styles.rowSub, !view.weights && styles.rowSubWarn]}>
                {view.weights ? `${view.photoRefs.length} foto · ${view.linkedLines} baris laporan` : 'Bobot belum diatur'}
              </Text>
            </View>
            <View style={styles.rowFigures}>
              <Text style={styles.figure}>{`Terverifikasi ${formatFraction(view.weights ? view.prevFraction : null)}`}</Text>
              <Text style={[styles.figure, view.claimedFraction != null && styles.figureClaimed]}>
                {`Minggu ini ${formatFraction(view.claimedFraction)}`}
              </Text>
            </View>
          </TouchableOpacity>
          {expandedId === view.item.id && view.weights && (
            <StageClaimForm
              key={view.item.id}
              projectId={projectId}
              row={view as WeightedRowView}
              editable={editable}
              onSaved={afterLineChange}
              onRemoved={afterLineChange}
              onClose={() => setExpandedId(null)}
              toast={toast}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: SPACE.lg },
  detail: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  error: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.regular, color: COLORS.critical },
  banner: {
    fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.info, marginTop: SPACE.sm,
    padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.infoBg,
  },
  confirmBox: { marginTop: SPACE.sm, padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.surfaceAlt },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
  rowWrap: { marginTop: SPACE.xs },
  row: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  rowActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentBg, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  rowCode: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  rowLabel: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  rowSub: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  rowSubWarn: { color: COLORS.warning, fontFamily: FONTS.semibold },
  rowFigures: { alignItems: 'flex-end', justifyContent: 'center' },
  figure: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  figureClaimed: { color: COLORS.accentDark, fontFamily: FONTS.bold },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/progressClaim/ProgressClaimPanel.tsx workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx
git commit -m "feat(progress): weekly claim panel with inline row form and Kirim"
```

---

### Task 16: Tambah progres becomes the stage claim (Progres and Laporan)

**Files:**
- Modify: `workflows/screens/ProgresScreen.tsx`
- Modify: `workflows/screens/LaporanScreen.tsx`
- Modify: `workflows/navigation.tsx`
- Modify: `workflows/App.tsx`
- Modify: `workflows/screens/NotificationsScreen.tsx`

The quantity form, its direct `progress_entries` insert, the Gate 4 panel and the client-side installed sync are removed from the Progres tab; Tambah progres and "Tambah progres untuk item ini" open the claim panel (spec §16). Laporan gets a Klaim Progres Mingguan card instead of a fifth tab, so the tab row does not overflow at 360 dp. Route params apply once per navigation (every tap passes a fresh params object), switch to the project the notification names, and bump the claim panel reload key; a returned or verified claim also refreshes project data. The app router blocks on its spinner only until the first load, so a refresh or project switch no longer unmounts the navigator and throws the user back to the first tab.

- [ ] **Step 1: Apply the screen changes**

`workflows/screens/ProgresScreen.tsx` (apply this change):

```diff
diff --git a/workflows/screens/ProgresScreen.tsx b/workflows/screens/ProgresScreen.tsx
index dfd7d4f..ccc4b5d 100644
--- a/workflows/screens/ProgresScreen.tsx
+++ b/workflows/screens/ProgresScreen.tsx
@@ -1,33 +1,26 @@
-import React, { useState, useMemo, useEffect, useCallback } from 'react';
-import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
-import { useNavigation } from '@react-navigation/native';
+import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
+import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
+import { useNavigation, useRoute } from '@react-navigation/native';
 import { Ionicons } from '@expo/vector-icons';
 import Header from '../components/Header';
 import Card from '../components/Card';
-import SelectSheet from '../components/SelectSheet';
-import FlagPanel from '../components/FlagPanel';
-import PhotoGalleryField from '../components/PhotoGalleryField';
 import Badge from '../components/Badge';
 import StatTile from '../components/StatTile';
 import { useProject } from '../hooks/useProject';
 import { useToast } from '../components/Toast';
 import CatatanPerubahanScreen from './CatatanPerubahanScreen';
 import DailyLogScreen from './DailyLogScreen';
-import { getDailyLog, upsertDailyLog } from '../../tools/dailySiteLogs';
-import { computeGate4Info } from '../gates/gate4';
-import { syncBoqInstalledFromDerived } from '../../tools/derivation';
-import { sanitizeText, isPositiveNumber } from '../../tools/validation';
-import { pickAndUploadPhoto } from '../../tools/storage';
+import ProgressClaimPanel from './progressClaim/ProgressClaimPanel';
+import { getDailyLog } from '../../tools/dailySiteLogs';
 import { supabase } from '../../tools/supabase';
 import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
 import { getSiteChangeSummary, type SiteChangeSummary } from '../../tools/siteChanges';
-import { buildWorkGroups } from '../../tools/boqWorkGroups';
 
 type SubModule = 'home' | 'progress' | 'perubahan' | 'daily-log';
 
 export default function ProgresScreen() {
   const navigation = useNavigation<any>();
-  const { boqItems, project, profile, refresh } = useProject();
+  const { boqItems, project, profile, setActiveProject, refresh } = useProject();
   const { show: toast } = useToast();
   const [activeModule, setActiveModule] = useState<SubModule>('home');
   const [selectedProgressItemId, setSelectedProgressItemId] = useState<string | null>(null);
@@ -45,49 +38,30 @@ export default function ProgresScreen() {
   const [changeSummary, setChangeSummary] = useState<SiteChangeSummary | null>(null);
   const [todayLogExists, setTodayLogExists] = useState<boolean | null>(null);
 
-  // ── Progress form state ──
-  const [groupKey, setGroupKey] = useState('');
-  const [boqId, setBoqId] = useState('');
-  const [qty, setQty] = useState('');
-  const [location, setLocation] = useState('');
-  const [progressPhotos, setProgressPhotos] = useState<string[]>([]);
-  const [progressNote, setProgressNote] = useState('');
-  const [submitting, setSubmitting] = useState(false);
-
-  // ── Computed ──
-  const inProgressItems = useMemo(() => boqItems.filter(b => b.progress < 100), [boqItems]);
-  const selectedItem = useMemo(() => boqItems.find(b => b.id === boqId), [boqItems, boqId]);
-
-  // Work-group grouping for the progress picker (same classifier as the material
-  // request flow). Step 1 picks a work-group; step 2 picks a BoQ row within it.
-  const inProgressIds = useMemo(() => new Set(inProgressItems.map(b => b.id)), [inProgressItems]);
-  const workGroups = useMemo(() => buildWorkGroups(boqItems), [boqItems]);
-  const visibleGroups = useMemo(
-    () => workGroups
-      .map(g => ({ group: g, openCount: g.itemIds.filter(id => inProgressIds.has(id)).length }))
-      .filter(g => g.openCount > 0),
-    [workGroups, inProgressIds],
-  );
-  const groupRows = useMemo(() => {
-    const g = workGroups.find(x => x.key === groupKey);
-    if (!g) return [];
-    const idset = new Set(g.itemIds);
-    return inProgressItems.filter(b => idset.has(b.id));
-  }, [workGroups, groupKey, inProgressItems]);
-  const gateResult = useMemo(() => {
-    if (!selectedItem || !qty) return null;
-    const q = parseFloat(qty);
-    if (isNaN(q) || q <= 0) return null;
-    return computeGate4Info(selectedItem, q);
-  }, [selectedItem, qty]);
-  const newInstalled = selectedItem && qty ? selectedItem.installed + (parseFloat(qty) || 0) : 0;
-  const newPct = selectedItem ? Math.min(100, (newInstalled / selectedItem.planned) * 100).toFixed(1) : '0';
-  const derivedWorkStatus = useMemo(() => {
-    if (!selectedItem) return 'IN_PROGRESS';
-    const q = parseFloat(qty);
-    if (isNaN(q) || q <= 0) return 'IN_PROGRESS';
-    return selectedItem.installed + q >= selectedItem.planned ? 'COMPLETE' : 'IN_PROGRESS';
-  }, [selectedItem, qty]);
+  // ── Tambah progres: the weekly stage claim (report-driven progress spec §16) ──
+  const route = useRoute<any>();
+  const [claimRowId, setClaimRowId] = useState<string | null>(null);
+  const [claimReloadKey, setClaimReloadKey] = useState(0);
+  const appliedParams = useRef<unknown>(null);
+
+  // A claim notification (migration 104: PROGRESS_CLAIM_RETURNED / _VERIFIED)
+  // opens the claim on its own project. Applied once per navigation, so a
+  // later manual project switch is not undone.
+  useEffect(() => {
+    const params = route.params as { module?: string; projectId?: string } | undefined;
+    if (!params || appliedParams.current === params) return;
+    appliedParams.current = params;
+    if (params.projectId && params.projectId !== project?.id) setActiveProject(params.projectId);
+    if (params.module === 'progress') {
+      setClaimRowId(null);
+      setActiveModule('progress');
+      // A returned or verified claim changed what the panel and boq_items
+      // show: reload the panel even if it is already open, and the project
+      // data behind Progres Terkini and Beranda.
+      setClaimReloadKey((k) => k + 1);
+      void refresh();
+    }
+  }, [route.params, project?.id, setActiveProject, refresh]);
 
   const loadHomeDetails = useCallback(async () => {
     if (!project) return;
@@ -128,158 +102,14 @@ export default function ProgresScreen() {
     [recentEntries, selectedProgressItemId],
   );
 
-  // ── Cross-prompt: offer to add progress to today's daily log highlight ──
-  const offerAddToDailyLog = useCallback(async (boqId: string, note: string) => {
-    if (!project || !profile) return;
-    const item = boqItems.find((b) => b.id === boqId);
-    const area = item ? `${item.code} — ${item.label}` : 'Progres';
-    const msg = `Tambahkan "${area}" ke Log Harian klien?`;
-    const ok = Platform.OS === 'web'
-      ? (typeof window !== 'undefined' && window.confirm ? window.confirm(msg) : false)
-      : false; // native: skip auto-prompt in MVP
-    if (!ok) return;
-
-    const d = new Date();
-    const pad = (n: number) => String(n).padStart(2, '0');
-    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
-
-    try {
-      const existing = await getDailyLog(project.id, iso);
-      const highlights = existing?.highlights ?? [];
-      await upsertDailyLog({
-        project_id: project.id,
-        log_date: iso,
-        weather: existing?.weather ?? null,
-        crew_total: existing?.crew_total ?? null,
-        crew_breakdown: existing?.crew_breakdown ?? null,
-        safety_incidents: existing?.safety_incidents ?? 0,
-        author_id: profile.id,
-        highlights: [...highlights, { area: item?.label ?? 'Progres', note, boq_item_id: boqId, sort_order: highlights.length, room_id: null, gate_code: null, source_event_id: null }],
-        photos: existing?.photos ?? [],
-      });
-      toast('Ditambahkan ke Log Harian', 'ok');
-    } catch {
-      toast('Tidak bisa menambahkan ke Log Harian', 'warning');
-    }
-  }, [project, profile, boqItems, toast]);
-
   // ── Handlers ──
   const goBack = () => setActiveModule('home');
 
-  const updatePhotoCollection = async (
-    folder: string,
-    setPhotos: React.Dispatch<React.SetStateAction<string[]>>,
-    replaceIndex?: number,
-    addMessage = 'Foto ditambahkan',
-    replaceMessage = 'Foto diganti',
-  ) => {
-    try {
-      const path = await pickAndUploadPhoto(folder);
-      if (!path) return;
-
-      setPhotos(prev => {
-        if (replaceIndex == null || replaceIndex < 0 || replaceIndex >= prev.length) {
-          return [...prev, path];
-        }
-        return prev.map((photo, index) => (index === replaceIndex ? path : photo));
-      });
-
-      toast(replaceIndex == null ? addMessage : replaceMessage, 'ok');
-    } catch (err: any) { toast(err.message, 'critical'); }
-  };
-
-  const removePhotoFromCollection = (
-    setPhotos: React.Dispatch<React.SetStateAction<string[]>>,
-    index: number,
-  ) => {
-    setPhotos(prev => prev.filter((_, photoIndex) => photoIndex !== index));
-    toast('Foto dihapus', 'warning');
-  };
-
-  const handleProgressPhoto = (replaceIndex?: number) =>
-    updatePhotoCollection(
-      `progress/${project!.id}`,
-      setProgressPhotos,
-      replaceIndex,
-      'Foto progres ditambahkan',
-      'Foto progres diganti',
-    );
-
-  const resetProgressForm = () => {
-    setBoqId(''); setQty(''); setLocation('');
-    setProgressPhotos([]); setProgressNote('');
-  };
-
-  const openProgressComposer = (nextBoqId?: string) => {
-    if (nextBoqId) {
-      setBoqId(nextBoqId);
-      setQty('');
-    }
+  const openProgressComposer = (rowId?: string) => {
+    setClaimRowId(rowId ?? null);
     setActiveModule('progress');
   };
 
-  const handleProgressSubmit = async () => {
-    const needsPhoto = Platform.OS !== 'web';
-    if (!boqId || !isPositiveNumber(qty) || (needsPhoto && progressPhotos.length === 0)) {
-      toast('Lengkapi BoQ, qty, dan foto progres', 'critical'); return;
-    }
-    const item = boqItems.find(b => b.id === boqId);
-    if (!item || !project || !profile) return;
-
-    setSubmitting(true);
-    try {
-      const { data: progressEntry, error: dbError } = await supabase
-        .from('progress_entries')
-        .insert({
-          project_id: project.id,
-          boq_item_id: boqId,
-          reported_by: profile.id,
-          quantity: parseFloat(qty),
-          unit: item.unit,
-          work_status: derivedWorkStatus,
-          location: location ? sanitizeText(location) : null,
-          note: progressNote ? sanitizeText(progressNote) : null,
-        })
-        .select('id')
-        .single();
-      if (dbError || !progressEntry) throw dbError ?? new Error('Progress insert failed');
-
-      if (progressPhotos.length > 0) {
-        const { error: photoError } = await supabase.from('progress_photos').insert(
-          progressPhotos.map((path) => ({
-            progress_entry_id: progressEntry.id,
-            storage_path: path,
-            captured_at: new Date().toISOString(),
-          })),
-        );
-        if (photoError) throw photoError;
-      }
-
-      await syncBoqInstalledFromDerived(project.id);
-
-      const { error: logError } = await supabase.from('activity_log').insert({
-        project_id: project.id, user_id: profile.id,
-        type: 'progres',
-        label: `${item.label} — ${qty} ${item.unit} terpasang`,
-        flag: 'OK',
-      });
-      if (logError) throw logError;
-
-      const submittedBoqId = boqId;
-      const submittedNote = progressNote;
-      resetProgressForm();
-      await refresh();
-      await loadHomeDetails();
-      setActiveModule('home');
-      toast(`Progres dicatat: ${qty} ${item.unit}`, 'ok');
-      await offerAddToDailyLog(submittedBoqId, submittedNote ? sanitizeText(submittedNote) : 'Progres pekerjaan tercatat.');
-    } catch (err: any) {
-      console.warn('Progress submit failed:', err?.message ?? err);
-      toast(err?.message ?? 'Gagal menyimpan progres', 'critical');
-    }
-    finally { setSubmitting(false); }
-  };
-
   // ── Sub-module header ──
   const SubHeader = ({ title }: { title: string }) => (
     <View style={styles.subHeader}>
@@ -349,6 +179,7 @@ export default function ProgresScreen() {
                   onPress={() => {
                     if (btn.key === 'ruangan') navigation.navigate('RoomScan');
                     else if (btn.key === 'papan') navigation.navigate('RoomBoard');
+                    else if (btn.key === 'progress') openProgressComposer();
                     else setActiveModule(btn.key as SubModule);
                   }}
                   accessibilityRole="button"
@@ -373,7 +204,7 @@ export default function ProgresScreen() {
                 <Text style={styles.expandTitle}>Progres Terkini per Item</Text>
                 <Ionicons name={showRecentProgress ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSec} />
               </TouchableOpacity>
-              <Text style={styles.sectionHint}>Tap item untuk buka detail progres dan tambah entri baru untuk item yang sama.</Text>
+              <Text style={styles.sectionHint}>Ketuk item untuk melihat riwayat progres terverifikasi atau mengisi klaim minggu ini.</Text>
               {showRecentProgress && (
                 <>
                   {boqItems.filter(b => b.progress > 0).map(b => (
@@ -477,115 +308,21 @@ export default function ProgresScreen() {
           </>
         )}
 
-        {/* ── PROGRESS: Add progress entry ── */}
-        {activeModule === 'progress' && (
+        {/* ── PROGRESS: the weekly stage claim per work area ── */}
+        {activeModule === 'progress' && project && (
           <>
             <SubHeader title="Tambah Progres" />
-            <Card title="Laporan Progres Baru">
-              <Text style={styles.label}>Grup Pekerjaan <Text style={styles.req}>*</Text></Text>
-              <SelectSheet
-                title="Pilih Grup Pekerjaan"
-                placeholder="-- Pilih grup pekerjaan --"
-                accessibilityLabel="Pilih grup pekerjaan"
-                value={groupKey}
-                onChange={v => { setGroupKey(v); setBoqId(''); setQty(''); }}
-                options={visibleGroups.map(({ group, openCount }) => ({
-                  value: group.key,
-                  label: group.label,
-                  meta: `${openCount} item`,
-                }))}
-              />
-
-              <Text style={styles.label}>Item BoQ <Text style={styles.req}>*</Text></Text>
-              <SelectSheet
-                title="Pilih Item BoQ"
-                placeholder={groupKey ? '-- Pilih item BoQ --' : '-- Pilih grup dulu --'}
-                accessibilityLabel="Pilih item BoQ"
-                disabled={!groupKey}
-                value={boqId}
-                onChange={v => { setBoqId(v); setQty(''); }}
-                options={groupRows.map(b => ({
-                  value: b.id,
-                  code: b.code,
-                  label: b.label,
-                  meta: `${b.progress}%`,
-                  metaColor: b.progress === 100 ? COLORS.ok : COLORS.accent,
-                }))}
-              />
-              {selectedItem && (
-                <Text style={styles.fieldHint}>{selectedItem.progress}% selesai · {selectedItem.installed.toFixed(2)} / {selectedItem.planned} {selectedItem.unit}</Text>
-              )}
-
-              {selectedItem && (
-                <>
-                  <View style={styles.row2}>
-                    <View style={{ flex: 1 }}>
-                      <Text style={styles.label}>Qty Hari Ini <Text style={styles.req}>*</Text></Text>
-                      <TextInput placeholderTextColor={COLORS.textMuted} style={styles.input} keyboardType="numeric" value={qty} onChangeText={setQty} placeholder="0" />
-                    </View>
-                    <View style={{ flex: 1 }}>
-                      <Text style={styles.label}>Satuan</Text>
-                      <TextInput style={[styles.input, styles.disabled]} value={selectedItem.unit} editable={false} />
-                    </View>
-                  </View>
-
-                  {qty && parseFloat(qty) > 0 && (
-                    <Text style={[styles.fieldHint, parseFloat(newPct) >= 100 ? { color: COLORS.ok } : null]}>
-                      Setelah: {newInstalled.toFixed(2)} / {selectedItem.planned} {selectedItem.unit} = {newPct}%
-                    </Text>
-                  )}
-
-                  <View style={styles.autoStatusBox}>
-                    <Text style={styles.autoStatusTitle}>Status otomatis</Text>
-                    <Text style={styles.autoStatusText}>
-                      {derivedWorkStatus === 'COMPLETE'
-                        ? 'Entri ini akan ditandai Selesai karena progres mencapai 100%.'
-                        : 'Entri ini akan ditandai Sedang Berjalan sampai item mencapai 100%.'}
-                    </Text>
-                  </View>
-
-                  <Text style={styles.label}>Lokasi / Keterangan</Text>
-                  <TextInput placeholderTextColor={COLORS.textMuted} style={styles.input} value={location} onChangeText={setLocation} placeholder="Contoh: Kolom K1-K8, zona utara" />
-
-                  <Text style={styles.label}>Catatan</Text>
-                  <TextInput placeholderTextColor={COLORS.textMuted} style={[styles.input, styles.textarea]} value={progressNote} onChangeText={setProgressNote} multiline placeholder="Catatan tambahan (opsional)" />
-                  <Text style={styles.fieldHint}>
-                    Tambahan scope, permintaan owner, atau perubahan pekerjaan dicatat lewat `Catatan Perubahan`, bukan lewat progres biasa.
-                  </Text>
-
-                  <Text style={styles.label}>Foto Progres <Text style={styles.req}>*</Text></Text>
-                  <PhotoGalleryField
-                    photoPaths={progressPhotos}
-                    onAdd={() => handleProgressPhoto()}
-                    onReplace={handleProgressPhoto}
-                    onRemove={(index) => removePhotoFromCollection(setProgressPhotos, index)}
-                    emptyLabel="Tambah Foto Progres"
-                    helperText="Tambahkan beberapa bukti progres bila perlu. Foto pertama tetap menjadi lampiran utama."
-                  />
-
-                  <FlagPanel result={gateResult} gateLabel="Gate 4" />
-
-                  <TouchableOpacity
-                    style={styles.btn}
-                    onPress={handleProgressSubmit}
-                    disabled={submitting}
-                    accessibilityRole="button"
-                    accessibilityLabel="Kirim progres"
-                    accessibilityState={{ disabled: submitting, busy: submitting }}
-                  >
-                    <Text style={styles.btnText}>{submitting ? 'Mengirim...' : 'Kirim Progres'}</Text>
-                  </TouchableOpacity>
-                  <TouchableOpacity
-                    style={[styles.ghostBtn, { marginTop: 8 }]}
-                    onPress={goBack}
-                    accessibilityRole="button"
-                    accessibilityLabel="Batal, kembali ke hub"
-                  >
-                    <Text style={styles.ghostBtnText}>Batal</Text>
-                  </TouchableOpacity>
-                </>
-              )}
-            </Card>
+            <Text style={styles.sectionHint}>
+              Isi persentase tiap tahap per area kerja. Klaim dikirim mingguan dan baru menambah progres proyek setelah estimator memverifikasi.
+            </Text>
+            <ProgressClaimPanel
+              projectId={project.id}
+              role={profile?.role}
+              boqItems={boqItems}
+              initialRowId={claimRowId}
+              reloadKey={claimReloadKey}
+              toast={toast}
+            />
           </>
         )}
 
@@ -619,7 +356,7 @@ const styles = StyleSheet.create({
 
   expandHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.xs },
   expandTitle:  { fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.3, color: COLORS.text },
-  sectionHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17, marginBottom: SPACE.sm },
+  sectionHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18, marginBottom: SPACE.sm },
 
   // Sub header
   subHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md, marginTop: SPACE.sm },
```

`workflows/screens/LaporanScreen.tsx` (apply this change):

```diff
diff --git a/workflows/screens/LaporanScreen.tsx b/workflows/screens/LaporanScreen.tsx
index c252c76..eeec1bd 100644
--- a/workflows/screens/LaporanScreen.tsx
+++ b/workflows/screens/LaporanScreen.tsx
@@ -1,4 +1,4 @@
-import React, { useEffect, useState, useCallback, useMemo } from 'react';
+import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
 import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, Platform } from 'react-native';
 import { Picker } from '@react-native-picker/picker';
 import { Ionicons } from '@expo/vector-icons';
@@ -15,6 +15,7 @@ import MandorSetupScreen from './MandorSetupScreen';
 import OpnameScreen from './OpnameScreen';
 import AttendanceScreen from './AttendanceScreen';
 import ClientReportBuilderScreen from './ClientReportBuilderScreen';
+import ProgressClaimPanel from './progressClaim/ProgressClaimPanel';
 import { MilestonePanel } from './MilestoneScreen';
 import MilestoneFormScreen from './MilestoneFormScreen';
 import MilestoneAiDraftScreen from './MilestoneAiDraftScreen';
@@ -34,7 +35,7 @@ import { canManageTeamMember } from '../../tools/rolePermissions';
 import { type UserRoleType } from '../../tools/constants';
 import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
 
-type Section = 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review' | 'katalog' | 'mandor' | 'opname' | 'attendance' | 'client-report';
+type Section = 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review' | 'katalog' | 'mandor' | 'opname' | 'attendance' | 'client-report' | 'klaim';
 
 // ── Report preview renderers ──────────────────────────────────────────────────
 
@@ -52,7 +53,7 @@ function formatReportTimestamp(value: string) {
 
 export default function LaporanScreen() {
   const route = useRoute<any>();
-  const { project, profile, boqItems, purchaseOrders, defects, milestones, refresh } = useProject();
+  const { project, profile, boqItems, purchaseOrders, defects, milestones, refresh, setActiveProject } = useProject();
   const { show: toast } = useToast();
   // Estimators manage team membership here (migration 037), but principal
   // members are out of reach (migration 090): only a principal actor may add
@@ -74,12 +75,20 @@ export default function LaporanScreen() {
     onOrder: number;
   } | null>(null);
 
+  // Route params apply once per navigation. Every navigate hands over a new
+  // params object, so opening the same section again after a manual tab
+  // switch still lands. Claim deeplinks also carry projectId and reload the
+  // claim panel.
+  const [claimReloadKey, setClaimReloadKey] = useState(0);
+  const appliedParams = useRef<unknown>(null);
   useEffect(() => {
-    const nextSection = route.params?.initialSection as Section | undefined;
-    if (nextSection) {
-      setActiveSection(nextSection);
-    }
-  }, [route.params?.initialSection]);
+    const params = route.params as { initialSection?: Section; projectId?: string } | undefined;
+    if (!params || appliedParams.current === params) return;
+    appliedParams.current = params;
+    if (params.projectId && params.projectId !== project?.id) setActiveProject(params.projectId);
+    if (params.initialSection) setActiveSection(params.initialSection);
+    if (params.initialSection === 'klaim') setClaimReloadKey((k) => k + 1);
+  }, [route.params, project?.id, setActiveProject]);
 
   useEffect(() => {
     if (route.params?.contractId) {
@@ -444,6 +453,19 @@ export default function LaporanScreen() {
               <StatTile value={openDefects} label="Perubahan Open" color={COLORS.critical} />
             </View>
 
+            {isSupervisor && project && (
+              <Card title="Klaim Progres Mingguan" subtitle="Isi progres per area kerja dan kirim mingguan untuk diverifikasi estimator.">
+                <TouchableOpacity
+                  style={styles.claimBtn}
+                  onPress={() => setActiveSection('klaim')}
+                  accessibilityRole="button"
+                  accessibilityLabel="Buka klaim progres"
+                >
+                  <Text style={styles.claimBtnText}>Buka klaim progres</Text>
+                </TouchableOpacity>
+              </Card>
+            )}
+
             {/* Material status */}
             <Card title="Status Material">
               <View style={styles.metricRow}>
@@ -721,6 +743,13 @@ export default function LaporanScreen() {
           </>
         )}
 
+        {activeSection === 'klaim' && project && (
+          <>
+            <Text style={styles.sectionHead}>Klaim Progres Mingguan</Text>
+            <ProgressClaimPanel projectId={project.id} role={profile?.role} boqItems={boqItems} reloadKey={claimReloadKey} toast={toast} />
+          </>
+        )}
+
         {activeSection === 'jadwal' && (
           <MilestonePanel
             embedded
@@ -831,6 +860,8 @@ const styles = StyleSheet.create({
   tabActive:     { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
   tabText:       { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.textSec },
   tabTextActive: { color: COLORS.primary },
+  claimBtn:      { minHeight: 44, marginTop: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACE.base },
+  claimBtnText:  { fontSize: TYPE.sm, lineHeight: Math.round(TYPE.sm * 1.45), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
 
   sectionHead: {
     fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 1,
```

`workflows/navigation.tsx` (apply this change):

```diff
diff --git a/workflows/navigation.tsx b/workflows/navigation.tsx
index 39ce7c9..f6faffb 100644
--- a/workflows/navigation.tsx
+++ b/workflows/navigation.tsx
@@ -27,8 +27,8 @@ export type TabParamList = {
   Beranda:    undefined;
   Permintaan: undefined;
   Terima:     undefined;
-  Progres:    undefined;
-  Laporan:    { initialSection?: 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' } | undefined;
+  Progres:    { module?: 'progress'; projectId?: string; claimId?: string; initialSection?: string } | undefined;
+  Laporan:    { initialSection?: 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'klaim'; projectId?: string; claimId?: string } | undefined;
   Notifikasi: undefined;
   RoomScan:   undefined;
   Room:       { projectCode: string; roomCode: string };
```

`workflows/App.tsx` (apply this change):

```diff
diff --git a/workflows/App.tsx b/workflows/App.tsx
index 0b0d5e8..0cd777b 100644
--- a/workflows/App.tsx
+++ b/workflows/App.tsx
@@ -62,7 +62,13 @@ function RoleRouter() {
     return cleanup;
   }, []);
 
-  if (loading) {
+  // Block on the spinner only until the first load finishes. A later refresh
+  // or project switch also sets loading; unmounting the navigator then would
+  // throw the user back to the first tab and drop the route params a
+  // notification just delivered.
+  const firstLoadDone = useRef(false);
+  if (!loading) firstLoadDone.current = true;
+  if (loading && !firstLoadDone.current) {
     return (
       <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg }}>
         <ActivityIndicator size="large" color={COLORS.accent} />
```

`workflows/screens/NotificationsScreen.tsx` (apply this change):

```diff
diff --git a/workflows/screens/NotificationsScreen.tsx b/workflows/screens/NotificationsScreen.tsx
index a29e786..150cca5 100644
--- a/workflows/screens/NotificationsScreen.tsx
+++ b/workflows/screens/NotificationsScreen.tsx
@@ -120,7 +120,9 @@ export default function NotificationsScreen({ profileId }: Props): React.ReactEl
     // Navigate immediately — never gated on the write above.
     const target = resolveNotificationRoute(item.deeplinkScreen, profile?.role);
     try {
-      navigation.navigate(target, item.deeplinkParams ?? {});
+      // A fresh params object per tap, so a screen that applies params once per
+      // navigation still reacts to a second tap on the same notification.
+      navigation.navigate(target, { ...(item.deeplinkParams ?? {}) });
     } catch {
       // Route not in current role's nav — stay on Notifikasi (no-op).
     }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/ProgresScreen.tsx workflows/screens/LaporanScreen.tsx workflows/navigation.tsx workflows/App.tsx workflows/screens/NotificationsScreen.tsx
git commit -m "feat(progress): Tambah progres opens the weekly stage claim"
```

---

### Task 17: Verification panel and the office Klaim tab

**Files:**
- Create: `office/screens/progressClaim/ProgressClaimVerifyPanel.tsx`
- Modify: `office/screens/OfficeReportsScreen.tsx`
- Modify: `office/navigation.tsx`
- Modify: `office/PrincipalNavigation.tsx`
- Modify: `office/screens/NotificationsScreen.tsx`
- Modify: `workflows/screens/components/NotificationList.tsx`
- Test: `office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx`

Estimators and admins see each claimed row with its weights, the verified and claimed figure per stage, the note and photos, and verify (writing progress) or return with a note. The submitter cannot decide their own claim; the principal reads. The Reports tab gets a Klaim section with a pending badge; notification maps and styles learn the three claim types. The table uses short column headers and 44 dp inputs so it fits a 360 dp phone.

- [ ] **Step 1: Write the failing test**

`office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx` (new file):

```tsx
// office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  getOpenClaim: jest.fn(),
  getLatestClaim: jest.fn(),
  listClaimLines: jest.fn(),
  listStageWeights: jest.fn(),
  listVerifiedStagePct: jest.fn(),
  listEntryTotals: jest.fn(),
  verifyClaim: jest.fn(),
  returnClaim: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../workflows/components/StoragePhoto', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { path: string; testID?: string }) => ReactLocal.createElement(Text, { testID: props.testID }, props.path),
  };
});

import {
  getLatestClaim, getOpenClaim, listClaimLines, listEntryTotals, listStageWeights, listVerifiedStagePct, returnClaim, verifyClaim,
} from '../../../../tools/progressClaims/claims';
import ProgressClaimVerifyPanel from '../ProgressClaimVerifyPanel';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const balok = { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 };
const K1 = { id: 'k1', project_id: 'p1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 32.6, progress: 32.6 };
const B1 = { id: 'b1', project_id: 'p1', code: 'T1-002', label: 'Lantai 2 ; Balok', unit: 'm³', planned: 200, installed: 0, progress: 0 };
const ITEMS = [K1, B1];
const claim = (status: string) => ({
  id: 'c1', project_id: 'p1', week_start: '2026-09-14', status, created_by: 'sup', created_at: 'x', updated_at: 'x',
  submitted_by: 'sup', submitted_at: 'x', returned_by: null, returned_at: null, return_note: null,
  verified_by: status === 'VERIFIED' ? 'est' : null, verified_at: status === 'VERIFIED' ? '2026-09-15T20:00:00Z' : null, verifier_note: null,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: 'l1', claim_id: 'c1', project_id: 'p1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, verified_pct: null, weights_snapshot: null, row_pct_prev: null,
  row_pct_new: null, installed_before: null, delta_quantity: null, regress_reason: null, note: 'Begel K1-K8 terpasang',
  evidence: { photo_refs: ['progress/p1/1.jpg'] }, created_by: 'sup', updated_by: 'sup', created_at: 'x', updated_at: 'x', ...over,
});
const weightRow = (id: string, weights: object, source = 'reference', cls: string | null = 'KOLOM') => ({ boq_item_id: id, weights, source, reference_class: cls, updated_at: 'x' });
const ESTIMATOR = { id: 'est', role: 'estimator' };

const renderPanel = (profile: { id: string; role: string } | null = ESTIMATOR) => {
  const props = { toast: jest.fn(), onVerified: jest.fn(), onChanged: jest.fn() };
  const utils = render(<ProgressClaimVerifyPanel projectId="p1" profile={profile} boqItems={ITEMS} {...props} />);
  return { ...utils, ...props, profile };
};

beforeEach(() => {
  jest.clearAllMocks();
  (getOpenClaim as jest.Mock).mockResolvedValue(claim('SUBMITTED'));
  (getLatestClaim as jest.Mock).mockResolvedValue(null);
  (listClaimLines as jest.Mock).mockResolvedValue([line()]);
  (listStageWeights as jest.Mock).mockResolvedValue([weightRow('k1', kolom)]);
  (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]));
  (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 32.6]]));
  (verifyClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'VERIFIED', lines: 1, entries: 1, regressions: 0, notified: 1 });
  (returnClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'RETURNED', notified: 1 });
});

describe('ProgressClaimVerifyPanel', () => {
  it('shows each stage before, claimed and to check, the note and photos, and verifies the edited figures', async () => {
    const { findByLabelText, getByLabelText, getByText, getByTestId, onVerified, toast } = renderPanel();
    const pembesian = await findByLabelText('Verifikasi Pembesian T1-001');
    expect(pembesian.props.value).toBe('60');
    expect(getByText('Catatan pengawas: Begel K1-K8 terpasang')).toBeTruthy();
    expect(getByText('Bobot referensi')).toBeTruthy();
    expect(getByText('Lalu: terverifikasi sebelumnya. Klaim: angka pengawas. Cek: angka verifikasi.')).toBeTruthy();
    expect(getByTestId('claim-photo-l1-0')).toBeTruthy();
    fireEvent.changeText(pembesian, '50');
    expect(getByText('Progres baris 32,6% menjadi 56,9% (perkiraan +24,3 m³)')).toBeTruthy();
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(verifyClaim).toHaveBeenCalledWith('c1', [
      { line_id: 'l1', verified_pct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, regress_reason: null },
    ], null));
    expect(onVerified).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Klaim diverifikasi. 1 entri progres dicatat.', 'ok');
  });

  it('verifies every line of a multi-line claim in one call', async () => {
    (listClaimLines as jest.Mock).mockResolvedValue([
      line(),
      line({ id: 'l2', boq_item_id: 'b1', prev_verified: { BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 }, claimed_pct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, note: null, evidence: { photo_refs: [] } }),
    ]);
    (listStageWeights as jest.Mock).mockResolvedValue([weightRow('k1', kolom), weightRow('b1', balok, 'manual', null)]);
    const { findByLabelText, getByLabelText } = renderPanel();
    await findByLabelText('Verifikasi Bekisting T1-002');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(verifyClaim).toHaveBeenCalledWith('c1', [
      { line_id: 'l1', verified_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, regress_reason: null },
      { line_id: 'l2', verified_pct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, regress_reason: null },
    ], null));
  });

  it('blocks verification while a line has no weights', async () => {
    (listClaimLines as jest.Mock).mockResolvedValue([line(), line({ id: 'l2', boq_item_id: 'b1' })]);
    const { findByText, getByLabelText, toast } = renderPanel();
    expect(await findByText('Bobot tahapan baris ini belum diatur. Kembalikan klaim atau atur bobot di Baseline.')).toBeTruthy();
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    expect(toast).toHaveBeenCalledWith('T1-002: bobot tahapan belum diatur.', 'critical');
    expect(verifyClaim).not.toHaveBeenCalled();
  });

  it('asks for a reason before verifying a stage below the verified one', async () => {
    (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 70, PENGECORAN: 0 }]]));
    (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 66.62]]));
    (listClaimLines as jest.Mock).mockResolvedValue([line({ claimed_pct: { BEKISTING: 100, PEMBESIAN: 80, PENGECORAN: 0 } })]);
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.changeText(await findByLabelText('Verifikasi Pembesian T1-001'), '50');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    expect(toast).toHaveBeenCalledWith('T1-001: penurunan progres wajib disertai alasan.', 'critical');
    expect(verifyClaim).not.toHaveBeenCalled();
    fireEvent.changeText(getByLabelText('Alasan penurunan T1-001'), 'Begel dibongkar');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(verifyClaim).toHaveBeenCalledWith('c1', [
      { line_id: 'l1', verified_pct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, regress_reason: 'Begel dibongkar' },
    ], null));
  });

  it('asks for a reason when re-weighting lowers the quantity although no stage dropped', async () => {
    (listStageWeights as jest.Mock).mockResolvedValue([weightRow('k1', { BEKISTING: 0.2, PEMBESIAN: 0.5, PENGECORAN: 0.3 }, 'manual', null)]);
    (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }]]));
    (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 52.04]]));
    (listClaimLines as jest.Mock).mockResolvedValue([line({ claimed_pct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 } })]);
    const { findByText, getByLabelText, getByText, toast } = renderPanel();
    expect(await findByText('Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.')).toBeTruthy();
    expect(getByText('Progres baris 40% menjadi 40% (perkiraan -12,04 m³)')).toBeTruthy();
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    expect(toast).toHaveBeenCalledWith('T1-001: penurunan progres wajib disertai alasan.', 'critical');
  });

  it('keeps the edited figures when verification fails', async () => {
    (verifyClaim as jest.Mock).mockRejectedValueOnce(new Error('Status klaim sudah berubah. Muat ulang halaman.'));
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.changeText(await findByLabelText('Verifikasi Pembesian T1-001'), '55');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Status klaim sudah berubah. Muat ulang halaman.', 'critical'));
    expect(getByLabelText('Verifikasi Pembesian T1-001').props.value).toBe('55');
  });

  it('returns the claim with a note, and refuses an empty one', async () => {
    const { findByLabelText, getByLabelText, onChanged, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Kembalikan klaim'));
    fireEvent.press(getByLabelText('Kirim pengembalian'));
    expect(toast).toHaveBeenCalledWith('Tulis alasan pengembalian klaim.', 'critical');
    fireEvent.changeText(getByLabelText('Alasan pengembalian'), 'Foto pembesian kurang jelas');
    fireEvent.press(getByLabelText('Kirim pengembalian'));
    await waitFor(() => expect(returnClaim).toHaveBeenCalledWith('c1', 'Foto pembesian kurang jelas'));
    expect(onChanged).toHaveBeenCalled();
  });

  it.each([
    ['the submitter', { id: 'sup', role: 'estimator' }, {}],
    ['someone who filled a line', { id: 'est', role: 'estimator' }, { updated_by: 'est' }],
  ])('never lets %s decide the claim', async (_who, profile, lineOver) => {
    (listClaimLines as jest.Mock).mockResolvedValue([line(lineOver)]);
    const { findByText, queryByLabelText, getByLabelText } = renderPanel(profile);
    expect(await findByText('Klaim ini berisi angka yang Anda kirim atau isi sendiri. Verifikasi harus dilakukan estimator atau admin lain.')).toBeTruthy();
    expect(queryByLabelText('Verifikasi klaim')).toBeNull();
    expect(getByLabelText('Verifikasi Pembesian T1-001').props.editable).toBe(false);
  });

  it('lets the principal read without deciding or being told to change figures', async () => {
    const { findByLabelText, queryByLabelText, getByText } = renderPanel({ id: 'pri', role: 'principal' });
    expect((await findByLabelText('Verifikasi Pembesian T1-001')).props.editable).toBe(false);
    expect(queryByLabelText('Verifikasi klaim')).toBeNull();
    expect(queryByLabelText('Kembalikan klaim')).toBeNull();
    expect(getByText('1 baris diklaim. Angka cek terisi dari klaim pengawas.')).toBeTruthy();
  });

  it('says when nothing waits for verification and shows the last claim', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(null);
    (getLatestClaim as jest.Mock).mockResolvedValue(claim('VERIFIED'));
    const { findByText, getByText } = renderPanel();
    expect(await findByText('Tidak ada klaim yang menunggu verifikasi.')).toBeTruthy();
    expect(getByText('Terverifikasi')).toBeTruthy();
    expect(listClaimLines).not.toHaveBeenCalled();
  });

  it('reloads when asked to, as a notification tap does', async () => {
    const { findByLabelText, rerender, toast, onVerified, onChanged } = renderPanel();
    await findByLabelText('Verifikasi Pembesian T1-001');
    rerender(<ProgressClaimVerifyPanel projectId="p1" profile={ESTIMATOR} boqItems={ITEMS} reloadKey={1} toast={toast} onVerified={onVerified} onChanged={onChanged} />);
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../ProgressClaimVerifyPanel'`.

- [ ] **Step 3: Write the implementation**

`office/screens/progressClaim/ProgressClaimVerifyPanel.tsx` (new file):

```tsx
// office/screens/progressClaim/ProgressClaimVerifyPanel.tsx
// SANO — Verifikasi Klaim Progres (spec §6.2 steps 4-5, §18). The estimator sees
// every claimed row with its weights, the verified and claimed figure per
// stage, the supervisor's note and photos, and sets the verified figures.
// Verifikasi writes progress through verify_progress_claim; Kembalikan sends
// the claim back with a note. The principal reads the same view. Whoever
// submitted the claim or filled one of its lines never verifies it (the RPC
// refuses that as well).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Card from '../../../workflows/components/Card';
import Badge from '../../../workflows/components/Badge';
import StoragePhoto from '../../../workflows/components/StoragePhoto';
import { canVerifyClaim, canVerifyClaimAs } from '../../../tools/progressClaims/claimRules';
import {
  getLatestClaim, getOpenClaim, listClaimLines, listEntryTotals, listStageWeights, listVerifiedStagePct, returnClaim, verifyClaim,
  type ProgressClaim, type ProgressClaimLine, type VerifyLineInput,
} from '../../../tools/progressClaims/claims';
import {
  claimStatusSummary, formatFraction, formatPercent, formatQty, pctInputs, readPctInputs, regressedStages, stageKeyLabel,
  weightSourceLabel, zeroPct, type ClaimableItem, type PctRead,
} from '../../../tools/progressClaims/claimView';
import { deltaFromInstalled, rowFraction, type StagePct } from '../../../tools/progressClaims/stageMath';
import {
  stagesOf, validateStageWeights, type StageKey, type StageWeights, type WeightSource,
} from '../../../tools/progressClaims/stageWeights';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

const lh = (size: number) => Math.round(size * 1.45);
const QUANTITY_DROP = 'Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.';

interface Props {
  projectId: string;
  profile: { id: string; role: string } | null;
  boqItems: ClaimableItem[];
  /** Bump to reload, e.g. when a notification brings the user back to a panel already on screen. */
  reloadKey?: number;
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
  /** After a verification wrote progress, so the screen can reload boq_items. */
  onVerified?: () => void;
  /** After a verification or a return, so badge counts can refresh. */
  onChanged?: () => void;
}

interface RowWeights {
  weights: StageWeights;
  source: WeightSource;
  referenceClass: string | null;
}

interface Loaded {
  projectId: string;
  claim: ProgressClaim | null;
  lines: ProgressClaimLine[];
  weights: Map<string, RowWeights>;
  verified: Map<string, StagePct>;
  ledger: Map<string, number>;
}

interface LineInput {
  inputs: Record<string, string>;
  reason: string;
}

/** One line's figures as the form currently holds them. */
interface LineCheck {
  code: string;
  item: ClaimableItem | undefined;
  rowWeights: RowWeights | null;
  prev: StagePct;
  read: PctRead | null;
  prevFraction: number;
  next: number | null;
  delta: number | null;
  regressed: StageKey[];
  needsReason: boolean;
  ledgerBefore: number;
}

const EMPTY_INPUT: LineInput = { inputs: {}, reason: '' };

export default function ProgressClaimVerifyPanel({ projectId, profile, boqItems, reloadKey = 0, toast, onVerified, onChanged }: Props) {
  const items = useMemo(
    () => new Map(boqItems.filter((b) => b.project_id == null || b.project_id === projectId).map((b) => [b.id, b])),
    [boqItems, projectId],
  );
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineInputs, setLineInputs] = useState<Record<string, LineInput>>({});
  const [verifierNote, setVerifierNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const claim = (await getOpenClaim(projectId)) ?? (await getLatestClaim(projectId));
      if (!claim || claim.status !== 'SUBMITTED') {
        if (mine === seq.current) {
          setData({ projectId, claim, lines: [], weights: new Map(), verified: new Map(), ledger: new Map() });
          setLineInputs({});
        }
        return;
      }
      const [lines, weightRows, verified, ledger] = await Promise.all([
        listClaimLines(claim.id),
        listStageWeights(projectId),
        listVerifiedStagePct(projectId),
        listEntryTotals(projectId),
      ]);
      const weights = new Map<string, RowWeights>();
      for (const w of weightRows) {
        const checked = validateStageWeights(w.weights);
        if (checked.ok) weights.set(w.boq_item_id, { weights: checked.weights, source: w.source, referenceClass: w.reference_class });
      }
      if (mine !== seq.current) return;
      setData({ projectId, claim, lines, weights, verified, ledger });
      setLineInputs(Object.fromEntries(lines.map((l) => {
        const w = weights.get(l.boq_item_id)?.weights;
        return [l.id, { inputs: w ? pctInputs(w, l.claimed_pct) : {}, reason: l.regress_reason ?? '' }];
      })));
      setVerifierNote('');
      setReturning(false);
      setReturnNote('');
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? 'Klaim progres gagal dimuat.');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load, reloadKey]);

  // Never render another project's claim with its decision buttons live.
  const current = data && data.projectId === projectId ? data : null;
  const claim = current?.claim ?? null;
  const submitted = claim?.status === 'SUBMITTED';
  const lineAuthors = useMemo(() => (current?.lines ?? []).flatMap((l) => [l.created_by, l.updated_by]), [current]);
  const actionable = submitted && canVerifyClaimAs(profile?.role, profile?.id, claim?.submitted_by, lineAuthors);
  const ownClaim = submitted && canVerifyClaim(profile?.role) && !actionable;

  const check = (loaded: Loaded, line: ProgressClaimLine, state: LineInput): LineCheck => {
    const item = items.get(line.boq_item_id);
    const code = item?.code ?? '—';
    const ledgerBefore = loaded.ledger.get(line.boq_item_id) ?? 0;
    const rowWeights = loaded.weights.get(line.boq_item_id) ?? null;
    if (!rowWeights) {
      return { code, item, rowWeights: null, prev: {}, read: null, prevFraction: 0, next: null, delta: null, regressed: [], needsReason: false, ledgerBefore };
    }
    const prev = loaded.verified.get(line.boq_item_id) ?? line.prev_verified ?? zeroPct(rowWeights.weights);
    const read = readPctInputs(rowWeights.weights, state.inputs);
    const prevFraction = rowFraction(rowWeights.weights, prev);
    const next = read.ok ? rowFraction(rowWeights.weights, read.pct) : null;
    const delta = next != null ? deltaFromInstalled(item?.planned ?? 0, ledgerBefore, next).deltaQuantity : null;
    const regressed = read.ok ? regressedStages(rowWeights.weights, prev, read.pct) : [];
    return {
      code, item, rowWeights, prev, read, prevFraction, next, delta, regressed, ledgerBefore,
      needsReason: regressed.length > 0 || (delta != null && delta < 0),
    };
  };

  const setInput = (lineId: string, stage: string, value: string) =>
    setLineInputs((prev) => {
      const existing = prev[lineId] ?? EMPTY_INPUT;
      return { ...prev, [lineId]: { ...existing, inputs: { ...existing.inputs, [stage]: value } } };
    });

  const setReason = (lineId: string, reason: string) =>
    setLineInputs((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? EMPTY_INPUT), reason } }));

  const verify = async () => {
    if (!current?.claim) return;
    const payload: VerifyLineInput[] = [];
    for (const line of current.lines) {
      const state = lineInputs[line.id] ?? EMPTY_INPUT;
      const c = check(current, line, state);
      if (!c.rowWeights) {
        toast(`${c.code}: bobot tahapan belum diatur.`, 'critical');
        return;
      }
      if (!c.read || !c.read.ok) {
        toast(`${c.code}: ${c.read && !c.read.ok ? c.read.reason : 'persentase tidak valid.'}`, 'critical');
        return;
      }
      const reason = state.reason.trim();
      if (c.needsReason && !reason) {
        toast(`${c.code}: penurunan progres wajib disertai alasan.`, 'critical');
        return;
      }
      payload.push({ line_id: line.id, verified_pct: c.read.pct, regress_reason: c.needsReason ? reason : null });
    }
    setBusy(true);
    try {
      const result = await verifyClaim(current.claim.id, payload, verifierNote.trim() || null);
      toast(`Klaim diverifikasi. ${result.entries} entri progres dicatat.`, 'ok');
      onVerified?.();
      onChanged?.();
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Verifikasi gagal.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const sendReturn = async () => {
    if (!current?.claim) return;
    const note = returnNote.trim();
    if (!note) {
      toast('Tulis alasan pengembalian klaim.', 'critical');
      return;
    }
    setBusy(true);
    try {
      await returnClaim(current.claim.id, note);
      toast('Klaim dikembalikan ke pengawas.', 'ok');
      onChanged?.();
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Pengembalian gagal.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Card title="Verifikasi Klaim Progres">
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Muat ulang klaim">
          <Text style={styles.ghostBtnText}>Coba lagi</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (!current) return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;

  const summary = claimStatusSummary(claim);

  if (!submitted) {
    return (
      <Card title="Verifikasi Klaim Progres" rightAction={claim ? <Badge flag={summary.flag} label={summary.label} /> : undefined}>
        <Text style={styles.detail}>Tidak ada klaim yang menunggu verifikasi.</Text>
        {claim && <Text style={styles.hint}>{`Klaim terakhir: ${summary.detail}`}</Text>}
      </Card>
    );
  }

  return (
    <View>
      <Card title="Verifikasi Klaim Progres" rightAction={<Badge flag={summary.flag} label={summary.label} />}>
        <Text style={styles.detail}>{summary.detail}</Text>
        <Text style={styles.hint}>
          {actionable
            ? `${current.lines.length} baris diklaim. Angka cek terisi dari klaim pengawas; ubah bila foto atau laporan tidak mendukung.`
            : `${current.lines.length} baris diklaim. Angka cek terisi dari klaim pengawas.`}
        </Text>
        <Text style={styles.hint}>Lalu: terverifikasi sebelumnya. Klaim: angka pengawas. Cek: angka verifikasi.</Text>
        {ownClaim && (
          <Text style={styles.banner}>
            Klaim ini berisi angka yang Anda kirim atau isi sendiri. Verifikasi harus dilakukan estimator atau admin lain.
          </Text>
        )}
      </Card>

      {current.lines.map((line) => {
        const state = lineInputs[line.id] ?? EMPTY_INPUT;
        const c = check(current, line, state);
        if (!c.rowWeights) {
          return (
            <Card key={line.id} title={c.code} subtitle={c.item?.label}>
              <Text style={styles.error}>Bobot tahapan baris ini belum diatur. Kembalikan klaim atau atur bobot di Baseline.</Text>
            </Card>
          );
        }
        const refs = (line.evidence?.photo_refs ?? []).filter((r): r is string => typeof r === 'string');
        const mismatch = !!c.item && Math.abs((Number(c.item.installed) || 0) - c.ledgerBefore) > 0.0001;
        return (
          <Card
            key={line.id}
            title={c.code}
            subtitle={c.item?.label}
            rightAction={c.rowWeights.source === 'reference' ? <Badge flag="WARNING" label="Bobot referensi" /> : undefined}
          >
            <Text style={styles.hint}>{weightSourceLabel(c.rowWeights.source, c.rowWeights.referenceClass)}</Text>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[styles.cellStage, styles.headText]} numberOfLines={1}>Tahap</Text>
              <Text style={[styles.cell, styles.headText]} numberOfLines={1}>Lalu</Text>
              <Text style={[styles.cell, styles.headText]} numberOfLines={1}>Klaim</Text>
              <Text style={[styles.cellInput, styles.headText]} numberOfLines={1}>Cek</Text>
            </View>
            {stagesOf(c.rowWeights.weights).map((stage) => (
              <View key={stage} style={styles.tableRow}>
                <Text style={styles.cellStage}>{stageKeyLabel(stage)}</Text>
                <Text style={styles.cell}>{formatPercent(c.prev[stage] ?? 0)}</Text>
                <Text style={styles.cell}>{formatPercent(line.claimed_pct[stage] ?? 0)}</Text>
                <TextInput
                  style={[styles.cellInput, styles.input, !actionable && styles.inputDisabled]}
                  value={state.inputs[stage] ?? ''}
                  onChangeText={(v) => setInput(line.id, stage, v)}
                  editable={actionable}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Verifikasi ${stageKeyLabel(stage)} ${c.code}`}
                />
              </View>
            ))}
            {c.read && c.read.ok && c.next != null && c.delta != null ? (
              <Text style={styles.preview}>
                {`Progres baris ${formatFraction(c.prevFraction)} menjadi ${formatFraction(c.next)} (perkiraan ${c.delta > 0 ? '+' : ''}${formatQty(c.delta, c.item?.unit ?? '')})`}
              </Text>
            ) : (
              <Text style={styles.error}>{c.read && !c.read.ok ? c.read.reason : ''}</Text>
            )}
            {mismatch && c.item && (
              <Text style={styles.hint}>
                {`Terpasang di BoQ ${formatQty(Number(c.item.installed) || 0, c.item.unit)} berbeda dari riwayat progres ${formatQty(c.ledgerBefore, c.item.unit)}; verifikasi mengikuti riwayat.`}
              </Text>
            )}
            {c.needsReason && (
              <>
                <Text style={styles.warn}>
                  {c.regressed.length > 0
                    ? `Turun dari angka terverifikasi: ${c.regressed.map((s) => stageKeyLabel(s)).join(', ')}.`
                    : QUANTITY_DROP}
                </Text>
                <TextInput
                  style={[styles.input, styles.textarea, !actionable && styles.inputDisabled]}
                  value={state.reason}
                  onChangeText={(v) => setReason(line.id, v)}
                  editable={actionable}
                  multiline
                  placeholder="Alasan progres turun"
                  placeholderTextColor={COLORS.textMuted}
                  accessibilityLabel={`Alasan penurunan ${c.code}`}
                />
              </>
            )}
            {line.note ? <Text style={styles.note}>{`Catatan pengawas: ${line.note}`}</Text> : null}
            {refs.length > 0 ? (
              <View style={styles.photos}>
                {refs.map((ref, i) => (
                  <StoragePhoto
                    key={`${i}-${ref}`}
                    path={ref}
                    style={styles.photo}
                    loadingLabel={`Memuat foto ${i + 1}`}
                    testID={`claim-photo-${line.id}-${i}`}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>Tidak ada foto.</Text>
            )}
          </Card>
        );
      })}

      {actionable && (
        <Card title="Keputusan">
          {!returning ? (
            <>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={verifierNote}
                onChangeText={setVerifierNote}
                multiline
                placeholder="Catatan verifikasi (opsional)"
                placeholderTextColor={COLORS.textMuted}
                accessibilityLabel="Catatan verifikasi"
              />
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnBusy]}
                  onPress={() => void verify()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Verifikasi klaim"
                  accessibilityState={{ disabled: busy, busy }}
                >
                  <Text style={styles.primaryBtnText}>{busy ? 'Memproses...' : 'Verifikasi'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setReturning(true)} disabled={busy} accessibilityRole="button" accessibilityLabel="Kembalikan klaim">
                  <Text style={styles.ghostBtnText}>Kembalikan</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={returnNote}
                onChangeText={setReturnNote}
                multiline
                placeholder="Apa yang perlu diperbaiki pengawas?"
                placeholderTextColor={COLORS.textMuted}
                accessibilityLabel="Alasan pengembalian"
              />
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnBusy]}
                  onPress={() => void sendReturn()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Kirim pengembalian"
                >
                  <Text style={styles.primaryBtnText}>Kirim pengembalian</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setReturning(false)} disabled={busy} accessibilityRole="button" accessibilityLabel="Batal kembalikan">
                  <Text style={styles.ghostBtnText}>Batal</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: SPACE.lg },
  detail: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  note: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.xs },
  warn: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm },
  banner: {
    fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm,
    padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.warningBg,
  },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.xs },
  tableHead: { borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, marginTop: SPACE.sm },
  headText: { fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  cellStage: { flex: 1.3, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text },
  cell: { flex: 1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, textAlign: 'right' },
  cellInput: { flex: 1.1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), textAlign: 'right' },
  input: {
    minHeight: 44, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, fontSize: TYPE.sm, lineHeight: lh(TYPE.sm),
    fontFamily: FONTS.regular, color: COLORS.text,
  },
  inputDisabled: { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea: { minHeight: 64, textAlignVertical: 'top', textAlign: 'left', marginTop: SPACE.sm },
  preview: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.accentDark, marginTop: SPACE.sm },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  photo: { width: 96, height: 96, borderRadius: RADIUS, backgroundColor: COLORS.surfaceSunken },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, paddingHorizontal: SPACE.base, borderRadius: RADIUS, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, marginTop: SPACE.xs, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
});
```

`office/screens/OfficeReportsScreen.tsx` (apply this change):

```diff
diff --git a/office/screens/OfficeReportsScreen.tsx b/office/screens/OfficeReportsScreen.tsx
index abbedcb..448906e 100644
--- a/office/screens/OfficeReportsScreen.tsx
+++ b/office/screens/OfficeReportsScreen.tsx
@@ -1,4 +1,4 @@
-import React, { useState, useEffect } from 'react';
+import React, { useState, useEffect, useRef } from 'react';
 import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Modal, useWindowDimensions } from 'react-native';
 import { useNavigation, useRoute } from '@react-navigation/native';
 import { Ionicons } from '@expo/vector-icons';
@@ -22,6 +22,8 @@ import type { MandorAttendance, KasbonAging } from '../../tools/types';
 import { generateReport, recordReportExport, type ReportPayload, type ReportType, type ReportFilters } from '../../tools/reports';
 import { ReportPreview } from '../../workflows/components/ReportPreview';
 import ClientReportBuilderScreen from '../../workflows/screens/ClientReportBuilderScreen';
+import ProgressClaimVerifyPanel from './progressClaim/ProgressClaimVerifyPanel';
+import { countSubmittedClaims } from '../../tools/progressClaims/claims';
 import { getMaterialDrift } from '../../tools/envelopes';
 import { aggregateDriftRollup, formatRollupTile, type DriftRollup } from '../../tools/planDrift';
 import { computeOverallProgress } from '../../tools/progressMath';
@@ -32,20 +34,41 @@ function formatTs(v: string) {
   return new Date(v).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
 }
 
-type Section = 'overview' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review' | 'client-report';
+type Section = 'overview' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review' | 'client-report' | 'klaim';
 
 export default function OfficeReportsScreen() {
   const navigation = useNavigation<any>();
   const route = useRoute<any>();
-  const { project, profile, boqItems, purchaseOrders, defects, milestones } = useProject();
+  const { project, profile, boqItems, purchaseOrders, defects, milestones, refresh, setActiveProject } = useProject();
   const { show: toast } = useToast();
   const [activeSection, setActiveSection] = useState<Section>(route.params?.initialSection ?? 'overview');
   const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
 
+  // Route params apply once per navigation. Every navigate hands over a new
+  // params object, so opening Klaim again after a manual tab switch still
+  // lands. A claim notification (migration 104) also names its project and
+  // reloads the verification panel and the badge.
+  const [claimReloadKey, setClaimReloadKey] = useState(0);
+  const appliedParams = useRef<unknown>(null);
   useEffect(() => {
-    const nextSection = route.params?.initialSection as Section | undefined;
-    if (nextSection) setActiveSection(nextSection);
-  }, [route.params?.initialSection]);
+    const params = route.params as { initialSection?: Section; projectId?: string } | undefined;
+    if (!params || appliedParams.current === params) return;
+    appliedParams.current = params;
+    if (params.projectId && params.projectId !== project?.id) setActiveProject(params.projectId);
+    if (params.initialSection) setActiveSection(params.initialSection);
+    if (params.initialSection === 'klaim') setClaimReloadKey((k) => k + 1);
+  }, [route.params, project?.id, setActiveProject]);
+
+  // Claims waiting for verification on the active project, for the Klaim tab badge.
+  const [pendingClaims, setPendingClaims] = useState(0);
+  useEffect(() => {
+    if (!project) return;
+    let alive = true;
+    countSubmittedClaims(project.id)
+      .then((n) => { if (alive) setPendingClaims(n); })
+      .catch(() => { if (alive) setPendingClaims(0); });
+    return () => { alive = false; };
+  }, [project, activeSection, claimReloadKey]);
   const { width } = useWindowDimensions();
   const isTablet  = width >= BREAKPOINTS.tablet;
   const isDesktop = width >= BREAKPOINTS.desktop;
@@ -161,9 +184,10 @@ export default function OfficeReportsScreen() {
     return <ClientReportBuilderScreen onBack={() => setActiveSection('overview')} />;
   }
 
-  const sectionTabs: Array<{ key: Section; label: string; icon: string }> = [
+  const sectionTabs: Array<{ key: Section; label: string; icon: string; badge?: number }> = [
     { key: 'overview', label: 'Ringkasan', icon: 'stats-chart' },
     { key: 'jadwal', label: 'Jadwal', icon: 'calendar' },
+    { key: 'klaim', label: 'Klaim', icon: 'clipboard', badge: pendingClaims },
   ];
 
   return (
@@ -182,6 +206,11 @@ export default function OfficeReportsScreen() {
           >
             <Ionicons name={tab.icon as any} size={16} color={activeSection === tab.key ? COLORS.primary : COLORS.textSec} />
             <Text style={[styles.tabText, activeSection === tab.key && styles.tabTextActive]}>{tab.label}</Text>
+            {tab.badge ? (
+              <View style={styles.tabBadge} accessibilityLabel={`${tab.badge} klaim menunggu verifikasi`}>
+                <Text style={styles.tabBadgeText}>{tab.badge}</Text>
+              </View>
+            ) : null}
           </TouchableOpacity>
         ))}
       </View>
@@ -199,6 +228,20 @@ export default function OfficeReportsScreen() {
           />
         )}
 
+        {activeSection === 'klaim' && project && (
+          <ProgressClaimVerifyPanel
+            projectId={project.id}
+            profile={profile ? { id: profile.id, role: profile.role } : null}
+            boqItems={boqItems}
+            reloadKey={claimReloadKey}
+            toast={toast}
+            onVerified={() => { void refresh(); }}
+            onChanged={() => {
+              countSubmittedClaims(project.id).then(setPendingClaims).catch(() => undefined);
+            }}
+          />
+        )}
+
         {activeSection === 'overview' && (<>
         <Text style={styles.sectionHead}>Laporan & Export</Text>
 
@@ -720,6 +763,8 @@ const styles = StyleSheet.create({
   },
   tabText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.textSec },
   tabTextActive: { color: COLORS.primary },
+  tabBadge: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.critical, alignItems: 'center', justifyContent: 'center' },
+  tabBadgeText: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.45), fontFamily: FONTS.bold, color: COLORS.textInverse },
   sectionHead: {
     fontSize: TYPE.sm,
     fontFamily: FONTS.bold,
```

`office/navigation.tsx` (apply this change):

```diff
diff --git a/office/navigation.tsx b/office/navigation.tsx
index c1cbbf4..f5ccc06 100644
--- a/office/navigation.tsx
+++ b/office/navigation.tsx
@@ -35,7 +35,7 @@ export type OfficeTabParamList = {
   Rooms: undefined;
   Mandor: undefined;
   Opname: undefined;
-  Reports: undefined;
+  Reports: { initialSection?: string; projectId?: string; claimId?: string } | undefined;
   Notifikasi: undefined;
   RoomDetail: { projectCode: string; roomCode: string };
   SiteEventDetail: { eventId: string; projectId: string };
```

`office/PrincipalNavigation.tsx` (apply this change):

```diff
diff --git a/office/PrincipalNavigation.tsx b/office/PrincipalNavigation.tsx
index 0d9e00f..5af187b 100644
--- a/office/PrincipalNavigation.tsx
+++ b/office/PrincipalNavigation.tsx
@@ -23,7 +23,7 @@ export type PrincipalTabParamList = {
   Home: undefined;
   Approvals: undefined;
   Rooms: undefined;
-  Reports: undefined;
+  Reports: { initialSection?: string; projectId?: string; claimId?: string } | undefined;
   Notifikasi: undefined;
   RoomDetail: { projectCode: string; roomCode: string };
   SiteEventDetail: { eventId: string; projectId: string };
```

`office/screens/NotificationsScreen.tsx` (apply this change):

```diff
diff --git a/office/screens/NotificationsScreen.tsx b/office/screens/NotificationsScreen.tsx
index fe96661..265004a 100644
--- a/office/screens/NotificationsScreen.tsx
+++ b/office/screens/NotificationsScreen.tsx
@@ -8,6 +8,9 @@ const NOTIFICATION_ROUTE_MAP: Record<string, string> = {
   ApprovalsScreen: 'Approvals',
   POScreen: 'Procurement',
   ReceiptScreen: 'Terima',
+  // Migration 104 claim notifications; both open the Klaim section of Reports.
+  ProgressClaimVerify: 'Reports',
+  ProgressClaim: 'Reports',
 };
 
 interface Props {
@@ -87,7 +90,9 @@ export default function NotificationsScreen({ profileId }: Props): React.ReactEl
     }
     const target = NOTIFICATION_ROUTE_MAP[item.deeplinkScreen] ?? item.deeplinkScreen;
     try {
-      navigation.navigate(target, item.deeplinkParams ?? {});
+      // A fresh params object per tap, so a screen that applies params once per
+      // navigation still reacts to a second tap on the same notification.
+      navigation.navigate(target, { ...(item.deeplinkParams ?? {}) });
     } catch {
       // Route not in current role's nav — stay on Notifikasi (no-op).
     }
```

`workflows/screens/components/NotificationList.tsx` (apply this change):

```diff
diff --git a/workflows/screens/components/NotificationList.tsx b/workflows/screens/components/NotificationList.tsx
index d2dd9f9..a1ca336 100644
--- a/workflows/screens/components/NotificationList.tsx
+++ b/workflows/screens/components/NotificationList.tsx
@@ -37,6 +37,9 @@ const TYPE_STYLES: Record<string, TypeStyle> = {
   REQUEST_APPROVED_FOR_PO: { icon: 'cart',             color: COLORS.ok,       bg: COLORS.okBg },
   PLAN_REVISED:            { icon: 'refresh-circle',   color: COLORS.info,     bg: COLORS.infoBg },
   PLAN_CEILING_RAISE:      { icon: 'trending-up',      color: COLORS.warning,  bg: COLORS.warningBg },
+  PROGRESS_CLAIM_SUBMITTED: { icon: 'clipboard',             color: COLORS.info,    bg: COLORS.infoBg },
+  PROGRESS_CLAIM_RETURNED:  { icon: 'arrow-undo-circle',     color: COLORS.warning, bg: COLORS.warningBg },
+  PROGRESS_CLAIM_VERIFIED:  { icon: 'checkmark-done-circle', color: COLORS.ok,      bg: COLORS.okBg },
   CRITICAL:                { icon: 'warning',          color: COLORS.critical, bg: COLORS.criticalBg },
   WARNING:                 { icon: 'warning',          color: COLORS.warning,  bg: COLORS.warningBg },
 };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx workflows/screens/components/__tests__/NotificationList.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 2 suites, 16 tests.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add office/screens/progressClaim/ProgressClaimVerifyPanel.tsx office/screens/OfficeReportsScreen.tsx office/navigation.tsx office/PrincipalNavigation.tsx office/screens/NotificationsScreen.tsx workflows/screens/components/NotificationList.tsx office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx
git commit -m "feat(progress): estimator verification panel and Klaim tab in office Reports"
```

---

### Task 18: Bobot Tahapan in Baseline

**Files:**
- Create: `workflows/screens/progressClaim/StageWeightsPanel.tsx`
- Modify: `workflows/screens/BaselineScreen.tsx`
- Test: `workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx`

Estimators and admins apply the reference profile to rows without weights, edit three percents that must add up to 100, switch a row to one stage, or reset it to the reference of its class. Other roles read. The card starts collapsed behind a summary, so a large RAB does not push the import sessions in Baseline down, and it ignores row taps while a save runs.

- [ ] **Step 1: Write the failing test**

`workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx` (new file):

```tsx
// workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  listStageWeights: jest.fn(),
  seedReferenceWeights: jest.fn(),
  setStageWeights: jest.fn(),
  resetStageWeights: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));

import { listStageWeights, resetStageWeights, seedReferenceWeights, setStageWeights } from '../../../../tools/progressClaims/claims';
import StageWeightsPanel from '../StageWeightsPanel';

const item = (id: string, code: string, label: string, sort: number) => ({
  id, project_id: 'p1', code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const kolomRow = { boq_item_id: 'k1', weights: { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 }, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' };

const renderPanel = (role = 'estimator', items = ITEMS) => {
  const toast = jest.fn();
  return { ...render(<StageWeightsPanel projectId="p1" role={role} boqItems={items} toast={toast} />), toast };
};

const openRows = async (utils: ReturnType<typeof renderPanel>) => {
  fireEvent.press(await utils.findByLabelText('Tampilkan baris'));
};

beforeEach(() => {
  jest.clearAllMocks();
  (listStageWeights as jest.Mock).mockResolvedValue([kolomRow]);
  (seedReferenceWeights as jest.Mock).mockResolvedValue(1);
  (setStageWeights as jest.Mock).mockResolvedValue(undefined);
  (resetStageWeights as jest.Mock).mockResolvedValue(undefined);
});

describe('StageWeightsPanel', () => {
  it('starts collapsed with a summary, then lists each row with its weights and source', async () => {
    const utils = renderPanel();
    expect(await utils.findByText('2 baris · 1 belum diatur · 1 referensi')).toBeTruthy();
    expect(utils.queryByText('Belum diatur')).toBeNull();
    await openRows(utils);
    expect(utils.getByText('Bekisting 32,6% · Pembesian 48,6% · Pengecoran 18,8%')).toBeTruthy();
    expect(utils.getByText('Bobot referensi (Kolom)')).toBeTruthy();
    expect(utils.getByText('Belum diatur')).toBeTruthy();
  });

  it('applies the reference profile to rows that have no weights', async () => {
    const { findByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Terapkan bobot referensi ke 1 baris'));
    await waitFor(() => expect(seedReferenceWeights).toHaveBeenCalledWith('p1', [{ boq_item_id: 'pc1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' }]));
    await waitFor(() => expect(listStageWeights).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith('1 baris memakai bobot referensi.', 'ok');
  });

  it('saves three stage weights that add up to 100', async () => {
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(utils.getByLabelText('Bobot Bekisting').props.value).toBe('32,6');
    fireEvent.changeText(utils.getByLabelText('Bobot Bekisting'), '30');
    fireEvent.changeText(utils.getByLabelText('Bobot Pembesian'), '50');
    fireEvent.changeText(utils.getByLabelText('Bobot Pengecoran'), '20');
    fireEvent.press(utils.getByLabelText('Simpan bobot'));
    await waitFor(() => expect(setStageWeights).toHaveBeenCalledWith('k1', { BEKISTING: 0.3, PEMBESIAN: 0.5, PENGECORAN: 0.2 }));
    expect(utils.toast).toHaveBeenCalledWith('Bobot T1-001 disimpan.', 'ok');
  });

  it('refuses weights that do not add up to 100', async () => {
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.changeText(utils.getByLabelText('Bobot Bekisting'), '30');
    fireEvent.changeText(utils.getByLabelText('Bobot Pembesian'), '50');
    fireEvent.changeText(utils.getByLabelText('Bobot Pengecoran'), '19');
    fireEvent.press(utils.getByLabelText('Simpan bobot'));
    expect(utils.toast).toHaveBeenCalledWith('Jumlah bobot 99%, harus 100%.', 'critical');
    expect(setStageWeights).not.toHaveBeenCalled();
  });

  it('switches a row to a single stage', async () => {
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.press(utils.getByLabelText('Satu tahap'));
    fireEvent.press(utils.getByLabelText('Simpan bobot'));
    await waitFor(() => expect(setStageWeights).toHaveBeenCalledWith('k1', { SINGLE: 1 }));
  });

  it('shows the server refusal when a verified row cannot change shape', async () => {
    (setStageWeights as jest.Mock).mockRejectedValueOnce(new Error('Baris ini sudah punya klaim terverifikasi, jadi jenis bobotnya (satu tahap atau tiga tahap) tidak bisa diubah. Ubah nilainya saja.'));
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.press(utils.getByLabelText('Satu tahap'));
    fireEvent.press(utils.getByLabelText('Simpan bobot'));
    await waitFor(() => expect(utils.toast).toHaveBeenCalledWith('Baris ini sudah punya klaim terverifikasi, jadi jenis bobotnya (satu tahap atau tiga tahap) tidak bisa diubah. Ubah nilainya saja.', 'critical'));
    expect(utils.getByLabelText('Simpan bobot')).toBeTruthy();
  });

  it('puts a row back on the reference profile of its class', async () => {
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.press(utils.getByLabelText('Kembalikan ke referensi Kolom'));
    await waitFor(() => expect(resetStageWeights).toHaveBeenCalledWith('k1', 'KOLOM'));
  });

  it('prefills a row without weights with the reference of its class', async () => {
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-002 Lantai 1 ; Pile Cap'));
    expect(utils.getByLabelText('Bobot Bekisting').props.value).toBe('13,1');
  });

  it('ignores row taps while a save is running', async () => {
    let finish: () => void = () => undefined;
    (setStageWeights as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const utils = renderPanel();
    await openRows(utils);
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.press(utils.getByLabelText('Satu tahap'));
    fireEvent.press(utils.getByLabelText('Simpan bobot'));
    fireEvent.press(utils.getByLabelText('T1-002 Lantai 1 ; Pile Cap'));
    expect(utils.queryByLabelText('Bobot Bekisting')).toBeNull();
    await act(async () => { finish(); });
    await waitFor(() => expect(utils.queryByLabelText('Simpan bobot')).toBeNull());
  });

  it('only reads for a supervisor', async () => {
    const utils = renderPanel('supervisor');
    await openRows(utils);
    expect(utils.getByText('Belum diatur')).toBeTruthy();
    expect(utils.queryByLabelText('Terapkan bobot referensi ke 1 baris')).toBeNull();
    fireEvent.press(utils.getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(utils.queryByLabelText('Simpan bobot')).toBeNull();
  });

  it('renders nothing before a BoQ is published', () => {
    const { toJSON } = renderPanel('estimator', EMPTY);
    expect(toJSON()).toBeNull();
    expect(listStageWeights).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../StageWeightsPanel'`.

- [ ] **Step 3: Write the implementation**

`workflows/screens/progressClaim/StageWeightsPanel.tsx` (new file):

```tsx
// workflows/screens/progressClaim/StageWeightsPanel.tsx
// SANO — Bobot Tahapan (spec §7.4, §17): the share of each work-area row's
// value carried by bekisting, pembesian and pengecoran, which turns stage
// percents into installed quantity when a claim is verified. Estimators and
// admins edit it in Baseline; other roles read it. Every write is an RPC
// (migration 103) that re-checks the role and the shape.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Card from '../../components/Card';
import { canEditStageWeights } from '../../../tools/progressClaims/claimRules';
import {
  listStageWeights, resetStageWeights, seedReferenceWeights, setStageWeights, type StageWeightRow,
} from '../../../tools/progressClaims/claims';
import {
  SPLIT_STAGES, WORK_AREA_CLASS_LABELS, classifyRows, claimableRows, formatPercent, missingWeightSeeds,
  readWeightPercentInputs, stageKeyLabel, weightPercentInputs, weightSourceLabel,
  type ClaimableItem, type SplitStage,
} from '../../../tools/progressClaims/claimView';
import { REFERENCE_PROFILE } from '../../../tools/progressClaims/referenceStageWeights.data';
import { isSingle, referenceWeightsFor, validateStageWeights, type StageWeights } from '../../../tools/progressClaims/stageWeights';
import type { WorkAreaClass } from '../../../tools/progressClaims/workAreaClass';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);
const BLANK: Record<SplitStage, string> = { BEKISTING: '', PEMBESIAN: '', PENGECORAN: '' };

interface Props {
  projectId: string;
  role: string | null | undefined;
  boqItems: ClaimableItem[];
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

export function weightsSummary(weights: StageWeights | null): string {
  if (!weights) return 'Belum diatur';
  if (isSingle(weights)) return 'Satu tahap (100%)';
  return SPLIT_STAGES.map((s) => `${stageKeyLabel(s)} ${formatPercent(weights[s] * 100)}`).join(' · ');
}

export default function StageWeightsPanel({ projectId, role, boqItems, toast }: Props) {
  const rows = useMemo(() => claimableRows(boqItems, projectId), [boqItems, projectId]);
  const classes = useMemo(() => classifyRows(rows), [rows]);
  const canEdit = canEditStageWeights(role);
  const [stored, setStored] = useState<StageWeightRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default: a large RAB would otherwise push Baseline's import sessions far down.
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'split' | 'single'>('split');
  const [inputs, setInputs] = useState<Record<SplitStage, string>>(BLANK);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const next = await listStageWeights(projectId);
      if (mine === seq.current) setStored(next);
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? 'Bobot tahapan gagal dimuat.');
    }
  }, [projectId]);

  useEffect(() => {
    setStored(null);
    setEditingId(null);
  }, [projectId]);

  useEffect(() => {
    if (rows.length === 0) return undefined;
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load, rows.length]);

  const byRow = useMemo(() => {
    const map = new Map<string, { weights: StageWeights; row: StageWeightRow }>();
    for (const w of stored ?? []) {
      const checked = validateStageWeights(w.weights);
      if (checked.ok) map.set(w.boq_item_id, { weights: checked.weights, row: w });
    }
    return map;
  }, [stored]);
  const missing = useMemo(() => (stored ? missingWeightSeeds(rows, stored) : []), [rows, stored]);
  const referenceCount = useMemo(() => rows.filter((r) => byRow.get(r.id)?.row.source === 'reference').length, [rows, byRow]);

  const classOf = (id: string): WorkAreaClass => classes.get(id) ?? 'LAINNYA';

  const openEditor = (id: string) => {
    if (!canEdit || busy) return;
    if (editingId === id) {
      setEditingId(null);
      return;
    }
    const current = byRow.get(id)?.weights ?? referenceWeightsFor(classOf(id), REFERENCE_PROFILE);
    setMode(isSingle(current) ? 'single' : 'split');
    setInputs(weightPercentInputs(current));
    setEditingId(id);
  };

  const switchMode = (next: 'split' | 'single', id: string) => {
    setMode(next);
    if (next === 'split' && SPLIT_STAGES.every((s) => !inputs[s])) {
      setInputs(weightPercentInputs(REFERENCE_PROFILE[classOf(id)]?.weights ?? null));
    }
  };

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await task();
      toast(done, 'ok');
      setEditingId(null);
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Bobot gagal disimpan.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const save = (item: ClaimableItem) => {
    let weights: StageWeights;
    if (mode === 'single') {
      weights = { SINGLE: 1 };
    } else {
      const read = readWeightPercentInputs(inputs);
      if (!read.ok) {
        toast(read.reason, 'critical');
        return;
      }
      weights = read.weights;
    }
    void run(() => setStageWeights(item.id, weights), `Bobot ${item.code} disimpan.`);
  };

  const reset = (item: ClaimableItem) =>
    void run(() => resetStageWeights(item.id, classOf(item.id)), `Bobot ${item.code} dikembalikan ke referensi.`);

  const applyMissing = () =>
    void run(() => seedReferenceWeights(projectId, missing), `${missing.length} baris memakai bobot referensi.`);

  if (rows.length === 0) return null;

  return (
    <Card title="Bobot Tahapan Progres" borderColor={COLORS.accent}>
      <Text style={styles.hint}>
        Bobot menentukan bagian volume baris yang dihitung terpasang per tahap saat klaim progres diverifikasi. Nilai referensi diturunkan dari lima RAB; ubah bila RAB proyek ini berbeda.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {!stored && !error && <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat bobot tahapan" />}
      {stored && <Text style={styles.summary}>{`${rows.length} baris · ${missing.length} belum diatur · ${referenceCount} referensi`}</Text>}
      {stored && canEdit && missing.length > 0 && (
        <TouchableOpacity
          style={[styles.primaryBtn, busy && styles.btnBusy]}
          onPress={applyMissing}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Terapkan bobot referensi ke ${missing.length} baris`}
        >
          <Text style={styles.primaryBtnText}>{`Terapkan bobot referensi ke ${missing.length} baris`}</Text>
        </TouchableOpacity>
      )}
      {stored && (
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Sembunyikan baris' : 'Tampilkan baris'}
        >
          <Text style={styles.ghostBtnText}>{expanded ? 'Sembunyikan baris' : 'Tampilkan baris'}</Text>
        </TouchableOpacity>
      )}
      {stored && expanded && rows.map((item) => {
        const entry = byRow.get(item.id);
        const cls = classOf(item.id);
        const open = editingId === item.id;
        return (
          <View key={item.id}>
            <TouchableOpacity
              style={[styles.row, open && styles.rowActive]}
              onPress={() => openEditor(item.id)}
              disabled={!canEdit || busy}
              accessibilityRole={canEdit ? 'button' : undefined}
              accessibilityLabel={`${item.code} ${item.label}`}
            >
              <Text style={styles.rowCode}>{item.code}</Text>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={[styles.rowSub, !entry && styles.rowWarn]}>{weightsSummary(entry?.weights ?? null)}</Text>
              {entry && <Text style={styles.rowSub}>{weightSourceLabel(entry.row.source, entry.row.reference_class)}</Text>}
            </TouchableOpacity>
            {open && (
              <View style={styles.editor}>
                <View style={styles.modeRow}>
                  {(['split', 'single'] as const).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.modeChip, mode === m && styles.modeChipActive]}
                      onPress={() => switchMode(m, item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={m === 'split' ? 'Tiga tahap' : 'Satu tahap'}
                      accessibilityState={{ selected: mode === m }}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    >
                      <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'split' ? 'Tiga tahap' : 'Satu tahap'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {mode === 'split' ? (
                  SPLIT_STAGES.map((s) => (
                    <View key={s} style={styles.inputRow}>
                      <Text style={styles.inputLabel}>{stageKeyLabel(s)}</Text>
                      <TextInput
                        style={styles.input}
                        value={inputs[s]}
                        onChangeText={(v) => setInputs((prev) => ({ ...prev, [s]: v }))}
                        keyboardType="decimal-pad"
                        accessibilityLabel={`Bobot ${stageKeyLabel(s)}`}
                      />
                      <Text style={styles.pct}>%</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.hint}>Baris ini diklaim dengan satu persentase progres, tanpa pembagian tahap.</Text>
                )}
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, busy && styles.btnBusy]}
                    onPress={() => save(item)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Simpan bobot"
                  >
                    <Text style={styles.primaryBtnText}>Simpan bobot</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.ghostBtn}
                    onPress={() => reset(item)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Kembalikan ke referensi ${WORK_AREA_CLASS_LABELS[cls]}`}
                  >
                    <Text style={styles.ghostBtnText}>{`Referensi ${WORK_AREA_CLASS_LABELS[cls]}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => setEditingId(null)} accessibilityRole="button" accessibilityLabel="Tutup editor bobot">
                    <Text style={styles.ghostBtnText}>Tutup</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: SPACE.sm },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  summary: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.xs },
  row: { paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xs, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  rowActive: { backgroundColor: COLORS.accentBg, borderRadius: RADIUS },
  rowCode: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  rowLabel: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  rowSub: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  rowWarn: { color: COLORS.warning, fontFamily: FONTS.semibold },
  editor: { padding: SPACE.md, marginBottom: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.borderSub },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm },
  modeChip: {
    minHeight: 36, paddingHorizontal: SPACE.md, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
  },
  modeChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.accentBg },
  modeText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.textSec },
  modeTextActive: { color: COLORS.primary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs },
  inputLabel: { flex: 1, fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  input: {
    minWidth: 84, minHeight: 44, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, fontSize: TYPE.sm, lineHeight: lh(TYPE.sm),
    fontFamily: FONTS.regular, color: COLORS.text, textAlign: 'right',
  },
  pct: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textSec },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
});
```

`workflows/screens/BaselineScreen.tsx` (apply this change):

```diff
diff --git a/workflows/screens/BaselineScreen.tsx b/workflows/screens/BaselineScreen.tsx
index d0dd926..27d853d 100644
--- a/workflows/screens/BaselineScreen.tsx
+++ b/workflows/screens/BaselineScreen.tsx
@@ -66,6 +66,8 @@ import {
 } from '../../tools/addProjectMaterialLine';
 import type { ImportSession, ImportStagingRow, ImportAnomaly } from '../../tools/types';
 import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
+import StageWeightsPanel from './progressClaim/StageWeightsPanel';
+import { canEditStageWeights } from '../../tools/progressClaims/claimRules';
 import { sourceLocation, sourceContext } from '../../tools/sourceProvenance';
 import { flagExplanation, ACTION_CAPTIONS } from '../../tools/flagExplanation';
 import { groupReviewRows, subGroupByParentBlock, pendingRowIds, FLAG_GROUP_HINTS } from '../../tools/flagGroups';
@@ -309,7 +311,7 @@ export default function BaselineScreen({
   backLabel?: string;
   onGoToJadwal?: () => void;
 }) {
-  const { project, profile, refresh } = useProject();
+  const { project, profile, refresh, boqItems } = useProject();
   const { show: toast } = useToast();
 
   const [view, setView] = useState<ScreenView>('sessions');
@@ -2033,6 +2035,10 @@ export default function BaselineScreen({
               </Card>
             )}
 
+            {project && canEditStageWeights(profile?.role) && (
+              <StageWeightsPanel projectId={project.id} role={profile?.role} boqItems={boqItems} toast={toast} />
+            )}
+
             {loading && <Text style={styles.hint}>Memuat sesi import...</Text>}
 
             {lastImportIssue && (
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 11 tests.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/progressClaim/StageWeightsPanel.tsx workflows/screens/BaselineScreen.tsx workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx
git commit -m "feat(progress): Bobot Tahapan editor in Baseline"
```

---

### Task 19: Klaim minggu ini on the principal home

**Files:**
- Create: `workflows/screens/progressClaim/ProgressClaimStatusCard.tsx`
- Modify: `office/screens/PrincipalHomeScreen.tsx`
- Test: `workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx`

The latest claim's status and how many rows still rely on reference weights, next to Progres vs Jadwal in both layouts (spec §6.3). Nothing to approve; the card opens Reports › Klaim.

- [ ] **Step 1: Write the failing test**

`workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx` (new file):

```tsx
// workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  getLatestClaim: jest.fn(),
  listStageWeights: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));

import { getLatestClaim, listStageWeights } from '../../../../tools/progressClaims/claims';
import ProgressClaimStatusCard from '../ProgressClaimStatusCard';

const item = (id: string, code: string, label: string, sort: number, projectId = 'p1') => ({
  id, project_id: projectId, code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const EN_DASH = String.fromCharCode(0x2013);

beforeEach(() => {
  jest.clearAllMocks();
  (getLatestClaim as jest.Mock).mockResolvedValue({
    id: 'c1', project_id: 'p1', week_start: '2026-09-14', status: 'VERIFIED', verified_at: '2026-09-15T20:00:00Z', return_note: null,
  });
  (listStageWeights as jest.Mock).mockResolvedValue([
    { boq_item_id: 'k1', weights: { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 }, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' },
  ]);
});

describe('ProgressClaimStatusCard', () => {
  it('shows the latest claim status and how many rows rely on reference weights', async () => {
    const { findByText, getByText } = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={jest.fn()} />);
    expect(await findByText('Terverifikasi')).toBeTruthy();
    expect(getByText(`Minggu 14${EN_DASH}20 Sep, diverifikasi 16 Sep`)).toBeTruthy();
    expect(getByText('1 dari 2 baris memakai bobot referensi.')).toBeTruthy();
    expect(getByText('1 baris belum punya bobot tahapan.')).toBeTruthy();
  });

  it('opens the claim view', async () => {
    const onOpen = jest.fn();
    const { findByLabelText } = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={onOpen} />);
    fireEvent.press(await findByLabelText('Buka klaim progres'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('says so when the status cannot be loaded', async () => {
    (getLatestClaim as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const { findByText } = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={jest.fn()} />);
    expect(await findByText('Status klaim belum bisa dimuat.')).toBeTruthy();
  });

  it('loads again for another project', async () => {
    const utils = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={jest.fn()} />);
    await utils.findByText('Terverifikasi');
    const P2 = [item('k9', 'T1-001', 'Lantai 1 ; Kolom', 1, 'p2')];
    utils.rerender(<ProgressClaimStatusCard projectId="p2" boqItems={P2} onOpen={jest.fn()} />);
    await waitFor(() => expect(getLatestClaim).toHaveBeenCalledWith('p2'));
  });

  it('renders nothing for a project without a published BoQ', () => {
    const { toJSON } = render(<ProgressClaimStatusCard projectId="p1" boqItems={EMPTY} onOpen={jest.fn()} />);
    expect(toJSON()).toBeNull();
    expect(getLatestClaim).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `Cannot find module '../ProgressClaimStatusCard'`.

- [ ] **Step 3: Write the implementation**

`workflows/screens/progressClaim/ProgressClaimStatusCard.tsx` (new file):

```tsx
// workflows/screens/progressClaim/ProgressClaimStatusCard.tsx
// SANO — Klaim minggu ini on the principal's home (spec §6.3): the latest
// claim's status and how many work-area rows still rely on reference weights.
// Nothing to approve here; the card opens the verification view.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import { getLatestClaim, listStageWeights, type ProgressClaim, type StageWeightRow } from '../../../tools/progressClaims/claims';
import { claimStatusSummary, claimableRows, type ClaimableItem } from '../../../tools/progressClaims/claimView';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);

interface Props {
  projectId: string;
  boqItems: ClaimableItem[];
  onOpen: () => void;
}

export default function ProgressClaimStatusCard({ projectId, boqItems, onOpen }: Props) {
  const rows = useMemo(() => claimableRows(boqItems, projectId), [boqItems, projectId]);
  const [claim, setClaim] = useState<ProgressClaim | null>(null);
  const [weights, setWeights] = useState<StageWeightRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (rows.length === 0) return undefined;
    let alive = true;
    setState('loading');
    Promise.all([getLatestClaim(projectId), listStageWeights(projectId)])
      .then(([latest, stored]) => {
        if (!alive) return;
        setClaim(latest);
        setWeights(stored);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [projectId, rows.length]);

  if (rows.length === 0) return null;

  const summary = claimStatusSummary(claim);
  const ids = new Set(rows.map((r) => r.id));
  const inProject = weights.filter((w) => ids.has(w.boq_item_id));
  const reference = inProject.filter((w) => w.source === 'reference').length;
  const unset = rows.length - inProject.length;

  return (
    <Card
      title="Klaim Progres Minggu Ini"
      rightAction={state === 'ready' ? <Badge flag={summary.flag} label={summary.label} /> : undefined}
    >
      <Text style={styles.detail}>
        {state === 'loading' ? 'Memuat status klaim...' : state === 'error' ? 'Status klaim belum bisa dimuat.' : summary.detail}
      </Text>
      {state === 'ready' && reference > 0 && (
        <Text style={styles.hint}>{`${reference} dari ${rows.length} baris memakai bobot referensi.`}</Text>
      )}
      {state === 'ready' && unset > 0 && <Text style={styles.hint}>{`${unset} baris belum punya bobot tahapan.`}</Text>}
      <TouchableOpacity style={styles.link} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Buka klaim progres">
        <Text style={styles.linkText}>Buka klaim progres</Text>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  detail: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  link: { marginTop: SPACE.sm, minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.primary },
});
```

`office/screens/PrincipalHomeScreen.tsx` (apply this change):

```diff
diff --git a/office/screens/PrincipalHomeScreen.tsx b/office/screens/PrincipalHomeScreen.tsx
index 189e5d8..35f5b6a 100644
--- a/office/screens/PrincipalHomeScreen.tsx
+++ b/office/screens/PrincipalHomeScreen.tsx
@@ -22,6 +22,7 @@ import { computeOverallProgress } from '../../tools/progressMath';
 import { getKasbonAging, kasbonStatusLabel } from '../../tools/kasbon';
 import type { KasbonAging } from '../../tools/types';
 import { formatRp } from '../../tools/opname';
+import ProgressClaimStatusCard from '../../workflows/screens/progressClaim/ProgressClaimStatusCard';
 
 interface PendingCounts {
   perubahan: number;
@@ -957,6 +958,15 @@ export default function PrincipalHomeScreen() {
     </Card>
   );
 
+  // ── Klaim progres minggu ini (report-driven progress spec §6.3) ──
+  const claimWeekCard = project ? (
+    <ProgressClaimStatusCard
+      projectId={project.id}
+      boqItems={boqItems}
+      onOpen={() => navigation.navigate('Reports', { initialSection: 'klaim' })}
+    />
+  ) : null;
+
   // ── Section 8: Catatan Perubahan ──
   const CHANGE_TYPE_LABELS: Record<string, string> = {
     permintaan_owner: 'Permintaan Owner',
@@ -1391,6 +1401,7 @@ export default function PrincipalHomeScreen() {
               {statRowBlock}
               {todayPulseCard}
               {progressVsScheduleCard}
+              {claimWeekCard}
               {allClearCard}
               {pendingCard}
               {financialCard}
@@ -1418,6 +1429,7 @@ export default function PrincipalHomeScreen() {
             {statRowBlock}
             {todayPulseCard}
             {progressVsScheduleCard}
+            {claimWeekCard}
             {allClearCard}
             {pendingCard}
             {teamActivityCard}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 1 suite, 5 tests.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/progressClaim/ProgressClaimStatusCard.tsx office/screens/PrincipalHomeScreen.tsx workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx
git commit -m "feat(progress): principal home card for the weekly claim"
```

---

### Task 20: Progress readers after claims

**Files:**
- Modify: `tools/derivation.ts`
- Modify: `tools/progressMath.ts`
- Modify: `tools/audit.ts`

`syncBoqInstalledFromDerived` has no caller left and is removed; the progressMath note names the single writer of `installed`; the audit's "no progress in 7 days" anomaly counts saved claim lines, because entries now appear only at verification.

- [ ] **Step 1: Apply the changes**

`tools/derivation.ts` (apply this change):

```diff
diff --git a/tools/derivation.ts b/tools/derivation.ts
index 53b4b19..aa801d8 100644
--- a/tools/derivation.ts
+++ b/tools/derivation.ts
@@ -519,39 +519,12 @@ export async function deriveMaterialBalance(projectId: string): Promise<Material
   return balances.sort((a, b) => a.material_name.localeCompare(b.material_name));
 }
 
-// ── Sync Derived Totals Back to BoQ ─────────────────────────────────
-// Updates boq_items.installed from derived totals. Call after progress entries.
-
-export async function syncBoqInstalledFromDerived(projectId: string): Promise<number> {
-  const totals = await deriveBoqInstalledTotals(projectId);
-  let updated = 0;
-
-  for (const t of totals) {
-    const { error } = await supabase
-      .from('boq_items')
-      .update({
-        installed: t.total_installed,
-        progress: 0, // Will be recomputed below
-      })
-      .eq('id', t.boq_item_id);
-
-    if (!error) {
-      // Recompute progress percentage
-      const { data: item } = await supabase
-        .from('boq_items')
-        .select('planned')
-        .eq('id', t.boq_item_id)
-        .single();
-
-      if (item && item.planned > 0) {
-        const pct = Math.min(100, Math.round((t.total_installed / item.planned) * 100));
-        await supabase.from('boq_items').update({ progress: pct }).eq('id', t.boq_item_id);
-      }
-      updated++;
-    }
-  }
-  return updated;
-}
+// ── boq_items.installed has one writer ───────────────────────────────
+// verify_progress_claim (migration 104) sets installed and progress and
+// records every change as a progress_entries row, negative for a correction,
+// so a claimed row's entries always sum to its installed column. The client
+// sync that used to recompute both from progress_entries was removed with the
+// quantity form it served (report-driven progress spec §16, §18).
 
 // ── Control-aware Material Balance ───────────────────────────────────
 // Merges quantity balances with Rupiah budgets into one row per material.
```

`tools/progressMath.ts` (apply this change):

```diff
diff --git a/tools/progressMath.ts b/tools/progressMath.ts
index 35d9b6e..0e74b56 100644
--- a/tools/progressMath.ts
+++ b/tools/progressMath.ts
@@ -36,14 +36,16 @@
 //
 // Edge case: Σ planned = 0 (no active item has planned > 0) → 0.
 //
-// Reviewer note: tools/reports.ts feeds this formula a derived `installed`
-// (summed from progress_entries), while every screen surface (Beranda,
-// Laporan, OfficeHomeScreen, OfficeReportsScreen, PrincipalHomeScreen,
-// GlobalAIChatLauncher, schedule.ts computeProjectHealth) feeds it the
-// cached `boq_items.installed` column. Same formula, same source-of-truth
-// module — but if the cache lags behind progress_entries, the two families
-// of callers can still diverge at the data level. Pre-existing, not
-// introduced by this unification.
+// Source of installed (2026-09-14, migration 104): verify_progress_claim is
+// the only writer of boq_items.installed, and it records every change as a
+// progress_entries row (negative for a correction). A claimed row's entries
+// therefore sum to its cached installed column, so callers that derive
+// installed from progress_entries (tools/reports.ts generateProgressSummary,
+// tools/clientReport.ts installedAsOf) and the screens that read the column
+// (Beranda, Laporan, OfficeHomeScreen, OfficeReportsScreen,
+// PrincipalHomeScreen, GlobalAIChatLauncher, schedule.ts) agree. A row whose
+// installed was set before claims existed can still differ until its first
+// verified claim writes the difference.
 
 export interface ProgressAggregable {
   planned: number;
```

`tools/audit.ts` (apply this change):

```diff
diff --git a/tools/audit.ts b/tools/audit.ts
index cc3fda8..ff42f94 100644
--- a/tools/audit.ts
+++ b/tools/audit.ts
@@ -326,18 +326,32 @@ export async function detectAnomalies(projectId: string): Promise<AnomalyCheck[]
     }
   }
 
-  // 4. No progress entries in 7 days (active project)
-  const { count: recentProgress } = await supabase
-    .from('progress_entries')
-    .select('*', { count: 'exact', head: true })
-    .eq('project_id', projectId)
-    .gte('created_at', sevenDaysAgo);
-
-  if ((recentProgress ?? 0) === 0) {
+  // 4. No progress claimed in 7 days (active project). Since migration 104 a
+  // progress entry appears only when an estimator verifies a weekly claim, so
+  // site activity is claim lines created, a draft or returned claim edited, or
+  // a claim submitted in the window. Verification also touches lines and
+  // claims, so a VERIFIED claim counts only through its submitted_at. A read
+  // error (for example 104 not pasted yet) raises no anomaly rather than a
+  // false one.
+  const [recentLines, recentClaims] = await Promise.all([
+    supabase
+      .from('progress_claim_lines')
+      .select('id', { count: 'exact', head: true })
+      .eq('project_id', projectId)
+      .gte('created_at', sevenDaysAgo),
+    supabase
+      .from('progress_claims')
+      .select('id', { count: 'exact', head: true })
+      .eq('project_id', projectId)
+      .or(`submitted_at.gte.${sevenDaysAgo},and(status.in.(DRAFT,RETURNED),updated_at.gte.${sevenDaysAgo})`),
+  ]);
+  const claimActivityReadable = !recentLines.error && !recentClaims.error;
+
+  if (claimActivityReadable && (recentLines.count ?? 0) === 0 && (recentClaims.count ?? 0) === 0) {
     anomalies.push({
       type: 'no_progress',
       found: true,
-      description: 'Tidak ada entri progres dalam 7 hari terakhir',
+      description: 'Tidak ada klaim progres dalam 7 hari terakhir',
       entityId: projectId,
       severity: 'WARNING',
     });
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Run the suites that read progress**

Run: `npx jest tools/__tests__/derivation.test.ts tools/__tests__/progressMath.test.ts tools/__tests__/gateAudit.test.ts tools/__tests__/auditPivot.materialFanout.test.ts tools/__tests__/auditPivot.recipeSynthesis.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/derivation.ts tools/progressMath.ts tools/audit.ts docs/superpowers/specs/2026-09-13-report-driven-progress-design.md
git commit -m "refactor(progress): one writer of installed; audit reads claim activity; spec amendment 18"
```

---

### Task 21: Full verification and deploy hand-off

- [ ] **Step 1: Type-check the project**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 2: Run every suite this plan adds or touches**

Run: `npx jest tools/__tests__/boqWorkGroups.floor.test.ts tools/__tests__/envelopes.workgroup.test.ts tools/__tests__/workGroupDemand.test.ts tools/__tests__/progressClaimsWorkAreaClass.test.ts tools/__tests__/progressClaimsStageWeights.test.ts tools/__tests__/progressClaimsStageMath.test.ts tools/__tests__/progressClaimsReferenceWeights.test.ts tools/__tests__/progressClaimsWeek.test.ts tools/__tests__/progressClaimsRules.test.ts tools/__tests__/progressClaimsView.test.ts tools/__tests__/progressClaimsData.test.ts tools/__tests__/notificationRouting.test.ts tools/__tests__/migration103.test.ts tools/__tests__/migration096.test.ts tools/__tests__/migration104.test.ts tools/__tests__/migration098.test.ts tools/__tests__/migration099.test.ts tools/__tests__/migration100.test.ts tools/__tests__/migration101.test.ts workflows/components/__tests__/StoragePhoto.test.tsx workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx workflows/screens/components/__tests__/NotificationList.test.tsx workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx tools/__tests__/derivation.test.ts tools/__tests__/progressMath.test.ts tools/__tests__/gateAudit.test.ts tools/__tests__/auditPivot.materialFanout.test.ts tools/__tests__/auditPivot.recipeSynthesis.test.ts --testPathIgnorePatterns='/node_modules/'`
Expected: PASS, 31 suites, 530 tests.

- [ ] **Step 3: Rehearse the migrations and stop the container**

Run: `supabase/tests/progress_claims_rehearsal/run.sh --stop`
Expected: `PASS=153 FAIL=0 ERROR=0`.

- [ ] **Step 4: Bundle the web app** (CI never runs Metro; an import that only breaks the bundle fails first on Vercel)

Run: `npx expo export --platform web --output-dir /tmp/sano-web`
Expected: exit 0.

- [ ] **Step 5: Hand-off (the owner deploys; nothing here is pushed)**

1. Paste `102_client_report_lines.sql` if it is not live yet, and run its self-checks.
2. Paste `103_boq_stage_weights.sql`, then `104_progress_claims.sql`, in the Supabase Dashboard SQL editor, and run each file's SELF-CHECK block.
3. Merge to main only after step 2: Vercel deploys the web app from main, and the new screens call the 103/104 RPCs.
4. Build the Android APK from main. Supervisors on an older APK still see the quantity form; after step 2 its submit is refused by RLS (the live projects have zero progress entries, so nothing in use breaks).
5. As an estimator, open Baseline › Bobot Tahapan on each live project and apply or adjust the reference weights; supervisors' first claim screen also seeds missing rows.
6. Gading Serpong needs a published BoQ before anyone can claim on it.

