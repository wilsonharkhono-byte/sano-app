/**
 * The timeline's rules, which are the same rules migration 099 and 097's
 * close_site_event enforce in SQL. They live here so the screen and the
 * database cannot drift: a control the user can see but the server refuses is
 * worse than no control at all.
 *
 * Spec §9 names exactly two groups who may edit the owner and due date:
 * office roles and the reporter. Being the current owner is neither a grant
 * nor a bar — an office role or the reporter who is also the owner can still
 * hand the item on.
 */
import {
  canClose, canEditAssignment, dueLabel, fmtDate, pendingCloseBadge, pendingCloseLeft, sortTimeline, validateAssignment,
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
  it('owner-ness alone neither grants nor bars: the reporter or an office role who is also the owner can still edit', () => {
    expect(canEditAssignment({ ...open, owner_id: 'u-rep' } as TimelineEvent, { id: 'u-rep', role: 'supervisor' })).toBe(true);
    expect(canEditAssignment({ ...open, owner_id: 'u-adm' } as TimelineEvent, { id: 'u-adm', role: 'admin' })).toBe(true);
  });
  it('refuses a member who is neither the reporter nor an office role, owner or not', () => {
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

  it('hides Selesai while this phone holds a close for the event that has not reached the server', () => {
    expect(canClose(ev({ id: 'a', status: 'open' }), true)).toBe(false);
    expect(canClose(ev({ id: 'a', status: 'open' }), false)).toBe(true);
  });
});

/**
 * Closure spec §4.5: a close still on this phone adds a badge beside the
 * server's status. A job the server refused, or that ran out of attempts, is
 * not on its way, so it must not say it is - the same "belum terkirim" the
 * detail screen uses for it.
 */
describe('pendingCloseBadge', () => {
  it('says nothing without a pending close', () => {
    expect(pendingCloseBadge(null)).toBeNull();
    expect(pendingCloseBadge(undefined)).toBeNull();
  });

  it('says Menunggu kirim while the close is on its way', () => {
    expect(pendingCloseBadge({ needsAttention: false })).toBe('Menunggu kirim');
  });

  it('says Belum terkirim, never Menunggu kirim, once the close needs attention', () => {
    expect(pendingCloseBadge({ needsAttention: true })).toBe('Belum terkirim');
  });
});

describe('pendingCloseLeft', () => {
  it('is true when an event that had a pending close no longer has one', () => {
    expect(pendingCloseLeft(['a', 'b'], ['b'])).toBe(true);
    expect(pendingCloseLeft(['a'], [])).toBe(true);
  });

  it('is false when nothing left, including when a new close joins', () => {
    expect(pendingCloseLeft([], [])).toBe(false);
    expect(pendingCloseLeft([], ['a'])).toBe(false);
    expect(pendingCloseLeft(['a'], ['a', 'b'])).toBe(false);
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

  it('refuses a due date that is not YYYY-MM-DD, in the same words the confirm screen uses', () => {
    expect(validateAssignment(ev({ id: 'a' }), { ownerId: 'u', dueDate: '12/09/2026' }, TODAY))
      .toBe('Format tenggat harus YYYY-MM-DD.');
    expect(validateAssignment(ev({ id: 'a' }), { ownerId: 'u', dueDate: '2026-02-30' }, TODAY))
      .toBe('Format tenggat harus YYYY-MM-DD.');
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
