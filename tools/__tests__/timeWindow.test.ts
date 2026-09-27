import {
  dayRangeWIB,
  wibStartOfDayIso,
  wibEndOfDayExclusiveIso,
  isRealCalendarDate,
  addCalendarDays,
  todayIsoWIB,
  formatWibShort,
  WIB_MONTH_ABBR,
} from '../timeWindow';

describe('wibStartOfDayIso', () => {
  it('00:00:00 WIB is 17:00:00 UTC the PREVIOUS calendar date (WIB = UTC+7)', () => {
    expect(wibStartOfDayIso('2026-07-10')).toBe('2026-07-09T17:00:00.000Z');
  });

  it('throws on a non-date-only input (guards against an accidentally-pre-baked ISO datetime)', () => {
    expect(() => wibStartOfDayIso('2026-07-10T00:00:00Z')).toThrow();
  });
});

describe('wibEndOfDayExclusiveIso', () => {
  it('is the START of the NEXT day WIB, not 23:59:59 of the given day', () => {
    // 00:00:00 WIB on 07-11 == 17:00:00 UTC on 07-10 (WIB = UTC+7).
    expect(wibEndOfDayExclusiveIso('2026-07-10')).toBe('2026-07-10T17:00:00.000Z');
  });

  it('rolls over month/year boundaries correctly', () => {
    expect(wibEndOfDayExclusiveIso('2026-12-31')).toBe(wibStartOfDayIso('2027-01-01'));
  });
});

describe('dayRangeWIB — boundary instants (spec example)', () => {
  const { fromIso, toIso } = dayRangeWIB('2026-07-10', '2026-07-10');

  it('produces the documented single-day bounds', () => {
    expect(fromIso).toBe('2026-07-09T17:00:00.000Z');
    expect(toIso).toBe('2026-07-10T17:00:00.000Z');
  });

  it('2026-07-10T16:59:59Z (= 23:59:59 WIB on 07-10) is INSIDE the 2026-07-10 window', () => {
    const instant = '2026-07-10T16:59:59.000Z';
    expect(instant >= fromIso).toBe(true);
    expect(instant < toIso).toBe(true); // exclusive-end containment check
  });

  it('2026-07-10T17:00:00Z (= 00:00:00 WIB on 07-11) is OUTSIDE the 2026-07-10 window — belongs to 07-11', () => {
    const instant = '2026-07-10T17:00:00.000Z';
    expect(instant < toIso).toBe(false); // must be excluded, not included
  });

  it('the previous-day boundary (2026-07-09T16:59:59Z = 23:59:59 WIB on 07-09) is excluded from 07-10', () => {
    const instant = '2026-07-09T16:59:59.999Z';
    expect(instant >= fromIso).toBe(false);
  });
});

describe('dayRangeWIB — from == to (single day)', () => {
  it('spans exactly 24 hours', () => {
    const { fromIso, toIso } = dayRangeWIB('2026-01-15', '2026-01-15');
    const spanMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe('dayRangeWIB — multi-day ordering', () => {
  it('fromIso is strictly before toIso for a forward-ordered range', () => {
    const { fromIso, toIso } = dayRangeWIB('2026-07-01', '2026-07-10');
    expect(fromIso < toIso).toBe(true);
  });

  it('toIso is the exclusive-end of dateTo, not dateFrom', () => {
    const range = dayRangeWIB('2026-07-01', '2026-07-10');
    expect(range.toIso).toBe(wibEndOfDayExclusiveIso('2026-07-10'));
    expect(range.fromIso).toBe(wibStartOfDayIso('2026-07-01'));
  });

  it('a caller who accidentally swaps from/to gets a negative (empty) window rather than a silently-huge one — documents current behavior, no clamping', () => {
    const { fromIso, toIso } = dayRangeWIB('2026-07-10', '2026-07-01');
    expect(fromIso > toIso).toBe(true);
  });
});

describe('isRealCalendarDate', () => {
  it('accepts a leap day in a leap year', () => {
    expect(isRealCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects a leap day in a non-leap year', () => {
    expect(isRealCalendarDate('2026-02-29')).toBe(false);
  });

  it('rejects the classic invalid date 2026-02-30', () => {
    expect(isRealCalendarDate('2026-02-30')).toBe(false);
  });

  it('accepts month-end and year-end dates', () => {
    expect(isRealCalendarDate('2026-01-31')).toBe(true);
    expect(isRealCalendarDate('2026-12-31')).toBe(true);
  });

  it('rejects shapes that are not YYYY-MM-DD', () => {
    expect(isRealCalendarDate('2026-9-1')).toBe(false);
    expect(isRealCalendarDate('2026-07-10T00:00:00Z')).toBe(false);
    expect(isRealCalendarDate('')).toBe(false);
  });
});

describe('addCalendarDays', () => {
  it('crosses a leap day', () => {
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addCalendarDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('crosses a month end', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year end', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('goes backward for negative days', () => {
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is a no-op for zero days', () => {
    expect(addCalendarDays('2026-06-15', 0)).toBe('2026-06-15');
  });
});

/**
 * The WIB "today" every site-event surface asks for. The instants below are the
 * ones that catch a device-clock implementation: between 17:00 UTC and 24:00
 * UTC, Jakarta is already on the NEXT calendar date, so a function that read
 * the machine's own day would be a full date behind for a third of every day.
 */
describe('todayIsoWIB', () => {
  it('is already tomorrow in Jakarta once UTC passes 17:00 (WIB = UTC+7)', () => {
    expect(todayIsoWIB(new Date('2026-09-11T16:59:59.999Z'))).toBe('2026-09-11');
    expect(todayIsoWIB(new Date('2026-09-11T17:00:00.000Z'))).toBe('2026-09-12');
    expect(todayIsoWIB(new Date('2026-09-11T23:59:59.999Z'))).toBe('2026-09-12');
  });

  it('agrees with wibStartOfDayIso on both sides of the WIB midnight it names', () => {
    const justBefore = new Date('2026-09-11T16:59:59.999Z');
    const atMidnight = new Date(wibStartOfDayIso('2026-09-12'));
    expect(atMidnight.toISOString()).toBe('2026-09-11T17:00:00.000Z');
    expect(todayIsoWIB(justBefore)).toBe('2026-09-11');
    expect(todayIsoWIB(atMidnight)).toBe('2026-09-12');
  });

  it('rolls the month and the year over at WIB midnight, not UTC midnight', () => {
    expect(todayIsoWIB(new Date('2026-01-31T17:00:00.000Z'))).toBe('2026-02-01');
    expect(todayIsoWIB(new Date('2026-12-31T16:00:00.000Z'))).toBe('2026-12-31');
    expect(todayIsoWIB(new Date('2026-12-31T17:00:00.000Z'))).toBe('2027-01-01');
  });

  it('returns a real, shape-valid calendar date', () => {
    const today = todayIsoWIB(new Date('2026-02-28T20:00:00.000Z'));
    expect(today).toBe('2026-03-01');
    expect(isRealCalendarDate(today)).toBe(true);
  });
});

/**
 * Closure spec 2026-09-26 §4.6 and §5.6: the superseded close card and the
 * digest health line print an instant as "17 Sep 14.05" in WIB. Fixed +7 h
 * arithmetic, like todayIsoWIB, so the day and the month roll at 17:00 UTC.
 */
describe('formatWibShort', () => {
  it('prints day, Indonesian month and HH.mm in WIB', () => {
    expect(formatWibShort('2026-09-17T07:05:00.000Z')).toBe('17 Sep 14.05');
    expect(formatWibShort('2026-09-17T00:00:00.000Z')).toBe('17 Sep 07.00');
  });

  it('rolls the date at 17:00 UTC, across a month and a year boundary', () => {
    expect(formatWibShort('2026-09-11T16:59:00.000Z')).toBe('11 Sep 23.59');
    expect(formatWibShort('2026-09-11T17:00:00.000Z')).toBe('12 Sep 00.00');
    expect(formatWibShort('2026-01-31T17:30:00.000Z')).toBe('1 Feb 00.30');
    expect(formatWibShort('2026-12-31T17:00:00.000Z')).toBe('1 Jan 00.00');
  });

  it('reads an offset timestamp the way Postgres returns one', () => {
    expect(formatWibShort('2026-08-05T09:15:00+07:00')).toBe('5 Agu 09.15');
  });

  it('returns an unparseable value unchanged instead of inventing a time', () => {
    expect(formatWibShort('bukan tanggal')).toBe('bukan tanggal');
  });

  it('spells the twelve months the Indonesian way', () => {
    expect(WIB_MONTH_ABBR).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']);
  });
});
