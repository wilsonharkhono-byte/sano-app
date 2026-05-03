// Mock supabase to prevent react-native-url-polyfill ESM import in Jest
jest.mock('../../../../tools/supabase', () => ({
  supabase: {},
}));

import { mergeEnvelopeWithBaselinePrice } from '../../../../tools/envelopes';
import type { MaterialEnvelopeStatus } from '../../../../tools/types';
import type { MaterialBaselinePriceSummary } from '../../../../workflows/gates/gate2';

// Smoke test for the data flow ApprovalsScreen → MaterialUsagePanel
// without booting the React tree. We verify the helper produces the
// shape the component reads.
describe('Material usage data flow', () => {
  const env: MaterialEnvelopeStatus = {
    material_id: 'mat-bata',
    project_id: 'proj-1',
    material_code: 'AAC-BL07',
    material_name: 'Bata ringan 7.5 cm',
    tier: 2,
    unit: 'pcs',
    total_planned: 5000,
    total_ordered: 200,
    total_received: 0,
    remaining_to_order: 4800,
    burn_pct: 4,
    boq_item_count: 8,
  };

  const price: MaterialBaselinePriceSummary = {
    material_id: 'mat-bata',
    baseline_unit_price: 6000,
    min_unit_price: 5800,
    max_unit_price: 6200,
    sample_count: 3,
    spread_pct: 6.7,
  };

  it('produces shape compatible with MaterialUsagePanel.envelope prop', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env, price);
    // Required fields read by Tier 2 render
    expect(typeof merged.total_ordered).toBe('number');
    expect(typeof merged.total_planned).toBe('number');
    expect(typeof merged.remaining_to_order).toBe('number');
    expect(typeof merged.burn_pct).toBe('number');
    expect(typeof merged.unit).toBe('string');
    expect(typeof merged.boq_item_count).toBe('number');
    // Required fields read by Rupiah block
    expect(typeof merged.envelope_total_rupiah).toBe('number');
    expect(typeof merged.envelope_used_rupiah).toBe('number');
    expect(typeof merged.envelope_remaining_rupiah).toBe('number');
    // Required field read by Tier 3 render
    expect(typeof merged.baseline_unit_price).toBe('number');
  });

  it('handles missing baseline price without crashing the component contract', () => {
    const merged = mergeEnvelopeWithBaselinePrice(env, null);
    expect(merged.baseline_unit_price).toBeNull();
    expect(merged.envelope_total_rupiah).toBeNull();
    // All envelope quantity fields still present
    expect(merged.total_ordered).toBe(200);
  });
});
