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
