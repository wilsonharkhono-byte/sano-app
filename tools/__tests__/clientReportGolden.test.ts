/**
 * Spec §18 item 7: Struktur-phase projects stay unaffected, and the guard is
 * written BEFORE the renderer is touched, not after.
 *
 * Two locks, deliberately different in kind:
 *
 *  1. GOLDEN FILES. Two STRUKTUR drafts (a daily one with no photos, a weekly
 *     one with photos and captions) are rendered and compared BYTE FOR BYTE
 *     against HTML captured from the renderer as it stood before the
 *     Finishing-phase work began. Any change to markup, ordering, whitespace or
 *     CSS fails here. Regenerate with UPDATE_CLIENT_REPORT_GOLDEN=1 only when a
 *     STRUKTUR change is genuinely intended; the diff is then reviewable.
 *  2. BLUEPRINT_CSS HASH. The golden can be regenerated, so the verbatim-port
 *     contract (2026-06-28 spec §1.2) gets a second lock a regeneration cannot
 *     quietly satisfy: the SHA-256 of the FIRST <style> block, which is
 *     BLUEPRINT_CSS exactly as it ships. The literal below is the value of that
 *     block before this plan; changing it means editing the blueprint port, and
 *     that needs the design owner, not a test update.
 *
 * The two drafts between them exercise every branch the renderer takes on a
 * STRUKTUR page: weekly vs daily row numbering, the revision tag, escaping
 * (the "<selesai>" in one note), a photo with an empty caption (dropped from
 * the legend but kept in the gallery), and the no-photo path.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft } from '../clientReport';

const GOLDEN_DIR = path.join(__dirname, 'golden');
const UPDATE = process.env.UPDATE_CLIENT_REPORT_GOLDEN === '1';

const WEEKLY: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, revision: 2, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang · 2 kenek · 1 mandor',
  safetyIncidents: 0, nextPlan: 'Penyelesaian railing tangga & pemasangan kusen lantai 2.',
  updates: [
    { date: '10 Jun', area: 'Tangga', note: 'Finishing anak tangga berjalan; railing menyusul.' },
    { date: '12 Jun', area: 'Kamar Mandi Utama', note: 'Waterproofing lapis kedua <selesai>.' },
    { date: '14 Jun', area: 'Ruang Keluarga', note: 'Rangka plafon terpasang.' },
  ],
  hero: { url: 'https://cdn.example/hero.jpg', caption: 'Kondisi lapangan pagi hari', date: '14 Jun' },
  thumbs: [
    { url: 'https://cdn.example/b.jpg', caption: 'Mock-up keramik KM utama', date: '12 Jun' },
    { url: 'https://cdn.example/c.jpg', caption: '', date: '10 Jun' },
  ],
};

const DAILY: ClientReportDraft = {
  ...WEEKLY, kind: 'harian', reportNo: 8, revision: 1,
  periodStart: '2026-06-14', periodEnd: '2026-06-14', hero: null, thumbs: [],
};

function checkGolden(name: string, html: string): void {
  const file = path.join(GOLDEN_DIR, name);
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, html, 'utf8');
  }
  expect(fs.readFileSync(file, 'utf8')).toBe(html);
}

describe('STRUKTUR client report is byte-identical to the captured golden', () => {
  it('renders the weekly report exactly as before', () => {
    checkGolden('clientReport.struktur.mingguan.html', renderClientReportHtml(WEEKLY));
  });

  it('renders the daily report exactly as before', () => {
    checkGolden('clientReport.struktur.harian.html', renderClientReportHtml(DAILY));
  });
});

describe('BLUEPRINT_CSS is the verbatim port and stays byte-identical', () => {
  const html = renderClientReportHtml(WEEKLY);
  const first = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));

  it('hashes to the value pinned before the Finishing-phase work', () => {
    expect(first).toHaveLength(10182);
    expect(crypto.createHash('sha256').update(first, 'utf8').digest('hex'))
      .toBe('03c76aa8bd3f22b6d86ca7af607e779744f86729e15e30969b62e14325417e33');
  });

  it('emits exactly two stylesheets on a STRUKTUR report', () => {
    expect(html.match(/<style>/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('.rgroup');
  });
});
