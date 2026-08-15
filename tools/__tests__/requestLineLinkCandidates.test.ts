import {
  getRequestLineLinkCandidates,
  type RequestLineLinkCandidate,
  type LinkedPoLineQuantity,
} from '../requestLineLinkCandidates';

// Base fixture — override per test. `overall_status` models the JOIN to
// material_request_headers the picker reads (only APPROVED headers qualify).
// `quantity` is the request line's approved_qty — the ceiling `remaining` is
// derived from (spec §4.1).
function line(partial: Partial<RequestLineLinkCandidate> & { id: string }): RequestLineLinkCandidate {
  return {
    material_id: 'mat-semen',
    custom_material_name: null,
    quantity: 10,
    unit: 'sak',
    target_date: '2026-07-01',
    overall_status: 'APPROVED',
    ...partial,
  };
}

// A non-cancelled-by-default existing PO line referencing a request line.
function poLine(partial: Partial<LinkedPoLineQuantity> & { request_line_id: string }): LinkedPoLineQuantity {
  return {
    quantity: 10,
    po_status: 'OPEN',
    ...partial,
  };
}

describe('getRequestLineLinkCandidates', () => {
  it('excludes lines whose header is not APPROVED (PENDING, UNDER_REVIEW, REJECTED, AUTO_HOLD)', () => {
    const lines = [
      line({ id: 'a', overall_status: 'PENDING' }),
      line({ id: 'b', overall_status: 'UNDER_REVIEW' }),
      line({ id: 'c', overall_status: 'REJECTED' }),
      line({ id: 'd', overall_status: 'AUTO_HOLD' }),
      line({ id: 'e', overall_status: 'APPROVED' }),
    ];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedPoLines: [] });

    expect(result.map(r => r.id)).toEqual(['e']);
  });

  it('a line with no linked PO lines is fully available (remaining === approved_qty)', () => {
    const lines = [line({ id: 'unlinked-1', quantity: 10 })];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedPoLines: [] });

    expect(result.map(r => r.id)).toEqual(['unlinked-1']);
    expect(result[0].remaining).toBe(10);
  });

  it('partial link leaves remainder available and displays it', () => {
    const lines = [line({ id: 'semen-1', quantity: 10 })];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedPoLines: [poLine({ request_line_id: 'semen-1', quantity: 4 })],
    });

    expect(result.map(r => r.id)).toEqual(['semen-1']);
    expect(result[0].remaining).toBe(6);
  });

  it('full link removes the line from the picker (remaining === 0)', () => {
    const lines = [line({ id: 'semen-1', quantity: 10 })];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedPoLines: [poLine({ request_line_id: 'semen-1', quantity: 10 })],
    });

    expect(result.map(r => r.id)).toEqual([]);
  });

  it('a CANCELLED PO frees the linked quantity back — the line reappears with full remaining', () => {
    const lines = [line({ id: 'semen-1', quantity: 10 })];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedPoLines: [poLine({ request_line_id: 'semen-1', quantity: 10, po_status: 'CANCELLED' })],
    });

    expect(result.map(r => r.id)).toEqual(['semen-1']);
    expect(result[0].remaining).toBe(10);
  });

  it('a CANCELLED PO line does not count toward the linked total even alongside a non-cancelled partial link', () => {
    const lines = [line({ id: 'semen-1', quantity: 10 })];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedPoLines: [
        poLine({ request_line_id: 'semen-1', quantity: 4, po_status: 'OPEN' }),
        poLine({ request_line_id: 'semen-1', quantity: 6, po_status: 'CANCELLED' }),
      ],
    });

    expect(result.map(r => r.id)).toEqual(['semen-1']);
    expect(result[0].remaining).toBe(6); // 10 - 4 (only the non-cancelled 4 counts)
  });

  it('over-link cannot make remaining negative (floor at 0) — the line is excluded, not offered with a negative remainder', () => {
    const lines = [line({ id: 'over-linked', quantity: 10 })];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedPoLines: [
        poLine({ request_line_id: 'over-linked', quantity: 6 }),
        poLine({ request_line_id: 'over-linked', quantity: 7 }), // sums to 13 > 10
      ],
    });

    expect(result).toEqual([]);
  });

  it('when the draft line has a catalog material_id, restricts candidates to that exact material', () => {
    const lines = [
      line({ id: 'same-mat', material_id: 'mat-semen' }),
      line({ id: 'other-mat', material_id: 'mat-besi' }),
      line({ id: 'free-text', material_id: null, custom_material_name: 'Semen custom' }),
    ];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: 'mat-semen',
      linkedPoLines: [],
    });

    expect(result.map(r => r.id)).toEqual(['same-mat']);
  });

  it('when the draft line is free-text (material_id null), returns every eligible candidate regardless of material — admin judgment', () => {
    const lines = [
      line({ id: 'mat-a', material_id: 'mat-semen' }),
      line({ id: 'mat-b', material_id: 'mat-besi' }),
      line({ id: 'free-text', material_id: null, custom_material_name: 'Custom item' }),
    ];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedPoLines: [],
    });

    expect(result.map(r => r.id)).toEqual(['mat-a', 'mat-b', 'free-text']);
  });

  it('combines all filters: APPROVED-only, remaining > 0, material-matched', () => {
    const lines = [
      line({ id: 'good', material_id: 'mat-semen', overall_status: 'APPROVED' }),
      line({ id: 'wrong-material', material_id: 'mat-besi', overall_status: 'APPROVED' }),
      line({ id: 'fully-linked', material_id: 'mat-semen', overall_status: 'APPROVED', quantity: 10 }),
      line({ id: 'not-approved', material_id: 'mat-semen', overall_status: 'PENDING' }),
    ];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: 'mat-semen',
      linkedPoLines: [poLine({ request_line_id: 'fully-linked', quantity: 10 })],
    });

    expect(result.map(r => r.id)).toEqual(['good']);
  });

  it('sorts eligible candidates by target_date ascending (most urgent / earliest need first)', () => {
    const lines = [
      line({ id: 'later', target_date: '2026-08-15' }),
      line({ id: 'sooner', target_date: '2026-07-01' }),
      line({ id: 'middle', target_date: '2026-07-20' }),
    ];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedPoLines: [] });

    expect(result.map(r => r.id)).toEqual(['sooner', 'middle', 'later']);
  });

  it('returns an empty array when there are no eligible lines', () => {
    const lines = [line({ id: 'a', overall_status: 'PENDING' })];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedPoLines: [] });

    expect(result).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    const result = getRequestLineLinkCandidates([], { draftMaterialId: null, linkedPoLines: [] });
    expect(result).toEqual([]);
  });
});
