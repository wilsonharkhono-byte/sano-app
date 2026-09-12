jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import {
  boardSummary, filterBoard, floorGroupKey, floorOptions, isQuietRoom, lastUpdateLabel,
  openChips, openCount, ownerOptions,
} from '../roomBoard';
import type { RoomBoardRow } from '../types';

function row(p: Partial<RoomBoardRow> & { room_id: string }): RoomBoardRow {
  return {
    project_id: 'p1', room_code: p.room_id.toUpperCase(), room_name: p.room_id, floor: '1',
    sort_order: 0, area_type: 'general', active: true,
    open_progres: 0, open_isu: 0, open_hambatan: 0, open_cacat: 0,
    open_butuh_keputusan: 0, open_info: 0, overdue_count: 0,
    last_event_at: null, last_gate_code: null, last_step_code: null,
    is_quiet: true, owner_initials: [], ...p,
  } as RoomBoardRow;
}

describe('boardSummary', () => {
  it('adds the three open counts the strip shows', () => {
    const s = boardSummary([
      row({ room_id: 'a', open_hambatan: 2, open_butuh_keputusan: 1, overdue_count: 1, is_quiet: false, last_event_at: '2026-09-10T00:00:00Z' }),
      row({ room_id: 'b', open_hambatan: 1, overdue_count: 3, is_quiet: false, last_event_at: '2026-09-10T00:00:00Z' }),
    ]);
    expect(s).toEqual({ hambatan: 3, overdue: 4, butuhKeputusan: 1, quietRooms: 0 });
  });

  it('counts a quiet room only when it has ever had an event', () => {
    const s = boardSummary([
      row({ room_id: 'used', is_quiet: true, last_event_at: '2026-09-01T00:00:00Z' }),
      row({ room_id: 'never', is_quiet: true, last_event_at: null }),
    ]);
    expect(s.quietRooms).toBe(1);
  });
});

describe('isQuietRoom', () => {
  it('does not treat a never-touched room as visibly quiet', () => {
    expect(isQuietRoom(row({ room_id: 'a', is_quiet: true, last_event_at: null }))).toBe(false);
    expect(isQuietRoom(row({ room_id: 'b', is_quiet: true, last_event_at: '2026-09-01T00:00:00Z' }))).toBe(true);
  });

  it('reads false once is_quiet itself is false, event or not', () => {
    expect(isQuietRoom(row({ room_id: 'c', is_quiet: false, last_event_at: '2026-09-01T00:00:00Z' }))).toBe(false);
  });
});

describe('filterBoard', () => {
  const rows = [
    row({ room_id: 'a', floor: '1', open_isu: 2, overdue_count: 1, owner_initials: ['AS'] }),
    row({ room_id: 'b', floor: '2', open_cacat: 1, owner_initials: ['BW', 'AS'] }),
    row({ room_id: 'c', floor: null, owner_initials: [] }),
  ];
  it('filters by floor, including the floorless bucket', () => {
    expect(filterBoard(rows, { floor: '2' }).map((r) => r.room_id)).toEqual(['b']);
    expect(filterBoard(rows, { floor: '' }).map((r) => r.room_id)).toEqual(['c']);
  });
  it('filters by event type, keeping only rooms that actually have one open', () => {
    expect(filterBoard(rows, { eventType: 'isu' }).map((r) => r.room_id)).toEqual(['a']);
    expect(filterBoard(rows, { eventType: 'info' })).toEqual([]);
  });
  it('filters by owner initials and by overdue only', () => {
    expect(filterBoard(rows, { owner: 'AS' }).map((r) => r.room_id)).toEqual(['a', 'b']);
    expect(filterBoard(rows, { overdueOnly: true }).map((r) => r.room_id)).toEqual(['a']);
  });
  it('combines filters', () => {
    expect(filterBoard(rows, { owner: 'AS', overdueOnly: true }).map((r) => r.room_id)).toEqual(['a']);
  });
  it('returns everything when nothing is set', () => {
    expect(filterBoard(rows, {})).toHaveLength(3);
  });
});

describe('option lists', () => {
  it('lists floors in board order and owners sorted', () => {
    const rows = [row({ room_id: 'a', floor: '1', owner_initials: ['BW'] }), row({ room_id: 'b', floor: '2', owner_initials: ['AS', 'BW'] }), row({ room_id: 'c', floor: '1' })];
    expect(floorOptions(rows)).toEqual(['1', '2']);
    expect(ownerOptions(rows)).toEqual(['AS', 'BW']);
  });

  it('collapses floor labels that normalise to the same floor, keeping the first label seen', () => {
    const rows = [
      row({ room_id: 'a', floor: '2' }),
      row({ room_id: 'b', floor: 'Lt. 2' }),
      row({ room_id: 'c', floor: 'Lantai 2' }),
    ];
    expect(floorOptions(rows)).toEqual(['2']);
  });
});

describe('floorGroupKey', () => {
  it('groups "2", "Lt. 2" and "Lantai 2" as the same floor', () => {
    expect(floorGroupKey('2')).toBe(floorGroupKey('Lt. 2'));
    expect(floorGroupKey('2')).toBe(floorGroupKey('Lantai 2'));
  });

  it('keeps distinct floors, and the floorless bucket, apart', () => {
    expect(floorGroupKey('2')).not.toBe(floorGroupKey('3'));
    expect(floorGroupKey(null)).toBe(floorGroupKey(''));
    expect(floorGroupKey(null)).not.toBe(floorGroupKey('Basement'));
  });
});

describe('filterBoard floor normalisation', () => {
  it('matches a floor filter against every spelling of that floor', () => {
    const rows = [
      row({ room_id: 'a', floor: '2' }),
      row({ room_id: 'b', floor: 'Lt. 2' }),
      row({ room_id: 'c', floor: '3' }),
    ];
    expect(filterBoard(rows, { floor: 'Lantai 2' }).map((r) => r.room_id)).toEqual(['a', 'b']);
  });
});

describe('lastUpdateLabel', () => {
  const now = new Date('2026-09-11T08:00:00Z');
  it('never invents a date for a room that has had no event', () => {
    expect(lastUpdateLabel(null, now)).toBe('Belum ada kejadian');
    expect(lastUpdateLabel('not-a-date', now)).toBe('Belum ada kejadian');
  });
  it('reads today, yesterday and N days', () => {
    expect(lastUpdateLabel('2026-09-11T01:00:00Z', now)).toBe('Hari ini');
    expect(lastUpdateLabel('2026-09-10T01:00:00Z', now)).toBe('Kemarin');
    expect(lastUpdateLabel('2026-09-05T01:00:00Z', now)).toBe('6 hari lalu');
  });

  it('pins the is_quiet boundary: still "N hari lalu" at exactly 3 and 4 days', () => {
    // now = 2026-09-11T08:00:00Z. v_room_board's is_quiet flips to true only
    // strictly after 3 days (confirmed_at < now() - interval '3 days'), so a
    // room can legitimately read "3 hari lalu" while already counted/faded as
    // quiet for the rest of that day-bucket. lastUpdateLabel just reports the
    // elapsed days; it never re-derives is_quiet itself.
    expect(lastUpdateLabel('2026-09-08T08:00:00Z', now)).toBe('3 hari lalu'); // exactly 3 days
    expect(lastUpdateLabel('2026-09-07T08:00:00Z', now)).toBe('4 hari lalu'); // exactly 4 days
  });
});

describe('openChips and openCount', () => {
  it('shows only the types with open events, in the declared order', () => {
    const r = row({ room_id: 'a', open_progres: 1, open_hambatan: 2 });
    expect(openChips(r)).toEqual([
      { type: 'progres', label: 'Progres', count: 1 },
      { type: 'hambatan', label: 'Hambatan', count: 2 },
    ]);
    expect(openCount(r, 'cacat')).toBe(0);
  });
});
