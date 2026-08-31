// SANO — THE canonical "remaining" arithmetic for a material envelope.
//
// Why this module exists
// ──────────────────────
// Before it, five surfaces each computed "sisa" (remaining) their own way and
// none of the labels said which formula was behind the number:
//
//   • the hard PO gate (Gate2Screen + migration 088's guard_po_line_quantity_gate
//     at 088:671)                       → planned − ordered
//   • the project envelope view          → planned − ordered
//   • the supervisor's material panel    → planned − ordered − requested
//   • ad-hoc call sites                  → assorted variants
//
// Two of those are legitimately DIFFERENT questions. This module names them,
// so a screen picks a semantic instead of re-deriving arithmetic:
//
//   remainingToOrder()  "Sisa untuk di-PO"
//       planned − ordered. The HARD-GATE headroom — exactly what the server
//       enforces in guard_po_line_quantity_gate (088:671) and what
//       create_purchase_order (071) re-checks. Requests are NOT subtracted:
//       a PO *fulfils* a request, so subtracting the request as well would
//       double-block the very order the request asked for.
//
//   remainingFree()     "Sisa bebas"
//       max(0, planned − ordered − requested). The UNCOMMITTED remainder —
//       what is left after the POs already booked AND the requests already
//       running. This is the supervisor's question ("how much can I still ask
//       for without overrunning the plan?"), never the gate's.
//
// The `requested` leg — read this before wiring a caller
// ─────────────────────────────────────────────────────
// `requested` must be the OUTSTANDING request demand: approved/open request
// quantity that has NOT yet been turned into a purchase order.
//
// v_material_envelope_status.total_requested is NOT that number. It sums every
// non-REJECTED material_request_line (072:412-419) whether or not a PO already
// fulfils it, so the moment a PO exists for a request, ordered and requested
// overlap and `ordered + requested` counts the same kilos twice. That overlap
// is only removable when purchase_order_lines.request_line_id is populated
// (migration 055:48) — which is what makes request→PO linking load-bearing
// rather than cosmetic. Until a caller can subtract linked quantity, it should
// either pass a link-aware figure it derived itself (see
// tools/requestLineLinkCandidates.ts, whose `remaining` is exactly
// "approved_qty − Σ linked non-cancelled PO qty") or accept that remainingFree
// / projected / burnPct('committed') read pessimistically.
//
// Self-exclusion contract
// ───────────────────────
// When a surface is evaluating a request/PO line that is ITSELF already part of
// the stored legs (editing an existing line, re-checking a submitted request),
// the caller must subtract that line from `requested` (or `ordered`) before
// calling, and pass its quantity as `thisQty` / `extraQty` instead. Otherwise
// the line is counted twice against its own plan. This module cannot detect
// that — it has no identity, only sums.
//
// Units: every leg is in the material's BASE unit (kg for rebar, never batang).
// Conversion to supplier units is display-only, at the screen boundary
// (tools/materialUnitConversion.ts). See tools/rebarBatang.ts.
//
// Truth contract (CLAUDE.md §1.1 / §12): when the plan is absent or non-positive
// there IS no percentage — burnPct returns null so the caller must render
// "tidak terukur", never a confident-looking 0%.

/**
 * The three quantities every "remaining" question is built from, in BASE units.
 *
 * - `planned`   total_planned — the published plan for this material.
 * - `ordered`   non-CANCELLED purchase-order quantity already booked.
 * - `requested` OUTSTANDING request demand not yet converted to a PO (see the
 *               header note — this is NOT the raw view column total_requested).
 */
export interface EnvelopeLegs {
  planned: number;
  ordered: number;
  requested: number;
}

/** A missing/NaN leg is a zero sum, never a silent NaN poisoning the result. */
function leg(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * "Sisa untuk di-PO" — hard-gate headroom: planned − ordered.
 *
 * This is the figure the server gate compares an incoming PO line against
 * (guard_po_line_quantity_gate, 088:671; create_purchase_order, 071:201-246),
 * so any screen that warns "this PO will be blocked" MUST use this and nothing
 * else. Requests are deliberately absent from the formula.
 *
 * May be NEGATIVE when a material is already over-ordered (an approved
 * principal override, or historical data). Negative is information — it is
 * returned as-is; a caller that shows it to a human may floor it for display,
 * but must not floor it before a gate comparison.
 */
export function remainingToOrder(l: EnvelopeLegs): number {
  return leg(l.planned) - leg(l.ordered);
}

/**
 * "Sisa bebas" — uncommitted remainder: max(0, planned − ordered − requested).
 *
 * What is left of the plan after everything already committed: POs booked plus
 * requests still running. This is the supervisor's / requester's question.
 * Floored at 0: "already fully committed" is the honest answer; a negative
 * free remainder is meaningless as an amount you may still spend. Use
 * remainingToOrder() when the sign matters.
 */
export function remainingFree(l: EnvelopeLegs): number {
  return Math.max(0, leg(l.planned) - leg(l.ordered) - leg(l.requested));
}

/**
 * Committed projection: ordered + requested + thisQty.
 *
 * "Where does this material land if the line being typed goes through?" The
 * caller passes a SELF-EXCLUDED `requested` (the line under evaluation removed
 * from the leg) and its quantity as `thisQty`, so the line is counted exactly
 * once. Compare against `planned` to decide whether the plan is exceeded.
 */
export function projected(l: EnvelopeLegs, thisQty: number = 0): number {
  return leg(l.ordered) + leg(l.requested) + leg(thisQty);
}

/**
 * Which commitment a burn percentage is measured on.
 *
 * - `'po'`         ordered only — matches the envelope view's burn_pct (072:378).
 * - `'requests'`   request demand only.
 * - `'committed'`  ordered + requested — the full commitment against the plan.
 *                  Only meaningful when the two legs are DISJOINT, i.e. the
 *                  `requested` leg excludes anything a PO already fulfils.
 */
export type BurnBasis = 'po' | 'requests' | 'committed';

/**
 * Percentage of the plan consumed on the given basis, plus `extraQty` for a
 * line currently being typed (self-excluded, per the module contract).
 *
 * Returns **null** when `planned <= 0` or is not finite: with no plan there is
 * nothing to be a percentage OF. Callers must render that as "tidak terukur" /
 * "tanpa alokasi pembanding" — never as 0%, which reads as "nothing used yet"
 * and is the exact false-confidence CLAUDE.md §1.1 forbids.
 *
 * Unrounded — the caller formats (existing SANO convention: `.toFixed(0)` /
 * `.toFixed(1)` at the display boundary).
 */
export function burnPct(l: EnvelopeLegs, basis: BurnBasis, extraQty: number = 0): number | null {
  const planned = leg(l.planned);
  if (!(planned > 0)) return null;

  const ordered = leg(l.ordered);
  const requested = leg(l.requested);
  const numerator =
    basis === 'po' ? ordered
    : basis === 'requests' ? requested
    : ordered + requested;

  return ((numerator + leg(extraQty)) / planned) * 100;
}
