import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import FlagPanel from '../components/FlagPanel';
import PhotoGalleryField from '../components/PhotoGalleryField';
import Badge from '../components/Badge';
import StatTile from '../components/StatTile';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import CatatanPerubahanScreen from './CatatanPerubahanScreen';
import { computeGate4Info } from '../gates/gate4';
import { syncBoqInstalledFromDerived } from '../../tools/derivation';
import { sanitizeText, isPositiveNumber } from '../../tools/validation';
import { pickAndUploadPhoto } from '../../tools/storage';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import { getSiteChangeSummary, type SiteChangeSummary } from '../../tools/siteChanges';

type SubModule = 'home' | 'progress' | 'perubahan';

export default function ProgresScreen() {
  const { boqItems, project, profile, refresh } = useProject();
  const { show: toast } = useToast();
  const [activeModule, setActiveModule] = useState<SubModule>('home');
  const [selectedProgressItemId, setSelectedProgressItemId] = useState<string | null>(null);
  const [showRecentProgress, setShowRecentProgress] = useState(true);
  const [recentEntries, setRecentEntries] = useState<Array<{
    id: string;
    boq_item_id: string;
    quantity: number;
    unit: string;
    work_status: string;
    location: string | null;
    note: string | null;
    created_at: string;
  }>>([]);
  const [changeSummary, setChangeSummary] = useState<SiteChangeSummary | null>(null);

  // ── Progress form state ──
  const [boqId, setBoqId] = useState('');
  const [qty, setQty] = useState('');
  const [location, setLocation] = useState('');
  const [progressPhotos, setProgressPhotos] = useState<string[]>([]);
  const [progressNote, setProgressNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Computed ──
  const inProgressItems = useMemo(() => boqItems.filter(b => b.progress < 100), [boqItems]);
  const selectedItem = useMemo(() => boqItems.find(b => b.id === boqId), [boqItems, boqId]);
  const gateResult = useMemo(() => {
    if (!selectedItem || !qty) return null;
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) return null;
    return computeGate4Info(selectedItem, q);
  }, [selectedItem, qty]);
  const newInstalled = selectedItem && qty ? selectedItem.installed + (parseFloat(qty) || 0) : 0;
  const newPct = selectedItem ? Math.min(100, (newInstalled / selectedItem.planned) * 100).toFixed(1) : '0';
  const derivedWorkStatus = useMemo(() => {
    if (!selectedItem) return 'IN_PROGRESS';
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) return 'IN_PROGRESS';
    return selectedItem.installed + q >= selectedItem.planned ? 'COMPLETE' : 'IN_PROGRESS';
  }, [selectedItem, qty]);

  const loadHomeDetails = useCallback(async () => {
    if (!project) return;
    try {
      const [entryRes, summaryRes] = await Promise.all([
        supabase
          .from('progress_entries')
          .select('id, boq_item_id, quantity, unit, work_status, location, note, created_at')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false })
          .limit(40),
        getSiteChangeSummary(project.id),
      ]);

      setRecentEntries((entryRes.data as any[]) ?? []);
      setChangeSummary(summaryRes);
    } catch (err: any) {
      console.warn('Progress home detail load failed:', err?.message ?? err);
    }
  }, [project]);

  useEffect(() => {
    if (activeModule === 'home') {
      loadHomeDetails();
    }
  }, [activeModule, loadHomeDetails]);

  const selectedProgressEntries = useMemo(
    () => recentEntries.filter(entry => entry.boq_item_id === selectedProgressItemId).slice(0, 8),
    [recentEntries, selectedProgressItemId],
  );

  // ── Handlers ──
  const goBack = () => setActiveModule('home');

  const updatePhotoCollection = async (
    folder: string,
    setPhotos: React.Dispatch<React.SetStateAction<string[]>>,
    replaceIndex?: number,
    addMessage = 'Foto ditambahkan',
    replaceMessage = 'Foto diganti',
  ) => {
    try {
      const path = await pickAndUploadPhoto(folder);
      if (!path) return;

      setPhotos(prev => {
        if (replaceIndex == null || replaceIndex < 0 || replaceIndex >= prev.length) {
          return [...prev, path];
        }
        return prev.map((photo, index) => (index === replaceIndex ? path : photo));
      });

      toast(replaceIndex == null ? addMessage : replaceMessage, 'ok');
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const removePhotoFromCollection = (
    setPhotos: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
  ) => {
    setPhotos(prev => prev.filter((_, photoIndex) => photoIndex !== index));
    toast('Foto dihapus', 'warning');
  };

  const handleProgressPhoto = (replaceIndex?: number) =>
    updatePhotoCollection(
      `progress/${project!.id}`,
      setProgressPhotos,
      replaceIndex,
      'Foto progres ditambahkan',
      'Foto progres diganti',
    );

  const resetProgressForm = () => {
    setBoqId(''); setQty(''); setLocation('');
    setProgressPhotos([]); setProgressNote('');
  };

  const openProgressComposer = (nextBoqId?: string) => {
    if (nextBoqId) {
      setBoqId(nextBoqId);
      setQty('');
    }
    setActiveModule('progress');
  };

  const handleProgressSubmit = async () => {
    const needsPhoto = Platform.OS !== 'web';
    if (!boqId || !isPositiveNumber(qty) || (needsPhoto && progressPhotos.length === 0)) {
      toast('Lengkapi BoQ, qty, dan foto progres', 'critical'); return;
    }
    const item = boqItems.find(b => b.id === boqId);
    if (!item || !project || !profile) return;

    setSubmitting(true);
    try {
      const { data: progressEntry, error: dbError } = await supabase
        .from('progress_entries')
        .insert({
          project_id: project.id,
          boq_item_id: boqId,
          reported_by: profile.id,
          quantity: parseFloat(qty),
          unit: item.unit,
          work_status: derivedWorkStatus,
          location: location ? sanitizeText(location) : null,
          note: progressNote ? sanitizeText(progressNote) : null,
        })
        .select('id')
        .single();
      if (dbError || !progressEntry) throw dbError ?? new Error('Progress insert failed');

      if (progressPhotos.length > 0) {
        const { error: photoError } = await supabase.from('progress_photos').insert(
          progressPhotos.map((path) => ({
            progress_entry_id: progressEntry.id,
            storage_path: path,
            captured_at: new Date().toISOString(),
          })),
        );
        if (photoError) throw photoError;
      }

      await syncBoqInstalledFromDerived(project.id);

      await supabase.from('activity_log').insert({
        project_id: project.id, user_id: profile.id,
        type: 'progres',
        label: `${item.label} — ${qty} ${item.unit} terpasang`,
        flag: 'OK',
      });

      resetProgressForm();
      await refresh();
      await loadHomeDetails();
      setActiveModule('home');
      toast(`Progres dicatat: ${qty} ${item.unit}`, 'ok');
    } catch (err: any) {
      console.warn('Progress submit failed:', err?.message ?? err);
      toast(err?.message ?? 'Gagal menyimpan progres', 'critical');
    }
    finally { setSubmitting(false); }
  };

  // ── Sub-module header ──
  const SubHeader = ({ title }: { title: string }) => (
    <View style={styles.subHeader}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Kembali ke hub progres"
      >
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali</Text>
      </TouchableOpacity>
      <Text style={styles.subTitle}>{title}</Text>
    </View>
  );

  // ═══════════════════════ RENDER ═══════════════════════

  // Full-screen takeover for CatatanPerubahan
  if (activeModule === 'perubahan') {
    return <CatatanPerubahanScreen onBack={goBack} />;
  }

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── HOME: Hub landing ── */}
        {activeModule === 'home' && (
          <>
            <Text style={styles.sectionHead}>Gate 4 — Hub Progres</Text>

            <View style={styles.statRow}>
              <StatTile value={boqItems.filter(b => b.progress > 0 && b.progress < 100).length} label="Berjalan" color={COLORS.accent} />
              <StatTile value={changeSummary?.pending_count ?? 0} label="Pending Review" color={COLORS.warning} />
              <StatTile value={changeSummary?.approved_unresolved ?? 0} label="Belum Selesai" color={COLORS.critical} />
            </View>

            {/* Action buttons */}
            <View style={styles.hubGrid}>
              {([
                { key: 'progress' as SubModule, icon: 'trending-up', label: 'Tambah Progres', color: COLORS.accent },
                { key: 'perubahan' as SubModule, icon: 'create', label: 'Catatan Perubahan', color: COLORS.warning },
              ]).map(btn => (
                <TouchableOpacity
                  key={btn.key}
                  style={styles.hubBtn}
                  onPress={() => setActiveModule(btn.key)}
                  accessibilityRole="button"
                  accessibilityLabel={btn.label}
                >
                  <View style={[styles.hubIcon, { backgroundColor: `${btn.color}15` }]}>
                    <Ionicons name={btn.icon as any} size={22} color={btn.color} />
                  </View>
                  <Text style={styles.hubLabel}>{btn.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Progress per item */}
            <Card>
              <TouchableOpacity
                style={styles.expandHeader}
                onPress={() => setShowRecentProgress(!showRecentProgress)}
                accessibilityRole="button"
                accessibilityLabel={showRecentProgress ? 'Sembunyikan progres terkini' : 'Tampilkan progres terkini'}
              >
                <Text style={styles.expandTitle}>Progres Terkini per Item</Text>
                <Ionicons name={showRecentProgress ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSec} />
              </TouchableOpacity>
              <Text style={styles.sectionHint}>Tap item untuk buka detail progres dan tambah entri baru untuk item yang sama.</Text>
              {showRecentProgress && (
                <>
                  {boqItems.filter(b => b.progress > 0).map(b => (
                    <View key={b.id} style={styles.rowStack}>
                      <TouchableOpacity
                        style={[styles.listItem, selectedProgressItemId === b.id && styles.listItemActive]}
                        onPress={() => setSelectedProgressItemId(prev => prev === b.id ? null : b.id)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.listTitle}>{b.code} — {b.label}</Text>
                          <Text style={styles.listSub}>{b.installed.toFixed(1)} / {b.planned} {b.unit}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[styles.listPct, { color: b.progress === 100 ? COLORS.ok : COLORS.accent }]}>{b.progress}%</Text>
                          <Badge flag={b.progress === 100 ? 'OK' : 'INFO'} label={b.progress === 100 ? 'Selesai' : 'Jalan'} />
                        </View>
                      </TouchableOpacity>
                      {selectedProgressItemId === b.id && (
                        <View style={styles.detailBoxInline}>
                          <Text style={styles.detailTitle}>{b.code} — {b.label}</Text>
                          <Text style={styles.hint}>
                            Target: {b.planned} {b.unit} · Terpasang: {b.installed.toFixed(2)} {b.unit}
                          </Text>
                          <TouchableOpacity style={[styles.miniBtn, styles.inlineActionBtn]} onPress={() => openProgressComposer(b.id)}>
                            <Text style={styles.miniBtnText}>Tambah progres untuk item ini</Text>
                          </TouchableOpacity>
                          {selectedProgressEntries.length > 0 ? (
                            selectedProgressEntries.map(entry => (
                              <View key={entry.id} style={styles.entryRow}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.entryQty}>{entry.quantity} {entry.unit}</Text>
                                  <Text style={styles.hint}>
                                    {new Date(entry.created_at).toLocaleDateString('id-ID')}
                                    {entry.location ? ` · ${entry.location}` : ''}
                                  </Text>
                                  {entry.note ? <Text style={styles.hint}>{entry.note}</Text> : null}
                                </View>
                                <Badge flag={entry.work_status === 'COMPLETE' ? 'OK' : 'INFO'} label={entry.work_status.replace('_', ' ')} />
                              </View>
                            ))
                          ) : (
                            <Text style={styles.hint}>Belum ada entri detail untuk item ini.</Text>
                          )}
                        </View>
                      )}
                    </View>
                  ))}
                  {boqItems.filter(b => b.progress > 0).length === 0 && (
                    <Text style={styles.hint}>Belum ada progres tercatat.</Text>
                  )}
                </>
              )}
            </Card>

            {/* Site changes summary */}
            {changeSummary && changeSummary.total_count > 0 && (
              <Card>
                <TouchableOpacity
                  style={styles.expandHeader}
                  onPress={() => setActiveModule('perubahan')}
                  accessibilityRole="button"
                  accessibilityLabel="Buka catatan perubahan"
                >
                  <Text style={styles.expandTitle}>Ringkasan Perubahan</Text>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
                </TouchableOpacity>
                <View style={styles.changeSummaryGrid}>
                  {changeSummary.pending_count > 0 && (
                    <View style={styles.changeStat}>
                      <Text style={[styles.changeStatValue, { color: COLORS.warning }]}>{changeSummary.pending_count}</Text>
                      <Text style={styles.changeStatLabel}>Pending</Text>
                    </View>
                  )}
                  {changeSummary.pending_berat > 0 && (
                    <View style={styles.changeStat}>
                      <Text style={[styles.changeStatValue, { color: COLORS.critical }]}>{changeSummary.pending_berat}</Text>
                      <Text style={styles.changeStatLabel}>Berat</Text>
                    </View>
                  )}
                  {changeSummary.approved_unresolved > 0 && (
                    <View style={styles.changeStat}>
                      <Text style={[styles.changeStatValue, { color: COLORS.info }]}>{changeSummary.approved_unresolved}</Text>
                      <Text style={styles.changeStatLabel}>Disetujui</Text>
                    </View>
                  )}
                  {changeSummary.open_rework > 0 && (
                    <View style={styles.changeStat}>
                      <Text style={[styles.changeStatValue, { color: COLORS.critical }]}>{changeSummary.open_rework}</Text>
                      <Text style={styles.changeStatLabel}>Rework</Text>
                    </View>
                  )}
                </View>
                {changeSummary.approved_cost_total > 0 && (
                  <Text style={styles.hint}>
                    Total biaya disetujui: Rp {changeSummary.approved_cost_total.toLocaleString('id-ID')}
                  </Text>
                )}
                <Text style={styles.hint}>Ketuk untuk buka daftar lengkap dan tambah catatan baru.</Text>
              </Card>
            )}
          </>
        )}

        {/* ── PROGRESS: Add progress entry ── */}
        {activeModule === 'progress' && (
          <>
            <SubHeader title="Tambah Progres" />
            <Card title="Laporan Progres Baru">
              <Text style={styles.label}>Item BoQ <Text style={styles.req}>*</Text></Text>
              <View style={styles.pickerWrap}>
                <Picker selectedValue={boqId} onValueChange={v => { setBoqId(v); setQty(''); }} style={{ color: COLORS.text }}>
                  <Picker.Item label="-- Pilih item BoQ --" value="" />
                  {inProgressItems.map(b => (
                    <Picker.Item key={b.id} label={`${b.code} — ${b.label} (${b.progress}%)`} value={b.id} />
                  ))}
                </Picker>
              </View>
              {selectedItem && (
                <Text style={styles.fieldHint}>{selectedItem.progress}% selesai · {selectedItem.installed.toFixed(2)} / {selectedItem.planned} {selectedItem.unit}</Text>
              )}

              {selectedItem && (
                <>
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Qty Hari Ini <Text style={styles.req}>*</Text></Text>
                      <TextInput style={styles.input} keyboardType="numeric" value={qty} onChangeText={setQty} placeholder="0" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Satuan</Text>
                      <TextInput style={[styles.input, styles.disabled]} value={selectedItem.unit} editable={false} />
                    </View>
                  </View>

                  {qty && parseFloat(qty) > 0 && (
                    <Text style={[styles.fieldHint, parseFloat(newPct) >= 100 ? { color: COLORS.ok } : null]}>
                      Setelah: {newInstalled.toFixed(2)} / {selectedItem.planned} {selectedItem.unit} = {newPct}%
                    </Text>
                  )}

                  <View style={styles.autoStatusBox}>
                    <Text style={styles.autoStatusTitle}>Status otomatis</Text>
                    <Text style={styles.autoStatusText}>
                      {derivedWorkStatus === 'COMPLETE'
                        ? 'Entri ini akan ditandai Selesai karena progres mencapai 100%.'
                        : 'Entri ini akan ditandai Sedang Berjalan sampai item mencapai 100%.'}
                    </Text>
                  </View>

                  <Text style={styles.label}>Lokasi / Keterangan</Text>
                  <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Contoh: Kolom K1-K8, zona utara" />

                  <Text style={styles.label}>Catatan</Text>
                  <TextInput style={[styles.input, styles.textarea]} value={progressNote} onChangeText={setProgressNote} multiline placeholder="Catatan tambahan (opsional)" />
                  <Text style={styles.fieldHint}>
                    Tambahan scope, permintaan owner, atau perubahan pekerjaan dicatat lewat `Catatan Perubahan`, bukan lewat progres biasa.
                  </Text>

                  <Text style={styles.label}>Foto Progres <Text style={styles.req}>*</Text></Text>
                  <PhotoGalleryField
                    photoPaths={progressPhotos}
                    onAdd={() => handleProgressPhoto()}
                    onReplace={handleProgressPhoto}
                    onRemove={(index) => removePhotoFromCollection(setProgressPhotos, index)}
                    emptyLabel="Tambah Foto Progres"
                    helperText="Tambahkan beberapa bukti progres bila perlu. Foto pertama tetap menjadi lampiran utama."
                  />

                  <FlagPanel result={gateResult} gateLabel="Gate 4" />

                  <TouchableOpacity
                    style={styles.btn}
                    onPress={handleProgressSubmit}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel="Kirim progres"
                    accessibilityState={{ disabled: submitting, busy: submitting }}
                  >
                    <Text style={styles.btnText}>{submitting ? 'Mengirim...' : 'Kirim Progres'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ghostBtn, { marginTop: 8 }]}
                    onPress={goBack}
                    accessibilityRole="button"
                    accessibilityLabel="Batal, kembali ke hub"
                  >
                    <Text style={styles.ghostBtnText}>Batal</Text>
                  </TouchableOpacity>
                </>
              )}
            </Card>
          </>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 0.8,
    textTransform: 'uppercase', color: COLORS.textSec,
    marginBottom: SPACE.sm, marginTop: SPACE.base,
  },
  statRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },

  // Hub grid
  hubGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.base },
  hubBtn:   {
    width: '48%', backgroundColor: COLORS.surface, borderWidth: 1,
    borderColor: COLORS.borderSub, borderRadius: RADIUS, padding: SPACE.base,
    alignItems: 'center', gap: SPACE.sm,
    shadowColor: '#5A4A3A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  hubIcon:  { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  hubLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center', color: COLORS.text },

  expandHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.xs },
  expandTitle:  { fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.3, color: COLORS.text },
  sectionHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17, marginBottom: SPACE.sm },

  // Sub header
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md, marginTop: SPACE.sm },
  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  backText:  { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  subTitle:  { fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.textSec },

  // Form
  label:     { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.xs, marginTop: SPACE.md },
  req:       { color: COLORS.critical },
  hint:      { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.xs, lineHeight: 17 },
  input:     {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.md - 1, paddingHorizontal: SPACE.md,
    fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text,
  },
  textarea:  { minHeight: 80, textAlignVertical: 'top', paddingTop: SPACE.md - 1 },
  disabled:  { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  pickerWrap:{ borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface },
  fieldHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 17 },
  row2:      { flexDirection: 'row', gap: SPACE.sm },
  autoStatusBox: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, backgroundColor: COLORS.surfaceAlt, marginTop: SPACE.sm },
  autoStatusTitle:{ fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.xs },
  autoStatusText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },

  // Tags

  // Buttons
  btn:          { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md + 2, alignItems: 'center', justifyContent: 'center', marginTop: SPACE.base, minHeight: 50 },
  btnText:      { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase', letterSpacing: 0.3 },
  ghostBtn:     { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase', color: COLORS.textSec, letterSpacing: 0.3 },

  // Lists
  rowStack:      { marginBottom: SPACE.xs },
  listItem:      { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  listItemActive:{ backgroundColor: COLORS.accentBg, borderRadius: RADIUS },
  listTitle:     { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  listSub:       { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  listPct:       { fontSize: TYPE.lg, fontFamily: FONTS.bold, letterSpacing: -0.3 },
  detailBoxInline:{ marginTop: 0, marginBottom: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS, backgroundColor: 'rgba(20,18,16,0.03)', borderWidth: 1, borderColor: COLORS.borderSub, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  detailTitle:   { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: SPACE.xs },
  entryRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  entryQty:      { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text },
  miniBtn:         { backgroundColor: COLORS.accent, borderRadius: RADIUS, paddingVertical: SPACE.xs + 1, paddingHorizontal: SPACE.md },
  inlineActionBtn: { backgroundColor: COLORS.accent, marginTop: SPACE.sm },
  miniBtnText:     { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.textInverse },

  // Site changes summary
  changeSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md, marginBottom: SPACE.sm },
  changeStat:        { alignItems: 'center', minWidth: 60 },
  changeStatValue:   { fontSize: TYPE.lg, fontFamily: FONTS.bold },
  changeStatLabel:   { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
});
