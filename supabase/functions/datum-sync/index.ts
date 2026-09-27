// SANO - datum-sync edge function.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6-§7.
// Plan: docs/superpowers/plans/2026-09-27-datum-sync.md (Lane F).
//
// POST { projectId }                                   "Sinkron DATUM" (any office role)
// POST { projectId, importDatumOnly: true, areaCodes } "Ambil {n} ruangan dari DATUM" (any office role)
// POST <Database Webhook body for datum_sync_requests>  the hourly pg_cron request
//
// Deploy with --no-verify-jwt: the webhook presents WEBHOOK_AUTH_SECRET, not a
// JWT, so the gateway's own check would refuse it. handler.ts checks both
// paths before any service-role work.
//
// Secrets (supabase secrets set): DATUM_API_BASE_URL (DATUM's origin),
// DATUM_SANO_SECRET (the same value as DATUM's SANO_INTEGRATION_SECRET),
// WEBHOOK_AUTH_SECRET (already set for send-push-notification). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY come from the runtime.
//
// Deno tests: `cd supabase/functions/datum-sync && deno test`. CI does not run
// them; they are a release step.

import { createClient } from '@supabase/supabase-js';
import { createHandler, type CallerCheck } from './handler.ts';
import { makeDatumApi } from './datum.ts';
import { makeSupabaseStore } from './store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const DATUM_API_BASE_URL = Deno.env.get('DATUM_API_BASE_URL') ?? '';
const DATUM_SANO_SECRET = Deno.env.get('DATUM_SANO_SECRET') ?? '';
const WEBHOOK_AUTH_SECRET = Deno.env.get('WEBHOOK_AUTH_SECRET') ?? '';

async function verifyCaller(authHeader: string, projectId: string): Promise<CallerCheck> {
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: authError } = await caller.auth.getUser();
  if (authError || !userData?.user) return { ok: false, status: 401, code: 'AUTH', error: 'Sesi tidak valid.' };
  const { data: visible } = await caller.from('projects').select('id').eq('id', projectId).maybeSingle();
  if (!visible) {
    return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Proyek tidak ditemukan atau Anda tidak punya akses.' };
  }
  const office = await caller.rpc('is_office_role');
  return { ok: true, userId: userData.user.id, isOffice: office.data === true };
}

type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil(work: Promise<unknown>): void } };

export const handle = createHandler({
  configured: !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATUM_API_BASE_URL && DATUM_SANO_SECRET),
  webhookSecret: WEBHOOK_AUTH_SECRET,
  verifyCaller,
  openContext: () => ({
    store: makeSupabaseStore(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })),
    datum: makeDatumApi({ baseUrl: DATUM_API_BASE_URL, secret: DATUM_SANO_SECRET, fetch }),
    now: () => new Date(),
  }),
  waitUntil: (work) => {
    const runtime = (globalThis as unknown as EdgeRuntimeGlobal).EdgeRuntime;
    if (runtime) runtime.waitUntil(work);
  },
});

if (import.meta.main) {
  Deno.serve(handle);
}
