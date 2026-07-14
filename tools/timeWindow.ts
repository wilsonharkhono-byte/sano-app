// SANO — Shared WIB (Asia/Jakarta, UTC+7) day-boundary math (Task 3.5)
//
// Before this module, "a report covering calendar date X" was interpreted
// three different, mutually-inconsistent ways depending which surface built
// the query:
//   1. tools/clientReport.ts — offset-less `${date}T00:00:00` / `T23:59:59`.
//      Postgres reads an offset-less timestamp literal as UTC, so for a site
//      operating in WIB (UTC+7) the "day" started/ended 7 hours late.
//   2. tools/reports.ts toStartOfDay/toEndOfDay — explicit `Z` (UTC) suffix.
//      Same UTC-anchored bug, just spelled differently.
//   3. tools/reports.ts generateAuditList — `date_to + 'T23:59:59'` with no
//      timezone marker at all, AND an inclusive `lte` bound that also drops
//      the [23:59:59.000, 23:59:59.999] tail of the day.
// All three disagree with each other and with what a WIB-based site actually
// means by "today". This module is the single source of truth: every report
// date-window construction should route through `dayRangeWIB`.
//
// WIB (Western Indonesia Time) has NO daylight-saving time — it is a fixed
// UTC+7 offset year-round, for every calendar date, with no exceptions. That
// means this is pure arithmetic: no Intl/timezone-database lookup is needed
// (unlike, say, US Eastern time, where the offset varies by date). Do not
// "upgrade" this to Intl.DateTimeFormat-based timezone resolution — it would
// add a dependency for zero behavioral benefit in this specific zone.
//
// Bounds convention: callers must use an EXCLUSIVE end (`lt`/`<` on the query
// side), not an inclusive `lte '...T23:59:59'` literal. An inclusive
// 23:59:59 bound silently drops the final second-fraction of the day
// (23:59:59.001–23:59:59.999); an exclusive boundary at the next day's
// 00:00:00 WIB has no such gap.

const WIB_OFFSET = '+07:00';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDateOnly(date: string): void {
  if (!DATE_ONLY_RE.test(date)) {
    throw new Error(`timeWindow: expected a YYYY-MM-DD calendar date, got "${date}"`);
  }
}

/** The next calendar date (YYYY-MM-DD), independent of any timezone. */
function nextCalendarDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  // UTC-anchored Date math avoids local-timezone DST edge cases entirely —
  // we only ever read back the Y/M/D fields, never an instant.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * UTC instant (ISO 8601, `Z`-suffixed) for 00:00:00 WIB on `date`.
 * This is the INCLUSIVE start of the WIB day.
 */
export function wibStartOfDayIso(date: string): string {
  assertDateOnly(date);
  return new Date(`${date}T00:00:00.000${WIB_OFFSET}`).toISOString();
}

/**
 * UTC instant (ISO 8601, `Z`-suffixed) for 00:00:00 WIB on the day AFTER
 * `date` — i.e. the EXCLUSIVE end of `date`'s WIB day (equivalent to
 * "24:00:00 WIB on `date`"). Query with `< toIso`, never `<= toIso`.
 */
export function wibEndOfDayExclusiveIso(date: string): string {
  assertDateOnly(date);
  return wibStartOfDayIso(nextCalendarDate(date));
}

export interface WibDayRange {
  /** Inclusive lower bound — query with `gte`/`>=`. */
  fromIso: string;
  /** Exclusive upper bound — query with `lt`/`<`. NEVER `lte`/`<=`. */
  toIso: string;
}

/**
 * Converts a `[dateFrom, dateTo]` calendar-date pair (both YYYY-MM-DD,
 * inclusive on both ends as calendar dates) into the correct UTC instant
 * bounds for the WIB day window: `fromIso` = 00:00:00 WIB on `dateFrom`,
 * `toIso` = 00:00:00 WIB on the day after `dateTo` (exclusive).
 *
 * `dateFrom === dateTo` is a valid single-day window.
 */
export function dayRangeWIB(dateFrom: string, dateTo: string): WibDayRange {
  return {
    fromIso: wibStartOfDayIso(dateFrom),
    toIso: wibEndOfDayExclusiveIso(dateTo),
  };
}
