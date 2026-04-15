import React, { useState, useRef } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

interface Props {
  onBack: () => void;
}

type ShiftMode = '1_shift' | '2_shift' | 'harian';

const PROJECT_TYPES = [
  'Rumah Tinggal',
  'Ruko',
  'Gedung Bertingkat',
  'Renovasi',
  'Lainnya',
];

const PROGRESS_STAGES = [
  'Mencocokkan dengan proyek serupa…',
  'Menganalisis struktur BoQ…',
  'Menyusun urutan milestone…',
];

export default function MilestoneAiDraftScreen({ onBack }: Props) {
  const { project, profile, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  const [projectType, setProjectType] = useState<string>('Rumah Tinggal');
  const [duration, setDuration] = useState('6');
  const [mandorCount, setMandorCount] = useState('3');
  const [shiftMode, setShiftMode] = useState<ShiftMode>('1_shift');
  const [siteNotes, setSiteNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const lastClickAt = useRef(0);

  const isValid =
    projectType.length > 0 &&
    /^\d+$/.test(duration) && parseInt(duration, 10) > 0 &&
    /^\d+$/.test(mandorCount) && parseInt(mandorCount, 10) > 0;

  const handleGenerate = async () => {
    if (!project || !profile) return;
    if (boqItems.length === 0) { toast('Baseline belum dipublikasi', 'critical'); return; }
    if (!isValid) { toast('Isi semua parameter wajib', 'critical'); return; }

    // Client-side debounce (spec §6)
    const now = Date.now();
    if (now - lastClickAt.current < 30_000) {
      toast('Tunggu sebentar sebelum mencoba lagi', 'warning');
      return;
    }
    lastClickAt.current = now;

    setSubmitting(true);
    setStageIdx(0);
    const stageTimer = setInterval(() => {
      setStageIdx(i => (i < PROGRESS_STAGES.length - 1 ? i + 1 : i));
    }, 2500);

    try {
      const { data, error } = await supabase.functions.invoke('ai-draft-milestones', {
        body: {
          project_id: project.id,
          user_id: profile.id,
          parameters: {
            project_type: projectType,
            duration_months: parseInt(duration, 10),
            mandor_count: parseInt(mandorCount, 10),
            shift_mode: shiftMode,
            site_notes: siteNotes.trim() || undefined,
          },
        },
      });

      clearInterval(stageTimer);
      if (error || !data || data.success !== true) {
        toast((data && data.error) || error?.message || 'AI draft gagal', 'critical');
        return;
      }
      toast(`${data.summary?.committed ?? 0} draf dibuat`, 'ok');
      await refresh();
      onBack();
    } catch (err: any) {
      clearInterval(stageTimer);
      toast(err.message ?? 'Gagal memanggil AI', 'critical');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={onBack} disabled={submitting}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Saran Jadwal AI</Text>
        <Text style={styles.hint}>AI akan membaca BoQ yang dipublikasi dan menyarankan milestone awal untuk direview.</Text>

        <Card>
          <Text style={styles.label}>Jenis Proyek <Text style={styles.req}>*</Text></Text>
          <View style={styles.pillRow}>
            {PROJECT_TYPES.map(t => {
              const active = t === projectType;
              return (
                <TouchableOpacity key={t} style={[styles.pill, active && styles.pillActive]} onPress={() => setProjectType(t)}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Durasi Target Proyek (bulan) <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="numeric" />

          <Text style={styles.label}>Jumlah Mandor Aktif <Text style={styles.req}>*</Text></Text>
          <TextInput style={styles.input} value={mandorCount} onChangeText={setMandorCount} keyboardType="numeric" />

          <Text style={styles.label}>Shift Kerja <Text style={styles.req}>*</Text></Text>
          <View style={styles.pillRow}>
            {([
              ['1_shift', '1 Shift'],
              ['2_shift', '2 Shift'],
              ['harian', 'Harian/Borongan'],
            ] as Array<[ShiftMode, string]>).map(([key, label]) => {
              const active = key === shiftMode;
              return (
                <TouchableOpacity key={key} style={[styles.pill, active && styles.pillActive]} onPress={() => setShiftMode(key)}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Catatan Kondisi Site</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={siteNotes}
            onChangeText={setSiteNotes}
            multiline
            placeholder="mis. akses terbatas, tanah lembek"
          />
        </Card>

        <Card>
          <Text style={styles.hint}>
            AI akan membaca <Text style={{ fontFamily: FONTS.semibold }}>{boqItems.length} item BoQ</Text> dari baseline yang dipublikasi.
          </Text>
        </Card>

        {submitting ? (
          <Card borderColor={COLORS.primary}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.hint}>{PROGRESS_STAGES[stageIdx]}</Text>
            </View>
          </Card>
        ) : (
          <TouchableOpacity style={[styles.primaryBtn, !isValid && { opacity: 0.5 }]} onPress={handleGenerate} disabled={!isValid}>
            <Ionicons name="sparkles" size={16} color={COLORS.textInverse} />
            <Text style={styles.primaryBtnText}>Buat Draf Jadwal →</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  title: { fontSize: TYPE.lg, fontFamily: FONTS.bold },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 4 },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginTop: SPACE.sm + 2, marginBottom: 6 },
  req: { color: COLORS.critical },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  pillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: TYPE.xs, color: COLORS.text },
  pillTextActive: { color: COLORS.textInverse, fontFamily: FONTS.semibold },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, marginTop: SPACE.md },
  primaryBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
});
