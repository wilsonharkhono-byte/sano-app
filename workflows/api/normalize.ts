export interface ProbeArgs {
  storagePath: string;
  supabaseUrl: string;
  anonKey: string;
  fetch?: typeof fetch;
}
export interface ProbeResult {
  rows_total: number;
  rows_needing_expansion: number;
  blocks_referenced: number;
}

export async function probeBoq(args: ProbeArgs): Promise<ProbeResult> {
  const f = args.fetch ?? fetch;
  const url = `${args.supabaseUrl}/functions/v1/boq-probe`;
  const resp = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${args.anonKey}` },
    body: JSON.stringify({ storage_path: args.storagePath }),
  });
  if (!resp.ok) throw new Error(`probeBoq HTTP ${resp.status}: ${await resp.text()}`);
  return (await resp.json()) as ProbeResult;
}

export interface NormalizeArgs extends ProbeArgs {}
export interface NormalizeResult {
  normalized_path: string;
  summary: {
    rows_normalized: number;
    rows_skipped: number;
    rows_with_mismatch: number;
    blocks_analyzed: number;
    blocks_from_cache: number;
    elapsed_ms: number;
  };
  warnings: Array<{ code: string; message: string }>;
}

export async function normalizeBoq(args: NormalizeArgs): Promise<NormalizeResult> {
  const f = args.fetch ?? fetch;
  const url = `${args.supabaseUrl}/functions/v1/boq-normalize`;
  const resp = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${args.anonKey}` },
    body: JSON.stringify({ storage_path: args.storagePath }),
  });
  if (!resp.ok) throw new Error(`normalizeBoq HTTP ${resp.status}: ${await resp.text()}`);
  return (await resp.json()) as NormalizeResult;
}
