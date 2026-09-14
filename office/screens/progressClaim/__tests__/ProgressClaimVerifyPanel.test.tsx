// office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  getOpenClaim: jest.fn(),
  getLatestClaim: jest.fn(),
  listClaimLines: jest.fn(),
  listStageWeights: jest.fn(),
  listVerifiedStagePct: jest.fn(),
  verifyClaim: jest.fn(),
  returnClaim: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../workflows/components/StoragePhoto', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { path: string; testID?: string }) => ReactLocal.createElement(Text, { testID: props.testID }, props.path),
  };
});

import {
  getLatestClaim, getOpenClaim, listClaimLines, listStageWeights, listVerifiedStagePct, returnClaim, verifyClaim,
} from '../../../../tools/progressClaims/claims';
import ProgressClaimVerifyPanel from '../ProgressClaimVerifyPanel';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const ITEMS = [{ id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 32.6, progress: 32.6 }];
const claim = (status: string) => ({
  id: 'c1', project_id: 'p1', week_start: '2026-09-14', status, created_by: 'sup', created_at: 'x', updated_at: 'x',
  submitted_by: 'sup', submitted_at: 'x', returned_by: null, returned_at: null, return_note: null,
  verified_by: status === 'VERIFIED' ? 'est' : null, verified_at: status === 'VERIFIED' ? '2026-09-15T20:00:00Z' : null, verifier_note: null,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: 'l1', claim_id: 'c1', project_id: 'p1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, verified_pct: null, weights_snapshot: null, row_pct_prev: null,
  row_pct_new: null, installed_before: null, delta_quantity: null, regress_reason: null, note: 'Begel K1-K8 terpasang',
  evidence: { photo_refs: ['progress/p1/1.jpg'] }, created_at: 'x', updated_at: 'x', ...over,
});
const ESTIMATOR = { id: 'est', role: 'estimator' };

const renderPanel = (profile: { id: string; role: string } | null = ESTIMATOR) => {
  const props = { toast: jest.fn(), onVerified: jest.fn(), onChanged: jest.fn() };
  return { ...render(<ProgressClaimVerifyPanel projectId="p1" profile={profile} boqItems={ITEMS} {...props} />), ...props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (getOpenClaim as jest.Mock).mockResolvedValue(claim('SUBMITTED'));
  (getLatestClaim as jest.Mock).mockResolvedValue(null);
  (listClaimLines as jest.Mock).mockResolvedValue([line()]);
  (listStageWeights as jest.Mock).mockResolvedValue([{ boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' }]);
  (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]));
  (verifyClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'VERIFIED', lines: 1, entries: 1, regressions: 0, notified: 1 });
  (returnClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'RETURNED', notified: 1 });
});

describe('ProgressClaimVerifyPanel', () => {
  it('shows each stage verified and claimed, the note and the photos, and verifies the edited figures', async () => {
    const { findByLabelText, getByLabelText, getByText, getByTestId, onVerified, toast } = renderPanel();
    const pembesian = await findByLabelText('Verifikasi Pembesian T1-001');
    expect(pembesian.props.value).toBe('60');
    expect(getByText('Catatan pengawas: Begel K1-K8 terpasang')).toBeTruthy();
    expect(getByText('Bobot referensi')).toBeTruthy();
    expect(getByTestId('claim-photo-l1-0')).toBeTruthy();
    fireEvent.changeText(pembesian, '50');
    expect(getByText('Progres baris 32,6% menjadi 56,9% (perkiraan +24,3 m³)')).toBeTruthy();
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(verifyClaim).toHaveBeenCalledWith('c1', [
      { line_id: 'l1', verified_pct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, regress_reason: null },
    ], null));
    expect(onVerified).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Klaim diverifikasi. 1 entri progres dicatat.', 'ok');
  });

  it('asks for a reason before verifying a figure below the verified one', async () => {
    (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 70, PENGECORAN: 0 }]]));
    (listClaimLines as jest.Mock).mockResolvedValue([line({ claimed_pct: { BEKISTING: 100, PEMBESIAN: 80, PENGECORAN: 0 } })]);
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.changeText(await findByLabelText('Verifikasi Pembesian T1-001'), '50');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    expect(toast).toHaveBeenCalledWith('T1-001: penurunan progres wajib disertai alasan.', 'critical');
    expect(verifyClaim).not.toHaveBeenCalled();
    fireEvent.changeText(getByLabelText('Alasan penurunan T1-001'), 'Begel dibongkar');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(verifyClaim).toHaveBeenCalledWith('c1', [
      { line_id: 'l1', verified_pct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, regress_reason: 'Begel dibongkar' },
    ], null));
  });

  it('returns the claim with a note, and refuses an empty one', async () => {
    const { findByLabelText, getByLabelText, onChanged, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Kembalikan klaim'));
    fireEvent.press(getByLabelText('Kirim pengembalian'));
    expect(toast).toHaveBeenCalledWith('Tulis alasan pengembalian klaim.', 'critical');
    fireEvent.changeText(getByLabelText('Alasan pengembalian'), 'Foto pembesian kurang jelas');
    fireEvent.press(getByLabelText('Kirim pengembalian'));
    await waitFor(() => expect(returnClaim).toHaveBeenCalledWith('c1', 'Foto pembesian kurang jelas'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('never lets the submitter decide their own claim', async () => {
    const { findByText, queryByLabelText, getByLabelText } = renderPanel({ id: 'sup', role: 'estimator' });
    expect(await findByText('Klaim ini Anda kirim sendiri. Verifikasi harus dilakukan estimator atau admin lain.')).toBeTruthy();
    expect(queryByLabelText('Verifikasi klaim')).toBeNull();
    expect(getByLabelText('Verifikasi Pembesian T1-001').props.editable).toBe(false);
  });

  it('lets the principal read without deciding', async () => {
    const { findByLabelText, queryByLabelText, queryByText } = renderPanel({ id: 'pri', role: 'principal' });
    expect((await findByLabelText('Verifikasi Pembesian T1-001')).props.editable).toBe(false);
    expect(queryByLabelText('Verifikasi klaim')).toBeNull();
    expect(queryByLabelText('Kembalikan klaim')).toBeNull();
    expect(queryByText('Klaim ini Anda kirim sendiri. Verifikasi harus dilakukan estimator atau admin lain.')).toBeNull();
  });

  it('says when nothing waits for verification and shows the last claim', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(null);
    (getLatestClaim as jest.Mock).mockResolvedValue(claim('VERIFIED'));
    const { findByText, getByText } = renderPanel();
    expect(await findByText('Tidak ada klaim yang menunggu verifikasi.')).toBeTruthy();
    expect(getByText('Terverifikasi')).toBeTruthy();
    expect(listClaimLines).not.toHaveBeenCalled();
  });
});
