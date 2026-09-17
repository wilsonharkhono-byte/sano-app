import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { listRoomsResult } from '../../tools/rooms';
import { listGateRefs, gateChipLabel } from '../../tools/gateRefs';
import { normalizeRoomCode } from '../../tools/roomCodes';
import { AREA_TYPE_LABELS, PROJECT_PHASE_LABELS } from '../../tools/constants';
import { todayIsoWIB } from '../../tools/timeWindow';
import type { GateRef, Room } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../theme';
import OpenEventsList from './siteEvent/OpenEventsList';
import RoomTimeline from './siteEvent/RoomTimeline';

type Refusal = 'not-assigned' | 'not-found' | 'inactive' | 'read-failed';

const REFUSAL_COPY: Record<Refusal, string> = {
  'not-assigned': 'Anda tidak ditugaskan ke proyek ini.',
  'not-found':    'Ruangan ini tidak ditemukan di proyek tersebut. Periksa labelnya atau hubungi kantor.',
  'inactive':     'Ruangan ini sudah tidak aktif. Hubungi kantor.',
  // A failed read is not "ruangan tidak ditemukan" (CLAUDE.md §12) — that
  // sends a supervisor standing in a real room to re-scan a label that isn't
  // the problem. This is the only refusal offering "Coba lagi" instead of
  // "Pilih ruangan lain".
  'read-failed':  'Gagal memuat ruangan. Periksa koneksi lalu coba lagi.',
};

/**
 * Where a scanned label lands. The room's open events and the "Lapor" entry
 * point (plan 2). Every failure is one of the three explicit refusals from
 * spec §8 - a blank screen would be the worst possible answer to a supervisor
 * standing in the room holding a phone.
 */
export default function RoomScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projects, project, setActiveProject, profile } = useProject();
  const params = (route.params ?? {}) as { projectCode?: string; roomCode?: string };

  const [room, setRoom] = useState<Room | null>(null);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [loading, setLoading] = useState(true);

  const wantedCode = normalizeRoomCode(params.roomCode ?? '');
  const target = projects.find(
    (p) => p.code.toLowerCase() === (params.projectCode ?? '').toLowerCase(),
  );

  // Switch the whole app to the scanned project so Header, and everything else
  // reading useProject(), agree with what is on screen.
  useEffect(() => {
    if (target && target.id !== project?.id) setActiveProject(target.id);
  }, [target, project?.id, setActiveProject]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setRefusal(null);
    if (!target) {
      if (alive.current) { setRefusal('not-assigned'); setLoading(false); }
      return;
    }
    const [roomsResult, g] = await Promise.all([
      listRoomsResult(target.id, { includeInactive: true }),
      listGateRefs({ activeOnly: true }),
    ]);
    if (!alive.current) return;
    if (roomsResult.rooms === null) {
      setRoom(null);
      setRefusal('read-failed');
      setLoading(false);
      return;
    }
    const found = roomsResult.rooms.find((r) => r.room_code === wantedCode) ?? null;
    setRoom(found);
    setGates(g);
    if (!found) setRefusal('not-found');
    else if (!found.active) setRefusal('inactive');
    setLoading(false);
  }, [target, wantedCode]);

  useEffect(() => {
    void load();
  }, [load]);

  // Falls back to the database default until migration 096 is pasted:
  // select('*') on a projects row with no phase column yields undefined at
  // runtime, even though Project.phase is typed required.
  const phase = target?.phase ?? 'STRUKTUR';
  const phaseLabel = target ? PROJECT_PHASE_LABELS[phase] ?? phase : '';

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Beranda')}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={styles.backText}>Beranda</Text>
        </TouchableOpacity>

        {loading && <Card><Text style={styles.empty}>Memuat ruangan…</Text></Card>}

        {!loading && refusal && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.refusal}>{REFUSAL_COPY[refusal]}</Text>
            {refusal !== 'read-failed' && (
              <Text style={styles.refusalMeta}>
                Kode dipindai: {params.projectCode ?? '—'} / {wantedCode || '—'}
              </Text>
            )}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => (refusal === 'read-failed' ? void load() : navigation.navigate('RoomScan'))}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{refusal === 'read-failed' ? 'Coba lagi' : 'Pilih ruangan lain'}</Text>
            </TouchableOpacity>
          </Card>
        )}

        {!loading && !refusal && room && (
          <>
            <Card>
              <Text style={styles.roomName}>{room.room_name}</Text>
              <Text style={styles.roomMeta}>
                {(room.floor || 'Tanpa lantai')} · {AREA_TYPE_LABELS[room.area_type]}
              </Text>
              <View style={styles.phasePill}>
                <Text style={styles.phaseText}>Fase {phaseLabel}</Text>
              </View>
              <Text style={styles.roomCode}>{room.room_code}</Text>
            </Card>

            <Card title="Gerbang finishing" subtitle="Tahapan pekerjaan yang dikenali sistem.">
              <View style={styles.chipRow}>
                {gates.map((g) => (
                  <View key={g.code} style={styles.chip}>
                    <Text style={styles.chipText}>{gateChipLabel(g)}</Text>
                  </View>
                ))}
              </View>
              {gates.length === 0 && (
                <Text style={styles.empty}>Data gerbang belum tersedia. Hubungi kantor.</Text>
              )}
            </Card>

            <Card title="Kejadian terbuka" subtitle="Periksa dulu agar hal yang sama tidak dilaporkan dua kali.">
              <OpenEventsList
                roomId={room.id}
                limit={3}
                onOpen={(event) => navigation.navigate('SiteEventDetail', { eventId: event.id, projectId: event.project_id })}
              />
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('SiteEventCapture', { projectId: room.project_id, roomId: room.id })}
                accessibilityRole="button"
                accessibilityLabel="Lapor kejadian di ruangan ini"
              >
                <Text style={styles.primaryText}>Lapor</Text>
              </TouchableOpacity>
            </Card>

            <RoomTimeline
              roomId={room.id}
              projectId={room.project_id}
              viewer={{ id: profile?.id ?? null, role: profile?.role ?? null }}
              today={todayIsoWIB()}
              onOpenEvent={(eventId) => navigation.navigate('SiteEventDetail', { eventId, projectId: room.project_id })}
              onOpenSiteChange={() => navigation.navigate('Progres')}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  roomName: { fontSize: TYPE.xl, fontFamily: FONTS.bold, color: COLORS.text },
  roomMeta: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  phasePill: {
    alignSelf: 'flex-start', marginTop: SPACE.sm, paddingVertical: 3, paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS, backgroundColor: COLORS.accentBg,
  },
  phaseText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accentDark },
  roomCode: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm, letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: 5, paddingHorizontal: SPACE.sm + 2 },
  chipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
  refusal: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.critical, lineHeight: 21 },
  refusalMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center', marginTop: SPACE.base },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.md },
});
