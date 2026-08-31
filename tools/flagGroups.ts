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
  unrecognized_beton_grade: 'Mutu beton tidak dikenali',
  __other__: 'Lainnya',
};

// Optional one-line explanation rendered under a group header. Only the
// batchable orphan group benefits from up-front context.
export const FLAG_GROUP_HINTS: Record<string, string> = {
  orphan_ahs_block: 'Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.',
  unrecognized_beton_grade:
    'Nilai di kolom "Mutu Beton" tidak dikenali, jadi betonnya dicatat tanpa mutu dan tidak cocok ke katalog.',
};

// Fixed top-level order. The orphan-block and literal-component groups support
// batch actions (Setujui/Tolak semua) — they can hold dozens of rows each and
// the decision is reversible before publish, so one-by-one review is needless
// friction. `unrecognized_beton_grade` is deliberately NOT batchable: each row
// carries its own bad value and needs its own correction, so a blanket
// "Setujui semua" would rubber-stamp a batch of unresolved concrete. `__other__`
// stays per-row too (heterogeneous reasons).
const GROUP_ORDER = ['orphan_ahs_block', 'literal_component', 'unrecognized_beton_grade', '__other__'] as const;
const BATCHABLE = new Set<string>(['orphan_ahs_block', 'literal_component']);
// A Set (not an object) so prototype keys like "constructor" can't masquerade
// as a known reason.
const KNOWN_REASONS = new Set<string>(GROUP_ORDER.filter((k) => k !== '__other__'));

function reasonKey(row: ImportStagingRow): string {
  const raw = (row.raw_data ?? {}) as Record<string, unknown>;
  const fr = raw.flag_reason;
  return typeof fr === 'string' && KNOWN_REASONS.has(fr) ? fr : '__other__';
}

/** Bucket flagged rows by flag_reason into ordered groups; empty groups omitted. */
export function groupReviewRows(rows: ImportStagingRow[]): ReviewGroup[] {
  const buckets: Record<string, ImportStagingRow[]> = Object.fromEntries(
    GROUP_ORDER.map((k) => [k, [] as ImportStagingRow[]]),
  );
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
