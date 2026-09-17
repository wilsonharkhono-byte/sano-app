// tools/__tests__/analyticsSCurve.test.ts
import { weekOf, weeksBetween } from '../analytics/weekBuckets';
import { buildSCurve, plannedPctAt } from '../analytics/sCurve';

describe('weekBuckets', () => {
  it('names the WIB Monday of a date or a timestamp', () => {
    expect(weekOf('2026-09-17')).toBe('2026-09-14');
    expect(weekOf('2026-09-14')).toBe('2026-09-14');
    expect(weekOf('2026-09-20')).toBe('2026-09-14');
    // 20 Sep 18:30 UTC is already Monday 21 Sep 01:30 in Jakarta.
    expect(weekOf('2026-09-20T18:30:00Z')).toBe('2026-09-21');
  });

  it('lists every Monday between two weeks', () => {
    expect(weeksBetween('2026-09-07', '2026-09-21')).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
    expect(weeksBetween('2026-09-21', '2026-09-07')).toEqual([]);
  });
});

describe('plannedPctAt (typical S-curve)', () => {
  it('starts at 0, passes 50 at the midpoint and ends at 100', () => {
    expect(plannedPctAt('2026-01-01', '2026-12-31', '2026-01-01')).toBe(0);
    expect(plannedPctAt('2026-01-01', '2026-12-31', '2026-07-02')).toBeCloseTo(50, 0);
    expect(plannedPctAt('2026-01-01', '2026-12-31', '2026-12-31')).toBe(100);
    expect(plannedPctAt('2026-01-01', '2026-12-31', '2027-03-01')).toBe(100);
    expect(plannedPctAt('2026-01-01', '2026-12-31', '2025-12-01')).toBe(0);
  });

  it('is slow, then fast, then slow', () => {
    const q1 = plannedPctAt('2026-01-01', '2026-12-31', '2026-04-01') as number;
    expect(q1).toBeLessThan(25);
    expect(plannedPctAt('2026-01-01', '2026-12-31', '2026-10-01') as number).toBeGreaterThan(75);
  });

  it('draws nothing without two real dates in order', () => {
    expect(plannedPctAt(null, '2026-12-31', '2026-06-01')).toBeNull();
    expect(plannedPctAt('2026-01-01', null, '2026-06-01')).toBeNull();
    expect(plannedPctAt('2026-12-31', '2026-01-01', '2026-06-01')).toBeNull();
    expect(plannedPctAt('not-a-date', '2026-12-31', '2026-06-01')).toBeNull();
  });
});

describe('buildSCurve', () => {
  const items = [{ id: 'a', planned: 100 }, { id: 'b', planned: 300 }];
  const entry = (row: string, quantity: number, at: string) => ({ boq_item_id: row, quantity, created_at: at });

  it('adds verified entries up by week, capped per work area, over total planned', () => {
    const c = buildSCurve({
      start: '2026-08-31', end: '2026-11-29', today: '2026-09-24', items,
      entries: [entry('a', 40, '2026-09-02T03:00:00Z'), entry('a', 80, '2026-09-10T03:00:00Z'), entry('b', 60, '2026-09-16T03:00:00Z'), entry('a', -20, '2026-09-23T03:00:00Z')],
    });
    expect(c.weeks.slice(0, 4)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
    // a: 40 → 120 capped at 100 → 100 → 100 (the 20 removed still leaves 100); b: 0, 0, 60, 60; total planned 400.
    expect(c.actual.slice(0, 4)).toEqual([10, 25, 40, 40]);
    expect(c.actual[4]).toBeNull();
    expect(c.planned[0]).toBe(0);
    expect(c.planned[c.planned.length - 1]).toBe(100);
    expect(c.latestActual).toBe(40);
    expect(c.entryCount).toBe(4);
  });

  it('projects the finish from the pace of the last four calendar weeks', () => {
    const c = buildSCurve({
      start: '2026-08-31', end: '2026-11-29', today: '2026-09-24', items,
      entries: [entry('b', 40, '2026-09-02T03:00:00Z'), entry('b', 40, '2026-09-09T03:00:00Z'), entry('b', 40, '2026-09-16T03:00:00Z'), entry('b', 40, '2026-09-23T03:00:00Z')],
    });
    expect(c.actual.slice(0, 4)).toEqual([10, 20, 30, 40]);
    expect(c.projection).toMatchObject({ pacePerWeek: 10, windowWeeks: 3, finishWeek: '2026-11-02' });
    expect(c.projection?.weeksFromPlan).toBe(-3);
    expect(c.projected[3]).toBe(40);
    expect(c.projected[4]).toBe(50);
  });

  it('says why it cannot project: one verified week, or no rise in the window', () => {
    const one = buildSCurve({ start: '2026-08-31', end: '2026-11-29', today: '2026-09-24', items, entries: [entry('a', 40, '2026-09-16T03:00:00Z')] });
    expect(one.projection).toBeNull();
    expect(one.projectionNote).toBe('Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.');
    const none = buildSCurve({ start: '2026-08-31', end: '2026-11-29', today: '2026-09-24', items, entries: [] });
    expect(none.latestActual).toBeNull();
    expect(none.projectionNote).toBe('Belum ada progres terverifikasi.');
    const flat = buildSCurve({ start: '2026-06-01', end: '2026-11-29', today: '2026-09-24', items, entries: [entry('a', 40, '2026-06-03T03:00:00Z'), entry('a', 10, '2026-06-10T03:00:00Z')] });
    expect(flat.projection).toBeNull();
    expect(flat.projectionNote).toBe('Tidak ada kenaikan progres terverifikasi dalam 4 minggu terakhir.');
  });

  it('draws no plan without project dates, and still shows verified progress', () => {
    const c = buildSCurve({ start: null, end: null, today: '2026-09-24', items, entries: [entry('a', 40, '2026-09-16T03:00:00Z')] });
    expect(c.hasPlan).toBe(false);
    expect(c.planned.every((v) => v === null)).toBe(true);
    expect(c.latestActual).toBe(10);
  });
});
