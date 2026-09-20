// workflows/components/charts/RadialRings.tsx
// SANO — concentric rings for a snapshot of several shares of one plan, on
// react-native-svg (web and Android). Each ring sweeps 270° from the lower
// left, 0 % at its start and 100 % at its end, open at the bottom; a ring may
// carry a lighter segment after its main one (requests still waiting) and a
// dot at its end. The hero figure is plain React Native text so it wraps.
// Identity comes from the ring colour plus the legend the caller draws.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { CHART, COLORS, FONTS, TYPE } from '../../theme';
import { arcPath, polar } from './chartGeometry';

export interface Ring {
  key: string;
  color: string;
  /** 0–100; null draws the track only, tint included. To hide just the main arc, pass 0 and anchor the tint with `tint.from`. */
  value: number | null;
  /** A lighter segment from `from` (the value when absent) to `tint.value`, drawn only when it lies beyond the main arc. */
  tint?: { from?: number; value: number; opacity: number } | null;
  endDot?: boolean;
  /** Skips the whole ring, track included. */
  hidden?: boolean;
}

interface Props {
  rings: Ring[];
  /** Outer diameter in px. */
  size?: number;
  hero: { value: string; label: string };
  accessibilityLabel: string;
}

export interface RingSegment { kind: 'track' | 'main' | 'tint'; d: string; opacity?: number }

export const SWEEP = 270;
/** Degrees clockwise from 12 o'clock: the lower left, so the open quarter sits at the bottom. */
export const START = 225;
const RING_WIDTH = 10;
const RING_GAP = 4;
/** Square caps overshoot by half the stroke; this arc length keeps a 2px visible gap between two segments of one ring. */
const SEGMENT_GAP_PX = RING_WIDTH + 2;

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const angleOf = (pct: number) => START + (SWEEP * clamp(pct)) / 100;

/** The arcs of one ring at radius `r`, and the end point of its main arc. Pure, for the tests. */
export function ringSegments(ring: Ring, cx: number, cy: number, r: number): { segments: RingSegment[]; end: { x: number; y: number } | null } {
  const segments: RingSegment[] = [{ kind: 'track', d: arcPath(cx, cy, r, START, START + SWEEP) }];
  if (ring.value === null) return { segments, end: null };
  const a1 = angleOf(ring.value);
  if (ring.value > 0) segments.push({ kind: 'main', d: arcPath(cx, cy, r, START, a1) });
  if (ring.tint && ring.tint.value > ring.value) {
    const from = ring.tint.from ?? ring.value;
    const gapDeg = ring.value > 0 && from <= ring.value ? (SEGMENT_GAP_PX / r) * (180 / Math.PI) : 0;
    const d = arcPath(cx, cy, r, angleOf(from) + gapDeg, angleOf(ring.tint.value));
    if (d) segments.push({ kind: 'tint', d, opacity: ring.tint.opacity });
  }
  return { segments, end: polar(cx, cy, r, a1) };
}

export default function RadialRings({ rings, size = 240, hero, accessibilityLabel }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 14;
  const innerRadius = outer - rings.length * (RING_WIDTH + RING_GAP);
  const label0 = polar(cx, cy, outer + 8, START);
  const label100 = polar(cx, cy, outer + 8, START + SWEEP);
  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size}>
        {rings.map((ring, i) => {
          if (ring.hidden) return null;
          const r = outer - i * (RING_WIDTH + RING_GAP) - RING_WIDTH / 2;
          const { segments, end } = ringSegments(ring, cx, cy, r);
          return (
            <React.Fragment key={ring.key}>
              {segments.map((s) => (
                <Path
                  key={s.kind}
                  d={s.d}
                  stroke={s.kind === 'track' ? CHART.track : ring.color}
                  strokeOpacity={s.opacity ?? 1}
                  strokeWidth={RING_WIDTH}
                  strokeLinecap="square"
                  fill="none"
                />
              ))}
              {ring.endDot && end && <Circle cx={end.x} cy={end.y} r={4} fill={ring.color} stroke={COLORS.surface} strokeWidth={2} />}
            </React.Fragment>
          );
        })}
        <SvgText x={label0.x} y={label0.y + 10} fontSize={10} fill={COLORS.textMuted} textAnchor="middle">0 %</SvgText>
        <SvgText x={label100.x} y={label100.y + 10} fontSize={10} fill={COLORS.textMuted} textAnchor="middle">100 %</SvgText>
      </Svg>
      <View style={styles.overlay} pointerEvents="none">
        <View style={{ width: Math.max(80, innerRadius * 2 - 8), alignItems: 'center' }}>
          <Text style={styles.heroValue}>{hero.value}</Text>
          <Text style={styles.heroLabel}>{hero.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroValue: { fontSize: TYPE.xl, lineHeight: Math.round(TYPE.xl * 1.2), fontFamily: FONTS.bold, color: COLORS.text, textAlign: 'center' },
  heroLabel: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.3), fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center' },
});
