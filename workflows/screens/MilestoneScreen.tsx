import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import Badge from '../components/Badge';
import DateSelectField from '../components/DateSelectField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { reviseMilestone, syncMilestoneStatuses, computeProjectHealth, deleteMilestone, topologicalSort, type ProjectHealthSummary } from '../../tools/schedule';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, FLAG_COLORS } from '../theme';
import type { Milestone, MilestoneStatus } from '../../tools/types';

const STATUS_FLAG: Record<MilestoneStatus, string> = {
  ON_TRACK: 'OK',
  AHEAD: 'OK',
  AT_RISK: 'WARNING',
  DELAYED: 'CRITICAL',
  COMPLETE: 'INFO',
};

const HEALTH_COLORS = { GREEN: COLORS.ok, AT_RISK: COLORS.warning, RED: COLORS.critical };

export function MilestonePanel({
  onBack,
  embedded = false,
  onOpenForm,
  onOpenAiDraft,
  onOpenAiReview,
}: {
  onBack?: () => void;
  embedded?: boolean;
  onOpenForm?: (milestoneId: string | null) => void;
  onOpenAiDraft?: () => void;
  onOpenAiReview?: () => void;
}) {
  const { project, profile, milestones, milestoneDrafts, boqItems, refresh } = useProject();
  const { show: toast } = useToast();

  // Baseline is considered published once BoQ items exist for the project.
  // BaselineScreen tracks publish state on the import session level, but project-level
  // proxy is whether published BoQ rows exist (publish writes to boq_items).
  const baselinePublished = boqItems.length > 0;

  const sortedMilestones = useMemo(() => topologicalSort(milestones), [milestones]);

  const [health, setHealth] = useState<ProjectHealthSummary | null>(null);
  const [revising, setRevising] = useState<string | null>(null); // milestone id being revised
  const [newDate, setNewDate] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [syncing, setSyncing] = useState(false);

  const role = profile?.role ?? 'supervisor';
  const canRevise = role === 'estimator' || role === 'admin' || role === 'principal';

  const loadHealth = useCallback(async () => {
    if (!project) return;
    try {
      const h = await computeProjectHealth(project.id);
      setHealth(h);
    } catch (err: any) {
      console.warn('Health compute failed:', err.message);
    }
  }, [project]);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const handleSync = async () => {
    if (!project) return;
    setSyncing(true);
    try {
      const count = await syncMilestoneStatuses(project.id);
      toast(`${count} milestone diperbarui`, 'ok');
      refresh();
      loadHealth();
    } catch (err: any) {
      toast(err.message, 'critical');
    } finally {
      setSyncing(false);
    }
  };

  const handleRevise = async () => {
    if (!revising || !project || !profile) return;
    if (!newDate.trim()) { toast('Masukkan tanggal baru', 'critical'); return; }
    if (!revisionReason.trim()) { toast('Masukkan alasan revisi', 'critical'); return; }

    const result = await reviseMilestone(revising, newDate.trim(), revisionReason.trim(), profile.id, project.id);
    if (!result.success) {
      toast(result.error ?? 'Revisi gagal', 'critical');
      return;
    }
    toast('Milestone direvisi', 'ok');
    setRevising(null);
    setNewDate('');
    setRevisionReason('');
    refresh();
    loadHealth();
  };

  const handleDeleteCard = (m: Milestone) => {
    const dependents = milestones.filter(other => other.id !== m.id && other.depends_on.includes(m.id));
    const dependentsText = dependents.length > 0
      ? `\n\nMilestone berikut bergantung:\n${dependents.map(d => `• ${d.label}`).join('\n')}`
      : '';

    Alert.alert(
      'Hapus milestone?',
      `"${m.label}" akan dihapus.${dependentsText}`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            const result = await deleteMilestone(m.id);
            if (!result.success) { toast(result.error ?? 'Gagal menghapus milestone', 'critical'); return; }
            toast('Milestone dihapus', 'ok');
            refresh();
            loadHealth();
          },
        },
      ],
    );
  };

  const handleAbandonAllDrafts = () => {
    Alert.alert(
      'Buang semua draf AI?',
      `${milestoneDrafts.length} draf akan dihapus.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Buang',
          style: 'destructive',
          onPress: async () => {
            for (const d of milestoneDrafts) {
              await deleteMilestone(d.id);
            }
            toast('Semua draf AI dihapus', 'ok');
            refresh();
          },
        },
      ],
    );
  };

  const daysLabel = (m: Milestone): string => {
    const ref = m.revised_date ?? m.planned_date;
    const days = Math.round((new Date(ref).getTime() - Date.now()) / 86400000);
    if (days < 0) return `${Math.abs(days)} hari terlewat`;
    if (days === 0) return 'Hari ini';
    return `${days} hari lagi`;
  };

  return (
    <>
      {!embedded && onBack ? (
        <TouchableOpacity style={styles.backRow} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali ke Laporan</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.sectionHead}>Jadwal & Milestone — {project?.name}</Text>

      {/* Project Health */}
      {health && (
        <Card
          title="Kesehatan Proyek"
          borderColor={HEALTH_COLORS[health.health]}
        >
          <View style={styles.healthRow}>
            <View style={[styles.healthBadge, { backgroundColor: HEALTH_COLORS[health.health] }]}>
              <Text style={styles.healthLabel}>{health.health}</Text>
            </View>
            <Text style={styles.healthProgress}>{health.overall_progress}% selesai</Text>
          </View>
          <View style={styles.healthGrid}>
            <View style={styles.healthStat}>
              <Text style={[styles.healthVal, { color: COLORS.ok }]}>{health.on_track + health.ahead}</Text>
              <Text style={styles.healthStatLabel}>On Track</Text>
            </View>
            <View style={styles.healthStat}>
              <Text style={[styles.healthVal, { color: COLORS.warning }]}>{health.at_risk}</Text>
              <Text style={styles.healthStatLabel}>At Risk</Text>
            </View>
            <View style={styles.healthStat}>
              <Text style={[styles.healthVal, { color: COLORS.critical }]}>{health.delayed}</Text>
              <Text style={styles.healthStatLabel}>Delayed</Text>
            </View>
            <View style={styles.healthStat}>
              <Text style={[styles.healthVal, { color: COLORS.info }]}>{health.complete}</Text>
              <Text style={styles.healthStatLabel}>Complete</Text>
            </View>
          </View>
        </Card>
      )}

      {/* Sync button */}
      {canRevise && (
        <TouchableOpacity style={styles.syncBtn} onPress={handleSync} disabled={syncing}>
          <Ionicons name="sync" size={16} color="#fff" />
          <Text style={styles.syncBtnText}>{syncing ? 'Menyinkronkan...' : 'Sinkronisasi Status dari Progres'}</Text>
        </TouchableOpacity>
      )}

      {/* Revision form */}
      {revising && (
        <Card title="Revisi Milestone" borderColor={COLORS.warning}>
          <Text style={styles.label}>Tanggal Baru <Text style={styles.req}>*</Text></Text>
          <DateSelectField
            value={newDate}
            onChange={setNewDate}
            placeholder="Pilih tanggal revisi"
          />
          <Text style={styles.label}>Alasan Revisi <Text style={styles.req}>*</Text></Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={revisionReason}
            onChangeText={setRevisionReason}
            multiline
            placeholder="Alasan perubahan tanggal..."
          />
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleRevise}>
              <Text style={styles.saveBtnText}>Simpan Revisi</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setRevising(null); setNewDate(''); setRevisionReason(''); }}>
              <Text style={styles.cancelBtnText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* Milestone list */}
      {canRevise && baselinePublished && (
        <View style={styles.entryRow}>
          <TouchableOpacity style={styles.entryBtn} onPress={() => onOpenForm?.(null)}>
            <Ionicons name="add" size={16} color={COLORS.textInverse} />
            <Text style={styles.entryBtnText}>Tambah Milestone</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.entryBtn, styles.entryBtnSecondary]} onPress={() => onOpenAiDraft?.()}>
            <Ionicons name="sparkles" size={16} color={COLORS.primary} />
            <Text style={[styles.entryBtnText, styles.entryBtnTextSecondary]}>Saran Jadwal AI</Text>
          </TouchableOpacity>
        </View>
      )}

      {canRevise && milestoneDrafts.length > 0 && (
        <Card borderColor={COLORS.warning}>
          <Text style={styles.msLabel}>
            Ada {milestoneDrafts.length} draf AI belum dikonfirmasi
          </Text>
          <View style={{ flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm }}>
            <TouchableOpacity style={styles.entryBtn} onPress={() => onOpenAiReview?.()}>
              <Text style={styles.entryBtnText}>Lanjutkan Review</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.entryBtn, styles.entryBtnSecondary]}
              onPress={() => handleAbandonAllDrafts()}
            >
              <Text style={[styles.entryBtnText, styles.entryBtnTextSecondary]}>Buang Semua</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      <Text style={styles.sectionHead}>Daftar Milestone</Text>

      {!baselinePublished && (
        <Card><Text style={styles.hint}>Publikasikan baseline dulu untuk mengaktifkan jadwal.</Text></Card>
      )}

      {baselinePublished && milestones.length === 0 && (
        <Card>
          <Text style={[styles.msLabel, { marginBottom: 6 }]}>Belum ada jadwal</Text>
          <Text style={styles.hint}>
            Mulai dengan menambah milestone manual, atau biarkan AI menyusun draf awal dari BoQ yang sudah dipublikasi.
          </Text>
        </Card>
      )}
      {sortedMilestones.map(m => (
        <Card
          key={m.id}
          borderColor={FLAG_COLORS[STATUS_FLAG[m.status] ?? 'INFO']}
        >
          <View style={styles.msRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={styles.msLabel}>{m.label}</Text>
                {m.proposed_by === 'ai' && (
                  <TouchableOpacity
                    style={styles.aiBadge}
                    onPress={() => {
                      Alert.alert('Penjelasan AI', m.ai_explanation ?? 'Tidak ada penjelasan.');
                    }}
                  >
                    <Ionicons name="sparkles" size={10} color={COLORS.info} />
                    <Text style={styles.aiBadgeText}>
                      AI {m.confidence_score != null ? `${Math.round(m.confidence_score * 100)}%` : ''}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.hint}>
                Rencana: {new Date(m.planned_date).toLocaleDateString('id-ID')}
                {m.revised_date ? ` → Revisi: ${new Date(m.revised_date).toLocaleDateString('id-ID')}` : ''}
              </Text>
              <Text style={[styles.hint, { fontWeight: '600' }]}>{daysLabel(m)}</Text>
              {m.revision_reason && (
                <Text style={[styles.hint, { fontStyle: 'italic' }]}>Alasan revisi: {m.revision_reason}</Text>
              )}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Badge flag={STATUS_FLAG[m.status] ?? 'INFO'} label={m.status.replace('_', ' ')} />
              {canRevise && !revising && (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <TouchableOpacity style={styles.actBtn} onPress={() => onOpenForm?.(m.id)}>
                    <Ionicons name="create-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.actBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actBtn}
                    onPress={() => {
                      setRevising(m.id);
                      setNewDate(m.revised_date ?? m.planned_date);
                      setRevisionReason('');
                    }}
                  >
                    <Ionicons name="time-outline" size={12} color={COLORS.warning} />
                    <Text style={[styles.actBtnText, { color: COLORS.warning }]}>Revisi</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actBtn}
                    onPress={() => handleDeleteCard(m)}
                  >
                    <Ionicons name="trash-outline" size={12} color={COLORS.critical} />
                    <Text style={[styles.actBtnText, { color: COLORS.critical }]}>Hapus</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Linked BoQ progress summary */}
          {m.boq_ids.length > 0 && (
            <Text style={[styles.hint, { marginTop: 6 }]}>
              {m.boq_ids.length} item BoQ terhubung
            </Text>
          )}

          {m.depends_on.length > 0 && (
            <View style={styles.depsRow}>
              <Text style={styles.hint}>Tergantung pada:</Text>
              {m.depends_on.map(depId => {
                const dep = milestones.find(x => x.id === depId);
                return (
                  <View key={depId} style={styles.depChip}>
                    <Text style={styles.depChipText}>{dep?.label ?? '[dihapus]'}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      ))}
    </>
  );
}

export default function MilestoneScreen({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <MilestonePanel onBack={onBack} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:           { flex: 1, backgroundColor: COLORS.bg },
  scroll:         { flex: 1 },
  content:        { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText:       { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  sectionHead:    { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm + 2, marginTop: SPACE.md },
  hint:           { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 3 },
  healthRow:      { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md },
  healthBadge:    { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS },
  healthLabel:    { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, letterSpacing: 1 },
  healthProgress: { fontSize: 20, fontFamily: FONTS.bold },
  healthGrid:     { flexDirection: 'row', gap: SPACE.sm },
  healthStat:     { flex: 1, alignItems: 'center', backgroundColor: COLORS.bg, borderRadius: RADIUS, padding: 10 },
  healthVal:      { fontSize: 22, fontFamily: FONTS.bold },
  healthStatLabel:{ fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.semibold, textTransform: 'uppercase', textAlign: 'center' },
  syncBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: 14, marginBottom: SPACE.md },
  syncBtnText:    { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  msRow:          { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  msLabel:        { fontSize: TYPE.sm, fontFamily: FONTS.bold },
  reviseBtn:      { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm },
  reviseBtnText:  { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  label:          { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: 6, marginTop: SPACE.sm + 2 },
  req:            { color: COLORS.critical },
  input:          { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, color: COLORS.text },
  textarea:       { minHeight: 60, textAlignVertical: 'top' },
  actionRow:      { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  saveBtn:        { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnText:    { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  cancelBtn:      { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelBtnText:  { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
  entryRow:       { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  entryBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.sm + 2 },
  entryBtnSecondary: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary },
  entryBtnText:   { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  entryBtnTextSecondary: { color: COLORS.primary },
  depsRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginTop: 4 },
  depChip:        { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  depChipText:    { fontSize: TYPE.xs, color: COLORS.text },
  aiBadge:        { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.info, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  aiBadgeText:    { fontSize: 10, color: COLORS.info, fontFamily: FONTS.semibold },
  actBtn:         { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingHorizontal: 6, paddingVertical: 3 },
  actBtnText:     { fontSize: 10, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.primary },
});
