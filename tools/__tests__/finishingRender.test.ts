/**
 * The Finishing-phase half of the renderer (spec §10.2). Its opposite number is
 * tools/__tests__/clientReportGolden.test.ts, which proves the STRUKTUR page did
 * not move; between them every branch of the phase switch is pinned.
 *
 * The "no numeric percentage" case is not decoration. The 2026-06-28 spec makes
 * the client report number-free on purpose, and room grouping is the first
 * change since then that touches section 01. A per-room completion figure is
 * exactly the kind of thing that would feel helpful and would be wrong.
 */
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft } from '../clientReport';

const BASE: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang',
  safetyIncidents: 0, nextPlan: 'Railing tangga.',
  updates: [{ date: '14 Jun', area: 'Lantai', note: 'Keramik dipasang' }],
  hero: { url: 'https://cdn/a.jpg', caption: 'Progres KM utama', date: '14 Jun', room: 'Kamar Mandi Utama' },
  thumbs: [],
  phase: 'FINISHING',
  roomGroups: [
    { roomLabel: 'Ruang Keluarga · Lt. 1', gateLabel: 'C · Plafon', updates: [{ date: '10 Jun', area: 'Plafon', note: 'Rangka terpasang' }] },
    { roomLabel: 'Kamar Mandi Utama · Lt. 2', gateLabel: 'B · Basah', updates: [{ date: '12 Jun', area: 'Lantai', note: 'Keramik dipasang' }, { date: '14 Jun', area: 'Dinding', note: 'Nat selesai' }] },
    { roomLabel: 'Area Umum', gateLabel: null, updates: [{ date: '13 Jun', area: 'Halaman', note: 'Bongkaran diangkut' }] },
  ],
};

/** The draft the manual A4 print check renders (task 9 step 4). */
const PREVIEW: ClientReportDraft = {
  ...BASE, reportNo: 12, periodStart: '2026-09-05', periodEnd: '2026-09-11',
  crewTotal: 9, crewBreakdown: '4 tukang · 3 kenek · 1 mandor',
  nextPlan: 'Pemasangan sanitair lantai 2.',
  roomGroups: [
    { roomLabel: 'Ruang Keluarga · Lt. 1', gateLabel: 'C · Plafon', updates: [
      { date: '06 Sep', area: 'Plafon', note: 'Rangka hollow terpasang penuh.' },
      { date: '09 Sep', area: 'Dinding', note: 'Plamir lapis pertama selesai.' }] },
    { roomLabel: 'Kamar Mandi Utama · Lt. 2', gateLabel: 'B · Basah', updates: [
      { date: '07 Sep', area: 'Lantai', note: 'Waterproofing lapis kedua selesai.' },
      { date: '10 Sep', area: 'Dinding', note: 'Keramik dinding terpasang, nat menyusul.' }] },
    { roomLabel: 'Kamar Tidur Anak · Lt. 2', gateLabel: 'D · Finishing', updates: [
      { date: '11 Sep', area: 'Kusen', note: 'Kusen pintu terpasang dan disetel.' }] },
    { roomLabel: 'Area Umum', gateLabel: null, updates: [
      { date: '08 Sep', area: 'Halaman', note: 'Sisa bongkaran diangkut keluar tapak.' }] },
  ],
  hero: { url: 'https://placehold.co/1600x1000/png', caption: 'Kondisi KM utama', date: '10 Sep', room: 'Kamar Mandi Utama' },
  thumbs: [
    { url: 'https://placehold.co/1600x1000/png', caption: 'Rangka plafon ruang keluarga', date: '06 Sep', room: 'Ruang Keluarga' },
    { url: 'https://placehold.co/1600x1000/png', caption: 'Kusen kamar anak', date: '11 Sep', room: 'Kamar Tidur Anak' },
  ],
};

const html = renderClientReportHtml(BASE);

it('kicker states the phase', () => {
  expect(html).toContain('Laporan Mingguan · Fase Finishing');
  expect(renderClientReportHtml({ ...BASE, kind: 'harian' })).toContain('Laporan Harian · Fase Finishing');
  expect(renderClientReportHtml({ ...BASE, phase: 'SERAH_TERIMA' })).toContain('Laporan Mingguan · Fase Serah Terima');
});

it('prints one head per room in the order given, Area Umum last', () => {
  const heads = [...html.matchAll(/<span class="rname">([^<]+)<\/span>/g)].map((m) => m[1]);
  expect(heads).toEqual(['Ruang Keluarga · Lt. 1', 'Kamar Mandi Utama · Lt. 2', 'Area Umum']);
  const chips = [...html.matchAll(/<span class="rgate">([^<]+)<\/span>/g)].map((m) => m[1]);
  expect(chips).toEqual(['C · Plafon', 'B · Basah']);
});

it('emits the additive room stylesheet and nothing inside BLUEPRINT_CSS', () => {
  expect(html.match(/<style>/g)).toHaveLength(3);
  expect(html).toContain('.rgroup{ margin-top:10px; }');
});

it('numbers daily rows continuously across groups', () => {
  const daily = renderClientReportHtml({ ...BASE, kind: 'harian' });
  const dates = [...daily.matchAll(/<span class="date">([^<]*)<\/span>/g)].map((m) => m[1]);
  expect(dates).toEqual(['01', '02', '03', '04']);
});

it('labels the figure legend with the room', () => {
  expect(html).toContain('Figur 1 · Kamar Mandi Utama');
  expect(html).toContain('class="figlegend byroom"');
});

it('renders no numeric percentage in the report body', () => {
  const body = html.slice(html.lastIndexOf('</style>'));
  expect(body).not.toMatch(/\d+\s*%/);
});

it('falls back to the flat list when a room phase has no groups', () => {
  const flat = renderClientReportHtml({ ...BASE, roomGroups: [] });
  expect(flat).not.toContain('<span class="rname">');
  expect(flat).toContain('Keramik dipasang');
  expect(flat).toContain('Laporan Mingguan · Fase Finishing');
});

// Opt-in escape hatch for the manual A4 print check (task 9 step 4). The
// renderer imports react-native, so it cannot be driven from a plain node
// script; this suite already carries the jest transform that makes it
// importable. No env var, no file written, and the case is a no-op.
it('writes a print preview when asked', () => {
  const out = process.env.WRITE_FINISHING_PREVIEW;
  if (!out) return;
  const fs = require('node:fs') as typeof import('node:fs');
  fs.writeFileSync(out, renderClientReportHtml(PREVIEW), 'utf8');
  expect(fs.readFileSync(out, 'utf8').length).toBeGreaterThan(1000);
});
