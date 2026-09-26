import {
  enqueueCapture,
  markAnalysisRequested,
  markInserted,
  markUnrecoverable,
  markUploaded,
  enqueueClose,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  markClosureMediaInserted,
  recordFailure,
  type CaptureJob,
  type CloseJob,
} from '../../tools/captureQueue';
import {
  REASON_CLOSE_STATUS_UNREADABLE,
  WEB_QUEUE_WARNING,
  WEB_QUEUED_TOAST,
  attentionRows,
  closeJobCancelKind,
  queueBadgeText,
} from '../screens/siteEvent/captureQueueModel';
import type { NewSiteEvent } from '../../tools/siteEvents';

const NOW = '2026-09-11T03:00:00.000Z';

const event = (id: string, rawText: string | null): NewSiteEvent => ({
  id, projectId: 'p1', roomId: 'r1', reporterId: 'u1', gateCode: null, rawText, capturedAt: NOW,
  media: [{ id: `${id}-m`, localUri: 'file:///x.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW }],
});

const fresh = (id: string, rawText: string | null = null): CaptureJob =>
  enqueueCapture({ event: event(id, rawText), ownerId: 'u1', workGroupNames: [], nowIso: NOW });

describe('WEB_QUEUE_WARNING', () => {
  it('states the exact web limitation from spec §7', () => {
    expect(WEB_QUEUE_WARNING).toBe('Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.');
  });
});

describe('WEB_QUEUED_TOAST', () => {
  it('never claims the report is saved, unlike the native toast', () => {
    expect(WEB_QUEUED_TOAST).toBe('Dikirim dari tab ini. Jangan tutup halaman sampai laporan muncul di Draf menunggu.');
  });
});

describe('attentionRows', () => {
  it('is empty when nothing needs attention', () => {
    expect(attentionRows([fresh('e1')])).toEqual([]);
  });

  it('offers Coba lagi for a retryable flagged entry, using its note as the title', () => {
    let e = fresh('e1', '  Nat retak di dekat pintu  ');
    for (let i = 0; i < 5; i++) e = recordFailure(e, 'jaringan turun', NOW);
    expect(attentionRows([e])).toEqual([
      { id: 'e1', title: 'Nat retak di dekat pintu', reason: 'jaringan turun', action: 'retry' },
    ]);
  });

  it('falls back to a generic title and reason when the note and error are both empty', () => {
    let e = fresh('e2', '   ');
    for (let i = 0; i < 5; i++) e = recordFailure(e, 'x', NOW);
    e = { ...e, lastError: null };
    expect(attentionRows([e])[0]).toMatchObject({ title: 'Laporan tanpa catatan', reason: expect.stringMatching(/Ketuk untuk mencoba lagi/) });
  });

  it('offers Buang, not Coba lagi, for an unrecoverable entry', () => {
    const e = markUnrecoverable(fresh('e3'), 'Berkas hilang.');
    expect(attentionRows([e])[0]).toMatchObject({ action: 'discard', reason: 'Berkas hilang.' });
  });
});

/** Uploaded, inserted, analysis kicked off - the state the badge's second half counts. */
const kickedOff = (id: string): CaptureJob => {
  const e = fresh(id);
  return markAnalysisRequested(markInserted(markUploaded(e, `${id}-m`, 1, NOW), NOW), NOW);
};

describe('queueBadgeText', () => {
  it('is silent when there is nothing queued', () => {
    expect(queueBadgeText([])).toBeNull();
  });

  it('counts what is still waiting for signal', () => {
    expect(queueBadgeText([fresh('e1')])).toBe('Antrean: 1 menunggu sinyal');
  });

  /**
   * The worker swallows every invoke outcome by design, so an entry can reach
   * draft_ready with no draft on the server at all. The badge must not
   * promise the supervisor something to confirm that may not exist - only
   * that the report itself is safely on the server.
   */
  it('says a kicked-off report is on the server, never that a draft is ready', () => {
    const badge = queueBadgeText([kickedOff('e2')]);
    expect(badge).toBe('Antrean: 1 terkirim ke server, menunggu analisis');
    expect(badge).not.toMatch(/draf siap/i);
  });

  it('shows both halves at once, separated so the second half reads as one phrase', () => {
    expect(queueBadgeText([fresh('e1'), kickedOff('e2')])).toBe(
      'Antrean: 1 menunggu sinyal · 1 terkirim ke server, menunggu analisis',
    );
  });
});

describe('attentionRows escape hatches', () => {
  it('offers Buang for a permanent refusal, which no number of retries can fix', () => {
    const e = recordFailure(fresh('e1', 'Retak di kolom'), 'Anda tidak ditugaskan ke proyek ini.', NOW, 'permanent');
    expect(attentionRows([e])).toEqual([
      { id: 'e1', title: 'Retak di kolom', reason: 'Anda tidak ditugaskan ke proyek ini.', action: 'discard' },
    ]);
  });

  it('still offers only Coba lagi for a transient failure that ran out of attempts', () => {
    let e = fresh('e2');
    for (let i = 0; i < 5; i++) e = recordFailure(e, 'jaringan turun', NOW);
    expect(attentionRows([e])[0].action).toBe('retry');
  });

  it('never offers Buang once the event is on the server, and says so plainly', () => {
    let e = markInserted(markUploaded(fresh('e3'), 'e3-m', 1, NOW), NOW);
    e = recordFailure(e, 'Bersihkan berkas lokal gagal: SD card unmounted', NOW, 'permanent');
    expect(attentionRows([e])[0]).toMatchObject({
      action: 'retry',
      reason: 'Sudah terkirim ke server; buka Draf menunggu.',
    });
  });
});

// ─── Close jobs (closure spec 2026-09-26 §4.6) ────────────────────────────────

const closeJob = (photo = true): CloseJob => enqueueClose({
  id: 'job1', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian', note: 'Sudah ditambal',
  closurePhoto: photo
    ? { id: 'cm1', localUri: 'file:///q/cm1.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW }
    : null,
  nowIso: NOW,
});

const supersededJob = (closedByName: string | null): CloseJob => markCleanedUp(
  markClosedElsewhere(markCloseOutcome(closeJob(false), 'not_open', NOW), { closedByName, closedAt: '2026-09-17T07:05:00.000Z' }, NOW),
  NOW,
);

describe('attentionRows for close jobs', () => {
  it('offers Coba lagi on a transient failure that ran out of attempts, titled with the event', () => {
    let j = closeJob(false);
    for (let i = 0; i < 5; i++) j = recordFailure(j, 'Tandai selesai gagal: Gagal menyimpan: Network request failed', NOW);
    expect(attentionRows([j])).toEqual([
      { id: 'job1', title: 'Selesai: Retak acian', reason: 'Tandai selesai gagal: Gagal menyimpan: Network request failed', action: 'retry' },
    ]);
  });

  it('offers Batalkan, confirmed first, on a permanent refusal before any outcome', () => {
    const j = recordFailure(closeJob(false), 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.', NOW, 'permanent');
    expect(attentionRows([j])).toEqual([{
      id: 'job1',
      title: 'Selesai: Retak acian',
      reason: 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
      action: 'cancel',
      confirm: 'Batalkan penutupan "Retak acian"? Kejadian tetap terbuka. Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu.',
    }]);
  });

  it('offers Batalkan on an unrecoverable job, with the missing-photo sentence when it carries no error', () => {
    const j = { ...markUnrecoverable(closeJob(), 'x'), lastError: null };
    expect(attentionRows([j])[0]).toMatchObject({
      action: 'cancel',
      reason: 'Foto penutupan hilang dari HP sebelum terkirim. Batalkan, lalu tandai selesai lagi dengan foto baru.',
    });
  });

  /**
   * NOT_OPEN, then the status read refused for good: "Coba lagi" would only
   * repeat the same refusal, and "Batalkan" would hide that the server already
   * answered. The row says what is known and lets the person dismiss it.
   */
  it('offers Mengerti, never Coba lagi or Batalkan, when the event is no longer open and its status cannot be read', () => {
    const j = recordFailure(markCloseOutcome(closeJob(false), 'not_open', NOW), 'Baca status kejadian gagal: Hanya kejadian terbuka yang bisa ditandai selesai.', NOW, 'permanent');
    expect(attentionRows([j])).toEqual([{
      id: 'job1',
      title: 'Selesai: Retak acian',
      reason: 'Kejadian sudah tidak terbuka di server; statusnya tidak bisa dibaca.',
      action: 'acknowledge',
    }]);
    expect(REASON_CLOSE_STATUS_UNREADABLE).toBe('Kejadian sudah tidak terbuka di server; statusnya tidak bisa dibaca.');
  });

  it('keeps Coba lagi on a status read that failed only transiently, five times running', () => {
    let j = markCloseOutcome(closeJob(false), 'not_open', NOW);
    for (let i = 0; i < 5; i++) j = recordFailure(j, 'Baca status kejadian gagal: network down', NOW);
    expect(attentionRows([j])[0]).toMatchObject({ action: 'retry', reason: 'Baca status kejadian gagal: network down' });
  });

  it("names the server's closer and time on a superseded job, and offers Mengerti", () => {
    expect(attentionRows([supersededJob('Budi Santoso')])).toEqual([
      { id: 'job1', title: 'Retak acian', reason: 'Sudah ditutup oleh Budi Santoso pada 17 Sep 14.05.', action: 'acknowledge' },
    ]);
  });

  it('says only when, never a guessed name, when the server recorded no closer', () => {
    expect(attentionRows([supersededJob(null)])[0].reason).toBe('Sudah ditutup pada 17 Sep 14.05.');
  });

  it('lists nothing for a close job that is simply waiting, and counts it as waiting for signal', () => {
    const j = markClosureMediaInserted(markUploaded(closeJob(), 'cm1', 1, NOW), NOW);
    expect(attentionRows([j])).toEqual([]);
    expect(queueBadgeText([j])).toBe('Antrean: 1 menunggu sinyal');
  });
});

/**
 * The one rule for what a person can do with a close job, shared by the
 * Beranda card and (in a follow-up) the detail screen, so the two can never
 * offer different ways out of the same job.
 */
describe('closeJobCancelKind', () => {
  const flaggedTransient = (j: CloseJob): CloseJob => {
    let out = j;
    for (let i = 0; i < 5; i++) out = recordFailure(out, 'jaringan turun', NOW);
    return out;
  };

  it('offers nothing while the job is simply on its way, or once it is done', () => {
    expect(closeJobCancelKind(closeJob())).toBeNull();
    expect(closeJobCancelKind(recordFailure(closeJob(false), 'jaringan turun', NOW))).toBeNull();
    const done = markCleanedUp(markCloseOutcome(closeJob(false), 'closed', NOW), NOW);
    expect(done.state).toBe('done');
    expect(closeJobCancelKind(done)).toBeNull();
  });

  it('retries a transient failure that ran out of attempts, before or after an outcome', () => {
    expect(closeJobCancelKind(flaggedTransient(closeJob(false)))).toBe('retry');
    expect(closeJobCancelKind(flaggedTransient(markCloseOutcome(closeJob(false), 'not_open', NOW)))).toBe('retry');
  });

  it('cancels a permanent refusal or a vanished photo while no outcome is recorded', () => {
    expect(closeJobCancelKind(recordFailure(closeJob(false), 'x', NOW, 'permanent'))).toBe('cancel');
    expect(closeJobCancelKind(markUnrecoverable(closeJob(), 'x'))).toBe('cancel');
  });

  it('never cancels once the close landed: a permanent failure after it is only retried', () => {
    const j = recordFailure(markCloseOutcome(closeJob(false), 'closed', NOW), 'x', NOW, 'permanent');
    expect(closeJobCancelKind(j)).toBe('retry');
  });

  it('acknowledges a superseded job and a job whose event is no longer open with an unreadable status', () => {
    expect(closeJobCancelKind(supersededJob('Budi Santoso'))).toBe('acknowledge');
    const unreadable = recordFailure(markCloseOutcome(closeJob(false), 'not_open', NOW), 'x', NOW, 'permanent');
    expect(closeJobCancelKind(unreadable)).toBe('acknowledge');
  });
});
