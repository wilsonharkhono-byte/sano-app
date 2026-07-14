import {
  DRIFT_TOLERANCE_PCT,
  computeDriftPct,
  shouldShowDriftBadge,
  formatDriftPct,
  formatDriftBadge,
  aggregateDriftRollup,
  formatRollupTile,
  type MaterialDrift,
} from '../planDrift';

// ── computeDriftPct ─────────────────────────────────────────────────────

describe('computeDriftPct', () => {
  it('computes (current - baseline) / baseline', () => {
    expect(computeDriftPct(1000, 1200)).toBeCloseTo(0.2, 6);
    expect(computeDriftPct(1000, 850)).toBeCloseTo(-0.15, 6);
  });

  it('is exactly 0 when current === baseline', () => {
    expect(computeDriftPct(500, 500)).toBe(0);
  });

  it('returns null (never Infinity/NaN) when baseline is 0', () => {
    const result = computeDriftPct(0, 100);
    expect(result).toBeNull();
    expect(result).not.toBe(Infinity);
  });

  it('returns null when baseline is 0 and current is also 0', () => {
    expect(computeDriftPct(0, 0)).toBeNull();
  });

  it('returns null on missing/null inputs (no snapshot yet)', () => {
    expect(computeDriftPct(null, 100)).toBeNull();
    expect(computeDriftPct(undefined, 100)).toBeNull();
    expect(computeDriftPct(1000, null)).toBeNull();
  });

  it('returns null on non-finite inputs rather than propagating NaN', () => {
    expect(computeDriftPct(NaN, 100)).toBeNull();
    expect(computeDriftPct(1000, NaN)).toBeNull();
  });
});

// ── shouldShowDriftBadge (tolerance gating) ─────────────────────────────

describe('shouldShowDriftBadge', () => {
  it('is false for exact 0 drift', () => {
    expect(shouldShowDriftBadge(0)).toBe(false);
  });

  it('is false for null (missing snapshot / no baseline)', () => {
    expect(shouldShowDriftBadge(null)).toBe(false);
    expect(shouldShowDriftBadge(undefined)).toBe(false);
  });

  it('is false below the tolerance (float noise)', () => {
    expect(shouldShowDriftBadge(0.001)).toBe(false);
    expect(shouldShowDriftBadge(-0.002)).toBe(false);
  });

  it('is true at and above the tolerance, either direction', () => {
    expect(shouldShowDriftBadge(DRIFT_TOLERANCE_PCT)).toBe(true);
    expect(shouldShowDriftBadge(-DRIFT_TOLERANCE_PCT)).toBe(true);
    expect(shouldShowDriftBadge(0.2)).toBe(true);
    expect(shouldShowDriftBadge(-0.2)).toBe(true);
  });

  it('never throws on non-finite input', () => {
    expect(shouldShowDriftBadge(Infinity)).toBe(false);
    expect(shouldShowDriftBadge(NaN)).toBe(false);
  });
});

// ── formatDriftPct / formatDriftBadge — copy contract ───────────────────

describe('formatDriftPct', () => {
  it('always shows a sign, rounds to whole percent — spec canonical example', () => {
    expect(formatDriftPct(0.2)).toBe('+20%');
  });

  it('shows a minus sign for negative drift', () => {
    expect(formatDriftPct(-0.15)).toBe('-15%');
  });

  it('shows a plus sign at exactly 0 (defensive — badge already gates on this)', () => {
    expect(formatDriftPct(0)).toBe('+0%');
  });
});

describe('formatDriftBadge — spec §4 canonical copy', () => {
  it('matches "Rencana direvisi +20% dari baseline awal" exactly', () => {
    expect(formatDriftBadge(0.2)).toBe('Rencana direvisi +20% dari baseline awal');
  });

  it('matches the negative-direction copy', () => {
    expect(formatDriftBadge(-0.15)).toBe('Rencana direvisi -15% dari baseline awal');
  });
});

// ── aggregateDriftRollup — office project rollup ────────────────────────

const drift = (o: Partial<MaterialDrift> & Pick<MaterialDrift, 'baseline_planned_qty' | 'current_planned_qty'>): MaterialDrift => ({
  material_id: o.material_id ?? 'm',
  material_name: o.material_name ?? 'Material',
  unit: o.unit ?? 'kg',
  baseline_planned_qty: o.baseline_planned_qty,
  current_planned_qty: o.current_planned_qty,
  drift_pct: o.drift_pct !== undefined ? o.drift_pct : computeDriftPct(o.baseline_planned_qty, o.current_planned_qty),
});

describe('aggregateDriftRollup', () => {
  it('computes sum(current)/sum(baseline) - 1 across materials with snapshots', () => {
    const rows = [
      drift({ material_id: 'a', baseline_planned_qty: 1000, current_planned_qty: 1200 }), // +20%
      drift({ material_id: 'b', baseline_planned_qty: 500, current_planned_qty: 500 }),   // 0%
    ];
    const rollup = aggregateDriftRollup(rows);
    // (1200 + 500 - 1000 - 500) / (1000 + 500) = 200 / 1500
    expect(rollup.rollup_pct).toBeCloseTo(200 / 1500, 6);
  });

  it('counts rising and falling materials against the same tolerance as the badge', () => {
    const rows = [
      drift({ material_id: 'a', baseline_planned_qty: 1000, current_planned_qty: 1200 }), // rising
      drift({ material_id: 'b', baseline_planned_qty: 1000, current_planned_qty: 800 }),  // falling
      drift({ material_id: 'c', baseline_planned_qty: 1000, current_planned_qty: 1001 }), // within tolerance — flat
    ];
    const rollup = aggregateDriftRollup(rows);
    expect(rollup.rising_count).toBe(1);
    expect(rollup.falling_count).toBe(1);
    expect(rollup.total_with_snapshot).toBe(3);
  });

  it('returns null rollup_pct (never Infinity) when every baseline sums to 0', () => {
    const rows = [
      drift({ material_id: 'a', baseline_planned_qty: 0, current_planned_qty: 0, drift_pct: null }),
    ];
    const rollup = aggregateDriftRollup(rows);
    expect(rollup.rollup_pct).toBeNull();
    expect(rollup.total_with_snapshot).toBe(1);
  });

  it('empty input → zero counts, null rollup_pct, no badge', () => {
    const rollup = aggregateDriftRollup([]);
    expect(rollup.rollup_pct).toBeNull();
    expect(rollup.rising_count).toBe(0);
    expect(rollup.falling_count).toBe(0);
    expect(rollup.total_with_snapshot).toBe(0);
  });
});

describe('formatRollupTile — spec §4 canonical copy', () => {
  it('matches "Rencana material bergeser +X% dari baseline awal (N naik, M turun)"', () => {
    const rows = [
      drift({ material_id: 'a', baseline_planned_qty: 1000, current_planned_qty: 1400 }), // rising
      drift({ material_id: 'b', baseline_planned_qty: 1000, current_planned_qty: 1000 }), // flat
    ];
    const rollup = aggregateDriftRollup(rows);
    expect(formatRollupTile(rollup)).toBe(
      'Rencana material bergeser +20% dari baseline awal (1 naik, 0 turun)',
    );
  });

  it('returns null when there is nothing to roll up (no snapshots yet)', () => {
    expect(formatRollupTile(aggregateDriftRollup([]))).toBeNull();
  });
});
