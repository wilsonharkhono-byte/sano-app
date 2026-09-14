// workflows/screens/progressClaim/__tests__/StageWeightsPanel.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  listStageWeights: jest.fn(),
  seedReferenceWeights: jest.fn(),
  setStageWeights: jest.fn(),
  resetStageWeights: jest.fn(),
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));

import { listStageWeights, resetStageWeights, seedReferenceWeights, setStageWeights } from '../../../../tools/progressClaims/claims';
import StageWeightsPanel from '../StageWeightsPanel';

const item = (id: string, code: string, label: string, sort: number) => ({
  id, code, label, unit: 'm³', planned: 100, installed: 0, progress: 0, sort_order: sort, chapter: null, sub_chapter: null, superseded_at: null,
});
const ITEMS = [item('k1', 'T1-001', 'Lantai 1 ; Kolom', 1), item('pc1', 'T1-002', 'Lantai 1 ; Pile Cap', 2)];
const EMPTY: typeof ITEMS = [];
const kolomRow = { boq_item_id: 'k1', weights: { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 }, source: 'reference', reference_class: 'KOLOM', updated_at: 'x' };

const renderPanel = (role = 'estimator', items = ITEMS) => {
  const toast = jest.fn();
  return { ...render(<StageWeightsPanel projectId="p1" role={role} boqItems={items} toast={toast} />), toast };
};

beforeEach(() => {
  jest.clearAllMocks();
  (listStageWeights as jest.Mock).mockResolvedValue([kolomRow]);
  (seedReferenceWeights as jest.Mock).mockResolvedValue(1);
  (setStageWeights as jest.Mock).mockResolvedValue(undefined);
  (resetStageWeights as jest.Mock).mockResolvedValue(undefined);
});

describe('StageWeightsPanel', () => {
  it('lists each row with its weights and where they came from', async () => {
    const { findByText, getByText } = renderPanel();
    expect(await findByText('Bekisting 32,6% · Pembesian 48,6% · Pengecoran 18,8%')).toBeTruthy();
    expect(getByText('Bobot referensi (Kolom)')).toBeTruthy();
    expect(getByText('Belum diatur')).toBeTruthy();
  });

  it('applies the reference profile to rows that have no weights', async () => {
    const { findByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('Terapkan bobot referensi ke 1 baris'));
    await waitFor(() => expect(seedReferenceWeights).toHaveBeenCalledWith('p1', [{ boq_item_id: 'pc1', reference_class: 'PILECAP_SLOOF_PLAT_DASAR' }]));
    await waitFor(() => expect(listStageWeights).toHaveBeenCalledTimes(2));
    expect(toast).toHaveBeenCalledWith('1 baris memakai bobot referensi.', 'ok');
  });

  it('saves three stage weights that add up to 100', async () => {
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(getByLabelText('Bobot Bekisting').props.value).toBe('32,6');
    fireEvent.changeText(getByLabelText('Bobot Bekisting'), '30');
    fireEvent.changeText(getByLabelText('Bobot Pembesian'), '50');
    fireEvent.changeText(getByLabelText('Bobot Pengecoran'), '20');
    fireEvent.press(getByLabelText('Simpan bobot'));
    await waitFor(() => expect(setStageWeights).toHaveBeenCalledWith('k1', { BEKISTING: 0.3, PEMBESIAN: 0.5, PENGECORAN: 0.2 }));
    expect(toast).toHaveBeenCalledWith('Bobot T1-001 disimpan.', 'ok');
  });

  it('refuses weights that do not add up to 100', async () => {
    const { findByLabelText, getByLabelText, toast } = renderPanel();
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.changeText(getByLabelText('Bobot Bekisting'), '30');
    fireEvent.changeText(getByLabelText('Bobot Pembesian'), '50');
    fireEvent.changeText(getByLabelText('Bobot Pengecoran'), '19');
    fireEvent.press(getByLabelText('Simpan bobot'));
    expect(toast).toHaveBeenCalledWith('Jumlah bobot 99%, harus 100%.', 'critical');
    expect(setStageWeights).not.toHaveBeenCalled();
  });

  it('switches a row to a single stage', async () => {
    const { findByLabelText, getByLabelText } = renderPanel();
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.press(getByLabelText('Satu tahap'));
    fireEvent.press(getByLabelText('Simpan bobot'));
    await waitFor(() => expect(setStageWeights).toHaveBeenCalledWith('k1', { SINGLE: 1 }));
  });

  it('puts a row back on the reference profile of its class', async () => {
    const { findByLabelText, getByLabelText } = renderPanel();
    fireEvent.press(await findByLabelText('T1-001 Lantai 1 ; Kolom'));
    fireEvent.press(getByLabelText('Kembalikan ke referensi Kolom'));
    await waitFor(() => expect(resetStageWeights).toHaveBeenCalledWith('k1', 'KOLOM'));
  });

  it('prefills a row without weights with the reference of its class', async () => {
    const { findByLabelText, getByLabelText } = renderPanel();
    fireEvent.press(await findByLabelText('T1-002 Lantai 1 ; Pile Cap'));
    expect(getByLabelText('Bobot Bekisting').props.value).toBe('13,1');
  });

  it('only reads for a supervisor', async () => {
    const { findByText, queryByLabelText, getByLabelText } = renderPanel('supervisor');
    expect(await findByText('Belum diatur')).toBeTruthy();
    expect(queryByLabelText('Terapkan bobot referensi ke 1 baris')).toBeNull();
    fireEvent.press(getByLabelText('T1-001 Lantai 1 ; Kolom'));
    expect(queryByLabelText('Simpan bobot')).toBeNull();
  });

  it('renders nothing before a BoQ is published', () => {
    const { toJSON } = renderPanel('estimator', EMPTY);
    expect(toJSON()).toBeNull();
    expect(listStageWeights).not.toHaveBeenCalled();
  });
});
