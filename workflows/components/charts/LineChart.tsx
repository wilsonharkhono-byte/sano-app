// workflows/components/charts/LineChart.tsx
// SANO — a small line chart on react-native-svg (web and Android). One y-axis;
// series differ by colour and dash, never by colour alone. Missing values break
// the line instead of being drawn as zero.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { labelIndices, linePath, niceMax, plotArea, xAt, yAt } from './chartGeometry';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** SVG dash pattern, e.g. "6 4"; solid when absent. */
  dash?: string;
  values: ReadonlyArray<number | null>;
  /** Draw a dot on every point (for sparse, real measurements). */
  dots?: boolean;
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
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

export default function LineChart({ labels, series, yMax, unit = '', height = 190, markerIndex = null, accessibilityLabel }: Props) {
  const [width, setWidth] = useState(0);
  const dataMax = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number')));
  const max = yMax ?? niceMax(dataMax);
  const area = plotArea({ width, height, left: 38, right: 10, top: 8, bottom: 22 });
  const tick = (v: number) => `${Math.round(v * 10) / 10}${unit}`;

  return (
    <View>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendLine, { borderTopColor: s.color, borderStyle: s.dash ? 'dashed' : 'solid' }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {TICKS.map((t) => {
              const y = yAt(max * t, max, area.y0, area.y1);
              return (
                <React.Fragment key={t}>
                  <Line x1={area.x0} x2={area.x1} y1={y} y2={y} stroke={COLORS.borderSub} strokeWidth={1} />
                  <SvgText x={area.x0 - 6} y={y + 4} fontSize={10} fill={COLORS.textMuted} textAnchor="end">{tick(max * t)}</SvgText>
                </React.Fragment>
              );
            })}
            {markerIndex != null && markerIndex >= 0 && markerIndex < labels.length && (
              <Line
                x1={xAt(markerIndex, labels.length, area.x0, area.x1)} x2={xAt(markerIndex, labels.length, area.x0, area.x1)}
                y1={area.y0} y2={area.y1} stroke={COLORS.textMuted} strokeWidth={1} strokeDasharray="2 3"
              />
            )}
            {series.map((s) => (
              <React.Fragment key={s.key}>
                <Path d={linePath(s.values, max, area)} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" fill="none" />
                {s.dots && s.values.map((v, i) => (typeof v === 'number'
                  ? <Circle key={i} cx={xAt(i, s.values.length, area.x0, area.x1)} cy={yAt(v, max, area.y0, area.y1)} r={3} fill={s.color} />
                  : null))}
              </React.Fragment>
            ))}
            {labelIndices(labels.length, width < 420 ? 4 : 7).map((i) => (
              <SvgText key={i} x={xAt(i, labels.length, area.x0, area.x1)} y={height - 6} fontSize={10} fill={COLORS.textMuted} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
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
  legendLine: { width: 18, height: 0, borderTopWidth: 2 },
  legendText: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.45), fontFamily: FONTS.regular, color: COLORS.textSec },
});
