import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import type { EnvelopeWithPrice } from '../../../tools/envelopes';

export interface MaterialUsagePanelProps {
  materialId: string | null;
  customMaterialName?: string | null;
  tier: 1 | 2 | 3 | null;
  requestedQuantity: number;
  requestedUnit: string;
  boqItemId?: string | null;
  envelope: EnvelopeWithPrice | null;
  boqItem?: { planned: number; installed: number; code: string; label: string } | null;
}

function fmtNum(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function fmtRp(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const juta = parseFloat((n / 1_000_000).toFixed(1));
    return `Rp ${juta} jt`;
  }
  if (Math.abs(n) >= 1000) {
    const ribu = Math.round(n / 1000);
    return `Rp ${ribu}rb`;
  }
  return `Rp ${Math.round(n)}`;
}

function burnColor(burnPct: number): string {
  if (burnPct > 80) return COLORS.critical;
  if (burnPct > 50) return COLORS.warning;
  return COLORS.text;
}

function renderTier2Like(env: EnvelopeWithPrice): React.ReactElement {
  const overBudget = env.burn_pct > 100;
  const burnTextColor = burnColor(env.burn_pct);
  return (
    <View style={[styles.panel, overBudget && styles.panelCritical]}>
      <Text style={styles.sectionLabel}>Envelope kuantitas</Text>
      <Text style={[styles.lineMain, { color: burnTextColor }]}>
        Terpakai: {fmtNum(env.total_ordered)} / {fmtNum(env.total_planned)} {env.unit} ({env.burn_pct.toFixed(0)}%)
      </Text>
      <Text style={styles.lineSub}>Sisa: {fmtNum(env.remaining_to_order)} {env.unit}</Text>
      {env.baseline_unit_price != null && env.envelope_total_rupiah != null ? (
        <>
          <Text style={[styles.sectionLabel, { marginTop: SPACE.sm }]}>Anggaran</Text>
          <Text style={[styles.lineMain, { color: burnTextColor }]}>
            Terpakai: {fmtRp(env.envelope_used_rupiah ?? 0)} / {fmtRp(env.envelope_total_rupiah)}
          </Text>
          <Text style={styles.lineSub}>Sisa: {fmtRp(env.envelope_remaining_rupiah ?? 0)}</Text>
        </>
      ) : (
        <Text style={[styles.lineSub, styles.muted, { marginTop: SPACE.sm }]}>
          Anggaran tidak tersedia (harga acuan kosong di AHS).
        </Text>
      )}
      {env.boq_item_count > 0 && (
        <Text style={[styles.lineSub, styles.muted, { marginTop: SPACE.xs }]}>
          Melayani {env.boq_item_count} item BoQ
        </Text>
      )}
      {overBudget && (
        <Text style={styles.criticalText}>⚠ Envelope sudah terlampaui ({env.burn_pct.toFixed(0)}%)</Text>
      )}
    </View>
  );
}

export function MaterialUsagePanel(props: MaterialUsagePanelProps): React.ReactElement {
  // Unlinked material
  if (!props.materialId || props.tier == null) {
    return (
      <View style={[styles.panel, styles.panelWarning]}>
        <Text style={styles.warningText}>
          ⚠ Material tidak terdaftar di katalog. Tambahkan di Material Catalog
          untuk tracking envelope.
        </Text>
      </View>
    );
  }

  // Envelope not yet built
  if (!props.envelope) {
    return (
      <View style={[styles.panel, styles.panelInfo]}>
        <Text style={styles.infoText}>
          Envelope belum ada di baseline. Material ini belum dipakai di AHS manapun.
        </Text>
      </View>
    );
  }

  const env = props.envelope;

  if (props.tier === 2) {
    return renderTier2Like(env);
  }

  if (props.tier === 1) {
    if (!props.boqItem) {
      // BoQ allocation orphan — defensive fallback to envelope-style render
      return renderTier2Like(env);
    }
    const remaining = props.boqItem.planned - props.boqItem.installed;
    const afterRequest = remaining - props.requestedQuantity;
    const overBoq = props.requestedQuantity > remaining;
    return (
      <View style={[styles.panel, overBoq && styles.panelCritical]}>
        <Text style={styles.sectionLabel}>BoQ {props.boqItem.code} — {props.boqItem.label}</Text>
        <Text style={styles.lineMain}>
          Volume rencana:   {fmtNum(props.boqItem.planned)} {props.requestedUnit}
        </Text>
        <Text style={styles.lineMain}>
          Sudah dipasang:    {fmtNum(props.boqItem.installed)} {props.requestedUnit}
        </Text>
        <Text style={styles.lineMain}>
          Sisa BoQ:          {fmtNum(remaining)} {props.requestedUnit}
        </Text>
        <Text style={[styles.lineMain, overBoq && { color: COLORS.critical }]}>
          Setelah request:   {fmtNum(afterRequest)} {props.requestedUnit} tersisa
        </Text>
        {overBoq && (
          <Text style={styles.criticalText}>
            ⚠ Akan melampaui BoQ rencana ({fmtNum(props.requestedQuantity - remaining)} {props.requestedUnit} over)
          </Text>
        )}
      </View>
    );
  }

  // Tier 3 placeholder — implemented in Task 5
  return (
    <View style={styles.panel}>
      <Text>Tier {props.tier} placeholder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: SPACE.sm,
    padding: SPACE.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.border,
  },
  panelWarning: { borderLeftColor: COLORS.warning, backgroundColor: '#fff8e1' },
  panelInfo: { borderLeftColor: COLORS.info, backgroundColor: '#e3f2fd' },
  panelCritical: { borderLeftColor: COLORS.critical, backgroundColor: '#ffebee' },
  warningText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  infoText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  sectionLabel: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.bold, marginBottom: 2 },
  lineMain: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  lineSub: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.regular },
  muted: { fontStyle: 'italic' },
  criticalText: { fontSize: TYPE.xs, color: COLORS.critical, fontFamily: FONTS.bold, marginTop: SPACE.xs },
});
