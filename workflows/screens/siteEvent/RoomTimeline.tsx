import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import AssignmentEditor from './AssignmentEditor';
import {
  canClose, canEditAssignment, dueLabel, isOverdue, sortTimeline, type TimelineEvent,
} from './timelineModel';
import { listRoomTimeline, signedMediaUrl, updateSiteEventAssignment, type TimelineEventRow } from '../../../tools/siteEvents';
import { getProjectTeam, type TeamMember } from '../../../tools/projectManagement';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../theme';

/**
 * A room's events, newest first (spec §9). Thumbnails are signed one by one
 * through plan 2's storage routing, the transcript expands in place, and the
 * action row offers "Selesai", the owner and due-date edit, and the linked
 * Catatan Perubahan when the event has one.
 *
 * Who may do what is decided in timelineModel.ts, which restates the rules
 * migration 099 and 097's close_site_event enforce. The screen hides a control
 * the viewer cannot use; the database is still what refuses.
 */
export default function RoomTimeline(props: {
  roomId: string;
  projectId: string;
  viewer: { id: string | null; role: string | null } | null;
  today: string;
  /** Provided where a "Selesai" flow exists (plan 2 task 14's detail screen). */
  onOpenEvent?: (eventId: string) => void;
  onOpenSiteChange?: (siteChangeId: string) => void;
}) {
  const { roomId, projectId, viewer, today, onOpenEvent, onOpenSiteChange } = props;

  const [rows, setRows] = useState<TimelineEventRow[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [events, members] = await Promise.all([listRoomTimeline(roomId), getProjectTeam(projectId)]);
    setRows(events);
    setTeam(members);
    setLoading(false);

    // One signed URL per first photo. Signing every close-up on a room with
    // fifty events would be fifty round trips for pictures nobody scrolled to.
    const pairs = await Promise.all(
      events.map(async (e) => {
        const first = e.media.find((m) => m.kind === 'photo');
        if (!first) return null;
        const url = await signedMediaUrl(first.storage_path);
        return url ? ([e.id, url] as const) : null;
      }),
    );
    setThumbs(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)));
  }, [roomId, projectId]);

  useEffect(() => { void load(); }, [load]);

  const ordered = useMemo(() => sortTimeline(rows), [rows]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async (eventId: string, ownerId: string | null, dueDate: string | null) => {
    setSaving(true);
    setError(null);
    const res = await updateSiteEventAssignment(eventId, ownerId, dueDate);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setEditing(null);
    await load();
  };

  if (loading) return <Card title="Riwayat kejadian"><ActivityIndicator color={COLORS.primary} /></Card>;

  if (ordered.length === 0) {
    return (
      <Card title="Riwayat kejadian">
        <Text style={styles.empty}>Belum ada kejadian di ruangan ini.</Text>
      </Card>
    );
  }

  return (
    <Card title={`Riwayat kejadian (${ordered.length})`}>
      {error && <Text style={styles.error}>{error}</Text>}
      {ordered.map((e) => {
        const open = expanded.has(e.id);
        const transcript = e.transcript_edited ?? e.transcript;
        const late = isOverdue(e, today);
        return (
          <View key={e.id} style={styles.row}>
            <View style={styles.head}>
              {thumbs[e.id]
                ? <Image source={{ uri: thumbs[e.id] }} style={styles.thumb} accessibilityIgnoresInvertColors />
                : <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="image-outline" size={16} color={COLORS.textMuted} /></View>}
              <View style={styles.headBody}>
                <Text style={styles.title} numberOfLines={2}>{e.title ?? 'Menunggu konfirmasi'}</Text>
                <Text style={styles.meta}>
                  {e.event_type ? SITE_EVENT_TYPE_LABELS[e.event_type] : 'Draf'}
                  {e.gate_code ? ` · ${e.gate_code}${e.step_code ? ` ${e.step_code}` : ''}` : ''}
                  {e.owner_name ? ` · ${e.owner_name}` : ''}
                </Text>
                {dueLabel(e, today) && (
                  <Text style={[styles.due, late && styles.dueLate]}>{dueLabel(e, today)}</Text>
                )}
              </View>
            </View>

            {e.summary && <Text style={styles.summary}>{e.summary}</Text>}

            {transcript && (
              <TouchableOpacity onPress={() => toggle(e.id)} accessibilityRole="button">
                <Text style={styles.link}>{open ? 'Sembunyikan transkrip' : 'Lihat transkrip'}</Text>
              </TouchableOpacity>
            )}
            {open && transcript && <Text style={styles.transcript}>{transcript}</Text>}

            <View style={styles.actions}>
              {canClose(e) && onOpenEvent && (
                <TouchableOpacity onPress={() => onOpenEvent(e.id)} accessibilityRole="button">
                  <Text style={styles.link}>Selesai</Text>
                </TouchableOpacity>
              )}
              {canEditAssignment(e, viewer) && (
                <TouchableOpacity onPress={() => setEditing(editing === e.id ? null : e.id)} accessibilityRole="button">
                  <Text style={styles.link}>{editing === e.id ? 'Tutup' : 'Ubah pemilik / tenggat'}</Text>
                </TouchableOpacity>
              )}
              {e.site_change_id && onOpenSiteChange && (
                <TouchableOpacity onPress={() => onOpenSiteChange(e.site_change_id!)} accessibilityRole="button">
                  <Text style={styles.link}>Buka Catatan Perubahan</Text>
                </TouchableOpacity>
              )}
            </View>

            {editing === e.id && (
              <AssignmentEditor
                event={e as TimelineEvent}
                team={team}
                today={today}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(ownerId, dueDate) => void save(e.id, ownerId, dueDate)}
              />
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  error: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical, marginBottom: SPACE.sm },
  row: { paddingVertical: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  head: { flexDirection: 'row', gap: SPACE.sm },
  thumb: { width: 48, height: 48, borderRadius: RADIUS_SM, backgroundColor: COLORS.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  headBody: { flex: 1 },
  title: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  meta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
  due: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginTop: 2 },
  dueLate: { color: COLORS.high, fontFamily: FONTS.bold },
  summary: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.xs, lineHeight: 18 },
  transcript: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 17, backgroundColor: COLORS.surfaceSunken, padding: SPACE.sm, borderRadius: RADIUS_SM },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, paddingVertical: 4 },
  actions: { flexDirection: 'row', gap: SPACE.md, flexWrap: 'wrap', marginTop: SPACE.xs },
});
