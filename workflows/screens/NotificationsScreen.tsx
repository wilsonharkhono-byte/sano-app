import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../tools/supabase';
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
  projects?: { name: string } | null;
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
    projectName: row.projects?.name ?? null,
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
      .select('id, type, title, body, created_at, read_at, deeplink_screen, deeplink_params, projects(name)')
      .eq('recipient_user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(200);
    setItems(((data ?? []) as unknown as NotificationRow[]).map(rowToItem));
  }, [profileId]);

  useEffect(() => {
    fetch().finally(() => setLoading(false));
  }, [fetch]);

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
        () => {
          // Refetch instead of prepending payload.new: the realtime payload
          // carries no joined project name, so the row would render unlabeled.
          void fetch();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profileId, fetch]);

  const handlePress = useCallback(async (item: NotificationItem) => {
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, readAt } : i));
      void supabase.from('notifications').update({ read_at: readAt }).eq('id', item.id);
    }
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
