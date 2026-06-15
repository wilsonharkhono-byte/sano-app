/**
 * Material take-off rollup CLI — no LLM.
 *
 * Runs the deterministic reconciler, then rolls every RECONCILED row's material
 * lines up into procurement blocks (e.g. "Kolom Lantai 1" = all column types on
 * floor 1) and writes a take-off workbook: a project-wide Order List, a
 * per-block sheet, and an Excluded sheet for anything that didn't reconcile.
 *
 * Usage:
 *   npm run normalize:boq:rollup -- <input.xlsx> [output.xlsx]
 *
 * Cost: zero. Pure local math, built on the same ±1 Rp reconciliation gate.
 */
import * as path from 'path';
import { runDeterministic } from './cli-deterministic';
import { buildRollupFromBreakdowns, writeTakeoffWorkbook } from '../materialTakeoff';

export async function runRollup(inputPath: string, outputPath: string): Promise<void> {
  const det = await runDeterministic({ inputPath, silent: true });
  const groups = buildRollupFromBreakdowns(det.breakdowns, det.boqRows);
  const { orderList } = writeTakeoffWorkbook(groups, outputPath);

  const summed = groups.reduce((n, g) => n + g.reconciledCount, 0);
  const excluded = groups.reduce((n, g) => n + g.excluded.length, 0);
  console.log(`Reconciled rows: ${det.breakdowns.length} (max variance ${det.maxAbsVariance.toFixed(2)} Rp)`);
  console.log(`Procurement blocks: ${groups.length}`);
  console.log(`  bullets summed:   ${summed}`);
  console.log(`  bullets excluded: ${excluded}`);
  console.log(`  distinct materials in order list: ${orderList.length}`);
  console.log(`\nWrote: ${outputPath}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run normalize:boq:rollup -- <input.xlsx> [output.xlsx]');
    process.exit(1);
  }
  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] ?? inputPath.replace(/\.xlsx$/i, '_takeoff.xlsx');
  await runRollup(inputPath, outputPath);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FAILED:', err);
    process.exit(10);
  });
}
