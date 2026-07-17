// Integration test for the photo gallery: it renders the real report HTML,
// extracts the *actual* embedded gallery script, and runs it against a minimal
// fake DOM (no jsdom needed) with stubbed image aspect ratios. This exercises
// the shipped code path end-to-end — feature detection + justified row building
// — the way it runs in the print window.
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft, ClientReportPhoto } from '../clientReport';

const baseDraft: ClientReportDraft = {
  kind: 'harian', reportNo: 1, periodStart: '2026-07-16', periodEnd: '2026-07-16',
  projectName: 'Bukit Darmo Golf D-18', clientName: 'Selvia Chandra', subtitle: '',
  statusLabel: 'Sesuai Jadwal', weather: 'Hujan', crewTotal: 6, crewBreakdown: '1 mandor · 3 tukang',
  safetyIncidents: 0, nextPlan: 'Acian tembok.',
  updates: [{ date: '16 Jul', area: 'Tangga', note: 'Cor dan pembesian' }],
  hero: null, thumbs: [],
};

function photo(n: number): ClientReportPhoto {
  return { url: `https://cdn/${n}.jpg`, caption: `Foto ${n}`, date: '16 Jul' };
}

// ---- minimal fake DOM --------------------------------------------------------
function fakeEl(tag: string): any {
  const el: any = {
    tagName: tag.toUpperCase(),
    className: '',
    style: {},
    children: [] as any[],
    parentNode: null as any,
    _imgs: [] as any[],
    getElementsByTagName(t: string) { return t.toLowerCase() === 'img' ? el._imgs : []; },
    appendChild(node: any) {
      if (node.parentNode) {
        const arr = node.parentNode.children;
        const i = arr.indexOf(node);
        if (i >= 0) arr.splice(i, 1);
      }
      node.parentNode = el;
      el.children.push(node);
      return node;
    },
  };
  return el;
}

function buildGallery(aspects: number[]): any {
  const gallery = fakeEl('div');
  gallery.className = 'gallery';
  for (const a of aspects) {
    const fig = fakeEl('figure');
    fig.className = 'gitem';
    const img = fakeEl('img');
    img.naturalWidth = Math.round(a * 1000);
    img.naturalHeight = 1000;
    fig._imgs = [img];
    gallery.appendChild(fig);
  }
  return gallery;
}

function extractGalleryScript(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('gallery script not found in rendered report');
  return m[1];
}

function runGallery(aspects: number[]): { gallery: any; ready: boolean } {
  // The photo count in the fake DOM mirrors what the report renders for the
  // same number of photos (asserted below), and the script is the real one.
  const draft: ClientReportDraft = { ...baseDraft, hero: aspects.length ? photo(0) : null, thumbs: aspects.slice(1).map((_, i) => photo(i + 1)) };
  const html = renderClientReportHtml(draft);
  const gitemCount = (html.match(/class="gitem"/g) ?? []).length;
  expect(gitemCount).toBe(aspects.length); // rendered markup matches our fake DOM
  const scriptBody = extractGalleryScript(html);
  const gallery = buildGallery(aspects);
  const win: any = { __galleryReady: false, addEventListener() {} };
  const doc: any = {
    readyState: 'complete',
    getElementById: (id: string) => (id === 'gallery' ? gallery : null),
    createElement: (t: string) => fakeEl(t),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('window', 'document', 'setTimeout', scriptBody);
  fn(win, doc, () => 0);
  return { gallery, ready: win.__galleryReady };
}

const isRow = (el: any) => el.className === 'grow-row';
const isFeature = (el: any) => typeof el.className === 'string' && el.className.indexOf('feature') >= 0;

describe('embedded gallery script (real HTML → fake DOM)', () => {
  it('gives a landscape first photo a full-width feature row, justifies the rest', () => {
    const { gallery, ready } = runGallery([1.6, 1.0, 1.0, 1.0]);
    expect(ready).toBe(true);
    // first child is the feature (kept full-width, not inside a row)
    expect(isFeature(gallery.children[0])).toBe(true);
    // the remaining photos live inside grow-row(s), none of them the feature
    const rows = gallery.children.filter(isRow);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const flowed = rows.flatMap((r: any) => r.children);
    expect(flowed).toHaveLength(3);
    for (const fig of flowed) {
      expect(isFeature(fig)).toBe(false);
      expect(fig.style.flexGrow).toBe('1'); // flex-grow ∝ aspect (square = 1)
    }
    // row height comes from an inline aspect-ratio (== sum of the row's aspects)
    for (const r of rows) expect(Number(r.style.aspectRatio)).toBeGreaterThan(0);
  });

  it('does NOT feature a portrait first photo — it joins the justified rows', () => {
    const { gallery, ready } = runGallery([0.8, 1.0, 1.0]);
    expect(ready).toBe(true);
    expect(gallery.children.every((c: any) => !isFeature(c))).toBe(true);
    const rows = gallery.children.filter(isRow);
    const flowed = rows.flatMap((r: any) => r.children);
    expect(flowed).toHaveLength(3); // all three photos flowed, none cropped into a banner
  });

  it('handles a report with no photos without error', () => {
    const { gallery, ready } = runGallery([]);
    expect(ready).toBe(true);
    expect(gallery.children).toHaveLength(0);
  });

  it('sets flex-grow proportional to each photo’s true aspect (no crop)', () => {
    // portrait-first (no feature) so all three flow; widths ∝ aspect at a shared
    // row height means each figure box matches its photo shape.
    const { gallery } = runGallery([0.75, 1.5, 1.0]);
    const flowed = gallery.children.filter(isRow).flatMap((r: any) => r.children);
    const grows = flowed.map((f: any) => Number(f.style.flexGrow));
    expect(grows).toEqual([0.75, 1.5, 1.0]);
  });
});
