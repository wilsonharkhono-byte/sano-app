import {
  enqueueCapture,
  markAnalysisRequested,
  markInserted,
  markUnrecoverable,
  markUploaded,
  recordFailure,
  type CaptureJob,
} from '../../tools/captureQueue';
import { WEB_QUEUE_WARNING, WEB_QUEUED_TOAST, attentionRows, queueBadgeText } from '../screens/siteEvent/captureQueueModel';
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
