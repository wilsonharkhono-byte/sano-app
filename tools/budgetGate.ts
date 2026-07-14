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

/**
 * Request-time (soft) Tier-3 budget check — Task 2.4 / spec §3.
 *
 * Wraps evaluateTier3Budget WITHOUT modifying it: the uncapped evaluator stays
 * byte-matched to the server twin compute_tier3_flag (048), which the migration
 * 069 tier-3 function re-caps to WARNING itself. This wrapper is the CLIENT twin
 * of that cap. HIGH/CRITICAL (over budget) collapse to WARNING with escalating
 * copy; request time never hard-blocks on budget. When the budget IS evaluable
 * and the projected burn crosses 100%, the result carries `.overage` (Rp grain)
 * so PermintaanScreen requires a reason before submit.
 */
export function evaluateTier3BudgetSoft(
  budget: MaterialBudgetStatus | null,
  requestedQty: number,
  actualUnitPrice?: number,
): GateResult {
  const base = evaluateTier3Budget(budget, requestedQty, actualUnitPrice);

  // Compute the Rp burn % when the budget is fully evaluable (mirrors the
  // evaluator's own guards). Missing budget/benchmark/zero-total stay as the
  // evaluator's WARNING — a can't-evaluate caution, not an over-total.
  const effectivePrice = budget ? (actualUnitPrice ?? budget.benchmark_unit_price ?? null) : null;
  const evaluable = !!budget && effectivePrice !== null
    && !!budget.budget_total_rupiah && budget.budget_total_rupiah > 0;

  if (!evaluable) {
    return capToWarning(base);
  }

  const b = budget as MaterialBudgetStatus;
  const thisOrder = requestedQty * (effectivePrice as number);
  const projectedPct = ((b.committed_rupiah + thisOrder) / (b.budget_total_rupiah as number)) * 100;

  const capped = capToWarning(base);
  return {
    ...capped,
    overage: {
      grainLabel: 'Proyek (anggaran)',
      poOrdered: null,
      otherOpen: b.committed_rupiah,
      thisRequest: thisOrder,
      planned: b.budget_total_rupiah as number,
      projectedPct,
      unit: 'Rp',
    },
  };
}

/** Collapse HIGH/CRITICAL to WARNING with escalating copy; pass INFO/OK/WARNING. */
function capToWarning(r: GateResult): GateResult {
  if (r.flag !== 'HIGH' && r.flag !== 'CRITICAL') return r;
  const escalate = r.flag === 'CRITICAL' ? ' Jauh melebihi anggaran.' : ' Melebihi anggaran.';
  // Strip any principal-override promise from the uncapped copy — request time
  // no longer hard-holds on budget (approval is the control point).
  const msg = r.msg.replace(/\s*Requires principal override\.?/i, '').trimEnd();
  return { ...r, flag: 'WARNING', msg: msg + escalate };
}

/** Tier 4: consumables — never gated, always passes. */
export function evaluateTier4Untracked(): GateResult {
  return { flag: 'OK', check: 'tier4_untracked', msg: 'Tier 4 consumable — not budget-tracked.' };
}
