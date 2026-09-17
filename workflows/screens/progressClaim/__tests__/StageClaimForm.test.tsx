// workflows/screens/progressClaim/__tests__/StageClaimForm.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/progressClaims/claims', () => ({
  saveClaimLine: jest.fn(),
  removeClaimLine: jest.fn(),
}));
jest.mock('../../../../tools/storage', () => ({ pickAndUploadPhoto: jest.fn() }));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../components/PhotoGalleryField', () => {
  const ReactLocal = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { photoPaths: string[]; onAdd: () => void }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(TouchableOpacity, { onPress: props.onAdd, accessibilityLabel: 'Tambah foto' }, ReactLocal.createElement(Text, null, 'Tambah foto')),
        ReactLocal.createElement(Text, null, `${props.photoPaths.length} foto dipilih`),
      ),
  };
});

import { removeClaimLine, saveClaimLine } from '../../../../tools/progressClaims/claims';
import { pickAndUploadPhoto } from '../../../../tools/storage';
import StageClaimForm, { type WeightedRowView } from '../StageClaimForm';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const kolom = { BEKISTING: 0.326, PEMBESIAN: 0.486, PENGECORAN: 0.188 };
const makeRow = (over: Partial<WeightedRowView> = {}): WeightedRowView => ({
  item: { id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 32.6, progress: 32.6 },
  weights: kolom,
  source: 'reference',
  referenceClass: 'KOLOM',
  prevPct: { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 },
  claimedPct: null,
  lineId: null,
  note: null,
  regressReason: null,
  photoRefs: [],
  prevFraction: 0.326,
  claimedFraction: null,
  linkedLines: 0,
  installedLedger: 32.6,
  installedMismatch: false,
  ...over,
});

const setup = (over: Partial<WeightedRowView> = {}, editable = true) => {
  const props = { onSaved: jest.fn(), onRemoved: jest.fn(), onClose: jest.fn(), toast: jest.fn() };
  const utils = render(<StageClaimForm projectId="p1" row={makeRow(over)} editable={editable} {...props} />);
  return { ...utils, ...props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (saveClaimLine as jest.Mock).mockResolvedValue({ claim_id: 'c1', claim_status: 'DRAFT' });
  (pickAndUploadPhoto as jest.Mock).mockResolvedValue('progress/p1/1.jpg');
});

describe('StageClaimForm', () => {
  it('starts from the verified figures and previews what the row becomes', () => {
    const { getByLabelText, getByText } = setup();
    expect(getByLabelText('Persentase Bekisting').props.value).toBe('100');
    expect(getByText('Bobot referensi (Kolom)')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Persentase Pembesian'), '60');
    expect(getByText('Progres baris 32,6% menjadi 61,8% (+29,16 m³)')).toBeTruthy();
  });

  it('saves the stage percents, note and photos into this week claim', async () => {
    const { findByText, getByLabelText, onSaved } = setup();
    fireEvent.press(getByLabelText('Pembesian 50 persen'));
    fireEvent.changeText(getByLabelText('Catatan progres'), 'Begel K1-K8');
    fireEvent.press(getByLabelText('Tambah foto'));
    // Save only once the uploaded photo is in the form, or the save races it.
    expect(await findByText('1 foto dipilih')).toBeTruthy();
    expect(pickAndUploadPhoto).toHaveBeenCalledWith('progress/p1');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(saveClaimLine).toHaveBeenCalledWith({
      projectId: 'p1', boqItemId: 'k1', claimedPct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 },
      note: 'Begel K1-K8', photoRefs: ['progress/p1/1.jpg'], regressReason: null,
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('asks for a photo before saving an increase', async () => {
    const { getByLabelText, toast } = setup();
    fireEvent.changeText(getByLabelText('Persentase Pembesian'), '60');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Tambahkan minimal satu foto sebagai bukti.', 'critical');
    expect(saveClaimLine).not.toHaveBeenCalled();
  });

  it('asks for a reason before saving a figure below the verified one', async () => {
    const { getByLabelText, toast } = setup({ prevPct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, prevFraction: 0.5204, installedLedger: 52.04 });
    fireEvent.changeText(getByLabelText('Persentase Bekisting'), '90');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Penurunan progres wajib disertai alasan.', 'critical');
    fireEvent.changeText(getByLabelText('Alasan penurunan'), 'Bekisting K3 dibongkar ulang');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(saveClaimLine).toHaveBeenCalledWith(expect.objectContaining({
      claimedPct: { BEKISTING: 90, PEMBESIAN: 40, PENGECORAN: 0 }, regressReason: 'Bekisting K3 dibongkar ulang',
    })));
  });

  it('asks for a reason when re-weighting lowers the quantity although no stage dropped', () => {
    const { getByLabelText, getByText, toast } = setup({
      weights: { BEKISTING: 0.2, PEMBESIAN: 0.5, PENGECORAN: 0.3 },
      prevPct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 },
      prevFraction: 0.4,
      installedLedger: 52.04,
    });
    expect(getByText('Progres baris 40% menjadi 40% (-12,04 m³)')).toBeTruthy();
    expect(getByText('Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.')).toBeTruthy();
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Penurunan progres wajib disertai alasan.', 'critical');
    expect(saveClaimLine).not.toHaveBeenCalled();
  });

  it('says when installed on the BoQ differs from the progress history', () => {
    const { getByText } = setup({
      item: { id: 'k1', code: 'T1-001', label: 'Lantai 1 ; Kolom', unit: 'm³', planned: 100, installed: 10, progress: 10 },
      installedLedger: 0,
      installedMismatch: true,
    });
    expect(getByText('Terpasang di BoQ 10 m³ berbeda dari riwayat progres 0 m³; verifikasi mengikuti riwayat.')).toBeTruthy();
  });

  it('refuses an invalid percent with the reason', () => {
    const { getByLabelText, getByText, toast } = setup();
    fireEvent.changeText(getByLabelText('Persentase Pengecoran'), '120');
    expect(getByText('Persentase pengecoran harus angka 0 sampai 100.')).toBeTruthy();
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Persentase pengecoran harus angka 0 sampai 100.', 'critical');
  });

  it('shows the server refusal sentence', async () => {
    (saveClaimLine as jest.Mock).mockRejectedValueOnce(new Error('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.'));
    const { getByLabelText, toast } = setup({ photoRefs: ['progress/p1/0.jpg'] });
    fireEvent.changeText(getByLabelText('Persentase Pembesian'), '10');
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.', 'critical'));
  });

  it('removes the row from the claim', async () => {
    const { getByLabelText, onRemoved } = setup({ lineId: 'l1', claimedPct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 } });
    expect(getByLabelText('Persentase Pembesian').props.value).toBe('60');
    fireEvent.press(getByLabelText('Hapus T1-001 dari klaim'));
    await waitFor(() => expect(removeClaimLine).toHaveBeenCalledWith('l1'));
    expect(onRemoved).toHaveBeenCalled();
  });

  it('only reads when the claim is waiting for verification', () => {
    const { getByLabelText, queryByLabelText, getByText } = setup({ photoRefs: ['a', 'b'] }, false);
    expect(getByLabelText('Persentase Bekisting').props.editable).toBe(false);
    expect(queryByLabelText('Simpan progres T1-001')).toBeNull();
    expect(queryByLabelText('Bekisting 100 persen')).toBeNull();
    expect(getByText('2 foto terlampir')).toBeTruthy();
  });
});
