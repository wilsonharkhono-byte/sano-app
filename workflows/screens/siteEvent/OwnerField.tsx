import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import SelectSheet, { type SelectOption } from '../../components/SelectSheet';
import type { TeamMember } from '../../../tools/projectManagement';
import { formStyles as s } from './styles';

const ROLE_LABELS: Record<string, string> = {
  supervisor: 'Pengawas',
  estimator: 'Estimator',
  admin: 'Admin',
  principal: 'Prinsipal',
};

interface Props {
  team: TeamMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
  required: boolean;
  disabled?: boolean;
}

/** One accountable owner from the project team (spec §2 decision 5); no outside contacts in release 1. */
export default function OwnerField({ team, value, onChange, required, disabled = false }: Props) {
  const options: SelectOption[] = team.map((m) => ({
    value: m.user_id,
    label: m.full_name,
    meta: ROLE_LABELS[m.role] ?? m.role,
  }));
  return (
    <View>
      <SelectSheet
        value={value ?? ''}
        options={options}
        onChange={(v) => onChange(v ? v : null)}
        placeholder="Pilih pemilik"
        title="Pemilik tindakan"
        disabled={disabled}
        emptyText="Tim proyek belum diatur. Hubungi kantor."
        accessibilityLabel="Pemilik"
      />
      {/* SelectSheet only ever emits a value from its list, so once a name is
          picked there is no way back to "nobody" — and for a non-actionable
          type (progres, info) nobody is a legitimate answer the RPC accepts.
          Not offered while the type is actionable: there the owner is
          required, and clearing it would only produce a refusal. */}
      {!required && value ? (
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => onChange(null)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Kosongkan pemilik"
        >
          <Text style={s.secondaryText}>Kosongkan</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={s.hint}>
        {required ? 'Satu orang yang bertanggung jawab menyelesaikan ini.' : 'Opsional untuk progres dan info.'}
      </Text>
    </View>
  );
}
