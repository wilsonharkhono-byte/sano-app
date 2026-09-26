import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../../workflows/components/Card';
import {
  listRoomBoard, boardSummary, filterBoard, floorGroupKey, floorOptions, isQuietRoom, ownerOptions,
  lastUpdateLabel, openChips, type BoardFilters,
} from '../../../tools/roomBoard';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { pendingCloseFor, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
import type { RoomBoardRow, SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';
import AttentionList from './AttentionList';
import DigestHealthLine from './DigestHealthLine';

/**
 * Papan Ruangan (spec §9). One read of v_room_board, the summary strip, the
 * filters, and room cards grouped by floor. Shared by all three role layouts:
 * the office tab, the principal tab and the supervisor's phone screen. The
 * only thing that varies is `onOpenRoom`, because a supervisor's room screen
 * and an office room detail are different routes.
 *
 * Nothing here derives a verdict. The strip counts what is open and what is
 * late; a room with no events reads "Belum ada kejadian", never "selesai".
 * Rooms sort through tools/clientReportRooms.ts, the same comparator the
 * client report uses, so the board and the report agree (spec §9).
 *
 * Owns its own scroll container (ScrollView + pull-to-refresh) so every
 * mount screen gets the same freshness behaviour for free: refetch on focus
 * (a bottom-tab screen stays mounted across tab switches, so without this a
 * confirmed site event elsewhere would not show up here until an app
 * restart) plus a manual pull-to-refresh.
 */
export default function RoomBoardView(props: {
  projectId: string | null;
  onOpenRoom: (row: RoomBoardRow) => void;
  /** Rendered in the strip card's title row. The office tab puts its sub-screen link here. */
  headerAction?: React.ReactNode;
  /** Phone layout wraps the filter pills instead of overflowing a 360dp screen. */
  compact?: boolean;
  /** The signed-in profile: "Milik saya" and this phone's pending closes. */
  viewerId: string | null;
  /** "Perlu ditindak" row tap (closure spec §5.6). */
  onOpenEvent: (eventId: string, projectId: string) => void;
  /** Office and principal layouts name each item's owner. */
  showOwners?: boolean;
  /** Office and principal layouts show when the morning digest last went out. */
  showDigestHealth?: boolean;
  /** From a digest notification's params; a fresh object per tap re-applies it. */
  mineRequest?: { mine: boolean } | null;
}) {
  const { projectId, onOpenRoom, headerAction, compact, viewerId, onOpenEvent, showOwners, showDigestHealth, mineRequest } = props;

  // Close jobs still on this phone, so "Perlu ditindak" can say "Menunggu
  // kirim" on a row the server still has open (closure spec §4.5).
  const queue = useCaptureQueueEntries(viewerId);
  const pendingEventIds = useMemo(
    () => new Set(queue.flatMap((e) => (e.kind === 'close' && pendingCloseFor(queue, e.eventId) ? [e.eventId] : []))),
    [queue],
  );
  // The list and the health line read once on mount by themselves; this is
  // bumped on every focus after the first and on pull-to-refresh, so they
  // refetch with the board: one read each on mount, one per focus.
  const [reloadKey, setReloadKey] = useState(0);
  const focusedBefore = useRef(false);
  // The project the rows on screen were read for, and the number of the
  // latest read: a refetch of the same project is silent, a project switch
  // shows the spinner, and a slow earlier answer never overwrites a newer one.
  const rowsFor = useRef<string | null>(null);
  const request = useRef(0);

  const [rows, setRows] = useState<RoomBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>({});

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const id = ++request.current;
    if (!projectId) {
      rowsFor.current = null;
      setRows([]);
      setLoadError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!opts.silent || rowsFor.current !== projectId) setLoading(true);
    const result = await listRoomBoard(projectId);
    if (id !== request.current) return;
    rowsFor.current = projectId;
    if ('error' in result) {
      // A fetch failure is never "no rooms" (CLAUDE.md §12): stale rows are
      // dropped so the error state below is the only thing shown, rather than
      // a confident-looking (and possibly outdated) list next to a warning.
      setLoadError(result.error);
      setRows([]);
    } else {
      setLoadError(null);
      setRows(result.rooms);
    }
    setLoading(false);
    setRefreshing(false);
  }, [projectId]);

  // The one load on mount, and a refetch whenever this screen regains focus
  // (useFocusEffect runs on mount when the screen is focused, and again when
  // `load` changes with the project). Bottom-tab navigators keep screens
  // mounted across tab switches, so without this a supervisor who confirms a
  // site event elsewhere and comes back to Papan Ruangan would see stale
  // open-counts and overdue badges until a full app reload. Silent: no
  // full-screen spinner on every tab switch (same convention as
  // NotificationsScreen's focus refetch).
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) setReloadKey((k) => k + 1);
      focusedBefore.current = true;
      void load({ silent: true });
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    void load({ silent: true });
  }, [load]);

  // v_room_board is read in full (active and inactive) so one query can both
  // show the board and say how many rooms are hidden from it, rather than
  // hiding inactive rooms silently with no way to tell "no hambatan" from
  // "hambatan on a room that got deactivated".
  const activeRows = useMemo(() => rows.filter((r) => r.active), [rows]);
  const inactiveCount = rows.length - activeRows.length;

  const summary = useMemo(() => boardSummary(activeRows), [activeRows]);
  const shown = useMemo(() => filterBoard(activeRows, filters), [activeRows, filters]);
  const floors = useMemo(() => floorOptions(activeRows), [activeRows]);
  const owners = useMemo(() => ownerOptions(activeRows), [activeRows]);

  // Floors in board order, grouped by the SAME normalised key filterBoard and
  // floorOptions use (see roomBoard.ts's floorGroupKey) so "2", "Lt. 2" and
  // "Lantai 2" render as one header instead of three. The comparator already
  // sorts same-floor rows adjacent, so first-appearance order is the right
  // order; the header shows the first raw label seen for the group.
  const byFloor = useMemo(() => {
    const groups: Array<{ key: string; label: string; rows: RoomBoardRow[] }> = [];
    for (const r of shown) {
      const key = floorGroupKey(r.floor);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else groups.push({ key, label: r.floor || 'Tanpa lantai', rows: [r] });
    }
    return groups;
  }, [shown]);

  const setFilter = (patch: BoardFilters) => setFilters((prev) => ({ ...prev, ...patch }));
  const anyFilter = filters.floor != null || !!filters.eventType || !!filters.owner || !!filters.overdueOnly;

  if (!projectId) {
    return <Card><Text style={styles.empty}>Pilih proyek terlebih dahulu.</Text></Card>;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />
      )}
    >
      <AttentionList
        projectId={projectId}
        viewerId={viewerId}
        showOwner={!!showOwners}
        mineRequest={mineRequest}
        pendingEventIds={pendingEventIds}
        onOpenEvent={onOpenEvent}
        reloadKey={reloadKey}
      />
      {showDigestHealth ? <DigestHealthLine reloadKey={reloadKey} /> : null}

      <Card title="Papan Ruangan" subtitle="Ringkasan kejadian per ruangan." rightAction={headerAction}>
        <View style={styles.strip}>
          <Stat label="Hambatan" value={summary.hambatan} color={COLORS.critical} />
          <Stat label="Lewat tenggat" value={summary.overdue} color={COLORS.high} />
          <Stat label="Butuh keputusan" value={summary.butuhKeputusan} color={COLORS.warning} />
          <Stat label="Sepi > 3 hari" value={summary.quietRooms} color={COLORS.textMuted} />
        </View>
      </Card>

      <Card title="Saringan">
        <View style={[styles.pillRow, compact && styles.pillRowWrap]}>
          <Pill label="Semua lantai" on={filters.floor == null} onPress={() => setFilter({ floor: null })} />
          {floors.map((f) => (
            <Pill
              key={f || 'none'}
              label={f || 'Tanpa lantai'}
              on={filters.floor === f}
              onPress={() => setFilter({ floor: filters.floor === f ? null : f })}
            />
          ))}
        </View>
        <View style={[styles.pillRow, compact && styles.pillRowWrap]}>
          {(Object.keys(SITE_EVENT_TYPE_LABELS) as SiteEventType[]).map((t) => (
            <Pill
              key={t}
              label={SITE_EVENT_TYPE_LABELS[t]}
              on={filters.eventType === t}
              onPress={() => setFilter({ eventType: filters.eventType === t ? null : t })}
            />
          ))}
        </View>
        <View style={[styles.pillRow, compact && styles.pillRowWrap]}>
          {owners.map((o) => (
            <Pill key={o} label={o} on={filters.owner === o} onPress={() => setFilter({ owner: filters.owner === o ? null : o })} />
          ))}
          <Pill
            label="Lewat tenggat"
            on={!!filters.overdueOnly}
            onPress={() => setFilter({ overdueOnly: !filters.overdueOnly })}
          />
          {anyFilter && (
            <TouchableOpacity onPress={() => setFilters({})} accessibilityRole="button">
              <Text style={styles.clear}>Hapus saringan</Text>
            </TouchableOpacity>
          )}
        </View>
      </Card>

      {loading && <Card><ActivityIndicator color={COLORS.primary} /></Card>}

      {!loading && loadError && (
        <Card>
          <Text style={styles.errorText}>
            Papan Ruangan gagal dimuat. Periksa koneksi lalu coba lagi.
          </Text>
          <TouchableOpacity onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
            <Text style={styles.retryBtnText}>Coba lagi</Text>
          </TouchableOpacity>
        </Card>
      )}

      {!loading && !loadError && shown.length === 0 && (
        <Card>
          <Text style={styles.empty}>
            {activeRows.length === 0
              ? 'Belum ada ruangan di proyek ini. Buat ruangan di "Kelola ruangan".'
              : 'Tidak ada ruangan yang cocok dengan saringan ini.'}
          </Text>
        </Card>
      )}

      {!loading && !loadError && byFloor.map((g) => (
        <Card key={g.key} title={g.label}>
          {g.rows.map((r) => (
            <TouchableOpacity
              key={r.room_id}
              style={[styles.roomRow, isQuietRoom(r) && styles.quiet]}
              onPress={() => onOpenRoom(r)}
              accessibilityRole="button"
              accessibilityLabel={`Buka ruangan ${r.room_name}`}
            >
              <View style={styles.roomHead}>
                <Text style={styles.roomName}>{r.room_name}</Text>
                {r.overdue_count > 0 && (
                  <View style={styles.overdue}>
                    <Text style={styles.overdueText}>{r.overdue_count} lewat tenggat</Text>
                  </View>
                )}
              </View>
              <Text style={styles.roomMeta}>
                {r.last_gate_code
                  ? `Gerbang ${r.last_gate_code}${r.last_step_code ? ` · ${r.last_step_code}` : ''}`
                  : 'Belum ada gerbang'}
                {' · '}{lastUpdateLabel(r.last_event_at)}
              </Text>
              <View style={styles.chipRow}>
                {openChips(r).map((c) => (
                  <View key={c.type} style={styles.chip}>
                    <Text style={styles.chipText}>{c.label} {c.count}</Text>
                  </View>
                ))}
                {openChips(r).length === 0 && <Text style={styles.noneText}>Tidak ada kejadian terbuka</Text>}
                {r.owner_initials.length > 0 && (
                  <Text style={styles.owners}>
                    <Ionicons name="person-outline" size={11} color={COLORS.textSec} /> {r.owner_initials.join(' · ')}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      ))}

      {!loading && !loadError && inactiveCount > 0 && (
        <Text style={styles.inactiveNote}>{inactiveCount} ruangan nonaktif disembunyikan.</Text>
      )}
    </ScrollView>
  );
}

function Stat(props: { label: string; value: number; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: props.value > 0 ? props.color : COLORS.textMuted }]}>{props.value}</Text>
      <Text style={styles.statLabel}>{props.label}</Text>
    </View>
  );
}

function Pill(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.pill, props.on && styles.pillOn]}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.on }}
    >
      <Text style={[styles.pillText, props.on && styles.pillTextOn]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },
  errorText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.critical, lineHeight: 18, marginBottom: SPACE.sm },
  retryBtn: { alignSelf: 'flex-start', backgroundColor: COLORS.critical, borderRadius: RADIUS_SM, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.base },
  retryBtnText: { color: COLORS.textInverse, fontSize: TYPE.xs, fontFamily: FONTS.semibold, textTransform: 'uppercase', letterSpacing: 0.3 },
  strip: { flexDirection: 'row', gap: SPACE.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: SPACE.sm, backgroundColor: COLORS.surfaceSunken, borderRadius: RADIUS_SM },
  statValue: { fontSize: TYPE.xl, fontFamily: FONTS.bold },
  statLabel: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textSec, textAlign: 'center', marginTop: 2 },
  pillRow: { flexDirection: 'row', gap: SPACE.xs, alignItems: 'center', marginBottom: SPACE.xs },
  pillRowWrap: { flexWrap: 'wrap' },
  pill: { paddingHorizontal: SPACE.sm, paddingVertical: 5, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border },
  pillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  pillTextOn: { color: COLORS.textInverse },
  clear: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, paddingHorizontal: SPACE.xs },
  roomRow: { paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  quiet: { opacity: 0.55 },
  roomHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm },
  roomName: { flex: 1, fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  overdue: { backgroundColor: COLORS.highBg, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  overdueText: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.high, textTransform: 'uppercase', letterSpacing: 0.4 },
  roomMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center', marginTop: SPACE.xs },
  chip: { backgroundColor: COLORS.accentBg, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipText: { fontSize: 10, fontFamily: FONTS.semibold, color: COLORS.accentDark },
  noneText: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted },
  owners: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginLeft: 'auto' },
  inactiveNote: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACE.sm },
});
