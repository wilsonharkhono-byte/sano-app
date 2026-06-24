// SANO — AHS price book ingestion. The price book is the price + tier authority.
// Format is fixed: columns material | unit | unit_price | tier. Rows missing a
// price or carrying an invalid tier go to `unresolved` — never guessed (CLAUDE.md §1.1).
import { supabase } from './supabase';

export interface PriceBookRecord {
  material_name: string;
  unit: string;
  unit_price: number;
  tier: 1 | 2 | 3 | 4;
}

export function mapPriceBookRows(
  rows: Record<string, unknown>[],
): { records: PriceBookRecord[]; unresolved: { row: number; reason: string }[] } {
  const records: PriceBookRecord[] = [];
  const unresolved: { row: number; reason: string }[] = [];

  rows.forEach((raw, i) => {
    const name = String(raw.material ?? '').trim();
    const unit = String(raw.unit ?? '').trim();
    const price = Number(raw.unit_price);
    const tier = Number(raw.tier);

    if (!name) { unresolved.push({ row: i, reason: 'missing material name' }); return; }
    if (!Number.isFinite(price) || price <= 0) { unresolved.push({ row: i, reason: `missing/invalid price for "${name}"` }); return; }
    if (![1, 2, 3, 4].includes(tier)) { unresolved.push({ row: i, reason: `tier out of range (1-4) for "${name}"` }); return; }

    records.push({ material_name: name, unit, unit_price: price, tier: tier as 1 | 2 | 3 | 4 });
  });

  return { records, unresolved };
}

/**
 * Replace the project's AHS price book with these records (delete-then-insert,
 * scoped to project_id), so re-ingesting a corrected book never appends
 * duplicates. material_id resolution against material_catalog (fuzzy) is
 * intentionally left to the catalog-link step that already exists for AHS
 * lines — here we persist by name + project; material_id is backfilled by
 * that linker. Returns count inserted.
 */
export async function ingestPriceBook(projectId: string, records: PriceBookRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const { error: deleteError } = await supabase
    .from('ahs_price_book')
    .delete()
    .eq('project_id', projectId);
  if (deleteError) throw deleteError;
  const { error } = await supabase
    .from('ahs_price_book')
    .insert(records.map(r => ({ project_id: projectId, ...r })));
  if (error) throw error;
  return records.length;
}
