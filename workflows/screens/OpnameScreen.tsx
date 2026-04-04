/**
 * OpnameScreen
 *
 * Weekly progress payment workflow:
 *   DRAFT     → Supervisor/estimator/admin prepares claim percentages
 *   SUBMITTED → Submitted for estimator verification
 *   VERIFIED  → Estimator adjusted %s, flagged TDK ACC lines
 *   APPROVED  → Admin confirmed kasbon, released payment
 *   PAID      → Excel export generated, opname closed
 *
 * Roles:
 *   supervisor — proposes progress claim percentages
 *   estimator  — can prepare draft, verify, adjust % and flag TDK ACC
 *   admin      — approves (sets kasbon, releases)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Share, Alert, Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Buffer } from 'buffer';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import Header from '../components/Header';
import Card   from '../components/Card';
import Badge  from '../components/Badge';
import DateSelectField, { getTodayIsoDate } from '../components/DateSelectField';
import { useProject } from '../hooks/useProject';
import { useToast }   from '../components/Toast';
import { readPickedWorkbook } from '../utils/workbookPicker';
import { suggestHarianAllocation, logAIUsage } from '../../tools/ai-assist';
import {
  getMandorContracts, getOpnameHeaders, createOpnameHeader,
  getOpnameLines, getOpnameProgressFlags, hasConfiguredContractRates, initOpnameLines, updateOpnameLine,
  submitOpname, verifyOpname, approveOpname, markOpnamePaid,
  parseOpnameProgressWorkbook, buildOpnameProgressImportPlan, applyOpnameProgressImport,
  exportOpnameToExcel, exportOpnameProgressTemplate, formatRp,
  getHarianCostAllocations, saveHarianCostAllocation, deleteHarianCostAllocation,
  summarizeHarianCostAllocations, applyHarianAiSuggestions, getHarianAllocationBoqCandidates,
  type MandorContract, type OpnameHeader, type OpnameLine, type OpnameProgressFlag,
  type HarianCostAllocation, type HarianAllocationBoqCandidate, type HarianAllocationScope,
} from '../../tools/opname';
import { getUnsettledAttendanceTotal } from '../../tools/attendance';
import {
  getAttendanceByWeek, getWeekStart, getWeekEnd, formatPayPreview,
  createHarianOpname, recomputeHarianOpname,
  attendanceStatusLabel,
  type WorkerAttendanceEntry,
} from '../../tools/workerAttendance';
import {
  getKasbonByContract, requestKasbon, approveKasbon,
  kasbonStatusLabel,
} from '../../tools/kasbon';
import type { Kasbon } from '../../tools/types';
import { supabase } from '../../tools/supabase';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'list' | 'detail' | 'lines';

const STATUS_CONFIG: Record<string, { color: string; label: string; flag: string }> = {
  DRAFT:     { color: COLORS.textSec,  label: 'Draft',     flag: 'INFO' },
  SUBMITTED: { color: COLORS.info,     label: 'Diajukan',  flag: 'INFO' },
  VERIFIED:  { color: COLORS.warning,  label: 'Terverif.', flag: 'WARNING' },
  APPROVED:  { color: COLORS.ok,       label: 'Disetujui', flag: 'OK' },
  PAID:      { color: COLORS.ok,       label: 'Dibayar',   flag: 'OK' },
};

const HARIAN_SCOPE_LABELS: Record<HarianAllocationScope, string> = {
  boq_item: 'Item BoQ',
  general_support: 'Support Umum',
  rework: 'Rework / Punchlist',
  site_overhead: 'Overhead Lapangan',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function OpnameScreen({
  onBack,
  initialContractId,
}: {
  onBack: () => void;
  initialContractId?: string;
}) {
  const { project, profile } = useProject();
  const { show: toast } = useToast();

  const [view, setView] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [importingProgress, setImportingProgress] = useState(false);

  // List
  const [contracts, setContracts] = useState<MandorContract[]>([]);
  const [selectedContract, setSelectedContract] = useState<MandorContract | null>(null);
  const [opnames, setOpnames] = useState<OpnameHeader[]>([]);

  // Create new
  const [showCreate, setShowCreate] = useState(false);
  const [newWeek, setNewWeek] = useState('');
  const [newDate, setNewDate] = useState(getTodayIsoDate());

  // Detail / Lines
  const [activeOpname, setActiveOpname] = useState<OpnameHeader | null>(null);
  const [lines, setLines]               = useState<OpnameLine[]>([]);
  const [progressFlags, setProgressFlags] = useState<Record<string, OpnameProgressFlag>>({});
  const [lineInputs, setLineInputs]     = useState<Record<string, { cumulative_pct: string; verified_pct: string }>>({});
  const [kasbonInput, setKasbonInput]   = useState('');
  const [verifyNotes, setVerifyNotes]   = useState('');
  const [kasbonEntries, setKasbonEntries] = useState<Kasbon[]>([]);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [showKasbonForm, setShowKasbonForm] = useState(false);
  const [kasbonFormAmount, setKasbonFormAmount] = useState('');
  const [kasbonFormReason, setKasbonFormReason] = useState('');
  const [newPaymentType, setNewPaymentType] = useState<'borongan' | 'harian'>('borongan');
  const [harianEntries, setHarianEntries] = useState<WorkerAttendanceEntry[]>([]);
  const [harianAllocations, setHarianAllocations] = useState<HarianCostAllocation[]>([]);
  const [harianAllocationCandidates, setHarianAllocationCandidates] = useState<HarianAllocationBoqCandidate[]>([]);
  const [allocationInputs, setAllocationInputs] = useState<Record<string, {
    allocation_pct: string;
    supervisor_note: string;
    estimator_note: string;
  }>>({});
  const [showAddAllocation, setShowAddAllocation] = useState(false);
  const [addAllocationScope, setAddAllocationScope] = useState<HarianAllocationScope>('boq_item');
  const [addAllocationBoqItemId, setAddAllocationBoqItemId] = useState('');
  const [addAllocationPct, setAddAllocationPct] = useState('');
  const [addAllocationAmount, setAddAllocationAmount] = useState('');
  const [addSupervisorNote, setAddSupervisorNote] = useState('');
  const [addEstimatorNote, setAddEstimatorNote] = useState('');
  const [aiAllocating, setAiAllocating] = useState(false);
  const [aiAllocationSummary, setAiAllocationSummary] = useState<string | null>(null);
  const [savingAllocationId, setSavingAllocationId] = useState<string | null>(null);
  const [deletingAllocationId, setDeletingAllocationId] = useState<string | null>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [tdkAccLineId, setTdkAccLineId] = useState<string | null>(null);
  const [tdkAccReason, setTdkAccReason] = useState('');

  const role = profile?.role ?? null;
  const canDraftEditRole = ['supervisor', 'estimator', 'admin', 'principal'].includes(role ?? '');
  const isEstimator = profile?.role === 'estimator' || profile?.role === 'admin' || profile?.role === 'principal';
  const isAdmin     = profile?.role === 'admin' || profile?.role === 'principal';
  const canImportProgress = !!activeOpname
    && lines.length > 0
    && (
      (activeOpname.status === 'DRAFT' && canDraftEditRole)
      || (activeOpname.status === 'SUBMITTED' && isEstimator)
    );
  const canEditHarianAllocation = !!activeOpname
    && activeOpname.payment_type === 'harian'
    && (
      (activeOpname.status === 'DRAFT' && canDraftEditRole)
      || (activeOpname.status === 'SUBMITTED' && isEstimator)
    );
  const canEditEstimatorAllocationNote = !!activeOpname
    && activeOpname.payment_type === 'harian'
    && (
      (activeOpname.status === 'DRAFT' && isEstimator)
      || (activeOpname.status === 'SUBMITTED' && isEstimator)
    );

  // ── Load ────────────────────────────────────────────────────────────────

  const loadContracts = useCallback(async () => {
    if (!project) return;
    const data = await getMandorContracts(project.id);
    setContracts(data);
    if (!data.length) {
      setSelectedContract(null);
      return;
    }
    const preferred = initialContractId
      ? data.find(contract => contract.id === initialContractId)
      : null;
    setSelectedContract(prev => {
      if (preferred) return preferred;
      if (prev && data.some(contract => contract.id === prev.id)) return prev;
      return data[0];
    });
  }, [project, initialContractId]);

  const loadOpnames = useCallback(async () => {
    if (!project || !selectedContract) return;
    setLoading(true);
    const data = await getOpnameHeaders(project.id, selectedContract.id);
    setOpnames(data);
    setLoading(false);
  }, [project, selectedContract]);

  const loadLines = useCallback(async (opname: OpnameHeader) => {
    setLoading(true);
    const [data, flagRows] = await Promise.all([
      getOpnameLines(opname.id),
      getOpnameProgressFlags(opname.id),
    ]);
    setLines(data);
    setLineInputs(Object.fromEntries(
      data.map(line => [line.id, {
        cumulative_pct: String(line.cumulative_pct),
        verified_pct: String(line.verified_pct ?? line.cumulative_pct),
      }])
    ));
    setProgressFlags(Object.fromEntries(flagRows.map(flag => [flag.line_id, flag])));
    setLoading(false);
  }, []);

  const syncAllocationInputs = useCallback((allocations: HarianCostAllocation[]) => {
    setAllocationInputs(Object.fromEntries(
      allocations.map(allocation => [allocation.id, {
        allocation_pct: String(Math.round(Number(allocation.allocation_pct ?? 0) * 100) / 100),
        supervisor_note: allocation.supervisor_note ?? '',
        estimator_note: allocation.estimator_note ?? '',
      }]),
    ));
  }, []);

  const resetHarianAllocationForm = useCallback(() => {
    setShowAddAllocation(false);
    setAddAllocationScope('boq_item');
    setAddAllocationPct('');
    setAddAllocationAmount('');
    setAddSupervisorNote('');
    setAddEstimatorNote('');
  }, []);

  const loadHarianDetail = useCallback(async (opname: OpnameHeader) => {
    const entriesPromise = opname.week_start && opname.week_end
      ? getAttendanceByWeek(opname.contract_id, opname.week_start, opname.week_end)
      : Promise.resolve([]);
    const [entries, allocations, candidates] = await Promise.all([
      entriesPromise,
      getHarianCostAllocations(opname.id),
      getHarianAllocationBoqCandidates(opname.contract_id),
    ]);

    setHarianEntries(entries);
    setHarianAllocations(allocations);
    syncAllocationInputs(allocations);
    setHarianAllocationCandidates(candidates);
    setAddAllocationBoqItemId(prev => prev || candidates[0]?.id || '');
    setAiAllocationSummary(null);
    resetHarianAllocationForm();
  }, [resetHarianAllocationForm, syncAllocationInputs]);

  const loadKasbon = useCallback(async () => {
    if (!selectedContract) return;
    const [data, attTotal] = await Promise.all([
      getKasbonByContract(selectedContract.id),
      getUnsettledAttendanceTotal(selectedContract.id),
    ]);
    setKasbonEntries(data);
    setAttendanceTotal(attTotal);
  }, [selectedContract]);

  const refreshActiveOpname = useCallback(async () => {
    if (!activeOpname) return;
    const updated = await getOpnameHeaders(activeOpname.project_id, selectedContract?.id);
    const refreshed = updated.find(opname => opname.id === activeOpname.id);
    if (refreshed) setActiveOpname(refreshed);
  }, [activeOpname, selectedContract]);

  useEffect(() => { loadContracts(); }, [loadContracts]);
  useEffect(() => { if (selectedContract) { loadOpnames(); loadKasbon(); } }, [selectedContract, loadOpnames, loadKasbon]);

  // ── Kasbon actions ─────────────────────────────────────────────────────────

  const handleRequestKasbon = () => {
    if (!selectedContract || !project) return;
    setKasbonFormAmount('');
    setKasbonFormReason('');
    setShowKasbonForm(true);
  };

  const handleSubmitKasbonForm = async () => {
    if (!selectedContract) return;
    const amount = parseFloat(kasbonFormAmount.replace(/[^\d.]/g, ''));
    if (!amount || amount <= 0) { toast('Masukkan jumlah yang valid', 'warning'); return; }
    setSaving(true);
    const { error } = await requestKasbon(
      selectedContract.id, amount, kasbonFormReason.trim() || 'Kasbon mandor',
    );
    setSaving(false);
    if (error) { toast(error, 'critical'); return; }
    toast(`Kasbon ${formatRp(amount)} diajukan`, 'ok');
    setShowKasbonForm(false);
    loadKasbon();
  };

  const handleApproveKasbon = async (kasbon: Kasbon) => {
    const { error } = await approveKasbon(kasbon.id);
    if (error) toast(error, 'critical');
    else { toast('Kasbon disetujui', 'ok'); loadKasbon(); }
  };

  // ── Create opname ───────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!project || !profile || !selectedContract) return;
    const week = parseInt(newWeek);
    if (isNaN(week) || week < 1) { toast('Masukkan nomor minggu yang valid', 'warning'); return; }
    if (!newDate) { toast('Masukkan tanggal opname', 'warning'); return; }

    // Duplicate week guard — check before hitting DB constraint
    const existingWeek = opnames.find(o => o.week_number === week);
    if (existingWeek) {
      toast(`Opname minggu ${week} sudah ada untuk kontrak ini`, 'warning');
      return;
    }

    const payType = (selectedContract.payment_mode === 'borongan') ? 'borongan'
      : (selectedContract.payment_mode === 'harian') ? 'harian'
      : newPaymentType; // campuran: user picks

    setSaving(true);

    if (payType === 'harian') {
      // Harian opname: attendance-based
      const ws = getWeekStart(new Date(newDate));
      const we = getWeekEnd(new Date(newDate));
      const { data: header, error } = await createHarianOpname({
        contractId: selectedContract.id,
        weekNumber: week,
        opnameDate: newDate,
        weekStart: ws,
        weekEnd: we,
      });
      setSaving(false);
      if (error || !header) { toast(error ?? 'Gagal membuat opname harian', 'critical'); return; }
      toast(`Opname harian minggu ${week} dibuat`, 'ok');
      setShowCreate(false);
      setNewWeek('');
      setActiveOpname(header);
      await loadHarianDetail(header);
      setView('lines');
    } else {
      // Borongan opname: BoQ lines
      const hasRates = await hasConfiguredContractRates(selectedContract.id);
      if (!hasRates) {
        toast('Set Harga di Kontrak Mandor dulu supaya item BoQ masuk ke opname', 'warning');
        setSaving(false);
        return;
      }

      const header = await createOpnameHeader(
        project.id, selectedContract.id, week, newDate, selectedContract.retention_pct,
      );
      if (!header) { toast('Gagal membuat opname', 'critical'); setSaving(false); return; }

      const { count, error } = await initOpnameLines(header.id, selectedContract.id, week);
      if (error || count === 0) {
        await supabase.from('opname_headers').delete().eq('id', header.id);
        toast(error ?? 'Belum ada item kontrak mandor yang terhubung ke BoQ', 'critical');
        setSaving(false);
        return;
      }

      toast(`Opname minggu ${week} dibuat — ${count} item`, 'ok');
      setSaving(false);
      setShowCreate(false);
      setNewWeek('');
      setActiveOpname(header);
      await loadLines(header);
      setView('lines');
    }
  }, [loadHarianDetail, loadLines, opnames, project, profile, selectedContract, newDate, newPaymentType, newWeek, toast]);

  // ── Open opname ─────────────────────────────────────────────────────────

  const openOpname = async (opname: OpnameHeader) => {
    setActiveOpname(opname);
    setKasbonInput(opname.kasbon > 0 ? String(Math.round(opname.kasbon)) : '');
    setVerifyNotes(opname.verifier_notes ?? '');
    if (opname.payment_type === 'harian') {
      await loadHarianDetail(opname);
    } else {
      setHarianEntries([]);
      setHarianAllocations([]);
      setHarianAllocationCandidates([]);
      setAllocationInputs({});
      setAiAllocationSummary(null);
      await loadLines(opname);
    }
    setView('lines');
  };

  // ── Update line ─────────────────────────────────────────────────────────

  const handleLineChange = async (
    line: OpnameLine,
    field: 'cumulative_pct' | 'verified_pct',
    value: string,
  ) => {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    const clamped = Math.max(line.prev_cumulative_pct, Math.min(100, parsed));

    const { error } = await updateOpnameLine(line.id, line.header_id, { [field]: clamped });
    if (error) {
      toast(error, 'critical');
      return;
    }

    await loadLines(activeOpname!);
    await refreshActiveOpname();
  };

  const handleLineInputText = (
    lineId: string,
    field: 'cumulative_pct' | 'verified_pct',
    value: string,
  ) => {
    const sanitized = value.replace(/[^\d.]/g, '');
    setLineInputs(prev => ({
      ...prev,
      [lineId]: {
        cumulative_pct: prev[lineId]?.cumulative_pct ?? '',
        verified_pct: prev[lineId]?.verified_pct ?? '',
        [field]: sanitized,
      },
    }));
  };

  const handleLineCommit = async (
    line: OpnameLine,
    field: 'cumulative_pct' | 'verified_pct',
  ) => {
    const currentValue = lineInputs[line.id]?.[field] ?? String(field === 'verified_pct' ? (line.verified_pct ?? line.cumulative_pct) : line.cumulative_pct);
    await handleLineChange(line, field, currentValue);
  };

  const getPreviewInputPct = (
    line: OpnameLine,
    field: 'cumulative_pct' | 'verified_pct',
  ) => {
    const fallback = field === 'verified_pct'
      ? (line.verified_pct ?? line.cumulative_pct)
      : line.cumulative_pct;
    const raw = lineInputs[line.id]?.[field];
    const parsed = raw == null || raw === '' ? NaN : parseFloat(raw);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(line.prev_cumulative_pct, Math.min(100, parsed));
  };

  const getPreviewLine = (line: OpnameLine) => {
    const previewCumulativePct = getPreviewInputPct(line, 'cumulative_pct');
    const previewVerifiedPct = activeOpname?.status === 'SUBMITTED' && isEstimator
      ? getPreviewInputPct(line, 'verified_pct')
      : line.verified_pct;
    const effectivePct = previewVerifiedPct ?? previewCumulativePct;
    const thisWeekPct = Math.max(0, effectivePct - line.prev_cumulative_pct);
    const cumulativeAmount = line.budget_volume * line.contracted_rate * (effectivePct / 100);
    const thisWeekAmount = line.budget_volume * line.contracted_rate * (thisWeekPct / 100);

    return {
      ...line,
      previewCumulativePct,
      previewVerifiedPct,
      effectivePct,
      thisWeekPct,
      cumulativeAmount,
      thisWeekAmount,
    };
  };

  const previewLines = lines.map(getPreviewLine);
  const previewGrossTotal = previewLines.reduce((sum, line) => (
    line.is_tdk_acc ? sum : sum + line.cumulativeAmount
  ), 0);
  const previewRetentionAmount = previewGrossTotal * ((activeOpname?.retention_pct ?? 0) / 100);
  const previewNetToDate = previewGrossTotal - previewRetentionAmount;
  const previewKasbon = activeOpname?.status === 'VERIFIED' && isAdmin
    ? (parseFloat(kasbonInput.replace(/[^\d.]/g, '')) || 0)
    : (activeOpname?.kasbon ?? 0);
  const previewNetThisWeek = Math.max(0, previewNetToDate - (activeOpname?.prior_paid ?? 0) - previewKasbon);
  const harianAllocationSummary = summarizeHarianCostAllocations(
    harianAllocations,
    activeOpname?.gross_total ?? 0,
  );
  const addAllocationPreviewPct = (() => {
    const amount = parseFloat(addAllocationAmount.replace(/[^\d.]/g, ''));
    if (Number.isFinite(amount) && amount > 0 && (activeOpname?.gross_total ?? 0) > 0) {
      return Math.max(0, Math.min(100, (amount / (activeOpname?.gross_total ?? 1)) * 100));
    }
    const pct = parseFloat(addAllocationPct.replace(/[^\d.]/g, ''));
    return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  })();

  const handleTdkAcc = async (line: OpnameLine) => {
    if (line.is_tdk_acc) {
      // Undo TDK ACC directly
      const { error } = await updateOpnameLine(line.id, line.header_id, {
        is_tdk_acc: false,
        tdk_acc_reason: null,
      });
      if (error) toast(error, 'critical');
      else {
        await loadLines(activeOpname!);
        await refreshActiveOpname();
      }
    } else {
      // Show inline TDK ACC reason form
      setTdkAccLineId(line.id);
      setTdkAccReason('');
    }
  };

  const handleTdkAccSubmit = async () => {
    if (!tdkAccLineId || !activeOpname) return;
    const line = lines.find(l => l.id === tdkAccLineId);
    if (!line) return;
    const { error } = await updateOpnameLine(line.id, line.header_id, {
      is_tdk_acc: true,
      tdk_acc_reason: tdkAccReason.trim() || 'Pekerjaan belum memenuhi standar',
    });
    if (error) toast(error, 'critical');
    else {
      setTdkAccLineId(null);
      await loadLines(activeOpname!);
      await refreshActiveOpname();
    }
  };

  const handleImportProgress = useCallback(async () => {
    if (!activeOpname || !lines.length) return;

    const targetField = activeOpname.status === 'SUBMITTED' && isEstimator
      ? 'verified_pct'
      : 'cumulative_pct';
    const targetLabel = targetField === 'verified_pct'
      ? 'Verifikasi % (estimator)'
      : 'Progress % (kumulatif)';

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
        copyToCacheDirectory: true,
        base64: false,
      });

      if (picked.canceled || !picked.assets?.length) return;

      const asset = picked.assets[0];
      setImportingProgress(true);
      const { arrayBuffer } = await readPickedWorkbook(asset);
      const importedRows = parseOpnameProgressWorkbook(arrayBuffer.slice(0), asset.name);
      const plan = buildOpnameProgressImportPlan(lines, importedRows);
      setImportingProgress(false);

      if (!importedRows.length) {
        toast('Format file belum terbaca. Sertakan kolom Kode BoQ atau Uraian Pekerjaan, plus Progress (%).', 'warning');
        return;
      }

      if (!plan.matches.length) {
        const issue = plan.invalidProgressRows.length > 0
          ? 'Angka progress di file belum terbaca.'
          : 'Tidak ada item yang cocok ke daftar opname ini.';
        toast(issue, 'warning');
        return;
      }

      const detailLines = [
        `${plan.matches.length} item akan diisi ke ${targetLabel}.`,
        'Pencocokan memakai kode BoQ dulu, lalu uraian pekerjaan.',
        plan.matchCounts.boq_code > 0 ? `${plan.matchCounts.boq_code} item cocok lewat kode BoQ.` : '',
        plan.matchCounts.description > 0 ? `${plan.matchCounts.description} item cocok lewat uraian pekerjaan.` : '',
        plan.invalidProgressRows.length > 0 ? `${plan.invalidProgressRows.length} baris punya angka progress yang tidak valid.` : '',
        plan.unmatchedCount > 0 ? `${plan.unmatchedCount} baris tidak cocok ke opname ini.` : '',
        plan.duplicateMatches.length > 0 ? `${plan.duplicateMatches.length} baris duplikat akan diabaikan.` : '',
        plan.unmatchedRows.length > 0 ? `Contoh tidak cocok: ${plan.unmatchedRows.slice(0, 3).join('; ')}` : '',
      ].filter(Boolean);

      Alert.alert(
        'Import Progress Opname',
        detailLines.join('\n\n'),
        [
          { text: 'Batal', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              setImportingProgress(true);
              const result = await applyOpnameProgressImport(plan.matches, targetField);
              setImportingProgress(false);

              if (result.error) {
                toast(result.error, 'critical');
                return;
              }

              await loadLines(activeOpname);
              await refreshActiveOpname();

              const notes: string[] = [];
              if (plan.unmatchedCount > 0) notes.push(`${plan.unmatchedCount} tidak cocok`);
              if (plan.invalidProgressRows.length > 0) notes.push(`${plan.invalidProgressRows.length} progress invalid`);
              if (plan.duplicateMatches.length > 0) notes.push(`${plan.duplicateMatches.length} duplikat diabaikan`);

              toast(
                notes.length > 0
                  ? `${result.importedCount} progress diimport. ${notes.join(' · ')}`
                  : `${result.importedCount} progress berhasil diimport`,
                'ok',
              );
            },
          },
        ],
      );
    } catch (error: any) {
      setImportingProgress(false);
      toast(error?.message ?? 'Gagal membaca file Excel', 'critical');
    }
  }, [activeOpname, isEstimator, lines, loadLines, refreshActiveOpname, toast]);

  // ── Harian allocation actions ────────────────────────────────────────────

  const handleAllocationInputChange = (
    allocationId: string,
    field: 'allocation_pct' | 'supervisor_note' | 'estimator_note',
    value: string,
  ) => {
    setAllocationInputs(prev => ({
      ...prev,
      [allocationId]: {
        allocation_pct: prev[allocationId]?.allocation_pct ?? '',
        supervisor_note: prev[allocationId]?.supervisor_note ?? '',
        estimator_note: prev[allocationId]?.estimator_note ?? '',
        [field]: field === 'allocation_pct' ? value.replace(/[^\d.]/g, '') : value,
      },
    }));
  };

  const handleAllocationSave = useCallback(async (allocation: HarianCostAllocation, forcePct?: number) => {
    if (!activeOpname || !profile) return;

    const input = allocationInputs[allocation.id];
    // forcePct bypasses allocationInputs (needed for AI suggestion path where setState
    // hasn't committed yet when this is called immediately after setAllocationInputs)
    const rawPct = forcePct !== undefined ? forcePct : parseFloat(input?.allocation_pct ?? String(allocation.allocation_pct));
    const pct = Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : 0;

    setSavingAllocationId(allocation.id);
    const { error } = await saveHarianCostAllocation({
      id: allocation.id,
      headerId: allocation.header_id,
      projectId: allocation.project_id,
      contractId: allocation.contract_id,
      userId: profile.id,
      boqItemId: allocation.boq_item_id,
      allocationScope: allocation.allocation_scope,
      allocationPct: pct,
      aiSuggestedPct: allocation.ai_suggested_pct,
      aiReason: allocation.ai_reason,
      supervisorNote: input?.supervisor_note ?? allocation.supervisor_note ?? null,
      estimatorNote: input?.estimator_note ?? allocation.estimator_note ?? null,
    });
    setSavingAllocationId(null);

    if (error) {
      toast(error, 'critical');
      return;
    }

    const refreshed = await getHarianCostAllocations(activeOpname.id);
    setHarianAllocations(refreshed);
    syncAllocationInputs(refreshed);
    toast('Alokasi harian diperbarui', 'ok');
  }, [activeOpname, allocationInputs, profile, syncAllocationInputs, toast]);

  const handleDeleteAllocationRow = useCallback(async (allocation: HarianCostAllocation) => {
    if (!activeOpname) return;
    setDeletingAllocationId(allocation.id);
    const { error } = await deleteHarianCostAllocation(allocation.id);
    setDeletingAllocationId(null);
    if (error) {
      toast(error, 'critical');
      return;
    }
    const refreshed = await getHarianCostAllocations(activeOpname.id);
    setHarianAllocations(refreshed);
    syncAllocationInputs(refreshed);
    toast('Row alokasi dihapus', 'ok');
  }, [activeOpname, syncAllocationInputs, toast]);

  const handleUseAiSuggestion = useCallback(async (allocation: HarianCostAllocation) => {
    if (allocation.ai_suggested_pct == null) return;
    const pct = allocation.ai_suggested_pct;
    setAllocationInputs(prev => ({
      ...prev,
      [allocation.id]: {
        allocation_pct: String(pct),
        supervisor_note: prev[allocation.id]?.supervisor_note ?? allocation.supervisor_note ?? '',
        estimator_note: prev[allocation.id]?.estimator_note ?? allocation.estimator_note ?? '',
      },
    }));
    await handleAllocationSave(allocation, pct);
  }, [handleAllocationSave]);

  const handleAddAllocation = useCallback(async () => {
    if (!activeOpname || !project || !profile) return;
    const pctFromInput = parseFloat(addAllocationPct.replace(/[^\d.]/g, ''));
    const amountFromInput = parseFloat(addAllocationAmount.replace(/[^\d.]/g, ''));
    const derivedPct = Number.isFinite(amountFromInput) && amountFromInput > 0 && activeOpname.gross_total > 0
      ? (amountFromInput / activeOpname.gross_total) * 100
      : pctFromInput;
    const pct = Number.isFinite(derivedPct) ? Math.max(0, Math.min(100, derivedPct)) : 0;

    if (addAllocationScope === 'boq_item' && !addAllocationBoqItemId) {
      toast('Pilih item BoQ untuk alokasi ini', 'warning');
      return;
    }

    const duplicate = harianAllocations.find(allocation => (
      addAllocationScope === 'boq_item'
        ? allocation.boq_item_id === addAllocationBoqItemId
        : allocation.allocation_scope === addAllocationScope
    ));
    if (duplicate) {
      toast('Target ini sudah ada. Edit row yang sudah ada atau hapus dulu.', 'warning');
      return;
    }

    const { error } = await saveHarianCostAllocation({
      headerId: activeOpname.id,
      projectId: project.id,
      contractId: activeOpname.contract_id,
      userId: profile.id,
      boqItemId: addAllocationScope === 'boq_item' ? addAllocationBoqItemId : null,
      allocationScope: addAllocationScope,
      allocationPct: pct,
      supervisorNote: addSupervisorNote.trim() || null,
      estimatorNote: addEstimatorNote.trim() || null,
    });

    if (error) {
      toast(error, 'critical');
      return;
    }

    const refreshed = await getHarianCostAllocations(activeOpname.id);
    setHarianAllocations(refreshed);
    syncAllocationInputs(refreshed);
    resetHarianAllocationForm();
    toast('Row alokasi harian ditambahkan', 'ok');
  }, [
    activeOpname,
    addAllocationAmount,
    addAllocationBoqItemId,
    addAllocationPct,
    addAllocationScope,
    addEstimatorNote,
    addSupervisorNote,
    harianAllocations,
    profile,
    project,
    resetHarianAllocationForm,
    syncAllocationInputs,
    toast,
  ]);

  const handleGenerateAiAllocation = useCallback(async () => {
    if (!activeOpname || !project || !profile) return;
    if (!harianEntries.length) {
      toast('Belum ada data kehadiran yang bisa dianalisis AI', 'warning');
      return;
    }
    if (!harianAllocationCandidates.length) {
      toast('Belum ada kandidat BoQ untuk dialokasikan. Cek trade mandor dan baseline.', 'warning');
      return;
    }

    setAiAllocating(true);
    try {
      const result = await suggestHarianAllocation({
        projectId: project.id,
        contractName: activeOpname.mandor_name ?? selectedContract?.mandor_name ?? 'Mandor',
        paymentWeek: activeOpname.week_number,
        weekStart: activeOpname.week_start,
        weekEnd: activeOpname.week_end,
        grossTotal: activeOpname.gross_total,
        userRole: role ?? undefined,
        candidates: harianAllocationCandidates,
        currentAllocations: harianAllocations,
        attendanceEntries: harianEntries.map(entry => ({
          workerName: entry.worker_name ?? 'Pekerja',
          date: entry.attendance_date,
          isPresent: entry.is_present,
          overtimeHours: entry.overtime_hours,
          dayTotal: entry.day_total,
          workDescription: entry.work_description,
        })),
        context: project ? {
          projectId: project.id,
          projectName: project.name,
          projectCode: project.code,
          userRole: role ?? undefined,
        } : undefined,
        model: 'haiku',
      });

      if (role) {
        await logAIUsage(
          project.id,
          profile.id,
          'haiku',
          result.usage.input_tokens,
          result.usage.output_tokens,
          role,
        );
      }

      const { error } = await applyHarianAiSuggestions({
        headerId: activeOpname.id,
        projectId: project.id,
        contractId: activeOpname.contract_id,
        userId: profile.id,
        existingAllocations: harianAllocations,
        suggestions: result.suggestions.map(suggestion => ({
          ...suggestion,
          reason: `${suggestion.confidence.toUpperCase()} — ${suggestion.reason}`,
        })),
      });

      if (error) {
        toast(error, 'critical');
        return;
      }

      const refreshed = await getHarianCostAllocations(activeOpname.id);
      setHarianAllocations(refreshed);
      syncAllocationInputs(refreshed);
      setAiAllocationSummary(result.summary);
      toast('Saran AI tersimpan. Review dulu sebelum jadi alokasi final.', 'ok');
    } catch (error: any) {
      toast(error?.message ?? 'Gagal membuat saran AI', 'critical');
    } finally {
      setAiAllocating(false);
    }
  }, [
    activeOpname,
    harianAllocationCandidates,
    harianAllocations,
    harianEntries,
    profile,
    project,
    role,
    selectedContract?.mandor_name,
    syncAllocationInputs,
    toast,
  ]);

  // ── Approval actions ────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!activeOpname || !profile) return;
    // Borongan requires opname_lines; harian validates attendance in the RPC
    if (activeOpname.payment_type !== 'harian' && lines.length === 0) {
      toast('Opname belum punya item pembayaran. Set Harga di Kontrak Mandor dulu.', 'warning');
      return;
    }
    setSaving(true);
    const { error } = await submitOpname(activeOpname.id, profile.id);
    if (error) toast(error, 'critical');
    else {
      const msg = role === 'supervisor'
        ? 'Opname diajukan ke estimator'
        : 'Opname submitted untuk verifikasi';
      toast(msg, 'ok');
      await loadOpnames();
      setView('list');
    }
    setSaving(false);
  };

  const handleVerify = async () => {
    if (!activeOpname || !profile) return;
    setSaving(true);
    const { error } = await verifyOpname(activeOpname.id, profile.id, verifyNotes);
    if (error) toast(error, 'critical');
    else { toast('Opname terverifikasi', 'ok'); await loadOpnames(); setView('list'); }
    setSaving(false);
  };

  const handleApprove = () => {
    setShowApproveConfirm(true);
  };

  const handleApproveConfirmed = async () => {
    if (!activeOpname || !profile) return;
    const kasbon = parseFloat(kasbonInput.replace(/[^\d.]/g, '')) || 0;
    setSaving(true);
    const { error } = await approveOpname(activeOpname.id, profile.id, kasbon);
    if (error) toast(error, 'critical');
    else { toast('Pembayaran disetujui', 'ok'); await loadOpnames(); setView('list'); }
    setSaving(false);
    setShowApproveConfirm(false);
  };

  const shareWorkbookBase64 = useCallback(async (base64: string, fileName: string, successMessage: string) => {
    if (Platform.OS === 'web') {
      const bytes = Buffer.from(base64, 'base64');
      const blob = new Blob(
        [bytes],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast(successMessage, 'ok');
      return;
    }

    const uri = FileSystem.documentDirectory + fileName;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    await Share.share({ url: uri, title: fileName });
    toast(successMessage, 'ok');
  }, [toast]);

  const handleExport = async () => {
    if (!activeOpname || !project) return;
    setExporting(true);
    try {
      const base64 = await exportOpnameToExcel(
        activeOpname.id,
        project.name,
        (project as any).client_name ?? '',
        (project as any).location ?? '',
      );
      const fileName = `Opname_${activeOpname.week_number}_${activeOpname.mandor_name?.replace(/\s/g, '_')}.xlsx`;
      await shareWorkbookBase64(base64, fileName, 'Excel exported');
    } catch (err: any) {
      toast(err.message, 'critical');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadProgressTemplate = async () => {
    if (!activeOpname) return;
    setExportingTemplate(true);
    try {
      const base64 = await exportOpnameProgressTemplate(activeOpname.id);
      const fileName = `Template_Progress_Opname_${activeOpname.week_number}_${activeOpname.mandor_name?.replace(/\s/g, '_')}.xlsx`;
      await shareWorkbookBase64(base64, fileName, 'Template progress siap diunduh');
    } catch (error: any) {
      toast(error?.message ?? 'Gagal membuat template progress', 'critical');
    } finally {
      setExportingTemplate(false);
    }
  };

  const handleConfirmPayment = () => {
    setPaymentReference('');
    setShowApproveConfirm(true);
  };

  const handleConfirmPaymentSubmit = async () => {
    if (!activeOpname || !profile) return;
    setSaving(true);
    const { error } = await markOpnamePaid(activeOpname.id, paymentReference.trim() || undefined);
    if (error) toast(error, 'critical');
    else { toast('Pembayaran dikonfirmasi', 'ok'); await loadOpnames(); setView('list'); }
    setSaving(false);
    setShowApproveConfirm(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.flex}>
      <Header />

      <TouchableOpacity
        style={styles.backBtn}
        onPress={view === 'list' ? onBack : () => setView('list')}
      >
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>{view === 'list' ? 'Kembali' : 'Daftar Opname'}</Text>
      </TouchableOpacity>

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.sectionHead}>Opname Mingguan</Text>

          {/* Contract selector */}
          {contracts.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.contractScroll}>
              {contracts.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.contractChip, selectedContract?.id === c.id && styles.contractChipActive]}
                  onPress={() => setSelectedContract(c)}
                >
                  <Text style={[styles.contractChipText, selectedContract?.id === c.id && styles.contractChipTextActive]}>
                    {c.mandor_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {contracts.length === 0 && (
            <Card>
              <Text style={styles.hint}>Belum ada kontrak mandor. Setup di Laporan → Mandor terlebih dahulu.</Text>
            </Card>
          )}

          {/* Create new */}
          {selectedContract && (
            <>
              {showCreate ? (
                <Card>
                  <Text style={styles.fieldLabel}>Minggu ke-</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    placeholder="e.g. 11"
                    placeholderTextColor={COLORS.textMuted}
                    value={newWeek}
                    onChangeText={setNewWeek}
                  />
                  <Text style={styles.fieldLabel}>Tanggal Opname</Text>
                  <DateSelectField
                    value={newDate}
                    onChange={setNewDate}
                    placeholder="Pilih tanggal opname"
                  />
                  {/* Payment type selector for campuran contracts */}
                  {selectedContract.payment_mode === 'campuran' && (
                    <>
                      <Text style={styles.fieldLabel}>Tipe Pembayaran Minggu Ini</Text>
                      <View style={{ flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.sm }}>
                        {(['borongan', 'harian'] as const).map(pt => (
                          <TouchableOpacity
                            key={pt}
                            style={[
                              { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
                              newPaymentType === pt && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                            ]}
                            onPress={() => setNewPaymentType(pt)}
                          >
                            <Text style={[
                              { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
                              newPaymentType === pt && { color: COLORS.textInverse },
                            ]}>
                              {pt === 'borongan' ? 'Borongan' : 'Harian'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                  <View style={styles.rowBtns}>
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={saving}>
                      {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Buat Opname</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowCreate(false)}>
                      <Text style={styles.ghostBtnText}>Batal</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ) : (
                <TouchableOpacity style={styles.newOpnameBtn} onPress={() => setShowCreate(true)}>
                  <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.newOpnameBtnText}>Opname Minggu Baru — {selectedContract.mandor_name}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Opname list */}
          {loading && <ActivityIndicator style={{ marginTop: SPACE.xl }} color={COLORS.primary} />}

          {opnames.map(op => {
            const cfg = STATUS_CONFIG[op.status] ?? STATUS_CONFIG.DRAFT;
            return (
              <Card key={op.id} borderColor={cfg.color}>
                <TouchableOpacity onPress={() => openOpname(op)}>
                  <View style={styles.opnameRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                        <Text style={styles.opnameTitle}>Minggu {op.week_number} — {op.mandor_name}</Text>
                        {op.payment_type === 'harian' && (
                          <View style={{ paddingHorizontal: SPACE.sm, paddingVertical: 1, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg }}>
                            <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.info }}>HARIAN</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.hint}>{new Date(op.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                    </View>
                    <Badge flag={cfg.flag as any} label={cfg.label} />
                  </View>
                  {/* Payment summary */}
                  <View style={styles.paymentSummary}>
                    <View style={styles.paymentItem}>
                      <Text style={styles.paymentLabel}>Gross</Text>
                      <Text style={styles.paymentValue}>{formatRp(op.gross_total)}</Text>
                    </View>
                    <View style={styles.paymentItem}>
                      <Text style={styles.paymentLabel}>Net minggu ini</Text>
                      <Text style={[styles.paymentValue, { color: COLORS.ok }]}>{formatRp(op.net_this_week)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </Card>
            );
          })}

          {!loading && opnames.length === 0 && selectedContract && (
            <Card><Text style={styles.hint}>Belum ada opname untuk {selectedContract.mandor_name}.</Text></Card>
          )}

          {/* Kasbon ledger */}
          {selectedContract && (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.sectionHead}>Kasbon</Text>
                {!showKasbonForm && (
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.xs }}
                    onPress={handleRequestKasbon}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={COLORS.accent} />
                    <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accent }}>Ajukan</Text>
                  </TouchableOpacity>
                )}
              </View>

              {showKasbonForm && (
                <View style={{ marginBottom: SPACE.sm, paddingTop: SPACE.xs, borderTopWidth: 1, borderTopColor: COLORS.borderSub }}>
                  <TextInput
                    style={[styles.kasbonInput, { marginBottom: SPACE.xs, minWidth: 0, width: '100%', textAlign: 'left', borderBottomColor: COLORS.primary }]}
                    placeholder="Jumlah (Rp)"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="numeric"
                    value={kasbonFormAmount}
                    onChangeText={setKasbonFormAmount}
                  />
                  <TextInput
                    style={[styles.kasbonInput, { marginBottom: SPACE.sm, minWidth: 0, width: '100%', textAlign: 'left', borderBottomColor: COLORS.primary }]}
                    placeholder="Alasan kasbon..."
                    placeholderTextColor={COLORS.textMuted}
                    value={kasbonFormReason}
                    onChangeText={setKasbonFormReason}
                  />
                  <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.primary, alignItems: 'center' }}
                      onPress={handleSubmitKasbonForm}
                      disabled={saving}
                    >
                      <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse }}>
                        {saving ? 'Menyimpan...' : 'Kirim'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' }}
                      onPress={() => setShowKasbonForm(false)}
                    >
                      <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec }}>Batal</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {kasbonEntries.length === 0 && !showKasbonForm ? (
                <Text style={styles.hint}>Belum ada kasbon untuk kontrak ini.</Text>
              ) : (
                kasbonEntries.map(k => (
                  <View key={k.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text }}>
                        {formatRp(k.amount)}
                      </Text>
                      <Text style={styles.hint}>{k.kasbon_date} · {k.reason ?? '-'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                      <Badge flag={k.status === 'SETTLED' ? 'OK' : k.status === 'APPROVED' ? 'INFO' : 'WARNING'} label={kasbonStatusLabel(k.status)} />
                      {k.status === 'REQUESTED' && isAdmin && (
                        <TouchableOpacity onPress={() => handleApproveKasbon(k)}>
                          <Ionicons name="checkmark-circle" size={22} color={COLORS.ok} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))
              )}
            </Card>
          )}
        </ScrollView>
      )}

      {/* ── LINES VIEW ── */}
      {view === 'lines' && activeOpname && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.sectionHead}>
            Minggu {activeOpname.week_number} — {activeOpname.mandor_name}
          </Text>

          {/* Status badge */}
          <View style={styles.statusRow}>
            <Badge flag={STATUS_CONFIG[activeOpname.status]?.flag as any} label={STATUS_CONFIG[activeOpname.status]?.label} />
            <Text style={styles.opnameDate}>
              {new Date(activeOpname.opname_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>

          {loading && <ActivityIndicator style={{ marginTop: SPACE.lg }} color={COLORS.primary} />}

          {/* ── HARIAN ATTENDANCE BREAKDOWN ── */}
          {activeOpname.payment_type === 'harian' && (
            <>
              <View style={{ paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg, alignSelf: 'flex-start', marginBottom: SPACE.md }}>
                <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.info }}>PEMBAYARAN HARIAN</Text>
              </View>

              <Card borderColor={COLORS.info}>
                <Text style={styles.reconTitle}>Harian membayar tenaga kerja, bukan mengubah progress BoQ otomatis</Text>
                <Text style={styles.hint}>
                  Pembayaran HOK mingguan dihitung dari kehadiran pekerja. Progress fisik BoQ tetap dicatat di progres lapangan.
                  Untuk kontrak campuran, pilih mode minggu ini saat membuat opname.
                </Text>
              </Card>

              {activeOpname.week_start && activeOpname.week_end && (
                <Text style={styles.hint}>
                  Periode: {activeOpname.week_start} — {activeOpname.week_end}
                </Text>
              )}

              {/* Harian payment waterfall */}
              <Card>
                <Text style={[styles.sectionHead, { marginTop: 0 }]}>Ringkasan Pembayaran</Text>
                <View style={styles.paymentSummary}>
                  <View style={styles.paymentItem}>
                    <Text style={styles.paymentLabel}>Gross (kehadiran)</Text>
                    <Text style={styles.paymentValue}>{formatRp(activeOpname.gross_total)}</Text>
                  </View>
                  <View style={styles.paymentItem}>
                    <Text style={styles.paymentLabel}>Retensi</Text>
                    <Text style={styles.paymentValue}>{formatRp(0)}</Text>
                  </View>
                </View>
                <View style={styles.paymentSummary}>
                  <View style={styles.paymentItem}>
                    <Text style={styles.paymentLabel}>Prior paid</Text>
                    <Text style={styles.paymentValue}>{formatRp(activeOpname.prior_paid)}</Text>
                  </View>
                  <View style={styles.paymentItem}>
                    <Text style={styles.paymentLabel}>Kasbon</Text>
                    <Text style={styles.paymentValue}>{formatRp(activeOpname.kasbon)}</Text>
                  </View>
                </View>
                <View style={{ borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACE.md, marginTop: SPACE.md }}>
                  <Text style={styles.paymentLabel}>NET BAYAR MINGGU INI</Text>
                  <Text style={[styles.paymentValue, { fontSize: TYPE.lg, color: COLORS.ok }]}>{formatRp(activeOpname.net_this_week)}</Text>
                </View>
              </Card>

              <Card borderColor={COLORS.info}>
                <View style={styles.reconHeader}>
                  <Ionicons name="sparkles-outline" size={18} color={COLORS.info} />
                  <Text style={styles.reconTitle}>Saran AI untuk alokasi biaya harian</Text>
                </View>
                <Text style={styles.hint}>
                  AI membaca kehadiran mingguan, uraian kerja, trade mandor, dan kandidat BoQ untuk memberi saran distribusi biaya.
                  AI tidak mengubah progress fisik dan tidak mengisi alokasi final otomatis.
                </Text>
                {aiAllocationSummary && (
                  <View style={styles.aiSummaryBox}>
                    <Text style={styles.aiSummaryText}>{aiAllocationSummary}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.secondaryBtn, aiAllocating && styles.disabledBtn]}
                  onPress={handleGenerateAiAllocation}
                  disabled={aiAllocating}
                >
                  {aiAllocating
                    ? <ActivityIndicator size="small" color={COLORS.info} />
                    : <Ionicons name="sparkles-outline" size={18} color={COLORS.info} />}
                  <Text style={styles.secondaryBtnText}>Generate Saran AI</Text>
                </TouchableOpacity>
              </Card>

              <Card borderColor={harianAllocationSummary.remainingPct > 0.05 ? COLORS.warning : COLORS.ok}>
                <View style={styles.reconHeader}>
                  <Ionicons
                    name={harianAllocationSummary.remainingPct > 0.05 ? 'layers-outline' : 'checkmark-circle-outline'}
                    size={18}
                    color={harianAllocationSummary.remainingPct > 0.05 ? COLORS.warning : COLORS.ok}
                  />
                  <Text style={styles.reconTitle}>Alokasi biaya harian ke BoQ / scope kerja</Text>
                </View>
                <Text style={styles.hint}>
                  Gunakan modul ini untuk menjelaskan biaya harian minggu ini masuk ke pekerjaan apa saja.
                  Alokasi ini membantu rekonsiliasi biaya, tapi tidak menulis progress BoQ otomatis.
                </Text>

                <View style={styles.paymentSummary}>
                  <View style={styles.paymentItem}>
                    <Text style={styles.paymentLabel}>Sudah dialokasikan</Text>
                    <Text style={styles.paymentValue}>{harianAllocationSummary.allocatedPct.toFixed(2)}%</Text>
                    <Text style={styles.hint}>{formatRp(harianAllocationSummary.allocatedAmount)}</Text>
                  </View>
                  <View style={styles.paymentItem}>
                    <Text style={styles.paymentLabel}>Sisa belum dialokasikan</Text>
                    <Text style={[
                      styles.paymentValue,
                      { color: harianAllocationSummary.remainingPct > 0.05 ? COLORS.warning : COLORS.ok },
                    ]}>
                      {harianAllocationSummary.remainingPct.toFixed(2)}%
                    </Text>
                    <Text style={styles.hint}>{formatRp(harianAllocationSummary.remainingAmount)}</Text>
                  </View>
                </View>

                {canEditHarianAllocation && (
                  showAddAllocation ? (
                    <View style={styles.allocationForm}>
                      <Text style={[styles.fieldLabel, { marginTop: 0 }]}>Tambah target alokasi</Text>
                      <View style={styles.scopeChipRow}>
                        {(['boq_item', 'general_support', 'rework', 'site_overhead'] as HarianAllocationScope[]).map(scope => (
                          <TouchableOpacity
                            key={scope}
                            style={[
                              styles.scopeChip,
                              addAllocationScope === scope && styles.scopeChipActive,
                            ]}
                            onPress={() => setAddAllocationScope(scope)}
                          >
                            <Text style={[
                              styles.scopeChipText,
                              addAllocationScope === scope && styles.scopeChipTextActive,
                            ]}>
                              {HARIAN_SCOPE_LABELS[scope]}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {addAllocationScope === 'boq_item' && (
                        <View style={styles.pickerWrap}>
                          <Picker
                            selectedValue={addAllocationBoqItemId}
                            onValueChange={value => setAddAllocationBoqItemId(value || '')}
                          >
                            <Picker.Item label="— Pilih item BoQ —" value="" />
                            {harianAllocationCandidates.map(candidate => (
                              <Picker.Item
                                key={candidate.id}
                                label={`${candidate.code} — ${candidate.label}`}
                                value={candidate.id}
                              />
                            ))}
                          </Picker>
                        </View>
                      )}

                      <View style={styles.allocationEntryRow}>
                        <View style={styles.pctInput}>
                          <Text style={styles.pctLabel}>Alokasi %</Text>
                          <TextInput
                            style={styles.pctField}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={COLORS.textMuted}
                            value={addAllocationPct}
                            onChangeText={setAddAllocationPct}
                          />
                        </View>
                        <View style={styles.pctInput}>
                          <Text style={styles.pctLabel}>Atau nominal (Rp)</Text>
                          <TextInput
                            style={styles.pctField}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={COLORS.textMuted}
                            value={addAllocationAmount}
                            onChangeText={text => setAddAllocationAmount(text.replace(/[^\d.]/g, ''))}
                          />
                        </View>
                      </View>

                      <Text style={styles.hint}>
                        Preview final: {addAllocationPreviewPct.toFixed(2)}% · {formatRp((activeOpname.gross_total ?? 0) * (addAllocationPreviewPct / 100))}
                      </Text>

                      <Text style={styles.fieldLabel}>Catatan Supervisor</Text>
                      <TextInput
                        style={[styles.input, styles.textareaSmall]}
                        multiline
                        placeholder="Apa pekerjaan utama minggu ini?"
                        placeholderTextColor={COLORS.textMuted}
                        value={addSupervisorNote}
                        onChangeText={setAddSupervisorNote}
                      />

                      {isEstimator && (
                        <>
                          <Text style={styles.fieldLabel}>Catatan Estimator</Text>
                          <TextInput
                            style={[styles.input, styles.textareaSmall]}
                            multiline
                            placeholder="Catatan review estimator..."
                            placeholderTextColor={COLORS.textMuted}
                            value={addEstimatorNote}
                            onChangeText={setAddEstimatorNote}
                          />
                        </>
                      )}

                      <View style={styles.rowBtns}>
                        <TouchableOpacity style={styles.primaryBtn} onPress={handleAddAllocation}>
                          <Text style={styles.primaryBtnText}>Simpan Alokasi</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.ghostBtn} onPress={resetHarianAllocationForm}>
                          <Text style={styles.ghostBtnText}>Batal</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.ghostBtn, { marginTop: SPACE.md }]}
                      onPress={() => setShowAddAllocation(true)}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                      <Text style={styles.ghostBtnText}>Tambah Alokasi</Text>
                    </TouchableOpacity>
                  )
                )}

                {harianAllocations.length === 0 ? (
                  <View style={styles.emptyAllocationBox}>
                    <Text style={styles.hint}>
                      Belum ada row alokasi. Tambahkan target manual atau generate saran AI untuk mulai menyusun distribusi biaya minggu ini.
                    </Text>
                  </View>
                ) : (
                  harianAllocations.map(allocation => {
                    const targetLabel = allocation.allocation_scope === 'boq_item'
                      ? `${allocation.boq_code ?? 'BoQ'} — ${allocation.boq_label ?? 'Tanpa label'}`
                      : HARIAN_SCOPE_LABELS[allocation.allocation_scope];
                    const livePct = parseFloat(allocationInputs[allocation.id]?.allocation_pct ?? String(allocation.allocation_pct));
                    const effectivePct = Number.isFinite(livePct) ? Math.max(0, Math.min(100, livePct)) : Number(allocation.allocation_pct ?? 0);
                    const effectiveAmount = (activeOpname.gross_total ?? 0) * (effectivePct / 100);

                    return (
                      <View key={allocation.id} style={styles.allocationRowCard}>
                        <View style={styles.allocationRowHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.lineDesc}>{targetLabel}</Text>
                            <Text style={styles.hint}>
                              {allocation.allocation_scope === 'boq_item'
                                ? 'Scope BoQ'
                                : `Scope ${HARIAN_SCOPE_LABELS[allocation.allocation_scope]}`}
                            </Text>
                          </View>
                          {canEditHarianAllocation && (
                            <TouchableOpacity
                              onPress={() => handleDeleteAllocationRow(allocation)}
                              disabled={deletingAllocationId === allocation.id}
                              style={styles.deleteAllocationBtn}
                            >
                              {deletingAllocationId === allocation.id
                                ? <ActivityIndicator size="small" color={COLORS.critical} />
                                : <Ionicons name="trash-outline" size={18} color={COLORS.critical} />}
                            </TouchableOpacity>
                          )}
                        </View>

                        <View style={styles.allocationEntryRow}>
                          <View style={styles.pctInput}>
                            <Text style={styles.pctLabel}>Alokasi Final %</Text>
                            {canEditHarianAllocation ? (
                              <TextInput
                                style={styles.pctField}
                                keyboardType="numeric"
                                value={allocationInputs[allocation.id]?.allocation_pct ?? String(allocation.allocation_pct)}
                                onChangeText={text => handleAllocationInputChange(allocation.id, 'allocation_pct', text)}
                                onEndEditing={() => handleAllocationSave(allocation)}
                              />
                            ) : (
                              <Text style={styles.pctDisplay}>{effectivePct.toFixed(2)}%</Text>
                            )}
                          </View>
                          <View style={styles.amountBox}>
                            <Text style={styles.pctLabel}>Nominal Minggu Ini</Text>
                            <Text style={styles.amountValue}>{formatRp(effectiveAmount)}</Text>
                          </View>
                        </View>

                        {allocation.ai_suggested_pct != null && (
                          <View style={styles.aiSuggestionRow}>
                            <Text style={styles.hint}>
                              AI menyarankan {allocation.ai_suggested_pct.toFixed(2)}%
                              {allocation.ai_reason ? ` · ${allocation.ai_reason}` : ''}
                            </Text>
                            {canEditHarianAllocation && (
                              <TouchableOpacity onPress={() => handleUseAiSuggestion(allocation)}>
                                <Text style={styles.applyAiText}>Pakai saran AI</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}

                        <Text style={styles.fieldLabel}>Catatan Supervisor</Text>
                        {canEditHarianAllocation ? (
                          <TextInput
                            style={[styles.input, styles.textareaSmall]}
                            multiline
                            placeholder="Apa pekerjaan utama yang dikerjakan?"
                            placeholderTextColor={COLORS.textMuted}
                            value={allocationInputs[allocation.id]?.supervisor_note ?? ''}
                            onChangeText={text => handleAllocationInputChange(allocation.id, 'supervisor_note', text)}
                            onEndEditing={() => handleAllocationSave(allocation)}
                          />
                        ) : (
                          <Text style={styles.hint}>{allocation.supervisor_note || 'Belum ada catatan supervisor.'}</Text>
                        )}

                        <Text style={styles.fieldLabel}>Catatan Estimator</Text>
                        {canEditEstimatorAllocationNote ? (
                          <TextInput
                            style={[styles.input, styles.textareaSmall]}
                            multiline
                            placeholder="Catatan review estimator..."
                            placeholderTextColor={COLORS.textMuted}
                            value={allocationInputs[allocation.id]?.estimator_note ?? ''}
                            onChangeText={text => handleAllocationInputChange(allocation.id, 'estimator_note', text)}
                            onEndEditing={() => handleAllocationSave(allocation)}
                          />
                        ) : (
                          <Text style={styles.hint}>{allocation.estimator_note || 'Belum ada catatan estimator.'}</Text>
                        )}

                        {savingAllocationId === allocation.id && (
                          <View style={styles.inlineSavingRow}>
                            <ActivityIndicator size="small" color={COLORS.primary} />
                            <Text style={styles.hint}>Menyimpan alokasi...</Text>
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </Card>

              {activeOpname.status === 'SUBMITTED' && harianAllocationSummary.remainingPct > 0.05 && (
                <Card borderColor={COLORS.warning}>
                  <Text style={styles.reconTitle}>Verifikasi tertahan sampai alokasi genap 100%</Text>
                  <Text style={styles.hint}>
                    Lengkapi alokasi biaya harian dulu. Sistem akan menahan verifikasi jika masih ada sisa {harianAllocationSummary.remainingPct.toFixed(2)}%
                    atau {formatRp(harianAllocationSummary.remainingAmount)} yang belum dialokasikan.
                  </Text>
                </Card>
              )}

              {/* Per-worker breakdown */}
              <Text style={styles.sectionHead}>Detail Per Pekerja</Text>
              {harianEntries.length === 0 && !loading && (
                <Card>
                  <Text style={styles.hint}>Belum ada data kehadiran untuk minggu ini. Catat kehadiran di tab Kehadiran.</Text>
                </Card>
              )}
              {(() => {
                // Group by worker
                const byWorker = new Map<string, WorkerAttendanceEntry[]>();
                for (const e of harianEntries) {
                  const arr = byWorker.get(e.worker_id) ?? [];
                  arr.push(e);
                  byWorker.set(e.worker_id, arr);
                }
                return Array.from(byWorker.entries()).map(([wid, entries]) => {
                  const name = entries[0]?.worker_name ?? 'Pekerja';
                  const totalPay = entries.reduce((s, e) => s + e.day_total, 0);
                  const daysPresent = entries.filter(e => e.is_present).length;
                  const totalOT = entries.reduce((s, e) => s + (e.is_present ? e.overtime_hours : 0), 0);
                  return (
                    <Card key={wid}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text }}>{name}</Text>
                        <Text style={{ fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.ok }}>{formatRp(totalPay)}</Text>
                      </View>
                      <Text style={styles.hint}>
                        {daysPresent} hari hadir{totalOT > 0 ? ` · ${totalOT}j lembur` : ''}
                      </Text>
                      {entries.map(e => (
                        <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub }}>
                          <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, width: 40 }}>{e.attendance_date.slice(5)}</Text>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: e.is_present ? COLORS.ok : COLORS.critical }} />
                          <Text style={[styles.hint, { flex: 1 }]}>
                            {e.is_present ? formatPayPreview(e.regular_pay, e.overtime_pay) : 'Absen'}
                          </Text>
                          <Badge
                            flag={e.status === 'SETTLED' ? 'OK' : e.status === 'CONFIRMED' || e.status === 'OVERRIDDEN' ? 'INFO' : 'WARNING'}
                            label={attendanceStatusLabel(e.status)}
                          />
                        </View>
                      ))}
                    </Card>
                  );
                });
              })()}

              {/* Refresh totals */}
              {activeOpname.status === 'DRAFT' && (
                <TouchableOpacity
                  style={[styles.ghostBtn, { marginTop: SPACE.md }]}
                  onPress={async () => {
                    await recomputeHarianOpname(activeOpname.id);
                    await refreshActiveOpname();
                    await loadHarianDetail(activeOpname);
                    toast('Total diperbarui dari kehadiran', 'ok');
                  }}
                >
                  <Ionicons name="refresh" size={16} color={COLORS.primary} />
                  <Text style={styles.ghostBtnText}>Refresh Total dari Kehadiran</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ── BORONGAN LINES ── */}
          {activeOpname.payment_type !== 'harian' && Object.keys(progressFlags).length > 0 && (
            <Card borderColor={COLORS.warning}>
              <View style={styles.reconHeader}>
                <Ionicons name="warning-outline" size={18} color={COLORS.warning} />
                <Text style={styles.reconTitle}>Perlu cek silang dengan Progress Lapangan</Text>
              </View>
              <Text style={styles.hint}>
                {Object.keys(progressFlags).length} item opname berbeda signifikan dari progress Gate 4.
                Klaim mandor tetap bisa direview, tapi angka ini perlu dicek sebelum verifikasi/approval.
              </Text>
            </Card>
          )}

          {activeOpname.payment_type !== 'harian' && lines.length === 0 && (
            <Card borderColor={COLORS.warning}>
              <Text style={styles.reconTitle}>Belum ada item pembayaran yang terhubung</Text>
              <Text style={styles.hint}>
                Draft opname ini kosong karena item BoQ belum dikonfigurasi di Kontrak Mandor.
                Buka tab Kontrak Mandor, set harga per item BoQ, lalu buat ulang opname.
              </Text>
            </Card>
          )}

          {activeOpname.payment_type !== 'harian' && activeOpname.status === 'DRAFT' && isEstimator && lines.length > 0 && (
            <Card borderColor={COLORS.info}>
              <Text style={styles.reconTitle}>Estimator dapat koreksi draft sebelum diajukan</Text>
              <Text style={styles.hint}>
                Supervisor mengusulkan progress kumulatif per item. Di draft ini Anda juga bisa menyesuaikan angka
                sebelum opname dikirim ke tahap verifikasi berikutnya.
              </Text>
            </Card>
          )}

          {activeOpname.payment_type !== 'harian' && canImportProgress && (
            <Card borderColor={COLORS.info}>
              <Text style={styles.reconTitle}>Import progress dari Excel</Text>
              <Text style={styles.hint}>
                Upload file dengan kolom `Kode BoQ` atau `Uraian Pekerjaan`, lalu kolom `Progress (%)`.
                Sistem akan mencocokkan item ke daftar opname ini dan mengisi angka secara massal.
              </Text>
              <View style={styles.importActionGroup}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, (importingProgress || exportingTemplate) && styles.disabledBtn]}
                  onPress={handleDownloadProgressTemplate}
                  disabled={importingProgress || exportingTemplate}
                >
                  {exportingTemplate
                    ? <ActivityIndicator size="small" color={COLORS.info} />
                    : <Ionicons name="download-outline" size={18} color={COLORS.info} />}
                  <Text style={styles.secondaryBtnText}>Download Template Excel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryBtn, (importingProgress || exportingTemplate) && styles.disabledBtn]}
                  onPress={handleImportProgress}
                  disabled={importingProgress || exportingTemplate}
                >
                  {importingProgress
                    ? <ActivityIndicator size="small" color={COLORS.info} />
                    : <Ionicons name="cloud-upload-outline" size={18} color={COLORS.info} />}
                  <Text style={styles.secondaryBtnText}>Upload Progress Excel</Text>
                </TouchableOpacity>
              </View>
            </Card>
          )}

          {/* Line items (borongan only) */}
          {activeOpname.payment_type !== 'harian' && previewLines.map(line => {
            const effectivePct = line.effectivePct;
            const canEdit = activeOpname.status === 'DRAFT' && canDraftEditRole;
            const canVerify = activeOpname.status === 'SUBMITTED' && isEstimator;
            const progressFlag = progressFlags[line.id];
            const previewVariancePct = progressFlag
              ? effectivePct - progressFlag.field_progress_pct
              : null;

            return (
              <Card key={line.id} borderColor={line.is_tdk_acc ? COLORS.critical : COLORS.borderSub}>
                <View style={styles.lineHeader}>
                  <Text style={styles.lineDesc}>{line.description}</Text>
                  {line.is_tdk_acc && (
                    <View style={styles.tdkBadge}>
                      <Text style={styles.tdkText}>TDK ACC</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.hint}>{line.budget_volume} {line.unit} · Rp {Math.round(line.contracted_rate).toLocaleString('id-ID')}/{line.unit}</Text>

                {progressFlag && (
                  <View style={[
                    styles.reconBadge,
                    progressFlag.variance_flag === 'HIGH' ? styles.reconBadgeHigh : styles.reconBadgeWarn,
                  ]}>
                    <Ionicons
                      name={progressFlag.variance_flag === 'HIGH' ? 'alert-circle' : 'alert-outline'}
                      size={14}
                      color={progressFlag.variance_flag === 'HIGH' ? COLORS.critical : COLORS.warning}
                    />
                    <Text style={styles.reconBadgeText}>
                      Gate 4 {progressFlag.field_progress_pct.toFixed(0)}% · Opname {effectivePct.toFixed(0)}%
                      {' '}({(previewVariancePct ?? 0) > 0 ? '+' : ''}{(previewVariancePct ?? 0).toFixed(0)}%)
                    </Text>
                  </View>
                )}

                {/* Progress bar */}
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(effectivePct, 100)}%` }]} />
                  {line.prev_cumulative_pct > 0 && (
                    <View style={[styles.progressPrev, { width: `${Math.min(line.prev_cumulative_pct, 100)}%` }]} />
                  )}
                </View>

                <View style={styles.pctRow}>
                  {/* Supervisor input */}
                  {canEdit ? (
                    <View style={styles.pctInput}>
                      <Text style={styles.pctLabel}>Progress % (kumulatif)</Text>
                      <TextInput
                        style={styles.pctField}
                        keyboardType="numeric"
                        value={lineInputs[line.id]?.cumulative_pct ?? String(line.cumulative_pct)}
                        onChangeText={text => handleLineInputText(line.id, 'cumulative_pct', text)}
                        onEndEditing={() => handleLineCommit(line, 'cumulative_pct')}
                        accessibilityLabel={`Progress kumulatif untuk ${line.description}`}
                        accessibilityHint="Masukkan persentase progress 0 sampai 100"
                      />
                    </View>
                  ) : canVerify ? (
                    <View style={styles.pctInput}>
                      <Text style={styles.pctLabel}>Verifikasi % (estimator)</Text>
                      <TextInput
                        style={[styles.pctField, { borderColor: COLORS.warning }]}
                        keyboardType="numeric"
                        value={lineInputs[line.id]?.verified_pct ?? String(line.previewVerifiedPct ?? line.previewCumulativePct)}
                        onChangeText={text => handleLineInputText(line.id, 'verified_pct', text)}
                        onEndEditing={() => handleLineCommit(line, 'verified_pct')}
                        accessibilityLabel={`Verifikasi progress untuk ${line.description}`}
                        accessibilityHint="Masukkan persentase verifikasi 0 sampai 100"
                      />
                    </View>
                  ) : (
                    <View>
                      <Text style={styles.pctLabel}>Progress</Text>
                      <Text style={styles.pctDisplay}>{effectivePct.toFixed(0)}%</Text>
                      {line.previewVerifiedPct !== null && line.previewVerifiedPct !== line.previewCumulativePct && (
                        <Text style={[styles.hint, { color: COLORS.warning }]}>
                          Diajukan: {line.previewCumulativePct}% → Diverif: {line.previewVerifiedPct}%
                        </Text>
                      )}
                    </View>
                  )}

                  <View style={styles.amountBox}>
                    <Text style={styles.pctLabel}>Minggu ini</Text>
                    <Text style={[styles.amountValue, line.is_tdk_acc && { color: COLORS.textMuted, textDecorationLine: 'line-through' }]}>
                      {formatRp(line.thisWeekAmount)}
                    </Text>
                    <Text style={styles.hint}>{line.thisWeekPct.toFixed(0)}% × vol</Text>
                  </View>
                </View>

                {/* TDK ACC toggle for estimator */}
                {canVerify && (
                  <>
                    <TouchableOpacity
                      style={[styles.tdkBtn, line.is_tdk_acc && styles.tdkBtnActive]}
                      onPress={() => handleTdkAcc(line)}
                    >
                      <Ionicons
                        name={line.is_tdk_acc ? 'close-circle' : 'ban-outline'}
                        size={14}
                        color={line.is_tdk_acc ? COLORS.textInverse : COLORS.critical}
                      />
                      <Text style={[styles.tdkBtnText, line.is_tdk_acc && { color: COLORS.textInverse }]}>
                        {line.is_tdk_acc ? 'Batalkan TDK ACC' : 'Tandai TDK ACC'}
                      </Text>
                    </TouchableOpacity>
                    {tdkAccLineId === line.id && (
                      <View style={{ marginTop: SPACE.sm }}>
                        <TextInput
                          style={styles.input}
                          placeholder="Alasan TDK ACC..."
                          placeholderTextColor={COLORS.textMuted}
                          value={tdkAccReason}
                          onChangeText={setTdkAccReason}
                          autoFocus
                        />
                        <View style={styles.rowBtns}>
                          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.critical }]} onPress={handleTdkAccSubmit}>
                            <Text style={styles.primaryBtnText}>Tandai</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.ghostBtn} onPress={() => setTdkAccLineId(null)}>
                            <Text style={styles.ghostBtnText}>Batal</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </>
                )}
              </Card>
            );
          })}

          {/* Payment waterfall (borongan) */}
          {activeOpname.payment_type !== 'harian' && <Card>
            <Text style={styles.sectionHead}>Ringkasan Pembayaran</Text>
            <View style={styles.waterfallRow}>
              <Text style={styles.waterfallLabel}>Total Pekerjaan</Text>
              <Text style={styles.waterfallValue}>{formatRp(previewGrossTotal)}</Text>
            </View>
            <View style={styles.waterfallRow}>
              <Text style={styles.waterfallLabel}>Retensi {activeOpname.retention_pct}%</Text>
              <Text style={[styles.waterfallValue, { color: COLORS.warning }]}>-{formatRp(previewRetentionAmount)}</Text>
            </View>
            <View style={styles.waterfallRow}>
              <Text style={styles.waterfallLabel}>Yang Dibayarkan s/d Minggu Ini</Text>
              <Text style={styles.waterfallValue}>{formatRp(previewNetToDate)}</Text>
            </View>
            <View style={styles.waterfallRow}>
              <Text style={styles.waterfallLabel}>Yang Dibayarkan s/d Minggu Lalu</Text>
              <Text style={[styles.waterfallValue, { color: COLORS.textSec }]}>-{formatRp(activeOpname.prior_paid)}</Text>
            </View>

            {/* Kasbon input (admin only, during VERIFIED) */}
            {activeOpname.status === 'VERIFIED' && isAdmin ? (
              <View style={styles.kasbonRow}>
                <Text style={styles.waterfallLabel}>Kasbon</Text>
                <TextInput
                  style={styles.kasbonInput}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={COLORS.textMuted}
                  value={kasbonInput}
                  onChangeText={setKasbonInput}
                />
              </View>
            ) : (
              <View style={styles.waterfallRow}>
                <Text style={styles.waterfallLabel}>Kasbon</Text>
                <Text style={[styles.waterfallValue, { color: COLORS.textSec }]}>-{formatRp(previewKasbon)}</Text>
              </View>
            )}

            {attendanceTotal > 0 && (
              <View style={styles.waterfallRow}>
                <Text style={styles.waterfallLabel}>Kehadiran (HOK) belum terpotong</Text>
                <Text style={[styles.waterfallValue, { color: COLORS.info }]}>{formatRp(attendanceTotal)}</Text>
              </View>
            )}

            <View style={[styles.waterfallRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>SISA BAYAR MINGGU INI</Text>
              <Text style={styles.totalValue}>{formatRp(previewNetThisWeek)}</Text>
            </View>
          </Card>}

          {/* Verifier notes */}
          {(activeOpname.status === 'SUBMITTED' && isEstimator) && (
            <View>
              <Text style={styles.fieldLabel}>Catatan Estimator</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                multiline
                placeholder="Catatan verifikasi (opsional)..."
                placeholderTextColor={COLORS.textMuted}
                value={verifyNotes}
                onChangeText={setVerifyNotes}
              />
            </View>
          )}
          {activeOpname.verifier_notes && activeOpname.status !== 'SUBMITTED' && (
            <Card>
              <Text style={styles.sectionHead}>Catatan Estimator</Text>
              <Text style={styles.hint}>{activeOpname.verifier_notes}</Text>
            </Card>
          )}

          {/* Action buttons */}
          <View style={styles.actionGroup}>
            {activeOpname.status === 'DRAFT' && canDraftEditRole && (
              <TouchableOpacity
                style={[styles.primaryBtn, (saving || (activeOpname.payment_type !== 'harian' && lines.length === 0)) && styles.disabledBtn]}
                onPress={handleSubmit}
                disabled={saving || (activeOpname.payment_type !== 'harian' && lines.length === 0)}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>
                      {role === 'supervisor' ? 'Ajukan ke Estimator' : 'Kirim Draft Opname'}
                    </Text>}
              </TouchableOpacity>
            )}
            {activeOpname.status === 'SUBMITTED' && isEstimator && (
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { backgroundColor: COLORS.warning },
                  activeOpname.payment_type === 'harian' && harianAllocationSummary.remainingPct > 0.05 && styles.disabledBtn,
                ]}
                onPress={handleVerify}
                disabled={saving || (activeOpname.payment_type === 'harian' && harianAllocationSummary.remainingPct > 0.05)}
              >
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Verifikasi & Teruskan ke Admin</Text>}
              </TouchableOpacity>
            )}
            {activeOpname.status === 'VERIFIED' && isAdmin && !showApproveConfirm && (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.ok }]} onPress={handleApprove} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Setujui Pembayaran</Text>}
              </TouchableOpacity>
            )}
            {activeOpname.status === 'VERIFIED' && isAdmin && showApproveConfirm && (
              <Card borderColor={COLORS.ok}>
                <Text style={[styles.sectionHead, { marginTop: 0 }]}>Konfirmasi Persetujuan</Text>
                <Text style={styles.hint}>
                  Kasbon: {formatRp(parseFloat(kasbonInput.replace(/[^\d.]/g, '')) || 0)} · Net bayar: {formatRp(Math.max(0, (activeOpname.net_this_week ?? 0) - (parseFloat(kasbonInput.replace(/[^\d.]/g, '')) || 0)))}
                </Text>
                <View style={styles.rowBtns}>
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.ok }]} onPress={handleApproveConfirmed} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Ya, Setujui</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowApproveConfirm(false)}>
                    <Text style={styles.ghostBtnText}>Batal</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}
            {(activeOpname.status === 'APPROVED' || activeOpname.status === 'PAID') && isAdmin && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: COLORS.info }]}
                onPress={handleExport}
                disabled={exporting}
              >
                {exporting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <Ionicons name="download-outline" size={18} color="#fff" />
                      <Text style={styles.primaryBtnText}>Export Excel Opname</Text>
                    </>
                }
              </TouchableOpacity>
            )}
            {activeOpname.status === 'APPROVED' && isAdmin && !showApproveConfirm && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: COLORS.ok, marginTop: SPACE.sm }]}
                onPress={handleConfirmPayment}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={styles.primaryBtnText}>Konfirmasi Pembayaran</Text>
                    </>
                }
              </TouchableOpacity>
            )}
            {activeOpname.status === 'APPROVED' && isAdmin && showApproveConfirm && (
              <Card borderColor={COLORS.ok}>
                <Text style={[styles.sectionHead, { marginTop: 0 }]}>Konfirmasi Pembayaran</Text>
                <Text style={styles.hint}>Jumlah: {formatRp(activeOpname.net_this_week)}</Text>
                <TextInput
                  style={[styles.input, { marginTop: SPACE.sm }]}
                  placeholder="No. referensi transfer (opsional)"
                  placeholderTextColor={COLORS.textMuted}
                  value={paymentReference}
                  onChangeText={setPaymentReference}
                />
                <View style={styles.rowBtns}>
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.ok }]} onPress={handleConfirmPaymentSubmit} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Konfirmasi PAID</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowApproveConfirm(false)}>
                    <Text style={styles.ghostBtnText}>Batal</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex:   { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.base, paddingVertical: SPACE.md },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  sectionHead: { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  hint:     { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17 },
  fieldLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.md, marginBottom: SPACE.xs },

  // Contract selector
  contractScroll: { marginBottom: SPACE.md },
  contractChip:       { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginRight: SPACE.sm },
  contractChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  contractChipText:       { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  contractChipTextActive: { color: COLORS.textInverse },

  // New opname
  newOpnameBtn:     { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.md, paddingHorizontal: SPACE.md, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: RADIUS, borderStyle: 'dashed', marginBottom: SPACE.sm, justifyContent: 'center' },
  newOpnameBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.md - 1, paddingHorizontal: SPACE.md,
    fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top', paddingTop: SPACE.md - 1 },
  textareaSmall: { minHeight: 64, textAlignVertical: 'top', paddingTop: SPACE.md - 1 },

  rowBtns:    { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, marginTop: SPACE.sm },
  importActionGroup: { gap: SPACE.sm, marginTop: SPACE.md },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, borderWidth: 1, borderColor: COLORS.info, borderRadius: RADIUS, paddingVertical: SPACE.md, backgroundColor: COLORS.info + '10' },
  disabledBtn: { opacity: 0.45 },
  primaryBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.3 },
  secondaryBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.info, textTransform: 'uppercase', letterSpacing: 0.3 },
  ghostBtn:   { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center', marginTop: SPACE.sm, minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },

  // Opname list
  opnameRow:    { flexDirection: 'row', alignItems: 'flex-start' },
  opnameTitle:  { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  opnameDate:   { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  reconHeader:  { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.xs },
  reconTitle:   { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  reconBadge:   { marginTop: SPACE.sm, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs },
  reconBadgeWarn: { backgroundColor: COLORS.warning + '14', borderColor: COLORS.warning + '55' },
  reconBadgeHigh: { backgroundColor: COLORS.critical + '14', borderColor: COLORS.critical + '55' },
  reconBadgeText: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.text },
  paymentSummary: { flexDirection: 'row', gap: SPACE.base, marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  paymentItem:  { flex: 1 },
  paymentLabel: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted },
  paymentValue: { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, marginTop: 1 },
  aiSummaryBox: { marginTop: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg },
  aiSummaryText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.info, lineHeight: 18 },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md },

  // Lines
  lineHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm },
  lineDesc:   { flex: 1, fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  tdkBadge:   { backgroundColor: COLORS.critical, paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: RADIUS_SM },
  tdkText:    { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textInverse, letterSpacing: 0.5 },  // was TYPE.xs-1 (10dp)

  progressTrack: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginVertical: SPACE.sm, position: 'relative' },
  progressFill:  { position: 'absolute', height: '100%', backgroundColor: COLORS.ok, borderRadius: 3 },
  progressPrev:  { position: 'absolute', height: '100%', backgroundColor: COLORS.ok + '44', borderRadius: 3 },

  pctRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.md },
  pctInput:  { flex: 1 },
  pctLabel:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginBottom: SPACE.xs },
  pctField:  { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: RADIUS_SM, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.primary, minWidth: 70 },
  pctDisplay:{ fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text },
  amountBox: { alignItems: 'flex-end' },
  amountValue: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  pickerWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    overflow: 'hidden',
    marginTop: SPACE.sm,
    backgroundColor: COLORS.surface,
  },
  scopeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm },
  scopeChip: { paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs + 1, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  scopeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  scopeChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  scopeChipTextActive: { color: COLORS.textInverse },
  allocationForm: { marginTop: SPACE.md, paddingTop: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  allocationEntryRow: { flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.sm, alignItems: 'flex-start' },
  allocationRowCard: { marginTop: SPACE.md, paddingTop: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub, gap: SPACE.xs },
  allocationRowHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm },
  deleteAllocationBtn: { paddingHorizontal: SPACE.xs, paddingVertical: SPACE.xs },
  emptyAllocationBox: { marginTop: SPACE.md, paddingTop: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  aiSuggestionRow: { marginTop: SPACE.sm, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, backgroundColor: COLORS.infoBg, gap: SPACE.xs },
  applyAiText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },
  inlineSavingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.sm },

  tdkBtn:      { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.md, paddingVertical: SPACE.xs + 1, paddingHorizontal: SPACE.md, borderWidth: 1, borderColor: COLORS.critical, borderRadius: RADIUS_SM, alignSelf: 'flex-start' },
  tdkBtnActive:{ backgroundColor: COLORS.critical, borderColor: COLORS.critical },
  tdkBtnText:  { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical },

  // Waterfall
  waterfallRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACE.xs + 1, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  waterfallLabel:{ fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  waterfallValue:{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  kasbonRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACE.xs + 1, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  kasbonInput:   { borderBottomWidth: 1.5, borderBottomColor: COLORS.warning, fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.warning, textAlign: 'right', minWidth: 120, paddingVertical: 2 },
  totalRow:      { marginTop: SPACE.xs, borderTopWidth: 2, borderTopColor: COLORS.text, borderBottomWidth: 0 },
  totalLabel:    { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.text, textTransform: 'uppercase', letterSpacing: 0.3 },
  totalValue:    { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.ok },

  actionGroup: { gap: SPACE.sm, marginTop: SPACE.md },
});
