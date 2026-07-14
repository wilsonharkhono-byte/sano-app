import { reconcileMaterials, type CatalogEntry } from '../excelParser';
import type { StagingRowV2 } from '../boqParserV2/types';

export interface OthersConflict {
  name: string;
  matched: boolean;
  fileTier: number | null;
  catalogTier: number | null;
  filePrice: number;
  kind: 'unmatched' | 'tier' | null;
}

interface OthersMaterial {
  name: string;
  tier: number | null;
  unit: string;
  volume: number;
  unitPrice: number;
}

/**
 * Compare each Others material's file-declared tier against the tier of the
 * catalog row it reconciles to. "File wins" per the spec, but the shared
 * catalog is never mutated here — mismatches are surfaced for the reviewer /
 * the later catalog cleanup. Unmatched materials are flagged too.
 */
export function detectOthersConflicts(
  anchorRow: StagingRowV2,
  catalog: CatalogEntry[],
  aliases: Map<string, string>,
): OthersConflict[] {
  const materials =
    (anchorRow.raw_data as { others_materials?: OthersMaterial[] }).others_materials ?? [];
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const out: OthersConflict[] = [];

  for (const m of materials) {
    const { resolved } = reconcileMaterials(
      [
        {
          rowNumber: 0,
          name: m.name,
          spec: null,
          unit: m.unit,
          unitPrice: m.unitPrice,
          resolvedCode: null,
          matchConfidence: 0,
        },
      ],
      catalog,
      aliases,
    );
    const hit = resolved[0];
    if (!hit || !hit.resolvedCode || hit.matchConfidence <= 0) {
      out.push({
        name: m.name,
        matched: false,
        fileTier: m.tier,
        catalogTier: null,
        filePrice: m.unitPrice,
        kind: 'unmatched',
      });
      continue;
    }
    const catalogTier = byCode.get(hit.resolvedCode)?.tier ?? null;
    if (m.tier != null && catalogTier != null && m.tier !== catalogTier) {
      out.push({
        name: m.name,
        matched: true,
        fileTier: m.tier,
        catalogTier,
        filePrice: m.unitPrice,
        kind: 'tier',
      });
    }
  }
  return out;
}

/** Mutate the anchor row: raise needs_review and attach the conflict list. */
export function flagOthersConflicts(anchorRow: StagingRowV2, conflicts: OthersConflict[]): void {
  if (conflicts.length === 0) return;
  anchorRow.needs_review = true;
  (anchorRow.raw_data as Record<string, unknown>).material_conflicts = conflicts;
}
