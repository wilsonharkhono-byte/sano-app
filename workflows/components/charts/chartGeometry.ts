// workflows/components/charts/chartGeometry.ts
// SANO — geometry for the SVG charts, kept out of the components so it can be
// tested without rendering. Pure.

export interface Frame { width: number; height: number; left: number; right: number; top: number; bottom: number }

export interface Area { x0: number; x1: number; y0: number; y1: number }

/** A value the charts can draw: a finite number. */
export const isDrawable = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function plotArea(f: Frame): Area {
  return { x0: f.left, x1: Math.max(f.left, f.width - f.right), y0: f.top, y1: Math.max(f.top, f.height - f.bottom) };
}

/** A round axis maximum at or above the data maximum: 1, 2, 2.5 or 5 times a power of ten, split in four. */
export function niceMax(dataMax: number): number {
  if (!(dataMax > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= dataMax) return step * magnitude;
  return 10 * magnitude;
}

export function xAt(index: number, count: number, x0: number, x1: number): number {
  return count <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * index) / (count - 1);
}

export function yAt(value: number, yMax: number, y0: number, y1: number): number {
  const clamped = Math.min(yMax, Math.max(0, value));
  return y1 - ((y1 - y0) * clamped) / yMax;
}

/** SVG path data for a series with gaps: each run of numbers is its own sub-path; a lone point draws nothing here (the dot shows it). */
export function linePath(values: ReadonlyArray<number | null>, yMax: number, area: Area): string {
  const parts: string[] = [];
  let open = false;
  values.forEach((v, i) => {
    if (!isDrawable(v)) { open = false; return; }
    const point = `${xAt(i, values.length, area.x0, area.x1).toFixed(1)} ${yAt(v, yMax, area.y0, area.y1).toFixed(1)}`;
    parts.push(`${open ? 'L' : 'M'} ${point}`);
    open = true;
  });
  return parts.join(' ');
}

/** Indices of at most `max` evenly spread labels, always the first and the last. */
export function labelIndices(count: number, max: number): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const picked = new Set<number>();
  for (let k = 0; k < max; k += 1) picked.add(Math.round((k * (count - 1)) / (max - 1)));
  return [...picked].sort((a, b) => a - b);
}

/** A point on a circle; `deg` runs clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path of the clockwise arc from `a0` to `a1` degrees; empty when a1 ≤ a0. Sweeps of 360° or more are capped just short of a full circle, by enough that the end point differs from the start at any radius. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (!(a1 > a0)) return '';
  const sweep = Math.min(360 - Math.max(0.01, 1.2 / r), a1 - a0);
  const s = polar(cx, cy, r, a0);
  const e = polar(cx, cy, r, a0 + sweep);
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/** The area between series `a` (top edge, drawn forward) and `b` (bottom edge, drawn back), one polygon per run where both are numbers. `count` is the number of x slots (the chart's label count); it defaults to the longer series. */
export function bandPath(a: ReadonlyArray<number | null>, b: ReadonlyArray<number | null>, yMax: number, area: Area, count = Math.max(a.length, b.length)): string {
  const parts: string[] = [];
  let run: number[] = [];
  const pt = (i: number, v: number) => `${xAt(i, count, area.x0, area.x1).toFixed(1)} ${yAt(v, yMax, area.y0, area.y1).toFixed(1)}`;
  const flush = () => {
    if (run.length >= 2) {
      const fwd = run.map((i) => pt(i, a[i] as number));
      const back = [...run].reverse().map((i) => pt(i, b[i] as number));
      parts.push(`M ${fwd[0]} ${fwd.slice(1).map((p) => `L ${p}`).join(' ')} ${back.map((p) => `L ${p}`).join(' ')} Z`);
    }
    run = [];
  };
  a.forEach((v, i) => { if (isDrawable(v) && isDrawable(b[i])) run.push(i); else flush(); });
  flush();
  return parts.join(' ');
}

/** Index where `a` exceeds `b` by the most; null when it never does. */
export function bandLabelIndex(a: ReadonlyArray<number | null>, b: ReadonlyArray<number | null>): number | null {
  let best: number | null = null;
  let gap = 0;
  a.forEach((v, i) => {
    const w = b[i];
    if (isDrawable(v) && isDrawable(w) && v - w > gap) { gap = v - w; best = i; }
  });
  return best;
}

/** Where to write each series' last real value; labels closer than `minGap` px are pushed down in order so they never overlap. */
export function endLabelPoints(
  series: ReadonlyArray<{ key: string; values: ReadonlyArray<number | null> }>,
  yMax: number,
  area: Area,
  minGap = 11,
): Array<{ key: string; index: number; value: number; x: number; y: number }> {
  const points: Array<{ key: string; index: number; value: number; x: number; y: number }> = [];
  for (const s of series) {
    let index = -1;
    s.values.forEach((v, i) => { if (isDrawable(v)) index = i; });
    if (index < 0) continue;
    const value = s.values[index] as number;
    points.push({ key: s.key, index, value, x: xAt(index, s.values.length, area.x0, area.x1), y: yAt(value, yMax, area.y0, area.y1) });
  }
  points.sort((a, b) => a.y - b.y);
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].x === points[i - 1].x && points[i].y - points[i - 1].y < minGap) points[i].y = points[i - 1].y + minGap;
  }
  return points;
}
