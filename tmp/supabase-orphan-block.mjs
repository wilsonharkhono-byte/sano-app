import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

// Find "finish 40 cm" AHS block
const { data: blocks } = await sb.from('import_staging_rows')
  .select('id, row_number, raw_data, parsed_data')
  .eq('session_id', sessionId)
  .eq('row_type', 'ahs_block')
  .ilike('parsed_data->>title', '%finish 40 cm%');

console.log(`AHS blocks matching "finish 40 cm": ${blocks?.length ?? 0}`);
for (const b of (blocks ?? [])) {
  console.log(`\n=== AHS block id=${b.id} row_number=${b.row_number} ===`);
  console.log(JSON.stringify(b.parsed_data, null, 2));

  // Find this block's sub-items (ahs rows with parent_ahs_staging_id = b.id)
  const { data: subs } = await sb.from('import_staging_rows')
    .select('row_number, parsed_data')
    .eq('session_id', sessionId)
    .eq('row_type', 'ahs')
    .eq('parent_ahs_staging_id', b.id);
  console.log(`\n  ${subs?.length ?? 0} AHS sub-rows:`);
  for (const s of (subs ?? [])) {
    console.log(`    row ${s.row_number}: ${JSON.stringify(s.parsed_data).slice(0, 200)}`);
  }
}
