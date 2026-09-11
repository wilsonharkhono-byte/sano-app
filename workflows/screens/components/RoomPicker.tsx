import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AREA_TYPE_LABELS } from '../../../tools/constants';
import type { Room } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

interface Props {
  rooms: Room[];
  onSelect: (room: Room) => void;
  /** Shown above the list - why the picker is on screen. */
  note?: string;
}

/** The fallback for a missing, damaged or unprinted label (spec §5.1). */
export default function RoomPicker({ rooms, onSelect, note }: Props) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rooms;
    return rooms.filter((r) =>
      r.room_name.toLowerCase().includes(needle) ||
      (r.floor ?? '').toLowerCase().includes(needle) ||
      r.room_code.toLowerCase().includes(needle),
    );
  }, [rooms, q]);

  return (
    <View style={styles.wrap}>
      {!!note && <Text style={styles.note}>{note}</Text>}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.search} value={q} onChangeText={setQ}
          placeholder="Cari nama ruangan atau lantai" placeholderTextColor={COLORS.textMuted}
          accessibilityLabel="Cari ruangan"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>Tidak ada ruangan yang cocok.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onSelect(item)} accessibilityRole="button">
            <View style={styles.rowMeta}>
              <Text style={styles.rowName} numberOfLines={1}>{item.room_name}</Text>
              <Text style={styles.rowSub}>
                {(item.floor || 'Tanpa lantai')} · {AREA_TYPE_LABELS[item.area_type]} · {item.room_code}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  note: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.sm, lineHeight: 18 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingHorizontal: SPACE.md, marginBottom: SPACE.sm,
  },
  search: { flex: 1, paddingVertical: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  rowMeta: { flex: 1 },
  rowName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  rowSub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.lg },
});
