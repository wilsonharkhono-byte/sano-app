// SANO - datum-sync: who is calling, from a user's JWT.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6.1, §10.
// The function is deployed with --no-verify-jwt (the webhook presents a shared
// secret, not a JWT), so for the button and the import this is the only gate:
// getUser() through a client carrying the caller's own Authorization header
// (401), the project read under the caller's own RLS (404), then
// is_office_role() (admin, principal, estimator). A role check that errors is
// a refusal with its reason, never read as "not an office role" or as one.
// index.ts builds the real client; caller.test.ts drives the same code over a
// fake one.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallerCheck } from './handler.ts';

type Reply<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The three calls the check makes, as supabase-js answers them. */
export interface CallerClient {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: { message: string } | null }> };
  from(table: 'projects'): {
    select(columns: 'id'): { eq(column: 'id', value: string): { maybeSingle(): Reply<{ id: string }> } };
  };
  rpc(fn: 'is_office_role'): Reply<boolean>;
}

export function makeVerifyCaller(clientFor: (authHeader: string) => CallerClient) {
  return async function verifyCaller(authHeader: string, projectId: string): Promise<CallerCheck> {
    const caller = clientFor(authHeader);
    const { data: userData, error: authError } = await caller.auth.getUser();
    if (authError || !userData?.user) return { ok: false, status: 401, code: 'AUTH', error: 'Sesi tidak valid.' };

    const { data: visible, error: readError } = await caller.from('projects').select('id').eq('id', projectId).maybeSingle();
    if (readError) return { ok: false, status: 500, code: 'UNEXPECTED', error: `Proyek gagal dibaca: ${readError.message}` };
    if (!visible) {
      return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Proyek tidak ditemukan atau Anda tidak punya akses.' };
    }

    const office = await caller.rpc('is_office_role');
    if (office.error) {
      return { ok: false, status: 403, code: 'FORBIDDEN', error: `Peran Anda tidak dapat diperiksa: ${office.error.message}` };
    }
    return { ok: true, userId: userData.user.id, isOffice: office.data === true };
  };
}

/**
 * A supabase-js client as a CallerClient: the same three calls, spelled out
 * (the client's own types are too deep to check structurally).
 */
export function supabaseCallerClient(client: SupabaseClient): CallerClient {
  return {
    auth: { getUser: () => client.auth.getUser() },
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => ({ maybeSingle: () => client.from(table).select(columns).eq(column, value).maybeSingle() }),
      }),
    }),
    rpc: (fn) => client.rpc(fn),
  };
}
