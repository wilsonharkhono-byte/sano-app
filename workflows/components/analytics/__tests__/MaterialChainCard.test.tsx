// workflows/components/analytics/__tests__/MaterialChainCard.test.tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
import type { ChainSupport, DiaryData, MaterialData } from '../../../../tools/analytics/data';
import { buildMaterialChain } from '../../../../tools/analytics/materialChain';
import MaterialChainCard, { qtyText, trendModel } from '../MaterialChainCard';

const catalog = new Map([
  ['besi', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }],
]);
// Typed as the read it stands in for, so a project-level plan line (boq_item_id: null) fits too.
const material: MaterialData = {
  planned: [
    { material_id: 'besi', boq_item_id: 'k1', planned_quantity: 1000 },
    { material_id: 'besi', boq_item_id: 'k2', planned_quantity: 3000 },
    { material_id: 'semen', boq_item_id: 'k1', planned_quantity: 200 },
  ],
  requests: [
    { material_id: 'besi', quantity: 500, status: 'APPROVED', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', allocations: [] },
    { material_id: 'besi', quantity: 2000, status: 'APPROVED', created_at: '2026-08-17T02:00:00Z', reviewed_at: '2026-08-19T02:00:00Z', allocations: [] },
    { material_id: 'besi', quantity: 900, status: 'PENDING', created_at: '2026-08-20T02:00:00Z', reviewed_at: null, allocations: [] },
  ],
  catalog,
};
const diary: DiaryData = { reports: [], links: new Map() };
const chain: ChainSupport = {
  diary: { lines: [], readable: true },
  weights: [{ boq_item_id: 'k1', weights: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 }, source: 'rab', reference_class: null, updated_at: 'x' }],
  verified: [
    { boq_item_id: 'k1', verified_pct: { BEKISTING: 100, PEMBESIAN: 50, PENGECORAN: 0 }, weights_snapshot: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 }, verified_at: '2026-08-26T03:00:00Z' },
    { boq_item_id: 'k1', verified_pct: { BEKISTING: 100, PEMBESIAN: 100, PENGECORAN: 0 }, weights_snapshot: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 }, verified_at: '2026-09-02T03:00:00Z' },
    { boq_item_id: 'k2', verified_pct: { SINGLE: 25 }, weights_snapshot: { SINGLE: 1 }, verified_at: '2026-09-09T03:00:00Z' },
  ],
};

const card = (over: { material?: MaterialData; chain?: ChainSupport; diary?: DiaryData; loadChain?: () => Promise<ChainSupport> } = {}) => render(
  <MaterialChainCard
    loadMaterial={() => Promise.resolve(over.material ?? material)}
    loadDiary={() => Promise.resolve(over.diary ?? diary)}
    loadChain={over.loadChain ?? (() => Promise.resolve(over.chain ?? chain))}
    today="2026-09-17"
  />,
);
/** The group the card opens on, straight from the builder, so the trend can be read without rendering. */
const besi = () => buildMaterialChain({
  today: '2026-09-17', planned: material.planned, requests: material.requests, catalog: material.catalog,
  weights: chain.weights, verifiedLines: chain.verified, diary: chain.diary,
}).groups[0];

describe('qtyText', () => {
  it('reads kilograms as tonnes from a thousand and keeps other units', () => {
    expect(qtyText(748, 'kg')).toBe('748 kg');
    expect(qtyText(41800, 'kg')).toBe('41,8 t');
    expect(qtyText(-1252, 'kg')).toBe('-1,3 t');
    expect(qtyText(42, 'lbr')).toBe('42 lbr');
  });
});

describe('trendModel', () => {
  it('names the window the projection measured and marks the lead and the cover the chart can draw', () => {
    const { series, annotations } = trendModel(besi());
    expect(series.find((s) => s.key === 'projected')?.label).toBe('Proyeksi laju 3 minggu (titik-titik)');
    expect(annotations.map((an) => an.key)).toEqual(['lead', 'cover']);
    // This week is index 5 of the 12 weeks drawn, and the 2-week cover ends at index 7.
    expect(annotations[1]).toMatchObject({ kind: 'run', fromIndex: 5, toIndex: 7, label: 'cukup ~2 minggu' });
  });

  it('drops the cover run when it runs past the weeks drawn or lasts under a week', () => {
    const g = besi();
    // 5 + 7 is past the last of the 12 weeks: a clamped run would say a cover the chart does not show.
    expect(trendModel({ ...g, relation: { ...g.relation, coverWeeks: 7 } }).annotations.map((an) => an.key)).toEqual(['lead']);
    expect(trendModel({ ...g, relation: { ...g.relation, coverWeeks: 0 } }).annotations.map((an) => an.key)).toEqual(['lead']);
  });
});

describe('MaterialChainCard', () => {
  it('opens on the largest plan with this week’s rings, the relation tiles and the caption', async () => {
    const { findAllByText, getByText, getByLabelText } = card();
    // The hero figure and the Terpasang row both read it.
    expect(await findAllByText('43,8 %')).toHaveLength(2);
    expect(getByText('terpasang, terverifikasi')).toBeTruthy();
    expect(getByLabelText('Besi (kg) → Pembesian').props.accessibilityState).toEqual({ selected: true });
    expect(getByText('85 %')).toBeTruthy();
    expect(getByText('62,5 %')).toBeTruthy();
    expect(getByText('750 kg')).toBeTruthy();
    expect(getByText('disetujui − terpasang · 18,8 poin')).toBeTruthy();
    expect(getByText('~4 minggu')).toBeTruthy();
    expect(getByText('~2 minggu')).toBeTruthy();
    expect(getByText('pada laju 10,4 poin/minggu (3 minggu terakhir)')).toBeTruthy();
    expect(getByText(/^Rencana 4\.000 kg per area kerja/)).toBeTruthy();
    expect(getByText('Belum pernah diminta: Material Beton (zak).')).toBeTruthy();
    // The besi request is 38 days old and the diary is empty, so the waiting warning applies.
    expect(getByText('Material diminta 38 hari lalu, pembesian belum muncul di laporan harian (batas 14 hari).')).toBeTruthy();
  });

  it('switches the group with the chips, switches rings off and on, and opens the weekly trend inline', async () => {
    const { findAllByText, getAllByText, getByLabelText, getByText, queryByLabelText } = card();
    await findAllByText('43,8 %');
    fireEvent.press(getByLabelText('Tampilkan cincin Diminta'));
    expect(getByLabelText('Tampilkan cincin Diminta').props.accessibilityState).toEqual({ checked: false });
    fireEvent.press(getByLabelText('Tampilkan cincin Diminta'));
    expect(getByLabelText('Tampilkan cincin Diminta').props.accessibilityState).toEqual({ checked: true });
    // Besi's pace was measured over 3 weeks, and the legend says so rather than claiming the full 4.
    expect(queryByLabelText('Tampilkan Proyeksi laju 3 minggu (titik-titik)')).toBeNull();
    fireEvent.press(getByLabelText('Lihat tren mingguan'));
    expect(getByLabelText('Tampilkan Proyeksi laju 3 minggu (titik-titik)')).toBeTruthy();
    expect(getByLabelText('Tampilkan Menurut laporan harian (belum diverifikasi)').props.accessibilityState).toEqual({ checked: false });
    // Diminta starts off on the chart and the chart's own switch turns it back on.
    expect(getByLabelText('Tampilkan Diminta').props.accessibilityState).toEqual({ checked: false });
    fireEvent.press(getByLabelText('Tampilkan Diminta'));
    expect(getByLabelText('Tampilkan Diminta').props.accessibilityState).toEqual({ checked: true });
    expect(getByText('Sembunyikan tren')).toBeTruthy();
    fireEvent.press(getByLabelText('Semen (zak) → Pengecoran'));
    expect(getByText(/^Rencana 200 zak per area kerja/)).toBeTruthy();
    // Semen: k1's verified Pengecoran is 0 %, and nothing was requested, so the hero and the
    // Diminta, Disetujui and Terpasang rows all read 0 %; the diary row has no figure and reads "—".
    expect(getAllByText('0 %')).toHaveLength(4);
    // Semen has no pace, so its projection legend keeps the plain window; hiding the trend takes it away.
    expect(getByLabelText('Tampilkan Proyeksi laju 4 minggu (titik-titik)')).toBeTruthy();
    fireEvent.press(getByLabelText('Sembunyikan tren'));
    expect(queryByLabelText('Tampilkan Proyeksi laju 4 minggu (titik-titik)')).toBeNull();
  });

  it('says why the numbers are missing before anything is verified, and warns when work outruns approvals', async () => {
    const { findAllByText, getByText, getAllByText } = card({ chain: { ...chain, verified: [] } });
    // Under the hero and in the stock tile.
    expect(await findAllByText('belum ada progres terverifikasi')).toHaveLength(2);
    // The hero, the Terpasang and diary rows, and all three tile values.
    expect(getAllByText('—')).toHaveLength(6);
    expect(getByText('belum bisa dihitung')).toBeTruthy();
    expect(getByText('belum ada laju')).toBeTruthy();
    const over = card({ material: { ...material, requests: material.requests.slice(0, 1) } });
    expect(await over.findByText('Pekerjaan melebihi material yang disetujui: terpasang 43,8 %, disetujui 12,5 %.')).toBeTruthy();
  });

  it('reads a cover of under half a week as “< 1 minggu” and names the window the pace came from', async () => {
    const thin: MaterialData = { ...material, requests: [{ material_id: 'besi', quantity: 1751, status: 'APPROVED', created_at: '2026-08-10T02:00:00Z', reviewed_at: '2026-08-12T02:00:00Z', allocations: [] }] };
    const { findByText, getByText } = card({ material: thin });
    // 1 751 kg approved − 1 750 kg verified: one kilogram of stock, under half a week at 10,4 poin/minggu.
    expect(await findByText('< 1 minggu')).toBeTruthy();
    expect(getByText('pada laju 10,4 poin/minggu (3 minggu terakhir)')).toBeTruthy();
  });

  it('warns that the diary’s work types behind the lag sentence are still keyword guesses', async () => {
    const guessed: DiaryData = {
      reports: [{ id: 'r1', report_no: 1, revision: 1, period_start: '2026-09-08', crewTotal: 6, updates: [{ area: 'Sloof', note: 'Penulangan sloof' }] }],
      links: new Map(),
    };
    const { findByText } = card({ diary: guessed });
    // The one line has no confirmed link, so every work type the card leans on is a keyword match.
    expect(await findByText(/Jenis pekerjaan di laporan harian: 100% masih perkiraan kata kunci\.$/)).toBeTruthy();
  });

  it('keeps going without the diary and says so', async () => {
    const { findByText } = card({ chain: { ...chain, diary: { lines: [], readable: false } } });
    expect(await findByText(/^Laporan harian belum bisa dibaca\. /)).toBeTruthy();
  });

  it('shows a failed read with a retry, and the no-plan case', async () => {
    const boom = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(chain);
    const { findByText, findAllByText, getByLabelText } = card({ loadChain: boom });
    expect(await findByText('Material vs progres gagal dimuat: boom')).toBeTruthy();
    fireEvent.press(getByLabelText('Muat ulang Material vs progres'));
    expect(await findAllByText('43,8 %')).toHaveLength(2);
    const empty = card({ material: { ...material, planned: [] } });
    expect(await empty.findByText('Belum ada rencana material untuk proyek ini.')).toBeTruthy();
    expect(empty.getByText('Diminta tanpa rencana di BoQ terbit: Struktur (kg).')).toBeTruthy();
    const projectLevel = card({ material: { ...material, planned: [...material.planned, { material_id: 'besi', boq_item_id: null, planned_quantity: 500 }, { material_id: 'semen', boq_item_id: null, planned_quantity: 300 }].filter((p) => !(p.material_id === 'semen' && p.boq_item_id)) } });
    expect(await projectLevel.findByText('Rencana 4.000 kg per area kerja · 500 kg tanpa area kerja (tidak digambar)')).toBeTruthy();
    expect(projectLevel.getByText('Rencana hanya di tingkat proyek: Material Beton (zak) 300 zak.')).toBeTruthy();
  });
});
