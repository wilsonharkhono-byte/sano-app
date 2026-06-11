# Review-Queue Grouping + Batch Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the "Perlu review" queue, group flagged rows by reason, batch Tolak/Setuju the orphan-block group from its header, and sub-group literal components by their parent recipe.

**Architecture:** A pure `tools/flagGroups.ts` buckets rows by `raw_data.flag_reason` and by `raw_data.blockTitle`. `BaselineScreen` extracts its per-card JSX into a `renderReviewCard` helper, then renders collapsible group sections calling it; a `handleBatchReview` reuses the existing `bulkReviewStagingRows`.

**Tech Stack:** TypeScript, ts-jest, React Native (Expo).

Spec: `docs/superpowers/specs/2026-06-11-review-queue-grouping-batch-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tools/flagGroups.ts` | Create | `groupReviewRows`, `subGroupByParentBlock`, `pendingRowIds`, `FLAG_GROUP_LABELS` |
| `tools/__tests__/flagGroups.test.ts` | Create | unit tests for the helpers |
| `workflows/screens/BaselineScreen.tsx` | Modify | extract `renderReviewCard`; grouped render + collapse + `handleBatchReview` |

Run the suite with `npx jest`.

---

## Task 1: `flagGroups` pure helpers

**Files:**
- Create: `tools/flagGroups.ts`
- Test: `tools/__tests__/flagGroups.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/flagGroups.test.ts`:

```ts
import { groupReviewRows, subGroupByParentBlock, pendingRowIds, FLAG_GROUP_LABELS } from '../flagGroups';
import type { ImportStagingRow } from '../types';

function row(partial: Partial<ImportStagingRow>): ImportStagingRow {
  return {
    id: Math.random().toString(36).slice(2), session_id: 's', row_number: 1, row_type: 'ahs',
    raw_data: {}, parsed_data: {}, confidence: 0.5, needs_review: true,
    review_status: 'PENDING', reviewer_notes: null, created_at: '',
    ...partial,
  } as ImportStagingRow;
}

describe('groupReviewRows', () => {
  it('buckets by flag_reason in fixed order, only orphan group is batchable', () => {
    const orphan = row({ row_type: 'ahs_block', raw_data: { flag_reason: 'orphan_ahs_block' } });
    const literal = row({ raw_data: { flag_reason: 'literal_component', blockTitle: 'Bekisting Balok' } });
    const groups = groupReviewRows([literal, orphan]); // input order shouldn't matter
    expect(groups.map(g => g.key)).toEqual(['orphan_ahs_block', 'literal_component']);
    expect(groups[0].batchable).toBe(true);
    expect(groups[1].batchable).toBe(false);
    expect(groups[0].label).toBe(FLAG_GROUP_LABELS.orphan_ahs_block);
  });

  it('omits empty groups and routes unknown/absent reasons to __other__', () => {
    const mystery = row({ raw_data: {} }); // flagged but no flag_reason
    const groups = groupReviewRows([mystery]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('__other__');
    expect(groups[0].batchable).toBe(false);
  });
});

describe('subGroupByParentBlock', () => {
  it('groups by blockTitle preserving first-appearance order, with counts', () => {
    const a1 = row({ raw_data: { blockTitle: 'Bekisting Balok' } });
    const b1 = row({ raw_data: { blockTitle: 'Pengecoran' } });
    const a2 = row({ raw_data: { blockTitle: 'Bekisting Balok' } });
    const subs = subGroupByParentBlock([a1, b1, a2]);
    expect(subs.map(s => s.title)).toEqual(['Bekisting Balok', 'Pengecoran']);
    expect(subs[0].rows).toHaveLength(2);
    expect(subs[1].rows).toHaveLength(1);
  });

  it('falls back to "Tanpa nama blok" when blockTitle is missing', () => {
    const subs = subGroupByParentBlock([row({ raw_data: {} })]);
    expect(subs[0].title).toBe('Tanpa nama blok');
  });
});

describe('pendingRowIds', () => {
  it('returns ids of only PENDING rows', () => {
    const p = row({ id: 'p', review_status: 'PENDING' });
    const a = row({ id: 'a', review_status: 'APPROVED' });
    expect(pendingRowIds([p, a])).toEqual(['p']);
  });
});
```

First confirm `ImportStagingRow` (in `tools/types.ts`) has the fields the factory uses; if it differs, adjust the factory (not the assertions). The sibling `tools/__tests__/flagExplanation.test.ts` has a working factory of the same shape to copy.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tools/__tests__/flagGroups`
Expected: FAIL — `Cannot find module '../flagGroups'`.

- [ ] **Step 3: Implement the helpers**

Create `tools/flagGroups.ts`:

```ts
import type { ImportStagingRow } from './types';

export interface ReviewGroup {
  key: string;
  label: string;
  rows: ImportStagingRow[];
  batchable: boolean;
}

export interface ParentBlockSubGroup {
  title: string;
  rows: ImportStagingRow[];
}

export const FLAG_GROUP_LABELS: Record<string, string> = {
  orphan_ahs_block: 'Blok harga tidak dipakai BoQ',
  literal_component: 'Komponen angka langsung (tanpa rumus)',
  __other__: 'Lainnya',
};

// Fixed top-level order; only `orphan_ahs_block` supports batch actions.
const GROUP_ORDER = ['orphan_ahs_block', 'literal_component', '__other__'] as const;
const BATCHABLE = new Set<string>(['orphan_ahs_block']);

function reasonKey(row: ImportStagingRow): string {
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const fr = raw.flag_reason;
  if (fr === 'orphan_ahs_block' || fr === 'literal_component') return fr;
  return '__other__';
}

/** Bucket flagged rows by flag_reason into ordered groups; empty groups omitted. */
export function groupReviewRows(rows: ImportStagingRow[]): ReviewGroup[] {
  const buckets: Record<string, ImportStagingRow[]> = {
    orphan_ahs_block: [],
    literal_component: [],
    __other__: [],
  };
  for (const r of rows) buckets[reasonKey(r)].push(r);
  return GROUP_ORDER.filter(k => buckets[k].length > 0).map(k => ({
    key: k,
    label: FLAG_GROUP_LABELS[k],
    rows: buckets[k],
    batchable: BATCHABLE.has(k),
  }));
}

/** Sub-group component rows by their parent AHS block title, order-preserving. */
export function subGroupByParentBlock(rows: ImportStagingRow[]): ParentBlockSubGroup[] {
  const order: string[] = [];
  const map = new Map<string, ImportStagingRow[]>();
  for (const r of rows) {
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    const title = typeof raw.blockTitle === 'string' && raw.blockTitle.length > 0
      ? raw.blockTitle
      : 'Tanpa nama blok';
    if (!map.has(title)) { map.set(title, []); order.push(title); }
    map.get(title)!.push(r);
  }
  return order.map(title => ({ title, rows: map.get(title)! }));
}

/** Ids of the rows still awaiting a decision (used as batch targets). */
export function pendingRowIds(rows: ImportStagingRow[]): string[] {
  return rows.filter(r => r.review_status === 'PENDING').map(r => r.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tools/__tests__/flagGroups`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add tools/flagGroups.ts tools/__tests__/flagGroups.test.ts
git commit -m "feat(boq): flagGroups helpers (group by reason, sub-group by parent block)"
```

---

## Task 2: Extract the per-card render into `renderReviewCard`

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` — the `visibleReviewRows.map(row => ( <Card key={row.id}> … </Card> ))` block (starts at ~line 1002)

This is a pure refactor (no behavior change) that makes Task 3's grouped render possible without duplicating ~90 lines of card JSX. There is no unit test for RN JSX; it is verified by tsc + the app rendering identically.

- [ ] **Step 1: Define the render helper**

In the component body, ABOVE the `return (` of the screen (a good spot is right after the `handlePublish`/handlers, near where `ahsBlockRows` is defined), add a function that wraps the EXISTING card JSX. Move the entire element currently inside the map — from `<Card key={row.id} borderColor={...}>` through its matching closing `</Card>` (this includes the inline koreksi editor block) — verbatim into the function body. Do not retype the JSX; move it:

```tsx
  const renderReviewCard = (row: ImportStagingRow) => (
    <Card key={row.id} borderColor={row.needs_review ? COLORS.warning : COLORS.border}>
      {/* …the existing card body, moved verbatim… */}
    </Card>
  );
```

- [ ] **Step 2: Replace the map call site**

Replace the old block:

```tsx
            {visibleReviewRows.map(row => (
              <Card key={row.id} borderColor={row.needs_review ? COLORS.warning : COLORS.border}>
                {/* …existing card body… */}
              </Card>
            ))}
```

with:

```tsx
            {visibleReviewRows.map(renderReviewCard)}
```

- [ ] **Step 3: Verify compile + no behavior change**

Run: `npx tsc --noEmit -p tsconfig.jest.json 2>&1 | grep -i "BaselineScreen" || echo "no BaselineScreen type errors"`
Expected: "no BaselineScreen type errors".
Run: `npx jest tools/__tests__/flagGroups tools/__tests__/flagExplanation`
Expected: green (sanity that nothing else broke).
Then run the app and confirm the review queue renders exactly as before (flat list, same cards).

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git commit -m "refactor(baseline): extract renderReviewCard from the review-queue map"
```

---

## Task 3: Grouped render + collapse + batch actions

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` — imports, new state + `handleBatchReview`, the render where `{visibleReviewRows.map(renderReviewCard)}` now sits (~line 1002), and styles

RN view; verified by running the app. The grouping/batch-target logic is covered by Task 1's unit tests.

- [ ] **Step 1: Import the helpers and confirm `Alert`**

Add to the imports at the top of `workflows/screens/BaselineScreen.tsx`:

```ts
import { groupReviewRows, subGroupByParentBlock, pendingRowIds } from '../../tools/flagGroups';
```

Confirm `Alert` is already imported from `react-native` (it is used elsewhere in this file for the publish-gate dialog). If not, add it to the `react-native` import.

- [ ] **Step 2: Add collapse state + the batch handler**

Near the other `useState`/handlers in the component (e.g. just after `handleBulkApproveClean`), add:

```tsx
  // Per-group collapse state. A group key absent here uses the size default
  // (>10 rows → collapsed) computed at render time.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const handleBatchReview = (ids: string[], status: 'APPROVED' | 'REJECTED') => {
    if (ids.length === 0) return;
    const verb = status === 'REJECTED' ? 'Tolak' : 'Setujui';
    Alert.alert(
      `${verb} ${ids.length} blok?`,
      'Tindakan ini bisa diubah lagi sebelum publish.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: verb,
          style: status === 'REJECTED' ? 'destructive' : 'default',
          onPress: async () => {
            const res = await bulkReviewStagingRows(ids, status);
            if (!res.success) { toast(`Gagal: ${res.error}`, 'critical'); return; }
            const idSet = new Set(ids);
            setStagingRows(prev => prev.map(r => (idSet.has(r.id) ? { ...r, review_status: status } : r)));
            toast(`${res.count} blok ${status === 'REJECTED' ? 'ditolak' : 'disetujui'}`,
              status === 'REJECTED' ? 'warning' : 'ok');
          },
        },
      ],
    );
  };
```

- [ ] **Step 3: Replace the flat map with grouped render (exceptions view only)**

Replace `{visibleReviewRows.map(renderReviewCard)}` with:

```tsx
            {reviewFilter === 'exceptions'
              ? groupReviewRows(visibleReviewRows).map(group => {
                  const pending = pendingRowIds(group.rows);
                  const isCollapsed = collapsedGroups[group.key] ?? group.rows.length > 10;
                  return (
                    <View key={group.key} style={styles.reviewGroup}>
                      <View style={styles.groupHeader}>
                        <TouchableOpacity
                          style={styles.groupHeaderMain}
                          onPress={() => setCollapsedGroups(c => ({ ...c, [group.key]: !isCollapsed }))}
                          accessibilityRole="button"
                        >
                          <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={16} color={COLORS.textSec} />
                          <Text style={styles.groupHeaderTitle}>{group.label} — {group.rows.length} baris</Text>
                        </TouchableOpacity>
                        {group.batchable && pending.length > 0 && (
                          <View style={styles.groupBatchBtns}>
                            <TouchableOpacity onPress={() => handleBatchReview(pending, 'REJECTED')} style={styles.groupBatchReject}>
                              <Text style={styles.groupBatchRejectText}>Tolak semua {pending.length}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleBatchReview(pending, 'APPROVED')} style={styles.groupBatchApprove}>
                              <Text style={styles.groupBatchApproveText}>Setujui semua {pending.length}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                      {!isCollapsed && (
                        group.key === 'literal_component'
                          ? subGroupByParentBlock(group.rows).map(sub => (
                              <View key={sub.title}>
                                <Text style={styles.subGroupHeader}>{sub.title} ({sub.rows.length})</Text>
                                {sub.rows.map(renderReviewCard)}
                              </View>
                            ))
                          : group.rows.map(renderReviewCard)
                      )}
                    </View>
                  );
                })
              : visibleReviewRows.map(renderReviewCard)}
```

- [ ] **Step 4: Add styles**

In `StyleSheet.create({ ... })`, add (verify token names against `workflows/theme.ts`; this file already uses `COLORS.warning`, `COLORS.ok`, `COLORS.critical`, `COLORS.text`, `COLORS.textSec`, `COLORS.textInverse`, `TYPE.sm`, `TYPE.xs`, `SPACE.sm`, `FONTS.semibold`):

```ts
  reviewGroup: { marginTop: SPACE.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACE.sm, gap: SPACE.sm },
  groupHeaderMain: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  groupHeaderTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, flexShrink: 1 },
  groupBatchBtns: { flexDirection: 'row', gap: 6 },
  groupBatchReject: { backgroundColor: COLORS.critical, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
  groupBatchRejectText: { fontSize: TYPE.xs, color: COLORS.textInverse, fontFamily: FONTS.semibold },
  groupBatchApprove: { backgroundColor: COLORS.ok, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
  groupBatchApproveText: { fontSize: TYPE.xs, color: COLORS.textInverse, fontFamily: FONTS.semibold },
  subGroupHeader: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.semibold, marginTop: SPACE.sm, marginBottom: 2 },
```

If `gap` is unsupported by the installed RN version, replace with marginRight on the inner items; if a token name differs, use the file's actual equivalent (mirror the existing `bulkApproveBtn`/`reviewFilterBtn` styles).

- [ ] **Step 5: Verify compile + helper tests + app**

Run: `npx tsc --noEmit -p tsconfig.jest.json 2>&1 | grep -i "BaselineScreen\|flagGroups" || echo "no type errors in touched files"`
Expected: "no type errors in touched files".
Run: `npx jest tools/__tests__/flagGroups`
Expected: green.
Then run the app, upload a workbook with flagged rows, and confirm: the orphan group header shows **[Tolak semua N] / [Setujui semua N]** and batch-rejects behind a confirm dialog; the literal group shows parent-block sub-headers; a group with >10 rows starts collapsed; "Semua" view is still flat.

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx
git commit -m "feat(baseline): group + batch the review queue, sub-group literals by parent block"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §3.1 grouping → Task 1 `groupReviewRows` + Task 3 render. §3.2 collapse (>10) → Task 3 `isCollapsed` default. §3.3 orphan batch + confirm → Task 3 `handleBatchReview` + header buttons. §3.4 literal parent-block sub-grouping → Task 1 `subGroupByParentBlock` + Task 3. §3.5 card reuse → Task 2 `renderReviewCard`. §3.6 batch handler (PENDING-only, optimistic, reuse bulk API) → Task 3. §5 testing → Task 1 unit tests + Task 3 app run. ✓
- **Type consistency:** `groupReviewRows`/`subGroupByParentBlock`/`pendingRowIds`/`FLAG_GROUP_LABELS` defined in Task 1 are imported and called with the same signatures in Task 3. `renderReviewCard(row)` defined in Task 2 is called in Task 3. ✓
- **Placeholder scan:** Task 2 intentionally moves existing JSX verbatim (a mechanical extraction, not omitted new code); every other code step shows full code. ✓
- **Risk:** nested touchables avoided — `groupHeaderMain` (collapse) and the batch buttons are siblings inside `groupHeader`, not nested. The orphan group is small enough (33) that the >10 default collapses it; batch buttons remain reachable on the collapsed header.
