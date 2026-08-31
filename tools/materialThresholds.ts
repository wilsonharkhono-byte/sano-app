// SANO — "Perlu Pengadaan" (needs procurement) predicate (Task 3.3).
//
// Pure, dependency-free helper (no supabase, no react-native) so it unit-tests
// without mocking — same discipline as planDrift.ts / requestOverage.ts /
// budgetGate.ts. New home rather than folding into an existing module:
//   - NOT progressMath.ts — that module is BoQ-progress-% math (volume-weighted
//     completion), a different domain than material stock levels.
//   - NOT planDrift.ts — that's Signal 2 (plan revision vs. baseline), a
//     different question ("did the plan change?") from this one ("is there
//     enough material on site right now?").
//   - This file is the material-stock-threshold analog of those two: one
//     small pure module per cross-surface predicate, per the established
//     pattern in this codebase.
//
// Shared by:
//   - workflows/screens/LaporanScreen.tsx (dashboard "Perlu Pengadaan" tile)
//   - tools/reports.ts (Material Balance report `needs_procurement` summary count)
//   - tools/excel.ts / tools/pdf.ts (Material Balance per-row Status column)
//   - workflows/components/ReportPreview.tsx (in-app preview of the same summary)
//
// Binding controller decision (Task 3.3, 2026-07-12): before this task, two
// different rules shared the "Perlu Pengadaan" label —
//   (a) LaporanScreen tile: on_site <= max(planned * 0.1, 0)
//   (b) excel.ts / reports.ts under_received: received < planned * 0.8
// The on_site-based rule (a) wins, because on_site (received − installed)
// reflects REAL REMAINING STOCK, not cumulative receipts. A material that has
// been fully received but is nearly all installed genuinely needs
// re-procurement to finish the job; the received-based rule would call that
// "fine" purely because the historical receiving total looked healthy.
//
// CAVEAT — carry this into any caller-facing copy: `on_site` is itself an
// ESTIMATE, not a measured stock count. Its `installed` side is derived from
// BoQ progress % × usage rate, not from a physical inventory count (see
// tools/derivation.ts `MaterialBalance.on_site` and the Material Balance
// report's documented caveat). Treat "needs procurement" as a planning
// signal, not a certified stockout.
//
// Follow-up (live-verified diagnosis, 2026-08-31): the report never read
// purchase_orders/material_request_* quantities, so a fully-ordered-but-not-
// yet-delivered material still flagged "Perlu Pengadaan" while Gate2 already
// showed zero remaining allocation — roles saw contradictory stories.
// `needsProcurement` now takes an optional `on_order` leg (tools/derivation.ts
// MaterialBalance.on_order, from v_material_envelope_status) that offsets the
// shortage; `isShortOnSite` exposes the old on_site-only signal so callers can
// distinguish "genuinely short" from "short but already ordered" and surface
// that third state distinctly instead of collapsing it into either extreme.

/** Below this fraction of `planned`, remaining on-site stock is low enough to flag. */
export const PROCUREMENT_THRESHOLD_PCT = 0.1;

/**
 * true when the material's remaining ON-SITE stock ALONE — ignoring any open
 * purchase order — is at or below 10% of planned. This is the raw physical-
 * stock signal; `needsProcurement` below is the caller-facing predicate and
 * additionally credits stock already on order. Use this one when you need to
 * tell "genuinely short" apart from "short on-site but an order is already in
 * flight" (see tools/excel.ts / tools/pdf.ts / LaporanScreen's "Sudah dipesan
 * — menunggu kedatangan" status, which needs exactly that distinction).
 * Guarded to `planned > 0`, same as needsProcurement.
 */
export function isShortOnSite({ planned, on_site }: { planned: number; on_site: number }): boolean {
  if (!(planned > 0)) return false;
  return on_site <= planned * PROCUREMENT_THRESHOLD_PCT;
}

/**
 * true when the material's remaining on-site stock is at or below 10% of the
 * planned quantity AND that shortage is not already covered by quantity on
 * an open purchase order. `on_order` (tools/derivation.ts MaterialBalance.on_order
 * = max(0, ordered − received), sourced from v_material_envelope_status) is
 * ADDED to on_site before the threshold check — a material sitting at 2%
 * on-site with a PO covering the rest reads as fine here, not as a false
 * "Perlu Pengadaan" the admin has already resolved.
 *
 * `on_order` defaults to 0, so a caller that hasn't wired the envelope-status
 * fetch — or a material with no v_material_envelope_status row at all (no PO
 * ever raised for it) — gets EXACTLY today's on_site-only behavior. Never
 * crashes on a missing on_order; there is nothing to look up here, it is
 * just an optional number.
 *
 * Guarded to `planned > 0` — a material with no plan (zero or negative
 * planned qty) has nothing to be "under" against, so it never flags
 * regardless of on_site/on_order (including a negative on_site, which is
 * instead surfaced separately as a deficit — see excel.ts/pdf.ts "Defisit"
 * branch, which takes precedence over this predicate in the Status column).
 */
export function needsProcurement({
  planned,
  on_site,
  on_order = 0,
}: {
  planned: number;
  on_site: number;
  on_order?: number;
}): boolean {
  if (!(planned > 0)) return false;
  return on_site + on_order <= planned * PROCUREMENT_THRESHOLD_PCT;
}
