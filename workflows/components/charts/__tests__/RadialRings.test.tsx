// workflows/components/charts/__tests__/RadialRings.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import RadialRings, { START, SWEEP, ringSegments } from '../RadialRings';
import { arcPath, polar } from '../chartGeometry';

describe('ringSegments', () => {
  it('draws the track, the main arc to the value, and a tint segment after a gap up to the tint value', () => {
    const { segments, end } = ringSegments({ key: 'p', color: '#000', value: 30.9, tint: { value: 43.3, opacity: 0.4 } }, 120, 120, 100);
    expect(segments.map((s) => s.kind)).toEqual(['track', 'main', 'tint']);
    expect(segments[1].d).toBe(arcPath(120, 120, 100, START, START + (SWEEP * 30.9) / 100));
    expect(segments[2].opacity).toBe(0.4);
    const gapDeg = (12 / 100) * (180 / Math.PI);
    expect(segments[2].d).toBe(arcPath(120, 120, 100, START + (SWEEP * 30.9) / 100 + gapDeg, START + (SWEEP * 43.3) / 100));
    expect(end).toEqual(polar(120, 120, 100, START + (SWEEP * 30.9) / 100));
  });

  it('draws only the track for a null value, no main arc at zero, and no tint at or below the value', () => {
    expect(ringSegments({ key: 'p', color: '#000', value: null }, 120, 120, 100)).toEqual({ segments: [{ kind: 'track', d: arcPath(120, 120, 100, START, START + SWEEP) }], end: null });
    expect(ringSegments({ key: 'p', color: '#000', value: 0, tint: { value: 0, opacity: 0.4 } }, 120, 120, 100).segments.map((s) => s.kind)).toEqual(['track']);
    expect(ringSegments({ key: 'p', color: '#000', value: 50, tint: { value: 40, opacity: 0.4 } }, 120, 120, 100).segments.map((s) => s.kind)).toEqual(['track', 'main']);
  });

  it('anchors the tint at an explicit start when the main segment is hidden', () => {
    const { segments } = ringSegments({ key: 'p', color: '#000', value: 0, tint: { from: 30.9, value: 43.3, opacity: 0.4 } }, 120, 120, 100);
    expect(segments.map((s) => s.kind)).toEqual(['track', 'tint']);
    expect(segments[1].d).toBe(arcPath(120, 120, 100, START + (SWEEP * 30.9) / 100, START + (SWEEP * 43.3) / 100));
  });
});

describe('RadialRings', () => {
  it('renders the hero figure and the accessibility label', () => {
    const { getByText, getByLabelText } = render(
      <RadialRings
        rings={[{ key: 'a', color: '#D9662B', value: 30.9 }, { key: 'b', color: '#1565C0', value: 13, endDot: true }, { key: 'c', color: '#1baf7a', value: null, hidden: true }]}
        hero={{ value: '13,0 %', label: 'terpasang, terverifikasi' }}
        accessibilityLabel="Besi: diminta 43,3 persen, disetujui 30,9 persen, terpasang 13 persen"
      />,
    );
    expect(getByText('13,0 %')).toBeTruthy();
    expect(getByText('terpasang, terverifikasi')).toBeTruthy();
    expect(getByLabelText('Besi: diminta 43,3 persen, disetujui 30,9 persen, terpasang 13 persen')).toBeTruthy();
  });
});
