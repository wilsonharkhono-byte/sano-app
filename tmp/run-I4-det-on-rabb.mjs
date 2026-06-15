// Mimic what the deterministic CLI does, but parse RAB (B) and read columns from row.source_sheet (not hardcoded RAB (A)).
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseBoqV2 } from '../tools/boqParserV2/index.ts';
import { needsExpansion } from '../tools/normalizer/needsExpansion.ts';

const TOL = 1;

const buf = fs.readFileSync('./assets/BOQ/RAB Nusa Golf I4 no. 29_R3.xlsx');
const result = await parseBoqV2(buf, { boqSheet: 'auto' });
const lookup = result.lookup;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const get = (s, a) => num(lookup.get(`${s}!${a}`)?.value);

// Build templates (copy of CLI logic — using all blocks)
function extractBekistingTemplates() {
  const out = [];
  for (const b of result.ahsBlocks) {
    if (!/Bekisting/i.test(b.title)) continue;
    const hargaRow = b.jumlahRow + 1;
    const harga = get('Analisa', `F${hargaRow}`);
    if (harga === 0) continue;
    const jumlah = get('Analisa', `F${b.jumlahRow}`);
    const cycle = harga > 0 ? Math.round(jumlah / harga) : 1;
    out.push({ blockTitle: b.title, hargaPerM2: harga, cycleFactor: cycle });
  }
  return out;
}
function extractConcreteTemplates() {
  const out = [];
  for (const b of result.ahsBlocks) {
    if (!/Pengecoran Beton/i.test(b.title)) continue;
    const f = get('Analisa', `F${b.jumlahRow}`);
    const g = get('Analisa', `G${b.jumlahRow}`);
    const h = get('Analisa', `H${b.jumlahRow}`);
    if (f === 0) continue;
    out.push({ blockTitle: b.title, matCost: f, laborCost: g, equipCost: h });
  }
  return out;
}

const bekistings = extractBekistingTemplates();
const concretes = extractConcreteTemplates();
console.log(`Bekisting templates: ${bekistings.length}`);
console.log(`Concrete templates: ${concretes.length}`);

const candidates = result.boqRows.filter(needsExpansion);
console.log(`\nCandidates: ${candidates.length}`);

let itemizedCount = 0, rolledCount = 0, unresolvedCount = 0;
const unresolvedRows = [];

for (const row of candidates) {
  const r = row.sourceRow;
  const sheet = row.source_sheet;
  const R = get(sheet, `R${r}`);
  const S = get(sheet, `S${r}`);
  const T = get(sheet, `T${r}`);
  const V = get(sheet, `V${r}`);
  const W = get(sheet, `W${r}`);
  const Z = get(sheet, `Z${r}`);
  const AA = get(sheet, `AA${r}`);
  const N = get(sheet, `N${r}`);

  // Source unit cost from cost_split (matches CLI)
  const sourceUnitCost = (row.cost_split
    ? row.cost_split.material + row.cost_split.labor + row.cost_split.equipment + row.cost_split.prelim
    : 0) + (row.subkon_cost_per_unit ?? 0);

  // Tier 2 rolled (the CLI's primary tier in practice): R + S + T + V*W + Z*AA
  const rolledSum = R + S + T + V*W + Z*AA;
  const variance = Math.abs(rolledSum - sourceUnitCost);

  // Try itemized first: requires matching bekisting + concrete templates
  let concrete = null;
  for (const c of concretes) {
    if (Math.abs(c.matCost - R) <= 1 && Math.abs(c.laborCost - S) <= 1 && Math.abs(c.equipCost - T) <= 1) {
      concrete = c; break;
    }
  }
  let bekisting = null;
  if (W > 0) {
    for (const b of bekistings) {
      if (Math.abs(b.hargaPerM2 - W) <= 1) {
        bekisting = b; break;
      }
    }
  }

  // Itemized would compute concrete sub-items + bekisting × ratio/cycle + pembesian.
  // For this test, we just measure whether the rolled sum reconciles.
  if (variance <= TOL) {
    // Counts as rolled (potentially itemized if templates match)
    if (concrete && (W === 0 || bekisting)) {
      itemizedCount++;
    } else {
      rolledCount++;
    }
  } else {
    unresolvedCount++;
    if (unresolvedRows.length < 20) {
      unresolvedRows.push({
        sheet, code: row.code, label: row.label.slice(0, 40),
        N, sourceUnitCost, rolledSum, variance, R, S, T, V, W, Z, AA,
      });
    }
  }
}

console.log(`\n=== Result for invariant R+S+T+V*W+Z*AA ===`);
console.log(`Itemized-eligible: ${itemizedCount}`);
console.log(`Rolled-only:       ${rolledCount}`);
console.log(`Unresolved:        ${unresolvedCount}`);
console.log(`\nFirst unresolved:`);
for (const u of unresolvedRows.slice(0, 10)) console.log(JSON.stringify(u));
