import type { ImportStagingRow } from './types';

export interface ReviewGroup {
  key: string;
  label: string;
  rows: ImportStagingRow[];
  batchable: boolean;
}

export interface ParentBlockSubGroup {
  title: string;
  rows: ImportStagingRow[];
}

export const FLAG_GROUP_LABELS: Record<string, string> = {
  orphan_ahs_block: 'Blok harga tidak dipakai BoQ',
  literal_component: 'Komponen angka langsung (tanpa rumus)',
  __other__: 'Lainnya',
};

// Optional one-line explanation rendered under a group header. Only the
// batchable orphan group benefits from up-front context.
export const FLAG_GROUP_HINTS: Record<string, string> = {
  orphan_ahs_block: 'Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.',
};

// Fixed top-level order; only `orphan_ahs_block` supports batch actions.
const GROUP_ORDER = ['orphan_ahs_block', 'literal_component', '__other__'] as const;
const BATCHABLE = new Set<string>(['orphan_ahs_block']);

function reasonKey(row: ImportStagingRow): string {
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const fr = raw.flag_reason;
  if (fr === 'orphan_ahs_block' || fr === 'literal_component') return fr;
  return '__other__';
}

/** Bucket flagged rows by flag_reason into ordered groups; empty groups omitted. */
export function groupReviewRows(rows: ImportStagingRow[]): ReviewGroup[] {
  const buckets: Record<string, ImportStagingRow[]> = {
    orphan_ahs_block: [],
    literal_component: [],
    __other__: [],
  };
  for (const r of rows) buckets[reasonKey(r)].push(r);
  return GROUP_ORDER.filter(k => buckets[k].length > 0).map(k => ({
    key: k,
    label: FLAG_GROUP_LABELS[k],
    rows: buckets[k],
    batchable: BATCHABLE.has(k),
  }));
}

/** Sub-group component rows by their parent AHS block title, order-preserving. */
export function subGroupByParentBlock(rows: ImportStagingRow[]): ParentBlockSubGroup[] {
  const order: string[] = [];
  const map = new Map<string, ImportStagingRow[]>();
  for (const r of rows) {
    const raw = (r.raw_data ?? {}) as Record<string, unknown>;
    const title = typeof raw.blockTitle === 'string' && raw.blockTitle.length > 0
      ? raw.blockTitle
      : 'Tanpa nama blok';
    if (!map.has(title)) { map.set(title, []); order.push(title); }
    map.get(title)!.push(r);
  }
  return order.map(title => ({ title, rows: map.get(title)! }));
}

/** Ids of the rows still awaiting a decision (used as batch targets). */
export function pendingRowIds(rows: ImportStagingRow[]): string[] {
  return rows.filter(r => r.review_status === 'PENDING').map(r => r.id);
}
