import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Mirrors the in-app unread count onto the launcher icon badge. Samsung/Oppo/
// Xiaomi-class launchers show the number; stock Android shows a dot.
export function useBadgeSync(count: number): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.setBadgeCountAsync(count).catch(() => {});
  }, [count]);
}
