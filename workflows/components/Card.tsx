import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

interface Props {
  title?: string;
  subtitle?: string;
  /** Accent colour used for the title row left indicator dot */
  borderColor?: string;
  /** Optional node rendered at the trailing end of the title row */
  rightAction?: React.ReactNode;
  style?: ViewStyle;
  children: React.ReactNode;
}

/**
 * Card — base surface container.
 *
 * When `borderColor` is provided the title row gets a coloured indicator dot
 * instead of the old 4px left border, which was a lazy accent pattern.
 * The card background stays neutral; only the dot carries meaning.
 */
export default function Card({ title, subtitle, borderColor, rightAction, style, children }: Props) {
  return (
    <View style={[styles.card, style]}>
      {title && (
        <View style={styles.titleRow}>
          {borderColor && <View style={[styles.dot, { backgroundColor: borderColor }]} />}
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {rightAction}
        </View>
      )}
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    padding: SPACE.base,
    marginBottom: SPACE.md,
    // Softer, warmer shadow
    shadowColor: '#5A4A3A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  title: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.text,
    flex: 1,
  },
  subtitle: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginBottom: SPACE.md,
    lineHeight: 19,
  },
});
