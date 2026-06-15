import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

// Check the Bekisting Kolom block status
const { data: blocks } = await sb.from('import_staging_rows')
  .select('id, row_number, parsed_data')
  .eq('session_id', sessionId)
  .eq('row_type', 'ahs_block')
  .or('parsed_data->>title.ilike.%Bekisting Kolom%,parsed_data->>title.ilike.%Bekisting Balok%,parsed_data->>title.ilike.%Pengecoran Beton%,parsed_data->>title.ilike.%Pembesian%');
console.log(`Structural AHS blocks: ${blocks?.length ?? 0}`);
for (const b of (blocks ?? [])) {
  console.log(`  ${b.parsed_data.title.slice(0, 70).padEnd(72)} orphan=${b.parsed_data.is_orphan} linked_boq=${b.parsed_data.linked_boq_code ?? '∅'}`);
}

// Now count BoQ rows whose recipe.components has referencedBlockTitle matching one of these
console.log('\n=== Counting BoQ row references to Bekisting Kolom ===');
const { data: allBoqs } = await sb.from('import_staging_rows')
  .select('parsed_data')
  .eq('session_id', sessionId)
  .eq('row_type', 'boq');
let kolomCount = 0, balokCount = 0, pembesianCount = 0, pengecoranCount = 0;
for (const b of (allBoqs ?? [])) {
  const blocks = (b.parsed_data?.recipe?.components ?? []).map((c) => c.referencedBlockTitle).filter(Boolean);
  if (blocks.some((t) => /Bekisting Kolom/i.test(t))) kolomCount++;
  if (blocks.some((t) => /Bekisting Balok/i.test(t))) balokCount++;
  if (blocks.some((t) => /Pembesian/i.test(t))) pembesianCount++;
  if (blocks.some((t) => /Pengecoran Beton/i.test(t))) pengecoranCount++;
}
console.log(`  Bekisting Kolom refs: ${kolomCount}`);
console.log(`  Bekisting Balok refs: ${balokCount}`);
console.log(`  Pembesian refs:       ${pembesianCount}`);
console.log(`  Pengecoran Beton refs: ${pengecoranCount}`);
