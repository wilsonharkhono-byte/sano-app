import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { BoqItem } from '../../tools/types';

interface Props {
  visible: boolean;
  items: BoqItem[];
  initialSelectedIds: string[];
  onClose: () => void;
  onSave: (selectedIds: string[]) => void;
}

type Row =
  | { kind: 'header'; chapter: string }
  | { kind: 'item'; item: BoqItem };

export default function BoqPickerSheet({ visible, items, initialSelectedIds, onClose, onSave }: Props) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeChapters, setActiveChapters] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds));

  useEffect(() => {
    if (visible) {
      setSelected(new Set(initialSelectedIds));
      setSearch('');
      setActiveChapters(new Set());
    }
  }, [visible, initialSelectedIds]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [search]);

  const chapters = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items) {
      const ch = it.chapter ?? 'Tanpa Chapter';
      if (!seen.has(ch)) seen.set(ch, it.sort_order);
      else seen.set(ch, Math.min(seen.get(ch)!, it.sort_order));
    }
    return Array.from(seen.entries()).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }, [items]);

  const rows = useMemo<Row[]>(() => {
    const filtered = items.filter(it => {
      const ch = it.chapter ?? 'Tanpa Chapter';
      if (activeChapters.size > 0 && !activeChapters.has(ch)) return false;
      if (!debounced) return true;
      return (
        it.code.toLowerCase().includes(debounced) ||
        it.label.toLowerCase().includes(debounced)
      );
    });

    filtered.sort((a, b) => a.sort_order - b.sort_order);

    const out: Row[] = [];
    let currentChapter: string | null = null;
    for (const it of filtered) {
      const ch = it.chapter ?? 'Tanpa Chapter';
      if (ch !== currentChapter) {
        out.push({ kind: 'header', chapter: ch });
        currentChapter = ch;
      }
      out.push({ kind: 'item', item: it });
    }
    return out;
  }, [items, debounced, activeChapters]);

  const toggleChapter = (ch: string) => {
    setActiveChapters(prev => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pilih Item BoQ</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Cari kode atau nama item…"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, activeChapters.size === 0 && styles.chipActive]}
              onPress={() => setActiveChapters(new Set())}
            >
              <Text style={[styles.chipText, activeChapters.size === 0 && styles.chipTextActive]}>Semua</Text>
            </TouchableOpacity>
            {chapters.map(ch => {
              const active = activeChapters.has(ch);
              return (
                <TouchableOpacity
                  key={ch}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleChapter(ch)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{ch}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <FlatList
            data={rows}
            keyExtractor={(r, i) => r.kind === 'header' ? `h-${r.chapter}-${i}` : r.item.id}
            renderItem={({ item: row }) => {
              if (row.kind === 'header') {
                return <Text style={styles.chapterHeader}>{row.chapter}</Text>;
              }
              const it = row.item;
              const checked = selected.has(it.id);
              return (
                <TouchableOpacity style={styles.item} onPress={() => toggleItem(it.id)}>
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked && <Ionicons name="checkmark" size={14} color={COLORS.textInverse} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemCode}>{it.code}</Text>
                    <Text style={styles.itemLabel}>{it.label}</Text>
                    <Text style={styles.itemMeta}>{it.unit}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            style={styles.list}
          />

          <View style={styles.footer}>
            <Text style={styles.footerCount}>{selected.size} item dipilih</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={() => onSave(Array.from(selected))}>
              <Text style={styles.saveBtnText}>Simpan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { fontSize: TYPE.md, fontFamily: FONTS.bold },
  searchRow: { padding: SPACE.md, paddingBottom: SPACE.sm },
  search: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.sm, fontSize: TYPE.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: SPACE.md, paddingBottom: SPACE.sm },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: TYPE.xs, color: COLORS.text },
  chipTextActive: { color: COLORS.textInverse },
  list: { flex: 1 },
  chapterHeader: { paddingHorizontal: SPACE.md, paddingVertical: 6, fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', color: COLORS.textSec, backgroundColor: COLORS.bg },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  itemCode: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.semibold },
  itemLabel: { fontSize: TYPE.sm, color: COLORS.text },
  itemMeta: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.border },
  footerCount: { fontSize: TYPE.sm, color: COLORS.textSec },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
});
