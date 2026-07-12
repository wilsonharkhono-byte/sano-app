// Task 0.6 — excel exporter must drop the price columns entirely (header AND
// cells) for supervisor-viewed receipt-log / material-balance payloads,
// driven by the single `show_costs` flag the builder in reports.ts sets.
// No mocking of our own code here: real SheetJS objects are built and read
// back, same as the app would produce.

import * as XLSX from 'xlsx';
import { buildReceiptLog, buildMaterialBalance } from '../excel';
import type { ReceiptLogData, MaterialBalanceData } from '../reportDataTypes';

function sheetHeader(wb: XLSX.WorkBook, sheetName: string): string[] {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  return (aoa[0] ?? []).map(String);
}

describe('excel.ts buildReceiptLog — supervisor redaction', () => {
  const baseEntry = {
    po_number: 'PO-0001', po_ref: 'III.A.1', supplier: 'Toko Jaya', material: 'Semen',
    ordered_qty: 10, received_qty: 5, receipt_count: 1, unit: 'sak', status: 'PARTIAL_RECEIVED',
    ordered_date: '2026-06-01', last_receipt: null,
  };

  it('estimator payload (show_costs=true) keeps Harga columns with values', () => {
    const wb = XLSX.utils.book_new();
    const data: ReceiptLogData = {
      total_pos: 1, fully_received: 0, show_costs: true,
      entries: [{ ...baseEntry, unit_price: 65000 }],
      receipts: [],
    };
    buildReceiptLog(wb, data);
    const header = sheetHeader(wb, 'Log Penerimaan');
    expect(header).toContain('Harga Satuan (Rp)');
    expect(header).toContain('Total Nilai (Rp)');
  });

  it('supervisor payload (show_costs=false) has no Harga column at all', () => {
    const wb = XLSX.utils.book_new();
    const data: ReceiptLogData = {
      total_pos: 1, fully_received: 0, show_costs: false,
      entries: [{ ...baseEntry }],
      receipts: [],
    };
    buildReceiptLog(wb, data);
    const header = sheetHeader(wb, 'Log Penerimaan');
    expect(header.some(h => h.includes('Harga'))).toBe(false);
    expect(header.some(h => h.includes('Nilai'))).toBe(false);
  });
});

describe('excel.ts buildMaterialBalance — supervisor redaction', () => {
  const baseRow = {
    material_name: 'Semen', unit: 'sak', planned: 100, received: 40, installed: 20, on_site: 20,
    tier: 3 as const, control: 'RP' as const, burn_pct: 40, flag: 'OK',
  };

  it('estimator payload (show_costs=true) keeps Anggaran/Terpakai columns', () => {
    const wb = XLSX.utils.book_new();
    const data: MaterialBalanceData = {
      total_materials: 1, over_received: 0, needs_procurement: 0, over_budget: 0, show_costs: true,
      balances: [{ ...baseRow, budget_total_rupiah: 6_500_000, committed_rupiah: 2_600_000 }],
    };
    buildMaterialBalance(wb, data);
    const header = sheetHeader(wb, 'Detail Material');
    expect(header).toContain('Anggaran (Rp)');
    expect(header).toContain('Terpakai (Rp)');
  });

  it('supervisor payload (show_costs=false) has no Anggaran/Terpakai column', () => {
    const wb = XLSX.utils.book_new();
    const data: MaterialBalanceData = {
      total_materials: 1, over_received: 0, needs_procurement: 0, over_budget: 0, show_costs: false,
      balances: [{ ...baseRow }],
    };
    buildMaterialBalance(wb, data);
    const header = sheetHeader(wb, 'Detail Material');
    expect(header.some(h => h.includes('Anggaran'))).toBe(false);
    expect(header.some(h => h.includes('Terpakai'))).toBe(false);
  });
});
