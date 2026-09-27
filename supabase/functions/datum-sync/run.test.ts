import { assert, assertEquals } from 'std/assert';
import { ESCALATE_AREA_UNKNOWN, ESCALATE_ROOM_UNLINKED, createGateSentence, IMPORT_GONE, importBadCode, importRaced } from './plan.ts';
import { AREAS_UNREAD, CREATE_DEFERRED, PAIRING_MISSING, RUN_INTERRUPTED, executeImport, executeSync, startRun, type RunRequest } from './run.ts';
import { AREA_KM1, DATUM_PROJECT_ID, NOW, PROJECT_ID, STAFF_BUDI, STAFF_SITI, decision, fakeUuid, newAreaId, world } from './testing.ts';

const STAFF_ANDI = fakeUuid('5', 3);
const STAFF_GONE = fakeUuid('5', 50);
const AREA_TERAS = fakeUuid('a', 2);
const AREA_LONG = fakeUuid('a', 3);
const AREA_RACE = fakeUuid('a', 4);
const AREA_DAPUR = fakeUuid('a', 5);

const manual: RunRequest = { projectId: PROJECT_ID, source: 'manual', requestedBy: 'u-siti', requestId: null };

async function sync(w: ReturnType<typeof world>, req: RunRequest = manual) {
  const started = await startRun(w.ctx, req);
  if (started.kind !== 'started') throw new Error(`run did not start: ${started.kind}`);
  return executeSync(w.ctx, started.runId, started.project, req);
}

async function importCodes(w: ReturnType<typeof world>, codes: string[]) {
  const req: RunRequest = { ...manual, source: 'import' };
  const started = await startRun(w.ctx, req);
  if (started.kind !== 'started') throw new Error(`run did not start: ${started.kind}`);
  return executeImport(w.ctx, started.runId, started.project, req, codes);
}

Deno.test('a first sync links, creates, caches gate status, links staff, and records every step ok', async () => {
  const w = world();
  const report = await sync(w);

  assertEquals(report.ok, true);
  assertEquals(report.error, null);
  assertEquals(report.counts.steps, { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' });
  assertEquals(report.counts.datum_project_name, 'Citraland K2-7 Sonny');
  assertEquals(w.store.rooms.map((r) => [r.room_code, r.datum_area_id !== null]), [['LT1-KM-1', true], ['LT1-DAPUR', true], ['UMUM', true]]);
  assertEquals(w.store.rooms[0].datum_area_id, AREA_KM1);
  assertEquals(report.counts.rooms_linked, 3);
  assertEquals(report.counts.rooms_linked_now, 3);
  assertEquals(report.counts.rooms_created, 2);

  const post = w.datum.state.calls.find((c) => c.method === 'POST' && c.path === 'areas');
  assertEquals(post?.body, {
    project_code: 'K2-7',
    areas: [
      { area_code: 'LT1-DAPUR', area_name: 'Dapur', floor: 'Lt. 1', area_type: 'kitchen', tracked: true },
      { area_code: 'UMUM', area_name: 'Area Umum', floor: null, area_type: 'general', tracked: false },
    ],
  });

  assertEquals(w.store.cache.map((c) => [c.room_id, c.gate_code, c.status, c.datum_stale, c.datum_area_id]), [
    ['room-km1', 'A', 'passed', false, AREA_KM1],
    ['room-km1', 'B', 'blocked', true, AREA_KM1],
  ]);
  assertEquals(w.store.cache[0].run_id, report.runId);
  assertEquals(report.counts.gate_rows, 2);
  // Every linked room's area was covered by this read, including the two just created.
  assertEquals(report.counts.gate_area_ids, [AREA_KM1, newAreaId(1), newAreaId(2)]);

  assertEquals(w.store.profiles.map((p) => [p.id, p.datum_staff_id]), [['u-budi', STAFF_BUDI], ['u-siti', STAFF_SITI], ['u-x', null]]);
  assertEquals(report.counts.staff, { linked: 2, linked_now: 2, unmatched: 1, ambiguous: 0, stale: 0 });
  assertEquals(report.differences.staff?.unmatched, [{ profile_id: 'u-x', full_name: 'Tak Dikenal' }]);

  const run = w.store.runs.find((r) => r.id === report.runId)!;
  assertEquals([run.ok, run.error, run.finished_at], [true, null, '2026-09-27T03:00:00.000Z']);
});

Deno.test('the plausibility gate refuses to create when no room matches a DATUM area, and says why', async () => {
  const w = world();
  w.datum.state.areas[0].area_code = 'LT9-LAIN';
  const report = await sync(w);
  assertEquals(report.counts.steps.create, 'skipped');
  assertEquals(report.counts.step_errors?.create, createGateSentence('Citraland K2-7 Sonny'));
  assertEquals(report.ok, false);
  assertEquals(report.error, createGateSentence('Citraland K2-7 Sonny'));
  assertEquals(w.datum.state.calls.some((c) => c.method === 'POST'), false);
  assertEquals(report.differences.datum_only, [{ area_code: 'LT9-LAIN', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom' }]);
});

Deno.test('a code edited in DATUM keeps the link: no second area, a code conflict, nothing listed as DATUM-only', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  w.datum.state.areas[0].area_code = 'LT1-KM-UTAMA';
  const report = await sync(w);
  const post = w.datum.state.calls.find((c) => c.method === 'POST' && c.path === 'areas');
  assertEquals((post?.body as { areas: Array<{ area_code: string }> }).areas.map((a) => a.area_code), ['LT1-DAPUR', 'UMUM']);
  assertEquals(w.store.rooms[0].datum_area_id, AREA_KM1);
  assertEquals(report.differences.field_conflicts, [{ room_code: 'LT1-KM-1', field: 'code', sano: 'LT1-KM-1', datum: 'LT1-KM-UTAMA' }]);
  assertEquals(report.differences.datum_only, undefined);
  assertEquals(report.counts.steps.create, 'ok');
});

Deno.test('rooms are created in batches of at most 200, as DATUM takes them, and every batch is linked', async () => {
  const w = world();
  for (let i = 0; i < 250; i++) {
    w.store.rooms.push({
      id: `room-x${i}`, project_id: PROJECT_ID, room_code: `LT2-R-${String(i).padStart(3, '0')}`, room_name: `Ruang ${i}`,
      floor: 'Lt. 2', area_type: 'general', sort_order: i, active: true, datum_area_id: null,
    });
  }
  const report = await sync(w);
  const posts = w.datum.state.calls.filter((c) => c.method === 'POST' && c.path === 'areas');
  assertEquals(posts.map((c) => (c.body as { areas: unknown[] }).areas.length), [200, 52]);
  assertEquals(report.counts.steps.create, 'ok');
  assertEquals(report.counts.rooms_created, 252);
  assertEquals(w.store.rooms.every((r) => r.datum_area_id !== null), true);
});

Deno.test('a DATUM project with no areas opens the gate: every active room is created', async () => {
  const w = world();
  w.datum.state.areas = [];
  const report = await sync(w);
  assertEquals(report.counts.steps.create, 'ok');
  assertEquals(report.counts.rooms_created, 3);
});

Deno.test('areas failing marks link and create, while gate_status, staff and escalate still run', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  decision(w.store);
  w.datum.state.failRoute = { areas: 500 };
  const report = await sync(w);
  assertEquals(report.counts.steps, { areas: 'error', link: 'skipped', create: 'skipped', gate_status: 'ok', staff: 'ok', escalate: 'ok' });
  assertEquals(report.counts.step_errors?.link, AREAS_UNREAD);
  assertEquals(report.error, 'DATUM menjawab 500 DB_ERROR: fake failure');
  assertEquals(report.counts.escalated, 1);
  assertEquals(report.counts.gate_rows, 2);
});

Deno.test('a wrong secret fails every DATUM step with the 401 sentence and writes nothing', async () => {
  const w = world();
  w.datum.state.secret = 'rotated';
  decision(w.store);
  const report = await sync(w);
  const sentence = 'DATUM menolak kunci integrasi (401).';
  assertEquals(report.counts.step_errors?.areas, sentence);
  assertEquals(report.counts.step_errors?.gate_status, sentence);
  assertEquals(report.counts.step_errors?.staff, sentence);
  assertEquals(w.store.rooms.every((r) => r.datum_area_id === null), true);
  assertEquals(w.store.cache, []);
  assertEquals(w.store.profiles.every((p) => p.datum_staff_id === null), true);
  assertEquals(w.store.events[0].datum_card_id, null);
});

Deno.test('an unknown DATUM code is named in the run', async () => {
  const w = world();
  w.store.projects[0].datum_project_code = 'ZZ-9';
  const report = await sync(w);
  assertEquals(report.error, 'Kode proyek DATUM ZZ-9 tidak ditemukan di DATUM.');
});

Deno.test("escalation authors by the reporter's link, else the confirmer's, else none, and sends both SANO names", async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  w.datum.state.staff.push({ id: STAFF_ANDI, full_name: 'Andi', active: true });
  w.store.profiles.push({ id: 'u-andi', full_name: 'Andi', datum_staff_id: null });
  w.store.profiles.push({ id: 'u-nolink', full_name: 'Orang Tanpa Tautan', datum_staff_id: null });
  const byReporter = decision(w.store, { reporter_id: 'u-budi', confirmed_by: 'u-andi' });
  const byConfirmer = decision(w.store, { reporter_id: 'u-nolink', confirmed_by: 'u-andi' });
  const bySystem = decision(w.store, { reporter_id: 'u-nolink', confirmed_by: null });
  const report = await sync(w);

  const sent = w.datum.state.calls.filter((c) => c.path === 'escalate').map((c) => c.body as Record<string, unknown>);
  const bodyOf = (id: string) => sent.find((b) => b.sano_event_id === id)!;
  assertEquals(bodyOf(byReporter.id).author_staff_id, STAFF_BUDI);
  assertEquals(bodyOf(byConfirmer.id).author_staff_id, STAFF_ANDI);
  assertEquals(bodyOf(bySystem.id).author_staff_id, null);
  assertEquals([bodyOf(byConfirmer.id).reporter_name, bodyOf(byConfirmer.id).confirmer_name], ['Orang Tanpa Tautan', 'Andi']);
  assertEquals(bodyOf(bySystem.id).confirmer_name, null);
  assertEquals(bodyOf(byReporter.id).sano_url, 'https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1');
  assertEquals(bodyOf(byReporter.id).area_id, AREA_KM1);
  assertEquals(report.counts.escalated, 3);
  assertEquals(report.counts.escalated_as_system, 1);
  assert(w.store.events.every((e) => e.datum_card_id !== null && e.datum_escalated_at === '2026-09-27T03:00:00.000Z'));
});

Deno.test('the same event is sent once; a lost SANO write is healed by the next run with the same card', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  const ev = decision(w.store);
  w.store.failNext.setEventCard = 'network blip';
  const first = await sync(w);
  assertEquals(first.counts.escalate_failed, 1);
  assertEquals(first.counts.steps.escalate, 'error');
  assertEquals(ev.datum_card_id, null);
  assertEquals(w.datum.state.cards.length, 1);

  const second = await sync(w);
  assertEquals(second.counts.escalated, 1);
  assertEquals(ev.datum_card_id, w.datum.state.cards[0].id);
  assertEquals(w.datum.state.cards.length, 1);

  await sync(w);
  assertEquals(w.datum.state.calls.filter((c) => c.path === 'escalate').length, 2);
});

Deno.test('decisions in unlinked rooms no longer hold back newer ones: all counted, the oldest listed, the linked ones sent', async () => {
  const w = world();
  w.datum.state.failRoute = { areas: 500 };
  for (let i = 0; i < 25; i++) decision(w.store, { room_id: 'room-dapur', title: `Di dapur ${i}` });
  const sent = [decision(w.store), decision(w.store)];
  w.store.rooms[0].datum_area_id = AREA_KM1;
  const report = await sync(w);
  assertEquals(report.counts.escalated, 2);
  assertEquals(sent.every((e) => e.datum_card_id !== null), true);
  assertEquals(report.counts.escalate_skipped, 25);
  assertEquals(report.counts.escalate_deferred, 0);
  assertEquals(report.counts.steps.escalate, 'ok');
  const listed = report.differences.escalate_skipped ?? [];
  assertEquals(listed.length, 20);
  assertEquals(listed[0], { event_id: w.store.events[0].id, room_code: 'LT1-DAPUR', title: 'Di dapur 0', reason: ESCALATE_ROOM_UNLINKED });
  assertEquals(listed.every((x) => x.reason === ESCALATE_ROOM_UNLINKED), true);
});

Deno.test('the 21st decision in a linked room is deferred to the next run', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  for (let i = 0; i < 21; i++) decision(w.store);
  const report = await sync(w);
  assertEquals(report.counts.escalated, 20);
  assertEquals(report.counts.escalate_deferred, 1);
  assertEquals(w.store.events[20].datum_card_id, null);
});

Deno.test('an area DATUM answers UNKNOWN_AREA for is not sent again in the same run; other rooms still are', async () => {
  const w = world();
  const gone = fakeUuid('a', 77);
  w.datum.state.areas.push({ id: AREA_DAPUR, project_id: DATUM_PROJECT_ID, area_code: 'LT1-DAPUR', area_name: 'Dapur', floor: 'Lt. 1', area_type: 'kitchen', sort_order: 1, tracked: true });
  w.datum.state.failRoute = { areas: 500 };
  w.store.rooms[0].datum_area_id = gone;
  w.store.rooms[1].datum_area_id = AREA_DAPUR;
  const [first, second, third] = [decision(w.store), decision(w.store), decision(w.store)];
  const inDapur = decision(w.store, { room_id: 'room-dapur' });
  const report = await sync(w);

  const escalations = w.datum.state.calls.filter((c) => c.path === 'escalate').map((c) => (c.body as { sano_event_id: string }).sano_event_id);
  assertEquals(escalations, [first.id, inDapur.id]);
  assertEquals(report.counts.escalated, 1);
  assertEquals(report.counts.escalate_failed, 1);
  assertEquals(report.counts.escalate_skipped, 2);
  assertEquals(report.counts.escalate_deferred, 0);
  assertEquals(report.counts.steps.escalate, 'error');
  assertEquals(report.differences.escalate_skipped?.map((x) => [x.event_id, x.reason]), [
    [first.id, 'Gagal dikirim: DATUM menjawab 404 UNKNOWN_AREA: Area ini bukan milik proyek DATUM tersebut.'],
    [second.id, ESCALATE_AREA_UNKNOWN],
    [third.id, ESCALATE_AREA_UNKNOWN],
  ]);
  assertEquals(inDapur.datum_card_id !== null, true);
});

Deno.test('escalation stops at the first network failure, 401 or 503, and defers the rest; any other failure moves on', async () => {
  const cases: Array<[string, (w: ReturnType<typeof world>) => void, number, string]> = [
    ['503', (w) => (w.datum.state.systemStaffId = ''), 1, 'DATUM belum siap untuk SANO (503): SANO_INTEGRATION_STAFF_ID belum diisi: kartu dari SANO butuh penulis sistem.'],
    ['401', (w) => (w.datum.state.failRoute = { escalate: 401 }), 1, 'DATUM menolak kunci integrasi (401).'],
    ['network', (w) => {
      w.datum.state.beforeReply = (path) => {
        if (path === 'escalate') throw new TypeError('connection reset');
      };
    }, 1, 'DATUM tidak dapat dihubungi: connection reset'],
    ['500', (w) => (w.datum.state.failRoute = { escalate: 500 }), 5, 'DATUM menjawab 500 DB_ERROR: fake failure'],
  ];
  for (const [name, breakIt, calls, sentence] of cases) {
    const w = world();
    w.store.rooms[0].datum_area_id = AREA_KM1;
    for (let i = 0; i < 5; i++) decision(w.store);
    breakIt(w);
    const report = await sync(w);
    assertEquals(w.datum.state.calls.filter((c) => c.path === 'escalate').length, calls, name);
    assertEquals([report.counts.escalate_failed, report.counts.escalate_deferred], [calls, 5 - calls], name);
    assertEquals([report.counts.steps.escalate, report.counts.step_errors?.escalate], ['error', sentence], name);
  }
});

Deno.test('no escalation starts once the run is 100 s old: worst case ends by 115 s, the rest deferred', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  for (let i = 0; i < 10; i++) decision(w.store);
  w.datum.state.beforeReply = () => {
    w.clock.now = new Date(w.clock.now.getTime() + 14_000);
  };
  const report = await sync(w);
  // areas, POST areas, gate-status, staff: 56 s; escalations start at 56, 70, 84, 98 s; the fifth would start at 112 s.
  assertEquals(report.counts.escalated, 4);
  assertEquals(report.counts.escalate_deferred, 6);
  assertEquals(report.counts.steps.escalate, 'ok');
  assertEquals(w.clock.now.getTime() - Date.parse(NOW), 112_000);
});

Deno.test('create batches stop at the first network failure, 401 or 503; a later batch starts only before 45 s', async () => {
  const addRooms = (w: ReturnType<typeof world>, n: number) => {
    for (let i = 0; i < n; i++) {
      w.store.rooms.push({
        id: `room-x${i}`, project_id: PROJECT_ID, room_code: `LT2-R-${String(i).padStart(3, '0')}`, room_name: `Ruang ${i}`,
        floor: 'Lt. 2', area_type: 'general', sort_order: i, active: true, datum_area_id: null,
      });
    }
  };
  const down = world();
  addRooms(down, 250);
  down.datum.state.beforeReply = (path, method) => {
    if (path === 'areas' && method === 'POST') throw new TypeError('connection reset');
  };
  const failed = await sync(down);
  assertEquals(down.datum.state.calls.filter((c) => c.method === 'POST' && c.path === 'areas').length, 1);
  assertEquals([failed.counts.steps.create, failed.counts.step_errors?.create], ['error', 'DATUM tidak dapat dihubungi: connection reset']);

  const slow = world();
  addRooms(slow, 450);
  slow.datum.state.beforeReply = () => {
    slow.clock.now = new Date(slow.clock.now.getTime() + 20_000);
  };
  const late = await sync(slow);
  // areas ends at 20 s, batch 1 at 40 s, batch 2 starts at 40 s; batch 3 would start at 60 s.
  assertEquals(slow.datum.state.calls.filter((c) => c.method === 'POST' && c.path === 'areas').length, 2);
  assertEquals(late.counts.rooms_created, 400);
  assertEquals(late.counts.steps.create, 'ok');
  const deferred = (late.differences.create_failed ?? []).filter((x) => x.reason === CREATE_DEFERRED);
  assertEquals(deferred.length, 52);
});

Deno.test('staff links are set only for unique matches; a stale link is reported and left alone', async () => {
  const w = world();
  w.store.profiles[1].datum_staff_id = STAFF_GONE;
  const report = await sync(w);
  assertEquals(w.store.profiles[1].datum_staff_id, STAFF_GONE);
  assertEquals(report.differences.staff?.stale, [
    { profile_id: 'u-siti', full_name: 'Siti Aminah', staff_id: STAFF_GONE, staff_name: null, reason: 'staff_gone' },
  ]);
  assertEquals(report.counts.staff, { linked: 2, linked_now: 1, unmatched: 1, ambiguous: 0, stale: 1 });
});

Deno.test('a gate word that differs from gate_refs is listed and nothing is written to gate_refs', async () => {
  const w = world();
  w.datum.state.gates = [{ ...w.datum.state.gates[0] }, { ...w.datum.state.gates[1], description: 'Deskripsi baru dari DATUM.' }];
  const before = JSON.stringify(w.store.gateRefs);
  const report = await sync(w);
  assertEquals(report.differences.gate_words, [{ code: 'B', field: 'description' }]);
  assertEquals(JSON.stringify(w.store.gateRefs), before);
});

Deno.test('a status row with a gate or a status SANO does not know is a difference, not an unlinked row, and is not stored', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = AREA_KM1;
  w.datum.state.statuses[1].status = 'menunggu_owner';
  w.datum.state.statuses.push(
    { project_id: DATUM_PROJECT_ID, area_id: AREA_KM1, gate_code: 'C', status: 'passed', stale: false, last_recomputed_at: null, updated_at: null },
    { project_id: DATUM_PROJECT_ID, area_id: fakeUuid('a', 88), gate_code: 'C', status: 'passed', stale: false, last_recomputed_at: null, updated_at: null },
    { project_id: DATUM_PROJECT_ID, area_id: fakeUuid('a', 88), gate_code: 'A', status: 'passed', stale: false, last_recomputed_at: null, updated_at: null },
  );
  const report = await sync(w);
  assertEquals(report.counts.steps.gate_status, 'ok');
  assertEquals(w.store.cache.map((c) => [c.gate_code, c.status]), [['A', 'passed']]);
  assertEquals([report.counts.gate_rows, report.counts.gate_rows_unlinked], [1, 1]);
  assertEquals(report.differences.gate_status_unknown, [
    { gate_code: 'B', status: 'menunggu_owner', unknown: 'status', rows: 1 },
    { gate_code: 'C', status: 'passed', unknown: 'gate', rows: 2 },
  ]);
});

Deno.test('the import brings only confirmed, still DATUM-only areas, links them, reads their status, and posts nothing', async () => {
  const w = world();
  w.store.rooms = [];
  w.datum.state.areas.push(
    { id: AREA_TERAS, project_id: DATUM_PROJECT_ID, area_code: 'LT2-TERAS', area_name: 'Teras Atas', floor: 'Lt. 2', area_type: 'terrace', sort_order: 4, tracked: true },
    { id: AREA_LONG, project_id: DATUM_PROJECT_ID, area_code: `${'A'.repeat(39)} B`, area_name: 'Kode panjang', floor: null, area_type: 'general', sort_order: 5, tracked: true },
    { id: AREA_RACE, project_id: DATUM_PROJECT_ID, area_code: 'LT3-RACE', area_name: 'Balapan', floor: 'Lt. 3', area_type: 'hall', sort_order: 6, tracked: true },
  );
  w.store.beforeRoomInsert = (row) => {
    if (row.room_code !== 'LT3-RACE') return;
    w.store.rooms.push({ id: 'room-race', project_id: PROJECT_ID, room_code: 'LT3-RACE', room_name: 'Dibuat duluan', floor: null, area_type: 'general', sort_order: 0, active: true, datum_area_id: null });
  };
  const report = await importCodes(w, ['LT1-KM-1', 'LT2-TERAS', `${'A'.repeat(39)} B`, 'LT3-RACE', 'GONE-1']);

  assertEquals(report.counts.steps, { areas: 'ok', import: 'ok', gate_status: 'ok' });
  assertEquals(report.counts.rooms_imported, 2);
  const km1 = w.store.rooms.find((r) => r.room_code === 'LT1-KM-1')!;
  assertEquals(
    { ...km1, id: 'x' },
    { id: 'x', project_id: PROJECT_ID, room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, active: true, datum_area_id: AREA_KM1, created_by: 'u-siti' },
  );
  assertEquals(w.store.rooms.find((r) => r.room_code === 'LT2-TERAS')?.area_type, 'terrace');
  assertEquals(w.store.rooms.find((r) => r.room_code === 'LT3-RACE')?.room_name, 'Dibuat duluan');
  assertEquals(report.differences.import_skipped, [
    { area_code: `${'A'.repeat(39)} B`, reason: importBadCode(`${'A'.repeat(39)} B`) },
    { area_code: 'GONE-1', reason: IMPORT_GONE },
    { area_code: 'LT3-RACE', reason: importRaced('LT3-RACE') },
  ]);
  assertEquals(w.datum.state.calls.some((c) => c.method === 'POST'), false);
  assertEquals(w.store.cache.length, 2);
  assertEquals(report.differences.datum_only?.map((a) => a.area_code), [`${'A'.repeat(39)} B`]);
});

Deno.test('after the import the plausibility gate opens and the next sync creates SANO-only rooms', async () => {
  const w = world();
  const saved = w.store.rooms;
  w.store.rooms = [];
  await importCodes(w, ['LT1-KM-1']);
  w.store.rooms.push(...saved.filter((r) => r.room_code !== 'LT1-KM-1'));
  const report = await sync(w);
  assertEquals(report.counts.steps.create, 'ok');
  assertEquals(report.counts.rooms_created, 2);
});

Deno.test('startRun: pairing missing writes a failed run; one open run blocks another; a ten-minute-old one is closed', async () => {
  const w = world();
  w.store.projects[0].datum_project_code = null;
  const missing = await startRun(w.ctx, manual);
  assertEquals(missing.kind, 'pairing_missing');
  assertEquals(w.store.runs.map((r) => [r.ok, r.error, r.finished_at !== null]), [[false, PAIRING_MISSING, true]]);

  w.store.projects[0].datum_project_code = 'K2-7';
  const first = await startRun(w.ctx, manual);
  assertEquals(first.kind, 'started');
  assertEquals((await startRun(w.ctx, manual)).kind, 'running');

  const open = w.store.runs.find((r) => r.finished_at === null)!;
  open.started_at = '2026-09-27T02:49:00.000Z';
  const later = await startRun(w.ctx, manual);
  assertEquals(later.kind, 'started');
  assertEquals([open.ok, open.error], [false, RUN_INTERRUPTED]);
});

Deno.test('an unexpected throw still finishes the run as failed, so the lock frees', async () => {
  const w = world();
  w.store.failNext.listGateRefs = 'boom';
  const report = await sync(w);
  assertEquals(report.counts.steps.gate_status, 'error');
  assertEquals(report.counts.step_errors?.gate_status, 'Status gerbang DATUM gagal disimpan: boom');
  assertEquals(w.store.runs.every((r) => r.finished_at !== null), true);
});
