import React, { useState, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import SelectSheet from '../components/SelectSheet';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { sanitizeText } from '../../tools/validation';
import { assembleClientReportDraft, issueClientReport, computeWeeklyProgressDelta, type ClientReportDraft } from '../../tools/clientReport';
import { exportClientReportPdf } from '../../tools/clientReportHtml';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

function isoNDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso(): string { return isoNDaysAgo(0); }

export default function ClientReportBuilderScreen({ onBack }: { onBack: () => void }) {
  const { project, profile, milestones, boqItems } = useProject();
  const { show: toast } = useToast();

  const [kind, setKind] = useState<'harian' | 'mingguan'>('mingguan');
  const [draft, setDraft] = useState<ClientReportDraft | null>(null);
  const [weeklyDelta, setWeeklyDelta] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const kindOptions = useMemo(() => ([
    { value: 'harian', label: 'Laporan Harian' },
    { value: 'mingguan', label: 'Laporan Mingguan' },
  ]), []);

  const generate = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const periodEnd = todayIso();
      const periodStart = kind === 'harian' ? periodEnd : isoNDaysAgo(6);
      const d = await assembleClientReportDraft({
        projectId: project.id,
        kind,
        periodStart,
        periodEnd,
        projectName: project.name,
        clientName: project.client_name ?? null,   // client_name is on the Project type (tools/types.ts:35)
        milestoneStatuses: milestones.map((m) => m.status),
      });
      setDraft(d);
      toast('Draf laporan dibuat — silakan tinjau & lengkapi', 'ok');
      if (kind === 'mingguan') {
        try {
          const delta = await computeWeeklyProgressDelta(
            project.id,
            boqItems.map((b) => ({ id: b.id, planned: b.planned })),
            periodStart,
            periodEnd,
          );
          setWeeklyDelta(delta);
        } catch {
          setWeeklyDelta(null);
        }
      } else {
        setWeeklyDelta(null);
      }
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuat draf', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const patch = (p: Partial<ClientReportDraft>) => setDraft((prev) => (prev ? { ...prev, ...p } : prev));

  const exportPdf = async () => {
    if (!draft) return;
    try {
      await exportClientReportPdf(draft);
    } catch (err: any) {
      toast(err.message ?? 'Gagal mencetak', 'critical');
    }
  };

  const issue = async () => {
    if (!draft || !project || !profile) return;
    setBusy(true);
    try {
      await issueClientReport(draft, project.id, profile.id);
      toast(`Laporan #${String(draft.reportNo).padStart(2, '0')} diterbitkan`, 'ok');
      onBack();
    } catch (err: any) {
      toast(err.message ?? 'Gagal menerbitkan', 'critical');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <Text style={styles.head}>Laporan Progres Klien (Blueprint)</Text>

        <Card title="Periode">
          <Text style={styles.label}>Jenis</Text>
          <SelectSheet value={kind} options={kindOptions} onChange={(v) => setKind(v as any)} title="Jenis laporan" />
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={generate}>
            <Text style={styles.btnText}>{busy ? 'Memproses...' : 'Buat Draf'}</Text>
          </TouchableOpacity>
        </Card>

        {draft && (
          <>
            <Card title="Lengkapi Naratif" subtitle="Isi field yang tidak bisa diambil otomatis.">
              <Text style={styles.label}>Sub-judul (mis. Finishing Interior)</Text>
              <TextInput style={styles.input} value={draft.subtitle} onChangeText={(v) => patch({ subtitle: v })} placeholder="Lingkup pekerjaan" />
              <Text style={styles.label}>Klien</Text>
              <TextInput style={styles.input} value={draft.clientName ?? ''} onChangeText={(v) => patch({ clientName: v })} placeholder="Nama klien" />
              <Text style={styles.label}>Cuaca</Text>
              <TextInput style={styles.input} value={draft.weather ?? ''} onChangeText={(v) => patch({ weather: v })} placeholder="Cerah" />
              <Text style={styles.label}>Status</Text>
              <TextInput style={styles.input} value={draft.statusLabel} onChangeText={(v) => patch({ statusLabel: v })} />
              {weeklyDelta !== null && (
                <Text style={styles.deltaHint}>
                  Progres minggu ini: {weeklyDelta >= 0 ? '+' : ''}{Math.round(weeklyDelta)}% · acuan status (tidak dicetak)
                </Text>
              )}
              <Text style={styles.label}>Rencana Periode Berikutnya</Text>
              <TextInput style={[styles.input, styles.textarea]} value={draft.nextPlan} onChangeText={(v) => patch({ nextPlan: v })} multiline placeholder="Rencana pekerjaan berikutnya..." />
            </Card>

            <Card title={`Update Lapangan (${draft.updates.length})`} subtitle="Hasil agregasi log harian. Edit/kurangi sesuai kebutuhan klien.">
              {draft.updates.map((u, i) => (
                <View key={i} style={styles.updRow}>
                  <Text style={styles.updDate}>{u.date}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.updArea}>{u.area}</Text>
                    <Text style={styles.updNote}>{u.note}</Text>
                  </View>
                  <TouchableOpacity onPress={() => patch({ updates: draft.updates.filter((_, idx) => idx !== i) })}>
                    <Ionicons name="close-circle-outline" size={18} color={COLORS.critical} />
                  </TouchableOpacity>
                </View>
              ))}
              {draft.updates.length === 0 && <Text style={styles.hint}>Belum ada update. Isi Log Harian dulu di tab Progres.</Text>}
            </Card>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={exportPdf}>
                <Ionicons name="print-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryText}>Cetak / PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={issue}>
                <Text style={styles.btnText}>Terbitkan & Simpan</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  head: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: SPACE.md },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center', marginTop: SPACE.md },
  btnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.base, paddingHorizontal: SPACE.base, marginTop: SPACE.md },
  secondaryText: { color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold },
  actions: { flexDirection: 'row', gap: SPACE.md - 2, alignItems: 'center' },
  updRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md - 2, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  updDate: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accent, width: 52 },
  updArea: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  updNote: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  deltaHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
});
