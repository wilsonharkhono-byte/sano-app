jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { topologicalSort, validateNoCycle } from '../schedule';
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
