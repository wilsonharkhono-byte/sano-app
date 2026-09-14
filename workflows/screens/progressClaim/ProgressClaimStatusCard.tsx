// workflows/screens/progressClaim/ProgressClaimStatusCard.tsx
// SANO — Klaim minggu ini on the principal's home (spec §6.3): the latest
// claim's status and how many work-area rows still rely on reference weights.
// Nothing to approve here; the card opens the verification view.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Card from '../../components/Card';
import Badge from '../../components/Badge';
import { getLatestClaim, listStageWeights, type ProgressClaim, type StageWeightRow } from '../../../tools/progressClaims/claims';
import { claimStatusSummary, claimableRows, type ClaimableItem } from '../../../tools/progressClaims/claimView';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';

const lh = (size: number) => Math.round(size * 1.45);

interface Props {
  projectId: string;
  boqItems: ClaimableItem[];
  onOpen: () => void;
}

export default function ProgressClaimStatusCard({ projectId, boqItems, onOpen }: Props) {
  const rows = useMemo(() => claimableRows(boqItems), [boqItems]);
  const [claim, setClaim] = useState<ProgressClaim | null>(null);
  const [weights, setWeights] = useState<StageWeightRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (rows.length === 0) return undefined;
    let alive = true;
    setState('loading');
    Promise.all([getLatestClaim(projectId), listStageWeights(projectId)])
      .then(([latest, stored]) => {
        if (!alive) return;
        setClaim(latest);
        setWeights(stored);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [projectId, rows.length]);

  if (rows.length === 0) return null;

  const summary = claimStatusSummary(claim);
  const ids = new Set(rows.map((r) => r.id));
  const inProject = weights.filter((w) => ids.has(w.boq_item_id));
  const reference = inProject.filter((w) => w.source === 'reference').length;
  const unset = rows.length - inProject.length;

  return (
    <Card
      title="Klaim Progres Minggu Ini"
      rightAction={state === 'ready' ? <Badge flag={summary.flag} label={summary.label} /> : undefined}
    >
      <Text style={styles.detail}>
        {state === 'loading' ? 'Memuat status klaim...' : state === 'error' ? 'Status klaim belum bisa dimuat.' : summary.detail}
      </Text>
      {state === 'ready' && reference > 0 && (
        <Text style={styles.hint}>{`${reference} dari ${rows.length} baris memakai bobot referensi.`}</Text>
      )}
      {state === 'ready' && unset > 0 && <Text style={styles.hint}>{`${unset} baris belum punya bobot tahapan.`}</Text>}
      <TouchableOpacity style={styles.link} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Buka klaim progres">
        <Text style={styles.linkText}>Buka klaim progres</Text>
      </TouchableOpacity>
    </Card>
  );
}

const styles = StyleSheet.create({
  detail: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.text },
  hint: { fontSize: TYPE.xs, lineHeight: lh(TYPE.xs), fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  link: { marginTop: SPACE.sm, minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: TYPE.sm, lineHeight: lh(TYPE.sm), fontFamily: FONTS.semibold, color: COLORS.primary },
});
