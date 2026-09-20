// workflows/components/analytics/__tests__/ProjectAnalytics.test.tsx
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/analytics/data', () => ({
  loadProgressEntries: jest.fn(),
  loadDiaryData: jest.fn(),
  loadMaterialData: jest.fn(),
  loadApprovalData: jest.fn(),
  loadChainSupport: jest.fn(),
  saveProjectDates: jest.fn(),
  validateProjectDates: jest.requireActual('../../../../tools/analytics/data').validateProjectDates,
}));
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../DateSelectField', () => {
  const ReactLocal = require('react');
  const { TextInput } = require('react-native');
  return { __esModule: true, default: (props: { value: string; onChange: (v: string) => void; accessibilityLabel?: string }) =>
    ReactLocal.createElement(TextInput, { value: props.value, onChangeText: props.onChange, accessibilityLabel: props.accessibilityLabel }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { loadApprovalData, loadChainSupport, loadDiaryData, loadMaterialData, loadProgressEntries, saveProjectDates } from '../../../../tools/analytics/data';
import ProjectAnalytics from '../ProjectAnalytics';
import SCurveCard from '../SCurveCard';

jest.setTimeout(20000);

const PROJECT = { id: 'p1', start_date: '2026-08-31', end_date: '2026-11-29' };
const ITEMS = [{ id: 'a', planned: 100, project_id: 'p1' }, { id: 'b', planned: 300, project_id: 'p1' }];
const entry = (row: string, quantity: number, at: string) => ({ boq_item_id: row, quantity, created_at: at });

beforeEach(() => {
  jest.clearAllMocks();
  (loadProgressEntries as jest.Mock).mockResolvedValue([]);
  (loadDiaryData as jest.Mock).mockResolvedValue({ reports: [], links: new Map() });
  (loadMaterialData as jest.Mock).mockResolvedValue({ planned: [], requests: [], catalog: new Map() });
  (loadApprovalData as jest.Mock).mockResolvedValue([]);
  (loadChainSupport as jest.Mock).mockResolvedValue({ diary: { lines: [], readable: true }, weights: [], verified: [] });
  (saveProjectDates as jest.Mock).mockResolvedValue(undefined);
});

describe('SCurveCard', () => {
  const card = (over: Partial<React.ComponentProps<typeof SCurveCard>> = {}) => render(
    <SCurveCard project={PROJECT} items={ITEMS} role="estimator" loadEntries={loadProgressEntries as never} onDatesSaved={jest.fn()} today="2026-09-24" {...over} />,
  );

  it('shows the plan with an empty actual line and says so, before any claim is verified', async () => {
    const { findByText, getByText, queryByLabelText } = card();
    expect(await findByText('Belum ada progres terverifikasi.')).toBeTruthy();
    expect(getByText('0%')).toBeTruthy();
    expect(getByText('Rencana (asumsi kurva-S)')).toBeTruthy();
    expect(getByText('Sumber: 0 entri progres terverifikasi. Rencana: asumsi kurva-S 31 Agu 2026 – 29 Nov 2026, bukan jadwal rinci.')).toBeTruthy();
    expect(queryByLabelText('Ubah tanggal proyek')).toBeNull();
  });

  it('shows verified progress, the pace and the projected finish against the plan', async () => {
    (loadProgressEntries as jest.Mock).mockResolvedValue([
      entry('b', 40, '2026-09-02T03:00:00Z'), entry('b', 40, '2026-09-09T03:00:00Z'), entry('b', 40, '2026-09-16T03:00:00Z'), entry('b', 40, '2026-09-23T03:00:00Z'),
    ]);
    const { findByText, getByText } = card();
    expect(await findByText('40%')).toBeTruthy();
    expect(getByText('10% / mgg')).toBeTruthy();
    expect(getByText('2 Nov 2026')).toBeTruthy();
    expect(getByText('3 minggu lebih cepat dari rencana')).toBeTruthy();
    expect(getByText('Proyeksi memakai laju 10% per minggu dari 3 minggu terakhir.')).toBeTruthy();
  });

  it('asks for the project dates instead of inventing a plan, and lets admin and principal set them', async () => {
    const onDatesSaved = jest.fn();
    const { findByText, getByLabelText } = card({ project: { id: 'p1', start_date: '2026-07-01', end_date: null }, role: 'admin', onDatesSaved });
    expect(await findByText('Isi tanggal selesai rencana untuk menggambar kurva rencana.')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Tanggal selesai rencana'), '2026-06-01');
    fireEvent.press(getByLabelText('Simpan tanggal proyek'));
    expect(await findByText('Tanggal selesai rencana harus setelah tanggal mulai.')).toBeTruthy();
    expect(saveProjectDates).not.toHaveBeenCalled();
    fireEvent.changeText(getByLabelText('Tanggal selesai rencana'), '2027-06-30');
    fireEvent.press(getByLabelText('Simpan tanggal proyek'));
    await waitFor(() => expect(saveProjectDates).toHaveBeenCalledWith('p1', '2026-07-01', '2027-06-30'));
    expect(onDatesSaved).toHaveBeenCalled();
  });

  it('tells other roles who can fill the dates', async () => {
    const { findByText, queryByLabelText } = card({ project: { id: 'p1', start_date: null, end_date: null }, role: 'supervisor' });
    expect(await findByText('Tanggal proyek belum diisi. Minta admin atau prinsipal mengisi tanggal mulai dan selesai rencana.')).toBeTruthy();
    expect(queryByLabelText('Simpan tanggal proyek')).toBeNull();
  });

  it('shows a failed read with a retry, never an empty chart', async () => {
    (loadProgressEntries as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const { findByText, getByLabelText } = card();
    expect(await findByText('Kurva-S gagal dimuat: boom')).toBeTruthy();
    fireEvent.press(getByLabelText('Muat ulang Kurva-S'));
    expect(await findByText('Belum ada progres terverifikasi.')).toBeTruthy();
  });
});

describe('ProjectAnalytics', () => {
  const block = (wide = false) => render(<ProjectAnalytics project={PROJECT} boqItems={ITEMS} role="supervisor" wide={wide} onProjectChanged={jest.fn()} />);

  it('keeps the other cards closed on a phone and reads their data only when opened', async () => {
    const { findByText, getByLabelText } = block();
    expect(await findByText('Belum ada progres terverifikasi.')).toBeTruthy();
    expect(loadMaterialData).not.toHaveBeenCalled();
    expect(loadApprovalData).not.toHaveBeenCalled();
    expect(loadChainSupport).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Alur Persetujuan Material'));
    expect(await findByText('Belum ada permintaan material untuk proyek ini.')).toBeTruthy();
    expect(loadApprovalData).toHaveBeenCalledWith('p1');
  });

  it('opens every card on a wide screen, sharing one diary read between cards', async () => {
    (loadDiaryData as jest.Mock).mockResolvedValue({
      reports: [{ id: 'r1', report_no: 1, revision: 1, period_start: '2026-09-07', crewTotal: 24, updates: [{ area: 'Basement', note: 'Penulangan sloof' }] }],
      links: new Map(),
    });
    (loadMaterialData as jest.Mock).mockResolvedValue({
      planned: [{ material_id: 'besi', boq_item_id: 'a', planned_quantity: 1000 }, { material_id: 'semen', boq_item_id: 'a', planned_quantity: 200 }],
      requests: [{ material_id: 'besi', quantity: 310, status: 'APPROVED', created_at: '2026-08-24T02:00:00Z', reviewed_at: null, allocations: [] }],
      catalog: new Map([['besi', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }], ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }]]),
    });
    (loadApprovalData as jest.Mock).mockResolvedValue([{ created_at: '2026-08-24T02:00:00Z', reviewed_at: '2026-08-26T02:00:00Z', overall_status: 'APPROVED' }]);
    const { findByText, getByText, getAllByText } = block(true);
    expect(await findByText('Besi (kg) → Pembesian')).toBeTruthy();
    expect(getAllByText('31 %').length).toBeGreaterThanOrEqual(2);
    expect(getAllByText('belum ada progres terverifikasi').length).toBeGreaterThanOrEqual(1);
    expect(getByText(/^Rencana 1\.000 kg/)).toBeTruthy();
    expect(loadChainSupport).toHaveBeenCalledWith('p1');
    expect(getByText('Diminta pertama 24 Agu; pembesian muncul di laporan harian 14 hari kemudian.')).toBeTruthy();
    expect(getByText('Belum pernah diminta: Material Beton (zak).')).toBeTruthy();
    expect(await findByText('2 hari')).toBeTruthy();
    expect(await findByText(/^1 laporan · /)).toBeTruthy();
    expect(loadDiaryData).toHaveBeenCalledTimes(1);
  });

  it('draws nothing without a project', () => {
    const { toJSON } = render(<ProjectAnalytics project={null} boqItems={[]} role="admin" onProjectChanged={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });
});
