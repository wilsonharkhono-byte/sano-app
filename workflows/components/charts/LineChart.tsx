// workflows/components/charts/LineChart.tsx
// SANO — a small line chart on react-native-svg (web and Android). One y-axis;
// series differ by colour, width and dash, never by colour alone, and the
// legend is always there (as switches when the caller passes onToggle). A
// band fills the space between two series, an annotation marks a level over
// a span of weeks. Missing values break the line instead of being drawn as 0.
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { bandLabelIndex, bandPath, endLabelPoints, isDrawable, labelIndices, linePath, niceMax, plotArea, xAt, yAt } from './chartGeometry';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** SVG dash pattern, e.g. "6 4"; solid when absent. */
  dash?: string;
  values: ReadonlyArray<number | null>;
  /** Draw a dot on every point (for sparse, real measurements). */
  dots?: boolean;
  /** Stroke width in px; 2 when absent. */
  width?: number;
  /** 0–1; 1 when absent. */
  opacity?: number;
  /** Write the last real value at the line's end. */
  endLabel?: boolean;
}

export interface Band {
  key: string;
  /** [top series key, bottom series key]; drawn where both are numbers and both visible. */
  between: [string, string];
  color: string;
  opacity: number;
  /** Written once, where the band is widest, when it is at least 16px tall there. */
  label?: string;
}

export interface Annotation {
  key: string;
  /** bracket: a hairline with end ticks and the label above its middle. run: a dotted hairline with the label above its end. */
  kind: 'bracket' | 'run';
  level: number;
  fromIndex: number;
  toIndex: number;
  label: string;
  color?: string;
  /** Series that must be visible for the annotation to show. */
  requires?: string[];
}

interface Props {
  labels: string[];
  series: LineSeries[];
  /** Fixed axis maximum (100 for percent); otherwise rounded up from the data. */
  yMax?: number;
  unit?: string;
  height?: number;
  /** Index of "today", drawn as a thin vertical rule. */
  markerIndex?: number | null;
  accessibilityLabel: string;
  bands?: Band[];
  annotations?: Annotation[];
  /** Series keys switched off; with onToggle the legend items become switches. */
  hidden?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];
const MIN_BAND_LABEL_PX = 16;
/** Room an end label needs to its right; with less it goes above the point instead of past the edge. */
const END_LABEL_ROOM_PX = 34;
/** How far a centred band label is kept inside the plot so it never runs off either side. */
const BAND_LABEL_INSET_PX = 28;

export default function LineChart({ labels, series, yMax, unit = '', height = 190, markerIndex = null, accessibilityLabel, bands = [], annotations = [], hidden, onToggle }: Props) {
  const [width, setWidth] = useState(0);
  const isVisible = (key: string) => !hidden?.has(key);
  const visible = series.filter((s) => isVisible(s.key));
  const dataMax = Math.max(0, ...visible.flatMap((s) => s.values.filter(isDrawable)));
  const max = yMax ?? niceMax(dataMax);
  const area = plotArea({ width, height, left: 38, right: 10, top: 8, bottom: 22 });
  const tick = (v: number) => `${Math.round(v * 10) / 10}${unit}`;
  const x = (i: number) => xAt(i, labels.length, area.x0, area.x1);
  const y = (v: number) => yAt(v, max, area.y0, area.y1);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const ends = endLabelPoints(visible.filter((s) => s.endLabel), max, area, undefined, labels.length);

  return (
    <View>
      <View style={styles.legend}>
        {series.map((s) => {
          const on = isVisible(s.key);
          // An off item is a flat 40%: its own tint would compound into near-invisibility.
          const swatch = <View style={[styles.legendLine, { borderTopColor: s.color, borderTopWidth: s.width ?? 2, borderStyle: s.dash ? 'dotted' : 'solid', opacity: on ? s.opacity ?? 1 : 1 }]} />;
          const item = (
            <>
              {swatch}
              <Text style={styles.legendText}>{s.label}</Text>
            </>
          );
          if (!onToggle) return <View key={s.key} style={styles.legendItem}>{item}</View>;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.legendItem, styles.legendSwitch, !on && styles.legendOff]}
              onPress={() => onToggle(s.key)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="switch"
              accessibilityLabel={`Tampilkan ${s.label}`}
              accessibilityState={{ checked: on }}
            >
              {item}
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {TICKS.map((t) => (
              <React.Fragment key={t}>
                <Line x1={area.x0} x2={area.x1} y1={y(max * t)} y2={y(max * t)} stroke={COLORS.borderSub} strokeWidth={1} />
                <SvgText x={area.x0 - 6} y={y(max * t) + 4} fontSize={10} fill={COLORS.textMuted} textAnchor="end">{tick(max * t)}</SvgText>
              </React.Fragment>
            ))}
            {bands.map((b) => {
              const top = byKey.get(b.between[0]);
              const bottom = byKey.get(b.between[1]);
              if (!top || !bottom || !isVisible(top.key) || !isVisible(bottom.key)) return null;
              const d = bandPath(top.values, bottom.values, max, area, labels.length);
              if (!d) return null;
              const li = b.label ? bandLabelIndex(top.values, bottom.values) : null;
              const tall = li !== null && y(bottom.values[li] as number) - y(top.values[li] as number) >= MIN_BAND_LABEL_PX;
              return (
                <React.Fragment key={b.key}>
                  <Path d={d} fill={b.color} fillOpacity={b.opacity} stroke="none" />
                  {tall && li !== null && (
                    <SvgText x={Math.min(Math.max(x(li), area.x0 + BAND_LABEL_INSET_PX), area.x1 - BAND_LABEL_INSET_PX)} y={(y(top.values[li] as number) + y(bottom.values[li] as number)) / 2 + 4} fontSize={10} fill={COLORS.textSec} textAnchor="middle">{b.label}</SvgText>
                  )}
                </React.Fragment>
              );
            })}
            {markerIndex != null && markerIndex >= 0 && markerIndex < labels.length && (
              <Line x1={x(markerIndex)} x2={x(markerIndex)} y1={area.y0} y2={area.y1} stroke={COLORS.textMuted} strokeWidth={1} strokeDasharray="2 3" />
            )}
            {visible.map((s) => (
              <React.Fragment key={s.key}>
                <Path d={linePath(s.values, max, area, labels.length)} stroke={s.color} strokeOpacity={s.opacity ?? 1} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" fill="none" />
                {s.dots && s.values.map((v, i) => (isDrawable(v)
                  ? <Circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke={COLORS.surface} strokeWidth={2} />
                  : null))}
              </React.Fragment>
            ))}
            {annotations.map((an) => {
              if ((an.requires ?? []).some((k) => !isVisible(k))) return null;
              if (!isDrawable(an.level)) return null;
              if (an.fromIndex < 0 || an.toIndex >= labels.length || an.toIndex < an.fromIndex) return null;
              const yy = y(an.level);
              const xa = x(an.fromIndex);
              const xb = x(an.toIndex);
              const color = an.color ?? COLORS.textMuted;
              return (
                <React.Fragment key={an.key}>
                  <Line x1={xa} x2={xb} y1={yy} y2={yy} stroke={color} strokeWidth={1} strokeDasharray={an.kind === 'run' ? '2 3' : undefined} />
                  {an.kind === 'bracket' && <Line x1={xa} x2={xa} y1={yy - 3} y2={yy + 3} stroke={color} strokeWidth={1} />}
                  {an.kind === 'bracket' && <Line x1={xb} x2={xb} y1={yy - 3} y2={yy + 3} stroke={color} strokeWidth={1} />}
                  <SvgText x={an.kind === 'bracket' ? (xa + xb) / 2 : xb} y={yy - 5} fontSize={10} fill={COLORS.textSec} textAnchor={an.kind === 'bracket' ? 'middle' : 'end'}>{an.label}</SvgText>
                </React.Fragment>
              );
            })}
            {ends.map((p) => {
              // Past the right edge there is no room beside the point, so the label sits above it.
              const tight = p.x > area.x1 - END_LABEL_ROOM_PX;
              return (
                <SvgText key={p.key} x={tight ? p.x : p.x + 5} y={tight ? p.y - 6 : p.y + 4} fontSize={10} fill={COLORS.textSec} textAnchor={tight ? 'end' : 'start'}>{tick(p.value)}</SvgText>
              );
            })}
            {labelIndices(labels.length, width < 420 ? 4 : 7).map((i) => (
              <SvgText key={i} x={x(i)} y={height - 6} fontSize={10} fill={COLORS.textMuted} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
                {labels[i]}
              </SvgText>
            ))}
          </Svg>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, marginBottom: SPACE.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  legendSwitch: { minHeight: 32 },
  legendOff: { opacity: 0.4 },
  legendLine: { width: 18, height: 0, borderTopWidth: 2 },
  legendText: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.45), fontFamily: FONTS.regular, color: COLORS.textSec },
});
