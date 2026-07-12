import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import type { EnvelopeWithPrice } from '../../../tools/envelopes';
import { makeOverageComponents, OVERAGE_REASON_LABELS } from '../../../tools/requestOverage';
import type { OverageReason } from '../../../tools/types';

export interface MaterialUsagePanelProps {
  materialId: string | null;
  customMaterialName?: string | null;
  // material_request_lines.tier allows 4 (untracked consumable) since
  // migration 053_tier4_request_lines.sql.
  tier: 1 | 2 | 3 | 4 | null;
  requestedQuantity: number;
  requestedUnit: string;
  boqItemId?: string | null;
  envelope: EnvelopeWithPrice | null;
  boqItem?: { planned: number; installed: number; code: string; label: string } | null;
  /** Signal-1 reason capture (spec §3) — evidence of why the supervisor exceeded. */
  overageReason?: OverageReason | null;
  overageNote?: string | null;
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
        Di-PO: {fmtNum(env.total_ordered)} / {fmtNum(env.total_planned)} {env.unit} ({env.burn_pct.toFixed(0)}%)
      </Text>
      <Text style={styles.lineSub}>Permintaan berjalan: {fmtNum(env.total_requested)} {env.unit}</Text>
      <Text style={styles.lineSub}>Sisa untuk di-PO: {fmtNum(env.remaining_to_order)} {env.unit}</Text>
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

/**
 * Signal-1 overage panel (Task 2.4 / spec §3) — RECOMPUTED AT RENDER from the
 * live envelope + this request's own quantity, never from the stored
 * line_check_details (that is evidence-of-then only). Grain: Proyek. Quantities,
 * not Rp. Self-excludes this line from "permintaan berjalan lain".
 */
function renderOverageRunningTotal(
  env: EnvelopeWithPrice,
  thisQty: number,
  reason: OverageReason | null | undefined,
  note: string | null | undefined,
): React.ReactElement | null {
  const planned = Number(env.total_planned ?? 0);
  if (planned <= 0) return null; // no comparison baseline → handled by caller
  const poOrdered = Number(env.total_ordered ?? 0);
  const otherOpen = Math.max(0, Number(env.total_requested ?? 0) - thisQty); // self-exclusion
  const c = makeOverageComponents({
    grainLabel: 'Proyek', poOrdered, otherOpen, thisRequest: thisQty, planned, unit: env.unit,
  });
  const projected = poOrdered + otherOpen + thisQty;
  const over = c.projectedPct > 100;
  return (
    <View style={[styles.panel, over && styles.panelCritical]}>
      <Text style={styles.sectionLabel}>Proyeksi alokasi — Proyek (berdasarkan PO SANO)</Text>
      <Text style={styles.lineSub}>Rencana: {fmtNum(planned)} {env.unit}</Text>
      <Text style={styles.lineSub}>Sudah di-PO: {fmtNum(poOrdered)} {env.unit}</Text>
      <Text style={styles.lineSub}>Permintaan berjalan lain: {fmtNum(otherOpen)} {env.unit}</Text>
      <Text style={styles.lineSub}>Permintaan ini: {fmtNum(thisQty)} {env.unit}</Text>
      <Text style={[styles.lineMain, over && { color: COLORS.critical }]}>
        Proyeksi: {fmtNum(projected)} {env.unit} ({c.projectedPct.toFixed(0)}%)
      </Text>
      {over && <Text style={styles.criticalText}>⚠ Melebihi total alokasi</Text>}
      {reason && (
        <Text style={[styles.lineSub, styles.reasonLine]}>
          Alasan pengaju: {OVERAGE_REASON_LABELS[reason]}{note ? ` — ${note}` : ''}
        </Text>
      )}
    </View>
  );
}

export function MaterialUsagePanel(props: MaterialUsagePanelProps): React.ReactElement {
  // Unlinked / free-text material → explicit no-comparison state (spec §3),
  // never a silent OK.
  if (!props.materialId || props.tier == null) {
    return (
      <View style={[styles.panel, styles.panelInfo]}>
        <Text style={styles.infoText}>
          Tidak ada alokasi pembanding — material bebas-teks belum terhubung ke
          katalog. Tambahkan di Material Catalog untuk tracking envelope.
        </Text>
      </View>
    );
  }

  // Envelope not yet built → also no comparison baseline.
  if (!props.envelope) {
    return (
      <View style={[styles.panel, styles.panelInfo]}>
        <Text style={styles.infoText}>
          Tidak ada alokasi pembanding — material belum punya rencana (envelope)
          di proyek ini.
        </Text>
      </View>
    );
  }

  const env = props.envelope;
  const overage = renderOverageRunningTotal(env, props.requestedQuantity, props.overageReason, props.overageNote);

  const detail = renderTierDetail(props, env);

  return (
    <>
      {overage}
      {detail}
    </>
  );
}

/** Tier-specific supplementary detail below the Signal-1 overage panel. */
function renderTierDetail(props: MaterialUsagePanelProps, env: EnvelopeWithPrice): React.ReactElement {
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

  if (props.tier === 3) {
    const TIER3_CAP = 5_000_000;
    if (env.baseline_unit_price == null) {
      return (
        <View style={styles.panel}>
          <Text style={[styles.lineSub, styles.muted]}>Estimasi biaya tidak tersedia (harga acuan kosong di AHS).</Text>
        </View>
      );
    }
    const estimatedCost = props.requestedQuantity * env.baseline_unit_price;
    const capPct = (estimatedCost / TIER3_CAP) * 100;
    const overCap = estimatedCost > TIER3_CAP;
    return (
      <View style={[styles.panel, overCap && styles.panelCritical]}>
        <Text style={styles.lineMain}>
          Estimasi biaya: {fmtRp(estimatedCost)}
        </Text>
        <Text style={styles.lineSub}>
          Spend cap per request: {fmtRp(TIER3_CAP)} ({capPct.toFixed(1)}% terpakai)
        </Text>
        {overCap && (
          <Text style={styles.criticalText}>⚠ Melampaui cap per request</Text>
        )}
      </View>
    );
  }

  if (props.tier === 4) {
    return (
      <View style={styles.panel}>
        <Text style={[styles.lineSub, styles.muted]}>
          Tier 4 consumable — tidak dilacak anggaran, dicatat sebagai stok umum.
        </Text>
      </View>
    );
  }

  // Defensive fallback: unknown tier
  return (
    <View style={[styles.panel, styles.panelWarning]}>
      <Text style={styles.warningText}>Material tier tidak terdefinisi.</Text>
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
  reasonLine: { marginTop: SPACE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
});
