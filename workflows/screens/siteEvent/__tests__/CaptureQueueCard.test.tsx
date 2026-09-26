// workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx
//
// Closure spec 2026-09-26 §4.6: the Beranda card shows close jobs too - a
// superseded one keeps the card on screen with "Mengerti", and a refused one
// offers "Batalkan", confirmed first.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockToast = jest.fn();
jest.mock('../../../components/Toast', () => ({ useToast: () => ({ show: mockToast }) }));
jest.mock('../../../hooks/useProject', () => ({ useProject: () => ({ profile: { id: 'u1' } }) }));
let mockEntries: unknown[] = [];
jest.mock('../../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => mockEntries),
  discardEntryLocally: jest.fn(async () => ({})),
  acknowledgeCloseEntry: jest.fn(async () => ({})),
}));
jest.mock('../../../../tools/captureQueueWorker', () => ({ retryQueueEntry: jest.fn(async () => undefined) }));

import {
  enqueueClose,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  recordFailure,
  type CloseJob,
} from '../../../../tools/captureQueue';
import { acknowledgeCloseEntry, discardEntryLocally } from '../../../../tools/captureQueueStore';
import CaptureQueueCard from '../CaptureQueueCard';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const NOW = '2026-09-17T02:00:00.000Z';
const job = (): CloseJob => enqueueClose({
  id: 'job1', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian', note: '',
  closurePhoto: null, nowIso: NOW,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries = [];
});

describe('CaptureQueueCard with close jobs', () => {
  it("stays on screen for a superseded close, names the server's closer, and acknowledges on Mengerti", async () => {
    mockEntries = [markCleanedUp(
      markClosedElsewhere(markCloseOutcome(job(), 'not_open', NOW), { closedByName: 'Sari', closedAt: '2026-09-17T07:05:00.000Z' }, NOW),
      NOW,
    )];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Retak acian')).toBeTruthy();
    expect(utils.getByText('Sudah ditutup oleh Sari pada 17 Sep 14.05.')).toBeTruthy();

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job1'));
  });

  it('asks before Batalkan on a refused close, and only then discards it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockEntries = [recordFailure(job(), 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini.', NOW, 'permanent')];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Selesai: Retak acian')).toBeTruthy();

    fireEvent.press(utils.getByText('Batalkan'));
    expect(alert).toHaveBeenCalledWith(
      'Batalkan penutupan',
      'Batalkan penutupan "Retak acian"? Kejadian tetap terbuka. Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu.',
      expect.any(Array),
    );
    expect(discardEntryLocally).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Batalkan')!.onPress!();
    await waitFor(() => expect(discardEntryLocally).toHaveBeenCalledWith('u1', 'job1'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Penutupan dibatalkan. Kejadian tetap terbuka.', 'ok'));
    alert.mockRestore();
  });

  it('offers Mengerti, not Coba lagi, when the event is no longer open and its status cannot be read', async () => {
    mockEntries = [recordFailure(
      markCloseOutcome(job(), 'not_open', NOW),
      'Baca status kejadian gagal: Hanya kejadian terbuka yang bisa ditandai selesai.',
      NOW,
      'permanent',
    )];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Selesai: Retak acian')).toBeTruthy();
    expect(utils.getByText('Kejadian sudah tidak terbuka di server; statusnya tidak bisa dibaca.')).toBeTruthy();
    expect(utils.queryByText('Coba lagi')).toBeNull();

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job1'));
  });

  it('shows in the row why Mengerti failed, and keeps the row so it can be pressed again', async () => {
    (acknowledgeCloseEntry as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    mockEntries = [markCleanedUp(
      markClosedElsewhere(markCloseOutcome(job(), 'not_open', NOW), { closedByName: 'Sari', closedAt: '2026-09-17T07:05:00.000Z' }, NOW),
      NOW,
    )];
    const utils = render(<CaptureQueueCard />);

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(utils.getByText('Gagal menghapus dari ponsel ini: disk full')).toBeTruthy());
    expect(utils.getByText('Mengerti')).toBeTruthy();

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.queryByText('Gagal menghapus dari ponsel ini: disk full')).toBeNull());
  });

  it('counts a close that is still on its way as waiting for signal', () => {
    mockEntries = [job()];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Antrean: 1 menunggu sinyal')).toBeTruthy();
  });
});
