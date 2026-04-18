import { useState, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { Share } from 'react-native';
import { getTodayIsoDate } from '../components/DateSelectField';
import { useProject } from './useProject';
import { useToast } from '../components/Toast';
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

type ViewMode = 'list' | 'detail' | 'lines';

const HARIAN_SCOPE_LABELS: Record<HarianAllocationScope, string> = {
  boq_item: 'Item BoQ',
  general_support: 'Support Umum',
  rework: 'Rework / Punchlist',
  site_overhead: 'Overhead Lapangan',
};

export interface UseOpnameParams {
  onBack: () => void;
  initialContractId?: string;
}

export interface UseOpnameReturn {
  // View
  view: ViewMode;
  setView: (view: ViewMode) => void;
  onBack: () => void;

  // Loading states
  loading: boolean;
  saving: boolean;
  exporting: boolean;
  exportingTemplate: boolean;
  importingProgress: boolean;

  // List
  contracts: MandorContract[];
  selectedContract: MandorContract | null;
  setSelectedContract: (contract: MandorContract | null) => void;
  opnames: OpnameHeader[];

  // Create new
  showCreate: boolean;
  setShowCreate: (show: boolean) => void;
  newWeek: string;
  setNewWeek: (week: string) => void;
  newDate: string;
  setNewDate: (date: string) => void;
  newPaymentType: 'borongan' | 'harian';
  setNewPaymentType: (type: 'borongan' | 'harian') => void;

  // Detail / Lines
  activeOpname: OpnameHeader | null;
  lines: OpnameLine[];
  progressFlags: Record<string, OpnameProgressFlag>;
  lineInputs: Record<string, { cumulative_pct: string; verified_pct: string }>;
  kasbonInput: string;
  setKasbonInput: (input: string) => void;
  verifyNotes: string;
  setVerifyNotes: (notes: string) => void;
  kasbonEntries: Kasbon[];
  attendanceTotal: number;

  // Kasbon form
  showKasbonForm: boolean;
  setShowKasbonForm: (show: boolean) => void;
  kasbonFormAmount: string;
  setKasbonFormAmount: (amount: string) => void;
  kasbonFormReason: string;
  setKasbonFormReason: (reason: string) => void;

  // Harian details
  harianEntries: WorkerAttendanceEntry[];
  harianAllocations: HarianCostAllocation[];
  harianAllocationCandidates: HarianAllocationBoqCandidate[];
  allocationInputs: Record<string, {
    allocation_pct: string;
    supervisor_note: string;
    estimator_note: string;
  }>;

  // Add allocation form
  showAddAllocation: boolean;
  setShowAddAllocation: (show: boolean) => void;
  addAllocationScope: HarianAllocationScope;
  setAddAllocationScope: (scope: HarianAllocationScope) => void;
  addAllocationBoqItemId: string;
  setAddAllocationBoqItemId: (id: string) => void;
  addAllocationPct: string;
  setAddAllocationPct: (pct: string) => void;
  addAllocationAmount: string;
  setAddAllocationAmount: (amount: string) => void;
  addSupervisorNote: string;
  setAddSupervisorNote: (note: string) => void;
  addEstimatorNote: string;
  setAddEstimatorNote: (note: string) => void;

  // AI allocation
  aiAllocating: boolean;
  aiAllocationSummary: string | null;
  savingAllocationId: string | null;
  deletingAllocationId: string | null;

  // Approval
  showApproveConfirm: boolean;
  setShowApproveConfirm: (show: boolean) => void;
  paymentReference: string;
  setPaymentReference: (ref: string) => void;

  // TDK ACC
  tdkAccLineId: string | null;
  setTdkAccLineId: (id: string | null) => void;
  tdkAccReason: string;
  setTdkAccReason: (reason: string) => void;

  // Derived values
  role: string | null;
  canDraftEditRole: boolean;
  isEstimator: boolean;
  isAdmin: boolean;
  canImportProgress: boolean;
  canEditHarianAllocation: boolean;
  canEditEstimatorAllocationNote: boolean;
  previewLines: Array<any>;
  previewGrossTotal: number;
  previewRetentionAmount: number;
  previewNetToDate: number;
  previewKasbon: number;
  previewNetThisWeek: number;
  harianAllocationSummary: any;
  addAllocationPreviewPct: number;

  // Handlers
  handleRequestKasbon: () => void;
  handleSubmitKasbonForm: () => Promise<void>;
  handleApproveKasbon: (kasbon: Kasbon) => Promise<void>;
  handleCreate: () => Promise<void>;
  openOpname: (opname: OpnameHeader) => Promise<void>;
  handleLineChange: (line: OpnameLine, field: 'cumulative_pct' | 'verified_pct', value: string) => Promise<void>;
  handleLineInputText: (lineId: string, field: 'cumulative_pct' | 'verified_pct', value: string) => void;
  handleLineCommit: (line: OpnameLine, field: 'cumulative_pct' | 'verified_pct') => Promise<void>;
  handleTdkAcc: (line: OpnameLine) => Promise<void>;
  handleTdkAccSubmit: () => Promise<void>;
  handleImportProgress: () => Promise<void>;
  handleDownloadProgressTemplate: () => Promise<void>;
  handleAllocationInputChange: (allocationId: string, field: 'allocation_pct' | 'supervisor_note' | 'estimator_note', value: string) => void;
  handleAllocationSave: (allocation: HarianCostAllocation, forcePct?: number) => Promise<void>;
  handleDeleteAllocationRow: (allocation: HarianCostAllocation) => Promise<void>;
  handleUseAiSuggestion: (allocation: HarianCostAllocation) => Promise<void>;
  handleAddAllocation: () => Promise<void>;
  handleGenerateAiAllocation: () => Promise<void>;
  handleSubmit: () => Promise<void>;
  handleVerify: () => Promise<void>;
  handleApprove: () => void;
  handleApproveConfirmed: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleConfirmPayment: () => void;
  handleConfirmPaymentSubmit: () => Promise<void>;
  resetHarianAllocationForm: () => void;

  // From hooks
  project: any;
  profile: any;
  toast: any;
}

export function useOpname(params: UseOpnameParams): UseOpnameReturn {
  const { onBack, initialContractId } = params;
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
      setActiveOpname(header as OpnameHeader);
      await loadHarianDetail(header as OpnameHeader);
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
      const importedRows = await parseOpnameProgressWorkbook(arrayBuffer.slice(0), asset.name);
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

  return {
    // View
    view,
    setView,
    onBack,

    // Loading states
    loading,
    saving,
    exporting,
    exportingTemplate,
    importingProgress,

    // List
    contracts,
    selectedContract,
    setSelectedContract,
    opnames,

    // Create new
    showCreate,
    setShowCreate,
    newWeek,
    setNewWeek,
    newDate,
    setNewDate,
    newPaymentType,
    setNewPaymentType,

    // Detail / Lines
    activeOpname,
    lines,
    progressFlags,
    lineInputs,
    kasbonInput,
    setKasbonInput,
    verifyNotes,
    setVerifyNotes,
    kasbonEntries,
    attendanceTotal,

    // Kasbon form
    showKasbonForm,
    setShowKasbonForm,
    kasbonFormAmount,
    setKasbonFormAmount,
    kasbonFormReason,
    setKasbonFormReason,

    // Harian details
    harianEntries,
    harianAllocations,
    harianAllocationCandidates,
    allocationInputs,

    // Add allocation form
    showAddAllocation,
    setShowAddAllocation,
    addAllocationScope,
    setAddAllocationScope,
    addAllocationBoqItemId,
    setAddAllocationBoqItemId,
    addAllocationPct,
    setAddAllocationPct,
    addAllocationAmount,
    setAddAllocationAmount,
    addSupervisorNote,
    setAddSupervisorNote,
    addEstimatorNote,
    setAddEstimatorNote,

    // AI allocation
    aiAllocating,
    aiAllocationSummary,
    savingAllocationId,
    deletingAllocationId,

    // Approval
    showApproveConfirm,
    setShowApproveConfirm,
    paymentReference,
    setPaymentReference,

    // TDK ACC
    tdkAccLineId,
    setTdkAccLineId,
    tdkAccReason,
    setTdkAccReason,

    // Derived values
    role,
    canDraftEditRole,
    isEstimator,
    isAdmin,
    canImportProgress,
    canEditHarianAllocation,
    canEditEstimatorAllocationNote,
    previewLines,
    previewGrossTotal,
    previewRetentionAmount,
    previewNetToDate,
    previewKasbon,
    previewNetThisWeek,
    harianAllocationSummary,
    addAllocationPreviewPct,

    // Handlers
    handleRequestKasbon,
    handleSubmitKasbonForm,
    handleApproveKasbon,
    handleCreate,
    openOpname,
    handleLineChange,
    handleLineInputText,
    handleLineCommit,
    handleTdkAcc,
    handleTdkAccSubmit,
    handleImportProgress,
    handleDownloadProgressTemplate,
    handleAllocationInputChange,
    handleAllocationSave,
    handleDeleteAllocationRow,
    handleUseAiSuggestion,
    handleAddAllocation,
    handleGenerateAiAllocation,
    handleSubmit,
    handleVerify,
    handleApprove,
    handleApproveConfirmed,
    handleExport,
    handleConfirmPayment,
    handleConfirmPaymentSubmit,
    resetHarianAllocationForm,

    // From hooks
    project,
    profile,
    toast,
  };
}
