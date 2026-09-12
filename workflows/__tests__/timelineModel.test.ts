/**
 * The timeline's rules, which are the same rules migration 099 and 097's
 * close_site_event enforce in SQL. They live here so the screen and the
 * database cannot drift: a control the user can see but the server refuses is
 * worse than no control at all.
 *
 * The case that matters most is "refuses the current owner": spec §9 lists
 * office roles and the reporter, and an owner reassigning their own overdue
 * item is precisely the accountability gap this feature closes.
 */
import {
  canClose, canEditAssignment, dueLabel, fmtDate, sortTimeline, validateAssignment,
  type TimelineEvent,
} from '../screens/siteEvent/timelineModel';

const TODAY = '2026-09-11';

function ev(p: Partial<TimelineEvent> & { id: string }): TimelineEvent {
  return {
    status: 'open', event_type: 'progres', title: 'T', summary: 'S', owner_id: null, due_date: null,
    confirmed_at: '2026-09-10T02:00:00Z', created_at: '2026-09-10T01:00:00Z', closed_at: null,
    site_change_id: null, reporter_id: 'u-rep', gate_code: null, step_code: null, is_blocking: false,
    ...p,
  } as TimelineEvent;
}

describe('sortTimeline', () => {
  it('puts the newest human action first and falls back to arrival', () => {
    const out = sortTimeline([
      ev({ id: 'old', confirmed_at: '2026-09-01T00:00:00Z' }),
      ev({ id: 'draft', confirmed_at: null, created_at: '2026-09-11T09:00:00Z' }),
      ev({ id: 'mid', confirmed_at: '2026-09-05T00:00:00Z' }),
    ]).map((e) => e.id);
    expect(out).toEqual(['draft', 'mid', 'old']);
  });

  it('is stable on a tie and does not mutate its input', () => {
    const input = [ev({ id: 'a' }), ev({ id: 'b' })];
    expect(sortTimeline(input).map((e) => e.id)).toEqual(['b', 'a']);
    expect(input.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('canEditAssignment', () => {
  const open = ev({ id: 'x', reporter_id: 'u-rep' });
  it('lets an office role and the reporter edit', () => {
    expect(canEditAssignment(open, { id: 'u-adm', role: 'admin' })).toBe(true);
    expect(canEditAssignment(open, { id: 'u-est', role: 'estimator' })).toBe(true);
    expect(canEditAssignment(open, { id: 'u-pri', role: 'principal' })).toBe(true);
    expect(canEditAssignment(open, { id: 'u-rep', role: 'supervisor' })).toBe(true);
  });
  it('refuses the current owner and any other member', () => {
    expect(canEditAssignment({ ...open, owner_id: 'u-own' } as TimelineEvent, { id: 'u-own', role: 'supervisor' })).toBe(false);
    expect(canEditAssignment(open, { id: 'u-other', role: 'supervisor' })).toBe(false);
  });
  it('refuses on an event that is not open, and with no session', () => {
    expect(canEditAssignment(ev({ id: 'x', status: 'done', reporter_id: 'u-rep' }), { id: 'u-rep', role: 'supervisor' })).toBe(false);
    expect(canEditAssignment(open, null)).toBe(false);
    expect(canEditAssignment(open, { id: null, role: 'admin' })).toBe(false);
  });
});

describe('canClose', () => {
  it('offers Selesai only on an open event', () => {
    expect(canClose(ev({ id: 'a', status: 'open' }))).toBe(true);
    expect(canClose(ev({ id: 'a', status: 'done' }))).toBe(false);
    expect(canClose(ev({ id: 'a', status: 'draft' }))).toBe(false);
  });
});

describe('validateAssignment', () => {
  it('requires both an owner and a due date on the four actionable types', () => {
    for (const t of ['isu', 'hambatan', 'cacat', 'butuh_keputusan'] as const) {
      const e = ev({ id: 'a', event_type: t });
      expect(validateAssignment(e, { ownerId: null, dueDate: '2026-09-20' }, TODAY))
        .toBe('Kejadian ini wajib punya pemilik dan tenggat.');
      expect(validateAssignment(e, { ownerId: 'u', dueDate: null }, TODAY))
        .toBe('Kejadian ini wajib punya pemilik dan tenggat.');
      expect(validateAssignment(e, { ownerId: 'u', dueDate: '2026-09-20' }, TODAY)).toBeNull();
    }
  });

  it('lets progres and info carry neither', () => {
    expect(validateAssignment(ev({ id: 'a', event_type: 'progres' }), { ownerId: null, dueDate: null }, TODAY)).toBeNull();
    expect(validateAssignment(ev({ id: 'a', event_type: 'info' }), { ownerId: null, dueDate: null }, TODAY)).toBeNull();
  });

  it('refuses a due date MOVED into the past', () => {
    expect(validateAssignment(ev({ id: 'a', due_date: '2026-09-20' }), { ownerId: 'u', dueDate: '2026-09-01' }, TODAY))
      .toBe('Tenggat tidak boleh sebelum hari ini.');
  });

  it('keeps an already-late event reassignable without a new date', () => {
    const late = ev({ id: 'a', event_type: 'isu', due_date: '2026-09-01' });
    expect(validateAssignment(late, { ownerId: 'u2', dueDate: '2026-09-01' }, TODAY)).toBeNull();
  });
});

describe('dueLabel and fmtDate', () => {
  it('reads the date, or how late it is', () => {
    expect(dueLabel(ev({ id: 'a', due_date: null }), TODAY)).toBeNull();
    expect(dueLabel(ev({ id: 'a', due_date: '2026-09-20' }), TODAY)).toBe('Tenggat 20-09-2026');
    expect(dueLabel(ev({ id: 'a', due_date: '2026-09-10' }), TODAY)).toBe('Lewat tenggat 1 hari');
    expect(dueLabel(ev({ id: 'a', due_date: '2026-09-04' }), TODAY)).toBe('Lewat tenggat 7 hari');
  });
  it('never calls a closed event late', () => {
    expect(dueLabel(ev({ id: 'a', status: 'done', due_date: '2026-09-01' }), TODAY)).toBe('Tenggat 01-09-2026');
  });
  it('spells a date the way the notification does', () => {
    expect(fmtDate('2026-09-11')).toBe('11-09-2026');
  });
});
