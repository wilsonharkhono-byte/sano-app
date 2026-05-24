import React from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  deeplinkScreen: string;
  deeplinkParams: Record<string, unknown> | null;
}

interface Props {
  items: NotificationItem[];
  onPress: (item: NotificationItem) => void;
}

const COLORS = {
  bg: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  unreadDot: '#EF4444',
  dayHeader: '#94A3B8',
};

function relativeDay(iso: string): string {
  const created = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const diffDays = Math.round((startOfToday.getTime() - startOfCreated.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hari ini';
  if (diffDays === 1) return 'Kemarin';
  if (diffDays < 7) return `${diffDays} hari lalu`;
  return created.toLocaleDateString('id-ID');
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

interface ListEntry {
  type: 'header' | 'item';
  key: string;
  label?: string;
  item?: NotificationItem;
}

function buildEntries(items: NotificationItem[]): ListEntry[] {
  const out: ListEntry[] = [];
  let lastDay = '';
  for (const it of items) {
    const day = relativeDay(it.createdAt);
    if (day !== lastDay) {
      out.push({ type: 'header', key: `h-${day}`, label: day });
      lastDay = day;
    }
    out.push({ type: 'item', key: it.id, item: it });
  }
  return out;
}

export function NotificationList({ items, onPress }: Props): React.ReactElement {
  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>Belum ada notifikasi.</Text>
      </View>
    );
  }

  const entries = buildEntries(items);

  return (
    <FlatList
      data={entries}
      keyExtractor={e => e.key}
      renderItem={({ item: entry }) => {
        if (entry.type === 'header') {
          return <Text style={styles.dayHeader}>{entry.label}</Text>;
        }
        const n = entry.item!;
        const unread = !n.readAt;
        return (
          <TouchableOpacity style={styles.row} onPress={() => onPress(n)}>
            <View style={styles.rowContent}>
              <View style={styles.titleRow}>
                {unread && <View style={styles.unreadDot} />}
                <Text style={[styles.title, unread && styles.titleUnread]}>{n.title}</Text>
                <Text style={styles.time}>{formatTime(n.createdAt)}</Text>
              </View>
              <Text style={styles.body}>{n.body}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
  dayHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    color: COLORS.dayHeader,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  rowContent: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.unreadDot,
  },
  title: { fontSize: 14, color: COLORS.textPrimary, flex: 1 },
  titleUnread: { fontWeight: '600' },
  time: { fontSize: 12, color: COLORS.textSecondary },
  body: { fontSize: 13, color: COLORS.textSecondary },
});
