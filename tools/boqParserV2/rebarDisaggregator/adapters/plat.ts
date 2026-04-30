import type { RebarAdapter } from '../types';

export const platAdapter: RebarAdapter = {
  name: 'plat',
  sheetName: 'REKAP Plat',
  prefixPattern: /^Plat\s+(.+)$/i,
  lookupBreakdown() {
    return null;        // implemented in Task 5
  },
};
