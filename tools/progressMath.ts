// SANO — Unified overall-progress formula (Task 3.2)
//
// Before this module, "overall project progress %" was computed three
// different ways depending which screen/report you looked at:
//   1. tools/reports.ts generateProgressSummary — unweighted mean of
//      per-item progress over ALL items, including planned=0 items scored
//      as 0%.
//   2. Dashboard screens (Beranda/Laporan/Progres) — unweighted mean of the
//      cached `boq_items.progress` column.
//   3. tools/clientReport.ts overallProgress — unweighted mean, but
//      filtered to planned>0 items only (feeds the weekly-delta hint).
// Same project, three different percentages. This module is the single
// source of truth: every surface below calls `computeOverallProgress`.
//
// ── Binding formula (controller decision, Task 3.2) ─────────────────────
//
//   overall_pct = 100 × Σ min(installed_i, planned_i) / Σ planned_i
//
// computed over ACTIVE items only (superseded_at IS NULL — Task 3.1,
// migration 074_boq_items_supersede.sql) that have planned > 0.
//
// Rationale:
//   - Volume-weighted, not item-count-averaged: a near-done large item
//     isn't drowned out by many tiny 0%-progress items the way an
//     unweighted mean-of-percentages would drown it (dilution-resistant).
//   - Cost-weighting (Σ installed·price ÷ Σ planned·price) is impossible
//     for v2-published projects — publish writes no per-item prices.
//   - Each item's contribution is capped at its own `planned`
//     (min(installed, planned)) so a single over-installed item can't drag
//     the aggregate past what the rest of the plan would allow.
//
// Documented caveat: quantities are summed across mixed native units
// (m³ + m² + ls + kg + …) — this is standard RAB rolled-up practice, not a
// dimensional claim. Per-item percentages (installed_i / planned_i) remain
// exact; only the aggregate mixes units, same as any RAB progress curve.
//
// Edge case: Σ planned = 0 (no active item has planned > 0) → 0.
//
// Reviewer note: tools/reports.ts feeds this formula a derived `installed`
// (summed from progress_entries), while every screen surface (Beranda,
// Laporan, OfficeHomeScreen, OfficeReportsScreen, PrincipalHomeScreen,
// GlobalAIChatLauncher, schedule.ts computeProjectHealth) feeds it the
// cached `boq_items.installed` column. Same formula, same source-of-truth
// module — but if the cache lags behind progress_entries, the two families
// of callers can still diverge at the data level. Pre-existing, not
// introduced by this unification.

export interface ProgressAggregable {
  planned: number;
  installed: number;
  /** Task 3.1 — non-null means a later re-publish dropped this code. Excluded. */
  superseded_at?: string | null;
}

/**
 * Volume-weighted overall completion across active, planned>0 items.
 * Returns an unrounded percentage (0–100); callers round for display as
 * needed (some, like clientReport's weekly delta, subtract two of these
 * before rounding, so rounding here would lose precision).
 */
export function computeOverallProgress(items: ProgressAggregable[]): number {
  const active = items.filter((b) => (b.superseded_at ?? null) == null && b.planned > 0);
  if (active.length === 0) return 0;

  const totalPlanned = active.reduce((sum, b) => sum + b.planned, 0);
  if (totalPlanned <= 0) return 0;

  const totalCapped = active.reduce((sum, b) => sum + Math.min(b.installed, b.planned), 0);
  return 100 * (totalCapped / totalPlanned);
}
