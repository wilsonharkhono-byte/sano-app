// SANO — Principal gate on overage-absolving ceiling raises (Task 2.12).
//
// Design: docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md
//   §5 step 4 ("Principal gate, narrow"): a re-publish that raises the planned
//   qty of a material CURRENTLY in overage (ordered > current planned) holds
//   until the principal approves.
//
// This module is the PURE, side-effect-free twin of migration 079's server
// enforcement (compute_ceiling_breaches + assert_ceiling_raise_gate). The
// SERVER is authoritative — it recomputes the breach set from DB state and never
// trusts the client's 2.11 diff classification (a hostile caller could omit
// RAISE_ABSOLVING_OVERAGE lines). This module only:
//   (a) shapes the SERVER-computed breach set into an escalation override_payload
//       (so the principal card renders material/before/proposed/ordered), and
//   (b) mirrors the server's coverage check so the estimator's client only
//       attaches an approved task that will actually let the publish through.
//
// ALL quantities are BASE units (kg for rebar), matching the master lines and
// the envelope view both sides compare against.

/**
 * One breaching material, exactly as migration 079's compute_ceiling_breaches
 * returns it (the ONLY source escalation payloads and gate checks may use):
 *   planned_before — the CURRENT latest master's planned qty (server-read).
 *   proposed       — the would-be new master's planned qty for this material.
 *   ordered        — non-cancelled SANO PO qty (server-read, envelope view).
 * A material breaches when ordered > planned_before AND proposed > planned_before.
 */
export interface CeilingBreach {
  material_id: string;
  material_name: string;
  planned_before: number;
  proposed: number;
  ordered: number;
}

/**
 * One entry of a plan_ceiling_raise approval_task's override_payload. The gate
 * (server + checkCeilingRaiseCoverage below) reads only material_id +
 * proposed_qty; the remaining fields are carried so the principal's Approve/Reject
 * card can render the full breach table from the payload alone, without a refetch.
 */
export interface CeilingRaisePayloadEntry {
  material_id: string;
  material_name: string;
  planned_before: number;
  /** The ceiling the principal is being asked to authorise (= proposed at escalation). */
  proposed_qty: number;
  ordered: number;
}

/** One proposed per-material planned total handed to the server gate as p_proposed. */
export interface ProposedPlannedEntry {
  material_id: string;
  planned_qty: number;
}

/**
 * Turn an aggregated per-material planned Map (the would-be new master's totals,
 * from publishBaselineV2's buildProposedAggregatesFromStaging) into the JSON
 * array shape the server RPCs accept as p_proposed. Zero/negative and empty-id
 * entries are dropped — they can never breach (proposed must exceed a positive
 * planned_before) and only bloat the payload.
 */
export function proposedAggregatesToArray(totals: Map<string, number>): ProposedPlannedEntry[] {
  const out: ProposedPlannedEntry[] = [];
  for (const [material_id, planned_qty] of totals) {
    if (!material_id) continue;
    const q = Number(planned_qty) || 0;
    if (q <= 0) continue;
    out.push({ material_id, planned_qty: q });
  }
  return out;
}

/**
 * Coerce raw compute_ceiling_breaches RPC rows into typed CeilingBreach objects
 * for the breach panel (numeric fields arrive as strings/unknown over PostgREST).
 * Rows without a material_id are dropped; a missing name falls back to the id so
 * the panel never renders "undefined".
 */
export function mapCeilingBreachRows(rows: Array<Record<string, unknown>> | null | undefined): CeilingBreach[] {
  return (rows ?? [])
    .filter(r => r && r.material_id)
    .map(r => ({
      material_id: String(r.material_id),
      material_name:
        typeof r.material_name === 'string' && r.material_name.trim()
          ? r.material_name
          : String(r.material_id),
      planned_before: Number(r.planned_before) || 0,
      proposed: Number(r.proposed) || 0,
      ordered: Number(r.ordered) || 0,
    }));
}

/**
 * Build the override_payload an escalation task carries so the principal's
 * approval authorises exactly these ceiling raises. Built from the SERVER's
 * compute_ceiling_breaches output — never from the client's 2.11 diff (design:
 * the payload MUST be server-computed).
 */
export function buildCeilingRaisePayload(breaches: CeilingBreach[]): CeilingRaisePayloadEntry[] {
  return breaches.map(b => ({
    material_id: b.material_id,
    material_name: b.material_name,
    planned_before: b.planned_before,
    proposed_qty: b.proposed,
    ordered: b.ordered,
  }));
}

/**
 * Verify an approved override_payload covers every breaching material: the
 * payload must list each material with proposed_qty >= this publish's proposed
 * ceiling for it. This is the exact check migration 079's assert_ceiling_raise_gate
 * runs server-side — kept here so the estimator's client only offers/attaches an
 * approved task that will actually pass, and blocks otherwise.
 *
 * A material absent from the payload, or approved for a SMALLER ceiling than the
 * current proposed (the estimator raised it further after escalation), stays
 * uncovered → the publish is held.
 */
export function checkCeilingRaiseCoverage(
  breaches: CeilingBreach[],
  payload: CeilingRaisePayloadEntry[],
): { covered: boolean; uncovered: CeilingBreach[] } {
  const byMaterial = new Map<string, number>();
  for (const e of payload) {
    // If a payload lists a material twice, the largest authorised ceiling wins.
    byMaterial.set(
      e.material_id,
      Math.max(byMaterial.get(e.material_id) ?? -Infinity, Number(e.proposed_qty) || 0),
    );
  }

  // Exact `>=`, matching migration 079's assert_ceiling_raise_gate
  // (`proposed_qty >= b.proposed`) with NO epsilon slack. Fail-closed alignment:
  // an epsilon here would let the client call a hair-short approval "covered" and
  // attach it, only for the server to reject on publish. Mirroring the server
  // exactly means the client never offers a task the server will refuse.
  const uncovered = breaches.filter(b => {
    const approved = byMaterial.get(b.material_id);
    return approved === undefined || b.proposed > approved;
  });

  return { covered: uncovered.length === 0, uncovered };
}
