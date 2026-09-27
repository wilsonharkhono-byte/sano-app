import { assertEquals } from 'std/assert';
import { datumFailureSentence, makeDatumApi, type DatumEscalateBody } from './datum.ts';
import { fakeDatum, fakeUuid } from './testing.ts';

Deno.test('every call sends the bearer and reaches the route under /api/integrations/sano', async () => {
  const datum = fakeDatum({ projects: [{ id: fakeUuid('d', 1), project_code: 'K2-7', project_name: 'Citraland' }] });
  const api = makeDatumApi({ baseUrl: 'https://datum.test///', secret: 'datum-secret', fetch: datum.fetch });
  const areas = await api.getAreas(' k2-7 ');
  assertEquals(areas.ok, true);
  await api.getGateStatus('K2-7');
  await api.getStaff();
  await api.postAreas('K2-7', [{ area_code: 'A-1', area_name: 'A', floor: null, area_type: 'general', tracked: true }]);
  assertEquals(datum.state.calls.map((c) => `${c.method} ${c.path}`), ['GET areas', 'GET gate-status', 'GET staff', 'POST areas']);
  assertEquals(datum.state.calls[3].body, {
    project_code: 'K2-7',
    areas: [{ area_code: 'A-1', area_name: 'A', floor: null, area_type: 'general', tracked: true }],
  });
});

Deno.test('a wrong secret reads as the 401 sentence', async () => {
  const datum = fakeDatum();
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 'wrong', fetch: datum.fetch });
  const r = await api.getStaff();
  assertEquals(r, { ok: false, status: 401, code: 'UNAUTHORIZED', error: 'DATUM menolak kunci integrasi (401).' });
});

Deno.test('an unknown project code reads as its own sentence', async () => {
  const datum = fakeDatum();
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 'datum-secret', fetch: datum.fetch });
  const r = await api.getAreas('ZZ-1');
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, 'Kode proyek DATUM ZZ-1 tidak ditemukan di DATUM.');
});

Deno.test('a slow DATUM times out with the 15-second sentence, and a dead one names the network error', async () => {
  const hang: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
    });
  const slow = makeDatumApi({ baseUrl: 'https://datum.test', secret: 's', fetch: hang, timeoutMs: 20 });
  assertEquals(await slow.getStaff(), { ok: false, status: 0, code: 'TIMEOUT', error: 'DATUM tidak menjawab dalam 15 detik.' });

  const dead: typeof fetch = () => Promise.reject(new TypeError('connection refused'));
  const down = makeDatumApi({ baseUrl: 'https://datum.test', secret: 's', fetch: dead });
  assertEquals(await down.getStaff(), { ok: false, status: 0, code: 'NETWORK', error: 'DATUM tidak dapat dihubungi: connection refused' });
});

Deno.test('a non-JSON or not-ok answer is a failure with the status and code, never data', async () => {
  const html: typeof fetch = () => Promise.resolve(new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }));
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 's', fetch: html });
  assertEquals(await api.getStaff(), { ok: false, status: 502, code: 'HTTP_502', error: 'DATUM menjawab 502 HTTP_502: Bad Gateway' });
  assertEquals(datumFailureSentence(503, 'NOT_CONFIGURED', 'SANO_INTEGRATION_STAFF_ID belum diisi'), 'DATUM belum siap untuk SANO (503): SANO_INTEGRATION_STAFF_ID belum diisi');
});

Deno.test('the fake DATUM refuses what the real routes refuse, so the run tests cannot pass on a body DATUM would reject', async () => {
  const datum = fakeDatum({
    projects: [{ id: fakeUuid('d', 1), project_code: 'K2-7', project_name: 'Citraland' }, { id: fakeUuid('d', 2), project_code: 'X-1', project_name: 'Lain' }],
    areas: [
      { id: fakeUuid('a', 1), project_id: fakeUuid('d', 1), area_code: 'A-1', area_name: 'A', floor: null, area_type: 'general', sort_order: 0, tracked: true },
      { id: fakeUuid('a', 2), project_id: fakeUuid('d', 2), area_code: 'B-1', area_name: 'B', floor: null, area_type: 'general', sort_order: 0, tracked: true },
    ],
  });
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 'datum-secret', fetch: datum.fetch });
  const good: DatumEscalateBody = {
    project_code: 'K2-7', area_id: fakeUuid('a', 1), sano_event_id: fakeUuid('e', 1), sano_url: 'https://sano-app.vercel.app/r/P/A-1',
    title: 'Pilih keramik', summary: null, room_name: 'Kamar', reporter_name: '', confirmer_name: null, owner_name: '',
    due_date: '2026-10-01', confirmed_at: '2026-09-20T00:00:00.000Z', author_staff_id: null,
  };
  assertEquals((await api.escalate(good)).ok, true);
  const refused = async (over: Partial<DatumEscalateBody>) => {
    const r = await api.escalate({ ...good, sano_event_id: fakeUuid('e', 9), ...over });
    return r.ok ? 'accepted' : `${r.status} ${r.code}`;
  };
  assertEquals(await refused({ area_id: 'area-1' }), '400 BAD_REQUEST');
  assertEquals(await refused({ sano_event_id: 'ev-1' }), '400 BAD_REQUEST');
  assertEquals(await refused({ author_staff_id: 'staff-1' }), '400 BAD_REQUEST');
  assertEquals(await refused({ due_date: '1 Okt 2026' }), '400 BAD_REQUEST');
  assertEquals(await refused({ title: 'x'.repeat(81) }), '400 BAD_REQUEST');
  assertEquals(await refused({ title: '   ' }), '400 BAD_REQUEST');
  assertEquals(await refused({ room_name: '' }), '400 BAD_REQUEST');
  assertEquals(await refused({ summary: 's'.repeat(301) }), '400 BAD_REQUEST');
  assertEquals(await refused({ area_id: fakeUuid('a', 2) }), '404 UNKNOWN_AREA');
  assertEquals(await refused({ project_code: ' ' }), '400 BAD_REQUEST');
  datum.state.systemStaffId = '';
  assertEquals(await refused({}), '503 NOT_CONFIGURED');

  const item = { area_code: 'A-2', area_name: 'Dua', floor: null, area_type: 'general', tracked: true };
  const many = Array.from({ length: 201 }, (_, i) => ({ ...item, area_code: `N-${i}` }));
  const tooMany = await api.postAreas('K2-7', many);
  assertEquals(tooMany.ok ? 'accepted' : `${tooMany.status} ${tooMany.code}`, '400 BAD_REQUEST');
  const items = await api.postAreas('K2-7', [
    item,
    { ...item, area_code: 'a 3' },
    { ...item, area_code: 'A-4', area_type: 'balcony' },
    { ...item, area_code: 'A-5', area_name: 'n'.repeat(121) },
    { ...item, area_code: 'A-6', floor: 'f'.repeat(41) },
  ]);
  assertEquals(items.ok && { areas: items.data.areas, errors: items.data.errors }, {
    areas: [{ area_code: 'A-2', id: fakeUuid('b', 1), created: true }],
    errors: [
      { area_code: 'a 3', code: 'CODE_NOT_NORMALIZED' },
      { area_code: 'A-4', code: 'INVALID' },
      { area_code: 'A-5', code: 'INVALID' },
      { area_code: 'A-6', code: 'INVALID' },
    ],
  });
  const blank = await api.getAreas('  ');
  assertEquals(blank.ok ? 'accepted' : `${blank.status} ${blank.code}`, '400 BAD_REQUEST');
});
