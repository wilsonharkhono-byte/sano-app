// SANO - The RLS read-back idiom (CLAUDE.md §12).
//
// Under RLS a filtered UPDATE is not an error: PostgREST matches zero rows
// and Supabase reports error null. Every single-row patcher in this codebase
// (updateRoom, updateGateRef, updateGateStepRef, setProjectPhase) selects the
// row back and treats a null row as the refusal it is, rather than reporting
// a success that did not happen. This is the shared implementation.
//
// `table` and `columns` are plain `string` here, not literals, so
// supabase-js's select-string parser cannot infer a row shape from them and
// types `data` as `GenericStringError | null` (see the ROOM_COLUMNS comment
// in tools/rooms.ts). Casting THAT to a concrete interface (`as Room`) fails
// tsc with TS2352, but casting to this function's own unconstrained `T` does
// not: TypeScript does not apply the overlap check to a bare type parameter.
// Verified 2026-09-11 against supabase-js 2.100; callers still get `data`
// narrowed to the real row type.
import { supabase } from './supabase';

export async function readBackUpdate<T>(
  table: string,
  patch: Record<string, unknown>,
  keyColumn: string,
  keyValue: string,
  columns: string,
  refusalMessage: string,
): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase
    .from(table)
    .update(patch)
    .eq(keyColumn, keyValue)
    .select(columns)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: refusalMessage };
  return { data: data as T };
}
