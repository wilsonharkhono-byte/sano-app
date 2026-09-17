// tools/__tests__/progressClaimsWeek.test.ts
import { shortDateId, weekEndWIB, weekLabel, weekStartWIB } from '../progressClaims/week';

describe('WIB week helpers', () => {
  it('starts the week on Monday 00:00 WIB whatever the device zone', () => {
    expect(weekStartWIB(new Date('2026-09-13T16:59:59.000Z'))).toBe('2026-09-07'); // Sunday 23:59:59 WIB
    expect(weekStartWIB(new Date('2026-09-13T17:00:00.000Z'))).toBe('2026-09-14'); // Monday 00:00 WIB
    expect(weekStartWIB(new Date('2026-09-19T10:00:00.000Z'))).toBe('2026-09-14'); // Saturday
    expect(weekStartWIB(new Date('2026-03-01T03:00:00.000Z'))).toBe('2026-02-23'); // across a month
  });

  it('ends the week on Sunday and labels it in Indonesian', () => {
    expect(weekEndWIB('2026-09-14')).toBe('2026-09-20');
    expect(shortDateId('2026-08-01')).toBe('1 Agu');
    expect(weekLabel('2026-09-14')).toBe(`Minggu 14${String.fromCharCode(0x2013)}20 Sep`);
  });
});
