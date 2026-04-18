import type { AhsBlock } from './detectBlocks';
import type { ValidationReport } from './types';

export function validateBlocks(blocks: AhsBlock[]): ValidationReport {
  const report: ValidationReport = {
    blocks: [],
    generated_at: new Date().toISOString(),
  };
  for (const b of blocks) {
    // Compare SUM(F) of component subtotals against the jumlah row's F
    // (cached B×E). Summing the E-column unit prices, as the previous
    // version did, always produces a wildly different number and makes
    // every block look imbalanced.
    const actual = b.componentSubtotals.reduce((sum, v) => sum + v, 0);
    const delta = actual - b.jumlahCachedValue;
    // Allow a small tolerance that grows with block magnitude — cached
    // Excel totals sometimes carry sub-rupiah floating point drift.
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
