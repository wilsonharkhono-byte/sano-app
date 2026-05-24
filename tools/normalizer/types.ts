export type BlockType = 'bekisting' | 'pembesian' | 'concrete';
export type RatioBasis = 'per_m2_form_per_cycle' | 'per_kg_finished_rebar' | 'per_m3_concrete';

export interface BlockSubItem {
  materialName: string;
  specNote: string | null;
  qtyPerNativeUnit: number;
  nativeUnit: string;
  unitPrice: number;
  includedInRolledUpTotal: boolean;
}

export interface BlockSchema {
  blockId: string;                       // e.g. "Analisa!F55"
  blockType: BlockType;
  elementHint: string | null;            // "Balok", "Plat", "Sloof", "Kolom", "Dinding"
  subItems: BlockSubItem[];
  cycleFactor: number | null;            // bekisting only
  ratioBasis: RatioBasis;
  rolledUpTotalPerNativeUnit: number;    // for reconciliation
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

export interface RebarDiameterWeight {
  diameter: string;                       // "D8", "D13"
  qtyPerBoqUnit: number;                  // kg / m³ beton
}

export interface RowExpansionInput {
  boqCode: string;
  description: string;
  unit: string;
  volume: number;
  sourceUnitCost: number;
  sourceLineTotal: number;
  bekistingSchema: BlockSchema | null;
  bekistingRatioPerM3: number | null;     // from RAB!V{row}
  pembesianSchema: BlockSchema | null;
  pembesianKgPerM3: number | null;        // from RAB!Z{row}
  pembesianDiameters: RebarDiameterWeight[];  // from REKAP Balok etc.
  concreteSchema: BlockSchema | null;
}
