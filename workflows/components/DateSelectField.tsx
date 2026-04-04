import React, { useEffect, useMemo, useState } from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, RADIUS_SM, SPACE, TYPE } from '../theme';

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getTodayIsoDate() {
  return toIsoDate(new Date());
}

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function formatDisplayDate(value: string | null | undefined) {
  const parsed = parseIsoDate(value);
  return parsed
    ? parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

interface DateSelectFieldProps {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  helperText?: string;
  allowClear?: boolean;
  minYear?: number;
  maxYear?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export default function DateSelectField({
  value,
  onChange,
  placeholder = 'Pilih tanggal',
  helperText,
  allowClear = false,
  minYear,
  maxYear,
  disabled = false,
  accessibilityLabel,
  style,
}: DateSelectFieldProps) {
  const today = useMemo(() => new Date(), []);
  const parsedValue = parseIsoDate(value) ?? today;
  const startYear = minYear ?? today.getFullYear() - 5;
  const endYear = maxYear ?? today.getFullYear() + 10;

  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(parsedValue.getFullYear());
  const [month, setMonth] = useState(parsedValue.getMonth() + 1);
  const [day, setDay] = useState(parsedValue.getDate());

  useEffect(() => {
    const source = parseIsoDate(value) ?? today;
    setYear(source.getFullYear());
    setMonth(source.getMonth() + 1);
    setDay(source.getDate());
  }, [value, today]);

  useEffect(() => {
    const maxDay = daysInMonth(year, month);
    if (day > maxDay) {
      setDay(maxDay);
    }
  }, [day, month, year]);

  const years = useMemo(() => {
    const result: number[] = [];
    for (let current = endYear; current >= startYear; current -= 1) {
      result.push(current);
    }
    return result;
  }, [endYear, startYear]);

  const maxDayForSelection = daysInMonth(year, month);
  const days = Array.from({ length: maxDayForSelection }, (_, index) => index + 1);

  const commitSelection = () => {
    onChange(`${year}-${pad(month)}-${pad(day)}`);
    setOpen(false);
  };

  const clearSelection = () => {
    onChange('');
    setOpen(false);
  };

  const displayText = value ? formatDisplayDate(value) : placeholder;

  return (
    <View style={style}>
      <TouchableOpacity
        style={[
          styles.trigger,
          open && styles.triggerOpen,
          disabled && styles.triggerDisabled,
        ]}
        onPress={() => !disabled && setOpen(current => !current)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityState={{ disabled, expanded: open }}
      >
        <View style={styles.triggerCopy}>
          <Ionicons
            name="calendar-outline"
            size={18}
            color={disabled ? COLORS.textMuted : open ? COLORS.primary : COLORS.textSec}
          />
          <Text
            style={[
              styles.triggerText,
              !value && styles.placeholder,
              disabled && styles.disabledText,
            ]}
          >
            {displayText}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={disabled ? COLORS.textMuted : COLORS.textSec}
        />
      </TouchableOpacity>

      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}

      {open && !disabled ? (
        <View style={styles.panel}>
          <View style={styles.pickerRow}>
            <View style={styles.pickerCol}>
              <Text style={styles.pickerLabel}>Tanggal</Text>
              <View style={styles.pickerShell}>
                <Picker selectedValue={String(day)} onValueChange={next => setDay(Number(next))}>
                  {days.map(option => (
                    <Picker.Item key={option} label={pad(option)} value={String(option)} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.pickerCol}>
              <Text style={styles.pickerLabel}>Bulan</Text>
              <View style={styles.pickerShell}>
                <Picker selectedValue={String(month)} onValueChange={next => setMonth(Number(next))}>
                  {MONTH_LABELS.map((label, index) => (
                    <Picker.Item key={label} label={label} value={String(index + 1)} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.pickerCol}>
              <Text style={styles.pickerLabel}>Tahun</Text>
              <View style={styles.pickerShell}>
                <Picker selectedValue={String(year)} onValueChange={next => setYear(Number(next))}>
                  {years.map(option => (
                    <Picker.Item key={option} label={String(option)} value={String(option)} />
                  ))}
                </Picker>
              </View>
            </View>
          </View>

          <View style={styles.actionRow}>
            {allowClear ? (
              <TouchableOpacity style={styles.clearBtn} onPress={clearSelection}>
                <Text style={styles.clearBtnText}>Kosongkan</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <View style={styles.trailingActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setOpen(false)}>
                <Text style={styles.secondaryBtnText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={commitSelection}>
                <Text style={styles.primaryBtnText}>Pilih</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.md,
  },
  triggerOpen: {
    borderColor: COLORS.primary,
  },
  triggerDisabled: {
    backgroundColor: COLORS.surfaceAlt,
    opacity: 0.8,
  },
  triggerCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    flex: 1,
  },
  triggerText: {
    flex: 1,
    color: COLORS.text,
    fontFamily: FONTS.medium,
    fontSize: TYPE.base,
  },
  placeholder: {
    color: COLORS.textSec,
  },
  disabledText: {
    color: COLORS.textMuted,
  },
  helperText: {
    marginTop: SPACE.sm,
    color: COLORS.textSec,
    fontFamily: FONTS.regular,
    fontSize: TYPE.sm,
  },
  panel: {
    marginTop: SPACE.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    backgroundColor: COLORS.surfaceAlt,
    padding: SPACE.md,
    gap: SPACE.md,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  pickerCol: {
    flex: 1,
  },
  pickerLabel: {
    color: COLORS.textSec,
    fontFamily: FONTS.semibold,
    fontSize: TYPE.sm,
    marginBottom: SPACE.xs,
  },
  pickerShell: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS_SM,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
    minHeight: 44,
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  trailingActions: {
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  secondaryBtn: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS_SM,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  secondaryBtnText: {
    color: COLORS.textSec,
    fontFamily: FONTS.semibold,
    fontSize: TYPE.sm,
  },
  primaryBtn: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS_SM,
    backgroundColor: COLORS.primary,
  },
  primaryBtnText: {
    color: COLORS.textInverse,
    fontFamily: FONTS.semibold,
    fontSize: TYPE.sm,
  },
  clearBtn: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm,
  },
  clearBtnText: {
    color: COLORS.warning,
    fontFamily: FONTS.semibold,
    fontSize: TYPE.sm,
  },
});
