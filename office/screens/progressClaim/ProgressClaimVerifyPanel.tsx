// office/screens/progressClaim/ProgressClaimVerifyPanel.tsx
// SANO — Verifikasi Klaim Progres (spec §6.2 steps 4-5, §18). The estimator sees
// every claimed row with its weights, the verified and claimed figure per
// stage, the supervisor's note and photos, and sets the verified figures.
// Verifikasi writes progress through verify_progress_claim; Kembalikan sends
// the claim back with a note. The principal reads the same view. Whoever
// submitted the claim or filled one of its lines never verifies it (the RPC
// refuses that as well). The preview reads the claim's BoQ rows fresh, because
// verification computes from the live planned volume.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Card from '../../../workflows/components/Card';
import Badge from '../../../workflows/components/Badge';
import StoragePhoto from '../../../workflows/components/StoragePhoto';
import { CLAIM_FLAG_LABELS, claimFlags } from '../../../tools/progressClaims/claimFlags';
import { canVerifyClaim, canVerifyClaimAs, claimChangedSince, regressReasonRowCode } from '../../../tools/progressClaims/claimRules';
import {
  getLatestClaim, getOpenClaim, listClaimLines, listClaimRows, listDiaryLines, listEntryTotals, listStageWeights, listVerifiedAtByRow, listVerifiedStagePct,
  returnClaim, verifyClaim,
  type ProgressClaim, type ProgressClaimLine, type VerifyLineInput,
} from '../../../tools/progressClaims/claims';
import {
  claimStatusSummary, formatFraction, formatPercent, formatQty, inactiveRowReason, pctInputs, pctMatchesWeights, readPctInputs,
  regressedStages, stageKeyLabel, weightSourceLabel, zeroPct, type ClaimableItem, type PctRead,
} from '../../../tools/progressClaims/claimView';
import { diarySummary, linesByRowSince, proposeFromDiary, type DiaryLine } from '../../../tools/progressClaims/diaryEvidence';
import { activityStateLabel, stageLabel } from '../../../tools/progressClaims/stages';
import { deltaFromInstalled, rowFraction, type StagePct } from '../../../tools/progressClaims/stageMath';
import { shortDateId } from '../../../tools/progressClaims/week';
import {
  stagesOf, validateStageWeights, type StageKey, type StageWeights, type WeightSource,
} from '../../../tools/progressClaims/stageWeights';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

const lh = (size: number) => Math.round(size * 1.45);
const QUANTITY_DROP = 'Volume terpasang turun karena bobot atau volume rencana berubah sejak verifikasi terakhir.';
const MAX_DIARY_LINES = 6;
const RECORDED_DROP = 'Progres baris ini turun dari yang tercatat. Isi alasan sebelum verifikasi.';

interface Props {
  projectId: string;
  profile: { id: string; role: string } | null;
  boqItems: ClaimableItem[];
  /** Bump to reload, e.g. when a notification brings the user back to a panel already on screen. */
  reloadKey?: number;
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
  projectId: string;
  claim: ProgressClaim | null;
  lines: ProgressClaimLine[];
  /** The claim's BoQ rows read fresh, by id. */
  rows: Map<string, ClaimableItem>;
  weights: Map<string, RowWeights>;
  verified: Map<string, StagePct>;
  ledger: Map<string, number>;
  /** Confirmed daily-report lines per work area since it was last verified. */
  diary: Map<string, DiaryLine[]>;
}

interface LineInput {
  inputs: Record<string, string>;
  reason: string;
}

/** One line's figures as the form currently holds them. */
interface LineCheck {
  code: string;
  item: ClaimableItem | undefined;
  rowWeights: RowWeights | null;
  prev: StagePct;
  read: PctRead | null;
  prevFraction: number;
  next: number | null;
  delta: number | null;
  regressed: StageKey[];
  needsReason: boolean;
  ledgerBefore: number;
  /** Why submit or verify refuses this row now (superseded, planned 0, deleted), or null. */
  inactive: string | null;
  /** The row's weights changed shape after the line was saved, so its claimed percents no longer apply. */
  refill: boolean;
}

const EMPTY_INPUT: LineInput = { inputs: {}, reason: '' };

export default function ProgressClaimVerifyPanel({ projectId, profile, boqItems, reloadKey = 0, toast, onVerified, onChanged }: Props) {
  const items = useMemo(
    () => new Map(boqItems.filter((b) => b.project_id == null || b.project_id === projectId).map((b) => [b.id, b])),
    [boqItems, projectId],
  );
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineInputs, setLineInputs] = useState<Record<string, LineInput>>({});
  const [verifierNote, setVerifierNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Lines verify_progress_claim demanded a reason for although the preview saw no drop.
  const [forcedReasons, setForcedReasons] = useState<ReadonlySet<string>>(() => new Set());
  const seq = useRef(0);

  const load = useCallback(async ({ keepInputs = false }: { keepInputs?: boolean } = {}) => {
    const mine = ++seq.current;
    setError(null);
    try {
      const claim = (await getOpenClaim(projectId)) ?? (await getLatestClaim(projectId));
      if (!claim || claim.status !== 'SUBMITTED') {
        if (mine === seq.current) {
          setData({ projectId, claim, lines: [], rows: new Map(), weights: new Map(), verified: new Map(), ledger: new Map(), diary: new Map() });
          setLineInputs({});
          setForcedReasons(new Set());
        }
        return;
      }
      const lines = await listClaimLines(claim.id);
      const [rows, weightRows, verified, ledger, diaryRead, verifiedAt] = await Promise.all([
        listClaimRows(lines.map((l) => l.boq_item_id)),
        listStageWeights(projectId),
        listVerifiedStagePct(projectId),
        listEntryTotals(projectId),
        listDiaryLines(projectId),
        listVerifiedAtByRow(projectId),
      ]);
      const weights = new Map<string, RowWeights>();
      for (const w of weightRows) {
        const checked = validateStageWeights(w.weights);
        if (checked.ok) weights.set(w.boq_item_id, { weights: checked.weights, source: w.source, referenceClass: w.reference_class });
      }
      if (mine !== seq.current) return;
      setData({ projectId, claim, lines, rows, weights, verified, ledger, diary: linesByRowSince(diaryRead.lines, verifiedAt) });
      const claimed = (l: ProgressClaimLine): LineInput => {
        const w = weights.get(l.boq_item_id)?.weights;
        return { inputs: w ? pctInputs(w, l.claimed_pct) : {}, reason: l.regress_reason ?? '' };
      };
      if (keepInputs) {
        // Reloading after a refusal keeps what the verifier typed.
        setLineInputs((prev) => Object.fromEntries(lines.map((l) => [l.id, prev[l.id] ?? claimed(l)])));
        return;
      }
      setLineInputs(Object.fromEntries(lines.map((l) => [l.id, claimed(l)])));
      setForcedReasons(new Set());
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
  }, [load, reloadKey]);

  // Never render another project's claim with its decision buttons live.
  const current = data && data.projectId === projectId ? data : null;
  const claim = current?.claim ?? null;
  const submitted = claim?.status === 'SUBMITTED';
  const lineAuthors = useMemo(() => (current?.lines ?? []).flatMap((l) => [l.created_by, l.updated_by]), [current]);
  const actionable = submitted && canVerifyClaimAs(profile?.role, profile?.id, claim?.submitted_by, lineAuthors);
  const ownClaim = submitted && canVerifyClaim(profile?.role) && !actionable;

  const itemOf = (loaded: Loaded, boqItemId: string) => loaded.rows.get(boqItemId) ?? items.get(boqItemId);

  const check = (loaded: Loaded, line: ProgressClaimLine, state: LineInput): LineCheck => {
    const item = itemOf(loaded, line.boq_item_id);
    const code = item?.code ?? '—';
    const ledgerBefore = loaded.ledger.get(line.boq_item_id) ?? 0;
    const rowWeights = loaded.weights.get(line.boq_item_id) ?? null;
    const inactive = inactiveRowReason(item ?? null);
    if (!rowWeights) {
      return {
        code, item, rowWeights: null, prev: {}, read: null, prevFraction: 0, next: null, delta: null, regressed: [], needsReason: false, ledgerBefore,
        inactive, refill: false,
      };
    }
    const refill = !pctMatchesWeights(rowWeights.weights, line.claimed_pct);
    const prev = loaded.verified.get(line.boq_item_id) ?? line.prev_verified ?? zeroPct(rowWeights.weights);
    const read = readPctInputs(rowWeights.weights, state.inputs);
    const prevFraction = rowFraction(rowWeights.weights, prev);
    const next = read.ok ? rowFraction(rowWeights.weights, read.pct) : null;
    const delta = next != null ? deltaFromInstalled(item?.planned ?? 0, ledgerBefore, next).deltaQuantity : null;
    const regressed = read.ok ? regressedStages(rowWeights.weights, prev, read.pct) : [];
    return {
      code, item, rowWeights, prev, read, prevFraction, next, delta, regressed, ledgerBefore, inactive, refill,
      needsReason: regressed.length > 0 || (delta != null && delta < 0) || forcedReasons.has(line.id),
    };
  };

  const setInput = (lineId: string, stage: string, value: string) =>
    setLineInputs((prev) => {
      const existing = prev[lineId] ?? EMPTY_INPUT;
      return { ...prev, [lineId]: { ...existing, inputs: { ...existing.inputs, [stage]: value } } };
    });

  const setReason = (lineId: string, reason: string) =>
    setLineInputs((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? EMPTY_INPUT), reason } }));

  const verify = async () => {
    if (!current?.claim) return;
    const payload: VerifyLineInput[] = [];
    for (const line of current.lines) {
      const state = lineInputs[line.id] ?? EMPTY_INPUT;
      const c = check(current, line, state);
      if (c.inactive) {
        toast(`${c.code}: ${c.inactive} Kembalikan klaim agar pengawas menghapus baris ini.`, 'critical');
        return;
      }
      if (!c.rowWeights) {
        toast(`${c.code}: bobot tahapan belum diatur.`, 'critical');
        return;
      }
      if (c.refill) {
        toast(`${c.code}: bobot baris berubah setelah diklaim. Kembalikan klaim agar pengawas mengisi ulang.`, 'critical');
        return;
      }
      if (!c.read || !c.read.ok) {
        toast(`${c.code}: ${c.read && !c.read.ok ? c.read.reason : 'persentase tidak valid.'}`, 'critical');
        return;
      }
      const reason = state.reason.trim();
      if (c.needsReason && !reason) {
        toast(`${c.code}: penurunan progres wajib disertai alasan.`, 'critical');
        return;
      }
      payload.push({ line_id: line.id, verified_pct: c.read.pct, regress_reason: c.needsReason ? reason : null });
    }
    setBusy(true);
    try {
      // Line ids survive edits, so the RPC cannot tell a claim that was returned,
      // corrected and sent again while this page stayed open. Re-read it first.
      const [storedClaim, storedLines] = await Promise.all([getOpenClaim(projectId), listClaimLines(current.claim.id)]);
      if (claimChangedSince({ claim: current.claim, lines: current.lines }, { claim: storedClaim, lines: storedLines })) {
        toast('Klaim berubah sejak halaman ini dimuat. Angka terbaru sudah dimuat; periksa lagi lalu verifikasi.', 'warning');
        await load();
        return;
      }
      const result = await verifyClaim(current.claim.id, payload, verifierNote.trim() || null);
      toast(`Klaim diverifikasi. ${result.entries} entri progres dicatat.`, 'ok');
      onVerified?.();
      onChanged?.();
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Verifikasi gagal.', 'critical');
      const refusal = err as { code?: string | null; detail?: string } | null;
      if (refusal?.code === 'CLAIM_REGRESS_REASON') {
        // The recorded figures moved after this page loaded, for example a
        // re-publish changed the planned volume. Ask for a reason on the row
        // the refusal names (every row when it names none) and reload the
        // figures behind the preview, keeping what was typed.
        const rowCode = regressReasonRowCode(refusal.detail);
        const named = current.lines.filter((l) => rowCode != null && itemOf(current, l.boq_item_id)?.code === rowCode);
        setForcedReasons(new Set((named.length > 0 ? named : current.lines).map((l) => l.id)));
        await load({ keepInputs: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const sendReturn = async () => {
    if (!current?.claim) return;
    const note = returnNote.trim();
    if (!note) {
      toast('Tulis alasan pengembalian klaim.', 'critical');
      return;
    }
    setBusy(true);
    try {
      const result = await returnClaim(current.claim.id, note);
      if (result.notified > 0) toast('Klaim dikembalikan ke pengawas.', 'ok');
      else toast('Klaim dikembalikan, tetapi tidak ada yang diberi tahu: pengirimnya tidak lagi ditugaskan ke proyek ini. Kabari tim lapangan langsung.', 'warning');
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

  if (!current) return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;

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
          {actionable
            ? `${current.lines.length} baris diklaim. Angka cek terisi dari klaim pengawas; ubah bila foto atau laporan tidak mendukung.`
            : `${current.lines.length} baris diklaim. Angka cek terisi dari klaim pengawas.`}
        </Text>
        <Text style={styles.hint}>Lalu: terverifikasi sebelumnya. Klaim: angka pengawas. Cek: angka verifikasi.</Text>
        {ownClaim && (
          <Text style={styles.banner}>
            Klaim ini berisi angka yang Anda kirim atau isi sendiri. Verifikasi harus dilakukan estimator atau admin lain.
          </Text>
        )}
      </Card>

      {current.lines.map((line) => {
        const state = lineInputs[line.id] ?? EMPTY_INPUT;
        const c = check(current, line, state);
        if (c.inactive) {
          return (
            <Card key={line.id} title={c.code} subtitle={c.item?.label}>
              <Text style={styles.error}>{`${c.inactive} Kembalikan klaim agar pengawas menghapus baris ini dari klaim.`}</Text>
            </Card>
          );
        }
        if (!c.rowWeights) {
          return (
            <Card key={line.id} title={c.code} subtitle={c.item?.label}>
              <Text style={styles.error}>Bobot tahapan baris ini belum diatur. Kembalikan klaim atau atur bobot di Baseline.</Text>
            </Card>
          );
        }
        const refs = (line.evidence?.photo_refs ?? []).filter((r): r is string => typeof r === 'string');
        const diaryLines = current.diary.get(line.boq_item_id) ?? [];
        const proposal = proposeFromDiary(c.rowWeights.weights, c.prev, diaryLines);
        // Advisory only: nothing here blocks Verifikasi.
        const flags = c.refill ? [] : claimFlags({
          weights: c.rowWeights.weights, source: c.rowWeights.source, prevPct: c.prev, claimedPct: line.claimed_pct,
          photoCount: refs.length, diaryLines, proposal,
        });
        const mismatch = !!c.item && Math.abs((Number(c.item.installed) || 0) - c.ledgerBefore) > 0.0001;
        return (
          <Card
            key={line.id}
            title={c.code}
            subtitle={c.item?.label}
          >
            <Text style={styles.hint}>{weightSourceLabel(c.rowWeights.source, c.rowWeights.referenceClass)}</Text>
            {flags.length > 0 && (
              <View style={styles.flagRow}>
                {flags.map((f) => <Badge key={f} flag="WARNING" label={CLAIM_FLAG_LABELS[f]} />)}
              </View>
            )}
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[styles.cellStage, styles.headText]} numberOfLines={1}>Tahap</Text>
              <Text style={[styles.cell, styles.headText]} numberOfLines={1}>Lalu</Text>
              <Text style={[styles.cell, styles.headText]} numberOfLines={1}>Klaim</Text>
              <Text style={[styles.cellInput, styles.headText]} numberOfLines={1}>Cek</Text>
            </View>
            {stagesOf(c.rowWeights.weights).map((stage) => (
              <View key={stage} style={styles.tableRow}>
                <Text style={styles.cellStage}>{stageKeyLabel(stage)}</Text>
                <Text style={styles.cell}>{formatPercent(c.prev[stage] ?? 0)}</Text>
                <Text style={styles.cell}>{c.refill ? '—' : formatPercent(line.claimed_pct[stage] ?? 0)}</Text>
                <TextInput
                  style={[styles.cellInput, styles.input, !actionable && styles.inputDisabled]}
                  value={state.inputs[stage] ?? ''}
                  onChangeText={(v) => setInput(line.id, stage, v)}
                  editable={actionable}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Verifikasi ${stageKeyLabel(stage)} ${c.code}`}
                />
              </View>
            ))}
            {c.refill && (
              <Text style={styles.error}>
                Bobot baris ini berubah setelah diklaim, jadi angka klaim lama tidak berlaku. Kembalikan klaim agar pengawas mengisi ulang.
              </Text>
            )}
            {c.read && c.read.ok && c.next != null && c.delta != null ? (
              <Text style={styles.preview}>
                {`Progres baris ${formatFraction(c.prevFraction)} menjadi ${formatFraction(c.next)} (perkiraan ${c.delta > 0 ? '+' : ''}${formatQty(c.delta, c.item?.unit ?? '')})`}
              </Text>
            ) : (
              <Text style={styles.error}>{c.read && !c.read.ok && !c.refill ? c.read.reason : ''}</Text>
            )}
            {mismatch && c.item && (
              <Text style={styles.hint}>
                {`Terpasang di BoQ ${formatQty(Number(c.item.installed) || 0, c.item.unit)} berbeda dari riwayat progres ${formatQty(c.ledgerBefore, c.item.unit)}; verifikasi mengikuti riwayat.`}
              </Text>
            )}
            {c.needsReason && (
              <>
                <Text style={styles.warn}>
                  {c.regressed.length > 0
                    ? `Turun dari angka terverifikasi: ${c.regressed.map((s) => stageKeyLabel(s)).join(', ')}.`
                    : c.delta != null && c.delta < 0 ? QUANTITY_DROP : RECORDED_DROP}
                </Text>
                <TextInput
                  style={[styles.input, styles.textarea, !actionable && styles.inputDisabled]}
                  value={state.reason}
                  onChangeText={(v) => setReason(line.id, v)}
                  editable={actionable}
                  multiline
                  placeholder="Alasan progres turun"
                  placeholderTextColor={COLORS.textMuted}
                  accessibilityLabel={`Alasan penurunan ${c.code}`}
                />
              </>
            )}
            <Text style={styles.evidenceHead}>Laporan harian</Text>
            {diaryLines.length === 0 ? (
              <Text style={styles.hint}>Tidak ada baris laporan harian untuk baris ini sejak verifikasi terakhir.</Text>
            ) : (
              <>
                {diarySummary(proposal) ? <Text style={styles.diary}>{diarySummary(proposal)}</Text> : null}
                {(proposal?.lines ?? diaryLines).slice(0, MAX_DIARY_LINES).map((l) => (
                  <Text key={l.id} style={styles.hint}>
                    {`${shortDateId(l.period_end)} · #${l.report_no} · ${stageLabel(l.stage)} · ${activityStateLabel(l.activity_state)}: ${l.line_text}`}
                  </Text>
                ))}
                {diaryLines.length > MAX_DIARY_LINES ? <Text style={styles.hint}>{`+${diaryLines.length - MAX_DIARY_LINES} baris laporan lainnya`}</Text> : null}
              </>
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
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm },
  evidenceHead: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', marginTop: SPACE.md },
  diary: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.info, marginTop: SPACE.xs },
  note: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.critical, marginTop: SPACE.xs },
  warn: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm },
  banner: {
    fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm,
    padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.warningBg,
  },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingVertical: SPACE.xs },
  tableHead: { borderBottomWidth: 1, borderBottomColor: COLORS.borderSub, marginTop: SPACE.sm },
  headText: { fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  cellStage: { flex: 1.3, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.text },
  cell: { flex: 1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, textAlign: 'right' },
  cellInput: { flex: 1.1, fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), textAlign: 'right' },
  input: {
    minHeight: 44, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
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
