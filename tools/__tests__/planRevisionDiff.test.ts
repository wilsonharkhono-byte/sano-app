import {
  computePlanRevisionDiff,
  classifyPlanChange,
  aggregatePlannedByMaterial,
  lowerBelowOrderedPct,
  PLAN_REVISION_WARNING_CLASSES,
  type PlanMasterRow,
  type MaterialActivity,
} from '../planRevisionDiff';

// A zero-activity material (no PO, no request, no receipt).
const NONE: MaterialActivity = { ordered: 0, requested: 0, receiptsExist: false };
const act = (o: number, r = 0, receipts = false): MaterialActivity => ({
  ordered: o,
  requested: r,
  receiptsExist: receipts,
});

// ─────────────────────────────────────────────────────────────────────────
// classifyPlanChange — the classification core + every boundary.
// ─────────────────────────────────────────────────────────────────────────
describe('classifyPlanChange', () => {
  describe('RAISE / RAISE_ABSOLVING_OVERAGE', () => {
    it('raise while ordered exceeds the OLD plan → RAISE_ABSOLVING_OVERAGE', () => {
      // before 100, after 150, ordered 120 (> before) → absolving.
      expect(classifyPlanChange(100, 150, true, true, act(120))).toBe('RAISE_ABSOLVING_OVERAGE');
    });

    it('ordered == planned_before exactly → NOT absolving (plain RAISE)', () => {
      expect(classifyPlanChange(100, 150, true, true, act(100))).toBe('RAISE');
    });

    it('ordered below planned_before → plain RAISE', () => {
      expect(classifyPlanChange(100, 150, true, true, act(90))).toBe('RAISE');
    });

    it('precedence overlap: before < after < ordered → RAISE_ABSOLVING_OVERAGE', () => {
      // The absolving test is `ordered > planned_before`, NOT `ordered > after`.
      // Here ordered (200) exceeds even the raised plan (after 150): the raise
      // still only partially covers the over-order, but it is unambiguously
      // absolving an existing overage. Must NOT be mistaken for a plain RAISE
      // just because the new ceiling is below the ordered qty.
      expect(classifyPlanChange(100, 150, true, true, act(200))).toBe('RAISE_ABSOLVING_OVERAGE');
    });

    it('raise with no ordering at all → plain RAISE', () => {
      expect(classifyPlanChange(100, 150, true, true, act(0, 50))).toBe('RAISE');
    });
  });

  describe('LOWER / LOWER_BELOW_ORDERED', () => {
    it('lower under the already-ordered qty → LOWER_BELOW_ORDERED', () => {
      // before 200, after 80, ordered 120 → after < ordered.
      expect(classifyPlanChange(200, 80, true, true, act(120))).toBe('LOWER_BELOW_ORDERED');
    });

    it('planned_after == ordered exactly → NOT below (plain LOWER)', () => {
      expect(classifyPlanChange(200, 120, true, true, act(120))).toBe('LOWER');
    });

    it('lower but still above the ordered qty → plain LOWER', () => {
      expect(classifyPlanChange(200, 150, true, true, act(120))).toBe('LOWER');
    });

    it('lower with nothing ordered → plain LOWER', () => {
      expect(classifyPlanChange(200, 150, true, true, act(0, 30))).toBe('LOWER');
    });
  });

  describe('ADDED / REMOVED', () => {
    it('present in new, absent from current → ADDED', () => {
      expect(classifyPlanChange(0, 50, true, false, act(10))).toBe('ADDED');
    });

    it('present in current, absent from new → REMOVED_WITH_ACTIVITY', () => {
      expect(classifyPlanChange(50, 0, false, true, act(10))).toBe('REMOVED_WITH_ACTIVITY');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// aggregatePlannedByMaterial — per-(boq,material) lines summed per material.
// ─────────────────────────────────────────────────────────────────────────
describe('aggregatePlannedByMaterial', () => {
  it('sums planned_quantity across BoQ lines of the same material', () => {
    const rows: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 30 },
      { material_id: 'm1', planned_quantity: 70 },
      { material_id: 'm2', planned_quantity: 5 },
    ];
    const map = aggregatePlannedByMaterial(rows);
    expect(map.get('m1')).toBe(100);
    expect(map.get('m2')).toBe(5);
    expect(map.size).toBe(2);
  });

  it('returns an empty map for no rows (first publish, empty current)', () => {
    expect(aggregatePlannedByMaterial([]).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// computePlanRevisionDiff — end-to-end classification, activity scoping,
// collapse-to-summary, warning surfacing.
// ─────────────────────────────────────────────────────────────────────────
describe('computePlanRevisionDiff', () => {
  it('produces NO lines and zero warnings for a no-change re-publish', () => {
    const master: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 100 },
      { material_id: 'm2', planned_quantity: 50 },
    ];
    const diff = computePlanRevisionDiff(master, master, new Map([['m1', act(80)]]));
    expect(diff.lines).toHaveLength(0);
    expect(diff.warningClasses).toHaveLength(0);
    expect(diff.summary.warningCount).toBe(0);
    expect(diff.summary.noActivityChanged).toBe(0);
  });

  it('collapses changed-but-no-activity materials into the summary, not lines', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 100 }];
    const next: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 130 }];
    // m1 raised but has NO activity → collapsed.
    const diff = computePlanRevisionDiff(next, current, new Map());
    expect(diff.lines).toHaveLength(0);
    expect(diff.summary.noActivityChanged).toBe(1);
    expect(diff.summary.warningCount).toBe(0);
  });

  it('first publish (empty current) with no activity → all collapse, no lines', () => {
    const next: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 100 },
      { material_id: 'm2', planned_quantity: 50 },
    ];
    const diff = computePlanRevisionDiff(next, [], new Map());
    expect(diff.lines).toHaveLength(0);
    expect(diff.summary.noActivityChanged).toBe(2);
    expect(diff.summary.added).toBe(0);
  });

  it('records a RAISE line (with activity) as a warning and captures ordered/requested at time', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 100 }];
    const next: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 150 }];
    const diff = computePlanRevisionDiff(next, current, new Map([['m1', act(60, 20)]]));
    expect(diff.lines).toHaveLength(1);
    const line = diff.lines[0];
    expect(line).toMatchObject({
      material_id: 'm1',
      planned_before: 100,
      planned_after: 150,
      ordered_at_time: 60,
      requested_at_time: 20,
      classification: 'RAISE',
    });
    expect(diff.summary.raised).toBe(1);
    expect(diff.summary.warningCount).toBe(1);
    expect(diff.warningClasses).toEqual(['RAISE']);
  });

  it('classifies a raise absolving an existing overage and surfaces it as a warning class', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 100 }];
    const next: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 200 }];
    const diff = computePlanRevisionDiff(next, current, new Map([['m1', act(140)]]));
    expect(diff.lines[0].classification).toBe('RAISE_ABSOLVING_OVERAGE');
    expect(diff.summary.raisedAbsolvingOverage).toBe(1);
    expect(diff.warningClasses).toContain('RAISE_ABSOLVING_OVERAGE');
    expect(diff.summary.warningCount).toBe(1);
  });

  it('classifies a lower-below-ordered as a warning', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 200 }];
    const next: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 90 }];
    const diff = computePlanRevisionDiff(next, current, new Map([['m1', act(120)]]));
    expect(diff.lines[0].classification).toBe('LOWER_BELOW_ORDERED');
    expect(diff.summary.loweredBelowOrdered).toBe(1);
    expect(diff.summary.warningCount).toBe(1);
  });

  it('a plain LOWER (with activity, above ordered) is recorded but is NOT a warning', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 200 }];
    const next: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 150 }];
    const diff = computePlanRevisionDiff(next, current, new Map([['m1', act(100)]]));
    expect(diff.lines[0].classification).toBe('LOWER');
    expect(diff.summary.lowered).toBe(1);
    expect(diff.summary.warningCount).toBe(0);
    expect(diff.warningClasses).toHaveLength(0);
  });

  it('REMOVED_WITH_ACTIVITY is the strongest warning; removed-without-activity collapses', () => {
    const current: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 100 },
      { material_id: 'm2', planned_quantity: 50 },
    ];
    const next: PlanMasterRow[] = []; // both removed
    const diff = computePlanRevisionDiff(
      next,
      current,
      new Map([['m1', act(30)]]), // m1 has activity, m2 does not
    );
    const removed = diff.lines.filter(l => l.classification === 'REMOVED_WITH_ACTIVITY');
    expect(removed).toHaveLength(1);
    expect(removed[0].material_id).toBe('m1');
    expect(removed[0].planned_before).toBe(100);
    expect(removed[0].planned_after).toBe(0);
    expect(diff.summary.removedWithActivity).toBe(1);
    expect(diff.summary.noActivityChanged).toBe(1); // m2 collapsed
    expect(diff.summary.warningCount).toBe(1);
  });

  it('ADDED (with activity) is recorded but is not a warning class', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 100 }];
    const next: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 100 }, // unchanged
      { material_id: 'm2', planned_quantity: 40 }, // added
    ];
    const diff = computePlanRevisionDiff(next, current, new Map([['m2', act(10)]]));
    expect(diff.lines).toHaveLength(1);
    expect(diff.lines[0]).toMatchObject({ material_id: 'm2', classification: 'ADDED', planned_before: 0, planned_after: 40 });
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.warningCount).toBe(0);
  });

  it('receiptsExist alone counts as activity (no PO, no request)', () => {
    const current: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 100 }];
    const next: PlanMasterRow[] = [{ material_id: 'm1', planned_quantity: 130 }];
    const diff = computePlanRevisionDiff(next, current, new Map([['m1', act(0, 0, true)]]));
    expect(diff.lines).toHaveLength(1);
    expect(diff.lines[0].classification).toBe('RAISE');
  });

  it('aggregates per-(boq,material) rows before diffing', () => {
    const current: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 40 },
      { material_id: 'm1', planned_quantity: 60 }, // total 100
    ];
    const next: PlanMasterRow[] = [
      { material_id: 'm1', planned_quantity: 90 },
      { material_id: 'm1', planned_quantity: 60 }, // total 150
    ];
    const diff = computePlanRevisionDiff(next, current, new Map([['m1', act(60)]]));
    expect(diff.lines).toHaveLength(1);
    expect(diff.lines[0].planned_before).toBe(100);
    expect(diff.lines[0].planned_after).toBe(150);
    expect(diff.lines[0].classification).toBe('RAISE');
  });

  it('surfaces distinct warning classes in canonical order across a mixed batch', () => {
    const current: PlanMasterRow[] = [
      { material_id: 'raiseOver', planned_quantity: 100 },
      { material_id: 'raise', planned_quantity: 100 },
      { material_id: 'lowerBelow', planned_quantity: 200 },
      { material_id: 'removed', planned_quantity: 50 },
      { material_id: 'plainLower', planned_quantity: 200 },
    ];
    const next: PlanMasterRow[] = [
      { material_id: 'raiseOver', planned_quantity: 200 },
      { material_id: 'raise', planned_quantity: 150 },
      { material_id: 'lowerBelow', planned_quantity: 80 },
      { material_id: 'plainLower', planned_quantity: 150 },
    ];
    const activity = new Map<string, MaterialActivity>([
      ['raiseOver', act(140)],
      ['raise', act(50)],
      ['lowerBelow', act(120)],
      ['removed', act(20)],
      ['plainLower', act(100)],
    ]);
    const diff = computePlanRevisionDiff(next, current, activity);
    expect(diff.warningClasses).toEqual([
      'RAISE_ABSOLVING_OVERAGE',
      'RAISE',
      'LOWER_BELOW_ORDERED',
      'REMOVED_WITH_ACTIVITY',
    ]);
    expect(diff.summary.warningCount).toBe(4); // plainLower is not a warning
    expect(diff.summary.lowered).toBe(1);
    expect(diff.lines).toHaveLength(5);
  });

  it('exposes the canonical warning-class list', () => {
    expect([...PLAN_REVISION_WARNING_CLASSES]).toEqual([
      'RAISE_ABSOLVING_OVERAGE',
      'RAISE',
      'LOWER_BELOW_ORDERED',
      'REMOVED_WITH_ACTIVITY',
    ]);
  });
});

describe('lowerBelowOrderedPct', () => {
  it('computes ordered as a percent of the new (lower) plan', () => {
    // ordered 120 vs new plan 80 → 150%.
    expect(lowerBelowOrderedPct({ ordered_at_time: 120, planned_after: 80 })).toBe(150);
  });

  it('returns Infinity when the new plan is zero (fully removed)', () => {
    expect(lowerBelowOrderedPct({ ordered_at_time: 30, planned_after: 0 })).toBe(Infinity);
  });
});
