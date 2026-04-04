/**
 * MandorSetupScreen
 *
 * Estimator/admin screen for:
 *  1. Reviewing AI-detected trade categories on AHS labor lines
 *  2. Creating/editing mandor contracts per project
 *  3. Setting contracted rates per BoQ item (vs BoQ labor rate)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, FlatList, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Header from '../components/Header';
import Card   from '../components/Card';
import Badge  from '../components/Badge';
import { useProject } from '../hooks/useProject';
import { useToast }   from '../components/Toast';
import { readPickedWorkbook } from '../utils/workbookPicker';
import {
  detectAndTagLaborTrades, confirmTradeCategoryBulk, getBoqLaborRate,
  TRADE_LABELS, type TradeCategory, type TradeSummaryGroup,
} from '../../tools/laborTrade';
import {
  getMandorContracts, createMandorContract, updateMandorContract,
  getContractRates, upsertContractRate, buildContractRateImportPlan, applyContractRateImport,
  type MandorContract, type MandorContractRate, type ContractRateImportPlan,
} from '../../tools/opname';
import { parseBoqWorkbook } from '../../tools/excelParser';
import {
  getWorkersWithRates, addWorker, deactivateWorker, setWorkerRate,
  getCurrentOvertimeRules, setOvertimeRules, updateOvertimeRules,
  setWorkerOvertimeRules, clearWorkerOvertimeRules,
  skillLevelLabel, formatRate,
  type WorkerWithRate, type OvertimeRules, type WorkerOvertimeRules, type SkillLevel,
} from '../../tools/workerRoster';
import { parseWorkerExcel, importWorkersToContract, type ParsedWorkerRow } from '../../tools/excelWorkerImport';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'contracts' | 'rates' | 'workers';

const ALL_TRADES: TradeCategory[] = [
  'beton_bekisting', 'besi', 'pasangan', 'plesteran',
  'finishing', 'kayu', 'mep', 'tanah', 'lainnya',
];

const TRADE_COLORS: Record<TradeCategory, string> = {
  beton_bekisting: COLORS.info,
  besi:            COLORS.warning,
  pasangan:        '#7B5EA7',
  plesteran:       '#2E7D32',
  finishing:       '#AD1457',
  kayu:            '#5D4037',
  mep:             '#00695C',
  tanah:           '#558B2F',
  lainnya:         COLORS.textSec,
};

const IMPORT_SOURCE_LABELS = {
  labor_breakdown: 'kolom labor',
  internal_unit_price: 'harga satuan internal',
  client_unit_price: 'harga satuan client',
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

export default function MandorSetupScreen({
  onBack,
  onOpenOpnameContract,
  onOpenAttendanceContract,
}: {
  onBack: () => void;
  onOpenOpnameContract?: (contract: MandorContract) => void;
  onOpenAttendanceContract?: (contract: MandorContract) => void;
}) {
  const { project, profile } = useProject();
  const { show: toast } = useToast();

  const [view, setView] = useState<ViewMode>('contracts');
  const [loading, setLoading] = useState(false);

  // Trade review modal state
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeSummary, setTradeSummary] = useState<TradeSummaryGroup[]>([]);
  const [expandedTrade, setExpandedTrade] = useState<TradeCategory | null>(null);
  const [confirming, setConfirming] = useState<TradeCategory | null>(null);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [pendingTradeCount, setPendingTradeCount] = useState(0);

  // Contracts state
  const [contracts, setContracts] = useState<MandorContract[]>([]);
  const [newMandorName, setNewMandorName] = useState('');
  const [newTrades, setNewTrades] = useState<TradeCategory[]>([]);
  const [newRetention, setNewRetention] = useState('10');
  const [newPaymentMode, setNewPaymentMode] = useState<'borongan' | 'harian' | 'campuran'>('borongan');
  const [newDailyRate, setNewDailyRate] = useState('');
  const [saving, setSaving] = useState(false);

  // Rates state
  const [selectedContract, setSelectedContract] = useState<MandorContract | null>(null);
  const [rates, setRates] = useState<MandorContractRate[]>([]);
  const [editingRate, setEditingRate] = useState<string | null>(null); // boq_item_id
  const [rateInput, setRateInput] = useState('');
  const [importingRates, setImportingRates] = useState(false);

  // Worker roster state
  const [workers, setWorkers] = useState<WorkerWithRate[]>([]);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerSkill, setNewWorkerSkill] = useState<SkillLevel>('tukang');
  const [newWorkerRate, setNewWorkerRate] = useState('');
  const [editingWorkerRate, setEditingWorkerRate] = useState<string | null>(null);
  const [workerRateInput, setWorkerRateInput] = useState('');
  const [importingWorkers, setImportingWorkers] = useState(false);

  // Per-worker overtime editing state
  const [editingWorkerOt, setEditingWorkerOt] = useState<string | null>(null);
  const [workerOtT1, setWorkerOtT1] = useState('');
  const [workerOtT2, setWorkerOtT2] = useState('');
  const [workerOtT2Threshold, setWorkerOtT2Threshold] = useState('10');
  const [savingWorkerOt, setSavingWorkerOt] = useState(false);

  // Contract-level overtime rules state
  const [overtimeRules, setOvertimeRulesData] = useState<OvertimeRules | null>(null);
  const [otTier1Rate, setOtTier1Rate] = useState('');
  const [otTier2Rate, setOtTier2Rate] = useState('');
  const [otTier2Threshold, setOtTier2Threshold] = useState('10');
  const [savingOt, setSavingOt] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────────

  const loadTradeReview = useCallback(async () => {
    if (!project) return;
    setLoadingTrades(true);
    const { summary, error } = await detectAndTagLaborTrades(project.id);
    if (error) toast(error, 'critical');
    setTradeSummary(summary);
    setLoadingTrades(false);
  }, [project, toast]);

  const checkPendingTrades = useCallback(async () => {
    if (!project) return;
    const { summary } = await detectAndTagLaborTrades(project.id);
    setPendingTradeCount(summary.length);
  }, [project]);

  const loadContracts = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    const data = await getMandorContracts(project.id);
    setContracts(data);
    setLoading(false);
  }, [project]);

  const loadRates = useCallback(async (contract: MandorContract) => {
    setLoading(true);
    const data = await getContractRates(contract.id);
    setRates(data);
    setLoading(false);
  }, []);

  const loadWorkers = useCallback(async (contract: MandorContract) => {
    setLoading(true);
    const [workerData, otData] = await Promise.all([
      getWorkersWithRates(contract.id),
      getCurrentOvertimeRules(contract.id),
    ]);
    setWorkers(workerData);
    setOvertimeRulesData(otData);
    if (otData) {
      setOtTier1Rate(String(otData.tier1_hourly_rate || ''));
      setOtTier2Rate(String(otData.tier2_hourly_rate || ''));
      setOtTier2Threshold(String(otData.tier2_threshold_hours || '10'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (view === 'contracts') loadContracts();
  }, [view, loadContracts]);

  useEffect(() => {
    checkPendingTrades();
  }, [checkPendingTrades]);

  // ── Trade category actions ──────────────────────────────────────────────

  const handleConfirmTrade = async (category: TradeCategory) => {
    if (!project) return;
    setConfirming(category);
    const { updated, error } = await confirmTradeCategoryBulk(project.id, category);
    if (error) toast(error, 'critical');
    else {
      toast(`${updated} baris ${TRADE_LABELS[category]} dikonfirmasi`, 'ok');
      setTradeSummary(prev => prev.filter(g => g.category !== category));
      setPendingTradeCount(prev => Math.max(0, prev - 1));
    }
    setConfirming(null);
  };

  // ── Contract creation ───────────────────────────────────────────────────

  const handleCreateContract = async () => {
    if (!project || !profile) return;
    if (!newMandorName.trim()) { toast('Masukkan nama mandor', 'warning'); return; }
    if (!newTrades.length) { toast('Pilih minimal satu kategori pekerjaan', 'warning'); return; }

    setSaving(true);
    const result = await createMandorContract(
      project.id, profile.id,
      newMandorName.trim(),
      newTrades,
      parseFloat(newRetention) || 10,
      undefined, // notes
      newPaymentMode,
      newPaymentMode !== 'borongan' ? (parseFloat(newDailyRate) || 0) : 0,
    );
    setSaving(false);

    if (!result) { toast('Gagal membuat kontrak', 'critical'); return; }
    toast(`Mandor "${result.mandor_name}" dibuat`, 'ok');
    setNewMandorName('');
    setNewTrades([]);
    setNewRetention('10');
    setNewPaymentMode('borongan');
    setNewDailyRate('');
    loadContracts();
  };

  const toggleNewTrade = (cat: TradeCategory) => {
    setNewTrades(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  // ── Rate editing ────────────────────────────────────────────────────────

  const openRates = (contract: MandorContract) => {
    setSelectedContract(contract);
    loadRates(contract);
    setView('rates');
  };

  const handleSaveRate = async (rate: MandorContractRate) => {
    if (!selectedContract) return;
    const parsed = parseFloat(rateInput.replace(/[^\d.]/g, ''));
    if (isNaN(parsed) || parsed <= 0) { toast('Masukkan harga satuan yang valid', 'warning'); return; }

    // Fetch boq_labor_rate if not already set
    let boqRate = rate.boq_labor_rate;
    if (!boqRate) {
      // Find the primary trade category for this contract
      const tradeCat = selectedContract.trade_categories[0] as TradeCategory;
      const { rate: labRate } = await getBoqLaborRate(rate.boq_item_id, tradeCat);
      boqRate = labRate;
    }

    const { error } = await upsertContractRate(
      selectedContract.id, rate.boq_item_id,
      parsed, boqRate, rate.unit,
    );
    if (error) toast(error, 'critical');
    else {
      toast('Rate disimpan', 'ok');
      setEditingRate(null);
      setRateInput('');
      loadRates(selectedContract);
    }
  };

  const confirmRateImport = useCallback(async (plan: ContractRateImportPlan) => {
    if (!selectedContract) return;

    setImportingRates(true);
    const result = await applyContractRateImport(selectedContract.id, plan.matches);
    setImportingRates(false);

    if (result.error) {
      toast(result.error, 'critical');
      return;
    }

    const notes: string[] = [];
    if (plan.unmatchedCount > 0) notes.push(`${plan.unmatchedCount} item tidak cocok ke scope kontrak ini`);
    if (plan.skippedNoPrice > 0) notes.push(`${plan.skippedNoPrice} item di file tidak punya harga`);
    if (plan.duplicateMatches.length > 0) notes.push(`${plan.duplicateMatches.length} baris duplikat diabaikan`);

    toast(
      notes.length > 0
        ? `${result.importedCount} harga diimport. ${notes.join(' · ')}`
        : `${result.importedCount} harga berhasil diimport`,
      'ok',
    );
    loadRates(selectedContract);
  }, [loadRates, selectedContract, toast]);

  const handleImportRates = useCallback(async () => {
    if (!selectedContract) return;

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
      const fileName = asset.name ?? `mandor_rates_${Date.now()}.xlsx`;

      setImportingRates(true);
      const { arrayBuffer } = await readPickedWorkbook(asset);
      const parsed = parseBoqWorkbook(arrayBuffer.slice(0), fileName);
      const plan = buildContractRateImportPlan(rates, parsed);
      setImportingRates(false);

      if (!plan.matches.length) {
        toast('Tidak ada item harga yang cocok. Pastikan file berisi kode/label BoQ dan harga per item.', 'warning');
        return;
      }

      const sourceSummary = (Object.entries(plan.sourceCounts) as Array<[keyof typeof IMPORT_SOURCE_LABELS, number]>)
        .filter(([, count]) => count > 0)
        .map(([source, count]) => `${count} dari ${IMPORT_SOURCE_LABELS[source]}`)
        .join(', ');

      const detailLines = [
        `${plan.matches.length} item akan diisi/update ke kontrak ini.`,
        'Pencocokan memakai kode BoQ dulu, lalu label BoQ.',
        sourceSummary ? `Sumber harga: ${sourceSummary}.` : '',
        plan.skippedNoPrice > 0 ? `${plan.skippedNoPrice} item di file tidak punya angka harga yang bisa dibaca.` : '',
        plan.unmatchedCount > 0 ? `${plan.unmatchedCount} item tidak cocok ke scope kontrak ini.` : '',
        plan.duplicateMatches.length > 0 ? `${plan.duplicateMatches.length} baris duplikat dari file akan diabaikan.` : '',
        plan.unmatchedItems.length > 0 ? `Contoh tidak cocok: ${plan.unmatchedItems.slice(0, 3).join('; ')}` : '',
      ].filter(Boolean);

      Alert.alert(
        'Import Harga Mandor',
        detailLines.join('\n\n'),
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Import', onPress: () => { void confirmRateImport(plan); } },
        ],
      );
    } catch (err: any) {
      setImportingRates(false);
      toast(err.message ?? 'Gagal membaca file harga mandor', 'critical');
    }
  }, [confirmRateImport, rates, selectedContract, toast]);

  // ── Worker roster actions ────────────────────────────────────────────────

  const openWorkers = (contract: MandorContract) => {
    setSelectedContract(contract);
    loadWorkers(contract);
    setView('workers');
  };

  const handleAddWorker = async () => {
    if (!selectedContract || !project) return;
    if (!newWorkerName.trim()) { toast('Masukkan nama pekerja', 'warning'); return; }
    const rate = parseFloat(newWorkerRate.replace(/[^\d.]/g, ''));
    if (isNaN(rate) || rate <= 0) { toast('Masukkan tarif harian yang valid', 'warning'); return; }

    setSaving(true);
    const { data: worker, error } = await addWorker({
      contractId: selectedContract.id,
      projectId: project.id,
      workerName: newWorkerName.trim(),
      skillLevel: newWorkerSkill,
    });
    if (error || !worker) { setSaving(false); toast(error ?? 'Gagal', 'critical'); return; }

    await setWorkerRate({ workerId: worker.id, contractId: selectedContract.id, dailyRate: rate });
    setSaving(false);
    toast(`${worker.worker_name} ditambahkan`, 'ok');
    setNewWorkerName('');
    setNewWorkerRate('');
    loadWorkers(selectedContract);
  };

  const handleUpdateWorkerRate = async (workerId: string) => {
    if (!selectedContract) return;
    const rate = parseFloat(workerRateInput.replace(/[^\d.]/g, ''));
    if (isNaN(rate) || rate <= 0) { toast('Tarif tidak valid', 'warning'); return; }

    const { error } = await setWorkerRate({ workerId, contractId: selectedContract.id, dailyRate: rate });
    if (error) toast(error, 'critical');
    else { toast('Tarif diperbarui', 'ok'); setEditingWorkerRate(null); setWorkerRateInput(''); loadWorkers(selectedContract); }
  };

  const handleDeactivateWorker = async (worker: WorkerWithRate) => {
    const { error } = await deactivateWorker(worker.id);
    if (error) toast(error, 'critical');
    else { toast(`${worker.worker_name} dinonaktifkan`, 'ok'); if (selectedContract) loadWorkers(selectedContract); }
  };

  const handleImportWorkers = async () => {
    if (!selectedContract || !project) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;

      setImportingWorkers(true);
      const { arrayBuffer } = await readPickedWorkbook(picked.assets[0]);
      const parsed = parseWorkerExcel(arrayBuffer.slice(0));

      if (parsed.length === 0) {
        setImportingWorkers(false);
        toast('Tidak ada data pekerja ditemukan', 'warning');
        return;
      }

      const result = await importWorkersToContract(selectedContract.id, project.id, parsed);
      setImportingWorkers(false);

      const parts = [];
      if (result.inserted > 0) parts.push(`${result.inserted} pekerja baru`);
      if (result.rateUpdated > 0) parts.push(`${result.rateUpdated} tarif diperbarui`);
      if (result.unchanged > 0) parts.push(`${result.unchanged} tidak berubah`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} error`);
      toast(parts.join(' · ') || 'Import selesai', result.errors.length > 0 ? 'warning' : 'ok');

      loadWorkers(selectedContract);
    } catch (err: any) {
      setImportingWorkers(false);
      toast(err.message ?? 'Gagal import', 'critical');
    }
  };

  const handleSaveOvertimeRules = async () => {
    if (!selectedContract) return;
    const t1 = parseFloat(otTier1Rate);
    const t2 = parseFloat(otTier2Rate);
    const t2h = parseFloat(otTier2Threshold) || 10;

    if (isNaN(t1) || t1 < 0) { toast('Rate tier 1 tidak valid', 'warning'); return; }
    if (isNaN(t2) || t2 < 0) { toast('Rate tier 2 tidak valid', 'warning'); return; }

    setSavingOt(true);
    if (overtimeRules) {
      const { error } = await updateOvertimeRules(overtimeRules.id, {
        tier1_hourly_rate: t1, tier2_hourly_rate: t2, tier2_threshold_hours: t2h,
      });
      setSavingOt(false);
      if (error) toast(error, 'critical');
      else { toast('Aturan lembur disimpan', 'ok'); loadWorkers(selectedContract); }
    } else {
      const res = await setOvertimeRules({
        contractId: selectedContract.id,
        tier1HourlyRate: t1, tier2HourlyRate: t2, tier2ThresholdHours: t2h,
      });
      setSavingOt(false);
      if (res.error) toast(res.error, 'critical');
      else { toast('Aturan lembur dibuat', 'ok'); loadWorkers(selectedContract); }
    }
  };

  const handleSaveWorkerOvertimeRules = async (workerId: string) => {
    if (!selectedContract) return;
    const t1 = parseFloat(workerOtT1);
    const t2 = parseFloat(workerOtT2);
    const t2h = parseFloat(workerOtT2Threshold) || 10;

    if (isNaN(t1) || t1 < 0) { toast('Rate tier 1 tidak valid', 'warning'); return; }
    if (isNaN(t2) || t2 < 0) { toast('Rate tier 2 tidak valid', 'warning'); return; }

    setSavingWorkerOt(true);
    const res = await setWorkerOvertimeRules({
      workerId,
      contractId: selectedContract.id,
      tier1HourlyRate: t1,
      tier2HourlyRate: t2,
      tier2ThresholdHours: t2h,
    });
    setSavingWorkerOt(false);
    if (res.error) toast(res.error, 'critical');
    else {
      toast('Tarif lembur pekerja disimpan', 'ok');
      setEditingWorkerOt(null);
      loadWorkers(selectedContract);
    }
  };

  const handleClearWorkerOvertimeRules = async (workerId: string) => {
    setSavingWorkerOt(true);
    const { error } = await clearWorkerOvertimeRules(workerId);
    setSavingWorkerOt(false);
    if (error) toast(error, 'critical');
    else {
      toast('Tarif lembur direset ke default', 'ok');
      setEditingWorkerOt(null);
      if (selectedContract) loadWorkers(selectedContract);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.flex}>
      <Header />

      {/* Back button */}
      <TouchableOpacity
        style={styles.backBtn}
        onPress={(view === 'rates' || view === 'workers') ? () => setView('contracts') : onBack}
      >
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>
          {(view === 'rates' || view === 'workers') ? 'Kontrak' : 'Kembali'}
        </Text>
      </TouchableOpacity>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── CONTRACTS VIEW ── */}
        {view === 'contracts' && (
          <>
            {/* Pending trades banner */}
            {pendingTradeCount > 0 && (
              <TouchableOpacity
                style={styles.tradeBanner}
                onPress={async () => {
                  setShowTradeModal(true);
                  await loadTradeReview();
                }}
              >
                <Ionicons name="alert-circle" size={18} color={COLORS.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tradeBannerTitle}>{pendingTradeCount} kategori pekerjaan belum dikonfirmasi</Text>
                  <Text style={styles.tradeBannerHint}>Ketuk untuk review dan konfirmasi sebelum setup kontrak.</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.warning} />
              </TouchableOpacity>
            )}

            <Text style={styles.sectionHead}>Kontrak Mandor</Text>

            {/* Create new contract */}
            <Card>
              <Text style={styles.fieldLabel}>Nama Mandor <Text style={styles.req}>*</Text></Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. H. Kholik"
                placeholderTextColor={COLORS.textMuted}
                value={newMandorName}
                onChangeText={setNewMandorName}
              />

              <Text style={styles.fieldLabel}>Kategori Pekerjaan <Text style={styles.req}>*</Text></Text>
              <View style={styles.tradeChips}>
                {ALL_TRADES.filter(t => t !== 'lainnya').map(cat => {
                  const selected = newTrades.includes(cat);
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.tradeChip, selected && { backgroundColor: TRADE_COLORS[cat], borderColor: TRADE_COLORS[cat] }]}
                      onPress={() => toggleNewTrade(cat)}
                    >
                      <Text style={[styles.tradeChipText, selected && { color: COLORS.textInverse }]}>
                        {TRADE_LABELS[cat]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Mode Pembayaran</Text>
              <View style={{ flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.sm }}>
                {(['borongan', 'harian', 'campuran'] as const).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    style={[
                      { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
                      newPaymentMode === mode && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                    ]}
                    onPress={() => setNewPaymentMode(mode)}
                  >
                    <Text style={[
                      { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
                      newPaymentMode === mode && { color: COLORS.textInverse },
                    ]}>
                      {mode === 'borongan' ? 'Borongan' : mode === 'harian' ? 'Harian' : 'Campuran'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {newPaymentMode !== 'borongan' && (
                <>
                  <Text style={styles.fieldLabel}>Rate Harian (Rp/orang/hari)</Text>
                  <TextInput
                    style={[styles.input, { width: 180 }]}
                    keyboardType="numeric"
                    placeholder="100000"
                    placeholderTextColor={COLORS.textMuted}
                    value={newDailyRate}
                    onChangeText={setNewDailyRate}
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>Retensi (%)</Text>
              <TextInput
                style={[styles.input, { width: 100 }]}
                keyboardType="numeric"
                value={newRetention}
                onChangeText={setNewRetention}
              />

              <TouchableOpacity
                style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                onPress={handleCreateContract}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Tambah Mandor</Text>
                }
              </TouchableOpacity>
            </Card>

            {loading && <ActivityIndicator style={{ marginTop: SPACE.lg }} color={COLORS.primary} />}

            <Card borderColor={COLORS.info}>
              <Text style={styles.contractName}>Mandor sebagai hub kerja mingguan</Text>
              <Text style={styles.hint}>
                Dari setiap mandor di bawah, buka Opname, Kehadiran, Harga BoQ, atau daftar Pekerja sesuai mode pembayarannya.
              </Text>
            </Card>

            {/* Existing contracts */}
            {contracts.map(c => (
              <Card key={c.id}>
                <View style={styles.contractRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contractName}>{c.mandor_name}</Text>
                    <View style={styles.tradeTagsRow}>
                      {c.trade_categories.map(cat => (
                        <View key={cat} style={[styles.tradeMiniTag, { backgroundColor: TRADE_COLORS[cat] + '22', borderColor: TRADE_COLORS[cat] }]}>
                          <Text style={[styles.tradeMiniText, { color: TRADE_COLORS[cat] }]}>{TRADE_LABELS[cat]}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.hint}>
                      {(c as any).payment_mode === 'harian' ? 'Harian' : (c as any).payment_mode === 'campuran' ? 'Campuran' : 'Borongan'} · Retensi {c.retention_pct}%
                      {(c as any).payment_mode !== 'borongan' && (c as any).daily_rate > 0 ? ` · Rate ${Math.round((c as any).daily_rate).toLocaleString('id-ID')}/hari` : ''}
                    </Text>
                    {c.payment_mode === 'campuran' && (
                      <Text style={styles.hint}>
                        Gunakan Kehadiran untuk HOK harian, lalu pilih tipe minggu saat membuat opname.
                      </Text>
                    )}
                  </View>
                  <View style={{ gap: SPACE.sm }}>
                    <TouchableOpacity
                      style={styles.rateBtn}
                      onPress={() => onOpenOpnameContract ? onOpenOpnameContract(c) : null}
                      disabled={!onOpenOpnameContract}
                    >
                      <Ionicons name="receipt-outline" size={16} color={COLORS.primary} />
                      <Text style={styles.rateBtnText}>Opname</Text>
                    </TouchableOpacity>
                    {c.payment_mode !== 'harian' && (
                      <TouchableOpacity style={styles.rateBtn} onPress={() => openRates(c)}>
                        <Ionicons name="pricetag-outline" size={16} color={COLORS.primary} />
                        <Text style={styles.rateBtnText}>Harga BoQ</Text>
                      </TouchableOpacity>
                    )}
                    {c.payment_mode !== 'borongan' && (
                      <TouchableOpacity
                        style={styles.rateBtn}
                        onPress={() => onOpenAttendanceContract ? onOpenAttendanceContract(c) : null}
                        disabled={!onOpenAttendanceContract}
                      >
                        <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
                        <Text style={styles.rateBtnText}>Kehadiran</Text>
                      </TouchableOpacity>
                    )}
                    {c.payment_mode !== 'borongan' && (
                      <TouchableOpacity style={styles.rateBtn} onPress={() => openWorkers(c)}>
                        <Ionicons name="people-outline" size={16} color={COLORS.primary} />
                        <Text style={styles.rateBtnText}>Pekerja</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </Card>
            ))}

            {!loading && contracts.length === 0 && (
              <Card>
                <Text style={styles.hint}>Belum ada kontrak mandor. Tambahkan di atas.</Text>
              </Card>
            )}
          </>
        )}

        {/* ── RATES VIEW ── */}
        {view === 'rates' && selectedContract && (
          <>
            <Text style={styles.sectionHead}>{selectedContract.mandor_name} — Harga Satuan</Text>
            <Text style={styles.hint}>
              Item di bawah diambil dari hasil parser AHS labor yang sudah dikonfirmasi dan terhubung ke BoQ proyek.
              Masukkan harga borongan yang disepakati per item untuk mengaktifkan opname.
            </Text>
            <View style={styles.importRow}>
              <TouchableOpacity
                style={[styles.importBtn, importingRates && { opacity: 0.6 }]}
                onPress={handleImportRates}
                disabled={importingRates}
              >
                {importingRates
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Ionicons name="cloud-upload-outline" size={16} color={COLORS.primary} />
                }
                <Text style={styles.importBtnText}>Upload Harga BoQ</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              Untuk import massal, upload workbook harga mandor. Sistem baca kolom labor lebih dulu, lalu fallback ke harga satuan internal/client bila kolom labor kosong.
            </Text>

            {loading && <ActivityIndicator style={{ marginTop: SPACE.lg }} color={COLORS.primary} />}

            {rates.map(rate => {
              const varPct = rate.variance_pct ?? 0;
              const varColor = varPct > 20 ? COLORS.critical : varPct > 10 ? COLORS.warning : varPct < -10 ? COLORS.info : COLORS.ok;
              const isEditing = editingRate === rate.boq_item_id;

              return (
                <Card key={rate.boq_item_id}>
                  {rate.boq_code ? <Text style={styles.rateCode}>{rate.boq_code}</Text> : null}
                  <Text style={styles.rateItemLabel}>{rate.boq_label}</Text>
                  <Text style={styles.hint}>Volume: {rate.boq_volume} {rate.unit}</Text>

                  <View style={styles.rateCompRow}>
                    <View style={styles.rateCompItem}>
                      <Text style={styles.rateCompLabel}>BoQ AHS</Text>
                      <Text style={styles.rateCompValue}>
                        {rate.boq_labor_rate > 0 ? `Rp ${Math.round(rate.boq_labor_rate).toLocaleString('id-ID')}` : '—'}
                      </Text>
                    </View>
                    <Ionicons name="arrow-forward" size={16} color={COLORS.textMuted} />
                    <View style={styles.rateCompItem}>
                      <Text style={styles.rateCompLabel}>Kontrak</Text>
                      {isEditing ? (
                        <TextInput
                          style={styles.rateInput}
                          keyboardType="numeric"
                          value={rateInput}
                          onChangeText={setRateInput}
                          placeholder="0"
                          placeholderTextColor={COLORS.textMuted}
                          autoFocus
                        />
                      ) : (
                        <Text style={[styles.rateCompValue, rate.contracted_rate > 0 && { color: COLORS.primary }]}>
                          {rate.contracted_rate > 0
                            ? `Rp ${Math.round(rate.contracted_rate).toLocaleString('id-ID')}`
                            : 'Belum diset'}
                        </Text>
                      )}
                    </View>
                    {rate.contracted_rate > 0 && !isEditing && (
                      <View style={[styles.varBadge, { backgroundColor: varColor + '22' }]}>
                        <Text style={[styles.varText, { color: varColor }]}>
                          {varPct > 0 ? '+' : ''}{varPct.toFixed(0)}%
                        </Text>
                      </View>
                    )}
                  </View>

                  {isEditing ? (
                    <View style={styles.rateActions}>
                      <TouchableOpacity style={styles.saveBtn} onPress={() => handleSaveRate(rate)}>
                        <Text style={styles.saveBtnText}>Simpan</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => { setEditingRate(null); setRateInput(''); }}>
                        <Text style={styles.cancelBtnText}>Batal</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.editRateBtn}
                      onPress={() => {
                        setEditingRate(rate.boq_item_id);
                        setRateInput(rate.contracted_rate > 0 ? String(Math.round(rate.contracted_rate)) : '');
                      }}
                    >
                      <Ionicons name="pencil" size={14} color={COLORS.primary} />
                      <Text style={styles.editRateBtnText}>
                        {rate.contracted_rate > 0 ? 'Edit Harga' : 'Set Harga'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </Card>
              );
            })}

            {!loading && rates.length === 0 && (
              <Card>
                <Text style={styles.hint}>
                  Belum ada item BoQ yang cocok. Pastikan baseline sudah dipublish dan trade category sudah dikonfirmasi.
                </Text>
              </Card>
            )}
          </>
        )}

        {/* ── WORKERS VIEW ── */}
        {view === 'workers' && selectedContract && (
          <>
            <Text style={styles.sectionHead}>{selectedContract.mandor_name} — Daftar Pekerja</Text>

            {/* Excel import button */}
            <View style={styles.importRow}>
              <TouchableOpacity
                style={[styles.importBtn, importingWorkers && { opacity: 0.6 }]}
                onPress={handleImportWorkers}
                disabled={importingWorkers}
              >
                {importingWorkers
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Ionicons name="cloud-upload-outline" size={16} color={COLORS.primary} />
                }
                <Text style={styles.importBtnText}>Import Excel</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              Upload file Excel dengan kolom: Nama Pekerja, Jabatan, Tarif Harian, Berlaku Mulai.
            </Text>

            {/* Add worker form */}
            <Card>
              <Text style={styles.fieldLabel}>Tambah Pekerja</Text>
              <TextInput
                style={styles.input}
                placeholder="Nama pekerja"
                placeholderTextColor={COLORS.textMuted}
                value={newWorkerName}
                onChangeText={setNewWorkerName}
              />
              <Text style={styles.fieldLabel}>Jabatan</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm }}>
                {(['tukang', 'kenek', 'wakil_mandor', 'operator', 'lainnya'] as SkillLevel[]).map(sk => (
                  <TouchableOpacity
                    key={sk}
                    style={[
                      { paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs + 1, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
                      newWorkerSkill === sk && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                    ]}
                    onPress={() => setNewWorkerSkill(sk)}
                  >
                    <Text style={[
                      { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
                      newWorkerSkill === sk && { color: COLORS.textInverse },
                    ]}>
                      {skillLevelLabel(sk)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fieldLabel}>Tarif Harian (Rp)</Text>
              <TextInput
                style={[styles.input, { width: 180 }]}
                keyboardType="numeric"
                placeholder="150000"
                placeholderTextColor={COLORS.textMuted}
                value={newWorkerRate}
                onChangeText={setNewWorkerRate}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
                onPress={handleAddWorker}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Tambah</Text>
                }
              </TouchableOpacity>
            </Card>

            {/* Default contract-level overtime rules */}
            <Text style={styles.sectionHead}>Aturan Lembur Default</Text>
            <Card>
              <Text style={styles.hint}>Jam kerja normal: 7 jam/hari (8:00–16:00 minus 1 jam istirahat) · Berlaku untuk pekerja yang belum diset tarif lemburnya</Text>
              <Text style={styles.fieldLabel}>Tarif Lembur Tier 1 (Rp/jam)</Text>
              <TextInput
                style={[styles.input, { width: 180 }]}
                keyboardType="numeric"
                placeholder="12500"
                placeholderTextColor={COLORS.textMuted}
                value={otTier1Rate}
                onChangeText={setOtTier1Rate}
              />
              <Text style={styles.fieldLabel}>Batas Tier 2 (jam total)</Text>
              <TextInput
                style={[styles.input, { width: 100 }]}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor={COLORS.textMuted}
                value={otTier2Threshold}
                onChangeText={setOtTier2Threshold}
              />
              <Text style={styles.fieldLabel}>Tarif Lembur Tier 2 (Rp/jam)</Text>
              <TextInput
                style={[styles.input, { width: 180 }]}
                keyboardType="numeric"
                placeholder="18750"
                placeholderTextColor={COLORS.textMuted}
                value={otTier2Rate}
                onChangeText={setOtTier2Rate}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, savingOt && { opacity: 0.6 }]}
                onPress={handleSaveOvertimeRules}
                disabled={savingOt}
              >
                {savingOt
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>{overtimeRules ? 'Update Lembur' : 'Simpan Lembur'}</Text>
                }
              </TouchableOpacity>
            </Card>

            {loading && <ActivityIndicator style={{ marginTop: SPACE.lg }} color={COLORS.primary} />}

            {/* Worker list */}
            <Text style={styles.sectionHead}>Pekerja Aktif ({workers.length})</Text>
            {workers.map(w => {
              const isEditRate = editingWorkerRate === w.id;
              const isEditOt = editingWorkerOt === w.id;
              return (
                <Card key={w.id}>
                  <View style={styles.contractRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contractName}>{w.worker_name}</Text>
                      <Text style={styles.hint}>{skillLevelLabel(w.skill_level)}</Text>

                      {/* Daily rate row */}
                      {isEditRate ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.sm }}>
                          <TextInput
                            style={[styles.rateInput, { flex: 1 }]}
                            keyboardType="numeric"
                            value={workerRateInput}
                            onChangeText={setWorkerRateInput}
                            placeholder="Tarif baru"
                            placeholderTextColor={COLORS.textMuted}
                            autoFocus
                          />
                          <TouchableOpacity style={styles.saveBtn} onPress={() => handleUpdateWorkerRate(w.id)}>
                            <Text style={styles.saveBtnText}>OK</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.cancelBtn} onPress={() => { setEditingWorkerRate(null); setWorkerRateInput(''); }}>
                            <Text style={styles.cancelBtnText}>X</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs }}>
                          <Text style={{ fontSize: TYPE.base, fontFamily: FONTS.semibold, color: w.current_daily_rate ? COLORS.text : COLORS.warning }}>
                            {w.current_daily_rate ? formatRate(w.current_daily_rate) : 'Belum ada tarif'}
                          </Text>
                          <TouchableOpacity onPress={() => { setEditingWorkerRate(w.id); setWorkerRateInput(w.current_daily_rate ? String(w.current_daily_rate) : ''); }}>
                            <Ionicons name="pencil" size={14} color={COLORS.primary} />
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Overtime rules row */}
                      {isEditOt ? (
                        <View style={{ gap: SPACE.sm, marginTop: SPACE.md }}>
                          <View style={{ gap: SPACE.xs }}>
                            <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec }}>Tier 1 Rate (Rp/jam)</Text>
                            <TextInput
                              style={styles.rateInput}
                              keyboardType="numeric"
                              value={workerOtT1}
                              onChangeText={setWorkerOtT1}
                              placeholder="12500"
                              placeholderTextColor={COLORS.textMuted}
                            />
                          </View>
                          <View style={{ gap: SPACE.xs }}>
                            <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec }}>Tier 2 Threshold (jam)</Text>
                            <TextInput
                              style={styles.rateInput}
                              keyboardType="numeric"
                              value={workerOtT2Threshold}
                              onChangeText={setWorkerOtT2Threshold}
                              placeholder="10"
                              placeholderTextColor={COLORS.textMuted}
                            />
                          </View>
                          <View style={{ gap: SPACE.xs }}>
                            <Text style={{ fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec }}>Tier 2 Rate (Rp/jam)</Text>
                            <TextInput
                              style={styles.rateInput}
                              keyboardType="numeric"
                              value={workerOtT2}
                              onChangeText={setWorkerOtT2}
                              placeholder="18750"
                              placeholderTextColor={COLORS.textMuted}
                            />
                          </View>
                          <View style={{ flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.xs }}>
                            <TouchableOpacity
                              style={[styles.saveBtn, { flex: 1 }]}
                              disabled={savingWorkerOt}
                              onPress={() => handleSaveWorkerOvertimeRules(w.id)}
                            >
                              <Text style={styles.saveBtnText}>{savingWorkerOt ? 'Menyimpan...' : 'Simpan'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.cancelBtn, { flex: 1 }]}
                              disabled={savingWorkerOt}
                              onPress={() => setEditingWorkerOt(null)}
                            >
                              <Text style={styles.cancelBtnText}>Batal</Text>
                            </TouchableOpacity>
                            {w.ot_tier1_rate !== null && (
                              <TouchableOpacity
                                style={[styles.cancelBtn, { flex: 1 }]}
                                disabled={savingWorkerOt}
                                onPress={() => handleClearWorkerOvertimeRules(w.id)}
                              >
                                <Text style={styles.cancelBtnText}>Reset</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs }}>
                          {w.ot_tier1_rate !== null ? (
                            <>
                              <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, flex: 1 }}>
                                Lembur: {formatRate(w.ot_tier1_rate)}/j · {formatRate(w.ot_tier2_rate ?? 0)}/j (ab {w.ot_tier2_threshold ?? 10}j)
                              </Text>
                            </>
                          ) : (
                            <Text style={{ fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, flex: 1 }}>
                              Ikut kontrak
                            </Text>
                          )}
                          <TouchableOpacity
                            onPress={() => {
                              setEditingWorkerOt(w.id);
                              setWorkerOtT1(w.ot_tier1_rate ? String(w.ot_tier1_rate) : '');
                              setWorkerOtT2(w.ot_tier2_rate ? String(w.ot_tier2_rate) : '');
                              setWorkerOtT2Threshold(w.ot_tier2_threshold ? String(w.ot_tier2_threshold) : '10');
                            }}
                          >
                            <Ionicons name="pencil" size={14} color={COLORS.primary} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity style={{ padding: SPACE.sm }} onPress={() => handleDeactivateWorker(w)}>
                      <Ionicons name="close-circle-outline" size={20} color={COLORS.critical} />
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })}

            {!loading && workers.length === 0 && (
              <Card>
                <Text style={styles.hint}>Belum ada pekerja. Tambahkan di atas atau import dari Excel.</Text>
              </Card>
            )}
          </>
        )}

      </ScrollView>

      {/* Trade Review Modal */}
      <Modal
        visible={showTradeModal}
        animationType="slide"
        onRequestClose={() => setShowTradeModal(false)}
      >
        <View style={styles.flex}>
          <Header />
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setShowTradeModal(false)}
              style={styles.modalBackBtn}
            >
              <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
              <Text style={styles.modalBackText}>Tutup</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Review Kategori Pekerjaan</Text>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.hint}>
              Sistem mendeteksi kategori pekerjaan dari deskripsi AHS secara otomatis.
              Tinjau dan konfirmasi setiap kelompok sebelum setup kontrak mandor.
            </Text>

            {loadingTrades && <ActivityIndicator style={{ marginTop: SPACE.xl }} color={COLORS.primary} />}

            {!loadingTrades && tradeSummary.length === 0 && (
              <Card>
                <View style={styles.emptyState}>
                  <Ionicons name="checkmark-circle" size={36} color={COLORS.ok} />
                  <Text style={styles.emptyTitle}>Semua trade sudah dikonfirmasi</Text>
                  <Text style={styles.hint}>Silakan tutup modal dan lanjut setup harga.</Text>
                </View>
              </Card>
            )}

            {tradeSummary.map(group => (
              <Card key={group.category}>
                <TouchableOpacity
                  style={styles.tradeHeader}
                  onPress={() => setExpandedTrade(expandedTrade === group.category ? null : group.category)}
                >
                  <View style={[styles.tradeDot, { backgroundColor: TRADE_COLORS[group.category] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tradeLabel}>{group.label}</Text>
                    <Text style={styles.hint}>{group.line_count} baris AHS · {group.boq_items.length} item BoQ</Text>
                  </View>
                  <Ionicons
                    name={expandedTrade === group.category ? 'chevron-up' : 'chevron-down'}
                    size={18} color={COLORS.textSec}
                  />
                </TouchableOpacity>

                {expandedTrade === group.category && (
                  <>
                    {/* Sample BoQ items */}
                    <View style={styles.boqList}>
                      {group.boq_items.slice(0, 6).map((label, i) => (
                        <Text key={i} style={styles.boqItem}>· {label}</Text>
                      ))}
                      {group.boq_items.length > 6 && (
                        <Text style={styles.hint}>+{group.boq_items.length - 6} item lainnya</Text>
                      )}
                    </View>

                    {/* Sample lines with confidence */}
                    {group.lines.slice(0, 4).map(line => (
                      <View key={line.ahs_line_id} style={styles.lineRow}>
                        <View style={[
                          styles.confDot,
                          { backgroundColor: line.confidence === 'high' ? COLORS.ok : line.confidence === 'medium' ? COLORS.warning : COLORS.textMuted }
                        ]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.lineDesc}>{line.description}</Text>
                          <Text style={styles.lineReason}>{line.reason}</Text>
                        </View>
                      </View>
                    ))}
                    {group.lines.length > 4 && (
                      <Text style={[styles.hint, { marginTop: SPACE.xs }]}>+{group.lines.length - 4} baris lainnya</Text>
                    )}
                  </>
                )}

                <TouchableOpacity
                  style={[styles.confirmBtn, confirming === group.category && { opacity: 0.6 }]}
                  onPress={() => handleConfirmTrade(group.category)}
                  disabled={confirming === group.category}
                >
                  {confirming === group.category
                    ? <ActivityIndicator size="small" color={COLORS.textInverse} />
                    : <Text style={styles.confirmBtnText}>Konfirmasi {group.label}</Text>
                  }
                </TouchableOpacity>
              </Card>
            ))}
          </ScrollView>
        </View>
      </Modal>
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

  tradeBanner:      { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, backgroundColor: COLORS.warning + '14', borderWidth: 1, borderColor: COLORS.warning, borderRadius: RADIUS, padding: SPACE.base, marginBottom: SPACE.md },
  tradeBannerTitle: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.warning },
  tradeBannerHint:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },

  modalHeader:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.base, paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  modalBackBtn:  { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  modalBackText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },
  modalTitle:    { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },

  sectionHead: { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17, marginTop: 2 },
  req:  { color: COLORS.critical },

  // Trade review
  tradeHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  tradeDot:    { width: 12, height: 12, borderRadius: 6 },
  tradeLabel:  { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  boqList:     { marginTop: SPACE.md, paddingLeft: SPACE.md },
  boqItem:     { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 20 },
  lineRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm, marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  confDot:     { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  lineDesc:    { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  lineReason:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 1 },
  confirmBtn:  { marginTop: SPACE.md, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  confirmBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Contracts
  fieldLabel: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.md, marginBottom: SPACE.xs },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.md - 1, paddingHorizontal: SPACE.md,
    fontSize: TYPE.md, fontFamily: FONTS.regular, color: COLORS.text,
  },
  tradeChips:    { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.xs },
  tradeChip:     { paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs + 1, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  tradeChipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  primaryBtn:    { marginTop: SPACE.md, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  primaryBtnText:{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.3 },

  contractRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md },
  contractName:  { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.xs },
  tradeTagsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginBottom: SPACE.xs },
  tradeMiniTag:  { paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: RADIUS_SM, borderWidth: 1 },
  tradeMiniText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },  // was TYPE.xs-1 (10dp)
  rateBtn:       { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.primary },
  rateBtnText:   { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },

  // Rates
  importRow: { flexDirection: 'row', justifyContent: 'flex-start', marginTop: SPACE.md, marginBottom: SPACE.xs },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: COLORS.surface },
  importBtnText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase', letterSpacing: 0.3 },
  rateCode:      { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.primary, letterSpacing: 0.4, marginBottom: 2 },
  rateItemLabel: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.xs },
  rateCompRow:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginTop: SPACE.md },
  rateCompItem:  { flex: 1 },
  rateCompLabel: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginBottom: 2 },
  rateCompValue: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  rateInput:     { borderBottomWidth: 1.5, borderBottomColor: COLORS.primary, fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.primary, paddingVertical: 2 },
  varBadge:      { paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: RADIUS_SM },
  varText:       { fontSize: TYPE.xs, fontFamily: FONTS.bold },
  rateActions:   { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  saveBtn:       { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, alignItems: 'center' },
  saveBtnText:   { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },
  cancelBtn:     { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, alignItems: 'center' },
  cancelBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  editRateBtn:   { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.md },
  editRateBtnText:{ fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  emptyState: { alignItems: 'center', paddingVertical: SPACE.xl, gap: SPACE.md },
  emptyTitle: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
});
