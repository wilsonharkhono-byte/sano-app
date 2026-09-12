import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { gateChipLabel, stepChipLabel } from '../../../tools/gateRefs';
import type { GateRef, GateStepRef } from '../../../tools/types';
import { formStyles as s } from './styles';

interface GateProps {
  gates: GateRef[];
  value: string | null;
  onChange: (code: string | null) => void;
  /** Medium confidence: the AI picked this, a human should look (spec §1.1). */
  markPeriksa?: boolean;
  /** Low confidence: the AI's guess, shown as a grey chip the supervisor may tap. */
  hintCode?: string | null;
  disabled?: boolean;
}

/** Gate chips. Tapping the selected chip clears it: a gate is optional. */
export function GateChipRow({ gates, value, onChange, markPeriksa = false, hintCode = null, disabled = false }: GateProps) {
  if (gates.length === 0) {
    return <Text style={s.empty}>Data gerbang belum tersedia. Hubungi kantor.</Text>;
  }
  return (
    <View>
      <View style={s.chipRow}>
        {gates.map((g) => {
          const active = g.code === value;
          const hinted = !value && hintCode === g.code;
          return (
            <TouchableOpacity
              key={g.code}
              style={[s.chip, active && s.chipActive, hinted && s.chipHint]}
              onPress={() => onChange(active ? null : g.code)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`Gerbang ${gateChipLabel(g)}${hinted ? ', saran AI' : ''}`}
            >
              <Text style={[s.chipText, active && s.chipTextActive, hinted && s.chipTextHint]}>
                {hinted ? `Saran AI: ${gateChipLabel(g)}` : gateChipLabel(g)}
              </Text>
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
