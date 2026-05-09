import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../tools/supabase';
import { NotificationList, type NotificationItem } from '../../workflows/screens/components/NotificationList';

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

  const handlePress = useCallback(async (item: NotificationItem) => {
    if (!item.readAt) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i));
    }
    navigation.navigate(item.deeplinkScreen, item.deeplinkParams ?? {});
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NotificationList
        items={items}
        onPress={handlePress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
