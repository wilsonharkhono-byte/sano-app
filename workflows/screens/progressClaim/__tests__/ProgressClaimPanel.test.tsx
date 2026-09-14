// workflows/screens/progressClaim/__tests__/ProgressClaimPanel.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  listStageWeights: jest.fn(),
  seedReferenceWeights: jest.fn(),
  getOpenClaim: jest.fn(),
  listClaimLines: jest.fn(),
  listVerifiedStagePct: jest.fn(),
  countLinkedLinesByRow: jest.fn(),
  submitClaim: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../StageClaimForm', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { row: { item: { id: string } }; editable: boolean }) =>
      ReactLocal.createElement(Text, { testID: `claim-form-${props.row.item.id}` }, props.editable ? 'editable' : 'read-only'),
  };
});

import {
  countLinkedLinesByRow, getOpenClaim, listClaimLines, listStageWeights, listVerifiedStagePct, seedReferenceWeights, submitClaim,
} from '../../../../tools/progressClaims/claims';
import ProgressClaimPanel from '../ProgressClaimPanel';

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const item = (id: string, code: string, label: string, sort: number) => ({
  id, code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const kolomWeights = { boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' };
const claim = (status: string) => ({
  id: 'c1', project_id: 'p1', week_start: '2026-09-14', status, created_by: 'sup', created_at: 'x', updated_at: 'x',
  submitted_by: status === 'DRAFT' ? null : 'sup', submitted_at: null, returned_by: null, returned_at: null, return_note: null,
  verified_by: null, verified_at: null, verifier_note: null,
});
const line = {
  id: 'l1', claim_id: 'c1', project_id: 'p1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, verified_pct: null, weights_snapshot: null, row_pct_prev: null,
  row_pct_new: null, installed_before: null, delta_quantity: null, regress_reason: null, note: null, evidence: { photo_refs: [] },
  created_at: 'x', updated_at: 'x',
};

beforeEach(() => {
  jest.clearAllMocks();
  (listStageWeights as jest.Mock).mockResolvedValue([kolomWeights]);
  (seedReferenceWeights as jest.Mock).mockResolvedValue(1);
  (getOpenClaim as jest.Mock).mockResolvedValue(claim('DRAFT'));
  (listClaimLines as jest.Mock).mockResolvedValue([line]);
  (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]));
  (countLinkedLinesByRow as jest.Mock).mockResolvedValue(new Map([['k1', 2]]));
  (submitClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'SUBMITTED', lines: 1, notified: 2 });
});

describe('ProgressClaimPanel', () => {
  it('seeds reference weights for rows without them, then lists verified and claimed figures', async () => {
    (listStageWeights as jest.Mock)
      .mockResolvedValueOnce([kolomWeights])
      .mockResolvedValueOnce([kolomWeights, { boq_item_id: 'pc1', weights: { BEKISTING: 0.131, PEMBESIAN: 0.476, PENGECORAN: 0.393 }, source: 'reference', reference_class: 'PILECAP_SLOOF_PLAT_DASAR', updated_at: 'x' }]);
    const { findByText, getByText } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={ITEMS} toast={jest.fn()} />);
    expect(await findByText('Belum dikirim')).toBeTruthy();
    expect(seedReferenceWeights).toHaveBeenCalledWith('p1', [{ boq_item_id: 'pc1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' }]);
    expect(getByText('Minggu ini 61,8%')).toBeTruthy();
    expect(getByText('Terverifikasi 32,6%')).toBeTruthy();
    expect(getByText('0 foto · 2 baris laporan')).toBeTruthy();
    expect(countLinkedLinesByRow).toHaveBeenCalledWith('p1', '2026-09-14');
  });

  it('never seeds weights for a role that only reads, and explains a row without them', async () => {
    const toast = jest.fn();
    const { findByLabelText } = render(<ProgressClaimPanel projectId="p1" role="principal" boqItems={ITEMS} toast={toast} />);
    fireEvent.press(await findByLabelText('T1-002 Lantai 1 ; Pile Cap'));
    expect(seedReferenceWeights).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.', 'warning');
  });

  it('opens the stage form under the tapped row', async () => {
    const { findByLabelText, getByTestId } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={ITEMS} toast={jest.fn()} />);
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByTestId('claim-form-k1').props.children).toBe('editable');
  });

  it('opens the row it was asked to open', async () => {
    const { findByTestId } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={ITEMS} initialRowId="k1" toast={jest.fn()} />);
    expect(await findByTestId('claim-form-k1')).toBeTruthy();
  });

  it('submits the week after an inline confirmation and reloads', async () => {
    const toast = jest.fn();
    const { findByLabelText, getByLabelText } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={ITEMS} toast={toast} />);
    fireEvent.press(await findByLabelText('Kirim klaim'));
    fireEvent.press(getByLabelText('Ya, kirim'));
    await waitFor(() => expect(submitClaim).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith('Klaim dikirim. 2 orang diberi tahu untuk verifikasi.', 'ok');
  });

  it('warns when nobody could be told about the submission', async () => {
    (submitClaim as jest.Mock).mockResolvedValueOnce({ claim_id: 'c1', status: 'SUBMITTED', lines: 1, notified: 0 });
    const toast = jest.fn();
    const { findByLabelText, getByLabelText } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={ITEMS} toast={toast} />);
    fireEvent.press(await findByLabelText('Kirim klaim'));
    fireEvent.press(getByLabelText('Ya, kirim'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Klaim dikirim, tetapi belum ada estimator atau admin di proyek ini yang bisa diberi tahu.', 'warning'));
  });

  it('locks a submitted claim: a banner, no Kirim, and a read-only form', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(claim('SUBMITTED'));
    const { findByText, queryByLabelText, getByLabelText, getByTestId } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={ITEMS} toast={jest.fn()} />);
    expect(await findByText('Menunggu verifikasi estimator. Baris baru bisa ditambah setelah klaim diverifikasi atau dikembalikan.')).toBeTruthy();
    expect(queryByLabelText('Kirim klaim')).toBeNull();
    fireEvent.press(getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByTestId('claim-form-k1').props.children).toBe('read-only');
  });

  it('says so when the project has no BoQ rows to claim', () => {
    const { getByText } = render(<ProgressClaimPanel projectId="p1" role="supervisor" boqItems={EMPTY} toast={jest.fn()} />);
    expect(getByText('Belum ada baris BoQ yang bisa diklaim. BoQ proyek ini belum dipublikasikan atau belum punya volume rencana.')).toBeTruthy();
    expect(listStageWeights).not.toHaveBeenCalled();
  });
});
