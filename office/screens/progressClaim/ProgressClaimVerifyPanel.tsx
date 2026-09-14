// office/screens/progressClaim/ProgressClaimVerifyPanel.tsx
// SANO — Verifikasi Klaim Progres (spec §6.2 steps 4-5). The estimator sees
// every claimed row with its weights, the verified and claimed figure per
// stage, the supervisor's note and photos, and sets the verified figures.
// Verifikasi writes progress through verify_progress_claim; Kembalikan sends
// the claim back with a note. The principal reads the same view, and whoever
// submitted a claim never verifies it (the RPC refuses it as well).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Card from '../../../workflows/components/Card';
import Badge from '../../../workflows/components/Badge';
import StoragePhoto from '../../../workflows/components/StoragePhoto';
import { canVerifyClaim, canVerifyClaimAs } from '../../../tools/progressClaims/claimRules';
import {
  getLatestClaim, getOpenClaim, listClaimLines, listStageWeights, listVerifiedStagePct, returnClaim, verifyClaim,
  type ProgressClaim, type ProgressClaimLine, type VerifyLineInput,
} from '../../../tools/progressClaims/claims';
import {
  claimStatusSummary, formatFraction, formatPercent, formatQty, pctInputs, readPctInputs, regressedStages, stageKeyLabel,
  weightSourceLabel, zeroPct, type ClaimableItem,
} from '../../../tools/progressClaims/claimView';
import { claimDelta, rowFraction, type StagePct } from '../../../tools/progressClaims/stageMath';
import { stagesOf, validateStageWeights, type StageWeights, type WeightSource } from '../../../tools/progressClaims/stageWeights';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

const lh = (size: number) => Math.round(size * 1.45);

interface Props {
  projectId: string;
  profile: { id: string; role: string } | null;
  boqItems: ClaimableItem[];
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
  /** After a verification wrote progress, so the screen can reload boq_items. */
  onVerified?: () => void;
  /** After a verification or a return, so badge counts can refresh. */
  onChanged?: () => void;
}

interface RowWeights {
  weights: StageWeights;
  source: WeightSource;
  referenceClass: string | null;
}

interface Loaded {
  claim: ProgressClaim | null;
  lines: ProgressClaimLine[];
  weights: Map<string, RowWeights>;
  verified: Map<string, StagePct>;
}

interface LineInput {
  inputs: Record<string, string>;
  reason: string;
}

const EMPTY_INPUT: LineInput = { inputs: {}, reason: '' };

export default function ProgressClaimVerifyPanel({ projectId, profile, boqItems, toast, onVerified, onChanged }: Props) {
  const items = useMemo(() => new Map(boqItems.map((b) => [b.id, b])), [boqItems]);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineInputs, setLineInputs] = useState<Record<string, LineInput>>({});
  const [verifierNote, setVerifierNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const claim = (await getOpenClaim(projectId)) ?? (await getLatestClaim(projectId));
      if (!claim || claim.status !== 'SUBMITTED') {
        if (mine === seq.current) {
          setData({ claim, lines: [], weights: new Map(), verified: new Map() });
          setLineInputs({});
        }
        return;
      }
      const [lines, weightRows, verified] = await Promise.all([
        listClaimLines(claim.id),
        listStageWeights(projectId),
        listVerifiedStagePct(projectId),
      ]);
      const weights = new Map<string, RowWeights>();
      for (const w of weightRows) {
        const checked = validateStageWeights(w.weights);
        if (checked.ok) weights.set(w.boq_item_id, { weights: checked.weights, source: w.source, referenceClass: w.reference_class });
      }
      if (mine !== seq.current) return;
      setData({ claim, lines, weights, verified });
      setLineInputs(Object.fromEntries(lines.map((l) => {
        const w = weights.get(l.boq_item_id)?.weights;
        return [l.id, { inputs: w ? pctInputs(w, l.claimed_pct) : {}, reason: l.regress_reason ?? '' }];
      })));
      setVerifierNote('');
      setReturning(false);
      setReturnNote('');
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? 'Klaim progres gagal dimuat.');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  const claim = data?.claim ?? null;
  const submitted = claim?.status === 'SUBMITTED';
  const actionable = submitted && canVerifyClaimAs(profile?.role, profile?.id, claim?.submitted_by);
  const ownClaim = submitted && canVerifyClaim(profile?.role) && !actionable;

  const prevOf = (line: ProgressClaimLine, weights: StageWeights): StagePct =>
    data?.verified.get(line.boq_item_id) ?? line.prev_verified ?? zeroPct(weights);

  const setInput = (lineId: string, stage: string, value: string) =>
    setLineInputs((prev) => {
      const current = prev[lineId] ?? EMPTY_INPUT;
      return { ...prev, [lineId]: { ...current, inputs: { ...current.inputs, [stage]: value } } };
    });

  const setReason = (lineId: string, reason: string) =>
    setLineInputs((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? EMPTY_INPUT), reason } }));

  const verify = async () => {
    if (!data?.claim) return;
    const payload: VerifyLineInput[] = [];
    for (const line of data.lines) {
      const code = items.get(line.boq_item_id)?.code ?? line.boq_item_id;
      const rowWeights = data.weights.get(line.boq_item_id);
      if (!rowWeights) {
        toast(`${code}: bobot tahapan belum diatur.`, 'critical');
        return;
      }
      const state = lineInputs[line.id] ?? EMPTY_INPUT;
      const read = readPctInputs(rowWeights.weights, state.inputs);
      if (!read.ok) {
        toast(`${code}: ${read.reason}`, 'critical');
        return;
      }
      const regressed = regressedStages(rowWeights.weights, prevOf(line, rowWeights.weights), read.pct).length > 0;
      const reason = state.reason.trim();
      if (regressed && !reason) {
        toast(`${code}: penurunan progres wajib disertai alasan.`, 'critical');
        return;
      }
      payload.push({ line_id: line.id, verified_pct: read.pct, regress_reason: regressed ? reason : null });
    }
    setBusy(true);
    try {
      const result = await verifyClaim(data.claim.id, payload, verifierNote.trim() || null);
      toast(`Klaim diverifikasi. ${result.entries} entri progres dicatat.`, 'ok');
      onVerified?.();
      onChanged?.();
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Verifikasi gagal.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  const sendReturn = async () => {
    if (!data?.claim) return;
    const note = returnNote.trim();
    if (!note) {
      toast('Tulis alasan pengembalian klaim.', 'critical');
      return;
    }
    setBusy(true);
    try {
      await returnClaim(data.claim.id, note);
      toast('Klaim dikembalikan ke pengawas.', 'ok');
      onChanged?.();
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Pengembalian gagal.', 'critical');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Card title="Verifikasi Klaim Progres">
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Muat ulang klaim">
          <Text style={styles.ghostBtnText}>Coba lagi</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (!data) return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;

  const summary = claimStatusSummary(claim);

  if (!submitted) {
    return (
      <Card title="Verifikasi Klaim Progres" rightAction={claim ? <Badge flag={summary.flag} label={summary.label} /> : undefined}>
        <Text style={styles.detail}>Tidak ada klaim yang menunggu verifikasi.</Text>
        {claim && <Text style={styles.hint}>{`Klaim terakhir: ${summary.detail}`}</Text>}
      </Card>
    );
  }

  return (
    <View>
      <Card title="Verifikasi Klaim Progres" rightAction={<Badge flag={summary.flag} label={summary.label} />}>
        <Text style={styles.detail}>{summary.detail}</Text>
        <Text style={styles.hint}>
          {`${data.lines.length} baris diklaim. Angka verifikasi terisi dari klaim pengawas; ubah bila foto atau laporan tidak mendukung.`}
        </Text>
        {ownClaim && (
          <Text style={styles.banner}>Klaim ini Anda kirim sendiri. Verifikasi harus dilakukan estimator atau admin lain.</Text>
        )}
      </Card>

      {data.lines.map((line) => {
        const item = items.get(line.boq_item_id);
        const code = item?.code ?? '—';
        const rowWeights = data.weights.get(line.boq_item_id);
        if (!rowWeights) {
          return (
            <Card key={line.id} title={code} subtitle={item?.label}>
              <Text style={styles.error}>Bobot tahapan baris ini belum diatur. Kembalikan klaim atau atur bobot di Baseline.</Text>
            </Card>
          );
        }
        const state = lineInputs[line.id] ?? EMPTY_INPUT;
        const prev = prevOf(line, rowWeights.weights);
        const read = readPctInputs(rowWeights.weights, state.inputs);
        const prevFraction = rowFraction(rowWeights.weights, prev);
        const next = read.ok ? rowFraction(rowWeights.weights, read.pct) : null;
        const delta = next != null ? claimDelta(item?.planned ?? 0, prevFraction, next).deltaQuantity : null;
        const regressed = read.ok ? regressedStages(rowWeights.weights, prev, read.pct) : [];
        const refs = (line.evidence?.photo_refs ?? []).filter((r): r is string => typeof r === 'string');
        return (
          <Card
            key={line.id}
            title={code}
            subtitle={item?.label}
            rightAction={rowWeights.source === 'reference' ? <Badge flag="WARNING" label="Bobot referensi" /> : undefined}
          >
            <Text style={styles.hint}>{weightSourceLabel(rowWeights.source, rowWeights.referenceClass)}</Text>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[styles.cellStage, styles.headText]}>Tahap</Text>
              <Text style={[styles.cell, styles.headText]}>Terverifikasi</Text>
              <Text style={[styles.cell, styles.headText]}>Klaim</Text>
              <Text style={[styles.cellInput, styles.headText]}>Verifikasi</Text>
            </View>
            {stagesOf(rowWeights.weights).map((stage) => (
              <View key={stage} style={styles.tableRow}>
                <Text style={styles.cellStage}>{stageKeyLabel(stage)}</Text>
                <Text style={styles.cell}>{formatPercent(prev[stage] ?? 0)}</Text>
                <Text style={styles.cell}>{formatPercent(line.claimed_pct[stage] ?? 0)}</Text>
                <TextInput
                  style={[styles.cellInput, styles.input, !actionable && styles.inputDisabled]}
                  value={state.inputs[stage] ?? ''}
                  onChangeText={(v) => setInput(line.id, stage, v)}
                  editable={actionable}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Verifikasi ${stageKeyLabel(stage)} ${code}`}
                />
              </View>
            ))}
            {read.ok && next != null && delta != null ? (
              <Text style={styles.preview}>
                {`Progres baris ${formatFraction(prevFraction)} menjadi ${formatFraction(next)} (perkiraan ${delta > 0 ? '+' : ''}${formatQty(delta, item?.unit ?? '')})`}
              </Text>
            ) : (
              <Text style={styles.error}>{read.ok ? '' : read.reason}</Text>
            )}
            {regressed.length > 0 && (
              <TextInput
                style={[styles.input, styles.textarea]}
                value={state.reason}
                onChangeText={(v) => setReason(line.id, v)}
                editable={actionable}
                multiline
                placeholder="Alasan progres turun"
                placeholderTextColor={COLORS.textMuted}
                accessibilityLabel={`Alasan penurunan ${code}`}
              />
            )}
            {line.note ? <Text style={styles.note}>{`Catatan pengawas: ${line.note}`}</Text> : null}
            {refs.length > 0 ? (
              <View style={styles.photos}>
                {refs.map((ref, i) => (
                  <StoragePhoto
                    key={`${i}-${ref}`}
                    path={ref}
                    style={styles.photo}
                    loadingLabel={`Memuat foto ${i + 1}`}
                    testID={`claim-photo-${line.id}-${i}`}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>Tidak ada foto.</Text>
            )}
          </Card>
        );
      })}

      {actionable && (
        <Card title="Keputusan">
          {!returning ? (
            <>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={verifierNote}
                onChangeText={setVerifierNote}
                multiline
                placeholder="Catatan verifikasi (opsional)"
                placeholderTextColor={COLORS.textMuted}
                accessibilityLabel="Catatan verifikasi"
              />
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnBusy]}
                  onPress={() => void verify()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Verifikasi klaim"
                  accessibilityState={{ disabled: busy, busy }}
                >
                  <Text style={styles.primaryBtnText}>{busy ? 'Memproses...' : 'Verifikasi'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setReturning(true)} disabled={busy} accessibilityRole="button" accessibilityLabel="Kembalikan klaim">
                  <Text style={styles.ghostBtnText}>Kembalikan</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={returnNote}
                onChangeText={setReturnNote}
                multiline
                placeholder="Apa yang perlu diperbaiki pengawas?"
                placeholderTextColor={COLORS.textMuted}
                accessibilityLabel="Alasan pengembalian"
              />
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && styles.btnBusy]}
                  onPress={() => void sendReturn()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Kirim pengembalian"
                >
                  <Text style={styles.primaryBtnText}>Kirim pengembalian</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setReturning(false)} disabled={busy} accessibilityRole="button" accessibilityLabel="Batal kembalikan">
                  <Text style={styles.ghostBtnText}>Batal</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: SPACE.lg },
  detail: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  note: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.xs },
  banner: {
    fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm,
    padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.warningBg,
  },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.xs },
  tableHead: { borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, marginTop: SPACE.sm },
  headText: { fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  cellStage: { flex: 1.2, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text },
  cell: { flex: 1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, textAlign: 'right' },
  cellInput: { flex: 1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), textAlign: 'right' },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, fontSize: TYPE.sm, lineHeight: lh(TYPE.sm),
    fontFamily: FONTS.regular, color: COLORS.text,
  },
  inputDisabled: { backgroundColor: COLORS.surfaceAlt, color: COLORS.textSec },
  textarea: { minHeight: 64, textAlignVertical: 'top', textAlign: 'left', marginTop: SPACE.sm },
  preview: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.accentDark, marginTop: SPACE.sm },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  photo: { width: 96, height: 96, borderRadius: RADIUS, backgroundColor: COLORS.surfaceSunken },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
  primaryBtn: {
    flexGrow: 1, minHeight: 44, paddingHorizontal: SPACE.base, borderRadius: RADIUS, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnBusy: { opacity: 0.6 },
  primaryBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase' },
  ghostBtn: {
    minHeight: 44, marginTop: SPACE.xs, paddingHorizontal: SPACE.base, borderRadius: RADIUS, borderWidth: 1,
    borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.medium, color: COLORS.textSec, textTransform: 'uppercase' },
});
