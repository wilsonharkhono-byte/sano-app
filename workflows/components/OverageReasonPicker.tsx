import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import {
  OVERAGE_REASONS, OVERAGE_REASON_LABELS, requiresOverageNote,
} from '../../tools/requestOverage';
import type { OverageReason } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';

interface Props {
  reason: OverageReason | null;
  note: string;
  /** Patch shape matches PermintaanScreen's updateLine, so callers just forward it. */
  onChange: (patch: { overageReason?: OverageReason | null; overageNote?: string }) => void;
  /** Heading — Mode Besi names the diameter its one picker covers. */
  title?: string;
  hint?: string;
}

/**
 * Signal-1 overage reason capture (spec 2026-07-10 §3). Extracted verbatim from
 * PermintaanScreen so the BoQ-first demand list and the Mode Besi matrix reuse
 * the exact same control instead of re-implementing it — the reason is required
 * before submit, so two drifting copies would be a submit-blocking bug class.
 */
export default function OverageReasonPicker({
  reason, note, onChange,
  title = 'Alasan kelebihan alokasi',
  hint = 'Permintaan ini membuat total melebihi rencana. Pilih alasan agar estimator bisa menindaklanjuti.',
}: Props): React.ReactElement {
  const otherNoteMissing = requiresOverageNote(reason, note);

  return (
    <View style={[styles.reasonBox, !reason && styles.reasonBoxMissing]}>
      <Text style={styles.reasonLabel}>
        {title} <Text style={styles.req}>*</Text>
      </Text>
      <Text style={styles.reasonHint}>{hint}</Text>
      <View style={styles.reasonChips}>
        {OVERAGE_REASONS.map(option => {
          const selected = reason === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.reasonChip, selected && styles.reasonChipActive]}
              onPress={() => onChange({ overageReason: selected ? null : option })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={OVERAGE_REASON_LABELS[option]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>
                {OVERAGE_REASON_LABELS[option]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {reason && (
        <>
          {reason === 'OTHER' && (
            <Text style={styles.reasonLabel}>
              Keterangan <Text style={styles.req}>*</Text>
            </Text>
          )}
          <TextInput
            style={[styles.input, styles.reasonNote, otherNoteMissing && styles.reasonNoteMissing]}
            value={note}
            onChangeText={text => onChange({ overageNote: text })}
            placeholder={
              reason === 'OTHER' ? "Jelaskan alasan 'Lainnya'…" : 'Catatan tambahan (opsional)…'
            }
            placeholderTextColor={COLORS.textMuted}
            multiline
          />
          {otherNoteMissing && (
            <Text style={styles.reasonNoteError}>
              Alasan &apos;Lainnya&apos; butuh keterangan
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  req: { color: COLORS.critical },
  reasonBox: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  reasonBoxMissing: { borderColor: COLORS.critical, backgroundColor: COLORS.criticalBg },
  reasonLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text },
  reasonHint: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec,
    marginTop: 2, marginBottom: SPACE.sm, lineHeight: 17,
  },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  reasonChip: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 999,
    paddingHorizontal: SPACE.md - 2, paddingVertical: SPACE.sm - 1,
    backgroundColor: COLORS.surface,
  },
  reasonChipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}15` },
  reasonChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  reasonChipTextActive: { color: COLORS.primary },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md - 1,
    paddingHorizontal: SPACE.md,
    fontSize: TYPE.md,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  reasonNote: { marginTop: SPACE.sm, minHeight: 44, textAlignVertical: 'top' },
  reasonNoteMissing: { borderColor: COLORS.critical },
  reasonNoteError: {
    fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.critical, marginTop: 4,
  },
});
