/**
 * Supabase Query Helpers
 *
 * Shared patterns for common Supabase operations.
 * Reduces boilerplate in tool files by extracting:
 * - Table/view selects with filtering and ordering
 * - RPC calls with numeric results
 * - RPC calls with structured error handling
 */

import { supabase } from './supabase';

/**
 * Fetch all rows from a table or view filtered by a single column, ordered by another.
 * Returns empty array on null/error.
 *
 * @example
 * const kasbon = await fetchAllByField<Kasbon>(
 *   'mandor_kasbon',
 *   'contract_id',
 *   contractId,
 *   'kasbon_date'
 * );
 */
export async function fetchAllByField<T = any>(
  table: string,
  filterField: string,
  filterValue: string,
  orderField: string,
  ascending: boolean = false,
): Promise<T[]> {
  const { data } = await supabase
    .from(table)
    .select('*')
    .eq(filterField, filterValue)
    .order(orderField, { ascending });
  return data ?? [];
}

/**
 * Page through a query that may return more than Supabase's default 1000-row
 * cap, returning ALL rows. `buildPage(from, to)` must apply `.range(from, to)`
 * (and a stable `.order(...)`) to a fresh query each call, so pages don't
 * overlap or drift. Stops when a page comes back short (or empty). Throws on a
 * query error instead of silently returning a truncated set — a truncated
 * material/cost rollup is a wrong number, which the truth contract forbids.
 *
 * Use this for any select whose result set can exceed 1000 rows (e.g. ahs_lines
 * for a large baseline). `fetchAllByField` does NOT paginate, despite the name.
 *
 * @example
 * const lines = await fetchAllPaged((from, to) =>
 *   supabase.from('ahs_lines').select('*')
 *     .eq('ahs_version_id', id).order('id', { ascending: true }).range(from, to));
 */
export async function fetchAllPaged<T = any>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message ?? 'fetchAllPaged query failed');
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

/**
 * Call a Supabase RPC and return the numeric result (0 on error/null).
 * Useful for aggregates like sums, counts, etc.
 *
 * @example
 * const total = await rpcNumeric('get_unsettled_kasbon_total', {
 *   p_contract_id: contractId
 * });
 */
export async function rpcNumeric(
  fnName: string,
  params: Record<string, unknown>,
): Promise<number> {
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) return 0;
  return data ?? 0;
}

/**
 * Call a Supabase RPC and return { data, error } with error as string | undefined.
 * Converts Supabase error object to string message.
 *
 * @example
 * const result = await rpcWithError<Kasbon>('request_kasbon', {
 *   p_contract_id: contractId,
 *   p_amount: amount,
 *   p_reason: reason
 * });
 * if (result.error) {
 *   console.error('Failed:', result.error);
 * } else {
 *   console.log('Created:', result.data);
 * }
 */
export async function rpcWithError<T = any>(
  fnName: string,
  params: Record<string, unknown>,
): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) return { error: error.message };
  return { data: data as T };
}

/**
 * Alias for fetchAllByField with clearer name for views.
 * Same behavior: fetch all rows from a view filtered and ordered.
 */
export const fetchView = fetchAllByField;
