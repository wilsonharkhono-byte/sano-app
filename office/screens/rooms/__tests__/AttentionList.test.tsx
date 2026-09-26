// office/screens/rooms/__tests__/AttentionList.test.tsx
//
// Closure spec 2026-09-26 §5.6: loading, a read error that never shows the
// empty text, the empty text in both toggle states, the rows and their chips,
// the Milik saya filter, the deeplink turning it on, "Menunggu kirim", and a
// tap opening the event.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../tools/siteEventAttention', () => {
  const actual = jest.requireActual('../../../../tools/siteEventAttention');
  return { ...actual, listSiteEventAttention: jest.fn() };
});

import { listSiteEventAttention, type AttentionRow } from '../../../../tools/siteEventAttention';
import AttentionList, { type AttentionListProps } from '../AttentionList';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  event_id: 'e1', project_id: 'p1', room_id: 'r1', room_code: 'LT1-R01', room_name: 'Kamar Tidur 1', floor: '1',
  gate_code: null, event_type: 'isu', title: 'Retak dinding', summary: null, owner_id: 'u1', owner_name: 'Budi',
  owner_on_project: true, due_date: '2026-09-14', is_blocking: false, confirmed_at: '2026-09-12T02:00:00Z',
  is_overdue: true, days_overdue: 3, ...over,
});

const ROWS = [
  row(),
  row({ event_id: 'e2', room_code: null, room_name: 'Area Umum', title: 'Pompa mati', owner_id: 'u2', owner_name: 'Sari', is_blocking: true, days_overdue: 0, is_overdue: false }),
  row({ event_id: 'e3', title: 'Keramik pecah', owner_id: 'u9', owner_name: 'Andi', owner_on_project: false, days_overdue: 1 }),
];

const renderList = (over: Partial<AttentionListProps> = {}) => {
  const onOpenEvent = jest.fn();
  const props: AttentionListProps = {
    projectId: 'p1', viewerId: 'u1', showOwner: false, pendingEventIds: new Set<string>(), onOpenEvent, ...over,
  };
  return { ...render(<AttentionList {...props} />), onOpenEvent, props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (listSiteEventAttention as jest.Mock).mockResolvedValue({ rows: ROWS });
});

describe('AttentionList', () => {
  it('shows a spinner while loading, then the rows with their chips', async () => {
    let resolve!: (v: unknown) => void;
    (listSiteEventAttention as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const utils = renderList();
    expect(utils.getByLabelText('Memuat daftar perlu ditindak')).toBeTruthy();

    resolve({ rows: ROWS });
    await waitFor(() => expect(utils.getByText('Perlu ditindak (3)')).toBeTruthy());
    expect(utils.getByText('Retak dinding')).toBeTruthy();
    expect(utils.getAllByText('LT1-R01 · Kamar Tidur 1')).toHaveLength(2);
    expect(utils.getByText('Area Umum')).toBeTruthy();
    expect(utils.getByText('Lewat 3 hari')).toBeTruthy();
    expect(utils.getByText('Menghambat')).toBeTruthy();
    expect(utils.getByText('Lewat 1 hari')).toBeTruthy();
    expect(listSiteEventAttention).toHaveBeenCalledWith('p1');
  });

  it('shows a read error with Coba lagi, and never the empty text', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValueOnce({ error: 'network down' });
    const utils = renderList();
    await waitFor(() =>
      expect(utils.getByText('Daftar perlu ditindak gagal dimuat. Periksa koneksi lalu coba lagi.')).toBeTruthy(),
    );
    expect(utils.queryByText('Tidak ada yang perlu ditindak.')).toBeNull();

    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(utils.getByText('Retak dinding')).toBeTruthy());
    expect(listSiteEventAttention).toHaveBeenCalledTimes(2);
  });

  it('says there is nothing to do, in both toggle states', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValue({ rows: [] });
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Tidak ada yang perlu ditindak.')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Milik saya'));
    expect(utils.getByText('Tidak ada tugas Anda yang perlu ditindak.')).toBeTruthy();
  });

  it('filters the same rows to the viewer with Milik saya, with no second query', async () => {
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Perlu ditindak (3)')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Milik saya'));
    expect(utils.getByText('Perlu ditindak (1)')).toBeTruthy();
    expect(utils.getByText('Retak dinding')).toBeTruthy();
    expect(utils.queryByText('Pompa mati')).toBeNull();
    expect(listSiteEventAttention).toHaveBeenCalledTimes(1);
  });

  it('turns Milik saya on from a deeplink, and again on a second tap of the same link', async () => {
    const first = { mine: true };
    const utils = renderList({ mineRequest: first });
    await waitFor(() => expect(utils.getByText('Perlu ditindak (1)')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Milik saya')); // the person turns it off
    expect(utils.getByText('Perlu ditindak (3)')).toBeTruthy();

    utils.rerender(
      <AttentionList {...utils.props} mineRequest={{ mine: true }} />,
    );
    expect(utils.getByText('Perlu ditindak (1)')).toBeTruthy();
  });

  it('marks a row whose close is still on this phone', async () => {
    const utils = renderList({ pendingEventIds: new Set(['e2']) });
    await waitFor(() => expect(utils.getByText('Menunggu kirim')).toBeTruthy());
    expect(utils.getAllByText('Menunggu kirim')).toHaveLength(1);
  });

  it('names owners in office layouts, and says Tanpa penanggung jawab only where the view knows it', async () => {
    const utils = renderList({ showOwner: true });
    await waitFor(() => expect(utils.getByText('Budi')).toBeTruthy());
    expect(utils.getByText('Sari')).toBeTruthy();
    expect(utils.getByText('Tanpa penanggung jawab')).toBeTruthy();
    expect(utils.queryByText('Andi')).toBeNull();
  });

  it('opens the event on a tap', async () => {
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Pompa mati')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Buka kejadian Pompa mati'));
    expect(utils.onOpenEvent).toHaveBeenCalledWith('e2', 'p1');
  });

  it('says the list was capped at 200', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => row({ event_id: `e${i}`, title: `Item ${i}` })),
    });
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Perlu ditindak (200 teratas)')).toBeTruthy());
  });

  it('counts Milik saya within the 200 read, not as the whole list, when capped', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => row({ event_id: `e${i}`, title: `Item ${i}`, owner_id: i < 2 ? 'u1' : 'u2' })),
    });
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Perlu ditindak (200 teratas)')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Milik saya'));
    expect(utils.getByText('Perlu ditindak (2 dari 200 teratas)')).toBeTruthy();
  });

  it('with Milik saya on over a capped read, says none are in the 200, never that the viewer has none', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => row({ event_id: `e${i}`, title: `Item ${i}`, owner_id: 'u2' })),
    });
    const utils = renderList({ mineRequest: { mine: true } });
    await waitFor(() => expect(utils.getByText('Tidak ada tugas Anda di 200 teratas.')).toBeTruthy());
    expect(utils.queryByText('Tidak ada tugas Anda yang perlu ditindak.')).toBeNull();
    expect(utils.getByText('Perlu ditindak (0 dari 200 teratas)')).toBeTruthy();
  });

  it('refetches when the board bumps reloadKey', async () => {
    const utils = renderList({ reloadKey: 1 });
    await waitFor(() => expect(listSiteEventAttention).toHaveBeenCalledTimes(1));
    utils.rerender(<AttentionList {...utils.props} reloadKey={2} />);
    await waitFor(() => expect(listSiteEventAttention).toHaveBeenCalledTimes(2));
  });
});
