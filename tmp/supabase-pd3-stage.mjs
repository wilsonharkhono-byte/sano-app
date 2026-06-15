import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

const types = ['boq', 'material', 'ahs', 'ahs_block'];
for (const t of types) {
  const { count } = await sb.from('import_staging_rows').select('*', { count: 'exact', head: true }).eq('session_id', sessionId).eq('row_type', t);
  console.log(`  ${t}: ${count}`);
}

// Get a few sample BoQ rows
console.log('\n=== Sample BoQ rows ===');
const { data: boqs } = await sb.from('import_staging_rows').select('row_number, raw_data, parsed_data, confidence, review_status, needs_review').eq('session_id', sessionId).eq('row_type', 'boq').limit(3);
for (const r of (boqs ?? [])) {
  console.log(`\nrow_number=${r.row_number} review_status=${r.review_status} confidence=${r.confidence} needs_review=${r.needs_review}`);
  console.log('  parsed_data:', JSON.stringify(r.parsed_data).slice(0, 300));
}

// Get sample AHS block
console.log('\n=== Sample AHS blocks ===');
const { data: blocks } = await sb.from('import_staging_rows').select('row_number, raw_data, parsed_data, review_status').eq('session_id', sessionId).eq('row_type', 'ahs_block').limit(3);
for (const r of (blocks ?? [])) {
  console.log(`\nrow_number=${r.row_number}`);
  console.log('  parsed_data:', JSON.stringify(r.parsed_data).slice(0, 300));
}
