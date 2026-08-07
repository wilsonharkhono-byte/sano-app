import React, { useCallback, useMemo } from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, TYPE, SPACE, RADIUS } from '../../theme';

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

// ── Per-type visual identity ──────────────────────────────────────────────────
// Each notification kind gets an icon + semantic colour, so the list reads at a
// glance and stays consistent with the rest of the app's Ionicons + flag palette.
type TypeStyle = { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string };

const TYPE_STYLES: Record<string, TypeStyle> = {
  APPROVED:                { icon: 'checkmark-circle', color: COLORS.ok,       bg: COLORS.okBg },
  REJECTED:                { icon: 'close-circle',     color: COLORS.critical, bg: COLORS.criticalBg },
  AUTO_HOLD:               { icon: 'pause-circle',     color: COLORS.warning,  bg: COLORS.warningBg },
  PO_READY:                { icon: 'cube',             color: COLORS.info,     bg: COLORS.infoBg },
  RECEIPT_MISMATCH:        { icon: 'alert-circle',     color: COLORS.high,     bg: COLORS.highBg },
  REQUEST_PENDING:         { icon: 'time',             color: COLORS.info,     bg: COLORS.infoBg },
  REQUEST_APPROVED_FOR_PO: { icon: 'cart',             color: COLORS.ok,       bg: COLORS.okBg },
  PLAN_REVISED:            { icon: 'refresh-circle',   color: COLORS.info,     bg: COLORS.infoBg },
  PLAN_CEILING_RAISE:      { icon: 'trending-up',      color: COLORS.warning,  bg: COLORS.warningBg },
  CRITICAL:                { icon: 'warning',          color: COLORS.critical, bg: COLORS.criticalBg },
  WARNING:                 { icon: 'warning',          color: COLORS.warning,  bg: COLORS.warningBg },
};

const DEFAULT_STYLE: TypeStyle = {
  icon: 'notifications',
  color: COLORS.accentDark,
  bg: COLORS.accentBg,
};

function styleForType(type: string): TypeStyle {
  return TYPE_STYLES[type] ?? DEFAULT_STYLE;
}

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

// Memoised row — only re-renders when its own item or readAt changes, so a
// realtime insert or a single mark-as-read doesn't re-render the whole list.
const NotificationRow = React.memo(function NotificationRow({
  item,
  onPress,
}: {
  item: NotificationItem;
  onPress: (item: NotificationItem) => void;
}): React.ReactElement {
  const unread = !item.readAt;
  const ts = styleForType(item.type);
  return (
    <TouchableOpacity
      style={[styles.row, unread && styles.rowUnread]}
      activeOpacity={0.6}
      onPress={() => onPress(item)}
    >
      <View style={[styles.iconBadge, { backgroundColor: ts.bg }]}>
        <Ionicons name={ts.icon} size={18} color={ts.color} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
      </View>
      {unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
});

export function NotificationList({ items, onPress }: Props): React.ReactElement {
  const entries = useMemo(() => buildEntries(items), [items]);

  const renderItem = useCallback(
    ({ item: entry }: { item: ListEntry }) => {
      if (entry.type === 'header') {
        return <Text style={styles.dayHeader}>{entry.label}</Text>;
      }
      return <NotificationRow item={entry.item!} onPress={onPress} />;
    },
    [onPress],
  );

  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="notifications-off-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.emptyText}>Belum ada notifikasi.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={e => e.key}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={10}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: SPACE.xxl },
  emptyState: { flex: 1, padding: SPACE.xxxl, alignItems: 'center', justifyContent: 'center', gap: SPACE.md },
  emptyText: { fontFamily: FONTS.regular, color: COLORS.textSec, fontSize: TYPE.base },
  dayHeader: {
    paddingHorizontal: SPACE.base,
    paddingTop: SPACE.lg,
    paddingBottom: SPACE.sm,
    fontFamily: FONTS.semibold,
    color: COLORS.textMuted,
    fontSize: TYPE.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    marginHorizontal: SPACE.base,
    marginVertical: SPACE.xs,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderSub,
    backgroundColor: COLORS.surface,
  },
  rowUnread: {
    backgroundColor: COLORS.accentBg,
    borderColor: COLORS.accent,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  title: { flex: 1, fontFamily: FONTS.medium, fontSize: TYPE.base, color: COLORS.text },
  titleUnread: { fontFamily: FONTS.semibold },
  time: { fontFamily: FONTS.regular, fontSize: TYPE.xs, color: COLORS.textMuted },
  body: { fontFamily: FONTS.regular, fontSize: TYPE.sm, color: COLORS.textSec },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accentDark,
  },
});
