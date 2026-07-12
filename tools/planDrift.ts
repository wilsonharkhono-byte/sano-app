// SANO — Signal-2 plan-drift math (Task 2.13, Phase 2).
//
// Pure, dependency-free helpers (no supabase, no react-native) — same
// discipline as requestOverage.ts (Signal 1). Unit-tests without mocking.
// Shared by:
//   - workflows/screens/PermintaanScreen.tsx (per-material drift badge, supervisor)
//   - office/screens/OfficeReportsScreen.tsx (project rollup tile, estimator/principal)
//   - tools/reports.ts Material Balance report (per-material drift column, office only)
//
// Design authority: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §4
//   "Signal 2 — plan drift". Table shape / copy below are binding per that spec.
//
//   drift_pct = (current_planned − baseline_planned) / baseline_planned
//   Badge only when |drift_pct| is not noise (tolerance, see DRIFT_TOLERANCE_PCT below).
//   Copy: "Rencana direvisi +20% dari baseline awal" — sign always shown, no Rp
//   (supervisor sees quantities/percent only; §4 "Visibility").
//   Rollup: "Rencana material proyek ini bergeser +8% dari baseline awal
//   (14 material direvisi naik, 2 turun)".
//
// The data anchor is `material_baseline_snapshots` (migration 077, INSERT-only —
// see that file's header). getMaterialDrift() in tools/envelopes.ts joins those
// snapshots against the CURRENT plan (v_material_envelope_status.total_planned)
// and hands rows shaped like MaterialDrift below into these pure functions.

/**
 * Minimum |drift_pct| that renders a badge/counts as rising-or-falling in the
 * rollup. 0.5% absorbs floating-point noise from the qty aggregation pipeline
 * (SUM() over many boq_item lines) without hiding a real, meaningful revision.
 * Below this, a material reads as "flat" even though its snapshot and current
 * plan may differ by a few decimal places.
 */
export const DRIFT_TOLERANCE_PCT = 0.005;

export interface MaterialDrift {
  material_id: string;
  material_name: string;
  unit: string;
  /** Base-unit qty as of the material's first publish (immutable, 077). */
  baseline_planned_qty: number;
  /** Base-unit qty from the CURRENT published master (v_material_envelope_status.total_planned). */
  current_planned_qty: number;
  /** null = no valid comparison (zero/missing baseline) — never Infinity/NaN. */
  drift_pct: number | null;
}

/**
 * (current − baseline) / baseline. Returns null — never Infinity or NaN — when
 * either input is missing/non-finite, or when baseline is exactly 0 (a material
 * whose first-publish plan was zero has no meaningful percentage to report;
 * CLAUDE.md §1.1 — absent is better than a fabricated/undefined number).
 */
export function computeDriftPct(
  baselinePlannedQty: number | null | undefined,
  currentPlannedQty: number | null | undefined,
): number | null {
  if (baselinePlannedQty == null || currentPlannedQty == null) return null;
  if (!Number.isFinite(baselinePlannedQty) || !Number.isFinite(currentPlannedQty)) return null;
  if (baselinePlannedQty === 0) return null;
  return (currentPlannedQty - baselinePlannedQty) / baselinePlannedQty;
}

/**
 * Gate for whether a drift badge renders at all. Spec §4: "Zero drift → no
 * badge." Extended here to "no badge inside tolerance" so float noise from
 * qty aggregation doesn't paint every material as revised.
 */
export function shouldShowDriftBadge(driftPct: number | null | undefined): boolean {
  if (driftPct == null || !Number.isFinite(driftPct)) return false;
  return Math.abs(driftPct) >= DRIFT_TOLERANCE_PCT;
}

/** "+20%" / "-15%" / "+0%" — sign always shown per spec §4 canonical copy. */
export function formatDriftPct(driftPct: number): string {
  const whole = Math.round(driftPct * 100);
  const sign = whole >= 0 ? '+' : '';
  return `${sign}${whole}%`;
}

/**
 * "Rencana direvisi +20% dari baseline awal" — the exact per-material badge
 * copy from spec §4. Caller is responsible for gating with shouldShowDriftBadge
 * first; this function does not itself suppress zero/near-zero drift.
 */
export function formatDriftBadge(driftPct: number): string {
  return `Rencana direvisi ${formatDriftPct(driftPct)} dari baseline awal`;
}

export interface DriftRollup {
  /** sum(current)/sum(baseline) − 1 across materials WITH a snapshot. null = no baseline sum to divide by. */
  rollup_pct: number | null;
  /** count of materials whose own drift_pct >= +tolerance. */
  rising_count: number;
  /** count of materials whose own drift_pct <= −tolerance. */
  falling_count: number;
  /** total materials fed in (all of which have a baseline snapshot — see getMaterialDrift). */
  total_with_snapshot: number;
}

/**
 * Project-wide rollup for the office dashboard tile (spec §4 "Project rollup").
 * Aggregates by SUMMING current and baseline first, then taking one ratio —
 * NOT by averaging each material's individual drift_pct — so a few
 * high-volume materials don't get diluted by many low-volume ones the way a
 * naive average would. Materials with no valid per-material drift_pct (e.g.
 * zero baseline) still contribute their raw qty to the sums but are excluded
 * from the rising/falling counts (their own direction is undefined).
 */
export function aggregateDriftRollup(
  materials: ReadonlyArray<Pick<MaterialDrift, 'baseline_planned_qty' | 'current_planned_qty' | 'drift_pct'>>,
): DriftRollup {
  let sumBaseline = 0;
  let sumCurrent = 0;
  let risingCount = 0;
  let fallingCount = 0;

  for (const m of materials) {
    sumBaseline += m.baseline_planned_qty;
    sumCurrent += m.current_planned_qty;
    if (m.drift_pct != null && Number.isFinite(m.drift_pct)) {
      if (m.drift_pct >= DRIFT_TOLERANCE_PCT) risingCount += 1;
      else if (m.drift_pct <= -DRIFT_TOLERANCE_PCT) fallingCount += 1;
    }
  }

  const rollupPct = sumBaseline !== 0 ? (sumCurrent - sumBaseline) / sumBaseline : null;

  return {
    rollup_pct: rollupPct,
    rising_count: risingCount,
    falling_count: fallingCount,
    total_with_snapshot: materials.length,
  };
}

/**
 * "Rencana material bergeser +X% dari baseline awal (N naik, M turun)" — the
 * office dashboard tile copy from spec §4. Returns null when there is no
 * rollup percentage to show (no materials with a usable baseline sum yet) —
 * caller renders nothing rather than a hollow "0 material" tile.
 */
export function formatRollupTile(rollup: DriftRollup): string | null {
  if (rollup.rollup_pct == null) return null;
  return `Rencana material bergeser ${formatDriftPct(rollup.rollup_pct)} dari baseline awal `
    + `(${rollup.rising_count} naik, ${rollup.falling_count} turun)`;
}
