import type { HarvestedCell } from '../types';

export interface RebarBreakdown {
  diameter: string;        // "D8", "D10", "D13", "D16", "D19", "D22", "D25"
  weightKg: number;        // total kg for this BoQ row
  sourceCell: string;      // e.g. "REKAP Balok!M267"
  role?: 'stirrup' | 'main';   // Kolom only; undefined for others
}

export interface LookupHint {
  /**
   * REKAP row to read weights from, derived from the BoQ row's own column-Z
   * formula reference (e.g., `='REKAP Balok'!X291`). When set, the adapter
   * MUST use this exact row and skip its label search — this avoids picking
   * up the wrong floor's weights when a single type code (e.g., "B24-1")
   * appears multiple times in REKAP (one summary row per floor, as in the
   * ERNAWATI workbook).
   */
  rekapRow?: number;
}

export interface RebarAdapter {
  name: string;                        // for logging — "balokSloof" | "poer" | "plat" | "kolom"
  sheetName: string;
  prefixPattern: RegExp;               // matched against cleaned BoQ label; capture group 1 = typeCode
  lookupBreakdown(
    typeCode: string,
    cells: HarvestedCell[],
    hint?: LookupHint,
  ): RebarBreakdown[] | null;          // null = type code not found
}
