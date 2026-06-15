import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { parseBoqWorkbook } = require('./excelParser.bundle.cjs');
const buf = readFileSync('assets/BOQ/CONTOH_Template_Parser.xlsx');
const parsed = parseBoqWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'CONTOH_Template_Parser.xlsx', { skipGrouping: true });

console.log('\n═══ PARSE RESULTS ═══');
console.log(`Materials parsed: ${parsed.materials.length}`);
for (const m of parsed.materials) {
  console.log(`  • ${m.name.padEnd(36)} ${m.unit.padEnd(5)} ${String(m.unitPrice).padStart(10)}`);
}
console.log(`\nAHS blocks parsed: ${parsed.ahsBlocks.length}`);
for (const b of parsed.ahsBlocks) {
  console.log(`  • ${b.title}`);
  console.log(`      material=${b.totals.material}  labor=${b.totals.labor}  components=${b.components.length}`);
  for (const c of b.components) {
    console.log(`         - coeff=${c.coefficient} ${c.unit} "${c.description}" [${c.lineType}] price=${c.unitPrice} ref=${c.priceRef ?? '-'}`);
  }
}
console.log(`\nBoQ items parsed: ${parsed.boqItems.length}`);
for (const i of parsed.boqItems) {
  const links = parsed.rabToAhsLinks.get(i.sourceRow);
  console.log(`  • [${i.code}] ${i.label} ${i.unit} vol=${i.volume}  material=${i.costBreakdown.material}  labor=${i.costBreakdown.labor}`);
  if (links?.directRefs?.length) {
    console.log(`      AHS refs: ${links.directRefs.map(r => `${r.component}@${r.column}${r.ahsRow}`).join(', ')}  → block indices: [${links.ahsBlockIndices.join(',')}]`);
  }
}
console.log(`\nAnomalies: ${parsed.anomalies.length}`);
for (const a of parsed.anomalies) {
  console.log(`  [${a.severity}] ${a.type}: ${a.description.slice(0, 110)}`);
}
