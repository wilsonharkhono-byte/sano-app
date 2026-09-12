import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import OwnerField from './OwnerField';
import DueDateField from './DueDateField';
import { validateAssignment, type TimelineEvent } from './timelineModel';
import { isActionableType } from '../../../tools/siteEventRules';
import type { TeamMember } from '../../../tools/projectManagement';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

/**
 * Owner and due date on an already-confirmed event (spec §9), saved through
 * migration 099's update_site_event_assignment. The form re-applies 099's rules
 * before the round trip so the refusal arrives as a sentence under the field
 * rather than as a Postgres error after a spinner; 099 is still the authority,
 * and its message is shown verbatim when it disagrees.
 *
 * Reuses plan 2's OwnerField and DueDateField so an owner is picked the same
 * way here as on the confirm screen.
 */
export default function AssignmentEditor(props: {
  event: TimelineEvent;
  team: TeamMember[];
  today: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (ownerId: string | null, dueDate: string | null) => void;
}) {
  const { event, team, today, saving, onCancel, onSave } = props;
  const [ownerId, setOwnerId] = useState<string | null>(event.owner_id);
  const [dueDate, setDueDate] = useState<string>(event.due_date ?? '');
  const [error, setError] = useState<string | null>(null);

  const actionable = isActionableType(event.event_type);

  const submit = () => {
    const next = { ownerId, dueDate: dueDate.trim() || null };
    const problem = validateAssignment(event, next, today);
    setError(problem);
    if (problem) return;
    onSave(next.ownerId, next.dueDate);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Pemilik</Text>
      <OwnerField team={team} value={ownerId} onChange={setOwnerId} required={actionable} disabled={saving} />
      <Text style={styles.label}>Tenggat</Text>
      <DueDateField value={dueDate} onChange={setDueDate} today={today} required={actionable} disabled={saving} />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghostBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.ghostText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
          <Text style={styles.primaryText}>{saving ? 'Menyimpan…' : 'Simpan'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: SPACE.sm, gap: SPACE.xs },
  label: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical, marginTop: SPACE.xs, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  primaryBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },
});
