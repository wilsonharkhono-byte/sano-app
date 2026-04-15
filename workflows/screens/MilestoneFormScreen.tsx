import React, { useMemo, useState, useEffect } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import DateSelectField from '../components/DateSelectField';
import BoqPickerSheet from '../components/BoqPickerSheet';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { createMilestone, updateMilestone, deleteMilestone } from '../../tools/schedule';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { Milestone } from '../../tools/types';

interface PredecessorPickerProps {
  allMilestones: Milestone[];
  currentId: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
}

function PredecessorPicker({ allMilestones, currentId, selected, onChange }: PredecessorPickerProps) {
  const [search, setSearch] = useState('');

  // Build the set of ineligible ids: self + any descendant of self (to block cycles at selection time)
  const forbidden = useMemo(() => {
    const out = new Set<string>();
    if (!currentId) return out;
    out.add(currentId);
    // BFS downward: find anything that transitively depends on currentId
    const childrenOf = new Map<string, string[]>();
    for (const m of allMilestones) {
      for (const p of m.depends_on) {
        if (!childrenOf.has(p)) childrenOf.set(p, []);
        childrenOf.get(p)!.push(m.id);
      }
    }
    const queue = [currentId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const child of childrenOf.get(id) ?? []) {
        if (out.has(child)) continue;
        out.add(child);
        queue.push(child);
      }
    }
    return out;
  }, [allMilestones, currentId]);

  const candidates = useMemo(() => {
    const q = search.toLowerCase();
    return allMilestones
      .filter(m => !forbidden.has(m.id))
      .filter(m => !m.deleted_at)
      .filter(m => !q || m.label.toLowerCase().includes(q));
  }, [allMilestones, forbidden, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <>
      <TextInput
        style={stylesLocal.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Cari milestone…"
      />

      <View style={stylesLocal.selectedChipRow}>
        {selected.map(id => {
          const m = allMilestones.find(x => x.id === id);
          if (!m) return null;
          return (
            <TouchableOpacity key={id} style={stylesLocal.chipSelected} onPress={() => toggle(id)}>
              <Text style={stylesLocal.chipSelectedText}>{m.label}</Text>
              <Ionicons name="close" size={14} color={COLORS.textInverse} />
            </TouchableOpacity>
          );
        })}
        {selected.length === 0 && (
          <Text style={{ fontSize: TYPE.xs, color: COLORS.textSec }}>Belum ada predecessor</Text>
        )}
      </View>

      <View style={{ marginTop: SPACE.sm }}>
        {candidates.map(m => {
          const checked = selected.includes(m.id);
          return (
            <TouchableOpacity key={m.id} style={stylesLocal.candidateRow} onPress={() => toggle(m.id)}>
              <View style={[stylesLocal.candidateBox, checked && stylesLocal.candidateBoxOn]}>
                {checked && <Ionicons name="checkmark" size={12} color={COLORS.textInverse} />}
              </View>
              <Text style={stylesLocal.candidateText}>{m.label}</Text>
              <Text style={stylesLocal.candidateDate}>{new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
            </TouchableOpacity>
          );
        })}
        {candidates.length === 0 && (
          <Text style={{ fontSize: TYPE.xs, color: COLORS.textSec, paddingVertical: SPACE.sm }}>
            Tidak ada kandidat
          </Text>
        )}
      </View>
    </>
  );
}

interface Props {
  onBack: () => void;
  milestoneId?: string | null; // null/undefined = create mode
  initialDraft?: Partial<Milestone>; // optional AI-draft seed
}

export default function MilestoneFormScreen({ onBack, milestoneId, initialDraft }: Props) {
  const { project, profile, milestones, milestoneDrafts, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const role = profile?.role ?? 'supervisor';
  const canEdit = role === 'estimator' || role === 'admin' || role === 'principal';

  const allProjectMilestones = useMemo(() => [...milestones, ...milestoneDrafts], [milestones, milestoneDrafts]);

  const existing = useMemo(
    () => allProjectMilestones.find(m => m.id === milestoneId) ?? null,
    [milestoneId, allProjectMilestones],
  );

  const [label, setLabel] = useState(existing?.label ?? initialDraft?.label ?? '');
  const [plannedDate, setPlannedDate] = useState(
    existing?.planned_date ?? initialDraft?.planned_date ?? '',
  );
  const [boqIds, setBoqIds] = useState<string[]>(
    existing?.boq_ids ?? initialDraft?.boq_ids ?? [],
  );
  const [dependsOn, setDependsOn] = useState<string[]>(
    existing?.depends_on ?? initialDraft?.depends_on ?? [],
  );
  const [boqPickerOpen, setBoqPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    return (
      <View style={styles.flex}>
        <Header />
        <View style={{ padding: SPACE.lg }}>
          <Text>Anda tidak memiliki izin untuk menyunting milestone.</Text>
          <TouchableOpacity onPress={onBack} style={{ marginTop: SPACE.md }}>
            <Text style={{ color: COLORS.primary }}>Kembali</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleSave = async () => {
    if (!project) return;
    if (!label.trim()) { toast('Nama milestone wajib diisi', 'critical'); return; }
    if (!plannedDate) { toast('Tanggal target wajib diisi', 'critical'); return; }
    setSaving(true);
    try {
      if (existing) {
        const result = await updateMilestone(existing.id, {
          label: label.trim(),
          planned_date: plannedDate,
          boq_ids: boqIds,
          depends_on: dependsOn,
          author_status: existing.author_status === 'draft' ? 'draft' : 'confirmed',
        });
        if (!result.success) { toast(result.error, 'critical'); return; }
        toast('Milestone diperbarui', 'ok');
      } else {
        const result = await createMilestone({
          project_id: project.id,
          label: label.trim(),
          planned_date: plannedDate,
          boq_ids: boqIds,
          depends_on: dependsOn,
        });
        if (!result.success) { toast(result.error, 'critical'); return; }
        toast('Milestone dibuat', 'ok');
      }
      await refresh();
      onBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!existing) return;

    const dependents = allProjectMilestones.filter(
      m => m.id !== existing.id && m.depends_on.includes(existing.id),
    );
    const dependentsText = dependents.length > 0
      ? `\n\nMilestone berikut bergantung dan akan kehilangan dependensi:\n${dependents.map(d => `• ${d.label}`).join('\n')}`
      : '';

    Alert.alert(
      'Hapus milestone?',
      `"${existing.label}" akan dihapus.${dependentsText}`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteMilestone(existing.id);
            if (!result.success) { toast(result.error, 'critical'); return; }
            toast('Milestone dihapus', 'ok');
            await refresh();
            onBack();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{existing ? 'Edit Milestone' : 'Tambah Milestone'}</Text>

        <Card>
          <Text style={styles.label}>Nama Milestone <Text style={styles.req}>*</Text></Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="mis. Pondasi & Sloof"
            maxLength={120}
          />

          <Text style={styles.label}>Target Tanggal <Text style={styles.req}>*</Text></Text>
          <DateSelectField value={plannedDate} onChange={setPlannedDate} placeholder="Pilih tanggal" />
          {existing && (
            <Text style={styles.hint}>Untuk revisi tanggal setelah milestone dikomit, gunakan tombol Revisi di daftar.</Text>
          )}

          <Text style={styles.label}>Item BoQ</Text>
          <TouchableOpacity style={styles.pickerRow} onPress={() => setBoqPickerOpen(true)}>
            <Text style={styles.pickerText}>
              {boqIds.length === 0 ? 'Pilih item BoQ…' : `${boqIds.length} item BoQ dipilih`}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
          </TouchableOpacity>
          <Text style={styles.hint}>Kosongkan jika milestone tidak terhubung ke item BoQ.</Text>
        </Card>

        <Card title="Tergantung Pada">
          <Text style={styles.hint}>Milestone ini hanya mulai setelah predecessor selesai.</Text>
          <PredecessorPicker
            allMilestones={allProjectMilestones}
            currentId={existing?.id ?? null}
            selected={dependsOn}
            onChange={setDependsOn}
          />
        </Card>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Menyimpan…' : 'Simpan'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onBack}>
            <Text style={styles.cancelBtnText}>Batal</Text>
          </TouchableOpacity>
          {existing && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete()}
            >
              <Ionicons name="trash" size={14} color={COLORS.critical} />
              <Text style={styles.deleteBtnText}>Hapus</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <BoqPickerSheet
        visible={boqPickerOpen}
        items={boqItems}
        initialSelectedIds={boqIds}
        onClose={() => setBoqPickerOpen(false)}
        onSave={(ids) => { setBoqIds(ids); setBoqPickerOpen(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  title: { fontSize: TYPE.lg, fontFamily: FONTS.bold, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: 6, marginTop: SPACE.sm + 2 },
  req: { color: COLORS.critical },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 4 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, backgroundColor: COLORS.surface },
  pickerText: { fontSize: TYPE.sm, color: COLORS.text },
  actionRow: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.lg },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS, padding: SPACE.md, justifyContent: 'center' },
  deleteBtnText: { color: COLORS.critical, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
});

const stylesLocal = StyleSheet.create({
  search: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.sm, fontSize: TYPE.sm, marginTop: SPACE.sm },
  selectedChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACE.sm },
  chipSelected: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipSelectedText: { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.medium },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  candidateBox: { width: 16, height: 16, borderWidth: 2, borderColor: COLORS.border, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  candidateBoxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  candidateText: { flex: 1, fontSize: TYPE.sm, color: COLORS.text },
  candidateDate: { fontSize: TYPE.xs, color: COLORS.textSec },
});
