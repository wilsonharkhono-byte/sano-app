// Task 3.3 — one "Perlu Pengadaan" (needs procurement) predicate. Before this
// task, LaporanScreen's dashboard tile used on_site <= max(planned*0.1, 0)
// while excel.ts/reports.ts used received < planned*0.8 — the same material
// could classify differently on the tile vs. in an export. This locks the
// controller-decided on_site-based rule as the single source of truth.

import { needsProcurement, PROCUREMENT_THRESHOLD_PCT } from '../materialThresholds';

describe('needsProcurement', () => {
  it('exposes the 10% threshold constant', () => {
    expect(PROCUREMENT_THRESHOLD_PCT).toBe(0.1);
  });

  it('flags at exactly the 10% boundary (<=, inclusive)', () => {
    expect(needsProcurement({ planned: 1000, on_site: 100 })).toBe(true);
  });

  it('does not flag just above the 10% boundary', () => {
    expect(needsProcurement({ planned: 1000, on_site: 100.01 })).toBe(false);
  });

  it('flags just below the 10% boundary', () => {
    expect(needsProcurement({ planned: 1000, on_site: 99.99 })).toBe(true);
  });

  it('does not flag comfortable on-site stock (well above 10%)', () => {
    expect(needsProcurement({ planned: 100, on_site: 50 })).toBe(false);
  });

  it('flags zero on-site stock when there is a plan', () => {
    expect(needsProcurement({ planned: 100, on_site: 0 })).toBe(true);
  });

  it('flags negative on-site (deficit) when there is a plan', () => {
    expect(needsProcurement({ planned: 100, on_site: -5 })).toBe(true);
  });

  it('guards planned === 0: never flags regardless of on_site', () => {
    expect(needsProcurement({ planned: 0, on_site: 0 })).toBe(false);
    expect(needsProcurement({ planned: 0, on_site: -5 })).toBe(false);
    expect(needsProcurement({ planned: 0, on_site: 5 })).toBe(false);
  });

  it('guards negative planned: never flags regardless of on_site', () => {
    expect(needsProcurement({ planned: -10, on_site: -5 })).toBe(false);
    expect(needsProcurement({ planned: -10, on_site: 0 })).toBe(false);
  });

  it('a fully-received-but-installed material still flags (the case the old received<0.8*planned rule missed)', () => {
    // received === planned (100% received), but almost all of it is already
    // installed, so on_site is low. The old rule (received < planned*0.8)
    // would call this "fine"; the on_site rule correctly flags it.
    const planned = 100;
    const received = 100;
    const installed = 95;
    const on_site = received - installed; // 5
    expect(needsProcurement({ planned, on_site })).toBe(true);
  });
});
