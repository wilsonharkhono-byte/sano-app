// SANO — Task 2.8: optional request→PO traceability link.
//
// Pure candidate-filtering for the Gate2Screen "Tautkan ke permintaan" picker:
// which approved material-request lines may the admin attach to a draft PO line?
//
// Rules (spec: 2026-07-10 SANO flow remediation, Task 2.8):
//   1. APPROVED-only — the header's overall_status must be 'APPROVED'. A
//      pending/held/rejected request is not yet (or never) purchasable.
//   2. Unlinked-only — a request line already referenced by any
//      purchase_order_lines.request_line_id is fulfilled; offering it again
//      would double-link one request to two POs (and migration 069's
//      fulfilled-line exclusion would silently under-count the open need).
//   3. Material match — when the draft PO line is a catalog material, only
//      request lines for that exact material_id qualify. A free-text draft
//      line (material_id null) may link to ANY eligible line — including
//      free-text request lines — by admin judgment; the picker shows
//      name + qty + date so the admin can decide.
//
// The link is OPTIONAL and non-blocking: an empty candidate list just means
// the PO line is created unlinked (request_line_id NULL), exactly as before.

import { MRStatus } from './constants';

/** One material_request_line joined to its header's overall_status. */
export interface RequestLineLinkCandidate {
  id: string;
  /** Catalog material, or null for a free-text request line. */
  material_id: string | null;
  /** Free-text name when material_id is null. */
  custom_material_name: string | null;
  quantity: number;
  unit: string;
  /** Header target_date — when the site needs the material. */
  target_date: string;
  /** Header overall_status (material_request_headers.overall_status). */
  overall_status: string;
}

export interface RequestLineLinkFilter {
  /** The draft PO line's catalog material_id, or null for a free-text line. */
  draftMaterialId: string | null;
  /** request_line_ids already present on purchase_order_lines (fulfilled). */
  linkedRequestLineIds: ReadonlyArray<string> | ReadonlySet<string>;
}

/**
 * Filter request lines down to the linkable candidates for one draft PO line:
 * APPROVED header, not already linked to a PO, and — when the draft line is a
 * catalog material — the same material_id. Sorted by target_date ascending so
 * the earliest-needed request surfaces first.
 */
export function getRequestLineLinkCandidates(
  lines: RequestLineLinkCandidate[],
  filter: RequestLineLinkFilter,
): RequestLineLinkCandidate[] {
  const linked = filter.linkedRequestLineIds instanceof Set
    ? filter.linkedRequestLineIds
    : new Set(filter.linkedRequestLineIds as ReadonlyArray<string>);

  return lines
    .filter(line => line.overall_status === MRStatus.APPROVED)
    .filter(line => !linked.has(line.id))
    .filter(line => filter.draftMaterialId == null || line.material_id === filter.draftMaterialId)
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
