import type { AhsBlock } from './detectBlocks';
import type {
  ValidationReport,
  UnresolvedReference,
  HarvestLookup,
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
  lookup: HarvestLookup = new Map(),
  catalogSheets: string[] = [],
): UnresolvedReference[] {
  const blockGrandTotals = new Set<string>();
  const blockJumlahAddresses = new Set<string>();
  // C2(b): extend range by +2 to cover "Harga per m2/m3/unit" continuation rows
  const blockRowRanges: Array<{ titleRow: number; jumlahRow: number }> = [];
  for (const b of blocks) {
    if (b.grandTotalAddress) blockGrandTotals.add(b.grandTotalAddress);
    blockJumlahAddresses.add(`F${b.jumlahRow}`);
    blockJumlahAddresses.add(`I${b.jumlahRow}`);
    blockRowRanges.push({ titleRow: b.titleRow, jumlahRow: b.jumlahRow });
  }

  // C2(a): build regex to detect one-hop catalog references
  const catalogRefRe =
    catalogSheets.length > 0
      ? new RegExp(
          `^=?(${catalogSheets.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})!`,
        )
      : null;

  const out: UnresolvedReference[] = [];
  for (const e of encounters) {
    if (blockGrandTotals.has(e.targetCell)) continue;
    if (blockJumlahAddresses.has(e.targetCell)) continue;

    // C2(a): skip if the target cell is a one-hop reference to a catalog sheet,
    // OR if the E-column sibling in the same row is a "Harga per" label —
    // these are normalized unit-cost rows (e.g. "Harga per m2") derived from
    // sub-calculation tables in Analisa and are not AHS components.
    {
      const targetKey = `${e.targetSheet}!${e.targetCell}`;
      const targetCellEntry = lookup.get(targetKey);
      if (catalogRefRe && targetCellEntry?.formula && catalogRefRe.test(targetCellEntry.formula)) continue;
      // "Harga per" row detection: E-column sibling of the target cell
      const rowMatch = /^[A-Z]+(\d+)$/.exec(e.targetCell);
      if (rowMatch) {
        const eKey = `${e.targetSheet}!E${rowMatch[1]}`;
        const eCell = lookup.get(eKey);
        if (typeof eCell?.value === 'string' && eCell.value.startsWith('Harga per')) continue;
      }
    }

    const m = /^([A-Z]+)(\d+)$/.exec(e.targetCell);
    const targetRow = m ? parseInt(m[2], 10) : null;
    let inRange = false;
    if (targetRow != null) {
      for (const r of blockRowRanges) {
        // C2(b): extend upper bound by +2 for "Harga per X" continuation rows
        if (targetRow >= r.titleRow && targetRow <= r.jumlahRow + 2) {
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
