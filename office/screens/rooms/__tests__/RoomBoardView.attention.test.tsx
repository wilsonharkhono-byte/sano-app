// office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx
//
// Closure spec 2026-09-26 §5.6: "Perlu ditindak" sits at the top of every
// Papan Ruangan. The board hands it the viewer, the deeplink's Milik saya
// request and the events this phone still holds a close for; the office and
// principal layouts also get owner names and the digest health line.
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const ReactLocal = require('react');
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
import RoomBoardView from '../RoomBoardView';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const lastProps = () => mockAttentionProps[mockAttentionProps.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  mockAttentionProps.length = 0;
  mockEntries = [];
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
});
