// workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx
//
// Closure spec 2026-09-26 §4.5 and §1.1 rule 1: while a close job for this
// event is still on the phone, the detail screen keeps the SERVER's status
// label ("Terbuka"), adds "Menunggu kirim", and offers no second "Selesai".
// When the job leaves the pending set the screen reads the server again
// instead of guessing what happened there.
//
// The queue reaches the screen the way it does on a phone: real close jobs
// built with tools/captureQueue.ts, handed over by useCaptureQueueEntries,
// and picked apart by the store's own pendingCloseFor and supersededCloseFor.
// Only the I/O around them is mocked, so a job for another event, or a job
// in the wrong state, is filtered exactly as it would be in the field.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    canGoBack: () => true,
    getState: () => ({ routeNames: ['Beranda', 'SiteEventDetail'] }),
  }),
  useRoute: () => ({ params: { eventId: 'ev1', projectId: 'p1' } }),
}));
jest.mock('../../components/Header', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useProject', () => ({ useProject: () => ({ profile: { id: 'u1', role: 'supervisor' } }) }));
jest.mock('../../../tools/siteEvents', () => ({ getSiteEventResult: jest.fn(), getSiteEvent: jest.fn() }));
jest.mock('../../../tools/gateRefs', () => ({
  listGateRefs: jest.fn(async () => []),
  listGateStepRefs: jest.fn(async () => []),
  gateChipLabel: jest.fn(() => ''),
  stepChipLabel: jest.fn(() => ''),
}));
// captureQueueStore's own imports; the two selectors used here never touch them.
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('expo-file-system/legacy', () => ({}));
let mockEntries: unknown[] = [];
jest.mock('../../../tools/captureQueueStore', () => {
  const actual = jest.requireActual('../../../tools/captureQueueStore');
  return {
    // Like the store, namespaced by user: a null or wrong id sees nothing.
    useCaptureQueueEntries: jest.fn((userId: string | null) =>
      mockEntries.filter((e) => (e as { ownerId: string }).ownerId === userId),
    ),
    pendingCloseFor: actual.pendingCloseFor,
    supersededCloseFor: actual.supersededCloseFor,
    // Like the store: an acknowledged job leaves the queue.
    acknowledgeCloseEntry: jest.fn(async (_userId: string, entryId: string) => {
      mockEntries = mockEntries.filter((e) => (e as { id: string }).id !== entryId);
      return {};
    }),
  };
});
jest.mock('../../../tools/captureQueueWorker', () => ({ retryQueueEntry: jest.fn(async () => undefined) }));
jest.mock('../siteEvent/MediaStrip', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { media: Array<{ role: string }> }) =>
      ReactLocal.createElement(Text, null, `media: ${props.media.map((m) => m.role).join(',') || 'none'}`),
  };
});
jest.mock('../siteEvent/ClosureForm', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => ReactLocal.createElement(Text, null, 'closure form') };
});

import {
  enqueueClose,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  recordFailure,
  type CloseJob,
} from '../../../tools/captureQueue';
import { getSiteEventResult } from '../../../tools/siteEvents';
import { acknowledgeCloseEntry, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
import { retryQueueEntry } from '../../../tools/captureQueueWorker';
import SiteEventDetailScreen from '../SiteEventDetailScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const NOW = '2026-09-17T07:00:00.000Z';
const CLOSED_AT = '2026-09-17T07:05:00.000Z';

/** A close job as enqueueCloseJob writes it: queued, no photo, owned by u1. */
const closeJob = (id: string, eventId: string): CloseJob => enqueueClose({
  id, ownerId: 'u1', eventId, projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian', note: '',
  closurePhoto: null, nowIso: NOW,
});

/** The worker's end state when the RPC answered NOT_OPEN and the lookup read the closer. */
const supersededJob = (id: string, eventId: string, closedByName: string | null): CloseJob => markCleanedUp(
  markClosedElsewhere(markCloseOutcome(closeJob(id, eventId), 'not_open', NOW), { closedByName, closedAt: CLOSED_AT }, NOW),
  NOW,
);

/** Five transient failures in a row: flagged, but still worth another try. */
const flaggedTransient = (id: string, eventId: string, error: string): CloseJob => ({
  ...recordFailure(closeJob(id, eventId), error, NOW, 'transient'),
  consecutiveFailures: 5,
  needsAttention: true,
});

const baseEvent = {
  id: 'ev1', project_id: 'p1', room_id: 'r1', reporter_id: 'u1', status: 'open', event_type: 'cacat',
  gate_code: null, step_code: null, title: 'Retak acian', summary: null, raw_text: null, transcript: null,
  transcript_edited: null, ai_draft: null, ai_confidence: null, ai_mismatch: false, ai_model: null, ai_used: false,
  owner_id: 'u1', due_date: '2026-09-20', downstream_impact: null, is_blocking: false, vo_flag: 'none',
  site_change_id: null, related_event_id: null, captured_at: '2026-09-16T02:00:00.000Z', created_at: '2026-09-16T02:00:00.000Z',
  confirmed_at: '2026-09-16T03:00:00.000Z', closed_at: null, closed_by: null, closure_note: null, last_error: null,
  analysis_attempts: 0, room_name: 'Kamar 1', room_floor: 'Lt. 1', owner_name: 'Budi', reporter_name: 'Budi',
  closed_by_name: null,
  media: [
    { id: 'm1', event_id: 'ev1', kind: 'photo', role: 'context', storage_path: 'x', mime_type: null, duration_s: null, bytes: null, sort_order: 0, captured_at: null },
    { id: 'm2', event_id: 'ev1', kind: 'photo', role: 'closure', storage_path: 'y', mime_type: null, duration_s: null, bytes: null, sort_order: 1, captured_at: null },
  ],
};
const doneEvent = (closedByName: string | null) => ({
  ...baseEvent, status: 'done', closed_at: CLOSED_AT, closed_by: closedByName ? 'u2' : null, closed_by_name: closedByName,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries = [];
  (getSiteEventResult as jest.Mock).mockResolvedValue({ event: baseEvent });
});

describe('the queue it reads', () => {
  it("is the signed-in profile's own", async () => {
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Selesai')).toBeTruthy());
    expect(useCaptureQueueEntries).toHaveBeenCalledWith('u1');
    expect(useCaptureQueueEntries).not.toHaveBeenCalledWith(null);
  });

  it('ignores close jobs for another event, pending or superseded', async () => {
    mockEntries = [
      flaggedTransient('job2', 'ev2', 'Tandai selesai gagal: Network request failed'),
      supersededJob('job3', 'ev2', 'Sari'),
    ];
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() => expect(utils.getByText('Selesai')).toBeTruthy());
    expect(utils.getByText('Terbuka')).toBeTruthy();
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
    expect(utils.queryByText(/Penutupan belum terkirim/)).toBeNull();
    expect(utils.queryByText(/Penutupan tersimpan di ponsel ini/)).toBeNull();
    expect(utils.queryByText(/Sudah ditutup/)).toBeNull();
    expect(utils.queryByText('Mengerti')).toBeNull();
  });
});

describe('a close waiting on this phone', () => {
  it('keeps the server label, adds Menunggu kirim, and hides Selesai', async () => {
    mockEntries = [closeJob('job1', 'ev1')];
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() => expect(utils.getByText('Terbuka')).toBeTruthy());
    expect(utils.getByText('Menunggu kirim')).toBeTruthy();
    expect(
      utils.getByText('Penutupan tersimpan di ponsel ini dan menunggu kirim. Status tetap Terbuka sampai server menerimanya.'),
    ).toBeTruthy();
    expect(utils.queryByText('Selesai')).toBeNull();
    expect(utils.queryByText('closure form')).toBeNull();
  });

  it('shows why a flagged close has not gone, and retries it on Coba lagi', async () => {
    mockEntries = [flaggedTransient('job1', 'ev1', 'Tandai selesai gagal: Network request failed')];
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() =>
      expect(utils.getByText('Penutupan belum terkirim: Tandai selesai gagal: Network request failed')).toBeTruthy(),
    );
    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(retryQueueEntry).toHaveBeenCalledWith('u1', 'job1'));
    expect(utils.getByText('Terbuka')).toBeTruthy();
  });

  it('reads the server again once the job leaves the pending set', async () => {
    mockEntries = [closeJob('job1', 'ev1')];
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Menunggu kirim')).toBeTruthy());
    expect(getSiteEventResult).toHaveBeenCalledTimes(1);

    (getSiteEventResult as jest.Mock).mockResolvedValue({ event: doneEvent('Sari') });
    mockEntries = [];
    utils.rerender(<SiteEventDetailScreen />);

    await waitFor(() => expect(getSiteEventResult).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.getByText('Ditutup oleh')).toBeTruthy());
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
  });

  it('takes the form down the moment a close for this event lands in the queue', async () => {
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Selesai')).toBeTruthy());
    fireEvent.press(utils.getByText('Selesai'));
    expect(utils.getByText('closure form')).toBeTruthy();

    // The store notifies before enqueueCloseJob returns, so the job can show
    // up while the form is still open: it must not stay on screen beside it.
    mockEntries = [closeJob('job1', 'ev1')];
    utils.rerender(<SiteEventDetailScreen />);

    expect(utils.queryByText('closure form')).toBeNull();
    expect(utils.getByText('Menunggu kirim')).toBeTruthy();
    expect(utils.queryByText('Selesai')).toBeNull();
  });
});

describe('with nothing queued', () => {
  it('offers Selesai on an open event, and splits closure photos from the other evidence', async () => {
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Selesai')).toBeTruthy());
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
    expect(utils.getByText('media: context')).toBeTruthy();
  });

  it('shows the closure photo next to the closer on a done event', async () => {
    (getSiteEventResult as jest.Mock).mockResolvedValue({ event: doneEvent('Sari') });
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Ditutup oleh')).toBeTruthy());
    expect(utils.getByText('media: closure')).toBeTruthy();
    expect(utils.getByText('Foto penutupan')).toBeTruthy();
  });
});

describe('a close this phone queued, already closed on the server', () => {
  it('names the server\'s closer and time, and Mengerti acknowledges the job and reads the server again', async () => {
    (getSiteEventResult as jest.Mock).mockResolvedValue({ event: doneEvent('Sari') });
    mockEntries = [supersededJob('job1', 'ev1', 'Sari')];
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() => expect(utils.getByText('Sudah ditutup oleh Sari pada 17 Sep 14.05.')).toBeTruthy());
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
    expect(getSiteEventResult).toHaveBeenCalledTimes(1);

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job1'));
    await waitFor(() => expect(getSiteEventResult).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.queryByText('Sudah ditutup oleh Sari pada 17 Sep 14.05.')).toBeNull());
    expect(utils.getByText('Ditutup oleh')).toBeTruthy();
  });

  it('without a closer name says only when, never names the queue owner, and Mengerti still acknowledges and reloads', async () => {
    (getSiteEventResult as jest.Mock).mockResolvedValue({ event: doneEvent(null) });
    mockEntries = [supersededJob('job7', 'ev1', null)];
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() => expect(utils.getByText('Sudah ditutup pada 17 Sep 14.05.')).toBeTruthy());
    expect(utils.queryByText(/Sudah ditutup oleh/)).toBeNull();
    expect(utils.queryByText('Menunggu kirim')).toBeNull();

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job7'));
    await waitFor(() => expect(getSiteEventResult).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.queryByText('Sudah ditutup pada 17 Sep 14.05.')).toBeNull());
  });

  it('shows why Mengerti did not go through, keeps the sentence, and does not read the server again', async () => {
    (getSiteEventResult as jest.Mock).mockResolvedValue({ event: doneEvent('Sari') });
    mockEntries = [supersededJob('job1', 'ev1', 'Sari')];
    (acknowledgeCloseEntry as jest.Mock).mockResolvedValueOnce({ error: 'Penutupan ini belum selesai diproses.' });
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Mengerti')).toBeTruthy());

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(utils.getByText('Penutupan ini belum selesai diproses.')).toBeTruthy());
    expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job1');
    expect(utils.getByText('Sudah ditutup oleh Sari pada 17 Sep 14.05.')).toBeTruthy();
    expect(getSiteEventResult).toHaveBeenCalledTimes(1);
  });
});
