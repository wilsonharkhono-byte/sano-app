import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { normalizeRoomCode, isValidRoomCode, ROOM_CODE_MAX } from '../../../tools/roomCodes';
import { AREA_TYPES } from '../../../tools/constants';
import type { AreaType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

interface Props {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: { floor: string; room_name: string; area_type: AreaType }) => void;
}

/**
 * The code preview is the point of this form: it is derived, frozen once
 * printed, and the join key to DATUM later. The user sees exactly what will be
 * stored before they commit to it, and Simpan stays disabled while it is invalid.
 */
export default function RoomForm({ saving, onCancel, onSubmit }: Props) {
  const [floor, setFloor] = useState('');
  const [name, setName] = useState('');
  const [areaType, setAreaType] = useState<AreaType>('general');

  const code = normalizeRoomCode(`${floor} ${name}`);
  const codeOk = isValidRoomCode(code);
  const canSave = !!name.trim() && codeOk && !saving;

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Lantai</Text>
      <TextInput
        style={styles.input} value={floor} onChangeText={setFloor}
        placeholder="Lt. 2" placeholderTextColor={COLORS.textMuted}
      />

      <Text style={styles.label}>Nama ruangan</Text>
      <TextInput
        style={styles.input} value={name} onChangeText={setName}
        placeholder="Kamar Mandi Utama" placeholderTextColor={COLORS.textMuted}
      />

      <Text style={styles.label}>Tipe area</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={areaType} onValueChange={(v) => setAreaType(v as AreaType)}>
          {AREA_TYPES.map((t) => <Picker.Item key={t.value} label={t.label} value={t.value} />)}
        </Picker>
      </View>

      <Text style={styles.label}>Kode ruangan (otomatis)</Text>
      <Text style={[styles.codePreview, !codeOk && styles.codeBad]}>{code || '—'}</Text>
      <Text style={styles.hint}>
        {codeOk
          ? 'Kode ini dicetak pada label QR dan tidak bisa diubah setelah dicetak.'
          : `Kode belum valid: maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung. Persingkat nama atau lantainya.`}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnOff]}
          disabled={!canSave}
          onPress={() => onSubmit({ floor: floor.trim(), room_name: name.trim(), area_type: areaType })}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>{saving ? 'Menyimpan…' : 'Simpan ruangan'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6, marginTop: SPACE.sm + 2 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  codePreview: { fontSize: TYPE.lg, fontFamily: FONTS.bold, letterSpacing: 0.6, color: COLORS.text },
  codeBad: { color: COLORS.critical },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnOff: { backgroundColor: COLORS.surfaceAlt },
  saveText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
});
