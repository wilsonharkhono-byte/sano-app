// The real sign-in check (makeVerifyCaller) behind the real handler, over a
// fake client that answers getUser, the project read under the caller's own
// permissions, and is_office_role as Supabase would for each token.

import { assertEquals } from 'std/assert';
import { createClient } from '@supabase/supabase-js';
import { makeVerifyCaller, supabaseCallerClient, type CallerClient } from './caller.ts';
import { FORBIDDEN_IMPORT, FORBIDDEN_SYNC, createHandler } from './handler.ts';
import { PROJECT_ID, world } from './testing.ts';

type Who = {
  user: { id: string } | null;
  authError?: string;
  /** Project ids this caller's RLS lets them read. */
  reads: string[];
  readError?: string;
  office: boolean | null;
  rpcError?: string;
};

const PEOPLE: Record<string, Who> = {
  'Bearer jwt-admin': { user: { id: 'u-adm' }, reads: [PROJECT_ID], office: true },
  'Bearer jwt-principal': { user: { id: 'u-pri' }, reads: [PROJECT_ID], office: true },
  'Bearer jwt-estimator': { user: { id: 'u-est' }, reads: [PROJECT_ID], office: true },
  'Bearer jwt-supervisor': { user: { id: 'u-sup' }, reads: [PROJECT_ID], office: false },
  'Bearer jwt-outsider': { user: { id: 'u-out' }, reads: [], office: true },
  'Bearer jwt-rpc-broken': { user: { id: 'u-rpc' }, reads: [PROJECT_ID], office: null, rpcError: 'function is_office_role() does not exist' },
  'Bearer jwt-db-broken': { user: { id: 'u-db' }, reads: [], readError: 'connection refused', office: true },
  'Bearer jwt-expired': { user: null, authError: 'JWT expired', reads: [PROJECT_ID], office: true },
};

function fakeClientFor(authHeader: string, calls: string[]): CallerClient {
  const who: Who = PEOPLE[authHeader] ?? { user: null, authError: 'invalid JWT', reads: [], office: null };
  const reply = <T>(data: T | null, error?: string) => Promise.resolve({ data, error: error ? { message: error } : null });
  return {
    auth: {
      getUser: () => {
        calls.push('getUser');
        return Promise.resolve({ data: { user: who.user }, error: who.authError ? { message: who.authError } : null });
      },
    },
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => ({
          maybeSingle: () => {
            calls.push(`${table}.select(${columns}).eq(${column})`);
            if (who.readError) return reply<{ id: string }>(null, who.readError);
            return reply(who.reads.includes(value) ? { id: value } : null);
          },
        }),
      }),
    }),
    rpc: (fn) => {
      calls.push(`rpc(${fn})`);
      return reply(who.office, who.rpcError);
    },
  };
}

function setup() {
  const w = world();
  const calls: string[] = [];
  const clientHeaders: string[] = [];
  const verifyCaller = makeVerifyCaller((authHeader) => {
    clientHeaders.push(authHeader);
    return fakeClientFor(authHeader, calls);
  });
  const handle = createHandler({
    configured: true,
    webhookSecret: 'webhook-secret',
    verifyCaller,
    openContext: () => w.ctx,
    waitUntil: () => {},
  });
  const call = async (auth: string, body: unknown) => {
    const res = await handle(new Request('https://fn.test/datum-sync', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { w, calls, clientHeaders, verifyCaller, call };
}

Deno.test('a bad or expired token is 401 before the project is read', async () => {
  for (const token of ['Bearer not-a-jwt', 'Bearer jwt-expired']) {
    const s = setup();
    const res = await s.call(token, { projectId: PROJECT_ID });
    assertEquals([res.status, res.body.code, res.body.error], [401, 'AUTH', 'Sesi tidak valid.'], token);
    assertEquals(s.calls, ['getUser'], token);
    assertEquals(s.w.store.runs, [], token);
  }
});

Deno.test("a project the caller's own permissions cannot read is 404; a failed read says so", async () => {
  const s = setup();
  const res = await s.call('Bearer jwt-outsider', { projectId: PROJECT_ID });
  assertEquals([res.status, res.body.code], [404, 'NOT_FOUND']);
  assertEquals(s.calls, ['getUser', 'projects.select(id).eq(id)']);
  assertEquals(s.clientHeaders, ['Bearer jwt-outsider']);

  const broken = setup();
  const failed = await broken.call('Bearer jwt-db-broken', { projectId: PROJECT_ID });
  assertEquals([failed.status, failed.body.code, failed.body.error], [500, 'UNEXPECTED', 'Proyek gagal dibaca: connection refused']);
  assertEquals(broken.w.store.runs, []);
});

Deno.test('a role check that errors is 403 with its reason, never read as an office role', async () => {
  const s = setup();
  const res = await s.call('Bearer jwt-rpc-broken', { projectId: PROJECT_ID });
  assertEquals([res.status, res.body.code], [403, 'FORBIDDEN']);
  assertEquals(res.body.error, 'Peran Anda tidak dapat diperiksa: function is_office_role() does not exist');
  assertEquals(s.w.store.runs, []);
});

Deno.test('a supervisor is 403 for a sync and an import alike', async () => {
  const s = setup();
  const sync = await s.call('Bearer jwt-supervisor', { projectId: PROJECT_ID });
  assertEquals([sync.status, sync.body.error], [403, FORBIDDEN_SYNC]);
  const imp = await s.call('Bearer jwt-supervisor', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['LT2-TERAS'] });
  assertEquals([imp.status, imp.body.error], [403, FORBIDDEN_IMPORT]);
  assertEquals(s.calls, ['getUser', 'projects.select(id).eq(id)', 'rpc(is_office_role)', 'getUser', 'projects.select(id).eq(id)', 'rpc(is_office_role)']);
  assertEquals(s.w.store.runs, []);
});

Deno.test('admin, principal and estimator pass, and the run is requested by the signed-in user', async () => {
  for (const [token, userId] of [['Bearer jwt-admin', 'u-adm'], ['Bearer jwt-principal', 'u-pri'], ['Bearer jwt-estimator', 'u-est']]) {
    const s = setup();
    assertEquals(await s.verifyCaller(token, PROJECT_ID), { ok: true, userId, isOffice: true }, token);
    const res = await s.call(token, { projectId: PROJECT_ID });
    assertEquals(res.status, 200, token);
    assertEquals(s.w.store.runs[0].requested_by, userId, token);
  }
});

Deno.test("the real client sends the caller's own token on all three calls (a capturing fetch; no host is contacted)", async () => {
  const seen: Array<{ method: string; path: string; auth: string | null }> = [];
  const office = { value: true as boolean };
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    seen.push({ method: init?.method ?? 'GET', path: `${url.pathname}${url.search}`, auth: new Headers(init?.headers).get('Authorization') });
    const body = url.pathname === '/auth/v1/user'
      ? { id: 'u-est', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
      : url.pathname === '/rest/v1/projects' ? [{ id: PROJECT_ID }] : office.value;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  const verify = makeVerifyCaller((authHeader) =>
    supabaseCallerClient(createClient('http://caller.test', 'anon-test-key', {
      global: { headers: { Authorization: authHeader }, fetch: fetchImpl as typeof fetch },
      auth: { persistSession: false },
    }))
  );
  assertEquals(await verify('Bearer jwt-estimator', PROJECT_ID), { ok: true, userId: 'u-est', isOffice: true });
  assertEquals(seen, [
    { method: 'GET', path: '/auth/v1/user', auth: 'Bearer jwt-estimator' },
    { method: 'GET', path: `/rest/v1/projects?select=id&id=eq.${PROJECT_ID}`, auth: 'Bearer jwt-estimator' },
    { method: 'POST', path: '/rest/v1/rpc/is_office_role', auth: 'Bearer jwt-estimator' },
  ]);
  office.value = false;
  assertEquals(await verify('Bearer jwt-supervisor', PROJECT_ID), { ok: true, userId: 'u-est', isOffice: false });
});
