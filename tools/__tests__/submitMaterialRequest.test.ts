/**
 * Unit tests for the material-request submit payload builder (Task 2.9).
 *
 * The load-bearing, error-prone part of making the submit transactional is the
 * allocations-by-array-index flattening: the RPC receives lines and allocations
 * as two flat JSONB arrays, and each allocation carries a `line_index` pointing
 * at the line it belongs to (the client cannot know the real line id before the
 * insert). This suite pins that index mapping and the field mirroring so a
 * refactor cannot silently mis-wire an allocation to the wrong line.
 */
import {
  buildSubmitMaterialRequestPayload,
  type SubmitRequestHeaderInput,
  type SubmitRequestLineInput,
  type SubmitRequestActivityInput,
} from '../submitMaterialRequest';

const header: SubmitRequestHeaderInput = {
  project_id: 'proj-1',
  boq_item_id: null,
  request_basis: 'MATERIAL',
  requested_by: 'user-1',
  target_date: '2026-07-20',
  urgency: 'NORMAL',
  common_note: null,
  overall_flag: 'OK',
  overall_status: 'PENDING',
};

const activity: SubmitRequestActivityInput = {
  project_id: 'proj-1',
  user_id: 'user-1',
  type: 'permintaan',
  label: 'Permintaan material: Semen x10 sak',
  flag: 'OK',
};

function line(overrides: Partial<SubmitRequestLineInput> = {}): SubmitRequestLineInput {
  return {
    material_id: 'mat-1',
    custom_material_name: null,
    tier: 2,
    material_spec_reference: null,
    quantity: 10,
    unit: 'kg',
    line_flag: 'OK',
    line_check_details: null,
    overage_reason: null,
    overage_note: null,
    work_group_label: null,
    allocations: [],
    ...overrides,
  };
}

describe('buildSubmitMaterialRequestPayload', () => {
  it('passes the header and activity through unchanged', () => {
    const payload = buildSubmitMaterialRequestPayload(header, [line()], activity);
    expect(payload.p_header).toEqual(header);
    expect(payload.p_activity).toEqual(activity);
  });

  it('mirrors every line field but strips the nested allocations off the line objects', () => {
    const payload = buildSubmitMaterialRequestPayload(
      header,
      [
        line({
          material_id: 'mat-9',
          custom_material_name: 'Besi custom',
          tier: 1,
          material_spec_reference: 'D13',
          quantity: 42.5,
          unit: 'kg',
          line_flag: 'WARNING',
          line_check_details: { overage: { burnPct: 130 } },
          overage_reason: 'WASTE',
          overage_note: 'sisa potongan',
          work_group_label: 'Pekerjaan Beton',
          allocations: [
            { boq_item_id: 'boq-1', allocated_quantity: 20, proportion_pct: 50, allocation_basis: 'WORKGROUP_ENVELOPE' },
          ],
        }),
      ],
      activity,
    );
    expect(payload.p_lines).toHaveLength(1);
    expect(payload.p_lines[0]).toEqual({
      material_id: 'mat-9',
      custom_material_name: 'Besi custom',
      tier: 1,
      material_spec_reference: 'D13',
      quantity: 42.5,
      unit: 'kg',
      line_flag: 'WARNING',
      line_check_details: { overage: { burnPct: 130 } },
      overage_reason: 'WASTE',
      overage_note: 'sisa potongan',
      work_group_label: 'Pekerjaan Beton',
    });
    // The nested allocations must NOT leak into the line object.
    expect((payload.p_lines[0] as unknown as Record<string, unknown>).allocations).toBeUndefined();
  });

  it('normalizes an undefined line_check_details to null', () => {
    const payload = buildSubmitMaterialRequestPayload(
      header,
      [line({ line_check_details: undefined })],
      activity,
    );
    expect(payload.p_lines[0].line_check_details).toBeNull();
  });

  it('flattens allocations with the correct 0-based line_index per line', () => {
    const payload = buildSubmitMaterialRequestPayload(
      header,
      [
        line({
          allocations: [
            { boq_item_id: 'boq-a', allocated_quantity: 5, proportion_pct: 50, allocation_basis: 'TIER2_ENVELOPE' },
            { boq_item_id: 'boq-b', allocated_quantity: 5, proportion_pct: 50, allocation_basis: 'TIER2_ENVELOPE' },
          ],
        }),
        line({ allocations: [] }), // a line with no allocations contributes nothing
        line({
          allocations: [
            { boq_item_id: 'boq-c', allocated_quantity: 3, proportion_pct: 100, allocation_basis: 'WORKGROUP_ENVELOPE' },
          ],
        }),
      ],
      activity,
    );
    expect(payload.p_allocations).toEqual([
      { line_index: 0, boq_item_id: 'boq-a', allocated_quantity: 5, proportion_pct: 50, allocation_basis: 'TIER2_ENVELOPE' },
      { line_index: 0, boq_item_id: 'boq-b', allocated_quantity: 5, proportion_pct: 50, allocation_basis: 'TIER2_ENVELOPE' },
      { line_index: 2, boq_item_id: 'boq-c', allocated_quantity: 3, proportion_pct: 100, allocation_basis: 'WORKGROUP_ENVELOPE' },
    ]);
  });

  it('produces an empty allocations array when no line has allocations', () => {
    const payload = buildSubmitMaterialRequestPayload(header, [line(), line()], activity);
    expect(payload.p_allocations).toEqual([]);
  });
});
