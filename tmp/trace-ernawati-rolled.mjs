// Trace exactly why specific rolled rows fail itemization.
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));
const get = (s, a) => lookup.get(`${s}!${a}`)?.value;
const num = (v) => typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0;

const TARGETS = [
  '(A) III.A.1.2',     // "Besi D13" line
  '(A) III.A.11.4.1',  // Plat lantai
  '(A) III.A.11.5.1',  // Dinding penahan tanah
  '(A) IV.A.5.1',      // Dinding Pagar Alas
  '(A) V.A.1.1',       // Plat lantai lt 3
];

for (const target of TARGETS) {
  const row = result.boqRows.find((r) => r.code === target);
  if (!row) { console.log(`NOT FOUND: ${target}\n`); continue; }
  const s = row.source_sheet;
  const r = row.sourceRow;
  console.log(`\n=== ${row.code} | ${row.label?.slice(0, 70)} (row ${r}) ===`);
  console.log(`  D=${get(s, `D${r}`)}, planned=${row.planned}, unit=${row.unit}`);
  const cs = row.cost_split;
  const src = (cs ? cs.material+cs.labor+cs.equipment+cs.prelim : 0) + (row.subkon_cost_per_unit ?? 0);
  console.log(`  cost_split = mat ${cs?.material.toFixed(0)} + lab ${cs?.labor.toFixed(0)} + eq ${cs?.equipment.toFixed(0)} + pre ${cs?.prelim.toFixed(0)} + subkon ${(row.subkon_cost_per_unit ?? 0).toFixed(0)} = ${src.toFixed(2)}`);

  const cols = {
    R: num(get(s, `R${r}`)), S: num(get(s, `S${r}`)), T: num(get(s, `T${r}`)),
    V: num(get(s, `V${r}`)), W: num(get(s, `W${r}`)), X: num(get(s, `X${r}`)),
    Z: num(get(s, `Z${r}`)), AA: num(get(s, `AA${r}`)),
    AC: num(get(s, `AC${r}`)), AD: num(get(s, `AD${r}`)),
    L: num(get(s, `L${r}`)), M: num(get(s, `M${r}`)),
  };
  console.log(`  R/S/T=${cols.R.toFixed(0)}/${cols.S.toFixed(0)}/${cols.T.toFixed(0)}`);
  console.log(`  V=${cols.V.toFixed(4)}, W=${cols.W.toFixed(2)}, X=${cols.X.toFixed(2)}  →  V·W=${(cols.V*cols.W).toFixed(0)}, V·X=${(cols.V*cols.X).toFixed(0)}`);
  console.log(`  Z=${cols.Z.toFixed(4)}, AA=${cols.AA.toFixed(2)}              →  Z·AA=${(cols.Z*cols.AA).toFixed(0)}`);
  console.log(`  AC=${cols.AC}, AD=${cols.AD}, L=${cols.L}, M=${cols.M}`);
  const invariant = cols.R + cols.S + cols.T + cols.V*cols.W + cols.V*cols.X + cols.Z*cols.AA + cols.AC*cols.AD + cols.L + cols.M;
  console.log(`  Invariant sum = ${invariant.toFixed(2)}; source = ${src.toFixed(2)}; delta = ${(invariant - src).toFixed(2)}`);

  // Recipe components dump (truncated)
  if (row.recipe) {
    const totalRebar = row.recipe.components.filter((c) => /^Besi /i.test(c.materialName ?? '')).reduce((s, c) => s + c.quantityPerUnit, 0);
    console.log(`  recipe: ${row.recipe.components.length} components, Σ rebar kg/m³ from disaggregator = ${totalRebar.toFixed(2)} (vs Z=${cols.Z.toFixed(2)})`);
    for (const c of row.recipe.components) {
      if (/^Besi /i.test(c.materialName ?? '')) continue; // hide diameter rows
      const label = c.materialName ?? c.referencedBlockTitle ?? '?';
      console.log(`    [${c.lineType}] ${c.sourceCell.address} -> ${c.referencedCell.sheet}!${c.referencedCell.address}  qty=${c.quantityPerUnit.toFixed(4)} price=${c.unitPrice.toFixed(2)}  block: ${label.slice(0, 50)}`);
    }
  }
}
