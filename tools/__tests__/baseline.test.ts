/**
 * Unit tests for tools/baseline.ts — getStagingRows.
 *
 * CRITICAL: these tests must NOT hit any real database. We mock the supabase
 * module (`jest.mock('../supabase')`), following the same idiom as
 * derivation.test.ts / queryHelpers.test.ts.
 *
 * Covers the truth-contract bug fixed here: getStagingRows used a single
 * unpaginated `.select('*')` (Supabase's 1000-row cap silently truncates a
 * large Audit-Trace session) and swallowed query errors as `[]` (a failed
 * query looked like an empty, successfully-loaded session).
 */

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { getStagingRows } from '../baseline';
import { supabase } from '../supabase';
import type { ImportStagingRow } from '../types';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

function makeRow(n: number): ImportStagingRow {
  return {
    id: `row-${n}`,
    session_id: 'sess-1',
    row_number: n,
    row_type: 'boq',
    raw_data: {},
    parsed_data: null,
    confidence: 1,
    needs_review: false,
    review_status: 'PENDING',
    reviewer_notes: null,
    created_at: '2026-01-01T00:00:00Z',
  } as ImportStagingRow;
}

/**
 * Range-aware chainable query stub: unlike derivation.test.ts's makeQuery
 * (which ignores .range() and always returns the full fixture), this one
 * slices `rows` by whatever `.range(from, to)` was actually called with, so
 * pagination across multiple fetchAllPaged pages can be exercised for real.
 * A fresh chain object is returned per `.from()` call so pages don't share
 * mutable range state.
 */
function makePagedFromMock(rows: ImportStagingRow[]) {
  return jest.fn(() => {
    const chain: Record<string, unknown> = {};
    // Default range mirrors real PostgREST/Supabase behavior: with no explicit
    // .range() call, the server still caps the result at 1000 rows starting
    // from 0. This is what makes an unpaginated `.select('*')` truncate.
    let range: [number, number] = [0, 999];
    for (const method of ['select', 'eq', 'order']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.range = jest.fn((from: number, to: number) => {
      range = [from, to];
      return chain;
    });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const [from, to] = range;
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve);
    };
    return chain;
  });
}

function makeErrorFromMock(message: string) {
  return jest.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'range']) {
      chain[method] = jest.fn(() => chain);
    }
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message } }).then(resolve);
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStagingRows', () => {
  it('returns ALL rows across more than one page (past the 1000-row cap)', async () => {
    // 1200 rows: page 1 = rows 0..999 (full page, keep going), page 2 = rows
    // 1000..1199 (short page, stop). A pre-fix unpaginated select would only
    // ever see the first page Supabase hands back.
    const rows = Array.from({ length: 1200 }, (_, i) => makeRow(i + 1));
    (mockSupabase.from as jest.Mock).mockImplementation(makePagedFromMock(rows));

    const result = await getStagingRows('sess-1');

    expect(result).toHaveLength(1200);
    expect(result.map(r => r.row_number)).toEqual(rows.map(r => r.row_number));
  });

  it('throws on a query error instead of silently returning []', async () => {
    (mockSupabase.from as jest.Mock).mockImplementation(makeErrorFromMock('connection reset'));

    await expect(getStagingRows('sess-1')).rejects.toThrow('connection reset');
  });

  it('still applies needsReview/rowType filters (single-page case unaffected)', async () => {
    const rows = [makeRow(1), makeRow(2)];
    const fromMock = makePagedFromMock(rows);
    (mockSupabase.from as jest.Mock).mockImplementation(fromMock);

    const result = await getStagingRows('sess-1', { needsReview: true, rowType: 'ahs' });

    expect(result).toHaveLength(2);
    const chain = fromMock.mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('session_id', 'sess-1');
    expect(chain.eq).toHaveBeenCalledWith('needs_review', true);
    expect(chain.eq).toHaveBeenCalledWith('row_type', 'ahs');
  });
});
