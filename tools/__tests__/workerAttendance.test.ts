// Mock supabase to prevent react-native-url-polyfill ESM import in Jest.
// The functions under test are pure (no I/O), so the mock is never exercised.
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import {
  getWeekStart,
  getWeekEnd,
  getWeekDates,
  cyclePresence,
  isCellLocked,
  isCellDirty,
  buildPersistedMap,
  buildInitialGrid,
  reconcileGridAfterSave,
  buildSavePayloads,
  computeOvertimePay,
  computeWorkerWeekTotal,
  countUnmarkedCells,
  countDirtyCells,
  countDraftEntries,
  canConfirmWeek,
  cellKey,
  type PresenceGrid,
  type PersistedEntryInput,
} from '../workerAttendance';

// Helper to build a minimal persisted entry.
function entry(over: Partial<PersistedEntryInput>): PersistedEntryInput {
  return {
    id: 'id',
    worker_id: 'w1',
    attendance_date: 'd1',
    is_present: true,
    overtime_hours: 0,
    status: 'DRAFT',
    ...over,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// F6 — Mon–Sat week date math (R19, Sunday excluded)
// ───────────────────────────────────────────────────────────────────────────

describe('F6 week date math — Mon–Sat', () => {
  // 2026-07-11 is a Saturday; that week's Monday is 2026-07-06.
  it('getWeekStart returns the Monday for a mid-week date (Wed)', () => {
    expect(getWeekStart(new Date(2026, 6, 8))).toBe('2026-07-06'); // Wed Jul 8
  });

  it('getWeekEnd returns Saturday (week_start + 5), never Sunday', () => {
    expect(getWeekEnd(new Date(2026, 6, 8))).toBe('2026-07-11'); // Sat
  });

  it('getWeekDates returns exactly 6 days, Mon..Sat', () => {
    const dates = getWeekDates('2026-07-06');
    expect(dates).toEqual([
      '2026-07-06', '2026-07-07', '2026-07-08',
      '2026-07-09', '2026-07-10', '2026-07-11',
    ]);
    expect(dates).toHaveLength(6);
    expect(dates).not.toContain('2026-07-12'); // Sunday excluded
  });

  it('a Sunday date resolves back into its Mon–Sat week (Sunday not paid)', () => {
    const sunday = new Date(2026, 6, 12); // Sun Jul 12
    expect(getWeekStart(sunday)).toBe('2026-07-06');
    expect(getWeekEnd(sunday)).toBe('2026-07-11');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// F3 — tri-state cell model
// ───────────────────────────────────────────────────────────────────────────

describe('F3 tri-state — cyclePresence', () => {
  it('cycles unmarked → present → absent → present', () => {
    expect(cyclePresence('unmarked')).toBe('present');
    expect(cyclePresence('present')).toBe('absent');
    expect(cyclePresence('absent')).toBe('present');
  });
});

describe('F5 — isCellLocked (only DRAFT is editable in the field)', () => {
  it('new (undefined) and DRAFT cells are editable', () => {
    expect(isCellLocked(undefined)).toBe(false);
    expect(isCellLocked('DRAFT')).toBe(false);
  });
  it('every non-DRAFT persisted status is locked', () => {
    for (const s of ['SUBMITTED', 'CONFIRMED', 'OVERRIDDEN', 'SETTLED']) {
      expect(isCellLocked(s)).toBe(true);
    }
  });
});

describe('isCellDirty', () => {
  it('unmarked is never dirty (nothing to save)', () => {
    expect(isCellDirty({ presence: 'unmarked', overtimeHours: 0 })).toBe(false);
  });
  it('marked but not persisted is dirty', () => {
    expect(isCellDirty({ presence: 'present', overtimeHours: 0 }, undefined)).toBe(true);
  });
  it('matches persisted → not dirty', () => {
    const persisted = { id: 'x', is_present: true, overtime_hours: 2, status: 'DRAFT' as const };
    expect(isCellDirty({ presence: 'present', overtimeHours: 2 }, persisted)).toBe(false);
  });
  it('OT change → dirty', () => {
    const persisted = { id: 'x', is_present: true, overtime_hours: 2, status: 'DRAFT' as const };
    expect(isCellDirty({ presence: 'present', overtimeHours: 3 }, persisted)).toBe(true);
  });
  it('absent normalizes OT to 0 when comparing', () => {
    const persisted = { id: 'x', is_present: false, overtime_hours: 0, status: 'DRAFT' as const };
    expect(isCellDirty({ presence: 'absent', overtimeHours: 5 }, persisted)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pay preview — unmarked and absent contribute ZERO (U2 / R1 / R17)
// ───────────────────────────────────────────────────────────────────────────

describe('computeOvertimePay — tier waterfall (R3)', () => {
  it('splits 9h at threshold 10: 3h@tier1 + 6h@tier2', () => {
    // Audited: 9h → 3×20k + 6×30k = 240,000
    expect(computeOvertimePay(9, 20000, 30000, 10)).toBe(240000);
  });
  it('returns 0 for non-positive hours', () => {
    expect(computeOvertimePay(0, 20000, 30000, 10)).toBe(0);
  });
});

describe('computeWorkerWeekTotal — unmarked/absent = 0', () => {
  const rate = { dailyRate: 150000, tier1Rate: 20000, tier2Rate: 30000, tier2Threshold: 10 };

  it('only present days count toward days and pay', () => {
    const cells = [
      { presence: 'present' as const, overtimeHours: 0 },
      { presence: 'absent' as const, overtimeHours: 0 },
      { presence: 'unmarked' as const, overtimeHours: 0 },
      { presence: 'present' as const, overtimeHours: 0 },
    ];
    const t = computeWorkerWeekTotal(cells, rate);
    expect(t.days).toBe(2);
    expect(t.weekPay).toBe(300000);
    expect(t.totalOT).toBe(0);
  });

  it('unmarked cell with stray OT still contributes zero', () => {
    const cells = [{ presence: 'unmarked' as const, overtimeHours: 5 }];
    expect(computeWorkerWeekTotal(cells, rate)).toEqual({ days: 0, totalOT: 0, weekPay: 0 });
  });

  it('OT only counts on present days', () => {
    const cells = [
      { presence: 'present' as const, overtimeHours: 9 },
      { presence: 'absent' as const, overtimeHours: 9 }, // ignored
    ];
    const t = computeWorkerWeekTotal(cells, rate);
    expect(t.days).toBe(1);
    expect(t.totalOT).toBe(9);
    expect(t.weekPay).toBe(150000 + 240000);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Save-payload construction — unmarked excluded, per-date skip, DRAFT-only
// ───────────────────────────────────────────────────────────────────────────

describe('buildSavePayloads', () => {
  const weekDates = ['d1', 'd2', 'd3'];
  const workerIds = ['w1', 'w2'];

  it('excludes unmarked cells, includes absent, skips all-unmarked dates', () => {
    const grid: PresenceGrid = {
      w1: {
        d1: { presence: 'present', overtimeHours: 2 },
        d2: { presence: 'unmarked', overtimeHours: 0 },
        d3: { presence: 'absent', overtimeHours: 5 },
      },
      w2: {
        d1: { presence: 'unmarked', overtimeHours: 0 },
        d2: { presence: 'unmarked', overtimeHours: 0 },
        d3: { presence: 'unmarked', overtimeHours: 0 },
      },
    };
    const payloads = buildSavePayloads(weekDates, workerIds, grid, {});
    // d2 is entirely unmarked → skipped; d1 has only w1; d3 has only w1 (absent, OT forced 0)
    expect(payloads).toEqual([
      { attendanceDate: 'd1', entries: [{ worker_id: 'w1', is_present: true, overtime_hours: 2 }] },
      { attendanceDate: 'd3', entries: [{ worker_id: 'w1', is_present: false, overtime_hours: 0 }] },
    ]);
  });

  it('excludes non-DRAFT (locked) cells even when marked', () => {
    const grid: PresenceGrid = {
      w1: { d1: { presence: 'present', overtimeHours: 0, status: 'SUBMITTED' } },
    };
    expect(buildSavePayloads(['d1'], ['w1'], grid, {})).toEqual([]);
  });

  it('excludes cells that already match the DB (nothing changed)', () => {
    const grid: PresenceGrid = {
      w1: { d1: { presence: 'present', overtimeHours: 0, status: 'DRAFT' } },
    };
    const persisted = { [cellKey('w1', 'd1')]: { id: 'x', is_present: true, overtime_hours: 0, status: 'DRAFT' as const } };
    expect(buildSavePayloads(['d1'], ['w1'], grid, persisted)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Grid build + reconciliation (F4 honesty)
// ───────────────────────────────────────────────────────────────────────────

describe('buildInitialGrid', () => {
  it('persisted cells map to present/absent; the rest start unmarked', () => {
    const grid = buildInitialGrid(
      ['w1', 'w2'],
      ['d1', 'd2'],
      [entry({ worker_id: 'w1', attendance_date: 'd1', is_present: true, overtime_hours: 3, status: 'DRAFT', id: 'e1' })],
    );
    expect(grid.w1.d1).toEqual({ presence: 'present', overtimeHours: 3, existingId: 'e1', status: 'DRAFT' });
    expect(grid.w1.d2).toEqual({ presence: 'unmarked', overtimeHours: 0 });
    expect(grid.w2.d1).toEqual({ presence: 'unmarked', overtimeHours: 0 });
  });
});

describe('reconcileGridAfterSave (F4)', () => {
  it('saved days go clean; failed days keep the user marks (stay dirty)', () => {
    const prev: PresenceGrid = {
      w1: {
        d1: { presence: 'present', overtimeHours: 0 }, // will be saved
        d2: { presence: 'absent', overtimeHours: 0 },  // failed day — keep
      },
    };
    const fresh = [entry({ worker_id: 'w1', attendance_date: 'd1', is_present: true, overtime_hours: 0, status: 'DRAFT', id: 'e1' })];
    const next = reconcileGridAfterSave(prev, ['w1'], ['d1', 'd2'], fresh, ['d2']);

    // d1 adopted persisted → clean
    expect(next.w1.d1).toEqual({ presence: 'present', overtimeHours: 0, existingId: 'e1', status: 'DRAFT' });
    const persistedMap = buildPersistedMap(fresh);
    expect(isCellDirty(next.w1.d1, persistedMap[cellKey('w1', 'd1')])).toBe(false);

    // d2 failed → user's absent mark preserved, still dirty (not persisted)
    expect(next.w1.d2.presence).toBe('absent');
    expect(isCellDirty(next.w1.d2, persistedMap[cellKey('w1', 'd2')])).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Konfirmasi gating (F3 + F4)
// ───────────────────────────────────────────────────────────────────────────

describe('Konfirmasi gating', () => {
  const weekDates = ['d1', 'd2'];
  const workerIds = ['w1'];

  it('countUnmarkedCells counts every still-unmarked cell', () => {
    const grid: PresenceGrid = {
      w1: { d1: { presence: 'present', overtimeHours: 0 }, d2: { presence: 'unmarked', overtimeHours: 0 } },
    };
    expect(countUnmarkedCells(weekDates, workerIds, grid)).toBe(1);
  });

  it('countDirtyCells ignores locked and unmarked cells', () => {
    const grid: PresenceGrid = {
      w1: {
        d1: { presence: 'present', overtimeHours: 0, status: 'SUBMITTED' }, // locked → ignored
        d2: { presence: 'present', overtimeHours: 0 },                      // new → dirty
      },
    };
    expect(countDirtyCells(weekDates, workerIds, grid, {})).toBe(1);
  });

  it('countDraftEntries counts only persisted DRAFT rows (never grid cells)', () => {
    expect(countDraftEntries([
      entry({ status: 'DRAFT' }),
      entry({ status: 'SUBMITTED' }),
      entry({ status: 'DRAFT' }),
    ])).toBe(2);
  });

  it('canConfirmWeek requires drafts, no unsaved edits, and zero unmarked', () => {
    expect(canConfirmWeek({ persistedDraftCount: 3, hasUnsavedEdits: false, unmarkedCount: 0 })).toBe(true);
    // blocked by unmarked cells
    expect(canConfirmWeek({ persistedDraftCount: 3, hasUnsavedEdits: false, unmarkedCount: 1 })).toBe(false);
    // blocked by unsaved edits
    expect(canConfirmWeek({ persistedDraftCount: 3, hasUnsavedEdits: true, unmarkedCount: 0 })).toBe(false);
    // nothing to confirm
    expect(canConfirmWeek({ persistedDraftCount: 0, hasUnsavedEdits: false, unmarkedCount: 0 })).toBe(false);
  });
});
