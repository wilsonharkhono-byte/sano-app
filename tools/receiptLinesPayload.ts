// Build the `p_lines` payload for the `submit_receipt_lines` RPC (migration 070,
// line-grain receiving). Each PO line the supervisor typed a quantity for becomes
// one receipt line, converted from its SUPPLIER input unit to the material's BASE
// unit before it leaves the client — receipts, envelopes, gates and PO totals are
// all base-unit (kg) math (see tools/materialUnitConversion.ts).
//
// Two invariants this enforces, both grounded in the DB schema and the truth
// contract:
//   1. Zero / blank / non-numeric / negative inputs are SKIPPED, never sent.
//      receipt_lines.quantity_actual carries CHECK (quantity_actual > 0)
//      (002:250), so a 0 would abort the whole atomic receipt; and an untouched
//      line simply means "nothing arrived for that line yet".
//   2. Conversion is per line, keyed off THAT line's factor — a multi-line PO can
//      mix a rebar line (batang→kg) with a cement line (1:1) in one receipt.
//
// The caller is responsible for requiring the result be non-empty (≥1 positive
// line) before submitting — this helper just reports what survived.

import { supplierToBase } from './materialUnitConversion';

export interface ReceiveLineDraft {
  /** The purchase_order_lines.id this receipt line settles, or null for a
   *  header-only/legacy PO synthesized as a single line (server stores NULL). */
  po_line_id: string | null;
  /** Catalog id for the envelope/balance join, or null when unresolved. */
  material_id: string | null;
  material_name: string;
  /** Raw string the supervisor typed, denominated in the line's input unit. */
  qtyInput: string;
  /** base_qty_per_supplier_unit for this line's material; null/0 ⇒ 1:1. */
  factor: number | null;
  /** The BASE (stored) unit recorded on the receipt line. */
  baseUnit: string;
}

export interface ReceiptLinePayload {
  po_line_id: string | null;
  material_id: string | null;
  material_name: string;
  /** Quantity in BASE units (already converted from the supplier input). */
  quantity: number;
  unit: string;
}

/**
 * Convert per-line drafts into the base-unit payload the RPC expects, dropping
 * every line whose typed quantity is not a strictly-positive number.
 */
export function buildReceiptLinesPayload(
  drafts: readonly ReceiveLineDraft[],
): ReceiptLinePayload[] {
  const out: ReceiptLinePayload[] = [];
  for (const d of drafts) {
    const raw = parseFloat(d.qtyInput);
    // Skip blank / non-numeric / zero / negative — see invariant (1) above.
    if (!Number.isFinite(raw) || raw <= 0) continue;
    out.push({
      po_line_id: d.po_line_id,
      material_id: d.material_id,
      material_name: d.material_name,
      quantity: supplierToBase(raw, d.factor),
      unit: d.baseUnit,
    });
  }
  return out;
}
