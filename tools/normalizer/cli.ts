/**
 * Normalizer CLI — agentic mode.
 *
 * For each BoQ row that needs detail expansion, give Claude the full Analisa
 * sheet and a self-verifying submit_breakdown tool. Claude iterates until the
 * computed unit cost reconciles to the source at-cost target within ±1 Rp.
 *
 * Truth-correctness: rows that do NOT reconcile are NOT written as Breakdown
 * sheets. They go into an "Unresolved" sheet with the variance + reason so a
 * human can fix them manually. No fake-correct numbers ever reach the workbook.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npm run normalize:boq -- <input.xlsx> [output.xlsx]
 *
 * Cost: ~$5 per workbook with prompt caching on the Analisa dump (paid for once,
 * then near-free reads on subsequent rows). Without caching ~$30.
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeWorkbookAgentic } from './index';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.error(
      'Usage: ANTHROPIC_API_KEY=sk-... npm run normalize:boq -- <input.xlsx> [output.xlsx]',
    );
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY env var is required');
    process.exit(2);
  }

  const inputPath = path.resolve(args[0]);
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: input file not found: ${inputPath}`);
    process.exit(3);
  }

  const outputPath = args[1]
    ? path.resolve(args[1])
    : inputPath.replace(/\.xlsx$/i, '_normalized.xlsx');

  console.log(`Reading: ${inputPath}`);
  console.log('Running agentic normalizer — Claude reasons over the full Analisa sheet per row.');
  console.log('Each row\'s breakdown must reconcile to the source at-cost target within ±1 Rp.');
  console.log('');

  const inputBuffer = fs.readFileSync(inputPath);

  const result = await normalizeWorkbookAgentic(inputBuffer, {
    apiKey,
    onProgress: ({ row, status, turnsUsed, variance }) => {
      const icon =
        status === 'reconciled' ? '✓' :
        status === 'unable_to_reconcile' ? '⚠' :
        status === 'no_tool_use' ? '✗' :
        '✗';
      const label = `${icon} ${row.code.padEnd(14)} ${row.label.slice(0, 35).padEnd(35)}`;
      const meta = `${turnsUsed} turn${turnsUsed === 1 ? '' : 's'}`;
      const varText = variance != null ? `  (variance Rp ${variance.toFixed(0)})` : '';
      console.log(`  ${label}  ${meta}${varText}`);
    },
  });

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Rows total:        ${result.summary.rows_total}`);
  console.log(`  Rows eligible:     ${result.summary.rows_eligible}`);
  console.log(`  Rows reconciled:   ${result.summary.rows_reconciled}  (written as Breakdown sheets)`);
  console.log(`  Rows unresolved:   ${result.summary.rows_unresolved}  (listed in 'Unresolved' sheet for manual review)`);
  console.log(`  Elapsed:           ${(result.summary.elapsed_ms / 1000).toFixed(1)}s`);

  if (result.unresolved.length > 0) {
    console.log('');
    console.log('=== Unresolved rows ===');
    for (const u of result.unresolved) {
      console.log(`  ${u.code} ${u.label}`);
      console.log(`    └─ ${u.reason}`);
    }
    console.log('');
    console.log('Open the Unresolved sheet in the output workbook and either:');
    console.log('  - fix the row manually in Excel, or');
    console.log('  - re-run the CLI (Claude may pick a different path with fresh sampling).');
  }

  fs.writeFileSync(outputPath, result.workbookBuffer);
  console.log('');
  console.log(`Wrote: ${outputPath}`);
  console.log('');
  console.log('Next step: upload this workbook in the SANO app with SANO_BOQ_RECIPE_DETAIL=on.');
  console.log('The parser will read the Breakdown sheets and produce per-material recipes.');
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(10);
});
