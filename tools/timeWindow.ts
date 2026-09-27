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
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks SHAPE only (`YYYY-MM-DD`), not that the date actually exists —
 * `assertDateOnly('2026-02-30')` does NOT throw, because `Date.UTC` silently
 * rolls an out-of-range day into the next month before anything reads it
 * back. That's fine for this module's own functions, which only ever add
 * whole days to a shape-valid string and re-derive Y/M/D from the result.
 * A caller that needs to know the INPUT itself is a real calendar date
 * (e.g. validating a date typed by a person) should use
 * `isRealCalendarDate` below instead.
 */
function assertDateOnly(date: string): void {
  if (!DATE_ONLY_RE.test(date)) {
    throw new Error(`timeWindow: expected a YYYY-MM-DD calendar date, got "${date}"`);
  }
}

/**
 * True when `iso` is shaped `YYYY-MM-DD` AND is a calendar date that really
 * exists — the Y/M/D round-trips through `Date.UTC` unchanged. Rejects
 * `2026-02-30` (April 31st, February 30th, month 13, etc.), unlike
 * `assertDateOnly`, which only checks the shape.
 */
export function isRealCalendarDate(iso: string): boolean {
  if (!DATE_ONLY_RE.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * The calendar date it is RIGHT NOW in WIB (Asia/Jakarta), `YYYY-MM-DD`.
 *
 * Deliberately NOT the device's own calendar day. A phone on WITA (UTC+8) or
 * WIT (UTC+9) rolls into a new local date one or two hours before Jakarta
 * does, so "today" read off the device disagrees with every server-side rule
 * that compares against `(now() AT TIME ZONE 'Asia/Jakarta')::date` — most
 * visibly confirm_site_event's due-date check, which would then accept a date
 * the screen had already called "past" (or the reverse, one date later).
 *
 * Same fixed-offset arithmetic as the rest of this module: shift the instant
 * by +7 h and read the UTC Y/M/D fields off the result. WIB has no DST, so
 * this is exact for every date. Do not re-implement it with
 * `Intl.DateTimeFormat` (see the module header).
 */
export function todayIsoWIB(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * `iso` plus `days` calendar days (negative goes backward), independent of
 * any timezone. Returns `YYYY-MM-DD`.
 */
export function addCalendarDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  // UTC-anchored Date math avoids local-timezone DST edge cases entirely —
  // we only ever read back the Y/M/D fields, never an instant.
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** The next calendar date (YYYY-MM-DD), independent of any timezone. */
function nextCalendarDate(date: string): string {
  return addCalendarDays(date, 1);
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

/**
 * Indonesian month abbreviations, index 0 = January. Migration 106's
 * site_event_digest_day() spells the same twelve; migration106.test.ts
 * compares the two lists so a push and the app never name a month
 * differently.
 */
export const WIB_MONTH_ABBR: ReadonlyArray<string> = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * "17 Sep 14.05": an instant as a WIB day, short month and 24-hour time with
 * a dot, the Indonesian convention. Same fixed +7 h arithmetic as
 * todayIsoWIB. The day carries no leading zero, like the SQL 'FMDD' in 106.
 * An unparseable input is returned unchanged rather than turned into a
 * made-up time.
 */
export function formatWibShort(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const shifted = new Date(ms + WIB_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${WIB_MONTH_ABBR[shifted.getUTCMonth()]} ${hh}.${mm}`;
}
