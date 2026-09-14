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
  listEntryTotals: jest.fn(),
  submitClaim: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../StageClaimForm', () => {
  const ReactLocal = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { row: { item: { id: string } }; editable: boolean; onSaved: () => void }) =>
      ReactLocal.createElement(
        View,
        { testID: `claim-form-${props.row.item.id}` },
        ReactLocal.createElement(Text, null, props.editable ? 'editable' : 'read-only'),
        ReactLocal.createElement(TouchableOpacity, { onPress: props.onSaved, accessibilityLabel: 'Simulasi simpan' }, ReactLocal.createElement(Text, null, 'Simulasi simpan')),
      ),
  };
});

import {
  countLinkedLinesByRow, getOpenClaim, listClaimLines, listEntryTotals, listStageWeights, listVerifiedStagePct, seedReferenceWeights,
  submitClaim,
} from '../../../../tools/progressClaims/claims';
import ProgressClaimPanel from '../ProgressClaimPanel';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const item = (id: string, code: string, label: string, sort: number, projectId = 'p1') => ({
  id, project_id: projectId, code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const kolomWeights = { boq_item_id: 'k1', weights: kolom, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' };
const claim = (status: string, over: Record<string, unknown> = {}) => ({
  id: 'c1', project_id: 'p1', week_start: '2026-09-14', status, created_by: 'sup', created_at: 'x', updated_at: 'x',
  submitted_by: status === 'DRAFT' ? null : 'sup', submitted_at: null, returned_by: null, returned_at: null, return_note: null,
  verified_by: null, verified_at: null, verifier_note: null, ...over,
});
const line = {
  id: 'l1', claim_id: 'c1', project_id: 'p1', boq_item_id: 'k1', prev_verified: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimed_pct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, verified_pct: null, weights_snapshot: null, row_pct_prev: null,
  row_pct_new: null, installed_before: null, delta_quantity: null, regress_reason: null, note: null, evidence: { photo_refs: [] },
  created_by: 'sup', updated_by: 'sup', created_at: 'x', updated_at: 'x',
};
const renderPanel = (over: Partial<React.ComponentProps<typeof ProgressClaimPanel>> = {}) => {
  const toast = jest.fn();
  const props = { projectId: 'p1', role: 'supervisor', boqItems: ITEMS, toast, ...over };
  return { ...render(<ProgressClaimPanel {...props} />), toast, props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (listStageWeights as jest.Mock).mockResolvedValue([kolomWeights]);
  (seedReferenceWeights as jest.Mock).mockResolvedValue(1);
  (getOpenClaim as jest.Mock).mockResolvedValue(claim('DRAFT'));
  (listClaimLines as jest.Mock).mockResolvedValue([line]);
  (listVerifiedStagePct as jest.Mock).mockResolvedValue(new Map([['k1', { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }]]));
  (countLinkedLinesByRow as jest.Mock).mockResolvedValue(new Map([['k1', 2]]));
  (listEntryTotals as jest.Mock).mockResolvedValue(new Map([['k1', 32.6]]));
  (submitClaim as jest.Mock).mockResolvedValue({ claim_id: 'c1', status: 'SUBMITTED', lines: 1, notified: 2, verifiers_notified: 2 });
});

describe('ProgressClaimPanel', () => {
  it('seeds reference weights for rows without them, then lists verified and claimed figures', async () => {
    (listStageWeights as jest.Mock)
      .mockResolvedValueOnce([kolomWeights])
      .mockResolvedValueOnce([kolomWeights, { boq_item_id: 'pc1', weights: { BEKISTING: 0.131, PEMBESIAN: 0.476, PENGECORAN: 0.393 }, source: 'reference', reference_class: 'PILECAP_SLOOF_PLAT_DASAR', updated_at: 'x' }]);
    const { findByText, getByText } = renderPanel();
    expect(await findByText('Belum dikirim')).toBeTruthy();
    expect(seedReferenceWeights).toHaveBeenCalledWith('p1', [{ boq_item_id: 'pc1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' }]);
    expect(getByText('Minggu ini 61,8%')).toBeTruthy();
    expect(getByText('Terverifikasi 32,6%')).toBeTruthy();
    expect(getByText('0 foto · 2 baris laporan')).toBeTruthy();
    expect(countLinkedLinesByRow).toHaveBeenCalledWith('p1', '2026-09-14');
    expect(listEntryTotals).toHaveBeenCalledWith('p1');
  });

  it('never seeds weights for a role that only reads, and explains a row without them', async () => {
    const { findByLabelText, toast } = renderPanel({ role: 'principal' });
    fireEvent.press(await findByLabelText('T1-002 Lantai 1 ; Pile Cap'));
    expect(seedReferenceWeights).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.', 'warning');
  });

  it('opens the stage form under the tapped row and reloads after a save', async () => {
    const { findByLabelText, getByLabelText, getByTestId, getByText } = renderPanel();
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByTestId('claim-form-k1')).toBeTruthy();
    expect(getByText('editable')).toBeTruthy();
    fireEvent.press(getByLabelText('Simulasi simpan'));
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
  });

  it('opens the row it was asked to open', async () => {
    const { findByTestId } = renderPanel({ initialRowId: 'k1' });
    expect(await findByTestId('claim-form-k1')).toBeTruthy();
  });

  it('submits the week after an inline confirmation, names who was told, and reloads', async () => {
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Kirim klaim'));
    fireEvent.press(getByLabelText('Ya, kirim'));
    await waitFor(() => expect(submitClaim).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith('Klaim dikirim. 2 estimator atau admin diberi tahu untuk verifikasi.', 'ok');
  });

  it.each([
    [{ notified: 1, verifiers_notified: 0 }, 'Klaim dikirim, tetapi belum ada estimator atau admin di proyek ini. Prinsipal diberi tahu agar menugaskan verifikator.'],
    [{ notified: 0, verifiers_notified: 0 }, 'Klaim dikirim, tetapi belum ada yang bisa diberi tahu. Minta admin menugaskan estimator ke proyek ini.'],
  ])('warns when no verifier could be told (%j)', async (counts, message) => {
    (submitClaim as jest.Mock).mockResolvedValueOnce({ claim_id: 'c1', status: 'SUBMITTED', lines: 1, ...counts });
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Kirim klaim'));
    fireEvent.press(getByLabelText('Ya, kirim'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(message, 'warning'));
  });

  it('locks a submitted claim: a banner, no Kirim, and a read-only form', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(claim('SUBMITTED'));
    const { findByText, queryByLabelText, getByLabelText, getByText } = renderPanel();
    expect(await findByText('Menunggu verifikasi estimator. Baris baru bisa ditambah setelah klaim diverifikasi atau dikembalikan.')).toBeTruthy();
    expect(queryByLabelText('Kirim klaim')).toBeNull();
    fireEvent.press(getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByText('read-only')).toBeTruthy();
  });

  it('lets the supervisor edit and resend a returned claim, showing why it came back', async () => {
    (getOpenClaim as jest.Mock).mockResolvedValue(claim('RETURNED', { return_note: 'Foto pembesian kurang jelas' }));
    const { findByText, getByLabelText, getByText } = renderPanel();
    expect(await findByText('Dikembalikan')).toBeTruthy();
    expect(getByText(`Minggu 14${String.fromCharCode(0x2013)}20 Sep: Foto pembesian kurang jelas`)).toBeTruthy();
    expect(getByLabelText('Kirim klaim')).toBeTruthy();
    fireEvent.press(getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByText('editable')).toBeTruthy();
  });

  it('reloads when asked to, as a notification tap does', async () => {
    const { findByText, rerender, props } = renderPanel();
    await findByText('Belum dikirim');
    rerender(<ProgressClaimPanel {...props} reloadKey={1} />);
    await waitFor(() => expect(getOpenClaim).toHaveBeenCalledTimes(2));
  });

  it("never shows the previous project's claim or rows after a project switch", async () => {
    const { findByText, rerender, props, getByLabelText, queryByText } = renderPanel();
    await findByText('Belum dikirim');
    rerender(<ProgressClaimPanel {...props} projectId="p2" />);
    expect(getByLabelText('Memuat klaim progres')).toBeTruthy();
    expect(queryByText('Belum dikirim')).toBeNull();
    expect(listStageWeights).not.toHaveBeenCalledWith('p2');
  });

  it('says so when the project has no BoQ rows to claim', () => {
    const { getByText } = renderPanel({ boqItems: EMPTY });
    expect(getByText('Belum ada baris BoQ yang bisa diklaim. BoQ proyek ini belum dipublikasikan atau belum punya volume rencana.')).toBeTruthy();
    expect(listStageWeights).not.toHaveBeenCalled();
  });
});
