import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import AssignmentEditor from './AssignmentEditor';
import {
  canClose, canEditAssignment, dueLabel, isOverdue, sortTimeline,
} from './timelineModel';
import { listRoomTimeline, signedMediaUrl, updateSiteEventAssignment, type TimelineEventRow } from '../../../tools/siteEvents';
import { getProjectTeam, type TeamMember } from '../../../tools/projectManagement';
import { SITE_EVENT_STATUS_LABELS, SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import type { SiteEventStatus } from '../../../tools/types';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../theme';

const TIMELINE_LIMIT = 50;

/** Tone per status; `discarded` never reaches this list (listRoomTimeline excludes it) but the map stays total. */
const STATUS_TONE: Record<SiteEventStatus, { fg: string; bg: string }> = {
  pending_analysis: { fg: COLORS.textSec, bg: COLORS.surfaceSunken },
  draft:            { fg: COLORS.info,    bg: COLORS.infoBg },
  open:             { fg: COLORS.warning, bg: COLORS.warningBg },
  done:             { fg: COLORS.ok,      bg: COLORS.okBg },
  discarded:        { fg: COLORS.textMuted, bg: COLORS.surfaceAlt },
};

/**
 * A room's events, newest first (spec §9). Thumbnails are signed one by one
 * through plan 2's storage routing, the transcript expands in place, and the
 * action row offers "Selesai", the owner and due-date edit, and the linked
 * Catatan Perubahan when the event has one.
 *
 * Who may do what is decided in timelineModel.ts, which restates the rules
 * migration 099 and 097's close_site_event enforce. The screen hides a control
 * the viewer cannot use; the database is still what refuses.
 *
 * Refetches on focus, the same pattern `OpenEventsList` uses on the card right
 * above this one on `RoomScreen` — otherwise closing an event on the detail
 * screen and coming back would leave two panels on one screen disagreeing
 * about the same event.
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

  const [rows, setRows] = useState<TimelineEventRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Guards state writes after three awaits (load) or one (save) land after
  // the screen has lost focus or unmounted.
  const alive = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, members] = await Promise.all([
      listRoomTimeline(roomId, projectId, TIMELINE_LIMIT),
      getProjectTeam(projectId),
    ]);
    if (!alive.current) return;
    if (res.error) {
      // A failed read is not "nothing happened here" (CLAUDE.md §12) — say so
      // and offer a retry, rather than rendering the empty-room state below.
      setLoadError('Riwayat kejadian gagal dimuat. Periksa koneksi lalu coba lagi.');
      setRows(null);
    } else {
      setLoadError(null);
      setRows(res.events);
    }
    setTeam(members);
    setLoading(false);

    // One signed URL per first photo. Signing every close-up on a room with
    // fifty events would be fifty round trips for pictures nobody scrolled to.
    const pairs = await Promise.all(
      (res.events ?? []).map(async (e) => {
        const first = e.media.find((m) => m.kind === 'photo');
        if (!first) return null;
        const url = await signedMediaUrl(first.storage_path);
        return url ? ([e.id, url] as const) : null;
      }),
    );
    if (!alive.current) return;
    setThumbs(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)));
  }, [roomId, projectId]);

  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void load();
      return () => { alive.current = false; };
    }, [load]),
  );

  const ordered = useMemo(() => sortTimeline(rows ?? []), [rows]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async (eventId: string, ownerId: string | null, dueDate: string | null) => {
    setSaving(true);
    setSaveError(null);
    const prevOwner = rows?.find((r) => r.id === eventId)?.owner_id ?? null;
    const res = await updateSiteEventAssignment(eventId, ownerId, dueDate);
    if (!alive.current) return;
    setSaving(false);
    if (res.error) { setSaveError({ id: eventId, message: res.error }); return; }
    // 099 skips the notification when the owner did not change or the actor
    // assigned themselves; only say something was due when one actually was.
    const notifyWasDue = !!ownerId && ownerId !== prevOwner && ownerId !== viewer?.id;
    setNotice(notifyWasDue && !res.result?.notified
      ? 'Perubahan tersimpan. Pemberitahuan ke pemilik baru belum terkirim — beri tahu langsung.'
      : null);
    setEditing(null);
    await load();
  };

  if (loading) return <Card title="Riwayat kejadian"><ActivityIndicator color={COLORS.primary} /></Card>;

  if (loadError) {
    return (
      <Card title="Riwayat kejadian">
        <Text style={styles.error}>{loadError}</Text>
        <TouchableOpacity
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Muat ulang riwayat kejadian"
          style={styles.retry}
        >
          <Text style={styles.link}>Coba lagi</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (ordered.length === 0) {
    return (
      <Card title="Riwayat kejadian">
        <Text style={styles.empty}>Belum ada kejadian di ruangan ini.</Text>
      </Card>
    );
  }

  return (
    <Card title={ordered.length >= TIMELINE_LIMIT ? `Riwayat kejadian (${TIMELINE_LIMIT} terbaru)` : `Riwayat kejadian (${ordered.length})`}>
      {notice && <Text style={styles.notice}>{notice}</Text>}
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
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: STATUS_TONE[e.status].bg }]}>
                    <Text
                      style={[styles.badgeText, { color: STATUS_TONE[e.status].fg }]}
                      accessibilityLabel={`Status: ${SITE_EVENT_STATUS_LABELS[e.status]}`}
                    >
                      {SITE_EVENT_STATUS_LABELS[e.status]}
                    </Text>
                  </View>
                </View>
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
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onOpenEvent(e.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Selesai untuk ${e.title ?? 'kejadian ini'}`}
                >
                  <Text style={styles.link}>Selesai</Text>
                </TouchableOpacity>
              )}
              {canEditAssignment(e, viewer) && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => { setSaveError(null); setEditing(editing === e.id ? null : e.id); }}
                  accessibilityRole="button"
                  accessibilityLabel={editing === e.id
                    ? 'Tutup formulir pemilik dan tenggat'
                    : `Ubah pemilik atau tenggat untuk ${e.title ?? 'kejadian ini'}`}
                >
                  <Text style={styles.link}>{editing === e.id ? 'Tutup' : 'Ubah pemilik / tenggat'}</Text>
                </TouchableOpacity>
              )}
              {e.site_change_id && onOpenSiteChange && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onOpenSiteChange(e.site_change_id!)}
                  accessibilityRole="button"
                  accessibilityLabel={`Lihat Catatan Perubahan untuk ${e.title ?? 'kejadian ini'}`}
                >
                  <Text style={styles.link}>Lihat Catatan Perubahan</Text>
                </TouchableOpacity>
              )}
            </View>

            {editing === e.id && (
              <AssignmentEditor
                event={e}
                team={team}
                today={today}
                saving={saving}
                serverError={saveError?.id === e.id ? saveError.message : null}
                onCancel={() => { setSaveError(null); setEditing(null); }}
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
  notice: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginBottom: SPACE.sm },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  row: { paddingVertical: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  head: { flexDirection: 'row', gap: SPACE.sm },
  thumb: { width: 48, height: 48, borderRadius: RADIUS_SM, backgroundColor: COLORS.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  headBody: { flex: 1 },
  title: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  badgeRow: { flexDirection: 'row', marginTop: 3 },
  badge: { paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: RADIUS_SM },
  badgeText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  meta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
  due: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginTop: 2 },
  dueLate: { color: COLORS.high, fontFamily: FONTS.bold },
  summary: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.xs, lineHeight: 18 },
  transcript: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 17, backgroundColor: COLORS.surfaceSunken, padding: SPACE.sm, borderRadius: RADIUS_SM },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, paddingVertical: 4 },
  actionBtn: { minHeight: 44, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: SPACE.md, flexWrap: 'wrap', marginTop: SPACE.xs },
});
