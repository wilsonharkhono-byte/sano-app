// The service-role store's own queries, read off the requests supabase-js
// builds. The fetch below answers from memory: no host is ever contacted.

import { assertEquals } from 'std/assert';
import { createClient } from '@supabase/supabase-js';
import { makeSupabaseStore } from './store.ts';

type Seen = { method: string; url: URL; headers: Headers; body: unknown };

function capturingStore(answer: (seen: Seen) => { body: unknown; headers?: Record<string, string> }) {
  const seen: Seen[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const s: Seen = {
      method: init?.method ?? 'GET',
      url,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(s);
    const a = answer(s);
    return Promise.resolve(new Response(JSON.stringify(a.body), { status: 200, headers: { 'content-type': 'application/json', ...a.headers } }));
  };
  const client = createClient('http://store.test', 'service-role-test-key', {
    auth: { persistSession: false },
    global: { fetch: fetchImpl as typeof fetch },
  });
  return { store: makeSupabaseStore(client), seen };
}

Deno.test('listEscalationDue filters on the room link in the query itself, and reads the total from the count', async () => {
  const row = {
    id: 'e1', title: 'Pilih keramik', summary: null, due_date: '2026-10-01', confirmed_at: '2026-09-20T00:00:00Z',
    rooms: { room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', datum_area_id: 'a1' },
    reporter: { full_name: 'Budi', datum_staff_id: 's1' }, confirmer: null, owner: { full_name: 'Budi' },
  };
  const { store, seen } = capturingStore(() => ({ body: [row], headers: { 'content-range': '0-0/25' } }));

  const linked = await store.listEscalationDue('p1', 'linked', 20);
  assertEquals(linked.total, 25);
  assertEquals(linked.rows[0].room_datum_area_id, 'a1');
  assertEquals(linked.rows[0].room_code, 'LT1-KM-1');
  const q = seen[0].url.searchParams;
  assertEquals(seen[0].url.pathname, '/rest/v1/site_events');
  assertEquals(q.get('rooms.datum_area_id'), 'not.is.null');
  assertEquals(q.get('select')?.includes('rooms!inner(room_code,room_name,datum_area_id)'), true);
  assertEquals([q.get('project_id'), q.get('status'), q.get('event_type'), q.get('confirmed_at'), q.get('datum_card_id')], [
    'eq.p1', 'eq.open', 'eq.butuh_keputusan', 'not.is.null', 'is.null',
  ]);
  assertEquals([q.get('order'), q.get('limit')], ['confirmed_at.asc', '20']);
  assertEquals(seen[0].headers.get('Prefer')?.includes('count=exact'), true);

  await store.listEscalationDue('p1', 'unlinked', 20);
  assertEquals(seen[1].url.searchParams.get('rooms.datum_area_id'), 'is.null');
});

Deno.test('closeStaleRuns closes only this project\'s old open runs and hands back each with its request', async () => {
  const { store, seen } = capturingStore(() => ({ body: [{ id: 'run-dead', request_id: 'req-1' }, { id: 'run-manual', request_id: null }] }));
  const swept = await store.closeStaleRuns('p1', '2026-09-27T02:50:00.000Z', '2026-09-27T03:00:00.000Z');
  assertEquals(swept, [{ runId: 'run-dead', requestId: 'req-1' }, { runId: 'run-manual', requestId: null }]);
  const q = seen[0].url.searchParams;
  assertEquals([seen[0].method, seen[0].url.pathname], ['PATCH', '/rest/v1/datum_sync_runs']);
  assertEquals([q.get('project_id'), q.get('finished_at'), q.get('started_at'), q.get('select')], [
    'eq.p1', 'is.null', 'lt.2026-09-27T02:50:00.000Z', 'id,request_id',
  ]);
  assertEquals(seen[0].body, { finished_at: '2026-09-27T03:00:00.000Z', ok: false, error: 'Sinkron terputus sebelum selesai.' });
});
