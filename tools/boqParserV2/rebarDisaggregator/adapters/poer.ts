import type { RebarAdapter } from '../types';

export const poerAdapter: RebarAdapter = {
  name: 'poer',
  sheetName: 'REKAP-PC',
  prefixPattern: /^Poer\s+(.+)$/i,
  lookupBreakdown() {
    return null;        // implemented in Task 4
  },
};
