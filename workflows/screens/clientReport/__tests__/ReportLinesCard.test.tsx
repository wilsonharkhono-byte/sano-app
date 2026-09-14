// workflows/screens/clientReport/__tests__/ReportLinesCard.test.tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/clientReportLines', () => {
  const actual = jest.requireActual('../../../../tools/clientReportLines');
  return {
    ...actual,
    listReportLines: jest.fn(),
    confirmSuggestedLines: jest.fn(async () => 1),
    confirmReportLine: jest.fn(async () => undefined),
    dismissReportLine: jest.fn(async () => undefined),
    reopenReportLine: jest.fn(async () => undefined),
    invokeReportLink: jest.fn(async () => ({ ok: true, code: 'LINKED', suggested: 1 })),
  };
});
// tools/clientReportLines imports tools/supabase; keep the polyfill out of jest.
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
// SelectSheet opens a Modal + FlatList; a stub carrying the value is enough here.
jest.mock('../../../components/SelectSheet', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { value: string; accessibilityLabel?: string }) =>
      ReactLocal.createElement(Text, { testID: props.accessibilityLabel }, props.value),
  };
});

import {
  listReportLines, confirmSuggestedLines, confirmReportLine, dismissReportLine, type ClientReportLine,
} from '../../../../tools/clientReportLines';
import ReportLinesCard from '../ReportLinesCard';
import type { BoqItem } from '../../../../tools/types';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const boq = [{ id: 'b1', code: 'T1-002', label: 'Lantai 1 ; Pile Cap, Sloof, Plat Lantai', planned: 216.25, unit: 'm³' }] as unknown as BoqItem[];
const line = (over: Partial<ClientReportLine> = {}): ClientReportLine => ({
  id: 'l1', report_id: 'r1', line_index: 0, line_text: 'Bekisting Pile Cap :: Melanjutkan bekisting pile cap.',
  boq_item_id: null, stage: null, activity_state: null, status: 'SUGGESTED', confirmed_by: null, confirmed_at: null,
  ai_boq_item_id: 'b1', ai_stage: 'BEKISTING', ai_activity_state: 'LANJUT', ai_confidence: 'high', ai_quote: 'Melanjutkan bekisting',
  ai_model: 'claude-opus-5', ai_run_id: 'run1', ...over,
});

describe('ReportLinesCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listReportLines as jest.Mock).mockResolvedValue([
      line(),
      line({ id: 'l2', line_index: 1, status: 'CONFIRMED', boq_item_id: 'b1', stage: 'PEMBESIAN', activity_state: 'LANJUT', line_text: 'Pembesian :: Pasang begel' }),
    ]);
  });

  it('shows the count, each line with its suggestion or decision, and the quote', async () => {
    const { findByText, getByText } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} />);
    expect(await findByText('Tautan Progres (1/2)')).toBeTruthy();
    expect(getByText('Saran: T1-002 · Bekisting · Lanjut (yakin)')).toBeTruthy();
    expect(getByText('T1-002 · Pembesian · Lanjut')).toBeTruthy();
    expect(getByText('“Melanjutkan bekisting”')).toBeTruthy();
  });

  it('confirms every ready suggestion through the bulk RPC and reloads', async () => {
    const { findByText } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} />);
    fireEvent.press(await findByText('Konfirmasi 1 saran'));
    await waitFor(() => expect(confirmSuggestedLines).toHaveBeenCalledWith('r1'));
    expect(listReportLines).toHaveBeenCalledTimes(2);
  });

  it('dismisses a line as unrelated', async () => {
    const { findAllByText } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} />);
    fireEvent.press((await findAllByText('Tidak terkait'))[0]);
    await waitFor(() => expect(dismissReportLine).toHaveBeenCalledWith('l1'));
  });

  it('seeds the inline editor from the suggestion and saves the decision', async () => {
    const { findByText, getByTestId, getByText } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} />);
    fireEvent.press(await findByText('Pilih baris'));
    expect(getByTestId('Baris BoQ untuk update 1').props.children).toBe('b1');
    expect(getByTestId('Tahap untuk update 1').props.children).toBe('BEKISTING');
    fireEvent.press(getByText('Selesai'));
    fireEvent.press(getByText('Simpan'));
    await waitFor(() => expect(confirmReportLine).toHaveBeenCalledWith('l1', { boqItemId: 'b1', stage: 'BEKISTING', activityState: 'SELESAI' }));
  });

  it('reports a failed action through the toast and keeps the card usable', async () => {
    (dismissReportLine as jest.Mock).mockRejectedValueOnce(new Error('Baris tidak ditemukan atau Anda tidak ditugaskan ke proyek ini.'));
    const toast = jest.fn();
    const { findAllByText } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={toast} />);
    fireEvent.press((await findAllByText('Tidak terkait'))[0]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Baris tidak ditemukan atau Anda tidak ditugaskan ke proyek ini.', 'critical'));
    fireEvent.press((await findAllByText('Tidak terkait'))[0]);
    await waitFor(() => expect(dismissReportLine).toHaveBeenCalledTimes(2));
  });

  it('offers to run the AI when no lines exist yet, but shows the banner instead while linking', async () => {
    (listReportLines as jest.Mock).mockResolvedValue([]);
    const { findByText, queryByText, rerender } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} />);
    expect(await findByText('Buat tautan (AI)')).toBeTruthy();
    rerender(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} linking />);
    expect(await findByText('AI sedang menautkan baris laporan…')).toBeTruthy();
    expect(queryByText('Buat tautan (AI)')).toBeNull();
  });

  it('reloads when the reload token changes, and only then', async () => {
    // One stable toast: a fresh jest.fn() per render would re-run the effect
    // by itself and hide whether the token is what triggers the reload.
    const toast = jest.fn();
    const { findByText, rerender } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={toast} reloadToken={0} />);
    await findByText('Tautan Progres (1/2)');
    rerender(<ReportLinesCard reportId="r1" boqItems={boq} toast={toast} reloadToken={0} />);
    expect(listReportLines).toHaveBeenCalledTimes(1);
    rerender(<ReportLinesCard reportId="r1" boqItems={boq} toast={toast} reloadToken={1} />);
    await waitFor(() => expect(listReportLines).toHaveBeenCalledTimes(2));
  });

  it('hides every AI action from a role that may not start AI spend', async () => {
    (listReportLines as jest.Mock).mockResolvedValue([
      line({ ai_boq_item_id: null, ai_model: null, ai_confidence: null }),
    ]);
    const { findByText, queryByText } = render(<ReportLinesCard reportId="r1" boqItems={boq} toast={jest.fn()} canRunAi={false} />);
    expect(await findByText('Belum ada saran AI')).toBeTruthy();
    expect(queryByText('Jalankan AI')).toBeNull();

    (listReportLines as jest.Mock).mockResolvedValue([]);
    const empty = render(<ReportLinesCard reportId="r2" boqItems={boq} toast={jest.fn()} canRunAi={false} />);
    expect(await empty.findByText('Belum ada tautan untuk laporan ini.')).toBeTruthy();
    expect(empty.queryByText('Buat tautan (AI)')).toBeNull();
  });
});
