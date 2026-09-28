jest.mock('expo-notifications', () => ({
  __esModule: true,
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));

jest.mock('expo-device', () => ({
  __esModule: true,
  isDevice: true,
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-123' } } } },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

const mockUpsert = jest.fn();
const mockDeleteEq = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: mockUpsert,
      delete: () => ({ eq: mockDeleteEq }),
    })),
  },
}));

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  ANDROID_CHANNEL_ID,
  attachNotificationTapListener,
  registerForPushNotifications,
  unregisterPushToken,
} from '../notifications';
import { getPushStatus } from '../pushStatus';
import { supabase } from '../supabase';

const N = Notifications as unknown as Record<string, jest.Mock>;

function grant(token = 'ExponentPushToken[xxx]') {
  N.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  N.getExpoPushTokenAsync.mockResolvedValue({ data: token });
}

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as { OS: string }).OS = 'android';
  (Device as { isDevice: boolean }).isDevice = true;
  mockUpsert.mockResolvedValue({ error: null });
  mockDeleteEq.mockResolvedValue({ error: null });
  N.setNotificationChannelAsync.mockResolvedValue(null);
});

describe('registerForPushNotifications', () => {
  it('is unsupported on a simulator', async () => {
    (Device as { isDevice: boolean }).isDevice = false;
    await expect(registerForPushNotifications('user-1')).resolves.toBe('unsupported');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(getPushStatus()).toBe('unsupported');
  });

  it('is unsupported on web', async () => {
    (Platform as { OS: string }).OS = 'web';
    await expect(registerForPushNotifications('user-1')).resolves.toBe('unsupported');
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('creates the high-importance Android channel before permission and token', async () => {
    const order: string[] = [];
    N.setNotificationChannelAsync.mockImplementation(async () => { order.push('channel'); return null; });
    N.getPermissionsAsync.mockImplementation(async () => { order.push('permission'); return { status: 'granted' }; });
    N.getExpoPushTokenAsync.mockImplementation(async () => { order.push('token'); return { data: 't' }; });

    await registerForPushNotifications('user-1');

    expect(order).toEqual(['channel', 'permission', 'token']);
    expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
      ANDROID_CHANNEL_ID,
      expect.objectContaining({ importance: 5, lockscreenVisibility: 1, showBadge: true }),
    );
  });

  it('does not create a channel on iOS', async () => {
    (Platform as { OS: string }).OS = 'ios';
    grant();
    await registerForPushNotifications('user-1');
    expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('registers with the EAS projectId, without prompting when already granted', async () => {
    grant();

    await expect(registerForPushNotifications('user-1')).resolves.toBe('active');

    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(supabase.from).toHaveBeenCalledWith('device_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        expo_push_token: 'ExponentPushToken[xxx]',
        platform: 'android',
      }),
      { onConflict: 'expo_push_token' },
    );
    expect(getPushStatus()).toBe('active');
  });

  it('prompts when undetermined and registers if granted', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    N.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    N.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[yyy]' });

    await expect(registerForPushNotifications('user-1')).resolves.toBe('active');
    expect(N.requestPermissionsAsync).toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('reports denied without asking for a token', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await expect(registerForPushNotifications('user-1')).resolves.toBe('denied');
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(getPushStatus()).toBe('denied');
  });

  it('reports error, never throws, when the token call fails (e.g. FCM missing)', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('Default FirebaseApp is not initialized'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(registerForPushNotifications('user-1')).resolves.toBe('error');
    expect(warn).toHaveBeenCalled();
    expect(getPushStatus()).toBe('error');
    warn.mockRestore();
  });

  it('reports error when saving the token is refused', async () => {
    grant();
    mockUpsert.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(registerForPushNotifications('user-1')).resolves.toBe('error');
    warn.mockRestore();
  });
});

describe('attachNotificationTapListener', () => {
  it('subscribes via expo-notifications and forwards deeplink data to handler', () => {
    const handler = jest.fn();
    const unsubscribe = jest.fn();
    N.addNotificationResponseReceivedListener.mockReturnValue({ remove: unsubscribe });

    const cleanup = attachNotificationTapListener(handler);
    expect(N.addNotificationResponseReceivedListener).toHaveBeenCalled();

    const callback = N.addNotificationResponseReceivedListener.mock.calls[0][0];
    callback({
      notification: {
        request: {
          content: {
            data: {
              deeplinkScreen: 'ApprovalsScreen',
              deeplinkParams: { headerId: 'h1' },
            },
          },
        },
      },
    });
    expect(handler).toHaveBeenCalledWith('ApprovalsScreen', { headerId: 'h1' });

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe('unregisterPushToken', () => {
  it('deletes the token this device registered and resets the status', async () => {
    grant('ExponentPushToken[mine]');
    await registerForPushNotifications('user-1');

    await unregisterPushToken();

    expect(mockDeleteEq).toHaveBeenCalledWith('expo_push_token', 'ExponentPushToken[mine]');
    expect(getPushStatus()).toBe('unknown');
  });

  it('does nothing when this device registered nothing', async () => {
    grant('ExponentPushToken[once]');
    await registerForPushNotifications('user-1');
    await unregisterPushToken();
    mockDeleteEq.mockClear();

    await unregisterPushToken();

    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  it('never blocks logout when the delete fails', async () => {
    grant('ExponentPushToken[offline]');
    await registerForPushNotifications('user-1');
    mockDeleteEq.mockRejectedValue(new Error('Network request failed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(unregisterPushToken()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
