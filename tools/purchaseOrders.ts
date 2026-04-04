export function normalizeProjectCode(projectCode?: string | null) {
  const normalized = (projectCode ?? 'PRJ')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized || 'PRJ';
}

function parsePoSequence(poNumber?: string | null) {
  if (!poNumber) return null;
  const parts = poNumber.split('-');
  const last = parts[parts.length - 1];
  const parsed = Number.parseInt(last, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getNextPurchaseOrderNumber(
  projectCode: string | null | undefined,
  purchaseOrders: Array<{ po_number?: string | null }>,
) {
  const nextSequence = purchaseOrders.reduce((maxValue, order) => {
    const sequence = parsePoSequence(order.po_number);
    return sequence != null && sequence > maxValue ? sequence : maxValue;
  }, 0) + 1;

  return `PO-${normalizeProjectCode(projectCode)}-${String(nextSequence).padStart(3, '0')}`;
}

export function getPurchaseOrderDisplayNumber(po: { po_number?: string | null; id?: string | null }) {
  if (po.po_number) return po.po_number;
  const fallbackId = (po.id ?? '').replace(/-/g, '').slice(0, 6).toUpperCase();
  return fallbackId ? `PO-${fallbackId}` : 'PO';
}
