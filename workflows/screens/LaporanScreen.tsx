import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import Header from '../components/Header';
import Card from '../components/Card';
import StatTile from '../components/StatTile';
import Badge from '../components/Badge';
import PhotoGalleryField from '../components/PhotoGalleryField';
import BaselineScreen from './BaselineScreen';
import Gate2Screen from './Gate2Screen';
import MaterialCatalogScreen from './MaterialCatalogScreen';
import MandorSetupScreen from './MandorSetupScreen';
import OpnameScreen from './OpnameScreen';
import AttendanceScreen from './AttendanceScreen';
import { MilestonePanel } from './MilestoneScreen';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { isPositiveNumber, isNonEmpty, sanitizeText } from '../../tools/validation';
import { pickAndUploadPhoto } from '../../tools/storage';
import { supabase } from '../../tools/supabase';
import { generateReport, recordReportExport, type ReportPayload, type ReportType, type ReportFilters } from '../../tools/reports';
import { exportReportToExcel } from '../../tools/excel';
import { exportReportToPdf } from '../../tools/pdf';
import { ReportPreview } from '../components/ReportPreview';
import { deriveMaterialBalance } from '../../tools/derivation';
import { getProjectTeam, type TeamMember, ROLE_LABELS } from '../../tools/projectManagement';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

type Section = 'overview' | 'mtn' | 'baseline' | 'gate2' | 'jadwal' | 'katalog' | 'mandor' | 'opname' | 'attendance';

// ── Report preview renderers ──────────────────────────────────────────────────



function formatReportTimestamp(value: string) {
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LaporanScreen() {
  const route = useRoute<any>();
  const { project, profile, boqItems, purchaseOrders, defects, milestones, refresh } = useProject();
  const { show: toast } = useToast();
  const [activeSection, setActiveSection] = useState<Section>(route.params?.initialSection ?? 'overview');
  const [focusedContractId, setFocusedContractId] = useState<string | undefined>(route.params?.contractId);
  const [detailBackSection, setDetailBackSection] = useState<'overview' | 'mandor'>('overview');
  const [reportPreview, setReportPreview] = useState<ReportPayload | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'excel' | 'pdf' | null>(null);
  const [materialBalanceSummary, setMaterialBalanceSummary] = useState<{
    total: number;
    lowStock: number;
    deficit: number;
  } | null>(null);

  useEffect(() => {
    const nextSection = route.params?.initialSection as Section | undefined;
    if (nextSection) {
      setActiveSection(nextSection);
    }
  }, [route.params?.initialSection]);

  useEffect(() => {
    if (route.params?.contractId) {
      setFocusedContractId(route.params.contractId);
    }
  }, [route.params?.contractId]);

  // Team state
  const [projectTeam, setProjectTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (!project) return;
    getProjectTeam(project.id).then(setProjectTeam).catch(() => {});
  }, [project?.id]);

  // MTN state — balance-driven
  const [mtnMaterialId, setMtnMaterialId] = useState('');
  const [mtnMat, setMtnMat] = useState('');        // name of selected material
  const [mtnUnit, setMtnUnit] = useState('');       // auto-filled from material
  const [mtnAvailable, setMtnAvailable] = useState<number | null>(null);
  const [mtnQty, setMtnQty] = useState('');
  const [mtnDest, setMtnDest] = useState('');      // destination project id
  const [mtnReason, setMtnReason] = useState('');
  const [mtnPhotos, setMtnPhotos] = useState<string[]>([]);
  const [mtnBalances, setMtnBalances] = useState<Array<{ id: string; name: string; unit: string; on_site: number }>>([]);
  const { projects } = useProject();

  // Report metrics
  const overallProgress = boqItems.length > 0
    ? Math.round(boqItems.reduce((s, b) => s + b.progress, 0) / boqItems.length)
    : 0;
  const completedItems = boqItems.filter(b => b.progress >= 100).length;
  const openDefects = defects.filter(d => d.status === 'OPEN' || d.status === 'VALIDATED' || d.status === 'IN_REPAIR').length;

  const openPOs = purchaseOrders.filter(po => po.status === 'OPEN' || po.status === 'PARTIAL_RECEIVED').length;

  // Punch list / handover eligibility
  const critOpen = defects.filter(d => d.status === 'OPEN' && d.severity === 'Critical').length;
  const majorOpen = defects.filter(d => ['OPEN', 'VALIDATED', 'IN_REPAIR'].includes(d.status) && d.severity === 'Major').length;
  const handoverEligible = critOpen === 0 && majorOpen === 0;

  // Load material balances when MTN tab is opened
  const loadMtnBalances = useCallback(async () => {
    if (!project) return;
    try {
      const balances = await deriveMaterialBalance(project.id);
      setMtnBalances(
        balances
          .filter(balance => balance.material_id && balance.on_site > 0)
          .map(balance => ({
            id: balance.material_id ?? '',
            name: balance.material_name,
            unit: balance.unit,
            on_site: balance.on_site,
          })),
      );
    } catch (err: any) {
      console.warn('MTN balance load failed:', err.message);
    }
  }, [project]);

  useEffect(() => {
    if (activeSection === 'mtn') {
      loadMtnBalances();
    }
  }, [activeSection, loadMtnBalances]);

  useEffect(() => {
    if (!project) return;
    deriveMaterialBalance(project.id)
      .then((balances) => {
        setMaterialBalanceSummary({
          total: balances.length,
          lowStock: balances.filter((item) => item.on_site <= Math.max(item.planned * 0.1, 0)).length,
          deficit: balances.filter((item) => item.on_site < 0).length,
        });
      })
      .catch((err) => {
        console.warn('Material balance summary failed:', err?.message ?? err);
        setMaterialBalanceSummary(null);
      });
  }, [project]);

  const handleMTN = async () => {
    if (!mtnMat || !isPositiveNumber(mtnQty) || !mtnDest || mtnPhotos.length === 0) {
      toast('Lengkapi semua field MTN', 'critical'); return;
    }
    const destProject = projects.find(p => p.id === mtnDest);
    const qty = parseFloat(mtnQty);
    const isOverBalance = mtnAvailable !== null && qty > mtnAvailable;

    try {
      const { data: mtnRequest, error } = await supabase.from('mtn_requests').insert({
        project_id: project!.id,
        requested_by: profile!.id,
        material_name: mtnMat,
        material_id: mtnMaterialId || null,
        quantity: qty,
        unit: mtnUnit || null,
        destination_project_id: destProject?.id ?? null,
        destination_project: destProject?.name ?? mtnDest,
        reason: sanitizeText(mtnReason),
        photo_path: mtnPhotos[0] ?? null,
        status: 'AWAITING',
      }).select('id').single();
      if (error || !mtnRequest) throw error ?? new Error('MTN insert failed');

      if (mtnPhotos.length > 0) {
        const { error: photoError } = await supabase.from('mtn_photos').insert(
          mtnPhotos.map((path) => ({
            mtn_request_id: mtnRequest.id,
            storage_path: path,
            captured_at: new Date().toISOString(),
          })),
        );
        if (photoError) throw photoError;
      }

      await supabase.from('activity_log').insert({
        project_id: project!.id, user_id: profile!.id,
        type: 'mtn',
        label: `MTN ${mtnMat} ${qty} ${mtnUnit} → ${destProject?.name ?? mtnDest}${isOverBalance ? ' [MELEBIHI SALDO]' : ''}`,
        flag: isOverBalance ? 'WARNING' : 'INFO',
      });

      if (isOverBalance) {
        toast('MTN dikirim — perhatian: melebihi saldo tersedia', 'warning');
      } else {
        toast('MTN dikirim ke Estimator untuk persetujuan', 'ok');
      }
      setMtnMaterialId(''); setMtnMat(''); setMtnUnit(''); setMtnAvailable(null);
      setMtnQty(''); setMtnDest(''); setMtnReason(''); setMtnPhotos([]);
      await refresh();
    } catch (err: any) { Alert.alert('Error', err.message); }
  };

  const handlePhotoMTN = async (replaceIndex?: number) => {
    try {
      const path = await pickAndUploadPhoto(`mtn/${project!.id}`);
      if (!path) return;
      setMtnPhotos(prev => {
        if (replaceIndex == null || replaceIndex < 0 || replaceIndex >= prev.length) {
          return [...prev, path];
        }
        return prev.map((photo, index) => (index === replaceIndex ? path : photo));
      });
      toast(replaceIndex == null ? 'Foto MTN ditambahkan' : 'Foto MTN diganti', 'ok');
    } catch (err: any) { toast(err.message, 'critical'); }
  };

  const removePhotoMTN = (index: number) => {
    setMtnPhotos(prev => prev.filter((_, photoIndex) => photoIndex !== index));
    toast('Foto dihapus', 'warning');
  };

  const handleHandover = () => {
    toast('Permintaan serah terima dikirim ke Prinsipal untuk persetujuan akhir', 'ok');
  };

  // Show BaselineScreen as full takeover when selected
  if (activeSection === 'baseline') {
    return <BaselineScreen onBack={() => setActiveSection('overview')} />;
  }

  // Show Gate2Screen as full takeover when selected
  if (activeSection === 'gate2') {
    return <Gate2Screen onBack={() => setActiveSection('overview')} />;
  }

  // Show MaterialCatalogScreen as full takeover when selected
  if (activeSection === 'katalog') {
    return <MaterialCatalogScreen onBack={() => setActiveSection('overview')} />;
  }

  // Show MandorSetupScreen as full takeover when selected
  if (activeSection === 'mandor') {
    return (
      <MandorSetupScreen
        onBack={() => setActiveSection('overview')}
        onOpenOpnameContract={(contract) => {
          setFocusedContractId(contract.id);
          setDetailBackSection('mandor');
          setActiveSection('opname');
        }}
        onOpenAttendanceContract={(contract) => {
          setFocusedContractId(contract.id);
          setDetailBackSection('mandor');
          setActiveSection('attendance');
        }}
      />
    );
  }

  // Show OpnameScreen as full takeover when selected
  if (activeSection === 'opname') {
    return (
      <OpnameScreen
        onBack={() => setActiveSection(detailBackSection)}
        initialContractId={focusedContractId}
      />
    );
  }

  // Show AttendanceScreen as full takeover when selected
  if (activeSection === 'attendance') {
    return (
      <AttendanceScreen
        onBack={() => setActiveSection(detailBackSection)}
        initialContractId={focusedContractId}
      />
    );
  }

  const isEstimatorOrAdmin = profile?.role === 'estimator' || profile?.role === 'admin' || profile?.role === 'principal';
  const isSupervisor = profile?.role === 'supervisor';

  const tabs: Array<{ key: Section; label: string; icon: string }> = [
    { key: 'overview', label: 'Ringkasan', icon: 'stats-chart' },
    { key: 'jadwal', label: 'Jadwal', icon: 'calendar' },
    { key: 'mtn', label: 'MTN', icon: 'swap-horizontal' },
    ...(isSupervisor ? [
      { key: 'attendance' as Section, label: 'Absensi', icon: 'people' },
    ] : []),
    ...(isEstimatorOrAdmin ? [
      { key: 'gate2' as Section, label: 'Harga', icon: 'pricetag' },
      { key: 'baseline' as Section, label: 'Baseline', icon: 'layers' },
      { key: 'katalog' as Section, label: 'Katalog', icon: 'cube' },
      { key: 'mandor' as Section, label: 'Mandor', icon: 'people' },
    ] : []),
  ];

  return (
    <View style={styles.flex}>
      <Header />

      {/* Section tabs */}
      <View style={styles.tabRow} accessibilityRole="tablist">
        {tabs.map(tab => (
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

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {activeSection === 'overview' && (
          <>
            <Text style={styles.sectionHead}>Gate 5 — Laporan & Rekonsiliasi</Text>

            <View style={styles.statRow}>
              <StatTile value={`${overallProgress}%`} label="Progress" color={COLORS.accent} />
              <StatTile value={completedItems} label="Selesai" color={COLORS.ok} />
              <StatTile value={openDefects} label="Perubahan Open" color={COLORS.critical} />
            </View>

            {/* Material status */}
            <Card title="Status Material">
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>PO Aktif</Text>
                <Text style={styles.metricValue}>{openPOs}</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Material Terhitung</Text>
                <Text style={styles.metricValue}>{materialBalanceSummary?.total ?? 0}</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Perlu Pengadaan</Text>
                <Text style={[styles.metricValue, { color: COLORS.warning }]}>{materialBalanceSummary?.lowStock ?? 0}</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Defisit On-Site</Text>
                <Text style={[styles.metricValue, { color: COLORS.critical }]}>{materialBalanceSummary?.deficit ?? 0}</Text>
              </View>
              <Text style={styles.hint}>Gunakan export Material Balance untuk melihat planned, received, installed, dan saldo material per item.</Text>
            </Card>

            {/* Milestone summary */}
            <Card title="Status Milestone">
              {milestones.length > 0 ? milestones.map(m => (
                <View key={m.id} style={styles.milestoneRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.milestoneLabel}>{m.label}</Text>
                    <Text style={styles.hint}>{new Date(m.planned_date).toLocaleDateString('id-ID')}</Text>
                  </View>
                  <Badge
                    flag={m.status === 'ON_TRACK' || m.status === 'AHEAD' ? 'OK' : m.status === 'AT_RISK' ? 'WARNING' : m.status === 'DELAYED' ? 'CRITICAL' : 'INFO'}
                    label={m.status.replace('_', ' ')}
                  />
                </View>
              )) : (
                <Text style={styles.hint}>Belum ada milestone. Akan tersedia setelah baseline import.</Text>
              )}
            </Card>

            {/* Tim Proyek */}
            <Card title="Tim Proyek">
              {projectTeam.length === 0 ? (
                <Text style={styles.hint}>Belum ada anggota tercatat.</Text>
              ) : (
                projectTeam.map(member => (
                  <View key={member.assignment_id} style={styles.teamRow}>
                    <View style={styles.teamAvatar}>
                      <Text style={styles.teamAvatarText}>
                        {member.full_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teamName}>{member.full_name}</Text>
                      <Text style={styles.teamRole}>{ROLE_LABELS[member.role] ?? member.role}</Text>
                    </View>
                  </View>
                ))
              )}
            </Card>

            {/* Handover eligibility */}
            <Card title="Status Serah Terima" borderColor={handoverEligible ? COLORS.ok : COLORS.critical}>
              <View style={[styles.eligibleBox, { backgroundColor: handoverEligible ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)' }]}>
                <Text style={[styles.eligibleLabel, { color: handoverEligible ? COLORS.ok : COLORS.critical }]}>
                  {handoverEligible ? 'ELIGIBLE — Siap Serah Terima' : 'BELUM ELIGIBLE'}
                </Text>
                <Text style={styles.hint}>
                  {handoverEligible
                    ? 'Semua Critical dan Major telah diselesaikan.'
                    : `${critOpen} Critical open, ${majorOpen} Major open/in repair.`}
                </Text>
              </View>
              {handoverEligible && (
                <TouchableOpacity style={styles.accentBtn} onPress={handleHandover}>
                  <Text style={styles.accentBtnText}>Ajukan Serah Terima ke Prinsipal</Text>
                </TouchableOpacity>
              )}
            </Card>

            {/* Export Center */}
            <Card
              title="Export Center"
              subtitle="Generate laporan proyek. Data akan disimpan untuk audit trail."
            >
              {([
                { type: 'progress_summary' as ReportType, label: 'Ringkasan Progres', icon: 'trending-up', filtered: false },
                { type: 'material_balance' as ReportType, label: 'Material Balance', icon: 'layers', filtered: false },
                { type: 'receipt_log' as ReportType, label: 'Log Penerimaan', icon: 'receipt', filtered: false },
                { type: 'site_change_log' as ReportType, label: 'Catatan Perubahan', icon: 'create', filtered: false },
                { type: 'schedule_variance' as ReportType, label: 'Varians Jadwal', icon: 'calendar', filtered: false },
                { type: 'weekly_digest' as ReportType, label: 'Rangkuman Mingguan', icon: 'newspaper', filtered: false },
              ]).map(r => (
                <TouchableOpacity
                  key={r.type}
                  style={styles.exportRow}
                  onPress={async () => {
                    if (!project || !profile) return;
                    try {
                      toast('Generating...', 'ok');
                      const filters: ReportFilters = {};
                      const payload = await generateReport(project.id, r.type, filters, {
                        viewerRole: profile.role,
                      });
                      await recordReportExport(project.id, profile.id, r.type, filters);
                      setReportPreview(payload);
                      toast('Preview laporan siap', 'ok');
                    } catch (err: any) { toast(err.message, 'critical'); }
                  }}
                >
                  <Ionicons name={r.icon as any} size={18} color={COLORS.primary} />
                  <Text style={styles.exportLabel}>{r.label}</Text>
                  {r.filtered && <Ionicons name="funnel-outline" size={12} color={COLORS.textSec} />}
                  <Ionicons name="download" size={16} color={COLORS.textSec} />
                </TouchableOpacity>
              ))}
            </Card>
          </>
        )}

        {activeSection === 'mtn' && (
          <>
            <Text style={styles.sectionHead}>MTN — Nota Transfer Material</Text>
            <Card title="Transfer Material Antar Proyek" subtitle="Material berlebih dipindah ke proyek lain atas persetujuan Estimator.">

              {/* Material dropdown — from balance */}
              <Text style={styles.label}>Material <Text style={styles.req}>*</Text></Text>
              {mtnBalances.length > 0 ? (
                <>
                  <View style={styles.pickerWrap}>
                    <Picker
                      selectedValue={mtnMaterialId}
                      onValueChange={val => {
                        setMtnMaterialId(val);
                        const b = mtnBalances.find(m => m.id === val);
                        if (b) { setMtnMat(b.name); setMtnUnit(b.unit); setMtnAvailable(b.on_site); }
                        else { setMtnMat(''); setMtnUnit(''); setMtnAvailable(null); }
                      }}
                      style={{ color: COLORS.text }}
                    >
                      <Picker.Item label="-- Pilih material --" value="" />
                      {mtnBalances.map(b => (
                        <Picker.Item key={b.id} label={`${b.name} (${b.on_site.toFixed(1)} ${b.unit} tersedia)`} value={b.id} />
                      ))}
                    </Picker>
                  </View>
                  {mtnAvailable !== null && (
                    <Text style={styles.hint}>Saldo di site: {mtnAvailable.toFixed(2)} {mtnUnit}</Text>
                  )}
                </>
              ) : (
                <>
                  <TextInput style={styles.input} value={mtnMat} onChangeText={setMtnMat} placeholder="Nama material (baseline belum tersedia)" />
                  <TouchableOpacity onPress={loadMtnBalances} style={{ marginTop: 4 }}>
                    <Text style={[styles.hint, { color: COLORS.info }]}>Muat saldo material →</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Quantity + unit */}
              <View style={styles.row2}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>Jumlah <Text style={styles.req}>*</Text></Text>
                  <TextInput
                    style={[styles.input, mtnAvailable !== null && parseFloat(mtnQty) > mtnAvailable ? { borderColor: COLORS.warning } : null]}
                    keyboardType="numeric"
                    value={mtnQty}
                    onChangeText={setMtnQty}
                    placeholder="0"
                  />
                  {mtnAvailable !== null && parseFloat(mtnQty) > mtnAvailable && (
                    <Text style={[styles.hint, { color: COLORS.warning }]}>Melebihi saldo — masih bisa dikirim, Estimator akan dapat peringatan</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Satuan</Text>
                  <TextInput style={[styles.input, { color: COLORS.textSec }]} value={mtnUnit} editable={false} placeholder="—" />
                </View>
              </View>

              {/* Destination project — dropdown from assigned projects */}
              <Text style={styles.label}>Proyek Tujuan <Text style={styles.req}>*</Text></Text>
              {projects.filter(p => p.id !== project?.id).length > 0 ? (
                <View style={styles.pickerWrap}>
                  <Picker selectedValue={mtnDest} onValueChange={setMtnDest} style={{ color: COLORS.text }}>
                    <Picker.Item label="-- Pilih proyek tujuan --" value="" />
                    {projects.filter(p => p.id !== project?.id).map(p => (
                      <Picker.Item key={p.id} label={`${p.code} — ${p.name}`} value={p.id} />
                    ))}
                  </Picker>
                </View>
              ) : (
                <TextInput style={styles.input} value={mtnDest} onChangeText={setMtnDest} placeholder="Nama / kode proyek tujuan" />
              )}

              <Text style={styles.label}>Alasan</Text>
              <TextInput style={[styles.input, styles.textarea]} value={mtnReason} onChangeText={setMtnReason} multiline placeholder="Alasan transfer..." />
              <Text style={styles.label}>Foto Material <Text style={styles.req}>*</Text></Text>
              <PhotoGalleryField
                photoPaths={mtnPhotos}
                onAdd={() => handlePhotoMTN()}
                onReplace={handlePhotoMTN}
                onRemove={removePhotoMTN}
                emptyLabel="Tambah Foto MTN"
                helperText="Tambah beberapa foto material, kondisi stok, atau area loading untuk memperjelas transfer."
              />
              <TouchableOpacity style={[styles.btn, { marginTop: 12 }]} onPress={handleMTN}>
                <Text style={styles.btnText}>Kirim MTN</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}

        {activeSection === 'jadwal' && (
          <MilestonePanel embedded onBack={() => setActiveSection('overview')} />
        )}
      </ScrollView>

      <Modal
        visible={!!reportPreview}
        transparent
        animationType="slide"
        onRequestClose={() => setReportPreview(null)}
      >
        <View style={styles.previewBackdrop}>
          <View style={styles.previewSheet}>
            <View style={styles.previewHeader}>
              <View style={styles.previewHeaderCopy}>
                <Text style={styles.previewEyebrow}>Preview Laporan</Text>
                <Text style={styles.previewTitle}>{reportPreview?.title}</Text>
                {reportPreview ? (
                  <Text style={styles.previewMeta}>
                    {project?.name ?? 'Proyek aktif'} · {formatReportTimestamp(reportPreview.generated_at)}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity style={styles.previewClose} onPress={() => setReportPreview(null)}>
                <Ionicons name="close" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {reportPreview ? (
              <>
                <ScrollView style={styles.previewBody} contentContainerStyle={styles.previewBodyContent}>
                  <ReportPreview payload={reportPreview} />
                </ScrollView>
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    style={[styles.exportBtnSecondary, exportingFormat && { opacity: 0.6 }]}
                    disabled={!!exportingFormat}
                    onPress={async () => {
                      if (!reportPreview) return;
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
                    <Text style={[styles.exportBtnSecondaryText, { color: COLORS.critical }]}>
                      {exportingFormat === 'pdf' ? 'Exporting...' : 'PDF'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.exportBtnSecondary, exportingFormat && { opacity: 0.6 }]}
                    disabled={!!exportingFormat}
                    onPress={async () => {
                      if (!reportPreview) return;
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
                    <Text style={styles.exportBtnSecondaryText}>
                      {exportingFormat === 'excel' ? 'Exporting...' : 'Excel'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={() => setReportPreview(null)}>
                    <Text style={styles.btnText}>Tutup Preview</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxl },

  tabRow:        { flexDirection: 'row', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs + 2, paddingVertical: SPACE.md },
  tabActive:     { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText:       { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', color: COLORS.textSec },
  tabTextActive: { color: COLORS.primary },

  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 1,
    textTransform: 'uppercase', color: COLORS.textSec,
    marginBottom: SPACE.sm + 2, marginTop: SPACE.base,
  },
  statRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },

  metricRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  metricLabel:  { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  metricValue:  { fontSize: TYPE.sm, fontFamily: FONTS.bold },

  milestoneRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.md - 2, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  milestoneLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold },

  hint:         { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  eligibleBox:  { padding: SPACE.md, borderRadius: RADIUS, marginBottom: SPACE.sm + 2 },
  eligibleLabel:{ fontSize: TYPE.sm, fontFamily: FONTS.bold, letterSpacing: 0.5 },

  accentBtn:     { backgroundColor: COLORS.accent, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  accentBtnText: { color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },

  label:    { fontSize: TYPE.sm, fontFamily: FONTS.medium, marginBottom: SPACE.xs + 2, marginTop: SPACE.md },
  req:      { color: COLORS.critical },
  input:    { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  row2:     { flexDirection: 'row', gap: SPACE.md - 2 },

  exportRow:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.md - 2, paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  exportLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium },
  pickerWrap:  { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, marginBottom: 2 },

  btn:          { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, alignItems: 'center' },
  btnText:      { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  modalBtnRow:  { flexDirection: 'row', gap: SPACE.md - 2, alignItems: 'center' },
  exportBtnSecondary: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs + 2, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.base, paddingHorizontal: SPACE.base },
  exportBtnSecondaryText: { color: COLORS.primary, fontSize: TYPE.sm, fontFamily: FONTS.semibold },

  // Filter chip + active bar
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border },
  filterChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  filterActiveBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,102,204,0.07)', borderRadius: 8, padding: 8, marginBottom: 8 },
  filterActiveText: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.primary },
  // Filter modal inputs
  filterLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: 4 },
  filterInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 12, fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, backgroundColor: COLORS.surfaceAlt },
  filterApplyBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: 14, alignItems: 'center' },
  filterApplyText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  filterClearBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 12, alignItems: 'center' },
  filterClearText: { color: COLORS.textSec, fontSize: TYPE.sm, fontFamily: FONTS.regular },

  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  previewSheet: {
    maxHeight: '86%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: SPACE.lg,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  previewHeaderCopy: { flex: 1 },
  previewEyebrow: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.xs + 2,
  },
  previewTitle: {
    fontSize: TYPE.lg,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  previewMeta: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginTop: SPACE.xs + 2,
  },
  previewClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewHint: {
    marginTop: SPACE.md,
    marginBottom: SPACE.md,
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    lineHeight: 18,
    color: COLORS.textSec,
  },
  previewBody: {
    flexGrow: 0,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.borderSub,
    marginBottom: SPACE.sm + 6,
  },
  previewBodyContent: {
    padding: 14,
  },
  previewCode: {
    fontSize: TYPE.xs,
    lineHeight: 18,
    color: COLORS.text,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },

  // Tim Proyek
  teamRow:        { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  teamAvatar:     { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.accentBg, alignItems: 'center', justifyContent: 'center' },
  teamAvatarText: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.primary },
  teamName:       { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  teamRole:       { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2, textTransform: 'capitalize' },
});
