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
  // Compact format: Rp 30 jt, Rp 1.2 jt, Rp 28.8 jt, Rp 750rb, Rp 5
  if (Math.abs(n) >= 1_000_000) {
    const juta = n / 1_000_000;
    // Show 1 decimal unless it's a round number (e.g. 30.0 → 30, 28.8 → 28.8)
    const rounded = parseFloat(juta.toFixed(1));
    return `Rp ${rounded} jt`;
  }
  if (Math.abs(n) >= 1000) {
    const ribu = Math.round(n / 1000);
    return `Rp ${ribu}rb`;
  }
  return `Rp ${Math.round(n)}`;
}

function burnColor(burnPct: number): string {
  if (burnPct > 100) return COLORS.critical;
  if (burnPct > 80) return COLORS.critical;
  if (burnPct > 50) return COLORS.warning;
  return COLORS.text;
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

  // Envelope not yet built (no baseline published, or material not in any AHS)
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
    const overBudget = env.burn_pct > 100;
    const burnTextColor = burnColor(env.burn_pct);
    return (
      <View style={[styles.panel, overBudget && styles.panelCritical]}>
        <Text style={styles.sectionLabel}>Envelope kuantitas</Text>
        <Text style={[styles.lineMain, { color: burnTextColor }]}>
          Terpakai: {fmtNum(env.total_ordered)} / {fmtNum(env.total_planned)} {env.unit} ({env.burn_pct.toFixed(0)}%)
        </Text>
        <Text style={styles.lineSub}>
          Sisa: {fmtNum(env.remaining_to_order)} {env.unit}
        </Text>

        {env.baseline_unit_price != null && env.envelope_total_rupiah != null ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: SPACE.sm }]}>Anggaran</Text>
            <Text style={[styles.lineMain, { color: burnTextColor }]}>
              Terpakai: {fmtRp(env.envelope_used_rupiah ?? 0)} / {fmtRp(env.envelope_total_rupiah)}
            </Text>
            <Text style={styles.lineSub}>
              Sisa: {fmtRp(env.envelope_remaining_rupiah ?? 0)}
            </Text>
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
          <Text style={styles.criticalText}>
            ⚠ Envelope sudah terlampaui ({env.burn_pct.toFixed(0)}%)
          </Text>
        )}
      </View>
    );
  }

  // Tier 1 and Tier 3 placeholders — implemented in Tasks 4 and 5
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
  panelWarning: {
    borderLeftColor: COLORS.warning,
    backgroundColor: '#fff8e1',
  },
  panelInfo: {
    borderLeftColor: COLORS.info,
    backgroundColor: '#e3f2fd',
  },
  panelCritical: {
    borderLeftColor: COLORS.critical,
    backgroundColor: '#ffebee',
  },
  warningText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  infoText: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  sectionLabel: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.bold, marginBottom: 2 },
  lineMain: { fontSize: TYPE.sm, color: COLORS.text, fontFamily: FONTS.regular },
  lineSub: { fontSize: TYPE.xs, color: COLORS.textSec, fontFamily: FONTS.regular },
  muted: { fontStyle: 'italic' },
  criticalText: { fontSize: TYPE.xs, color: COLORS.critical, fontFamily: FONTS.bold, marginTop: SPACE.xs },
});
