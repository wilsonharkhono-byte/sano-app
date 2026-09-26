/**
 * "Perlu ditindak" reads migration 106's v_site_event_attention, the same
 * predicate the morning digest counts, and the office health line reads
 * v_site_event_digest_health. A failed read is an error, never an empty list
 * or a "never sent" (closure spec 2026-09-26 §1.1 rule 4).
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import {
  ATTENTION_COLUMNS,
  ATTENTION_LIMIT,
  attentionChips,
  attentionEmptyText,
  attentionHeading,
  attentionMineRequest,
  attentionRoomLabel,
  filterMine,
  getDigestHealth,
  listSiteEventAttention,
  type AttentionRow,
} from '../siteEventAttention';

const mocked = supabase as unknown as { from: jest.Mock };
const calls: string[] = [];

/** Records every builder call and resolves to `result` whichever method is awaited last. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'maybeSingle']) {
    c[name] = (...args: unknown[]) => {
      calls.push(`${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
      return c;
    };
  }
  c.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  event_id: 'e1', project_id: 'p1', room_id: 'r1', room_code: 'LT1-R01', room_name: 'Kamar Tidur 1', floor: '1',
  gate_code: null, event_type: 'isu', title: 'Retak dinding', summary: null, owner_id: 'u1', owner_name: 'Budi',
  owner_on_project: true, due_date: '2026-09-14', is_blocking: false, confirmed_at: '2026-09-12T02:00:00Z',
  is_overdue: true, days_overdue: 3, ...over,
});

beforeEach(() => {
  calls.length = 0;
  mocked.from.mockReset();
});

describe('listSiteEventAttention', () => {
  it('reads one project, longest overdue first, capped at 200', async () => {
    mocked.from.mockReturnValueOnce(chain({ data: [row()], error: null }));
    const result = await listSiteEventAttention('p1');
    expect(result).toEqual({ rows: [row()] });
    expect(mocked.from).toHaveBeenCalledWith('v_site_event_attention');
    expect(calls).toEqual([
      `select:${JSON.stringify(ATTENTION_COLUMNS)}`,
      'eq:"project_id":"p1"',
      'order:"days_overdue":{"ascending":false}',
      'order:"due_date":{"ascending":true}',
      'order:"confirmed_at":{"ascending":true}',
      'order:"event_id":{"ascending":true}',
      `limit:${ATTENTION_LIMIT}`,
    ]);
  });

  it('returns the error, never an empty list, when the read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockReturnValueOnce(chain({ data: null, error: { message: 'network down' } }));
    expect(await listSiteEventAttention('p1')).toEqual({ error: 'network down' });
    warn.mockRestore();
  });
});

describe('getDigestHealth', () => {
  it('returns the latest run', async () => {
    const last = { last_run_date: '2026-09-17', last_sent_at: '2026-09-17T00:00:04Z', recipients: 4 };
    mocked.from.mockReturnValueOnce(chain({ data: last, error: null }));
    expect(await getDigestHealth()).toEqual({ last });
    expect(mocked.from).toHaveBeenCalledWith('v_site_event_digest_health');
  });

  it('returns last: null only when the view has no row', async () => {
    mocked.from.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await getDigestHealth()).toEqual({ last: null });
  });

  it('returns the error, never "never sent", when the read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockReturnValueOnce(chain({ data: null, error: { message: 'permission denied' } }));
    expect(await getDigestHealth()).toEqual({ error: 'permission denied' });
    warn.mockRestore();
  });
});

describe('attentionMineRequest', () => {
  it('asks for nothing without params, or without attention', () => {
    expect(attentionMineRequest(undefined)).toBeNull();
    expect(attentionMineRequest(null)).toBeNull();
    expect(attentionMineRequest({ projectId: 'p1', mine: true })).toBeNull();
  });

  it('turns Milik saya on only for mine: true', () => {
    expect(attentionMineRequest({ projectId: 'p1', attention: true })).toEqual({ mine: false });
    expect(attentionMineRequest({ projectId: 'p1', attention: true, mine: true })).toEqual({ mine: true });
    expect(attentionMineRequest({ projectId: 'p1', attention: true, mine: false })).toEqual({ mine: false });
  });

  it('answers a second identical params object with a NEW object, so a second tap re-applies it', () => {
    const first = attentionMineRequest({ projectId: 'p1', attention: true, mine: true });
    const second = attentionMineRequest({ projectId: 'p1', attention: true, mine: true });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

describe('pure helpers', () => {
  it('filters Milik saya to the viewer, and to nothing when signed out', () => {
    const rows = [row(), row({ event_id: 'e2', owner_id: 'u2' })];
    expect(filterMine(rows, 'u2').map((r) => r.event_id)).toEqual(['e2']);
    expect(filterMine(rows, null)).toEqual([]);
  });

  it('titles the list with the shown count, or says it was capped', () => {
    expect(attentionHeading(3, 3, false)).toBe('Perlu ditindak (3)');
    expect(attentionHeading(3, 1, true)).toBe('Perlu ditindak (1)');
    expect(attentionHeading(200, 200, false)).toBe('Perlu ditindak (200 teratas)');
  });

  it('says Milik saya over a capped read counts only within the 200 read', () => {
    expect(attentionHeading(200, 7, true)).toBe('Perlu ditindak (7 dari 200 teratas)');
    expect(attentionHeading(200, 0, true)).toBe('Perlu ditindak (0 dari 200 teratas)');
  });

  it('never claims the viewer has nothing when the read was capped', () => {
    expect(attentionEmptyText(0, false)).toBe('Tidak ada yang perlu ditindak.');
    expect(attentionEmptyText(0, true)).toBe('Tidak ada tugas Anda yang perlu ditindak.');
    expect(attentionEmptyText(12, true)).toBe('Tidak ada tugas Anda yang perlu ditindak.');
    expect(attentionEmptyText(200, true)).toBe('Tidak ada tugas Anda di 200 teratas.');
  });

  it('labels a room by code and name, or by name alone', () => {
    expect(attentionRoomLabel(row())).toBe('LT1-R01 · Kamar Tidur 1');
    expect(attentionRoomLabel(row({ room_code: null }))).toBe('Kamar Tidur 1');
  });

  it('shows Lewat n hari from one day late, and Menghambat on a blocking item', () => {
    expect(attentionChips(row({ days_overdue: 0, is_overdue: false, is_blocking: true }), { showOwner: false, closePending: false }))
      .toEqual([{ label: 'Menghambat', tone: 'block' }]);
    expect(attentionChips(row({ days_overdue: 1 }), { showOwner: false, closePending: false }))
      .toEqual([{ label: 'Lewat 1 hari', tone: 'late' }]);
  });

  it('adds Menunggu kirim while a close for the row is still on this phone', () => {
    expect(attentionChips(row(), { showOwner: false, closePending: true }).map((c) => c.label)).toEqual(['Lewat 3 hari', 'Menunggu kirim']);
  });

  it('names the owner in office layouts, or Tanpa penanggung jawab only when the view knows the owner is gone', () => {
    expect(attentionChips(row(), { showOwner: true, closePending: false }).map((c) => c.label)).toEqual(['Lewat 3 hari', 'Budi']);
    expect(attentionChips(row({ owner_on_project: false }), { showOwner: true, closePending: false }).map((c) => c.label))
      .toEqual(['Lewat 3 hari', 'Tanpa penanggung jawab']);
    expect(attentionChips(row({ owner_on_project: false, owner_id: null, owner_name: null }), { showOwner: true, closePending: false }).map((c) => c.label))
      .toEqual(['Lewat 3 hari', 'Tanpa penanggung jawab']);
    // A supervisor reads NULL for a colleague's item: unknown, so no claim either way.
    expect(attentionChips(row({ owner_on_project: null, owner_name: null }), { showOwner: true, closePending: false }).map((c) => c.label))
      .toEqual(['Lewat 3 hari']);
    expect(attentionChips(row(), { showOwner: false, closePending: false }).map((c) => c.label)).toEqual(['Lewat 3 hari']);
  });
});
