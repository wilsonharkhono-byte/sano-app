import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

interface Props {
  value: string | number;
  label: string;
  /** Optional contextual note shown below label (e.g. "vs 12 last week") */
  context?: string;
  color?: string;
}

/**
 * StatTile — left-aligned metric tile.
 *
 * Intentionally avoids the "hero metric" anti-pattern (centred big number
 * with small all-caps label below). Instead, value and label sit in a
 * horizontal relationship with a subtle left accent bar.
 */
export default function StatTile({ value, label, context, color = COLORS.accent }: Props) {
  return (
    <View style={styles.tile} accessibilityLabel={`${label}: ${value}${context ? ', ' + context : ''}`}>
      <View style={[styles.accentBar, { backgroundColor: color }]} />
      <View style={styles.body}>
        <Text style={[styles.value, { color }]} numberOfLines={1}>{value}</Text>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {context ? <Text style={styles.context} numberOfLines={1}>{context}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    flex: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    // Softer shadow
    shadowColor: '#5A4A3A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
    flexShrink: 0,
    opacity: 0.7,
  },
  body: {
    flex: 1,
    padding: SPACE.md,
    paddingLeft: SPACE.sm + 2,
    justifyContent: 'center',
    gap: 1,
  },
  value: {
    fontSize: TYPE.xl,
    fontFamily: FONTS.bold,
    lineHeight: TYPE.xl + 2,
    letterSpacing: -0.5,
    // fontVariant: ['tabular-nums'], // helps on RN if supported
  },
  label: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    color: COLORS.textSec,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  context: {
    fontSize: TYPE.xs,       // was TYPE.xs-1 (10dp) — below mobile legibility floor
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginTop: 1,
  },
});
