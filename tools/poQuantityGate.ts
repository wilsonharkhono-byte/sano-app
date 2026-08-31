// SANO — Hard quantity gate at PO creation (Signal 1, PO-time enforcement).
//
// Design: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §3.
//   "At PO time (admin, Gate2Screen): hard gate — existing_non_cancelled_PO_qty
//    + this_PO_line_qty > current_planned → CRITICAL, requires principal override."
//
// This module is the PURE, side-effect-free twin of the server enforcement in
// migration 071's create_purchase_order. Both compute the same thing so the
// client can warn pre-submit exactly where the RPC will block — lockstep. The
// server is authoritative; this is the mirror.
//
// ALL quantities are BASE units (kg for rebar, not batang). The caller converts
// supplier units → base before handing lines here, matching what the PO rows and
// the RPC store.
//
// The remaining-arithmetic itself lives in tools/envelopeMath.ts — the single
// canonical module every surface shares. This file only decides WHICH question
// the PO gate asks: remainingToOrder ("Sisa untuk di-PO", planned − ordered),
// never remainingFree.

import { remainingToOrder, type EnvelopeLegs } from './envelopeMath';

/** One draft/incoming PO line, in BASE units. Free-text lines have material_id null. */
export interface PoGateLine {
  material_id: string | null;
  material_name: string;
  /** Base-unit quantity being ordered on this line. */
  quantity: number;
}

/** The project-grain envelope figures for one material (from v_material_envelope_status). */
export interface PoGateEnvelope {
  material_id: string;
  material_name?: string;
  /** total_planned — the current published plan for this material (base units). */
  total_planned: number;
  /** total_ordered — non-CANCELLED SANO PO lines already booked (base units). */
  total_ordered: number;
  /**
   * total_requested — every non-REJECTED material_request_line (072:412-419),
   * base units. CONTEXT ONLY: it is NOT part of the gate comparison, and it is
   * NOT link-aware (a request a PO already fulfils is still counted here, which
   * is the project-view double-count). Optional so existing callers that only
   * need the gate keep compiling.
   */
  total_requested?: number;
}

/** A material whose aggregated attempt exceeds its remaining envelope. */
export interface MaterialBreach {
  material_id: string;
  material_name: string;
  /** total_planned − total_ordered (can be negative if already over-ordered). */
  remaining: number;
  /** Aggregated qty for this material across ALL incoming lines in this PO. */
  attempted: number;
  /** attempted − remaining (always > 0 for a breach). */
  over: number;
}

/** A line that cannot be measured against a plan (free-text, unlinked, or no envelope). */
export interface UnmeasuredLine {
  material_id: string | null;
  material_name: string;
  /** Aggregated qty for this unmeasured material/name. */
  attempted: number;
}

export interface PoGateResult {
  /** Measured materials whose attempt exceeds remaining — the blocking set. */
  breaches: MaterialBreach[];
  /** material_ids that ARE measured and fit within the envelope. */
  measuredOk: string[];
  /** Lines with no comparable plan — never block, but surfaced/labelled. */
  unmeasured: UnmeasuredLine[];
  /** Convenience: breaches.length > 0. */
  hasBreach: boolean;
}

/** The override contract carried in an approved po_qty_gate approval_task payload. */
export interface OverridePayloadEntry {
  material_id: string;
  /** The over-order quantity authorised for this material (base units). */
  attempted_qty: number;
  /** remaining at the moment of escalation — audit evidence, not a re-check input. */
  remaining_at_escalation: number;
}

// Float-subtraction guard: total_planned − total_ordered can carry IEEE noise
// (e.g. 0.3 − 0.1 = 0.19999999999999998). An attempt within this epsilon of the
// remaining is NOT a breach — we never block on rounding dust, only on real overage.
const EPSILON = 1e-9;

/**
 * Adapt a project-grain envelope row to the canonical {@link EnvelopeLegs}.
 *
 * `requestedOverride` is where a LINK-AWARE outstanding-request figure goes —
 * approved request quantity minus what linked, non-cancelled PO lines already
 * cover (tools/requestLineLinkCandidates.ts derives exactly that as its
 * `remaining`). Without an override the leg falls back to the view's
 * total_requested, which counts requests a PO already fulfils and therefore
 * reads pessimistically once POs exist. The gate itself never looks at the
 * requested leg — only the surrounding display does.
 */
export function envelopeLegs(env: PoGateEnvelope, requestedOverride?: number): EnvelopeLegs {
  return {
    planned: env.total_planned,
    ordered: env.total_ordered,
    requested: requestedOverride ?? env.total_requested ?? 0,
  };
}

/**
 * Evaluate the PO quantity gate for a set of incoming lines against project-grain
 * envelopes. Aggregates attempted quantity PER material_id first, so a single
 * over-order split across two lines is still caught as the material total (the
 * server does the same GROUP BY). Materials with no envelope, or a non-positive
 * plan, are "unmeasured" (design §3: no baseline → unknown, never blocks).
 */
export function evaluatePoQuantityGate(
  lines: PoGateLine[],
  envelopes: Map<string, PoGateEnvelope> | PoGateEnvelope[],
): PoGateResult {
  const envMap = envelopes instanceof Map
    ? envelopes
    : new Map(envelopes.map(e => [e.material_id, e]));

  // Aggregate per material_id (linked lines) and per name (free-text lines).
  const linkedAttempt = new Map<string, { name: string; attempted: number }>();
  const freeTextAttempt = new Map<string, number>();

  for (const line of lines) {
    const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
    if (line.material_id) {
      const prev = linkedAttempt.get(line.material_id);
      linkedAttempt.set(line.material_id, {
        name: prev?.name ?? line.material_name,
        attempted: (prev?.attempted ?? 0) + qty,
      });
    } else {
      const key = line.material_name.trim() || '(tanpa nama)';
      freeTextAttempt.set(key, (freeTextAttempt.get(key) ?? 0) + qty);
    }
  }

  const breaches: MaterialBreach[] = [];
  const measuredOk: string[] = [];
  const unmeasured: UnmeasuredLine[] = [];

  for (const [materialId, { name, attempted }] of linkedAttempt) {
    const env = envMap.get(materialId);
    // Measurable only when an envelope exists with a positive plan.
    if (!env || !(env.total_planned > 0)) {
      unmeasured.push({ material_id: materialId, material_name: env?.material_name ?? name, attempted });
      continue;
    }
    // THE hard-gate headroom, via the canonical module: planned − ordered, with
    // requests deliberately absent (a PO fulfils a request — subtracting the
    // request as well would double-block the order it asked for). Same formula
    // as before, now named and shared with every other surface.
    const remaining = remainingToOrder(envelopeLegs(env));
    if (attempted > remaining + EPSILON) {
      breaches.push({
        material_id: materialId,
        material_name: env.material_name ?? name,
        remaining,
        attempted,
        over: attempted - remaining,
      });
    } else {
      measuredOk.push(materialId);
    }
  }

  for (const [name, attempted] of freeTextAttempt) {
    unmeasured.push({ material_id: null, material_name: name, attempted });
  }

  return { breaches, measuredOk, unmeasured, hasBreach: breaches.length > 0 };
}

/**
 * Build the override payload an escalation task carries so the principal's
 * approval authorises exactly these over-orders. Consumed server-side by
 * create_purchase_order (migration 071) via checkOverrideCoverage's logic.
 */
export function buildOverridePayload(breaches: MaterialBreach[]): OverridePayloadEntry[] {
  return breaches.map(b => ({
    material_id: b.material_id,
    attempted_qty: b.attempted,
    remaining_at_escalation: b.remaining,
  }));
}

/**
 * Verify that an approved override payload covers every breaching material:
 * the payload must contain each material with attempted_qty >= this PO's attempt.
 * This is the exact check migration 071's RPC runs server-side — kept here so the
 * client only offers overrides that will actually let the PO through.
 */
export function checkOverrideCoverage(
  breaches: MaterialBreach[],
  payload: OverridePayloadEntry[],
): { covered: boolean; uncovered: MaterialBreach[] } {
  const byMaterial = new Map<string, number>();
  for (const e of payload) {
    // If a payload lists a material twice, the largest authorised qty wins.
    byMaterial.set(e.material_id, Math.max(byMaterial.get(e.material_id) ?? -Infinity, e.attempted_qty));
  }

  const uncovered = breaches.filter(b => {
    const approved = byMaterial.get(b.material_id);
    return approved === undefined || b.attempted > approved + EPSILON;
  });

  return { covered: uncovered.length === 0, uncovered };
}
