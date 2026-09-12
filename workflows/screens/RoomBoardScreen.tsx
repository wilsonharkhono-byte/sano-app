import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
 */
export default function RoomBoardScreen() {
  const { project } = useProject();
  const navigation = useNavigation<any>();

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => navigation.navigate('Progres')} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <RoomBoardView
          compact
          projectId={project?.id ?? null}
          onOpenRoom={(row) => {
            if (!project || !row.room_code) return;
            navigation.navigate('Room', { projectCode: project.code, roomCode: row.room_code });
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
});
