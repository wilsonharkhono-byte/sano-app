import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Card from '../../../workflows/components/Card';
import {
  attentionChips, attentionEmptyText, attentionHeading, attentionRoomLabel, filterMine, listSiteEventAttention,
  type AttentionChipTone, type AttentionRow,
} from '../../../tools/siteEventAttention';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';

export interface AttentionListProps {
  projectId: string;
  /** The signed-in profile, for "Milik saya". */
  viewerId: string | null;
  /** Office and principal layouts name the owner on each row. */
  showOwner: boolean;
  /**
   * Set from a notification tap's params (spec §5.6). A fresh object per tap
   * re-applies `mine` even when the list is already on screen, because
   * routeDeeplink copies params (workflows/pendingDeeplink.ts).
   */
  mineRequest?: { mine: boolean } | null;
  /** Events this phone holds a pending close job for (captureQueueStore.pendingCloseFor). */
  pendingEventIds: ReadonlySet<string>;
  onOpenEvent: (eventId: string, projectId: string) => void;
  /**
   * Bumped by the board on every focus after the first and on pull-to-refresh,
   * so this list refetches with it. The list reads once on mount by itself.
   */
  reloadKey?: number;
}

/** What the last read that counted returned, and for which project. */
type Loaded = { projectId: string; rows: AttentionRow[] } | { projectId: string; error: string };

const CHIP_TONE: Record<AttentionChipTone, { fg: string; bg: string }> = {
  late: { fg: COLORS.high, bg: COLORS.highBg },
  block: { fg: COLORS.critical, bg: COLORS.criticalBg },
  pending: { fg: COLORS.info, bg: COLORS.infoBg },
  owner: { fg: COLORS.accentDark, bg: COLORS.accentBg },
  unowned: { fg: COLORS.warning, bg: COLORS.warningBg },
};

/**
 * "Perlu ditindak" (closure spec 2026-09-26 §5.6): the same rows the 07:00
 * digest counts, at the top of Papan Ruangan for every role. A failed read is
 * shown as a failed read, never as "nothing to do" (spec §1.1 rule 4).
 */
export default function AttentionList(props: AttentionListProps) {
  const { projectId, viewerId, showOwner, mineRequest, pendingEventIds, onOpenEvent, reloadKey } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mine, setMine] = useState(mineRequest?.mine ?? false);
  // Every read takes a number; only the latest one may land, so a slow
  // earlier answer can never overwrite a newer one.
  const request = useRef(0);

  useEffect(() => {
    if (mineRequest) setMine(mineRequest.mine);
  }, [mineRequest]);

  const load = useCallback(async () => {
    const id = ++request.current;
    // A refresh keeps the rows on screen until the new ones arrive; a retry
    // after a failed read goes back to the spinner.
    setLoaded((prev) => (prev && 'error' in prev ? null : prev));
    const result = await listSiteEventAttention(projectId);
    if (id !== request.current) return;
    setLoaded('error' in result ? { projectId, error: result.error } : { projectId, rows: result.rows });
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Only what was read for THIS project: after a project switch the spinner
  // shows until its own rows arrive, never the previous project's rows.
  const current = loaded && loaded.projectId === projectId ? loaded : null;
  const rows = current && 'rows' in current ? current.rows : null;
  const error = current && 'error' in current ? current.error : null;
  const loading = current === null;

  const shown = useMemo(() => (rows ? (mine ? filterMine(rows, viewerId) : rows) : []), [rows, mine, viewerId]);
  const title = rows ? attentionHeading(rows.length, shown.length, mine) : 'Perlu ditindak';

  const minePill = (
    <TouchableOpacity
      style={[styles.pill, mine && styles.pillOn]}
      onPress={() => setMine((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ selected: mine }}
      accessibilityLabel="Milik saya"
    >
      <Text style={[styles.pillText, mine && styles.pillTextOn]}>Milik saya</Text>
    </TouchableOpacity>
  );

  return (
    <Card title={title} borderColor={shown.length > 0 ? COLORS.high : undefined} rightAction={minePill}>
      {loading ? <ActivityIndicator color={COLORS.primary} accessibilityLabel="Memuat daftar perlu ditindak" /> : null}

      {!loading && error !== null ? (
        <View>
          <Text style={styles.errorText}>Daftar perlu ditindak gagal dimuat. Periksa koneksi lalu coba lagi.</Text>
          <TouchableOpacity onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
            <Text style={styles.retryText}>Coba lagi</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!loading && error === null && shown.length === 0 ? (
        <Text style={styles.empty}>{attentionEmptyText(rows?.length ?? 0, mine)}</Text>
      ) : null}

      {!loading && error === null
        ? shown.map((r) => (
          <TouchableOpacity
            key={r.event_id}
            style={styles.row}
            onPress={() => onOpenEvent(r.event_id, r.project_id)}
            accessibilityRole="button"
            accessibilityLabel={`Buka kejadian ${r.title ?? 'tanpa judul'}`}
          >
            <Text style={styles.room}>{attentionRoomLabel(r)}</Text>
            <Text style={styles.title} numberOfLines={2}>{r.title ?? 'Kejadian lapangan'}</Text>
            <View style={styles.chipRow}>
              {attentionChips(r, { showOwner, closePending: pendingEventIds.has(r.event_id) }).map((c) => (
                <View key={c.label} style={[styles.chip, { backgroundColor: CHIP_TONE[c.tone].bg }]}>
                  <Text style={[styles.chipText, { color: CHIP_TONE[c.tone].fg }]}>{c.label}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },
  errorText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.critical, lineHeight: 18, marginBottom: SPACE.sm },
  retryBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase' },
  pill: { paddingHorizontal: SPACE.sm, paddingVertical: 5, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border },
  pillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  pillTextOn: { color: COLORS.textInverse },
  row: { paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub, minHeight: 48 },
  room: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  title: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.xs },
  chip: { borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipText: { fontSize: 10, fontFamily: FONTS.semibold },
});
