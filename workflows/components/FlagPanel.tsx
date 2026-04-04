import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { GateResult } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, FLAG_COLORS, FLAG_BG } from '../theme';
import Badge from './Badge';

interface Props {
  result: GateResult | null;
  gateLabel?: string;
}

export default function FlagPanel({ result, gateLabel = 'Gate' }: Props) {
  if (!result) {
    return (
      <View style={[styles.panel, { borderLeftColor: COLORS.border, backgroundColor: COLORS.surfaceAlt }]}>
        <Text style={styles.title}>{gateLabel} — Menunggu input</Text>
        <Text style={styles.msg}>Pilih item BoQ dan masukkan jumlah untuk melihat validasi.</Text>
      </View>
    );
  }

  const flagKey = result.flag;
  return (
    <View
      style={[styles.panel, { borderLeftColor: FLAG_COLORS[flagKey], backgroundColor: FLAG_BG[flagKey] }]}
      accessibilityLabel={`${gateLabel} status: ${flagKey}. ${result.msg}`}
      accessibilityRole="alert"
    >
      <View style={styles.titleRow}>
        <Badge flag={flagKey} />
        <Text style={styles.title}> {gateLabel} — Check {result.check}</Text>
      </View>
      <Text style={styles.msg}>{result.msg}</Text>
      {result.extra && (
        <View style={styles.extraRow}>
          <Badge flag={result.extra.flag} />
          <Text style={styles.extraMsg}> Check {result.extra.check}: {result.extra.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: RADIUS,
    padding: SPACE.md,
    marginBottom: SPACE.md,
    borderLeftWidth: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACE.sm,
    flexWrap: 'wrap',
    gap: SPACE.xs,
  },
  title: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: COLORS.text,
    flex: 1,
  },
  msg: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    lineHeight: 20,
  },
  extraRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: SPACE.sm,
    paddingTop: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(20,18,16,0.08)',
    gap: SPACE.xs,
  },
  extraMsg: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    flex: 1,
  },
});
