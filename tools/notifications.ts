import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getPushStatus, setPushStatus, type PushStatus } from './pushStatus';

// Must match the channelId the send-push-notification edge function sends and
// the expo-notifications plugin's defaultChannel in app.json.
export const ANDROID_CHANNEL_ID = 'default';

// The token this device registered in this app session; unregisterPushToken
// deletes exactly this row on logout.
let registeredToken: string | null = null;

// Set while registerForPushNotifications is running; unregisterPushToken
// waits for it (capped below) so a Logout tap that lands mid-registration
// still removes the token once it arrives, instead of racing it and leaving
// a freshly re-attached row behind for the account that just signed out.
let inFlightRegistration: Promise<PushStatus> | null = null;

// A stalled network call must never hang a caller (registration is
// fire-and-forget on launch; logout's onPress handlers have no spinner), so
// both the in-flight-registration wait and the delete below are capped at
// this budget.
const REMOTE_CALL_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: number | NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>(resolve => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  const promise = tryRegister(userId).then(status => {
    setPushStatus(status);
    return status;
  });
  inFlightRegistration = promise;
  try {
    return await promise;
  } finally {
    if (inFlightRegistration === promise) inFlightRegistration = null;
  }
}

async function tryRegister(userId: string): Promise<PushStatus> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';

  try {
    // Created before asking for permission: the channel's importance decides
    // heads-up banners and lock-screen visibility, and older Android targets
    // only show the permission prompt once a channel exists.
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
    if (!granted && existing.canAskAgain !== false) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.status === 'granted';
    }
    if (!granted) return 'denied';

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // A plain client upsert would only ever be seen as an UPDATE of a row
    // this device already owns (device_tokens_update_own filters by
    // auth.uid() = user_id, 034) — so a previous, still-signed-out user's
    // stale row on this phone would refuse the update instead of being
    // reassigned. register_device_token (108) is SECURITY DEFINER and claims
    // the token for whoever is signed in on the phone right now.
    const { error } = await supabase.rpc('register_device_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
    if (error) throw new Error(error.message);

    registeredToken = token;
    return 'active';
  } catch (e) {
    console.warn('[push] registration failed', e);
    return 'error';
  }
}

// Called when the app returns to the foreground. If this phone was denied or
// failed to register, and permission is granted now (e.g. the user just
// enabled it in system settings), register. Never requests permission itself:
// on Android a request pauses the activity, which would re-fire this
// foreground event and loop.
export async function retryPushRegistrationIfGranted(userId: string): Promise<void> {
  const status = getPushStatus();
  if (status !== 'denied' && status !== 'error') return;
  if (inFlightRegistration) return;
  try {
    const { status: permission } = await Notifications.getPermissionsAsync();
    if (permission !== 'granted') return;
  } catch {
    return;
  }
  await registerForPushNotifications(userId);
}

// Called on logout BEFORE the session ends: device_tokens RLS only lets the
// owner delete their row. On a shared phone this stops the next user's
// device from receiving the previous user's notifications. Never throws —
// logout must not be blocked by a flaky connection.
export async function unregisterPushToken(): Promise<void> {
  if (inFlightRegistration) {
    await withTimeout(inFlightRegistration, REMOTE_CALL_TIMEOUT_MS);
  }

  const token = registeredToken;
  registeredToken = null;
  setPushStatus('unknown');
  if (!token) return;
  try {
    const result = await withTimeout(
      Promise.resolve(supabase.from('device_tokens').delete().eq('expo_push_token', token)),
      REMOTE_CALL_TIMEOUT_MS,
    );
    if (result?.error) console.warn('[push] token removal failed', result.error.message);
  } catch (e) {
    console.warn('[push] token removal failed', e);
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
