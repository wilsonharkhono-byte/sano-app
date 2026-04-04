import type { PurchaseOrder, Material, GateResult, FlagLevel } from '../../tools/types';

interface ReceiptTotals {
  total_received: number;
  total_planned: number;
  unit: string;
}

export function computeGate3Flag(
  po: PurchaseOrder,
  actualQty: number,
  material: Material | null,
  receiptTotals: ReceiptTotals | null,
): GateResult {
  const diff = actualQty - po.quantity;
  const pctDiff = po.quantity > 0 ? (diff / po.quantity) * 100 : 0;
  const tier = material?.tier ?? 1;
  const tolerance = tier === 1 ? 0 : 10;

  let check3a: GateResult;
  if (Math.abs(pctDiff) <= tolerance) {
    check3a = { flag: 'OK', check: '3a', msg: `Kuantitas sesuai PO dalam toleransi Tier ${tier} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%).` };
  } else if (actualQty < po.quantity) {
    check3a = { flag: 'WARNING', check: '3a', msg: `Diterima ${actualQty} ${po.unit} vs PO ${po.quantity} ${po.unit}. Konfirmasi parsial.` };
  } else {
    check3a = { flag: 'CRITICAL', check: '3a', msg: `Diterima ${actualQty} ${po.unit} melebihi PO ${po.quantity} ${po.unit} (+${pctDiff.toFixed(1)}%).` };
  }

  // Check 3d — Accumulation
  if (receiptTotals) {
    const afterThis = receiptTotals.total_received + actualQty;
    const pctTotal = (afterThis / receiptTotals.total_planned) * 100;
    if (pctTotal >= 100) {
      check3a.extra = { flag: 'WARNING', check: '3d', msg: `Akumulasi: ${afterThis.toFixed(1)} / ${receiptTotals.total_planned} ${receiptTotals.unit} (${pctTotal.toFixed(0)}%). Total ≥100%.` };
    } else if (pctTotal >= 85) {
      check3a.extra = { flag: 'INFO', check: '3d', msg: `Akumulasi: ${afterThis.toFixed(1)} / ${receiptTotals.total_planned} ${receiptTotals.unit} (${pctTotal.toFixed(0)}%). Mendekati batas.` };
    }
  }

  return check3a;
}
