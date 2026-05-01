// RecipeView — inline expandable recipe breakdown for a BoQ row.
//
// Shows the composite AHS components (which block each rupiah comes from)
// and the markup factor, so estimators can verify "Poer PC.5 = 1 m³
// readymix @X + 2.13 m² bekisting @Y + 84.7 kg rebar @Z, × 20% markup".
//
// Rendered inside BoqDetail (AuditTraceScreen BoQ tab) directly under the
// cost-summary card. Uses the same StyleSheet conventions as the parent
// screen — no new libraries introduced.

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BoqRowRecipe, RecipeComponent } from '../../../tools/boqParserV2/types';
import { formatRupiah, formatQuantity } from '../../../tools/auditPivot';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../../theme';

if (
  Platform.OS === 'android'
  && UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Line-type display helpers ────────────────────────────────────────────

const LINE_TYPE_LABELS: Record<string, string> = {
  material:  'Material',
  labor:     'Upah',
  equipment: 'Peralatan',
  subkon:    'Subkon',
  prelim:    'Prelim',
};

const LINE_TYPE_ORDER: RecipeComponent['lineType'][] = [
  'material',
  'labor',
  'equipment',
  'subkon',
  'prelim',
];

// Light tints per line type — used as left-border accent on component rows.
const LINE_TYPE_COLORS: Record<string, string> = {
  material:  COLORS.info,
  labor:     COLORS.ok,
  equipment: COLORS.warning,
  subkon:    COLORS.accent,
  prelim:    COLORS.textMuted,
};

// ─── Component row ────────────────────────────────────────────────────────

function ComponentRow({ comp }: { comp: RecipeComponent }) {
  // Prefer the disaggregator's materialName ("Besi D13", "Besi D16", ...)
  // over the parent AHS block title ("Pembesian U24 & U40", which is a
  // steel-grade label, not a diameter). Fall back to the block title for
  // non-disaggregated components, then to the raw cell address.
  const label = comp.materialName
    ?? comp.referencedBlockTitle
    ?? `${comp.referencedCell.sheet}!${comp.referencedCell.address}`;

  const coeffFormatted = formatQuantity(comp.quantityPerUnit, 4);
  const priceFormatted = formatRupiah(comp.unitPrice);
  const contribFormatted = formatRupiah(comp.costContribution);

  return (
    <View style={[styles.componentRow, { borderLeftColor: LINE_TYPE_COLORS[comp.lineType] ?? COLORS.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.componentLabel} numberOfLines={2}>{label}</Text>
        <Text style={styles.componentMath}>
          {coeffFormatted} × {priceFormatted} = {contribFormatted}
        </Text>
        <Text style={styles.componentSource}>
          {comp.sourceCell.sheet}!{comp.sourceCell.address}
        </Text>
      </View>
      <View style={styles.componentContrib}>
        <Text style={styles.componentContribValue}>{contribFormatted}</Text>
      </View>
    </View>
  );
}

// ─── Section (one line type group) ────────────────────────────────────────

function LineTypeSection({
  type,
  components,
}: {
  type: RecipeComponent['lineType'];
  components: RecipeComponent[];
}) {
  if (components.length === 0) return null;

  const subtotal = components.reduce((sum, c) => sum + c.costContribution, 0);
  const label = LINE_TYPE_LABELS[type] ?? type;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, { color: LINE_TYPE_COLORS[type] ?? COLORS.text }]}>
          {label}
        </Text>
        <Text style={styles.sectionSubtotal}>{formatRupiah(subtotal)}</Text>
      </View>
      {components.map((comp, idx) => (
        <ComponentRow key={idx} comp={comp} />
      ))}
    </View>
  );
}

// ─── Main RecipeView ──────────────────────────────────────────────────────

interface RecipeViewProps {
  recipe: BoqRowRecipe | null;
}

export default function RecipeView({ recipe }: RecipeViewProps) {
  const [expanded, setExpanded] = useState(false);

  if (!recipe) return null;

  // Group components by lineType, preserving defined order
  const byType = new Map<RecipeComponent['lineType'], RecipeComponent[]>();
  for (const type of LINE_TYPE_ORDER) byType.set(type, []);
  for (const comp of recipe.components) {
    const bucket = byType.get(comp.lineType);
    if (bucket) bucket.push(comp);
  }

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => !prev);
  };

  // Pre-markup subtotal = sum of all components' costContribution
  const preMarkup = recipe.components.reduce((sum, c) => sum + c.costContribution, 0);
  const markupFactor = recipe.markup?.factor ?? 1;
  const postMarkup = preMarkup * markupFactor;

  const markupPct = `${((markupFactor - 1) * 100).toFixed(0)}%`;
  const markupSourceCell = recipe.markup
    ? `${recipe.markup.sourceCell.sheet}!${recipe.markup.sourceCell.address}`
    : null;
  const markupLabel = recipe.markup?.sourceLabel ?? markupSourceCell;

  return (
    <View style={styles.container}>
      {/* Toggle button */}
      <TouchableOpacity
        style={styles.toggleRow}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Sembunyikan rincian resep' : 'Tampilkan rincian resep'}
      >
        <Ionicons
          name={expanded ? 'receipt' : 'receipt-outline'}
          size={14}
          color={COLORS.primary}
        />
        <Text style={styles.toggleText}>
          {expanded ? 'Sembunyikan Resep' : 'Lihat Resep Komponen'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={COLORS.textSec}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {/* Per line-type sections */}
          {LINE_TYPE_ORDER.map(type => (
            <LineTypeSection
              key={type}
              type={type}
              components={byType.get(type) ?? []}
            />
          ))}

          {/* Markup row */}
          {recipe.markup && (
            <View style={styles.markupRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.markupLabel}>
                  Markup: +{markupPct}
                </Text>
                {markupLabel && (
                  <Text style={styles.markupSource}>{markupLabel}</Text>
                )}
              </View>
              <Text style={styles.markupFactor}>× {markupFactor.toFixed(4)}</Text>
            </View>
          )}

          {/* Pre / post markup totals */}
          <View style={styles.totalsBlock}>
            <View style={styles.totalLine}>
              <Text style={styles.totalLineLabel}>Subtotal (pra-markup)</Text>
              <Text style={styles.totalLineValue}>{formatRupiah(preMarkup)}</Text>
            </View>
            {recipe.markup && (
              <View style={[styles.totalLine, styles.totalLinePost]}>
                <Text style={[styles.totalLineLabel, { color: COLORS.primary }]}>
                  Total (paska-markup)
                </Text>
                <Text style={[styles.totalLineValue, { color: COLORS.primary }]}>
                  {formatRupiah(postMarkup)}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginTop: SPACE.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    overflow: 'hidden',
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACE.sm + 2,
    paddingVertical: SPACE.sm,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  toggleText: {
    flex: 1,
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.primary,
  },

  body: {
    paddingHorizontal: SPACE.sm + 2,
    paddingVertical: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },

  // ── Line type section ──
  section: {
    marginBottom: SPACE.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionSubtotal: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },

  // ── Component row ──
  componentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: SPACE.sm,
    paddingVertical: 5,
    borderLeftWidth: 3,
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.015)',
    borderRadius: 4,
  },
  componentLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.text,
  },
  componentMath: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.medium,
    color: COLORS.textSec,
    marginTop: 1,
  },
  componentSource: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    marginTop: 1,
  },
  componentContrib: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 80,
  },
  componentContribValue: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },

  // ── Markup row ──
  markupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACE.sm,
    paddingTop: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  markupLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.warning,
  },
  markupSource: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
    marginTop: 1,
  },
  markupFactor: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.warning,
  },

  // ── Totals block ──
  totalsBlock: {
    marginTop: SPACE.sm,
    paddingTop: SPACE.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 4,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLinePost: {
    marginTop: 2,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  totalLineLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONTS.semibold,
    color: COLORS.textSec,
  },
  totalLineValue: {
    fontSize: TYPE.sm,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
});
