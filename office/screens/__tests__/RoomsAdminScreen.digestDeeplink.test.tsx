// office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx
//
// Closure spec 2026-09-26 §5.6: a SITE_EVENT_DIGEST tap resolves to the office
// "Ruangan" tab with { projectId, attention, mine }. Whatever sub-screen was
// open there, the tab shows the board again and hands "Milik saya" to the
// list. Only the switch is under test: the board, the authoring pieces and
// every read are mocked.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-picker/picker', () => ({ Picker: Object.assign(() => null, { Item: () => null }) }));
jest.mock('../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../workflows/components/Header', () => ({ __esModule: true, default: () => null }));
// One object for every render, as the real context gives: the screen's rooms
// read depends on `project`, so a fresh object per render would loop.
const mockProjectContext = {
  project: { id: 'p1', code: 'P1', name: 'Proyek Satu', phase: 'STRUKTUR' },
  profile: { id: 'u1', role: 'admin' },
  refresh: jest.fn(),
};
jest.mock('../../../workflows/hooks/useProject', () => ({ useProject: () => mockProjectContext }));
jest.mock('../../../workflows/components/Toast', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('../../../tools/rooms', () => ({
  listRoomsResult: jest.fn(async () => ({ rooms: [], error: null })),
  createRoom: jest.fn(),
  setRoomActive: jest.fn(),
  ensureAreaUmum: jest.fn(),
  roomsToDatumAreas: jest.fn(() => []),
}));
jest.mock('../../../tools/roomLabelsHtml', () => ({ exportRoomLabelSheet: jest.fn() }));
jest.mock('../../../tools/projectPhase', () => ({ canSetProjectPhase: () => false, setProjectPhase: jest.fn() }));
jest.mock('../GatesAdminScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../rooms/RoomForm', () => ({ __esModule: true, default: () => null }));
jest.mock('../rooms/RoomPasteImport', () => ({ __esModule: true, default: () => null }));
const mockBoardProps: Array<Record<string, unknown>> = [];
jest.mock('../rooms/RoomBoardView', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockBoardProps.push(props);
      return ReactLocal.createElement(View, null,
        ReactLocal.createElement(Text, null, 'papan ruangan'),
        props.headerAction as React.ReactNode);
    },
  };
});

import RoomsAdminScreen from '../RoomsAdminScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

beforeEach(() => {
  mockParams = undefined;
  mockBoardProps.length = 0;
});

describe('RoomsAdminScreen and the digest deeplink', () => {
  it('switches back to the board from Kelola ruangan and hands on Milik saya', async () => {
    const utils = render(<RoomsAdminScreen />);
    await act(async () => {}); // the rooms read on mount settles
    expect(utils.getByText('papan ruangan')).toBeTruthy();
    expect(mockBoardProps[mockBoardProps.length - 1].mineRequest).toBeNull();

    fireEvent.press(utils.getByText('Kelola ruangan'));
    await waitFor(() => expect(utils.getByText('Tambah ruangan')).toBeTruthy());
    expect(utils.queryByText('papan ruangan')).toBeNull();

    mockParams = { projectId: 'p1', attention: true, mine: true };
    utils.rerender(<RoomsAdminScreen />);
    await waitFor(() => expect(utils.getByText('papan ruangan')).toBeTruthy());
    expect(utils.queryByText('Tambah ruangan')).toBeNull();
    expect(mockBoardProps[mockBoardProps.length - 1].mineRequest).toEqual({ mine: true });
  });
});
