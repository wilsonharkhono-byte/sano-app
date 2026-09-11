import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { parseRoomPaste, type ParsedRoomRow } from '../../../tools/rooms';
import { AREA_TYPE_LABELS } from '../../../tools/constants';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

interface Props {
  saving: boolean;
  onCancel: () => void;
  onImport: (rows: ParsedRoomRow[]) => void;
}

/**
 * Preview before import, always. The warning list is the honest half: every
 * line the parser dropped is named with its line number and its reason, so a
 * room never goes missing quietly.
 */
export default function RoomPasteImport({ saving, onCancel, onImport }: Props) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseRoomPaste(text), [text]);

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Satu ruangan per baris: lantai, nama, lalu tipe area (opsional). Pemisah kolom: | , titik koma, atau tab.
        {'\n'}Contoh: Lt. 2 | Kamar Mandi Utama | Kamar mandi
      </Text>

      <TextInput
        style={styles.textarea} value={text} onChangeText={setText}
        multiline numberOfLines={8} textAlignVertical="top"
        placeholder={'Lt. 1 | Dapur | Dapur\nLt. 2 | Kamar Mandi Utama | Kamar mandi'}
        placeholderTextColor={COLORS.textMuted}
      />

      {parsed.rows.length > 0 && (
        <>
          <Text style={styles.subHead}>{parsed.rows.length} ruangan akan dibuat</Text>
          {parsed.rows.slice(0, 20).map((r) => (
            <View key={r.room_code} style={styles.previewRow}>
              <Text style={styles.previewCode}>{r.room_code}</Text>
              <Text style={styles.previewName} numberOfLines={1}>
                {r.room_name}{r.floor ? ` · ${r.floor}` : ''} · {AREA_TYPE_LABELS[r.area_type]}
              </Text>
            </View>
          ))}
          {parsed.rows.length > 20 && (
            <Text style={styles.hint}>…dan {parsed.rows.length - 20} baris lagi.</Text>
          )}
        </>
      )}

      {parsed.warnings.length > 0 && (
        <View style={styles.warnBox}>
          <Text style={styles.warnHead}>{parsed.warnings.length} baris perlu diperiksa</Text>
          {parsed.warnings.map((w, i) => <Text key={i} style={styles.warnLine}>• {w}</Text>)}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, (parsed.rows.length === 0 || saving) && styles.saveBtnOff]}
          disabled={parsed.rows.length === 0 || saving}
          onPress={() => onImport(parsed.rows)}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>
            {saving ? 'Mengimpor…' : `Impor ${parsed.rows.length} ruangan`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginBottom: SPACE.sm },
  textarea: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, minHeight: 140, fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text,
  },
  subHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.4, textTransform: 'uppercase',
    color: COLORS.textSec, marginTop: SPACE.md, marginBottom: SPACE.xs,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 3 },
  previewCode: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, minWidth: 132 },
  previewName: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec },
  warnBox: { marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS, backgroundColor: COLORS.warningBg },
  warnHead: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.warning, marginBottom: SPACE.xs },
  warnLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnOff: { backgroundColor: COLORS.surfaceAlt },
  saveText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
});
