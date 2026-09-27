// office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx
//
// DATUM sync spec 2026-09-27 §8.2: DATUM's readiness per room on Papan
// Ruangan, exactly as DATUM states it. While its read is under way nothing
// about DATUM shows; a failed read is one line with "Coba lagi"; an unpaired
// project shows nothing; a room SANO knows nothing about says so.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const ReactLocal = require('react');
    ReactLocal.useEffect(() => effect(), [effect]);
  },
}));
jest.mock('../../../../tools/roomBoard', () => {
  const actual = jest.requireActual('../../../../tools/roomBoard');
  return { ...actual, listRoomBoard: jest.fn() };
});
jest.mock('../../../../tools/datumGateStatus', () => {
  const actual = jest.requireActual('../../../../tools/datumGateStatus');
  return { ...actual, listDatumGateStatus: jest.fn() };
});
jest.mock('../../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => []),
  pendingCloseFor: jest.fn(() => undefined),
}));
jest.mock('../AttentionList', () => ({ __esModule: true, default: () => null }));
jest.mock('../DigestHealthLine', () => ({ __esModule: true, default: () => null }));

import { listRoomBoard } from '../../../../tools/roomBoard';
import { listDatumGateStatus, type DatumGateRow, type DatumGateStatusResult } from '../../../../tools/datumGateStatus';
import type { RoomBoardRow } from '../../../../tools/types';
import RoomBoardView from '../RoomBoardView';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const board = listRoomBoard as jest.Mock;
const datumRead = listDatumGateStatus as jest.Mock;

const room = (over: Partial<RoomBoardRow> = {}): RoomBoardRow => ({
  room_id: 'r1', project_id: 'p1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: '1', sort_order: 0,
  area_type: 'bathroom', active: true, open_progres: 0, open_isu: 0, open_hambatan: 0, open_cacat: 0,
  open_butuh_keputusan: 0, open_info: 0, overdue_count: 0, last_event_at: null, last_gate_code: null,
  last_step_code: null, is_quiet: false, owner_initials: [], ...over,
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const gateRow = (over: Partial<DatumGateRow> = {}): DatumGateRow => ({
  room_id: 'r1', gate_code: 'A', datum_area_id: 'a1', status: 'passed', datum_stale: false, synced_at: hoursAgo(1), ...over,
});
const paired = (over: Partial<Extract<DatumGateStatusResult, { paired: true }>> = {}): DatumGateStatusResult => ({
  paired: true, lastGateReadAt: hoursAgo(1), readAreaIds: ['a1', 'a2'], roomLinks: { r1: 'a1', r2: null }, rows: [gateRow()], ...over,
});

const renderBoard = () => render(<RoomBoardView projectId="p1" viewerId="u1" onOpenRoom={jest.fn()} onOpenEvent={jest.fn()} />);

beforeEach(() => {
  jest.clearAllMocks();
  board.mockResolvedValue({ rooms: [room(), room({ room_id: 'r2', room_code: 'LT1-DAPUR', room_name: 'Dapur', sort_order: 1 })] });
});

describe('RoomBoardView and DATUM readiness', () => {
  it('says nothing about DATUM while its read is under way, and never holds the board back', async () => {
    datumRead.mockReturnValue(new Promise(() => {}));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('Kamar Mandi 1')).toBeTruthy());
    expect(utils.queryByText(/DATUM/)).toBeNull();
  });

  it('shows one error line with Coba lagi on a failed read, and no room pretends to know', async () => {
    datumRead.mockResolvedValueOnce({ error: 'offline' }).mockResolvedValueOnce(paired());
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('Status DATUM gagal dimuat.')).toBeTruthy());
    expect(utils.queryByText('Status DATUM belum tersinkron')).toBeNull();
    await act(async () => { fireEvent.press(utils.getByText('Coba lagi')); });
    await waitFor(() => expect(utils.getByText('A lolos')).toBeTruthy());
    expect(datumRead).toHaveBeenCalledTimes(2);
  });

  it('shows nothing for an unpaired project', async () => {
    datumRead.mockResolvedValue({ paired: false });
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('Kamar Mandi 1')).toBeTruthy());
    await act(async () => {});
    expect(utils.queryByText(/DATUM/)).toBeNull();
  });

  it("shows chips with DATUM's labels and the read time, and says never for an unlinked room", async () => {
    datumRead.mockResolvedValue(paired({ rows: [gateRow({ gate_code: 'B', status: 'blocked' }), gateRow()] }));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('A lolos')).toBeTruthy());
    expect(utils.getByText('B terhambat')).toBeTruthy();
    expect(utils.getByText(/^per DATUM /)).toBeTruthy();
    expect(utils.getByText('Status DATUM belum tersinkron')).toBeTruthy();
  });

  it('says DATUM holds nothing for a linked room with no row, ignoring rows read for another area', async () => {
    datumRead.mockResolvedValue(paired({ roomLinks: { r1: 'a1', r2: 'a2' }, rows: [gateRow({ room_id: 'r2', datum_area_id: 'old-area' })] }));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getAllByText('DATUM belum punya status untuk ruangan ini')).toHaveLength(2));
  });

  it('marks chips older than 24 hours "lama", and says when DATUM itself has not recomputed', async () => {
    datumRead.mockResolvedValue(paired({ rows: [gateRow({ synced_at: hoursAgo(25), datum_stale: true })] }));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText(/ · lama · sebagian menunggu hitung ulang di DATUM$/)).toBeTruthy());
  });
});
