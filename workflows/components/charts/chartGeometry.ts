// workflows/components/charts/chartGeometry.ts
// SANO — geometry for the SVG charts, kept out of the components so it can be
// tested without rendering. Pure.

export interface Frame { width: number; height: number; left: number; right: number; top: number; bottom: number }

export function plotArea(f: Frame): { x0: number; x1: number; y0: number; y1: number } {
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
export function linePath(values: ReadonlyArray<number | null>, yMax: number, area: { x0: number; x1: number; y0: number; y1: number }): string {
  const parts: string[] = [];
  let open = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) { open = false; return; }
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
