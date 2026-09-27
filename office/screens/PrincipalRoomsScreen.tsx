import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import { useProject } from '../../workflows/hooks/useProject';
import RoomBoardView from './rooms/RoomBoardView';
import DatumSyncCard from './rooms/DatumSyncCard';
import { attentionMineRequest } from '../../tools/siteEventAttention';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../workflows/theme';
import { DATUM_CARD_COPY } from './rooms/datumSyncModel';

/**
 * The principal's "Ruangan" tab (spec §9). Room authoring and gate editing
 * stay in the office tab, which a principal does not have; tapping a room
 * opens the same read-only RoomDetail a scanned QR lands on.
 *
 * The one thing a principal does here is DATUM (spec 2026-09-27 §8.1): the
 * pairing, "Sinkron DATUM" and the import are office-role actions, and this
 * is the principal's only rooms screen. The section sits above the board and
 * expands in place (the owner's rule: never a modal); its card reads nothing
 * until it is opened. After a sync or an import the board reads again.
 *
 * RoomBoardView owns its own scroll container (with pull-to-refresh), so the
 * section is handed to it rather than wrapped around it in another ScrollView.
 */
export default function PrincipalRoomsScreen() {
  const { project, profile, refresh } = useProject();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // A SITE_EVENT_DIGEST tap resolves to this tab (tools/notificationRouting.ts)
  // with { projectId, attention, mine } (closure spec §5.6); see
  // attentionMineRequest.
  const mineRequest = useMemo(() => attentionMineRequest(route.params), [route.params]);
  const [datumOpen, setDatumOpen] = useState(false);
  const [boardReload, setBoardReload] = useState(0);
  const reloadBoard = useCallback(() => setBoardReload((n) => n + 1), []);

  const datum = project ? (
    <View style={styles.datum}>
      <TouchableOpacity
        style={styles.datumHead}
        onPress={() => setDatumOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={DATUM_CARD_COPY.title}
        accessibilityState={{ expanded: datumOpen }}
      >
        <Text style={styles.datumTitle}>{DATUM_CARD_COPY.title}</Text>
        <Text style={styles.datumCode} numberOfLines={1}>{project.datum_project_code ?? DATUM_CARD_COPY.unpaired}</Text>
        <Ionicons name={datumOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSec} />
      </TouchableOpacity>
      {datumOpen ? (
        <DatumSyncCard project={project} role={profile?.role} onPaired={refresh} onRoomsChanged={reloadBoard} />
      ) : null}
    </View>
  ) : null;

  return (
    <View style={styles.flex}>
      <Header />
      <RoomBoardView
        projectId={project?.id ?? null}
        viewerId={profile?.id ?? null}
        showOwners
        showDigestHealth
        mineRequest={mineRequest}
        aboveBoard={datum}
        reloadSignal={boardReload}
        onOpenEvent={(eventId, projectId) => navigation.navigate('SiteEventDetail', { eventId, projectId })}
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
  datum: { marginBottom: SPACE.sm },
  datumHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44,
    paddingHorizontal: SPACE.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    backgroundColor: COLORS.surface, marginBottom: SPACE.sm,
  },
  datumTitle: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase', color: COLORS.textSec,
  },
  datumCode: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text },
});
