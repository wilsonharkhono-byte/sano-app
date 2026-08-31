// SANO — request → PO lifecycle consistency, over the CANONICAL envelope math.
//
// What this file protects
// ───────────────────────
// One material, one plan, one request, one PO. As that request walks
// PENDING → APPROVED → PO (linked) → PO CANCELLED → back, every surface must
// tell the SAME story about the same kilos:
//
//   supervisor   "sisa bebas"        remainingFree
//   estimator    both figures        remainingToOrder + remainingFree
//   admin        hard-gate headroom  remainingToOrder (== the server gate)
//   everyone     commitment          burnPct('committed')
//
// The invariant under all of it: `ordered` and `requested` must be DISJOINT.
// A PO fulfils a request — it does not add to it. When a PO line carries
// request_line_id (migration 055:48), approving-then-ordering MOVES quantity
// from the requested leg to the ordered leg and the free remainder does not
// budge. When the link is missing, the same kilos land in both legs and every
// request-aware surface under-reports what is left. The second describe block
// pins that broken arithmetic down deliberately, so "linking is cosmetic"
// can never be believed again.
//
// No DB: the fixtures below are the query results each surface would get, and
// the view columns are re-derived by hand-written mirrors of the actual SQL
// (v_material_envelope_status, migration 072:360-420). Link-aware remaining
// comes from the PRODUCTION helper (getRequestLineLinkCandidates), so this test
// fails if that arithmetic ever drifts.

import {
  getRequestLineLinkCandidates,
  type RequestLineLinkCandidate,
  type LinkedPoLineQuantity,
} from '../requestLineLinkCandidates';
import { remainingToOrder, remainingFree, projected, burnPct } from '../envelopeMath';
import { evaluatePoQuantityGate, envelopeLegs, type PoGateEnvelope } from '../poQuantityGate';

// ── Fixture world ────────────────────────────────────────────────────
// Besi D13, plan 100 kg. All quantities BASE units (kg) — batang is display-only.

const MATERIAL_ID = 'mat-besi-d13';
const REQUEST_LINE_ID = 'req-line-1';
const PLANNED = 100;
const REQUEST_QTY = 40;

/** A purchase_order_lines row joined to its PO's status. */
interface PoLineRow {
  request_line_id: string | null;
  quantity: number;
  po_status: 'OPEN' | 'CANCELLED' | 'CLOSED_SHORT';
}

interface WorldState {
  label: string;
  /** material_request_headers.overall_status for the one request. */
  requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  poLines: PoLineRow[];
}

function requestLine(status: WorldState['requestStatus']): RequestLineLinkCandidate {
  return {
    id: REQUEST_LINE_ID,
    material_id: MATERIAL_ID,
    custom_material_name: null,
    quantity: REQUEST_QTY,
    unit: 'kg',
    target_date: '2026-09-01',
    overall_status: status,
  };
}

// ── Mirrors of the view's SQL (migration 072:360-420) ────────────────

/** total_ordered: non-CANCELLED PO line quantity. */
function viewTotalOrdered(w: WorldState): number {
  return w.poLines
    .filter(l => l.po_status !== 'CANCELLED')
    .reduce((sum, l) => sum + l.quantity, 0);
}

/** total_requested: EVERY non-REJECTED request line — link-blind, by design. */
function viewTotalRequested(w: WorldState): number {
  return w.requestStatus === 'REJECTED' ? 0 : REQUEST_QTY;
}

// ── Link-aware legs (what an honest surface should read) ─────────────

/** APPROVED request quantity still awaiting a PO — the production helper. */
function approvedAwaitingPo(w: WorldState): number {
  const linked: LinkedPoLineQuantity[] = w.poLines
    .filter((l): l is PoLineRow & { request_line_id: string } => Boolean(l.request_line_id))
    .map(l => ({ request_line_id: l.request_line_id, quantity: l.quantity, po_status: l.po_status }));

  return getRequestLineLinkCandidates([requestLine(w.requestStatus)], {
    draftMaterialId: null,
    linkedPoLines: linked,
  }).reduce((sum, c) => sum + c.remaining, 0);
}

/** Demand that exists but is not APPROVED yet (PENDING / HOLD / RETURNED). */
function notYetApproved(w: WorldState): number {
  const approvedTotal = w.requestStatus === 'APPROVED' ? REQUEST_QTY : 0;
  return Math.max(0, viewTotalRequested(w) - approvedTotal);
}

/** All outstanding request demand not yet turned into a PO. */
function outstandingRequested(w: WorldState): number {
  return approvedAwaitingPo(w) + notYetApproved(w);
}

/** What the group-grain RPC (086:93-94) can attribute to a PO: linked qty only. */
function supervisorVisibleOrdered(w: WorldState): number {
  return w.poLines
    .filter(l => l.po_status !== 'CANCELLED' && l.request_line_id === REQUEST_LINE_ID)
    .reduce((sum, l) => sum + l.quantity, 0);
}

function envelopeRow(w: WorldState): PoGateEnvelope {
  return {
    material_id: MATERIAL_ID,
    material_name: 'Besi beton ulir 13 mm',
    total_planned: PLANNED,
    total_ordered: viewTotalOrdered(w),
    total_requested: viewTotalRequested(w),
  };
}

/** Every surface's answer, from ONE set of legs, at one point in the lifecycle. */
function snapshot(w: WorldState) {
  const env = envelopeRow(w);
  // Admin at PO time: the requested leg is the link-aware APPROVED-awaiting
  // figure (Gate2Screen's chip). The gate itself ignores it.
  const adminLegs = envelopeLegs(env, approvedAwaitingPo(w));
  // Supervisor / estimator: ALL outstanding demand, link-aware.
  const fieldLegs = envelopeLegs(env, outstandingRequested(w));

  return {
    ordered: env.total_ordered,
    adminHeadroom: remainingToOrder(adminLegs),
    estimatorHeadroom: remainingToOrder(fieldLegs),
    estimatorFree: remainingFree(fieldLegs),
    supervisorFree: remainingFree(fieldLegs),
    committedBurnPct: burnPct(fieldLegs, 'committed'),
    supervisorSeesOrdered: supervisorVisibleOrdered(w),
  };
}

// ── The lifecycle, WITH the request→PO link written ───────────────────

const pending: WorldState = { label: '1. permintaan PENDING', requestStatus: 'PENDING', poLines: [] };
const approved: WorldState = { label: '2. permintaan APPROVED', requestStatus: 'APPROVED', poLines: [] };
const orderedLinked: WorldState = {
  label: '3. PO dibuat, TERTAUT',
  requestStatus: 'APPROVED',
  poLines: [{ request_line_id: REQUEST_LINE_ID, quantity: REQUEST_QTY, po_status: 'OPEN' }],
};
const cancelledLinked: WorldState = {
  label: '4. PO dibatalkan',
  requestStatus: 'APPROVED',
  poLines: [{ request_line_id: REQUEST_LINE_ID, quantity: REQUEST_QTY, po_status: 'CANCELLED' }],
};

describe('request → PO lifecycle, LINKED (the story every surface should tell)', () => {
  it('1. PENDING — demand exists, the PO gate is untouched by it', () => {
    const s = snapshot(pending);

    expect(s.ordered).toBe(0);
    // A request never eats PO headroom: the gate is planned − ordered.
    expect(s.adminHeadroom).toBe(100);
    // But it IS committed demand for whoever asks "what may I still request?".
    expect(s.supervisorFree).toBe(60);
    expect(s.committedBurnPct).toBe(40);
    // Nothing is approved yet, so nothing is awaiting a PO.
    expect(approvedAwaitingPo(pending)).toBe(0);
    expect(notYetApproved(pending)).toBe(40);
  });

  it('2. APPROVED — the same 40 kg, now visible to the admin as awaiting a PO', () => {
    const s = snapshot(approved);

    expect(approvedAwaitingPo(approved)).toBe(40);
    expect(notYetApproved(approved)).toBe(0);
    // Approval moves the demand between context buckets; it changes NO total.
    expect(s).toEqual(snapshot(pending));
    expect(s.adminHeadroom).toBe(100);
    expect(s.supervisorFree).toBe(60);
  });

  it('2b. the hard gate lets the PO that fulfils the request through', () => {
    // The double-block trap: if the gate subtracted the request, ordering the
    // requested 40 against a 100 plan with 0 ordered would "breach" at 40 > 60.
    const gate = evaluatePoQuantityGate(
      [{ material_id: MATERIAL_ID, material_name: 'Besi D13', quantity: REQUEST_QTY }],
      [envelopeRow(approved)],
    );

    expect(gate.hasBreach).toBe(false);
    expect(gate.measuredOk).toEqual([MATERIAL_ID]);
  });

  it('3. PO created LINKED — quantity MOVES from requested to ordered; the free remainder does not budge', () => {
    const s = snapshot(orderedLinked);

    // Moved, not stacked.
    expect(s.ordered).toBe(40);
    expect(approvedAwaitingPo(orderedLinked)).toBe(0);
    expect(outstandingRequested(orderedLinked)).toBe(0);

    // THE assertion: the supervisor's free remainder is identical before and
    // after the PO. The same kilos were never counted twice.
    expect(s.supervisorFree).toBe(60);
    expect(s.supervisorFree).toBe(snapshot(approved).supervisorFree);
    expect(s.committedBurnPct).toBe(40);
    expect(s.committedBurnPct).toBe(snapshot(approved).committedBurnPct);

    // The admin's headroom is the one figure that legitimately drops: the PO is
    // now booked against the plan.
    expect(s.adminHeadroom).toBe(60);
    expect(s.estimatorHeadroom).toBe(60);
    // Estimator sees both, and they differ by the outstanding request leg (0 now).
    expect(s.estimatorFree).toBe(s.estimatorHeadroom - outstandingRequested(orderedLinked));

    // Because the link exists, the group-grain RPC can attribute the PO to the
    // supervisor's request — this is what makes the PO visible in the field.
    expect(s.supervisorSeesOrdered).toBe(40);
  });

  it('3b. the gate now measures against the reduced headroom', () => {
    const gate = evaluatePoQuantityGate(
      [{ material_id: MATERIAL_ID, material_name: 'Besi D13', quantity: 70 }],
      [envelopeRow(orderedLinked)],
    );

    expect(gate.hasBreach).toBe(true);
    expect(gate.breaches[0].remaining).toBe(60);
    expect(gate.breaches[0].over).toBe(10);
    // The gate's `remaining` IS remainingToOrder — one formula, not two.
    expect(gate.breaches[0].remaining).toBe(remainingToOrder(envelopeLegs(envelopeRow(orderedLinked))));
  });

  it('4. PO CANCELLED — the quantity moves back, exactly to the APPROVED state', () => {
    const s = snapshot(cancelledLinked);

    expect(s.ordered).toBe(0);
    expect(approvedAwaitingPo(cancelledLinked)).toBe(40); // freed back to the picker
    expect(s.supervisorSeesOrdered).toBe(0);

    // Round trip: every surface reads exactly what it read at step 2.
    expect(s).toEqual(snapshot(approved));
  });

  it('the whole walk never double-counts: committed burn is flat at 40% throughout', () => {
    const walk = [pending, approved, orderedLinked, cancelledLinked, approved];

    expect(walk.map(w => snapshot(w).committedBurnPct)).toEqual([40, 40, 40, 40, 40]);
    // projected() agrees from the other direction: ordered + requested + 0.
    for (const w of walk) {
      const legs = envelopeLegs(envelopeRow(w), outstandingRequested(w));
      expect(projected(legs)).toBe(40);
      expect(remainingFree(legs)).toBe(PLANNED - projected(legs));
    }
  });
});

// ── The same lifecycle WITHOUT the link — current production behaviour ──

const orderedUnlinked: WorldState = {
  label: '3\'. PO dibuat, TIDAK tertaut',
  requestStatus: 'APPROVED',
  poLines: [{ request_line_id: null, quantity: REQUEST_QTY, po_status: 'OPEN' }],
};

describe('KNOWN BROKEN — the same PO with request_line_id NULL (why linking is load-bearing)', () => {
  it('the same 40 kg is counted twice: once as ordered, once as still-awaiting-PO', () => {
    // request_line_id has never been populated in production (0 links DB-wide),
    // so this — not the linked case above — is what every project currently sees.
    expect(approvedAwaitingPo(orderedUnlinked)).toBe(40); // still "awaiting a PO"…
    expect(viewTotalOrdered(orderedUnlinked)).toBe(40);   // …while already ordered
    expect(outstandingRequested(orderedUnlinked)).toBe(40);
  });

  it('the supervisor loses 40 kg of plan that was never spent', () => {
    const broken = snapshot(orderedUnlinked);
    const correct = snapshot(orderedLinked);

    // Documented current behaviour: 20 instead of 60.
    expect(broken.supervisorFree).toBe(20);
    expect(correct.supervisorFree).toBe(60);
    expect(correct.supervisorFree - broken.supervisorFree).toBe(REQUEST_QTY);

    // …and the commitment reads as 80% burnt when 40% is spent.
    expect(broken.committedBurnPct).toBe(80);
    expect(correct.committedBurnPct).toBe(40);
  });

  it('the supervisor cannot see that their request was bought at all', () => {
    // get_workgroup_material_envelopes (086:93-94) has nothing to join on, so
    // the quantity can never leave `requested` for `ordered` at group grain.
    expect(snapshot(orderedUnlinked).supervisorSeesOrdered).toBe(0);
    expect(snapshot(orderedLinked).supervisorSeesOrdered).toBe(40);
  });

  it('the hard PO gate is the ONE surface the missing link does not corrupt', () => {
    // planned − ordered ignores requests entirely, so it is identical either way.
    // This is why the bug is invisible to the admin and brutal in the field.
    expect(snapshot(orderedUnlinked).adminHeadroom).toBe(60);
    expect(snapshot(orderedLinked).adminHeadroom).toBe(60);
  });

  it('cancelling an UNLINKED PO frees the plan but still leaves the request stranded', () => {
    const cancelledUnlinked: WorldState = {
      ...orderedUnlinked,
      poLines: [{ request_line_id: null, quantity: REQUEST_QTY, po_status: 'CANCELLED' }],
    };

    // The ordered leg is released (the view excludes CANCELLED)…
    expect(viewTotalOrdered(cancelledUnlinked)).toBe(0);
    // …and because nothing was ever linked, this round-trips to the APPROVED
    // state by luck, not by bookkeeping — the intermediate state was wrong.
    expect(snapshot(cancelledUnlinked)).toEqual(snapshot(approved));
  });
});
