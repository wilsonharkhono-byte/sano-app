import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FLAG_COLORS, FLAG_BG, FONTS, TYPE, RADIUS_SM } from '../theme';

interface Props {
  flag: string;
  label?: string;
}

const FLAG_LABELS: Record<string, string> = {
  OK: 'OK',
  INFO: 'Info',
  WARNING: 'Peringatan',
  HIGH: 'Tinggi',
  CRITICAL: 'Kritis',
};

export default function Badge({ flag, label }: Props) {
  const bgColor   = FLAG_BG[flag]     ?? 'rgba(0,0,0,0.06)';
  const textColor = FLAG_COLORS[flag] ?? '#524E49';
  const displayLabel = label ?? FLAG_LABELS[flag] ?? flag;

  return (
    <View
      style={[styles.badge, { backgroundColor: bgColor }]}
      accessibilityLabel={`Status: ${displayLabel}`}
      accessibilityRole="text"
    >
      <Text style={[styles.text, { color: textColor }]}>{displayLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS_SM,
  },
  text: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
