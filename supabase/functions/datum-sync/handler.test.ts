import { assertEquals } from 'std/assert';
import { FORBIDDEN_IMPORT, FORBIDDEN_SYNC, bearerMatches, createHandler, type CallerCheck, type HandlerDeps } from './handler.ts';
import { importBadCode } from './plan.ts';
import { PAIRING_MISSING, SYNC_RUNNING } from './run.ts';
import { DATUM_PROJECT_ID, NOW, PROJECT_ID, fakeUuid, world } from './testing.ts';

const WEBHOOK_SECRET = 'webhook-secret';
const AREA_TERAS = fakeUuid('a', 2);
const AREA_LONG = fakeUuid('a', 3);
const AREA_BAD = fakeUuid('a', 4);
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

/** Callers by token, as verifyCaller would find them through getUser() and is_office_role(). */
const CALLERS: Record<string, CallerCheck> = {
  'Bearer jwt-admin': { ok: true, userId: 'u-adm', isOffice: true },
  'Bearer jwt-principal': { ok: true, userId: 'u-pri', isOffice: true },
  'Bearer jwt-estimator': { ok: true, userId: 'u-est', isOffice: true },
  'Bearer jwt-supervisor': { ok: true, userId: 'u-sup', isOffice: false },
};

function setup(over: Partial<HandlerDeps> = {}) {
  const w = world();
  const pending: Promise<unknown>[] = [];
  let contexts = 0;
  const deps: HandlerDeps = {
    configured: true,
    webhookSecret: WEBHOOK_SECRET,
    verifyCaller: (auth) => Promise.resolve(CALLERS[auth] ?? { ok: false, status: 401, code: 'AUTH', error: 'Sesi tidak valid.' }),
    openContext: () => {
      contexts += 1;
      return w.ctx;
    },
    waitUntil: (work) => {
      pending.push(work);
    },
    ...over,
  };
  const handle = createHandler(deps);
  const call = (auth: string | null, body: unknown, method = 'POST') =>
    handle(new Request('https://fn.test/datum-sync', {
      method,
      headers: auth === null ? {} : { Authorization: auth },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }));
  return { w, call, pending, contexts: () => contexts };
}

const webhookBody = { type: 'INSERT', table: 'datum_sync_requests', record: { id: REQUEST_ID, project_id: PROJECT_ID } };

Deno.test('bearerMatches compares exactly "Bearer <secret>" and never opens on an empty secret', async () => {
  assertEquals(await bearerMatches(`Bearer ${WEBHOOK_SECRET}`, WEBHOOK_SECRET), true);
  assertEquals(await bearerMatches(`Bearer ${WEBHOOK_SECRET}x`, WEBHOOK_SECRET), false);
  assertEquals(await bearerMatches(WEBHOOK_SECRET, WEBHOOK_SECRET), false);
  assertEquals(await bearerMatches('Bearer ', ''), false);
});

Deno.test('the webhook secret takes the cron path: 202 while the run is still going, which then finishes in waitUntil and marks its request', async () => {
  const s = setup();
  s.w.store.requests.push({ id: REQUEST_ID, handled_at: null, run_id: null, error: null });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  s.w.datum.state.beforeReply = () => held;

  const res = await s.call(`Bearer ${WEBHOOK_SECRET}`, webhookBody);
  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body.code, 'ACCEPTED');
  const run = s.w.store.runs.find((r) => r.id === body.runId)!;
  assertEquals([run.finished_at, run.started_at], [null, NOW]);
  assertEquals(s.pending.length, 1);

  release();
  await Promise.all(s.pending);
  assertEquals([run.source, run.requested_by, run.request_id, run.ok, run.finished_at], ['cron', null, REQUEST_ID, true, NOW]);
  assertEquals(s.w.store.requests[0], { id: REQUEST_ID, handled_at: NOW, run_id: body.runId, error: null });
});

Deno.test('a webhook body that is not a datum_sync_requests INSERT is 400', async () => {
  const s = setup();
  const res = await s.call(`Bearer ${WEBHOOK_SECRET}`, { type: 'UPDATE', table: 'datum_sync_requests', record: webhookBody.record });
  assertEquals(res.status, 400);
  assertEquals(s.contexts(), 0);
});

Deno.test('a wrong or unset webhook secret falls to the JWT path: a webhook body is no sync request (400), a sync request is 401', async () => {
  const wrong = setup();
  assertEquals((await wrong.call('Bearer not-the-secret', webhookBody)).status, 400);
  assertEquals((await wrong.call('Bearer not-the-secret', { projectId: PROJECT_ID })).status, 401);
  const unset = setup({ webhookSecret: '' });
  const res = await unset.call('Bearer ', webhookBody);
  assertEquals(res.status, 400);
  assertEquals((await unset.call('Bearer ', { projectId: PROJECT_ID })).status, 401);
  assertEquals(unset.contexts(), 0);
});

Deno.test('Sinkron DATUM is open to every office role and refused to a supervisor', async () => {
  for (const token of ['Bearer jwt-admin', 'Bearer jwt-principal', 'Bearer jwt-estimator']) {
    const s = setup();
    const res = await s.call(token, { projectId: PROJECT_ID });
    assertEquals(res.status, 200, token);
    const report = await res.json();
    assertEquals(report.ok, true);
    assertEquals(s.w.store.runs[0].source, 'manual');
  }
  const s = setup();
  const res = await s.call('Bearer jwt-supervisor', { projectId: PROJECT_ID });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { ok: false, code: 'FORBIDDEN', error: FORBIDDEN_SYNC });
  assertEquals(s.contexts(), 0);
});

Deno.test('the import is open to every office role, refused to a supervisor, and checks its codes', async () => {
  const s = setup();
  s.w.datum.state.areas.push({ id: AREA_TERAS, project_id: DATUM_PROJECT_ID, area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 3, tracked: true });
  const ok = await s.call('Bearer jwt-estimator', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['LT2-TERAS'] });
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).counts.rooms_imported, 1);
  assertEquals(s.w.store.runs[0].source, 'import');

  const sup = await s.call('Bearer jwt-supervisor', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['LT2-TERAS'] });
  assertEquals(sup.status, 403);
  assertEquals((await sup.json()).error, FORBIDDEN_IMPORT);

  for (const areaCodes of [[], Array.from({ length: 501 }, (_, i) => `A-${i}`), ['x'.repeat(201)], [''], [7], 'LT2-TERAS']) {
    assertEquals((await s.call('Bearer jwt-admin', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes })).status, 400);
  }
});

Deno.test('one long or unusable DATUM code no longer refuses the import: up to 500 codes of up to 200 characters, each judged alone', async () => {
  const s = setup();
  const long = `LT2 ${'kamar tidur utama dengan walk in closet '.repeat(4)}`.slice(0, 200);
  const unusable = '/'.repeat(150);
  s.w.datum.state.areas.push(
    { id: AREA_TERAS, project_id: DATUM_PROJECT_ID, area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 3, tracked: true },
    { id: AREA_LONG, project_id: DATUM_PROJECT_ID, area_code: long, area_name: 'Kamar utama', floor: 'Lt. 2', area_type: 'bedroom', sort_order: 4, tracked: true },
    { id: AREA_BAD, project_id: DATUM_PROJECT_ID, area_code: unusable, area_name: 'Tanpa kode', floor: null, area_type: 'general', sort_order: 5, tracked: true },
  );
  const filler = Array.from({ length: 497 }, (_, i) => `GONE-${i}`);
  const res = await s.call('Bearer jwt-estimator', {
    projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['LT2-TERAS', long, unusable, ...filler],
  });
  assertEquals(res.status, 200);
  const report = await res.json();
  assertEquals(report.counts.steps.import, 'ok');
  assertEquals(report.counts.rooms_imported, 2);
  assertEquals(s.w.store.rooms.find((r) => r.datum_area_id === AREA_LONG)?.room_code, 'LT2-KAMAR-TIDUR-UTAMA-DENGAN-WALK-IN-CLO');
  assertEquals(report.differences.import_skipped[0], { area_code: unusable, reason: importBadCode(unusable) });
  assertEquals(report.differences.import_skipped.length, 1 + filler.length);
});

Deno.test('missing configuration is 500 CONFIG before anything else', async () => {
  const s = setup({ configured: false });
  const res = await s.call('Bearer jwt-admin', { projectId: PROJECT_ID });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).code, 'CONFIG');
});

Deno.test('an unpaired project answers 409 PAIRING_MISSING and leaves a failed run row', async () => {
  const s = setup();
  s.w.store.projects[0].datum_project_code = null;
  const res = await s.call('Bearer jwt-admin', { projectId: PROJECT_ID });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals([body.code, body.error], ['PAIRING_MISSING', PAIRING_MISSING]);
  assertEquals(s.w.store.runs.map((r) => [r.id, r.ok, r.error]), [[body.runId, false, PAIRING_MISSING]]);
});

Deno.test('a run already open answers 409 SYNC_RUNNING to a sync, an import and the webhook alike', async () => {
  const s = setup();
  s.w.store.runs.push({
    id: 'run-open', project_id: PROJECT_ID, source: 'cron', requested_by: null, request_id: null,
    started_at: '2026-09-27T02:58:00.000Z', finished_at: null, ok: null, counts: { steps: {} }, differences: {}, error: null,
  });
  s.w.store.requests.push({ id: REQUEST_ID, handled_at: null, run_id: null, error: null });
  for (const body of [{ projectId: PROJECT_ID }, { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['X-1'] }]) {
    const res = await s.call('Bearer jwt-admin', body);
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { ok: false, code: 'SYNC_RUNNING', error: SYNC_RUNNING });
  }
  const hook = await s.call(`Bearer ${WEBHOOK_SECRET}`, webhookBody);
  assertEquals(hook.status, 409);
  assertEquals(s.w.store.requests[0].error, SYNC_RUNNING);
  assertEquals(s.w.store.requests[0].run_id, null);
});

Deno.test('a bad body, a bad projectId, no header and GET are refused before any work', async () => {
  const s = setup();
  assertEquals((await s.call('Bearer jwt-admin', { projectId: 'nope' })).status, 400);
  assertEquals((await s.call(null, { projectId: PROJECT_ID })).status, 401);
  assertEquals((await s.call('Bearer jwt-admin', null, 'GET')).status, 405);
  assertEquals(s.contexts(), 0);
});
