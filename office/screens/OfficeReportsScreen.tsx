import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Modal, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import StatTile from '../../workflows/components/StatTile';
import Badge from '../../workflows/components/Badge';
import DateSelectField, { formatDisplayDate } from '../../workflows/components/DateSelectField';
import { MilestonePanel } from '../../workflows/screens/MilestoneScreen';
import MilestoneFormScreen from '../../workflows/screens/MilestoneFormScreen';
import MilestoneAiDraftScreen from '../../workflows/screens/MilestoneAiDraftScreen';
import MilestoneAiReviewScreen from '../../workflows/screens/MilestoneAiReviewScreen';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import { getSiteChangeSummary, type SiteChangeSummary } from '../../tools/siteChanges';
import { getLaborPaymentSummary, type LaborPaymentSummary } from '../../tools/opnameRpc';
import { getAttendanceByProject } from '../../tools/attendance';
import { getKasbonAging } from '../../tools/kasbon';
import { formatRp } from '../../tools/opname';
import type { MandorAttendance, KasbonAging } from '../../tools/types';
import { generateReport, recordReportExport, type ReportPayload, type ReportType, type ReportFilters } from '../../tools/reports';
import { ReportPreview } from '../../workflows/components/ReportPreview';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';


function formatTs(v: string) {
  return new Date(v).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Section = 'overview' | 'jadwal' | 'jadwal-form' | 'jadwal-ai-draft' | 'jadwal-ai-review';

export default function OfficeReportsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { project, profile, boqItems, purchaseOrders, defects, milestones } = useProject();
  const { show: toast } = useToast();
  const [activeSection, setActiveSection] = useState<Section>(route.params?.initialSection ?? 'overview');
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);

  useEffect(() => {
    const nextSection = route.params?.initialSection as Section | undefined;
    if (nextSection) setActiveSection(nextSection);
  }, [route.params?.initialSection]);
  const { width } = useWindowDimensions();
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop ? MAX_CONTENT_WIDTH.desktop : isTablet ? MAX_CONTENT_WIDTH.tablet : undefined;
  const [reportPreview, setReportPreview] = useState<ReportPayload | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'excel' | 'pdf' | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [changeSummary, setChangeSummary] = useState<SiteChangeSummary | null>(null);
  const [laborSummary, setLaborSummary] = useState<LaborPaymentSummary[]>([]);
  const [attendance, setAttendance] = useState<MandorAttendance[]>([]);
  const [kasbonAging, setKasbonAging] = useState<KasbonAging[]>([]);

  useEffect(() => {
    if (!project) return;
    getSiteChangeSummary(project.id).then(setChangeSummary);
  }, [project]);

  useEffect(() => {
    if (!project || profile?.role !== 'principal') return;
    getLaborPaymentSummary(project.id).then(setLaborSummary);
    getAttendanceByProject(project.id).then(setAttendance);
    getKasbonAging(project.id).then(setKasbonAging);
  }, [project, profile?.role]);

  const overallProgress = boqItems.length > 0
    ? Math.round(boqItems.reduce((s, b) => s + b.progress, 0) / boqItems.length)
    : 0;
  const pendingBerat = changeSummary?.pending_berat ?? 0;
  const openRework = changeSummary?.open_rework ?? 0;
  const handoverEligible = pendingBerat === 0 && openRework === 0;
  const openPOs = purchaseOrders.filter(po => po.status === 'OPEN' || po.status === 'PARTIAL_RECEIVED').length;
  const atRisk = milestones.filter(m => m.status === 'AT_RISK' || m.status === 'DELAYED').length;
  const delayedMilestones = milestones.filter(m => m.status === 'DELAYED').length;
  const completedMilestones = milestones.filter(m => m.status === 'COMPLETE').length;
  const baselinePublished = boqItems.length > 0;
  const nextMilestone = milestones
    .filter(m => m.status !== 'COMPLETE')
    .sort((a, b) => {
      const aDate = new Date(a.revised_date ?? a.planned_date).getTime();
      const bDate = new Date(b.revised_date ?? b.planned_date).getTime();
      return aDate - bDate;
    })[0] ?? null;
  const milestoneBadgeFlag = !baselinePublished
    ? 'INFO'
    : delayedMilestones > 0
    ? 'CRITICAL'
    : atRisk > 0
    ? 'WARNING'
    : milestones.length > 0
    ? 'OK'
    : 'INFO';
  const milestoneBadgeLabel = !baselinePublished
    ? 'Baseline belum publish'
    : delayedMilestones > 0
    ? 'Ada yang terlambat'
    : atRisk > 0
    ? 'Perlu perhatian'
    : milestones.length > 0
    ? 'Sehat'
    : 'Belum ada milestone';
  const isPrincipal = profile?.role === 'principal';

  const REPORTS: Array<{ type: ReportType; label: string; icon: string; filtered?: boolean }> = [
    { type: 'progress_summary', label: 'Ringkasan Progres', icon: 'trending-up' },
    { type: 'material_balance', label: 'Material Balance', icon: 'layers' },
    { type: 'receipt_log', label: 'Log Penerimaan', icon: 'receipt' },
    { type: 'site_change_log', label: 'Catatan Perubahan', icon: 'create' },
    { type: 'schedule_variance', label: 'Varians Jadwal', icon: 'calendar' },
    { type: 'weekly_digest', label: 'Rangkuman Mingguan', icon: 'newspaper' },
    { type: 'audit_list', label: 'Daftar Audit & Anomali', icon: 'shield-checkmark', filtered: true },
    ...(isPrincipal ? [
      { type: 'ai_usage_summary' as ReportType, label: 'Penggunaan AI per User', icon: 'sparkles', filtered: true },
      { type: 'approval_sla_user' as ReportType, label: 'Approval SLA per User', icon: 'time', filtered: true },
      { type: 'operational_entry_discipline' as ReportType, label: 'Disiplin Entry Operasional', icon: 'create', filtered: true },
      { type: 'tool_usage_summary' as ReportType, label: 'Penggunaan Laporan & AI', icon: 'analytics', filtered: true },
      { type: 'exception_handling_load' as ReportType, label: 'Beban Penanganan Exception', icon: 'warning', filtered: true },
    ] : []),
  ];

  // ── Full-screen takeovers for milestone authoring ────────────────────
  if (activeSection === 'jadwal-form') {
    return (
      <MilestoneFormScreen
        milestoneId={editingMilestoneId}
        onBack={() => { setEditingMilestoneId(null); setActiveSection('jadwal'); }}
      />
    );
  }
  if (activeSection === 'jadwal-ai-draft') {
    return <MilestoneAiDraftScreen onBack={() => setActiveSection('jadwal')} />;
  }
  if (activeSection === 'jadwal-ai-review') {
    return <MilestoneAiReviewScreen onBack={() => setActiveSection('jadwal')} />;
  }

  const sectionTabs: Array<{ key: Section; label: string; icon: string }> = [
    { key: 'overview', label: 'Ringkasan', icon: 'stats-chart' },
    { key: 'jadwal', label: 'Jadwal', icon: 'calendar' },
  ];

  return (
    <View style={styles.flex}>
      <Header />

      <View style={styles.tabRow} accessibilityRole="tablist">
        {sectionTabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeSection === tab.key && styles.tabActive]}
            onPress={() => setActiveSection(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeSection === tab.key }}
          >
            <Ionicons name={tab.icon as any} size={16} color={activeSection === tab.key ? COLORS.primary : COLORS.textSec} />
            <Text style={[styles.tabText, activeSection === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentMaxWidth != null && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth }]}>
        {activeSection === 'jadwal' && (
          <MilestonePanel
            embedded
            onOpenForm={(id) => {
              setEditingMilestoneId(id);
              setActiveSection('jadwal-form');
            }}
            onOpenAiDraft={() => setActiveSection('jadwal-ai-draft')}
            onOpenAiReview={() => setActiveSection('jadwal-ai-review')}
          />
        )}

        {activeSection === 'overview' && (<>
        <Text style={styles.sectionHead}>Laporan & Export</Text>

        {/* KPI row */}
        <View style={styles.statRow}>
          <StatTile value={`${overallProgress}%`} label="Progress" color={COLORS.accent} />
          <StatTile value={openPOs} label="PO Aktif" color={COLORS.warning} />
          <StatTile value={atRisk} label="Milestone Risiko" color={COLORS.critical} />
        </View>

        <Card
          title="Jadwal & Milestone"
          subtitle={baselinePublished
            ? 'Panel milestone ada di tab Jadwal. Ringkasan ini memberi akses cepat dari halaman laporan.'
            : 'Publikasikan baseline dulu untuk mulai menyusun milestone proyek.'
          }
          borderColor={delayedMilestones > 0 ? COLORS.critical : atRisk > 0 ? COLORS.warning : COLORS.info}
          rightAction={<Badge flag={milestoneBadgeFlag} label={milestoneBadgeLabel} />}
        >
          <View style={styles.kpiRow}>
            <View style={styles.kpiTile}>
              <Text style={[styles.kpiValue, { color: COLORS.info }]}>{milestones.length}</Text>
              <Text style={styles.kpiLabel}>Total Milestone</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={[styles.kpiValue, { color: COLORS.ok }]}>{completedMilestones}</Text>
              <Text style={styles.kpiLabel}>Selesai</Text>
            </View>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>At Risk / Delayed</Text>
            <Text style={[styles.metricValue, { color: atRisk > 0 ? COLORS.warning : COLORS.text }]}>
              {atRisk}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Milestone Berikutnya</Text>
            <Text style={[styles.metricValue, styles.metricValueFlexible]}>
              {nextMilestone
                ? `${nextMilestone.label} · ${new Date(nextMilestone.revised_date ?? nextMilestone.planned_date).toLocaleDateString('id-ID')}`
                : baselinePublished
                ? 'Belum ada milestone aktif'
                : 'Menunggu baseline'}
            </Text>
          </View>

          <TouchableOpacity style={styles.inlineActionBtn} onPress={() => setActiveSection('jadwal')}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.textInverse} />
            <Text style={styles.inlineActionBtnText}>Buka Panel Milestone</Text>
          </TouchableOpacity>
        </Card>

        {/* Handover eligibility */}
        <Card title="Status Serah Terima" borderColor={handoverEligible ? COLORS.ok : COLORS.critical}>
          <View style={[styles.eligibleBox, { backgroundColor: handoverEligible ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)' }]}>
            <Text style={[styles.eligibleLabel, { color: handoverEligible ? COLORS.ok : COLORS.critical }]}>
              {handoverEligible ? 'ELIGIBLE — Siap Serah Terima' : 'BELUM ELIGIBLE'}
            </Text>
            <Text style={styles.hint}>
              {handoverEligible ? 'Semua catatan perubahan berat dan rework terselesaikan.' : `${pendingBerat} berat, ${openRework} rework masih open.`}
            </Text>
          </View>
        </Card>

        {/* Catatan Perubahan summary */}
        <Card title="Ringkasan Catatan Perubahan">
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total Catatan</Text>
            <Text style={styles.metricValue}>{changeSummary?.total_count ?? 0}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Pending Review</Text>
            <Text style={[styles.metricValue, { color: COLORS.warning }]}>{changeSummary?.pending_count ?? 0}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Impact Berat</Text>
            <Text style={[styles.metricValue, { color: COLORS.critical }]}>{changeSummary?.pending_berat ?? 0}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Rework Belum Selesai</Text>
            <Text style={[styles.metricValue, { color: COLORS.warning }]}>{changeSummary?.open_rework ?? 0}</Text>
          </View>
        </Card>

        {isPrincipal ? (
          <>
            {/* ── Payment Summary ──────────────────────────────────────── */}
            <Card title="Ringkasan Pembayaran" subtitle={`${laborSummary.length} mandor aktif`}>
              {(() => {
                const totGross = laborSummary.reduce((s, m) => s + m.total_gross, 0);
                const totRetention = laborSummary.reduce((s, m) => s + m.total_retention, 0);
                const totPaid = laborSummary.reduce((s, m) => s + m.total_paid, 0);
                const totKasbon = laborSummary.reduce((s, m) => s + m.total_kasbon, 0);
                const totBudget = laborSummary.reduce((s, m) => s + m.total_contracted_budget, 0);
                const budgetUsed = totBudget > 0 ? Math.round((totGross / totBudget) * 100) : 0;
                return (
                  <>
                    <View style={styles.kpiRow}>
                      <View style={styles.kpiTile}>
                        <Text style={[styles.kpiValue, { color: COLORS.accent }]}>{formatRp(totGross)}</Text>
                        <Text style={styles.kpiLabel}>Total Gross</Text>
                      </View>
                      <View style={styles.kpiTile}>
                        <Text style={[styles.kpiValue, { color: COLORS.ok }]}>{formatRp(totPaid)}</Text>
                        <Text style={styles.kpiLabel}>Total Dibayar</Text>
                      </View>
                    </View>
                    <View style={styles.metricRow}>
                      <Text style={styles.metricLabel}>Retensi Ditahan</Text>
                      <Text style={[styles.metricValue, { color: COLORS.warning }]}>{formatRp(totRetention)}</Text>
                    </View>
                    <View style={styles.metricRow}>
                      <Text style={styles.metricLabel}>Kasbon Outstanding</Text>
                      <Text style={[styles.metricValue, { color: COLORS.critical }]}>{formatRp(totKasbon)}</Text>
                    </View>
                    <View style={styles.metricRow}>
                      <Text style={styles.metricLabel}>Budget Terpakai</Text>
                      <Text style={[styles.metricValue, { color: budgetUsed > 90 ? COLORS.critical : budgetUsed > 70 ? COLORS.warning : COLORS.ok }]}>{budgetUsed}%</Text>
                    </View>
                    {laborSummary.length > 0 && (
                      <>
                        <Text style={styles.subSectionHead}>Per Mandor</Text>
                        {laborSummary.map(m => {
                          const pct = m.total_contracted_budget > 0
                            ? Math.round((m.total_gross / m.total_contracted_budget) * 100)
                            : 0;
                          return (
                            <View key={m.contract_id} style={styles.mandorRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.mandorName}>{m.mandor_name}</Text>
                                <Text style={styles.mandorMeta}>
                                  {(m.trade_categories ?? []).join(', ')} · {m.approved_opname_count} opname
                                </Text>
                              </View>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={styles.mandorAmount}>{formatRp(m.total_paid)}</Text>
                                <Text style={[styles.mandorPct, { color: pct > 90 ? COLORS.critical : pct > 70 ? COLORS.warning : COLORS.textSec }]}>{pct}% budget</Text>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </>
                );
              })()}
            </Card>

            {/* ── Attendance Summary ───────────────────────────────────── */}
            <Card title="Ringkasan Absensi (HOK)">
              {(() => {
                const totalRecords = attendance.length;
                const totalHOK = attendance.reduce((s, a) => s + a.worker_count, 0);
                const totalAmount = attendance.reduce((s, a) => s + (a.line_total ?? a.worker_count * a.daily_rate), 0);
                const draftCount = attendance.filter(a => a.status === 'DRAFT').length;
                const verifiedCount = attendance.filter(a => a.status === 'VERIFIED').length;
                const settledCount = attendance.filter(a => a.status === 'SETTLED').length;
                return (
                  <>
                    <View style={styles.kpiRow}>
                      <View style={styles.kpiTile}>
                        <Text style={[styles.kpiValue, { color: COLORS.accent }]}>{totalHOK.toLocaleString('id-ID')}</Text>
                        <Text style={styles.kpiLabel}>Total HOK</Text>
                      </View>
                      <View style={styles.kpiTile}>
                        <Text style={[styles.kpiValue, { color: COLORS.info }]}>{formatRp(totalAmount)}</Text>
                        <Text style={styles.kpiLabel}>Total Biaya Harian</Text>
                      </View>
                    </View>
                    <View style={styles.metricRow}>
                      <Text style={styles.metricLabel}>Total Catatan</Text>
                      <Text style={styles.metricValue}>{totalRecords}</Text>
                    </View>
                    <View style={styles.statusRow}>
                      <View style={[styles.statusChip, { backgroundColor: 'rgba(158,158,158,0.12)' }]}>
                        <Text style={[styles.statusChipText, { color: COLORS.textSec }]}>Draft {draftCount}</Text>
                      </View>
                      <View style={[styles.statusChip, { backgroundColor: `${COLORS.info}15` }]}>
                        <Text style={[styles.statusChipText, { color: COLORS.info }]}>Verified {verifiedCount}</Text>
                      </View>
                      <View style={[styles.statusChip, { backgroundColor: `${COLORS.ok}15` }]}>
                        <Text style={[styles.statusChipText, { color: COLORS.ok }]}>Settled {settledCount}</Text>
                      </View>
                    </View>
                    {verifiedCount > 0 && (
                      <Text style={[styles.hint, { color: COLORS.warning }]}>
                        {verifiedCount} absensi sudah diverifikasi tapi belum masuk opname.
                      </Text>
                    )}
                  </>
                );
              })()}
            </Card>

            {/* ── Opname Summary ───────────────────────────────────────── */}
            <Card title="Ringkasan Opname Mingguan">
              {(() => {
                const totalOpname = laborSummary.reduce((s, m) => s + m.approved_opname_count, 0);
                const latestDate = laborSummary
                  .map(m => m.latest_approved_date)
                  .filter(Boolean)
                  .sort()
                  .reverse()[0];
                const avgVariance = laborSummary.length > 0
                  ? Math.round(laborSummary.reduce((s, m) => s + (m.contract_vs_boq_variance_pct ?? 0), 0) / laborSummary.length * 10) / 10
                  : 0;
                return (
                  <>
                    <View style={styles.kpiRow}>
                      <View style={styles.kpiTile}>
                        <Text style={[styles.kpiValue, { color: COLORS.accent }]}>{totalOpname}</Text>
                        <Text style={styles.kpiLabel}>Opname Disetujui</Text>
                      </View>
                      <View style={styles.kpiTile}>
                        <Text style={[styles.kpiValue, { color: Math.abs(avgVariance) > 10 ? COLORS.critical : Math.abs(avgVariance) > 5 ? COLORS.warning : COLORS.ok }]}>
                          {avgVariance > 0 ? '+' : ''}{avgVariance}%
                        </Text>
                        <Text style={styles.kpiLabel}>Avg Rate Variance</Text>
                      </View>
                    </View>
                    {latestDate && (
                      <View style={styles.metricRow}>
                        <Text style={styles.metricLabel}>Opname Terakhir</Text>
                        <Text style={styles.metricValue}>{new Date(latestDate).toLocaleDateString('id-ID')}</Text>
                      </View>
                    )}
                    {laborSummary.map(m => (
                      <View key={m.contract_id} style={styles.mandorRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mandorName}>{m.mandor_name}</Text>
                          <Text style={styles.mandorMeta}>
                            Minggu ke-{m.latest_approved_week ?? '—'} · {(m.trade_categories ?? []).join(', ')}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.mandorAmount}>{m.approved_opname_count}x</Text>
                          <Text style={[styles.mandorPct, {
                            color: Math.abs(m.contract_vs_boq_variance_pct ?? 0) > 10 ? COLORS.critical
                              : Math.abs(m.contract_vs_boq_variance_pct ?? 0) > 5 ? COLORS.warning : COLORS.textSec
                          }]}>
                            {(m.contract_vs_boq_variance_pct ?? 0) > 0 ? '+' : ''}{Math.round(m.contract_vs_boq_variance_pct ?? 0)}% var
                          </Text>
                        </View>
                      </View>
                    ))}
                  </>
                );
              })()}
            </Card>

            {/* ── Kasbon Aging ─────────────────────────────────────────── */}
            {kasbonAging.length > 0 && (
              <Card title={`${kasbonAging.length} Kasbon Belum Terpotong`} borderColor={COLORS.warning}>
                {kasbonAging.slice(0, 5).map(k => (
                  <View key={k.id} style={styles.mandorRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mandorName}>{k.mandor_name}</Text>
                      <Text style={styles.mandorMeta}>{k.age_days} hari · {k.opname_cycles_since} siklus opname</Text>
                    </View>
                    <Text style={[styles.mandorAmount, { color: COLORS.warning }]}>{formatRp(k.amount)}</Text>
                  </View>
                ))}
                {kasbonAging.length > 5 && (
                  <Text style={[styles.hint, { marginTop: SPACE.sm }]}>+{kasbonAging.length - 5} kasbon lainnya</Text>
                )}
              </Card>
            )}
          </>
        ) : (
          <Card title="Mandor & Opname" subtitle="Workflow borongan dan opname mingguan untuk estimator dan admin.">
            <View style={styles.workflowGrid}>
              <TouchableOpacity style={styles.workflowBtn} onPress={() => navigation.navigate('Mandor')}>
                <View style={[styles.workflowIcon, { backgroundColor: `${COLORS.info}15` }]}>
                  <Ionicons name="people" size={20} color={COLORS.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.workflowLabel}>Setup Mandor</Text>
                  <Text style={styles.workflowHint}>Kontrak, trade, dan rate borongan</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.workflowBtn} onPress={() => navigation.navigate('Opname')}>
                <View style={[styles.workflowIcon, { backgroundColor: `${COLORS.accent}20` }]}>
                  <Ionicons name="receipt" size={20} color={COLORS.accentDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.workflowLabel}>Opname Mingguan</Text>
                  <Text style={styles.workflowHint}>Create, verify, approve, dan export opname</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Export center */}
        <Card
          title="Export Center"
          subtitle="Semua laporan mencatat audit trail."
          rightAction={
            <TouchableOpacity style={styles.filterChip} onPress={() => setFilterModalVisible(true)}>
              <Ionicons name="calendar-outline" size={14} color={filterFrom || filterTo ? COLORS.primary : COLORS.textSec} />
              <Text style={[styles.filterChipText, (filterFrom || filterTo) && { color: COLORS.primary }]}>
                {filterFrom || filterTo ? 'Filter aktif' : 'Filter'}
              </Text>
            </TouchableOpacity>
          }
        >
          {(filterFrom || filterTo) && (
            <View style={styles.filterActiveBar}>
              <Ionicons name="funnel" size={12} color={COLORS.primary} />
              <Text style={styles.filterActiveText}>
                {filterFrom ? formatDisplayDate(filterFrom) : '—'} → {filterTo ? formatDisplayDate(filterTo) : 'sekarang'}
              </Text>
              <TouchableOpacity onPress={() => { setFilterFrom(''); setFilterTo(''); }}>
                <Ionicons name="close-circle" size={16} color={COLORS.textSec} />
              </TouchableOpacity>
            </View>
          )}
          {REPORTS.map(r => (
            <TouchableOpacity
              key={r.type}
              style={styles.exportRow}
              onPress={async () => {
                if (!project || !profile) return;
                try {
                  toast('Generating...', 'ok');
                  const filters: ReportFilters = r.filtered
                    ? { date_from: filterFrom || undefined, date_to: filterTo || undefined }
                    : {};
                  const payload = await generateReport(project.id, r.type, filters, {
                    viewerRole: profile.role,
                  });
                  await recordReportExport(project.id, profile.id, r.type, filters);
                  setReportPreview(payload);
                } catch (err: any) { toast(err.message, 'critical'); }
              }}
            >
              <Ionicons name={r.icon as any} size={18} color={COLORS.primary} />
              <Text style={styles.exportLabel}>{r.label}</Text>
              {r.filtered && <Ionicons name="funnel-outline" size={12} color={COLORS.textSec} />}
              <Ionicons name="download-outline" size={16} color={COLORS.textSec} />
            </TouchableOpacity>
          ))}
        </Card>
        </>)}
      </ScrollView>

      {/* Filter date-range modal */}
      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetEyebrow}>Filter Laporan</Text>
                <Text style={styles.sheetTitle}>Rentang Tanggal</Text>
                <Text style={[styles.sheetMeta, { marginTop: 4 }]}>Pilih rentang tanggal · Kosongkan untuk semua data</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setFilterModalVisible(false)}>
                <Ionicons name="close" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={{ gap: 12, marginTop: 12 }}>
              <View>
                <Text style={styles.filterLabel}>Dari tanggal</Text>
                <DateSelectField
                  value={filterFrom}
                  onChange={setFilterFrom}
                  placeholder="Pilih tanggal awal"
                  allowClear
                />
              </View>
              <View>
                <Text style={styles.filterLabel}>Sampai tanggal</Text>
                <DateSelectField
                  value={filterTo}
                  onChange={setFilterTo}
                  placeholder="Pilih tanggal akhir"
                  allowClear
                />
              </View>
              <TouchableOpacity style={styles.applyBtn} onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.applyBtnText}>Terapkan</Text>
              </TouchableOpacity>
              {(filterFrom || filterTo) && (
                <TouchableOpacity style={styles.clearBtn} onPress={() => { setFilterFrom(''); setFilterTo(''); setFilterModalVisible(false); }}>
                  <Text style={styles.clearBtnText}>Hapus Filter</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Preview modal */}
      <Modal visible={!!reportPreview} transparent animationType="slide" onRequestClose={() => setReportPreview(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetEyebrow}>Preview Laporan</Text>
                <Text style={styles.sheetTitle}>{reportPreview?.title}</Text>
                {reportPreview && <Text style={styles.sheetMeta}>{project?.name} · {formatTs(reportPreview.generated_at)}</Text>}
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setReportPreview(null)}>
                <Ionicons name="close" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            {reportPreview && (
              <>
                <ScrollView style={styles.codeBox} contentContainerStyle={{ padding: 14 }}>
                  <ReportPreview payload={reportPreview} />
                </ScrollView>
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={[styles.excelBtn, exportingFormat === 'pdf' && { opacity: 0.6 }]}
                    disabled={exportingFormat === 'pdf'}
                    onPress={async () => {
                      setExportingFormat('pdf');
                      try {
                        const { exportReportToPdf } = await import('../../tools/pdf');
                        await exportReportToPdf(reportPreview, project?.name);
                        toast('File PDF siap', 'ok');
                      } catch (err: any) {
                        toast(err.message ?? 'Gagal export PDF', 'critical');
                      } finally {
                        setExportingFormat(null);
                      }
                    }}
                  >
                    <Ionicons name="document-outline" size={16} color={COLORS.critical} />
                    <Text style={[styles.excelBtnText, { color: COLORS.critical }]}>{exportingFormat === 'pdf' ? 'Exporting...' : 'PDF'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.excelBtn, exportingFormat && { opacity: 0.6 }]}
                    disabled={!!exportingFormat}
                    onPress={async () => {
                      setExportingFormat('excel');
                      try {
                        const { exportReportToExcel } = await import('../../tools/excel');
                        await exportReportToExcel(reportPreview, project?.name);
                        toast('File Excel siap', 'ok');
                      } catch (err: any) {
                        toast(err.message ?? 'Gagal export Excel', 'critical');
                      } finally {
                        setExportingFormat(null);
                      }
                    }}
                  >
                    <Ionicons name="download-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.excelBtnText}>{exportingFormat === 'excel' ? 'Exporting...' : 'Excel'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.closeFullBtn, { flex: 1 }]} onPress={() => setReportPreview(null)}>
                    <Text style={styles.closeFullBtnText}>Tutup Preview</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  tabRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    backgroundColor: COLORS.bgOat,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.xs + 2,
    paddingVertical: SPACE.sm + 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(253,250,246,0.45)',
  },
  tabActive: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
  },
  tabText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.textSec },
  tabTextActive: { color: COLORS.primary },
  sectionHead: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.md - 2,
    marginTop: SPACE.xs,
  },
  statRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  eligibleBox: { padding: SPACE.md, borderRadius: RADIUS },
  eligibleLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold, letterSpacing: 0.5 },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 4 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACE.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  metricLabel: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec },
  metricValue: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  metricValueFlexible: { flex: 1, textAlign: 'right', paddingLeft: SPACE.md },
  // Principal summary cards
  kpiRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  kpiTile: {
    flex: 1,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: TYPE.base + 1,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  kpiLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 2,
  },
  subSectionHead: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginTop: SPACE.md,
    marginBottom: SPACE.sm,
  },
  mandorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  mandorName: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  mandorMeta: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: 1,
  },
  mandorAmount: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  mandorPct: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    marginTop: 1,
  },
  statusRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
    marginBottom: SPACE.xs,
  },
  statusChip: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs + 1,
    borderRadius: 999,
  },
  statusChipText: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
  },
  inlineActionBtn: {
    marginTop: SPACE.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.base,
  },
  inlineActionBtnText: {
    color: COLORS.textInverse,
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  workflowGrid: { gap: SPACE.sm },
  workflowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.base,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surface,
  },
  workflowIcon: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowLabel: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  workflowHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md - 2,
    paddingVertical: SPACE.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  exportLabel: { flex: 1, fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text, lineHeight: 21 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    backgroundColor: COLORS.surface,
  },
  filterChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  filterActiveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs + 2,
    backgroundColor: COLORS.infoBg,
    borderRadius: RADIUS,
    padding: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  filterActiveText: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.primary },
  filterLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: 4 },
  filterInput: {
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    borderRadius: RADIUS,
    padding: SPACE.md,
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    backgroundColor: COLORS.surfaceAlt,
  },
  applyBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  applyBtnText: {
    color: COLORS.textInverse,
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  clearBtn: {
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
  },
  clearBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  // Modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: SPACE.lg - 2,
    paddingTop: SPACE.lg - 2,
    paddingBottom: SPACE.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE.md,
    marginBottom: SPACE.sm,
  },
  sheetEyebrow: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.textSec,
  },
  sheetTitle: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text, marginTop: 4 },
  sheetMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  codeBox: {
    flexGrow: 0,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    marginBottom: SPACE.md + 2,
    padding: 4,
  },
  closeFullBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  closeFullBtnText: {
    color: COLORS.textInverse,
    fontSize: TYPE.base,
    fontFamily: FONTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modalBtnRow: { flexDirection: 'row', gap: SPACE.md - 2, alignItems: 'center' },
  excelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm - 2,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: RADIUS,
    paddingVertical: SPACE.base,
    paddingHorizontal: SPACE.base,
  },
  excelBtnText: { color: COLORS.primary, fontSize: TYPE.base, fontFamily: FONTS.semibold },
});
