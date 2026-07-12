// Pure helpers for reasoning about a purchase order's lifecycle status.
//
// The storable statuses (must match purchase_orders.status CHECK, migration 072):
//   OPEN              — created, nothing received yet.
//   PARTIAL_RECEIVED  — at least one delivery, still short of the ordered qty.
//   FULLY_RECEIVED    — total received ≥ ordered qty.
//   CLOSED_SHORT      — TERMINAL. A short delivery declared "Terima Final".
//   CANCELLED         — TERMINAL. Admin cancelled an OPEN, receipt-free PO.
//
// Both CLOSED_SHORT and CANCELLED are terminal: no receive form, no reopen path
// in v1. Keep these predicates the single source of truth so the receive screen,
// the dashboards and any future reader agree on what "closed" / "open" means.

import { PO_STATUS_LABELS } from './constants';

type MaybeStatus = string | null | undefined;

/**
 * Terminal "closed" states that drop a PO out of the receivable list and out of
 * every open-PO count. A short-closed or cancelled PO can never be received
 * against again.
 */
export function isPoClosed(status: MaybeStatus): boolean {
  return status === 'CANCELLED' || status === 'CLOSED_SHORT';
}

/**
 * True when a receive form may still be opened for this PO — only OPEN and
 * PARTIAL_RECEIVED qualify. FULLY_RECEIVED, CANCELLED and CLOSED_SHORT are all
 * terminal for receiving and must close the form.
 */
export function isPoReceivable(status: MaybeStatus): boolean {
  return status === 'OPEN' || status === 'PARTIAL_RECEIVED';
}

/**
 * The dashboard "open PO / pending delivery" predicate — OPEN || PARTIAL_RECEIVED
 * (mirrors BerandaScreen + LaporanScreen). CLOSED_SHORT and CANCELLED are closed
 * and are deliberately excluded; FULLY_RECEIVED is done. Same set as isPoReceivable
 * today, kept as a distinct name so the dashboard intent reads clearly at call sites.
 */
export function isPoOpenForDelivery(status: MaybeStatus): boolean {
  return status === 'OPEN' || status === 'PARTIAL_RECEIVED';
}

/** Indonesian display label for a PO status; falls back to the raw code (or '' for null). */
export function poStatusLabel(status: MaybeStatus): string {
  if (!status) return '';
  return PO_STATUS_LABELS[status as keyof typeof PO_STATUS_LABELS] ?? status;
}
