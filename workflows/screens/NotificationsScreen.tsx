import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../tools/supabase';
import { markNotificationRead } from '../../tools/notificationsRead';
import { NotificationList, type NotificationItem } from './components/NotificationList';
import Header from '../components/Header';
import { COLORS } from '../theme';
import { useProject } from '../hooks/useProject';
// This screen is shared by the supervisor nav (workflows/navigation.tsx) AND
// the principal nav (office/PrincipalNavigation.tsx), so deeplink resolution
// must be role-aware: supervisors have no Approvals route (their APPROVED/
// REJECTED outcomes route to Permintaan), principals keep Approvals.
import { resolveNotificationRoute } from '../../tools/notificationRouting';

interface Props {
  profileId: string;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  deeplink_screen: string;
  deeplink_params: Record<string, unknown> | null;
}

function rowToItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
    deeplinkScreen: row.deeplink_screen,
    deeplinkParams: row.deeplink_params,
  };
}

export default function NotificationsScreen({ profileId }: Props): React.ReactElement {
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const { profile } = useProject();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, created_at, read_at, deeplink_screen, deeplink_params')
      .eq('recipient_user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(200);
    setItems((data ?? []).map(rowToItem));
  }, [profileId]);

  useEffect(() => {
    fetch().finally(() => setLoading(false));
  }, [fetch]);

  // Reconcile on focus: a per-item read acknowledgement can silently fail to
  // reach the server on a flaky field connection (see markNotificationRead).
  // Re-running fetch() whenever this screen regains focus re-reads the true
  // server state, so a stale-read item (or one someone else marked read)
  // corrects itself without waiting for the realtime channel below.
  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  // Realtime subscription for live updates.
  useEffect(() => {
    const channel = supabase.channel(`notifications:${profileId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_user_id=eq.${profileId}`,
        },
        payload => {
          setItems(prev => [rowToItem(payload.new as NotificationRow), ...prev]);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profileId]);

  const handlePress = useCallback((item: NotificationItem) => {
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, readAt } : i));
      // Fire the write but do NOT await it before navigating — supabase-js
      // has no default request timeout, so on a slow field connection an
      // await here would stall the tap-to-deeplink response. Handle the
      // result asynchronously instead: revert the optimistic flip if it
      // didn't actually land. Safe to update state after navigation —
      // NotificationsScreen is registered as a bottom-tabs Tab.Screen
      // (workflows/navigation.tsx, office/navigation.tsx,
      // office/PrincipalNavigation.tsx) with no unmountOnBlur, so it stays
      // mounted when navigating to another tab; even in the hypothetical
      // unmounted case, React 18+ makes a post-unmount setState a silent
      // no-op, and the useFocusEffect fetch() above reconciles true server
      // state whenever the user returns here anyway.
      void markNotificationRead(item.id, readAt).then(result => {
        if (!result.ok) {
          setItems(prev => prev.map(i => i.id === item.id ? { ...i, readAt: null } : i));
        }
      });
    }
    // Navigate immediately — never gated on the write above.
    const target = resolveNotificationRoute(item.deeplinkScreen, profile?.role);
    try {
      navigation.navigate(target, item.deeplinkParams ?? {});
    } catch {
      // Route not in current role's nav — stay on Notifikasi (no-op).
    }
  }, [navigation, profile?.role]);

  return (
    <View style={styles.container}>
      <Header />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      ) : (
        <NotificationList items={items} onPress={handlePress} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
