import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  value: string;
  onChange: (text: string) => void;
  dirty: boolean;
  onReanalyze: () => void;
  busy: boolean;
}

/** Expandable, editable transcript. An edit offers "Analisis ulang" (spec §5.4). */
export default function TranscriptEditor({ value, onChange, dirty, onReanalyze, busy }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={COLORS.text} />
        <Text style={styles.toggleText}>Transkrip{value ? '' : ' (kosong)'}</Text>
      </TouchableOpacity>
      {open ? (
        <>
          <TextInput
            style={[s.input, s.textarea]}
            value={value}
            onChangeText={onChange}
            multiline
            editable={!busy}
            placeholder="Belum ada transkrip."
            placeholderTextColor={COLORS.textMuted}
            accessibilityLabel="Transkrip"
          />
          <Text style={s.hint}>Koreksi kata yang salah dengar. Kutipan dasar AI dicocokkan dengan teks ini.</Text>
          {dirty ? (
            <TouchableOpacity style={s.secondaryBtn} onPress={onReanalyze} disabled={busy} accessibilityRole="button">
              <Text style={s.secondaryText}>{busy ? 'Menganalisis…' : 'Analisis ulang dengan transkrip ini'}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SPACE.md },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 44 },
  toggleText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
});
