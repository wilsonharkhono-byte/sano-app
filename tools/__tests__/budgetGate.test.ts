import { evaluateTier3Budget, evaluateTier4Untracked } from '../budgetGate';
import type { MaterialBudgetStatus } from '../types';

const budget = (m: Partial<MaterialBudgetStatus>): MaterialBudgetStatus => ({
  material_id: 'mat-1',
  project_id: 'proj-1',
  material_name: 'Cat tembok',
  tier: 3,
  unit: 'ltr',
  benchmark_unit_price: 85_000,
  total_planned: 100,
  budget_total_rupiah: 8_500_000,
  committed_rupiah: 0,
  remaining_rupiah: 8_500_000,
  burn_pct: 0,
  boq_item_count: 4,
  ...m,
});

describe('evaluateTier3Budget', () => {
  it('OK when well within budget', () => {
    const r = evaluateTier3Budget(budget({}), 10);            // 10 × 85k = 850k of 8.5M
    expect(r.flag).toBe('OK');
  });

  it('WARNING past 80% of budget', () => {
    const r = evaluateTier3Budget(budget({ committed_rupiah: 6_500_000 }), 10); // 6.5M+850k=7.35M = 86%
    expect(r.flag).toBe('WARNING');
  });

  it('HIGH past 100% of budget', () => {
    const r = evaluateTier3Budget(budget({ committed_rupiah: 8_000_000 }), 10); // 8.85M = 104%
    expect(r.flag).toBe('HIGH');
  });

  it('CRITICAL past 120% of budget', () => {
    const r = evaluateTier3Budget(budget({ committed_rupiah: 10_000_000 }), 10); // 10.85M = 127%
    expect(r.flag).toBe('CRITICAL');
  });

  it('uses actual price override instead of benchmark', () => {
    const r = evaluateTier3Budget(budget({}), 10, 1_000_000); // 10 × 1M = 10M > 8.5M
    expect(r.flag).toBe('CRITICAL');
  });

  it('blocks (WARNING) when no price-book row at all', () => {
    const r = evaluateTier3Budget(null, 10);
    expect(r.flag).toBe('WARNING');
    expect(r.check).toBe('tier3_no_budget');
  });

  it('blocks (WARNING) when benchmark price is missing and no override given', () => {
    const r = evaluateTier3Budget(budget({ benchmark_unit_price: null, budget_total_rupiah: null }), 10);
    expect(r.flag).toBe('WARNING');
    expect(r.check).toBe('tier3_no_benchmark');
  });
});

describe('evaluateTier4Untracked', () => {
  it('always OK', () => {
    expect(evaluateTier4Untracked().flag).toBe('OK');
    expect(evaluateTier4Untracked().check).toBe('tier4_untracked');
  });
});
