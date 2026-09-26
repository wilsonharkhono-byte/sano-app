// workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx
//
// Closure spec 2026-09-26 §4.5 and §1.1 rule 1: while a close job for this
// event is still on the phone, the detail screen keeps the SERVER's status
// label ("Terbuka"), adds "Menunggu kirim", and offers no second "Selesai".
// When the job leaves the pending set the screen reads the server again
// instead of guessing what happened there.
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
let mockPending: Record<string, unknown> | undefined;
// A superseded close of THIS event: office and principal phones have no
// Beranda queue card, so the detail screen is where "Mengerti" lives for them.
let mockSuperseded: Record<string, unknown> | null;
jest.mock('../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => []),
  pendingCloseFor: jest.fn(() => mockPending),
  supersededCloseFor: jest.fn(() => mockSuperseded),
  acknowledgeCloseEntry: jest.fn(async () => {
    mockSuperseded = null;
    return {};
  }),
}));
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

import { getSiteEventResult } from '../../../tools/siteEvents';
import { acknowledgeCloseEntry } from '../../../tools/captureQueueStore';
import { retryQueueEntry } from '../../../tools/captureQueueWorker';
import SiteEventDetailScreen from '../SiteEventDetailScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

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

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = undefined;
  mockSuperseded = null;
  (getSiteEventResult as jest.Mock).mockResolvedValue({ event: baseEvent });
});

describe('a close waiting on this phone', () => {
  it('keeps the server label, adds Menunggu kirim, and hides Selesai', async () => {
    mockPending = { id: 'job1', kind: 'close', eventId: 'ev1', state: 'queued', needsAttention: false, lastError: null };
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
    mockPending = {
      id: 'job1', kind: 'close', eventId: 'ev1', state: 'failed', needsAttention: true,
      lastError: 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
    };
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() =>
      expect(utils.getByText(
        'Penutupan belum terkirim: Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
      )).toBeTruthy(),
    );
    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(retryQueueEntry).toHaveBeenCalledWith('u1', 'job1'));
    expect(utils.getByText('Terbuka')).toBeTruthy();
  });

  it('reads the server again once the job leaves the pending set', async () => {
    mockPending = { id: 'job1', kind: 'close', eventId: 'ev1', state: 'closing', needsAttention: false, lastError: null };
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Menunggu kirim')).toBeTruthy());
    expect(getSiteEventResult).toHaveBeenCalledTimes(1);

    (getSiteEventResult as jest.Mock).mockResolvedValue({
      event: { ...baseEvent, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u2', closed_by_name: 'Sari' },
    });
    mockPending = undefined;
    utils.rerender(<SiteEventDetailScreen />);

    await waitFor(() => expect(getSiteEventResult).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.getByText('Ditutup oleh')).toBeTruthy());
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
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
    (getSiteEventResult as jest.Mock).mockResolvedValue({
      event: { ...baseEvent, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u2', closed_by_name: 'Sari' },
    });
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Ditutup oleh')).toBeTruthy());
    expect(utils.getByText('media: closure')).toBeTruthy();
    expect(utils.getByText('Foto penutupan')).toBeTruthy();
  });
});

describe('a close this phone queued, already closed on the server', () => {
  it('names the server\'s closer and time, and Mengerti acknowledges the job and reads the server again', async () => {
    (getSiteEventResult as jest.Mock).mockResolvedValue({
      event: { ...baseEvent, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u2', closed_by_name: 'Sari' },
    });
    mockSuperseded = {
      id: 'job1', kind: 'close', eventId: 'ev1', ownerId: 'u1', state: 'superseded', needsAttention: false, lastError: null,
      createdAt: '2026-09-17T07:00:00.000Z',
      closedElsewhere: { closedByName: 'Sari', closedAt: '2026-09-17T07:05:00.000Z' },
    };
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
    (getSiteEventResult as jest.Mock).mockResolvedValue({
      event: { ...baseEvent, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: null, closed_by_name: null },
    });
    mockSuperseded = {
      id: 'job7', kind: 'close', eventId: 'ev1', ownerId: 'u1', state: 'superseded', needsAttention: false, lastError: null,
      createdAt: '2026-09-17T07:00:00.000Z',
      closedElsewhere: { closedByName: null, closedAt: '2026-09-17T07:05:00.000Z' },
    };
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() => expect(utils.getByText('Sudah ditutup pada 17 Sep 14.05.')).toBeTruthy());
    expect(utils.queryByText(/Sudah ditutup oleh/)).toBeNull();
    expect(utils.queryByText('Menunggu kirim')).toBeNull();

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job7'));
    await waitFor(() => expect(getSiteEventResult).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.queryByText('Sudah ditutup pada 17 Sep 14.05.')).toBeNull());
  });
});
