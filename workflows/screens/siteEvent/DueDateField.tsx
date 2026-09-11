import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { addDaysIso } from '../../../tools/siteEventRules';
import { COLORS, SPACE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  value: string;
  onChange: (value: string) => void;
  today: string;
  required: boolean;
  disabled?: boolean;
}

const QUICK: ReadonlyArray<{ label: string; days: number }> = [
  { label: 'Besok', days: 1 },
  { label: 'Lusa', days: 2 },
  { label: '1 minggu', days: 7 },
];

/** Typed YYYY-MM-DD plus quick picks; the repo has no date-picker dependency (OfficeHomeScreen uses the same pattern). */
export default function DueDateField({ value, onChange, today, required, disabled = false }: Props) {
  return (
    <View>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={COLORS.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        editable={!disabled}
        accessibilityLabel="Tenggat"
      />
      <View style={[s.chipRow, { marginTop: SPACE.sm }]}>
        {QUICK.map((q) => {
          const date = addDaysIso(today, q.days);
          const active = value === date;
          return (
            <TouchableOpacity
              key={q.label}
              style={[s.chip, active && s.chipActive]}
              onPress={() => onChange(date)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`Tenggat ${q.label}, ${date}`}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{q.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={s.hint}>{required ? 'Wajib untuk isu, hambatan, cacat dan butuh keputusan.' : 'Opsional.'}</Text>
    </View>
  );
}
