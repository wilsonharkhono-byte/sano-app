import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DATUM_BOARD_COPY, type DatumChipState } from '../../../tools/datumGateStatus';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';

/**
 * DATUM's readiness for one room on Papan Ruangan (spec 2026-09-27 §8.2),
 * under the room's own meta line. DATUM's word per gate, the time SANO read
 * it, "lama" past 24 hours; or the one sentence that says what is unknown.
 * It sits beside SANO's own "Gerbang X" meta, which is where SANO's latest
 * event was filed, not a readiness verdict.
 */
export default function DatumRoomLine({ state }: { state: DatumChipState }) {
  if (state.kind === 'hidden') return null;
  if (state.kind === 'never') return <Text style={styles.muted}>{DATUM_BOARD_COPY.never}</Text>;
  if (state.kind === 'none') return <Text style={styles.muted}>{DATUM_BOARD_COPY.none}</Text>;
  const tail = `per DATUM ${state.asOf}${state.old ? ` · ${DATUM_BOARD_COPY.old}` : ''}${state.datumStale ? ` · ${DATUM_BOARD_COPY.datumStale}` : ''}`;
  return (
    <View style={styles.row}>
      {state.chips.map((c) => {
        const blocked = c.status === 'blocked' && !state.old;
        return (
          <View key={c.gate_code} style={[styles.chip, blocked && styles.chipBlocked, state.old && styles.chipOld]}>
            <Text style={[styles.chipText, blocked && styles.textBlocked, state.old && styles.textOld]}>
              {c.gate_code} {c.label}
            </Text>
          </View>
        );
      })}
      <Text style={styles.muted}>{tail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center', marginTop: SPACE.xs },
  chip: { backgroundColor: COLORS.infoBg, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipBlocked: { backgroundColor: COLORS.criticalBg },
  chipOld: { backgroundColor: COLORS.surfaceSunken },
  chipText: { fontSize: 10, fontFamily: FONTS.semibold, color: COLORS.info },
  textBlocked: { color: COLORS.critical },
  textOld: { color: COLORS.textMuted },
  muted: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
});
