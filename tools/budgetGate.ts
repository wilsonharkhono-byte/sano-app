// SANO — pure Tier-3 (Rupiah budget) and Tier-4 (untracked) gate evaluators.
// Kept pure (no supabase) so they unit-test without mocking, like
// mergeEnvelopeWithBaselinePrice. The fetch + dispatch wrappers live in envelopes.ts.
import type { GateResult, MaterialBudgetStatus } from './types';

const BUDGET_WARNING_PCT = 80;
const BUDGET_CRITICAL_PCT = 100;
const BUDGET_CRITICAL_SPREAD = 20;

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/**
 * Tier 3: order × price vs the material's Rupiah budget envelope.
 * Deplete-at-order: committed already reflects placed orders; this adds the
 * prospective order. actualUnitPrice (if the admin entered one) overrides the
 * benchmark for THIS order. No benchmark and no override => blocking, never a pass.
 */
export function evaluateTier3Budget(
  budget: MaterialBudgetStatus | null,
  requestedQty: number,
  actualUnitPrice?: number,
): GateResult {
  if (!budget) {
    return { flag: 'WARNING', check: 'tier3_no_budget', msg: 'No budget envelope — material not in AHS price book. Cannot evaluate Tier 3 spend.' };
  }

  const effectivePrice = actualUnitPrice ?? budget.benchmark_unit_price ?? null;
  if (effectivePrice === null) {
    return { flag: 'WARNING', check: 'tier3_no_benchmark', msg: `No benchmark price for ${budget.material_name}. Cannot evaluate Tier 3 budget — enter an actual price or set the AHS price.` };
  }
  if (!budget.budget_total_rupiah || budget.budget_total_rupiah <= 0) {
    return { flag: 'WARNING', check: 'tier3_zero_budget', msg: `${budget.material_name} is in the price book but has zero planned quantity — budget total is 0. Cannot evaluate Tier 3 spend.` };
  }

  const thisOrder = requestedQty * effectivePrice;
  const newCommitted = budget.committed_rupiah + thisOrder;
  const newBurn = (newCommitted / budget.budget_total_rupiah) * 100;
  const detail = `${rp(newCommitted)} / ${rp(budget.budget_total_rupiah)} (${newBurn.toFixed(0)}%)`;

  if (newBurn > BUDGET_CRITICAL_PCT + BUDGET_CRITICAL_SPREAD) {
    return { flag: 'CRITICAL', check: 'tier3_budget_exceeded', msg: `Order of ${rp(thisOrder)} pushes ${budget.material_name} to ${detail} — exceeds budget by ${(newBurn - 100).toFixed(0)}%. Requires principal override.` };
  }
  if (newBurn > BUDGET_CRITICAL_PCT) {
    return { flag: 'HIGH', check: 'tier3_budget_over', msg: `Order pushes ${budget.material_name} to ${detail} — over budget.` };
  }
  if (newBurn > BUDGET_WARNING_PCT) {
    return { flag: 'WARNING', check: 'tier3_budget_warning', msg: `${budget.material_name} budget at ${detail} after this order — approaching limit.` };
  }
  if (newBurn > 50) {
    return { flag: 'INFO', check: 'tier3_budget_info', msg: `${budget.material_name}: ${detail} of budget used.` };
  }
  return { flag: 'OK', check: 'tier3_budget_ok', msg: `${budget.material_name}: ${detail} of budget.` };
}

/** Tier 4: consumables — never gated, always passes. */
export function evaluateTier4Untracked(): GateResult {
  return { flag: 'OK', check: 'tier4_untracked', msg: 'Tier 4 consumable — not budget-tracked.' };
}
