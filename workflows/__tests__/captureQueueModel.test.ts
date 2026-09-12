import { enqueueCapture, markUnrecoverable, recordFailure, type CaptureQueueEntry } from '../../tools/captureQueue';
import { WEB_QUEUE_WARNING, WEB_QUEUED_TOAST, attentionRows } from '../screens/siteEvent/captureQueueModel';
import type { NewSiteEvent } from '../../tools/siteEvents';

const NOW = '2026-09-11T03:00:00.000Z';

const event = (id: string, rawText: string | null): NewSiteEvent => ({
  id, projectId: 'p1', roomId: 'r1', reporterId: 'u1', gateCode: null, rawText, capturedAt: NOW,
  media: [{ id: `${id}-m`, localUri: 'file:///x.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW }],
});

const fresh = (id: string, rawText: string | null = null): CaptureQueueEntry =>
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
