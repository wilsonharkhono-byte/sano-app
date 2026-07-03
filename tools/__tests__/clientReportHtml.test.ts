import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft } from '../clientReport';

const draft: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang · 2 kenek',
  safetyIncidents: 0, nextPlan: 'Penyelesaian railing tangga.',
  updates: [{ date: '14 Jun', area: 'Tangga', note: 'Finishing anak tangga <berjalan>' }],
  hero: { url: 'https://cdn/a.jpg', caption: 'Kondisi lapangan', date: '14 Jun' },
  thumbs: [{ url: 'https://cdn/b.jpg', caption: 'Mock-up', date: '12 Jun' }],
};

describe('renderClientReportHtml', () => {
  const html = renderClientReportHtml(draft);

  it('is exactly A4 and single-sheet', () => {
    expect(html).toContain('size:A4');
    expect(html).toContain('210mm');
    expect(html).toContain('297mm');
  });

  it('strips the screen-only toolbar', () => {
    expect(html).not.toContain('class="toolbar"');
    expect(html).not.toContain('window.print()'); // the toolbar button is gone
  });

  it('injects the report data', () => {
    expect(html).toContain('Graha Family T-61');
    expect(html).toContain('Bpk. Jason Jordy');
    expect(html).toContain('Finishing Interior');
    expect(html).toContain('Sesuai Jadwal');
    expect(html).toContain('Penyelesaian railing tangga.');
    expect(html).toContain('Laporan #07');
    expect(html).toContain('Tangga');
    expect(html).toContain('https://cdn/a.jpg');
  });

  it('sets the kicker by kind', () => {
    expect(html).toContain('Laporan Mingguan');
    expect(renderClientReportHtml({ ...draft, kind: 'harian' })).toContain('Laporan Harian');
  });

  it('HTML-escapes user text to prevent broken markup', () => {
    expect(html).toContain('Finishing anak tangga &lt;berjalan&gt;');
    expect(html).not.toContain('<berjalan>');
  });

  it('renders NO numeric percentage in the report body', () => {
    // The CSS (both <style> blocks) legitimately contains % (widths, saturate,
    // etc.), so scope the check to the body after the LAST </style> — the report
    // itself must show no progress percentage.
    const body = html.slice(html.lastIndexOf('</style>'));
    expect(body).not.toMatch(/\d+\s*%/);
  });

  it('renders a cross-month weekly period unambiguously (both months shown)', () => {
    const html = renderClientReportHtml({ ...draft, kind: 'mingguan', periodStart: '2026-06-26', periodEnd: '2026-07-02' });
    expect(html).toContain('26 Juni – 2 Juli 2026');   // long form in the strip
    expect(html).toContain('26 Jun–2 Jul 2026');        // short form in the masthead
  });

  it('renders the real SANO logotype SVG, not the placeholder text wordmark', () => {
    expect(html).toContain('viewBox="0 0 315.66 87.26"');
    expect(html).not.toContain('<span class="logo">SANO</span>');
  });

  it('credits SANcontractor in the footer, not WHAstudio', () => {
    expect(html).toContain('SANcontractor © 2026 · Konfidensial');
    expect(html).not.toContain('WHAstudio');
  });

  it('tags revisions in the report number (R2+), plain on first issue', () => {
    expect(html).not.toContain('· R');
    const rev2 = renderClientReportHtml({ ...draft, revision: 2 });
    expect(rev2).toContain('Laporan #07 · R2');
  });

  it('renders photos as <img> (print-safe), not CSS background-image', () => {
    expect(html).toMatch(/<img[^>]+src="https:\/\/cdn\/a\.jpg"/);   // hero
    expect(html).toMatch(/<img[^>]+src="https:\/\/cdn\/b\.jpg"/);   // thumb
    expect(html).not.toContain("background-image:url('https://cdn"); // no bg-image for photos
  });

  it('forces backgrounds to print and pins the footer to the A4 page bottom', () => {
    expect(html).toContain('print-color-adjust:exact');
    expect(html).toContain('min-height:100vh');   // sheet fills the page in print
  });
});
