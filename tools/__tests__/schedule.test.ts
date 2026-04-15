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
    expect((result as { success: false; error: string }).error).toMatch(/nama/i);
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
    expect((result as { success: false; error: string }).error).toMatch(/sudah ada/i);
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
    expect((result as { success: false; error: string }).error).toMatch(/tanggal/i);
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
    expect((result as { success: false; error: string }).error).toMatch(/tidak ditemukan/i);
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
    expect((result as { success: false; error: string }).error).toMatch(/siklus/i);
  });
});

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
