import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(url, key);

const { data, error } = await sb
  .from('import_sessions')
  .select('id, project_id, original_file_name, status, created_at, parser_version')
  .ilike('original_file_name', '%PD3%')
  .order('created_at', { ascending: false })
  .limit(10);
if (error) { console.error(error); process.exit(1); }
console.log(`PD3 sessions: ${data?.length ?? 0}`);
for (const s of (data ?? [])) {
  console.log(`  ${s.id.slice(0,8)} ${s.created_at} status=${s.status} parser=${s.parser_version} file=${s.original_file_name}`);
}
