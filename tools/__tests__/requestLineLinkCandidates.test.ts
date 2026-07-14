import { getRequestLineLinkCandidates, type RequestLineLinkCandidate } from '../requestLineLinkCandidates';

// Base fixture — override per test. `overall_status` models the JOIN to
// material_request_headers the picker reads (only APPROVED headers qualify).
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

describe('getRequestLineLinkCandidates', () => {
  it('excludes lines whose header is not APPROVED (PENDING, UNDER_REVIEW, REJECTED, AUTO_HOLD)', () => {
    const lines = [
      line({ id: 'a', overall_status: 'PENDING' }),
      line({ id: 'b', overall_status: 'UNDER_REVIEW' }),
      line({ id: 'c', overall_status: 'REJECTED' }),
      line({ id: 'd', overall_status: 'AUTO_HOLD' }),
      line({ id: 'e', overall_status: 'APPROVED' }),
    ];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedRequestLineIds: [] });

    expect(result.map(r => r.id)).toEqual(['e']);
  });

  it('excludes a line already linked to a PO (id present in linkedRequestLineIds)', () => {
    const lines = [
      line({ id: 'linked-1' }),
      line({ id: 'unlinked-1' }),
    ];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedRequestLineIds: ['linked-1'],
    });

    expect(result.map(r => r.id)).toEqual(['unlinked-1']);
  });

  it('accepts linkedRequestLineIds as a Set, same as an array', () => {
    const lines = [line({ id: 'linked-1' }), line({ id: 'unlinked-1' })];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: null,
      linkedRequestLineIds: new Set(['linked-1']),
    });

    expect(result.map(r => r.id)).toEqual(['unlinked-1']);
  });

  it('when the draft line has a catalog material_id, restricts candidates to that exact material', () => {
    const lines = [
      line({ id: 'same-mat', material_id: 'mat-semen' }),
      line({ id: 'other-mat', material_id: 'mat-besi' }),
      line({ id: 'free-text', material_id: null, custom_material_name: 'Semen custom' }),
    ];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: 'mat-semen',
      linkedRequestLineIds: [],
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
      linkedRequestLineIds: [],
    });

    expect(result.map(r => r.id)).toEqual(['mat-a', 'mat-b', 'free-text']);
  });

  it('combines all three filters: APPROVED-only, unlinked-only, material-matched', () => {
    const lines = [
      line({ id: 'good', material_id: 'mat-semen', overall_status: 'APPROVED' }),
      line({ id: 'wrong-material', material_id: 'mat-besi', overall_status: 'APPROVED' }),
      line({ id: 'already-linked', material_id: 'mat-semen', overall_status: 'APPROVED' }),
      line({ id: 'not-approved', material_id: 'mat-semen', overall_status: 'PENDING' }),
    ];

    const result = getRequestLineLinkCandidates(lines, {
      draftMaterialId: 'mat-semen',
      linkedRequestLineIds: ['already-linked'],
    });

    expect(result.map(r => r.id)).toEqual(['good']);
  });

  it('sorts eligible candidates by target_date ascending (most urgent / earliest need first)', () => {
    const lines = [
      line({ id: 'later', target_date: '2026-08-15' }),
      line({ id: 'sooner', target_date: '2026-07-01' }),
      line({ id: 'middle', target_date: '2026-07-20' }),
    ];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedRequestLineIds: [] });

    expect(result.map(r => r.id)).toEqual(['sooner', 'middle', 'later']);
  });

  it('returns an empty array when there are no eligible lines', () => {
    const lines = [line({ id: 'a', overall_status: 'PENDING' })];

    const result = getRequestLineLinkCandidates(lines, { draftMaterialId: null, linkedRequestLineIds: [] });

    expect(result).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    const result = getRequestLineLinkCandidates([], { draftMaterialId: null, linkedRequestLineIds: [] });
    expect(result).toEqual([]);
  });
});
