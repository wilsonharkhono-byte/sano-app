import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../../workflows/components/Card';
import {
  listRoomBoard, boardSummary, filterBoard, floorOptions, ownerOptions,
  lastUpdateLabel, openChips, type BoardFilters,
} from '../../../tools/roomBoard';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import type { RoomBoardRow, SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';

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
 */
export default function RoomBoardView(props: {
  projectId: string | null;
  onOpenRoom: (row: RoomBoardRow) => void;
  /** Rendered in the strip card's title row. The office tab puts its sub-screen link here. */
  headerAction?: React.ReactNode;
  /** Phone layout wraps the filter pills instead of overflowing a 360dp screen. */
  compact?: boolean;
}) {
  const { projectId, onOpenRoom, headerAction, compact } = props;

  const [rows, setRows] = useState<RoomBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<BoardFilters>({});

  const load = useCallback(async () => {
    if (!projectId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setRows(await listRoomBoard(projectId));
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => boardSummary(rows), [rows]);
  const shown = useMemo(() => filterBoard(rows, filters), [rows, filters]);
  const floors = useMemo(() => floorOptions(rows), [rows]);
  const owners = useMemo(() => ownerOptions(rows), [rows]);

  // Floors in board order; the comparator already put Area Umum and the
  // floorless rooms last, so first-appearance order is the right order.
  const byFloor = useMemo(() => {
    const groups: Array<[string, RoomBoardRow[]]> = [];
    for (const r of shown) {
      const key = r.floor || 'Tanpa lantai';
      const last = groups[groups.length - 1];
      if (last && last[0] === key) last[1].push(r);
      else groups.push([key, [r]]);
    }
    return groups;
  }, [shown]);

  const setFilter = (patch: BoardFilters) => setFilters((prev) => ({ ...prev, ...patch }));
  const anyFilter = filters.floor != null || !!filters.eventType || !!filters.owner || !!filters.overdueOnly;

  if (!projectId) {
    return <Card><Text style={styles.empty}>Pilih proyek terlebih dahulu.</Text></Card>;
  }

  return (
    <>
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

      {!loading && shown.length === 0 && (
        <Card>
          <Text style={styles.empty}>
            {rows.length === 0
              ? 'Belum ada ruangan di proyek ini. Buat ruangan di "Kelola ruangan".'
              : 'Tidak ada ruangan yang cocok dengan saringan ini.'}
          </Text>
        </Card>
      )}

      {!loading && byFloor.map(([floor, group]) => (
        <Card key={floor} title={floor}>
          {group.map((r) => (
            <TouchableOpacity
              key={r.room_id}
              style={[styles.roomRow, r.is_quiet && styles.quiet]}
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
    </>
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
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },
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
});
