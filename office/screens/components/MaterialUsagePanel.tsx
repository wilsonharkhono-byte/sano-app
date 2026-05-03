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

export function MaterialUsagePanel(props: MaterialUsagePanelProps): React.ReactElement {
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
  warningText: {
    fontSize: TYPE.sm,
    color: COLORS.text,
    fontFamily: FONTS.regular,
  },
});
