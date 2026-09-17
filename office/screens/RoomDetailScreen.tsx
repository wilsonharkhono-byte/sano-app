import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import RoomTimeline from '../../workflows/screens/siteEvent/RoomTimeline';
import { useProject } from '../../workflows/hooks/useProject';
import { listRoomsResult } from '../../tools/rooms';
import { normalizeRoomCode } from '../../tools/roomCodes';
import { buildRoomUrl } from '../../tools/roomLinks';
import { AREA_TYPE_LABELS, PROJECT_PHASE_LABELS } from '../../tools/constants';
import { todayIsoWIB } from '../../tools/timeWindow';
import type { Room } from '../../tools/types';
import { COLORS, FONTS, SPACE, TYPE } from '../../workflows/theme';

/**
 * Where a scanned label lands for admin, estimator and principal. The room
 * summary card itself is read-only — office roles author rooms in "Kelola
 * ruangan" — but the mounted `RoomTimeline` below it is not: it writes
 * `owner_id` and `due_date` through migration 099 for any office role or the
 * reporter, principal included, even though the principal is read-only
 * everywhere else by migration 090's seat rule. This screen exists so a
 * scanned QR does something sensible in every role rather than dead-ending.
 */
export default function RoomDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projects, profile } = useProject();
  const params = (route.params ?? {}) as { projectCode?: string; roomCode?: string };

  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const wantedCode = normalizeRoomCode(params.roomCode ?? '');
  const target = projects.find(
    (p) => p.code.toLowerCase() === (params.projectCode ?? '').toLowerCase(),
  );
  // Falls back to the database default until migration 096 is pasted:
  // select('*') on a projects row with no phase column yields undefined at
  // runtime, even though Project.phase is typed required.
  const phase = target?.phase ?? 'STRUKTUR';

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setRoomLoadError(null);
    if (!target) { if (alive.current) { setRoom(null); setLoading(false); } return; }
    const result = await listRoomsResult(target.id, { includeInactive: true });
    if (!alive.current) return;
    if (result.rooms === null) {
      // A failed read is not "ruangan tidak ada di proyek" (CLAUDE.md §12) —
      // offer a retry instead of sending someone to "Kelola ruangan" to fix a
      // room that is actually fine.
      setRoomLoadError('Gagal memuat ruangan. Periksa koneksi lalu coba lagi.');
      setRoom(null);
      setLoading(false);
      return;
    }
    setRoom(result.rooms.find((r) => r.room_code === wantedCode) ?? null);
    setLoading(false);
  }, [target, wantedCode]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading && <Card><Text style={styles.body}>Memuat ruangan…</Text></Card>}

        {!loading && !target && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.body}>
              Proyek dengan kode "{params.projectCode ?? '—'}" tidak ditemukan.
            </Text>
          </Card>
        )}

        {!loading && target && roomLoadError && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.body}>{roomLoadError}</Text>
            <TouchableOpacity onPress={() => void load()} accessibilityRole="button">
              <Text style={styles.retry}>Coba lagi</Text>
            </TouchableOpacity>
          </Card>
        )}

        {!loading && target && !roomLoadError && !room && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.body}>
              Ruangan {wantedCode || '—'} tidak ada di proyek {target.name}. Periksa di "Kelola ruangan".
            </Text>
          </Card>
        )}

        {!loading && target && room && (
          <Card title={room.room_name} subtitle={`${room.floor || 'Tanpa lantai'} · ${AREA_TYPE_LABELS[room.area_type]}`}>
            <Text style={styles.row}>Proyek: {target.name} ({target.code})</Text>
            <Text style={styles.row}>Fase: {PROJECT_PHASE_LABELS[phase] ?? phase}</Text>
            <Text style={styles.row}>Kode ruangan: {room.room_code}</Text>
            <Text style={styles.row}>Status: {room.active ? 'Aktif' : 'Nonaktif'}</Text>
            <Text style={styles.row}>
              Label QR: {room.qr_printed_at ? `tercetak ${new Date(room.qr_printed_at).toLocaleDateString('id-ID')}` : 'belum dicetak'}
            </Text>
            <Text style={styles.url}>{buildRoomUrl(target.code, room.room_code)}</Text>
            <Text style={styles.note}>
              Kelola ruangan ini dari tab Ruangan.
            </Text>
          </Card>
        )}

        {!loading && target && room && (
          <RoomTimeline
            roomId={room.id}
            projectId={target.id}
            viewer={{ id: profile?.id ?? null, role: profile?.role ?? null }}
            today={todayIsoWIB()}
            onOpenEvent={(eventId) => navigation.navigate('SiteEventDetail', { eventId, projectId: target.id })}
            onOpenSiteChange={() => navigation.navigate('Approvals')}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  body: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 20 },
  retry: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.critical, marginTop: SPACE.sm },
  row: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, paddingVertical: 2 },
  url: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm },
  note: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.md, lineHeight: 16 },
});
