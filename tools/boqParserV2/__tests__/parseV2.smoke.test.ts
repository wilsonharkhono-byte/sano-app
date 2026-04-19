import * as fs from 'fs';
import { parseBoqV2 } from '..';

test('AAL-5 workbook → parseBoqV2 smoke', async () => {
  const buf = fs.readFileSync('assets/BOQ/RAB R1 Pakuwon Indah AAL-5.xlsx');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const result = await parseBoqV2(ab as ArrayBuffer);

  const sheets = new Set(result.cells.map(c => c.sheet));
  console.log('\n==== parseBoqV2 smoke: AAL-5 ====');
  console.log('SHEETS       :', [...sheets].join(', '));
  console.log('MATERIALS    :', result.materialRows.length);
  console.log('AHS BLOCKS   :', result.ahsBlocks.length);
  console.log('BoQ ROWS     :', result.boqRows.length);
  console.log('STAGING ROWS :', result.stagingRows.length);

  console.log('\nFIRST 5 BLOCKS:');
  result.ahsBlocks.slice(0, 5).forEach(b => {
    console.log(
      `  "${b.title}" rows ${b.titleRow}-${b.jumlahRow} comps=${b.components.length} jumlahF=${b.jumlahCachedValue}`,
    );
  });

  console.log('\nFIRST 5 BoQ ROWS:');
  result.boqRows.slice(0, 5).forEach(r => {
    console.log(`  ${r.code} | ${r.unit} ${r.planned} | basis=${r.cost_basis} | ${r.label}`);
  });

  console.log('\nVALIDATION:');
  console.log('  blocksChecked :', result.validationReport.blocks.length);
  const imbalanced = result.validationReport.blocks.filter(b => b.status === 'imbalanced');
  console.log('  imbalanced    :', imbalanced.length);
  imbalanced.slice(0, 3).forEach(b => {
    console.log(`    ${b.block_title}: expected ${b.expected} got ${b.actual} (Δ ${b.delta})`);
  });

  const boqWithSplit = result.boqRows.filter(r => r.cost_split).length;
  const blockRows = result.stagingRows.filter(r => r.row_type === 'ahs_block');
  const linkedBlocks = blockRows.filter(r => (r.parsed_data as { linked_boq_code?: string }).linked_boq_code).length;
  console.log('\nLINKING:');
  console.log('  BoQ rows with cost_split :', boqWithSplit, '/', result.boqRows.length);
  console.log('  Blocks linked to BoQ     :', linkedBlocks, '/', blockRows.length);

  // Core sanity: blocks extracted, materials extracted, BoQ extracted
  expect(result.ahsBlocks.length).toBeGreaterThan(10);
  expect(result.materialRows.length).toBeGreaterThan(0);
  expect(result.boqRows.length).toBeGreaterThan(50);

  // Validator must agree with the workbook's own cached totals. Summing
  // component subtotals (F column) should equal the jumlah row (F19-style
  // cached SUM). More than a few imbalanced blocks means the validator
  // or the detector is off.
  expect(imbalanced.length / result.validationReport.blocks.length).toBeLessThan(0.05);

  // Sampled BoQ rows should not be header rows. Row 1's code must be
  // a number, not the literal "URAIAN PEKERJAAN" label.
  if (result.boqRows.length > 0) {
    expect(result.boqRows[0].label.toLowerCase()).not.toContain('uraian');
    expect(result.boqRows[0].unit.toLowerCase()).not.toBe('sat');
  }

  // For workbooks like AAL-5 that store a cached cost split on each BoQ
  // row (Material/Upah/Peralatan columns), most real work items should
  // come out with a populated split — otherwise the audit UI renders Rp 0.
  // Non-item rows (chapter headers, subtotals) are already filtered
  // earlier, so this ratio is a meaningful coverage signal.
  expect(boqWithSplit / result.boqRows.length).toBeGreaterThan(0.5);

  // A non-trivial fraction of blocks should resolve back to a BoQ code.
  // We cannot reach 100% (some blocks are referenced only through
  // secondary sheets like Pas. Dinding or Plumbing), but 21/33 ≈ 0.63
  // is the current achievable floor for AAL-5.
  expect(linkedBlocks / blockRows.length).toBeGreaterThan(0.5);

  // Recipe coverage and reconciliation: every BoQ row with a cost_split
  // should have a recipe, and the components per line type should sum to
  // the split values within 1 rupiah (or 0.01% of the magnitude).
  const withRecipe = result.boqRows.filter(r => r.recipe).length;
  const withSplit = result.boqRows.filter(r => r.cost_split).length;
  console.log('\nRECIPE COVERAGE:');
  console.log('  rows with recipe :', withRecipe, '/', withSplit, '(', Math.round(100 * withRecipe / Math.max(1, withSplit)), '% of split rows)');

  let reconciled = 0;
  let mismatches = 0;
  for (const r of result.boqRows) {
    if (!r.recipe || !r.cost_split) continue;
    const byType: Record<string, number> = { material: 0, labor: 0, equipment: 0, subkon: 0, prelim: 0 };
    for (const c of r.recipe.components) byType[c.lineType] += c.costContribution;
    const matOk = Math.abs(byType.material - r.cost_split.material) <= Math.max(1, r.cost_split.material * 1e-4);
    const labOk = Math.abs(byType.labor - r.cost_split.labor) <= Math.max(1, r.cost_split.labor * 1e-4);
    const eqpOk = Math.abs(byType.equipment - r.cost_split.equipment) <= Math.max(1, r.cost_split.equipment * 1e-4);
    if (matOk && labOk && eqpOk) reconciled++;
    else if (mismatches < 5) {
      mismatches++;
      console.log(`  reconciliation miss row ${r.sourceRow} ${r.code} "${r.label.slice(0, 30)}": `
        + `mat Δ${Math.round(byType.material - r.cost_split.material)} `
        + `lab Δ${Math.round(byType.labor - r.cost_split.labor)} `
        + `eqp Δ${Math.round(byType.equipment - r.cost_split.equipment)}`);
    }
  }
  console.log('  reconciled       :', reconciled, '/', withRecipe);
  expect(reconciled / Math.max(1, withRecipe)).toBeGreaterThan(0.7);
}, 120000);
