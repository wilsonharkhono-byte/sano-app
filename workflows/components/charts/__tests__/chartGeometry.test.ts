// workflows/components/charts/__tests__/chartGeometry.test.ts
import { arcPath, bandLabelIndex, bandPath, labelIndices, linePath, niceMax, plotArea, polar, xAt, yAt } from '../chartGeometry';

describe('chartGeometry', () => {
  const area = plotArea({ width: 300, height: 120, left: 40, right: 10, top: 10, bottom: 20 });

  it('lays the plot area inside the frame', () => {
    expect(area).toEqual({ x0: 40, x1: 290, y0: 10, y1: 100 });
  });

  it('rounds the axis maximum up', () => {
    expect([0, 3, 14, 23, 39, 100, 229].map(niceMax)).toEqual([1, 5, 20, 25, 50, 100, 250]);
  });

  it('places points, with zero on the baseline and the maximum at the top', () => {
    expect(xAt(0, 5, area.x0, area.x1)).toBe(40);
    expect(xAt(4, 5, area.x0, area.x1)).toBe(290);
    expect(xAt(0, 1, area.x0, area.x1)).toBe(165);
    expect(yAt(0, 100, area.y0, area.y1)).toBe(100);
    expect(yAt(100, 100, area.y0, area.y1)).toBe(10);
    expect(yAt(150, 100, area.y0, area.y1)).toBe(10);
  });

  it('breaks a line at missing values', () => {
    expect(linePath([0, 50, null, 100], 100, area)).toBe('M 40.0 100.0 L 123.3 55.0 M 290.0 10.0');
    expect(linePath([null, null], 100, area)).toBe('');
  });

  it('spreads a few labels over many points', () => {
    expect(labelIndices(4, 6)).toEqual([0, 1, 2, 3]);
    expect(labelIndices(37, 5)).toEqual([0, 9, 18, 27, 36]);
    expect(labelIndices(0, 5)).toEqual([]);
  });
});

describe('polar and arcPath', () => {
  it('measures angles clockwise from 12 o’clock', () => {
    expect(polar(0, 0, 10, 0)).toEqual({ x: expect.closeTo(0, 6), y: -10 });
    expect(polar(0, 0, 10, 90)).toEqual({ x: 10, y: expect.closeTo(0, 6) });
    expect(polar(0, 0, 10, 180)).toEqual({ x: expect.closeTo(0, 6), y: 10 });
  });

  it('draws an arc from a0 to a1 with the large-arc flag past 180°, and nothing for an empty sweep', () => {
    expect(arcPath(50, 50, 10, 0, 90)).toBe('M 50.00 40.00 A 10 10 0 0 1 60.00 50.00');
    expect(arcPath(50, 50, 10, 225, 495)).toBe('M 42.93 57.07 A 10 10 0 1 1 57.07 57.07');
    expect(arcPath(50, 50, 10, 90, 90)).toBe('');
    expect(arcPath(50, 50, 10, 90, 80)).toBe('');
  });

  it('caps a full sweep so the end point still differs from the start at a small radius', () => {
    const d = arcPath(50, 50, 20, 0, 400);
    const [, sx, sy, , , , , , , ex, ey] = d.split(' ');
    expect(`${sx} ${sy}`).not.toBe(`${ex} ${ey}`);
    expect(d).toMatch(/ A 20 20 0 1 1 /);
  });
});

describe('bandPath and bandLabelIndex', () => {
  const area = { x0: 0, x1: 100, y0: 0, y1: 100 };
  it('fills the area between two series as one polygon per run where both are numbers', () => {
    const a = [null, 50, 60, null, 80, 90];
    const b = [null, 10, 20, null, null, 30];
    expect(bandPath(a, b, 100, area)).toBe('M 20.0 50.0 L 40.0 40.0 L 40.0 80.0 L 20.0 90.0 Z');
  });
  it('returns nothing for a lone point and picks the widest positive gap for the label', () => {
    expect(bandPath([null, 50], [null, 10], 100, area)).toBe('');
    expect(bandLabelIndex([10, 50, 60, 20], [5, 10, 55, 30])).toBe(1);
    expect(bandLabelIndex([10, 5], [20, 9])).toBeNull();
  });
  it('treats NaN and Infinity as gaps, like linePath, and draws one polygon per run', () => {
    const area = { x0: 0, x1: 100, y0: 0, y1: 100 };
    expect(bandPath([50, NaN, 60, 70], [10, 20, 30, 40], 100, area)).toBe('M 66.7 40.0 L 100.0 30.0 L 100.0 60.0 L 66.7 70.0 Z');
    expect(bandPath([50, 60, null, 70, 80], [10, 20, null, 30, 40], 100, area)).toBe('M 0.0 50.0 L 25.0 40.0 L 25.0 80.0 L 0.0 90.0 Z M 75.0 30.0 L 100.0 20.0 L 100.0 60.0 L 75.0 70.0 Z');
    expect(bandPath([], [], 100, area)).toBe('');
    expect(linePath([1, Infinity, 2], 10, area)).toBe('M 0.0 90.0 M 100.0 80.0');
  });
  it('scales the band by an explicit point count', () => {
    const area = { x0: 0, x1: 100, y0: 0, y1: 100 };
    expect(bandPath([10, 20], [1, 2], 100, area, 4)).toBe('M 0.0 90.0 L 33.3 80.0 L 33.3 98.0 L 0.0 99.0 Z');
  });
  it('skips gaps when looking for the widest band', () => {
    expect(bandLabelIndex([null, 50, 10], [null, 10, 5])).toBe(1);
    expect(bandLabelIndex([NaN, 50], [1, 60])).toBeNull();
  });
});
