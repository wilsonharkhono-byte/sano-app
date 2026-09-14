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
import { canSaveClaimLine, isClaimEditable } from '../../../tools/progressClaims/claimRules';
import {
  countLinkedLinesByRow, getOpenClaim, listClaimLines, listStageWeights, listVerifiedStagePct, seedReferenceWeights, submitClaim,
  type ProgressClaim, type ProgressClaimLine, type StageWeightRow,
} from '../../../tools/progressClaims/claims';
import {
  buildRowViews, claimStatusSummary, claimableRows, formatFraction, missingWeightSeeds,
  type ClaimRowView, type ClaimableItem,
} from '../../../tools/progressClaims/claimView';
import type { StagePct } from '../../../tools/progressClaims/stageMath';
import { weekStartWIB } from '../../../tools/progressClaims/week';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);

interface Props {
  projectId: string;
  role: string | null | undefined;
  boqItems: ClaimableItem[];
  /** Row to open on arrival, e.g. from "Tambah progres untuk item ini". */
  initialRowId?: string | null;
  toast: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

interface Loaded {
  claim: ProgressClaim | null;
  lines: ProgressClaimLine[];
  weights: StageWeightRow[];
  verified: Map<string, StagePct>;
  linked: Map<string, number>;
}

export default function ProgressClaimPanel({ projectId, role, boqItems, initialRowId, toast }: Props) {
  const rows = useMemo(() => claimableRows(boqItems), [boqItems]);
  const canSave = canSaveClaimLine(role);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialRowId ?? null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
      const [lines, verified, linked] = await Promise.all([
        claim ? listClaimLines(claim.id) : Promise.resolve([] as ProgressClaimLine[]),
        listVerifiedStagePct(projectId),
        countLinkedLinesByRow(projectId, claim?.week_start ?? weekStartWIB()),
      ]);
      if (mine === seq.current) setData({ claim, lines, weights, verified, linked });
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
  }, [load, rows.length]);

  useEffect(() => {
    setExpandedId(initialRowId ?? null);
    setConfirming(false);
  }, [projectId, initialRowId]);

  const views = useMemo(
    () => (data ? buildRowViews(rows, data.weights, data.verified, data.lines, data.linked) : []),
    [data, rows],
  );

  const claim = data?.claim ?? null;
  const summary = claimStatusSummary(claim);
  const editable = canSave && (claim === null || isClaimEditable(claim.status));
  const lineCount = data?.lines.length ?? 0;

  const submit = async () => {
    if (!claim) return;
    setSubmitting(true);
    try {
      const result = await submitClaim(claim.id);
      setConfirming(false);
      if (result.notified > 0) toast(`Klaim dikirim. ${result.notified} orang diberi tahu untuk verifikasi.`, 'ok');
      else toast('Klaim dikirim, tetapi belum ada estimator atau admin di proyek ini yang bisa diberi tahu.', 'warning');
      await load();
    } catch (err) {
      toast((err as Error)?.message ?? 'Gagal mengirim klaim.', 'critical');
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

  if (!data) {
    return <ActivityIndicator style={styles.loading} accessibilityLabel="Memuat klaim progres" />;
  }

  return (
    <View>
      <Card title="Klaim Progres Mingguan" rightAction={<Badge flag={summary.flag} label={summary.label} />}>
        <Text style={styles.detail}>{summary.detail}</Text>
        <Text style={styles.hint}>
          {`${lineCount} baris diklaim. Progres proyek baru bertambah setelah estimator memverifikasi klaim.`}
        </Text>
        {claim?.status === 'SUBMITTED' && (
          <Text style={styles.banner}>
            Menunggu verifikasi estimator. Baris baru bisa ditambah setelah klaim diverifikasi atau dikembalikan.
          </Text>
        )}
        {editable && claim && lineCount > 0 && !confirming && (
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

      {views.map((view) => (
        <View key={view.item.id} style={styles.rowWrap}>
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
            </View>
            <View style={styles.rowFigures}>
              <Text style={styles.figure}>{`Terverifikasi ${formatFraction(view.weights ? view.prevFraction : null)}`}</Text>
              <Text style={[styles.figure, view.claimedFraction != null && styles.figureClaimed]}>
                {`Minggu ini ${formatFraction(view.claimedFraction)}`}
              </Text>
            </View>
          </TouchableOpacity>
          {expandedId === view.item.id && view.weights && (
            <StageClaimForm
              key={view.item.id}
              projectId={projectId}
              row={view as WeightedRowView}
              editable={editable}
              onSaved={afterLineChange}
              onRemoved={afterLineChange}
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
