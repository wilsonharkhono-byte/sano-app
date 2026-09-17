// workflows/screens/progressClaim/ProgressClaimPanel.tsx
// SANO — Tambah progres as the weekly stage claim (spec §16): every work-area
// row with its verified and this week's figures, the stage form inline under
// the tapped row, and Kirim for the week. Mounted in the Progres tab and in
// Laporan. Nothing here writes progress: verify_progress_claim does, after
// an estimator checks the claim.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import StageClaimForm, { type WeightedRowView } from './StageClaimForm';
import { canSaveClaimLine, isClaimEditable, isStaleClaimRefusal } from '../../../tools/progressClaims/claimRules';
import {
  getLatestClaim, getOpenClaim, listClaimLines, listClaimRows, listDiaryLines, listEntryTotals, listStageWeights, listVerifiedAtByRow, listVerifiedStagePct,
  removeClaimLine, seedReferenceWeights, submitClaim,
  type ProgressClaim, type ProgressClaimLine, type StageWeightRow,
} from '../../../tools/progressClaims/claims';
import {
  buildRowViews, claimStatusSummary, claimableRows, formatFraction, inactiveRowReason, missingWeightSeeds, orphanClaimLines,
  type ClaimRowView, type ClaimableItem,
} from '../../../tools/progressClaims/claimView';
import { diarySummary, linesByRowSince, proposeFromDiary, type DiaryLine, type DiaryProposal } from '../../../tools/progressClaims/diaryEvidence';
import type { StagePct } from '../../../tools/progressClaims/stageMath';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);

interface Props {
  projectId: string;
  role: string | null | undefined;
  boqItems: ClaimableItem[];
  /** Row to open on arrival, e.g. from "Tambah progres untuk item ini". */
  initialRowId?: string | null;
  /** Bump to reload, e.g. when a claim notification brings the user back to a panel already on screen. */
  reloadKey?: number;
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

interface Loaded {
  projectId: string;
  claim: ProgressClaim | null;
  lines: ProgressClaimLine[];
  weights: StageWeightRow[];
  verified: Map<string, StagePct>;
  /** Confirmed daily-report lines per work area since it was last verified. */
  diary: Map<string, DiaryLine[]>;
  diaryReadable: boolean;
  ledger: Map<string, number>;
  /** With no claim open, the last claim (how it ended, and the verifier's note). */
  lastClaim: ProgressClaim | null;
  /** The rows of lines this screen cannot list (superseded, planned 0, gone), read fresh. */
  orphanRows: Map<string, ClaimableItem>;
}

export default function ProgressClaimPanel({ projectId, role, boqItems, initialRowId, reloadKey = 0, toast }: Props) {
  const rows = useMemo(() => claimableRows(boqItems, projectId), [boqItems, projectId]);
  // Just after a project switch the context still holds the previous project's rows.
  const switching = rows.length === 0 && boqItems.some((b) => b.project_id != null && b.project_id !== projectId);
  const canSave = canSaveClaimLine(role);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialRowId ?? null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      let weights = await listStageWeights(projectId);
      const seeds = canSave ? missingWeightSeeds(rows, weights) : [];
      if (seeds.length > 0) {
        try {
          await seedReferenceWeights(projectId, seeds);
          weights = await listStageWeights(projectId);
        } catch (err) {
          toast((err as Error)?.message ?? 'Bobot referensi gagal diterapkan.', 'warning');
        }
      }
      const claim = await getOpenClaim(projectId);
      const [lines, verified, diaryRead, verifiedAt, ledger, lastClaim] = await Promise.all([
        claim ? listClaimLines(claim.id) : Promise.resolve([] as ProgressClaimLine[]),
        listVerifiedStagePct(projectId),
        listDiaryLines(projectId),
        listVerifiedAtByRow(projectId),
        listEntryTotals(projectId),
        claim ? Promise.resolve(null) : getLatestClaim(projectId),
      ]);
      const diary = linesByRowSince(diaryRead.lines, verifiedAt);
      // A re-publish can supersede a claimed row, or zero its planned volume.
      // Submit refuses such a line, so read those rows to list them for removal.
      const orphanIds = orphanClaimLines(lines, rows).map((l) => l.boq_item_id);
      const orphanRows = orphanIds.length > 0 ? await listClaimRows(orphanIds) : new Map<string, ClaimableItem>();
      if (mine === seq.current) setData({ projectId, claim, lines, weights, verified, diary, diaryReadable: diaryRead.readable, ledger, lastClaim, orphanRows });
    } catch (err) {
      if (mine === seq.current) setError((err as Error)?.message ?? 'Klaim progres gagal dimuat.');
    }
  }, [projectId, rows, canSave, toast]);

  useEffect(() => {
    if (rows.length === 0) return undefined;
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load, rows.length, reloadKey]);

  useEffect(() => {
    setExpandedId(initialRowId ?? null);
    setConfirming(false);
  }, [projectId, initialRowId]);

  // Never render another project's claim, with its Kirim still live.
  const current = data && data.projectId === projectId ? data : null;
  const views = useMemo(() => {
    if (!current) return [];
    const linked = new Map([...current.diary].map(([rowId, lines]) => [rowId, lines.length]));
    return buildRowViews(rows, current.weights, current.verified, current.lines, linked, current.ledger);
  }, [current, rows]);
  // What the diary proposes per work area; status credit, never below the verified figure.
  const proposals = useMemo(() => {
    const map = new Map<string, DiaryProposal>();
    for (const v of views) {
      const p = v.weights ? proposeFromDiary(v.weights, v.prevPct, current?.diary.get(v.item.id) ?? []) : null;
      if (p) map.set(v.item.id, p);
    }
    return map;
  }, [views, current]);
  // Work areas the diary moved and nobody has claimed yet come first.
  const moved = (v: ClaimRowView) => !v.lineId && proposals.get(v.item.id)?.changed === true;
  const ordered = useMemo(() => [...views.filter(moved), ...views.filter((v) => !moved(v))], [views, proposals]);
  const movedCount = views.filter(moved).length;

  const claim = current?.claim ?? null;
  // With nothing open, the header shows how the last claim ended.
  const lastClaim = claim ? null : current?.lastClaim ?? null;
  const summary = claimStatusSummary(claim ?? lastClaim);
  const editable = canSave && (claim === null || isClaimEditable(claim.status));
  const lineCount = current?.lines.length ?? 0;
  const orphans = current ? orphanClaimLines(current.lines, rows) : [];
  const blockingOrphans = orphans.filter((l) => inactiveRowReason(current?.orphanRows.get(l.boq_item_id)) != null).length;
  const refills = views.filter((v) => v.claimNeedsRefill).length;
  const canSend = blockingOrphans === 0 && refills === 0;

  const submit = async () => {
    if (!claim) return;
    setSubmitting(true);
    try {
      const result = await submitClaim(claim.id);
      setConfirming(false);
      if (result.verifiers_notified > 0) {
        toast(`Klaim dikirim. ${result.verifiers_notified} estimator atau admin diberi tahu untuk verifikasi.`, 'ok');
      } else if (result.notified > 0) {
        toast('Klaim dikirim, tetapi belum ada estimator atau admin di proyek ini. Prinsipal diberi tahu agar menugaskan verifikator.', 'warning');
      } else {
        toast('Klaim dikirim, tetapi belum ada yang bisa diberi tahu. Minta admin menugaskan estimator ke proyek ini.', 'warning');
      }
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal mengirim klaim.', 'critical');
      if (isStaleClaimRefusal((err as { code?: string | null })?.code)) {
        setConfirming(false);
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openRow = (view: ClaimRowView) => {
    if (!view.weights) {
      toast('Bobot tahapan baris ini belum diatur. Minta estimator menerapkan bobot di Baseline.', 'warning');
      return;
    }
    setExpandedId((prev) => (prev === view.item.id ? null : view.item.id));
  };

  const afterLineChange = () => {
    setExpandedId(null);
    void load();
  };

  const removeOrphan = async (line: ProgressClaimLine, code: string) => {
    setRemovingId(line.id);
    try {
      await removeClaimLine(line.id);
      toast(`${code} dihapus dari klaim.`, 'warning');
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal menghapus.', 'critical');
    } finally {
      setRemovingId(null);
      await load();
    }
  };

  if (switching) {
    return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;
  }

  if (rows.length === 0) {
    return (
      <Card title="Klaim Progres Mingguan">
        <Text style={styles.hint}>
          Belum ada baris BoQ yang bisa diklaim. BoQ proyek ini belum dipublikasikan atau belum punya volume rencana.
        </Text>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Klaim Progres Mingguan">
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Muat ulang klaim">
          <Text style={styles.ghostBtnText}>Coba lagi</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (!current) {
    return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;
  }

  return (
    <View>
      <Card title="Klaim Progres Mingguan" rightAction={<Badge flag={summary.flag} label={summary.label} />}>
        <Text style={styles.detail}>{summary.detail}</Text>
        {lastClaim?.verifier_note ? <Text style={styles.note}>{`Catatan verifikasi: ${lastClaim.verifier_note}`}</Text> : null}
        <Text style={styles.hint}>
          {lastClaim
            ? 'Klaim terakhir di atas. Simpan progres di baris mana pun untuk membuka klaim baru.'
            : `${lineCount} baris diklaim. Progres proyek baru bertambah setelah estimator memverifikasi klaim.`}
        </Text>
        {!current.diaryReadable && (
          <Text style={styles.warnText}>Laporan harian belum bisa dibaca. Isi status tiap tahap secara manual.</Text>
        )}
        {claim?.status === 'SUBMITTED' && (
          <Text style={styles.banner}>
            Menunggu verifikasi estimator. Baris baru bisa ditambah setelah klaim diverifikasi atau dikembalikan.
          </Text>
        )}
        {editable && claim && lineCount > 0 && !canSend && (
          <Text style={styles.warnText}>
            {blockingOrphans > 0
              ? 'Hapus baris yang tidak berlaku lagi (di bawah) sebelum mengirim klaim.'
              : `Isi ulang ${refills} baris yang bobotnya berubah sebelum mengirim klaim.`}
          </Text>
        )}
        {editable && claim && lineCount > 0 && canSend && !confirming && (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setConfirming(true)} accessibilityRole="button" accessibilityLabel="Kirim klaim">
            <Text style={styles.primaryBtnText}>Kirim klaim</Text>
          </TouchableOpacity>
        )}
        {confirming && (
          <View style={styles.confirmBox}>
            <Text style={styles.detail}>{`Kirim ${lineCount} baris ke estimator untuk diverifikasi?`}</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, submitting && styles.btnBusy]}
                onPress={() => void submit()}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Ya, kirim"
                accessibilityState={{ disabled: submitting, busy: submitting }}
              >
                <Text style={styles.primaryBtnText}>{submitting ? 'Mengirim...' : 'Ya, kirim'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => setConfirming(false)} accessibilityRole="button" accessibilityLabel="Batal kirim">
                <Text style={styles.ghostBtnText}>Batal</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Card>

      {orphans.length > 0 && (
        <Card title="Baris yang tidak berlaku lagi">
          <Text style={styles.hint}>Baris ini masih ada di klaim, tetapi tidak bisa diklaim lagi. Hapus dari klaim sebelum mengirim.</Text>
          {orphans.map((l) => {
            const row = current.orphanRows.get(l.boq_item_id);
            const code = row?.code ?? 'Baris';
            return (
              <View key={l.id} style={styles.orphan}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowCode}>{row?.code ?? '—'}</Text>
                  {row?.label ? <Text style={styles.rowLabel}>{row.label}</Text> : null}
                  <Text style={[styles.rowSub, styles.rowSubWarn]}>
                    {inactiveRowReason(row) ?? 'Baris ini tidak lagi termasuk baris yang bisa diklaim.'}
                  </Text>
                </View>
                {editable && (
                  <TouchableOpacity
                    style={[styles.ghostBtn, removingId === l.id && styles.btnBusy]}
                    onPress={() => void removeOrphan(l, code)}
                    disabled={removingId != null}
                    accessibilityRole="button"
                    accessibilityLabel={`Hapus ${code} dari klaim`}
                  >
                    <Text style={styles.ghostBtnText}>{removingId === l.id ? 'Menghapus...' : 'Hapus dari klaim'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </Card>
      )}

      {ordered.map((view, index) => (
        <View key={view.item.id} style={styles.rowWrap}>
          {index === 0 && movedCount > 0 && <Text style={styles.groupHead}>Ada kegiatan di laporan harian</Text>}
          {index === movedCount && movedCount > 0 && <Text style={styles.groupHead}>Baris lainnya</Text>}
          <TouchableOpacity
            style={[styles.row, expandedId === view.item.id && styles.rowActive]}
            onPress={() => openRow(view)}
            accessibilityRole="button"
            accessibilityLabel={`${view.item.code} ${view.item.label}`}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowCode}>{view.item.code}</Text>
              <Text style={styles.rowLabel}>{view.item.label}</Text>
              <Text style={[styles.rowSub, !view.weights && styles.rowSubWarn]}>
                {view.weights ? `${view.photoRefs.length} foto · ${view.linkedLines} baris laporan` : 'Bobot belum diatur'}
              </Text>
              {diarySummary(proposals.get(view.item.id)) ? (
                <Text style={styles.rowDiary}>{diarySummary(proposals.get(view.item.id))}</Text>
              ) : null}
            </View>
            <View style={styles.rowFigures}>
              <Text style={styles.figure}>{`Terverifikasi ${formatFraction(view.weights ? view.prevFraction : null)}`}</Text>
              <Text style={[styles.figure, view.claimedFraction != null && styles.figureClaimed, view.claimNeedsRefill && styles.rowSubWarn]}>
                {view.claimNeedsRefill ? 'Diklaim: isi ulang' : `Diklaim ${formatFraction(view.claimedFraction)}`}
              </Text>
            </View>
          </TouchableOpacity>
          {expandedId === view.item.id && view.weights && (
            <StageClaimForm
              key={view.item.id}
              projectId={projectId}
              row={view as WeightedRowView}
              editable={editable}
              diary={proposals.get(view.item.id) ?? null}
              onSaved={afterLineChange}
              onRemoved={afterLineChange}
              onStale={afterLineChange}
              onClose={() => setExpandedId(null)}
              toast={toast}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: SPACE.lg },
  detail: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  error: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.regular, color: COLORS.critical },
  note: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.xs },
  groupHead: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase', marginTop: SPACE.md, marginBottom: SPACE.xs },
  rowDiary: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.medium, color: COLORS.info, marginTop: 2 },
  warnText: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.warning, marginTop: SPACE.sm },
  orphan: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm,
    borderTopWidth: 1, borderTopColor: COLORS.borderSub,
  },
  banner: {
    fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.semibold, color: COLORS.info, marginTop: SPACE.sm,
    padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.infoBg,
  },
  confirmBox: { marginTop: SPACE.sm, padding: SPACE.sm, borderRadius: RADIUS, backgroundColor: COLORS.surfaceAlt },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.sm },
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
  rowWrap: { marginTop: SPACE.xs },
  row: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderSub,
  },
  rowActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentBg, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  rowCode: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.bold, color: COLORS.textSec, textTransform: 'uppercase' },
  rowLabel: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  rowSub: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  rowSubWarn: { color: COLORS.warning, fontFamily: FONTS.semibold },
  rowFigures: { alignItems: 'flex-end', justifyContent: 'center' },
  figure: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec },
  figureClaimed: { color: COLORS.accentDark, fontFamily: FONTS.bold },
});
