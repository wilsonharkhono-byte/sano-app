import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

// Compare 35cm (linked, IX.C.3) with 40cm (orphan) and 50cm (linked, IX.B.4)
const titles = ['finish 35 cm', 'finish 40 cm', 'finish 50 cm', 'finish 15 cm', 'finish 20 cm', 'finish 25 cm'];
for (const t of titles) {
  const { data: blocks } = await sb.from('import_staging_rows')
    .select('id, row_number, parsed_data')
    .eq('session_id', sessionId)
    .eq('row_type', 'ahs_block')
    .ilike('parsed_data->>title', `%${t}%`);
  for (const b of (blocks ?? [])) {
    const { count: subCount } = await sb.from('import_staging_rows')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('row_type', 'ahs')
      .eq('parent_ahs_staging_id', b.id);
    console.log(`row ${b.row_number}: ${b.parsed_data.title.slice(0, 70).padEnd(72)} orphan=${b.parsed_data.is_orphan} → linked_boq=${b.parsed_data.linked_boq_code ?? '∅'} subRows=${subCount}`);
  }
}
