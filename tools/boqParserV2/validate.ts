import type { AhsBlock } from './detectBlocks';
import type { ValidationReport } from './types';

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function validateBlocks(blocks: AhsBlock[]): ValidationReport {
  const report: ValidationReport = {
    blocks: [],
    generated_at: new Date().toISOString(),
  };
  for (const b of blocks) {
    const actual = b.components.reduce((sum, c) => sum + toNumber(c.value), 0);
    const delta = actual - b.jumlahCachedValue;
    const status: 'ok' | 'imbalanced' = Math.abs(delta) <= 1 ? 'ok' : 'imbalanced';
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
