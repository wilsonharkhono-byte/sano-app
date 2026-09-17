// supabase/functions/report-progress-analyze/context.test.ts
import { assertEquals } from 'std/assert';
import {
  isPhotoPathInProject, leaseFreeFilter, linesFromSnapshot, photoRefsFromSnapshot, promptLinesFromFrozen, recentFromRows, storageTarget,
} from './context.ts';

const PID = '11e59d22-5aa8-436e-b82d-ccbd6c2bdd7d';
const OTHER = 'b0eb0da4-8ee4-455a-9c12-8d32a642e041';

Deno.test('linesFromSnapshot keeps one entry per update in order and tolerates malformed entries', () => {
  const lines = linesFromSnapshot({ updates: [{ area: 'Galian', note: 'lanjut' }, 42, { area: 'Cor' }] });
  assertEquals(lines.map((l) => l.index), [0, 1, 2]);
  assertEquals(lines[0].text, 'Galian :: lanjut');
  assertEquals(lines[1], { index: 1, area: '', note: '', text: ' :: ' });
  assertEquals(lines[2].text, 'Cor :: ');
  assertEquals(linesFromSnapshot(null), []);
  assertEquals(linesFromSnapshot({ updates: 'x' }), []);
});

Deno.test('promptLinesFromFrozen splits the frozen text at the first separator only', () => {
  const out = promptLinesFromFrozen([
    { id: 'a', line_index: 0, status: 'SUGGESTED', line_text: 'Bekisting :: Melanjutkan :: dua' },
    { id: 'b', line_index: 3, status: 'CONFIRMED', line_text: 'tanpa pemisah' },
  ]);
  assertEquals(out, [
    { index: 0, area: 'Bekisting', note: 'Melanjutkan :: dua' },
    { index: 3, area: 'tanpa pemisah', note: '' },
  ]);
});

Deno.test('storageTarget routes the site-media prefix to the private bucket and everything else to photos', () => {
  assertEquals(storageTarget('site-media:site-events/p/e/m.jpg'), { bucket: 'site-media', path: 'site-events/p/e/m.jpg' });
  assertEquals(storageTarget('client-report/p/1.jpg'), { bucket: 'photos', path: 'client-report/p/1.jpg' });
});

Deno.test('isPhotoPathInProject allows only this project\'s report, daily-log and site-event folders', () => {
  assertEquals(isPhotoPathInProject(`client-report/${PID}/1.jpg`, PID), true);
  assertEquals(isPhotoPathInProject(`daily-log/${PID}/2.jpg`, PID), true);
  assertEquals(isPhotoPathInProject(`site-media:site-events/${PID}/e/m.jpg`, PID), true);
  assertEquals(isPhotoPathInProject(`client-report/${OTHER}/1.jpg`, PID), false);
  assertEquals(isPhotoPathInProject(`site-media:site-events/${OTHER}/e/m.jpg`, PID), false);
  assertEquals(isPhotoPathInProject(`defects/${PID}/1.jpg`, PID), false);
  assertEquals(isPhotoPathInProject(`client-report/${PID}/`, PID), false);
  assertEquals(isPhotoPathInProject(`client-report/${PID}/../${OTHER}/x.jpg`, PID), false);
  assertEquals(isPhotoPathInProject(`client-report/${PID}/1.jpg`, ''), false);
});

Deno.test('isPhotoPathInProject refuses bucket/folder crossovers and traversal hidden in a signed URL', () => {
  assertEquals(isPhotoPathInProject(`site-media:client-report/${PID}/x.jpg`, PID), false);
  assertEquals(isPhotoPathInProject(`site-events/${PID}/e/m.jpg`, PID), false);
  const { refs, outOfScope } = photoRefsFromSnapshot({
    thumbs: [
      { url: `https://x.supabase.co/storage/v1/object/sign/photos/client-report/${PID}/%2e%2e/${OTHER}/x.jpg?token=t` },
      { url: `https://x.supabase.co/storage/v1/object/sign/avatars/client-report/${PID}/x.jpg?token=t` },
    ],
  }, PID, 8);
  assertEquals(refs, []);
  assertEquals(outOfScope, 2);
});

Deno.test('leaseFreeFilter frees a null, a stale and a far-future lease, and nothing else', () => {
  const now = Date.parse('2026-09-14T01:00:00.000Z');
  assertEquals(
    leaseFreeFilter(now),
    'link_claimed_at.is.null,link_claimed_at.lt.2026-09-14T00:58:00.000Z,link_claimed_at.gt.2026-09-14T01:02:00.000Z',
  );
});

Deno.test('photoRefsFromSnapshot prefers stored paths, recovers URLs, counts out-of-scope, and caps', () => {
  const snapshot = {
    hero: { url: `https://x.supabase.co/storage/v1/object/sign/photos/client-report/${PID}/h.jpg?token=t` },
    thumbs: [
      { path: `daily-log/${PID}/a.jpg`, url: 'ignored' },
      { path: `client-report/${OTHER}/steal.jpg` },
      { url: 'https://example.com/not-storage.jpg' },
      { path: `client-report/${PID}/c.jpg` },
      'garbage',
    ],
  };
  const { refs, outOfScope } = photoRefsFromSnapshot(snapshot, PID, 2);
  assertEquals(refs, [`client-report/${PID}/h.jpg`, `daily-log/${PID}/a.jpg`]);
  assertEquals(outOfScope, 1);
  assertEquals(photoRefsFromSnapshot(null, PID, 8), { refs: [], outOfScope: 0 });
});

Deno.test('recentFromRows maps embedded rows, drops incomplete ones, sorts newest first and caps', () => {
  const rows = [
    { line_text: 'a', stage: 'BEKISTING', activity_state: 'LANJUT', boq_items: { code: 'T1-002' }, client_progress_reports: { period_end: '2026-09-10' } },
    { line_text: 'b', stage: null, activity_state: 'SELESAI', boq_items: [{ code: 'T1-003' }], client_progress_reports: [{ period_end: '2026-09-12' }] },
    { line_text: 'no code', stage: null, activity_state: 'LANJUT', boq_items: null, client_progress_reports: { period_end: '2026-09-11' } },
    { line_text: 'c', stage: 'PENGECORAN', activity_state: 'LANJUT', boq_items: { code: 'T1-004' }, client_progress_reports: { period_end: '2026-09-11' } },
  ];
  const out = recentFromRows(rows, 2);
  assertEquals(out.map((r) => r.code), ['T1-003', 'T1-004']);
  assertEquals(out[0], { period_end: '2026-09-12', code: 'T1-003', stage: null, activity_state: 'SELESAI', text: 'b' });
});
