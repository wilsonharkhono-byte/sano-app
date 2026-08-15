import {
  resolveTier2Allocations, buildTier2Allocations, buildTier2GeneralStockAllocation,
  type Tier2AllocationLine,
} from '../tier2Allocation';
import type { EnvelopeBoqBreakdown, MaterialEnvelopeStatus } from '../types';

const breakdownRow = (o: Partial<EnvelopeBoqBreakdown>): EnvelopeBoqBreakdown => ({
  boq_item_id: 'boq-1',
  boq_code: 'III.A.1',
  boq_label: 'Poer PC.1',
  planned_quantity: 100,
  pct_of_total: 100,
  ...o,
});

const envelope = (o: Partial<MaterialEnvelopeStatus>): MaterialEnvelopeStatus => ({
  material_id: 'mat-1',
  project_id: 'proj-1',
  material_code: null,
  material_name: 'Semen',
  tier: 2,
  unit: 'sak',
  total_planned: 500,
  total_ordered: 0,
  total_requested: 0,
  total_received: 0,
  remaining_to_order: 500,
  burn_pct: 0,
  boq_item_count: 0,
  ...o,
});

describe('buildTier2Allocations (per-BoQ breakdown, unchanged behavior)', () => {
  it('splits proportionally across breakdown rows', () => {
    const rows = [
      breakdownRow({ boq_item_id: 'a', planned_quantity: 75, pct_of_total: 75 }),
      breakdownRow({ boq_item_id: 'b', planned_quantity: 25, pct_of_total: 25 }),
    ];
    const result = buildTier2Allocations(rows, 100);
    expect(result).toHaveLength(2);
    expect(result[0].allocatedQuantity).toBe(75);
    expect(result[1].allocatedQuantity).toBe(25);
    expect(result.every((r: Tier2AllocationLine) => r.allocationBasis === 'TIER2_ENVELOPE')).toBe(true);
  });

  it('returns empty when there is no breakdown', () => {
    expect(buildTier2Allocations([], 100)).toEqual([]);
  });

  it('returns empty when requested qty is not positive', () => {
    expect(buildTier2Allocations([breakdownRow({})], 0)).toEqual([]);
  });
});

describe('buildTier2GeneralStockAllocation', () => {
  it('produces a single STOK line at 100%', () => {
    const result = buildTier2GeneralStockAllocation(42.5);
    expect(result).toEqual([{
      boqItemId: null,
      boqCode: 'STOK',
      boqLabel: 'Stok Umum',
      allocatedQuantity: 42.5,
      proportionPct: 100,
      allocationBasis: 'GENERAL_STOCK',
    }]);
  });
});

describe('resolveTier2Allocations — the Task B fallback', () => {
  it('prefers the per-BoQ breakdown when it exists (unchanged happy path)', () => {
    const rows = [breakdownRow({ boq_item_id: 'a', planned_quantity: 100, pct_of_total: 100 })];
    const result = resolveTier2Allocations(rows, envelope({}), 50);
    expect(result).toHaveLength(1);
    expect(result[0].allocationBasis).toBe('TIER2_ENVELOPE');
    expect(result[0].boqItemId).toBe('a');
  });

  it('falls back to GENERAL_STOCK when breakdown is empty but the project envelope has planned demand (the "Others" project-level master-line case)', () => {
    const result = resolveTier2Allocations([], envelope({ total_planned: 500 }), 50);
    expect(result).toEqual([{
      boqItemId: null,
      boqCode: 'STOK',
      boqLabel: 'Stok Umum',
      allocatedQuantity: 50,
      proportionPct: 100,
      allocationBasis: 'GENERAL_STOCK',
    }]);
  });

  it('stays empty (hard block preserved) when breakdown is empty AND envelope is null', () => {
    expect(resolveTier2Allocations([], null, 50)).toEqual([]);
  });

  it('stays empty (hard block preserved) when breakdown is empty AND envelope has zero planned', () => {
    expect(resolveTier2Allocations([], envelope({ total_planned: 0 }), 50)).toEqual([]);
  });

  it('stays empty (hard block preserved) when breakdown is empty AND envelope has negative/undefined planned', () => {
    expect(resolveTier2Allocations([], envelope({ total_planned: -1 }), 50)).toEqual([]);
  });

  it('does not fall back when requested qty is not positive, even with a healthy envelope', () => {
    expect(resolveTier2Allocations([], envelope({ total_planned: 500 }), 0)).toEqual([]);
  });
});
