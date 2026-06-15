import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const sessionId = '74a186cd-d553-4370-bdf7-9baaeaae547f';

const { data } = await sb.from('import_staging_rows')
  .select('parsed_data')
  .eq('session_id', sessionId)
  .eq('row_type', 'boq')
  .eq('parsed_data->>code', 'III.B.1.14')
  .single();

const recipe = data.parsed_data.recipe;
console.log('recipe keys:', Object.keys(recipe));
console.log('markup:', JSON.stringify(recipe.markup));
console.log('perUnit:', JSON.stringify(recipe.perUnit));
console.log(`\ncomponents (${recipe.components.length}):`);
for (const c of recipe.components) {
  console.log(JSON.stringify(c, null, 1).replace(/\n\s*/g, ' '));
}
