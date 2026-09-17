// workflows/components/charts/StackedBarChart.tsx
// SANO — stacked (or single-series) bars on react-native-svg. A 2 px gap
// separates touching segments; bars are square at the baseline.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { labelIndices, niceMax, plotArea, yAt } from './chartGeometry';

export interface BarSeries { key: string; label: string; color: string; values: ReadonlyArray<number> }

interface Props {
  labels: string[];
  series: BarSeries[];
  unit?: string;
  height?: number;
  accessibilityLabel: string;
}

const TICKS = [0, 0.5, 1];
const MAX_BAR = 24;

export default function StackedBarChart({ labels, series, unit = '', height = 160, accessibilityLabel }: Props) {
  const [width, setWidth] = useState(0);
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const area = plotArea({ width, height, left: 34, right: 8, top: 8, bottom: 22 });
  const slot = labels.length > 0 ? (area.x1 - area.x0) / labels.length : 0;
  const bar = Math.min(MAX_BAR, slot * 0.6);

  return (
    <View>
      {series.length > 1 && (
        <View style={styles.legend}>
          {series.map((s) => (
            <View key={s.key} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <Text style={styles.legendText}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {TICKS.map((t) => {
              const y = yAt(max * t, max, area.y0, area.y1);
              return (
                <React.Fragment key={t}>
                  <Line x1={area.x0} x2={area.x1} y1={y} y2={y} stroke={COLORS.borderSub} strokeWidth={1} />
                  <SvgText x={area.x0 - 6} y={y + 4} fontSize={10} fill={COLORS.textMuted} textAnchor="end">{`${Math.round(max * t * 10) / 10}${unit}`}</SvgText>
                </React.Fragment>
              );
            })}
            {labels.map((_, i) => {
              let base = 0;
              const x = area.x0 + slot * i + (slot - bar) / 2;
              return series.map((s) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const yTop = yAt(base + v, max, area.y0, area.y1);
                const yBottom = yAt(base, max, area.y0, area.y1);
                base += v;
                const h = Math.max(1, yBottom - yTop - (yBottom < area.y1 ? 2 : 0));
                return <Rect key={`${i}-${s.key}`} x={x} y={yTop} width={bar} height={h} fill={s.color} />;
              });
            })}
            {labelIndices(labels.length, width < 420 ? 4 : 8).map((i) => (
              <SvgText key={i} x={area.x0 + slot * i + slot / 2} y={height - 6} fontSize={10} fill={COLORS.textMuted} textAnchor="middle">{labels[i]}</SvgText>
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
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: TYPE.xs, lineHeight: Math.round(TYPE.xs * 1.45), fontFamily: FONTS.regular, color: COLORS.textSec },
});
