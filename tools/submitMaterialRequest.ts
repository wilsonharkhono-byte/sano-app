// SANO — Task 2.9: transactional material-request submit payload builder.
//
// PermintaanScreen used to write header → N lines → per-line allocations →
// activity_log as SEPARATE PostgREST inserts. A failure partway through orphaned
// the header (the exact bug class migration 045 fixed for POs). Migration 073
// moves all of those inserts into one plpgsql transaction, submit_material_request.
//
// The RPC receives lines and allocations as two FLAT JSONB arrays. Because the
// client cannot know a line's real id before it is inserted, each allocation
// references its owning line by ARRAY INDEX (`line_index`, 0-based into p_lines);
// the function resolves that index to the freshly-inserted line id. This module
// is the pure assembler for that payload — kept free of React/Supabase so the
// index mapping (the load-bearing part) is unit-tested in isolation.

/** material_request_headers insert payload (one object). */
export interface SubmitRequestHeaderInput {
  project_id: string;
  boq_item_id: string | null;
  request_basis: string;
  requested_by: string;
  target_date: string;
  urgency: string;
  common_note: string | null;
  overall_flag: string;
  overall_status: string;
}

/** One material_request_line_allocations row, still tied to its line in-memory. */
export interface SubmitRequestAllocationInput {
  boq_item_id: string | null;
  allocated_quantity: number;
  proportion_pct: number;
  allocation_basis: string;
}

/**
 * One material_request_lines row plus its allocations. `line_flag` is sent for
 * completeness but migration 033's BEFORE trigger overwrites it server-side, so
 * it is advisory only.
 */
export interface SubmitRequestLineInput {
  material_id: string | null;
  custom_material_name: string | null;
  tier: number;
  material_spec_reference: string | null;
  quantity: number;
  unit: string;
  line_flag: string;
  line_check_details: unknown;
  overage_reason: string | null;
  overage_note: string | null;
  work_group_label: string | null;
  allocations: SubmitRequestAllocationInput[];
}

/** activity_log insert payload (one object). */
export interface SubmitRequestActivityInput {
  project_id: string;
  user_id: string;
  type: string;
  label: string;
  flag: string;
}

/** A line as sent to the RPC — every field except the nested allocations. */
export interface SubmitRequestLinePayload {
  material_id: string | null;
  custom_material_name: string | null;
  tier: number;
  material_spec_reference: string | null;
  quantity: number;
  unit: string;
  line_flag: string;
  line_check_details: unknown;
  overage_reason: string | null;
  overage_note: string | null;
  work_group_label: string | null;
}

/** An allocation as sent to the RPC — carries its owning line's array index. */
export interface SubmitRequestAllocationPayload extends SubmitRequestAllocationInput {
  line_index: number;
}

/** The exact argument object passed to supabase.rpc('submit_material_request', …). */
export interface SubmitMaterialRequestPayload {
  p_header: SubmitRequestHeaderInput;
  p_lines: SubmitRequestLinePayload[];
  p_allocations: SubmitRequestAllocationPayload[];
  p_activity: SubmitRequestActivityInput;
}

/**
 * Assemble the transactional submit payload: strip each line's allocations onto
 * a flat array stamped with the line's 0-based index, and pass the header, line
 * fields, and activity through unchanged. Lines with no allocations contribute
 * nothing to p_allocations (correct — the RPC skips them). `line_check_details`
 * is normalized to null when undefined so it round-trips as SQL NULL rather than
 * being dropped by JSON serialization.
 */
export function buildSubmitMaterialRequestPayload(
  header: SubmitRequestHeaderInput,
  lines: SubmitRequestLineInput[],
  activity: SubmitRequestActivityInput,
): SubmitMaterialRequestPayload {
  const p_lines: SubmitRequestLinePayload[] = lines.map(line => ({
    material_id: line.material_id,
    custom_material_name: line.custom_material_name,
    tier: line.tier,
    material_spec_reference: line.material_spec_reference,
    quantity: line.quantity,
    unit: line.unit,
    line_flag: line.line_flag,
    line_check_details: line.line_check_details ?? null,
    overage_reason: line.overage_reason,
    overage_note: line.overage_note,
    work_group_label: line.work_group_label,
  }));

  const p_allocations: SubmitRequestAllocationPayload[] = lines.flatMap((line, index) =>
    line.allocations.map(allocation => ({
      line_index: index,
      boq_item_id: allocation.boq_item_id,
      allocated_quantity: allocation.allocated_quantity,
      proportion_pct: allocation.proportion_pct,
      allocation_basis: allocation.allocation_basis,
    })),
  );

  return { p_header: header, p_lines, p_allocations, p_activity: activity };
}
