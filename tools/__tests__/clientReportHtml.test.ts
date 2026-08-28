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

  it('uses perfectly white paper for clean printing', () => {
    expect(html).toContain('--paper:#FFFFFF');
    expect(html).not.toContain('#FDFCF9');   // the old cream tint is gone
  });

  it('locks the printed page geometry to A4 on every page', () => {
    expect(html).toContain('print-color-adjust:exact');
    expect(html).toContain('size:A4');
    expect(html).toContain('@page');
    expect(html).toContain('min-height:270mm');     // deterministic A4 page height…
    expect(html).not.toContain('min-height:100vh');  // …not the browser-dependent 100vh
    expect(html).toContain('position:fixed');        // registration marks reframe each page
  });

  it('never prints a page number it cannot compute (no counter(page) → "Hal. 0")', () => {
    // Chrome renders CSS page counters as 0 in print; showing a wrong page
    // number violates the "never fake a number" rule, so there is none.
    expect(html).not.toContain('counter(page)');
    expect(html).not.toContain('Hal. 1 / 1');
  });

  it('arranges photos in an auto-justified gallery, not a fixed crop band', () => {
    expect(html).toContain('class="gallery" id="gallery"');
    expect(html).toContain('class="gitem"');
    expect(html).toContain('function layoutJustified'); // the embedded layout algorithm
    expect(html).not.toContain('class="heroimg"');      // old fixed 50mm cover band gone
    expect(html).not.toContain('class="thumbimg"');     // old fixed 26mm cover grid gone
  });

  it('keeps the report body free of any literal percentage (incl. the gallery script)', () => {
    const body = html.slice(html.lastIndexOf('</style>'));
    expect(body).not.toMatch(/\d+\s*%/);
  });

  describe('photo captions (Figur overlay + legend below the gallery)', () => {
    const longCaption = 'Pembongkaran bekisting balok lantai 2 zona B beserta pembersihan area kerja';
    const capDraft: ClientReportDraft = {
      ...draft,
      hero: { url: 'https://cdn/a.jpg', caption: longCaption, date: '14 Jun' },
      thumbs: [
        { url: 'https://cdn/b.jpg', caption: 'Mock-up <plafon> & "list"', date: '12 Jun' },
        { url: 'https://cdn/c.jpg', caption: '   ', date: '11 Jun' },
      ],
    };
    const capHtml = renderClientReportHtml(capDraft);

    it('numbers the hero Figur 1 and the thumbs onward, in gallery order', () => {
      const overlays = [...capHtml.matchAll(/<figcaption class="gcap"><span class="d">([^<]*)<\/span><span class="t">([^<]*)<\/span>/g)];
      expect(overlays.map((m) => m[1])).toEqual(['Figur 1', 'Figur 2', 'Figur 3']);
      expect(overlays.map((m) => m[2])).toEqual(['14 Jun', '12 Jun', '11 Jun']); // date moved into .t
    });

    it('shows a long caption IN FULL in the legend, never in the overlay', () => {
      expect(capHtml).toContain(`<span class="fl-t">${longCaption}</span>`);
      // the overlay bar carries no caption text at all, so nothing can be clipped
      const overlayBlob = [...capHtml.matchAll(/<figcaption class="gcap">.*?<\/figcaption>/g)].join('');
      expect(overlayBlob).not.toContain('Pembongkaran');
      expect(capHtml).not.toContain('…');
    });

    it('gives a blank-caption photo its Figur overlay but no legend row', () => {
      expect(capHtml).toContain('<span class="d">Figur 3</span>');       // overlay present
      expect(capHtml).not.toContain('<span class="fl-no">Figur 3</span>'); // legend row absent
      expect((capHtml.match(/class="flrow"/g) ?? [])).toHaveLength(2);
    });

    it('renders the legend as a SIBLING of #gallery, never inside it', () => {
      // the legend must sit after the gallery's closing </div> so the embedded
      // justified-layout script (which re-appends #gallery children) ignores it.
      const galleryStart = capHtml.indexOf('<div class="gallery" id="gallery">');
      const legendStart = capHtml.indexOf('<div class="figlegend">');
      expect(galleryStart).toBeGreaterThan(-1);
      expect(legendStart).toBeGreaterThan(galleryStart);
      const between = capHtml.slice(galleryStart, legendStart);
      expect(between.trimEnd().endsWith('</div>')).toBe(true);  // gallery closed first
      expect(capHtml.slice(legendStart)).not.toContain('class="gitem"'); // no figures after
    });

    it('HTML-escapes caption text in the legend', () => {
      expect(capHtml).toContain('Mock-up &lt;plafon&gt; &amp; &quot;list&quot;');
      expect(capHtml).not.toContain('<plafon>');
    });

    it('omits the legend entirely when no photo has a caption', () => {
      const noCaps = renderClientReportHtml({
        ...draft,
        hero: { url: 'https://cdn/a.jpg', caption: '', date: '14 Jun' },
        thumbs: [{ url: 'https://cdn/b.jpg', caption: '  ', date: '12 Jun' }],
      });
      expect(noCaps).toContain('class="gitem"');       // photos still render…
      expect(noCaps).not.toContain('class="figlegend"'); // …with no legend block
      expect(noCaps).not.toContain('class="flrow"');
    });

    it('omits the legend when the report has no photos at all', () => {
      const noPhotos = renderClientReportHtml({ ...draft, hero: null, thumbs: [] });
      expect(noPhotos).not.toContain('class="figlegend"');
      expect(noPhotos).not.toContain('id="gallery"');
    });

    it('lets legend caption text wrap (no nowrap/ellipsis on .fl-t) and keeps rows unsplit in print', () => {
      const flt = capHtml.match(/\.fl-t\{[^}]*\}/)?.[0] ?? '';
      expect(flt).toContain('font-size:9.5px');
      expect(flt).not.toContain('nowrap');
      expect(flt).not.toContain('ellipsis');
      expect(flt).not.toContain('overflow');
      expect(capHtml).toContain('@media print{ .flrow{ break-inside:avoid; } }');
    });
  });

  describe('photo dates by kind (daily drops them, weekly keeps them)', () => {
    // Photo dates deliberately differ from every other date in the draft
    // ('14 Jun' also appears in `updates`), so any leak into the gallery is
    // unambiguously a PHOTO date and not the update row's own column.
    const photoDraft = (kind: ClientReportDraft['kind']): ClientReportDraft => ({
      ...draft,
      kind,
      hero: { url: 'https://cdn/a.jpg', caption: 'Pengecoran plat lantai 2', date: '03 Mei' },
      thumbs: [
        { url: 'https://cdn/b.jpg', caption: 'Pembesian kolom K1', date: '02 Mei' },
        { url: 'https://cdn/c.jpg', caption: '   ', date: '01 Mei' },   // blank caption
      ],
    });
    const dailyHtml = renderClientReportHtml(photoDraft('harian'));
    const weeklyHtml = renderClientReportHtml(photoDraft('mingguan'));
    const photoDates = ['03 Mei', '02 Mei', '01 Mei'];

    // inner HTML of each overlay / legend row, in document order
    const overlays = (html: string) =>
      [...html.matchAll(/<figcaption class="gcap">(.*?)<\/figcaption>/g)].map((m) => m[1]);
    const legendRows = (html: string) =>
      [...html.matchAll(/<div class="flrow">(.*?)<\/div>/g)].map((m) => m[1]);

    it('daily: overlays carry Figur N only — no .t date span', () => {
      expect(overlays(dailyHtml)).toEqual([
        '<span class="d">Figur 1</span>',
        '<span class="d">Figur 2</span>',
        '<span class="d">Figur 3</span>',
      ]);
      expect(overlays(dailyHtml).join('')).not.toContain('class="t"');
    });

    it('daily: no photo date reaches the overlays or the legend', () => {
      const galleryText = overlays(dailyHtml).join('') + legendRows(dailyHtml).join('');
      for (const d of photoDates) expect(galleryText).not.toContain(d);
      // and nowhere else in the document either — the metadata strip states the
      // single report date ('8 Juni 2026'), so a photo date has no other home.
      for (const d of photoDates) expect(dailyHtml).not.toContain(d);
    });

    it('daily: legend is .figlegend nodate and its rows drop the fl-d column', () => {
      expect(dailyHtml).toContain('<div class="figlegend nodate">');
      expect(dailyHtml).not.toContain('<div class="figlegend">');
      expect(legendRows(dailyHtml)).toEqual([
        '<span class="fl-no">Figur 1</span><span class="fl-t">Pengecoran plat lantai 2</span>',
        '<span class="fl-no">Figur 2</span><span class="fl-t">Pembesian kolom K1</span>',
      ]);
      expect(legendRows(dailyHtml).join('')).not.toContain('fl-d');  // Figur 3 stays row-less
    });

    it('weekly: overlays keep the .t date span, in gallery order', () => {
      expect(overlays(weeklyHtml)).toEqual([
        '<span class="d">Figur 1</span><span class="t">03 Mei</span>',
        '<span class="d">Figur 2</span><span class="t">02 Mei</span>',
        '<span class="d">Figur 3</span><span class="t">01 Mei</span>',
      ]);
    });

    it('weekly: legend rows keep the fl-d date span, in gallery order', () => {
      expect(legendRows(weeklyHtml)).toEqual([
        '<span class="fl-no">Figur 1</span><span class="fl-d">03 Mei</span><span class="fl-t">Pengecoran plat lantai 2</span>',
        '<span class="fl-no">Figur 2</span><span class="fl-d">02 Mei</span><span class="fl-t">Pembesian kolom K1</span>',
      ]);
    });

    it('weekly: legend container is plain .figlegend, never .nodate', () => {
      expect(weeklyHtml).toContain('<div class="figlegend">');
      expect(weeklyHtml).not.toContain('class="figlegend nodate"');
    });

    describe('"01 Update Lapangan" leading column', () => {
      // Update dates sit in February; the report period is June and the photos
      // are in May, so any '21 Feb' in the output can only be an update date.
      const withUpdates = (kind: ClientReportDraft['kind']): ClientReportDraft => ({
        ...photoDraft(kind),
        updates: [
          { date: '21 Feb', area: 'Tangga', note: 'Finishing anak tangga' },
          { date: '20 Feb', area: 'Lantai 2', note: 'Pemasangan keramik' },
          { date: '19 Feb', area: 'Fasad', note: 'Plester aci' },
        ],
      });
      const dailyUpd = renderClientReportHtml(withUpdates('harian'));
      const weeklyUpd = renderClientReportHtml(withUpdates('mingguan'));
      const updateDates = ['21 Feb', '20 Feb', '19 Feb'];

      const leadCells = (html: string) =>
        [...html.matchAll(/<div class="row"><span class="date">([^<]*)<\/span>/g)].map((m) => m[1]);

      it('daily: leads with a zero-padded row number, not the date', () => {
        expect(leadCells(dailyUpd)).toEqual(['01', '02', '03']);
        for (const d of updateDates) expect(dailyUpd).not.toContain(d);
        // area + note are untouched — only the leading column changed
        expect(dailyUpd).toContain('<span class="area">Tangga</span><span class="note">Finishing anak tangga</span>');
      });

      it('daily: pads single digits only — the 10th row is "10", not "010"', () => {
        const ten = renderClientReportHtml({
          ...withUpdates('harian'),
          updates: Array.from({ length: 10 }, (_, i) => ({ date: '21 Feb', area: `A${i}`, note: `N${i}` })),
        });
        expect(leadCells(ten)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
      });

      it('weekly: keeps the real dates in source order', () => {
        expect(leadCells(weeklyUpd)).toEqual(updateDates);
      });

      it('daily: photos still read "Figur N" — only the update rows renumber', () => {
        expect(overlays(dailyUpd)).toEqual([
          '<span class="d">Figur 1</span>',
          '<span class="d">Figur 2</span>',
          '<span class="d">Figur 3</span>',
        ]);
        expect(dailyUpd).toContain('<span class="fl-no">Figur 1</span>');
        expect(dailyUpd).not.toContain('<span class="fl-no">01</span>');
      });
    });

    it('ships the CSS rule that collapses the nodate row to two columns', () => {
      expect(dailyHtml).toContain('.figlegend.nodate .flrow{ grid-template-columns:52px 1fr; }');
      expect(weeklyHtml).toContain('.figlegend.nodate .flrow{ grid-template-columns:52px 1fr; }');
      expect(dailyHtml).toContain('.flrow{ display:grid; grid-template-columns:52px 52px 1fr;');
    });
  });
});
