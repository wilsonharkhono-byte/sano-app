import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import * as XLSX from 'xlsx';

interface ProbeBody { storage_path: string; }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );

  const body = (await req.json()) as ProbeBody;
  const { data, error } = await supabase.storage.from('project-files').download(body.storage_path);
  if (error || !data) return new Response(JSON.stringify({ error: error?.message ?? 'not found' }), { status: 404 });
  const buf = new Uint8Array(await data.arrayBuffer());

  const wb = XLSX.read(buf, { cellFormula: true });
  let rowsTotal = 0;
  let rowsNeeding = 0;
  const blocksReferenced = new Set<string>();

  const rabSheet = wb.Sheets['RAB (A)'];
  if (rabSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(rabSheet, { header: 1, raw: true, defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as unknown[];
      const label = String(r[1] ?? '').toLowerCase();
      const unit = String(r[2] ?? '').toLowerCase();
      const isStructural = /balok|sloof|kolom|plat|poer/i.test(label);
      if (!isStructural || unit !== 'm3') continue;
      rowsTotal++;
      // Heuristic: row has non-empty col W (idx 22) AND non-empty col Z (idx 25)
      if (r[22] && r[25]) rowsNeeding++;
    }
  }

  return new Response(
    JSON.stringify({
      rows_total: rowsTotal,
      rows_needing_expansion: rowsNeeding,
      blocks_referenced: blocksReferenced.size,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
