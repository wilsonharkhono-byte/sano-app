// tools/boqParserV2/breakdownSheetReader.types.ts
export type BreakdownGroup = 'material' | 'labor' | 'equipment';

export interface BreakdownRow {
  group: BreakdownGroup;
  componentGroup: string;          // raw label, e.g. "BEKISTING BALOK (Material) — ratio 10 m²"
  materialName: string;
  specNote: string | null;
  qtyPerNativeUnit: number;        // col E
  nativeUnit: string;              // col F
  nativeBasis: string | null;      // col G
  unitPrice: number;               // col H
  qtyPerBoqUnit: number;           // col I
  costPerBoqUnit: number;          // col J
  totalQty: number;                // col K
  totalCost: number;               // col L
}

export interface RowBreakdown {
  boqCode: string;
  description: string;
  unit: string;
  volume: number;
  unitCost: number;                // header row "Unit cost (Rp/{unit})"
  lineTotal: number;               // header row "Line total at-cost (Rp)"
  components: BreakdownRow[];
  reconciliation: {
    computedUnitCost: number;
    sourceUnitCost: number;
    unitCostVariance: number;
    computedLineTotal: number;
    sourceLineTotal: number;
    lineTotalVariance: number;
    reconciles: boolean;
  };
  sourceSheet: string;             // e.g. "Breakdown IV.A.2.7"
}

export interface ReaderWarning {
  sheet: string;
  code: 'MALFORMED_HEADER' | 'MALFORMED_COMPONENT_ROW' | 'COST_MISMATCH' | 'MISSING_RECONCILIATION';
  message: string;
}
