// SANO — Task 2.8, extended by the 2026-08-15 approval/PO separation-of-duties
// spec §2.4 / §4.1 (Task D): optional request→PO traceability link, now with
// partial linking.
//
// Pure candidate-filtering for the Gate2Screen "Tautkan ke permintaan" picker:
// which approved material-request lines may the admin attach to a draft PO line,
// and how much of each is still unordered?
//
// Rules (spec: 2026-07-10 SANO flow remediation, Task 2.8; partial-linking per
// 2026-08-15 spec §2.4/§4.1):
//   1. APPROVED-only — the header's overall_status must be 'APPROVED'. A
//      pending/held/rejected request is not yet (or never) purchasable.
//   2. Remaining-only — a request line is offered as long as it has REMAINING
//      unlinked quantity, not just until it is touched once:
//        remaining = approved_qty − Σ(linked non-cancelled PO line qty)
//      One request line may be linked by more than one PO line (spec §2.4).
//      This is arithmetic derived over the real linked PO-line rows every call
//      — never a stored/cached fulfilment status (spec §4.1, CLAUDE.md §1.1) —
//      so a CANCELLED PO's linked quantity is excluded from the sum INSIDE this
//      helper (via each row's `po_status`), not by trusting every caller to
//      pre-filter. CLOSED_SHORT / OPEN / received links still count in full —
//      only CANCELLED frees the quantity back. `remaining` is floored at 0 so
//      an over-linked line (data entered outside this picker, e.g. two admins
//      racing) never reads as "available for a negative amount".
//   3. Material match — when the draft PO line is a catalog material, only
//      request lines for that exact material_id qualify. A free-text draft
//      line (material_id null) may link to ANY eligible line — including
//      free-text request lines — by admin judgment; the picker shows
//      name + remaining qty + date so the admin can decide.
//
// The link is OPTIONAL and non-blocking (spec §2.2, locked decision — never
// superseded): an empty candidate list just means the PO line is created
// unlinked (request_line_id NULL), exactly as before.

import { MRStatus, POStatus } from './constants';

/** One material_request_line joined to its header's overall_status. */
export interface RequestLineLinkCandidate {
  id: string;
  /** Catalog material, or null for a free-text request line. */
  material_id: string | null;
  /** Free-text name when material_id is null. */
  custom_material_name: string | null;
  /** approved_qty — the ceiling `remaining` is derived from. */
  quantity: number;
  unit: string;
  /** Header target_date — when the site needs the material. */
  target_date: string;
  /** Header overall_status (material_request_headers.overall_status). */
  overall_status: string;
}

/**
 * One existing purchase_order_lines row that references a request line, plus
 * its owning PO's status. Callers pass EVERY linked row, cancelled or not —
 * the CANCELLED exclusion happens inside this helper (spec §4.1: "cancelled
 * POs must not count toward the linked total"), so the arithmetic can't drift
 * if a caller forgets to pre-filter.
 */
export interface LinkedPoLineQuantity {
  request_line_id: string;
  quantity: number;
  po_status: string;
}

export interface RequestLineLinkFilter {
  /** The draft PO line's catalog material_id, or null for a free-text line. */
  draftMaterialId: string | null;
  /** Every purchase_order_lines row linked to a request line (any PO status). */
  linkedPoLines: ReadonlyArray<LinkedPoLineQuantity>;
}

/** A candidate with its derived remaining-unlinked quantity attached. */
export interface RequestLineLinkCandidateResult extends RequestLineLinkCandidate {
  /** approved_qty − Σ(linked non-cancelled PO line qty), floored at 0. */
  remaining: number;
}

/**
 * Filter request lines down to the linkable candidates for one draft PO line:
 * APPROVED header, remaining unlinked quantity > 0, and — when the draft line
 * is a catalog material — the same material_id. Sorted by target_date
 * ascending so the earliest-needed request surfaces first.
 */
export function getRequestLineLinkCandidates(
  lines: RequestLineLinkCandidate[],
  filter: RequestLineLinkFilter,
): RequestLineLinkCandidateResult[] {
  const linkedQtyByLine = new Map<string, number>();
  for (const linked of filter.linkedPoLines) {
    if (linked.po_status === POStatus.CANCELLED) continue; // cancelled POs free the qty back
    linkedQtyByLine.set(
      linked.request_line_id,
      (linkedQtyByLine.get(linked.request_line_id) ?? 0) + linked.quantity,
    );
  }

  return lines
    .filter(line => line.overall_status === MRStatus.APPROVED)
    .filter(line => filter.draftMaterialId == null || line.material_id === filter.draftMaterialId)
    .map(line => ({
      ...line,
      remaining: Math.max(0, line.quantity - (linkedQtyByLine.get(line.id) ?? 0)),
    }))
    .filter(line => line.remaining > 0)
    .sort((a, b) => a.target_date.localeCompare(b.target_date));
}

/** Display name for a candidate row: catalog name wins, else the free-text name. */
export function candidateDisplayName(
  candidate: Pick<RequestLineLinkCandidate, 'material_id' | 'custom_material_name'>,
  catalogNameById: ReadonlyMap<string, string>,
): string {
  if (candidate.material_id) {
    return catalogNameById.get(candidate.material_id) ?? candidate.custom_material_name ?? candidate.material_id;
  }
  return candidate.custom_material_name ?? '(tanpa nama)';
}
