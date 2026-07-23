import { LAYOUT_JUSTIFIED_JS } from '../justifiedGallery';

// The layout algorithm ships to the print window as a self-contained JS source
// string (LAYOUT_JUSTIFIED_JS) so there is ONE source of truth: the exact code
// the browser runs is the exact code we test here. We materialise it with
// `new Function` (only in the test — the app never eval()s it).
type JItem = { index: number; width: number };
type JRow = { height: number; items: JItem[] };
type LayoutFn = (
  aspects: number[],
  opts: { containerWidth: number; targetRowHeight: number; gap?: number; maxRowHeight?: number; maxItemsPerRow?: number },
) => JRow[];
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const layoutJustified = new Function('return (' + LAYOUT_JUSTIFIED_JS + ')')() as LayoutFn;

const sumRowWidth = (row: JRow, gap: number) =>
  row.items.reduce((s, it) => s + it.width, 0) + gap * Math.max(0, row.items.length - 1);

describe('layoutJustified', () => {
  it('returns nothing for no photos', () => {
    expect(layoutJustified([], { containerWidth: 1000, targetRowHeight: 200 })).toEqual([]);
  });

  it('justifies a full row to exactly fill the container width', () => {
    // two 2:1 landscapes + one square: adding the square drops the row height
    // to the 200 target, so the row commits and fills the 1000px width.
    const rows = layoutJustified([2, 2, 1], { containerWidth: 1000, targetRowHeight: 200, gap: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBeCloseTo(200, 5);
    const widths = rows[0].items.map((i) => i.width);
    expect(widths[0]).toBeCloseTo(400, 5);
    expect(widths[1]).toBeCloseTo(400, 5);
    expect(widths[2]).toBeCloseTo(200, 5);
    expect(sumRowWidth(rows[0], 0)).toBeCloseTo(1000, 5);
  });

  it('preserves each photo’s aspect ratio (width/height == aspect) — no cropping', () => {
    const aspects = [2, 2, 1];
    const rows = layoutJustified(aspects, { containerWidth: 1000, targetRowHeight: 200, gap: 0 });
    for (const row of rows) {
      for (const it of row.items) {
        expect(it.width / row.height).toBeCloseTo(aspects[it.index], 5);
      }
    }
  });

  it('breaks into a new row once the target height is reached', () => {
    // four 2:1 landscapes: first three commit at the target, the 4th spills.
    const rows = layoutJustified([2, 2, 2, 2], { containerWidth: 1000, targetRowHeight: 200, gap: 0, maxRowHeight: 300 });
    expect(rows).toHaveLength(2);
    expect(rows[0].items.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(rows[0].height).toBeCloseTo(1000 / 6, 5); // 166.67
    expect(rows[1].items.map((i) => i.index)).toEqual([3]);
  });

  it('does not over-stretch a sparse last row (clamped to maxRowHeight, ragged edge)', () => {
    // the lone trailing landscape would justify to 500px tall if stretched to
    // full width; it must be clamped so the last row stays a sane height.
    const rows = layoutJustified([2, 2, 2, 2], { containerWidth: 1000, targetRowHeight: 200, gap: 0, maxRowHeight: 300 });
    const last = rows[rows.length - 1];
    expect(last.height).toBeLessThanOrEqual(300);
    expect(sumRowWidth(last, 0)).toBeLessThan(1000); // ragged, not force-filled
  });

  it('accounts for inter-photo gaps when justifying', () => {
    const rows = layoutJustified([1, 1], { containerWidth: 1000, targetRowHeight: 490, gap: 20 });
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBeCloseTo(490, 5); // (1000 - 20) / 2
    expect(sumRowWidth(rows[0], 20)).toBeCloseTo(1000, 5);
  });

  it('keeps a single portrait photo at a sane size instead of blowing it full-width', () => {
    const rows = layoutJustified([0.75], { containerWidth: 1000, targetRowHeight: 200, gap: 0, maxRowHeight: 300 });
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBeCloseTo(300, 5); // clamped, not 1000/0.75
    expect(rows[0].items[0].width).toBeCloseTo(225, 5); // 0.75 * 300
  });

  it('caps a row at maxItemsPerRow so photos never shrink illegibly small', () => {
    // five portrait photos (phone shots of A4-ish daily reports): unlimited,
    // all five pack into one 185px row — each only ~131px wide. With a cap of
    // 3 the rows split 3 + 2 and every photo stays substantially larger.
    const aspects = [0.707, 0.707, 0.707, 0.707, 0.707];
    const uncapped = layoutJustified(aspects, { containerWidth: 688, targetRowHeight: 200, gap: 8, maxRowHeight: 300 });
    expect(uncapped).toHaveLength(1); // documents the cramming this cap fixes

    const rows = layoutJustified(aspects, { containerWidth: 688, targetRowHeight: 200, gap: 8, maxRowHeight: 300, maxItemsPerRow: 3 });
    expect(rows).toHaveLength(2);
    expect(rows[0].items.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(rows[1].items.map((i) => i.index)).toEqual([3, 4]);
    for (const row of rows) {
      expect(row.height).toBeLessThanOrEqual(300); // count-capped rows clamp like the last row
      for (const it of row.items) expect(it.width).toBeGreaterThan(200);
    }
  });

  it('maxItemsPerRow leaves wide-landscape packing untouched when rows commit before the cap', () => {
    const capped = layoutJustified([2, 2, 1], { containerWidth: 1000, targetRowHeight: 200, gap: 0, maxItemsPerRow: 3 });
    const free = layoutJustified([2, 2, 1], { containerWidth: 1000, targetRowHeight: 200, gap: 0 });
    expect(capped).toEqual(free);
  });

  it('skips non-positive/degenerate aspect ratios', () => {
    const rows = layoutJustified([2, 0, 1, -1], { containerWidth: 1000, targetRowHeight: 200, gap: 0 });
    const indices = rows.flatMap((r) => r.items.map((i) => i.index));
    expect(indices).not.toContain(1);
    expect(indices).not.toContain(3);
    expect(indices).toEqual([0, 2]);
  });
});
