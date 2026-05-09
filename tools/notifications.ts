import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<void> {
  if (!Device.isDevice) return; // simulators don't get a real token

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return;

  const tokenResp = await Notifications.getExpoPushTokenAsync();
  await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: tokenResp.data,
      platform: Platform.OS as 'ios' | 'android' | 'web',
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' },
  );
}

export type NotificationTapHandler = (
  deeplinkScreen: string,
  deeplinkParams: Record<string, unknown> | null,
) => void;

export function attachNotificationTapListener(handler: NotificationTapHandler): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as {
      deeplinkScreen?: string;
      deeplinkParams?: Record<string, unknown>;
    };
    if (data?.deeplinkScreen) {
      handler(data.deeplinkScreen, data.deeplinkParams ?? null);
    }
  });
  return () => subscription.remove();
}
