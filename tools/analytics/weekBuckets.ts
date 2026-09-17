// tools/analytics/weekBuckets.ts
// SANO — analytics bucket by WIB week (Monday, YYYY-MM-DD), the same week the
// progress claims use. Pure.
import { addCalendarDays, todayIsoWIB } from '../timeWindow';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date (YYYY-MM-DD) as is; a timestamp as its WIB calendar date. */
export function dateOf(isoDateOrTimestamp: string): string {
  return DATE_RE.test(isoDateOrTimestamp) ? isoDateOrTimestamp : todayIsoWIB(new Date(isoDateOrTimestamp));
}

/** Monday of the WIB week containing a date or a timestamp. */
export function weekOf(isoDateOrTimestamp: string): string {
  const date = dateOf(isoDateOrTimestamp);
  const [y, m, d] = date.split('-').map(Number);
  const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addCalendarDays(date, -daysSinceMonday);
}

/** Every Monday from `fromWeek` to `toWeek`, both included. */
export function weeksBetween(fromWeek: string, toWeek: string): string[] {
  const weeks: string[] = [];
  for (let w = fromWeek; w <= toWeek && weeks.length < 520; w = addCalendarDays(w, 7)) weeks.push(w);
  return weeks;
}

export function daysBetween(fromDate: string, toDate: string): number {
  const ms = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(toDate) - ms(fromDate)) / 86400000);
}
