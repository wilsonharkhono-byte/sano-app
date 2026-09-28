jest.mock('expo-notifications', () => ({
  __esModule: true,
  setBadgeCountAsync: jest.fn(() => Promise.resolve(true)),
}));

// react-native's top-level `Platform` export resolves through a `.default`
// getter (see index.js) that jest.setup.js's submodule mock doesn't satisfy;
// tools/__tests__/notifications.test.ts hits the same gap and works around
// it the same way.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBadgeSync } from '../useBadgeSync';

const setBadge = Notifications.setBadgeCountAsync as jest.Mock;

describe('useBadgeSync', () => {
  beforeEach(() => setBadge.mockClear());

  it('sets the launcher badge to the unread count and follows changes', () => {
    const { rerender } = renderHook(({ n }: { n: number }) => useBadgeSync(n), {
      initialProps: { n: 3 },
    });
    expect(setBadge).toHaveBeenLastCalledWith(3);

    rerender({ n: 0 });
    expect(setBadge).toHaveBeenLastCalledWith(0);
    expect(setBadge).toHaveBeenCalledTimes(2);
  });

  it('is a no-op on web', () => {
    const original = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    renderHook(() => useBadgeSync(5));
    expect(setBadge).not.toHaveBeenCalled();
    (Platform as { OS: string }).OS = original;
  });

  it('swallows launcher errors', () => {
    setBadge.mockImplementationOnce(() => Promise.reject(new Error('unsupported launcher')));
    expect(() => renderHook(() => useBadgeSync(1))).not.toThrow();
  });
});
