import type { HarvestedCell } from '../../types';
import type { RebarAdapter, RebarBreakdown } from '../types';
import { detectDiameterHeader, findRowByLabel } from './headerDetect';

/**
 * REKAP-PC (pile cap rebar) layouts seen in the field:
 *
 *   AAL-5  header row 6 -> J=6, K=8, L=10, M=13, N=16, O=19, P=22, Q=25  (label in A)
 *   PD3-23 header row 6 -> J=6, K=8, L=10, M=13, N=16, O=19, P=22, Q=25  (label in A)
 *   I4-29  header row 6 -> K=6, L=8, M=10, N=13, O=16, P=19, Q=22, R=25  (label in A)
 *
 * The previous hardcoded mapping (H=D6, I=D8, ..., O=D25) was off-by-two
 * columns for AAL-5/PD3 (which use J..Q) and off-by-three for I4-29
 * (which uses K..R). The on-AAL-5 symptom of that bug was the
 * "Z vs diameter discrepancy of ~0.76 kg/m³" reported as bottleneck #4 in
 * the field guide: column I on AAL-5 REKAP-PC is "Lantai Kerja" (1.23 kg
 * for PC.1 at beton 1.62 m³ → 0.76 kg/m³), which the old adapter
 * incorrectly reported as the D8 weight. The remaining diameter
 * assignments were similarly off by 2 columns.
 *
 * Verification (AAL-5 PC.5 row 16):
 *   B16  = 1.7578 m³ (Beton volume)
 *   R16  = 148.97 kg (workbook's Total Besi)
 *   148.97 / 1.7578 = 84.749 kg/m³, which equals RAB(A)!Z59 exactly
 *   (the Poer PC.5 BoQ row's pembesian-kg-per-m³ column). With proper
 *   header detection, Σ(diameter weights) reconciles to Z by construction.
 *
 * As an extra safety belt, if the diameter sum (post-header-detection)
 * still disagrees with the BoQ row's RAB!Z column by more than the
 * `transformRecipe` tolerance, the disaggregator already routes that
 * row's "conservation_violation" warning to the caller; downstream the
 * itemized tier in cli-deterministic.ts falls back to rolled rather than
 * emit a wrong breakdown, per the truth-correctness contract.
 */

const SHEET = 'REKAP-PC';
const LABEL_COLS = ['A', 'B', 'C', 'D'];

export const poerAdapter: RebarAdapter = {
  name: 'poer',
  sheetName: SHEET,
  prefixPattern: /^Poer\s+(.+)$/i,
  lookupBreakdown(typeCode, cells) {
    const header = detectDiameterHeader(cells, SHEET, { rowMin: 1, rowMax: 30 });
    if (!header) return null;
    const found = findRowByLabel(cells, SHEET, LABEL_COLS, typeCode, {
      rowMin: header.row + 1,
    });
    if (!found) return null;
    const out: RebarBreakdown[] = [];
    for (const [diameter, col] of header.map) {
      const cell = cells.find((c) => c.sheet === SHEET && c.address === `${col}${found.row}`);
      const w = Number(cell?.value ?? 0);
      if (w > 0) {
        out.push({ diameter, weightKg: w, sourceCell: `${SHEET}!${col}${found.row}` });
      }
    }
    return out;
  },
};
