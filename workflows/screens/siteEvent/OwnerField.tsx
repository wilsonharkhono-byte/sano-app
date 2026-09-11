import React from 'react';
import { View, Text } from 'react-native';
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
      <Text style={s.hint}>
        {required ? 'Satu orang yang bertanggung jawab menyelesaikan ini.' : 'Opsional untuk progres dan info.'}
      </Text>
    </View>
  );
}
