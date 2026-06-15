import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

// Get all poer BoQ staging rows
const { data: boqs } = await sb.from('import_staging_rows')
  .select('id, row_number, parsed_data')
  .eq('session_id', sessionId)
  .eq('row_type', 'boq')
  .ilike('parsed_data->>code', 'III.B.1.%')
  .order('row_number');

console.log(`Poer BoQ staging rows: ${boqs?.length ?? 0}\n`);
for (const b of (boqs ?? [])) {
  const code = b.parsed_data?.code;
  const label = b.parsed_data?.label ?? '';
  const compCount = (b.parsed_data?.recipe?.components ?? []).length;
  // Count child ahs staging rows referencing this boq
  const { count: ahsKids } = await sb.from('import_staging_rows')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('row_type', 'ahs')
    .eq('parent_ahs_staging_id', b.id);
  console.log(`${(code ?? '?').padEnd(12)} ${label.slice(0,16).padEnd(16)} parsed_components=${String(compCount).padEnd(3)} staged_ahs_children=${ahsKids}`);
}
