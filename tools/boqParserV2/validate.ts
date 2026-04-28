import type { AhsBlock } from './detectBlocks';
import type {
  ValidationReport,
  UnresolvedReference,
} from './types';

export function validateBlocks(blocks: AhsBlock[]): ValidationReport {
  const report: ValidationReport = {
    blocks: [],
    unresolved_references: [],
    generated_at: new Date().toISOString(),
  };
  for (const b of blocks) {
    const actual = b.componentSubtotals.reduce((sum, v) => sum + v, 0);
    const delta = actual - b.jumlahCachedValue;
    const tolerance = Math.max(1, Math.abs(b.jumlahCachedValue) * 1e-6);
    const status: 'ok' | 'imbalanced' = Math.abs(delta) <= tolerance ? 'ok' : 'imbalanced';
    report.blocks.push({
      block_title: b.title,
      status,
      expected: b.jumlahCachedValue,
      actual,
      delta,
    });
  }
  return report;
}

export interface AnalisaRefEncounter {
  boqCode: string;
  sourceAddress: string;
  formula: string;
  targetSheet: string;
  targetCell: string;
}

export function collectUnresolvedReferences(
  encounters: AnalisaRefEncounter[],
  blocks: AhsBlock[],
): UnresolvedReference[] {
  const blockGrandTotals = new Set<string>();
  const blockJumlahAddresses = new Set<string>();
  const blockRowRanges: Array<{ titleRow: number; jumlahRow: number }> = [];
  for (const b of blocks) {
    if (b.grandTotalAddress) blockGrandTotals.add(b.grandTotalAddress);
    blockJumlahAddresses.add(`F${b.jumlahRow}`);
    blockJumlahAddresses.add(`I${b.jumlahRow}`);
    blockRowRanges.push({ titleRow: b.titleRow, jumlahRow: b.jumlahRow });
  }

  const out: UnresolvedReference[] = [];
  for (const e of encounters) {
    if (blockGrandTotals.has(e.targetCell)) continue;
    if (blockJumlahAddresses.has(e.targetCell)) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(e.targetCell);
    const targetRow = m ? parseInt(m[2], 10) : null;
    let inRange = false;
    if (targetRow != null) {
      for (const r of blockRowRanges) {
        if (targetRow >= r.titleRow && targetRow <= r.jumlahRow) {
          inRange = true;
          break;
        }
      }
    }
    if (inRange) continue;
    out.push({
      boq_row_code: e.boqCode,
      source_address: e.sourceAddress,
      formula: e.formula,
      target: { sheet: e.targetSheet, cell: e.targetCell },
      message: `Formula points at ${e.targetSheet}!${e.targetCell} which does not match a Jumlah row, AHS title, or recognized block range. Likely hand-priced or unrecognized layout.`,
    });
  }
  return out;
}
