jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { buildMaterialBalanceRows } from '../derivation';
import type { MaterialBalance } from '../derivation';
import type { MaterialBudgetStatus } from '../types';

const bal = (m: Partial<MaterialBalance>): MaterialBalance => ({
  material_name: 'X', material_id: 'm1', planned: 100, received: 10, installed: 0, on_site: 10, unit: 'kg', ...m,
});
const bud = (m: Partial<MaterialBudgetStatus>): MaterialBudgetStatus => ({
  material_id: 'm1', project_id: 'p1', material_name: 'X', tier: 3, unit: 'kg',
  benchmark_unit_price: 1000, total_planned: 100, budget_total_rupiah: 100_000,
  committed_rupiah: 0, remaining_rupiah: 100_000, burn_pct: 0, boq_item_count: 1, ...m,
});

describe('buildMaterialBalanceRows', () => {
  it('tier 3 → RP control, flag from Rupiah burn', () => {
    const [row] = buildMaterialBalanceRows([bal({})], [bud({ burn_pct: 105, budget_total_rupiah: 100_000 })]);
    expect(row.control).toBe('RP');
    expect(row.flag).toBe('HIGH');
    expect(row.budget_total_rupiah).toBe(100_000);
  });

  it('tier 1/2 → QTY control, flag from received/planned', () => {
    const [row] = buildMaterialBalanceRows([bal({ received: 96 })], [bud({ tier: 2 })]);
    expect(row.control).toBe('QTY');
    expect(row.burn_pct).toBe(96);
    expect(row.flag).toBe('WARNING');
  });

  it('tier 4 → NONE control, never flagged', () => {
    const [row] = buildMaterialBalanceRows([bal({ received: 9999 })], [bud({ tier: 4 })]);
    expect(row.control).toBe('NONE');
    expect(row.flag).toBe('OK');
    expect(row.burn_pct).toBeNull();
  });

  it('no budget row → QTY control by default', () => {
    const [row] = buildMaterialBalanceRows([bal({})], []);
    expect(row.control).toBe('QTY');
    expect(row.budget_total_rupiah).toBeNull();
  });
});
