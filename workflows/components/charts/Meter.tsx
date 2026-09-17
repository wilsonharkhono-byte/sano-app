// workflows/components/charts/Meter.tsx
// SANO — a ratio against a limit: two shades of one colour on a pale track.
// Plain views, no SVG.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';

interface Props {
  label: string;
  /** 0–100; drawn in the strong shade. */
  primaryPct: number | null;
  /** 0–100, at or above primaryPct; the part beyond primary is drawn lighter. */
  secondaryPct?: number | null;
  caption: string;
  color?: string;
}

const clamp = (v: number | null | undefined) => Math.min(100, Math.max(0, v ?? 0));

export default function Meter({ label, primaryPct, secondaryPct = null, caption, color = COLORS.info }: Props) {
  const primary = clamp(primaryPct);
  const extra = Math.max(0, clamp(secondaryPct) - primary);
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${label}. ${caption}`}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View style={{ width: `${primary}%`, backgroundColor: color }} />
        {extra > 0 && <View style={{ width: `${extra}%`, backgroundColor: color, opacity: 0.4, marginLeft: 2 }} />}
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

const lh = (size: number) => Math.round(size * 1.45);
const styles = StyleSheet.create({
  wrap: { marginTop: SPACE.sm },
  label: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text },
  track: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: COLORS.surfaceAlt, marginVertical: SPACE.xs },
  caption: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
});
