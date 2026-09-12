import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Header from '../../workflows/components/Header';
import { useProject } from '../../workflows/hooks/useProject';
import RoomBoardView from './rooms/RoomBoardView';
import { COLORS } from '../../workflows/theme';

/**
 * The principal's "Ruangan" tab (spec §9). Read-only by construction: it mounts
 * the board and nothing else. Room authoring and gate editing stay in the
 * office tab, which a principal does not have; tapping a room opens the same
 * read-only RoomDetail a scanned QR lands on.
 *
 * RoomBoardView owns its own scroll container (with pull-to-refresh), so it
 * is not wrapped in another ScrollView here.
 */
export default function PrincipalRoomsScreen() {
  const { project } = useProject();
  const navigation = useNavigation<any>();

  return (
    <View style={styles.flex}>
      <Header />
      <RoomBoardView
        projectId={project?.id ?? null}
        onOpenRoom={(row) => {
          if (!project || !row.room_code) return;
          navigation.navigate('RoomDetail', { projectCode: project.code, roomCode: row.room_code });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
});
