jest.mock('expo-notifications', () => ({
  __esModule: true,
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
}));

jest.mock('expo-device', () => ({
  __esModule: true,
  isDevice: true,
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const mockUpsert = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerForPushNotifications, attachNotificationTapListener } from '../notifications';
import { supabase } from '../supabase';

describe('registerForPushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('returns early on simulator', async () => {
    (Device as { isDevice: boolean }).isDevice = false;
    await registerForPushNotifications('user-1');
    expect(supabase.from).not.toHaveBeenCalled();
    (Device as { isDevice: boolean }).isDevice = true;
  });

  it('returns early when permission denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    await registerForPushNotifications('user-1');
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('registers existing-permission token without prompting', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[xxx]' });

    await registerForPushNotifications('user-1');

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith('device_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        expo_push_token: 'ExponentPushToken[xxx]',
        platform: 'ios',
      }),
      { onConflict: 'expo_push_token' },
    );
  });

  it('prompts when permission undetermined and registers if granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[yyy]' });

    await registerForPushNotifications('user-1');

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalled();
  });
});

describe('attachNotificationTapListener', () => {
  it('subscribes via expo-notifications and forwards deeplink data to handler', () => {
    const handler = jest.fn();
    const unsubscribe = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({
      remove: unsubscribe,
    });

    const cleanup = attachNotificationTapListener(handler);
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled();

    // Simulate the listener firing.
    const callback = (Notifications.addNotificationResponseReceivedListener as jest.Mock).mock.calls[0][0];
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
