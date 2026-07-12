import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { probeBoq, normalizeBoq } from '../api/normalize';
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
  bulkReviewStagingRows,
  publishBaseline,
  generateMaterialMaster,
  createImportSession,
  parseAndStageWorkbook,
  getImportAnomalies,
  resolveAnomaly,
  deleteImportSession,
} from '../../tools/baseline';
import { previewNewMasterTotals, type RevisionContext } from '../../tools/publishBaselineV2';
import {
  computePlanRevisionDiff,
  lowerBelowOrderedPct,
  type PlanRevisionClassification,
  type PlanRevisionDiffResult,
  type PlanRevisionSummary,
  type MaterialActivity,
} from '../../tools/planRevisionDiff';
import {
  mapCeilingBreachRows,
  buildCeilingRaisePayload,
  checkCeilingRaiseCoverage,
  proposedAggregatesToArray,
  type CeilingBreach,
  type CeilingRaisePayloadEntry,
} from '../../tools/ceilingRaiseGate';
import { parseBoqWorkbook, applyBoqGrouping, type ParsedWorkbook } from '../../tools/excelParser';
import { parseBoqV2 } from '../../tools/boqParserV2';
import { applyAIBoqGrouping } from '../../tools/ai-assist';
import { supabase } from '../../tools/supabase';
import type { ImportSession, ImportStagingRow, ImportAnomaly } from '../../tools/types';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../theme';
import { sourceLocation, sourceContext } from '../../tools/sourceProvenance';
import { flagExplanation, ACTION_CAPTIONS } from '../../tools/flagExplanation';
import { groupReviewRows, subGroupByParentBlock, pendingRowIds, FLAG_GROUP_HINTS } from '../../tools/flagGroups';

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

/**
 * Copy + severity for the four spec §5 re-publish warning classes (the only
 * ones that need an explicit acknowledgment tick). Order matches
 * PLAN_REVISION_WARNING_CLASSES. REMOVED_WITH_ACTIVITY and
 * RAISE_ABSOLVING_OVERAGE carry the strongest copy per the spec.
 */
const REVISION_WARNING_META: Record<
  string,
  { label: string; copy: string; severity: 'critical' | 'warning' }
> = {
  RAISE_ABSOLVING_OVERAGE: {
    label: 'Menaikkan plafon material yang sudah melebihi order',
    copy:
      'Rencana dinaikkan untuk menutup jumlah yang SUDAH melebihi order lama. ' +
      'Perubahan ini dicatat dan diberitahukan ke principal.',
    severity: 'critical',
  },
  RAISE: {
    label: 'Menaikkan plafon material',
    copy: 'Plafon rencana material dinaikkan dari baseline sebelumnya.',
    severity: 'warning',
  },
  LOWER_BELOW_ORDERED: {
    label: 'Menurunkan rencana di bawah jumlah yang sudah di-order',
    copy:
      'Rencana baru lebih kecil dari yang sudah di-PO — material akan tercatat ' +
      'melebihi alokasi baru.',
    severity: 'warning',
  },
  REMOVED_WITH_ACTIVITY: {
    label: 'Menghapus material yang masih punya permintaan / PO / penerimaan',
    copy:
      'Material hilang dari BoQ baru padahal komitmennya masih berjalan — ' +
      'komitmen jadi yatim (orphaned). Peringatan terkuat.',
    severity: 'critical',
  },
};

/**
 * Human-friendly Indonesian labels for the parsed_data fields the
 * correction editor renders. Keys here are the database field names;
 * values are what the estimator sees on the form. Fields not listed
 * fall back to the key with underscores replaced by spaces.
 */
const FIELD_LABELS: Record<string, string> = {
  // Material rows
  code: 'Kode',
  name: 'Nama Material',
  unit: 'Satuan',
  reference_unit_price: 'Harga Acuan',
  category: 'Kategori',
  tier: 'Tingkatan',
  // AHS component rows
  material_name: 'Nama Material',
  coefficient: 'Koefisien',
  unit_price: 'Harga Satuan',
  disaggregated_from: 'Dipecah Dari',
  role: 'Peran',
  // AHS block rows
  title: 'Judul Resep',
  is_orphan: 'Tidak Dipakai BoQ?',
  linked_boq_code: 'Kode BoQ Terkait',
  jumlah_cached_value: 'Total Harga (per satuan)',
  // BoQ rows
  label: 'Uraian',
  planned: 'Volume',
  total_cost: 'Total Harga',
};

/**
 * One-line guidance shown under the field label for cryptic fields.
 * Skip the obvious ones (Nama, Satuan, Volume, etc.).
 */
const FIELD_HINTS: Record<string, string> = {
  is_orphan: 'true = resep ada di Analisa tapi tidak ada BoQ yang pakai. false = ada baris BoQ yang pakai.',
  linked_boq_code: 'Contoh: "III.A.5". Kosongkan jika resep memang tidak terpakai.',
  jumlah_cached_value: 'Total harga per 1 satuan resep. Biasanya tidak perlu diubah.',
  reference_unit_price: 'Harga per satuan dari katalog material proyek.',
  tier: '1 = Precise (besi, dll). 2 = Bulk (semen, pasir). 3 = Consumables (paku, dll).',
  coefficient: 'Berapa banyak material ini per 1 satuan resep. Contoh: 0.22 sak Semen per m².',
  disaggregated_from: 'Resep induk asal komponen ini (misal "Pembesian U24 & U40").',
  role: 'sengkang = besi tulangan kolom melingkar. utama = besi tulangan kolom vertikal.',
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
}

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
  onGoToJadwal,
}: {
  onBack: () => void;
  backLabel?: string;
  onGoToJadwal?: () => void;
}) {
  const { project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [view, setView] = useState<ScreenView>('sessions');
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [activeSession, setActiveSession] = useState<ImportSession | null>(null);
  const [stagingRows, setStagingRows] = useState<ImportStagingRow[]>([]);
  // Exception-based review: default to showing only rows that need a human
  // (flagged needs_review or already rejected). Clean rows are hidden until
  // the user flips to 'all'. Keeps a 300-row import down to a short queue.
  const [reviewFilter, setReviewFilter] = useState<'exceptions' | 'all'>('exceptions');
  const [bulkApproving, setBulkApproving] = useState(false);
  const [anomalies, setAnomalies] = useState<ImportAnomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingAnomalyId, setEditingAnomalyId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [parseProgress, setParseProgress] = useState('');
  const [publishedJustNow, setPublishedJustNow] = useState(false);
  // Re-publish diff-and-acknowledge (Task 2.11). When a re-publish touches
  // materials-with-activity, the diff is computed client-side and rendered as a
  // blocking checklist; publish is held until every warning class is ticked.
  const [preparingDiff, setPreparingDiff] = useState(false);
  const [diffPreview, setDiffPreview] = useState<PlanRevisionDiffResult | null>(null);
  const [acknowledgedClasses, setAcknowledgedClasses] = useState<Set<PlanRevisionClassification>>(new Set());
  const [materialNames, setMaterialNames] = useState<Map<string, string>>(new Map());
  // Task 2.12 — principal ceiling-raise gate. When the acknowledged diff raises
  // the ceiling of a material currently in overage, the SERVER recomputes the
  // breach set (compute_ceiling_breaches); a non-empty set holds the publish
  // behind a plan_ceiling_raise principal approval.
  const [proposedTotals, setProposedTotals] = useState<Map<string, number>>(new Map());
  const [ceilingBreaches, setCeilingBreaches] = useState<CeilingBreach[] | null>(null);
  const [approvedCeilingTasks, setApprovedCeilingTasks] = useState<Array<{ id: string; created_at: string; override_payload: CeilingRaisePayloadEntry[] }>>([]);
  const [selectedCeilingTaskId, setSelectedCeilingTaskId] = useState<string | null>(null);
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [checkingCeiling, setCheckingCeiling] = useState(false);
  const [escalatingCeiling, setEscalatingCeiling] = useState(false);
  const [lastPreview, setLastPreview] = useState<ParsePreview | null>(null);
  const [lastImportIssue, setLastImportIssue] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  // BoQ uploads always use the v2 parser. The v1/v2 toggle was removed once v2
  // became the default; v1 parser code is retained only for the legacy upload
  // preview and MandorSetup, not selectable for new uploads.
  const parserVersion = 'v2' as const;
  const [probe, setProbe] = useState<import('../api/normalize').ProbeResult | null>(null);
  const [normalizing, setNormalizing] = useState(false);
  const [normalized, setNormalized] = useState<import('../api/normalize').NormalizeResult | null>(null);
  const [currentStoragePath, setCurrentStoragePath] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    const data = await getProjectImportSessions(project.id);
    setSessions(data);
    setLoading(false);
  }, [project]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Stale-diff invalidation (review CRITICAL) ────────────────────────────
  // The acknowledgment checklist is computed from a SNAPSHOT of stagingRows.
  // While it is displayed the review cards stay editable, so an estimator could
  // see a warning, EDIT the offending staged row, tick, and publish — landing
  // the edited rows while the audit persists the STALE planned_after /
  // classification (the row would lie). Any change to stagingRows while a
  // preview exists therefore drops the preview + the acknowledged ticks, forcing
  // a recompute. The publish path can then only be reached via handlePublish
  // again (the checklist is unmounted once diffPreview is null), which re-fetches
  // the current master and recomputes the diff — and publishBaselineV2's
  // fail-loud guard refuses any re-publish without a fresh revisionContext.
  //
  // Keyed on stagingRows ONLY. diffPreview is read through a ref so setting the
  // preview (which does not change stagingRows) never re-runs this effect and
  // self-clears the checklist it just rendered.
  const diffPreviewRef = useRef<PlanRevisionDiffResult | null>(null);
  useEffect(() => { diffPreviewRef.current = diffPreview; }, [diffPreview]);
  useEffect(() => {
    if (!diffPreviewRef.current) return;
    setDiffPreview(null);
    setAcknowledgedClasses(new Set());
    // Also drop any pending ceiling-breach panel + attached approval: the breach
    // set is computed from the same staging snapshot, so an edit invalidates it.
    setCeilingBreaches(null);
    setSelectedCeilingTaskId(null);
    toast('Baris berubah — hitung ulang diff', 'warning');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagingRows]);

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

      // Probe for expansion-needed rows before offering parse.
      const flagEnabled = Boolean((Constants.expoConfig?.extra as any)?.sanoBoqRecipeDetail);
      let probeResult: import('../api/normalize').ProbeResult | null = null;
      if (flagEnabled && !uploadError) {
        try {
          const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
          const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
          if (url && anon) {
            probeResult = await probeBoq({ storagePath, supabaseUrl: url, anonKey: anon });
          }
        } catch (err) {
          console.warn('probeBoq failed (continuing with rolled-up parse):', err);
        }
      }
      setProbe(probeResult);
      setCurrentStoragePath(storagePath);

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
    try {
      // getStagingRows now throws on a query error (instead of silently
      // returning []), so a failed load surfaces here rather than opening
      // review on a session that looks empty.
      const [rows, anomalyData] = await Promise.all([
        getStagingRows(session.id),
        getImportAnomalies(session.id),
      ]);
      setStagingRows(rows);
      setCollapsedGroups({});
      setAnomalies(anomalyData);
      setView('review');
    } catch (err: any) {
      toast(`Gagal memuat staging rows: ${err.message}`, 'critical');
    } finally {
      setLoading(false);
    }
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

  // Clean rows = parser-confident, not flagged for review. They never block
  // publish, but bulk-approving them gives an explicit sign-off and clears the
  // PENDING badge so the only thing left in view is genuine exceptions.
  const cleanPendingRows = useMemo(
    () => stagingRows.filter(r => !r.needs_review && r.review_status === 'PENDING'),
    [stagingRows],
  );

  const handleBulkApproveClean = async () => {
    if (cleanPendingRows.length === 0) {
      toast('Tidak ada baris bersih yang menunggu.', 'warning');
      return;
    }
    const ids = cleanPendingRows.map(r => r.id);
    setBulkApproving(true);
    try {
      const res = await bulkReviewStagingRows(ids, 'APPROVED');
      if (!res.success) {
        toast(`Gagal menyetujui massal: ${res.error}`, 'critical');
        return;
      }
      const idSet = new Set(ids);
      setStagingRows(prev => prev.map(r =>
        idSet.has(r.id) ? { ...r, review_status: 'APPROVED' } : r
      ));
      toast(`${res.count} baris bersih disetujui`, 'ok');
    } finally {
      setBulkApproving(false);
    }
  };

  // Per-group collapse state. A group key absent here uses the size default
  // (>10 rows → collapsed) computed at render time.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [batchReviewing, setBatchReviewing] = useState(false);

  const handleBatchReview = (ids: string[], status: 'APPROVED' | 'REJECTED') => {
    if (ids.length === 0) return;
    const verb = status === 'REJECTED' ? 'Tolak' : 'Setujui';

    const runBatch = async () => {
      setBatchReviewing(true);
      try {
        const res = await bulkReviewStagingRows(ids, status);
        if (!res.success) { toast(`Gagal: ${res.error}`, 'critical'); return; }
        const idSet = new Set(ids);
        setStagingRows(prev => prev.map(r => (idSet.has(r.id) ? { ...r, review_status: status } : r)));
        toast(`${res.count} blok ${status === 'REJECTED' ? 'ditolak' : 'disetujui'}`,
          status === 'REJECTED' ? 'warning' : 'ok');
      } finally {
        setBatchReviewing(false);
      }
    };

    const message = 'Tindakan ini bisa diubah lagi sebelum publish.';

    // RN-Web's Alert.alert does not render multi-button dialogs nor fire the
    // custom-button onPress, so on web the confirmation must go through the
    // browser's window.confirm (same reason handlePublish branches on web).
    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(`${verb} ${ids.length} blok?\n\n${message}`)
        : true;
      if (ok) void runBatch();
      return;
    }

    Alert.alert(
      `${verb} ${ids.length} blok?`,
      message,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: verb,
          style: status === 'REJECTED' ? 'destructive' : 'default',
          onPress: () => { void runBatch(); },
        },
      ],
    );
  };

  // Rows shown in the review queue. 'exceptions' (default) surfaces only what
  // needs a human: flagged rows + anything rejected. 'all' shows everything.
  const visibleReviewRows = useMemo(
    () => reviewFilter === 'all'
      ? stagingRows
      : stagingRows.filter(r => r.needs_review || r.review_status === 'REJECTED'),
    [stagingRows, reviewFilter],
  );

  const ahsBlockRows = useMemo(
    () => stagingRows.filter(r => r.row_type === 'ahs_block'),
    [stagingRows],
  );

  // A short Indonesian sentence summarizing the diff → the PLAN_REVISED
  // notification body (supervisors + principal FYI).
  const buildNotifySummary = (s: PlanRevisionSummary): string => {
    const parts: string[] = [];
    if (s.raisedAbsolvingOverage) parts.push(`${s.raisedAbsolvingOverage} kenaikan menutup over-order`);
    if (s.raised) parts.push(`${s.raised} dinaikkan`);
    if (s.loweredBelowOrdered) parts.push(`${s.loweredBelowOrdered} turun di bawah order`);
    if (s.removedWithActivity) parts.push(`${s.removedWithActivity} dihapus (masih ada aktivitas)`);
    if (s.added) parts.push(`${s.added} ditambah`);
    if (s.lowered) parts.push(`${s.lowered} diturunkan`);
    return parts.length
      ? `Rencana material diperbarui: ${parts.join(', ')}.`
      : 'Rencana material proyek diperbarui.';
  };

  // Fetch the CURRENT published master's per-(material) planned lines. Presence
  // of a master row is the re-publish signal (a plan exists to diff against).
  const fetchCurrentMaster = async (
    projectId: string,
  ): Promise<{ isRepublish: boolean; lines: Array<{ material_id: string; planned_quantity: number }> }> => {
    const { data: master } = await supabase
      .from('project_material_master')
      .select('id')
      .eq('project_id', projectId)
      // id DESC is the tiebreak (054 convention): a re-publish batch can create
      // more than one master within the same wall-clock second, so created_at
      // alone is not a deterministic "latest". Match the view's ordering exactly
      // (v_material_envelopes: ORDER BY created_at DESC, id DESC) so the client
      // diffs against the SAME master the envelope view scopes to.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!master) return { isRepublish: false, lines: [] };
    const { data: lines } = await supabase
      .from('project_material_master_lines')
      .select('material_id, planned_quantity')
      .eq('master_id', master.id);
    const rows = (lines ?? [])
      .filter((l): l is { material_id: string; planned_quantity: number } => !!l.material_id)
      .map(l => ({ material_id: l.material_id as string, planned_quantity: Number(l.planned_quantity) || 0 }));
    return { isRepublish: true, lines: rows };
  };

  // Per-material activity + names from the project envelope view. "Activity" =
  // any non-cancelled PO (total_ordered), non-rejected request (total_requested),
  // or receipt (total_received > 0). One view read covers all three.
  const fetchProjectActivity = async (
    projectId: string,
  ): Promise<{ activity: Map<string, MaterialActivity>; names: Map<string, string> }> => {
    const activity = new Map<string, MaterialActivity>();
    const names = new Map<string, string>();
    const { data } = await supabase
      .from('v_material_envelope_status')
      .select('material_id, material_name, total_ordered, total_requested, total_received')
      .eq('project_id', projectId);
    for (const r of data ?? []) {
      if (!r.material_id) continue;
      activity.set(r.material_id as string, {
        ordered: Number(r.total_ordered) || 0,
        requested: Number(r.total_requested) || 0,
        receiptsExist: (Number(r.total_received) || 0) > 0,
      });
      if (r.material_name) names.set(r.material_id as string, r.material_name as string);
    }
    return { activity, names };
  };

  // Supplementary activity probe for materials NEW to the plan (review Fix 2).
  // v_material_envelope_status is scoped to the CURRENT master, so a material
  // that is new to the about-to-publish plan (not in the current master) has NO
  // view row — its prior activity (tier-4 requests, since 053; id-linked
  // receipts; POs placed against a name-matched line) is therefore invisible to
  // fetchProjectActivity and would wrongly collapse it into noActivityChanged
  // instead of surfacing as an ADDED line with true figures. Probe those exact
  // material_ids directly. Three cheap IN-list selects, joined to their headers
  // for the project + status filter (mirrors v_material_envelope_status's
  // laterals: non-REJECTED requests / non-CANCELLED POs / any receipt).
  //
  // Scope note: receipts are matched by material_id only (id-linked). Unlinked,
  // name-only receipts are not probed here — keeping this to three IN-list
  // selects — so a name-only receipt against a brand-new material stays
  // invisible; acceptable because the diff still records the material (via its
  // request/PO activity, or as a no-activity summary line) and never invents a
  // figure (CLAUDE.md §1.1).
  const fetchActivityForNewMaterials = async (
    projectId: string,
    materialIds: string[],
  ): Promise<Map<string, MaterialActivity>> => {
    const out = new Map<string, MaterialActivity>();
    if (materialIds.length === 0) return out;
    const bump = (id: string): MaterialActivity => {
      let a = out.get(id);
      if (!a) { a = { ordered: 0, requested: 0, receiptsExist: false }; out.set(id, a); }
      return a;
    };

    const [reqRes, poRes, rcptRes] = await Promise.all([
      supabase
        .from('material_request_lines')
        .select('material_id, quantity, material_request_headers!inner(project_id, overall_status)')
        .in('material_id', materialIds)
        .eq('material_request_headers.project_id', projectId)
        .neq('material_request_headers.overall_status', 'REJECTED'),
      supabase
        .from('purchase_order_lines')
        .select('material_id, quantity, purchase_orders!inner(project_id, status)')
        .in('material_id', materialIds)
        .eq('purchase_orders.project_id', projectId)
        .neq('purchase_orders.status', 'CANCELLED'),
      supabase
        .from('receipt_lines')
        .select('material_id, receipts!inner(project_id)')
        .in('material_id', materialIds)
        .eq('receipts.project_id', projectId),
    ]);

    for (const r of (reqRes.data ?? []) as Array<{ material_id: string | null; quantity: unknown }>) {
      if (!r.material_id) continue;
      bump(r.material_id).requested += Number(r.quantity) || 0;
    }
    for (const r of (poRes.data ?? []) as Array<{ material_id: string | null; quantity: unknown }>) {
      if (!r.material_id) continue;
      bump(r.material_id).ordered += Number(r.quantity) || 0;
    }
    for (const r of (rcptRes.data ?? []) as Array<{ material_id: string | null }>) {
      if (!r.material_id) continue;
      bump(r.material_id).receiptsExist = true;
    }
    return out;
  };

  // Phase 1 — validate, then on a re-publish compute the diff. If any warning
  // class is present, hold and render the blocking checklist (doPublish is
  // deferred to the "Konfirmasi & Publish" tap). Otherwise publish straight
  // through — first publishes with no context, no-warning re-publishes with a
  // context so the audit row is still written.
  const handlePublish = async () => {
    if (!activeSession || !project) return;
    // Hard re-entry guard: `disabled` only takes effect after the next render,
    // so a rapid second tap could run this again before the button disables —
    // producing TWO publishes → duplicate ahs_versions + a corrupt master.
    if (publishing || preparingDiff) return;

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

    setPreparingDiff(true);
    try {
      const current = await fetchCurrentMaster(project.id);
      if (!current.isRepublish) {
        // First publish — nothing revised, no acknowledgment needed.
        await doPublish(undefined);
        return;
      }
      const [preview, activityInfo] = await Promise.all([
        previewNewMasterTotals(activeSession.id),
        fetchProjectActivity(project.id),
      ]);
      if (preview.error) {
        toast(`Gagal menghitung perubahan rencana: ${preview.error}`, 'critical');
        return;
      }
      // Stash the would-be new master's per-material totals — the exact p_proposed
      // the 2.12 ceiling gate (server) and its pre-check compute_ceiling_breaches
      // key off. Reset any prior breach panel; a fresh handlePublish recomputes.
      setProposedTotals(preview.totals);
      setCeilingBreaches(null);
      setSelectedCeilingTaskId(null);
      const newRows = [...preview.totals].map(([material_id, planned_quantity]) => ({ material_id, planned_quantity }));

      // Fix 2: materials new to this plan have no envelope-view row, so their
      // prior activity is missing from activityInfo. Probe those specific ids so
      // they classify as ADDED (with real ordered/requested) rather than
      // collapsing into the no-activity summary — the audit line then tells the
      // truth. Only the new-to-plan ids (absent from the view activity map).
      const newMaterialIds = newRows
        .map(r => r.material_id)
        .filter(id => id && !activityInfo.activity.has(id));
      if (newMaterialIds.length > 0) {
        try {
          const probed = await fetchActivityForNewMaterials(project.id, newMaterialIds);
          for (const [id, a] of probed) activityInfo.activity.set(id, a);
        } catch (probeErr) {
          // Non-fatal: a probe failure must not block the re-publish diff. Worst
          // case a new material with prior activity is under-classified (falls
          // into the no-activity summary), never over-classified — the diff is
          // still shown and nothing is fabricated.
          console.warn('fetchActivityForNewMaterials failed (non-fatal):', probeErr);
        }
      }

      const diff = computePlanRevisionDiff(newRows, current.lines, activityInfo.activity);
      setMaterialNames(activityInfo.names);

      if (diff.warningClasses.length > 0) {
        // Hold — render the checklist. doPublish fires on Konfirmasi.
        setAcknowledgedClasses(new Set());
        setDiffPreview(diff);
      } else {
        // No warnings — still record the audit revision (empty or non-warning).
        await doPublish(buildRevisionContext(diff));
      }
    } catch (err: any) {
      toast(err?.message ?? 'Gagal menyiapkan re-publish', 'critical');
    } finally {
      setPreparingDiff(false);
    }
  };

  const buildRevisionContext = (diff: PlanRevisionDiffResult): RevisionContext => ({
    diffLines: diff.lines,
    summary: diff.summary,
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: profile?.id ?? null,
    notifySummaryText: buildNotifySummary(diff.summary),
  });

  // ── Task 2.12 — ceiling-raise gate (client pre-check + escalation) ──────
  // The SERVER is authoritative: compute_ceiling_breaches recomputes the breach
  // set from DB state (current plan + envelope ordered) and assert_ceiling_raise_
  // gate re-verifies on publish. The client calls compute_ceiling_breaches only
  // to decide whether to hold the publish and to render the breach panel.
  const fetchCeilingBreaches = async (
    projectId: string,
    totals: Map<string, number>,
  ): Promise<CeilingBreach[]> => {
    const { data, error } = await supabase.rpc('compute_ceiling_breaches', {
      p_project_id: projectId,
      p_proposed: proposedAggregatesToArray(totals),
    });
    if (error) throw new Error(error.message);
    return mapCeilingBreachRows((data ?? []) as Array<Record<string, unknown>>);
  };

  // APPROVED, STILL-UNCONSUMED plan_ceiling_raise tasks the estimator can attach +
  // the project's principal (escalation assignee). Mirrors Gate2Screen's override
  // loading. consumed_at IS NULL is the client mirror of migration 079's single-use
  // gate: a task already spent by an earlier re-publish is filtered out here so the
  // picker never offers it (the server would reject it anyway).
  const loadApprovedCeilingTasks = async (projectId: string) => {
    const [taskRes, assignRes, profRes] = await Promise.all([
      supabase
        .from('approval_tasks')
        .select('id, created_at, override_payload')
        .eq('project_id', projectId)
        .eq('entity_type', 'plan_ceiling_raise')
        .in('action', ['APPROVE', 'OVERRIDE'])
        .is('consumed_at', null),
      supabase.from('project_assignments').select('user_id').eq('project_id', projectId),
      supabase.from('profiles').select('id').eq('role', 'principal'),
    ]);
    const tasks = ((taskRes.data ?? []) as Array<{ id: string; created_at: string; override_payload: CeilingRaisePayloadEntry[] | null }>)
      .map(t => ({ id: t.id, created_at: t.created_at, override_payload: t.override_payload ?? [] }));
    setApprovedCeilingTasks(tasks);
    const assignmentIds = ((assignRes.data as Array<{ user_id: string }>) ?? []).map(r => r.user_id);
    const principal = ((profRes.data as Array<{ id: string }>) ?? [])
      .find(p => assignmentIds.includes(p.id));
    setPrincipalId(principal?.id ?? null);
  };

  // Human-readable picker label for an approved ceiling task: creation date +
  // the first authorised material, with a "+N lainnya" tail (e.g.
  // "12 Jul — Besi D13 +2 lainnya"), so the estimator can tell approvals apart.
  const ceilingTaskLabel = (t: { created_at: string; override_payload: CeilingRaisePayloadEntry[] }) => {
    const date = t.created_at
      ? new Date(t.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
      : '—';
    const names = t.override_payload.map(e => e.material_name || e.material_id).filter(Boolean);
    const first = names[0] ?? `${t.override_payload.length} material`;
    const extra = names.length > 1 ? ` +${names.length - 1} lainnya` : '';
    return `${date} — ${first}${extra}`;
  };

  // Confirm tap on the acknowledgment checklist. When the diff raises the ceiling
  // of a material already in overage (client hint — RAISE_ABSOLVING_OVERAGE), the
  // SERVER recomputes the breach set first. Empty → publish. Non-empty + an
  // attached covering approval → publish with the task id (server re-verifies).
  // Otherwise hold and render the breach panel (escalate / attach approved task /
  // revert-and-republish). No RAISE_ABSOLVING lines → straight publish.
  const confirmRepublish = async (diff: PlanRevisionDiffResult) => {
    if (!project) return;
    if (publishing || checkingCeiling) return;
    const revCtx = buildRevisionContext(diff);
    const raisesOverage = diff.lines.some(l => l.classification === 'RAISE_ABSOLVING_OVERAGE');
    if (!raisesOverage) {
      await doPublish(revCtx);
      return;
    }
    setCheckingCeiling(true);
    try {
      const breaches = await fetchCeilingBreaches(project.id, proposedTotals);
      if (breaches.length === 0) {
        // Server disagrees with the client hint (e.g. ordering changed) — no gate.
        await doPublish(revCtx);
        return;
      }
      const selected = selectedCeilingTaskId
        ? approvedCeilingTasks.find(t => t.id === selectedCeilingTaskId)
        : null;
      if (selected && checkCeilingRaiseCoverage(breaches, selected.override_payload).covered) {
        await doPublish(revCtx, selected.id);
        return;
      }
      // Hold: surface the breach panel + load any approved tasks to attach.
      setCeilingBreaches(breaches);
      await loadApprovedCeilingTasks(project.id);
    } catch (err: any) {
      toast(err?.message ?? 'Gagal memeriksa plafon material', 'critical');
    } finally {
      setCheckingCeiling(false);
    }
  };

  // Create the plan_ceiling_raise approval task with the SERVER-computed payload
  // (buildCeilingRaisePayload over compute_ceiling_breaches output — never the
  // client diff). The 079 AFTER INSERT trigger notifies the principal.
  const handleEscalateCeiling = async () => {
    if (!project || !ceilingBreaches) return;
    if (!principalId) {
      toast('Belum ada user principal yang ter-assign di proyek ini', 'critical');
      return;
    }
    setEscalatingCeiling(true);
    try {
      const { error } = await supabase.from('approval_tasks').insert({
        project_id: project.id,
        entity_type: 'plan_ceiling_raise',
        entity_id: project.id,
        assigned_to: principalId,
        override_payload: buildCeilingRaisePayload(ceilingBreaches),
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast('Eskalasi terkirim — menunggu persetujuan prinsipal, lalu publish ulang', 'ok');
    } catch (err: any) {
      toast(err?.message ?? 'Gagal mengirim eskalasi', 'critical');
    } finally {
      setEscalatingCeiling(false);
    }
  };

  // Phase 2 — the actual publish. revisionContext is undefined for a first
  // publish, set (acknowledged) for a re-publish. ceilingApprovalTaskId is the
  // attached principal approval when re-publishing an overage-absolving raise.
  const doPublish = async (revisionContext?: RevisionContext, ceilingApprovalTaskId?: string) => {
    if (!activeSession || !project) return;
    if (publishing) return;

    setPublishing(true);
    try {
      const result = await publishBaseline(
        activeSession.id,
        project.id,
        revisionContext ? { revisionContext, ceilingApprovalTaskId } : undefined,
      );
      if (!result.success) {
        // Server-side ceiling gate backstop (Task 2.12): the client pre-check
        // passed (or was skipped) but assert_ceiling_raise_gate RAISEd. Surface
        // the breach panel from a fresh server recompute instead of a raw error.
        if (result.ceilingApprovalRequired) {
          try {
            const breaches = await fetchCeilingBreaches(project.id, proposedTotals);
            if (breaches.length > 0) {
              setCeilingBreaches(breaches);
              await loadApprovedCeilingTasks(project.id);
            }
          } catch { /* fall through to the toast below */ }
          toast('Kenaikan plafon perlu persetujuan prinsipal — eskalasi lalu publish ulang', 'critical');
          return;
        }
        // Partial-prior-publish dead end (review 5c): the server refuses the
        // re-publish as "belum di-acknowledge" because a current ahs_version
        // exists, yet the client took the first-publish path (revisionContext
        // undefined) because fetchCurrentMaster found NO master to diff — i.e. a
        // prior publish created the version but not the master. The user would
        // otherwise be stuck on an opaque error with no diff to acknowledge.
        if (!revisionContext && /acknowledge|di-acknowledge/i.test(result.error ?? '')) {
          toast(
            'Publish sebelumnya tidak tuntas (versi baseline ada tanpa master material). ' +
            'Tutup lalu buka ulang sesi ini untuk menghitung ulang diff, kemudian publish lagi.',
            'critical',
          );
          return;
        }
        toast(`Publish gagal: ${result.error}`, 'critical');
        return;
      }

      setDiffPreview(null);
      setCeilingBreaches(null);
      setSelectedCeilingTaskId(null);
      toast(`Baseline published: ${result.boqCount} BoQ, ${result.ahsCount} AHS, ${result.materialCount} material`, 'ok');
      setPublishedJustNow(true);

      // Surface BoQ rows excluded because their take-off volume was 0 — these
      // are listed in the source but not part of the published baseline. Never
      // silent: the estimator should know they were left out.
      if (result.skippedZeroPlanned && result.skippedZeroPlanned.length > 0) {
        const codes = result.skippedZeroPlanned;
        const shown = codes.slice(0, 5).join(', ');
        const more = codes.length > 5 ? ` +${codes.length - 5} lagi` : '';
        toast(`${codes.length} baris volume 0 dilewati (tidak masuk baseline): ${shown}${more}`, 'warning');
      }

      // Non-fatal publish warnings (snapshot / plan-revision audit / notify).
      // Closes the 2.10 gap where these were type-erased and never shown.
      if (result.warnings && result.warnings.length > 0) {
        const shown = result.warnings.slice(0, 3).join('; ');
        const more = result.warnings.length > 3 ? ` +${result.warnings.length - 3} lagi` : '';
        toast(`Peringatan publish: ${shown}${more}`, 'warning');
      }

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

  const toggleAckClass = (cls: PlanRevisionClassification) => {
    setAcknowledgedClasses(prev => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  };

  const matName = (id: string) => materialNames.get(id) ?? id;
  const fmtQty = (n: number) => Number(n.toFixed(2)).toLocaleString('id-ID');

  // Blocking re-publish acknowledgment checklist (spec §5). One tickable card
  // per present warning class; "Konfirmasi & Publish" stays disabled until every
  // warning class is acknowledged. No-activity changes + non-warning recorded
  // changes collapse into a summary line.
  const renderRevisionChecklist = () => {
    if (!diffPreview) return null;
    const { warningClasses, lines, summary } = diffPreview;
    const allAcknowledged = warningClasses.every(c => acknowledgedClasses.has(c));
    const collapsedCount = summary.noActivityChanged;
    const recordedNonWarning = summary.added + summary.lowered;

    return (
      <View style={styles.revisionPanel}>
        <Text style={styles.revisionTitle}>Konfirmasi perubahan rencana</Text>
        <Text style={styles.revisionIntro}>
          Re-publish ini mengubah rencana material yang sudah punya permintaan / PO / penerimaan.
          Centang setiap peringatan untuk melanjutkan.
        </Text>

        {warningClasses.map(cls => {
          const meta = REVISION_WARNING_META[cls];
          const affected = lines.filter(l => l.classification === cls);
          const checked = acknowledgedClasses.has(cls);
          const isCritical = meta.severity === 'critical';
          return (
            <View
              key={cls}
              style={[styles.revisionClassCard, isCritical && styles.revisionClassCardCritical]}
            >
              <TouchableOpacity style={styles.revisionCheckboxRow} onPress={() => toggleAckClass(cls)}>
                <View style={[styles.revisionCheckbox, checked && styles.revisionCheckboxChecked]}>
                  {checked && <Ionicons name="checkmark" size={16} color="#fff" />}
                </View>
                <Text style={styles.revisionClassLabel}>{meta.label}</Text>
              </TouchableOpacity>
              <Text style={styles.revisionClassCopy}>{meta.copy}</Text>
              {affected.map(l => {
                // lowerBelowOrderedPct returns Infinity when the new plan is 0
                // (fully absorbed) — render "—" rather than "Infinity%" (Fix 5d).
                const pct = lowerBelowOrderedPct(l);
                const pctLabel = Number.isFinite(pct) ? `${pct}%` : '—';
                const suffix =
                  cls === 'LOWER_BELOW_ORDERED'
                    ? ` — akan tercatat ${pctLabel} melebihi alokasi baru`
                    : cls === 'REMOVED_WITH_ACTIVITY'
                      ? ` — order ${fmtQty(l.ordered_at_time)}, permintaan ${fmtQty(l.requested_at_time)}`
                      : '';
                return (
                  <Text key={l.material_id} style={styles.revisionMatLine}>
                    • {matName(l.material_id)}: {fmtQty(l.planned_before)} → {fmtQty(l.planned_after)}{suffix}
                  </Text>
                );
              })}
            </View>
          );
        })}

        {(recordedNonWarning > 0 || collapsedCount > 0) && (
          <Text style={styles.revisionSummaryLine}>
            {recordedNonWarning > 0
              ? `${recordedNonWarning} perubahan lain dengan aktivitas dicatat (tanpa peringatan). `
              : ''}
            {collapsedCount > 0
              ? `${collapsedCount} material berubah tanpa aktivitas (diringkas).`
              : ''}
          </Text>
        )}

        <View style={styles.revisionBtnRow}>
          <TouchableOpacity
            style={styles.revisionCancelBtn}
            onPress={() => setDiffPreview(null)}
            disabled={publishing}
          >
            <Text style={styles.revisionCancelText}>Batal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.revisionConfirmBtn, (!allAcknowledged || publishing || checkingCeiling) && styles.revisionConfirmBtnDisabled]}
            onPress={() => confirmRepublish(diffPreview)}
            disabled={!allAcknowledged || publishing || checkingCeiling}
          >
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.revisionConfirmText}>
              {checkingCeiling ? 'Memeriksa plafon...' : publishing ? 'Publishing...' : 'Konfirmasi & Publish'}
            </Text>
          </TouchableOpacity>
        </View>

        {renderCeilingBreachPanel()}
      </View>
    );
  };

  // ── Task 2.12 — ceiling-raise breach panel ───────────────────────────────
  // Shown when the server's compute_ceiling_breaches holds the publish: the
  // estimator either escalates to the principal, attaches an already-APPROVED
  // plan_ceiling_raise task and proceeds (server re-verifies), or reverts the
  // raised planned values in the workbook and re-publishes (just re-editing).
  const renderCeilingBreachPanel = () => {
    if (!ceilingBreaches || ceilingBreaches.length === 0) return null;
    const selected = selectedCeilingTaskId
      ? approvedCeilingTasks.find(t => t.id === selectedCeilingTaskId)
      : null;
    const covered = selected
      ? checkCeilingRaiseCoverage(ceilingBreaches, selected.override_payload).covered
      : false;
    return (
      <View style={styles.ceilingPanel}>
        <Text style={styles.ceilingTitle}>Perlu persetujuan prinsipal</Text>
        <Text style={styles.ceilingIntro}>
          Re-publish ini menaikkan plafon material yang jumlah order-nya SUDAH melebihi rencana lama.
          Kenaikan seperti ini butuh persetujuan prinsipal sebelum bisa dipublish.
        </Text>
        {ceilingBreaches.map(b => (
          <Text key={b.material_id} style={styles.ceilingMatLine}>
            • {matName(b.material_id)}: rencana lama {fmtQty(b.planned_before)} → diusulkan {fmtQty(b.proposed)}
            {' '}(sudah order {fmtQty(b.ordered)})
          </Text>
        ))}

        {approvedCeilingTasks.length > 0 && (
          <View style={styles.ceilingPickerBox}>
            <Text style={styles.ceilingPickerLabel}>Lampirkan persetujuan prinsipal:</Text>
            <View style={styles.ceilingPickerWrap}>
              <Picker
                selectedValue={selectedCeilingTaskId ?? ''}
                onValueChange={(v) => setSelectedCeilingTaskId(v ? String(v) : null)}
              >
                <Picker.Item label="— pilih task yang disetujui —" value="" />
                {approvedCeilingTasks.map((t) => (
                  <Picker.Item key={t.id} label={ceilingTaskLabel(t)} value={t.id} />
                ))}
              </Picker>
            </View>
            {selected && !covered && (
              <Text style={styles.ceilingWarn}>
                Persetujuan ini tidak menutup semua material / plafon yang diusulkan. Naikkan persetujuan atau eskalasi ulang.
              </Text>
            )}
          </View>
        )}

        <View style={styles.revisionBtnRow}>
          <TouchableOpacity
            style={[styles.ceilingEscalateBtn, escalatingCeiling && styles.revisionConfirmBtnDisabled]}
            onPress={handleEscalateCeiling}
            disabled={escalatingCeiling}
          >
            <Ionicons name="arrow-up-circle-outline" size={18} color="#fff" />
            <Text style={styles.revisionConfirmText}>{escalatingCeiling ? 'Mengirim...' : 'Eskalasi ke Prinsipal'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.revisionConfirmBtn, (!covered || publishing) && styles.revisionConfirmBtnDisabled]}
            onPress={() => selected && doPublish(buildRevisionContext(diffPreview!), selected.id)}
            disabled={!covered || publishing}
          >
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.revisionConfirmText}>{publishing ? 'Publishing...' : 'Publish dgn persetujuan'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.ceilingHint}>
          Atau kembalikan nilai rencana material tsb ke nilai lama di workbook, lalu publish ulang tanpa gate.
        </Text>
      </View>
    );
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

  const renderReviewCard = (row: ImportStagingRow) => (
    <Card key={row.id} borderColor={row.needs_review ? COLORS.warning : COLORS.border}>
      <View style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceLoc}>📄 {sourceLocation(row)}</Text>
          {(() => {
            const ctx = sourceContext(row, ahsBlockRows);
            return ctx ? <Text style={styles.sourceCtx}>{ctx}</Text> : null;
          })()}
          <View style={styles.confRow}>
            <Text style={styles.hint}>{row.row_type.toUpperCase()} · Confidence: </Text>
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

      {(() => {
        const fx = flagExplanation(row);
        return fx && row.review_status === 'PENDING' ? (
          <View style={styles.flagCallout}>
            <Text style={styles.flagWhy}>❓ Kenapa dicek: {fx.why}</Text>
            <Text style={styles.flagSaran}>💡 Saran: {fx.saran}</Text>
          </View>
        ) : null;
      })()}

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
            <Text style={styles.reviewBtnCaption}>{ACTION_CAPTIONS.setuju}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reviewBtn, { backgroundColor: COLORS.critical }]}
            onPress={() => handleReviewRow(row.id, 'REJECTED')}
          >
            <Text style={styles.reviewBtnText}>Tolak</Text>
            <Text style={styles.reviewBtnCaption}>{ACTION_CAPTIONS.tolak}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reviewBtn, { backgroundColor: COLORS.warning }]}
            onPress={() => startRowCorrection(row)}
          >
            <Text style={styles.reviewBtnText}>Koreksi</Text>
            <Text style={styles.reviewBtnCaption}>{ACTION_CAPTIONS.koreksi}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Inline koreksi editor — expands directly under the tapped
          card, never jumps to the top of the list. */}
      {editingRowId === row.id && (
        <View style={styles.inlineEditor}>
          <Text style={styles.inlineEditorTitle}>
            Editor Koreksi — 📄 {sourceLocation(row)}
          </Text>
          <Text style={styles.hint}>
            {editingAnomalyId
              ? 'Koreksi ini berasal dari review anomali. Saat disimpan, anomali akan ditandai CORRECTED.'
              : 'Ubah hasil parse sebelum baseline dipublish.'}
          </Text>

          {Object.entries((row.parsed_data ?? {}) as Record<string, unknown>).map(([key]) => {
            const dropdownOptions = row.row_type === 'material' ? MATERIAL_DROPDOWNS[key] : null;
            const label = fieldLabel(key);
            const helperText = FIELD_HINTS[key];
            return (
              <View key={key} style={styles.editorField}>
                <Text style={styles.editorLabel}>{label}</Text>
                {helperText && (
                  <Text style={styles.editorHint}>{helperText}</Text>
                )}
                {dropdownOptions ? (
                  <View style={styles.pickerWrap}>
                    <Picker
                      selectedValue={editDraft[key] ?? ''}
                      onValueChange={(val) => setEditDraft(prev => ({ ...prev, [key]: String(val) }))}
                      style={styles.picker}
                    >
                      <Picker.Item label={`Pilih ${label}...`} value="" color={COLORS.textSec} />
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
                    placeholder={`Isi ${label}`}
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
        </View>
      )}
    </Card>
  );

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

            {publishedJustNow && onGoToJadwal && (
              <Card borderColor={COLORS.ok}>
                <Text style={styles.msLabel}>Baseline berhasil dipublikasi</Text>
                <Text style={{ fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 4 }}>
                  Langkah selanjutnya: atur jadwal milestone untuk proyek ini.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={onGoToJadwal}>
                  <Text style={styles.primaryBtnText}>Atur Jadwal →</Text>
                </TouchableOpacity>
              </Card>
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

            {probe && probe.rows_needing_expansion > 0 && !normalized && (
              <View style={styles.normalizeBanner}>
                <Text style={styles.normalizeBannerText}>
                  Detected: {probe.rows_needing_expansion} rows need detail expansion.
                </Text>
                <View style={styles.normalizeBannerActions}>
                  <TouchableOpacity
                    style={[styles.uploadBtn, { backgroundColor: COLORS.primary, flex: 1 }]}
                    onPress={async () => {
                      if (!currentStoragePath) return;
                      setNormalizing(true);
                      try {
                        const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
                        const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
                        const r = await normalizeBoq({ storagePath: currentStoragePath, supabaseUrl: url, anonKey: anon });
                        setCurrentStoragePath(r.normalized_path);
                        setNormalized(r);
                      } catch (err) {
                        console.warn('normalizeBoq failed:', err);
                      } finally {
                        setNormalizing(false);
                      }
                    }}
                    disabled={normalizing}
                  >
                    <Text style={styles.uploadText}>{normalizing ? 'Normalizing…' : 'Normalize with AI'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.uploadBtn, { backgroundColor: COLORS.textMuted, flex: 1 }]}
                    onPress={() => setProbe(null)}
                  >
                    <Text style={styles.uploadText}>Skip</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {normalized && (
              <View style={styles.normalizeBanner}>
                <Text style={styles.normalizeBannerText}>
                  Normalized: {normalized.summary.rows_normalized} rows
                  {normalized.summary.rows_with_mismatch > 0 ? `  (⚠ ${normalized.summary.rows_with_mismatch} flagged)` : ''}
                </Text>
              </View>
            )}

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

            {/* Editor Koreksi is rendered inline inside the tapped staging
                row card (see the stagingRows.map below). Keeping it there
                anchors the form directly under whatever card the user tapped
                instead of jumping the whole viewport to the top of the list. */}

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

            {/* ── Exception-based review controls ── */}
            <View style={styles.reviewControls}>
              <View style={styles.reviewFilterRow}>
                <TouchableOpacity
                  onPress={() => setReviewFilter('exceptions')}
                  style={[styles.reviewFilterBtn, reviewFilter === 'exceptions' && styles.reviewFilterBtnActive]}
                  accessibilityRole="button"
                >
                  <Text style={reviewFilter === 'exceptions' ? styles.reviewFilterTextActive : styles.reviewFilterText}>
                    Perlu review ({stagingRows.filter(r => r.needs_review || r.review_status === 'REJECTED').length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setReviewFilter('all')}
                  style={[styles.reviewFilterBtn, reviewFilter === 'all' && styles.reviewFilterBtnActive]}
                  accessibilityRole="button"
                >
                  <Text style={reviewFilter === 'all' ? styles.reviewFilterTextActive : styles.reviewFilterText}>
                    Semua ({stagingRows.length})
                  </Text>
                </TouchableOpacity>
              </View>
              {cleanPendingRows.length > 0 && (
                <TouchableOpacity
                  style={[styles.bulkApproveBtn, bulkApproving && { opacity: 0.6 }]}
                  onPress={handleBulkApproveClean}
                  disabled={bulkApproving}
                  accessibilityRole="button"
                  accessibilityLabel={`Setujui ${cleanPendingRows.length} baris bersih`}
                >
                  {bulkApproving
                    ? <ActivityIndicator size="small" color={COLORS.ok} />
                    : <Ionicons name="checkmark-done" size={16} color={COLORS.ok} />}
                  <Text style={styles.bulkApproveText}>Setujui {cleanPendingRows.length} baris bersih</Text>
                </TouchableOpacity>
              )}
            </View>

            {visibleReviewRows.length === 0 && (
              <Card>
                <Text style={styles.hint}>
                  {reviewFilter === 'exceptions'
                    ? 'Tidak ada baris yang perlu review — semua bersih. Pilih “Semua” untuk meninjau seluruh baris.'
                    : 'Tidak ada baris.'}
                </Text>
              </Card>
            )}

            {reviewFilter === 'exceptions'
              ? groupReviewRows(visibleReviewRows).map(group => {
                  const pending = pendingRowIds(group.rows);
                  const isCollapsed = collapsedGroups[group.key] ?? group.rows.length > 10;
                  return (
                    <View key={group.key} style={styles.reviewGroup}>
                      <View style={styles.groupHeader}>
                        <TouchableOpacity
                          style={styles.groupHeaderMain}
                          onPress={() => setCollapsedGroups(c => ({ ...c, [group.key]: !isCollapsed }))}
                          accessibilityRole="button"
                        >
                          <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={16} color={COLORS.textSec} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.groupHeaderTitle}>{group.label} ({pending.length}/{group.rows.length})</Text>
                            {FLAG_GROUP_HINTS[group.key] ? (
                              <Text style={styles.groupHeaderHint}>{FLAG_GROUP_HINTS[group.key]}</Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                        {group.batchable && pending.length > 0 && (
                          <View style={[styles.groupBatchBtns, batchReviewing && { opacity: 0.5 }]}>
                            <TouchableOpacity onPress={() => handleBatchReview(pending, 'REJECTED')} style={styles.groupBatchReject} disabled={batchReviewing}>
                              <Text style={styles.groupBatchRejectText}>Tolak semua {pending.length}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleBatchReview(pending, 'APPROVED')} style={styles.groupBatchApprove} disabled={batchReviewing}>
                              <Text style={styles.groupBatchApproveText}>Setujui semua {pending.length}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                      {!isCollapsed && (
                        group.key === 'literal_component'
                          ? subGroupByParentBlock(group.rows).map(sub => (
                              <View key={sub.title}>
                                <Text style={styles.subGroupHeader}>{sub.title} ({sub.rows.length})</Text>
                                {sub.rows.map(renderReviewCard)}
                              </View>
                            ))
                          : group.rows.map(renderReviewCard)
                      )}
                    </View>
                  );
                })
              : visibleReviewRows.map(renderReviewCard)}

            {diffPreview && renderRevisionChecklist()}

            {stagingRows.length > 0 && !diffPreview && (
              <TouchableOpacity
                style={styles.publishBtn}
                onPress={handlePublish}
                disabled={publishing || preparingDiff}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.publishText}>
                  {preparingDiff ? 'Menghitung perubahan...' : publishing ? 'Publishing...' : 'Publish Baseline'}
                </Text>
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
  msLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center', marginTop: SPACE.sm },
  primaryBtnText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
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
  sourceLoc: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: TYPE.base, fontWeight: '700', color: COLORS.text },
  sourceCtx: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  confRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  confValue: { fontSize: TYPE.xs, fontFamily: FONTS.bold },
  dataPreview: { backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 4, padding: 8, marginTop: 8 },
  inlineEditor: {
    marginTop: SPACE.md,
    paddingTop: SPACE.md,
    paddingHorizontal: SPACE.sm,
    paddingBottom: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: 'rgba(59, 130, 246, 0.04)',
    borderRadius: RADIUS,
  },
  inlineEditorTitle: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.text,
    marginBottom: 4,
  },
  editorField: { marginTop: 10 },
  editorLabel: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: 4 },
  editorHint: { fontSize: TYPE.xs, color: COLORS.textSec, marginBottom: 6, lineHeight: TYPE.xs * 1.4 },
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
  reviewBtnCaption: { fontSize: TYPE.xs, color: COLORS.textInverse, opacity: 0.85, textAlign: 'center', marginTop: 2 },
  flagCallout: {
    backgroundColor: COLORS.surface,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
    borderRadius: 6,
    padding: SPACE.sm,
    marginTop: SPACE.sm,
  },
  flagWhy: { fontSize: TYPE.sm, color: COLORS.text },
  flagSaran: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.ok, borderRadius: RADIUS, padding: SPACE.base, marginTop: SPACE.base },
  publishText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  // ── Re-publish diff-and-acknowledge checklist (Task 2.11) ──
  revisionPanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.warning, borderRadius: RADIUS, padding: SPACE.base, marginTop: SPACE.base, gap: SPACE.sm },
  revisionTitle: { color: COLORS.text, fontSize: TYPE.base, fontFamily: FONTS.bold },
  revisionIntro: { color: COLORS.textSec, fontSize: TYPE.xs, marginBottom: SPACE.xs },
  revisionClassCard: { borderWidth: 1, borderColor: COLORS.warning, borderRadius: RADIUS, padding: SPACE.sm, gap: SPACE.xs, backgroundColor: COLORS.bg },
  revisionClassCardCritical: { borderColor: COLORS.critical },
  revisionCheckboxRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  revisionCheckbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: COLORS.textSec, alignItems: 'center', justifyContent: 'center' },
  revisionCheckboxChecked: { backgroundColor: COLORS.ok, borderColor: COLORS.ok },
  revisionClassLabel: { flex: 1, color: COLORS.text, fontSize: TYPE.sm, fontFamily: FONTS.bold },
  revisionClassCopy: { color: COLORS.textSec, fontSize: TYPE.xs },
  revisionMatLine: { color: COLORS.text, fontSize: TYPE.xs, marginLeft: SPACE.xs },
  revisionSummaryLine: { color: COLORS.textSec, fontSize: TYPE.xs, fontStyle: 'italic' },
  revisionBtnRow: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.xs },
  revisionCancelBtn: { paddingVertical: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border },
  revisionCancelText: { color: COLORS.textSec, fontSize: TYPE.sm, fontFamily: FONTS.bold },
  revisionConfirmBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.ok, borderRadius: RADIUS, paddingVertical: SPACE.sm },
  revisionConfirmBtnDisabled: { opacity: 0.45 },
  revisionConfirmText: { color: COLORS.textInverse, fontSize: TYPE.sm, fontFamily: FONTS.bold, textTransform: 'uppercase' },
  // Task 2.12 — ceiling-raise breach panel
  ceilingPanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS, padding: SPACE.base, marginTop: SPACE.base, gap: SPACE.sm },
  ceilingTitle: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.critical, textTransform: 'uppercase', letterSpacing: 0.4 },
  ceilingIntro: { fontSize: TYPE.xs, color: COLORS.textSec, lineHeight: 17 },
  ceilingMatLine: { color: COLORS.text, fontSize: TYPE.xs, marginLeft: SPACE.xs },
  ceilingPickerBox: { gap: SPACE.xs, marginTop: SPACE.xs },
  ceilingPickerLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  ceilingPickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, overflow: 'hidden' },
  ceilingWarn: { fontSize: TYPE.xs, color: COLORS.critical },
  ceilingHint: { fontSize: TYPE.xs, color: COLORS.textSec, fontStyle: 'italic', marginTop: SPACE.xs },
  ceilingEscalateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.critical, borderRadius: RADIUS, paddingVertical: SPACE.sm },
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
  reviewControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.sm, marginBottom: SPACE.sm, flexWrap: 'wrap',
  },
  reviewFilterRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  reviewFilterBtn: {
    paddingHorizontal: SPACE.md, paddingVertical: 8,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  reviewFilterBtnActive: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  reviewFilterText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
  reviewFilterTextActive: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textInverse },
  bulkApproveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    paddingHorizontal: SPACE.md, paddingVertical: 8,
    borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.ok,
    backgroundColor: COLORS.surface,
  },
  bulkApproveText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.ok },
  normalizeBanner: { backgroundColor: COLORS.surface, borderRadius: RADIUS, padding: SPACE.base, marginBottom: SPACE.base, borderWidth: 1, borderColor: COLORS.border },
  normalizeBannerText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, marginBottom: SPACE.sm },
  normalizeBannerActions: { flexDirection: 'row', gap: SPACE.sm },
  reviewGroup: { marginTop: SPACE.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACE.sm, gap: SPACE.sm },
  groupHeaderMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flex: 1 },
  groupHeaderTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, flexShrink: 1 },
  groupHeaderHint: { fontSize: TYPE.xs, color: COLORS.textSec, marginTop: 2 },
  groupBatchBtns: { flexDirection: 'row', gap: 6 },
  groupBatchReject: { backgroundColor: COLORS.critical, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
  groupBatchRejectText: { fontSize: TYPE.xs, color: COLORS.textInverse, fontFamily: FONTS.semibold },
  groupBatchApprove: { backgroundColor: COLORS.ok, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8 },
  groupBatchApproveText: { fontSize: TYPE.xs, color: COLORS.textInverse, fontFamily: FONTS.semibold },
  subGroupHeader: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.semibold, marginTop: SPACE.sm, marginBottom: 2 },
});
