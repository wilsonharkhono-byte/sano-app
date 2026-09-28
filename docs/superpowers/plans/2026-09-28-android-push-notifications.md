# Android Push Notifications + Unread Badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SANO notifications reach Android phones as lock-screen / heads-up pushes, and the app icon shows a badge equal to the user's unread in-app notification count.

**Architecture:** The pipeline from the May notifications design already exists (DB triggers → `notifications` row → Database Webhook → `send-push-notification` edge function → Expo Push API) but no phone has ever registered, because FCM was never configured. This plan adds the FCM config, hardens client registration (Android channel, projectId, visible status, logout cleanup), syncs the launcher badge from the existing `useUnreadCount`, and makes the edge function authenticated, DB-sourced and badge-aware.

**Tech Stack:** Expo SDK 54, `expo-notifications` 0.32, React Native 0.81, Supabase (Postgres, Edge Functions on Deno), EAS Build, jest + ts-jest + @testing-library/react-native, `deno test`.

**Spec:** `docs/superpowers/specs/2026-09-28-android-push-notifications-design.md`

---

## Ground rules for the executor

- Work in the worktree `/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/android-push` (branch `feat/android-push`, based on `origin/main`). Never `cd` to the main checkout.
- **jest-in-worktree trap:** `package.json` `testPathIgnorePatterns` contains `/.claude/worktrees/`, which matches this worktree's own path, so plain `npx jest` finds NO tests. Always run jest as:
  `npx jest <paths> --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/'`
  (written below as `JEST <paths>`).
- Deno tests: `cd supabase/functions/<name> && deno test --allow-env --allow-net --allow-read`.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (preceded by a blank line).
- User-facing strings are Indonesian. Use plain ASCII punctuation in new strings (`...` and ` - `), not typed `\u` escapes.
- Tasks 1–7 are code (no external accounts needed). Tasks 8–9 need the user's Firebase / Supabase Dashboard access. Task 10 is rollout.

## File map

| File | Status | Responsibility |
|---|---|---|
| `tools/pushStatus.ts` | Create | Tiny observable store: this device's push registration status |
| `tools/notifications.ts` | Modify | Register (channel → permission → token → upsert), unregister, tap listener |
| `tools/auth.ts` | Modify | `signOut()` removes this phone's token first |
| `workflows/screens/hooks/useBadgeSync.ts` | Create | Mirror unread count onto the launcher badge |
| `workflows/components/Header.tsx` | Modify | Mount `useBadgeSync(unread)` |
| `workflows/components/PushStatusLine.tsx` | Create | "Aktif / Izin ditolak / ..." line; opens settings when denied |
| `workflows/screens/LainnyaScreen.tsx` | Modify | Show `PushStatusLine` in the profile card |
| `supabase/functions/send-push-notification/index.ts` | Modify | Auth (fail-closed), load row by id, badge/channel/priority, shared `makeDeps` |
| `supabase/functions/retry-push-notifications/index.ts` | Modify | Reuse `makeDeps`/`checkAuth`; dispatch by id |
| `app.json` | Modify | `googleServicesFile`, `expo-notifications` plugin, version 3.2.0 |
| `assets/notification-icon.png` | Create | White-on-transparent 96×96 small icon |
| `google-services.json` | Create (from user) | Firebase Android client config |
| `docs/deploy/android-push-setup.md` | Create | Firebase, EAS, Dashboard webhook/cron/secret steps |
| tests | Create/Modify | `tools/__tests__/pushStatus.test.ts`, `tools/__tests__/notifications.test.ts`, `tools/__tests__/auth.test.ts`, `workflows/screens/hooks/__tests__/useBadgeSync.test.ts`, `workflows/components/__tests__/PushStatusLine.test.tsx`, both Deno `index.test.ts` |

---

### Task 0: Worktree setup and baseline

**Files:** none changed.

- [ ] **Step 1: Install dependencies and copy .env**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/android-push"
npm ci
cp "/Users/carissatjondro/Dropbox/AI/Claude Code/.env" .env
```

Expected: `npm ci` finishes without errors. `.env` is gitignored (verify: `git check-ignore .env` prints `.env`).

- [ ] **Step 2: Record the baseline**

```bash
npx jest tools/__tests__/notifications.test.ts --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/'
(cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read)
(cd supabase/functions/retry-push-notifications && deno test --allow-env --allow-net --allow-read)
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" > /tmp/android-push-tsc-baseline.txt; cat /tmp/android-push-tsc-baseline.txt
```

Expected: 5 jest tests pass, 4 + 3 Deno tests pass. Note the tsc error count (pre-existing errors are fine; later tasks must not raise it).

---

### Task 1: Push status store

**Files:**
- Create: `tools/pushStatus.ts`
- Test: `tools/__tests__/pushStatus.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/__tests__/pushStatus.test.ts`:

```ts
import { getPushStatus, setPushStatus, subscribePushStatus } from '../pushStatus';

describe('pushStatus store', () => {
  afterEach(() => setPushStatus('unknown'));

  it('starts as unknown', () => {
    expect(getPushStatus()).toBe('unknown');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: string[] = [];
    const unsubscribe = subscribePushStatus(() => seen.push(getPushStatus()));
    setPushStatus('active');
    unsubscribe();
    setPushStatus('denied');
    expect(seen).toEqual(['active']);
    expect(getPushStatus()).toBe('denied');
  });

  it('does not notify when the status is unchanged', () => {
    const listener = jest.fn();
    const unsubscribe = subscribePushStatus(listener);
    setPushStatus('unknown');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `JEST tools/__tests__/pushStatus.test.ts`
Expected: FAIL, `Cannot find module '../pushStatus'`.

- [ ] **Step 3: Implement**

`tools/pushStatus.ts`:

```ts
// This device's push-registration outcome, readable from any screen without
// prop drilling (PushStatusLine subscribes via useSyncExternalStore).
export type PushStatus = 'unknown' | 'active' | 'denied' | 'unsupported' | 'error';

let current: PushStatus = 'unknown';
const listeners = new Set<() => void>();

export function getPushStatus(): PushStatus {
  return current;
}

export function setPushStatus(next: PushStatus): void {
  if (next === current) return;
  current = next;
  listeners.forEach(listener => listener());
}

export function subscribePushStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `JEST tools/__tests__/pushStatus.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/pushStatus.ts tools/__tests__/pushStatus.test.ts
git commit -m "feat(push): observable push-registration status store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Robust registration (channel, projectId, status, no silent failure)

**Files:**
- Modify: `tools/notifications.ts` (replace `registerForPushNotifications`, lines 1–37)
- Test: `tools/__tests__/notifications.test.ts` (full rewrite of the mocks + register block; tap-listener test kept)

- [ ] **Step 1: Rewrite the test file**

Replace the whole of `tools/__tests__/notifications.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `JEST tools/__tests__/notifications.test.ts`
Expected: FAIL. `ANDROID_CHANNEL_ID` is undefined; the channel/status/projectId assertions fail.

- [ ] **Step 3: Implement**

Replace lines 1–37 of `tools/notifications.ts` (everything above `export type NotificationTapHandler`) with:

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `JEST tools/__tests__/notifications.test.ts tools/__tests__/pushStatus.test.ts`
Expected: 10 + 3 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/notifications.ts tools/__tests__/notifications.test.ts
git commit -m "feat(push): Android channel, explicit projectId and visible status on registration

Registration failures were swallowed by \`void\`, which hid that no phone
ever got a token. It now returns and publishes a status instead.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Remove this phone's token on logout

**Files:**
- Modify: `tools/notifications.ts` (add `unregisterPushToken`)
- Modify: `tools/auth.ts:20-23` (`signOut`)
- Test: `tools/__tests__/notifications.test.ts` (append a describe block), create `tools/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tools/__tests__/notifications.test.ts`, change the import from `'../notifications'` to also import `unregisterPushToken`:

```ts
import {
  ANDROID_CHANNEL_ID,
  attachNotificationTapListener,
  registerForPushNotifications,
  unregisterPushToken,
} from '../notifications';
```

and append at the end of the file:

```ts
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
```

Create `tools/__tests__/auth.test.ts`:

```ts
const mockOrder: string[] = [];

jest.mock('../notifications', () => ({
  unregisterPushToken: jest.fn(async () => { mockOrder.push('unregister'); }),
}));

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: jest.fn(async () => { mockOrder.push('signOut'); return { error: null }; }),
    },
  },
}));

import { signOut } from '../auth';

describe('signOut', () => {
  it("removes this phone's push token while the session can still delete it", async () => {
    await signOut();
    expect(mockOrder).toEqual(['unregister', 'signOut']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `JEST tools/__tests__/notifications.test.ts tools/__tests__/auth.test.ts`
Expected: FAIL. `unregisterPushToken is not a function`, and auth order is `['signOut']`.

- [ ] **Step 3: Implement**

In `tools/notifications.ts`, insert directly after the closing `}` of `tryRegister` (before `export type NotificationTapHandler`):

```ts
// Called on logout BEFORE the session ends: device_tokens RLS only lets the
// owner delete their row. On a shared phone this stops the next user's
// device from receiving the previous user's notifications. Never throws —
// logout must not be blocked by a flaky connection.
export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  setPushStatus('unknown');
  if (!token) return;
  try {
    const { error } = await supabase.from('device_tokens').delete().eq('expo_push_token', token);
    if (error) console.warn('[push] token removal failed', error.message);
  } catch (e) {
    console.warn('[push] token removal failed', e);
  }
}
```

In `tools/auth.ts`, add the import under the existing imports:

```ts
import { unregisterPushToken } from './notifications';
```

and replace `signOut`:

```ts
export async function signOut() {
  await unregisterPushToken();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `JEST tools/__tests__/notifications.test.ts tools/__tests__/auth.test.ts`
Expected: 13 + 1 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/notifications.ts tools/auth.ts tools/__tests__/notifications.test.ts tools/__tests__/auth.test.ts
git commit -m "feat(push): remove this phone's push token on logout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Launcher badge follows the unread count

**Files:**
- Create: `workflows/screens/hooks/useBadgeSync.ts`
- Modify: `workflows/components/Header.tsx:7` (import) and `:23` (call)
- Test: `workflows/screens/hooks/__tests__/useBadgeSync.test.ts`

- [ ] **Step 1: Write the failing test**

`workflows/screens/hooks/__tests__/useBadgeSync.test.ts`:

```ts
jest.mock('expo-notifications', () => ({
  __esModule: true,
  setBadgeCountAsync: jest.fn(() => Promise.resolve(true)),
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `JEST workflows/screens/hooks/__tests__/useBadgeSync.test.ts`
Expected: FAIL, `Cannot find module '../useBadgeSync'`.

- [ ] **Step 3: Implement**

`workflows/screens/hooks/useBadgeSync.ts`:

```ts
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
```

In `workflows/components/Header.tsx`, add after the `useUnreadCount` import (line 7):

```ts
import { useBadgeSync } from '../screens/hooks/useBadgeSync';
```

and directly after `const unread = useUnreadCount(profile?.id);` (line 23):

```ts
  useBadgeSync(unread);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `JEST workflows/screens/hooks/__tests__/useBadgeSync.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add workflows/screens/hooks/useBadgeSync.ts workflows/screens/hooks/__tests__/useBadgeSync.test.ts workflows/components/Header.tsx
git commit -m "feat(push): app icon badge follows the unread notification count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: "Notifikasi HP" status line on the Lainnya screen

**Files:**
- Create: `workflows/components/PushStatusLine.tsx`
- Modify: `workflows/screens/LainnyaScreen.tsx` (import near line 3; insert after line 240)
- Test: `workflows/components/__tests__/PushStatusLine.test.tsx`

- [ ] **Step 1: Write the failing test**

`workflows/components/__tests__/PushStatusLine.test.tsx`:

```tsx
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import PushStatusLine from '../PushStatusLine';
import { setPushStatus } from '../../../tools/pushStatus';

describe('PushStatusLine', () => {
  afterEach(() => {
    act(() => setPushStatus('unknown'));
    jest.restoreAllMocks();
  });

  it('shows the current status and follows changes', () => {
    const { getByText } = render(<PushStatusLine />);
    expect(getByText('Memeriksa...')).toBeTruthy();

    act(() => setPushStatus('active'));
    expect(getByText('Aktif')).toBeTruthy();
  });

  it('opens the system settings when permission was denied', () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    act(() => setPushStatus('denied'));

    const { getByText } = render(<PushStatusLine />);
    fireEvent.press(getByText('Izin ditolak - ketuk untuk membuka Pengaturan'));

    expect(openSettings).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `JEST workflows/components/__tests__/PushStatusLine.test.tsx`
Expected: FAIL, `Cannot find module '../PushStatusLine'`.

- [ ] **Step 3: Implement**

`workflows/components/PushStatusLine.tsx`:

```tsx
import React, { useSyncExternalStore } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { getPushStatus, subscribePushStatus, type PushStatus } from '../../tools/pushStatus';
import { COLORS, SPACE, TYPE } from '../theme';

const LABELS: Record<PushStatus, string> = {
  unknown: 'Memeriksa...',
  active: 'Aktif',
  denied: 'Izin ditolak - ketuk untuk membuka Pengaturan',
  error: 'Gagal mendaftar - tutup lalu buka lagi aplikasi',
  unsupported: 'Tidak didukung di perangkat ini',
};

const TONES: Record<PushStatus, string> = {
  unknown: COLORS.textSec,
  active: COLORS.ok,
  denied: COLORS.warning,
  error: COLORS.critical,
  unsupported: COLORS.textSec,
};

// Lets the office see at a glance whether this phone can receive pushes.
export default function PushStatusLine() {
  const status = useSyncExternalStore(subscribePushStatus, getPushStatus, getPushStatus);
  const label = <Text style={[styles.text, { color: TONES[status] }]}>{LABELS[status]}</Text>;

  if (status !== 'denied') return label;
  return (
    <TouchableOpacity accessibilityRole="button" onPress={() => { void Linking.openSettings(); }}>
      {label}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: TYPE.sm, marginTop: SPACE.xs },
});
```

In `workflows/screens/LainnyaScreen.tsx`, add after `import Header from '../components/Header';`:

```ts
import PushStatusLine from '../components/PushStatusLine';
```

and directly after the line `<Text style={styles.fieldHint}>Proyek diassign oleh Estimator</Text>` (line 240) insert:

```tsx
          <Text style={styles.label}>Notifikasi HP</Text>
          <PushStatusLine />
```

- [ ] **Step 4: Run it to verify it passes**

Run: `JEST workflows/components/__tests__/PushStatusLine.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add workflows/components/PushStatusLine.tsx workflows/components/__tests__/PushStatusLine.test.tsx workflows/screens/LainnyaScreen.tsx
git commit -m "feat(push): show the phone's push status on the Lainnya profile card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Edge function — authenticated, DB-sourced, badge-aware

**Files:**
- Modify: `supabase/functions/send-push-notification/index.ts` (full rewrite)
- Modify: `supabase/functions/send-push-notification/index.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the tests**

Replace `supabase/functions/send-push-notification/index.test.ts` with:

```ts
import { assertEquals } from 'std/assert';
import { checkAuth, handleNotification, type Deps, type ExpoMessage, type NotificationRow } from './index.ts';

const ROW: NotificationRow = {
  id: '00000000-0000-0000-0000-000000000001',
  recipient_user_id: '00000000-0000-0000-0000-000000000002',
  title: 'Permintaan disetujui',
  body: 'MR-12 disetujui estimator',
  deeplink_screen: 'ApprovalsScreen',
  deeplink_params: { headerId: 'h1' },
  push_sent_at: null,
};

function makeMockDeps(overrides: Partial<Deps> = {}) {
  const calls = {
    pushed: [] as ExpoMessage[][],
    markSent: 0,
    deleted: [] as string[],
  };
  const deps: Deps = {
    fetchNotification: async () => ({ ...ROW }),
    fetchTokens: async () => [{ expo_push_token: 'ExponentPushToken[abc]' }],
    countUnread: async () => 4,
    expoPush: async (messages) => { calls.pushed.push(messages); return { data: messages.map(() => ({ status: 'ok' })) }; },
    markSent: async () => { calls.markSent++; },
    deleteToken: async (t) => { calls.deleted.push(t); },
    ...overrides,
  };
  return { deps, calls };
}

Deno.test('checkAuth fails closed when the secret is not configured', () => {
  assertEquals(checkAuth('Bearer x', undefined), 'misconfigured');
  assertEquals(checkAuth(null, ''), 'misconfigured');
});

Deno.test('checkAuth requires the exact bearer', () => {
  assertEquals(checkAuth('Bearer s3cret', 's3cret'), 'ok');
  assertEquals(checkAuth('Bearer wrong', 's3cret'), 'unauthorized');
  assertEquals(checkAuth(null, 's3cret'), 'unauthorized');
});

Deno.test('unknown notification id is not pushed', async () => {
  const { deps, calls } = makeMockDeps({ fetchNotification: async () => null });
  assertEquals(await handleNotification(ROW.id, deps), 'not found');
  assertEquals(calls.pushed.length, 0);
});

Deno.test('skips when push_sent_at already set (idempotency)', async () => {
  const { deps, calls } = makeMockDeps({
    fetchNotification: async () => ({ ...ROW, push_sent_at: '2026-09-28T00:00:00Z' }),
  });
  assertEquals(await handleNotification(ROW.id, deps), 'already sent');
  assertEquals(calls.pushed.length, 0);
});

Deno.test('skips without marking sent when no tokens are registered', async () => {
  const { deps, calls } = makeMockDeps({ fetchTokens: async () => [] });
  assertEquals(await handleNotification(ROW.id, deps), 'no tokens');
  assertEquals(calls.pushed.length, 0);
  assertEquals(calls.markSent, 0);
});

Deno.test('message content comes from the DB row, with badge, channel and priority', async () => {
  const { deps, calls } = makeMockDeps();
  assertEquals(await handleNotification(ROW.id, deps), 'ok');
  const [msg] = calls.pushed[0];
  assertEquals(msg.to, 'ExponentPushToken[abc]');
  assertEquals(msg.title, 'Permintaan disetujui');
  assertEquals(msg.body, 'MR-12 disetujui estimator');
  assertEquals(msg.badge, 4);
  assertEquals(msg.channelId, 'default');
  assertEquals(msg.priority, 'high');
  assertEquals(msg.data, {
    notificationId: ROW.id,
    deeplinkScreen: 'ApprovalsScreen',
    deeplinkParams: { headerId: 'h1' },
  });
  assertEquals(calls.markSent, 1);
});

Deno.test('one message per token', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[a]' },
      { expo_push_token: 'ExponentPushToken[b]' },
    ],
  });
  await handleNotification(ROW.id, deps);
  assertEquals(calls.pushed[0].map(m => m.to), ['ExponentPushToken[a]', 'ExponentPushToken[b]']);
});

Deno.test('deletes stale tokens on DeviceNotRegistered', async () => {
  const { deps, calls } = makeMockDeps({
    fetchTokens: async () => [
      { expo_push_token: 'ExponentPushToken[good]' },
      { expo_push_token: 'ExponentPushToken[stale]' },
    ],
    expoPush: async () => ({
      data: [
        { status: 'ok' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
      ],
    }),
  });
  await handleNotification(ROW.id, deps);
  assertEquals(calls.deleted, ['ExponentPushToken[stale]']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read`
Expected: FAIL at type-check (`checkAuth`, `NotificationRow`, `countUnread` don't exist).

- [ ] **Step 3: Implement**

Replace `supabase/functions/send-push-notification/index.ts` with:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface NotificationRow {
  id: string;
  recipient_user_id: string;
  title: string;
  body: string;
  deeplink_screen: string;
  deeplink_params: unknown;
  push_sent_at: string | null;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: unknown;
  sound: 'default';
  badge: number;
  channelId: 'default';
  priority: 'high';
}

interface ExpoResponse {
  data?: { status?: string; details?: { error?: string } }[];
}

export interface Deps {
  fetchNotification: (id: string) => Promise<NotificationRow | null>;
  fetchTokens: (userId: string) => Promise<{ expo_push_token: string }[]>;
  countUnread: (userId: string) => Promise<number>;
  expoPush: (messages: ExpoMessage[]) => Promise<ExpoResponse>;
  markSent: (id: string) => Promise<void>;
  deleteToken: (token: string) => Promise<void>;
}

// Fail closed: without a configured secret nobody may trigger pushes.
export function checkAuth(
  authorization: string | null,
  expected: string | undefined,
): 'ok' | 'unauthorized' | 'misconfigured' {
  if (!expected) return 'misconfigured';
  return authorization === `Bearer ${expected}` ? 'ok' : 'unauthorized';
}

// Only the id is trusted from the caller; title/body/recipient are re-read from
// the DB so a caller cannot push arbitrary text to a user.
export async function handleNotification(id: string, deps: Deps): Promise<string> {
  const row = await deps.fetchNotification(id);
  if (!row) return 'not found';
  if (row.push_sent_at) return 'already sent';

  const tokens = await deps.fetchTokens(row.recipient_user_id);
  if (!tokens.length) return 'no tokens';

  const badge = await deps.countUnread(row.recipient_user_id);
  const messages: ExpoMessage[] = tokens.map(t => ({
    to: t.expo_push_token,
    title: row.title,
    body: row.body,
    data: {
      notificationId: row.id,
      deeplinkScreen: row.deeplink_screen,
      deeplinkParams: row.deeplink_params,
    },
    sound: 'default',
    badge,
    channelId: 'default',
    priority: 'high',
  }));

  const result = await deps.expoPush(messages);
  await deps.markSent(row.id);

  for (let i = 0; i < (result.data ?? []).length; i++) {
    if (result.data![i]?.details?.error === 'DeviceNotRegistered') {
      await deps.deleteToken(tokens[i].expo_push_token);
    }
  }

  return 'ok';
}

// Shared by send-push-notification and retry-push-notifications.
export function makeDeps(supa: SupabaseClient): Deps {
  return {
    fetchNotification: async (id) => {
      const { data } = await supa
        .from('notifications')
        .select('id, recipient_user_id, title, body, deeplink_screen, deeplink_params, push_sent_at')
        .eq('id', id)
        .maybeSingle();
      return (data as NotificationRow | null) ?? null;
    },
    fetchTokens: async (userId) => {
      const { data } = await supa.from('device_tokens').select('expo_push_token').eq('user_id', userId);
      return (data as { expo_push_token: string }[] | null) ?? [];
    },
    countUnread: async (userId) => {
      const { count } = await supa
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', userId)
        .is('read_at', null);
      return count ?? 0;
    },
    expoPush: async (messages) => {
      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      return resp.json();
    },
    markSent: async (id) => {
      await supa.from('notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', id);
    },
    deleteToken: async (token) => {
      await supa.from('device_tokens').delete().eq('expo_push_token', token);
    },
  };
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

// Guarded by import.meta.main so retry-push-notifications and the tests can
// import this module without binding the HTTP port.
if (import.meta.main) {
  Deno.serve(async (req) => {
    const auth = checkAuth(req.headers.get('authorization'), Deno.env.get('WEBHOOK_AUTH_SECRET'));
    if (auth === 'misconfigured') return new Response('WEBHOOK_AUTH_SECRET not set', { status: 500 });
    if (auth === 'unauthorized') return new Response('unauthorized', { status: 401 });

    const payload = await req.json().catch(() => null) as { record?: { id?: unknown } } | null;
    const id = payload?.record?.id;
    if (typeof id !== 'string') return new Response('missing record.id', { status: 400 });

    const result = await handleNotification(id, makeDeps(serviceClient()));
    return new Response(result, { status: 200 });
  });
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read`
Expected: 8 passed. (The retry function's tests break until Task 7; that is expected.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-push-notification/index.ts supabase/functions/send-push-notification/index.test.ts
git commit -m "fix(push): authenticate the push function, read content from the DB, add badge

The function accepted unauthenticated calls and pushed whatever title/body the
request carried. It now fails closed without WEBHOOK_AUTH_SECRET, trusts only
record.id, and sends the recipient's unread count as the badge on the
high-priority 'default' Android channel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Retry function reuses the shared deps and auth

**Files:**
- Modify: `supabase/functions/retry-push-notifications/index.ts` (full rewrite)
- Modify: `supabase/functions/retry-push-notifications/index.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the tests**

Replace `supabase/functions/retry-push-notifications/index.test.ts` with:

```ts
import { assertEquals } from 'std/assert';
import { runRetry, type RetryDeps } from './index.ts';

Deno.test('skips an empty pending list', async () => {
  let dispatched = 0;
  const deps: RetryDeps = {
    fetchPendingIds: async () => [],
    dispatch: async () => { dispatched++; return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result, { processed: 0, failed: 0 });
  assertEquals(dispatched, 0);
});

Deno.test('dispatches each pending id', async () => {
  const seen: string[] = [];
  const deps: RetryDeps = {
    fetchPendingIds: async () => ['1', '2', '3'],
    dispatch: async (id) => { seen.push(id); return 'ok'; },
  };
  const result = await runRetry(deps);
  assertEquals(result, { processed: 3, failed: 0 });
  assertEquals(seen, ['1', '2', '3']);
});

Deno.test('continues past per-row failures', async () => {
  const seen: string[] = [];
  const deps: RetryDeps = {
    fetchPendingIds: async () => ['1', '2', '3'],
    dispatch: async (id) => {
      seen.push(id);
      if (id === '2') throw new Error('boom');
      return 'ok';
    },
  };
  const result = await runRetry(deps);
  assertEquals(result, { processed: 3, failed: 1 });
  assertEquals(seen, ['1', '2', '3']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd supabase/functions/retry-push-notifications && deno test --allow-env --allow-net --allow-read`
Expected: FAIL at type-check (`fetchPendingIds` does not exist on `RetryDeps`).

- [ ] **Step 3: Implement**

Replace `supabase/functions/retry-push-notifications/index.ts` with:

```ts
import { checkAuth, handleNotification, makeDeps, serviceClient } from '../send-push-notification/index.ts';

export interface RetryDeps {
  fetchPendingIds: () => Promise<string[]>;
  dispatch: (id: string) => Promise<string>;
}

export async function runRetry(deps: RetryDeps): Promise<{ processed: number; failed: number }> {
  const ids = await deps.fetchPendingIds();
  let failed = 0;
  for (const id of ids) {
    try {
      await deps.dispatch(id);
    } catch {
      failed++;
    }
  }
  return { processed: ids.length, failed };
}

// Runs every 15 minutes (Dashboard cron). Re-sends anything from the last 24 h
// the webhook missed, and delivers to users who registered a phone after the
// notification was created ('no tokens' rows are never marked sent).
if (import.meta.main) {
  Deno.serve(async (req) => {
    const auth = checkAuth(req.headers.get('authorization'), Deno.env.get('WEBHOOK_AUTH_SECRET'));
    if (auth === 'misconfigured') return new Response('WEBHOOK_AUTH_SECRET not set', { status: 500 });
    if (auth === 'unauthorized') return new Response('unauthorized', { status: 401 });

    const supa = serviceClient();
    const pushDeps = makeDeps(supa);

    const result = await runRetry({
      fetchPendingIds: async () => {
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supa
          .from('notifications')
          .select('id')
          .is('push_sent_at', null)
          .gt('created_at', sinceIso)
          .order('created_at', { ascending: true })
          .limit(1000);
        return ((data as { id: string }[] | null) ?? []).map(r => r.id);
      },
      dispatch: (id) => handleNotification(id, pushDeps),
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
```

- [ ] **Step 4: Run both Deno suites to verify they pass**

```bash
(cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read)
(cd supabase/functions/retry-push-notifications && deno test --allow-env --allow-net --allow-read)
```

Expected: 8 passed, 3 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/retry-push-notifications/index.ts supabase/functions/retry-push-notifications/index.test.ts
git commit -m "refactor(push): retry function shares deps and auth with send-push-notification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Setup guide, notification icon and app config

**Files:**
- Create: `docs/deploy/android-push-setup.md`
- Create: `assets/notification-icon.png`
- Modify: `app.json` (version, android, plugins)
- Create: `google-services.json` (**from the user**, see Step 3)

- [ ] **Step 1: Write the setup guide**

Create `docs/deploy/android-push-setup.md`:

````markdown
# Android push notifications — one-time setup

Everything here is done once. Order matters in Part C.

## Part A — Firebase (≈10 min, free)

1. Open https://console.firebase.google.com → **Create a project** → name `SANO` →
   turn **Google Analytics off** → Create.
2. On the project home, click the **Android** icon ("Add app").
   - Android package name: `com.sancontractor.supervisor` (exactly)
   - App nickname: `SANO`
   - Leave SHA-1 empty → **Register app**.
3. **Download google-services.json** → put it in the repo root (next to
   `app.json`). Skip the remaining "Add Firebase SDK" steps — Expo handles them.
4. Gear icon → **Project settings** → **Service accounts** →
   **Generate new private key** → Generate. A JSON file downloads.
   **Keep it private — never commit it or paste it in chat.**

## Part B — Give the key to EAS

In a terminal in the repo:

```bash
npx eas-cli credentials -p android
```

Choose build profile `preview` → **Google Service Account** →
**Manage your Google Service Account Key for Push Notifications (FCM V1)** →
**Set up a Google Service Account Key for Push Notifications (FCM V1)** →
**Upload a new service account key** → select the JSON from Part A step 4.
The key belongs to the app (package), so `production` builds use it too.

## Part C — Supabase Dashboard

1. Create a secret — run in a terminal and copy the output:

   ```bash
   openssl rand -hex 32
   ```

2. **Check what already exists.** SQL Editor → run:

   ```sql
   SELECT tgname, pg_get_triggerdef(t.oid)
   FROM pg_trigger t
   WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal;

   SELECT jobid, jobname, schedule FROM cron.job;
   ```

   If the second query errors with `schema "cron" does not exist`, enable
   **Integrations → Cron** first.

3. **Webhook.** Database → Webhooks → create (or edit the existing one that
   calls `send-push-notification`):
   - Name `push_on_notification_insert`, table `public.notifications`, event **Insert**
   - Type **Supabase Edge Functions**, function `send-push-notification`, method POST, timeout 5000 ms
   - HTTP headers: `Content-Type: application/json` and
     `Authorization: Bearer <secret from step 1>`

4. **Retry cron.** Integrations → Cron → Jobs → create job:
   - Name `retry-push-notifications`, schedule `*/15 * * * *`
   - Type **Supabase Edge Function**, POST, function `retry-push-notifications`
   - Header `Authorization: Bearer <secret>`, body `{}`
   - Delete any older daily retry job found in step 2.

5. **Secret.** Edge Functions → Secrets → add `WEBHOOK_AUTH_SECRET` = the secret.

Steps 3–4 come before step 5 so there is no window where the webhook sends no
header but the function demands one.

## Part D — Deploy the functions (Claude or developer)

Requires `supabase login` once (Personal Access Token). From a worktree on `main`:

```bash
supabase functions deploy send-push-notification --project-ref ufntlqvacjhmddwltcxf --use-api
supabase functions deploy retry-push-notifications --project-ref ufntlqvacjhmddwltcxf --use-api
```

Verify both refuse anonymous calls (expected `401`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://ufntlqvacjhmddwltcxf.supabase.co/functions/v1/send-push-notification -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://ufntlqvacjhmddwltcxf.supabase.co/functions/v1/retry-push-notifications -d '{}'
```
````

- [ ] **Step 2: Generate the notification icon**

Android's small notification icon must be white on transparent. This draws the SANO "O" mark (rounded rectangle, 74:46 like the logo's O):

```bash
python3 - <<'EOF'
from PIL import Image, ImageDraw
size = 96
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([12, 27, 84, 69], radius=9, outline=(255, 255, 255, 255), width=10)
img.save('assets/notification-icon.png')
EOF
python3 -c "from PIL import Image; im=Image.open('assets/notification-icon.png'); print(im.size, im.mode)"
```

Expected: `(96, 96) RGBA`.

- [ ] **Step 3: USER GATE — obtain google-services.json**

Ask the user to complete `docs/deploy/android-push-setup.md` Parts A and B and place `google-services.json` in the worktree root (`.claude/worktrees/android-push/google-services.json`). Stop until it exists. Then verify it is for the right app:

```bash
python3 -c "import json; d=json.load(open('google-services.json')); print([c['client_info']['android_client_info']['package_name'] for c in d['client']])"
```

Expected: `['com.sancontractor.supervisor']`. It contains only public client identifiers and is committed. The service-account key must NOT be in the repo: `git status --porcelain | grep -i -E "firebase-adminsdk|service.?account"` must print nothing.

- [ ] **Step 4: Update app.json**

In `app.json`:

1. `"version": "3.1.0"` → `"version": "3.2.0"`.
2. In `"android"`, directly after `"package": "com.sancontractor.supervisor",` add:
   ```json
      "googleServicesFile": "./google-services.json",
   ```
3. In `"plugins"`, after `"expo-camera",` add:
   ```json
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#B29F86",
          "defaultChannel": "default"
        }
      ],
   ```

Verify the config resolves:

```bash
npx expo config --type public --json | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['version'], c['android']['googleServicesFile'], [p for p in c['plugins'] if 'expo-notifications' in str(p)])"
```

Expected: `3.2.0 ./google-services.json [['expo-notifications', {...}]]`.

- [ ] **Step 5: Commit**

```bash
git add docs/deploy/android-push-setup.md assets/notification-icon.png app.json google-services.json
git commit -m "feat(push): FCM config, notification icon and setup guide; version 3.2.0

Native config changes (google-services, expo-notifications plugin), so the
app version and OTA runtime move to 3.2.0 and phones need a new APK.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification and PR

**Files:** none changed.

- [ ] **Step 1: Run all affected tests**

```bash
npx jest tools/__tests__/pushStatus.test.ts tools/__tests__/notifications.test.ts tools/__tests__/auth.test.ts workflows/screens/hooks/__tests__/useBadgeSync.test.ts workflows/components/__tests__/PushStatusLine.test.tsx --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/'
(cd supabase/functions/send-push-notification && deno test --allow-env --allow-net --allow-read)
(cd supabase/functions/retry-push-notifications && deno test --allow-env --allow-net --allow-read)
```

Expected: jest 22 passed (3 + 13 + 1 + 3 + 2); Deno 8 and 3 passed.

- [ ] **Step 2: Run the full jest suite and typecheck**

```bash
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='supabase/functions/' --testPathIgnorePatterns='tmp/' 2>&1 | tail -6
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; cat /tmp/android-push-tsc-baseline.txt
```

Expected: no new failing suites vs `main`; tsc error count ≤ baseline.

- [ ] **Step 3: Web export still builds** (CI never runs it; Vercel does)

```bash
npx expo export --platform web --output-dir /tmp/android-push-web >/dev/null && echo WEB_OK
git status --porcelain
```

Expected: `WEB_OK`; `git status` shows no untracked source files that the commits missed.

- [ ] **Step 4: Push and open the PR** (ask the user before pushing)

```bash
git push -u origin feat/android-push
gh pr create --base main --title "Android push notifications + unread badge" --body "$(cat <<'EOF'
## Summary
- Registers Android phones for push (FCM config, high-importance channel, explicit projectId); failures are now visible as a status on the Lainnya screen instead of being swallowed
- App icon badge = unread in-app notification count
- Logout removes the phone's token
- send-push-notification: fails closed without WEBHOOK_AUTH_SECRET, reads content from the DB (callers can no longer push arbitrary text), sends badge/channel/priority
- Version 3.2.0: **needs a new APK** (native config change)

## Before merge
Dashboard steps in docs/deploy/android-push-setup.md Part C, then Part D deploy.

## Test plan
- [ ] jest + deno suites green
- [ ] New APK on a Samsung/Oppo-class phone: status "Aktif", device_tokens row appears
- [ ] Test push arrives with app killed, on lock screen, badge shows number
- [ ] Reading in app lowers badge; mark-all -> 0; logout -> no more pushes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then bind the PR with the ccd_pr tools (`get_status`, `bind_pr`).

---

### Task 10: Server rollout, APK and end-to-end check

**Files:** `tmp/send-test-push.mjs` (throwaway, not committed).

- [ ] **Step 1: USER GATE — Dashboard**

The user completes `docs/deploy/android-push-setup.md` Part C (webhook, cron, secret).

- [ ] **Step 2: Deploy the functions from main after merge**

After the user merges the PR, from a detached worktree on `origin/main` (e.g. `.claude/worktrees/deploy-main`, `git fetch && git checkout --detach origin/main`), run Part D's two deploy commands and the two curl checks. Expected: `401` and `401`. If the CLI says not logged in, ask the user to run `supabase login`.

- [ ] **Step 3: Build the APK from main**

From a worktree on `origin/main` with `npm ci` done:

```bash
npx eas-cli build -p android --profile preview --non-interactive --no-wait
```

Record the build id. When finished, confirm `npx eas-cli build:view <id> --json` shows `appVersion` 3.2.0, `runtimeVersion` 3.2.0, channel `preview`, and a `gitCommitHash` for which `git merge-base --is-ancestor <hash> origin/main` succeeds.

- [ ] **Step 4: USER GATE — install on one phone**

User installs the APK over the existing app, opens it, allows notifications. Lainnya → Notifikasi HP must read **Aktif**. Then check the row landed:

```bash
cat > tmp/send-test-push.mjs <<'EOF'
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tokens } = await s.from('device_tokens').select('user_id, platform, last_seen_at').order('last_seen_at', { ascending: false }).limit(5);
console.log('device_tokens:', tokens);
if (process.argv[2] !== 'send' || !tokens?.length) process.exit(0);
const userId = tokens[0].user_id;
const { data: pa } = await s.from('project_assignments').select('project_id').eq('user_id', userId).limit(1);
const projectId = pa?.[0]?.project_id ?? (await s.from('projects').select('id').limit(1)).data[0].id;
const { data, error } = await s.from('notifications').insert({
  project_id: projectId, recipient_user_id: userId, type: 'APPROVED',
  title: 'Tes notifikasi SANO', body: 'Jika ini muncul di layar kunci, notifikasi HP sudah aktif.',
  deeplink_screen: 'Notifikasi',
}).select('id').single();
console.log(error ?? data);
await new Promise(r => setTimeout(r, 8000));
console.log((await s.from('notifications').select('push_sent_at').eq('id', data.id).single()).data);
EOF
npx tsx tmp/send-test-push.mjs
```

Expected: at least one `android` row.

- [ ] **Step 5: Send the test push**

Ask the user to lock the phone (app closed), then:

```bash
npx tsx tmp/send-test-push.mjs send
```

Expected: the script prints a non-null `push_sent_at`; the phone shows "Tes notifikasi SANO" on the lock screen with sound; the icon badge shows a number (dot on Pixel). Opening Notifikasi and reading it lowers the badge; "tandai semua dibaca" clears it. If `push_sent_at` stays null, the webhook did not fire — recheck Part C step 3 and the function logs (Dashboard → Edge Functions → send-push-notification → Logs).

- [ ] **Step 6: Roll out and record**

- Share the APK link with supervisors (install over the old app; login is kept).
- From now on OTA updates target runtime 3.2.0; phones still on 3.1.0 get nothing until they install this APK.
- Update project memory `project_apk_distribution_eas_channel.md` with the build id, runtime 3.2.0, and that pushes are live; delete `tmp/send-test-push.mjs`.
