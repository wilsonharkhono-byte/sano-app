import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import {
  deriveEquipmentBalances,
  fetchDispositions,
  evaluateEquipmentAvailability,
  validateReconciliation,
  recordEquipmentMovement,
  recordEquipmentMovements,
  EquipmentBalanceRow,
  EquipmentDisposition,
  EquipmentEventType,
  EquipmentMovementInput,
} from '../../tools/equipment';
import { COLORS, FONTS, RADIUS, SPACE, TYPE, BREAKPOINTS, MAX_CONTENT_WIDTH } from '../../workflows/theme';

interface ReconLineDraft {
  qty: string;
  disposition_id: string;
}

/** Sentinel Picker value for the Gudang (yard = NULL project) option. */
const YARD = '__YARD__';

const EVENT_LABELS: Record<EquipmentEventType, string> = {
  OPENING: 'Stok awal (OPENING)',
  DEPLOY: 'Kirim ke proyek (DEPLOY)',
  TRANSFER: 'Pindah antar proyek (TRANSFER)',
  RETURN: 'Kembali ke gudang (RETURN)',
  WRITE_OFF: 'Penghapusan (WRITE_OFF)',
  REPAIRED: 'Selesai perbaikan (REPAIRED)',
};

const fmt = (n: number) => n.toLocaleString('id-ID');

/**
 * Parse a typed quantity, accepting the id-ID decimal comma ('1,5' = 1.5).
 * Bare parseFloat would silently truncate at the comma (parseFloat('1,5') = 1)
 * and record the wrong quantity. Anything ambiguous (two separators, trailing
 * junk) is NaN — rejected loudly, never guessed.
 */
const parseQty = (text: string): number => {
  const s = text.trim().replace(',', '.');
  return /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
};

export default function EquipmentScreen() {
  const { profile, projects: contextProjects } = useProject();
  const { show: toast } = useToast();
  const { width } = useWindowDimensions();
  const isTablet  = width >= BREAKPOINTS.tablet;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const contentMaxWidth = isDesktop ? MAX_CONTENT_WIDTH.desktop : isTablet ? MAX_CONTENT_WIDTH.tablet : undefined;

  const [balances, setBalances] = useState<EquipmentBalanceRow[]>([]);
  const [dispositions, setDispositions] = useState<EquipmentDisposition[]>([]);
  const [loading, setLoading] = useState(true);

  // Projects come from the shared context (RLS-scoped, refreshed by
  // useProject) — no second projects query, no drift from the rest of the app.
  const projects = useMemo(
    () => (contextProjects ?? [])
      .map(p => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })),
    [contextProjects],
  );

  // Catat pergerakan (inline form under the tapped part card)
  const [moveFormId, setMoveFormId] = useState<string | null>(null); // material id
  const [eventType, setEventType] = useState<EquipmentEventType>('DEPLOY');
  const [fromProjectId, setFromProjectId] = useState(''); // '' = unselected; YARD = gudang (WRITE_OFF only)
  const [toProjectId, setToProjectId] = useState('');
  const [yardBucket, setYardBucket] = useState<'READY' | 'REPAIR'>('READY');
  const [dispositionId, setDispositionId] = useState('');
  const [qtyText, setQtyText] = useState('');
  const [noteText, setNoteText] = useState('');

  // Hitung & tutup (inline form under a deployed project line)
  const [reconKey, setReconKey] = useState<string | null>(null); // `${material_id}|${project_id}`
  const [reconLines, setReconLines] = useState<ReconLineDraft[]>([]);

  const load = useCallback(async () => {
    try {
      // One dispositions fetch: it feeds the pickers AND the balance fold.
      const dispos = await fetchDispositions();
      const rows = await deriveEquipmentBalances(dispos);
      setBalances(rows);
      setDispositions(dispos);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Write access: office roles only — everyone else gets the read-only balance list.
  const canWrite = profile?.role === 'admin' || profile?.role === 'estimator' || profile?.role === 'principal';
  const canOpening = profile?.role === 'admin' || profile?.role === 'principal';

  const projectById = new Map(projects.map(p => [p.id, p.name]));
  const projectName = (id: string) => projectById.get(id) ?? 'Proyek tidak dikenal';

  const returnDispositions = dispositions.filter(d => d.ledger_effect === 'RETURN_OK' || d.ledger_effect === 'RETURN_HOLD');
  const writeOffDispositions = dispositions.filter(d => d.ledger_effect === 'WRITE_OFF');

  // ── Catat pergerakan ────────────────────────────────────────────────────────

  const resetMoveForm = () => {
    setEventType('DEPLOY');
    setFromProjectId('');
    setToProjectId('');
    setYardBucket('READY');
    setDispositionId('');
    setQtyText('');
    setNoteText('');
  };

  const toggleMoveForm = (materialId: string) => {
    if (moveFormId === materialId) { setMoveFormId(null); return; }
    resetMoveForm();
    setMoveFormId(materialId);
  };

  const handleEventTypeChange = (value: EquipmentEventType) => {
    setEventType(value);
    // Location and disposition fields are event-specific — never carry stale picks over.
    setFromProjectId('');
    setToProjectId('');
    setYardBucket('READY');
    setDispositionId('');
  };

  const handleSubmitMovement = async (row: EquipmentBalanceRow) => {
    const qty = parseQty(qtyText);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast('Jumlah harus angka positif', 'critical'); return;
    }

    const input: EquipmentMovementInput = {
      material_id: row.material_id,
      event_type: eventType,
      qty,
      note: noteText.trim() || null,
      moved_by: profile?.id ?? null,
    };

    switch (eventType) {
      case 'OPENING':
      case 'REPAIRED':
        break; // yard → yard; no location picks needed
      case 'DEPLOY': {
        if (!toProjectId) { toast('Pilih proyek tujuan', 'critical'); return; }
        const avail = evaluateEquipmentAvailability(row, qty);
        if (avail.flag === 'SHORTAGE') {
          toast(`Stok gudang kurang ${fmt(avail.shortfall)} ${row.unit} — siap di gudang hanya ${fmt(avail.available)}`, 'critical');
          return;
        }
        input.to_project_id = toProjectId;
        break;
      }
      case 'TRANSFER': {
        if (!fromProjectId || !toProjectId) { toast('Pilih proyek asal dan tujuan', 'critical'); return; }
        if (fromProjectId === toProjectId) { toast('Proyek asal dan tujuan harus berbeda', 'critical'); return; }
        input.from_project_id = fromProjectId;
        input.to_project_id = toProjectId;
        break;
      }
      case 'RETURN': {
        if (!fromProjectId) { toast('Pilih proyek asal', 'critical'); return; }
        if (!dispositionId) { toast('Pilih disposisi', 'critical'); return; }
        input.from_project_id = fromProjectId;
        input.disposition_id = dispositionId;
        break;
      }
      case 'WRITE_OFF': {
        if (!fromProjectId) { toast('Pilih lokasi asal', 'critical'); return; }
        if (!dispositionId) { toast('Pilih disposisi', 'critical'); return; }
        input.disposition_id = dispositionId;
        if (fromProjectId === YARD) input.yard_bucket = yardBucket;
        else input.from_project_id = fromProjectId;
        break;
      }
    }

    try {
      // The DB trigger re-derives balances and rejects overdraw — its message
      // is surfaced verbatim in the Alert below, never masked.
      await recordEquipmentMovement(input);
      toast('Pergerakan dicatat', 'ok');
      resetMoveForm();
      setMoveFormId(null);
      // A movement can change any project's deployed qty — an open count-&-close
      // form's pre-filled lines would silently go stale against the fresh
      // expected. Close it; the user re-opens against current numbers.
      setReconKey(null);
      setReconLines([]);
      await load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // ── Hitung & tutup (count & close) ──────────────────────────────────────────

  const toggleRecon = (materialId: string, projectId: string, expected: number) => {
    const key = `${materialId}|${projectId}`;
    if (reconKey === key) { setReconKey(null); return; }
    // Pre-fill one line with the full expected qty — the all-OK hand-over is one pick away.
    setReconLines([{ qty: String(expected), disposition_id: '' }]);
    setReconKey(key);
  };

  const updateReconLine = (index: number, patch: Partial<ReconLineDraft>) => {
    setReconLines(lines => lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addReconLine = () => setReconLines(lines => [...lines, { qty: '', disposition_id: '' }]);

  const removeReconLine = (index: number) => setReconLines(lines => lines.filter((_, i) => i !== index));

  const handleSubmitRecon = async (row: EquipmentBalanceRow, projectId: string, expected: number) => {
    if (reconLines.some(l => !l.disposition_id)) {
      toast('Pilih disposisi untuk semua baris', 'critical'); return;
    }
    const lines = reconLines.map(l => ({ qty: parseQty(l.qty), disposition_id: l.disposition_id }));
    if (lines.some(l => !Number.isFinite(l.qty))) {
      toast('Jumlah tiap baris harus angka positif', 'critical'); return;
    }
    const check = validateReconciliation(expected, lines);
    if (!check.ok) { toast(check.error, 'critical'); return; }

    const effectById = new Map(dispositions.map(d => [d.id, d.ledger_effect]));
    const group = `recon-${Date.now()}`;
    const inputs: EquipmentMovementInput[] = lines.map(l => ({
      material_id: row.material_id,
      event_type: effectById.get(l.disposition_id) === 'WRITE_OFF' ? 'WRITE_OFF' : 'RETURN',
      from_project_id: projectId,
      qty: l.qty,
      disposition_id: l.disposition_id,
      reconciliation_group: group,
      moved_by: profile?.id ?? null,
    }));

    try {
      // ONE batched insert — the hand-over lands atomically or not at all.
      await recordEquipmentMovements(inputs);
      toast('Hitung & tutup dicatat', 'ok');
      setReconKey(null);
      setReconLines([]);
      await load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderMoveForm = (row: EquipmentBalanceRow) => {
    const parsedQty = parseQty(qtyText);
    const avail = Number.isFinite(parsedQty) && parsedQty > 0
      ? evaluateEquipmentAvailability(row, parsedQty)
      : null;
    return (
      <View style={styles.inlineForm}>
        <Text style={styles.label}>Jenis pergerakan</Text>
        <View style={styles.pickerWrap}>
          <Picker selectedValue={eventType} onValueChange={handleEventTypeChange}>
            {canOpening && <Picker.Item label={EVENT_LABELS.OPENING} value="OPENING" />}
            <Picker.Item label={EVENT_LABELS.DEPLOY} value="DEPLOY" />
            <Picker.Item label={EVENT_LABELS.TRANSFER} value="TRANSFER" />
            <Picker.Item label={EVENT_LABELS.RETURN} value="RETURN" />
            <Picker.Item label={EVENT_LABELS.WRITE_OFF} value="WRITE_OFF" />
            <Picker.Item label={EVENT_LABELS.REPAIRED} value="REPAIRED" />
          </Picker>
        </View>

        {(eventType === 'TRANSFER' || eventType === 'RETURN') && (
          <>
            <Text style={styles.label}>Proyek asal</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={fromProjectId} onValueChange={setFromProjectId}>
                <Picker.Item label="Pilih proyek..." value="" />
                {projects.map(p => <Picker.Item key={p.id} label={p.name} value={p.id} />)}
              </Picker>
            </View>
          </>
        )}

        {eventType === 'WRITE_OFF' && (
          <>
            <Text style={styles.label}>Lokasi asal</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={fromProjectId} onValueChange={setFromProjectId}>
                <Picker.Item label="Pilih lokasi..." value="" />
                <Picker.Item label="Gudang" value={YARD} />
                {projects.map(p => <Picker.Item key={p.id} label={p.name} value={p.id} />)}
              </Picker>
            </View>
            {fromProjectId === YARD && (
              <>
                <Text style={styles.label}>Dari bucket gudang</Text>
                <View style={styles.pickerWrap}>
                  <Picker selectedValue={yardBucket} onValueChange={setYardBucket}>
                    <Picker.Item label="Siap (READY)" value="READY" />
                    <Picker.Item label="Perbaikan (REPAIR)" value="REPAIR" />
                  </Picker>
                </View>
              </>
            )}
          </>
        )}

        {(eventType === 'DEPLOY' || eventType === 'TRANSFER') && (
          <>
            <Text style={styles.label}>Proyek tujuan</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={toProjectId} onValueChange={setToProjectId}>
                <Picker.Item label="Pilih proyek..." value="" />
                {projects.map(p => <Picker.Item key={p.id} label={p.name} value={p.id} />)}
              </Picker>
            </View>
          </>
        )}

        {(eventType === 'RETURN' || eventType === 'WRITE_OFF') && (
          <>
            <Text style={styles.label}>Disposisi</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={dispositionId} onValueChange={setDispositionId}>
                <Picker.Item label="Pilih disposisi..." value="" />
                {(eventType === 'RETURN' ? returnDispositions : writeOffDispositions).map(d => (
                  <Picker.Item key={d.id} label={d.name} value={d.id} />
                ))}
              </Picker>
            </View>
          </>
        )}

        <Text style={styles.label}>Jumlah ({row.unit})</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={qtyText}
          onChangeText={setQtyText}
          placeholder="0"
          placeholderTextColor={COLORS.textSec}
        />
        {eventType === 'DEPLOY' && (
          avail === null ? (
            <Text style={styles.fieldHint}>Siap di gudang: {fmt(row.yard_ready)} {row.unit}</Text>
          ) : avail.flag === 'OK' ? (
            <Text style={[styles.availNote, { color: COLORS.ok }]}>
              Tersedia — siap di gudang {fmt(avail.available)} {row.unit}
            </Text>
          ) : (
            <Text style={[styles.availNote, { color: COLORS.critical }]}>
              Kurang {fmt(avail.shortfall)} {row.unit} — siap di gudang hanya {fmt(avail.available)}
            </Text>
          )
        )}

        <Text style={styles.label}>Catatan</Text>
        <TextInput
          style={styles.input}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Opsional"
          placeholderTextColor={COLORS.textSec}
        />

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setMoveFormId(null)}>
            <Text style={styles.cancelText}>Batal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={() => handleSubmitMovement(row)}>
            <Text style={styles.saveBtnText}>Simpan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderReconForm = (row: EquipmentBalanceRow, projectId: string, expected: number) => {
    const total = reconLines.reduce((s, l) => {
      const q = parseQty(l.qty);
      return s + (Number.isFinite(q) ? q : 0);
    }, 0);
    const totalOk = Math.abs(total - expected) <= 1e-9;
    return (
      <View style={styles.inlineForm}>
        <Text style={styles.reconExpected}>
          Tercatat terpasang: {fmt(expected)} {row.unit} — semua unit wajib dipertanggungjawabkan
        </Text>
        {reconLines.map((line, idx) => (
          <View key={idx} style={styles.reconLine}>
            <TextInput
              style={[styles.input, styles.reconQtyInput]}
              keyboardType="numeric"
              value={line.qty}
              onChangeText={t => updateReconLine(idx, { qty: t })}
              placeholder="Qty"
              placeholderTextColor={COLORS.textSec}
            />
            <View style={[styles.pickerWrap, styles.reconPicker]}>
              <Picker selectedValue={line.disposition_id} onValueChange={v => updateReconLine(idx, { disposition_id: v })}>
                <Picker.Item label="Pilih disposisi..." value="" />
                {dispositions.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
              </Picker>
            </View>
            {reconLines.length > 1 && (
              <TouchableOpacity style={styles.reconRemoveBtn} onPress={() => removeReconLine(idx)}>
                <Ionicons name="trash-outline" size={16} color={COLORS.critical} />
              </TouchableOpacity>
            )}
          </View>
        ))}
        <TouchableOpacity style={styles.reconAddBtn} onPress={addReconLine}>
          <Ionicons name="add-circle-outline" size={16} color={COLORS.info} />
          <Text style={[styles.hint, { color: COLORS.info }]}>Tambah baris</Text>
        </TouchableOpacity>
        <Text style={[styles.reconTotal, { color: totalOk ? COLORS.ok : COLORS.critical }]}>
          Total {fmt(total)} / harus {fmt(expected)}
        </Text>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setReconKey(null)}>
            <Text style={styles.cancelText}>Batal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={() => handleSubmitRecon(row, projectId, expected)}>
            <Text style={styles.saveBtnText}>Tutup & Catat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentMaxWidth != null && { alignSelf: 'center', width: '100%', maxWidth: contentMaxWidth }]}>
        <Text style={styles.sectionHead}>Alat — Saldo Peralatan</Text>
        <Text style={styles.introHint}>
          Alat milik perusahaan (scaffolding & suku cadang) beredar antar proyek dari satu gudang pusat — dihitung per jenis, bukan dibeli per proyek.
        </Text>

        {balances.map(row => {
          const deployedEntries = Object.entries(row.deployed);
          const writtenOffEntries = Object.entries(row.written_off);
          const isMoveOpen = moveFormId === row.material_id;
          const isSeeded = row.owned !== 0 || row.yard_ready !== 0 || row.yard_repair !== 0
            || deployedEntries.length > 0 || writtenOffEntries.length > 0;
          return (
            <Card key={row.material_id}>
              <Text style={styles.partName}>{row.material_name}</Text>
              <Text style={styles.hint}>Satuan: {row.unit}</Text>

              <View style={styles.statsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statValue}>{fmt(row.owned)}</Text>
                  <Text style={styles.statLabel}>Dimiliki</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={[styles.statValue, { color: COLORS.ok }]}>{fmt(row.yard_ready)}</Text>
                  <Text style={styles.statLabel}>Siap di gudang</Text>
                </View>
                <View style={styles.statCol}>
                  <Text style={[styles.statValue, { color: COLORS.warning }]}>{fmt(row.yard_repair)}</Text>
                  <Text style={styles.statLabel}>Perbaikan</Text>
                </View>
              </View>

              {!isSeeded && (
                <Text style={styles.fieldHint}>
                  Belum ada stok tercatat — catat pergerakan Stok awal (OPENING) untuk memulai.
                </Text>
              )}

              {deployedEntries.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.subHead}>Terpasang di proyek</Text>
                  {deployedEntries.map(([pid, qty]) => {
                    const rKey = `${row.material_id}|${pid}`;
                    const isReconOpen = reconKey === rKey;
                    return (
                      <View key={pid} style={styles.deployedLine}>
                        <View style={styles.deployedRow}>
                          <Text style={styles.deployedName}>{projectName(pid)}</Text>
                          <Text style={styles.deployedQty}>{fmt(qty)} {row.unit}</Text>
                          {canWrite && (
                            <TouchableOpacity style={styles.reconToggleBtn} onPress={() => toggleRecon(row.material_id, pid, qty)}>
                              <Ionicons name={isReconOpen ? 'chevron-up' : 'calculator-outline'} size={14} color={COLORS.info} />
                              <Text style={[styles.hint, { color: COLORS.info, marginTop: 0 }]}>
                                {isReconOpen ? 'Tutup' : 'Hitung & tutup'}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        {isReconOpen && renderReconForm(row, pid, qty)}
                      </View>
                    );
                  })}
                </View>
              )}

              {writtenOffEntries.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.subHead}>Dihapus dari pool</Text>
                  {writtenOffEntries.map(([name, qty]) => (
                    <Text key={name} style={styles.writtenOffLine}>
                      {name}: {fmt(qty)} {row.unit}
                    </Text>
                  ))}
                </View>
              )}

              {canWrite && (
                <TouchableOpacity style={styles.moveBtn} onPress={() => toggleMoveForm(row.material_id)}>
                  <Ionicons name={isMoveOpen ? 'chevron-up' : 'swap-horizontal-outline'} size={14} color={COLORS.info} />
                  <Text style={[styles.hint, { color: COLORS.info, marginTop: 0 }]}>
                    {isMoveOpen ? 'Tutup' : 'Catat pergerakan'}
                  </Text>
                </TouchableOpacity>
              )}

              {isMoveOpen && renderMoveForm(row)}
            </Card>
          );
        })}

        {!loading && balances.length === 0 && (
          <Card><Text style={styles.empty}>Belum ada alat terdaftar di katalog.</Text></Card>
        )}
      </ScrollView>
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
  introHint: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    marginBottom: SPACE.md,
    lineHeight: 17,
  },
  partName: { fontSize: TYPE.base, fontFamily: FONTS.bold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  fieldHint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.sm },
  availNote: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, marginTop: SPACE.sm },
  statsRow: {
    flexDirection: 'row',
    marginTop: SPACE.md,
    paddingVertical: SPACE.sm + 2,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSub,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSub,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: TYPE.lg, fontFamily: FONTS.bold, color: COLORS.text },
  statLabel: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  section: { marginTop: SPACE.md - 2 },
  subHead: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: COLORS.textSec,
    marginBottom: SPACE.xs,
  },
  deployedLine: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSub,
    paddingVertical: SPACE.sm - 2,
  },
  deployedRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  deployedName: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
  deployedQty: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  reconToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.xs },
  writtenOffLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  moveBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.md - 2 },
  inlineForm: { marginTop: SPACE.sm + 2, paddingTop: SPACE.sm + 2, borderTopWidth: 1, borderTopColor: COLORS.border },
  label: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.medium,
    color: COLORS.text,
    marginBottom: 6,
    marginTop: SPACE.sm + 2,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  formActions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base - 2 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: SPACE.md,
    alignItems: 'center',
  },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnText: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.textInverse,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  reconExpected: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.sm },
  reconLine: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.sm },
  reconQtyInput: { width: 88 },
  reconPicker: { flex: 1 },
  reconRemoveBtn: { padding: SPACE.sm },
  reconAddBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xs },
  reconTotal: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, marginTop: SPACE.sm + 2 },
  empty: {
    fontSize: TYPE.base,
    fontFamily: FONTS.regular,
    color: COLORS.textSec,
    textAlign: 'center',
    paddingVertical: SPACE.md,
  },
});
