import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import * as fs from 'fs';

const buf = fs.readFileSync('./assets/BOQ/RAB ERNAWATI edit.xlsx');
const result = await parseBoqV2(buf);
const lookup = new Map(result.cells.map((c) => [`${c.sheet}!${c.address}`, c]));

// Cluster rows by ".N" suffix to understand the family layout
const families = new Map();
for (const r of result.boqRows) {
  if (!r.code) continue;
  const parts = r.code.split('.');
  if (parts.length < 3) continue;
  const last = parts[parts.length - 1];
  const family = parts.slice(0, -1).join('.');
  if (!families.has(family)) families.set(family, []);
  families.get(family).push({ code: r.code, last, row: r });
}

// Print families that have an exact ".1/.2/.3/.4/.5" pattern
let n = 0;
for (const [fam, rows] of families) {
  if (rows.length < 4 || rows.length > 7) continue;
  if (n++ > 4) break;
  console.log(`\n=== Family ${fam} (${rows.length} rows) ===`);
  for (const e of rows) {
    const r = e.row.sourceRow;
    const desc = lookup.get(`RAB (A)!B${r}`)?.value ?? '?';
    const unit = e.row.unit;
    const vol = e.row.planned;
    const N = lookup.get(`RAB (A)!N${r}`)?.value;
    const O = lookup.get(`RAB (A)!O${r}`)?.value;
    const R = lookup.get(`RAB (A)!R${r}`)?.value;
    const V = lookup.get(`RAB (A)!V${r}`)?.value;
    const W = lookup.get(`RAB (A)!W${r}`)?.value;
    const Z = lookup.get(`RAB (A)!Z${r}`)?.value;
    const AA = lookup.get(`RAB (A)!AA${r}`)?.value;
    console.log(`  ${e.code.padEnd(15)} r${r} unit=${(unit ?? '?').padEnd(4)} vol=${String(vol).padEnd(10)} ${String(desc).slice(0,30).padEnd(30)} | N=${N} O=${O} | R=${R} V=${V} W=${W} Z=${Z} AA=${AA}`);
  }
}
