import type { RebarAdapter } from '../types';

export const kolomAdapter: RebarAdapter = {
  name: 'kolom',
  sheetName: 'Hasil-Kolom',
  prefixPattern: /^Kolom\s+(.+)$/i,
  lookupBreakdown() {
    return null;        // implemented in Task 6
  },
};
