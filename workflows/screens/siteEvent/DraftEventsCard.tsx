import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import { useProject } from '../../hooks/useProject';
import { listDraftEvents, type DraftEventSummary } from '../../../tools/siteEvents';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { draftCardLine, type DraftTone } from './detailModel';

const TONE_COLOR: Record<DraftTone, string> = {
  info: COLORS.info,
  warning: COLORS.warning,
  ok: COLORS.ok,
};

const VISIBLE = 5;

/**
 * "Draf menunggu" (spec §5.3). Kirim never waits for the AI; drafts come back
 * here. Hidden when there is nothing to do, so Beranda stays quiet.
 */
export default function DraftEventsCard() {
  const navigation = useNavigation<any>();
  const { project, profile } = useProject();
  const [items, setItems] = useState<DraftEventSummary[]>([]);
  const [tick, setTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!project || !profile) {
        setItems([]);
        return undefined;
      }
      let alive = true;
      void listDraftEvents(project.id, profile.id).then((rows) => {
        if (alive) setItems(rows);
      });
      return () => {
        alive = false;
      };
    }, [project, profile, tick]),
  );

  if (items.length === 0) return null;
  const ready = items.filter((item) => item.status === 'draft').length;

  return (
    <Card
      title={`Draf menunggu (${items.length})`}
      subtitle={ready > 0 ? `${ready} siap dikonfirmasi` : 'Masih dianalisis AI'}
      borderColor={ready > 0 ? COLORS.ok : COLORS.info}
      rightAction={
        <TouchableOpacity
          onPress={() => setTick((t) => t + 1)}
          accessibilityRole="button"
          accessibilityLabel="Muat ulang draf"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.refresh}
        >
          <Ionicons name="refresh" size={18} color={COLORS.textSec} />
        </TouchableOpacity>
      }
    >
      {items.slice(0, VISIBLE).map((item) => {
        const line = draftCardLine(item);
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.row}
            onPress={() => navigation.navigate('SiteEventConfirm', { eventId: item.id })}
            accessibilityRole="button"
          >
            <View style={[styles.dot, { backgroundColor: TONE_COLOR[line.tone] }]} />
            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={1}>{line.title}</Text>
              <Text style={styles.sub} numberOfLines={2}>{line.line}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        );
      })}
      {items.length > VISIBLE ? <Text style={styles.more}>+{items.length - VISIBLE} draf lainnya</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  refresh: { marginLeft: 'auto', padding: SPACE.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { flex: 1 },
  title: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  sub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  more: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginTop: SPACE.sm },
});
