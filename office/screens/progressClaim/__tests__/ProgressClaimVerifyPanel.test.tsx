// office/screens/progressClaim/__tests__/ProgressClaimVerifyPanel.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  getOpenClaim: jest.fn(),
  getLatestClaim: jest.fn(),
  listClaimLines: jest.fn(),
  listStageWeights: jest.fn(),
  listVerifiedStagePct: jest.fn(),
  listEntryTotals: jest.fn(),
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
  getLatestClaim, getOpenClaim, listClaimLines, listEntryTotals, listStageWeights, listVerifiedStagePct, returnClaim, verifyClaim,
} from '../../../../tools/progressClaims/claims';
import ProgressClaimVerifyPanel from '../ProgressClaimVerifyPanel';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const balok = { BEKISTING: 0.368, PEMBESIAN: 0.38, PENGECORAN: 0.252 };
const K1 = { id: 'k1', project_id: 'p1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 32.6, progress: 32.6 };
const B1 = { id: 'b1', project_id: 'p1', code: 'T1-002', label: 'Lantai 2 ; Balok', unit: 'm³', planned: 200, installed: 0, progress: 0 };
const ITEMS = [K1, B1];
const claim = (status: string) => ({
  id: 'c1', project_id: 'p1', week_start: '2026-09-14', status, created_by: 'sup', created_at: 'x', updated_at: 'x',
  submitted_by: 'sup', submitted_at: 'x', returned_by: null, returned_at: null, return_note: null,
  verified_by: status === 'VERIFIED' ? 'est' : null, verified_at: status === 'VERIFIED' ? '2026-09-15T20:00:00Z' : null, verifier_note: null,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: 'l1', claim_id: 'c1', project_id: 'p1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, verified_pct: null, weights_snapshot: null, row_pct_prev: null,
  row_pct_new: null, installed_before: null, delta_quantity: null, regress_reason: null, note: 'Begel K1-K8 terpasang',
  evidence: { photo_refs: ['progress/p1/1.jpg'] }, created_by: 'sup', updated_by: 'sup', created_at: 'x', updated_at: 'x', ...over,
});
const weightRow = (id: string, weights: object, source = 'reference', cls: string | null = 'KOLOM') => ({ boq_item_id: id, weights, source, reference_class: cls, updated_at: 'x' });
const ESTIMATOR = { id: 'est', role: 'estimator' };

const renderPanel = (profile: { id: string; role: string } | null = ESTIMATOR) => {
  const props = { toast: jest.fn(), onVerified: jest.fn(), onChanged: jest.fn() };
  const utils = render(<ProgressClaimVerifyPanel projectId="p1" profile={profile} boqItems={ITEMS} {...props} />);
  return { ...utils, ...props, profile };
};

beforeEach(() => {
  jest.clearAllMocks();
  (getOpenClaim as jest.Mock).mockResolvedValue(claim('SUBMITTED'));
  (getLatestClaim as jest.Mock).mockResolvedValue(null);
  (listClaimLines as jest.Mock).mockResolvedValue([line()]);
  (listStageWeights as jest.Mock).mockResolvedValue([weightRow('k1', kolom)]);
  (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]));
  (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 32.6]]));
  (verifyClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'VERIFIED', lines: 1, entries: 1, regressions: 0, notified: 1 });
  (returnClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'RETURNED', notified: 1 });
});

describe('ProgressClaimVerifyPanel', () => {
  it('shows each stage before, claimed and to check, the note and photos, and verifies the edited figures', async () => {
    const { findByLabelText, getByLabelText, getByText, getByTestId, onVerified, toast } = renderPanel();
    const pembesian = await findByLabelText('Verifikasi Pembesian T1-001');
    expect(pembesian.props.value).toBe('60');
    expect(getByText('Catatan pengawas: Begel K1-K8 terpasang')).toBeTruthy();
    expect(getByText('Bobot referensi')).toBeTruthy();
    expect(getByText('Lalu: terverifikasi sebelumnya. Klaim: angka pengawas. Cek: angka verifikasi.')).toBeTruthy();
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

  it('verifies every line of a multi-line claim in one call', async () => {
    (listClaimLines as jest.Mock).mockResolvedValue([
      line(),
      line({ id: 'l2', boq_item_id: 'b1', prev_verified: { BEKISTING: 0, PEMBESIAN: 0, PENGECORAN: 0 }, claimed_pct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, note: null, evidence: { photo_refs: [] } }),
    ]);
    (listStageWeights as jest.Mock).mockResolvedValue([weightRow('k1', kolom), weightRow('b1', balok, 'manual', null)]);
    const { findByLabelText, getByLabelText } = renderPanel();
    await findByLabelText('Verifikasi Bekisting T1-002');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(verifyClaim).toHaveBeenCalledWith('c1', [
      { line_id: 'l1', verified_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, regress_reason: null },
      { line_id: 'l2', verified_pct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, regress_reason: null },
    ], null));
  });

  it('blocks verification while a line has no weights', async () => {
    (listClaimLines as jest.Mock).mockResolvedValue([line(), line({ id: 'l2', boq_item_id: 'b1' })]);
    const { findByText, getByLabelText, toast } = renderPanel();
    expect(await findByText('Bobot tahapan baris ini belum diatur. Kembalikan klaim atau atur bobot di Baseline.')).toBeTruthy();
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    expect(toast).toHaveBeenCalledWith('T1-002: bobot tahapan belum diatur.', 'critical');
    expect(verifyClaim).not.toHaveBeenCalled();
  });

  it('asks for a reason before verifying a stage below the verified one', async () => {
    (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 70, PENGECORAN: 0 }]]));
    (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 66.62]]));
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

  it('asks for a reason when re-weighting lowers the quantity although no stage dropped', async () => {
    (listStageWeights as jest.Mock).mockResolvedValue([weightRow('k1', { BEKISTING: 0.2, PEMBESIAN: 0.5, PENGECORAN: 0.3 }, 'manual', null)]);
    (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }]]));
    (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 52.04]]));
    (listClaimLines as jest.Mock).mockResolvedValue([line({ claimed_pct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 } })]);
    const { findByText, getByLabelText, getByText, toast } = renderPanel();
    expect(await findByText('Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.')).toBeTruthy();
    expect(getByText('Progres baris 40% menjadi 40% (perkiraan -12,04 m³)')).toBeTruthy();
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    expect(toast).toHaveBeenCalledWith('T1-001: penurunan progres wajib disertai alasan.', 'critical');
  });

  it('keeps the edited figures when verification fails', async () => {
    (verifyClaim as jest.Mock).mockRejectedValueOnce(new Error('Status klaim sudah berubah. Muat ulang halaman.'));
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.changeText(await findByLabelText('Verifikasi Pembesian T1-001'), '55');
    fireEvent.press(getByLabelText('Verifikasi klaim'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Status klaim sudah berubah. Muat ulang halaman.', 'critical'));
    expect(getByLabelText('Verifikasi Pembesian T1-001').props.value).toBe('55');
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

  it.each([
    ['the submitter', { id: 'sup', role: 'estimator' }, {}],
    ['someone who filled a line', { id: 'est', role: 'estimator' }, { updated_by: 'est' }],
  ])('never lets %s decide the claim', async (_who, profile, lineOver) => {
    (listClaimLines as jest.Mock).mockResolvedValue([line(lineOver)]);
    const { findByText, queryByLabelText, getByLabelText } = renderPanel(profile);
    expect(await findByText('Klaim ini berisi angka yang Anda kirim atau isi sendiri. Verifikasi harus dilakukan estimator atau admin lain.')).toBeTruthy();
    expect(queryByLabelText('Verifikasi klaim')).toBeNull();
    expect(getByLabelText('Verifikasi Pembesian T1-001').props.editable).toBe(false);
  });

  it('lets the principal read without deciding or being told to change figures', async () => {
    const { findByLabelText, queryByLabelText, getByText } = renderPanel({ id: 'pri', role: 'principal' });
    expect((await findByLabelText('Verifikasi Pembesian T1-001')).props.editable).toBe(false);
    expect(queryByLabelText('Verifikasi klaim')).toBeNull();
    expect(queryByLabelText('Kembalikan klaim')).toBeNull();
    expect(getByText('1 baris diklaim. Angka cek terisi dari klaim pengawas.')).toBeTruthy();
  });

  it('says when nothing waits for verification and shows the last claim', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(null);
    (getLatestClaim as jest.Mock).mockResolvedValue(claim('VERIFIED'));
    const { findByText, getByText } = renderPanel();
    expect(await findByText('Tidak ada klaim yang menunggu verifikasi.')).toBeTruthy();
    expect(getByText('Terverifikasi')).toBeTruthy();
    expect(listClaimLines).not.toHaveBeenCalled();
  });

  it('reloads when asked to, as a notification tap does', async () => {
    const { findByLabelText, rerender, toast, onVerified, onChanged } = renderPanel();
    await findByLabelText('Verifikasi Pembesian T1-001');
    rerender(<ProgressClaimVerifyPanel projectId="p1" profile={ESTIMATOR} boqItems={ITEMS} reloadKey={1} toast={toast} onVerified={onVerified} onChanged={onChanged} />);
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
  });
});
