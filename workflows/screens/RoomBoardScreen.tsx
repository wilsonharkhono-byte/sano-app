import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import { useProject } from '../hooks/useProject';
import RoomBoardView from '../../office/screens/rooms/RoomBoardView';
import { COLORS, FONTS, SPACE, TYPE } from '../theme';

/**
 * Papan Ruangan on a phone (spec §9: "supervisors get the same data in a phone
 * layout reached from Progres"). Same component, same data, `compact` so the
 * filter pills wrap instead of overflowing a 360dp screen.
 *
 * Tapping a room opens the supervisor's own RoomScreen, not the office detail:
 * that is where "Lapor" lives (plan 2 task 12), so the board doubles as a way
 * into capture for a room whose label is out of reach.
 *
 * RoomBoardView owns its own scroll container (with pull-to-refresh), so
 * "Kembali" sits above it as a fixed row instead of scrolling away with the
 * board.
 */
export default function RoomBoardScreen() {
  const { project, profile } = useProject();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // A SITE_EVENT_DIGEST tap lands here with { projectId, attention, mine }
  // (closure spec §5.6). routeDeeplink copies params per tap, so a second tap
  // of the same notification is a new object and re-applies "Milik saya".
  const params = route.params as { attention?: boolean; mine?: boolean } | undefined;
  const mineRequest = useMemo(
    () => (params?.attention ? { mine: params.mine === true } : null),
    [params],
  );

  return (
    <View style={styles.flex}>
      <Header />
      <TouchableOpacity onPress={() => navigation.navigate('Progres')} style={styles.back}>
        <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
        <Text style={styles.backText}>Kembali</Text>
      </TouchableOpacity>
      <RoomBoardView
        compact
        projectId={project?.id ?? null}
        viewerId={profile?.id ?? null}
        mineRequest={mineRequest}
        onOpenEvent={(eventId, projectId) => navigation.navigate('SiteEventDetail', { eventId, projectId })}
        onOpenRoom={(row) => {
          if (!project || !row.room_code) return;
          navigation.navigate('Room', { projectCode: project.code, roomCode: row.room_code });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.base },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
});
