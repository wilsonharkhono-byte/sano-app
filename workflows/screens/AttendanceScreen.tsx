/**
 * AttendanceScreen
 *
 * Weekly timesheet for harian/campuran mandor contracts.
 *
 * Views:
 *   entry   — weekly grid: workers as rows, Mon–Sat as tappable columns (R19)
 *             tap cell cycles belum-ditandai → hadir → absen (U2: presence is
 *             never assumed); tap OT input = set jam lembur
 *             saves marked days via recordWorkerAttendanceBatch per date
 *   history — compact 1-line-per-week-per-worker summary (read-only)
 *
 * Supervisor fills by date range → estimator's opname picks week_start/week_end
 * → recompute aggregates all attendance entries in that range. They match.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import Header from '../components/Header';
import Card   from '../components/Card';
import Badge  from '../components/Badge';
import { useProject } from '../hooks/useProject';
import { useToast }   from '../components/Toast';
import { readPickedWorkbook } from '../utils/workbookPicker';
import { getMandorContracts, formatRp, type MandorContract } from '../../tools/opname';
import {
  getWorkersWithRates, getCurrentOvertimeRules,
  type WorkerWithRate,
} from '../../tools/workerRoster';
import {
  getAttendanceByWeek, getWeeklySummary, confirmWeeklyAttendance,
  recordWorkerAttendanceBatch,
  getWeekStart, getWeekEnd, getWeekDates,
  buildInitialGrid, reconcileGridAfterSave, buildSavePayloads, buildPersistedMap,
  computeWorkerWeekTotal, countUnmarkedCells, countDirtyCells, countDraftEntries,
  canConfirmWeek, cyclePresence, isCellLocked,
  type WorkerAttendanceWeekly, type WorkerAttendanceEntry,
  type PresenceGrid, type CellPresence,
} from '../../tools/workerAttendance';
import { parseAndImportAttendance } from '../../tools/excelAttendanceImport';
import { encode } from 'base64-arraybuffer';
import * as XLSX from 'xlsx';
import { COLORS, FONTS, TYPE, SPACE, RADIUS, RADIUS_SM } from '../theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'entry' | 'history';

// weekGrid[workerId][dateISO] = GridCell (tri-state presence: unmarked | present | absent)
type WeekGrid = PresenceGrid;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// R19: Mon–Sat, Sunday excluded.
const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  return localISO(d);
}

function nextWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  return localISO(d);
}

const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function formatWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const fmt = (d: Date) => `${d.getDate()} ${ID_MONTHS[d.getMonth()]}`;
  return `${fmt(s)} – ${fmt(e)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AttendanceScreen({
  onBack,
  initialContractId,
}: {
  onBack: () => void;
  initialContractId?: string;
}) {
  const { project } = useProject();
  const { show: toast } = useToast();

  const [view, setView] = useState<ViewMode>('entry');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  const [contracts, setContracts] = useState<MandorContract[]>([]);
  const [selectedContract, setSelectedContract] = useState<MandorContract | null>(null);
  const [workers, setWorkers] = useState<WorkerWithRate[]>([]);

  // Week navigation — memoized so stable references don't re-trigger loadWeekEntry
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const weekEnd   = useMemo(() => getWeekEnd(new Date(weekStart + 'T00:00:00')), [weekStart]);
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  // Minggu ke N — week number relative to contract creation date
  const weekNumber = useMemo(() => {
    if (!selectedContract) return 1;
    const origin = new Date(selectedContract.created_at.split('T')[0] + 'T00:00:00');
    const day = origin.getDay();
    origin.setDate(origin.getDate() - day + (day === 0 ? -6 : 1)); // Monday of contract's creation week
    const thisWeek = new Date(weekStart + 'T00:00:00');
    const dayDiff = Math.round((thisWeek.getTime() - origin.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(dayDiff / 7) + 1);
  }, [selectedContract, weekStart]);

  // The editable grid
  const [weekGrid, setWeekGrid] = useState<WeekGrid>({});
  // Persisted DB truth for the current week — source for per-cell dirty
  // reconciliation (F4) and the Konfirmasi badge (persisted DRAFT count).
  const [persistedEntries, setPersistedEntries] = useState<WorkerAttendanceEntry[]>([]);

  // History (read-only summary)
  const [weeklySummary, setWeeklySummary] = useState<WorkerAttendanceWeekly[]>([]);

  // OT rates (for estimate) — stored on workers, loaded with getWorkersWithRates
  const [contractOtTier1, setContractOtTier1] = useState(0);
  const [contractOtTier2, setContractOtTier2] = useState(0);
  const [contractOtThreshold, setContractOtThreshold] = useState(10);

  // ── Load ──────────────────────────────────────────────────────────────

  const loadContracts = useCallback(async () => {
    if (!project) return;
    const data = await getMandorContracts(project.id);
    const filtered = data.filter((c: any) =>
      c.payment_mode === 'harian' || c.payment_mode === 'campuran',
    );
    setContracts(filtered);
    if (!filtered.length) { setSelectedContract(null); return; }
    const preferred = initialContractId
      ? filtered.find(c => c.id === initialContractId)
      : null;
    setSelectedContract(prev => {
      if (preferred) return preferred;
      if (prev && filtered.some(c => c.id === prev.id)) return prev;
      return filtered[0];
    });
  }, [project, initialContractId]);

  const loadWeekEntry = useCallback(async () => {
    if (!selectedContract) return;
    setLoading(true);
    const [workerList, contractOt, entries] = await Promise.all([
      getWorkersWithRates(selectedContract.id),
      getCurrentOvertimeRules(selectedContract.id),
      getAttendanceByWeek(selectedContract.id, weekStart, weekEnd),
    ]);
    setWorkers(workerList);
    setContractOtTier1(contractOt?.tier1_hourly_rate ?? 0);
    setContractOtTier2(contractOt?.tier2_hourly_rate ?? 0);
    setContractOtThreshold(contractOt?.tier2_threshold_hours ?? 10);

    // Build grid from existing entries — cells with no persisted entry start UNMARKED
    // (U2: presence is never assumed; an unmarked cell pays zero and blocks Konfirmasi).
    setWeekGrid(buildInitialGrid(workerList.map((w) => w.id), weekDates, entries));
    setPersistedEntries(entries);
    setLoading(false);
  }, [selectedContract, weekStart, weekEnd, weekDates]);

  const loadHistory = useCallback(async () => {
    if (!selectedContract) return;
    setLoading(true);
    const summary = await getWeeklySummary(selectedContract.id);
    setWeeklySummary(summary);
    setLoading(false);
  }, [selectedContract]);

  useEffect(() => { loadContracts(); }, [loadContracts]);
  useEffect(() => {
    if (view === 'entry') loadWeekEntry();
    else loadHistory();
  }, [view, loadWeekEntry, loadHistory]);

  // ── Grid mutations ────────────────────────────────────────────────────

  // Tap cycles: unmarked → present → absent → present … (F3, keeps U1 tap speed).
  const togglePresence = (workerId: string, date: string) => {
    if (isCellLocked(weekGrid[workerId]?.[date]?.status)) {
      toast('Terkunci — koreksi lewat kantor', 'warning');
      return;
    }
    setWeekGrid(prev => {
      const current = prev[workerId][date];
      const next = cyclePresence(current.presence);
      return {
        ...prev,
        [workerId]: {
          ...prev[workerId],
          [date]: {
            ...current,
            presence: next,
            overtimeHours: next === 'present' ? current.overtimeHours : 0,
          },
        },
      };
    });
  };

  const setOT = (workerId: string, date: string, val: string) => {
    if (isCellLocked(weekGrid[workerId]?.[date]?.status)) return;
    const hours = Math.max(0, parseFloat(val) || 0);
    setWeekGrid(prev => ({
      ...prev,
      [workerId]: {
        ...prev[workerId],
        [date]: { ...prev[workerId][date], overtimeHours: hours },
      },
    }));
  };

  // Explicit blanket assertion: mark every UNMARKED cell present (U2). Leaves
  // explicit absent marks and locked cells untouched.
  const markAllPresent = () => {
    setWeekGrid(prev => {
      const next: WeekGrid = {};
      for (const wId of Object.keys(prev)) {
        next[wId] = {};
        for (const date of weekDates) {
          const cell = prev[wId][date];
          next[wId][date] = cell.presence === 'unmarked' && !isCellLocked(cell.status)
            ? { ...cell, presence: 'present' }
            : cell;
        }
      }
      return next;
    });
  };

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSaveAll = async () => {
    if (!selectedContract || !project) return;
    setSaving(true);

    const workerIds = workers.map((w) => w.id);
    // Only marked, editable, changed cells are sent; unmarked cells are excluded
    // and a date with nothing to save gets no RPC call at all (U2 / F3).
    const payloads = buildSavePayloads(weekDates, workerIds, weekGrid, persistedMap);
    const failedDates: string[] = [];
    let totalSaved = 0;

    for (const { attendanceDate, entries } of payloads) {
      const { count, error } = await recordWorkerAttendanceBatch({
        contractId: selectedContract.id,
        attendanceDate,
        entries,
      });
      if (error) failedDates.push(attendanceDate);
      else totalSaved += count ?? 0;
    }

    // F4: re-fetch and reconcile per-cell against what actually persisted.
    // Saved days go clean; failed days keep the user's marks (stay dirty).
    const fresh = await getAttendanceByWeek(selectedContract.id, weekStart, weekEnd);
    setPersistedEntries(fresh);
    setWeekGrid((prev) => reconcileGridAfterSave(prev, workerIds, weekDates, fresh, failedDates));
    setSaving(false);

    if (failedDates.length > 0) {
      const names = failedDates
        .map((d) => DAY_LABELS[weekDates.indexOf(d)] ?? d)
        .join(', ');
      toast(`Gagal disimpan: ${names} — coba lagi`, 'warning');
    } else {
      toast(`${totalSaved} entri disimpan`, 'ok');
    }
  };

  const handleConfirmWeek = async () => {
    if (!selectedContract) return;
    setSaving(true);
    const { count, error } = await confirmWeeklyAttendance({
      contractId: selectedContract.id,
      weekStart,
    });
    setSaving(false);
    if (error) { toast(error, 'critical'); return; }
    toast(`${count} entri dikonfirmasi`, 'ok');
    loadWeekEntry();
  };

  // ── Excel template download ───────────────────────────────────────────

  const handleExportTemplate = async () => {
    if (!selectedContract) return;
    setImportingFile(true);
    try {
      // Header row: Nama | date Hadir | date Lembur | date Hadir | ... | Keterangan
      // Embed ISO date in column name so the parser can recover it unambiguously.
      // Display format: "Sen 23/3\n(Hadir)" — user fills Y or N
      const headerRow: unknown[] = ['Nama Pekerja'];
      for (let i = 0; i < weekDates.length; i++) {
        const date = weekDates[i];
        const d = new Date(date + 'T00:00:00');
        const label = `${DAY_LABELS[i]} ${d.getDate()}/${d.getMonth() + 1}`;
        // Embed ISO date in the col header so the parser can recover it
        headerRow.push(`${label}\n${date}\nHadir (Y/N)`, `${label}\n${date}\nLembur (jam)`);
      }
      headerRow.push('Keterangan');

      const wsData: unknown[][] = [headerRow];

      // One data row per worker — BLANK presence + OT (U2: never default-present;
      // the mandor must mark Y/N explicitly, blank cells are skipped on import).
      for (const w of workers) {
        const row: unknown[] = [w.worker_name];
        for (const _ of weekDates) {
          row.push('', '');
        }
        row.push('');
        wsData.push(row);
      }

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Col widths: name=22, then pairs of (10, 10) per day, keterangan=24
      ws['!cols'] = [
        { wch: 22 },
        ...weekDates.flatMap(() => [{ wch: 11 }, { wch: 10 }]),
        { wch: 24 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Kehadiran');

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array;
      const ab: ArrayBuffer = buf.buffer instanceof ArrayBuffer
        ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        : new Uint8Array(buf).buffer;
      const fileName = `Absensi_${selectedContract.mandor_name.replace(/\s+/g, '_')}_${weekStart}.xlsx`;

      if (Platform.OS === 'web') {
        const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const FileSystem = await import('expo-file-system/legacy');
        const Sharing = await import('expo-sharing');
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, encode(ab), {
          encoding: FileSystem.EncodingType.Base64,
        });
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Template Kehadiran',
          UTI: 'com.microsoft.excel.xlsx',
        });
      }
      toast('Template siap diunduh', 'ok');
    } catch (err: any) {
      toast(err.message ?? 'Gagal membuat template', 'critical');
    } finally {
      setImportingFile(false);
    }
  };

  const handleImportAttendance = async () => {
    if (!selectedContract || !project) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.length) return;

      setImportingFile(true);
      const { arrayBuffer } = await readPickedWorkbook(picked.assets[0]);
      const result = await parseAndImportAttendance(
        arrayBuffer.slice(0),
        selectedContract.id,
        project.id,
      );
      setImportingFile(false);

      const parts = [];
      if (result.imported > 0) parts.push(`${result.imported} entri diimpor`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} error`);
      toast(parts.join(' · ') || 'Import selesai', result.errors.length > 0 ? 'warning' : 'ok');
      loadWeekEntry();
    } catch (err: any) {
      setImportingFile(false);
      toast(err.message ?? 'Gagal import', 'critical');
    }
  };

  // ── Computed ──────────────────────────────────────────────────────────

  const workerIds = workers.map((w) => w.id);
  const persistedMap = useMemo(() => buildPersistedMap(persistedEntries), [persistedEntries]);

  // Pay preview: only 'present' cells pay; 'unmarked' and 'absent' contribute zero (U2).
  const weekTotals = workers.map((w) => {
    const cells = weekDates.map((d) =>
      weekGrid[w.id]?.[d] ?? { presence: 'unmarked' as CellPresence, overtimeHours: 0 },
    );
    const t = computeWorkerWeekTotal(cells, {
      dailyRate: w.current_daily_rate ?? 0,
      tier1Rate: w.ot_tier1_rate ?? contractOtTier1,
      tier2Rate: w.ot_tier2_rate ?? contractOtTier2,
      tier2Threshold: w.ot_tier2_threshold ?? contractOtThreshold,
    });
    return { workerId: w.id, ...t };
  });

  const grandTotal = weekTotals.reduce((s, t) => s + t.weekPay, 0);
  const grandDays = weekTotals.reduce((s, t) => s + t.days, 0);

  // Konfirmasi gating (F3/F4): unmarked cells block; badge = persisted DRAFT rows.
  const unmarkedCount = countUnmarkedCells(weekDates, workerIds, weekGrid);
  const hasUnsavedEdits = countDirtyCells(weekDates, workerIds, weekGrid, persistedMap) > 0;
  const persistedDraftCount = countDraftEntries(persistedEntries);
  const canConfirm = canConfirmWeek({ persistedDraftCount, hasUnsavedEdits, unmarkedCount });

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <View style={styles.flex}>
      <Header />

      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
        <Text style={styles.backText}>Kembali</Text>
      </TouchableOpacity>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, view === 'entry' && styles.tabActive]}
          onPress={() => setView('entry')}
        >
          <Text style={[styles.tabText, view === 'entry' && styles.tabTextActive]}>Input Mingguan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, view === 'history' && styles.tabActive]}
          onPress={() => setView('history')}
        >
          <Text style={[styles.tabText, view === 'history' && styles.tabTextActive]}>Riwayat</Text>
        </TouchableOpacity>
      </View>

      {/* ── ENTRY VIEW — weekly timesheet grid ── */}
      {view === 'entry' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

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
              <Text style={styles.hint}>Belum ada kontrak mandor dengan mode harian/campuran.</Text>
            </Card>
          )}

          {selectedContract && (
            <>
              {/* Week navigation */}
              <View style={styles.weekNav}>
                <TouchableOpacity style={styles.weekNavBtn} onPress={() => setWeekStart(prevWeek(weekStart))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
                </TouchableOpacity>
                <View style={styles.weekLabelBox}>
                  <Text style={styles.weekNum}>Minggu ke {weekNumber}</Text>
                  <Text style={styles.weekDates}>{formatWeekLabel(weekStart, weekEnd)}</Text>
                </View>
                <TouchableOpacity
                  style={styles.weekNavBtn}
                  onPress={() => setWeekStart(nextWeek(weekStart))}
                  disabled={nextWeek(weekStart) > localISO(new Date())}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>

              {/* Toolbar */}
              <View style={styles.toolbar}>
                <TouchableOpacity style={styles.toolBtn} onPress={markAllPresent}>
                  <Ionicons name="checkmark-done" size={14} color={COLORS.ok} />
                  <Text style={[styles.toolBtnText, { color: COLORS.ok }]}>Semua Hadir</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolBtn, importingFile && { opacity: 0.5 }]}
                  onPress={handleExportTemplate}
                  disabled={importingFile}
                >
                  <Ionicons name="cloud-download-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.toolBtnText}>Template</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolBtn, importingFile && { opacity: 0.5 }]}
                  onPress={handleImportAttendance}
                  disabled={importingFile}
                >
                  <Ionicons name="cloud-upload-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.toolBtnText}>Impor</Text>
                </TouchableOpacity>
              </View>

              {loading && <ActivityIndicator style={{ marginTop: SPACE.lg }} color={COLORS.primary} />}

              {/* ── Timesheet grid ── */}
              {!loading && workers.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={true} bounces={false}>
                  <View>
                    {/* Column headers */}
                    <View style={styles.gridRow}>
                      <View style={styles.nameCell}>
                        <Text style={styles.gridHeaderText}>Pekerja</Text>
                      </View>
                      {weekDates.map((date, i) => (
                        <View key={date} style={styles.dayHeaderCell}>
                          <Text style={styles.dayName}>{DAY_LABELS[i]}</Text>
                          <Text style={styles.dayDate}>{date.slice(8)}</Text>
                        </View>
                      ))}
                      <View style={styles.totalHeaderCell}>
                        <Text style={styles.gridHeaderText}>Hari</Text>
                      </View>
                      <View style={styles.payHeaderCell}>
                        <Text style={styles.gridHeaderText}>Estimasi</Text>
                      </View>
                    </View>

                    {/* Separator */}
                    <View style={styles.gridSep} />

                    {/* Worker rows */}
                    {workers.map((w, wi) => {
                      const totals = weekTotals[wi];
                      return (
                        <View key={w.id}>
                          <View style={[styles.gridRow, wi % 2 === 1 && styles.gridRowAlt]}>
                            {/* Name */}
                            <View style={styles.nameCell}>
                              <Text style={styles.workerNameText} numberOfLines={1}>
                                {w.worker_name}
                              </Text>
                              <Text style={styles.workerSkillText}>
                                {formatRp(w.current_daily_rate ?? 0).replace('Rp ', '')}
                              </Text>
                            </View>

                            {/* Day cells — tri-state: unmarked (grey –) / present (✓) / absent (✗) */}
                            {weekDates.map((date) => {
                              const cell = weekGrid[w.id]?.[date];
                              const presence: CellPresence = cell?.presence ?? 'unmarked';
                              const locked = isCellLocked(cell?.status);
                              const ot = cell?.overtimeHours ?? 0;
                              const pillStyle =
                                presence === 'present' ? styles.presencePresent
                                : presence === 'absent' ? styles.presenceAbsent
                                : styles.presenceUnmarked;
                              const symbol =
                                presence === 'present' ? '✓' : presence === 'absent' ? '✗' : '–';

                              return (
                                <View key={date} style={styles.dayCell}>
                                  <TouchableOpacity
                                    style={[styles.presenceToggle, pillStyle, locked && styles.presenceLocked]}
                                    onPress={() => togglePresence(w.id, date)}
                                    activeOpacity={locked ? 1 : 0.2}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                  >
                                    <Text style={[
                                      styles.presenceSymbol,
                                      presence === 'unmarked' && styles.presenceSymbolMuted,
                                    ]}>{symbol}</Text>
                                  </TouchableOpacity>
                                  {locked ? (
                                    <View style={styles.lockRow}>
                                      <Ionicons name="lock-closed" size={12} color={COLORS.textSec} />
                                      {presence === 'present' && ot > 0 && (
                                        <Text style={styles.lockOt}>{ot}j</Text>
                                      )}
                                    </View>
                                  ) : presence === 'present' ? (
                                    <TextInput
                                      style={styles.otInput}
                                      keyboardType="decimal-pad"
                                      value={ot > 0 ? String(ot) : ''}
                                      onChangeText={(val) => setOT(w.id, date, val)}
                                      placeholder="0"
                                      placeholderTextColor={COLORS.textMuted}
                                      selectTextOnFocus
                                    />
                                  ) : (
                                    <Text style={styles.otPlaceholder}>–</Text>
                                  )}
                                </View>
                              );
                            })}

                            {/* Totals */}
                            <View style={styles.totalCell}>
                              <Text style={styles.totalText}>{totals.days}h</Text>
                              {totals.totalOT > 0 && (
                                <Text style={styles.otSummary}>{totals.totalOT}j OT</Text>
                              )}
                            </View>
                            <View style={styles.payCell}>
                              <Text style={styles.payText} numberOfLines={1}>{formatRp(totals.weekPay)}</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}

                    {/* Footer totals */}
                    <View style={styles.gridSep} />
                    <View style={styles.gridRow}>
                      <View style={styles.nameCell}>
                        <Text style={styles.gridFooterText}>Total</Text>
                      </View>
                      {weekDates.map(date => {
                        const present = workers.filter(w => weekGrid[w.id]?.[date]?.presence === 'present').length;
                        return (
                          <View key={date} style={styles.dayCell}>
                            <Text style={styles.footerDayCount}>{String(present)}</Text>
                          </View>
                        );
                      })}
                      <View style={styles.totalCell}>
                        <Text style={styles.gridFooterText}>{grandDays}h</Text>
                      </View>
                      <View style={styles.payCell}>
                        <Text style={[styles.gridFooterText, { color: COLORS.primary }]} numberOfLines={1}>
                          {formatRp(grandTotal)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </ScrollView>
              )}

              {!loading && workers.length === 0 && (
                <Card>
                  <Text style={styles.hint}>
                    Belum ada pekerja terdaftar. Tambahkan di Mandor → Pekerja.
                  </Text>
                </Card>
              )}

              {/* Save + Confirm buttons */}
              {workers.length > 0 && (
                <>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.saveBtn, (!hasUnsavedEdits || saving) && styles.saveBtnDisabled]}
                      onPress={handleSaveAll}
                      disabled={!hasUnsavedEdits || saving}
                    >
                      {saving
                        ? <ActivityIndicator size="small" color={COLORS.textInverse} />
                        : <Text style={styles.saveBtnText}>
                            {hasUnsavedEdits ? 'Simpan Draft' : 'Tersimpan'}
                          </Text>
                      }
                    </TouchableOpacity>
                    {persistedDraftCount > 0 && (
                      <TouchableOpacity
                        style={[styles.confirmBtn, (!canConfirm || saving) && styles.saveBtnDisabled]}
                        onPress={handleConfirmWeek}
                        disabled={!canConfirm || saving}
                      >
                        <Text style={styles.confirmBtnText}>Konfirmasi ({persistedDraftCount})</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Konfirmasi is blocked while any cell is still unmarked (U2/U3) */}
                  {unmarkedCount > 0 && (
                    <Text style={[styles.hint, styles.warnHint, { marginTop: SPACE.sm }]}>
                      Tandai dulu {unmarkedCount} sel yang belum ditandai sebelum Konfirmasi
                    </Text>
                  )}
                </>
              )}

              <Text style={[styles.hint, { marginTop: SPACE.md }]}>
                Ketuk sel: belum ditandai → hadir → absen · Isi kolom OT untuk jam lembur
              </Text>
            </>
          )}
        </ScrollView>
      )}

      {/* ── HISTORY VIEW — compact summary ── */}
      {view === 'history' && (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.sectionHead}>Riwayat Kehadiran</Text>

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

          {loading && <ActivityIndicator style={{ marginTop: SPACE.lg }} color={COLORS.primary} />}

          {!loading && weeklySummary.length === 0 && (
            <Card>
              <Text style={styles.hint}>Belum ada data kehadiran.</Text>
            </Card>
          )}

          {/* Group by week */}
          {!loading && (() => {
            const byWeek = new Map<string, WorkerAttendanceWeekly[]>();
            for (const ws of weeklySummary) {
              const key = ws.week_start;
              if (!byWeek.has(key)) byWeek.set(key, []);
              byWeek.get(key)!.push(ws);
            }
            return Array.from(byWeek.entries())
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([wkStart, rows]) => {
                const wkEnd = getWeekEnd(new Date(wkStart + 'T00:00:00'));
                const totalPay = rows.reduce((s, r) => s + r.total_pay, 0);
                return (
                  <Card key={wkStart}>
                    <View style={styles.historyWeekHeader}>
                      <Text style={styles.historyWeekLabel}>
                        {formatWeekLabel(wkStart, wkEnd)}
                      </Text>
                      <Text style={styles.historyWeekTotal}>{formatRp(totalPay)}</Text>
                    </View>

                    {/* Compact rows: one line per worker */}
                    {rows.map(ws => (
                      <View key={ws.worker_id} style={styles.historyRow}>
                        <Text style={styles.historyName} numberOfLines={1}>{ws.worker_name}</Text>
                        <Text style={styles.historyDays}>{ws.days_present}h</Text>
                        {ws.total_overtime_hours > 0 && (
                          <Text style={styles.historyOT}>{ws.total_overtime_hours}j OT</Text>
                        )}
                        <Text style={styles.historyPay} numberOfLines={1}>{formatRp(ws.total_pay)}</Text>
                        <View style={styles.historyStatus}>
                          {ws.settled_count === ws.days_present + ws.days_absent
                            ? <Badge flag="OK" label="Settled" />
                            : ws.confirmed_count > 0
                            ? <Badge flag="INFO" label="Konfirm" />
                            : <Badge flag="WARNING" label="Draft" />
                          }
                        </View>
                      </View>
                    ))}
                  </Card>
                );
              });
          })()}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const NAME_W   = 118;
const DAY_W    = 52;
const TOTAL_W  = 44;
const PAY_W    = 112;

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },

  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.base, paddingVertical: SPACE.md },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.primary },

  tabRow:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab:           { flex: 1, paddingVertical: SPACE.md, alignItems: 'center' },
  tabActive:     { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText:       { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
  tabTextActive: { color: COLORS.primary, fontFamily: FONTS.semibold },

  sectionHead: { fontSize: TYPE.xs, fontFamily: FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase', color: COLORS.textSec, marginBottom: SPACE.sm, marginTop: SPACE.sm },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 17 },
  warnHint: { color: COLORS.warning, fontFamily: FONTS.semibold },

  contractScroll: { marginBottom: SPACE.md },
  contractChip:       { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginRight: SPACE.sm },
  contractChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  contractChipText:       { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  contractChipTextActive: { color: COLORS.textInverse },

  // Week navigation
  weekNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.sm },
  weekNavBtn:   { padding: SPACE.sm },
  weekLabelBox: { alignItems: 'center', gap: 2 },
  weekNum:      { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  weekDates:    { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec },

  // Toolbar
  toolbar:     { flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.md },
  toolBtn:     { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.sm + 2, paddingVertical: SPACE.xs + 2, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  toolBtnText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },

  // Grid
  gridRow:    { flexDirection: 'row', alignItems: 'stretch' },
  gridRowAlt: { backgroundColor: COLORS.bg },
  gridSep:    { height: 1, backgroundColor: COLORS.border, marginVertical: 2 },

  nameCell:       { width: NAME_W, paddingVertical: SPACE.sm, paddingRight: SPACE.sm, justifyContent: 'center' },
  dayHeaderCell:  { width: DAY_W, alignItems: 'center', paddingVertical: SPACE.sm },
  totalHeaderCell:{ width: TOTAL_W, alignItems: 'center', paddingVertical: SPACE.sm },
  payHeaderCell:  { width: PAY_W, alignItems: 'flex-end', paddingVertical: SPACE.sm },

  gridHeaderText: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.5 },
  gridFooterText: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.text },

  dayName: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.textSec, letterSpacing: 0.3 },
  dayDate: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },

  dayCell: { width: DAY_W, alignItems: 'center', paddingVertical: SPACE.xs },
  totalCell: { width: TOTAL_W, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.xs },
  payCell: { width: PAY_W, alignItems: 'flex-end', justifyContent: 'center', paddingVertical: SPACE.xs },

  presenceToggle: { width: 34, height: 30, borderRadius: RADIUS_SM, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  presencePresent:  { backgroundColor: COLORS.ok + '28' },
  presenceAbsent:   { backgroundColor: COLORS.critical + '20' },
  presenceUnmarked: { backgroundColor: COLORS.borderSub, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  presenceLocked:   { opacity: 0.45 },
  presenceSymbol:      { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  presenceSymbolMuted: { color: COLORS.textMuted },

  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, height: 22 },
  lockOt:  { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec },

  otInput: {
    width: 36, height: 22, textAlign: 'center',
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary,
    borderBottomWidth: 1, borderBottomColor: COLORS.primary + '60',
    paddingVertical: 0,
  },
  otPlaceholder: { fontSize: TYPE.xs, color: COLORS.textSec, height: 22, textAlignVertical: 'center', marginTop: 1 },

  workerNameText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  workerSkillText: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },  // was TYPE.xs-1 (10dp)

  totalText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  otSummary: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },  // was TYPE.xs-1 (10dp)
  payText:   { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },

  footerDayCount: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },

  // Action buttons
  actionRow:      { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.lg },
  saveBtn:        { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  saveBtnDisabled:{ opacity: 0.45 },
  saveBtnText:    { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },
  confirmBtn:     { flex: 1, backgroundColor: COLORS.ok, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  confirmBtnText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },

  // History
  historyWeekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.sm },
  historyWeekLabel:  { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  historyWeekTotal:  { fontSize: TYPE.sm, fontFamily: FONTS.bold, color: COLORS.primary },
  historyRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.xs, borderTopWidth: 1, borderTopColor: COLORS.borderSub, gap: SPACE.sm },
  historyName:       { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  historyDays:       { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, width: 28, textAlign: 'right' },
  historyOT:         { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, width: 42, textAlign: 'right' },
  historyPay:        { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, width: 92, textAlign: 'right' },
  historyStatus:     { width: 56, alignItems: 'flex-end' },
});
