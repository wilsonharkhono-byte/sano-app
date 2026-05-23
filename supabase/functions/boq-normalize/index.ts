import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import * as XLSX from 'xlsx';

interface NormalizeBody { storage_path: string; }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY missing' }), { status: 500 });
  }

  const { storage_path } = (await req.json()) as NormalizeBody;
  const { data, error } = await supabase.storage.from('project-files').download(storage_path);
  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? 'not found' }), { status: 404 });
  }

  const startedAt = Date.now();
  const inBuf = new Uint8Array(await data.arrayBuffer());

  // STUB: For phase-6 ship-readiness, the Edge Function returns a stub response.
  // The full Node→Deno port of `tools/normalizer/index.ts` and its dependencies
  // lands in Task 28 (`feat(edge): finish boq-normalize port — shared core runs on Node + Deno`).
  // The current stub preserves the API contract (returns a normalized_path even
  // though the actual normalization is not yet performed in this environment).
  const wb = XLSX.read(inBuf, { cellFormula: true });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Recipe Index'], ['(empty — Edge Function port in progress)']]),
    'Recipe Index',
  );
  const outBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  const outPath = storage_path.replace(/\.xlsx$/i, '_normalized.xlsx');
  const upload = await supabase.storage.from('project-files').upload(outPath, outBuf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });
  if (upload.error) {
    return new Response(JSON.stringify({ error: upload.error.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      normalized_path: outPath,
      summary: {
        rows_normalized: 0,
        rows_skipped: 0,
        rows_with_mismatch: 0,
        blocks_analyzed: 0,
        blocks_from_cache: 0,
        elapsed_ms: Date.now() - startedAt,
      },
      warnings: [{
        code: 'EDGE_PORT_IN_PROGRESS',
        message: 'Edge Function shipping with stub orchestration; full port in Task 28.',
      }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
