import { computeOverallProgress } from '../progressMath';

describe('computeOverallProgress', () => {
  it('is dilution-resistant: 1 big near-done item outweighs 10 tiny 0% items', () => {
    const items = [
      { planned: 1000, installed: 900 }, // 90% of a huge item
      ...Array.from({ length: 10 }, () => ({ planned: 1, installed: 0 })), // 10 tiny 0% items
    ];
    const weighted = computeOverallProgress(items);
    // Volume-weighted: 900 / 1010 ≈ 89.1%
    expect(weighted).toBeCloseTo((900 / 1010) * 100, 5);

    // The OLD unweighted mean-of-percentages formula would give a much
    // lower number: (90 + 0*10) / 11 ≈ 8.2% — this is exactly the dilution
    // bug this formula fixes.
    const oldUnweightedMean = (90 + 0 * 10) / 11;
    expect(weighted).toBeGreaterThan(oldUnweightedMean * 5);
  });

  it('caps a single over-installed item at its own planned so it cannot drag the aggregate over 100%', () => {
    const items = [
      { planned: 10, installed: 25 }, // way over-installed
      { planned: 10, installed: 0 },
    ];
    // Without the cap this would be (25+0)/20 = 125%. With the cap:
    // (min(25,10) + min(0,10)) / 20 = 10/20 = 50%.
    expect(computeOverallProgress(items)).toBe(50);
  });

  it('excludes items with planned = 0 from both numerator and denominator', () => {
    const items = [
      { planned: 0, installed: 999 }, // untracked/zero-planned — must not pollute
      { planned: 10, installed: 5 },
    ];
    expect(computeOverallProgress(items)).toBe(50);
  });

  it('returns 0 for an empty item list', () => {
    expect(computeOverallProgress([])).toBe(0);
  });

  it('returns 0 when every active item has planned = 0 (no denominator)', () => {
    const items = [
      { planned: 0, installed: 5 },
      { planned: 0, installed: 0 },
    ];
    expect(computeOverallProgress(items)).toBe(0);
  });

  it('excludes superseded items (Task 3.1) from the aggregate', () => {
    const active = [{ planned: 10, installed: 10 }]; // 100%
    const superseded = [{ planned: 1000, installed: 0, superseded_at: '2026-06-01T00:00:00Z' }];
    expect(computeOverallProgress([...active, ...superseded])).toBe(100);
  });

  it('treats undefined superseded_at as active (default)', () => {
    const items = [{ planned: 10, installed: 10 }];
    expect(computeOverallProgress(items)).toBe(100);
  });

  it('is volume-weighted, not item-count-averaged, for a simple two-item mix', () => {
    const items = [
      { planned: 90, installed: 90 },  // 100% of a big item
      { planned: 10, installed: 0 },   // 0% of a small item
    ];
    // Volume-weighted: 90/100 = 90%, NOT the unweighted mean (100+0)/2 = 50%.
    expect(computeOverallProgress(items)).toBe(90);
  });
});
