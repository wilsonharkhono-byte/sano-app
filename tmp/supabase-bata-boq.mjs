import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

// All bata merah BoQ rows
const { data: boqs } = await sb.from('import_staging_rows')
  .select('row_number, parsed_data, review_status, needs_review')
  .eq('session_id', sessionId)
  .eq('row_type', 'boq')
  .ilike('parsed_data->>label', '%bata merah%')
  .order('row_number');

console.log(`Bata merah BoQ rows: ${boqs?.length ?? 0}\n`);
for (const b of (boqs ?? [])) {
  const code = b.parsed_data?.code ?? '?';
  const label = b.parsed_data?.label ?? '';
  const unit = b.parsed_data?.unit ?? '';
  const comps = b.parsed_data?.recipe?.components ?? [];
  // What AHS block does each component reference?
  const blocks = [...new Set(comps.map((c) => c.referencedBlockTitle).filter(Boolean))];
  console.log(`${code.padEnd(10)} ${unit.padEnd(4)} ${label.slice(0, 75).padEnd(75)} → ${blocks.length ? blocks.join(' | ') : '∅ (no AHS link)'}`);
}
