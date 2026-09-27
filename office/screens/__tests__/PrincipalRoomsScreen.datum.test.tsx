// office/screens/__tests__/PrincipalRoomsScreen.datum.test.tsx
//
// DATUM sync spec 2026-09-27 §8.1 and §9: a principal's "Ruangan" tab is
// PrincipalRoomsScreen, not the office tab, so the DATUM card lives here too:
// a "DATUM" section above the board that expands in place (never a modal),
// with the same pairing, "Sinkron DATUM" and import as Kelola ruangan. The
// board is mocked; the card is the real one over mocked calls.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../workflows/components/Header', () => ({ __esModule: true, default: () => null }));
// One object for every render, as the real context gives.
const mockProjectContext = {
  project: { id: 'p1', code: 'P1', name: 'Proyek Satu', phase: 'STRUKTUR', datum_project_code: 'K2-7' },
  profile: { id: 'u1', role: 'principal' },
  refresh: jest.fn(),
};
jest.mock('../../../workflows/hooks/useProject', () => ({ useProject: () => mockProjectContext }));
jest.mock('../../../tools/datumSync', () => {
  const actual = jest.requireActual('../../../tools/datumSync');
  return {
    ...actual,
    getDatumSyncState: jest.fn(),
    syncDatum: jest.fn(),
    importFromDatum: jest.fn(),
    setDatumProjectCode: jest.fn(),
  };
});
const mockBoardProps: Array<Record<string, unknown>> = [];
jest.mock('../rooms/RoomBoardView', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockBoardProps.push(props);
      return ReactLocal.createElement(View, null,
        props.aboveBoard as React.ReactNode,
        ReactLocal.createElement(Text, null, 'papan ruangan'));
    },
  };
});

import { getDatumSyncState, setDatumProjectCode, syncDatum } from '../../../tools/datumSync';
import PrincipalRoomsScreen from '../PrincipalRoomsScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const getState = getDatumSyncState as jest.Mock;
const sync = syncDatum as jest.Mock;
const pair = setDatumProjectCode as jest.Mock;

const latest = {
  id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', requester_name: 'Pak Prinsipal',
  started_at: '2026-09-26T03:00:00.000Z', finished_at: '2026-09-26T03:00:05.000Z', ok: true,
  counts: { steps: { areas: 'ok' }, rooms_linked: 12 }, differences: {}, error: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockBoardProps.length = 0;
  getState.mockResolvedValue({ latest, latestFinished: latest, latestSync: latest, staffRun: null, waiting: null });
});

describe('PrincipalRoomsScreen and DATUM', () => {
  it('shows a closed DATUM section above the board, and reads nothing until it is opened', async () => {
    const utils = render(<PrincipalRoomsScreen />);
    expect(utils.getByText('papan ruangan')).toBeTruthy();
    const toggle = utils.getByLabelText('DATUM');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(utils.getByText('K2-7')).toBeTruthy();
    expect(utils.queryByText('Sinkron DATUM')).toBeNull();
    await act(async () => {});
    expect(getState).not.toHaveBeenCalled();
  });

  it('lets the principal sync in place, then reads the board again', async () => {
    sync.mockResolvedValueOnce({ run: { ok: true, runId: 'run-2', counts: { steps: { areas: 'ok' } }, differences: {}, error: null } });
    const utils = render(<PrincipalRoomsScreen />);
    fireEvent.press(utils.getByLabelText('DATUM'));
    await waitFor(() => expect(utils.getByText(/Sinkron terakhir: 26 Sep 10.00/)).toBeTruthy());
    expect(utils.getByLabelText('DATUM').props.accessibilityState).toMatchObject({ expanded: true });
    expect(getState).toHaveBeenCalledWith('p1');
    const signalBefore = mockBoardProps[mockBoardProps.length - 1].reloadSignal;
    await act(async () => { fireEvent.press(utils.getByText('Sinkron DATUM')); });
    expect(sync).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(mockBoardProps[mockBoardProps.length - 1].reloadSignal).not.toBe(signalBefore));
  });

  it("pairs through the same card, reloading the project, and closes again in place", async () => {
    pair.mockResolvedValueOnce({ code: 'D-18' });
    const utils = render(<PrincipalRoomsScreen />);
    fireEvent.press(utils.getByLabelText('DATUM'));
    await waitFor(() => expect(utils.getByLabelText('Kode proyek DATUM')).toBeTruthy());
    fireEvent.changeText(utils.getByLabelText('Kode proyek DATUM'), 'd-18');
    await act(async () => { fireEvent.press(utils.getByText('Simpan')); });
    expect(pair).toHaveBeenCalledWith('p1', 'd-18');
    expect(mockProjectContext.refresh).toHaveBeenCalled();
    fireEvent.press(utils.getByLabelText('DATUM'));
    expect(utils.queryByText('Sinkron DATUM')).toBeNull();
    expect(utils.getByText('papan ruangan')).toBeTruthy();
  });
});
