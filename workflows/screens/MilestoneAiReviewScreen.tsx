import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { updateMilestone, deleteMilestone } from '../../tools/schedule';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import type { Milestone } from '../../tools/types';

interface Props {
  onBack: () => void;
}

function confidenceColor(score: number | null): string {
  if (score == null) return COLORS.border;
  if (score >= 0.8) return COLORS.ok;
  if (score >= 0.5) return COLORS.info;
  return COLORS.warning;
}

export default function MilestoneAiReviewScreen({ onBack }: Props) {
  const { milestoneDrafts, milestones, refresh } = useProject();
  const { show: toast } = useToast();

  const [checked, setChecked] = useState<Set<string>>(() => {
    const out = new Set<string>();
    for (const d of milestoneDrafts) {
      if ((d.confidence_score ?? 0) >= 0.5) out.add(d.id);
    }
    return out;
  });

  const lowConfidenceCount = useMemo(
    () => milestoneDrafts.filter(d => (d.confidence_score ?? 0) < 0.5).length,
    [milestoneDrafts],
  );

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCommit = async () => {
    const ids = Array.from(checked);
    if (ids.length === 0) { toast('Pilih minimal satu milestone', 'critical'); return; }

    let ok = 0;
    for (const id of ids) {
      const result = await updateMilestone(id, { author_status: 'confirmed' });
      if (result.success) ok++;
    }
    toast(`${ok} milestone dikonfirmasi`, 'ok');
    await refresh();
    onBack();
  };

  const handleAbandonAll = () => {
    Alert.alert(
      'Buang semua draf?',
      `${milestoneDrafts.length} draf akan dihapus.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Buang',
          style: 'destructive',
          onPress: async () => {
            for (const d of milestoneDrafts) await deleteMilestone(d.id);
            toast('Semua draf dibuang', 'ok');
            await refresh();
            onBack();
          },
        },
      ],
    );
  };

  const handleDiscardOne = async (d: Milestone) => {
    const result = await deleteMilestone(d.id);
    if (!result.success) { toast(result.error, 'critical'); return; }
    toast('Draf dibuang', 'ok');
    await refresh();
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backRow} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Review Draf AI</Text>

        {lowConfidenceCount > 0 && (
          <Card borderColor={COLORS.warning}>
            <Text style={styles.hint}>
              ⚠️ {lowConfidenceCount} milestone dengan confidence rendah — perlu review ekstra
            </Text>
          </Card>
        )}

        {milestoneDrafts.length === 0 && (
          <Card>
            <Text style={styles.hint}>Tidak ada draf AI.</Text>
          </Card>
        )}

        {milestoneDrafts.map(d => {
          const isChecked = checked.has(d.id);
          const depLabels = d.depends_on
            .map(depId => [...milestoneDrafts, ...milestones].find(m => m.id === depId)?.label)
            .filter(Boolean) as string[];
          return (
            <Card key={d.id} borderColor={confidenceColor(d.confidence_score)}>
              <TouchableOpacity style={styles.cardHead} onPress={() => toggle(d.id)}>
                <View style={[styles.checkbox, isChecked && styles.checkboxOn]}>
                  {isChecked && <Ionicons name="checkmark" size={14} color={COLORS.textInverse} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msLabel}>{d.label}</Text>
                  <Text style={styles.hint}>
                    Target: {new Date(d.planned_date).toLocaleDateString('id-ID')}
                    {' · '}
                    {d.boq_ids.length} item BoQ
                  </Text>
                  {depLabels.length > 0 && (
                    <Text style={styles.hint}>Tergantung pada: {depLabels.join(', ')}</Text>
                  )}
                  <Text style={[styles.hint, { fontStyle: 'italic', marginTop: 4 }]}>
                    {d.ai_explanation ?? ''}
                  </Text>
                  <Text style={styles.hint}>
                    Confidence: {d.confidence_score != null ? `${Math.round(d.confidence_score * 100)}%` : '—'}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.discardBtn} onPress={() => handleDiscardOne(d)}>
                <Ionicons name="trash-outline" size={12} color={COLORS.critical} />
                <Text style={styles.discardText}>Buang</Text>
              </TouchableOpacity>
            </Card>
          );
        })}

        {milestoneDrafts.length > 0 && (
          <View style={{ gap: SPACE.sm, marginTop: SPACE.md }}>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCommit}>
              <Text style={styles.primaryBtnText}>Buat {checked.size} Milestone</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleAbandonAll}>
              <Text style={styles.secondaryBtnText}>Batal — Buang Semua Draf</Text>
            </TouchableOpacity>
          </View>
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
  title: { fontSize: TYPE.lg, fontFamily: FONTS.bold, marginBottom: SPACE.sm },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  msLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold },
  discardBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: SPACE.sm, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS, paddingHorizontal: 8, paddingVertical: 4 },
  discardText: { color: COLORS.critical, fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  primaryBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  secondaryBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.textSec, fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
});
