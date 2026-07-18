import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList, TextInput, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

export interface SelectOption {
  value: string;
  /** Small uppercase line above the label, e.g. a BoQ code or PO number. */
  code?: string;
  /** Main label — wraps to two lines so long names stay readable. */
  label: string;
  /** Right-aligned meta, e.g. "45%" or "120 m³". */
  meta?: string;
  /** Optional colour for the meta text. */
  metaColor?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Trigger placeholder when nothing is selected. */
  placeholder?: string;
  /** Modal heading. */
  title?: string;
  disabled?: boolean;
  /** Force the search box. Defaults to on when there are > 8 options. */
  searchable?: boolean;
  /** Shown inside the sheet when the (filtered) list is empty. */
  emptyText?: string;
  accessibilityLabel?: string;
}

/**
 * A tap-to-open selection field that replaces the native `Picker`. The native
 * Android picker renders a full-screen dialog that truncates every row to one
 * line — unusable for long Indonesian BoQ labels. This shows the code prominently,
 * wraps the label, supports search, and reads at a glance. Mirrors the project
 * picker in Header for a consistent feel.
 */
export default function SelectSheet({
  value, options, onChange, placeholder = '-- Pilih --', title = 'Pilih',
  disabled = false, searchable, emptyText = 'Tidak ada pilihan.', accessibilityLabel,
}: Props): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => options.find(o => o.value === value), [options, value]);
  const showSearch = searchable ?? options.length > 8;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.code?.toLowerCase().includes(q) ?? false));
  }, [options, query]);

  const close = () => { setOpen(false); setQuery(''); };
  const choose = (v: string) => { onChange(v); close(); };

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled }}
      >
        <View style={styles.triggerBody}>
          {selected ? (
            <>
              {selected.code ? <Text style={styles.triggerCode}>{selected.code}</Text> : null}
              <Text style={styles.triggerLabel} numberOfLines={2}>{selected.label}</Text>
            </>
          ) : (
            <Text style={styles.triggerPlaceholder} numberOfLines={1}>{placeholder}</Text>
          )}
        </View>
        <Ionicons name="chevron-down" size={18} color={disabled ? COLORS.textMuted : COLORS.textSec} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close} accessibilityViewIsModal>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close} accessibilityLabel="Tutup pilihan">
          <View
            style={[styles.sheet, { marginTop: insets.top + 56, marginBottom: insets.bottom + SPACE.base }]}
            // Stop taps inside the sheet from closing it.
            onStartShouldSetResponder={() => true}
          >
            <Text style={styles.sheetTitle}>{title}</Text>
            <Text style={styles.sheetCount}>{options.length} pilihan</Text>

            {showSearch && (
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={COLORS.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Cari..."
                  placeholderTextColor={COLORS.textMuted}
                  autoCorrect={false}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Hapus pencarian" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={o => o.value}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={14}
              ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <TouchableOpacity
                    style={[styles.item, active && styles.itemActive]}
                    onPress={() => choose(item.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={styles.itemBody}>
                      {item.code ? <Text style={styles.itemCode}>{item.code}</Text> : null}
                      <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{item.label}</Text>
                    </View>
                    {item.meta ? (
                      <Text style={[styles.itemMeta, item.metaColor ? { color: item.metaColor } : null]}>
                        {item.meta}
                      </Text>
                    ) : null}
                    {active && <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} style={{ marginLeft: SPACE.sm }} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Trigger — matches the form `input` look
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md - 1,
    paddingHorizontal: SPACE.md,
    minHeight: 50,
  },
  triggerDisabled: { backgroundColor: COLORS.surfaceAlt, borderColor: COLORS.borderSub },
  triggerBody: { flex: 1, gap: 1 },
  triggerCode: {
    fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  triggerLabel: { fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  triggerPlaceholder: { fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.textMuted },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(20,18,16,0.5)', justifyContent: 'flex-start' },
  sheet: {
    marginHorizontal: SPACE.base,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    padding: SPACE.base,
    maxHeight: '72%',
    shadowColor: '#141210', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
  sheetTitle: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text, letterSpacing: 0.2 },
  sheetCount: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2, marginBottom: SPACE.md },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingHorizontal: SPACE.md, marginBottom: SPACE.sm,
  },
  searchInput: { flex: 1, paddingVertical: SPACE.sm + 1, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },

  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACE.md, paddingHorizontal: SPACE.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  itemActive: { backgroundColor: COLORS.accentBg, borderRadius: RADIUS - 2 },
  itemBody: { flex: 1, gap: 2 },
  itemCode: {
    fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  itemLabel: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  itemLabelActive: { fontFamily: FONTS.bold },
  itemMeta: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.textSec },
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, padding: SPACE.md, textAlign: 'center' },
});
