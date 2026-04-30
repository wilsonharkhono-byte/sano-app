import type { RebarAdapter } from '../types';

export const balokSloofAdapter: RebarAdapter = {
  name: 'balokSloof',
  sheetName: 'REKAP Balok',
  prefixPattern: /^(?:Sloof|Balok)\s+(.+)$/i,
  lookupBreakdown() {
    return null;        // implemented in Task 3
  },
};
