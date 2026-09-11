import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { listOpenEventsForRoom, type OpenEventSummary } from '../../../tools/siteEvents';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';

interface Props {
  roomId: string;
  limit?: number;
  onOpen: (event: OpenEventSummary) => void;
}

/** Up to `limit` open events in a room: the release-1 duplicate protection (spec §5.2). */
export default function OpenEventsList({ roomId, limit = 3, onOpen }: Props) {
  const [events, setEvents] = useState<OpenEventSummary[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listOpenEventsForRoom(roomId, limit).then((rows) => {
        if (alive) setEvents(rows);
      });
      return () => {
        alive = false;
      };
    }, [roomId, limit]),
  );

  if (events === null) return <Text style={s.empty}>Memuat kejadian…</Text>;
  if (events.length === 0) return <Text style={s.empty}>Belum ada kejadian terbuka di ruangan ini.</Text>;

  return (
    <View>
      {events.map((event) => (
        <TouchableOpacity key={event.id} style={styles.row} onPress={() => onOpen(event)} accessibilityRole="button">
          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={2}>{event.title ?? 'Tanpa judul'}</Text>
            <Text style={styles.sub}>
              {event.event_type ? SITE_EVENT_TYPE_LABELS[event.event_type] : 'Kejadian'}
              {event.due_date ? ` · tenggat ${event.due_date}` : ''}
              {event.is_blocking ? ' · menghambat' : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  meta: { flex: 1 },
  title: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text, lineHeight: 19 },
  sub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
});
