import { dayRangeWIB, wibStartOfDayIso, wibEndOfDayExclusiveIso } from '../timeWindow';

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
