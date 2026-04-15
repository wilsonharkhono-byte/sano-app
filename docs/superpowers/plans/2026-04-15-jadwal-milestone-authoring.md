# Jadwal & Milestone Authoring Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoring foundation for project milestones — schema (DAG, AI provenance, soft-delete), manual form, AI draft-assist (Claude Sonnet 4.6), BoQ picker, and MilestoneScreen integration — so estimators can create, edit, link, and depend milestones in `Laporan → Jadwal`.

**Architecture:** Additive `milestones` columns (`depends_on uuid[]`, `proposed_by`, `confidence_score`, `ai_explanation`, `author_status`, `deleted_at`), pure graph utilities (topo sort, cycle detection) in `tools/schedule.ts`, CRUD RPCs (`createMilestone`, `updateMilestone`, `deleteMilestone`, `createMilestonesBulk`), a new Supabase edge function `ai-draft-milestones` pinned to `claude-sonnet-4-6`, three new screens (`MilestoneFormScreen`, `MilestoneAiDraftScreen`, `MilestoneAiReviewScreen`), and one new component (`BoqPickerSheet`). Existing `reviseMilestone` + `milestone_revisions` stay as-is for post-commit slips.

**Tech Stack:** React Native (Expo), TypeScript, Supabase (Postgres + Edge Functions running Deno), Jest for unit/integration tests, Anthropic Claude API (Sonnet 4.6).

**Spec:** [docs/superpowers/specs/2026-04-15-jadwal-milestone-authoring-design.md](../specs/2026-04-15-jadwal-milestone-authoring-design.md)

---

## How to read this plan

- **Phases** are logical groups. Commit and push between phases.
- **Tasks** are independent units of work. Each task ends with a commit.
- **Steps** within a task are 2–5 minute actions — write a test, run it, implement, verify, commit.
- **TDD is mandatory** for all pure utilities and RPCs in Phase 1, for edge function validation in Phase 7. For React screens (Phases 3–6), write tests only for pure logic extracted from components; the rendering itself is verified by manual QA at the phase boundary.

## Phase overview

1. **Phase 1 — Data Foundation** (Tasks 1–10): migration, types, pure utilities, CRUD RPCs, add soft-delete filter to existing reads.
2. **Phase 2 — Hook split** (Task 11): `useProject` returns `milestones` (confirmed) and `milestoneDrafts` separately.
3. **Phase 3 — BoQ Picker** (Task 12): reusable `BoqPickerSheet` component.
4. **Phase 4 — Manual Authoring** (Tasks 13–15): `MilestoneFormScreen` create / edit / delete.
5. **Phase 5 — MilestoneScreen updates** (Tasks 16–19): entry row, baseline gate, topo sort, chips, AI badge, per-card actions, draft banner.
6. **Phase 6 — Cross-screen wiring** (Tasks 20–21): `LaporanScreen` takeover routing, `BaselineScreen` Atur Jadwal shortcut.
7. **Phase 7 — AI draft-assist** (Tasks 22–25): edge function + parameters screen + review screen.
8. **Phase 8 — Polish** (Tasks 26–28): stale BoQ banner, abandoned draft cleanup, activity log entries.

---

# Phase 1 — Data Foundation

## Task 1: Database migration — milestones columns, indexes, ai_draft_runs

**Files:**
- Create: `supabase/migrations/029_jadwal_authoring.sql`

- [ ] **Step 1: Create the migration file**

Write `supabase/migrations/029_jadwal_authoring.sql`:

```sql
-- 029_jadwal_authoring.sql
-- Spec: docs/superpowers/specs/2026-04-15-jadwal-milestone-authoring-design.md §4 + §10

-- ── milestones: additive columns ─────────────────────────────────────
ALTER TABLE milestones
  ADD COLUMN IF NOT EXISTS depends_on uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT 'human'
    CHECK (proposed_by IN ('human', 'ai')),
  ADD COLUMN IF NOT EXISTS confidence_score numeric(4,3)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  ADD COLUMN IF NOT EXISTS ai_explanation text,
  ADD COLUMN IF NOT EXISTS author_status text NOT NULL DEFAULT 'confirmed'
    CHECK (author_status IN ('draft', 'confirmed')),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── indexes for the new columns ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS milestones_depends_on_gin
  ON milestones USING GIN (depends_on);

CREATE INDEX IF NOT EXISTS milestones_project_status_active
  ON milestones (project_id, author_status)
  WHERE deleted_at IS NULL;

-- ── ai_draft_runs: audit table for AI draft-assist ───────────────────
CREATE TABLE IF NOT EXISTS ai_draft_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parameters jsonb NOT NULL,
  prompt_hash text NOT NULL,
  response_summary jsonb NOT NULL,
  committed_milestone_ids uuid[],
  model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_draft_runs_project_user_recent
  ON ai_draft_runs (project_id, user_id, created_at DESC);

-- ── RLS for ai_draft_runs ────────────────────────────────────────────
ALTER TABLE ai_draft_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_draft_runs_project_read
  ON ai_draft_runs
  FOR SELECT
  USING (
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

CREATE POLICY ai_draft_runs_insert
  ON ai_draft_runs
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    project_id IN (
      SELECT project_id FROM project_assignments WHERE user_id = auth.uid()
    )
  );

CREATE POLICY ai_draft_runs_update
  ON ai_draft_runs
  FOR UPDATE
  USING (user_id = auth.uid());
```

- [ ] **Step 2: Apply the migration locally**

Run:
```bash
supabase db reset
# OR if you want to preserve data:
supabase db push
```
Expected: migration applies cleanly, no errors. Verify with:
```bash
supabase db diff --schema public
```
Should report no differences after apply.

- [ ] **Step 3: Sanity-check in psql**

```bash
supabase db execute --sql "\\d milestones"
```
Expected columns present: `depends_on`, `proposed_by`, `confidence_score`, `ai_explanation`, `author_status`, `deleted_at`. Run:
```bash
supabase db execute --sql "\\d ai_draft_runs"
```
Expected: table exists with 9 columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/029_jadwal_authoring.sql
git commit -m "feat(db): add jadwal authoring columns + ai_draft_runs table"
```

---

## Task 2: Extend `Milestone` type

**Files:**
- Modify: `tools/types.ts:199-210`

- [ ] **Step 1: Update `Milestone` interface**

Replace the block at `tools/types.ts:199-210` with:

```ts
export interface Milestone {
  id: string;
  project_id: string;
  label: string;
  planned_date: string;
  revised_date: string | null;
  revision_reason: string | null;
  boq_ids: string[];
  status: MilestoneStatus;

  // ── Authoring fields (spec §4) ─────────────────────────────────
  depends_on: string[];
  proposed_by: 'human' | 'ai';
  confidence_score: number | null;
  ai_explanation: string | null;
  author_status: 'draft' | 'confirmed';
  deleted_at: string | null;
}

export type MilestoneStatus = 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'AHEAD' | 'COMPLETE';

export interface CreateMilestoneInput {
  project_id: string;
  label: string;
  planned_date: string;
  boq_ids: string[];
  depends_on: string[];
  proposed_by?: 'human' | 'ai';
  confidence_score?: number | null;
  ai_explanation?: string | null;
  author_status?: 'draft' | 'confirmed';
}

export interface UpdateMilestoneInput {
  label?: string;
  planned_date?: string;
  boq_ids?: string[];
  depends_on?: string[];
  author_status?: 'draft' | 'confirmed';
}
```

- [ ] **Step 2: Run the TypeScript compiler to catch call-site breakage**

Run:
```bash
npx tsc --noEmit
```
Expected: errors will surface in any place that constructs a `Milestone` literal or reads `.depends_on` (which doesn't exist yet). List them; the existing callers should only read fields they already know, so there should be **no new errors**. If there are, fix by adding the new fields to literals as needed (e.g., test fixtures).

- [ ] **Step 3: Commit**

```bash
git add tools/types.ts
git commit -m "feat(types): extend Milestone with authoring + dependency fields"
```

---

## Task 3: `topologicalSort` utility (TDD)

**Files:**
- Create: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Write the failing tests for `topologicalSort`**

Create `tools/__tests__/schedule.test.ts`:

```ts
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { topologicalSort, validateNoCycle, validatePlannedDate, cascadeCleanupDependsOn } from '../schedule';
import type { Milestone } from '../types';

const mk = (id: string, depends_on: string[] = [], planned_date = '2026-06-01'): Milestone => ({
  id,
  project_id: 'p1',
  label: `M-${id}`,
  planned_date,
  revised_date: null,
  revision_reason: null,
  boq_ids: [],
  status: 'ON_TRACK',
  depends_on,
  proposed_by: 'human',
  confidence_score: null,
  ai_explanation: null,
  author_status: 'confirmed',
  deleted_at: null,
});

describe('topologicalSort', () => {
  it('returns empty for empty input', () => {
    expect(topologicalSort([])).toEqual([]);
  });

  it('returns single node unchanged', () => {
    const ms = [mk('a')];
    expect(topologicalSort(ms).map(m => m.id)).toEqual(['a']);
  });

  it('sorts a linear chain a → b → c', () => {
    const ms = [mk('c', ['b']), mk('b', ['a']), mk('a')];
    expect(topologicalSort(ms).map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('respects parallel branches sorted by planned_date tie-break', () => {
    const ms = [
      mk('a', [], '2026-06-01'),
      mk('b', ['a'], '2026-06-10'),
      mk('c', ['a'], '2026-06-05'),
    ];
    const ids = topologicalSort(ms).map(m => m.id);
    expect(ids[0]).toBe('a');
    expect(ids.slice(1)).toEqual(['c', 'b']); // c earlier than b
  });

  it('handles diamond dependency a → (b, c) → d', () => {
    const ms = [
      mk('d', ['b', 'c']),
      mk('c', ['a']),
      mk('b', ['a']),
      mk('a'),
    ];
    const ids = topologicalSort(ms).map(m => m.id);
    expect(ids[0]).toBe('a');
    expect(ids[3]).toBe('d');
    expect(ids.slice(1, 3).sort()).toEqual(['b', 'c']);
  });

  it('falls back to date order on cycle detection', () => {
    const ms = [
      mk('a', ['b'], '2026-06-01'),
      mk('b', ['a'], '2026-06-10'),
    ];
    // Should not throw; should return all input nodes.
    const result = topologicalSort(ms);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.id)).toEqual(['a', 'b']); // date order
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tools/__tests__/schedule.test.ts
```
Expected: `topologicalSort is not a function` (or TypeScript compile error).

- [ ] **Step 3: Implement `topologicalSort` in `tools/schedule.ts`**

Append at the bottom of `tools/schedule.ts` (after the existing exports):

```ts
// ── Graph Utilities (spec §4) ────────────────────────────────────────

/**
 * Kahn's algorithm topological sort over `depends_on` edges.
 * Tie-breaks by planned_date ascending.
 * On cycle detection, logs a warning and returns input in date order.
 */
export function topologicalSort(milestones: Milestone[]): Milestone[] {
  if (milestones.length === 0) return [];

  const byId = new Map(milestones.map(m => [m.id, m]));
  const inDegree = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const m of milestones) {
    inDegree.set(m.id, 0);
    successors.set(m.id, []);
  }

  for (const m of milestones) {
    for (const predId of m.depends_on) {
      if (!byId.has(predId)) continue; // ignore dangling edge
      inDegree.set(m.id, (inDegree.get(m.id) ?? 0) + 1);
      successors.get(predId)!.push(m.id);
    }
  }

  const cmp = (a: Milestone, b: Milestone) =>
    a.planned_date.localeCompare(b.planned_date);

  const ready: Milestone[] = milestones
    .filter(m => (inDegree.get(m.id) ?? 0) === 0)
    .sort(cmp);

  const out: Milestone[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    out.push(next);
    for (const succId of successors.get(next.id) ?? []) {
      const d = (inDegree.get(succId) ?? 0) - 1;
      inDegree.set(succId, d);
      if (d === 0) {
        const succ = byId.get(succId)!;
        // insert sorted
        const idx = ready.findIndex(r => cmp(succ, r) < 0);
        if (idx < 0) ready.push(succ);
        else ready.splice(idx, 0, succ);
      }
    }
  }

  if (out.length !== milestones.length) {
    console.warn('topologicalSort: cycle detected, falling back to date order');
    return [...milestones].sort(cmp);
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts -t topologicalSort
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): topologicalSort utility with cycle fallback"
```

---

## Task 4: `validateNoCycle` utility (TDD)

**Files:**
- Modify: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add failing tests**

Append to `tools/__tests__/schedule.test.ts`:

```ts
describe('validateNoCycle', () => {
  it('passes for empty graph', () => {
    expect(validateNoCycle([], mk('new'))).toBe(true);
  });

  it('passes for new milestone with no dependencies', () => {
    const existing = [mk('a')];
    expect(validateNoCycle(existing, mk('new'))).toBe(true);
  });

  it('rejects self-reference', () => {
    const existing = [mk('a')];
    const updated = mk('a', ['a']);
    expect(validateNoCycle(existing, updated)).toBe(false);
  });

  it('rejects 2-cycle a → b → a', () => {
    const existing = [mk('b', ['a'])];
    const updated = mk('a', ['b']);
    expect(validateNoCycle(existing, updated)).toBe(false);
  });

  it('rejects 3-cycle a → b → c → a', () => {
    const existing = [mk('b', ['a']), mk('c', ['b'])];
    const updated = mk('a', ['c']);
    expect(validateNoCycle(existing, updated)).toBe(false);
  });

  it('accepts edit that does not create a cycle', () => {
    const existing = [mk('a'), mk('b', ['a'])];
    const updated = mk('c', ['b']);
    expect(validateNoCycle(existing, updated)).toBe(true);
  });

  it('detects transitive cycle through multiple hops', () => {
    const existing = [
      mk('b', ['a']),
      mk('c', ['b']),
      mk('d', ['c']),
    ];
    const updated = mk('a', ['d']);
    expect(validateNoCycle(existing, updated)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tools/__tests__/schedule.test.ts -t validateNoCycle
```
Expected: all 7 tests fail with `validateNoCycle is not a function`.

- [ ] **Step 3: Implement `validateNoCycle`**

Append to `tools/schedule.ts`:

```ts
/**
 * Returns true iff the projected post-edit graph (existing + updated) has no cycle.
 * DFS-based. The updated milestone replaces any existing entry with the same id,
 * or is appended if new.
 */
export function validateNoCycle(existing: Milestone[], updated: Milestone): boolean {
  const projected: Milestone[] = existing
    .filter(m => m.id !== updated.id)
    .concat(updated);

  const byId = new Map(projected.map(m => [m.id, m]));

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const m of projected) color.set(m.id, WHITE);

  const visit = (id: string): boolean => {
    if (color.get(id) === GRAY) return false; // back-edge ⇒ cycle
    if (color.get(id) === BLACK) return true;
    color.set(id, GRAY);
    const node = byId.get(id);
    if (node) {
      for (const predId of node.depends_on) {
        if (predId === id) return false; // self-loop
        if (!byId.has(predId)) continue; // dangling
        if (!visit(predId)) return false;
      }
    }
    color.set(id, BLACK);
    return true;
  };

  for (const m of projected) {
    if (!visit(m.id)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts -t validateNoCycle
```
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): validateNoCycle DFS utility"
```

---

## Task 5: `validatePlannedDate` and `cascadeCleanupDependsOn` utilities (TDD)

**Files:**
- Modify: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add failing tests**

Append to `tools/__tests__/schedule.test.ts`:

```ts
describe('validatePlannedDate', () => {
  it('passes when no predecessors', () => {
    const result = validatePlannedDate([], [], '2026-06-01');
    expect(result.ok).toBe(true);
  });

  it('passes when date is after all predecessors', () => {
    const all = [mk('a', [], '2026-06-01'), mk('b', [], '2026-06-05')];
    const result = validatePlannedDate(all, ['a', 'b'], '2026-06-10');
    expect(result.ok).toBe(true);
  });

  it('passes when date equals max predecessor date', () => {
    const all = [mk('a', [], '2026-06-05')];
    const result = validatePlannedDate(all, ['a'], '2026-06-05');
    expect(result.ok).toBe(true);
  });

  it('rejects when date is before any predecessor', () => {
    const all = [mk('a', [], '2026-06-10')];
    const result = validatePlannedDate(all, ['a'], '2026-06-05');
    expect(result.ok).toBe(false);
    expect(result.conflictMilestoneId).toBe('a');
  });

  it('ignores predecessor IDs not found in graph', () => {
    const result = validatePlannedDate([], ['missing'], '2026-06-01');
    expect(result.ok).toBe(true);
  });
});

describe('cascadeCleanupDependsOn', () => {
  it('returns empty list when nothing depends on deleted id', () => {
    const all = [mk('a'), mk('b')];
    const patches = cascadeCleanupDependsOn(all, 'c');
    expect(patches).toEqual([]);
  });

  it('returns patches that remove deleted id from direct dependents', () => {
    const all = [mk('a'), mk('b', ['a']), mk('c', ['a', 'x'])];
    const patches = cascadeCleanupDependsOn(all, 'a');
    expect(patches).toEqual([
      { id: 'b', depends_on: [] },
      { id: 'c', depends_on: ['x'] },
    ]);
  });

  it('does not affect transitive descendants', () => {
    const all = [mk('a'), mk('b', ['a']), mk('c', ['b'])];
    const patches = cascadeCleanupDependsOn(all, 'a');
    expect(patches).toEqual([{ id: 'b', depends_on: [] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tools/__tests__/schedule.test.ts -t "validatePlannedDate|cascadeCleanupDependsOn"
```
Expected: all 8 tests fail (function not exported).

- [ ] **Step 3: Implement both utilities**

Append to `tools/schedule.ts`:

```ts
export interface PlannedDateValidation {
  ok: boolean;
  conflictMilestoneId?: string;
  conflictDate?: string;
}

/**
 * A milestone's planned_date must be ≥ max(planned_date of its predecessors).
 * Dangling predecessor IDs are ignored.
 */
export function validatePlannedDate(
  all: Milestone[],
  dependsOn: string[],
  plannedDate: string,
): PlannedDateValidation {
  const byId = new Map(all.map(m => [m.id, m]));
  for (const predId of dependsOn) {
    const pred = byId.get(predId);
    if (!pred) continue;
    const predDate = pred.revised_date ?? pred.planned_date;
    if (plannedDate < predDate) {
      return {
        ok: false,
        conflictMilestoneId: predId,
        conflictDate: predDate,
      };
    }
  }
  return { ok: true };
}

/**
 * When milestone `deletedId` is soft-deleted, every other milestone that has
 * it in `depends_on` needs to have that reference removed. Returns the patches
 * to apply. Transitive descendants are NOT updated here — they keep their
 * other predecessors unchanged.
 */
export function cascadeCleanupDependsOn(
  all: Milestone[],
  deletedId: string,
): Array<{ id: string; depends_on: string[] }> {
  return all
    .filter(m => m.id !== deletedId && m.depends_on.includes(deletedId))
    .map(m => ({
      id: m.id,
      depends_on: m.depends_on.filter(d => d !== deletedId),
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts
```
Expected: all tests in the file pass (21 tests total across the four describe blocks).

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): validatePlannedDate + cascadeCleanupDependsOn"
```

---

## Task 6: `createMilestone` RPC (TDD)

**Files:**
- Modify: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add failing tests with mocked supabase**

Append to `tools/__tests__/schedule.test.ts`:

```ts
import { createMilestone } from '../schedule';
import { supabase } from '../supabase';

describe('createMilestone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validInput = {
    project_id: 'p1',
    label: 'Pondasi',
    planned_date: '2026-06-15',
    boq_ids: ['b1'],
    depends_on: [] as string[],
  };

  const mockFromChain = (opts: {
    selectResult?: { data: any; error: any };
    insertResult?: { data: any; error: any };
  }) => {
    const insertChain = {
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue(
          opts.insertResult ?? { data: null, error: null },
        ),
      }),
    };
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          is: jest.fn().mockResolvedValue(
            opts.selectResult ?? { data: [], error: null },
          ),
        }),
      }),
      insert: jest.fn().mockReturnValue(insertChain),
    };
  };

  it('rejects empty label', async () => {
    const result = await createMilestone({ ...validInput, label: '  ' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nama/i);
  });

  it('rejects duplicate label within project (case-insensitive)', async () => {
    (supabase.from as jest.Mock).mockReturnValue(
      mockFromChain({
        selectResult: {
          data: [{ id: 'existing', label: 'Pondasi' }],
          error: null,
        },
      }),
    );

    const result = await createMilestone(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/sudah ada/i);
  });

  it('rejects when planned_date is before a predecessor', async () => {
    (supabase.from as jest.Mock).mockReturnValue(
      mockFromChain({
        selectResult: {
          data: [{
            id: 'pre',
            project_id: 'p1',
            label: 'Previous',
            planned_date: '2026-07-01',
            revised_date: null,
            depends_on: [],
            author_status: 'confirmed',
            deleted_at: null,
            boq_ids: [],
            status: 'ON_TRACK',
            revision_reason: null,
            proposed_by: 'human',
            confidence_score: null,
            ai_explanation: null,
          }],
          error: null,
        },
      }),
    );

    const result = await createMilestone({
      ...validInput,
      depends_on: ['pre'],
      planned_date: '2026-06-15',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tanggal/i);
  });

  it('inserts on happy path and returns the new milestone', async () => {
    const newRow = {
      id: 'new1',
      project_id: 'p1',
      label: 'Pondasi',
      planned_date: '2026-06-15',
      revised_date: null,
      revision_reason: null,
      boq_ids: ['b1'],
      status: 'ON_TRACK',
      depends_on: [],
      proposed_by: 'human',
      confidence_score: null,
      ai_explanation: null,
      author_status: 'confirmed',
      deleted_at: null,
    };
    (supabase.from as jest.Mock).mockReturnValue(
      mockFromChain({
        selectResult: { data: [], error: null },
        insertResult: { data: newRow, error: null },
      }),
    );

    const result = await createMilestone(validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('new1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tools/__tests__/schedule.test.ts -t createMilestone
```
Expected: all 4 tests fail (function not exported).

- [ ] **Step 3: Implement `createMilestone`**

Append to `tools/schedule.ts`:

```ts
// ── Result type (spec §4) ────────────────────────────────────────────

export type MilestoneResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── createMilestone ──────────────────────────────────────────────────

import type { CreateMilestoneInput, UpdateMilestoneInput } from './types';

export async function createMilestone(
  input: CreateMilestoneInput,
): Promise<MilestoneResult<Milestone>> {
  // 1. Validate label
  const label = input.label.trim();
  if (!label) {
    return { success: false, error: 'Nama milestone wajib diisi.' };
  }

  // 2. Fetch existing project milestones (for uniqueness + cycle + date checks)
  const { data: existing, error: fetchErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', input.project_id)
    .is('deleted_at', null);

  if (fetchErr) return { success: false, error: fetchErr.message };
  const existingRows: Milestone[] = existing ?? [];

  // 3. Uniqueness (case-insensitive)
  const clash = existingRows.find(
    m => m.label.trim().toLowerCase() === label.toLowerCase(),
  );
  if (clash) {
    return { success: false, error: `Milestone "${label}" sudah ada di proyek ini.` };
  }

  // 4. Predecessor project scoping
  for (const predId of input.depends_on) {
    if (!existingRows.some(m => m.id === predId)) {
      return { success: false, error: 'Predecessor milestone tidak ditemukan di proyek ini.' };
    }
  }

  // 5. Planned-date vs predecessors
  const dateCheck = validatePlannedDate(existingRows, input.depends_on, input.planned_date);
  if (!dateCheck.ok) {
    const conflict = existingRows.find(m => m.id === dateCheck.conflictMilestoneId);
    return {
      success: false,
      error: `Target tanggal harus ≥ ${dateCheck.conflictDate} (milestone "${conflict?.label ?? dateCheck.conflictMilestoneId}").`,
    };
  }

  // 6. Cycle check against a synthetic projected graph
  const synthetic: Milestone = {
    id: '__new__',
    project_id: input.project_id,
    label,
    planned_date: input.planned_date,
    revised_date: null,
    revision_reason: null,
    boq_ids: input.boq_ids,
    status: 'ON_TRACK',
    depends_on: input.depends_on,
    proposed_by: input.proposed_by ?? 'human',
    confidence_score: input.confidence_score ?? null,
    ai_explanation: input.ai_explanation ?? null,
    author_status: input.author_status ?? 'confirmed',
    deleted_at: null,
  };
  if (!validateNoCycle(existingRows, synthetic)) {
    return { success: false, error: 'Milestone ini akan membuat siklus dependensi.' };
  }

  // 7. Insert
  const { data: inserted, error: insertErr } = await supabase
    .from('milestones')
    .insert({
      project_id: input.project_id,
      label,
      planned_date: input.planned_date,
      boq_ids: input.boq_ids,
      depends_on: input.depends_on,
      proposed_by: input.proposed_by ?? 'human',
      confidence_score: input.confidence_score ?? null,
      ai_explanation: input.ai_explanation ?? null,
      author_status: input.author_status ?? 'confirmed',
      status: 'ON_TRACK',
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    return { success: false, error: insertErr?.message ?? 'Gagal membuat milestone.' };
  }

  return { success: true, data: inserted as Milestone };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts -t createMilestone
```
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): createMilestone RPC with validation pipeline"
```

---

## Task 7: `updateMilestone` RPC (TDD)

**Files:**
- Modify: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add failing tests**

Append to `tools/__tests__/schedule.test.ts`:

```ts
import { updateMilestone } from '../schedule';

describe('updateMilestone', () => {
  beforeEach(() => jest.clearAllMocks());

  const existingRow = {
    id: 'm1',
    project_id: 'p1',
    label: 'Pondasi',
    planned_date: '2026-06-15',
    revised_date: null,
    revision_reason: null,
    boq_ids: ['b1'],
    status: 'ON_TRACK' as const,
    depends_on: [] as string[],
    proposed_by: 'human' as const,
    confidence_score: null,
    ai_explanation: null,
    author_status: 'confirmed' as const,
    deleted_at: null,
  };

  const mockExistingFetch = (row: any) => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockImplementation((col: string, val: string) => {
          // first call: fetch by id (.eq('id', id).single())
          if (col === 'id') {
            return {
              single: jest.fn().mockResolvedValue({ data: row, error: null }),
              is: jest.fn().mockResolvedValue({ data: [row], error: null }),
            };
          }
          // second call: fetch siblings (.eq('project_id', pid).is('deleted_at', null))
          return {
            is: jest.fn().mockResolvedValue({ data: [row], error: null }),
          };
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { ...row, label: 'New Label' }, error: null }),
          }),
        }),
      }),
    }));
  };

  it('returns error if milestone not found', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }));
    const result = await updateMilestone('missing', { label: 'X' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tidak ditemukan/i);
  });

  it('patches label on happy path', async () => {
    mockExistingFetch(existingRow);
    const result = await updateMilestone('m1', { label: 'New Label' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.label).toBe('New Label');
  });

  it('rejects self-loop in depends_on', async () => {
    mockExistingFetch(existingRow);
    const result = await updateMilestone('m1', { depends_on: ['m1'] });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/siklus/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tools/__tests__/schedule.test.ts -t updateMilestone
```
Expected: 3 failing tests.

- [ ] **Step 3: Implement `updateMilestone`**

Append to `tools/schedule.ts`:

```ts
export async function updateMilestone(
  id: string,
  patch: UpdateMilestoneInput,
): Promise<MilestoneResult<Milestone>> {
  // 1. Load existing
  const { data: existing, error: loadErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', id)
    .single();

  if (loadErr || !existing) {
    return { success: false, error: 'Milestone tidak ditemukan.' };
  }
  const current = existing as Milestone;
  if (current.deleted_at) {
    return { success: false, error: 'Milestone sudah dihapus.' };
  }

  // 2. Load siblings for validation
  const { data: siblings, error: sibErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', current.project_id)
    .is('deleted_at', null);
  if (sibErr) return { success: false, error: sibErr.message };
  const all: Milestone[] = siblings ?? [];

  // 3. Compute projected row
  const projected: Milestone = {
    ...current,
    label: patch.label !== undefined ? patch.label.trim() : current.label,
    planned_date: patch.planned_date ?? current.planned_date,
    boq_ids: patch.boq_ids ?? current.boq_ids,
    depends_on: patch.depends_on ?? current.depends_on,
    author_status: patch.author_status ?? current.author_status,
  };

  if (!projected.label) {
    return { success: false, error: 'Nama milestone wajib diisi.' };
  }

  // 4. Uniqueness (exclude self)
  const clash = all.find(
    m => m.id !== id && m.label.trim().toLowerCase() === projected.label.toLowerCase(),
  );
  if (clash) {
    return { success: false, error: `Milestone "${projected.label}" sudah ada di proyek ini.` };
  }

  // 5. Project scoping of predecessors
  for (const predId of projected.depends_on) {
    if (predId === id) {
      return { success: false, error: 'Milestone ini akan membuat siklus dependensi.' };
    }
    if (!all.some(m => m.id === predId)) {
      return { success: false, error: 'Predecessor milestone tidak ditemukan di proyek ini.' };
    }
  }

  // 6. Date check
  const dateCheck = validatePlannedDate(all, projected.depends_on, projected.planned_date);
  if (!dateCheck.ok) {
    const conflict = all.find(m => m.id === dateCheck.conflictMilestoneId);
    return {
      success: false,
      error: `Target tanggal harus ≥ ${dateCheck.conflictDate} (milestone "${conflict?.label ?? dateCheck.conflictMilestoneId}").`,
    };
  }

  // 7. Cycle check
  if (!validateNoCycle(all, projected)) {
    return { success: false, error: 'Milestone ini akan membuat siklus dependensi.' };
  }

  // 8. Write
  const updatePayload: Record<string, unknown> = {};
  if (patch.label !== undefined) updatePayload.label = projected.label;
  if (patch.planned_date !== undefined) updatePayload.planned_date = projected.planned_date;
  if (patch.boq_ids !== undefined) updatePayload.boq_ids = projected.boq_ids;
  if (patch.depends_on !== undefined) updatePayload.depends_on = projected.depends_on;
  if (patch.author_status !== undefined) updatePayload.author_status = projected.author_status;

  const { data: updated, error: updateErr } = await supabase
    .from('milestones')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (updateErr || !updated) {
    return { success: false, error: updateErr?.message ?? 'Gagal memperbarui milestone.' };
  }
  return { success: true, data: updated as Milestone };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts -t updateMilestone
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): updateMilestone RPC with full validation"
```

---

## Task 8: `deleteMilestone` RPC with cascade cleanup (TDD)

**Files:**
- Modify: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add failing tests**

Append to `tools/__tests__/schedule.test.ts`:

```ts
import { deleteMilestone } from '../schedule';

describe('deleteMilestone', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns error when milestone is missing', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }));
    const result = await deleteMilestone('missing');
    expect(result.success).toBe(false);
  });

  it('soft-deletes and removes references from dependents', async () => {
    const target = {
      id: 'a', project_id: 'p1', label: 'A',
      planned_date: '2026-06-01', revised_date: null, revision_reason: null,
      boq_ids: [], status: 'ON_TRACK', depends_on: [],
      proposed_by: 'human', confidence_score: null, ai_explanation: null,
      author_status: 'confirmed', deleted_at: null,
    };
    const dependents = [
      { ...target, id: 'b', depends_on: ['a'] },
      { ...target, id: 'c', depends_on: ['a', 'x'] },
    ];

    const updateCalls: Array<{ id: string; payload: any }> = [];

    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockImplementation((col: string, val: string) => ({
          single: jest.fn().mockResolvedValue({ data: col === 'id' ? target : null, error: null }),
          is: jest.fn().mockResolvedValue({ data: [target, ...dependents], error: null }),
        })),
      }),
      update: jest.fn().mockImplementation((payload: any) => ({
        eq: jest.fn().mockImplementation((col: string, id: string) => {
          updateCalls.push({ id, payload });
          return Promise.resolve({ error: null });
        }),
      })),
    }));

    const result = await deleteMilestone('a');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cleanedReferences).toBe(2);

    // Target row soft-deleted
    const softDelete = updateCalls.find(c => c.id === 'a' && c.payload.deleted_at);
    expect(softDelete).toBeTruthy();
    // Dependents cleaned
    expect(updateCalls.find(c => c.id === 'b')?.payload.depends_on).toEqual([]);
    expect(updateCalls.find(c => c.id === 'c')?.payload.depends_on).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx jest tools/__tests__/schedule.test.ts -t deleteMilestone
```
Expected: 2 failing tests.

- [ ] **Step 3: Implement `deleteMilestone`**

Append to `tools/schedule.ts`:

```ts
export async function deleteMilestone(
  id: string,
): Promise<MilestoneResult<{ cleanedReferences: number }>> {
  // 1. Load target
  const { data: target, error: loadErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', id)
    .single();

  if (loadErr || !target) {
    return { success: false, error: 'Milestone tidak ditemukan.' };
  }
  const current = target as Milestone;
  if (current.deleted_at) {
    return { success: false, error: 'Milestone sudah dihapus.' };
  }

  // 2. Load siblings for cascade
  const { data: siblings, error: sibErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('project_id', current.project_id)
    .is('deleted_at', null);
  if (sibErr) return { success: false, error: sibErr.message };

  const cleanups = cascadeCleanupDependsOn(siblings ?? [], id);

  // 3. Soft-delete target
  const nowIso = new Date().toISOString();
  const { error: deleteErr } = await supabase
    .from('milestones')
    .update({ deleted_at: nowIso })
    .eq('id', id);
  if (deleteErr) return { success: false, error: deleteErr.message };

  // 4. Apply cascade patches
  for (const patch of cleanups) {
    const { error: patchErr } = await supabase
      .from('milestones')
      .update({ depends_on: patch.depends_on })
      .eq('id', patch.id);
    if (patchErr) console.warn('cascade cleanup failed for', patch.id, patchErr.message);
  }

  return { success: true, data: { cleanedReferences: cleanups.length } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts -t deleteMilestone
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): deleteMilestone soft-delete with cascade cleanup"
```

---

## Task 9: `createMilestonesBulk` RPC (TDD)

**Files:**
- Modify: `tools/__tests__/schedule.test.ts`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add failing test**

Append to `tools/__tests__/schedule.test.ts`:

```ts
import { createMilestonesBulk } from '../schedule';

describe('createMilestonesBulk', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a sequence of drafts and returns their rows', async () => {
    const insertedRows = [
      { id: 'x', label: 'A', project_id: 'p1', planned_date: '2026-06-01',
        revised_date: null, revision_reason: null, boq_ids: [], status: 'ON_TRACK',
        depends_on: [], proposed_by: 'ai', confidence_score: 0.8, ai_explanation: 'r',
        author_status: 'draft', deleted_at: null },
      { id: 'y', label: 'B', project_id: 'p1', planned_date: '2026-06-10',
        revised_date: null, revision_reason: null, boq_ids: [], status: 'ON_TRACK',
        depends_on: ['x'], proposed_by: 'ai', confidence_score: 0.7, ai_explanation: 'r',
        author_status: 'draft', deleted_at: null },
    ];

    (supabase.from as jest.Mock).mockImplementation(() => ({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({ data: insertedRows, error: null }),
      }),
    }));

    const result = await createMilestonesBulk('p1', [
      { project_id: 'p1', label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on: [],
        proposed_by: 'ai', confidence_score: 0.8, ai_explanation: 'r', author_status: 'draft' },
      { project_id: 'p1', label: 'B', planned_date: '2026-06-10', boq_ids: [], depends_on: ['x'],
        proposed_by: 'ai', confidence_score: 0.7, ai_explanation: 'r', author_status: 'draft' },
    ]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(2);
  });

  it('returns the insert error on failure', async () => {
    (supabase.from as jest.Mock).mockImplementation(() => ({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
      }),
    }));
    const result = await createMilestonesBulk('p1', [
      { project_id: 'p1', label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on: [] },
    ]);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx jest tools/__tests__/schedule.test.ts -t createMilestonesBulk
```
Expected: 2 failing tests.

- [ ] **Step 3: Implement `createMilestonesBulk`**

Append to `tools/schedule.ts`:

```ts
export async function createMilestonesBulk(
  projectId: string,
  drafts: CreateMilestoneInput[],
): Promise<MilestoneResult<Milestone[]>> {
  if (drafts.length === 0) return { success: true, data: [] };

  const payload = drafts.map(d => ({
    project_id: projectId,
    label: d.label.trim(),
    planned_date: d.planned_date,
    boq_ids: d.boq_ids,
    depends_on: d.depends_on,
    proposed_by: d.proposed_by ?? 'ai',
    confidence_score: d.confidence_score ?? null,
    ai_explanation: d.ai_explanation ?? null,
    author_status: d.author_status ?? 'draft',
    status: 'ON_TRACK',
  }));

  const { data, error } = await supabase
    .from('milestones')
    .insert(payload)
    .select();

  if (error || !data) {
    return { success: false, error: error?.message ?? 'Gagal membuat draf milestone.' };
  }
  return { success: true, data: data as Milestone[] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tools/__tests__/schedule.test.ts -t createMilestonesBulk
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/schedule.ts tools/__tests__/schedule.test.ts
git commit -m "feat(schedule): createMilestonesBulk RPC for AI draft commit"
```

---

## Task 10: Add `deleted_at IS NULL` filter to existing reads

**Files:**
- Modify: `tools/schedule.ts:61`
- Modify: `tools/schedule.ts` (inside `deriveMilestoneStatuses` and other readers)
- Modify: `tools/reports.ts` (milestone reads)

- [ ] **Step 1: Find every milestones read**

Run:
```bash
grep -n "from('milestones')" tools/schedule.ts tools/reports.ts
```
Record the list. Expected matches include `deriveMilestoneStatuses`, `syncMilestoneStatuses`, `reviseMilestone` (read to fetch existing), and any reports.ts schedule variance/health queries.

- [ ] **Step 2: Update `deriveMilestoneStatuses`**

In `tools/schedule.ts`, replace:

```ts
const { data: milestones } = await supabase
  .from('milestones')
  .select('*')
  .eq('project_id', projectId);
```

with:

```ts
const { data: milestones } = await supabase
  .from('milestones')
  .select('*')
  .eq('project_id', projectId)
  .is('deleted_at', null)
  .eq('author_status', 'confirmed');
```

The new RPCs (`createMilestone`, `updateMilestone`, `deleteMilestone`) already filter in their own queries — only the pre-existing readers need this update. Do not touch the new RPC queries.

- [ ] **Step 3: Update `reviseMilestone` existing fetch**

In `tools/schedule.ts`, inside `reviseMilestone`, replace:

```ts
const { data: existing, error: fetchErr } = await supabase
  .from('milestones')
  .select('planned_date, revised_date, label')
  .eq('id', milestoneId)
  .single();
```

with:

```ts
const { data: existing, error: fetchErr } = await supabase
  .from('milestones')
  .select('planned_date, revised_date, label, deleted_at')
  .eq('id', milestoneId)
  .single();

if (fetchErr || !existing || existing.deleted_at) {
  return { success: false, error: 'Milestone tidak ditemukan.' };
}
```

Remove the old `if (fetchErr || !existing)` block since we've replaced it above.

- [ ] **Step 4: Update `tools/reports.ts` milestone reads**

Open `tools/reports.ts` and find `generateScheduleVariance` (spec §13 references line 730 area). For every `.from('milestones').select(...)` chain inside it, append `.is('deleted_at', null).eq('author_status', 'confirmed')` before the `.order(...)` or await.

Example — if you see:
```ts
const { data } = await supabase
  .from('milestones')
  .select('*')
  .eq('project_id', projectId);
```
replace with:
```ts
const { data } = await supabase
  .from('milestones')
  .select('*')
  .eq('project_id', projectId)
  .is('deleted_at', null)
  .eq('author_status', 'confirmed');
```

Verify every remaining `from('milestones')` read in `reports.ts` has the filter.

- [ ] **Step 5: Run existing tests to make sure nothing broke**

```bash
npx jest tools/__tests__/schedule.test.ts
```
Expected: all passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add tools/schedule.ts tools/reports.ts
git commit -m "feat(schedule): filter soft-deleted + draft milestones from existing reads"
```

---

# Phase 2 — Hook split

## Task 11: Split `useProject` into milestones + milestoneDrafts

**Files:**
- Modify: `workflows/hooks/useProject.tsx`

- [ ] **Step 1: Extend the context type and state**

In `workflows/hooks/useProject.tsx`, update the `ProjectContextType` interface:

```tsx
interface ProjectContextType {
  profile: Profile | null;
  projects: Project[];
  project: Project | null;
  setActiveProject: (projectId: string) => void;
  boqItems: BoqItem[];
  purchaseOrders: PurchaseOrder[];
  envelopes: Envelope[];
  milestones: Milestone[];
  milestoneDrafts: Milestone[];
  defects: Defect[];
  activityLog: ActivityLog[];
  loading: boolean;
  refresh: () => Promise<void>;
}
```

Add `milestoneDrafts: []` to the default context object below that interface.

- [ ] **Step 2: Add the draft state**

In `ProjectProvider`, after the `milestones` state, add:
```tsx
const [milestoneDrafts, setMilestoneDrafts] = useState<Milestone[]>([]);
```

- [ ] **Step 3: Update `loadProjectData` to issue two queries**

Replace the `loadProjectData` body's `Promise.all` with:

```tsx
const results = await Promise.all([
  supabase.from('boq_items').select('*').eq('project_id', pid).order('code'),
  supabase.from('purchase_orders').select('*').eq('project_id', pid),
  supabase.from('envelopes').select('*').eq('project_id', pid),
  supabase.from('milestones')
    .select('*')
    .eq('project_id', pid)
    .eq('author_status', 'confirmed')
    .is('deleted_at', null)
    .order('planned_date'),
  supabase.from('defects').select('*').eq('project_id', pid).order('reported_at', { ascending: false }),
  supabase.from('activity_log').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(20),
  supabase.from('milestones')
    .select('*')
    .eq('project_id', pid)
    .eq('author_status', 'draft')
    .is('deleted_at', null)
    .order('planned_date'),
]);

for (const r of results) {
  if (r.error) console.warn('Query error:', r.error.message);
}

setBoqItems(results[0].data ?? []);
setPurchaseOrders(results[1].data ?? []);
setEnvelopes(results[2].data ?? []);
setMilestones(results[3].data ?? []);
setDefects(results[4].data ?? []);
setActivityLog(results[5].data ?? []);
setMilestoneDrafts(results[6].data ?? []);
```

- [ ] **Step 4: Expose `milestoneDrafts` in the provider value**

In the `return (<ProjectContext.Provider value={{ ... }}>` block, add `milestoneDrafts,` to the object.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors. If any consumer destructures `milestoneDrafts` and we forgot to expose it, add it now.

- [ ] **Step 6: Commit**

```bash
git add workflows/hooks/useProject.tsx
git commit -m "feat(hooks): split confirmed milestones and drafts in useProject"
```

---

# Phase 3 — BoQ Picker

## Task 12: `BoqPickerSheet` component

**Files:**
- Create: `workflows/components/BoqPickerSheet.tsx`

- [ ] **Step 1: Scaffold the component**

Create `workflows/components/BoqPickerSheet.tsx`:

```tsx
import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { BoqItem } from '../../tools/types';

interface Props {
  visible: boolean;
  items: BoqItem[];
  initialSelectedIds: string[];
  onClose: () => void;
  onSave: (selectedIds: string[]) => void;
}

type Row =
  | { kind: 'header'; chapter: string }
  | { kind: 'item'; item: BoqItem };

export default function BoqPickerSheet({ visible, items, initialSelectedIds, onClose, onSave }: Props) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeChapters, setActiveChapters] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds));

  useEffect(() => {
    if (visible) {
      setSelected(new Set(initialSelectedIds));
      setSearch('');
      setActiveChapters(new Set());
    }
  }, [visible, initialSelectedIds]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [search]);

  const chapters = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items) {
      const ch = it.chapter ?? 'Tanpa Chapter';
      if (!seen.has(ch)) seen.set(ch, it.sort_order);
      else seen.set(ch, Math.min(seen.get(ch)!, it.sort_order));
    }
    return Array.from(seen.entries()).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }, [items]);

  const rows = useMemo<Row[]>(() => {
    const filtered = items.filter(it => {
      const ch = it.chapter ?? 'Tanpa Chapter';
      if (activeChapters.size > 0 && !activeChapters.has(ch)) return false;
      if (!debounced) return true;
      return (
        it.code.toLowerCase().includes(debounced) ||
        it.label.toLowerCase().includes(debounced)
      );
    });

    filtered.sort((a, b) => a.sort_order - b.sort_order);

    const out: Row[] = [];
    let currentChapter: string | null = null;
    for (const it of filtered) {
      const ch = it.chapter ?? 'Tanpa Chapter';
      if (ch !== currentChapter) {
        out.push({ kind: 'header', chapter: ch });
        currentChapter = ch;
      }
      out.push({ kind: 'item', item: it });
    }
    return out;
  }, [items, debounced, activeChapters]);

  const toggleChapter = (ch: string) => {
    setActiveChapters(prev => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pilih Item BoQ</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Cari kode atau nama item…"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, activeChapters.size === 0 && styles.chipActive]}
              onPress={() => setActiveChapters(new Set())}
            >
              <Text style={[styles.chipText, activeChapters.size === 0 && styles.chipTextActive]}>Semua</Text>
            </TouchableOpacity>
            {chapters.map(ch => {
              const active = activeChapters.has(ch);
              return (
                <TouchableOpacity
                  key={ch}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleChapter(ch)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{ch}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <FlatList
            data={rows}
            keyExtractor={(r, i) => r.kind === 'header' ? `h-${r.chapter}-${i}` : r.item.id}
            renderItem={({ item: row }) => {
              if (row.kind === 'header') {
                return <Text style={styles.chapterHeader}>{row.chapter}</Text>;
              }
              const it = row.item;
              const checked = selected.has(it.id);
              return (
                <TouchableOpacity style={styles.item} onPress={() => toggleItem(it.id)}>
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked && <Ionicons name="checkmark" size={14} color={COLORS.textInverse} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemCode}>{it.code}</Text>
                    <Text style={styles.itemLabel}>{it.label}</Text>
                    <Text style={styles.itemMeta}>{it.unit}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            style={styles.list}
          />

          <View style={styles.footer}>
            <Text style={styles.footerCount}>{selected.size} item dipilih</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(Array.from(selected))}>
              <Text style={styles.saveBtnText}>Simpan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: TYPE.md, fontFamily: FONTS.bold },
  searchRow: { padding: SPACE.md, paddingBottom: SPACE.sm },
  search: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.sm, fontSize: TYPE.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: SPACE.md, paddingBottom: SPACE.sm },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: TYPE.xs, color: COLORS.text },
  chipTextActive: { color: COLORS.textInverse },
  list: { flex: 1 },
  chapterHeader: { paddingHorizontal: SPACE.md, paddingVertical: 6, fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', color: COLORS.textSec, backgroundColor: COLORS.bg },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  itemCode: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.semibold },
  itemLabel: { fontSize: TYPE.sm, color: COLORS.text },
  itemMeta: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  footerCount: { fontSize: TYPE.sm, color: COLORS.textSec },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workflows/components/BoqPickerSheet.tsx
git commit -m "feat(ui): BoqPickerSheet grouped by chapter with filter chips"
```

---

# Phase 4 — Manual Authoring

## Task 13: `MilestoneFormScreen` — create mode shell + basic fields

**Files:**
- Create: `workflows/screens/MilestoneFormScreen.tsx`

- [ ] **Step 1: Scaffold the screen with label + date fields**

Create `workflows/screens/MilestoneFormScreen.tsx`:

```tsx
import React, { useMemo, useState, useEffect } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import DateSelectField from '../components/DateSelectField';
import BoqPickerSheet from '../components/BoqPickerSheet';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { createMilestone, updateMilestone, deleteMilestone } from '../../tools/schedule';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { Milestone } from '../../tools/types';

interface Props {
  onBack: () => void;
  milestoneId?: string | null; // null/undefined = create mode
  initialDraft?: Partial<Milestone>; // optional AI-draft seed
}

export default function MilestoneFormScreen({ onBack, milestoneId, initialDraft }: Props) {
  const { project, profile, milestones, milestoneDrafts, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const role = profile?.role ?? 'supervisor';
  const canEdit = role === 'estimator' || role === 'admin' || role === 'principal';

  const allProjectMilestones = useMemo(() => [...milestones, ...milestoneDrafts], [milestones, milestoneDrafts]);

  const existing = useMemo(
    () => allProjectMilestones.find(m => m.id === milestoneId) ?? null,
    [milestoneId, allProjectMilestones],
  );

  const [label, setLabel] = useState(existing?.label ?? initialDraft?.label ?? '');
  const [plannedDate, setPlannedDate] = useState(
    existing?.planned_date ?? initialDraft?.planned_date ?? '',
  );
  const [boqIds, setBoqIds] = useState<string[]>(
    existing?.boq_ids ?? initialDraft?.boq_ids ?? [],
  );
  const [dependsOn, setDependsOn] = useState<string[]>(
    existing?.depends_on ?? initialDraft?.depends_on ?? [],
  );
  const [boqPickerOpen, setBoqPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    return (
      <View style={styles.flex}>
        <Header />
        <View style={{ padding: SPACE.lg }}>
          <Text>Anda tidak memiliki izin untuk menyunting milestone.</Text>
          <TouchableOpacity onPress={onBack} style={{ marginTop: SPACE.md }}>
            <Text style={{ color: COLORS.primary }}>Kembali</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleSave = async () => {
    if (!project) return;
    if (!label.trim()) { toast('Nama milestone wajib diisi', 'critical'); return; }
    if (!plannedDate) { toast('Tanggal target wajib diisi', 'critical'); return; }
    setSaving(true);
    try {
      if (existing) {
        const result = await updateMilestone(existing.id, {
          label: label.trim(),
          planned_date: plannedDate,
          boq_ids: boqIds,
          depends_on: dependsOn,
          author_status: existing.author_status === 'draft' ? 'draft' : 'confirmed',
        });
        if (!result.success) { toast(result.error, 'critical'); return; }
        toast('Milestone diperbarui', 'ok');
      } else {
        const result = await createMilestone({
          project_id: project.id,
          label: label.trim(),
          planned_date: plannedDate,
          boq_ids: boqIds,
          depends_on: dependsOn,
        });
        if (!result.success) { toast(result.error, 'critical'); return; }
        toast('Milestone dibuat', 'ok');
      }
      await refresh();
      onBack();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{existing ? 'Edit Milestone' : 'Tambah Milestone'}</Text>

        <Card>
          <Text style={styles.label}>Nama Milestone <Text style={styles.req}>*</Text></Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="mis. Pondasi & Sloof"
            maxLength={120}
          />

          <Text style={styles.label}>Target Tanggal <Text style={styles.req}>*</Text></Text>
          <DateSelectField value={plannedDate} onChange={setPlannedDate} placeholder="Pilih tanggal" />
          {existing && (
            <Text style={styles.hint}>Untuk revisi tanggal setelah milestone dikomit, gunakan tombol Revisi di daftar.</Text>
          )}

          <Text style={styles.label}>Item BoQ</Text>
          <TouchableOpacity style={styles.pickerRow} onPress={() => setBoqPickerOpen(true)}>
            <Text style={styles.pickerText}>
              {boqIds.length === 0 ? 'Pilih item BoQ…' : `${boqIds.length} item BoQ dipilih`}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
          </TouchableOpacity>
          <Text style={styles.hint}>Kosongkan jika milestone tidak terhubung ke item BoQ.</Text>
        </Card>

        {/* Depends-on picker added in Task 14 */}

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Menyimpan…' : 'Simpan'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onBack}>
            <Text style={styles.cancelBtnText}>Batal</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BoqPickerSheet
        visible={boqPickerOpen}
        items={boqItems}
        initialSelectedIds={boqIds}
        onClose={() => setBoqPickerOpen(false)}
        onSave={(ids) => { setBoqIds(ids); setBoqPickerOpen(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  title: { fontSize: TYPE.lg, fontFamily: FONTS.bold, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: 6, marginTop: SPACE.sm + 2 },
  req: { color: COLORS.critical },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 4 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, backgroundColor: COLORS.surface },
  pickerText: { fontSize: TYPE.sm, color: COLORS.text },
  actionRow: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.lg },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/MilestoneFormScreen.tsx
git commit -m "feat(ui): MilestoneFormScreen shell with label/date/BoQ fields"
```

---

## Task 14: `MilestoneFormScreen` — predecessor picker (`depends_on`)

**Files:**
- Modify: `workflows/screens/MilestoneFormScreen.tsx`

- [ ] **Step 1: Add predecessor picker block**

In `MilestoneFormScreen.tsx`, replace the comment `{/* Depends-on picker added in Task 14 */}` with:

```tsx
<Card title="Tergantung Pada">
  <Text style={styles.hint}>Milestone ini hanya mulai setelah predecessor selesai.</Text>
  <PredecessorPicker
    allMilestones={allProjectMilestones}
    currentId={existing?.id ?? null}
    selected={dependsOn}
    onChange={setDependsOn}
  />
</Card>
```

- [ ] **Step 2: Implement `PredecessorPicker` as a file-local component**

Add this component above `MilestoneFormScreen` in the same file (after the imports):

```tsx
interface PredecessorPickerProps {
  allMilestones: Milestone[];
  currentId: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
}

function PredecessorPicker({ allMilestones, currentId, selected, onChange }: PredecessorPickerProps) {
  const [search, setSearch] = useState('');

  // Build the set of ineligible ids: self + any descendant of self (to block cycles at selection time)
  const forbidden = useMemo(() => {
    const out = new Set<string>();
    if (!currentId) return out;
    out.add(currentId);
    // BFS downward: find anything that transitively depends on currentId
    const childrenOf = new Map<string, string[]>();
    for (const m of allMilestones) {
      for (const p of m.depends_on) {
        if (!childrenOf.has(p)) childrenOf.set(p, []);
        childrenOf.get(p)!.push(m.id);
      }
    }
    const queue = [currentId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const child of childrenOf.get(id) ?? []) {
        if (out.has(child)) continue;
        out.add(child);
        queue.push(child);
      }
    }
    return out;
  }, [allMilestones, currentId]);

  const candidates = useMemo(() => {
    const q = search.toLowerCase();
    return allMilestones
      .filter(m => !forbidden.has(m.id))
      .filter(m => !m.deleted_at)
      .filter(m => !q || m.label.toLowerCase().includes(q));
  }, [allMilestones, forbidden, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <>
      <TextInput
        style={stylesLocal.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Cari milestone…"
      />

      <View style={stylesLocal.selectedChipRow}>
        {selected.map(id => {
          const m = allMilestones.find(x => x.id === id);
          if (!m) return null;
          return (
            <TouchableOpacity key={id} style={stylesLocal.chipSelected} onPress={() => toggle(id)}>
              <Text style={stylesLocal.chipSelectedText}>{m.label}</Text>
              <Ionicons name="close" size={14} color={COLORS.textInverse} />
            </TouchableOpacity>
          );
        })}
        {selected.length === 0 && (
          <Text style={{ fontSize: TYPE.xs, color: COLORS.textSec }}>Belum ada predecessor</Text>
        )}
      </View>

      <View style={{ marginTop: SPACE.sm }}>
        {candidates.map(m => {
          const checked = selected.includes(m.id);
          return (
            <TouchableOpacity key={m.id} style={stylesLocal.candidateRow} onPress={() => toggle(m.id)}>
              <View style={[stylesLocal.candidateBox, checked && stylesLocal.candidateBoxOn]}>
                {checked && <Ionicons name="checkmark" size={12} color={COLORS.textInverse} />}
              </View>
              <Text style={stylesLocal.candidateText}>{m.label}</Text>
              <Text style={stylesLocal.candidateDate}>{new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
            </TouchableOpacity>
          );
        })}
        {candidates.length === 0 && (
          <Text style={{ fontSize: TYPE.xs, color: COLORS.textSec, paddingVertical: SPACE.sm }}>
            Tidak ada kandidat
          </Text>
        )}
      </View>
    </>
  );
}

const stylesLocal = StyleSheet.create({
  search: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.sm, fontSize: TYPE.sm, marginTop: SPACE.sm },
  selectedChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACE.sm },
  chipSelected: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipSelectedText: { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.medium },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  candidateBox: { width: 16, height: 16, borderWidth: 2, borderColor: COLORS.border, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  candidateBoxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  candidateText: { flex: 1, fontSize: TYPE.sm, color: COLORS.text },
  candidateDate: { fontSize: TYPE.xs, color: COLORS.textSec },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/MilestoneFormScreen.tsx
git commit -m "feat(ui): predecessor picker with descendant exclusion"
```

---

## Task 15: `MilestoneFormScreen` — edit mode delete action

**Files:**
- Modify: `workflows/screens/MilestoneFormScreen.tsx`

- [ ] **Step 1: Add delete button and handler**

In `MilestoneFormScreen.tsx`, in the `actionRow` area, add below the cancel button (only in edit mode):

```tsx
{existing && (
  <TouchableOpacity
    style={styles.deleteBtn}
    onPress={() => handleDelete()}
  >
    <Ionicons name="trash" size={14} color={COLORS.critical} />
    <Text style={styles.deleteBtnText}>Hapus</Text>
  </TouchableOpacity>
)}
```

Add to the styles object:

```tsx
deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS, padding: SPACE.md, justifyContent: 'center' },
deleteBtnText: { color: COLORS.critical, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
```

Add `handleDelete` above the `return`:

```tsx
const handleDelete = () => {
  if (!existing) return;

  const dependents = allProjectMilestones.filter(
    m => m.id !== existing.id && m.depends_on.includes(existing.id),
  );
  const dependentsText = dependents.length > 0
    ? `\n\nMilestone berikut bergantung dan akan kehilangan dependensi:\n${dependents.map(d => `• ${d.label}`).join('\n')}`
    : '';

  Alert.alert(
    'Hapus milestone?',
    `"${existing.label}" akan dihapus.${dependentsText}`,
    [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteMilestone(existing.id);
          if (!result.success) { toast(result.error, 'critical'); return; }
          toast('Milestone dihapus', 'ok');
          await refresh();
          onBack();
        },
      },
    ],
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/MilestoneFormScreen.tsx
git commit -m "feat(ui): MilestoneFormScreen delete with cascade confirmation"
```

---

# Phase 5 — MilestoneScreen updates

## Task 16: Entry row, baseline gate, empty state

**Files:**
- Modify: `workflows/screens/MilestoneScreen.tsx`

- [ ] **Step 1: Accept navigation callbacks from parent**

Update the `MilestonePanel` signature in `MilestoneScreen.tsx`:

```tsx
export function MilestonePanel({
  onBack,
  embedded = false,
  onOpenForm,
  onOpenAiDraft,
  onOpenAiReview,
}: {
  onBack?: () => void;
  embedded?: boolean;
  onOpenForm?: (milestoneId: string | null) => void;
  onOpenAiDraft?: () => void;
  onOpenAiReview?: () => void;
}) {
```

- [ ] **Step 2: Read baseline publish status from the project**

Inside `MilestonePanel`, after destructuring `useProject`:

```tsx
const baselinePublished = project?.status && project.status !== 'draft';
// Adjust the condition above if project.status values differ in this codebase.
// The spec calls for gating until baseline is published — match whatever the
// existing BaselineScreen uses to signal "published".
```

If `project.status === 'draft'` is not the right check, search `workflows/screens/BaselineScreen.tsx` for how it determines publish state and mirror that logic here. Record whatever flag is used.

- [ ] **Step 3: Replace empty state and add entry row**

In the render, replace:
```tsx
<Text style={styles.sectionHead}>Daftar Milestone</Text>
{milestones.length === 0 && (
  <Card><Text style={styles.hint}>Belum ada milestone. Tersedia setelah baseline import.</Text></Card>
)}
```
with:

```tsx
{canRevise && baselinePublished && (
  <View style={styles.entryRow}>
    <TouchableOpacity style={styles.entryBtn} onPress={() => onOpenForm?.(null)}>
      <Ionicons name="add" size={16} color={COLORS.textInverse} />
      <Text style={styles.entryBtnText}>Tambah Milestone</Text>
    </TouchableOpacity>
    <TouchableOpacity style={[styles.entryBtn, styles.entryBtnSecondary]} onPress={() => onOpenAiDraft?.()}>
      <Ionicons name="sparkles" size={16} color={COLORS.primary} />
      <Text style={[styles.entryBtnText, styles.entryBtnTextSecondary]}>Saran Jadwal AI</Text>
    </TouchableOpacity>
  </View>
)}

<Text style={styles.sectionHead}>Daftar Milestone</Text>

{!baselinePublished && (
  <Card><Text style={styles.hint}>Publikasikan baseline dulu untuk mengaktifkan jadwal.</Text></Card>
)}

{baselinePublished && milestones.length === 0 && (
  <Card>
    <Text style={[styles.msLabel, { marginBottom: 6 }]}>Belum ada jadwal</Text>
    <Text style={styles.hint}>
      Mulai dengan menambah milestone manual, atau biarkan AI menyusun draf awal dari BoQ yang sudah dipublikasi.
    </Text>
  </Card>
)}
```

Add the styles:
```tsx
entryRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
entryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.sm + 2 },
entryBtnSecondary: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary },
entryBtnText: { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
entryBtnTextSecondary: { color: COLORS.primary },
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors. The new props are all optional (`?:`), so the existing `LaporanScreen` call site stays valid. The buttons will render but be no-ops until wired up in Task 20.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/MilestoneScreen.tsx
git commit -m "feat(ui): jadwal entry row + baseline gate + new empty state"
```

---

## Task 17: Topological sort + predecessor chips + AI badge

**Files:**
- Modify: `workflows/screens/MilestoneScreen.tsx`

- [ ] **Step 1: Sort milestones topologically**

At the top of `MilestoneScreen.tsx`, update imports:
- Add `topologicalSort` to the existing `'../../tools/schedule'` import.
- Ensure `useMemo` is in the `'react'` import.

Inside `MilestonePanel`, near the top of the function body (after the `useProject()` destructure):

```tsx
const sortedMilestones = useMemo(() => topologicalSort(milestones), [milestones]);
```

In the JSX, replace `{milestones.map(m => (` with `{sortedMilestones.map(m => (`.

- [ ] **Step 2: Add predecessor chip row**

Inside each milestone card, below the existing `{m.boq_ids.length > 0 && ...}` block, add:

```tsx
{m.depends_on.length > 0 && (
  <View style={styles.depsRow}>
    <Text style={styles.hint}>Tergantung pada:</Text>
    {m.depends_on.map(depId => {
      const dep = milestones.find(x => x.id === depId);
      return (
        <View key={depId} style={styles.depChip}>
          <Text style={styles.depChipText}>{dep?.label ?? '[dihapus]'}</Text>
        </View>
      );
    })}
  </View>
)}
```

- [ ] **Step 3: Add AI provenance badge**

Inside the milestone card's label area, replace:

```tsx
<Text style={styles.msLabel}>{m.label}</Text>
```

with:

```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
  <Text style={styles.msLabel}>{m.label}</Text>
  {m.proposed_by === 'ai' && (
    <TouchableOpacity
      style={styles.aiBadge}
      onPress={() => {
        Alert.alert('Penjelasan AI', m.ai_explanation ?? 'Tidak ada penjelasan.');
      }}
    >
      <Ionicons name="sparkles" size={10} color={COLORS.info} />
      <Text style={styles.aiBadgeText}>
        AI {m.confidence_score != null ? `${Math.round(m.confidence_score * 100)}%` : ''}
      </Text>
    </TouchableOpacity>
  )}
</View>
```

Add the styles:
```tsx
depsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginTop: 4 },
depChip: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
depChipText: { fontSize: TYPE.xs, color: COLORS.text },
aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.info, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
aiBadgeText: { fontSize: 10, color: COLORS.info, fontFamily: FONTS.semibold },
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors in `MilestoneScreen.tsx`.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/MilestoneScreen.tsx
git commit -m "feat(ui): topological sort + predecessor chips + AI badge"
```

---

## Task 18: Per-card Edit and Hapus actions

**Files:**
- Modify: `workflows/screens/MilestoneScreen.tsx`

- [ ] **Step 1: Extend the action button row**

Find the existing `Revisi` button block inside the milestone card (currently around lines 194-206 of `MilestoneScreen.tsx`). The current code is:

```tsx
{canRevise && !revising && (
  <TouchableOpacity
    style={styles.reviseBtn}
    onPress={() => {
      setRevising(m.id);
      setNewDate(m.revised_date ?? m.planned_date);
      setRevisionReason('');
    }}
  >
    <Ionicons name="create" size={14} color={COLORS.primary} />
    <Text style={styles.reviseBtnText}>Revisi</Text>
  </TouchableOpacity>
)}
```

Replace it with:

```tsx
{canRevise && !revising && (
  <View style={{ flexDirection: 'row', gap: 4 }}>
    <TouchableOpacity style={styles.actBtn} onPress={() => onOpenForm?.(m.id)}>
      <Ionicons name="create-outline" size={12} color={COLORS.primary} />
      <Text style={styles.actBtnText}>Edit</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.actBtn}
      onPress={() => {
        setRevising(m.id);
        setNewDate(m.revised_date ?? m.planned_date);
        setRevisionReason('');
      }}
    >
      <Ionicons name="time-outline" size={12} color={COLORS.warning} />
      <Text style={[styles.actBtnText, { color: COLORS.warning }]}>Revisi</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.actBtn}
      onPress={() => handleDeleteCard(m)}
    >
      <Ionicons name="trash-outline" size={12} color={COLORS.critical} />
      <Text style={[styles.actBtnText, { color: COLORS.critical }]}>Hapus</Text>
    </TouchableOpacity>
  </View>
)}
```

Add the styles:
```tsx
actBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingHorizontal: 6, paddingVertical: 3 },
actBtnText: { fontSize: 10, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.primary },
```

- [ ] **Step 2: Add `handleDeleteCard` helper**

Add a top-of-file import update: add `deleteMilestone` to the existing `'../../tools/schedule'` import line:

```tsx
import { reviseMilestone, syncMilestoneStatuses, computeProjectHealth, deleteMilestone, topologicalSort, type ProjectHealthSummary } from '../../tools/schedule';
```

Then below the existing `handleRevise` function, add:

```tsx
const handleDeleteCard = (m: Milestone) => {
  const dependents = milestones.filter(other => other.id !== m.id && other.depends_on.includes(m.id));
  const dependentsText = dependents.length > 0
    ? `\n\nMilestone berikut bergantung:\n${dependents.map(d => `• ${d.label}`).join('\n')}`
    : '';

  Alert.alert(
    'Hapus milestone?',
    `"${m.label}" akan dihapus.${dependentsText}`,
    [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteMilestone(m.id);
          if (!result.success) { toast(result.error, 'critical'); return; }
          toast('Milestone dihapus', 'ok');
          refresh();
          loadHealth();
        },
      },
    ],
  );
};
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors in MilestoneScreen.tsx.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/MilestoneScreen.tsx
git commit -m "feat(ui): per-milestone Edit/Revisi/Hapus action row"
```

---

## Task 19: Draft review banner

**Files:**
- Modify: `workflows/screens/MilestoneScreen.tsx`

- [ ] **Step 1: Read `milestoneDrafts` from `useProject`**

Update the destructure:
```tsx
const { project, profile, milestones, milestoneDrafts, refresh } = useProject();
```

- [ ] **Step 2: Render the banner above the list**

Just above `<Text style={styles.sectionHead}>Daftar Milestone</Text>`:

```tsx
{canRevise && milestoneDrafts.length > 0 && (
  <Card borderColor={COLORS.warning}>
    <Text style={styles.msLabel}>
      🟠 Ada {milestoneDrafts.length} draf AI belum dikonfirmasi
    </Text>
    <View style={{ flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm }}>
      <TouchableOpacity style={styles.entryBtn} onPress={() => onOpenAiReview?.()}>
        <Text style={styles.entryBtnText}>Lanjutkan Review</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.entryBtn, styles.entryBtnSecondary]}
        onPress={() => handleAbandonAllDrafts()}
      >
        <Text style={[styles.entryBtnText, styles.entryBtnTextSecondary]}>Buang Semua</Text>
      </TouchableOpacity>
    </View>
  </Card>
)}
```

- [ ] **Step 3: Add `handleAbandonAllDrafts`**

Below `handleDeleteCard`:

```tsx
const handleAbandonAllDrafts = () => {
  Alert.alert(
    'Buang semua draf AI?',
    `${milestoneDrafts.length} draf akan dihapus.`,
    [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Buang',
        style: 'destructive',
        onPress: async () => {
          for (const d of milestoneDrafts) {
            await deleteMilestone(d.id);
          }
          toast('Semua draf AI dihapus', 'ok');
          refresh();
        },
      },
    ],
  );
};
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/MilestoneScreen.tsx
git commit -m "feat(ui): AI draft review banner on MilestoneScreen"
```

---

# Phase 6 — Cross-screen wiring

## Task 20: Route new screens as takeovers in `LaporanScreen`

**Files:**
- Modify: `workflows/screens/LaporanScreen.tsx`

- [ ] **Step 1: Extend the Section type**

In `LaporanScreen.tsx`, find:

```tsx
type Section = 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'katalog' | 'mandor' | 'opname' | 'attendance';
```

Replace with:

```tsx
type Section = 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review' | 'katalog' | 'mandor' | 'opname' | 'attendance';
```

- [ ] **Step 2: Add state for editing milestone id**

Near `focusedContractId` state:
```tsx
const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
```

- [ ] **Step 3: Add takeover routes**

Import the new screens at the top of the file:
```tsx
import MilestoneFormScreen from './MilestoneFormScreen';
import MilestoneAiDraftScreen from './MilestoneAiDraftScreen';
import MilestoneAiReviewScreen from './MilestoneAiReviewScreen';
```

Near the existing `if (activeSection === 'baseline')` block, add:

```tsx
if (activeSection === 'jadwal-form') {
  return (
    <MilestoneFormScreen
      milestoneId={editingMilestoneId}
      onBack={() => { setEditingMilestoneId(null); setActiveSection('jadwal'); }}
    />
  );
}

if (activeSection === 'jadwal-ai-draft') {
  return (
    <MilestoneAiDraftScreen onBack={() => setActiveSection('jadwal')} />
  );
}

if (activeSection === 'jadwal-ai-review') {
  return (
    <MilestoneAiReviewScreen onBack={() => setActiveSection('jadwal')} />
  );
}
```

(If `MilestoneAiDraftScreen` and `MilestoneAiReviewScreen` don't exist yet — they're Tasks 24 and 25 — TypeScript will complain. Create placeholder exports in each file with:
```tsx
// workflows/screens/MilestoneAiDraftScreen.tsx
export default function MilestoneAiDraftScreen({ onBack }: { onBack: () => void }) {
  return null;
}
```
Do the same for `MilestoneAiReviewScreen.tsx`. These are placeholders that will be filled in later tasks.)

- [ ] **Step 4: Wire `MilestonePanel` callbacks**

Find:
```tsx
{activeSection === 'jadwal' && (
  <MilestonePanel embedded onBack={() => setActiveSection('overview')} />
)}
```

Replace with:

```tsx
{activeSection === 'jadwal' && (
  <MilestonePanel
    embedded
    onBack={() => setActiveSection('overview')}
    onOpenForm={(id) => {
      setEditingMilestoneId(id);
      setActiveSection('jadwal-form');
    }}
    onOpenAiDraft={() => setActiveSection('jadwal-ai-draft')}
    onOpenAiReview={() => setActiveSection('jadwal-ai-review')}
  />
)}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors (with the placeholder screens in place).

- [ ] **Step 6: Commit**

```bash
git add workflows/screens/LaporanScreen.tsx workflows/screens/MilestoneAiDraftScreen.tsx workflows/screens/MilestoneAiReviewScreen.tsx
git commit -m "feat(ui): LaporanScreen takeover routes for jadwal screens"
```

---

## Task 21: `BaselineScreen` — Atur Jadwal shortcut

**Files:**
- Modify: `workflows/screens/BaselineScreen.tsx` (around the publish-success handling)

- [ ] **Step 1: Find the publish success handler**

Search `BaselineScreen.tsx` for `publishBaseline`:
```bash
grep -n "publishBaseline\|toast.*publish\|Baseline.*publish" workflows/screens/BaselineScreen.tsx
```

Locate the success branch (spec references line ~434).

- [ ] **Step 2: Accept an optional navigation prop**

In `BaselineScreen`'s prop interface, add:
```tsx
onGoToJadwal?: () => void;
```

- [ ] **Step 3: Add a `publishedJustNow` state flag**

Near the other `useState` declarations at the top of the `BaselineScreen` component:

```tsx
const [publishedJustNow, setPublishedJustNow] = useState(false);
```

In the publish success handler, after the existing `toast(...)` success call:

```tsx
setPublishedJustNow(true);
```

- [ ] **Step 4: Render the shortcut card**

Locate where the publish-success area renders (near the publish button, inside the main ScrollView). Add this block immediately after the existing success feedback:

```tsx
{publishedJustNow && onGoToJadwal && (
  <Card borderColor={COLORS.ok}>
    <Text style={styles.msLabel}>Baseline berhasil dipublikasi</Text>
    <Text style={{ fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 4 }}>
      Langkah selanjutnya: atur jadwal milestone untuk proyek ini.
    </Text>
    <TouchableOpacity style={styles.primaryBtn} onPress={onGoToJadwal}>
      <Text style={styles.primaryBtnText}>Atur Jadwal →</Text>
    </TouchableOpacity>
  </Card>
)}
```

If `styles.msLabel` / `styles.primaryBtn` / `styles.primaryBtnText` don't already exist in `BaselineScreen.tsx`, add them to that file's StyleSheet:

```tsx
msLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold },
primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center', marginTop: SPACE.sm },
primaryBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
```

- [ ] **Step 5: Pass `onGoToJadwal` from `LaporanScreen`**

In `LaporanScreen.tsx` where `BaselineScreen` is rendered:

```tsx
if (activeSection === 'baseline') {
  return (
    <BaselineScreen
      onBack={() => setActiveSection('overview')}
      onGoToJadwal={() => setActiveSection('jadwal')}
    />
  );
}
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add workflows/screens/BaselineScreen.tsx workflows/screens/LaporanScreen.tsx
git commit -m "feat(ui): Atur Jadwal shortcut after baseline publish"
```

---

# Phase 7 — AI draft-assist

## Task 22: `ai-draft-milestones` edge function — schema + validation (TDD)

**Files:**
- Create: `supabase/functions/ai-draft-milestones/index.ts`
- Create: `supabase/functions/ai-draft-milestones/validate.ts`
- Create: `supabase/functions/ai-draft-milestones/validate.test.ts`

The edge function has two moving parts: (a) pure validation of Claude's structured output, (b) the Claude call + persistence. We TDD part (a) here and build part (b) in Task 23.

- [ ] **Step 1: Create the validator module with TDD**

Create `supabase/functions/ai-draft-milestones/validate.ts`:

```ts
// Pure validation of Claude's structured output.
// Exported separately so it can be unit-tested without the full edge runtime.

export interface AiDraftCandidate {
  label: string;
  planned_date: string;
  boq_ids: string[];
  depends_on_labels: string[];
  confidence: number;
  explanation: string;
}

export interface ValidationResult {
  valid: AiDraftCandidate[];
  rejected: Array<{ candidate: unknown; reason: string }>;
}

export function validateDraftBatch(
  raw: unknown,
  validBoqIds: Set<string>,
  today: string, // ISO date
): ValidationResult {
  const result: ValidationResult = { valid: [], rejected: [] };

  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).milestones)) {
    return { valid: [], rejected: [{ candidate: raw, reason: 'payload missing "milestones" array' }] };
  }

  for (const c of (raw as { milestones: unknown[] }).milestones) {
    const reason = validateCandidate(c, validBoqIds, today);
    if (reason) {
      result.rejected.push({ candidate: c, reason });
    } else {
      const cast = c as AiDraftCandidate;
      result.valid.push({
        ...cast,
        boq_ids: cast.boq_ids.filter(id => validBoqIds.has(id)),
        confidence: Math.max(0, Math.min(1, cast.confidence)),
      });
    }
  }
  return result;
}

function validateCandidate(c: unknown, validBoqIds: Set<string>, today: string): string | null {
  if (!c || typeof c !== 'object') return 'not an object';
  const obj = c as Record<string, unknown>;

  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) return 'missing label';
  if (typeof obj.planned_date !== 'string') return 'missing planned_date';
  const date = obj.planned_date as string;
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return 'planned_date not ISO';
  if (date < today) return 'planned_date is in the past';

  if (!Array.isArray(obj.boq_ids)) return 'missing boq_ids array';
  if (!obj.boq_ids.every(x => typeof x === 'string')) return 'boq_ids must be strings';

  if (!Array.isArray(obj.depends_on_labels)) return 'missing depends_on_labels array';
  if (!obj.depends_on_labels.every(x => typeof x === 'string')) return 'depends_on_labels must be strings';

  if (typeof obj.confidence !== 'number' || Number.isNaN(obj.confidence)) return 'missing confidence';
  if (typeof obj.explanation !== 'string' || obj.explanation.trim().length === 0) return 'missing explanation';

  return null;
}

/**
 * Resolve depends_on_labels to depends_on (array of draft indices in the valid list),
 * then run a cycle check on the projected index graph. Returns the final drafts with
 * label references replaced by indices (still index-based until DB insert assigns UUIDs).
 */
export function resolveLabelRefs(
  valid: AiDraftCandidate[],
): Array<AiDraftCandidate & { depends_on_indices: number[] }> {
  const labelToIdx = new Map<string, number>();
  valid.forEach((v, i) => labelToIdx.set(v.label, i));

  return valid.map((v, idx) => {
    const indices = v.depends_on_labels
      .map(l => labelToIdx.get(l))
      .filter((x): x is number => x !== undefined && x !== idx);
    return { ...v, depends_on_indices: indices };
  });
}
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/functions/ai-draft-milestones/validate.test.ts`:

```ts
import { validateDraftBatch, resolveLabelRefs } from './validate';

const today = '2026-04-15';
const validBoqIds = new Set(['b1', 'b2', 'b3']);

describe('validateDraftBatch', () => {
  it('rejects payload with no milestones array', () => {
    const r = validateDraftBatch({}, validBoqIds, today);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('accepts a well-formed candidate', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'Pondasi',
        planned_date: '2026-06-01',
        boq_ids: ['b1', 'b2'],
        depends_on_labels: [],
        confidence: 0.85,
        explanation: 'Based on reference project',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it('drops unknown boq_ids but keeps the row', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'X',
        planned_date: '2026-06-01',
        boq_ids: ['b1', 'unknown'],
        depends_on_labels: [],
        confidence: 0.5,
        explanation: 'e',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].boq_ids).toEqual(['b1']);
  });

  it('rejects rows missing explanation', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'X',
        planned_date: '2026-06-01',
        boq_ids: [],
        depends_on_labels: [],
        confidence: 0.5,
        explanation: '',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/explanation/);
  });

  it('rejects past planned_date', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'X',
        planned_date: '2025-01-01',
        boq_ids: [],
        depends_on_labels: [],
        confidence: 0.5,
        explanation: 'e',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(0);
  });

  it('clamps confidence above 1 and below 0', () => {
    const r = validateDraftBatch({
      milestones: [
        { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: [], confidence: 1.5, explanation: 'e' },
        { label: 'B', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: [], confidence: -0.3, explanation: 'e' },
      ],
    }, validBoqIds, today);
    expect(r.valid.map(v => v.confidence)).toEqual([1, 0]);
  });
});

describe('resolveLabelRefs', () => {
  it('resolves valid label references to indices', () => {
    const resolved = resolveLabelRefs([
      { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: [], confidence: 1, explanation: 'e' },
      { label: 'B', planned_date: '2026-06-10', boq_ids: [], depends_on_labels: ['A'], confidence: 1, explanation: 'e' },
    ]);
    expect(resolved[1].depends_on_indices).toEqual([0]);
  });

  it('drops self-references', () => {
    const resolved = resolveLabelRefs([
      { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: ['A'], confidence: 1, explanation: 'e' },
    ]);
    expect(resolved[0].depends_on_indices).toEqual([]);
  });

  it('drops unknown label references', () => {
    const resolved = resolveLabelRefs([
      { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: ['Unknown'], confidence: 1, explanation: 'e' },
    ]);
    expect(resolved[0].depends_on_indices).toEqual([]);
  });
});
```

Note: Jest needs to be configured to run files under `supabase/functions/ai-draft-milestones/`. Check `jest.config.js` `testMatch` to verify it picks up `**/*.test.ts` globally; if it's restricted to `tools/__tests__`, either widen it or move the validator test to `tools/__tests__/ai-draft-validate.test.ts` and re-export the module from a thin `tools/` wrapper. Pick the least-invasive option based on current Jest config.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx jest validate.test
```
Expected: tests load and fail (module not found) or pass (if you got it right first time). Iterate until all 8 tests pass.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest validate.test
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-draft-milestones/validate.ts supabase/functions/ai-draft-milestones/validate.test.ts
git commit -m "feat(edge): ai-draft-milestones validator with schema + label refs"
```

---

## Task 23: `ai-draft-milestones` edge function — Claude call + persistence

**Files:**
- Modify: `supabase/functions/ai-draft-milestones/index.ts`

- [ ] **Step 1: Write the edge function entrypoint**

Create `supabase/functions/ai-draft-milestones/index.ts`:

```ts
// SANO — AI Draft Milestones Edge Function
// Spec: docs/superpowers/specs/2026-04-15-jadwal-milestone-authoring-design.md §6
// Pinned to claude-sonnet-4-6; no rate limiting; validates output strictly.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { validateDraftBatch, resolveLabelRefs, type AiDraftCandidate } from './validate.ts';

const MODEL = Deno.env.get('AI_DRAFT_MODEL') ?? 'claude-sonnet-4-6';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DraftRequest {
  project_id: string;
  user_id: string;
  parameters: {
    project_type: string;
    duration_months: number;
    mandor_count: number;
    shift_mode: '1_shift' | '2_shift' | 'harian';
    site_notes?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body: DraftRequest = await req.json();
    const { project_id, user_id, parameters } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 0. Idempotency: suppress duplicate triggers within 30s ───────
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    const { data: recent } = await supabase
      .from('ai_draft_runs')
      .select('id, committed_milestone_ids, response_summary, completed_at')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .gte('created_at', thirtySecAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (recent && recent[0] && recent[0].completed_at) {
      return json({
        success: true,
        reused: true,
        summary: recent[0].response_summary,
        committed_milestone_ids: recent[0].committed_milestone_ids,
      });
    }

    // ── 1. Fetch published BoQ ──────────────────────────────────────
    const { data: boqItems } = await supabase
      .from('boq_items')
      .select('id, code, label, unit, chapter, sort_order')
      .eq('project_id', project_id)
      .order('sort_order');

    if (!boqItems || boqItems.length === 0) {
      return json({ success: false, error: 'Baseline belum dipublikasi.' }, 400);
    }

    // ── 2. Reference-class lookup (top-3 similar past projects) ─────
    const references = await fetchReferenceClass(supabase, project_id, boqItems);

    // ── 3. Build prompt and call Claude ─────────────────────────────
    const prompt = buildPrompt(parameters, boqItems, references);
    const promptHash = await hashString(prompt);

    // Insert audit row (pending)
    const { data: runRow, error: runErr } = await supabase
      .from('ai_draft_runs')
      .insert({
        project_id,
        user_id,
        parameters,
        prompt_hash: promptHash,
        response_summary: { status: 'pending' },
        model: MODEL,
      })
      .select()
      .single();
    if (runErr || !runRow) {
      return json({ success: false, error: 'Gagal menyimpan audit run.' }, 500);
    }

    const claudeResult = await callClaudeWithRetry(prompt, 1);
    if (!claudeResult.ok) {
      await supabase.from('ai_draft_runs').update({
        response_summary: { status: 'failed', error: claudeResult.error },
        completed_at: new Date().toISOString(),
      }).eq('id', runRow.id);
      return json({ success: false, error: 'AI tidak dapat membuat draf. Silakan coba lagi atau buat milestone manual.' }, 500);
    }

    // ── 4. Validate + resolve label refs ─────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const validBoqIdSet = new Set(boqItems.map(b => b.id));
    const validation = validateDraftBatch(claudeResult.parsed, validBoqIdSet, today);
    const resolved = resolveLabelRefs(validation.valid);

    if (resolved.length === 0) {
      await supabase.from('ai_draft_runs').update({
        response_summary: {
          status: 'failed',
          proposed: validation.valid.length + validation.rejected.length,
          rejected: validation.rejected.length,
        },
        completed_at: new Date().toISOString(),
      }).eq('id', runRow.id);
      return json({ success: false, error: 'Semua usulan AI tidak valid.' }, 500);
    }

    // ── 5. Persist drafts (two-pass: insert then patch depends_on) ──
    const firstPass = resolved.map(r => ({
      project_id,
      label: r.label,
      planned_date: r.planned_date,
      boq_ids: r.boq_ids,
      depends_on: [],
      proposed_by: 'ai',
      confidence_score: r.confidence,
      ai_explanation: r.explanation,
      author_status: 'draft',
      status: 'ON_TRACK',
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('milestones')
      .insert(firstPass)
      .select();
    if (insertErr || !inserted) {
      return json({ success: false, error: insertErr?.message ?? 'Gagal menyimpan draf.' }, 500);
    }

    // Patch depends_on with actual UUIDs now that rows have IDs.
    // resolved[i] maps to inserted[i] by position since we inserted in order.
    for (let i = 0; i < resolved.length; i++) {
      const idxDeps = resolved[i].depends_on_indices;
      if (idxDeps.length === 0) continue;
      const predIds = idxDeps.map(idx => inserted[idx].id);
      await supabase
        .from('milestones')
        .update({ depends_on: predIds })
        .eq('id', inserted[i].id);
    }

    // ── 6. Finalize audit row ────────────────────────────────────────
    await supabase.from('ai_draft_runs').update({
      committed_milestone_ids: inserted.map(r => r.id),
      response_summary: {
        status: 'ok',
        proposed: validation.valid.length + validation.rejected.length,
        rejected: validation.rejected.length,
        committed: inserted.length,
      },
      completed_at: new Date().toISOString(),
    }).eq('id', runRow.id);

    return json({
      success: true,
      committed_milestone_ids: inserted.map(r => r.id),
      summary: {
        proposed: validation.valid.length + validation.rejected.length,
        rejected: validation.rejected.length,
        committed: inserted.length,
      },
    });
  } catch (err) {
    console.error('ai-draft-milestones error:', err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

async function hashString(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Reference-class lookup (§6 step 2) ───────────────────────────────

async function fetchReferenceClass(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  boqItems: Array<{ id: string; code: string; label: string }>,
): Promise<Array<{ project_id: string; milestones: Array<{ label: string; offset_days: number }> }>> {
  // Minimal v1: pull the 3 most recently created projects (excluding current)
  // that have at least one confirmed, non-deleted milestone and share ≥1 BoQ code.
  // Spec 2 will replace this with proper AHS/BoQ similarity scoring.

  const codes = new Set(boqItems.map(b => b.code));

  const { data: candidateProjects } = await supabase
    .from('projects')
    .select('id, created_at')
    .neq('id', projectId)
    .order('created_at', { ascending: false })
    .limit(20);

  const results: Array<{ project_id: string; milestones: Array<{ label: string; offset_days: number }> }> = [];
  for (const p of candidateProjects ?? []) {
    if (results.length >= 3) break;

    const { data: pBoq } = await supabase
      .from('boq_items')
      .select('code')
      .eq('project_id', p.id)
      .limit(200);

    const overlap = (pBoq ?? []).filter(b => codes.has(b.code)).length;
    if (overlap < 3) continue;

    const { data: pMs } = await supabase
      .from('milestones')
      .select('label, planned_date')
      .eq('project_id', p.id)
      .eq('author_status', 'confirmed')
      .is('deleted_at', null)
      .order('planned_date');

    if (!pMs || pMs.length === 0) continue;
    const firstDate = new Date(pMs[0].planned_date).getTime();
    results.push({
      project_id: p.id,
      milestones: pMs.map(m => ({
        label: m.label,
        offset_days: Math.round((new Date(m.planned_date).getTime() - firstDate) / 86400000),
      })),
    });
  }
  return results;
}

// ── Prompt builder (§6 step 3) ───────────────────────────────────────

function buildPrompt(
  params: DraftRequest['parameters'],
  boqItems: Array<{ code: string; label: string; chapter: string | null; unit: string }>,
  references: Array<{ project_id: string; milestones: Array<{ label: string; offset_days: number }> }>,
): string {
  const boqByChapter = new Map<string, Array<{ code: string; label: string; unit: string }>>();
  for (const b of boqItems) {
    const ch = b.chapter ?? 'Tanpa Chapter';
    if (!boqByChapter.has(ch)) boqByChapter.set(ch, []);
    boqByChapter.get(ch)!.push({ code: b.code, label: b.label, unit: b.unit });
  }

  const boqBlock = Array.from(boqByChapter.entries())
    .map(([ch, items]) => `${ch}:\n${items.map(i => `  ${i.code} — ${i.label} (${i.unit})`).join('\n')}`)
    .join('\n\n');

  const refBlock = references.length === 0
    ? 'Tidak ada proyek referensi — andalkan parameter dan struktur BoQ saja.'
    : references.map((r, i) => `Proyek referensi ${i + 1}:\n${r.milestones.map(m => `  +${m.offset_days}hari: ${m.label}`).join('\n')}`).join('\n\n');

  return `Anda adalah Claude bertugas sebagai prior elicitor (Role 7) untuk sistem penjadwalan proyek konstruksi Indonesia.

TUGAS: Buatkan draf milestone untuk proyek ini. Output HARUS mengikuti skema JSON yang diminta, dengan confidence (0..1) dan explanation untuk setiap milestone.

PARAMETER PROYEK:
- Jenis: ${params.project_type}
- Durasi target: ${params.duration_months} bulan
- Jumlah mandor aktif: ${params.mandor_count}
- Shift: ${params.shift_mode}
${params.site_notes ? `- Catatan site: ${params.site_notes}` : ''}

BOQ YANG DIPUBLIKASI (gunakan boq_ids yang SAMA PERSIS dengan code di bawah):
${boqBlock}

REFERENSI DARI PROYEK SEBELUMNYA:
${refBlock}

INSTRUKSI:
1. Susun 6–12 milestone yang mencerminkan fase kerja realistis.
2. Setiap milestone boleh (tapi tidak wajib) terhubung ke item BoQ.
3. Gunakan depends_on_labels untuk menyatakan dependensi antar-milestone dalam set yang Anda usulkan.
4. planned_date harus ≥ hari ini dan logis vs durasi proyek.
5. confidence = seberapa yakin Anda (0..1). explanation = alasan singkat 1-2 kalimat.

OUTPUT SCHEMA (wajib persis):
{
  "milestones": [
    {
      "label": string,
      "planned_date": "YYYY-MM-DD",
      "boq_ids": [string],
      "depends_on_labels": [string],
      "confidence": number,
      "explanation": string
    }
  ]
}

Kembalikan HANYA JSON tanpa prose apapun.`;
}

// ── Claude call with one retry (§6 step 5) ───────────────────────────

async function callClaudeWithRetry(
  prompt: string,
  retries: number,
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const systemNote = attempt === 0
      ? 'Output MUST be valid JSON matching the requested schema.'
      : 'CRITICAL: Output MUST match the schema exactly. Return only JSON. No prose.';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: systemNote,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        if (attempt === retries) return { ok: false, error: `Claude API ${resp.status}` };
        continue;
      }
      const data = await resp.json();
      const text = data?.content?.[0]?.text ?? '';
      try {
        const parsed = JSON.parse(extractJson(text));
        return { ok: true, parsed };
      } catch {
        if (attempt === retries) return { ok: false, error: 'Could not parse Claude JSON' };
        continue;
      }
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: false, error: 'Retry loop exhausted' };
}

function extractJson(text: string): string {
  // Claude sometimes wraps in ```json ... ``` blocks. Strip them.
  const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
  if (match) return match[1];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);
  return text;
}
```

- [ ] **Step 2: Local deploy check**

```bash
supabase functions deploy ai-draft-milestones --no-verify-jwt
```
Expected: function deploys. If you don't have the Supabase CLI linked locally, skip deploy and run:
```bash
deno check supabase/functions/ai-draft-milestones/index.ts
```
Expected: type-checks clean.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-draft-milestones/index.ts
git commit -m "feat(edge): ai-draft-milestones Claude call + persistence"
```

---

## Task 24: `MilestoneAiDraftScreen` — parameters form

**Files:**
- Modify: `workflows/screens/MilestoneAiDraftScreen.tsx` (replace placeholder)

- [ ] **Step 1: Replace the placeholder with the parameters form**

Replace the contents of `workflows/screens/MilestoneAiDraftScreen.tsx`:

```tsx
import React, { useState, useRef } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

interface Props {
  onBack: () => void;
}

type ShiftMode = '1_shift' | '2_shift' | 'harian';

const PROJECT_TYPES = [
  'Rumah Tinggal',
  'Ruko',
  'Gedung Bertingkat',
  'Renovasi',
  'Lainnya',
];

const PROGRESS_STAGES = [
  'Mencocokkan dengan proyek serupa…',
  'Menganalisis struktur BoQ…',
  'Menyusun urutan milestone…',
];

export default function MilestoneAiDraftScreen({ onBack }: Props) {
  const { project, profile, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const [projectType, setProjectType] = useState<string>('Rumah Tinggal');
  const [duration, setDuration] = useState('6');
  const [mandorCount, setMandorCount] = useState('3');
  const [shiftMode, setShiftMode] = useState<ShiftMode>('1_shift');
  const [siteNotes, setSiteNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const lastClickAt = useRef(0);

  const isValid =
    projectType.length > 0 &&
    /^\d+$/.test(duration) && parseInt(duration, 10) > 0 &&
    /^\d+$/.test(mandorCount) && parseInt(mandorCount, 10) > 0;

  const handleGenerate = async () => {
    if (!project || !profile) return;
    if (boqItems.length === 0) { toast('Baseline belum dipublikasi', 'critical'); return; }
    if (!isValid) { toast('Isi semua parameter wajib', 'critical'); return; }

    // Client-side debounce (spec §6)
    const now = Date.now();
    if (now - lastClickAt.current < 30_000) {
      toast('Tunggu sebentar sebelum mencoba lagi', 'warning');
      return;
    }
    lastClickAt.current = now;

    setSubmitting(true);
    setStageIdx(0);
    const stageTimer = setInterval(() => {
      setStageIdx(i => (i < PROGRESS_STAGES.length - 1 ? i + 1 : i));
    }, 2500);

    try {
      const { data, error } = await supabase.functions.invoke('ai-draft-milestones', {
        body: {
          project_id: project.id,
          user_id: profile.id,
          parameters: {
            project_type: projectType,
            duration_months: parseInt(duration, 10),
            mandor_count: parseInt(mandorCount, 10),
            shift_mode: shiftMode,
            site_notes: siteNotes.trim() || undefined,
          },
        },
      });

      clearInterval(stageTimer);
      if (error || !data || data.success !== true) {
        toast((data && data.error) || error?.message || 'AI draft gagal', 'critical');
        return;
      }
      toast(`${data.summary?.committed ?? 0} draf dibuat`, 'ok');
      await refresh();
      onBack();
    } catch (err: any) {
      clearInterval(stageTimer);
      toast(err.message ?? 'Gagal memanggil AI', 'critical');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={onBack} disabled={submitting}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Saran Jadwal AI</Text>
        <Text style={styles.hint}>AI akan membaca BoQ yang dipublikasi dan menyarankan milestone awal untuk direview.</Text>

        <Card>
          <Text style={styles.label}>Jenis Proyek <Text style={styles.req}>*</Text></Text>
          <View style={styles.pillRow}>
            {PROJECT_TYPES.map(t => {
              const active = t === projectType;
              return (
                <TouchableOpacity key={t} style={[styles.pill, active && styles.pillActive]} onPress={() => setProjectType(t)}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Durasi Target Proyek (bulan) <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="numeric" />

          <Text style={styles.label}>Jumlah Mandor Aktif <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={mandorCount} onChangeText={setMandorCount} keyboardType="numeric" />

          <Text style={styles.label}>Shift Kerja <Text style={styles.req}>*</Text></Text>
          <View style={styles.pillRow}>
            {([
              ['1_shift', '1 Shift'],
              ['2_shift', '2 Shift'],
              ['harian', 'Harian/Borongan'],
            ] as Array<[ShiftMode, string]>).map(([key, label]) => {
              const active = key === shiftMode;
              return (
                <TouchableOpacity key={key} style={[styles.pill, active && styles.pillActive]} onPress={() => setShiftMode(key)}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Catatan Kondisi Site</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={siteNotes}
            onChangeText={setSiteNotes}
            multiline
            placeholder="mis. akses terbatas, tanah lembek"
          />
        </Card>

        <Card>
          <Text style={styles.hint}>
            AI akan membaca <Text style={{ fontFamily: FONTS.semibold }}>{boqItems.length} item BoQ</Text> dari baseline yang dipublikasi.
          </Text>
        </Card>

        {submitting ? (
          <Card borderColor={COLORS.primary}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.hint}>{PROGRESS_STAGES[stageIdx]}</Text>
            </View>
          </Card>
        ) : (
          <TouchableOpacity style={[styles.primaryBtn, !isValid && { opacity: 0.5 }]} onPress={handleGenerate} disabled={!isValid}>
            <Ionicons name="sparkles" size={16} color={COLORS.textInverse} />
            <Text style={styles.primaryBtnText}>Buat Draf Jadwal →</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  title: { fontSize: TYPE.lg, fontFamily: FONTS.bold },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 4 },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginTop: SPACE.sm + 2, marginBottom: 6 },
  req: { color: COLORS.critical },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  pillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: TYPE.xs, color: COLORS.text },
  pillTextActive: { color: COLORS.textInverse, fontFamily: FONTS.semibold },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, marginTop: SPACE.md },
  primaryBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/MilestoneAiDraftScreen.tsx
git commit -m "feat(ui): MilestoneAiDraftScreen parameters form + edge invoke"
```

---

## Task 25: `MilestoneAiReviewScreen` — draft card list

**Files:**
- Modify: `workflows/screens/MilestoneAiReviewScreen.tsx` (replace placeholder)

- [ ] **Step 1: Replace the placeholder with the review screen**

Replace `workflows/screens/MilestoneAiReviewScreen.tsx` with:

```tsx
import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { updateMilestone, deleteMilestone } from '../../tools/schedule';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { Milestone } from '../../tools/types';

interface Props {
  onBack: () => void;
}

function confidenceColor(score: number | null): string {
  if (score == null) return COLORS.border;
  if (score >= 0.8) return COLORS.ok;
  if (score >= 0.5) return COLORS.info;
  return COLORS.warning;
}

export default function MilestoneAiReviewScreen({ onBack }: Props) {
  const { milestoneDrafts, milestones, refresh } = useProject();
  const { show: toast } = useToast();

  const [checked, setChecked] = useState<Set<string>>(() => {
    const out = new Set<string>();
    for (const d of milestoneDrafts) {
      if ((d.confidence_score ?? 0) >= 0.5) out.add(d.id);
    }
    return out;
  });

  const lowConfidenceCount = useMemo(
    () => milestoneDrafts.filter(d => (d.confidence_score ?? 0) < 0.5).length,
    [milestoneDrafts],
  );

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCommit = async () => {
    const ids = Array.from(checked);
    if (ids.length === 0) { toast('Pilih minimal satu milestone', 'critical'); return; }

    let ok = 0;
    for (const id of ids) {
      const result = await updateMilestone(id, { author_status: 'confirmed' });
      if (result.success) ok++;
    }
    toast(`${ok} milestone dikonfirmasi`, 'ok');
    await refresh();
    onBack();
  };

  const handleAbandonAll = () => {
    Alert.alert(
      'Buang semua draf?',
      `${milestoneDrafts.length} draf akan dihapus.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Buang',
          style: 'destructive',
          onPress: async () => {
            for (const d of milestoneDrafts) await deleteMilestone(d.id);
            toast('Semua draf dibuang', 'ok');
            await refresh();
            onBack();
          },
        },
      ],
    );
  };

  const handleDiscardOne = async (d: Milestone) => {
    const result = await deleteMilestone(d.id);
    if (!result.success) { toast(result.error, 'critical'); return; }
    toast('Draf dibuang', 'ok');
    await refresh();
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Review Draf AI</Text>

        {lowConfidenceCount > 0 && (
          <Card borderColor={COLORS.warning}>
            <Text style={styles.hint}>
              ⚠️ {lowConfidenceCount} milestone dengan confidence rendah — perlu review ekstra
            </Text>
          </Card>
        )}

        {milestoneDrafts.length === 0 && (
          <Card>
            <Text style={styles.hint}>Tidak ada draf AI.</Text>
          </Card>
        )}

        {milestoneDrafts.map(d => {
          const isChecked = checked.has(d.id);
          const depLabels = d.depends_on
            .map(depId => [...milestoneDrafts, ...milestones].find(m => m.id === depId)?.label)
            .filter(Boolean) as string[];
          return (
            <Card key={d.id} borderColor={confidenceColor(d.confidence_score)}>
              <TouchableOpacity style={styles.cardHead} onPress={() => toggle(d.id)}>
                <View style={[styles.checkbox, isChecked && styles.checkboxOn]}>
                  {isChecked && <Ionicons name="checkmark" size={14} color={COLORS.textInverse} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msLabel}>{d.label}</Text>
                  <Text style={styles.hint}>
                    Target: {new Date(d.planned_date).toLocaleDateString('id-ID')}
                    {' · '}
                    {d.boq_ids.length} item BoQ
                  </Text>
                  {depLabels.length > 0 && (
                    <Text style={styles.hint}>Tergantung pada: {depLabels.join(', ')}</Text>
                  )}
                  <Text style={[styles.hint, { fontStyle: 'italic', marginTop: 4 }]}>
                    {d.ai_explanation ?? ''}
                  </Text>
                  <Text style={styles.hint}>
                    Confidence: {d.confidence_score != null ? `${Math.round(d.confidence_score * 100)}%` : '—'}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.discardBtn} onPress={() => handleDiscardOne(d)}>
                <Ionicons name="trash-outline" size={12} color={COLORS.critical} />
                <Text style={styles.discardText}>Buang</Text>
              </TouchableOpacity>
            </Card>
          );
        })}

        {milestoneDrafts.length > 0 && (
          <View style={{ gap: SPACE.sm, marginTop: SPACE.md }}>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCommit}>
              <Text style={styles.primaryBtnText}>Buat {checked.size} Milestone</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleAbandonAll}>
              <Text style={styles.secondaryBtnText}>Batal — Buang Semua Draf</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  title: { fontSize: TYPE.lg, fontFamily: FONTS.bold, marginBottom: SPACE.sm },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  msLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold },
  discardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: SPACE.sm, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS, paddingHorizontal: 8, paddingVertical: 4 },
  discardText: { color: COLORS.critical, fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  primaryBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  secondaryBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.textSec, fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add workflows/screens/MilestoneAiReviewScreen.tsx
git commit -m "feat(ui): MilestoneAiReviewScreen with confidence-tier card list"
```

---

# Phase 8 — Polish

## Task 26: Stale BoQ banner on `MilestoneScreen`

**Files:**
- Modify: `workflows/screens/MilestoneScreen.tsx`

- [ ] **Step 1: Compute stale count from current `boqItems` + `milestones`**

In `MilestonePanel`, after the destructure, add:

```tsx
const { boqItems } = useProject();
const staleMilestoneCount = useMemo(() => {
  const liveBoqIds = new Set(boqItems.map(b => b.id));
  return milestones.filter(m =>
    m.boq_ids.length > 0 && m.boq_ids.some(id => !liveBoqIds.has(id))
  ).length;
}, [boqItems, milestones]);
```

- [ ] **Step 2: Render the banner above the list**

Just above `<Text style={styles.sectionHead}>Daftar Milestone</Text>`:

```tsx
{staleMilestoneCount > 0 && (
  <Card borderColor={COLORS.warning}>
    <Text style={styles.hint}>
      ⚠️ Baseline dipublish ulang — {staleMilestoneCount} milestone mungkin perlu ditinjau
    </Text>
  </Card>
)}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add workflows/screens/MilestoneScreen.tsx
git commit -m "feat(ui): stale BoQ reference banner on MilestoneScreen"
```

---

## Task 27: Abandoned draft auto-cleanup

**Files:**
- Modify: `workflows/hooks/useProject.tsx`
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Add `autoPurgeStaleDrafts` helper**

Append to `tools/schedule.ts`:

```ts
/**
 * Soft-deletes AI drafts older than 14 days for this project. Janitorial —
 * no user notification. Returns the count purged.
 * Spec §9 "Abandoned drafts".
 */
export async function autoPurgeStaleDrafts(projectId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: stale, error } = await supabase
    .from('milestones')
    .select('id')
    .eq('project_id', projectId)
    .eq('author_status', 'draft')
    .is('deleted_at', null)
    .lt('created_at', cutoff);

  if (error || !stale || stale.length === 0) return 0;

  const nowIso = new Date().toISOString();
  for (const row of stale) {
    await supabase
      .from('milestones')
      .update({ deleted_at: nowIso })
      .eq('id', row.id);
  }
  return stale.length;
}
```

- [ ] **Step 2: Wire it into `loadProjectData`**

In `useProject.tsx`, after the `setMilestoneDrafts(results[6].data ?? []);` line:

```tsx
import { autoPurgeStaleDrafts } from '../../tools/schedule';
// ... inside loadProjectData, after the setMilestoneDrafts call:
const purged = await autoPurgeStaleDrafts(pid);
if (purged > 0) {
  console.log(`[auto-purge] removed ${purged} stale drafts`);
}
```

(Add the import at the top of the file.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tools/schedule.ts workflows/hooks/useProject.tsx
git commit -m "feat(schedule): auto-purge stale AI drafts older than 14 days"
```

---

## Task 28: Activity log entries for authoring actions

**Files:**
- Modify: `tools/schedule.ts`

- [ ] **Step 1: Emit activity log on create/update/delete**

In `tools/schedule.ts`, find each of `createMilestone`, `updateMilestone`, `deleteMilestone` and after their successful-write point, append:

For `createMilestone` (after `{ success: true, data: inserted as Milestone }`):

```ts
// Just before the return:
await supabase.from('activity_log').insert({
  project_id: input.project_id,
  user_id: null, // no user context in this layer; fill in higher layers if needed
  type: 'permintaan',
  label: `Milestone "${label}" dibuat (${input.proposed_by ?? 'human'})`,
  flag: 'INFO',
});
```

For `updateMilestone` (after success write):

```ts
await supabase.from('activity_log').insert({
  project_id: current.project_id,
  user_id: null,
  type: 'permintaan',
  label: `Milestone "${projected.label}" diperbarui`,
  flag: 'INFO',
});
```

For `deleteMilestone` (after cascade loop):

```ts
await supabase.from('activity_log').insert({
  project_id: current.project_id,
  user_id: null,
  type: 'permintaan',
  label: `Milestone "${current.label}" dihapus (cascade: ${cleanups.length})`,
  flag: 'WARNING',
});
```

Note: the existing `reviseMilestone` uses `type: 'permintaan'` as a placeholder; mirror that convention. A proper taxonomy extension belongs in a separate schema migration and is out of scope for this plan.

- [ ] **Step 2: Re-run the schedule tests**

```bash
npx jest tools/__tests__/schedule.test.ts
```
Expected: all tests still pass. (The activity_log insert is fire-and-forget via the mocked supabase — the mocks won't be configured for it but since nothing awaits the return value for a result, tests should stay green. If any tests fail due to mock chain missing, add an insert chain to the mock.)

- [ ] **Step 3: Commit**

```bash
git add tools/schedule.ts
git commit -m "feat(schedule): activity log entries for milestone create/update/delete"
```

---

# Post-implementation: manual QA checklist

Run through all of the following on both iOS and Android simulators (at minimum) against a project with a published baseline:

- [ ] `+ Tambah Milestone` opens the form, save path works end-to-end, new milestone appears in the list in correct topological position.
- [ ] Edit a milestone, change its name + date, save, list updates.
- [ ] Create a milestone B depending on A. Confirm B shows `Tergantung pada: [A]` chip.
- [ ] Delete milestone A; B shows `[dihapus]` chip or empty predecessor list (depending on cascade cleanup completing).
- [ ] Try to save a milestone whose date is before its predecessor — rejection toast names the conflict.
- [ ] Try to create a cycle A depends on B which already depends on A — rejection toast.
- [ ] BoQ picker: scroll 100+ items, filter chips, search, select 4, save.
- [ ] Predecessor picker: 10+ existing milestones, exclude self and descendants, multi-select, remove chip.
- [ ] `✨ Saran Jadwal AI` — fill form, submit, progress indicator cycles through 3 stages, review screen shows the drafts with confidence-tiered borders.
- [ ] Draft review: low-confidence warning bar appears, commit 3 of 5, remaining 2 stay as drafts, draft banner appears on MilestoneScreen.
- [ ] `Lanjutkan Review` returns to the review screen; `Buang Semua` clears the drafts.
- [ ] Republish baseline removing one BoQ item; stale banner appears on jadwal if any milestone referenced the removed item.
- [ ] Supervisor role: logs in, sees the list with chips and AI badge, but NO entry row, NO draft banner, NO Edit/Hapus buttons.
- [ ] `Revisi` (existing flow) still works and still writes to `milestone_revisions`.
- [ ] Publish a baseline — the success screen shows `Atur Jadwal →` and it navigates to the Jadwal tab.

If any of these fail, file a follow-up task in this plan rather than shipping.

---

# References

- Spec: [docs/superpowers/specs/2026-04-15-jadwal-milestone-authoring-design.md](../specs/2026-04-15-jadwal-milestone-authoring-design.md)
- Forecasting research (for Spec 2 context): [SAN_Forecasting_Research.md](../../../SAN_Forecasting_Research.md)
- Existing patterns referenced:
  - [tools/schedule.ts:18](../../../tools/schedule.ts#L18) — `deriveMilestoneStatus`
  - [tools/schedule.ts:120](../../../tools/schedule.ts#L120) — `reviseMilestone` (untouched)
  - [workflows/screens/MilestoneScreen.tsx:35](../../../workflows/screens/MilestoneScreen.tsx#L35) — `canRevise` pattern
  - [workflows/screens/LaporanScreen.tsx:228](../../../workflows/screens/LaporanScreen.tsx#L228) — takeover pattern
  - [supabase/functions/ai-assist/index.ts](../../../supabase/functions/ai-assist/index.ts) — edge function template
