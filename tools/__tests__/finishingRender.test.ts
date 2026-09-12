/**
 * The Finishing-phase half of the renderer (spec §10.2). Its opposite number is
 * tools/__tests__/clientReportGolden.test.ts, which proves the STRUKTUR page did
 * not move; between them every branch of the phase switch is pinned.
 *
 * The "no numeric percentage" case is not decoration. The 2026-06-28 spec makes
 * the client report number-free on purpose, and room grouping is the first
 * change since then that touches section 01. A per-room completion figure is
 * exactly the kind of thing that would feel helpful and would be wrong.
 *
 * The curated-draft cases are the heart of this suite. `draft.updates` is the
 * ONE list the report builder edits and the ONE list section 01 prints; a room
 * phase only re-groups it. If grouping ever goes back to a parallel structure,
 * a curator's rewording, deletion or added line would stop reaching the client
 * PDF - exactly the silent failure spec §1-§3 and CLAUDE.md §12 forbid - and
 * these cases fail.
 */
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft, ClientReportUpdate } from '../clientReport';

const RK = 'Ruang Keluarga · Lt. 1';
const KM = 'Kamar Mandi Utama · Lt. 2';
const UMUM = 'Area Umum';

/** Lines arrive from assembly already ordered by room, each carrying its labels. */
const BASE_UPDATES: ClientReportUpdate[] = [
  { date: '10 Jun', area: 'Plafon', note: 'Rangka terpasang', roomId: 'r1', roomLabel: RK, gateLabel: 'C · Plafon' },
  { date: '12 Jun', area: 'Lantai', note: 'Keramik dipasang', roomId: 'r2', roomLabel: KM, gateLabel: 'B · Basah' },
  { date: '14 Jun', area: 'Dinding', note: 'Nat selesai', roomId: 'r2', roomLabel: KM, gateLabel: 'B · Basah' },
  { date: '13 Jun', area: 'Halaman', note: 'Bongkaran diangkut', roomId: 'ru', roomLabel: UMUM, gateLabel: null },
];

const BASE: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang',
  safetyIncidents: 0, nextPlan: 'Railing tangga.',
  updates: BASE_UPDATES,
  hero: { url: 'https://cdn/a.jpg', caption: 'Progres KM utama', date: '14 Jun', room: 'Kamar Mandi Utama' },
  thumbs: [],
  phase: 'FINISHING',
};

/** The draft the manual A4 print check renders (task 9 step 4). */
const PREVIEW: ClientReportDraft = {
  ...BASE, reportNo: 12, periodStart: '2026-09-05', periodEnd: '2026-09-11',
  crewTotal: 9, crewBreakdown: '4 tukang · 3 kenek · 1 mandor',
  nextPlan: 'Pemasangan sanitair lantai 2.',
  updates: [
    { date: '06 Sep', area: 'Plafon', note: 'Rangka hollow terpasang penuh.', roomId: 'r1', roomLabel: RK, gateLabel: 'C · Plafon' },
    { date: '09 Sep', area: 'Dinding', note: 'Plamir lapis pertama selesai.', roomId: 'r1', roomLabel: RK, gateLabel: 'C · Plafon' },
    { date: '07 Sep', area: 'Lantai', note: 'Waterproofing lapis kedua selesai.', roomId: 'r2', roomLabel: KM, gateLabel: 'B · Basah' },
    { date: '10 Sep', area: 'Dinding', note: 'Keramik dinding terpasang, nat menyusul.', roomId: 'r2', roomLabel: KM, gateLabel: 'B · Basah' },
    { date: '11 Sep', area: 'Kusen', note: 'Kusen pintu terpasang dan disetel.', roomId: 'r3', roomLabel: 'Kamar Tidur Anak · Lt. 2', gateLabel: 'D · Finishing' },
    { date: '08 Sep', area: 'Halaman', note: 'Sisa bongkaran diangkut keluar tapak.', roomId: 'ru', roomLabel: UMUM, gateLabel: null },
  ],
  hero: { url: 'https://placehold.co/1600x1000/png', caption: 'Kondisi KM utama', date: '10 Sep', room: 'Kamar Mandi Utama' },
  thumbs: [
    { url: 'https://placehold.co/1600x1000/png', caption: 'Rangka plafon ruang keluarga', date: '06 Sep', room: 'Ruang Keluarga' },
    { url: 'https://placehold.co/1600x1000/png', caption: 'Kusen kamar anak', date: '11 Sep', room: 'Kamar Tidur Anak' },
  ],
};

const html = renderClientReportHtml(BASE);

const roomNames = (h: string): string[] =>
  [...h.matchAll(/<span class="rname">([^<]+)<\/span>/g)].map((m) => m[1]);
const notesInOrder = (h: string): string[] =>
  [...h.matchAll(/<span class="note">([^<]*)<\/span>/g)].map((m) => m[1]);

it('kicker states the phase', () => {
  expect(html).toContain('Laporan Mingguan · Fase Finishing');
  expect(renderClientReportHtml({ ...BASE, kind: 'harian' })).toContain('Laporan Harian · Fase Finishing');
  expect(renderClientReportHtml({ ...BASE, phase: 'SERAH_TERIMA' })).toContain('Laporan Mingguan · Fase Serah Terima');
});

it('prints one head per room in the order given, Area Umum last', () => {
  expect(roomNames(html)).toEqual([RK, KM, UMUM]);
  const chips = [...html.matchAll(/<span class="rgate">([^<]+)<\/span>/g)].map((m) => m[1]);
  expect(chips).toEqual(['C · Plafon', 'B · Basah']);
});

// Pins the whole head element, not just the contents of two spans: a fourth
// span added later (a photo count, a due-date badge, a debug chip) matches
// neither span regex above and would otherwise slip through green.
it('the room head carries the label and the chip and nothing else', () => {
  const heads = [...html.matchAll(/<div class="rhead">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  expect(heads).toHaveLength(3);
  expect(heads[1]).toBe(`<span class="rname">${KM}</span><span class="rgate">B · Basah</span>`);
  expect(heads[2]).toBe(`<span class="rname">${UMUM}</span>`); // no chip when gateLabel is null
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
  // The sheet only — GALLERY_SCRIPT sits after it and is full of numbers, so
  // including it would both dilute the claim and false-fail on a layout tweak.
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>'));
  expect(body).not.toMatch(/\d+\s*%/);
});

// ── The curated draft reaches the client PDF (spec §1-§3) ────────────────────

it('prints a curator reword, honours a delete, and files an added line under its room', () => {
  const edited: ClientReportDraft = {
    ...BASE,
    updates: [
      ...BASE_UPDATES
        .filter((u) => u.note !== 'Nat selesai')                                  // deleted with the red ✕
        .map((u) => (u.area === 'Lantai' ? { ...u, note: 'Keramik utama dipasang rapi' } : u)), // reworded
      // "Tambah update" with Kamar Mandi Utama picked: the new line carries the
      // room id + label the picker supplied and no gate of its own.
      { date: '15 Jun', area: 'Kusen', note: 'Kusen kamar mandi dipasang', roomId: 'r2', roomLabel: KM, gateLabel: null },
    ],
  };
  const out = renderClientReportHtml(edited);

  expect(out).toContain('Keramik utama dipasang rapi');
  expect(out).not.toContain('Keramik dipasang</span>');
  expect(out).not.toContain('Nat selesai');
  // The added line joins the existing room block instead of opening a second head.
  expect(roomNames(out)).toEqual([RK, KM, UMUM]);
  expect(notesInOrder(out)).toEqual([
    'Rangka terpasang', 'Keramik utama dipasang rapi', 'Kusen kamar mandi dipasang', 'Bongkaran diangkut',
  ]);
});

it('files an untagged added line under Area Umum rather than dropping it', () => {
  const out = renderClientReportHtml({
    ...BASE,
    updates: [...BASE_UPDATES, { date: '15 Jun', area: 'Taman', note: 'Pagar sementara dibongkar' }],
  });
  expect(roomNames(out)).toEqual([RK, KM, UMUM]);
  // Area Umum stays last and the untagged line lands in it, after its own line.
  expect(notesInOrder(out).slice(-2)).toEqual(['Bongkaran diangkut', 'Pagar sementara dibongkar']);
});

it('drops the head of a room whose every line the curator deleted', () => {
  const out = renderClientReportHtml({
    ...BASE,
    updates: BASE_UPDATES.filter((u) => u.roomLabel !== KM),
  });
  expect(roomNames(out)).toEqual([RK, UMUM]);
  expect(out).not.toContain('Keramik dipasang');
});

it('falls back to the flat list when a room phase carries no room labels', () => {
  // A draft assembled — or a snapshot frozen — before room tagging shipped.
  const flat = renderClientReportHtml({
    ...BASE,
    updates: BASE_UPDATES.map(({ date, area, note }) => ({ date, area, note })),
  });
  expect(flat).not.toContain('<span class="rname">');
  expect(flat).toContain('Keramik dipasang');
  expect(flat).toContain('Laporan Mingguan · Fase Finishing');
});

it('freezes the labels: a renamed room cannot change an issued snapshot', () => {
  // Nothing in the render path looks a room up, so re-rendering the stored
  // snapshot after the office renames r2 still prints the name it was sent with.
  expect(renderClientReportHtml(JSON.parse(JSON.stringify(BASE)))).toBe(html);
  expect(roomNames(html)).toContain(KM);
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
