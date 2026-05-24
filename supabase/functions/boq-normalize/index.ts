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

  // STUB. The full Node→Deno port of `tools/normalizer/index.ts` is deferred —
  // the Node implementation depends on `process.env`, `Buffer`, and several
  // transitive imports that need a Deno-compatible runtime shim or a bundling
  // step (esbuild → single-file ES module) before this Edge Function can run
  // the real orchestration.
  //
  // Path forward (follow-up work, tracked in docs/boq-normalizer-rollout-checklist.md):
  //   1. Extract the orchestration body of `tools/normalizer/index.ts` into a
  //      runtime-neutral `core.ts` that accepts the flag and any I/O via
  //      injected dependencies (no direct process.env / Buffer references).
  //   2. Update parseBoqV2 to accept an explicit `recipeDetailEnabled` option
  //      instead of reading `process.env`.
  //   3. Configure esbuild to bundle the Node implementation into a single ES
  //      module the Deno function can `import` via a relative path.
  //   4. Replace this stub body with a `normalizeWorkbookCore(...)` call.
  //
  // Until then, the stub preserves the API contract: returns a `normalized_path`
  // and `EDGE_PORT_IN_PROGRESS` warning. Callers must use the in-process
  // Node normalizer (e.g., a server-side script) during the rollout window.
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
        message: 'Edge Function shipping with stub orchestration. Use the Node normalizer during rollout; see docs/boq-normalizer-rollout-checklist.md.',
      }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
