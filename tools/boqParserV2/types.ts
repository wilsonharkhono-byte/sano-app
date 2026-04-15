// v2-only types for the new BoQ parser. All interfaces additive — no
// existing v1 types are changed. See spec Section 1.

export type CostBasis =
  | 'catalog'
  | 'nested_ahs'
  | 'literal'
  | 'takeoff_ref'
  | 'cross_ref';

export interface CellRef {
  sheet: string;
  cell: string;         // e.g. "I199"
  cached_value: number | string | null;
}

export interface RefCells {
  unit_price?: CellRef;
  material_cost?: CellRef;
  labor_cost?: CellRef;
  equipment_cost?: CellRef;
  quantity?: CellRef[];
}

export interface CostSplit {
  material: number;
  labor: number;
  equipment: number;
}

export interface HarvestedCell {
  sheet: string;
  address: string;      // "I199"
  row: number;
  col: number;
  value: unknown;       // exceljs computed result
  formula: string | null;
}

export type HarvestLookup = Map<string, HarvestedCell>;
// key format: `${sheet}!${address}` e.g. "Analisa!I199"

export interface ValidationReport {
  blocks: Array<{
    block_title: string;
    status: 'ok' | 'imbalanced';
    expected: number;
    actual: number;
    delta: number;
  }>;
  generated_at: string;
}

export interface StagingRowV2 {
  row_type: 'boq' | 'ahs' | 'ahs_block' | 'material';
  row_number: number;
  raw_data: Record<string, unknown>;
  parsed_data: Record<string, unknown>;
  needs_review: boolean;
  confidence: number;
  review_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  cost_basis: CostBasis | null;
  parent_ahs_staging_id: string | null;
  ref_cells: RefCells | null;
  cost_split: CostSplit | null;
}
