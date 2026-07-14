import {
  proposedAggregatesToArray,
  buildCeilingRaisePayload,
  checkCeilingRaiseCoverage,
  mapCeilingBreachRows,
  type CeilingBreach,
  type CeilingRaisePayloadEntry,
} from '../ceilingRaiseGate';

const breach = (over: Partial<CeilingBreach> = {}): CeilingBreach => ({
  material_id: 'm1',
  material_name: 'Besi D13',
  planned_before: 1000,
  proposed: 1300,
  ordered: 1100,
  ...over,
});

describe('proposedAggregatesToArray', () => {
  it('maps a per-material Map to {material_id, planned_qty} entries', () => {
    const out = proposedAggregatesToArray(new Map([['a', 10], ['b', 20]]));
    expect(out).toEqual(
      expect.arrayContaining([
        { material_id: 'a', planned_qty: 10 },
        { material_id: 'b', planned_qty: 20 },
      ]),
    );
    expect(out).toHaveLength(2);
  });

  it('drops zero, negative, and empty-id entries (they can never breach)', () => {
    const out = proposedAggregatesToArray(new Map([['a', 0], ['b', -5], ['', 99], ['c', 3]]));
    expect(out).toEqual([{ material_id: 'c', planned_qty: 3 }]);
  });
});

describe('mapCeilingBreachRows', () => {
  it('coerces string/unknown numeric fields from PostgREST into a typed CeilingBreach', () => {
    const out = mapCeilingBreachRows([
      { material_id: 'm1', material_name: 'Besi D13', planned_before: '1000', proposed: '1300', ordered: '1100' },
    ]);
    expect(out).toEqual([
      { material_id: 'm1', material_name: 'Besi D13', planned_before: 1000, proposed: 1300, ordered: 1100 },
    ]);
  });

  it('drops rows without a material_id and falls back to the id for a missing name', () => {
    const out = mapCeilingBreachRows([
      { material_id: null, material_name: 'ghost', planned_before: 1, proposed: 2, ordered: 3 },
      { material_id: 'm2', material_name: '', planned_before: 5, proposed: 9, ordered: 7 },
    ]);
    expect(out).toEqual([
      { material_id: 'm2', material_name: 'm2', planned_before: 5, proposed: 9, ordered: 7 },
    ]);
  });

  it('returns [] for null/empty input', () => {
    expect(mapCeilingBreachRows(null)).toEqual([]);
    expect(mapCeilingBreachRows([])).toEqual([]);
  });
});

describe('buildCeilingRaisePayload', () => {
  it('carries planned_before/ordered and sets proposed_qty = the proposed ceiling', () => {
    const payload = buildCeilingRaisePayload([breach()]);
    expect(payload).toEqual([
      { material_id: 'm1', material_name: 'Besi D13', planned_before: 1000, proposed_qty: 1300, ordered: 1100 },
    ]);
  });

  it('is server-shaped: one entry per breach, order preserved', () => {
    const payload = buildCeilingRaisePayload([
      breach({ material_id: 'm1' }),
      breach({ material_id: 'm2', material_name: 'Semen' }),
    ]);
    expect(payload.map(e => e.material_id)).toEqual(['m1', 'm2']);
  });
});

describe('checkCeilingRaiseCoverage', () => {
  const cover = (over: Partial<CeilingRaisePayloadEntry> = {}): CeilingRaisePayloadEntry => ({
    material_id: 'm1',
    material_name: 'Besi D13',
    planned_before: 1000,
    proposed_qty: 1300,
    ordered: 1100,
    ...over,
  });

  it('covers a breach when the payload authorises proposed_qty >= proposed', () => {
    const res = checkCeilingRaiseCoverage([breach()], [cover()]);
    expect(res.covered).toBe(true);
    expect(res.uncovered).toHaveLength(0);
  });

  it('leaves a breach uncovered when the material is absent from the payload', () => {
    const res = checkCeilingRaiseCoverage([breach()], []);
    expect(res.covered).toBe(false);
    expect(res.uncovered.map(b => b.material_id)).toEqual(['m1']);
  });

  it('leaves a breach uncovered when the approved ceiling is below the current proposed', () => {
    // Approved 1200, but the estimator now proposes 1300 → not covered.
    const res = checkCeilingRaiseCoverage([breach({ proposed: 1300 })], [cover({ proposed_qty: 1200 })]);
    expect(res.covered).toBe(false);
    expect(res.uncovered).toHaveLength(1);
  });

  it('covers when the approved ceiling exactly equals the proposed (boundary >=)', () => {
    const res = checkCeilingRaiseCoverage(
      [breach({ proposed: 1300 })],
      [cover({ proposed_qty: 1300 })],
    );
    expect(res.covered).toBe(true);
  });

  it('is fail-closed: an approval a hair below the proposed is UNCOVERED (no epsilon slack, mirrors server exact >=)', () => {
    // Post-review 3(a): dropped the 1e-9 epsilon so the client matches migration
    // 079's exact `proposed_qty >= b.proposed`. A hair-short approval the client
    // once called "covered" would be rejected by the server on publish — so the
    // client must refuse to attach it too (fail-closed alignment).
    const res = checkCeilingRaiseCoverage(
      [breach({ proposed: 1300 })],
      [cover({ proposed_qty: 1300 - 1e-9 })],
    );
    expect(res.covered).toBe(false);
    expect(res.uncovered).toHaveLength(1);
  });

  it('takes the largest authorised ceiling when a material is listed twice', () => {
    const res = checkCeilingRaiseCoverage(
      [breach({ proposed: 1300 })],
      [cover({ proposed_qty: 1200 }), cover({ proposed_qty: 1400 })],
    );
    expect(res.covered).toBe(true);
  });
});
