// workflows/screens/progressClaim/StageWeightsPanel.tsx
// SANO — Bobot Tahapan (spec §7.4, §17): the share of each work-area row's
// value carried by bekisting, pembesian and pengecoran, which turns stage
// percents into installed quantity when a claim is verified. Estimators and
// admins edit it in Baseline; other roles read it. Every write is an RPC
// (migration 103) that re-checks the role and the shape.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Card from '../../components/Card';
import { canEditStageWeights } from '../../../tools/progressClaims/claimRules';
import {
  listStageWeights, resetStageWeights, seedReferenceWeights, setStageWeights, type StageWeightRow,
} from '../../../tools/progressClaims/claims';
import {
  SPLIT_STAGES, WORK_AREA_CLASS_LABELS, classifyRows, claimableRows, formatPercent, missingWeightSeeds,
  readWeightPercentInputs, stageKeyLabel, weightPercentInputs, weightSourceLabel,
  type ClaimableItem, type SplitStage,
} from '../../../tools/progressClaims/claimView';
import { REFERENCE_PROFILE } from '../../../tools/progressClaims/referenceStageWeights.data';
import { isSingle, referenceWeightsFor, validateStageWeights, type StageWeights } from '../../../tools/progressClaims/stageWeights';
import type { WorkAreaClass } from '../../../tools/progressClaims/workAreaClass';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);
const BLANK: Record<SplitStage, string> = { BEKISTING: '', PEMBESIAN: '', PENGECORAN: '' };

interface Props {
  projectId: string;
  role: string | null | undefined;
  boqItems: ClaimableItem[];
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

export function weightsSummary(weights: StageWeights | null): string {
  if (!weights) return 'Belum diatur';
  if (isSingle(weights)) return 'Satu tahap (100%)';
  return SPLIT_STAGES.map((s) => `${stageKeyLabel(s)} ${formatPercent(weights[s] * 100)}`).join(' · ');
}

export default function StageWeightsPanel({ projectId, role, boqItems, toast }: Props) {
  const rows = useMemo(() => claimableRows(boqItems, projectId), [boqItems, projectId]);
  const classes = useMemo(() => classifyRows(rows), [rows]);
  const canEdit = canEditStageWeights(role);
  const [stored, setStored] = useState<StageWeightRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default: a large RAB would otherwise push Baseline's import sessions far down.
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'split' | 'single'>('split');
  const [inputs, setInputs] = useState<Record<SplitStage, string>>(BLANK);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const next = await listStageWeights(projectId);
      if (mine === seq.current) setStored(next);
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? 'Bobot tahapan gagal dimuat.');
    }
  }, [projectId]);

  useEffect(() => {
    setStored(null);
    setEditingId(null);
  }, [projectId]);

  useEffect(() => {
    if (rows.length === 0) return undefined;
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load, rows.length]);

  const byRow = useMemo(() => {
    const map = new Map<string, { weights: StageWeights; row: StageWeightRow }>();
    for (const w of stored ?? []) {
      const checked = validateStageWeights(w.weights);
      if (checked.ok) map.set(w.boq_item_id, { weights: checked.weights, row: w });
    }
    return map;
  }, [stored]);
  const missing = useMemo(() => (stored ? missingWeightSeeds(rows, stored) : []), [rows, stored]);
  const referenceCount = useMemo(() => rows.filter((r) => byRow.get(r.id)?.row.source === 'reference').length, [rows, byRow]);

  const classOf = (id: string): WorkAreaClass => classes.get(id) ?? 'LAINNYA';

  const openEditor = (id: string) => {
    if (!canEdit || busy) return;
    if (editingId === id) {
      setEditingId(null);
      return;
    }
    const current = byRow.get(id)?.weights ?? referenceWeightsFor(classOf(id), REFERENCE_PROFILE);
    setMode(isSingle(current) ? 'single' : 'split');
    setInputs(weightPercentInputs(current));
    setEditingId(id);
  };

  const switchMode = (next: 'split' | 'single', id: string) => {
    setMode(next);
    if (next === 'split' && SPLIT_STAGES.every((s) => !inputs[s])) {
      setInputs(weightPercentInputs(REFERENCE_PROFILE[classOf(id)]?.weights ?? null));
    }
  };

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await task();
      toast(done, 'ok');
      setEditingId(null);
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Bobot gagal disimpan.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const save = (item: ClaimableItem) => {
    let weights: StageWeights;
    if (mode === 'single') {
      weights = { SINGLE: 1 };
    } else {
      const read = readWeightPercentInputs(inputs);
      if (!read.ok) {
        toast(read.reason, 'critical');
        return;
      }
      weights = read.weights;
    }
    void run(() => setStageWeights(item.id, weights), `Bobot ${item.code} disimpan.`);
  };

  const reset = (item: ClaimableItem) =>
    void run(() => resetStageWeights(item.id, classOf(item.id)), `Bobot ${item.code} dikembalikan ke referensi.`);

  const applyMissing = () =>
    void run(() => seedReferenceWeights(projectId, missing), `${missing.length} baris memakai bobot referensi.`);

  if (rows.length === 0) return null;

  return (
    <Card title="Bobot Tahapan Progres" borderColor={COLORS.accent}>
      <Text style={styles.hint}>
        Bobot menentukan bagian volume baris yang dihitung terpasang per tahap saat klaim progres diverifikasi. Nilai referensi diturunkan dari lima RAB; ubah bila RAB proyek ini berbeda.
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {!stored && !error && <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat bobot tahapan" />}
      {stored && <Text style={styles.summary}>{`${rows.length} baris · ${missing.length} belum diatur · ${referenceCount} referensi`}</Text>}
      {stored && canEdit && missing.length > 0 && (
        <TouchableOpacity
          style={[styles.primaryBtn, busy && styles.btnBusy]}
          onPress={applyMissing}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Terapkan bobot referensi ke ${missing.length} baris`}
        >
          <Text style={styles.primaryBtnText}>{`Terapkan bobot referensi ke ${missing.length} baris`}</Text>
        </TouchableOpacity>
      )}
      {stored && (
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Sembunyikan baris' : 'Tampilkan baris'}
        >
          <Text style={styles.ghostBtnText}>{expanded ? 'Sembunyikan baris' : 'Tampilkan baris'}</Text>
        </TouchableOpacity>
      )}
      {stored && expanded && rows.map((item) => {
        const entry = byRow.get(item.id);
        const cls = classOf(item.id);
        const open = editingId === item.id;
        return (
          <View key={item.id}>
            <TouchableOpacity
              style={[styles.row, open && styles.rowActive]}
              onPress={() => openEditor(item.id)}
              disabled={!canEdit || busy}
              accessibilityRole={canEdit ? 'button' : undefined}
              accessibilityLabel={`${item.code} ${item.label}`}
            >
              <Text style={styles.rowCode}>{item.code}</Text>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={[styles.rowSub, !entry && styles.rowWarn]}>{weightsSummary(entry?.weights ?? null)}</Text>
              {entry && <Text style={styles.rowSub}>{weightSourceLabel(entry.row.source, entry.row.reference_class)}</Text>}
            </TouchableOpacity>
            {open && (
              <View style={styles.editor}>
                <View style={styles.modeRow}>
                  {(['split', 'single'] as const).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.modeChip, mode === m && styles.modeChipActive]}
                      onPress={() => switchMode(m, item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={m === 'split' ? 'Tiga tahap' : 'Satu tahap'}
                      accessibilityState={{ selected: mode === m }}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    >
                      <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'split' ? 'Tiga tahap' : 'Satu tahap'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {mode === 'split' ? (
                  SPLIT_STAGES.map((s) => (
                    <View key={s} style={styles.inputRow}>
                      <Text style={styles.inputLabel}>{stageKeyLabel(s)}</Text>
                      <TextInput
                        style={styles.input}
                        value={inputs[s]}
                        onChangeText={(v) => setInputs((prev) => ({ ...prev, [s]: v }))}
                        keyboardType="decimal-pad"
                        accessibilityLabel={`Bobot ${stageKeyLabel(s)}`}
                      />
                      <Text style={styles.pct}>%</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.hint}>Baris ini diklaim dengan satu persentase progres, tanpa pembagian tahap.</Text>
                )}
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={[styles.primaryBtn, busy && styles.btnBusy]}
                    onPress={() => save(item)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Simpan bobot"
                  >
                    <Text style={styles.primaryBtnText}>Simpan bobot</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.ghostBtn}
                    onPress={() => reset(item)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Kembalikan ke referensi ${WORK_AREA_CLASS_LABELS[cls]}`}
                  >
                    <Text style={styles.ghostBtnText}>{`Referensi ${WORK_AREA_CLASS_LABELS[cls]}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ghostBtn} onPress={() => setEditingId(null)} accessibilityRole="button" accessibilityLabel="Tutup editor bobot">
                    <Text style={styles.ghostBtnText}>Tutup</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: SPACE.sm },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  summary: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.xs },
  row: { paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xs, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  rowActive: { backgroundColor: COLORS.accentBg, borderRadius: RADIUS },
  rowCode: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  rowLabel: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  rowSub: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  rowWarn: { color: COLORS.warning, fontFamily: FONTS.semibold },
  editor: { padding: SPACE.md, marginBottom: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.surfaceSunken, borderWidth: 1, borderColor: COLORS.borderSub },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm },
  modeChip: {
    minHeight: 36, paddingHorizontal: SPACE.md, borderRadius: RADIUS, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
  },
  modeChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.accentBg },
  modeText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.textSec },
  modeTextActive: { color: COLORS.primary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.xs },
  inputLabel: { flex: 1, fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  input: {
    minWidth: 84, minHeight: 44, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, fontSize: TYPE.sm, lineHeight: lh(TYPE.sm),
    fontFamily: FONTS.regular, color: COLORS.text, textAlign: 'right',
  },
  pct: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textSec },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, marginTop: SPACE.sm, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
});
