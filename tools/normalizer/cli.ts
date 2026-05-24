/**
 * Normalizer CLI
 *
 * Runs the Node normalizer end-to-end against a workbook on disk. Use this
 * while the Supabase Edge Function `boq-normalize` is still a stub (Task 28).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx tools/normalizer/cli.ts <input.xlsx> [output.xlsx]
 *
 * If output is omitted, writes `<input>_normalized.xlsx` next to the input.
 *
 * After running, upload the normalized workbook to the SANO app with
 * SANO_BOQ_RECIPE_DETAIL=on — the parser will read the Breakdown sheets and
 * produce per-material recipes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseBoqV2 } from '../boqParserV2';
import { normalizeWorkbook, makeAnalyzeBlock } from './index';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.error('Usage: ANTHROPIC_API_KEY=sk-... npx tsx tools/normalizer/cli.ts <input.xlsx> [output.xlsx]');
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
  const inputBuffer = fs.readFileSync(inputPath);

  console.log('Dry-parsing for cell extraction...');
  const dry = await parseBoqV2(inputBuffer);
  console.log(`  ${dry.boqRows.length} BoQ rows, ${dry.ahsBlocks.length} AHS blocks`);

  console.log('Building Opus-backed analyzeBlock (real API calls)...');
  const analyzeBlock = makeAnalyzeBlock({ apiKey, cells: dry.cells });

  console.log('Running normalizer (one Opus call per unique block, then expansion)...');
  const startedAt = Date.now();
  const result = await normalizeWorkbook(inputBuffer, { analyzeBlock });
  const elapsedMs = Date.now() - startedAt;

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Rows total:       ${result.summary.rows_total}`);
  console.log(`  Rows normalized:  ${result.summary.rows_normalized}`);
  console.log(`  Rows skipped:     ${result.summary.rows_skipped}`);
  console.log(`  Rows mismatched:  ${result.summary.rows_with_mismatch}`);
  console.log(`  Blocks analyzed:  ${result.summary.blocks_analyzed}`);
  console.log(`  Elapsed:          ${elapsedMs}ms`);

  if (result.warnings.length > 0) {
    console.log('');
    console.log('=== Warnings ===');
    for (const w of result.warnings) {
      console.log(`  [${w.code}] ${w.message}`);
    }
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
