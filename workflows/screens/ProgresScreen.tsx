import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import Badge from '../components/Badge';
import StatTile from '../components/StatTile';
import { useProject } from '../hooks/useProject';
import { queueDeeplink } from '../pendingDeeplink';
import { useToast } from '../components/Toast';
import CatatanPerubahanScreen from './CatatanPerubahanScreen';
import DailyLogScreen from './DailyLogScreen';
import ProgressClaimPanel from './progressClaim/ProgressClaimPanel';
import { getDailyLog } from '../../tools/dailySiteLogs';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import { getSiteChangeSummary, type SiteChangeSummary } from '../../tools/siteChanges';

type SubModule = 'home' | 'progress' | 'perubahan' | 'daily-log';

export default function ProgresScreen() {
  const navigation = useNavigation<any>();
  const { projects, boqItems, project, profile, setActiveProject, refresh } = useProject();
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
  const [todayLogExists, setTodayLogExists] = useState<boolean | null>(null);

  // ── Tambah progres: the weekly stage claim (report-driven progress spec §16) ──
  const route = useRoute<any>();
  const [claimRowId, setClaimRowId] = useState<string | null>(null);
  const [claimReloadKey, setClaimReloadKey] = useState(0);
  const appliedParams = useRef<unknown>(null);

  // A claim notification (migration 104: PROGRESS_CLAIM_RETURNED / _VERIFIED)
  // opens the claim on its own project. Applied once per navigation, so a
  // later manual project switch is not undone.
  useEffect(() => {
    const params = route.params as { module?: string; projectId?: string } | undefined;
    if (!params || appliedParams.current === params) return;
    appliedParams.current = params;
    // Notification taps switch projects before navigating
    // (workflows/pendingDeeplink.ts). A link opened any other way switches
    // here; the switch unmounts this screen, so the route is queued for
    // RoleRouter to open again once the new project has loaded.
    if (params.projectId && params.projectId !== project?.id && projects.some((p) => p.id === params.projectId)) {
      queueDeeplink(route.name, { ...params });
      setActiveProject(params.projectId);
      return;
    }
    if (params.module === 'progress') {
      setClaimRowId(null);
      setActiveModule('progress');
      setClaimReloadKey((k) => k + 1);
      // A returned or verified claim changed boq_items: reload the project data
      // behind Progres Terkini and Beranda.
      void refresh();
    }
  }, [route.params, route.name, project?.id, projects, setActiveProject, refresh]);

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

  useEffect(() => {
    if (activeModule !== 'home' || !project) return;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    getDailyLog(project.id, iso).then((l) => setTodayLogExists(!!l)).catch(() => setTodayLogExists(null));
  }, [activeModule, project]);

  const selectedProgressEntries = useMemo(
    () => recentEntries.filter(entry => entry.boq_item_id === selectedProgressItemId).slice(0, 8),
    [recentEntries, selectedProgressItemId],
  );

  // ── Handlers ──
  const goBack = () => setActiveModule('home');

  const openProgressComposer = (rowId?: string) => {
    setClaimRowId(rowId ?? null);
    setActiveModule('progress');
  };

  // ── Sub-module header ──
  const SubHeader = ({ title }: { title: string }) => (
    <View style={styles.subHeader}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Kembali ke hub progres"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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

  if (activeModule === 'daily-log') {
    return <DailyLogScreen onBack={() => setActiveModule('home')} />;
  }

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── HOME: Hub landing ── */}
        {activeModule === 'home' && (
          <>
            <Text style={styles.sectionHead}>Gate 4 — Hub Progres</Text>

            <Card title="Log Harian Hari Ini" subtitle="Catatan lapangan yang mengisi laporan progres klien.">
              <TouchableOpacity
                style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' }}
                onPress={() => setActiveModule('daily-log')}
              >
                <Text style={{ color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' }}>
                  {todayLogExists ? 'Edit Log Hari Ini' : '+ Catat Log Harian'}
                </Text>
              </TouchableOpacity>
            </Card>

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
                { key: 'ruangan' as const, icon: 'qr-code', label: 'Ruangan', color: COLORS.info },
                { key: 'papan' as const, icon: 'grid', label: 'Papan', color: COLORS.accentDark },
              ]).map(btn => (
                <TouchableOpacity
                  key={btn.key}
                  style={styles.hubBtn}
                  onPress={() => {
                    if (btn.key === 'ruangan') navigation.navigate('RoomScan');
                    else if (btn.key === 'papan') navigation.navigate('RoomBoard');
                    else if (btn.key === 'progress') openProgressComposer();
                    else setActiveModule(btn.key as SubModule);
                  }}
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
              <Text style={styles.sectionHint}>Ketuk item untuk melihat riwayat progres terverifikasi atau mengisi klaim minggu ini.</Text>
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

        {/* ── PROGRESS: the weekly stage claim per work area ── */}
        {activeModule === 'progress' && project && (
          <>
            <SubHeader title="Tambah Progres" />
            <Text style={styles.sectionHint}>
              Isi persentase tiap tahap per area kerja. Klaim dikirim mingguan dan baru menambah progres proyek setelah estimator memverifikasi.
            </Text>
            <ProgressClaimPanel
              projectId={project.id}
              role={profile?.role}
              boqItems={boqItems}
              initialRowId={claimRowId}
              reloadKey={claimReloadKey}
              toast={toast}
            />
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
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  hubIcon:  { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  hubLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center', color: COLORS.text },

  expandHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.xs },
  expandTitle:  { fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.3, color: COLORS.text },
  sectionHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18, marginBottom: SPACE.sm },

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
  detailBoxInline:{ marginTop: 0, marginBottom: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS, backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.borderSub, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
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
