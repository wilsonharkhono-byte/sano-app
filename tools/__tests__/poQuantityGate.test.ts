import {
  evaluatePoQuantityGate,
  buildOverridePayload,
  checkOverrideCoverage,
  type PoGateLine,
  type PoGateEnvelope,
  type OverridePayloadEntry,
} from '../poQuantityGate';

// Base-unit envelope fixtures (all quantities in base units — kg, m2, pcs).
function env(partial: Partial<PoGateEnvelope> & { material_id: string }): PoGateEnvelope {
  return {
    material_name: partial.material_id,
    total_planned: 0,
    total_ordered: 0,
    ...partial,
  };
}

describe('evaluatePoQuantityGate — breach detection', () => {
  it('flags a line that pushes ordered past planned (planned 1000, ordered 900, line 150 → over 50)', () => {
    const envelopes = [env({ material_id: 'besi', material_name: 'Besi D13', total_planned: 1000, total_ordered: 900 })];
    const lines: PoGateLine[] = [{ material_id: 'besi', material_name: 'Besi D13', quantity: 150 }];

    const result = evaluatePoQuantityGate(lines, envelopes);

    expect(result.hasBreach).toBe(true);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]).toMatchObject({
      material_id: 'besi',
      remaining: 100,
      attempted: 150,
      over: 50,
    });
    expect(result.measuredOk).toHaveLength(0);
  });

  it('passes exactly at the remaining boundary (remaining 150, line 150 → no breach)', () => {
    const envelopes = [env({ material_id: 'besi', total_planned: 1000, total_ordered: 850 })];
    const lines: PoGateLine[] = [{ material_id: 'besi', material_name: 'Besi', quantity: 150 }];

    const result = evaluatePoQuantityGate(lines, envelopes);

    expect(result.hasBreach).toBe(false);
    expect(result.breaches).toHaveLength(0);
    expect(result.measuredOk).toEqual(['besi']);
  });

  it('passes a line comfortably within the envelope', () => {
    const envelopes = [env({ material_id: 'semen', total_planned: 1000, total_ordered: 100 })];
    const lines: PoGateLine[] = [{ material_id: 'semen', material_name: 'Semen', quantity: 50 }];

    expect(evaluatePoQuantityGate(lines, envelopes).hasBreach).toBe(false);
  });

  it('treats an already over-ordered material (negative remaining) as a breach for any qty', () => {
    const envelopes = [env({ material_id: 'besi', total_planned: 1000, total_ordered: 1100 })];
    const lines: PoGateLine[] = [{ material_id: 'besi', material_name: 'Besi', quantity: 1 }];

    const result = evaluatePoQuantityGate(lines, envelopes);
    expect(result.hasBreach).toBe(true);
    expect(result.breaches[0].remaining).toBe(-100);
    expect(result.breaches[0].over).toBe(101);
  });

  it('aggregates two lines for the same material before comparing (split over-order is caught)', () => {
    const envelopes = [env({ material_id: 'besi', total_planned: 1000, total_ordered: 900 })];
    const lines: PoGateLine[] = [
      { material_id: 'besi', material_name: 'Besi', quantity: 60 },
      { material_id: 'besi', material_name: 'Besi', quantity: 60 },
    ];

    const result = evaluatePoQuantityGate(lines, envelopes);
    // 60 + 60 = 120 attempted vs remaining 100 → breach of 20, even though each
    // individual line (60) would be under the remaining.
    expect(result.hasBreach).toBe(true);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].attempted).toBe(120);
    expect(result.breaches[0].over).toBe(20);
  });
});

describe('evaluatePoQuantityGate — unmeasured lines never breach', () => {
  it('marks a free-text line (material_id null) as unmeasured, never a breach', () => {
    const lines: PoGateLine[] = [{ material_id: null, material_name: 'Kayu reng lokal', quantity: 9999 }];

    const result = evaluatePoQuantityGate(lines, []);

    expect(result.hasBreach).toBe(false);
    expect(result.breaches).toHaveLength(0);
    expect(result.unmeasured).toHaveLength(1);
    expect(result.unmeasured[0]).toMatchObject({ material_id: null, attempted: 9999 });
  });

  it('marks a catalog material with no envelope row as unmeasured', () => {
    const lines: PoGateLine[] = [{ material_id: 'orphan', material_name: 'Material tanpa BoQ', quantity: 500 }];

    const result = evaluatePoQuantityGate(lines, []);

    expect(result.hasBreach).toBe(false);
    expect(result.unmeasured).toHaveLength(1);
    expect(result.unmeasured[0].material_id).toBe('orphan');
  });

  it('marks a material whose envelope has zero planned as unmeasured (no baseline to compare)', () => {
    const envelopes = [env({ material_id: 'x', total_planned: 0, total_ordered: 0 })];
    const lines: PoGateLine[] = [{ material_id: 'x', material_name: 'X', quantity: 10 }];

    const result = evaluatePoQuantityGate(lines, envelopes);
    expect(result.hasBreach).toBe(false);
    expect(result.unmeasured.map(u => u.material_id)).toContain('x');
  });

  it('does not treat float subtraction noise as a breach at the boundary', () => {
    const envelopes = [env({ material_id: 'm', total_planned: 0.3, total_ordered: 0.1 })];
    // remaining = 0.2 (but 0.3 - 0.1 in float = 0.19999999999999998); attempted 0.2 must NOT breach.
    const lines: PoGateLine[] = [{ material_id: 'm', material_name: 'M', quantity: 0.2 }];

    expect(evaluatePoQuantityGate(lines, envelopes).hasBreach).toBe(false);
  });
});

describe('buildOverridePayload', () => {
  it('produces one entry per breaching material with attempted + remaining', () => {
    const envelopes = [
      env({ material_id: 'besi', total_planned: 1000, total_ordered: 900 }),
      env({ material_id: 'semen', total_planned: 500, total_ordered: 480 }),
    ];
    const lines: PoGateLine[] = [
      { material_id: 'besi', material_name: 'Besi', quantity: 150 },
      { material_id: 'semen', material_name: 'Semen', quantity: 40 },
    ];
    const { breaches } = evaluatePoQuantityGate(lines, envelopes);
    const payload = buildOverridePayload(breaches);

    expect(payload).toEqual([
      { material_id: 'besi', attempted_qty: 150, remaining_at_escalation: 100 },
      { material_id: 'semen', attempted_qty: 40, remaining_at_escalation: 20 },
    ]);
  });
});

describe('checkOverrideCoverage — mirrors the server-side RPC verification', () => {
  const breach = { material_id: 'besi', material_name: 'Besi', remaining: 100, attempted: 150, over: 50 };

  it('covers a breach when payload has the material with attempted_qty >= this attempt', () => {
    const payload: OverridePayloadEntry[] = [{ material_id: 'besi', attempted_qty: 150, remaining_at_escalation: 100 }];
    const r = checkOverrideCoverage([breach], payload);
    expect(r.covered).toBe(true);
    expect(r.uncovered).toHaveLength(0);
  });

  it('covers when the approved attempted_qty exceeds this attempt', () => {
    const payload: OverridePayloadEntry[] = [{ material_id: 'besi', attempted_qty: 200, remaining_at_escalation: 100 }];
    expect(checkOverrideCoverage([breach], payload).covered).toBe(true);
  });

  it('does NOT cover when the approved attempted_qty is below this attempt', () => {
    const payload: OverridePayloadEntry[] = [{ material_id: 'besi', attempted_qty: 100, remaining_at_escalation: 100 }];
    const r = checkOverrideCoverage([breach], payload);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual([breach]);
  });

  it('does NOT cover when the payload is for a different material', () => {
    const payload: OverridePayloadEntry[] = [{ material_id: 'semen', attempted_qty: 999, remaining_at_escalation: 0 }];
    expect(checkOverrideCoverage([breach], payload).covered).toBe(false);
  });

  it('requires EVERY breaching material to be covered', () => {
    const breach2 = { material_id: 'semen', material_name: 'Semen', remaining: 20, attempted: 40, over: 20 };
    const payload: OverridePayloadEntry[] = [{ material_id: 'besi', attempted_qty: 150, remaining_at_escalation: 100 }];
    const r = checkOverrideCoverage([breach, breach2], payload);
    expect(r.covered).toBe(false);
    expect(r.uncovered).toEqual([breach2]);
  });

  it('an empty payload covers nothing', () => {
    expect(checkOverrideCoverage([breach], []).covered).toBe(false);
  });
});
