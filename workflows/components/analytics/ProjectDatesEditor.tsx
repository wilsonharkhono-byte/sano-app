// workflows/components/analytics/ProjectDatesEditor.tsx
// SANO — the project's start and planned end date, the two ends of the planned
// S-curve (spec 2026-09-17 §5.4). Inline under the curve, never a modal; shown
// to admin and principal, who may update any project (policy 036).
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import DateSelectField from '../DateSelectField';
import { saveProjectDates, validateProjectDates } from '../../../tools/analytics/data';
import { a } from './analyticsStyles';

interface Props {
  projectId: string;
  startDate: string | null;
  endDate: string | null;
  onSaved: () => void;
  toast?: (msg: string, type?: 'ok' | 'warning' | 'critical') => void;
}

export const canEditProjectDates = (role: string | null | undefined): boolean => role === 'admin' || role === 'principal';

export default function ProjectDatesEditor({ projectId, startDate, endDate, onSaved, toast }: Props) {
  const [start, setStart] = useState(startDate ?? '');
  const [end, setEnd] = useState(endDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const invalid = validateProjectDates(start, end);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      await saveProjectDates(projectId, start, end);
      toast?.('Tanggal proyek disimpan.', 'ok');
      onSaved();
    } catch (err) {
      setError((err as Error)?.message ?? 'Tanggal gagal disimpan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={a.subhead}>Tanggal proyek</Text>
      <Text style={a.hint}>Tanggal mulai</Text>
      <DateSelectField value={start} onChange={setStart} placeholder="Pilih tanggal mulai" minYear={2020} accessibilityLabel="Tanggal mulai proyek" />
      <Text style={a.hint}>Tanggal selesai rencana</Text>
      <DateSelectField value={end} onChange={setEnd} placeholder="Pilih tanggal selesai rencana" minYear={2020} accessibilityLabel="Tanggal selesai rencana" />
      {error ? <Text style={a.warn}>{error}</Text> : null}
      <TouchableOpacity style={[a.primaryBtn, busy && a.busy]} onPress={() => void save()} disabled={busy} accessibilityRole="button" accessibilityLabel="Simpan tanggal proyek">
        <Text style={a.primaryBtnText}>{busy ? 'Menyimpan...' : 'Simpan tanggal'}</Text>
      </TouchableOpacity>
    </View>
  );
}
