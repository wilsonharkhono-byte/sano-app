// office/screens/rooms/__tests__/DigestHealthLine.test.tsx
//
// Closure spec 2026-09-26 §5.6: last run, never sent, read error - and a read
// error never reads as "belum pernah terkirim".
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../tools/siteEventAttention', () => ({ getDigestHealth: jest.fn() }));

import { getDigestHealth } from '../../../../tools/siteEventAttention';
import DigestHealthLine from '../DigestHealthLine';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const LAST = { last_run_date: '2026-09-17', last_sent_at: '2026-09-17T00:00:04.000Z', recipients: 4 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DigestHealthLine', () => {
  it('names the last send in WIB and how many people it reached', async () => {
    (getDigestHealth as jest.Mock).mockResolvedValue({
      last: { last_run_date: '2026-09-17', last_sent_at: '2026-09-17T00:00:04.000Z', recipients: 4 },
    });
    const { findByText } = render(<DigestHealthLine />);
    expect(await findByText('Pengingat terakhir: 17 Sep 07.00 · 4 orang')).toBeTruthy();
  });

  it('says never sent only when the view has no row', async () => {
    (getDigestHealth as jest.Mock).mockResolvedValue({ last: null });
    const { findByText } = render(<DigestHealthLine />);
    expect(await findByText('Pengingat harian belum pernah terkirim')).toBeTruthy();
  });

  it('says the read failed, never "belum pernah", and retries', async () => {
    (getDigestHealth as jest.Mock)
      .mockResolvedValueOnce({ error: 'network down' })
      .mockResolvedValueOnce({ last: null });
    const utils = render(<DigestHealthLine />);
    expect(await utils.findByText('Status pengingat harian gagal dimuat.')).toBeTruthy();
    expect(utils.queryByText('Pengingat harian belum pernah terkirim')).toBeNull();

    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(utils.getByText('Pengingat harian belum pernah terkirim')).toBeTruthy());
    expect(getDigestHealth).toHaveBeenCalledTimes(2);
  });

  it('keeps the last line on screen while a refresh is in flight, never "Memuat…"', async () => {
    (getDigestHealth as jest.Mock).mockResolvedValueOnce({ last: LAST });
    const utils = render(<DigestHealthLine reloadKey={1} />);
    expect(await utils.findByText('Pengingat terakhir: 17 Sep 07.00 · 4 orang')).toBeTruthy();

    (getDigestHealth as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    utils.rerender(<DigestHealthLine reloadKey={2} />);
    await waitFor(() => expect(getDigestHealth).toHaveBeenCalledTimes(2));
    expect(utils.getByText('Pengingat terakhir: 17 Sep 07.00 · 4 orang')).toBeTruthy();
    expect(utils.queryByText('Memuat status pengingat harian…')).toBeNull();
  });

  it('ignores a slow earlier read that answers after a later one', async () => {
    let resolveFirst!: (v: unknown) => void;
    (getDigestHealth as jest.Mock)
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ last: LAST });
    const utils = render(<DigestHealthLine reloadKey={1} />);
    utils.rerender(<DigestHealthLine reloadKey={2} />);
    expect(await utils.findByText('Pengingat terakhir: 17 Sep 07.00 · 4 orang')).toBeTruthy();

    await act(async () => { resolveFirst({ last: null }); });
    expect(utils.queryByText('Pengingat harian belum pernah terkirim')).toBeNull();
    expect(utils.getByText('Pengingat terakhir: 17 Sep 07.00 · 4 orang')).toBeTruthy();
  });
});
