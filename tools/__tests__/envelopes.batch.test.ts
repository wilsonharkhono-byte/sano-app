// Mock supabase to prevent react-native-url-polyfill ESM import in Jest
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { mergeEnvelopeWithBaselinePrice } from '../envelopes';
import type { MaterialEnvelopeStatus } from '../types';
import type { MaterialBaselinePriceSummary } from '../../workflows/gates/gate2';

describe('mergeEnvelopeWithBaselinePrice', () => {
  const env = (m: Partial<MaterialEnvelopeStatus>): MaterialEnvelopeStatus => ({
    material_id: 'mat-1',
    project_id: 'proj-1',
    material_code: 'CODE',
    material_name: 'Bata ringan 7.5 cm',
    tier: 2,
    unit: 'pcs',
    total_planned: 5000,
    total_ordered: 200,
    total_received: 0,
    remaining_to_order: 4800,
    burn_pct: 4,
    boq_item_count: 8,
    ...m,
  });

  const price = (m: Partial<MaterialBaselinePriceSummary>): MaterialBaselinePriceSummary => ({
    material_id: 'mat-1',
    baseline_unit_price: 6000,
    min_unit_price: 5800,
    max_unit_price: 6200,
    sample_count: 3,
    spread_pct: 6.7,
    ...m,
  });

  it('attaches baseline_unit_price when present', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env({}), price({ baseline_unit_price: 6000 }));
    expect(merged.baseline_unit_price).toBe(6000);
    expect(merged.envelope_total_rupiah).toBe(30_000_000);  // 5000 × 6000
    expect(merged.envelope_used_rupiah).toBe(1_200_000);    // 200 × 6000
    expect(merged.envelope_remaining_rupiah).toBe(28_800_000);
  });

  it('returns null Rupiah fields when baseline price is missing', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env({}), null);
    expect(merged.baseline_unit_price).toBeNull();
    expect(merged.envelope_total_rupiah).toBeNull();
    expect(merged.envelope_used_rupiah).toBeNull();
    expect(merged.envelope_remaining_rupiah).toBeNull();
  });

  it('returns null Rupiah fields when baseline price is zero or negative', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env({}), price({ baseline_unit_price: 0 }));
    expect(merged.envelope_total_rupiah).toBeNull();
  });

  it('preserves all envelope fields verbatim', () => {
    const e = env({ total_ordered: 999, burn_pct: 19.98 });
    const merged = mergeEnvelopeWithBaselinePrice(e, null);
    expect(merged.total_ordered).toBe(999);
    expect(merged.burn_pct).toBe(19.98);
    expect(merged.material_name).toBe('Bata ringan 7.5 cm');
  });
});
