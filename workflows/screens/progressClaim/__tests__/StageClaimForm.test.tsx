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
import { proposeFromDiary, type DiaryLine, type DiaryProposal } from '../../../../tools/progressClaims/diaryEvidence';

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
  claimNeedsRefill: false,
  ...over,
});

const setup = (over: Partial<WeightedRowView> = {}, editable = true, diary: DiaryProposal | null = null) => {
  const props = { onSaved: jest.fn(), onRemoved: jest.fn(), onClose: jest.fn(), toast: jest.fn() };
  const utils = render(<StageClaimForm projectId="p1" row={makeRow(over)} editable={editable} diary={diary} {...props} />);
  return { ...utils, ...props };
};

/** Types an exact figure, opening "Angka persis" first when the percent fields are hidden. */
const typePct = (u: ReturnType<typeof setup>, stage: string, value: string) => {
  if (!u.queryByLabelText(`Persentase ${stage}`)) fireEvent.press(u.getByLabelText('Angka persis'));
  fireEvent.changeText(u.getByLabelText(`Persentase ${stage}`), value);
};

const diaryLine = (stage: string, state: string, over: Partial<DiaryLine> = {}): DiaryLine => ({
  id: `${stage}-${state}`, boq_item_id: 'k1', stage, activity_state: state, line_text: 'Kolom K1-K8 :: pasang besi', line_index: 0,
  report_id: 'r14', report_no: 14, revision: 1, period_end: '2026-09-10', issued_at: '2026-09-10T10:00:00Z', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (saveClaimLine as jest.Mock).mockResolvedValue({ claim_id: 'c1', claim_status: 'DRAFT' });
  (pickAndUploadPhoto as jest.Mock).mockResolvedValue('progress/p1/1.jpg');
});

describe('StageClaimForm', () => {
  it('starts from the verified status and previews what a tap makes the row', () => {
    const { getByLabelText, getByText, queryByLabelText } = setup();
    expect(getByLabelText('Bekisting Selesai').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Pembesian Belum').props.accessibilityState.selected).toBe(true);
    expect(queryByLabelText('Persentase Bekisting')).toBeNull();
    expect(getByText('Bobot referensi (Kolom)')).toBeTruthy();
    fireEvent.press(getByLabelText('Pembesian Berjalan'));
    expect(getByLabelText('Pembesian Berjalan').props.accessibilityState.selected).toBe(true);
    expect(getByText('Progres baris 32,6% menjadi 56,9% (+24,3 m³)')).toBeTruthy();
  });

  it('keeps an exact figure one tap away, and shows a typed figure on the running chip', () => {
    const u = setup();
    typePct(u, 'Pembesian', '60');
    expect(u.getByText('Progres baris 32,6% menjadi 61,8% (+29,16 m³)')).toBeTruthy();
    expect(u.getByText('Berjalan · 60%')).toBeTruthy();
  });

  it('opens from the diary when nothing is saved yet, says so, and saves nothing by itself', () => {
    const lines = [diaryLine('PEMBESIAN', 'LANJUT')];
    const diary = proposeFromDiary(kolom, { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, lines);
    const { getByLabelText, getByText } = setup({}, true, diary);
    expect(getByLabelText('Pembesian Berjalan').props.accessibilityState.selected).toBe(true);
    expect(getByText('Dari laporan #14: Pembesian berjalan. Periksa lalu simpan.')).toBeTruthy();
    expect(getByText('10 Sep · #14 · Pembesian · Lanjut: Kolom K1-K8 :: pasang besi')).toBeTruthy();
    expect(saveClaimLine).not.toHaveBeenCalled();
  });

  it('keeps the saved figures over the diary, and still shows what the diary says', () => {
    const diary = proposeFromDiary(kolom, { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, [diaryLine('PEMBESIAN', 'SELESAI')]);
    const { getByLabelText, getByText } = setup({ lineId: 'l1', claimedPct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 } }, true, diary);
    expect(getByLabelText('Pembesian Berjalan').props.accessibilityState.selected).toBe(true);
    expect(getByText('Dari laporan #14: Pembesian selesai')).toBeTruthy();
  });

  it('accepts confirmed diary lines as evidence for a rise, without a photo', async () => {
    const diary = proposeFromDiary(kolom, { BEKISTING: 100, PEMBESIAN: 0, PENGECORAN: 0 }, [diaryLine('PEMBESIAN', 'LANJUT')]);
    const { getByLabelText, toast } = setup({}, true, diary);
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(saveClaimLine).toHaveBeenCalledWith(expect.objectContaining({
      claimedPct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, photoRefs: [],
    })));
    expect(toast).not.toHaveBeenCalledWith('Tambahkan minimal satu foto sebagai bukti.', 'critical');
  });

  it('saves the stage percents, note and photos into this week claim', async () => {
    const { findByText, getByLabelText, onSaved } = setup();
    fireEvent.press(getByLabelText('Pembesian Berjalan'));
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
    fireEvent.press(getByLabelText('Pembesian Berjalan'));
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Tambahkan minimal satu foto atau konfirmasi baris laporan harian sebagai bukti.', 'critical');
    expect(saveClaimLine).not.toHaveBeenCalled();
  });

  it('asks for a reason before saving a figure below the verified one', async () => {
    const u = setup({ prevPct: { BEKISTING: 100, PEMBESIAN: 40, PENGECORAN: 0 }, prevFraction: 0.5204, installedLedger: 52.04 });
    const { getByLabelText, toast } = u;
    typePct(u, 'Bekisting', '90');
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
    const u = setup();
    const { getByLabelText, getByText, toast } = u;
    typePct(u, 'Pengecoran', '120');
    expect(getByText('Persentase pengecoran harus angka 0 sampai 100.')).toBeTruthy();
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    expect(toast).toHaveBeenCalledWith('Persentase pengecoran harus angka 0 sampai 100.', 'critical');
  });

  it('shows the server refusal sentence', async () => {
    (saveClaimLine as jest.Mock).mockRejectedValueOnce(new Error('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.'));
    const u = setup({ photoRefs: ['progress/p1/0.jpg'] });
    const { getByLabelText, toast } = u;
    typePct(u, 'Pembesian', '10');
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

  it('asks for the percents again when the weights changed shape after the claim', () => {
    const { getByText } = setup({
      weights: { SINGLE: 1 }, prevPct: { SINGLE: 0 }, prevFraction: 0, lineId: 'l1',
      claimedPct: { BEKISTING: 100, PEMBESIAN: 60, PENGECORAN: 0 }, claimNeedsRefill: true,
    });
    expect(getByText('Bobot baris ini berubah setelah diklaim. Isi ulang persentasenya lalu simpan.')).toBeTruthy();
  });

  it('asks the panel to reload when the server says the claim moved on', async () => {
    (saveClaimLine as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Klaim sedang diverifikasi. Tunggu hasilnya sebelum menambah progres.'), { code: 'CLAIM_LOCKED' }));
    const onStale = jest.fn();
    const { getByLabelText } = render(
      <StageClaimForm projectId="p1" row={makeRow({ photoRefs: ['progress/p1/0.jpg'] })} editable onSaved={jest.fn()} onRemoved={jest.fn()} onStale={onStale} onClose={jest.fn()} toast={jest.fn()} />,
    );
    fireEvent.press(getByLabelText('Pembesian Berjalan'));
    fireEvent.press(getByLabelText('Simpan progres T1-001'));
    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });

  it('only reads when the claim is waiting for verification', () => {
    const { getByLabelText, queryByLabelText, getByText } = setup({ photoRefs: ['a', 'b'] }, false);
    expect(getByLabelText('Persentase Bekisting').props.editable).toBe(false);
    expect(queryByLabelText('Simpan progres T1-001')).toBeNull();
    expect(queryByLabelText('Bekisting Selesai')).toBeNull();
    expect(getByText('2 foto terlampir')).toBeTruthy();
  });
});
