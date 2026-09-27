import { assertEquals } from 'std/assert';
import { datumFailureSentence, makeDatumApi } from './datum.ts';
import { fakeDatum } from './testing.ts';

Deno.test('every call sends the bearer and reaches the route under /api/integrations/sano', async () => {
  const datum = fakeDatum({ projects: [{ id: 'dp', project_code: 'K2-7', project_name: 'Citraland' }] });
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
