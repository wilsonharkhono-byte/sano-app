// office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx
//
// Closure spec 2026-09-26 §5.6: "Perlu ditindak" sits at the top of every
// Papan Ruangan. The board hands it the viewer, the deeplink's Milik saya
// request and the events this phone still holds a close for; the office and
// principal layouts also get owner names and the digest health line.
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
// Runs on mount like the real hook on a focused screen; mockFocus() is a later
// focus (a tab switch back to the board).
let mockFocus: (() => void) | null = null;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const ReactLocal = require('react');
    mockFocus = effect;
    ReactLocal.useEffect(() => effect(), [effect]);
  },
}));
jest.mock('../../../../tools/roomBoard', () => {
  const actual = jest.requireActual('../../../../tools/roomBoard');
  return { ...actual, listRoomBoard: jest.fn(async () => ({ rooms: [] })) };
});
let mockEntries: Array<Record<string, unknown>> = [];
jest.mock('../../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => mockEntries),
  pendingCloseFor: jest.fn((entries: Array<Record<string, unknown>>, eventId: string) =>
    entries.find((e) => e.kind === 'close' && e.eventId === eventId && e.state !== 'done' && e.state !== 'superseded')),
}));
const mockAttentionProps: Array<Record<string, unknown>> = [];
jest.mock('../AttentionList', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockAttentionProps.push(props);
      return ReactLocal.createElement(Text, null, 'attention list');
    },
  };
});
jest.mock('../DigestHealthLine', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => ReactLocal.createElement(Text, null, 'digest health') };
});

import { useCaptureQueueEntries } from '../../../../tools/captureQueueStore';
import { listRoomBoard } from '../../../../tools/roomBoard';
import type { RoomBoardRow } from '../../../../tools/types';
import RoomBoardView from '../RoomBoardView';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const lastProps = () => mockAttentionProps[mockAttentionProps.length - 1];

const room = (over: Partial<RoomBoardRow> = {}): RoomBoardRow => ({
  room_id: 'r1', project_id: 'p1', room_code: 'LT1-R01', room_name: 'Kamar Tidur 1', floor: '1', sort_order: 0,
  area_type: 'bedroom', active: true, open_progres: 0, open_isu: 0, open_hambatan: 0, open_cacat: 0,
  open_butuh_keputusan: 0, open_info: 0, overdue_count: 0, last_event_at: null, last_gate_code: null,
  last_step_code: null, is_quiet: false, owner_initials: [], ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAttentionProps.length = 0;
  mockEntries = [];
  mockFocus = null;
});

describe('RoomBoardView and Perlu ditindak', () => {
  it("hands the list the viewer, the deeplink request and this phone's pending closes", async () => {
    mockEntries = [
      { kind: 'close', id: 'j1', eventId: 'ev1', state: 'queued' },
      { kind: 'close', id: 'j2', eventId: 'ev2', state: 'superseded' },
      { kind: 'capture', id: 'ev3', state: 'queued' },
    ];
    const mineRequest = { mine: true };
    const onOpenEvent = jest.fn();
    const utils = render(
      <RoomBoardView projectId="p1" viewerId="u1" onOpenRoom={jest.fn()} onOpenEvent={onOpenEvent} mineRequest={mineRequest} />,
    );
    await waitFor(() => expect(utils.getByText('attention list')).toBeTruthy());

    expect(useCaptureQueueEntries).toHaveBeenCalledWith('u1');
    const props = lastProps();
    expect(props).toMatchObject({ projectId: 'p1', viewerId: 'u1', showOwner: false, mineRequest, onOpenEvent });
    expect([...(props.pendingEventIds as Set<string>)]).toEqual(['ev1']);
    expect(utils.queryByText('digest health')).toBeNull();
  });

  it('names owners and shows the digest health line in office layouts', async () => {
    const utils = render(
      <RoomBoardView projectId="p1" viewerId="u9" onOpenRoom={jest.fn()} onOpenEvent={jest.fn()} showOwners showDigestHealth />,
    );
    await waitFor(() => expect(utils.getByText('digest health')).toBeTruthy());
    expect(lastProps()).toMatchObject({ showOwner: true });
  });

  it('reads the board once on mount and once per later focus; the list and health line reload only on the later ones', async () => {
    const utils = render(
      <RoomBoardView projectId="p1" viewerId="u1" onOpenRoom={jest.fn()} onOpenEvent={jest.fn()} showDigestHealth />,
    );
    await waitFor(() => expect(utils.getByText('attention list')).toBeTruthy());
    await waitFor(() => expect(listRoomBoard).toHaveBeenCalledTimes(1));
    // The list and the health line read once on mount by themselves; a
    // reloadKey that moved during mount would make each read twice.
    const mountKey = lastProps().reloadKey as number;
    expect(new Set(mockAttentionProps.map((p) => p.reloadKey))).toEqual(new Set([mountKey]));

    await act(async () => { mockFocus?.(); });
    expect(listRoomBoard).toHaveBeenCalledTimes(2);
    expect(lastProps().reloadKey).toBe(mountKey + 1);
  });

  it("shows the spinner on a project switch, never the previous project's rooms", async () => {
    (listRoomBoard as jest.Mock).mockResolvedValueOnce({ rooms: [room({ room_name: 'Kamar Proyek Satu' })] });
    const props = { viewerId: 'u1', onOpenRoom: jest.fn(), onOpenEvent: jest.fn() };
    const utils = render(<RoomBoardView projectId="p1" {...props} />);
    await waitFor(() => expect(utils.getByText('Kamar Proyek Satu')).toBeTruthy());

    (listRoomBoard as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    utils.rerender(<RoomBoardView projectId="p2" {...props} />);
    await waitFor(() => expect(listRoomBoard).toHaveBeenLastCalledWith('p2'));
    expect(utils.queryByText('Kamar Proyek Satu')).toBeNull();
  });
});
