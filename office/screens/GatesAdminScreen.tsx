import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useToast } from '../../workflows/components/Toast';
import { listGateRefs, listGateStepRefs, updateGateRef, updateGateStepRef, stepChipLabel } from '../../tools/gateRefs';
import type { GateRef, GateStepRef } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../workflows/theme';

interface Props { onBack: () => void }

/**
 * Gates are data, not code (spec §2 decision 3). The office edits the label a
 * supervisor reads and the description the release-2 prompt reads. The CODE is
 * shown read-only: it is the foreign key events reference, and migration 096
 * refuses to move or delete it.
 */
export default function GatesAdminScreen({ onBack }: Props) {
  const { show: toast } = useToast();
  const [gates, setGates] = useState<GateRef[]>([]);
  const [steps, setSteps] = useState<GateStepRef[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ short_label: string; name_id: string; description: string; sort_order: string }>({
    short_label: '', name_id: '', description: '', sort_order: '0',
  });

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([listGateRefs(), listGateStepRefs()]);
    setGates(g); setSteps(s);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (g: GateRef) => {
    setEditing(g.code);
    setDraft({
      short_label: g.short_label, name_id: g.name_id,
      description: g.description ?? '', sort_order: String(g.sort_order),
    });
  };

  const save = async (code: string) => {
    const order = Number(draft.sort_order);
    if (!draft.short_label.trim() || !draft.name_id.trim()) {
      Alert.alert('Belum lengkap', 'Nama dan label singkat wajib diisi.');
      return;
    }
    if (!Number.isFinite(order)) {
      Alert.alert('Urutan tidak valid', 'Urutan harus berupa angka.');
      return;
    }
    const { error } = await updateGateRef(code, {
      short_label: draft.short_label.trim(),
      name_id: draft.name_id.trim(),
      description: draft.description.trim() || null,
      sort_order: order,
    });
    if (error) { Alert.alert('Gagal menyimpan', error); return; }
    setEditing(null);
    toast(`Gerbang ${code} diperbarui.`, 'ok');
    await load();
  };

  const toggleActive = async (g: GateRef) => {
    const { error } = await updateGateRef(g.code, { active: !g.active });
    if (error) Alert.alert('Gagal', error); else await load();
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={styles.backText}>Kelola ruangan</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHead}>Kelola gerbang</Text>
        <Text style={styles.hint}>
          Kode gerbang (A sampai H) tetap selamanya - kejadian lapangan menunjuk ke kode itu.
          Nama, label dan penjelasannya boleh diubah; gerbang yang tidak dipakai dinonaktifkan, bukan dihapus.
        </Text>

        {gates.map((g) => {
          const gateSteps = steps.filter((s) => s.gate_code === g.code);
          return (
            <Card key={g.code} title={`${g.code} · ${g.short_label}`} borderColor={g.active ? COLORS.accent : COLORS.textMuted}>
              {editing === g.code ? (
                <>
                  <Text style={styles.label}>Nama lengkap</Text>
                  <TextInput style={styles.input} value={draft.name_id} onChangeText={(v) => setDraft({ ...draft, name_id: v })} />
                  <Text style={styles.label}>Label singkat (chip)</Text>
                  <TextInput style={styles.input} value={draft.short_label} onChangeText={(v) => setDraft({ ...draft, short_label: v })} />
                  <Text style={styles.label}>Penjelasan</Text>
                  <TextInput
                    style={[styles.input, styles.inputMulti]} multiline numberOfLines={3} textAlignVertical="top"
                    value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })}
                  />
                  <Text style={styles.hint}>Penjelasan ini dibaca AI saat memilih gerbang untuk sebuah kejadian.</Text>
                  <Text style={styles.label}>Urutan</Text>
                  <TextInput
                    style={styles.input} keyboardType="number-pad"
                    value={draft.sort_order} onChangeText={(v) => setDraft({ ...draft, sort_order: v })}
                  />
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                      <Text style={styles.cancelText}>Batal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveBtn} onPress={() => void save(g.code)}>
                      <Text style={styles.saveText}>Simpan</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.gateName}>{g.name_id}</Text>
                  {!!g.description && <Text style={styles.gateDesc}>{g.description}</Text>}
                  <Text style={styles.codeLine}>Kode: {g.code} (tetap) · Urutan: {g.sort_order}</Text>

                  {gateSteps.length > 0 && (
                    <View style={styles.stepBox}>
                      <Text style={styles.subHead}>Langkah</Text>
                      {gateSteps.map((s) => (
                        <View key={s.code} style={styles.stepRow}>
                          <Text style={styles.stepLabel} numberOfLines={1}>{stepChipLabel(s, g)}</Text>
                          <Switch
                            value={s.active}
                            onValueChange={async () => {
                              const { error } = await updateGateStepRef(s.code, { active: !s.active });
                              if (error) Alert.alert('Gagal', error); else await load();
                            }}
                          />
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => void toggleActive(g)}>
                      <Text style={styles.cancelText}>{g.active ? 'Nonaktifkan' : 'Aktifkan'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveBtn} onPress={() => startEdit(g)}>
                      <Text style={styles.saveText}>Ubah</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Card>
          );
        })}

        {gates.length === 0 && (
          <Card>
            <Text style={styles.empty}>
              Belum ada data gerbang. Pastikan migrasi 096 sudah dijalankan di Supabase.
            </Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.xs,
  },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginBottom: SPACE.md },
  gateName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  gateDesc: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 18 },
  codeLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6, marginTop: SPACE.sm + 2 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  inputMulti: { minHeight: 76 },
  subHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.4, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.xs,
  },
  stepBox: { marginTop: SPACE.md, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 2 },
  stepLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.md },
});
