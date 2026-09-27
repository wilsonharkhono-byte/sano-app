// workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx
//
// DATUM sync spec 2026-09-27 §8.3: the event detail says who confirmed it
// when that is known, when a decision went to DATUM (with its card), or that
// it will go on the next sync; and nothing about DATUM on an unpaired project.
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getState: () => ({ routeNames: [] }) }),
  useRoute: () => ({ params: { eventId: 'ev1', projectId: 'p1' } }),
}));
jest.mock('../../components/Header', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useProject', () => ({ useProject: () => ({ profile: { id: 'u1', role: 'admin' } }) }));
jest.mock('../../../tools/siteEvents', () => ({ getSiteEventResult: jest.fn(), getSiteEvent: jest.fn() }));
jest.mock('../../../tools/gateRefs', () => ({
  listGateRefs: jest.fn(async () => []),
  listGateStepRefs: jest.fn(async () => []),
  gateChipLabel: jest.fn(() => ''),
  stepChipLabel: jest.fn(() => ''),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => []),
  pendingCloseFor: jest.fn(() => undefined),
  supersededCloseFor: jest.fn(() => undefined),
  unreadableCloseFor: jest.fn(() => undefined),
  acknowledgeCloseEntry: jest.fn(),
  discardEntryLocally: jest.fn(),
}));
jest.mock('../../../tools/captureQueueWorker', () => ({ retryQueueEntry: jest.fn() }));
jest.mock('../siteEvent/MediaStrip', () => ({ __esModule: true, default: () => null }));
jest.mock('../siteEvent/ClosureForm', () => ({ __esModule: true, default: () => null }));
const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({ useToast: () => ({ show: mockToast }) }));

import { getSiteEventResult } from '../../../tools/siteEvents';
import SiteEventDetailScreen from '../SiteEventDetailScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const baseEvent = {
  id: 'ev1', project_id: 'p1', room_id: 'r1', reporter_id: 'u1', status: 'open', event_type: 'butuh_keputusan',
  gate_code: null, step_code: null, title: 'Pilih warna nat', summary: null, raw_text: null, transcript: null,
  transcript_edited: null, ai_draft: null, ai_confidence: null, ai_mismatch: false, ai_model: null, ai_used: false,
  owner_id: 'u1', due_date: '2026-10-01', downstream_impact: null, is_blocking: false, vo_flag: 'none',
  site_change_id: null, related_event_id: null, captured_at: '2026-09-26T02:00:00.000Z', created_at: '2026-09-26T02:00:00.000Z',
  confirmed_at: '2026-09-26T03:00:00.000Z', closed_at: null, closed_by: null, closure_note: null, last_error: null,
  analysis_attempts: 0, room_name: 'Kamar Mandi 1', room_floor: 'Lt. 1', owner_name: 'Budi', reporter_name: 'Budi',
  closed_by_name: null, media: [], datum_card_id: null, datum_card_url: null, datum_escalated_at: null, confirmed_by: null,
  confirmed_by_name: null, project_datum_code: 'K2-7', room_datum_area_id: 'area-1',
};

const show = (over: Record<string, unknown>) => {
  (getSiteEventResult as jest.Mock).mockResolvedValue({ event: { ...baseEvent, ...over } });
  return render(<SiteEventDetailScreen />);
};

beforeEach(() => jest.clearAllMocks());

describe('SiteEventDetailScreen and DATUM', () => {
  it('shows when the decision went to DATUM and opens its card', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const utils = show({
      datum_card_id: 'card-1', datum_card_url: 'https://datum.example/project/k2-7/cards/pilih-warna-nat',
      datum_escalated_at: '2026-09-27T03:00:00.000Z',
    });
    await waitFor(() => expect(utils.getByText('Dikirim ke DATUM')).toBeTruthy());
    expect(utils.getByText('27 Sep 10.00')).toBeTruthy();
    fireEvent.press(utils.getByText('Buka kartu DATUM'));
    expect(open).toHaveBeenCalledWith('https://datum.example/project/k2-7/cards/pilih-warna-nat');
    expect(utils.queryByText('Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.')).toBeNull();
    open.mockRestore();
  });

  it('says so when the card link cannot be opened, instead of failing silently', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No app to open the URL'));
    const utils = show({ datum_card_id: 'card-1', datum_card_url: 'https://datum.example/c/1', datum_escalated_at: '2026-09-27T03:00:00.000Z' });
    await waitFor(() => expect(utils.getByText('Buka kartu DATUM')).toBeTruthy());
    fireEvent.press(utils.getByText('Buka kartu DATUM'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Kartu DATUM gagal dibuka: No app to open the URL', 'critical'));
    open.mockRestore();
  });

  it('says an open decision on a paired project goes on the next sync, when its room is linked', async () => {
    const utils = show({});
    await waitFor(() => expect(utils.getByText('Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.')).toBeTruthy());
    expect(utils.queryByText('Dikirim ke DATUM')).toBeNull();
  });

  it('never promises the next sync for a room with no DATUM area: the sync does not send those', async () => {
    const utils = show({ room_datum_area_id: null });
    await waitFor(() => expect(utils.getByText('Belum dikirim ke DATUM: Ruangan belum tertaut ke area DATUM.')).toBeTruthy());
    expect(utils.queryByText(/Terkirim pada sinkron berikutnya/)).toBeNull();
  });

  it('says nothing about DATUM on an unpaired project, or for a closed or other event', async () => {
    for (const over of [{ project_datum_code: null }, { status: 'done' }, { event_type: 'isu' }]) {
      const utils = show(over);
      await waitFor(() => expect(utils.getByText('Tanggung jawab')).toBeTruthy());
      expect(utils.queryByText(/DATUM/)).toBeNull();
      utils.unmount();
    }
  });

  it('adds "oleh" to Dikonfirmasi only when the confirmer is known, in WIB like the DATUM row', async () => {
    const known = show({ confirmed_by: 'u2', confirmed_by_name: 'Siti Aminah' });
    await waitFor(() => expect(known.getByText('26 Sep 10.00 · oleh Siti Aminah')).toBeTruthy());
    known.unmount();
    const unknown = show({});
    await waitFor(() => expect(unknown.getByText('Dikonfirmasi')).toBeTruthy());
    expect(unknown.getByText('26 Sep 10.00')).toBeTruthy();
    expect(unknown.queryByText(/oleh/)).toBeNull();
  });
});
