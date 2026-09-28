import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { setPushStatus, type PushStatus } from './pushStatus';

// Must match the channelId the send-push-notification edge function sends and
// the expo-notifications plugin's defaultChannel in app.json.
export const ANDROID_CHANNEL_ID = 'default';

// The token this device registered in this app session; unregisterPushToken
// deletes exactly this row on logout.
let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(userId: string): Promise<PushStatus> {
  const status = await tryRegister(userId);
  setPushStatus(status);
  return status;
}

async function tryRegister(userId: string): Promise<PushStatus> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';

  try {
    // Android 13+ shows the notification permission prompt only once a
    // channel exists, and the channel's importance decides heads-up banners
    // and lock-screen visibility — so it is created first.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Notifikasi SANO',
        importance: Notifications.AndroidImportance.MAX,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: 'default',
        showBadge: true,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Check before requesting: on Android a request for an already-granted
    // permission still pauses the activity (AppState -> background).
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.status === 'granted';
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.status === 'granted';
    }
    if (!granted) return 'denied';

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { error } = await supabase.from('device_tokens').upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform: Platform.OS as 'ios' | 'android' | 'web',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );
    if (error) throw new Error(error.message);

    registeredToken = token;
    return 'active';
  } catch (e) {
    console.warn('[push] registration failed', e);
    return 'error';
  }
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
