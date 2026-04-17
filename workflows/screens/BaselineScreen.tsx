import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Header from '../components/Header';
import Card from '../components/Card';
import Badge from '../components/Badge';
import AuditTraceScreen from './AuditTraceScreen';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { readPickedWorkbook } from '../utils/workbookPicker';
import {
  getProjectImportSessions,
  getStagingRows,
  reviewStagingRow,
  publishBaseline,
  generateMaterialMaster,
  createImportSession,
  parseAndStageWorkbook,
  getImportAnomalies,
  resolveAnomaly,
  deleteImportSession,
} from '../../tools/baseline';
import { parseBoqWorkbook, applyBoqGrouping, type ParsedWorkbook } from '../../tools/excelParser';
import { applyAIBoqGrouping } from '../../tools/ai-assist';
import { supabase } from '../../tools/supabase';
import type { ImportSession, ImportStagingRow, ImportAnomaly } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';

type ScreenView = 'sessions' | 'review' | 'anomalies' | 'detail';

/**
 * Enumerated values used by the correction editor for material rows.
 * Tier is constrained by the DB check (1, 2, 3); unit and category are
 * free-text in the schema but we restrict the editor to the in-use set
 * from the material_master seed so estimators can't invent new variants
 * every import.
 */
const MATERIAL_TIER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Tier 1 — Precise' },
  { value: '2', label: 'Tier 2 — Bulk' },
  { value: '3', label: 'Tier 3 — Consumables' },
];

const MATERIAL_UNIT_OPTIONS: string[] = [
  'pcs', 'btg', 'lbr', 'set', 'bh', 'unit',
  'kg', 'ton', 'zak', 'sak', 'pail', 'liter',
  'm', 'm2', 'm3', 'roll', 'ls',
];

const MATERIAL_CATEGORY_OPTIONS: string[] = [
  'Struktur',
  'Material Beton',
  'Kayu & Bekisting',
  'Dinding',
  'Atap',
  'Finishing & Coating',
  'Lantai & Dinding Finishing',
  'Plafon & Partisi',
  'Waterproofing',
  'Elektrikal',
  'Plumbing',
  'Earthwork',
];

const MATERIAL_DROPDOWNS: Record<string, string[]> = {
  tier: MATERIAL_TIER_OPTIONS.map(o => o.value),
  unit: MATERIAL_UNIT_OPTIONS,
  category: MATERIAL_CATEGORY_OPTIONS,
};

interface ParsePreview {
  fileName: string;
  rabSheets: string[];
  ahsSheet: string | null;
  materialSheet: string | null;
  boqCount: number;
  ahsCount: number;
  materialCount: number;
  anomalyCount: number;
  boqSample: Array<{
    code: string;
    label: string;
    unit: string;
    volume: number;
    sourceSheet: string;
    sourceRow: number;
  }>;
  anomalySample: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
}

function buildLocalImportPath(projectId: string, fileName: string) {
  return `local-import://${projectId}/${Date.now()}_${fileName}`;
}

function buildParsePreview(fileName: string, parsed: ParsedWorkbook): ParsePreview {
  return {
    fileName,
    rabSheets: parsed.projectInfo.rabSheets,
    ahsSheet: parsed.projectInfo.ahsSheet,
    materialSheet: parsed.projectInfo.materialSheet,
    boqCount: parsed.boqItems.length,
    ahsCount: parsed.ahsBlocks.length,
    materialCount: parsed.materials.length,
    anomalyCount: parsed.anomalies.length,
    boqSample: parsed.boqItems.slice(0, 6).map(item => ({
      code: item.code,
      label: item.label,
      unit: item.unit,
      volume: item.volume,
      sourceSheet: item.sourceSheet,
      sourceRow: item.sourceRow,
    })),
    anomalySample: parsed.anomalies.slice(0, 4).map(anomaly => ({
      type: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
    })),
  };
}

export default function BaselineScreen({
  onBack,
  backLabel = 'Kembali ke Laporan',
}: {
  onBack: () => void;
  backLabel?: string;
}) {
  const { project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [view, setView] = useState<ScreenView>('sessions');
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [activeSession, setActiveSession] = useState<ImportSession | null>(null);
  const [stagingRows, setStagingRows] = useState<ImportStagingRow[]>([]);
  const [anomalies, setAnomalies] = useState<ImportAnomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingAnomalyId, setEditingAnomalyId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [parseProgress, setParseProgress] = useState('');
  const [lastPreview, setLastPreview] = useState<ParsePreview | null>(null);
  const [lastImportIssue, setLastImportIssue] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [parserVersion, setParserVersion] = useState<'v1' | 'v2'>('v1');
  const canSeeParserToggle = profile?.role === 'principal' || profile?.role === 'admin' || profile?.role === 'estimator';

  const loadSessions = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    const data = await getProjectImportSessions(project.id);
    setSessions(data);
    setLoading(false);
  }, [project]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleDryRunV2 = async () => {
    if (!__DEV__) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const { arrayBuffer } = await readPickedWorkbook(picked.assets[0]);
      const { parseBoqV2 } = await import('../../tools/boqParserV2');
      const result = await parseBoqV2(arrayBuffer);
      console.log('[parseBoqV2 dry-run]', {
        materials: result.materialRows.length,
        blocks: result.ahsBlocks.length,
        boqRows: result.boqRows.length,
        validation: result.validationReport,
        staging: result.stagingRows.slice(0, 5),
      });
      Alert.alert(
        'Dry run complete',
        `Materials: ${result.materialRows.length}\nBlocks: ${result.ahsBlocks.length}\nBoQ rows: ${result.boqRows.length}`,
      );
    } catch (e) {
      Alert.alert('Dry run failed', e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpload = async () => {
    if (!project || !profile) return;
    try {
      // Pick an Excel file from the device
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls
          '*/*', // fallback — some devices don't recognise xlsx MIME
        ],
        copyToCacheDirectory: Platform.OS !== 'web',
        base64: false,
      });

      if (picked.canceled || !picked.assets?.length) return;

      const asset = picked.assets[0];
      const fileName = asset.name ?? `import_${Date.now()}.xlsx`;

      // Read file in a way that works on both native cache URIs and browser File objects.
      setParsing(true);
      setParseProgress('Membaca file Excel...');
      setLastImportIssue(null);

      const { arrayBuffer, uploadBody, mimeType } = await readPickedWorkbook(asset);

      setParseProgress('Menganalisis struktur RAB...');
      const localParsed = parseBoqWorkbook(arrayBuffer.slice(0), fileName);

      // AI-driven grouping: consolidate granular items into broader categories
      setParseProgress('Mengelompokkan item BoQ (AI)...');
      try {
        await applyAIBoqGrouping(localParsed);
      } catch {
        applyBoqGrouping(localParsed); // keyword fallback
      }

      setLastPreview(buildParsePreview(fileName, localParsed));

      // Upload raw file to Supabase Storage for traceability when the bucket exists.
      setParseProgress('Mengunggah file...');
      const storagePath = `imports/${project.id}/${Date.now()}_${fileName}`;
      let persistedFilePath = storagePath;
      const { error: uploadError } = await supabase.storage.from('project-files').upload(storagePath, uploadBody, {
        contentType: mimeType,
      });
      if (uploadError) {
        console.warn('Baseline source upload skipped:', uploadError.message);
        persistedFilePath = buildLocalImportPath(project.id, fileName);
        setLastImportIssue('Bucket arsip baseline belum tersedia. Parsing tetap dilanjutkan tanpa menyimpan file sumber.');
        toast('Bucket arsip baseline belum tersedia. Parsing tetap dilanjutkan tanpa menyimpan file sumber.', 'warning');
      }

      // Create import session record
      const sessionResult = await createImportSession(project.id, profile.id, persistedFilePath, fileName, parserVersion);
      if (!sessionResult.session) {
        setLastImportIssue(`Gagal membuat sesi import: ${sessionResult.error ?? 'Unknown error'}`);
        toast(`Gagal membuat sesi import: ${sessionResult.error ?? 'Unknown error'}`, 'critical');
        setParsing(false);
        setParseProgress('');
        return;
      }

      // Parse & stage — the main pipeline
      setParseProgress('Memproses data BoQ...');
      const result = await parseAndStageWorkbook(sessionResult.session.id, project.id, arrayBuffer, fileName);

      setParsing(false);
      setParseProgress('');

      if (!result.success) {
        setLastImportIssue(`Parse gagal: ${result.error}`);
        toast(`Parse gagal: ${result.error}`, 'critical');
        loadSessions();
        return;
      }

      setLastImportIssue(null);
      if (result.parsed) {
        setLastPreview(buildParsePreview(fileName, result.parsed));
      }

      const anomalyMsg = result.anomalyCount && result.anomalyCount > 0
        ? ` | ${result.anomalyCount} anomali terdeteksi`
        : '';
      toast(`Parsed: ${result.stagingRowCount} baris${anomalyMsg} — siap review`, 'ok');
      loadSessions();
    } catch (err: any) {
      setParsing(false);
      setParseProgress('');
      setLastImportIssue(err.message);
      toast(err.message, 'critical');
    }
  };

  const openReview = async (session: ImportSession) => {
    setActiveSession(session);
    setLoading(true);
    const [rows, anomalyData] = await Promise.all([
      getStagingRows(session.id),
      getImportAnomalies(session.id),
    ]);
    setStagingRows(rows);
    setAnomalies(anomalyData);
    setLoading(false);
    setView('review');
  };

  const handleResolveAnomaly = async (id: string, resolution: 'ACCEPTED' | 'CORRECTED' | 'DISMISSED') => {
    if (!profile) return;
    await resolveAnomaly(id, resolution, profile.id);
    setAnomalies(prev => prev.map(a => a.id === id ? { ...a, resolution } : a));
    toast(resolution === 'ACCEPTED' ? 'Diterima' : resolution === 'CORRECTED' ? 'Dikoreksi' : 'Diabaikan', 'ok');
  };

  const startRowCorrection = useCallback((row: ImportStagingRow, anomalyId?: string | null) => {
    const parsed = (row.parsed_data ?? {}) as Record<string, unknown>;
    const draft = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );

    setEditingRowId(row.id);
    setEditingAnomalyId(anomalyId ?? null);
    setEditDraft(draft);
    setView('review');
  }, []);

  const findLinkedRowsForAnomaly = useCallback((anomaly: ImportAnomaly): ImportStagingRow[] => {
    if (!anomaly.source_row) return [];

    return stagingRows.filter(row => {
      const raw = (row.raw_data ?? {}) as Record<string, unknown>;
      const sourceRow = Number(raw.sourceRow ?? raw.excelRowNumber ?? -1);
      const sourceSheet = String(raw.sourceSheet ?? '');

      if (anomaly.source_sheet === 'Material') {
        return row.row_type === 'material' && Number(raw.excelRowNumber ?? -1) === anomaly.source_row;
      }

      if (anomaly.source_sheet === 'Analisa') {
        return row.row_type === 'ahs' && sourceRow === anomaly.source_row;
      }

      if (anomaly.source_sheet?.startsWith('RAB')) {
        return row.row_type === 'boq'
          && sourceRow === anomaly.source_row
          && sourceSheet === anomaly.source_sheet;
      }

      return sourceRow === anomaly.source_row;
    });
  }, [stagingRows]);

  const handleStartAnomalyCorrection = useCallback((anomaly: ImportAnomaly) => {
    const linkedRows = findLinkedRowsForAnomaly(anomaly);
    if (linkedRows.length === 0) {
      toast('Belum ditemukan baris staging yang bisa dikoreksi dari anomali ini.', 'warning');
      return;
    }

    if (linkedRows.length > 1) {
      toast(`Ada ${linkedRows.length} baris terkait. Editor dibuka untuk baris pertama.`, 'warning');
    }

    startRowCorrection(linkedRows[0], anomaly.id);
  }, [findLinkedRowsForAnomaly, startRowCorrection, toast]);

  const handleSaveCorrection = async () => {
    if (!editingRowId || !profile) return;

    const targetRow = stagingRows.find(r => r.id === editingRowId);
    if (!targetRow?.parsed_data || typeof targetRow.parsed_data !== 'object') {
      toast('Baris ini tidak punya data parsed yang bisa dikoreksi.', 'warning');
      return;
    }

    const original = targetRow.parsed_data as Record<string, unknown>;
    const modifiedData = Object.fromEntries(
      Object.entries(original).map(([key, value]) => {
        const draftValue = editDraft[key] ?? '';

        if (value === null || value === undefined) {
          return [key, draftValue.trim() === '' ? null : draftValue];
        }
        if (typeof value === 'number') {
          const normalized = draftValue.trim().replace(',', '.');
          const parsed = Number(normalized);
          return [key, Number.isFinite(parsed) ? parsed : value];
        }
        if (typeof value === 'boolean') {
          const normalized = draftValue.trim().toLowerCase();
          return [key, ['true', '1', 'ya', 'yes'].includes(normalized)];
        }
        return [key, draftValue];
      }),
    );

    await reviewStagingRow(
      targetRow.id,
      'MODIFIED',
      editingAnomalyId ? 'Koreksi manual dari review anomali' : 'Koreksi manual import row',
      modifiedData,
    );

    setStagingRows(prev => prev.map(r =>
      r.id === targetRow.id
        ? { ...r, parsed_data: modifiedData, review_status: 'MODIFIED' }
        : r
    ));

    if (editingAnomalyId) {
      await resolveAnomaly(editingAnomalyId, 'CORRECTED', profile.id);
      setAnomalies(prev => prev.map(a =>
        a.id === editingAnomalyId
          ? { ...a, resolution: 'CORRECTED', resolved_by: profile.id, resolved_at: new Date().toISOString() }
          : a
      ));
    }

    setEditingRowId(null);
    setEditingAnomalyId(null);
    setEditDraft({});
    toast('Koreksi disimpan', 'ok');
  };

  const editingRow = editingRowId
    ? stagingRows.find(r => r.id === editingRowId) ?? null
    : null;

  const pendingAnomalies = anomalies.filter(a => a.resolution === 'PENDING');
  const anomalySeverityColor = (s: string) => {
    switch (s) {
      case 'CRITICAL': return COLORS.critical;
      case 'HIGH': return '#E65100';
      case 'WARNING': return COLORS.warning;
      default: return COLORS.textSec;
    }
  };

  const handleReviewRow = async (rowId: string, action: 'APPROVED' | 'REJECTED') => {
    await reviewStagingRow(rowId, action);
    setStagingRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, review_status: action } : r
    ));
    toast(action === 'APPROVED' ? 'Row disetujui' : 'Row ditolak', action === 'APPROVED' ? 'ok' : 'warning');
  };

  const handlePublish = async () => {
    if (!activeSession || !project) return;

    const pending = stagingRows.filter(r => r.needs_review && r.review_status === 'PENDING');
    if (pending.length > 0) {
      const message = `${pending.length} baris masih perlu di-review sebelum baseline bisa dipublish.`;
      if (Platform.OS === 'web') {
        setLastImportIssue(message);
        toast(message, 'warning');
      } else {
        Alert.alert('Review Belum Selesai', message);
      }
      return;
    }

    setPublishing(true);
    try {
      const result = await publishBaseline(activeSession.id, project.id);
      if (!result.success) {
        toast(`Publish gagal: ${result.error}`, 'critical');
        return;
      }

      toast(`Baseline published: ${result.boqCount} BoQ, ${result.ahsCount} AHS, ${result.materialCount} material`, 'ok');

      // Generate material master
      const masterResult = await generateMaterialMaster(project.id);
      if (masterResult.success) {
        toast(`Material master: ${masterResult.lineCount} baris`, 'ok');
      }

      refresh();
      setView('sessions');
      loadSessions();
    } catch (err: any) {
      toast(err.message, 'critical');
    } finally {
      setPublishing(false);
    }
  };

  const confirmDeleteSession = (session: ImportSession) => {
    const message = session.status === 'REVIEW'
      ? 'Sesi import, staging rows, dan anomali review akan dihapus. Baseline yang belum dipublish aman untuk dibuang.'
      : 'File upload dan sesi import ini akan dihapus dari daftar.';

    const performDelete = async () => {
      setDeletingSessionId(session.id);
      try {
        const result = await deleteImportSession(session);
        if (!result.success) {
          toast(`Hapus gagal: ${result.error}`, 'critical');
          return;
        }
        if (activeSession?.id === session.id) {
          setActiveSession(null);
          setStagingRows([]);
          setAnomalies([]);
          setView('sessions');
        }
        toast('Sesi import dihapus', 'ok');
        loadSessions();
      } finally {
        setDeletingSessionId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Hapus sesi import?\n\n${message}`)) {
        void performDelete();
      }
      return;
    }

    Alert.alert(
      'Hapus sesi import?',
      message,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () => {
            void performDelete();
          },
        },
      ],
    );
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'PUBLISHED': return COLORS.ok;
      case 'REVIEW': return COLORS.warning;
      case 'FAILED': return COLORS.critical;
      default: return COLORS.textSec;
    }
  };

  const confidenceColor = (c: number) => c >= 0.9 ? COLORS.ok : c >= 0.7 ? COLORS.warning : COLORS.critical;

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={view === 'sessions' ? onBack : () => setView('sessions')}>
          <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
          <Text style={styles.backText}>{view === 'sessions' ? backLabel : 'Kembali ke Sesi'}</Text>
        </TouchableOpacity>

        {/* ── Sessions list ── */}
        {view === 'sessions' && (
          <>
            <Text style={styles.sectionHead}>Baseline Import — {project?.name}</Text>

            {canSeeParserToggle && (
              <View style={styles.parserToggleRow}>
                <Text style={styles.parserToggleLabel}>Parser:</Text>
                <TouchableOpacity
                  onPress={() => setParserVersion('v1')}
                  style={[
                    styles.parserToggleBtn,
                    parserVersion === 'v1' && styles.parserToggleBtnActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Gunakan parser v1 stable"
                >
                  <Text style={parserVersion === 'v1' ? styles.parserToggleTextActive : styles.parserToggleText}>
                    v1 (stable)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setParserVersion('v2')}
                  style={[
                    styles.parserToggleBtn,
                    parserVersion === 'v2' && styles.parserToggleBtnActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Gunakan parser v2 beta"
                >
                  <Text style={parserVersion === 'v2' ? styles.parserToggleTextActive : styles.parserToggleText}>
                    v2 (beta)
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={[styles.uploadBtn, parsing && { opacity: 0.6 }]} onPress={handleUpload} disabled={parsing}>
              {parsing ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.uploadText}>{parseProgress || 'Parsing...'}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={20} color="#fff" />
                  <Text style={styles.uploadText}>Upload File BoQ / AHS</Text>
                </>
              )}
            </TouchableOpacity>

            {__DEV__ && (
              <TouchableOpacity onPress={handleDryRunV2} style={{ padding: 12, backgroundColor: '#333' }}>
                <Text style={{ color: '#fff' }}>DEV: Dry-run parseBoqV2</Text>
              </TouchableOpacity>
            )}

            <Card borderColor={COLORS.border}>
              <Text style={styles.previewTitle}>Panduan Penggunaan</Text>
              <Text style={styles.hint}>
                Upload baseline dipakai untuk RAB awal atau revisi penuh sebelum baseline live dipakai operasional.
              </Text>
              <Text style={styles.hint}>
                Jika ada tambahan scope setelah baseline sudah berjalan, lebih aman masuk lewat Catatan Perubahan agar audit trail perubahan tetap jelas.
              </Text>
            </Card>

            {loading && <Text style={styles.hint}>Memuat sesi import...</Text>}

            {lastImportIssue && (
              <Card borderColor={COLORS.warning}>
                <Text style={[styles.previewTitle, { marginBottom: 8 }]}>Status Import Terakhir</Text>
                <Text style={[styles.hint, { color: COLORS.text }]}>{lastImportIssue}</Text>
              </Card>
            )}

            {lastPreview && (
              <Card title={`Preview Parser — ${lastPreview.fileName}`} borderColor={COLORS.info}>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{lastPreview.boqCount}</Text>
                    <Text style={styles.hint}>Item BoQ</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{lastPreview.ahsCount}</Text>
                    <Text style={styles.hint}>Blok AHS</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, { color: lastPreview.anomalyCount > 0 ? COLORS.warning : COLORS.ok }]}>
                      {lastPreview.anomalyCount}
                    </Text>
                    <Text style={styles.hint}>Anomali</Text>
                  </View>
                </View>
                <Text style={styles.hint}>
                  Sheet RAB: {lastPreview.rabSheets.length > 0 ? lastPreview.rabSheets.join(', ') : 'Tidak terdeteksi'}
                </Text>
                <Text style={styles.hint}>
                  Sheet AHS: {lastPreview.ahsSheet ?? 'Tidak terdeteksi'} | Sheet Material: {lastPreview.materialSheet ?? 'Tidak terdeteksi'}
                </Text>

                {lastPreview.boqSample.length > 0 && (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewTitle}>Contoh hasil parse RAB</Text>
                    {lastPreview.boqSample.map(item => (
                      <Text key={`${item.code}-${item.sourceRow}`} style={styles.dataLine}>
                        {item.code} · {item.label} · {item.volume} {item.unit}
                        {'  '}
                        <Text style={styles.previewMeta}>({item.sourceSheet} row {item.sourceRow})</Text>
                      </Text>
                    ))}
                  </View>
                )}

                {lastPreview.anomalySample.length > 0 && (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewTitle}>Anomali awal</Text>
                    {lastPreview.anomalySample.map((anomaly, index) => (
                      <Text key={`${anomaly.type}-${index}`} style={styles.dataLine}>
                        [{anomaly.severity}] {anomaly.type}: {anomaly.description}
                      </Text>
                    ))}
                  </View>
                )}
              </Card>
            )}

            {sessions.map(s => (
              <Card key={s.id} borderColor={statusColor(s.status)}>
                <View style={styles.sessionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionName}>{s.original_file_name}</Text>
                    <Text style={styles.hint}>{new Date(s.created_at).toLocaleDateString('id-ID')}</Text>
                  </View>
                  <Badge
                    flag={s.status === 'PUBLISHED' ? 'OK' : s.status === 'REVIEW' ? 'WARNING' : s.status === 'FAILED' ? 'CRITICAL' : 'INFO'}
                    label={s.status}
                  />
                </View>
                {s.status === 'REVIEW' && (
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => openReview(s)}>
                    <Text style={styles.ghostBtnText}>Review & Publish</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.sessionActions}>
                  {s.status !== 'PUBLISHED' && (
                    <TouchableOpacity
                      style={[styles.sessionActionBtn, styles.deleteBtn, deletingSessionId === s.id && styles.disabledBtn]}
                      onPress={() => confirmDeleteSession(s)}
                      disabled={deletingSessionId === s.id}
                    >
                      <Ionicons name="trash-outline" size={16} color={COLORS.critical} />
                      <Text style={[styles.sessionActionText, { color: COLORS.critical }]}>
                        {deletingSessionId === s.id ? 'Menghapus...' : 'Hapus Upload'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {s.status === 'PUBLISHED' && (
                  <Text style={styles.hint}>
                    Sudah menjadi baseline live. Tambahan scope sesudah ini sebaiknya masuk lewat Catatan Perubahan, bukan menghapus baseline ini.
                  </Text>
                )}
                {s.error_message && <Text style={[styles.hint, { color: COLORS.critical }]}>{s.error_message}</Text>}
              </Card>
            ))}

            {sessions.length === 0 && !loading && (
              <Card>
                <Text style={styles.hint}>Belum ada sesi import. Upload file Excel BoQ/AHS untuk memulai.</Text>
              </Card>
            )}
          </>
        )}

        {/* ── Review queue ── */}
        {view === 'review' && activeSession && (
          <>
            <Text style={styles.sectionHead}>Review Import — {activeSession.original_file_name}</Text>

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{stagingRows.length}</Text>
                <Text style={styles.hint}>Total Baris</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: COLORS.warning }]}>
                  {stagingRows.filter(r => r.needs_review && r.review_status === 'PENDING').length}
                </Text>
                <Text style={styles.hint}>Perlu Review</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: COLORS.ok }]}>
                  {stagingRows.filter(r => r.review_status === 'APPROVED' || r.review_status === 'MODIFIED').length}
                </Text>
                <Text style={styles.hint}>Disetujui</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.auditBtn}
              onPress={() => setShowAuditModal(true)}
            >
              <Ionicons name="analytics-outline" size={18} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.auditBtnTitle}>Audit & Edit Parser</Text>
                <Text style={styles.hint}>
                  Lihat & perbaiki interpretasi parser per material, BoQ, atau AHS block sebelum publish.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
            </TouchableOpacity>

            {editingRow && (
              <Card borderColor={COLORS.info}>
                <Text style={styles.previewTitle}>
                  Editor Koreksi — {editingRow.row_type.toUpperCase()} Baris {editingRow.row_number}
                </Text>
                <Text style={styles.hint}>
                  {editingAnomalyId
                    ? 'Koreksi ini berasal dari review anomali. Saat disimpan, anomali akan ditandai CORRECTED.'
                    : 'Ubah hasil parse sebelum baseline dipublish.'}
                </Text>

                {Object.entries((editingRow.parsed_data ?? {}) as Record<string, unknown>).map(([key]) => {
                  const dropdownOptions = editingRow.row_type === 'material' ? MATERIAL_DROPDOWNS[key] : null;
                  return (
                    <View key={key} style={styles.editorField}>
                      <Text style={styles.editorLabel}>{key}</Text>
                      {dropdownOptions ? (
                        <View style={styles.pickerWrap}>
                          <Picker
                            selectedValue={editDraft[key] ?? ''}
                            onValueChange={(val) => setEditDraft(prev => ({ ...prev, [key]: String(val) }))}
                            style={styles.picker}
                          >
                            <Picker.Item label={`Pilih ${key}...`} value="" color={COLORS.textSec} />
                            {key === 'tier'
                              ? MATERIAL_TIER_OPTIONS.map(opt => (
                                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                                ))
                              : dropdownOptions.map(opt => (
                                  <Picker.Item key={opt} label={opt} value={opt} />
                                ))}
                          </Picker>
                        </View>
                      ) : (
                        <TextInput
                          style={styles.editorInput}
                          value={editDraft[key] ?? ''}
                          onChangeText={(text) => setEditDraft(prev => ({ ...prev, [key]: text }))}
                          placeholder={`Isi ${key}`}
                          placeholderTextColor={COLORS.textSec}
                        />
                      )}
                    </View>
                  );
                })}

                <View style={styles.reviewActions}>
                  <TouchableOpacity
                    style={[styles.reviewBtn, { backgroundColor: COLORS.ok }]}
                    onPress={handleSaveCorrection}
                  >
                    <Text style={styles.reviewBtnText}>Simpan Koreksi</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reviewBtn, { backgroundColor: COLORS.textSec }]}
                    onPress={() => {
                      setEditingRowId(null);
                      setEditingAnomalyId(null);
                      setEditDraft({});
                    }}
                  >
                    <Text style={styles.reviewBtnText}>Batal</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}

            {/* ── Anomaly section ── */}
            {anomalies.length > 0 && (
              <>
                <TouchableOpacity
                  style={[styles.anomalyBanner, pendingAnomalies.length > 0 && { borderColor: COLORS.warning }]}
                  onPress={() => setView('anomalies')}
                >
                  <Ionicons
                    name="warning"
                    size={18}
                    color={pendingAnomalies.length > 0 ? COLORS.warning : COLORS.ok}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.anomalyBannerTitle}>
                      {pendingAnomalies.length > 0
                        ? `${pendingAnomalies.length} anomali terdeteksi AI`
                        : `${anomalies.length} anomali — semua resolved`}
                    </Text>
                    <Text style={styles.hint}>
                      {anomalies.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH').length > 0
                        ? 'Ada anomali severity tinggi — harap ditinjau sebelum publish'
                        : 'Tap untuk review detail'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textSec} />
                </TouchableOpacity>
              </>
            )}

            {stagingRows.map(row => (
              <Card key={row.id} borderColor={row.needs_review ? COLORS.warning : COLORS.border}>
                <View style={styles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowType}>{row.row_type.toUpperCase()} — Baris {row.row_number}</Text>
                    <View style={styles.confRow}>
                      <Text style={styles.hint}>Confidence: </Text>
                      <Text style={[styles.confValue, { color: confidenceColor(row.confidence) }]}>
                        {(row.confidence * 100).toFixed(0)}%
                      </Text>
                    </View>
                  </View>
                  <Badge
                    flag={row.review_status === 'APPROVED' || row.review_status === 'MODIFIED' ? 'OK' : row.review_status === 'REJECTED' ? 'CRITICAL' : row.needs_review ? 'WARNING' : 'INFO'}
                    label={row.review_status}
                  />
                </View>

                {/* Show parsed data summary */}
                {row.parsed_data && (
                  <View style={styles.dataPreview}>
                    {Object.entries(row.parsed_data as Record<string, unknown>).slice(0, 4).map(([key, val]) => (
                      <Text key={key} style={styles.dataLine}>
                        <Text style={{ fontWeight: '600' }}>{key}: </Text>
                        {String(val)}
                      </Text>
                    ))}
                  </View>
                )}

                {/* Review actions */}
                {row.needs_review && row.review_status === 'PENDING' && (
                  <View style={styles.reviewActions}>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.ok }]}
                      onPress={() => handleReviewRow(row.id, 'APPROVED')}
                    >
                      <Text style={styles.reviewBtnText}>Setuju</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.critical }]}
                      onPress={() => handleReviewRow(row.id, 'REJECTED')}
                    >
                      <Text style={styles.reviewBtnText}>Tolak</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.warning }]}
                      onPress={() => startRowCorrection(row)}
                    >
                      <Text style={styles.reviewBtnText}>Koreksi</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            ))}

            {stagingRows.length > 0 && (
              <TouchableOpacity style={styles.publishBtn} onPress={handlePublish} disabled={publishing}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.publishText}>{publishing ? 'Publishing...' : 'Publish Baseline'}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Audit Trace Modal ── */}
        {activeSession && activeSession.status === 'REVIEW' && (
          <AuditTraceScreen
            visible={showAuditModal}
            onClose={() => setShowAuditModal(false)}
            sessionId={activeSession.id}
            sessionName={activeSession.original_file_name}
            stagingRows={stagingRows}
            onRowsChange={setStagingRows}
            userId={profile?.id ?? null}
          />
        )}

        {/* ── Anomaly detail view ── */}
        {view === 'anomalies' && activeSession && (
          <>
            <Text style={styles.sectionHead}>Anomali AI — {activeSession.original_file_name}</Text>

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{anomalies.length}</Text>
                <Text style={styles.hint}>Total</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: COLORS.warning }]}>{pendingAnomalies.length}</Text>
                <Text style={styles.hint}>Pending</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: COLORS.critical }]}>
                  {anomalies.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH').length}
                </Text>
                <Text style={styles.hint}>Kritis</Text>
              </View>
            </View>

            {anomalies.map(a => (
              <Card key={a.id} borderColor={a.resolution === 'PENDING' ? anomalySeverityColor(a.severity) : COLORS.border}>
                <View style={styles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <View style={[styles.severityDot, { backgroundColor: anomalySeverityColor(a.severity) }]} />
                      <Text style={styles.rowType}>{a.anomaly_type.replace(/_/g, ' ').toUpperCase()}</Text>
                    </View>
                    <Text style={[styles.dataLine, { marginTop: 2 }]}>{a.description}</Text>
                    {a.expected_value && (
                      <Text style={styles.hint}>
                        Ekspektasi: {a.expected_value} | Aktual: {a.actual_value}
                      </Text>
                    )}
                    {a.source_sheet && (
                      <Text style={styles.hint}>Sheet: {a.source_sheet} baris {a.source_row}</Text>
                    )}
                  </View>
                  <Badge
                    flag={a.resolution === 'PENDING' ? (a.severity === 'CRITICAL' ? 'CRITICAL' : a.severity === 'HIGH' ? 'HIGH' : 'WARNING') : 'OK'}
                    label={a.resolution}
                  />
                </View>

                {a.resolution === 'PENDING' && (
                  <View style={styles.reviewActions}>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.ok }]}
                      onPress={() => handleResolveAnomaly(a.id, 'ACCEPTED')}
                    >
                      <Text style={styles.reviewBtnText}>Terima</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.warning }]}
                      onPress={() => handleStartAnomalyCorrection(a)}
                    >
                      <Text style={styles.reviewBtnText}>Koreksi</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reviewBtn, { backgroundColor: COLORS.textSec }]}
                      onPress={() => handleResolveAnomaly(a.id, 'DISMISSED')}
                    >
                      <Text style={styles.reviewBtnText}>Abaikan</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            ))}

            <TouchableOpacity style={styles.ghostBtn} onPress={() => setView('review')}>
              <Text style={styles.ghostBtnText}>Kembali ke Review</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  sectionHead: { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm + 2, marginTop: SPACE.md },
  hint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: SPACE.xs },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.base, marginBottom: SPACE.base },
  uploadText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  sessionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sessionName: { fontSize: TYPE.sm, fontFamily: FONTS.semibold },
  ghostBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 10, alignItems: 'center', marginTop: SPACE.sm + 2, minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, textTransform: 'uppercase' },
  sessionActions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm + 2 },
  sessionActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  sessionActionText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  deleteBtn: { borderColor: 'rgba(198, 40, 40, 0.28)', backgroundColor: 'rgba(198, 40, 40, 0.05)' },
  disabledBtn: { opacity: 0.5 },
  summaryRow: { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  summaryItem: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  summaryValue: { fontSize: 20, fontFamily: FONTS.bold },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  rowType: { fontSize: TYPE.xs, fontFamily: FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  confRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  confValue: { fontSize: TYPE.xs, fontFamily: FONTS.bold },
  dataPreview: { backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 4, padding: 8, marginTop: 8 },
  editorField: { marginTop: 10 },
  editorLabel: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  editorInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    fontSize: TYPE.sm,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  picker: {
    color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  dataLine: { fontSize: TYPE.xs, color: COLORS.text, lineHeight: 18 },
  previewBox: { backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 4, padding: 10, marginTop: 10 },
  previewTitle: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  previewMeta: { color: COLORS.textSec, fontSize: TYPE.xs },
  reviewActions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm + 2 },
  reviewBtn: { flex: 1, borderRadius: RADIUS, padding: 10, alignItems: 'center' },
  reviewBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.semibold, textTransform: 'uppercase' },
  publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.ok, borderRadius: RADIUS, padding: SPACE.base, marginTop: SPACE.base },
  publishText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  anomalyBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,152,0,0.08)', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: 14, marginBottom: SPACE.md },
  anomalyBannerTitle: { fontSize: TYPE.sm, fontFamily: FONTS.bold },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  auditBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(33,150,243,0.06)',
    borderWidth: 1, borderColor: COLORS.primary,
    borderRadius: RADIUS, padding: 14, marginBottom: SPACE.md,
  },
  auditBtnTitle: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.primary },
  parserToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  parserToggleLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  parserToggleBtn: {
    paddingHorizontal: SPACE.md, paddingVertical: 8,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  parserToggleBtnActive: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  parserToggleText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
  parserToggleTextActive: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textInverse },
});
