/**
 * Catatan Perubahan — unified site change capture & review
 *
 * Supervisor: quick capture (location, photo, type, impact)
 * Estimator/Admin: review with cost + decision
 * Principal: auto-sees all 'berat' items
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import Header from '../components/Header';
import Card from '../components/Card';
import StatTile from '../components/StatTile';
import Badge from '../components/Badge';
import PhotoGalleryField from '../components/PhotoGalleryField';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { pickAndUploadPhoto } from '../../tools/storage';
import { sanitizeText } from '../../tools/validation';
import { supabase } from '../../tools/supabase';
import {
  getSiteChanges, getSiteChangeSummary, createSiteChange, reviewSiteChange, resolveSiteChange,
  type SiteChange, type SiteChangeSummary, type ChangeType, type Impact, type Decision, type CostBearer,
  CHANGE_TYPE_LABELS, IMPACT_LABELS, IMPACT_COLORS, DECISION_LABELS, COST_BEARER_LABELS,
} from '../../tools/siteChanges';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

// ─── Constants ─────────────────────────────────────────────────────────────

const CHANGE_TYPES: { key: ChangeType; icon: string; hint: string }[] = [
  { key: 'permintaan_owner', icon: 'person', hint: 'Perubahan atas permintaan owner atau klien' },
  { key: 'kondisi_lapangan', icon: 'construct', hint: 'Kondisi tak terduga di lapangan yang mempengaruhi pekerjaan' },
  { key: 'rework', icon: 'refresh', hint: 'Pekerjaan yang harus diulang atau diperbaiki' },
  { key: 'revisi_desain', icon: 'document-text', hint: 'Perubahan mengikuti revisi gambar atau spesifikasi' },
  { key: 'catatan_mutu', icon: 'checkbox', hint: 'Observasi kualitas pekerjaan yang perlu ditindaklanjuti' },
];

const IMPACTS: Impact[] = ['ringan', 'sedang', 'berat'];
const COST_BEARERS: CostBearer[] = ['mandor', 'owner', 'kontraktor'];

const DECISION_COLORS: Record<Decision, string> = {
  pending: COLORS.textSec,
  disetujui: '#1565C0',
  ditolak: COLORS.critical,
  selesai: COLORS.ok,
};

type ViewMode = 'list' | 'form';
type FilterType = 'all' | ChangeType;
type FilterDecision = 'all' | Decision;

// ─── Main Screen ───────────────────────────────────────────────────────────

export default function CatatanPerubahanScreen({ onBack }: { onBack: () => void }) {
  const { project, profile, boqItems, refresh } = useProject();
  const { show: toast } = useToast();
  const role = profile?.role ?? 'supervisor';
  const isReviewer = ['estimator', 'admin', 'principal'].includes(role);

  const [view, setView] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Data
  const [changes, setChanges] = useState<SiteChange[]>([]);
  const [summary, setSummary] = useState<SiteChangeSummary | null>(null);
  const [mandorContracts, setMandorContracts] = useState<{ id: string; mandor_name: string }[]>([]);

  // Filters
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterDecision, setFilterDecision] = useState<FilterDecision>('all');

  // Form fields (supervisor capture)
  const [formLocation, setFormLocation] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState<ChangeType>('kondisi_lapangan');
  const [formImpact, setFormImpact] = useState<Impact>('ringan');
  const [formIsUrgent, setFormIsUrgent] = useState(false);
  const [formBoqItemId, setFormBoqItemId] = useState('');
  const [formContractId, setFormContractId] = useState('');
  const [formPhotos, setFormPhotos] = useState<string[]>([]);

  // Review modal
  const [reviewItem, setReviewItem] = useState<SiteChange | null>(null);
  const [reviewDecision, setReviewDecision] = useState<Decision>('pending');
  const [reviewCost, setReviewCost] = useState('');
  const [reviewCostBearer, setReviewCostBearer] = useState<CostBearer | ''>('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewNeedsOwner, setReviewNeedsOwner] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    const [changeList, changeSummary] = await Promise.all([
      getSiteChanges(project.id),
      getSiteChangeSummary(project.id),
    ]);
    setChanges(changeList);
    setSummary(changeSummary);
    setLoading(false);
  }, [project]);

  const loadContracts = useCallback(async () => {
    if (!project) return;
    const { data } = await supabase
      .from('mandor_contracts')
      .select('id, mandor_name')
      .eq('project_id', project.id)
      .eq('is_active', true)
      .order('mandor_name');
    setMandorContracts(data ?? []);
  }, [project]);

  useEffect(() => {
    loadData();
    loadContracts();
  }, [loadData, loadContracts]);

  // ── Filtered list ──────────────────────────────────────────────────────

  const filteredChanges = useMemo(() => {
    let list = changes;
    if (filterType !== 'all') list = list.filter(c => c.change_type === filterType);
    if (filterDecision !== 'all') list = list.filter(c => c.decision === filterDecision);
    return list;
  }, [changes, filterType, filterDecision]);

  // ── Photo handling ─────────────────────────────────────────────────────

  const handlePhoto = async (replaceIndex?: number) => {
    try {
      const path = await pickAndUploadPhoto(`site-changes/${project!.id}`);
      if (!path) return;
      setFormPhotos(prev => {
        if (replaceIndex == null || replaceIndex < 0 || replaceIndex >= prev.length) return [...prev, path];
        return prev.map((p, i) => (i === replaceIndex ? path : p));
      });
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const removePhoto = (index: number) => {
    setFormPhotos(prev => prev.filter((_, i) => i !== index));
  };

  // ── Submit new change ──────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!formLocation.trim()) { toast('Isi lokasi perubahan', 'critical'); return; }
    if (!formDescription.trim()) { toast('Isi deskripsi perubahan', 'critical'); return; }

    setSubmitting(true);
    const { error } = await createSiteChange({
      projectId: project!.id,
      location: sanitizeText(formLocation),
      description: sanitizeText(formDescription),
      changeType: formType,
      impact: formImpact,
      isUrgent: formIsUrgent,
      boqItemId: formBoqItemId || undefined,
      contractId: formContractId || undefined,
      photoUrls: formPhotos,
    });
    setSubmitting(false);

    if (error) { toast(error, 'critical'); return; }

    // Activity log
    await supabase.from('activity_log').insert({
      project_id: project!.id,
      user_id: profile!.id,
      type: 'perubahan',
      label: `${CHANGE_TYPE_LABELS[formType]}: ${sanitizeText(formDescription).slice(0, 60)} [${IMPACT_LABELS[formImpact]}]`,
      flag: formImpact === 'berat' ? 'WARNING' : 'INFO',
    });

    // Reset form
    setFormLocation(''); setFormDescription(''); setFormType('kondisi_lapangan');
    setFormImpact('ringan'); setFormIsUrgent(false); setFormBoqItemId('');
    setFormContractId(''); setFormPhotos([]);
    setView('list');
    await loadData();
    toast('Catatan perubahan disimpan', 'ok');
  };

  // ── Review ─────────────────────────────────────────────────────────────

  const openReview = (item: SiteChange) => {
    setReviewItem(item);
    setReviewDecision(item.decision);
    setReviewCost(item.est_cost != null ? String(item.est_cost) : '');
    setReviewCostBearer((item.cost_bearer as CostBearer | '') ?? '');
    setReviewNote(item.estimator_note ?? '');
    setReviewNeedsOwner(item.needs_owner_approval);
  };

  const handleReviewSave = async () => {
    if (!reviewItem) return;
    setReviewSaving(true);
    const parsedCost = parseFloat(reviewCost.replace(/[^\d.]/g, ''));
    const { error } = await reviewSiteChange({
      id: reviewItem.id,
      decision: reviewDecision,
      estCost: Number.isFinite(parsedCost) ? parsedCost : undefined,
      costBearer: reviewCostBearer || undefined,
      needsOwnerApproval: reviewNeedsOwner,
      estimatorNote: reviewNote || undefined,
    });
    setReviewSaving(false);
    if (error) { toast(error, 'critical'); return; }
    setReviewItem(null);
    await loadData();
    toast('Review disimpan', 'ok');
  };

  const handleResolve = async (item: SiteChange) => {
    Alert.alert('Tandai Selesai', 'Perubahan ini sudah ditangani?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Selesai', onPress: async () => {
        const { error } = await resolveSiteChange(item.id);
        if (error) { toast(error, 'critical'); return; }
        await loadData();
        toast('Ditandai selesai', 'ok');
      }},
    ]);
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  };

  const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.flex}>
      <Header />

      {/* Back + title */}
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali</Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── Summary stats ── */}
        {summary && (
          <View style={styles.statRow}>
            <StatTile value={summary.pending_count} label="Pending" color={COLORS.warning} />
            <StatTile value={summary.open_rework} label="Rework" color={COLORS.critical} />
            <StatTile value={summary.total_count} label="Total" color={COLORS.textSec} />
          </View>
        )}

        {/* Principal alert: berat items */}
        {summary && summary.pending_berat > 0 && (
          <Card borderColor={COLORS.critical}>
            <View style={styles.alertRow}>
              <Ionicons name="warning" size={18} color={COLORS.critical} />
              <View style={{ flex: 1 }}>
                <Text style={styles.alertTitle}>{summary.pending_berat} perubahan BERAT belum ditinjau</Text>
                <Text style={styles.hint}>Perlu perhatian estimator dan prinsipal.</Text>
              </View>
            </View>
          </Card>
        )}

        {/* ── Tab: list / form ── */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, view === 'list' && styles.tabActive]}
            onPress={() => setView('list')}
          >
            <Text style={[styles.tabText, view === 'list' && styles.tabTextActive]}>Daftar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, view === 'form' && styles.tabActive]}
            onPress={() => setView('form')}
          >
            <Text style={[styles.tabText, view === 'form' && styles.tabTextActive]}>+ Catat Baru</Text>
          </TouchableOpacity>
        </View>

        {/* ═══════════ LIST VIEW ═══════════ */}
        {view === 'list' && (
          <>
            {/* Filters */}
            <View style={styles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.xs }}>
                <TouchableOpacity
                  style={[styles.filterChip, filterType === 'all' && styles.filterChipActive]}
                  onPress={() => setFilterType('all')}
                >
                  <Text style={[styles.filterText, filterType === 'all' && styles.filterTextActive]}>Semua</Text>
                </TouchableOpacity>
                {CHANGE_TYPES.map(ct => (
                  <TouchableOpacity
                    key={ct.key}
                    style={[styles.filterChip, filterType === ct.key && styles.filterChipActive]}
                    onPress={() => setFilterType(ct.key)}
                  >
                    <Text style={[styles.filterText, filterType === ct.key && styles.filterTextActive]}>
                      {CHANGE_TYPE_LABELS[ct.key]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Decision filter */}
            <View style={styles.filterRow}>
              {(['all', 'pending', 'disetujui', 'selesai'] as const).map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.filterChip, filterDecision === d && styles.filterChipActive]}
                  onPress={() => setFilterDecision(d)}
                >
                  <Text style={[styles.filterText, filterDecision === d && styles.filterTextActive]}>
                    {d === 'all' ? 'Semua' : DECISION_LABELS[d]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {loading && <Text style={styles.hint}>Memuat...</Text>}

            {filteredChanges.map(item => (
              <Card key={item.id} borderColor={IMPACT_COLORS[item.impact]}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardType}>{CHANGE_TYPE_LABELS[item.change_type]}</Text>
                    <Text style={styles.cardLocation}>{item.location}</Text>
                  </View>
                  <View style={styles.badges}>
                    <Badge
                      flag={item.impact === 'berat' ? 'CRITICAL' : item.impact === 'sedang' ? 'WARNING' : 'OK'}
                      label={IMPACT_LABELS[item.impact]}
                    />
                    <Badge
                      flag={item.decision === 'selesai' ? 'OK' : item.decision === 'ditolak' ? 'CRITICAL' : item.decision === 'disetujui' ? 'INFO' : 'WARNING'}
                      label={DECISION_LABELS[item.decision]}
                    />
                  </View>
                </View>

                <Text style={styles.cardDesc}>{item.description}</Text>

                <View style={styles.cardMeta}>
                  {item.boq_code && <Text style={styles.hint}>{item.boq_code}</Text>}
                  {item.mandor_name && <Text style={styles.hint}>{item.mandor_name}</Text>}
                  <Text style={styles.hint}>{formatDate(item.created_at)}</Text>
                  {item.reporter_name && <Text style={styles.hint}>oleh {item.reporter_name}</Text>}
                </View>

                {item.est_cost != null && (
                  <View style={styles.costRow}>
                    <Text style={styles.costLabel}>Est. biaya:</Text>
                    <Text style={styles.costValue}>{formatRp(item.est_cost)}</Text>
                    {item.cost_bearer && (
                      <Text style={styles.costBearer}>({COST_BEARER_LABELS[item.cost_bearer]})</Text>
                    )}
                  </View>
                )}

                {item.estimator_note && (
                  <Text style={[styles.hint, { marginTop: SPACE.xs }]}>Estimator: {item.estimator_note}</Text>
                )}

                {item.is_urgent && (
                  <View style={styles.urgentTag}>
                    <Ionicons name="flash" size={12} color={COLORS.critical} />
                    <Text style={styles.urgentText}>Urgent</Text>
                  </View>
                )}

                {/* Action buttons */}
                <View style={styles.cardActions}>
                  {isReviewer && item.decision === 'pending' && (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openReview(item)}>
                      <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                      <Text style={styles.actionText}>Review</Text>
                    </TouchableOpacity>
                  )}
                  {item.decision === 'disetujui' && (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => handleResolve(item)}>
                      <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.ok} />
                      <Text style={[styles.actionText, { color: COLORS.ok }]}>Tandai Selesai</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Card>
            ))}

            {!loading && filteredChanges.length === 0 && (
              <Card>
                <Text style={styles.hint}>Belum ada catatan perubahan.</Text>
              </Card>
            )}
          </>
        )}

        {/* ═══════════ FORM VIEW ═══════════ */}
        {view === 'form' && (
          <Card title="Catatan Perubahan Baru">
            {/* Change type */}
            <Text style={styles.label}>Tipe Perubahan <Text style={styles.req}>*</Text></Text>
            <View style={styles.typeGrid}>
              {CHANGE_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct.key}
                  style={[styles.typeChip, formType === ct.key && styles.typeChipActive]}
                  onPress={() => setFormType(ct.key)}
                >
                  <View style={styles.typeChipHeader}>
                    <Ionicons
                      name={ct.icon as any}
                      size={15}
                      color={formType === ct.key ? COLORS.primary : COLORS.textSec}
                    />
                    <Text style={[styles.typeText, formType === ct.key && styles.typeTextActive]}>
                      {CHANGE_TYPE_LABELS[ct.key]}
                    </Text>
                  </View>
                  <Text style={[styles.typeHint, formType === ct.key && styles.typeHintActive]}>
                    {ct.hint}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Location */}
            <Text style={styles.label}>Lokasi <Text style={styles.req}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={formLocation}
              onChangeText={setFormLocation}
              placeholder="Contoh: Kolom K3, Lt.2 Kamar Utama"
              placeholderTextColor={COLORS.textMuted}
            />

            {/* Description */}
            <Text style={styles.label}>Apa yang Berubah <Text style={styles.req}>*</Text></Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={formDescription}
              onChangeText={setFormDescription}
              multiline
              placeholder="Jelaskan singkat perubahan, kondisi, atau permintaan"
              placeholderTextColor={COLORS.textMuted}
            />

            {/* Impact */}
            <Text style={styles.label}>Dampak <Text style={styles.req}>*</Text></Text>
            <Text style={styles.impactHint}>
              Indikasikan tingkat dampak terhadap pekerjaan. Estimasi biaya akan ditentukan oleh estimator.
            </Text>
            <View style={styles.impactRow}>
              {IMPACTS.map(imp => (
                <TouchableOpacity
                  key={imp}
                  style={[styles.impactChip, formImpact === imp && { borderColor: IMPACT_COLORS[imp], backgroundColor: `${IMPACT_COLORS[imp]}12` }]}
                  onPress={() => setFormImpact(imp)}
                >
                  <Text style={[styles.impactLabel, formImpact === imp && { color: IMPACT_COLORS[imp] }]}>
                    {IMPACT_LABELS[imp]}
                  </Text>
                  <Text style={styles.impactDesc}>
                    {imp === 'ringan' ? 'Penyesuaian minor' : imp === 'sedang' ? 'Perlu penanganan lanjutan' : 'Berdampak pada jadwal proyek'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {formImpact === 'berat' && (
              <View style={styles.beratWarning}>
                <Ionicons name="warning" size={14} color={COLORS.critical} />
                <Text style={styles.beratWarningText}>
                  Perubahan berat akan dikirim ke estimator dan prinsipal untuk ditinjau.
                </Text>
              </View>
            )}

            {/* Urgent toggle */}
            <TouchableOpacity style={styles.urgentToggle} onPress={() => setFormIsUrgent(!formIsUrgent)}>
              <Ionicons
                name={formIsUrgent ? 'checkbox' : 'square-outline'}
                size={20}
                color={formIsUrgent ? COLORS.critical : COLORS.textSec}
              />
              <Text style={styles.urgentToggleText}>Urgent — menghambat pekerjaan lain</Text>
            </TouchableOpacity>

            {/* BoQ item (optional) */}
            <Text style={styles.label}>Item BoQ Terkait</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={formBoqItemId} onValueChange={setFormBoqItemId}>
                <Picker.Item label="-- Tidak spesifik --" value="" />
                {boqItems.map(b => (
                  <Picker.Item key={b.id} label={`${b.code} — ${b.label}`} value={b.id} />
                ))}
              </Picker>
            </View>

            {/* Mandor contract (for rework) */}
            {(formType === 'rework') && (
              <>
                <Text style={styles.label}>Mandor Terkait</Text>
                <View style={styles.pickerWrap}>
                  <Picker selectedValue={formContractId} onValueChange={setFormContractId}>
                    <Picker.Item label="-- Pilih mandor --" value="" />
                    {mandorContracts.map(c => (
                      <Picker.Item key={c.id} label={c.mandor_name} value={c.id} />
                    ))}
                  </Picker>
                </View>
              </>
            )}

            {/* Photos */}
            <Text style={styles.label}>Foto</Text>
            <PhotoGalleryField
              photoPaths={formPhotos}
              onAdd={() => handlePhoto()}
              onReplace={handlePhoto}
              onRemove={removePhoto}
              emptyLabel="Tambah Foto"
              helperText="Foto kondisi lapangan, kerusakan, atau permintaan perubahan."
            />

            {/* Submit */}
            <TouchableOpacity
              style={[styles.btn, { marginTop: SPACE.md }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.btnText}>{submitting ? 'Menyimpan...' : 'Simpan Catatan'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.ghostBtn, { marginTop: SPACE.sm }]}
              onPress={() => setView('list')}
            >
              <Text style={styles.ghostBtnText}>Batal</Text>
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>

      {/* ═══════════ REVIEW MODAL ═══════════ */}
      <Modal visible={!!reviewItem} animationType="slide" onRequestClose={() => setReviewItem(null)}>
        <View style={styles.flex}>
          <Header />
          <TouchableOpacity style={styles.backBtn} onPress={() => setReviewItem(null)}>
            <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
            <Text style={styles.backText}>Tutup</Text>
          </TouchableOpacity>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {reviewItem && (
              <>
                <Card>
                  <Text style={styles.cardType}>{CHANGE_TYPE_LABELS[reviewItem.change_type]}</Text>
                  <Text style={styles.cardLocation}>{reviewItem.location}</Text>
                  <Text style={[styles.cardDesc, { marginTop: SPACE.sm }]}>{reviewItem.description}</Text>
                  <View style={[styles.cardMeta, { marginTop: SPACE.sm }]}>
                    <Badge
                      flag={reviewItem.impact === 'berat' ? 'CRITICAL' : reviewItem.impact === 'sedang' ? 'WARNING' : 'OK'}
                      label={IMPACT_LABELS[reviewItem.impact]}
                    />
                    {reviewItem.reporter_name && <Text style={styles.hint}>oleh {reviewItem.reporter_name}</Text>}
                    <Text style={styles.hint}>{formatDate(reviewItem.created_at)}</Text>
                  </View>
                  {reviewItem.boq_code && (
                    <Text style={[styles.hint, { marginTop: SPACE.xs }]}>BoQ: {reviewItem.boq_code} — {reviewItem.boq_label}</Text>
                  )}
                  {reviewItem.mandor_name && (
                    <Text style={[styles.hint, { marginTop: SPACE.xs }]}>Mandor: {reviewItem.mandor_name}</Text>
                  )}
                </Card>

                <Card title="Review Estimator">
                  {/* Decision */}
                  <Text style={styles.label}>Keputusan</Text>
                  <View style={styles.impactRow}>
                    {(['disetujui', 'ditolak'] as Decision[]).map(d => (
                      <TouchableOpacity
                        key={d}
                        style={[styles.impactChip, reviewDecision === d && { borderColor: DECISION_COLORS[d], backgroundColor: `${DECISION_COLORS[d]}12` }]}
                        onPress={() => setReviewDecision(d)}
                      >
                        <Text style={[styles.impactLabel, reviewDecision === d && { color: DECISION_COLORS[d] }]}>
                          {DECISION_LABELS[d]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Cost estimate */}
                  <Text style={styles.label}>Estimasi Biaya</Text>
                  <TextInput
                    style={styles.input}
                    value={reviewCost}
                    onChangeText={setReviewCost}
                    keyboardType="numeric"
                    placeholder="Rp (kosongkan jika tidak ada)"
                    placeholderTextColor={COLORS.textMuted}
                  />

                  {/* Cost bearer */}
                  <Text style={styles.label}>Siapa Menanggung</Text>
                  <View style={styles.impactRow}>
                    {COST_BEARERS.map(cb => (
                      <TouchableOpacity
                        key={cb}
                        style={[styles.impactChip, reviewCostBearer === cb && styles.typeChipActive]}
                        onPress={() => setReviewCostBearer(cb)}
                      >
                        <Text style={[styles.impactLabel, reviewCostBearer === cb && { color: COLORS.primary }]}>
                          {COST_BEARER_LABELS[cb]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Needs owner approval */}
                  <TouchableOpacity style={styles.urgentToggle} onPress={() => setReviewNeedsOwner(!reviewNeedsOwner)}>
                    <Ionicons
                      name={reviewNeedsOwner ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={reviewNeedsOwner ? COLORS.warning : COLORS.textSec}
                    />
                    <Text style={styles.urgentToggleText}>Perlu persetujuan owner</Text>
                  </TouchableOpacity>

                  {/* Note */}
                  <Text style={styles.label}>Catatan Estimator</Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={reviewNote}
                    onChangeText={setReviewNote}
                    multiline
                    placeholder="Catatan review..."
                    placeholderTextColor={COLORS.textMuted}
                  />

                  <TouchableOpacity
                    style={[styles.btn, { marginTop: SPACE.md }]}
                    onPress={handleReviewSave}
                    disabled={reviewSaving}
                  >
                    <Text style={styles.btnText}>{reviewSaving ? 'Menyimpan...' : 'Simpan Review'}</Text>
                  </TouchableOpacity>
                </Card>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const RADIUS_SM = 6;

const styles = StyleSheet.create({
  flex:         { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { flex: 1 },
  content:      { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACE.base, paddingVertical: SPACE.sm },
  backText:     { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.primary },
  statRow:      { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  hint:         { fontSize: TYPE.xs, color: COLORS.textSec },

  // Alert
  alertRow:     { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  alertTitle:   { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.critical },

  // Tabs
  tabRow:       { flexDirection: 'row', marginBottom: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab:          { flex: 1, paddingVertical: SPACE.sm, alignItems: 'center' },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText:      { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  tabTextActive:{ color: COLORS.primary, fontFamily: FONTS.semibold },

  // Filters
  filterRow:    { flexDirection: 'row', gap: SPACE.xs, marginBottom: SPACE.sm },
  filterChip:   { paddingHorizontal: SPACE.sm, paddingVertical: 6, borderRadius: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText:   { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  filterTextActive: { color: COLORS.textInverse },

  // Card items
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.xs },
  cardType:     { fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', color: COLORS.textSec, letterSpacing: 0.5 },
  cardLocation: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: 2 },
  cardDesc:     { fontSize: TYPE.sm, color: COLORS.text, marginBottom: SPACE.xs },
  cardMeta:     { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'center' },
  badges:       { flexDirection: 'row', gap: 4 },
  cardActions:  { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  actionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.surface },
  actionText:   { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.primary },

  // Cost row
  costRow:      { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs },
  costLabel:    { fontSize: TYPE.xs, color: COLORS.textSec },
  costValue:    { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  costBearer:   { fontSize: TYPE.xs, color: COLORS.textSec },

  // Urgent
  urgentTag:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACE.xs },
  urgentText:   { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical },
  urgentToggle: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm },
  urgentToggleText: { fontSize: TYPE.sm, color: COLORS.text },

  // Form
  label:        { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: 6, marginTop: SPACE.md },
  req:          { color: COLORS.critical },
  input:        { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.sm, color: COLORS.text },
  textarea:     { minHeight: 80, textAlignVertical: 'top' },
  pickerWrap:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  impactHint:   { fontSize: TYPE.xs, color: COLORS.textSec, marginBottom: SPACE.sm },
  impactRow:    { flexDirection: 'row', gap: SPACE.sm },
  impactChip:   { flex: 1, padding: SPACE.sm, borderWidth: 2, borderColor: COLORS.border, borderRadius: RADIUS, alignItems: 'center' },
  impactLabel:  { fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', color: COLORS.textSec },
  impactDesc:   { fontSize: 10, color: COLORS.textSec, marginTop: 2, textAlign: 'center' },
  beratWarning: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm, padding: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: 'rgba(198,40,40,0.08)' },
  beratWarningText: { fontSize: TYPE.xs, color: COLORS.critical, flex: 1 },

  // Type selector
  typeGrid:       { gap: SPACE.xs },
  typeChip:       { paddingHorizontal: SPACE.sm, paddingVertical: SPACE.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, flexDirection: 'column', gap: 3 },
  typeChipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}10` },
  typeChipHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeText:       { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  typeTextActive: { color: COLORS.primary },
  typeHint:       { fontSize: TYPE.xs - 1, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 15, paddingLeft: 21 },
  typeHintActive: { color: COLORS.primary, opacity: 0.75 },

  // Buttons
  btn:          { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  btnText:      { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  ghostBtn:     { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 10, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
});
