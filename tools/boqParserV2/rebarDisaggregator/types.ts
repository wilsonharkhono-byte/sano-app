import type { HarvestedCell } from '../types';

export interface RebarBreakdown {
  diameter: string;        // "D8", "D10", "D13", "D16", "D19", "D22", "D25"
  weightKg: number;        // total kg for this BoQ row
  sourceCell: string;      // e.g. "REKAP Balok!M267"
  role?: 'stirrup' | 'main';   // Kolom only; undefined for others
}

export interface RebarAdapter {
  name: string;                        // for logging — "balokSloof" | "poer" | "plat" | "kolom"
  sheetName: string;
  prefixPattern: RegExp;               // matched against cleaned BoQ label; capture group 1 = typeCode
  lookupBreakdown(
    typeCode: string,
    cells: HarvestedCell[],
  ): RebarBreakdown[] | null;          // null = type code not found
}
