import { createClient } from '@supabase/supabase-js';
import { extractBoqRows, extractAhsRows, pivotByBoq } from '../tools/auditPivot.ts';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

// Pull ALL staging rows (paginate)
let all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('import_staging_rows')
    .select('*').eq('session_id', sessionId).range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  all = all.concat(data ?? []);
  if (!data || data.length < 1000) break;
}
console.log(`Total staging rows: ${all.length}`);

const boqRows = extractBoqRows(all);
const ahsRows = extractAhsRows(all);
const breakdowns = pivotByBoq(boqRows, ahsRows);

// Poer family
const poer = breakdowns.filter(b => /^III\.B\.1\./.test(b.boq.code)).sort((a,b)=>a.boq.code.localeCompare(b.boq.code, undefined, {numeric:true}));
console.log(`\n=== Poer rows: lines per row (BEFORE fix all but last = 0) ===`);
for (const b of poer) {
  const m = b.lines.filter(l => l.ahs.lineType==='material').length;
  const u = b.lines.filter(l => l.ahs.lineType==='labor').length;
  const a = b.lines.filter(l => l.ahs.lineType==='equipment').length;
  console.log(`  ${b.boq.code.padEnd(12)} ${b.boq.label.slice(0,14).padEnd(14)} lines=${String(b.lines.length).padStart(2)} (M:${m} U:${u} A:${a}) perUnitTotal=Rp ${Math.round(b.perUnitTotal).toLocaleString('id')}`);
}

// Global: how many BoQ rows now have ≥1 line vs 0
const withLines = breakdowns.filter(b => b.lines.length > 0).length;
const without = breakdowns.filter(b => b.lines.length === 0).length;
console.log(`\nAll ${breakdowns.length} BoQ rows: ${withLines} with lines, ${without} without`);
