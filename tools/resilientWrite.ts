// Resilient batch writer: write rows in chunks, and if a chunk is rejected,
// retry it row-by-row so a single bad row only quarantines itself instead of
// sinking the whole batch and leaving the baseline empty.
//
// `write` runs the underlying query for a batch and returns its {data, error};
// the caller controls insert-vs-upsert and any .select(). Storage-agnostic on
// purpose (no Supabase import) so it stays unit-testable in isolation.
//
// Returns the rows that landed (concatenated `data`) and the rows that failed
// with their error — so the omission is visible, never silent
// (CLAUDE.md §1.1: surface what didn't make it rather than fail everything).

export interface ResilientWriteResult<TRow, TOut> {
  inserted: TOut[];
  failed: Array<{ row: TRow; error: string }>;
}

export async function resilientWrite<TRow, TOut = unknown>(
  rows: TRow[],
  write: (batch: TRow[]) => PromiseLike<{ data: TOut[] | null; error: { message: string } | null }>,
  opts: { chunkSize?: number } = {},
): Promise<ResilientWriteResult<TRow, TOut>> {
  const chunkSize = opts.chunkSize ?? 200;
  const inserted: TOut[] = [];
  const failed: Array<{ row: TRow; error: string }> = [];

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { data, error } = await write(chunk);
    if (!error) {
      if (Array.isArray(data)) inserted.push(...data);
      continue;
    }
    // Chunk rejected — isolate the offender(s) by retrying each row alone.
    for (const row of chunk) {
      const { data: d1, error: e1 } = await write([row]);
      if (e1) failed.push({ row, error: e1.message });
      else if (Array.isArray(d1)) inserted.push(...d1);
    }
  }
  return { inserted, failed };
}
