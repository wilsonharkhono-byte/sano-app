import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Modal, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import StatTile from '../../workflows/components/StatTile';
import Badge from '../../workflows/components/Badge';
import DateSelectField, { formatDisplayDate } from '../../workflows/components/DateSelectField';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import { generateReport, recordReportExport, type ReportPayload, type ReportType, type ReportFilters } from '../../tools/reports';
import { exportReportToExcel } from '../../tools/excel';
import { exportReportToPdf } from '../../tools/pdf';
import { ReportPreview } from '../../workflows/components/ReportPreview';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';


function formatTs(v: string) {
  return new Date(v).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function OfficeReportsScreen() {
  const navigation = useNavigation<any>();
  const { project, profile, boqItems, purchaseOrders, defects, milestones } = useProject();
  const { show: toast } = useToast();
  const { width } = useWindowDimensions();
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop ? MAX_CONTENT_WIDTH.desktop : isTablet ? MAX_CONTENT_WIDTH.tablet : undefined;
  const [reportPreview, setReportPreview] = useState<ReportPayload | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'excel' | 'pdf' | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const overallProgress = boqItems.length > 0
    ? Math.round(boqItems.reduce((s, b) => s + b.progress, 0) / boqItems.length)
    : 0;
  const openDefects = defects.filter(d => !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(d.status)).length;
  const critOpen = defects.filter(d => d.severity === 'Critical' && !['VERIFIED', 'ACCEPTED_BY_PRINCIPAL'].includes(d.status)).length;
  const majorOpen = defects.filter(d => d.severity === 'Major' && ['OPEN', 'VALIDATED', 'IN_REPAIR'].includes(d.status)).length;
  const handoverEligible = critOpen === 0 && majorOpen === 0;
  const openPOs = purchaseOrders.filter(po => po.status === 'OPEN' || po.status === 'PARTIAL_RECEIVED').length;
  const atRisk = milestones.filter(m => m.status === 'AT_RISK' || m.status === 'DELAYED').length;
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

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentMaxWidth != null && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth }]}>
        <Text style={styles.sectionHead}>Laporan & Export</Text>

        {/* KPI row */}
        <View style={styles.statRow}>
          <StatTile value={`${overallProgress}%`} label="Progress" color={COLORS.accent} />
          <StatTile value={openPOs} label="PO Aktif" color={COLORS.warning} />
          <StatTile value={atRisk} label="Milestone Risiko" color={COLORS.critical} />
        </View>

        {/* Handover eligibility */}
        <Card title="Status Serah Terima" borderColor={handoverEligible ? COLORS.ok : COLORS.critical}>
          <View style={[styles.eligibleBox, { backgroundColor: handoverEligible ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)' }]}>
            <Text style={[styles.eligibleLabel, { color: handoverEligible ? COLORS.ok : COLORS.critical }]}>
              {handoverEligible ? 'ELIGIBLE — Siap Serah Terima' : 'BELUM ELIGIBLE'}
            </Text>
            <Text style={styles.hint}>
              {handoverEligible ? 'Semua Critical dan Major terselesaikan.' : `${critOpen} Critical, ${majorOpen} Major masih open.`}
            </Text>
          </View>
        </Card>

        {/* Defect breakdown */}
        <Card title="Ringkasan Cacat">
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total Open</Text>
            <Text style={[styles.metricValue, { color: COLORS.critical }]}>{openDefects}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Critical Open</Text>
            <Text style={[styles.metricValue, { color: COLORS.critical }]}>{critOpen}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Major Open</Text>
            <Text style={[styles.metricValue, { color: COLORS.warning }]}>{majorOpen}</Text>
          </View>
        </Card>

        <Card title="Mandor & Opname" subtitle="Workflow borongan dan opname mingguan untuk estimator, admin, dan prinsipal.">
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
