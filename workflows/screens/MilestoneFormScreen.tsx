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

        {/* Depends-on picker added in Task 14 */}

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
});
