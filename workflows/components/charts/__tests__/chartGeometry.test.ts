// workflows/components/charts/__tests__/chartGeometry.test.ts
import { labelIndices, linePath, niceMax, plotArea, xAt, yAt } from '../chartGeometry';

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
