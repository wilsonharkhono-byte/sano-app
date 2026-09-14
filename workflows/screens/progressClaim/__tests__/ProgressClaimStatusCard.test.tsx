// workflows/screens/progressClaim/__tests__/ProgressClaimStatusCard.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  getLatestClaim: jest.fn(),
  listStageWeights: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));

import { getLatestClaim, listStageWeights } from '../../../../tools/progressClaims/claims';
import ProgressClaimStatusCard from '../ProgressClaimStatusCard';

const item = (id: string, code: string, label: string, sort: number) => ({
  id, code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const EN_DASH = String.fromCharCode(0x2013);

beforeEach(() => {
  jest.clearAllMocks();
  (getLatestClaim as jest.Mock).mockResolvedValue({
    id: 'c1', project_id: 'p1', week_start: '2026-09-14', status: 'VERIFIED', verified_at: '2026-09-15T20:00:00Z', return_note: null,
  });
  (listStageWeights as jest.Mock).mockResolvedValue([
    { boq_item_id: 'k1', weights: { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 }, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' },
  ]);
});

describe('ProgressClaimStatusCard', () => {
  it('shows the latest claim status and how many rows rely on reference weights', async () => {
    const { findByText, getByText } = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={jest.fn()} />);
    expect(await findByText('Terverifikasi')).toBeTruthy();
    expect(getByText(`Minggu 14${EN_DASH}20 Sep, diverifikasi 16 Sep`)).toBeTruthy();
    expect(getByText('1 dari 2 baris memakai bobot referensi.')).toBeTruthy();
    expect(getByText('1 baris belum punya bobot tahapan.')).toBeTruthy();
  });

  it('opens the claim view', async () => {
    const onOpen = jest.fn();
    const { findByLabelText } = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={onOpen} />);
    fireEvent.press(await findByLabelText('Buka klaim progres'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('says so when the status cannot be loaded', async () => {
    (getLatestClaim as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const { findByText } = render(<ProgressClaimStatusCard projectId="p1" boqItems={ITEMS} onOpen={jest.fn()} />);
    expect(await findByText('Status klaim belum bisa dimuat.')).toBeTruthy();
  });

  it('renders nothing for a project without a published BoQ', () => {
    const { toJSON } = render(<ProgressClaimStatusCard projectId="p1" boqItems={EMPTY} onOpen={jest.fn()} />);
    expect(toJSON()).toBeNull();
    expect(getLatestClaim).not.toHaveBeenCalled();
  });
});
