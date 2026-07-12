// Task 0.6 — Receipt Log & Material Balance report-surface price redaction.
// Supervisors must never see unit_price / total-value / Rp budget fields in
// generated report payloads (and therefore never in the excel/pdf exports
// that render those payloads). Estimator/admin/principal see everything,
// byte-identical to before. Missing viewerRole fails closed (redacted).

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../derivation', () => ({
  deriveMaterialBalanceWithControl: jest.fn(),
  derivePoReceivedTotals: jest.fn(),
  deriveBoqInstalledTotals: jest.fn(),
}));
jest.mock('../purchaseOrders', () => ({
  getPurchaseOrderDisplayNumber: jest.fn((po: { po_number?: string | null; id?: string | null }) => po.po_number ?? `PO-${po.id}`),
}));
jest.mock('../storage', () => ({
  resolvePhotoUrl: jest.fn(async (p: string) => `https://cdn/${p}`),
}));
jest.mock('../siteChanges', () => ({
  CHANGE_TYPE_LABELS: {}, COST_BEARER_LABELS: {}, DECISION_LABELS: {}, IMPACT_LABELS: {},
}));
// Task 2.13 — generateMaterialBalanceReport joins Signal-2 drift for office
// viewers via getMaterialDrift (tools/envelopes.ts). Mocked at the module
// boundary like the sibling data-source mocks above, so these redaction tests
// don't need to know getMaterialDrift's own supabase plumbing.
jest.mock('../envelopes', () => ({
  getMaterialDrift: jest.fn(),
}));

import { generateMaterialBalanceReport, generateReceiptLog } from '../reports';
import type { MaterialBalanceData, ReceiptLogData } from '../reportDataTypes';
import { supabase } from '../supabase';
import { deriveMaterialBalanceWithControl, derivePoReceivedTotals } from '../derivation';
import { getMaterialDrift } from '../envelopes';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;
const mockDeriveBalance = deriveMaterialBalanceWithControl as jest.Mock;
const mockDerivePoTotals = derivePoReceivedTotals as jest.Mock;
const mockGetMaterialDrift = getMaterialDrift as jest.Mock;

describe('generateMaterialBalanceReport — supervisor price redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeriveBalance.mockResolvedValue([
      {
        material_name: 'Semen', material_id: 'm1', planned: 100, received: 40, installed: 20, on_site: 20, unit: 'sak',
        tier: 3, control: 'RP', benchmark_unit_price: 65000, budget_total_rupiah: 6_500_000, committed_rupiah: 2_600_000,
        burn_pct: 40, flag: 'OK',
      },
    ]);
    mockGetMaterialDrift.mockResolvedValue([
      { material_id: 'm1', material_name: 'Semen', unit: 'sak', baseline_planned_qty: 80, current_planned_qty: 100, drift_pct: 0.25 },
    ]);
  });

  it('estimator sees Rp budget fields', async () => {
    const payload = await generateMaterialBalanceReport('proj-1', { viewerRole: 'estimator' });
    const data = payload.data as MaterialBalanceData;
    expect(data.show_costs).toBe(true);
    const row = data.balances[0] as any;
    expect(row.budget_total_rupiah).toBe(6_500_000);
    expect(row.committed_rupiah).toBe(2_600_000);
    expect(row.benchmark_unit_price).toBe(65000);
  });

  it('estimator sees Signal-2 drift_pct joined from getMaterialDrift', async () => {
    const payload = await generateMaterialBalanceReport('proj-1', { viewerRole: 'estimator' });
    const data = payload.data as MaterialBalanceData;
    const row = data.balances[0] as any;
    expect(row.drift_pct).toBe(0.25);
    expect(row.baseline_planned_qty).toBe(80);
    expect(mockGetMaterialDrift).toHaveBeenCalledWith('proj-1');
  });

  it('supervisor gets no Rp budget fields (keys omitted, not nulled)', async () => {
    const payload = await generateMaterialBalanceReport('proj-1', { viewerRole: 'supervisor' });
    const data = payload.data as MaterialBalanceData;
    expect(data.show_costs).toBe(false);
    const row = data.balances[0] as any;
    expect('budget_total_rupiah' in row).toBe(false);
    expect('committed_rupiah' in row).toBe(false);
    expect('benchmark_unit_price' in row).toBe(false);
    // non-price fields survive untouched
    expect(row.material_name).toBe('Semen');
    expect(row.control).toBe('RP');
    expect(row.planned).toBe(100);
  });

  it('supervisor gets no drift_pct either — badge lives in Permintaan, not this report', async () => {
    const payload = await generateMaterialBalanceReport('proj-1', { viewerRole: 'supervisor' });
    const data = payload.data as MaterialBalanceData;
    const row = data.balances[0] as any;
    expect('drift_pct' in row).toBe(false);
    expect(mockGetMaterialDrift).not.toHaveBeenCalled();
  });

  it('missing viewerRole fails closed (treated as supervisor)', async () => {
    const payload = await generateMaterialBalanceReport('proj-1', {});
    const data = payload.data as MaterialBalanceData;
    expect(data.show_costs).toBe(false);
    expect('budget_total_rupiah' in (data.balances[0] as any)).toBe(false);
  });

  it('no options object at all also fails closed', async () => {
    const payload = await generateMaterialBalanceReport('proj-1');
    const data = payload.data as MaterialBalanceData;
    expect(data.show_costs).toBe(false);
  });
});

describe('generateReceiptLog — supervisor price redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDerivePoTotals.mockResolvedValue([
      { po_id: 'po-1', total_received: 5, receipt_count: 1, last_receipt_at: '2026-07-01' },
    ]);
    const chains: Record<string, any> = {
      purchase_orders: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [{
            id: 'po-1', project_id: 'proj-1', po_number: 'PO-0001', boq_ref: 'III.A.1', supplier: 'Toko Jaya',
            material_name: 'Semen', quantity: 10, unit: 'sak', unit_price: 65000, status: 'PARTIAL_RECEIVED',
            ordered_date: '2026-06-01', flag: 'OK',
          }],
          error: null,
        }),
      },
      receipts: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      },
    };
    (mockSupabase.from as jest.Mock).mockImplementation((table: string) => chains[table]);
  });

  it('estimator sees unit_price on entries', async () => {
    const payload = await generateReceiptLog('proj-1', { viewerRole: 'estimator' });
    const data = payload.data as ReceiptLogData;
    expect(data.show_costs).toBe(true);
    expect(data.entries[0].unit_price).toBe(65000);
  });

  it('supervisor entries have no unit_price / total-value keys', async () => {
    const payload = await generateReceiptLog('proj-1', { viewerRole: 'supervisor' });
    const data = payload.data as ReceiptLogData;
    expect(data.show_costs).toBe(false);
    const entry = data.entries[0] as any;
    expect('unit_price' in entry).toBe(false);
    expect('total_value' in entry).toBe(false);
    // non-price fields survive
    expect(entry.material).toBe('Semen');
    expect(entry.po_number).toBe('PO-0001');
  });

  it('missing viewerRole fails closed (treated as supervisor)', async () => {
    const payload = await generateReceiptLog('proj-1', {});
    const data = payload.data as ReceiptLogData;
    expect(data.show_costs).toBe(false);
    expect('unit_price' in (data.entries[0] as any)).toBe(false);
  });

  it('no options object at all also fails closed', async () => {
    const payload = await generateReceiptLog('proj-1');
    const data = payload.data as ReceiptLogData;
    expect(data.show_costs).toBe(false);
  });
});
