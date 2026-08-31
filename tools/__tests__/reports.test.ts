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

import { generateMaterialBalanceReport, generateReceiptLog, generateApprovalSLAUser } from '../reports';
import type { MaterialBalanceData, ReceiptLogData, ApprovalSLAData } from '../reportDataTypes';
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

describe('generateMaterialBalanceReport — needs_procurement summary count', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeriveBalance.mockResolvedValue([
      // genuinely short: 5% on-site, nothing on order → counts
      { material_name: 'Semen', material_id: 'm1', planned: 100, received: 60, installed: 55, on_site: 5, on_order: 0, unit: 'sak', tier: 3, control: 'RP', burn_pct: 40, flag: 'OK' },
      // short on-site but fully ordered → must NOT count (row Status says
      // "Sudah dipesan — menunggu kedatangan"; header must agree)
      { material_name: 'Besi D13', material_id: 'm2', planned: 100, received: 2, installed: 0, on_site: 2, on_order: 98, unit: 'kg', tier: 1, control: 'QTY', flag: 'OK' },
      // healthy stock → does not count
      { material_name: 'Pasir', material_id: 'm3', planned: 100, received: 90, installed: 10, on_site: 80, on_order: 0, unit: 'm3', tier: 3, control: 'RP', burn_pct: 20, flag: 'OK' },
    ]);
  });

  it('nets on_order against the shortage, matching the per-row Status column', async () => {
    const payload = await generateMaterialBalanceReport('proj-1', { viewerRole: 'supervisor' });
    const data = payload.data as MaterialBalanceData;
    expect(data.needs_procurement).toBe(1);
    expect(data.total_materials).toBe(3);
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

// Spec §5.5 — "Is a returned request still open demand?": yes, it is live
// work parked with the estimator, exactly like PENDING. The Approval SLA
// report's "Permintaan Material" queue counter must therefore count RETURNED
// rows the same way it counts PENDING/UNDER_REVIEW/AUTO_HOLD.
//
// RETURNED is not a fresh row, though: it can only be reached from APPROVED
// (migration 088 §5.2), which means the estimator's original reviewed_at is
// already set and 088 deliberately leaves reviewed_by/reviewed_at pointing at
// that original reviewer (design note in 088 §1 — the admin's return uses its
// own returned_by/returned_at pair, not reviewed_at). A naive `!row.reviewed_at
// && status IN (...)` filter would therefore silently drop every RETURNED row
// even after RETURNED is added to the status list, because reviewed_at is
// truthy. The fixture below pins a RETURNED row with reviewed_at already set
// to catch exactly that regression.
describe('generateApprovalSLAUser — RETURNED counts as outstanding (spec §5.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const requestRows = [
      { requested_by: 'u1', reviewed_by: null, created_at: '2026-08-01T00:00:00Z', reviewed_at: null, overall_status: 'PENDING' },
      { requested_by: 'u2', reviewed_by: null, created_at: '2026-08-01T00:00:00Z', reviewed_at: null, overall_status: 'UNDER_REVIEW' },
      { requested_by: 'u3', reviewed_by: null, created_at: '2026-08-01T00:00:00Z', reviewed_at: null, overall_status: 'AUTO_HOLD' },
      // Approved-then-returned: reviewed_at is already set (points at the
      // original estimator decision, per 088), yet this row is live work.
      { requested_by: 'u4', reviewed_by: null, created_at: '2026-08-01T00:00:00Z', reviewed_at: '2026-08-02T00:00:00Z', overall_status: 'RETURNED' },
      // Controls: genuinely resolved rows must NOT be counted.
      { requested_by: 'u5', reviewed_by: null, created_at: '2026-08-01T00:00:00Z', reviewed_at: '2026-08-02T00:00:00Z', overall_status: 'APPROVED' },
      { requested_by: 'u6', reviewed_by: null, created_at: '2026-08-01T00:00:00Z', reviewed_at: '2026-08-02T00:00:00Z', overall_status: 'REJECTED' },
    ];
    const emptyChain = () => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    const chains: Record<string, any> = {
      material_request_headers: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: requestRows, error: null }),
      },
      vo_entries: emptyChain(),
      mtn_requests: emptyChain(),
      approval_tasks: emptyChain(),
      opname_headers: emptyChain(),
      mandor_attendance: emptyChain(),
      mandor_kasbon: emptyChain(),
    };
    (mockSupabase.from as jest.Mock).mockImplementation((table: string) => chains[table]);
  });

  it('counts PENDING + UNDER_REVIEW + AUTO_HOLD + RETURNED in the "Permintaan Material" queue, excluding APPROVED/REJECTED', async () => {
    const payload = await generateApprovalSLAUser('proj-1');
    const data = payload.data as ApprovalSLAData;
    const queueItem = data.pending_by_queue.find(item => item.label === 'Permintaan Material');
    expect(queueItem?.count).toBe(4);
  });
});
