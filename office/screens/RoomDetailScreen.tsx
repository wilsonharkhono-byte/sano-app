import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useProject } from '../../workflows/hooks/useProject';
import { listRooms } from '../../tools/rooms';
import { normalizeRoomCode } from '../../tools/roomCodes';
import { buildRoomUrl } from '../../tools/roomLinks';
import { AREA_TYPE_LABELS, PROJECT_PHASE_LABELS } from '../../tools/constants';
import type { Room } from '../../tools/types';
import { COLORS, FONTS, SPACE, TYPE } from '../../workflows/theme';

/**
 * Where a scanned label lands for admin, estimator and principal: read-only.
 * Office roles author rooms in "Kelola ruangan"; this screen exists so a
 * scanned QR does something sensible in every role rather than dead-ending.
 */
export default function RoomDetailScreen() {
  const route = useRoute<any>();
  const { projects } = useProject();
  const params = (route.params ?? {}) as { projectCode?: string; roomCode?: string };

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);

  const wantedCode = normalizeRoomCode(params.roomCode ?? '');
  const target = projects.find(
    (p) => p.code.toLowerCase() === (params.projectCode ?? '').toLowerCase(),
  );
  // Falls back to the database default until migration 096 is pasted:
  // select('*') on a projects row with no phase column yields undefined at
  // runtime, even though Project.phase is typed required.
  const phase = target?.phase ?? 'STRUKTUR';

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (!target) { if (alive) { setRoom(null); setLoading(false); } return; }
      const all = await listRooms(target.id, { includeInactive: true });
      if (!alive) return;
      setRoom(all.find((r) => r.room_code === wantedCode) ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [target, wantedCode]);

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

        {!loading && target && !room && (
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
              Kelola ruangan ini dari tab Ruangan. Riwayat kejadian menyusul pada pembaruan berikutnya.
            </Text>
          </Card>
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
  row: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, paddingVertical: 2 },
  url: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm },
  note: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.md, lineHeight: 16 },
});
