// v2-only types for the new BoQ parser. All interfaces additive — no
// existing v1 types are changed. See spec Section 1.

export type CostBasis =
  | 'catalog'
  | 'nested_ahs'
  | 'literal'
  | 'takeoff_ref'
  | 'cross_ref'
  // BoQ-row only: the workbook already carries a cached per-unit cost
  // split (Material / Upah / Peralatan / Subkon columns) on the BoQ row
  // itself. No AHS-component traversal needed to compute the cost — the
  // row is self-contained for display purposes.
  | 'inline_split';

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
  prelim: number;
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

export interface RecipeComponent {
  sourceCell: { sheet: string; address: string };
  referencedCell: { sheet: string; address: string };
  referencedBlockTitle: string | null;
  referencedBlockRow: number | null;
  quantityPerUnit: number;
  unitPrice: number;
  costContribution: number;
  lineType: 'material' | 'labor' | 'equipment' | 'subkon' | 'prelim';
  confidence: number;
  // Optional: populated by rebar disaggregator post-pass for components
  // produced from REKAP Balok / REKAP-PC / REKAP Plat / Hasil-Kolom.
  materialName?: string;          // e.g. "Besi D8"
  disaggregatedFrom?: string;     // e.g. "Pembesian U24 & U40"
  role?: 'stirrup' | 'main';      // Kolom-only; null for other adapters
}

export interface Markup {
  factor: number;
  sourceCell: { sheet: string; address: string };
  sourceLabel: string | null;
}

export interface BoqRowRecipe {
  perUnit: CostSplit;
  subkonPerUnit: number;
  components: RecipeComponent[];
  markup: Markup | null;
  totalCached: number;
}
