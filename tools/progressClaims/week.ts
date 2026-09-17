// tools/progressClaims/week.ts
// SANO — the WIB (Asia/Jakarta) week a progress claim belongs to. Pure.
// Built on tools/timeWindow.ts so the device zone never decides the week;
// migration 104 computes the same Monday with date_trunc('week', now() AT TIME ZONE 'Asia/Jakarta').
import { addCalendarDays, todayIsoWIB } from '../timeWindow';

const SHORT_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Monday (YYYY-MM-DD) of the WIB week containing `now`. */
export function weekStartWIB(now: Date = new Date()): string {
  const today = todayIsoWIB(now);
  const [y, m, d] = today.split('-').map(Number);
  const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addCalendarDays(today, -daysSinceMonday);
}

/** Sunday (YYYY-MM-DD) of the week that starts on `weekStart`. */
export function weekEndWIB(weekStart: string): string {
  return addCalendarDays(weekStart, 6);
}

/** "2026-09-14" → "14 Sep". */
export function shortDateId(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS_ID[m - 1]}`;
}

/** "Minggu 14–20 Sep" for the week starting on `weekStart`. */
export function weekLabel(weekStart: string): string {
  return `Minggu ${shortDateId(weekStart).split(' ')[0]}–${shortDateId(weekEndWIB(weekStart))}`;
}
