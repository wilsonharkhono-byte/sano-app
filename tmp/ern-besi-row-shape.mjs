import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));

const codes = ['III.A.1.1', 'III.A.1.2', 'III.A.1.3', 'III.A.2.2', 'III.A.10.4'];

for (const code of codes) {
  const row = result.boqRows.find((r) => r.code === code);
  if (!row) { console.log(`NOT FOUND: ${code}`); continue; }
  const r = row.sourceRow;
  console.log(`\n=== ${code} (RAB row ${r}) ===`);
  console.log(`description: ${row.description}`);
  console.log(`unit=${row.unit} volume=${row.planned} sourceUnitCost=${row.sourceUnitCost}`);
  const cols = ['B','D','E','F','G','H','I','J','K','L','M','N','O','R','S','T','V','W','X','Z','AA','AC','AD'];
  for (const c of cols) {
    const v = lookup.get(`RAB (A)!${c}${r}`);
    if (v && v.value !== '' && v.value !== null && v.value !== undefined) {
      const f = v.formula ? ` formula=${String(v.formula).slice(0, 60)}` : '';
      const val = typeof v.value === 'number' ? v.value.toFixed(2) : v.value;
      console.log(`  ${c}${r}: ${val}${f}`);
    }
  }
  console.log(`Recipe components (${row.recipe.components.length}):`);
  for (const c of row.recipe.components) {
    console.log(`    [${c.group}] ${(c.materialName ?? '?').slice(0, 50).padEnd(50)} | qty/${c.nativeUnit}=${c.quantityPerUnit} × ${c.unitPrice} | block=${(c.referencedBlockTitle ?? '?').slice(0, 40)} | ${c.referencedCell?.sheet}!${c.referencedCell?.address}`);
  }
}
