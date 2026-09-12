import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SITE_EVENT_TYPES } from '../../../tools/constants';
import type { SiteEventType } from '../../../tools/types';
import { formStyles as s } from './styles';

interface Props {
  value: SiteEventType | null;
  onChange: (type: SiteEventType) => void;
  markPeriksa?: boolean;
  /** Low confidence: the AI's guess as a grey chip, never pre-selected. */
  hint?: SiteEventType | null;
  disabled?: boolean;
}

export default function EventTypeChipRow({ value, onChange, markPeriksa = false, hint = null, disabled = false }: Props) {
  return (
    <View>
      <View style={s.chipRow}>
        {SITE_EVENT_TYPES.map((t) => {
          const active = t.value === value;
          const hinted = !value && hint === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              style={[s.chip, active && s.chipActive, hinted && s.chipHint]}
              onPress={() => onChange(t.value)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`Jenis ${t.label}${hinted ? ', saran AI' : ''}`}
            >
              <Text style={[s.chipText, active && s.chipTextActive, hinted && s.chipTextHint]}>
                {hinted ? `Saran AI: ${t.label}` : t.label}
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
