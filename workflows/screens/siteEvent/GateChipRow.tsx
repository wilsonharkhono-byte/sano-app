import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { gateChipLabel, stepChipLabel } from '../../../tools/gateRefs';
import type { GateRef, GateStepRef } from '../../../tools/types';
import { formStyles as s } from './styles';
import { COLORS } from '../../theme';

interface GateProps {
  gates: GateRef[];
  value: string | null;
  onChange: (code: string | null) => void;
  /** Medium confidence: the AI picked this, a human should look (spec §1.1). */
  markPeriksa?: boolean;
  /** Low confidence: the AI's guess, shown as a dashed "Saran" row the supervisor may tap. */
  hintCode?: string | null;
  disabled?: boolean;
}

/**
 * Gates as a vertical, selectable list — one row per active gate, tall enough
 * (48pt) for a title plus a two-line description, because each gate now names
 * two trades ("Waterproofing + kamar mandi") and a bare chip label no longer
 * carries enough meaning on its own. The description is the same text
 * supabase/functions/site-event-analyze/prompt.ts feeds the AI classifier, so
 * a supervisor reading it here sees exactly what the model was told.
 * Tapping the selected row clears it: a gate is optional.
 */
export function GateChipRow({ gates, value, onChange, markPeriksa = false, hintCode = null, disabled = false }: GateProps) {
  const active = gates.filter((g) => g.active);
  if (active.length === 0) {
    return <Text style={s.empty}>Data gerbang belum tersedia. Hubungi kantor.</Text>;
  }
  return (
    <View>
      <View style={s.gateList}>
        {active.map((g) => {
          const selected = g.code === value;
          const hinted = !value && hintCode === g.code;
          const label = gateChipLabel(g);
          const description = g.description ?? '';
          return (
            <TouchableOpacity
              key={g.code}
              style={[s.gateRow, selected && s.gateRowActive, hinted && s.gateRowHint]}
              onPress={() => onChange(selected ? null : g.code)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`Gerbang ${label}${description ? `. ${description}` : ''}${hinted ? '. Saran AI' : ''}`}
            >
              <View style={s.gateRowText}>
                <Text style={[s.gateTitle, selected && s.gateTitleActive]}>{label}</Text>
                {description ? (
                  <Text
                    style={[s.gateSubtitle, selected && s.gateSubtitleActive]}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {description}
                  </Text>
                ) : null}
              </View>
              {hinted ? (
                <View style={s.saranBadge}>
                  <Text style={s.saranText}>Saran</Text>
                </View>
              ) : null}
              {selected ? (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.textInverse} style={s.gateCheck} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {markPeriksa && value ? (
        <View style={s.periksa}>
          <Text style={s.periksaText}>Periksa</Text>
        </View>
      ) : null}
    </View>
  );
}

interface StepProps {
  steps: GateStepRef[];
  gates: GateRef[];
  gateCode: string | null;
  value: string | null;
  onChange: (code: string | null) => void;
  disabled?: boolean;
}

/** Optional steps under the chosen gate. gate_step_refs ships empty (096), so this often renders nothing. */
export function StepChipRow({ steps, gates, gateCode, value, onChange, disabled = false }: StepProps) {
  const visible = steps.filter((step) => step.gate_code === gateCode);
  if (!gateCode || visible.length === 0) return null;
  const gate = gates.find((g) => g.code === gateCode);
  return (
    <View style={s.chipRow}>
      {visible.map((step) => {
        const active = step.code === value;
        return (
          <TouchableOpacity
            key={step.code}
            style={[s.chip, active && s.chipActive]}
            onPress={() => onChange(active ? null : step.code)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
          >
            <Text style={[s.chipText, active && s.chipTextActive]}>{stepChipLabel(step, gate)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
