import type { StagingRowV2, CostSplit } from './boqParserV2/types';

export function topoSortBlocks(stagingRows: StagingRowV2[]): StagingRowV2[] {
  const blocks = stagingRows.filter(r => r.row_type === 'ahs_block');
  const byRowNumber = new Map<number, StagingRowV2>();
  for (const b of blocks) byRowNumber.set(b.row_number, b);

  // Build adjacency: each block depends on whatever its components reference
  const deps = new Map<number, Set<number>>();
  for (const b of blocks) deps.set(b.row_number, new Set());

  // Which block does each component belong to? Track via order:
  // components immediately after an ahs_block belong to that block until
  // the next ahs_block.
  let currentBlockRow: number | null = null;
  for (const r of stagingRows) {
    if (r.row_type === 'ahs_block') {
      currentBlockRow = r.row_number;
      continue;
    }
    if (r.row_type === 'ahs' && currentBlockRow != null && r.parent_ahs_staging_id) {
      const match = /^block:(\d+)$/.exec(r.parent_ahs_staging_id);
      if (match) {
        const parentRow = Number(match[1]);
        deps.get(currentBlockRow)?.add(parentRow);
      }
    }
  }

  // Kahn's algorithm — produce a parents-first order
  const result: StagingRowV2[] = [];
  const inDegree = new Map<number, number>();
  for (const [row, ds] of deps) inDegree.set(row, ds.size);

  // Reverse the edge direction to get parents-first: we want blocks with
  // zero incoming deps processed first.
  const reverseAdjacency = new Map<number, Set<number>>();
  for (const b of blocks) reverseAdjacency.set(b.row_number, new Set());
  for (const [child, parents] of deps) {
    for (const parent of parents) {
      reverseAdjacency.get(parent)?.add(child);
    }
  }

  const queue: number[] = [];
  for (const [row, count] of inDegree) {
    if (count === 0) queue.push(row);
  }

  while (queue.length > 0) {
    const row = queue.shift()!;
    const block = byRowNumber.get(row);
    if (block) result.push(block);
    for (const child of reverseAdjacency.get(row) ?? []) {
      const newDeg = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return result;
}

export interface FlattenedLine {
  line_type: 'material' | 'labor' | 'equipment' | 'subkon';
  material_name: string;
  unit_price: number;
  coefficient: number;
  origin_parent_ahs_id: string | null;
}

function pd<T = unknown>(row: StagingRowV2, key: string, fallback: T): T {
  const v = (row.parsed_data as Record<string, unknown>)[key];
  return (v ?? fallback) as T;
}

export function flattenBlock(
  components: StagingRowV2[],
  parentCache: Map<number, FlattenedLine[]>,
): FlattenedLine[] {
  const out: FlattenedLine[] = [];
  for (const c of components) {
    const materialName = pd(c, 'material_name', '');
    const coefficient = pd(c, 'coefficient', 1) as number;
    const unitPriceRaw = pd(c, 'unit_price', 0) as number;

    switch (c.cost_basis) {
      case 'catalog':
      case 'takeoff_ref':
      case 'literal':
      case null: {
        const unitPrice =
          c.ref_cells?.unit_price?.cached_value != null
            ? Number(c.ref_cells.unit_price.cached_value)
            : unitPriceRaw;
        out.push({
          line_type: 'material',
          material_name: materialName,
          unit_price: unitPrice,
          coefficient,
          origin_parent_ahs_id: null,
        });
        break;
      }
      case 'cross_ref': {
        const split: CostSplit = c.cost_split ?? {
          material: 0,
          labor: 0,
          equipment: 0,
        };
        out.push({
          line_type: 'material',
          material_name: materialName,
          unit_price: split.material,
          coefficient,
          origin_parent_ahs_id: null,
        });
        out.push({
          line_type: 'labor',
          material_name: materialName,
          unit_price: split.labor,
          coefficient,
          origin_parent_ahs_id: null,
        });
        out.push({
          line_type: 'equipment',
          material_name: materialName,
          unit_price: split.equipment,
          coefficient,
          origin_parent_ahs_id: null,
        });
        break;
      }
      case 'nested_ahs': {
        const parentKey = c.parent_ahs_staging_id;
        const match = parentKey ? /^block:(\d+)$/.exec(parentKey) : null;
        const parentRowNumber = match ? Number(match[1]) : null;
        const parentLines =
          parentRowNumber != null ? parentCache.get(parentRowNumber) : null;
        if (parentLines) {
          for (const pl of parentLines) {
            out.push({
              ...pl,
              coefficient: pl.coefficient * coefficient,
              origin_parent_ahs_id: parentKey,
            });
          }
        }
        break;
      }
    }
  }
  return out;
}

import { supabase } from './supabase';

export async function publishBaselineV2(
  sessionId: string,
  projectId: string,
): Promise<{
  success: boolean;
  error?: string;
  boqCount?: number;
  ahsCount?: number;
  materialCount?: number;
}> {
  const { data: stagingRowsDB, error: fetchErr } = await supabase
    .from('import_staging_rows')
    .select('*')
    .eq('session_id', sessionId)
    .neq('review_status', 'REJECTED')
    .order('row_number', { ascending: true });

  if (fetchErr) return { success: false, error: fetchErr.message };
  if (!stagingRowsDB) return { success: false, error: 'No staging rows' };

  const rows = stagingRowsDB as unknown as StagingRowV2[];

  // Translate DB uuids into row_number keys for topological sort
  const blockRowNumberByUuid = new Map<string, number>();
  for (const r of rows) {
    if (r.row_type === 'ahs_block') {
      blockRowNumberByUuid.set(
        (r as unknown as { id: string }).id,
        r.row_number,
      );
    }
  }
  // Rewrite parent_ahs_staging_id from uuid form (DB) back to block:<row_number>
  // so topoSort + flatten can work on it.
  for (const r of rows) {
    if (r.cost_basis === 'nested_ahs' && r.parent_ahs_staging_id) {
      const parentUuid = r.parent_ahs_staging_id;
      const parentRow = blockRowNumberByUuid.get(parentUuid);
      if (parentRow != null) {
        r.parent_ahs_staging_id = `block:${parentRow}`;
      }
    }
  }

  const sortedBlocks = topoSortBlocks(rows);

  // Group components by their owning block (determined by staging row order)
  const componentsByBlock = new Map<number, StagingRowV2[]>();
  let currentBlockRow: number | null = null;
  for (const r of rows) {
    if (r.row_type === 'ahs_block') {
      currentBlockRow = r.row_number;
      componentsByBlock.set(currentBlockRow, []);
      continue;
    }
    if (r.row_type === 'ahs' && currentBlockRow != null) {
      componentsByBlock.get(currentBlockRow)?.push(r);
    }
  }

  // Flatten parents first — parent cache keyed by block row_number
  const parentCache = new Map<number, FlattenedLine[]>();
  for (const block of sortedBlocks) {
    const components = componentsByBlock.get(block.row_number) ?? [];
    parentCache.set(block.row_number, flattenBlock(components, parentCache));
  }

  // TODO: Write flattened lines into ahs_versions + ahs_lines + boq_items
  // using the same shape as v1 publishBaseline. This step is deferred to
  // Task 20 because it touches real DB tables.

  return {
    success: true,
    boqCount: rows.filter(r => r.row_type === 'boq').length,
    ahsCount: Array.from(parentCache.values()).reduce((n, arr) => n + arr.length, 0),
    materialCount: rows.filter(r => r.row_type === 'material').length,
  };
}
