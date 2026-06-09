# Review-Card "Why Flagged + What To Do" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each flagged BoQ-import review card, show *why* the row needs checking and *what* each action does (plain Indonesian + a soft suggestion), so the estimator can decide confidently.

**Architecture:** The parser stamps a `flag_reason` code into `raw_data` wherever it sets `needs_review` (orphan AHS block / literal AHS component). A pure helper `flagExplanation(row)` maps that code to `{ why, saran }` copy (generic-but-honest fallback for unknown reasons). `BaselineScreen` renders a callout for flagged rows plus static per-button action captions.

**Tech Stack:** TypeScript, ts-jest, React Native (Expo).

Spec: `docs/superpowers/specs/2026-06-08-review-card-why-flagged-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tools/boqParserV2/index.ts` | Modify (2 sites) | stamp `raw_data.flag_reason` when `needs_review` is set |
| `tools/boqParserV2/__tests__/flagReason.parser.test.ts` | Create | assert the stamped reasons |
| `tools/flagExplanation.ts` | Create | `flagExplanation(row)` + `ACTION_CAPTIONS` |
| `tools/__tests__/flagExplanation.test.ts` | Create | unit tests for the helper |
| `workflows/screens/BaselineScreen.tsx` | Modify | render callout + action captions |

Run the suite with `npx jest`.

---

## Task 1: Parser stamps `flag_reason`

**Files:**
- Modify: `tools/boqParserV2/index.ts` — `ahs_block` builder `raw_data` (~line 312) and `ahs` component builder `raw_data` (~line 372)
- Test: `tools/boqParserV2/__tests__/flagReason.parser.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tools/boqParserV2/__tests__/flagReason.parser.test.ts`:

```ts
import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('staging flag_reason', () => {
  it('stamps orphan_ahs_block on an orphan AHS block (not referenced by any BoQ)', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Lantai Kerja' },
          { address: 'B12', value: 'Semen PC' }, { address: 'C12', value: 'zak' },
          { address: 'D12', value: 'Semen PC' }, { address: 'E12', value: 65000 },
          { address: 'F12', value: 6825 },
          { address: 'B15', value: 'Jumlah' }, { address: 'F15', value: 6825 },
        ],
      },
    ]);
    const result = await parseBoqV2(wb);
    const block = result.stagingRows.find(r => r.row_type === 'ahs_block');
    expect(block!.needs_review).toBe(true);
    expect((block!.raw_data as any).flag_reason).toBe('orphan_ahs_block');
  });

  it('stamps literal_component on an AHS component whose price cell has no formula', async () => {
    const wb = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'B10', value: '1 m3 Lantai Kerja' },
          { address: 'B12', value: 'Semen PC' }, { address: 'C12', value: 'zak' },
          { address: 'D12', value: 'Semen PC' }, { address: 'E12', value: 65000 }, // literal price, no formula
          { address: 'F12', value: 6825 },
          { address: 'B15', value: 'Jumlah' }, { address: 'F15', value: 6825 },
        ],
      },
    ]);
    const result = await parseBoqV2(wb);
    const comp = result.stagingRows.find(r => r.row_type === 'ahs');
    expect(comp!.needs_review).toBe(true);
    expect((comp!.raw_data as any).flag_reason).toBe('literal_component');
  });
});
```

Note for the implementer: this fixture has no BoQ/RAB sheet, so the only AHS block is unreferenced → orphan, and the single component cell `E12` is a literal value (no `formula`) → `cost_basis: 'literal'`. If `parseBoqV2`'s result shape differs, adapt the access (the point is `raw_data.flag_reason`). Mirror the fixture style of `tools/boqParserV2/__tests__/sourceProvenance.parser.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest flagReason.parser`
Expected: FAIL — `flag_reason` is `undefined`.

- [ ] **Step 3: Stamp the `ahs_block` builder**

In `tools/boqParserV2/index.ts`, the `ahs_block` row's `raw_data` (currently ends with `source_cell: block.titleAddress,`) — add a `flag_reason` line so it reads:

```ts
      raw_data: {
        titleRow: block.titleRow,
        jumlahRow: block.jumlahRow,
        grandTotalAddress: block.grandTotalAddress,
        source_sheet: analisaSheet,
        source_row: block.titleRow,
        source_cell: block.titleAddress,
        flag_reason: linkedBoqCode == null ? 'orphan_ahs_block' : undefined,
      },
```

(`undefined` values are dropped when the row is serialized to JSONB, so non-orphan blocks carry no `flag_reason`. `linkedBoqCode` is already in scope — it's the same value used by `needs_review: linkedBoqCode == null` a few lines below.)

- [ ] **Step 4: Stamp the `ahs` component builder**

In the same file, the `ahs` component row's `raw_data` (currently ends with `source_cell: \`D${compRow}\`,`) — add:

```ts
        raw_data: {
          sourceRow: compRow,
          blockTitle: block.title,
          source_sheet: eCell.sheet,
          source_row: compRow,
          source_cell: `D${compRow}`,
          flag_reason: classification.cost_basis === 'literal' ? 'literal_component' : undefined,
        },
```

(`classification` is already in scope — it's the same value used by `needs_review: classification.cost_basis === 'literal'` below.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest flagReason.parser`
Expected: PASS (both tests).

- [ ] **Step 6: Run the parser suite for regressions**

Run: `npx jest tools/boqParserV2`
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add tools/boqParserV2/index.ts tools/boqParserV2/__tests__/flagReason.parser.test.ts
git commit -m "feat(boq-v2): stamp flag_reason (orphan_ahs_block / literal_component) into raw_data"
```

---

## Task 2: `flagExplanation` helper + action captions

**Files:**
- Create: `tools/flagExplanation.ts`
- Test: `tools/__tests__/flagExplanation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/flagExplanation.test.ts`:

```ts
import { flagExplanation, ACTION_CAPTIONS } from '../flagExplanation';
import type { ImportStagingRow } from '../types';

function row(partial: Partial<ImportStagingRow>): ImportStagingRow {
  return {
    id: 'id', session_id: 's', row_number: 1, row_type: 'ahs',
    raw_data: {}, parsed_data: {}, confidence: 0.5, needs_review: true,
    review_status: 'PENDING', reviewer_notes: null, created_at: '',
    ...partial,
  } as ImportStagingRow;
}

describe('flagExplanation', () => {
  it('returns null for a row that does not need review', () => {
    expect(flagExplanation(row({ needs_review: false }))).toBeNull();
  });

  it('explains an orphan AHS block', () => {
    const r = row({ row_type: 'ahs_block', raw_data: { flag_reason: 'orphan_ahs_block' } });
    const fx = flagExplanation(r);
    expect(fx).not.toBeNull();
    expect(fx!.why).toBe('Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.');
    expect(fx!.saran).toContain('Tolak jika ini template sisa');
  });

  it('explains a literal component', () => {
    const r = row({ raw_data: { flag_reason: 'literal_component' } });
    const fx = flagExplanation(r);
    expect(fx!.why).toBe('Komponen ini berisi angka langsung tanpa rumus, jadi parser tidak bisa memastikan asal biayanya.');
    expect(fx!.saran).toContain('Periksa angkanya');
  });

  it('falls back to a generic explanation when flagged but the reason is unknown/missing', () => {
    const fx = flagExplanation(row({ raw_data: {} }));
    expect(fx!.why).toBe('Baris ini ditandai untuk dicek manual.');
    expect(fx!.saran).toContain('Periksa nilainya');
  });

  it('exposes static action captions', () => {
    expect(ACTION_CAPTIONS.setuju).toBe('pakai apa adanya di baseline');
    expect(ACTION_CAPTIONS.tolak).toBe('buang dari baseline');
    expect(ACTION_CAPTIONS.koreksi).toBe('perbaiki dulu, lalu masuk');
  });
});
```

First confirm `ImportStagingRow` (in `tools/types.ts`) has the fields the factory uses; if it differs, adjust the factory (not the assertions).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/flagExplanation`
Expected: FAIL — `Cannot find module '../flagExplanation'`.

- [ ] **Step 3: Implement the helper**

Create `tools/flagExplanation.ts`:

```ts
import type { ImportStagingRow } from './types';

export interface FlagExplanation {
  why: string;
  saran: string;
}

// Keyed by the `flag_reason` codes the v2 parser stamps into raw_data.
const FLAG_COPY: Record<string, FlagExplanation> = {
  orphan_ahs_block: {
    why: 'Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.',
    saran: 'Tolak jika ini template sisa yang tidak dipakai; Koreksi & isi Kode BoQ jika seharusnya ada yang memakai.',
  },
  literal_component: {
    why: 'Komponen ini berisi angka langsung tanpa rumus, jadi parser tidak bisa memastikan asal biayanya.',
    saran: 'Periksa angkanya. Setuju jika sudah benar; Koreksi jika perlu diperbaiki.',
  },
};

// Shown when a row is flagged but carries no recognized reason (stale rows,
// or a future trigger that didn't stamp a code). Honest, never a wrong reason.
const GENERIC: FlagExplanation = {
  why: 'Baris ini ditandai untuk dicek manual.',
  saran: 'Periksa nilainya; Setuju jika benar, Koreksi jika perlu, Tolak jika tidak relevan.',
};

/**
 * Plain-Indonesian explanation of why a flagged review row needs checking and
 * a soft suggestion. Returns null for rows that don't need review (no callout).
 */
export function flagExplanation(row: ImportStagingRow): FlagExplanation | null {
  if (!row.needs_review) return null;
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const reason = raw.flag_reason;
  if (typeof reason === 'string' && reason in FLAG_COPY) return FLAG_COPY[reason];
  return GENERIC;
}

// Static, reason-independent captions for the three review actions.
export const ACTION_CAPTIONS = {
  setuju: 'pakai apa adanya di baseline',
  tolak: 'buang dari baseline',
  koreksi: 'perbaiki dulu, lalu masuk',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/__tests__/flagExplanation`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/flagExplanation.ts tools/__tests__/flagExplanation.test.ts
git commit -m "feat(boq): flagExplanation helper (why + saran) + action captions"
```

---

## Task 3: Render callout + action captions on the card

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` — import, card body (~line 1021-1023), action buttons (~line 1038-1054), styles

React Native view; verified by re-running the app (Step 5). The copy logic is covered by Task 2's unit tests.

- [ ] **Step 1: Import the helper**

Add near the other imports at the top of `workflows/screens/BaselineScreen.tsx`:

```ts
import { flagExplanation, ACTION_CAPTIONS } from '../../tools/flagExplanation';
```

- [ ] **Step 2: Render the callout between the header and the parsed-data preview**

In the `visibleReviewRows.map` card, immediately AFTER the closing `</View>` of the `styles.rowHeader` block (the line right before the `{/* Show parsed data summary */}` comment) and BEFORE that comment, insert:

```tsx
                {(() => {
                  const fx = flagExplanation(row);
                  return fx ? (
                    <View style={styles.flagCallout}>
                      <Text style={styles.flagWhy}>❓ Kenapa dicek: {fx.why}</Text>
                      <Text style={styles.flagSaran}>💡 Saran: {fx.saran}</Text>
                    </View>
                  ) : null;
                })()}
```

- [ ] **Step 3: Add a caption under each action button**

In the `Review actions` block, add a caption `Text` directly under each button's label. The three buttons currently each contain a single `<Text style={styles.reviewBtnText}>Setuju|Tolak|Koreksi</Text>`. Add a second line in each:

```tsx
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.ok }]}
                      onPress={() => handleReviewRow(row.id, 'APPROVED')}
                    >
                      <Text style={styles.reviewBtnText}>Setuju</Text>
                      <Text style={styles.reviewBtnCaption}>{ACTION_CAPTIONS.setuju}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.critical }]}
                      onPress={() => handleReviewRow(row.id, 'REJECTED')}
                    >
                      <Text style={styles.reviewBtnText}>Tolak</Text>
                      <Text style={styles.reviewBtnCaption}>{ACTION_CAPTIONS.tolak}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.warning }]}
                      onPress={() => startRowCorrection(row)}
                    >
                      <Text style={styles.reviewBtnText}>Koreksi</Text>
                      <Text style={styles.reviewBtnCaption}>{ACTION_CAPTIONS.koreksi}</Text>
                    </TouchableOpacity>
```

(Keep the existing `onPress`, `style`, and label text exactly; only ADD the caption `Text` line in each of the three buttons.)

- [ ] **Step 4: Add the styles**

In this screen's `StyleSheet.create({ ... })`, add four styles. Mirror the existing callout/banner styling already in the file (search for `anomalyBanner` and reuse its color tokens). Use the file's real tokens — verify `COLORS.warning`, `COLORS.text`, `COLORS.textSec`, and the `TYPE` sizes exist in `workflows/theme.ts` and adjust names if needed:

```ts
  flagCallout: {
    backgroundColor: COLORS.surface,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  flagWhy: { fontSize: TYPE.sm, color: COLORS.text },
  flagSaran: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  reviewBtnCaption: { fontSize: 10, color: '#FFFFFF', opacity: 0.85, textAlign: 'center', marginTop: 2 },
```

If `COLORS.surface` is not a token in this file's theme, use the same background the `anomalyBanner` style uses (or another light neutral token that exists). The caption text is white because the buttons have colored backgrounds (`COLORS.ok` / `COLORS.critical` / `COLORS.warning`).

- [ ] **Step 5: Verify it compiles + helper tests still pass**

Run: `npx tsc --noEmit -p tsconfig.jest.json 2>&1 | grep -i "BaselineScreen\|flagExplanation" || echo "no BaselineScreen/flagExplanation type errors"`
Expected: no errors referencing these files. (Pre-existing unrelated errors elsewhere, e.g. `workflows/App.tsx`, may appear — ignore.)
Run: `npx jest tools/__tests__/flagExplanation`
Expected: 5/5 pass.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git commit -m "feat(baseline): show why-flagged callout + action captions on review cards"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Part 1 (stamp `flag_reason`) → Task 1. Part 2 (`flagExplanation` + generic fallback + `ACTION_CAPTIONS`) → Task 2. Part 3 (callout + captions render) → Task 3. Copy table (Section 5) → the `FLAG_COPY`/`GENERIC`/`ACTION_CAPTIONS` literals in Task 2, asserted in its tests. Truth-correctness (generic, never-wrong fallback) → Task 2 Step 3 + test. ✓
- **Type consistency:** `flag_reason` codes stamped in Task 1 (`'orphan_ahs_block'`, `'literal_component'`) are the exact keys of `FLAG_COPY` in Task 2 and the values asserted in both test files. `flagExplanation` / `ACTION_CAPTIONS` defined in Task 2 are imported and used in Task 3. ✓
- **Placeholder scan:** no TBD/TODO; every code step shows full code. ✓
- **Risk note:** the callout renders only for `needs_review` rows (clean rows hidden by the exceptions filter), so it adds no clutter to approved rows. Action captions add height to the three buttons — acceptable; verify legibility in Step 5's app run.
