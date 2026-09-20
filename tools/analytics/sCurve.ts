// tools/analytics/sCurve.ts
// SANO — Kurva-S (spec 2026-09-17 §5.3.1). The plan is a typical S-curve
// between the project's start and end date, an assumption the card labels as
// one. Actual progress is the verified progress entries added up by week with
// the computeOverallProgress formula. The projection extends the pace of the
// last four calendar weeks and says so, or says why it cannot. Pure.
import { isRealCalendarDate, addCalendarDays } from '../timeWindow';
import { daysBetween, weekOf, weeksBetween } from './weekBuckets';

const PACE_WINDOW_WEEKS = 4;
const MAX_PROJECTION_WEEKS = 156;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Planned percent on a date: 100 × (3t² − 2t³), t the elapsed share of start→end. Null without two real dates in order. */
export function plannedPctAt(start: string | null | undefined, end: string | null | undefined, date: string): number | null {
  if (!start || !end || !isRealCalendarDate(start) || !isRealCalendarDate(end) || end <= start) return null;
  const t = Math.min(1, Math.max(0, daysBetween(start, date) / daysBetween(start, end)));
  return round1(100 * (3 * t * t - 2 * t * t * t));
}

export interface SCurveInput {
  start: string | null | undefined;
  end: string | null | undefined;
  /** Today as a WIB date. */
  today: string;
  /** Live work areas with a planned volume. */
  items: ReadonlyArray<{ id: string; planned: number }>;
  /** progress_entries: verification writes one per change, negative for a correction. */
  entries: ReadonlyArray<{ boq_item_id: string; quantity: number; created_at: string }>;
}

export interface SCurveProjection {
  pacePerWeek: number;
  windowWeeks: number;
  finishWeek: string;
  /** Weeks between the planned end and the projected finish; negative is early. Null without a plan. */
  weeksFromPlan: number | null;
}

export interface SCurve {
  weeks: string[];
  planned: Array<number | null>;
  actual: Array<number | null>;
  /** The projection line: starts at the latest verified point. */
  projected: Array<number | null>;
  hasPlan: boolean;
  plannedToday: number | null;
  latestActual: number | null;
  entryCount: number;
  projection: SCurveProjection | null;
  projectionNote: string | null;
}

export function buildSCurve(input: SCurveInput): SCurve {
  const { start, end, today, items } = input;
  const hasPlan = plannedPctAt(start, end, today) !== null;
  const planned = new Map(items.filter((i) => i.planned > 0).map((i) => [i.id, i.planned]));
  const totalPlanned = [...planned.values()].reduce((a, b) => a + b, 0);
  const entries = input.entries.filter((e) => planned.has(e.boq_item_id));
  const thisWeek = weekOf(today);

  const entryWeeks = entries.map((e) => weekOf(e.created_at)).sort();
  const firstWeek = [hasPlan ? weekOf(start as string) : null, entryWeeks[0] ?? null, thisWeek].filter((w): w is string => !!w).sort()[0];

  // Verified progress per week up to this week: per work area capped at its plan.
  const gainsByWeek = new Map<string, Array<{ row: string; quantity: number }>>();
  for (const e of entries) {
    const w = weekOf(e.created_at);
    gainsByWeek.set(w, [...(gainsByWeek.get(w) ?? []), { row: e.boq_item_id, quantity: Number(e.quantity) || 0 }]);
  }
  const installed = new Map<string, number>();
  const actualByWeek = new Map<string, number>();
  for (const w of weeksBetween(firstWeek, thisWeek)) {
    for (const g of gainsByWeek.get(w) ?? []) installed.set(g.row, (installed.get(g.row) ?? 0) + g.quantity);
    const capped = [...installed].reduce((sum, [row, q]) => sum + Math.min(Math.max(q, 0), planned.get(row) ?? 0), 0);
    actualByWeek.set(w, totalPlanned > 0 ? round1((100 * capped) / totalPlanned) : 0);
  }
  const latestActual = entries.length > 0 ? actualByWeek.get(thisWeek) ?? null : null;

  // Projection from the pace of the last four calendar weeks.
  let projection: SCurveProjection | null = null;
  let projectionNote: string | null = null;
  const verifiedWeeks = new Set(entryWeeks);
  if (entries.length === 0) {
    projectionNote = 'Belum ada progres terverifikasi.';
  } else if (verifiedWeeks.size < 2) {
    projectionNote = 'Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda.';
  } else if (latestActual !== null && latestActual < 100) {
    const weeksSinceFirst = Math.round(daysBetween(entryWeeks[0], thisWeek) / 7);
    const windowWeeks = Math.max(1, Math.min(PACE_WINDOW_WEEKS, weeksSinceFirst));
    const before = actualByWeek.get(addCalendarDays(thisWeek, -7 * windowWeeks)) ?? 0;
    const pace = round1((latestActual - before) / windowWeeks);
    if (pace <= 0) {
      // The note names the window it actually measured, which is shorter than PACE_WINDOW_WEEKS in a young project.
      projectionNote = `Tidak ada kenaikan progres terverifikasi dalam ${windowWeeks} minggu terakhir.`;
    } else {
      const weeksLeft = Math.min(MAX_PROJECTION_WEEKS, Math.ceil((100 - latestActual) / pace));
      const finishWeek = addCalendarDays(thisWeek, 7 * weeksLeft);
      projection = {
        pacePerWeek: pace, windowWeeks, finishWeek,
        weeksFromPlan: hasPlan ? Math.round(daysBetween(weekOf(end as string), finishWeek) / 7) : null,
      };
    }
  }

  const lastWeek = [hasPlan ? weekOf(end as string) : null, projection?.finishWeek ?? null, thisWeek].filter((w): w is string => !!w).sort().pop() as string;
  const weeks = weeksBetween(firstWeek, lastWeek);
  const lastDayOf = (w: string) => addCalendarDays(w, 6);
  return {
    weeks,
    // The plan is read at each week's end, and exactly at the two ends.
    planned: weeks.map((w, i) => (!hasPlan ? null : i === 0 ? plannedPctAt(start, end, start as string) : plannedPctAt(start, end, lastDayOf(w)))),
    actual: weeks.map((w) => (entries.length > 0 && w <= thisWeek ? actualByWeek.get(w) ?? null : null)),
    projected: weeks.map((w) => {
      if (!projection || latestActual === null || w < thisWeek) return null;
      const steps = Math.round(daysBetween(thisWeek, w) / 7);
      return Math.min(100, round1(latestActual + steps * projection.pacePerWeek));
    }),
    hasPlan,
    plannedToday: plannedPctAt(start, end, today),
    latestActual,
    entryCount: entries.length,
    projection,
    projectionNote,
  };
}
