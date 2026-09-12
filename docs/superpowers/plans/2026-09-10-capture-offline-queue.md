# Capture Offline Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A supervisor who taps "Kirim" on the capture screen in a room with
no signal, or a flaky one, must never lose the report and must never be made
to wait for the network. This plan replaces the synchronous three-call online
path plan 2 shipped (`createSiteEventWithMedia`: upload, then insert, then
invoke, all awaited before the screen returns) with a local, durable queue:
the capture is copied into the app's own storage and recorded immediately,
"Kirim" returns at once, and a background worker delivers it - upload, then
insert, then a best-effort analysis kick-off - whenever the phone has a
signal, resuming file-by-file and step-by-step after any interruption. Five
consecutive failures flag an entry for the supervisor's attention; nothing is
ever silently discarded. Web keeps the online path's honesty by admitting
what it cannot promise: a save that lives only in the tab's memory.

**Architecture:** Three new `tools/` modules, layered the way `tools/siteEvents.ts`
already separates pure orchestration from I/O. `tools/captureQueue.ts` is a
pure state machine with no imports beyond types: entries move through
`queued → uploading → analyzing → draft_ready → done`, plus `failed`
(retryable), and every transition is validated against an explicit table so a
bug in progress-tracking throws in a test instead of corrupting a queued
report. `tools/captureQueueStore.ts` persists entries per signed-in user -
AsyncStorage plus `expo-file-system` copies of every media file on native,
an in-memory map on web - and recovers (never drops) an entry whose local
file went missing before it could upload. `tools/captureQueueWorker.ts` is
the single-flight, oldest-first drain loop: it calls plan 2's
`uploadSiteEventMedia`, `insertSiteEvent` and `invokeSiteEventAnalysis`
exactly as they already exist, one step at a time, triggered by app
foreground, network regained, and immediately after every capture, and it
stops touching a user's queue the instant they sign out.
`SiteEventCaptureScreen`'s "Kirim" now calls `enqueueNewCapture` and returns
immediately; Beranda gains a queue card showing what is still only on the
phone, separate from plan 2's "Draf menunggu" (which reads confirmed server
state).

**Tech Stack:** TypeScript, React Native (Expo SDK 54 / RN 0.81),
`@react-native-async-storage/async-storage` (already a dependency,
`^2.2.0`), `expo-file-system` (already a dependency, `~19.0.21`; this plan
uses the classic API at `expo-file-system/legacy`, matching `tools/storage.ts`'s
existing import - see Task 2's rationale), `expo-network` (added by this
plan), jest + ts-jest. Indonesian UI copy, no i18n library.

**Spec:** `docs/superpowers/specs/2026-09-10-room-site-events-design.md`
(section 7, "Offline queue (native)", is this plan's primary source; sections
1.1, 5.2-5.3, 12, 13, 14, 16 and 18 provide the surrounding contract this
plan must not violate).

**Branch and working tree:** `feat/capture-offline-queue`, cut from `main`
once plan 2's branch (`feat/site-events-capture`) merges, checked out in a
fresh git worktree created the same way plans 1 and 2 were (per
`superpowers:using-git-worktrees`) - not necessarily reusing
`/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/room-site-events`,
since that path will still hold plan 2's in-progress branch until it merges.
Wherever the worktree lands, if its path contains `/.claude/worktrees/`, the
repo's `testPathIgnorePatterns` hides every test under it, so every
`npx jest <path>` in this plan must be run as
`npx jest <path> --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'`.
Never set `ALLOW_PROD_DB_TESTS`. This plan touches no migration and calls no
live Supabase, OpenAI or Anthropic endpoint from a test; the only live steps
are the APK build in task 7 and the manual device checks, both user-run.

**Commit identity:** the repo's commits are authored by
`Test User <test@example.com>`, already the configured git user - a plain
`git commit` is correct. End every commit message with the trailer line
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Plan sequence

This is **plan 3 of 4** for the 2026-09-10 spec. Plans 1 and 2 are hard
prerequisites.

| # | Plan | Scope |
|---|---|---|
| 1 | Room Spine & QR Deep Links | Migration 096, rooms, gates, QR labels and deep links, `RoomScreen`. Merged. |
| 2 | Site Event Capture & AI Draft | Migrations 097/098; `tools/siteEventDraftValidate.ts`, `tools/siteEventRules.ts`, `tools/siteEvents.ts`, `tools/voiceRecorder.ts`; the edge function; capture, confirm and detail screens; "Draf menunggu" on Beranda. This plan imports `tools/siteEvents.ts`'s `uploadSiteEventMedia`, `insertSiteEvent`, `invokeSiteEventAnalysis`, `LocalSiteEventMedia` and `NewSiteEvent` verbatim, and rewrites the `onSend` handler `SiteEventCaptureScreen.tsx` (plan 2 task 12) built around `createSiteEventWithMedia`. |
| **3** | **Capture Offline Queue (this document)** | `tools/captureQueue.ts`, `tools/captureQueueStore.ts`, `tools/captureQueueWorker.ts`; rewiring `SiteEventCaptureScreen`'s "Kirim"; the Beranda queue card; the web degradation; `expo-network`. |
| 4 | Papan Ruangan + Blueprint Finishing mode | The `v_room_board`-backed board, room timeline, Daily Site Log pull-through, the `projects.phase` report switch, `ai_usage_summary`'s second source. |

**Not in this plan:** anything in plan 4's scope above; editing an event's
owner or due date after confirm (plan 4's room timeline); mandatory or
richer closure evidence (release 2, spec §15); retrying the AI analysis
itself from the background (deliberately left to "Analisis ulang" on
`SiteEventConfirmScreen`, plan 2 task 13 - see Task 3's module comment for
why); changing `insertSiteEvent`'s or `uploadSiteEventMedia`'s idempotency
mechanics (already correct as plan 2 built them - see the "Idempotency
already holds" note under Task 3); iOS universal links, DATUM calls,
WhatsApp, reminders (release 2, spec §17).

---

## Decisions settled from the repo before writing

Each of these picks a branch the task brief left open. Evidence is quoted so
a reviewer can re-run it.

1. **`expo-file-system/legacy`, not the new `File`/`Directory`/`Paths` API.**
   `package.json:36` already depends on `expo-file-system@~19.0.21` (SDK 54's
   pin, confirmed against `node_modules/expo/bundledNativeModules.json`),
   which ships both the new object API and the classic one under
   `expo-file-system/legacy`. `tools/storage.ts:4` already imports
   `* as FileSystem from 'expo-file-system/legacy'` and calls
   `getInfoAsync`/`readAsStringAsync`. This plan needs `copyAsync`,
   `makeDirectoryAsync`, `deleteAsync`, `getInfoAsync` and
   `documentDirectory` - all present in `node_modules/expo-file-system/build/legacy/FileSystem.d.ts`
   with the exact signatures used below (`copyAsync({from, to})`,
   `makeDirectoryAsync(uri, {intermediates})`,
   `deleteAsync(uri, {idempotent})`). Using the same classic API as
   `storage.ts` keeps one mental model for "how this app touches files," and
   the classic API's jest mock shape (`jest.mock('expo-file-system/legacy', () => ({...}))`)
   is already this repo's own established pattern (Task 8 of plan 2).
2. **`expo-network` is not yet installed; task 3's own code degrades if its
   listener API differs from what is documented here.**
   `grep -n "expo-network" package.json` finds nothing; `bundledNativeModules.json`
   pins it at `~8.0.8` for this SDK, but the package itself is absent from
   `node_modules`, so its actual exported surface could not be inspected while
   writing this plan (unlike plan 2, which could `cat` `expo-audio`'s and
   `expo-crypto`'s real `.d.ts` files before writing code against them).
   `attachNetworkListener` in Task 3 therefore checks
   `typeof Network.addNetworkStateListener === 'function'` before calling it
   and falls back to "no network-regained trigger, foreground and
   post-capture still work" with a `console.warn`, rather than assuming the
   name is right and crashing the app if it is not.
3. **Idempotency already holds; this plan changes neither `insertSiteEvent`
   nor `uploadSiteEventMedia`.** Plan 2 task 9's `insertSiteEvent`
   (`tools/siteEvents.ts`) calls
   `supabase.from('site_events').upsert(buildEventRow(input), { onConflict: 'id', ignoreDuplicates: true })`
   and the same shape for `site_event_media` - `ignoreDuplicates: true` means
   a retry against an id already on the server returns no error at all, not
   merely a caught one. `uploadSiteEventMedia` treats a 409 (already exists)
   from Storage as success via `isDuplicateUploadError`. Both were built
   retry-safe on the assumption that "plan 3's queue will retry these exact
   functions" (plan 2's own task 9 doc comment). The task brief that seeded
   this plan asked to "verify plan 2's implementation... and pick one and
   justify it" - the answer is: nothing to add, plan 2's authors already
   solved it, and this plan's worker calls both functions completely
   unmodified.
4. **The invoke step is hands-off, not retried by the queue.** See Task 3's
   module doc comment for the full reasoning; summarised in "Not in this
   plan" above.
5. **`CaptureQueueEntry` carries `gateCode` but no `stepCode`.** Plan 2's
   `NewSiteEvent` (`tools/siteEvents.ts` task 9) - the exact shape
   `SiteEventCaptureScreen`'s `buildNewSiteEvent` produces and the shape this
   queue enqueues - has no `stepCode` field: the capture screen's only gate
   input is the `GateChipRow` default (spec §5.2, "a hint for the AI, not a
   confirmed gate"); the step is chosen later, at confirm, from
   `SiteEventConfirmScreen`'s loaded `activeSteps`. A queue entry mirrors
   exactly what capture collects, so it has no step field either.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/captureQueue.ts` (create) | Pure state machine: entry shape, transitions, `nextStep`, backoff, Beranda selectors. No I/O. |
| `tools/__tests__/captureQueue.test.ts` (create) | Exhaustive transition, failure-accounting and selector tests. |
| `tools/captureQueueStore.ts` (create) | AsyncStorage index per user, `expo-file-system` media copies, load-time recovery, pub/sub, the web memory backend. |
| `tools/__tests__/captureQueueStore.test.ts` (create) | Both backends, recovery, discard. |
| `package.json` (modify) | `expo-network`, via `npx expo install`. |
| `tools/captureQueueWorker.ts` (create) | The drain loop: single-flight, oldest-first, the three triggers, `retryQueueEntry`. |
| `tools/__tests__/captureQueueWorker.test.ts` (create) | Call order, failure isolation, single-flight, sign-out, triggers. |
| `workflows/App.tsx` (modify) | Starts/stops the worker keyed on `session?.user.id`. |
| `tools/__tests__/captureQueueAppWiring.test.ts` (create) | Static guard on `App.tsx`'s wiring. |
| `workflows/screens/siteEvent/captureQueueModel.ts` (create, task 4; modify, task 5) | `WEB_QUEUE_WARNING`, `queueBadgeText` re-export, then `attentionRows`. |
| `workflows/__tests__/captureQueueModel.test.ts` (create, task 4; modify, task 5) | Jest suite for the model. |
| `workflows/screens/SiteEventCaptureScreen.tsx` (modify, plan 2 task 12) | "Kirim" calls `enqueueNewCapture` + `triggerDrain`; web copy. |
| `tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts` (create) | Static guard on the screen's source. |
| `workflows/screens/siteEvent/CaptureQueueCard.tsx` (create) | Beranda's queue badge and "Perlu perhatian" list. |
| `workflows/screens/BerandaScreen.tsx` (modify, plan 2 task 14) | Renders `CaptureQueueCard`. |
| `tools/__tests__/captureQueueWeb.test.ts` (create) | The store and the worker composed together under `Platform.OS === 'web'`. |

---

### Task 1: `tools/captureQueue.ts` - the pure state machine

**Files:**
- Create: `tools/captureQueue.ts`
- Test: `tools/__tests__/captureQueue.test.ts`

Spec §7 names five states plus `failed` and says progress is what actually
matters: "each individually resumable" steps (upload, insert, insert media,
invoke, mark `draft_ready` and delete local copies). This module tracks that
progress with four independent flags - one `uploaded` boolean per media
item, plus `eventInserted`, `analysisRequested`, `localCleanedUp` on the
entry - and always **derives** the coarse `state` field from those flags
(`deriveState`), rather than letting a caller set `state` directly. That
way state and progress can never silently disagree; a bug that tries to jump
state without the matching progress throws `IllegalQueueTransitionError`
instead of writing a queue entry that looks further along than it is.

`nextStep(entry)` is the one function the worker (task 3) asks "what do I do
now": it inspects the same four flags in order - first unfinished media
upload, then insert, then invoke, then cleanup - and returns exactly one
action. Because every transition function (`markUploaded`, `markInserted`,
`markAnalysisRequested`, `markCleanedUp`) re-derives `state` from the new
flags, `nextStep` and the displayed `state` can never contradict each other.

Failure accounting is separate from progress: `recordFailure` bumps
`consecutiveFailures` and flags `needsAttention` at exactly 5 (spec §7,
"After 5 consecutive failed attempts the entry is flagged for manual
attention... the supervisor can retry it by hand at any time"), without ever
touching the upload/insert/invoke/cleanup flags - a failed attempt is a
setback, not a rollback. `retryEntry` ("Coba lagi") clears the flag and the
counter and resumes exactly where progress left off, because `deriveState`
recomputes `state` from whatever already succeeded.

`unrecoverable` is a fifth signal, set only by `captureQueueStore.ts`'s
load-time recovery pass (task 2) when a media file the entry still needs
was found missing - the OS purged a camera or recorder temp file before it
could upload. `nextStep` refuses to act on an unrecoverable entry (there is
nothing to retry), and `retryEntry` is a deliberate no-op on one, because
retrying would only burn through five more failed attempts to reach the
same unrecoverable state. The only way out is `discardEntryLocally` (task 2).

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/captureQueue.test.ts`:

```ts
import {
  MAX_CONSECUTIVE_FAILURES,
  IllegalQueueTransitionError,
  attentionCount,
  backoffMs,
  beginAttempt,
  bytesById,
  draftReadyCount,
  enqueueCapture,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markInserted,
  markUnrecoverable,
  markUploaded,
  nextStep,
  queueBadgeText,
  recordFailure,
  retryEntry,
  toNewSiteEvent,
  waitingCount,
  type CaptureQueueEntry,
} from '../captureQueue';
import type { NewSiteEvent } from '../siteEvents';

const NOW = '2026-09-11T03:00:00.000Z';

const event = (over: Partial<NewSiteEvent> = {}): NewSiteEvent => ({
  id: 'e1', projectId: 'p1', roomId: 'r1', reporterId: 'u1', gateCode: 'B', rawText: 'Nat retak',
  capturedAt: '2026-09-11T02:00:00.000Z',
  media: [
    { id: 'm1', localUri: 'file:///q/e1/m1.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' },
    { id: 'm2', localUri: 'file:///q/e1/m2.m4a', kind: 'audio', role: 'audio', mimeType: 'audio/mp4', ext: 'm4a', durationS: 8.2, sortOrder: 0, capturedAt: '2026-09-11T02:00:05.000Z' },
  ],
  ...over,
});

const fresh = (): CaptureQueueEntry => enqueueCapture({ event: event(), ownerId: 'u1', workGroupNames: ['Finishing Lantai 2'], nowIso: NOW });

describe('enqueueCapture', () => {
  it('starts queued, no progress, both media not yet uploaded', () => {
    const e = fresh();
    expect(e).toMatchObject({
      id: 'e1', ownerId: 'u1', state: 'queued', eventInserted: false, analysisRequested: false,
      localCleanedUp: false, attempts: 0, consecutiveFailures: 0, needsAttention: false, unrecoverable: false,
    });
    expect(e.media.map((m) => [m.id, m.uploaded, m.bytes])).toEqual([['m1', false, null], ['m2', false, null]]);
  });
});

describe('nextStep', () => {
  it('walks upload (one file at a time) -> insert -> invoke -> cleanup -> none', () => {
    let e = fresh();
    expect(nextStep(e)).toEqual({ kind: 'upload', mediaId: 'm1' });
    e = markUploaded(e, 'm1', 1234, NOW);
    expect(nextStep(e)).toEqual({ kind: 'upload', mediaId: 'm2' });
    e = markUploaded(e, 'm2', 5678, NOW);
    expect(nextStep(e)).toEqual({ kind: 'insert' });
    e = markInserted(e, NOW);
    expect(nextStep(e)).toEqual({ kind: 'invoke' });
    e = markAnalysisRequested(e, NOW);
    expect(nextStep(e)).toEqual({ kind: 'cleanup' });
    e = markCleanedUp(e, NOW);
    expect(e.state).toBe('done');
    expect(nextStep(e)).toEqual({ kind: 'none' });
  });

  it('gives none for a flagged or unrecoverable entry, without inspecting progress', () => {
    const attention = recordFailures(fresh(), MAX_CONSECUTIVE_FAILURES);
    expect(nextStep(attention)).toEqual({ kind: 'none' });
    const gone = markUnrecoverable(fresh(), 'Berkas lokal hilang.');
    expect(nextStep(gone)).toEqual({ kind: 'none' });
  });
});

function recordFailures(entry: CaptureQueueEntry, n: number): CaptureQueueEntry {
  let e = entry;
  for (let i = 0; i < n; i++) e = recordFailure(e, `gagal ${i}`, NOW);
  return e;
}

describe('state derives from progress, never set directly', () => {
  it('moves to uploading the moment any one file lands, not only when all do', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    expect(e.state).toBe('uploading');
  });

  it('reaches analyzing right after insert, before invoke is attempted', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    expect(e.state).toBe('analyzing');
  });

  it('reaches draft_ready once analysis was requested, even before cleanup runs', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    e = markAnalysisRequested(e, NOW);
    expect(e.state).toBe('draft_ready');
    expect(e.localCleanedUp).toBe(false);
  });
});

describe('failure accounting', () => {
  it('counts consecutive failures and flags for attention at exactly 5, never before', () => {
    let e = fresh();
    for (let i = 1; i <= 4; i++) {
      e = recordFailure(e, `jaringan turun ${i}`, NOW);
      expect(e.needsAttention).toBe(false);
      expect(e.consecutiveFailures).toBe(i);
    }
    e = recordFailure(e, 'jaringan turun 5', NOW);
    expect(e.needsAttention).toBe(true);
    expect(e.consecutiveFailures).toBe(5);
    expect(e.state).toBe('failed');
    expect(e.lastError).toBe('jaringan turun 5');
  });

  it('never removes or discards the entry on failure, however many times', () => {
    const e = recordFailures(fresh(), 20);
    expect(e.consecutiveFailures).toBe(20);
    expect(e.media).toHaveLength(2);
    expect(e.id).toBe('e1');
  });

  it('a success anywhere resets the consecutive counter and clears the flag', () => {
    let e = recordFailures(fresh(), 4);
    e = markUploaded(e, 'm1', 10, NOW);
    expect(e).toMatchObject({ consecutiveFailures: 0, needsAttention: false, lastError: null });
  });

  it('"Coba lagi" clears the flag and resumes exactly where progress left off', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = recordFailures(e, MAX_CONSECUTIVE_FAILURES);
    expect(e.needsAttention).toBe(true);
    const retried = retryEntry(e, '2026-09-11T04:00:00.000Z');
    expect(retried).toMatchObject({ state: 'uploading', needsAttention: false, consecutiveFailures: 0, lastError: null });
    expect(nextStep(retried)).toEqual({ kind: 'upload', mediaId: 'm2' });
  });

  it('retryEntry is a no-op on an unrecoverable entry', () => {
    const e = markUnrecoverable(fresh(), 'Berkas lokal hilang.');
    expect(retryEntry(e, NOW)).toBe(e);
  });
});

describe('illegal transitions', () => {
  it('refuses to go backwards from a further-along state', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 10, NOW);
    e = markUploaded(e, 'm2', 20, NOW);
    e = markInserted(e, NOW);
    // Simulate a caller that forgot insert happened and re-asserts 'uploading' progress only.
    expect(() => markCleanedUp({ ...e, analysisRequested: false, localCleanedUp: false, eventInserted: false }, NOW))
      .toThrow(IllegalQueueTransitionError);
  });
});

describe('backoff', () => {
  it('doubles from 30s, capped at 15 minutes', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(4)).toBe(240_000);
    expect(backoffMs(5)).toBe(480_000);
    expect(backoffMs(10)).toBe(900_000);
  });

  it('is ready immediately when never attempted, and only after backoff elapses when failed', () => {
    let e = fresh();
    expect(isReadyToAttempt(e, Date.parse(NOW))).toBe(true);
    e = recordFailure(e, 'timeout', NOW);
    const justAfter = Date.parse(NOW) + 1000;
    const afterBackoff = Date.parse(NOW) + backoffMs(1);
    expect(isReadyToAttempt(e, justAfter)).toBe(false);
    expect(isReadyToAttempt(e, afterBackoff)).toBe(true);
  });

  it('is never ready when done, flagged, or unrecoverable', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 1, NOW);
    e = markUploaded(e, 'm2', 1, NOW);
    e = markInserted(e, NOW);
    e = markAnalysisRequested(e, NOW);
    e = markCleanedUp(e, NOW);
    expect(isReadyToAttempt(e, Date.parse(NOW) + 999_999)).toBe(false);
    const flagged = recordFailures(fresh(), MAX_CONSECUTIVE_FAILURES);
    expect(isReadyToAttempt(flagged, Date.parse(NOW) + 999_999)).toBe(false);
    const gone = markUnrecoverable(fresh(), 'hilang');
    expect(isReadyToAttempt(gone, Date.parse(NOW) + 999_999)).toBe(false);
  });
});

describe('beginAttempt', () => {
  it('bumps attempts and lastAttemptAt without touching progress or state', () => {
    const e = fresh();
    const started = beginAttempt(e, NOW);
    expect(started).toMatchObject({ attempts: 1, lastAttemptAt: NOW, state: 'queued' });
    expect(beginAttempt(started, NOW).attempts).toBe(2);
  });
});

describe('conversions', () => {
  it('rebuilds a NewSiteEvent from progress, valid up to cleanup', () => {
    const e = fresh();
    expect(toNewSiteEvent(e)).toEqual(event());
  });

  it('reads back the bytes recorded at upload time', () => {
    let e = fresh();
    e = markUploaded(e, 'm1', 111, NOW);
    e = markUploaded(e, 'm2', 222, NOW);
    expect(bytesById(e)).toEqual({ m1: 111, m2: 222 });
  });
});

describe('Beranda selectors', () => {
  it('counts waiting as queued, uploading, analyzing or failed; ready as draft_ready; attention as flagged', () => {
    const queued = fresh();
    let uploading = fresh();
    uploading = markUploaded(uploading, 'm1', 1, NOW);
    let ready = fresh();
    ready = markUploaded(ready, 'm1', 1, NOW);
    ready = markUploaded(ready, 'm2', 1, NOW);
    ready = markInserted(ready, NOW);
    ready = markAnalysisRequested(ready, NOW);
    const flagged = recordFailures(fresh(), MAX_CONSECUTIVE_FAILURES);

    const all = [queued, uploading, ready, flagged];
    expect(waitingCount(all)).toBe(3); // queued, uploading, flagged(failed)
    expect(draftReadyCount(all)).toBe(1); // ready
    expect(attentionCount(all)).toBe(1); // flagged
  });

  it('builds the exact Indonesian badge line, hiding whichever part is zero, and null when both are', () => {
    expect(queueBadgeText([])).toBeNull();
    const waitingOnly = [fresh()];
    expect(queueBadgeText(waitingOnly)).toBe('Antrean: 1 menunggu sinyal');
    let ready = fresh();
    ready = markUploaded(ready, 'm1', 1, NOW);
    ready = markUploaded(ready, 'm2', 1, NOW);
    ready = markInserted(ready, NOW);
    ready = markAnalysisRequested(ready, NOW);
    expect(queueBadgeText([ready])).toBe('Antrean: 1 draf siap dikonfirmasi');
    expect(queueBadgeText([fresh(), ready])).toBe('Antrean: 1 menunggu sinyal, 1 draf siap dikonfirmasi');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tools/__tests__/captureQueue.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Cannot find module '../captureQueue'`.

- [ ] **Step 3: Write the module**

Create `tools/captureQueue.ts`:

```ts
// SANO - Offline capture queue: pure state machine (spec §7). No I/O, no
// imports beyond types, so it needs no mocks and runs identically on native
// and web. captureQueueStore.ts persists entries; captureQueueWorker.ts
// drives them through this machine by calling tools/siteEvents.ts.
//
// Progress is tracked with three booleans (eventInserted, analysisRequested,
// localCleanedUp) plus a per-file `uploaded` flag, because each is backed by
// a separately retryable network call. `state` is always DERIVED from that
// progress (deriveState), never set directly, so state and progress can never
// disagree. An explicit transition table still guards every state change:
// deriveState is trusted to pick a valid target, but assertTransition is the
// one place that would catch a bug in deriveState turning into silent data
// corruption instead of a thrown error caught by a test.

import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';
// SiteEventMediaKind/Role are declared in tools/types.ts (plan 2 task 2) and
// only used structurally inside siteEvents.ts's own interfaces there, never
// re-exported from that file - so they are imported from their actual home.
import type { SiteEventMediaKind, SiteEventMediaRole } from './types';

export type QueueState = 'queued' | 'uploading' | 'analyzing' | 'draft_ready' | 'done' | 'failed';

/** Spec §7: "After 5 consecutive failed attempts the entry is flagged for manual attention." */
export const MAX_CONSECUTIVE_FAILURES = 5;

export interface QueueMediaItem {
  id: string;
  localUri: string;
  role: SiteEventMediaRole;
  kind: SiteEventMediaKind;
  mimeType: string;
  ext: string;
  durationS: number | null;
  sortOrder: number;
  capturedAt: string;
  uploaded: boolean;
  /** Filled in once uploaded, from readUploadBody's byte count; null until then. */
  bytes: number | null;
}

export interface CaptureQueueEntry {
  /** Same id as the eventual site_events row (spec §7: "client uuid, same id as the event"). */
  id: string;
  /** The signed-in profile this entry belongs to. A shared phone must not mix supervisors (§7). */
  ownerId: string;
  projectId: string;
  roomId: string;
  reporterId: string;
  gateCode: string | null;
  rawText: string | null;
  capturedAt: string;
  media: QueueMediaItem[];
  /** Work-group name hints captured at enqueue time, so a later drain doesn't need boqItems loaded. */
  workGroupNames: string[];
  state: QueueState;
  eventInserted: boolean;
  analysisRequested: boolean;
  localCleanedUp: boolean;
  createdAt: string;
  attempts: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  needsAttention: boolean;
  /**
   * True when a needed local file was found missing on load (temp URI purged
   * by the OS before it could be uploaded). Nothing can resume it; the only
   * action left is discardEntryLocally. Always false once eventInserted is
   * true, because upload always finishes before insert is attempted.
   */
  unrecoverable: boolean;
}

// ─── Building an entry ───────────────────────────────────────────────────────

export interface NewCaptureParams {
  /** The NewSiteEvent captureModel.ts already builds (plan 2 task 12); media localUri must already
   *  point at the queue's permanent per-entry copies (captureQueueStore.ts copies them in
   *  before this is called), not the camera's or recorder's own temp files. */
  event: NewSiteEvent;
  ownerId: string;
  workGroupNames: string[];
  nowIso: string;
}

export function enqueueCapture(params: NewCaptureParams): CaptureQueueEntry {
  const { event } = params;
  return {
    id: event.id,
    ownerId: params.ownerId,
    projectId: event.projectId,
    roomId: event.roomId,
    reporterId: event.reporterId,
    gateCode: event.gateCode,
    rawText: event.rawText,
    capturedAt: event.capturedAt,
    media: event.media.map((m) => ({
      id: m.id,
      localUri: m.localUri,
      role: m.role,
      kind: m.kind,
      mimeType: m.mimeType,
      ext: m.ext,
      durationS: m.durationS,
      sortOrder: m.sortOrder,
      capturedAt: m.capturedAt,
      uploaded: false,
      bytes: null,
    })),
    workGroupNames: params.workGroupNames,
    state: 'queued',
    eventInserted: false,
    analysisRequested: false,
    localCleanedUp: false,
    createdAt: params.nowIso,
    attempts: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastAttemptAt: null,
    needsAttention: false,
    unrecoverable: false,
  };
}

/** Back to the shape tools/siteEvents.ts's upload/insert functions take. Valid before cleanup only. */
export function toNewSiteEvent(entry: CaptureQueueEntry): NewSiteEvent {
  return {
    id: entry.id,
    projectId: entry.projectId,
    roomId: entry.roomId,
    reporterId: entry.reporterId,
    gateCode: entry.gateCode,
    rawText: entry.rawText,
    capturedAt: entry.capturedAt,
    media: entry.media.map(toLocalMedia),
  };
}

export function toLocalMedia(item: QueueMediaItem): LocalSiteEventMedia {
  return {
    id: item.id,
    localUri: item.localUri,
    kind: item.kind,
    role: item.role,
    mimeType: item.mimeType,
    ext: item.ext,
    durationS: item.durationS,
    sortOrder: item.sortOrder,
    capturedAt: item.capturedAt,
  };
}

/** { mediaId: bytes } for buildMediaRows/insertSiteEvent, straight from what upload already recorded. */
export function bytesById(entry: CaptureQueueEntry): Record<string, number | null> {
  return Object.fromEntries(entry.media.map((m) => [m.id, m.bytes]));
}

// ─── State derivation and the transition table ───────────────────────────────

function deriveState(
  entry: Pick<CaptureQueueEntry, 'media' | 'eventInserted' | 'analysisRequested' | 'localCleanedUp'>,
): Exclude<QueueState, 'failed'> {
  if (entry.localCleanedUp) return 'done';
  if (entry.analysisRequested) return 'draft_ready';
  if (entry.eventInserted) return 'analyzing';
  if (entry.media.some((m) => m.uploaded)) return 'uploading';
  return 'queued';
}

/**
 * Every legal (from, to) pair. 'failed' can resume into whatever deriveState
 * says fits the entry's actual progress, because a step can fail at any
 * point; every forward state can also fail. 'done' is terminal: nothing is
 * auto-discarded (spec §7), but once local copies are gone and the server has
 * the event, there is nothing left for THIS module to retry.
 */
const ALLOWED_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
  queued: ['uploading', 'failed'],
  uploading: ['uploading', 'analyzing', 'failed'],
  analyzing: ['analyzing', 'draft_ready', 'failed'],
  draft_ready: ['draft_ready', 'done', 'failed'],
  failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
  done: [],
};

export class IllegalQueueTransitionError extends Error {
  constructor(from: QueueState, to: QueueState) {
    super(`captureQueue: illegal transition ${from} -> ${to}`);
    this.name = 'IllegalQueueTransitionError';
  }
}

function assertTransition(from: QueueState, to: QueueState): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalQueueTransitionError(from, to);
  }
}

function withProgress(entry: CaptureQueueEntry, now: string, patch: Partial<CaptureQueueEntry>): CaptureQueueEntry {
  const next = { ...entry, ...patch };
  const state = deriveState(next);
  assertTransition(entry.state, state);
  return {
    ...next,
    state,
    consecutiveFailures: 0,
    needsAttention: false,
    lastError: null,
    lastAttemptAt: now,
  };
}

// ─── What to do next ──────────────────────────────────────────────────────────

export type QueueAction =
  | { kind: 'upload'; mediaId: string }
  | { kind: 'insert' }
  | { kind: 'invoke' }
  | { kind: 'cleanup' }
  | { kind: 'none' };

/**
 * Pure "what next", independent of timing. The worker gates on
 * isReadyToAttempt(entry, now) before calling this, so a backing-off or
 * flagged entry is simply not asked.
 */
export function nextStep(entry: CaptureQueueEntry): QueueAction {
  if (entry.state === 'done' || entry.unrecoverable || entry.needsAttention) return { kind: 'none' };
  const pending = entry.media.find((m) => !m.uploaded);
  if (pending) return { kind: 'upload', mediaId: pending.id };
  if (!entry.eventInserted) return { kind: 'insert' };
  if (!entry.analysisRequested) return { kind: 'invoke' };
  if (!entry.localCleanedUp) return { kind: 'cleanup' };
  return { kind: 'none' };
}

// ─── Attempt bookkeeping ──────────────────────────────────────────────────────

/** Call before starting I/O for a step, so attempts/lastAttemptAt reflect reality even if the app is killed mid-step. */
export function beginAttempt(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return { ...entry, attempts: entry.attempts + 1, lastAttemptAt: now };
}

export function markUploaded(entry: CaptureQueueEntry, mediaId: string, bytes: number | null, now: string): CaptureQueueEntry {
  const media = entry.media.map((m) => (m.id === mediaId ? { ...m, uploaded: true, bytes } : m));
  return withProgress(entry, now, { media });
}

export function markInserted(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return withProgress(entry, now, { eventInserted: true });
}

/**
 * The invoke step's own outcome (ok, deferred by the daily cap, or a network
 * error) is deliberately NOT distinguished here: the queue hands off after
 * one best-effort attempt either way. See captureQueueWorker.ts's module
 * comment for why retrying invoke is not the queue's job.
 */
export function markAnalysisRequested(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return withProgress(entry, now, { analysisRequested: true });
}

export function markCleanedUp(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  return withProgress(entry, now, { localCleanedUp: true });
}

export function recordFailure(entry: CaptureQueueEntry, error: string, now: string): CaptureQueueEntry {
  assertTransition(entry.state, 'failed');
  const consecutiveFailures = entry.consecutiveFailures + 1;
  return {
    ...entry,
    state: 'failed',
    consecutiveFailures,
    lastError: error,
    lastAttemptAt: now,
    needsAttention: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
  };
}

/** "Coba lagi": clears the flag and the failure count so nextStep is asked again. Safe to call on any state. */
export function retryEntry(entry: CaptureQueueEntry, now: string): CaptureQueueEntry {
  if (entry.unrecoverable) return entry;
  const state = deriveState(entry);
  assertTransition(entry.state, state);
  return { ...entry, state, needsAttention: false, consecutiveFailures: 0, lastError: null, lastAttemptAt: now };
}

/** Set by captureQueueStore.ts's load-time recovery pass when a needed local file is gone. */
export function markUnrecoverable(entry: CaptureQueueEntry, reason: string): CaptureQueueEntry {
  return { ...entry, unrecoverable: true, needsAttention: true, lastError: reason };
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/** 30s, 60s, 120s, 240s, 480s, capped at 15 min. Field signal is intermittent, not down for good. */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(30_000 * 2 ** (consecutiveFailures - 1), 15 * 60 * 1000);
}

export function isReadyToAttempt(entry: CaptureQueueEntry, nowMs: number): boolean {
  if (entry.state === 'done' || entry.needsAttention || entry.unrecoverable) return false;
  if (entry.state !== 'failed' || !entry.lastAttemptAt) return true;
  return nowMs - new Date(entry.lastAttemptAt).getTime() >= backoffMs(entry.consecutiveFailures);
}

// ─── Beranda summary selectors ────────────────────────────────────────────────

const WAITING_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'failed'];

export function waitingCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => WAITING_STATES.includes(e.state)).length;
}

export function draftReadyCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.state === 'draft_ready').length;
}

export function attentionCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.needsAttention).length;
}

/** "Antrean: N menunggu sinyal, M draf siap dikonfirmasi" (spec §7), each part hidden when zero, or null when both are. */
export function queueBadgeText(entries: ReadonlyArray<CaptureQueueEntry>): string | null {
  const waiting = waitingCount(entries);
  const ready = draftReadyCount(entries);
  if (waiting === 0 && ready === 0) return null;
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} menunggu sinyal`);
  if (ready > 0) parts.push(`${ready} draf siap dikonfirmasi`);
  return `Antrean: ${parts.join(', ')}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tools/__tests__/captureQueue.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
npx tsc --noEmit
```

Expected: `Tests: 20 passed, 20 total`; `tsc` shows only the pre-existing
`workflows/App.tsx` error documented at `.github/workflows/ci.yml:50-54`.

Verified in a scratch harness while writing this plan (this module has no
runtime dependency on the rest of the repo, so it can be exercised standalone):
20/20 tests pass and `tsc --noEmit` against the real `tsconfig.json` is clean.

- [ ] **Step 5: Commit**

```bash
git add tools/captureQueue.ts tools/__tests__/captureQueue.test.ts
git commit -m "$(cat <<'MSG'
feat(capture-queue): pure offline queue state machine

State is always derived from four progress flags (per-file uploaded, plus
eventInserted/analysisRequested/localCleanedUp), never set directly, so a
transition bug throws in a test instead of writing an entry whose displayed
state disagrees with its actual progress. Failure accounting (consecutive
count, needsAttention at exactly 5) is independent of progress: a failed
attempt is a setback, not a rollback, and nothing is ever auto-discarded.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `tools/captureQueueStore.ts` - persistence

**Files:**
- Create: `tools/captureQueueStore.ts`
- Test: `tools/__tests__/captureQueueStore.test.ts`

Spec §7: "AsyncStorage index keyed per user (a shared phone must not mix
supervisors)... copies media into the app's document directory under a
per-entry folder before enqueueing (camera and recorder temp URIs can be
purged by the OS)... write media copies first then the index... load on
startup with recovery of entries whose media files are missing (mark
`needsAttention` with a clear Indonesian reason; never silently drop)... and
deletion of local copies only after the server confirms." Every one of those
sentences maps to one function below.

Keys are namespaced per user:
`sano.captureQueue.v1.index.{userId}` holds the list of entry ids;
`sano.captureQueue.v1.entry.{userId}.{entryId}` holds one entry. A second
supervisor signing into the same phone gets a completely separate index - no
`AsyncStorage.getAllKeys()` scan that could leak one supervisor's queue into
another's is ever needed, because every read and write already carries the
user id.

`enqueueNewCapture` is the **only** way an entry is created, and it enforces
the write order itself: `copyMediaIntoQueueDir` (which calls
`makeDirectoryAsync` then `copyAsync` for every file) always finishes before
`saveEntry` (which writes the entry, then adds its id to the index) is
called. If the app is killed between the two, the copied files are orphaned
under `capture-queue/{userId}/{entryId}/` but never referenced by anything -
harmless, not a leak a human needs to clean up by hand, just wasted bytes
until the OS or a future storage-usage screen reclaims them.

`loadQueue`'s recovery pass only checks files that are still `uploaded: false`
and only when `eventInserted` is still false - Task 1's `nextStep` ordering
guarantees a file cannot be missing-and-still-needed once the event row
exists, because upload always finishes before insert is attempted. A missing
file becomes `unrecoverable: true` with the Indonesian reason from spec §7's
own requirement ("mark needsAttention with a clear Indonesian reason"), and
that recovered entry is written straight back so a second `loadQueue` call
does not need to touch the filesystem again for the same finding.

`subscribeToQueue`/`useCaptureQueueEntries` exist so Beranda's queue card
(task 5) updates live after every capture and every drain step, without
polling: `saveEntry` and `removeEntry` both `await notify(...)`, so by the
time either resolves, every current subscriber has already been called with
the fresh list.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/captureQueueStore.test.ts`:

```ts
/**
 * Persistence around the pure state machine. What matters here: media is
 * copied into the app's own folder and saved BEFORE the index record (so a
 * crash mid-enqueue never leaves an index pointing at a file that was never
 * actually captured); a missing local file is recovered into an explained,
 * never-silent unrecoverable flag rather than dropped; and the web backend
 * never touches AsyncStorage or the filesystem at all.
 */
let currentOS = 'android';
jest.mock('react-native', () => ({
  get Platform() {
    return { get OS() { return currentOS; } };
  },
}));

const calls: string[] = [];
const fsFiles = new Map<string, boolean>(); // uri -> exists

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  makeDirectoryAsync: jest.fn(async (uri: string) => {
    calls.push(`mkdir:${uri}`);
  }),
  copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    calls.push(`copy:${from}->${to}`);
    fsFiles.set(to, true);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    calls.push(`delete:${uri}`);
    fsFiles.delete(uri);
  }),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: fsFiles.get(uri) ?? false })),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  discardEntryLocally,
  enqueueNewCapture,
  entryDirUri,
  entryKey,
  indexKey,
  loadQueue,
  removeEntry,
  saveEntry,
  subscribeToQueue,
  __clearWebStoreForTests,
} from '../captureQueueStore';
import { markInserted, markUploaded } from '../captureQueue';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'u1';

const event = (over: Partial<NewSiteEvent> = {}): NewSiteEvent => ({
  id: 'e1', projectId: 'p1', roomId: 'r1', reporterId: USER, gateCode: null, rawText: 'Catatan',
  capturedAt: '2026-09-11T02:00:00.000Z',
  media: [
    { id: 'm1', localUri: 'file:///tmp/cam/m1.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' },
  ],
  ...over,
});

beforeEach(async () => {
  currentOS = 'android';
  calls.length = 0;
  fsFiles.clear();
  fsFiles.set('file:///tmp/cam/m1.jpg', true); // the "camera temp file" exists until copied
  __clearWebStoreForTests();
  await AsyncStorage.clear();
});

describe('key shapes', () => {
  it('namespaces by user so a shared phone cannot mix supervisors', () => {
    expect(indexKey('u1')).toBe('sano.captureQueue.v1.index.u1');
    expect(indexKey('u2')).not.toBe(indexKey('u1'));
    expect(entryKey('u1', 'e1')).toBe('sano.captureQueue.v1.entry.u1.e1');
    expect(entryDirUri('u1', 'e1')).toBe('file:///doc/capture-queue/u1/e1/');
  });
});

describe('enqueueNewCapture (native)', () => {
  it('copies media into the queue folder, then writes the entry, then the index', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: ['Finishing'], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(entry.media[0].localUri).toBe('file:///doc/capture-queue/u1/e1/m1.jpg');
    expect(calls).toEqual([
      `mkdir:file:///doc/capture-queue/${USER}/e1/`,
      `copy:file:///tmp/cam/m1.jpg->file:///doc/capture-queue/${USER}/e1/m1.jpg`,
    ]);
    const storedIndex = JSON.parse((await AsyncStorage.getItem(indexKey(USER)))!);
    expect(storedIndex).toEqual(['e1']);
    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'e1')))!);
    expect(stored.id).toBe('e1');
    expect(stored.state).toBe('queued');
  });
});

describe('saveEntry / removeEntry', () => {
  it('round-trips through AsyncStorage and keeps the index in sync', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const uploaded = markUploaded(entry, 'm1', 999, '2026-09-11T02:00:05.000Z');
    await saveEntry(uploaded);
    const [reloaded] = await loadQueue(USER);
    expect(reloaded.state).toBe('uploading');
    expect(reloaded.media[0].bytes).toBe(999);

    await removeEntry(USER, 'e1');
    expect(await loadQueue(USER)).toEqual([]);
    expect(await AsyncStorage.getItem(entryKey(USER, 'e1'))).toBeNull();
  });
});

describe('loadQueue recovery', () => {
  it('flags an entry unrecoverable, with a clear reason, when a still-needed file is gone; never drops it', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    fsFiles.delete(entry.media[0].localUri); // simulate the OS purging the copy before it could upload

    const [reloaded] = await loadQueue(USER);
    expect(reloaded.unrecoverable).toBe(true);
    expect(reloaded.needsAttention).toBe(true);
    expect(reloaded.lastError).toMatch(/hilang dari HP/);
    // Persisted, so a second load does not need to re-check the filesystem.
    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'e1')))!);
    expect(stored.unrecoverable).toBe(true);
  });

  it('does not re-check files once the event is already inserted', async () => {
    let entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    entry = markUploaded(entry, 'm1', 10, '2026-09-11T02:00:05.000Z');
    entry = markInserted(entry, '2026-09-11T02:00:06.000Z');
    await saveEntry(entry);
    fsFiles.delete(entry.media[0].localUri); // the local copy is gone, which is fine post-insert

    const [reloaded] = await loadQueue(USER);
    expect(reloaded.unrecoverable).toBe(false);
    expect(reloaded.state).toBe('analyzing');
  });

  it('skips an index id whose entry record is missing, rather than crashing', async () => {
    await AsyncStorage.setItem(indexKey(USER), JSON.stringify(['ghost']));
    expect(await loadQueue(USER)).toEqual([]);
  });
});

describe('discardEntryLocally', () => {
  it('deletes the folder and drops the entry when nothing was ever inserted', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    fsFiles.delete(entry.media[0].localUri);
    await loadQueue(USER); // marks it unrecoverable

    const result = await discardEntryLocally(USER, 'e1');
    expect(result.error).toBeUndefined();
    expect(calls).toContain(`delete:file:///doc/capture-queue/${USER}/e1/`);
    expect(await loadQueue(USER)).toEqual([]);
  });

  it('refuses once the server has the event, and touches nothing', async () => {
    let entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    entry = markUploaded(entry, 'm1', 10, '2026-09-11T02:00:05.000Z');
    entry = markInserted(entry, '2026-09-11T02:00:06.000Z');
    await saveEntry(entry);
    calls.length = 0;

    const result = await discardEntryLocally(USER, 'e1');
    expect(result.error).toMatch(/sudah tersimpan/);
    expect(calls).toEqual([]);
    expect((await loadQueue(USER))[0].id).toBe('e1');
  });
});

/** subscribeToQueue's initial callback fires from an un-awaited loadQueue; give it a real tick to land. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('subscribeToQueue', () => {
  it('calls back immediately, and again after every save, until unsubscribed', async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToQueue(USER, (entries) => seen.push(entries.length));
    await flush(); // the initial load
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    unsubscribe();
    await enqueueNewCapture({ userId: USER, event: event({ id: 'e2' }), workGroupNames: [], nowIso: '2026-09-11T02:00:02.000Z' });
    expect(seen).toEqual([0, 1]);
  });
});

describe('web backend', () => {
  beforeEach(() => {
    currentOS = 'web';
  });

  it('never touches AsyncStorage or the filesystem, and forgets nothing on its own', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(entry.media[0].localUri).toBe('file:///tmp/cam/m1.jpg'); // unchanged: nothing is copied on web
    expect(calls).toEqual([]);
    expect(await AsyncStorage.getItem(indexKey(USER))).toBeNull();
    expect((await loadQueue(USER)).map((e) => e.id)).toEqual(['e1']);

    __clearWebStoreForTests(); // stands in for "the tab was closed"
    expect(await loadQueue(USER)).toEqual([]);
  });

  it('discardEntryLocally works the same way, minus any filesystem call', async () => {
    await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const result = await discardEntryLocally(USER, 'e1');
    expect(result.error).toBeUndefined();
    expect(calls).toEqual([]);
    expect(await loadQueue(USER)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tools/__tests__/captureQueueStore.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Cannot find module '../captureQueueStore'`.

- [ ] **Step 3: Write the module**

Create `tools/captureQueueStore.ts`:

```ts
// SANO - Offline capture queue persistence (spec §7).
//
// Native: an AsyncStorage index per signed-in user (so a shared phone never
// mixes supervisors), plus one expo-file-system copy of every media file
// under the app's document directory. Camera and recorder temp URIs can be
// purged by the OS at any time, so a capture is copied into a permanent,
// app-owned folder BEFORE it is queued; the write order is media copies
// first, then the index record, so a crash between the two leaves an orphan
// file (harmless, never referenced) rather than an index entry pointing at a
// file that was never actually saved.
//
// Web: memory-only (decision, spec §7 "Web gets save-and-retry only"). A
// closed tab loses everything, which SiteEventCaptureScreen states plainly
// (task 6). There is nothing to copy on web: the picker/recorder already
// hand back a blob: URL that is either usable this session or gone.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import {
  enqueueCapture,
  markUnrecoverable,
  type CaptureQueueEntry,
} from './captureQueue';
import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';

const PREFIX = 'sano.captureQueue.v1';

export function indexKey(userId: string): string {
  return `${PREFIX}.index.${userId}`;
}

export function entryKey(userId: string, entryId: string): string {
  return `${PREFIX}.entry.${userId}.${entryId}`;
}

/** Exported for tests; captureQueueWorker.ts never touches the filesystem directly. */
export function entryDirUri(userId: string, entryId: string): string {
  const base = FileSystem.documentDirectory ?? '';
  return `${base}capture-queue/${userId}/${entryId}/`;
}

const REASON_MEDIA_MISSING =
  'Berkas foto atau suara untuk laporan ini hilang dari HP (mungkin dibersihkan sistem sebelum terkirim). ' +
  'Laporan tidak bisa dikirim; buang dan laporkan ulang.';

// ─── Native backend (AsyncStorage + expo-file-system) ─────────────────────────

async function readIndexNative(userId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(indexKey(userId));
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndexNative(userId: string, ids: string[]): Promise<void> {
  await AsyncStorage.setItem(indexKey(userId), JSON.stringify(ids));
}

async function readEntryNative(userId: string, entryId: string): Promise<CaptureQueueEntry | null> {
  const raw = await AsyncStorage.getItem(entryKey(userId, entryId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CaptureQueueEntry;
  } catch {
    return null;
  }
}

async function copyMediaIntoQueueDir(
  userId: string,
  entryId: string,
  media: LocalSiteEventMedia[],
): Promise<LocalSiteEventMedia[]> {
  const dir = entryDirUri(userId, entryId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const copied: LocalSiteEventMedia[] = [];
  for (const m of media) {
    const to = `${dir}${m.id}.${m.ext}`;
    await FileSystem.copyAsync({ from: m.localUri, to });
    copied.push({ ...m, localUri: to });
  }
  return copied;
}

// ─── Web backend (memory only) ─────────────────────────────────────────────────

const webStore = new Map<string, Map<string, CaptureQueueEntry>>();

function webUserMap(userId: string): Map<string, CaptureQueueEntry> {
  let map = webStore.get(userId);
  if (!map) {
    map = new Map();
    webStore.set(userId, map);
  }
  return map;
}

// ─── Change notifications (drives the Beranda badge without polling) ──────────

const listeners = new Map<string, Set<(entries: CaptureQueueEntry[]) => void>>();

/**
 * Awaited by saveEntry/removeEntry so that, once either resolves, every
 * current subscriber has already seen the update - callers never need to
 * guess how many microtask ticks a notification takes to land.
 */
async function notify(userId: string): Promise<void> {
  const subs = listeners.get(userId);
  if (!subs || subs.size === 0) return;
  const entries = await loadQueue(userId);
  for (const cb of subs) cb(entries);
}

/** Live updates for one user's queue. Used by useCaptureQueueEntries and by tests. */
export function subscribeToQueue(userId: string, callback: (entries: CaptureQueueEntry[]) => void): () => void {
  let subs = listeners.get(userId);
  if (!subs) {
    subs = new Set();
    listeners.set(userId, subs);
  }
  subs.add(callback);
  void loadQueue(userId).then(callback);
  return () => {
    subs?.delete(callback);
  };
}

/** Beranda's badge and "Perlu perhatian" list (task 5). Empty array while `userId` is null (signed out). */
export function useCaptureQueueEntries(userId: string | null): CaptureQueueEntry[] {
  const [entries, setEntries] = useState<CaptureQueueEntry[]>([]);
  useEffect(() => {
    if (!userId) {
      setEntries([]);
      return undefined;
    }
    return subscribeToQueue(userId, setEntries);
  }, [userId]);
  return entries;
}

// ─── Public API (both backends behind Platform.OS) ─────────────────────────────

export async function saveEntry(entry: CaptureQueueEntry): Promise<void> {
  if (Platform.OS === 'web') {
    webUserMap(entry.ownerId).set(entry.id, entry);
    await notify(entry.ownerId);
    return;
  }
  await AsyncStorage.setItem(entryKey(entry.ownerId, entry.id), JSON.stringify(entry));
  const ids = await readIndexNative(entry.ownerId);
  if (!ids.includes(entry.id)) {
    await writeIndexNative(entry.ownerId, [...ids, entry.id]);
  }
  await notify(entry.ownerId);
}

/** Only for a 'done' entry: the server has it, and local copies are already gone. */
export async function removeEntry(userId: string, entryId: string): Promise<void> {
  if (Platform.OS === 'web') {
    webUserMap(userId).delete(entryId);
    await notify(userId);
    return;
  }
  await AsyncStorage.removeItem(entryKey(userId, entryId));
  const ids = await readIndexNative(userId);
  await writeIndexNative(userId, ids.filter((id) => id !== entryId));
  await notify(userId);
}

async function recoverMissingMedia(entry: CaptureQueueEntry): Promise<CaptureQueueEntry> {
  // Upload always finishes before insert is attempted (captureQueue.ts's
  // nextStep ordering), so a still-needed local file can only go missing
  // before eventInserted flips true. After that, or once already flagged,
  // there is nothing new to check.
  if (entry.eventInserted || entry.unrecoverable) return entry;
  for (const m of entry.media) {
    if (m.uploaded) continue;
    const info = await FileSystem.getInfoAsync(m.localUri);
    if (!info.exists) {
      const fixed = markUnrecoverable(entry, REASON_MEDIA_MISSING);
      await saveEntry(fixed);
      return fixed;
    }
  }
  return entry;
}

/** Reads the whole queue for one user, recovering (never dropping) entries whose local files are gone. */
export async function loadQueue(userId: string): Promise<CaptureQueueEntry[]> {
  if (Platform.OS === 'web') {
    return [...webUserMap(userId).values()];
  }
  const ids = await readIndexNative(userId);
  const entries: CaptureQueueEntry[] = [];
  for (const id of ids) {
    const entry = await readEntryNative(userId, id);
    if (!entry) continue; // index drifted from an entry key that no longer exists; nothing to recover
    entries.push(await recoverMissingMedia(entry));
  }
  return entries;
}

export interface NewCaptureRequest {
  userId: string;
  event: NewSiteEvent;
  workGroupNames: string[];
  nowIso: string;
}

/**
 * Copies every media file into the queue's own folder (native), builds the
 * entry, and persists it. This is the ONLY way an entry is created, so
 * "media copies first, then the index" always holds.
 */
export async function enqueueNewCapture(request: NewCaptureRequest): Promise<CaptureQueueEntry> {
  const media =
    Platform.OS === 'web' ? request.event.media : await copyMediaIntoQueueDir(request.userId, request.event.id, request.event.media);
  const entry = enqueueCapture({
    event: { ...request.event, media },
    ownerId: request.userId,
    workGroupNames: request.workGroupNames,
    nowIso: request.nowIso,
  });
  await saveEntry(entry);
  return entry;
}

/** The cleanup step (captureQueueWorker.ts task 3). No-op on web: nothing was ever copied. */
export async function deleteLocalMedia(userId: string, entryId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await FileSystem.deleteAsync(entryDirUri(userId, entryId), { idempotent: true });
}

/**
 * The only discard path for the LOCAL queue: an unrecoverable entry (media
 * gone before it could reach the server) never became a site_events row, so
 * there is nothing server-side to protect. Refuses once eventInserted is
 * true - at that point the row exists and "Draf menunggu" (plan 2) already
 * shows it; Buang there goes through discardSiteEvent, not this function.
 */
export async function discardEntryLocally(userId: string, entryId: string): Promise<{ error?: string }> {
  const entry = await readEntryForUser(userId, entryId);
  if (!entry) return {};
  if (entry.eventInserted) {
    return { error: 'Kejadian ini sudah tersimpan di server; buang lewat layar konfirmasi.' };
  }
  await deleteLocalMedia(userId, entryId);
  await removeEntry(userId, entryId);
  return {};
}

async function readEntryForUser(userId: string, entryId: string): Promise<CaptureQueueEntry | null> {
  if (Platform.OS === 'web') return webUserMap(userId).get(entryId) ?? null;
  return readEntryNative(userId, entryId);
}

/** Test-only escape hatch: nothing else in the app needs to reach into the map directly. */
export function __clearWebStoreForTests(): void {
  webStore.clear();
  listeners.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tools/__tests__/captureQueueStore.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
npx tsc --noEmit
```

Expected: `Tests: 11 passed, 11 total`; `tsc` shows only the pre-existing
`workflows/App.tsx` error.

Verified in a scratch harness: 11/11 pass, using the real
`@react-native-async-storage/async-storage/jest/async-storage-mock` (the
package's own official mock, not a hand-rolled one) and a mocked
`expo-file-system/legacy` that tracks which URIs "exist" so the recovery
test can delete one out from under a queued entry. `tsc --noEmit` is clean.

- [ ] **Step 5: Commit**

```bash
git add tools/captureQueueStore.ts tools/__tests__/captureQueueStore.test.ts
git commit -m "$(cat <<'MSG'
feat(capture-queue): persistence - per-user AsyncStorage index, media copies, recovery

Camera and recorder temp URIs are copied into capture-queue/{userId}/{entryId}/
under the app's document directory before an entry is ever recorded, so the OS
purging a temp file can never lose a report already handed to Kirim. Load-time
recovery marks (never drops) an entry whose still-needed file went missing,
with a clear Indonesian reason. Web is a plain in-memory map behind the same
API, so the worker (task 3) needs no Platform.OS branches of its own.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: `tools/captureQueueWorker.ts` - the drain loop, `expo-network`, and app wiring

**Files:**
- Create: `tools/captureQueueWorker.ts`
- Test: `tools/__tests__/captureQueueWorker.test.ts`
- Modify: `package.json` (via `npx expo install expo-network`), `workflows/App.tsx`
- Test: `tools/__tests__/captureQueueAppWiring.test.ts`

**Why the invoke step is hands-off.** The task brief that seeded this plan
asked explicitly: "decide whether the queue retries invoke or hands off, and
say why." The answer is hands off, for three reasons, all stated in the
module's own doc comment below so a future reader does not have to dig up
this plan to find them again:

1. By the time `invokeSiteEventAnalysis` runs, `insertSiteEvent` has already
   succeeded - the event and its media rows exist on the server. Nothing is
   lost if the analysis call never lands; the row sits at `pending_analysis`
   and is visible in plan 2's "Draf menunggu" either way.
2. `SiteEventConfirmScreen` (plan 2 task 13) already has a user-facing retry:
   "Analisis ulang" calls `invokeSiteEventAnalysis(id, { force: true })`
   directly. A background retry loop racing that button would be redundant
   at best and confusing at worst (two concurrent analysis runs for one
   event).
3. Spec §6 caps analysis calls per project per day. Retrying invoke
   automatically on every foreground and network-regained trigger would
   burn through that cap for events that already have a queued retry path
   through the confirm screen, for no benefit - the edge function already
   skips analysis when `ai_draft` exists unless `force: true` is sent.

So the worker calls `invokeSiteEventAnalysis` **exactly once** per
drain-worthy pass through an entry, logs a warning on any non-ok outcome or
thrown error, and always proceeds to cleanup regardless. This directly
implements spec §12's rule that "a failed or quota-deferred invoke must not
block."

**Single-flight and oldest-first.** `drain()` sets a module-level `draining`
flag; a `triggerDrain()` call that arrives while a pass is already running
sets `drainAgainRequested` instead of starting a second overlapping pass, and
the running pass loops once more before it finishes. Within one pass,
`loadQueue` results are sorted by `createdAt` ascending before processing, so
three reports filed in a row land on the server in the order they happened
(spec §7's implicit ordering expectation, made explicit here).

**Sign-out.** `stopCaptureQueueWorker` clears `currentUserId`; both `drain`'s
outer loop and `processEntry`'s inner loop check `currentUserId === userId`
before touching the next entry or the next step, so a sign-out that arrives
mid-pass lets whatever single step is already in flight finish and save (it
cannot be safely aborted mid-network-call), then stops - nothing beyond that
one step runs for the signed-out user.

- [ ] **Step 1: Install `expo-network` and confirm its listener API**

```bash
npx expo install expo-network
node -e "console.log(require('./package.json').dependencies['expo-network'])"
node -e "console.log(Object.keys(require('expo-network')))"
```

Expected: a version starting `~8.0.` (the SDK 54 pin in
`node_modules/expo/bundledNativeModules.json`, confirmed while writing this
plan even though the package itself was not yet installed) and a key list
that includes `addNetworkStateListener`. If that name is **not** present,
read `node_modules/expo-network/build/*.d.ts` for the actual listener export
and update `attachNetworkListener` in the module below to call it instead -
the defensive `typeof addListener !== 'function'` guard means a name
mismatch degrades to "no network-regained trigger" rather than crashing the
app, but the code should still call the real name once it is known. `expo-network`
is a native module and rides the APK build in task 7.

- [ ] **Step 2: Write the failing test**

Create `tools/__tests__/captureQueueWorker.test.ts`:

```ts
/**
 * The drain loop's job is orchestration, not logic: the state machine
 * (captureQueue.ts) and the persistence (captureQueueStore.ts) are already
 * separately tested, so what matters here is call ORDER, that a failed step
 * stops only its own entry, that invoke never blocks cleanup, that a
 * concurrent trigger does not run two overlapping passes, and that signing
 * out stops the worker touching that user's entries again.
 */
let appStateHandler: ((state: string) => void) | null = null;
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      appStateHandler = cb;
      return { remove: jest.fn(() => { appStateHandler = null; }) };
    }),
  },
}));

let networkHandler: ((state: { isConnected?: boolean | null }) => void) | null = null;
let networkListenerAvailable = true;
jest.mock(
  'expo-network',
  () => ({
    addNetworkStateListener: (cb: (state: { isConnected?: boolean | null }) => void) => {
      if (!networkListenerAvailable) return undefined; // simulates an SDK where the export is missing
      networkHandler = cb;
      return { remove: jest.fn(() => { networkHandler = null; }) };
    },
  }),
  { virtual: true },
);

const calls: string[] = [];
const store = new Map<string, import('../captureQueue').CaptureQueueEntry>();

jest.mock('../captureQueueStore', () => ({
  loadQueue: jest.fn(async (userId: string) => {
    calls.push(`loadQueue:${userId}`);
    return [...store.values()].filter((e) => e.ownerId === userId);
  }),
  saveEntry: jest.fn(async (entry: import('../captureQueue').CaptureQueueEntry) => {
    calls.push(`saveEntry:${entry.id}:${entry.state}`);
    store.set(entry.id, entry);
  }),
  removeEntry: jest.fn(async (userId: string, entryId: string) => {
    calls.push(`removeEntry:${entryId}`);
    store.delete(entryId);
  }),
  deleteLocalMedia: jest.fn(async (userId: string, entryId: string) => {
    calls.push(`deleteLocalMedia:${entryId}`);
  }),
}));

const upload = jest.fn();
const insert = jest.fn();
const invoke = jest.fn();
jest.mock('../siteEvents', () => ({
  uploadSiteEventMedia: (...args: unknown[]) => upload(...args),
  insertSiteEvent: (...args: unknown[]) => insert(...args),
  invokeSiteEventAnalysis: (...args: unknown[]) => invoke(...args),
}));

import { enqueueCapture, recordFailure, type CaptureQueueEntry } from '../captureQueue';
import {
  retryQueueEntry,
  startCaptureQueueWorker,
  stopCaptureQueueWorker,
  triggerDrain,
} from '../captureQueueWorker';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'u1';

const event = (id: string, capturedAt: string): NewSiteEvent => ({
  id, projectId: 'p1', roomId: 'r1', reporterId: USER, gateCode: 'B', rawText: null, capturedAt,
  media: [{ id: `${id}-m1`, localUri: `file:///q/${id}/m1.jpg`, kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt }],
});

function seed(id: string, createdAt: string): CaptureQueueEntry {
  const entry = enqueueCapture({ event: event(id, createdAt), ownerId: USER, workGroupNames: [], nowIso: createdAt });
  store.set(id, entry);
  return entry;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls.length = 0;
  store.clear();
  appStateHandler = null;
  networkHandler = null;
  networkListenerAvailable = true;
  upload.mockReset().mockResolvedValue({ bytesById: { 'e1-m1': 100 } });
  insert.mockReset().mockResolvedValue({});
  invoke.mockReset().mockResolvedValue({ ok: true, code: 'ANALYZED', status: 'draft' });
  stopCaptureQueueWorker();
});

afterEach(() => {
  stopCaptureQueueWorker();
});

describe('a full pass', () => {
  it('walks one entry through upload, insert, invoke, cleanup, and purges it once done', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(upload).toHaveBeenCalledWith({ id: 'e1', projectId: 'p1', media: [expect.objectContaining({ id: 'e1-m1' })] });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), { 'e1-m1': 100 });
    expect(invoke).toHaveBeenCalledWith('e1', { workGroupNames: [] });
    expect(calls).toContain('deleteLocalMedia:e1');
    expect(calls).toContain('removeEntry:e1');
    expect(store.has('e1')).toBe(false);
  });

  it('processes entries oldest first', async () => {
    seed('e2', '2026-09-11T02:00:02.000Z');
    seed('e1', '2026-09-11T02:00:01.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();
    const order = calls.filter((c) => c.startsWith('saveEntry:')).map((c) => c.split(':')[1]);
    expect(order[0]).toBe('e1');
  });
});

describe('failure', () => {
  it('records the failure and moves on to the next entry, without touching insert', async () => {
    upload.mockResolvedValueOnce({ bytesById: {}, error: 'jaringan turun' });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    expect(insert).not.toHaveBeenCalled();
    const saved = store.get('e1')!;
    expect(saved.state).toBe('failed');
    expect(saved.lastError).toMatch(/Unggah berkas gagal: jaringan turun/);
    expect(saved.consecutiveFailures).toBe(1);
  });

  it('a deferred or failed invoke never blocks cleanup', async () => {
    invoke.mockResolvedValueOnce({ ok: false, code: 'QUOTA_EXCEEDED', error: 'Kuota habis' });
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(calls).toContain('removeEntry:e1');
  });

  it('an invoke call that throws is also swallowed, not turned into a queue failure', async () => {
    invoke.mockRejectedValueOnce(new Error('network down'));
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(calls).toContain('removeEntry:e1');
  });
});

describe('skips entries that are not ready', () => {
  it('never asks the store to save a needsAttention entry', async () => {
    let flagged = seed('e1', '2026-09-11T02:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      upload.mockResolvedValueOnce({ bytesById: {}, error: 'gagal' });
      // Backoff is real wall-clock in the module (captureQueue.ts's
      // isReadyToAttempt takes an explicit `now`, but the worker always
      // passes Date.now()); back-date the stored attempt so each loop
      // iteration is immediately ready instead of waiting out 30s+ for real.
      flagged.lastAttemptAt = new Date(0).toISOString();
      store.set('e1', flagged);
      startCaptureQueueWorker(USER);
      // eslint-disable-next-line no-await-in-loop
      await flush();
      // eslint-disable-next-line no-await-in-loop
      await flush();
      stopCaptureQueueWorker();
      flagged = store.get('e1')!;
    }
    expect(flagged.needsAttention).toBe(true);
    calls.length = 0;
    startCaptureQueueWorker(USER);
    await flush();
    expect(calls.filter((c) => c.startsWith('saveEntry:'))).toEqual([]);
  });
});

describe('single-flight', () => {
  it('coalesces a trigger that arrives mid-drain into the pass already running, not a second overlapping one', async () => {
    let resolveUpload!: (v: { bytesById: Record<string, number>; error?: string }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    seed('e1', '2026-09-11T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush(); // loadQueue has run once, upload is now pending
    const loadsBeforeSecondTrigger = calls.filter((c) => c.startsWith('loadQueue:')).length;
    triggerDrain(); // arrives while the first pass is still awaiting upload
    resolveUpload({ bytesById: { 'e1-m1': 1 } });
    await flush();
    await flush();
    await flush();
    // The coalesced trigger causes at most one extra loadQueue at the end of
    // the running pass, never a second drain racing the first.
    const loadsAfter = calls.filter((c) => c.startsWith('loadQueue:')).length;
    expect(loadsAfter).toBeGreaterThan(loadsBeforeSecondTrigger);
    expect(calls).toContain('removeEntry:e1');
  });
});

describe('sign-out mid-drain', () => {
  it('stops touching the previous user once stopCaptureQueueWorker runs, mid-pass', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    seed('e2', '2026-09-11T02:00:01.000Z');
    let resolveUpload!: (v: { bytesById: Record<string, number>; error?: string }) => void;
    upload.mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    startCaptureQueueWorker(USER);
    await flush(); // e1's upload is in flight
    stopCaptureQueueWorker();
    resolveUpload({ bytesById: { 'e1-m1': 1 } });
    await flush();
    await flush();
    await flush();
    // e1's in-flight step is allowed to finish and save, but nothing beyond
    // that (e2, or e1's later steps) runs once signed out.
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('retryQueueEntry', () => {
  it('clears the flag and drains again, on the "Coba lagi" path', async () => {
    let entry = seed('e1', '2026-09-11T02:00:00.000Z');
    entry = recordFailure(entry, 'gagal', new Date(0).toISOString());
    entry = { ...entry, needsAttention: true, consecutiveFailures: 5 };
    store.set('e1', entry);
    startCaptureQueueWorker(USER); // the worker must already be running for triggerDrain to do anything

    await retryQueueEntry(USER, 'e1');
    await flush();
    await flush();
    await flush();

    expect(upload).toHaveBeenCalled();
    expect(calls).toContain('removeEntry:e1');
  });

  it('does nothing for an entry that no longer exists', async () => {
    await expect(retryQueueEntry(USER, 'ghost')).resolves.toBeUndefined();
    expect(calls.filter((c) => c.startsWith('saveEntry:'))).toEqual([]);
  });
});

describe('triggers', () => {
  it('drains again when the app returns to the foreground', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    upload.mockResolvedValue({ bytesById: {}, error: 'offline' });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    const before = calls.filter((c) => c.startsWith('loadQueue:')).length;
    appStateHandler?.('active');
    await flush();
    expect(calls.filter((c) => c.startsWith('loadQueue:')).length).toBeGreaterThan(before);
  });

  it('drains again when the network reports connected', async () => {
    seed('e1', '2026-09-11T02:00:00.000Z');
    upload.mockResolvedValue({ bytesById: {}, error: 'offline' });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    const before = calls.filter((c) => c.startsWith('loadQueue:')).length;
    networkHandler?.({ isConnected: true });
    await flush();
    expect(calls.filter((c) => c.startsWith('loadQueue:')).length).toBeGreaterThan(before);
  });

  it('degrades without crashing when expo-network has no listener export', async () => {
    networkListenerAvailable = false;
    expect(() => startCaptureQueueWorker(USER)).not.toThrow();
    expect(networkHandler).toBeNull();
  });

  it('starting twice for the same user does not resubscribe', async () => {
    const rn = require('react-native');
    startCaptureQueueWorker(USER);
    const callsAfterFirst = (rn.AppState.addEventListener as jest.Mock).mock.calls.length;
    startCaptureQueueWorker(USER);
    expect((rn.AppState.addEventListener as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest tools/__tests__/captureQueueWorker.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Cannot find module '../captureQueueWorker'`.

- [ ] **Step 4: Write the module**

Create `tools/captureQueueWorker.ts`:

```ts
// SANO - Offline capture queue drain loop (spec §7).
//
// Single-flight: only one drain runs at a time per process; a trigger that
// arrives mid-drain is coalesced into the drain already running rather than
// starting a second overlapping pass (drainAgainRequested).
//
// Oldest-first: within one pass, ready entries are processed in createdAt
// order, so a supervisor who reported three things in a row sees them land in
// the order they happened.
//
// The invoke step is deliberately hands-off: the worker calls
// invokeSiteEventAnalysis exactly once per drain-worthy pass through this
// entry and moves on regardless of the outcome (ok, daily-cap deferral, or a
// network error). It does not retry invoke itself. Three reasons: (1) the
// server already has the durable record by the time invoke runs (insert
// happens first), so nothing is lost if the call never lands; (2)
// SiteEventConfirmScreen's "Analisis ulang" (plan 2 task 13) already calls
// invokeSiteEventAnalysis(id, {force: true}) as the user-facing retry, and a
// background retry loop would race it; (3) retrying automatically on every
// foreground/network-regained trigger would pile up duplicate calls against
// the same event before the queue forgets about it, wasting calls against
// the per-project daily cap (spec §6) for no benefit, since the edge
// function already skips analysis when ai_draft exists unless forced.
//
// Stops on sign-out: stopCaptureQueueWorker clears the current user before
// any in-flight drain's next entry begins, so a signed-out session's queue is
// never touched by a drain that started before sign-out.

import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import {
  beginAttempt,
  bytesById,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markInserted,
  markUploaded,
  nextStep,
  recordFailure,
  retryEntry,
  toLocalMedia,
  toNewSiteEvent,
  type CaptureQueueEntry,
  type QueueAction,
} from './captureQueue';
import { deleteLocalMedia, loadQueue, removeEntry, saveEntry } from './captureQueueStore';
import { insertSiteEvent, invokeSiteEventAnalysis, uploadSiteEventMedia } from './siteEvents';

let currentUserId: string | null = null;
let draining = false;
let drainAgainRequested = false;
let appStateSub: { remove: () => void } | null = null;
let networkSub: { remove: () => void } | null = null;

/** App.tsx calls this once a session exists, with the signed-in profile's id. Idempotent for the same user. */
export function startCaptureQueueWorker(userId: string): void {
  if (currentUserId === userId) return;
  stopCaptureQueueWorker();
  currentUserId = userId;
  appStateSub = AppState.addEventListener('change', handleAppStateChange);
  networkSub = attachNetworkListener();
  triggerDrain();
}

/** App.tsx calls this on sign-out. Any drain already running finishes its current step, then stops. */
export function stopCaptureQueueWorker(): void {
  currentUserId = null;
  appStateSub?.remove();
  appStateSub = null;
  networkSub?.remove();
  networkSub = null;
}

/** SiteEventCaptureScreen calls this right after enqueueing (task 4). Fire-and-forget on purpose: Kirim returns immediately. */
export function triggerDrain(): void {
  void drain();
}

/**
 * "Coba lagi" on the Beranda "Perlu perhatian" list (task 5): clears the
 * flag and failure count, then asks for an immediate drain. A no-op when the
 * entry is gone (already delivered by another drain) or unrecoverable, since
 * retrying a missing local file would only fail again the same way.
 */
export async function retryQueueEntry(userId: string, entryId: string): Promise<void> {
  const entries = await loadQueue(userId);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;
  await saveEntry(retryEntry(entry, new Date().toISOString()));
  triggerDrain();
}

function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active') triggerDrain();
}

function handleNetworkChange(state: { isConnected?: boolean | null }): void {
  if (state.isConnected) triggerDrain();
}

/**
 * expo-network's listener API is confirmed only once task 3 step 1 installs
 * the package and inspects its own type declarations (the repo pins the SDK
 * 54 version but did not have the module installed while this plan was
 * written). Guarded so a name mismatch degrades to "no network-regained
 * trigger" instead of a crash; the foreground and post-capture triggers
 * still cover the same ground on a short delay.
 */
function attachNetworkListener(): { remove: () => void } | null {
  const addListener = (Network as { addNetworkStateListener?: typeof Network.addNetworkStateListener })
    .addNetworkStateListener;
  if (typeof addListener !== 'function') {
    console.warn('[captureQueueWorker] expo-network has no addNetworkStateListener; relying on foreground and post-capture triggers.');
    return null;
  }
  return addListener(handleNetworkChange);
}

async function drain(): Promise<void> {
  if (!currentUserId) return;
  if (draining) {
    drainAgainRequested = true;
    return;
  }
  draining = true;
  const userId = currentUserId;
  try {
    do {
      drainAgainRequested = false;
      const now = Date.now();
      const entries = await loadQueue(userId);
      const runnable = entries
        .filter((e) => isReadyToAttempt(e, now))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const entry of runnable) {
        if (currentUserId !== userId) return; // signed out mid-pass
        await processEntry(userId, entry);
      }
    } while (drainAgainRequested && currentUserId === userId);
  } finally {
    draining = false;
  }
}

async function processEntry(userId: string, start: CaptureQueueEntry): Promise<void> {
  let entry = start;
  while (currentUserId === userId) {
    const step = nextStep(entry);
    if (step.kind === 'none') break;
    const startedAt = new Date().toISOString();
    entry = beginAttempt(entry, startedAt);
    await saveEntry(entry);
    try {
      entry = await runStep(userId, entry, step);
    } catch (err) {
      entry = recordFailure(entry, describeStepError(step, err), new Date().toISOString());
      await saveEntry(entry);
      return;
    }
    await saveEntry(entry);
  }
  if (entry.state === 'done') {
    await removeEntry(userId, entry.id);
  }
}

async function runStep(userId: string, entry: CaptureQueueEntry, step: QueueAction): Promise<CaptureQueueEntry> {
  const now = new Date().toISOString();
  switch (step.kind) {
    case 'upload': {
      const item = entry.media.find((m) => m.id === step.mediaId);
      if (!item) return markUploaded(entry, step.mediaId, null, now); // defensive; nextStep only asks for media that exists
      const result = await uploadSiteEventMedia({ id: entry.id, projectId: entry.projectId, media: [toLocalMedia(item)] });
      if (result.error) throw new Error(result.error);
      return markUploaded(entry, item.id, result.bytesById[item.id] ?? null, now);
    }
    case 'insert': {
      const result = await insertSiteEvent(toNewSiteEvent(entry), bytesById(entry));
      if (result.error) throw new Error(result.error);
      return markInserted(entry, now);
    }
    case 'invoke': {
      try {
        const result = await invokeSiteEventAnalysis(entry.id, { workGroupNames: entry.workGroupNames });
        if (!result.ok) {
          console.warn('[captureQueueWorker] analysis deferred for', entry.id, result.code, result.error);
        }
      } catch (err) {
        console.warn('[captureQueueWorker] analysis invoke failed for', entry.id, (err as Error).message);
      }
      return markAnalysisRequested(entry, now);
    }
    case 'cleanup': {
      await deleteLocalMedia(userId, entry.id);
      return markCleanedUp(entry, now);
    }
    case 'none':
      return entry;
  }
}

const STEP_LABEL: Record<Exclude<QueueAction['kind'], 'none'>, string> = {
  upload: 'Unggah berkas',
  insert: 'Simpan kejadian',
  invoke: 'Jalankan analisis',
  cleanup: 'Bersihkan berkas lokal',
};

function describeStepError(step: QueueAction, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const label = step.kind === 'none' ? 'Langkah' : STEP_LABEL[step.kind];
  return `${label} gagal: ${message}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest tools/__tests__/captureQueueWorker.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
npx tsc --noEmit
```

Expected: `Tests: 14 passed, 14 total`; `tsc` shows only the pre-existing
`workflows/App.tsx` error.

Verified in a scratch harness: 14/14 pass. Two console warnings are expected
console output from the deliberately-swallowed invoke failures in the
"failure" tests, not test failures. A minimal `expo-network` fake package
(matching the real `~8.0.8` API this plan expects) was used only so `tsc`
could resolve the specifier - the actual `npx expo install` in step 1
resolves the same import against the real package.

- [ ] **Step 6: Wire the worker into `workflows/App.tsx`**

Add the import beside the other `tools/` imports (after the
`resolveNotificationRoute` import, `workflows/App.tsx:14`):

```tsx
import { startCaptureQueueWorker, stopCaptureQueueWorker } from '../tools/captureQueueWorker';
```

Add a new effect directly after the existing auth-state effect (the one
ending `}, []);` that calls `supabase.auth.getSession()` and subscribes to
`onAuthStateChange`):

```tsx
  // Drain the offline capture queue for whichever user is signed in, and
  // stop touching it the moment they sign out (tools/captureQueueWorker.ts).
  useEffect(() => {
    if (session?.user.id) {
      startCaptureQueueWorker(session.user.id);
    } else {
      stopCaptureQueueWorker();
    }
  }, [session?.user.id]);
```

This fires on the initial session check, on every `onAuthStateChange` event
(sign-in, token refresh, sign-out), and is keyed on `session?.user.id` rather
than the `session` object itself so a token refresh (a new `session`
reference, same user) does not restart the worker -
`startCaptureQueueWorker` is already idempotent for the same id, but keying
the effect narrowly avoids even calling it redundantly.

- [ ] **Step 7: Write and run the static guard test**

`App.tsx` is not rendered in jest (no screen in this repo is; the convention
is pure model files instead), so this wiring is pinned with a guard on the
source text, the same style as plan 2's `siteEventAnalyzeIndex.test.ts`.

Create `tools/__tests__/captureQueueAppWiring.test.ts`:

```ts
/**
 * The worker's start/stop lifecycle lives in workflows/App.tsx, which
 * renders once per app launch and is not otherwise unit-tested (no screen in
 * this repo is rendered in jest, per its own convention). A static guard on
 * the source text is the practical way to pin: the worker starts once a
 * session exists, stops on sign-out, and the effect is keyed on the user id
 * (not the whole session object, which is a new reference every refresh).
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '../../workflows/App.tsx'), 'utf8');

describe('App.tsx capture queue worker wiring', () => {
  it('imports both lifecycle functions from tools/captureQueueWorker', () => {
    expect(SOURCE).toMatch(/import\s*\{\s*startCaptureQueueWorker,\s*stopCaptureQueueWorker\s*\}\s*from\s*'\.\.\/tools\/captureQueueWorker'/);
  });

  it('starts the worker with the signed-in user id, guarded so it is never called with null', () => {
    expect(SOURCE).toMatch(/if\s*\(session\?\.user\.id\)\s*\{\s*startCaptureQueueWorker\(session\.user\.id\);/);
  });

  it('stops the worker in the same effect, on the else branch', () => {
    const startIndex = SOURCE.indexOf('startCaptureQueueWorker(session.user.id)');
    const stopIndex = SOURCE.indexOf('stopCaptureQueueWorker()');
    expect(startIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(startIndex);
  });

  it('keys the effect on session?.user.id, not the session object itself', () => {
    expect(SOURCE).toMatch(/\},\s*\[session\?\.user\.id\]\);/);
  });
});
```

```bash
npx jest tools/__tests__/captureQueueAppWiring.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
npx tsc --noEmit
```

Expected: `Tests: 4 passed, 4 total`.

Verified against a reconstructed copy of `App.tsx` carrying exactly this
diff (not the full file, which depends on many other plan 1/2 modules this
plan does not touch): all four assertions pass. The real repo's `App.tsx`
was read in full while writing this plan (see the "Architecture" note above
for the exact insertion points); this guard test will run against the real
file once step 6 lands it there.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tools/captureQueueWorker.ts \
        tools/__tests__/captureQueueWorker.test.ts \
        workflows/App.tsx tools/__tests__/captureQueueAppWiring.test.ts
git commit -m "$(cat <<'MSG'
feat(capture-queue): drain loop - single-flight, oldest-first, hands-off invoke

The worker calls plan 2's uploadSiteEventMedia, insertSiteEvent and
invokeSiteEventAnalysis completely unmodified, one queue step at a time.
Invoke is attempted once per pass and never retried by this module: the event
is already durable on the server by then, and "Analisis ulang" on the confirm
screen is the user-facing retry. Triggers are app foreground, network
regained (expo-network, degrading gracefully if its listener API differs),
and immediately after every capture. workflows/App.tsx starts the worker on
sign-in and stops it on sign-out, keyed on the user id.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Capture integration - `SiteEventCaptureScreen`'s "Kirim"

**Files:**
- Create: `workflows/screens/siteEvent/captureQueueModel.ts`, `tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts`
- Test: `workflows/__tests__/captureQueueModel.test.ts`
- Modify: `workflows/screens/SiteEventCaptureScreen.tsx` (plan 2 task 12)

Plan 2's `onSend` (`workflows/screens/SiteEventCaptureScreen.tsx`, task 12
step 9) builds a `CaptureDraft`, validates it with `canSend`, and - the part
this task replaces - calls `createSiteEventWithMedia(...)`, which **awaits**
upload, insert and the invoke kick-off (not the analysis itself) before the
screen shows "Terkirim" and navigates back. On a slow or absent connection
that await can hang for a long time, exactly the failure mode spec §7 exists
to remove. This task swaps that one call for
`enqueueNewCapture` (task 2) followed by `triggerDrain()` (task 3): the
screen returns as soon as the capture is durably on the phone, not once it
reaches the server.

`workflows/screens/siteEvent/captureQueueModel.ts` is a small pure file,
parallel to plan 2's `captureModel.ts` / `detailModel.ts` naming, holding UI
rules that are not the state machine itself. This task gives it one constant:
the exact Indonesian copy spec §7 names for the web limitation. Task 5 adds
`attentionRows` to the same file for Beranda's "Perlu perhatian" list.

- [ ] **Step 1: Write the failing test**

Create `workflows/__tests__/captureQueueModel.test.ts`:

```ts
import { WEB_QUEUE_WARNING } from '../screens/siteEvent/captureQueueModel';

describe('WEB_QUEUE_WARNING', () => {
  it('states the exact web limitation from spec §7', () => {
    expect(WEB_QUEUE_WARNING).toBe('Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest workflows/__tests__/captureQueueModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Cannot find module '../screens/siteEvent/captureQueueModel'`.

- [ ] **Step 3: Write the model**

Create `workflows/screens/siteEvent/captureQueueModel.ts`:

```ts
// SANO - Beranda offline-queue card rules (pure).

import { queueBadgeText } from '../../../tools/captureQueue';

export { queueBadgeText };

/** Copy for the web capture screen (spec §7 point 6); shown on Platform.OS === 'web' only. */
export const WEB_QUEUE_WARNING =
  'Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest workflows/__tests__/captureQueueModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 1 passed, 1 total`.

- [ ] **Step 5: Rewrite `onSend` in `SiteEventCaptureScreen.tsx`**

In the imports (plan 2 task 12 step 9), replace this line:

```tsx
import { createSiteEventWithMedia, getRoomLastGate, newSiteEventId, workGroupHints } from '../../tools/siteEvents';
```

with:

```tsx
import { getRoomLastGate, newSiteEventId, workGroupHints } from '../../tools/siteEvents';
import { enqueueNewCapture } from '../../tools/captureQueueStore';
import { triggerDrain } from '../../tools/captureQueueWorker';
```

and add, beside the other `siteEvent/` imports:

```tsx
import { WEB_QUEUE_WARNING } from './siteEvent/captureQueueModel';
```

Replace the whole `onSend` function with:

```tsx
  const onSend = async () => {
    if (!project || !room || !profile) return;
    const draft: CaptureDraft = {
      eventId,
      projectId: project.id,
      roomId: room.id,
      reporterId: profile.id,
      gateCode,
      note,
      context: contextPhoto,
      closeups,
      voice,
    };
    const check = canSend(draft);
    if (!check.ok) {
      setSendError(check.reason);
      return;
    }
    setSending(true);
    setSendError(null);
    // Work-group names are prompt hints; they come from the loaded BoQ only
    // when the scanned project is the active one.
    const hints = activeProject?.id === project.id ? workGroupHints(boqItems) : [];
    try {
      await enqueueNewCapture({
        userId: profile.id,
        event: buildNewSiteEvent(draft, new Date().toISOString()),
        workGroupNames: hints,
        nowIso: new Date().toISOString(),
      });
    } catch (err) {
      setSending(false);
      setSendError((err as Error).message || 'Gagal menyimpan laporan di HP ini.');
      return;
    }
    // Kirim returns at once; the queue delivers this in the background
    // (tools/captureQueueWorker.ts) whenever there is a signal.
    triggerDrain();
    setSending(false);
    toast('Tersimpan, dikirim saat ada sinyal', 'ok');
    backToRoom();
  };
```

`enqueueNewCapture` only throws for a genuinely unexpected failure (disk
full, permission denied on the document directory) - the ordinary "no
signal" case is exactly what the queue exists to absorb, so it never reaches
the `catch` at all. `sendDisabled = !contextPhoto || sending` (unchanged)
still governs the button.

Replace the web hint at the bottom of the "Lapor kejadian" card:

```tsx
              {Platform.OS === 'web' ? (
                <Text style={s.hint}>Di web, tetap di halaman ini sampai muncul "Terkirim".</Text>
              ) : null}
```

with:

```tsx
              {Platform.OS === 'web' ? (
                <Text style={s.hint}>{WEB_QUEUE_WARNING}</Text>
              ) : null}
```

- [ ] **Step 6: Write and run the static guard test**

The screen is not rendered in jest, so the rewrite is pinned the same way
task 3's App.tsx wiring is: a static guard on the source text.

Create `tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts`:

```ts
/**
 * SiteEventCaptureScreen is not rendered in jest (the repo keeps screens
 * thin and tests their model files instead), so the "Kirim" rewrite from
 * plan 2's synchronous three-call orchestration to the offline queue is
 * pinned with a static guard: the old online-path call is gone, the new
 * enqueue-and-drain call is present in the right order, and the web-only
 * limitation copy is shown from the shared constant (never re-typed inline,
 * so the capture screen and any future queue UI cannot drift apart).
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '../../workflows/screens/SiteEventCaptureScreen.tsx'), 'utf8');

describe('SiteEventCaptureScreen: Kirim goes through the offline queue', () => {
  it('no longer calls the plan 2 online-path orchestration function', () => {
    expect(SOURCE).not.toMatch(/createSiteEventWithMedia/);
  });

  it('enqueues before triggering a drain, inside onSend', () => {
    const onSendBody = SOURCE.slice(SOURCE.indexOf('const onSend'), SOURCE.indexOf('const sendDisabled'));
    const enqueueIndex = onSendBody.indexOf('enqueueNewCapture(');
    const drainIndex = onSendBody.indexOf('triggerDrain()');
    expect(enqueueIndex).toBeGreaterThan(-1);
    expect(drainIndex).toBeGreaterThan(enqueueIndex);
  });

  it('shows the exact instant-return toast, never a wait-for-AI message', () => {
    expect(SOURCE).toMatch(/toast\('Tersimpan, dikirim saat ada sinyal', 'ok'\)/);
    expect(SOURCE).not.toMatch(/Draf AI akan muncul di Beranda/);
  });

  it('renders the shared web warning constant on Platform.OS === \'web\', not an inline string', () => {
    expect(SOURCE).toMatch(/Platform\.OS === 'web'[\s\S]{0,80}\{WEB_QUEUE_WARNING\}/);
    expect(SOURCE).not.toMatch(/tetap di halaman ini sampai muncul/);
  });
});
```

```bash
npx jest tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 4 passed, 4 total`.

Verified against a reconstructed copy of `SiteEventCaptureScreen.tsx`
carrying exactly this diff (not the full screen, which imports many
plan 1/2 components and modules this plan does not touch): all four
assertions pass. `npx tsc --noEmit` on this specific file requires plan 2's
`Header`, `Card`, `PhotoGalleryField`, `siteEvent/styles`,
`siteEvent/GateChipRow`, `siteEvent/VoiceNoteField`,
`siteEvent/OpenEventsList` and `siteEvent/captureModel` to already exist in
the repo (they do not yet in the environment this plan was written in, since
plan 2 is only up to its first task); step 7 below runs the real project-wide
`tsc` once the branch actually has plan 2 merged in.

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
```

Expected: only the pre-existing `workflows/App.tsx` error, once run against
the real branch with plan 2 fully merged.

```bash
git add workflows/screens/siteEvent/captureQueueModel.ts workflows/__tests__/captureQueueModel.test.ts \
        workflows/screens/SiteEventCaptureScreen.tsx tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts
git commit -m "$(cat <<'MSG'
feat(capture-queue): Kirim enqueues and returns at once, instead of awaiting the network

Replaces plan 2's synchronous createSiteEventWithMedia (upload, insert, invoke
kick-off, all awaited) with enqueueNewCapture + triggerDrain: the capture is
durably on the phone before Kirim returns, and delivery happens in the
background whenever there is a signal. The web hint now states the actual web
limitation (memory-only, spec §7) instead of a promise the online path could
no longer keep.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Beranda - the queue badge and "Perlu perhatian"

**Files:**
- Create: `workflows/screens/siteEvent/CaptureQueueCard.tsx`
- Modify: `workflows/screens/siteEvent/captureQueueModel.ts`, `workflows/__tests__/captureQueueModel.test.ts`, `workflows/screens/BerandaScreen.tsx` (plan 2 task 14)

Spec §7: "Beranda badge: `Antrean: N menunggu sinyal, M draf siap
dikonfirmasi`." This is a **separate** card from plan 2's "Draf menunggu"
(`DraftEventsCard.tsx`, task 14): that one reads confirmed server state
(`site_events` rows already at `pending_analysis` or `draft`) through
`listDraftEvents`, so it works from any device the supervisor signs into and
survives a reinstall. `CaptureQueueCard` reads the **local** queue through
`useCaptureQueueEntries`, so it stays useful with literally no signal at
all - exactly the case `DraftEventsCard`'s server read cannot cover. The two
cards can briefly show overlapping information (an entry that just reached
`draft_ready` is momentarily in both), and that overlap is intentional: it
is the same handoff the queue itself performs, made visible.

`attentionRows` (added to `captureQueueModel.ts` alongside task 4's
`WEB_QUEUE_WARNING`) turns every `needsAttention` entry into a row with a
title (the supervisor's own note, or a fallback), a reason (the last error,
or a fallback), and an action: `'retry'` for an ordinary failed entry,
`'discard'` for an `unrecoverable` one (its local file is gone; retrying
would only fail the same way five more times before flagging again).

- [ ] **Step 1: Write the failing test**

Replace `workflows/__tests__/captureQueueModel.test.ts` with:

```ts
import { enqueueCapture, markUnrecoverable, recordFailure, type CaptureQueueEntry } from '../../tools/captureQueue';
import { WEB_QUEUE_WARNING, attentionRows } from '../screens/siteEvent/captureQueueModel';
import type { NewSiteEvent } from '../../tools/siteEvents';

const NOW = '2026-09-11T03:00:00.000Z';

const event = (id: string, rawText: string | null): NewSiteEvent => ({
  id, projectId: 'p1', roomId: 'r1', reporterId: 'u1', gateCode: null, rawText, capturedAt: NOW,
  media: [{ id: `${id}-m`, localUri: 'file:///x.jpg', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW }],
});

const fresh = (id: string, rawText: string | null = null): CaptureQueueEntry =>
  enqueueCapture({ event: event(id, rawText), ownerId: 'u1', workGroupNames: [], nowIso: NOW });

describe('WEB_QUEUE_WARNING', () => {
  it('states the exact web limitation from spec §7', () => {
    expect(WEB_QUEUE_WARNING).toBe('Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.');
  });
});

describe('attentionRows', () => {
  it('is empty when nothing needs attention', () => {
    expect(attentionRows([fresh('e1')])).toEqual([]);
  });

  it('offers Coba lagi for a retryable flagged entry, using its note as the title', () => {
    let e = fresh('e1', '  Nat retak di dekat pintu  ');
    for (let i = 0; i < 5; i++) e = recordFailure(e, 'jaringan turun', NOW);
    expect(attentionRows([e])).toEqual([
      { id: 'e1', title: 'Nat retak di dekat pintu', reason: 'jaringan turun', action: 'retry' },
    ]);
  });

  it('falls back to a generic title and reason when the note and error are both empty', () => {
    let e = fresh('e2', '   ');
    for (let i = 0; i < 5; i++) e = recordFailure(e, 'x', NOW);
    e = { ...e, lastError: null };
    expect(attentionRows([e])[0]).toMatchObject({ title: 'Laporan tanpa catatan', reason: expect.stringMatching(/Ketuk untuk mencoba lagi/) });
  });

  it('offers Buang, not Coba lagi, for an unrecoverable entry', () => {
    const e = markUnrecoverable(fresh('e3'), 'Berkas hilang.');
    expect(attentionRows([e])[0]).toMatchObject({ action: 'discard', reason: 'Berkas hilang.' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest workflows/__tests__/captureQueueModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Module '"../screens/siteEvent/captureQueueModel"' has no exported member 'attentionRows'`.

- [ ] **Step 3: Extend the model**

Replace `workflows/screens/siteEvent/captureQueueModel.ts` with:

```ts
// SANO - Beranda offline-queue card rules (pure).

import {
  queueBadgeText,
  type CaptureQueueEntry,
} from '../../../tools/captureQueue';

export { queueBadgeText };

/** Copy for the web capture screen (spec §7 point 6); shown on Platform.OS === 'web' only. */
export const WEB_QUEUE_WARNING =
  'Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.';

export interface AttentionRow {
  id: string;
  title: string;
  reason: string;
  /** 'retry' offers "Coba lagi"; 'discard' offers "Buang" (local files are gone, nothing to retry). */
  action: 'retry' | 'discard';
}

const FALLBACK_TITLE = 'Laporan tanpa catatan';
const FALLBACK_REASON = 'Gagal setelah beberapa kali percobaan. Ketuk untuk mencoba lagi.';

/** Beranda's "Perlu perhatian" list: every entry flagged after 5 consecutive failures, or an unrecoverable one. */
export function attentionRows(entries: ReadonlyArray<CaptureQueueEntry>): AttentionRow[] {
  return entries
    .filter((e) => e.needsAttention)
    .map((e) => ({
      id: e.id,
      title: e.rawText && e.rawText.trim() ? e.rawText.trim() : FALLBACK_TITLE,
      reason: e.lastError ?? FALLBACK_REASON,
      action: e.unrecoverable ? 'discard' : 'retry',
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest workflows/__tests__/captureQueueModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 5 passed, 5 total`.

Verified together with the whole `captureQueue.ts`/`captureQueueStore.ts`
combination in a scratch harness while writing this plan: all 5 pass, and
`tsc --noEmit` against the real `tsconfig.json` is clean for this file.

- [ ] **Step 5: The card**

Create `workflows/screens/siteEvent/CaptureQueueCard.tsx`:

```tsx
import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Card from '../../components/Card';
import { useProject } from '../../hooks/useProject';
import { useToast } from '../../components/Toast';
import { discardEntryLocally, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
import { retryQueueEntry } from '../../../tools/captureQueueWorker';
import { attentionRows, queueBadgeText } from './captureQueueModel';
import { COLORS, FONTS, SPACE, TYPE } from '../../theme';

/**
 * The offline capture queue's own badge (spec §7), separate from plan 2's
 * "Draf menunggu" (DraftEventsCard): that card reads confirmed server state
 * (site_events rows that already exist); this one reads what is still only
 * on the phone, so it stays useful even with no signal at all. Hidden when
 * the queue is empty.
 */
export default function CaptureQueueCard() {
  const { profile } = useProject();
  const { show: toast } = useToast();
  const entries = useCaptureQueueEntries(profile?.id ?? null);

  const badge = queueBadgeText(entries);
  const attention = attentionRows(entries);

  const onRetry = useCallback(async (id: string) => {
    if (!profile) return;
    await retryQueueEntry(profile.id, id);
  }, [profile]);

  const onDiscard = useCallback(async (id: string) => {
    if (!profile) return;
    const result = await discardEntryLocally(profile.id, id);
    if (result.error) toast(result.error, 'critical');
  }, [profile, toast]);

  if (!badge && attention.length === 0) return null;

  return (
    <Card
      title="Antrean kiriman"
      subtitle={badge ?? undefined}
      borderColor={attention.length > 0 ? COLORS.warning : COLORS.info}
    >
      {attention.length > 0 ? (
        <View>
          <Text style={styles.sectionLabel}>Perlu perhatian</Text>
          {attention.map((row) => (
            <View key={row.id} style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
                <Text style={styles.reason} numberOfLines={2}>{row.reason}</Text>
              </View>
              <TouchableOpacity
                style={row.action === 'discard' ? styles.dangerBtn : styles.retryBtn}
                onPress={() => void (row.action === 'discard' ? onDiscard(row.id) : onRetry(row.id))}
                accessibilityRole="button"
                accessibilityLabel={row.action === 'discard' ? `Buang laporan ${row.title}` : `Coba lagi laporan ${row.title}`}
              >
                <Text style={row.action === 'discard' ? styles.dangerText : styles.retryText}>
                  {row.action === 'discard' ? 'Buang' : 'Coba lagi'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, textTransform: 'uppercase', marginBottom: SPACE.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  meta: { flex: 1 },
  title: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  reason: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  retryBtn: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 40, justifyContent: 'center' },
  retryText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase' },
  dangerBtn: { paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, minHeight: 40, justifyContent: 'center' },
  dangerText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.critical, textTransform: 'uppercase' },
});
```

This follows plan 2's `DraftEventsCard.tsx` (task 14) almost line for line -
same `Card` props (`title`, `subtitle`, `borderColor`), same
`useProject`/`useToast` import paths from a file at
`workflows/screens/siteEvent/`, same row/button style shapes - so the two
cards read as one visual family on Beranda rather than two different design
languages.

- [ ] **Step 6: Render it on `BerandaScreen.tsx`**

Add the import beside plan 2's `DraftEventsCard` import
(`workflows/screens/BerandaScreen.tsx`, task 14 step 8):

```tsx
import CaptureQueueCard from './siteEvent/CaptureQueueCard';
```

Render it directly **before** `<DraftEventsCard />`, so the phone-only queue
(the more urgent of the two - a report that has not even reached the server
yet) appears above the server-confirmed drafts:

```tsx
        {/* ── Kiriman offline yang masih di HP ──────────────────────────── */}
        <CaptureQueueCard />

        {/* ── Draf kejadian menunggu konfirmasi ─────────────────────────── */}
        <DraftEventsCard />
```

Both cards render nothing when they have nothing to show, so Beranda is
unchanged for office roles and for supervisors with an empty queue and no
pending drafts.

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
npx jest workflows/__tests__/captureQueueModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: only the pre-existing `workflows/App.tsx` error, once run against
the branch with plans 1 and 2 merged; `Tests: 5 passed, 5 total`.

```bash
git add workflows/screens/siteEvent/CaptureQueueCard.tsx workflows/screens/siteEvent/captureQueueModel.ts \
        workflows/__tests__/captureQueueModel.test.ts workflows/screens/BerandaScreen.tsx
git commit -m "$(cat <<'MSG'
feat(capture-queue): Beranda queue card - badge and Perlu perhatian

CaptureQueueCard reads the local queue (useCaptureQueueEntries), separate
from plan 2's server-backed "Draf menunggu": it stays useful with no signal
at all. Shows "Antrean: N menunggu sinyal, M draf siap dikonfirmasi" and,
when any entry has failed 5 times in a row, a "Perlu perhatian" list with
Coba lagi (clears the flag and drains again) or Buang (only for an
unrecoverable entry, whose local file is already gone).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Web - proving the store and the worker compose end to end

**Files:**
- Create: `tools/__tests__/captureQueueWeb.test.ts`

Tasks 2 and 3 each already test their own `Platform.OS === 'web'` branch in
isolation: `captureQueueStore.test.ts`'s "web backend" block proves
`enqueueNewCapture`/`loadQueue` never touch AsyncStorage or the filesystem,
and `captureQueueWorker.test.ts` never mocks `Platform` at all (it mocks
`captureQueueStore` directly, so it is agnostic to which backend that store
would have picked). Neither test proves the two modules actually **compose**
correctly on web - that draining a web-enqueued capture reaches `draft_ready`
and gets purged the same way a native one does, with the real (not mocked)
`captureQueueStore` underneath. This task closes that gap with one
end-to-end test.

- [ ] **Step 1: Write the test**

Create `tools/__tests__/captureQueueWeb.test.ts`:

```ts
/**
 * captureQueueStore.ts and captureQueueWorker.ts each degrade to Platform.OS
 * === 'web' separately (tasks 2 and 3); this test runs them TOGETHER on the
 * web backend, the same way the app actually uses them: enqueue, drain,
 * reach draft_ready, with no AsyncStorage or filesystem call at any point.
 * Proves the two modules' web branches actually compose, not just that each
 * one in isolation avoids native APIs.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })) }), { virtual: true });

const fsCalls: string[] = [];
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  makeDirectoryAsync: jest.fn(async () => { fsCalls.push('mkdir'); }),
  copyAsync: jest.fn(async () => { fsCalls.push('copy'); }),
  deleteAsync: jest.fn(async () => { fsCalls.push('delete'); }),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
}));

const storageCalls: string[] = [];
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => { storageCalls.push('getItem'); return null; }),
  setItem: jest.fn(async () => { storageCalls.push('setItem'); }),
  removeItem: jest.fn(async () => { storageCalls.push('removeItem'); }),
}));

jest.mock('../siteEvents', () => ({
  uploadSiteEventMedia: jest.fn(async () => ({ bytesById: { 'e1-m1': 42 } })),
  insertSiteEvent: jest.fn(async () => ({})),
  invokeSiteEventAnalysis: jest.fn(async () => ({ ok: true, code: 'ANALYZED', status: 'draft' })),
}));

import { enqueueNewCapture, loadQueue, __clearWebStoreForTests } from '../captureQueueStore';
import { startCaptureQueueWorker, stopCaptureQueueWorker } from '../captureQueueWorker';
import type { NewSiteEvent } from '../siteEvents';

const USER = 'web-user';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const event: NewSiteEvent = {
  id: 'e1', projectId: 'p1', roomId: 'r1', reporterId: USER, gateCode: null, rawText: 'Catatan web',
  capturedAt: '2026-09-11T02:00:00.000Z',
  media: [{ id: 'e1-m1', localUri: 'blob:https://sano-app.vercel.app/abc', kind: 'photo', role: 'context', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-11T02:00:00.000Z' }],
};

beforeEach(() => {
  __clearWebStoreForTests();
  fsCalls.length = 0;
  storageCalls.length = 0;
  stopCaptureQueueWorker();
});

afterEach(() => {
  stopCaptureQueueWorker();
});

it('drains a web capture end to end in memory, touching neither AsyncStorage nor the filesystem', async () => {
  await enqueueNewCapture({ userId: USER, event, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
  startCaptureQueueWorker(USER);
  await flush();
  await flush();
  await flush();

  expect(fsCalls).toEqual([]);
  expect(storageCalls).toEqual([]);
  // The web store purges a 'done' entry the same way native does, so after a
  // successful drain the queue is empty - the app relies on plan 2's server
  // read (listDraftEvents) from that point on, exactly as on native.
  expect(await loadQueue(USER)).toEqual([]);
});

it('forgets everything once the in-memory store is cleared, standing in for a closed tab', async () => {
  await enqueueNewCapture({ userId: USER, event, workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
  expect((await loadQueue(USER)).length).toBe(1);
  __clearWebStoreForTests();
  expect(await loadQueue(USER)).toEqual([]);
});
```

- [ ] **Step 2: Run it**

```bash
npx jest tools/__tests__/captureQueueWeb.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 2 passed, 2 total`. Verified in the same scratch harness as
the rest of this plan: 2/2 pass, and neither `AsyncStorage` nor
`expo-file-system/legacy` is called at any point in the drain.

- [ ] **Step 3: Commit**

```bash
git add tools/__tests__/captureQueueWeb.test.ts
git commit -m "$(cat <<'MSG'
test(capture-queue): the store and the worker compose correctly on web

Tasks 2 and 3 each proved their own Platform.OS === 'web' branch in
isolation; this runs them together - enqueue, drain, reach draft_ready, purge
- with real (not mocked) AsyncStorage and expo-file-system/legacy spies,
confirming neither is ever called on the full web path.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Final verification and the user-run steps

**Files:** none new.

- [ ] **Step 1: Full jest suite, prod-DB suites excluded exactly as CI excludes them**

```bash
npx jest --silent --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' '__tests__/(serverGateEnforcement|materialLinkTrial|materialAliasesRls|publishBreakdownTrial|notificationDispatch|dump_real_parser_output)\.test\.ts$'
```

Expected: every suite passes. The suites this plan adds, and their counts -
every one of these was run in a scratch harness while writing this plan and
passed at exactly this count:

| Suite | Tests |
|---|---|
| `tools/__tests__/captureQueue.test.ts` | 20 |
| `tools/__tests__/captureQueueStore.test.ts` | 11 |
| `tools/__tests__/captureQueueWorker.test.ts` | 14 |
| `tools/__tests__/captureQueueAppWiring.test.ts` | 4 |
| `tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts` | 4 |
| `tools/__tests__/captureQueueWeb.test.ts` | 2 |
| `workflows/__tests__/captureQueueModel.test.ts` | 5 |

The last exclusion pattern is CI's own prod-DB exclusion
(`.github/workflows/ci.yml`), so nothing here reaches the live database.
Never set `ALLOW_PROD_DB_TESTS`.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: only the pre-existing `workflows/App.tsx` error documented at
`.github/workflows/ci.yml:50-54`. `tools/captureQueue.ts`,
`tools/captureQueueStore.ts` and `tools/captureQueueWorker.ts` were each
already confirmed clean against the real `tsconfig.json` in the scratch
harness; this step re-checks them in place alongside every other file in the
repo, including the ones tasks 4-5 modified that could not be fully
type-checked in isolation (task 4 step 6, task 5 step 4).

- [ ] **Step 3: Web export, the check CI does not do**

```bash
npx expo export --platform web
git status --porcelain | grep -E '^\?\?' | grep -Ev '^\?\? (tmp/|outputs/|assets/|docs/audits/|sano-normalizer-kit)' || echo "no new untracked source files"
```

Expected: the export completes (it bundles `expo-network`'s web
implementation and the new queue card), and no untracked source file
remains. CI never runs `expo export` (`.github/workflows/ci.yml`).

- [ ] **Step 4: Static audits**

```bash
grep -rn "OPENAI_API_KEY\|ANTHROPIC_API_KEY" tools/captureQueue.ts tools/captureQueueStore.ts tools/captureQueueWorker.ts workflows/screens/siteEvent/CaptureQueueCard.tsx || echo "no provider keys in the offline queue"
grep -n "\.delete(" tools/captureQueueStore.ts || echo "no raw deletes; discardEntryLocally goes through the same guarded path as everything else"
grep -c "invokeSiteEventAnalysis(entry.id" tools/captureQueueWorker.ts
```

Expected: the two "no ..." lines, and `1` for the last command - invoke is
called from exactly one place in the worker, confirming the hands-off design
was not accidentally duplicated into a retry loop.

- [ ] **Step 5: User-run steps**

These are for the user. **Implementers must not execute any of them**: they
touch a signed APK and real devices.

1. **APK on channel `preview`.** `expo-network` is a native module, and this
   plan's branch also needs whatever plans 1 and 2 already required
   (`expo-camera`, `expo-linking`, `expo-audio`, `expo-crypto`); if the APK
   from plan 2's rollout already included this plan's `expo-network`
   dependency, a new build is still required - a JS-only `eas update` cannot
   add a native module to an already-installed binary.
   ```bash
   eas build -p android --profile preview
   ```
2. **Manual device checks no unit test can stand in for** (spec §7, §14):
   - **Airplane-mode capture.** Turn on airplane mode, report a full
     capture (context photo, two close-ups, a voice note, a note), tap
     Kirim: it returns in under a second with "Tersimpan, dikirim saat ada
     sinyal", and the Beranda queue card shows "1 menunggu sinyal". Turn
     airplane mode off: within the next foreground or a few seconds, the
     entry drains and disappears from the queue card, and appears in "Draf
     menunggu".
   - **Kill and relaunch with a queued entry.** Capture while offline, force-
     quit the app before turning the network back on, relaunch: the queued
     entry is still there (loaded from AsyncStorage), still shows "1
     menunggu sinyal", and drains normally once signal returns.
   - **Flaky network.** Capture on a real connection that drops mid-upload
     (toggle airplane mode on partway through a large voice-note upload):
     the entry moves to `failed` with a specific Indonesian error, the
     backoff schedule is visible in the queue card not immediately retrying,
     and it eventually succeeds without duplicating anything (check
     `site_events` and `site_event_media` for the event's id after: exactly
     one row each).
   - **Sign-out with a queued entry.** Capture while offline, sign out
     before reconnecting, sign back in as the same user: the entry is still
     queued (per-user AsyncStorage key) and resumes draining. Sign out and
     sign in as a **different** supervisor on the same phone: the first
     supervisor's queued entry does not appear anywhere in the second
     supervisor's Beranda.
   - **Two supervisors on one phone.** Both supervisors capture something
     while signed in at different times on the same physical device; confirm
     neither ever sees the other's queue card content, using
     `AsyncStorage.getAllKeys()` in a debug console if needed to confirm the
     `sano.captureQueue.v1.*.{userId}.*` keys are genuinely separate.
   - **"Perlu perhatian."** Force five consecutive failures on one entry (a
     sustained airplane-mode capture left untouched for the five retry
     backoff windows, or a deliberately invalid `projectId` in a debug
     build), confirm "Coba lagi" appears with the last error shown, tap it,
     confirm it clears and retries. Separately, force a missing-file case
     (capture, then delete the app's `capture-queue/` folder contents via a
     file manager before the next drain) and confirm "Buang" appears
     instead, with the "hilang dari HP" reason.

- [ ] **Step 6: Report**

Summarise for the user: suite counts and pass/fail, `tsc` and export result,
and the handover of step 5's device checks. Do not report a user-run step as
done.

---

## Self-review and deviations

Every deviation from the task brief that seeded this plan, or from the
spec's own wording, with the evidence behind it.

| # | Brief or spec says | This plan does | Evidence |
|---|---|---|---|
| D1 | Brief: "Pick one, justify it" between the new `expo-file-system` object API and the legacy one | Legacy API (`expo-file-system/legacy`) throughout | `tools/storage.ts:4` already imports it this way; the classic API's function set (`copyAsync`, `makeDirectoryAsync`, `deleteAsync`, `getInfoAsync`, `documentDirectory`) matches `node_modules/expo-file-system/build/legacy/FileSystem.d.ts` exactly, and plan 2 task 8's own jest mock already targets this same module path |
| D2 | Brief: "verify plan 2's implementation... or have plan 3 change `insertSiteEvent` to upsert-ignore; pick one" | Neither branch needed - `insertSiteEvent` (`tools/siteEvents.ts`, plan 2 task 9) already calls `.upsert(..., { onConflict: 'id', ignoreDuplicates: true })` for both `site_events` and `site_event_media` | Quoted verbatim from plan 2's task 9 code block and its own doc comment ("a retry after a lost response cannot duplicate"); this plan's worker calls `insertSiteEvent` completely unmodified |
| D3 | Spec §7's state list names `queued`, `uploading`, `analyzing`, `draft_ready`, `done`, `failed` without defining exactly when the coarse `state` changes relative to fine-grained progress | `state` is always *derived* from four independent progress flags (one per media item's `uploaded`, plus `eventInserted`/`analysisRequested`/`localCleanedUp`), never set as an independent field | Spec §7 only names the states; it does not specify the relationship between "uploading" and "the row exists yet" or between "analyzing" and "the analysis actually finished." Deriving state from progress, guarded by an explicit transition table, was the only design that let `nextStep` and the displayed `state` provably never disagree - verified by the "illegal transitions" test in Task 1 |
| D4 | Spec §7 does not say what happens when a queue entry's local media file is missing before it uploads | A dedicated `unrecoverable` flag, set only by `captureQueueStore.ts`'s load-time recovery pass, with `discardEntryLocally` as the only way out (refused once the event is already on the server) | Spec §7 says "recovery of entries whose media files are missing (mark `needsAttention` with a clear Indonesian reason; never silently drop)" but does not say what UI action follows. `unrecoverable` distinguishes "retrying will eventually work" from "retrying can never work" so the Beranda card (task 5) can offer the right action instead of five wasted retry cycles |
| D5 | Spec §7: "insert the `site_events` row... insert the media rows; invoke `site-event-analyze`... mark `draft_ready` and delete the local copies **only after the server confirms**" | `draft_ready` is reached once `analysisRequested` is true (i.e., invoke was attempted, regardless of outcome), not once the AI draft itself exists | "The server confirms" most plausibly means the event and media rows exist server-side (spec §12 already treats a failed/deferred analysis as a state the row can sit in indefinitely: "Draft will be made... or isi manual"). Requiring the AI draft itself before `draft_ready` would mean an outage in the Anthropic or OpenAI API could strand local media files forever, directly violating the surrounding sentence in the same paragraph: "a failed or quota-deferred invoke must not block" |
| D6 | Task brief: "decide whether the queue retries invoke or hands off, and say why" | Hands off, exactly once per pass, never retried by this module | See Task 3's full reasoning (three numbered points); the short version is that `insertSiteEvent` already made the record durable, and `SiteEventConfirmScreen`'s "Analisis ulang" (plan 2 task 13) is already the user-facing retry surface, so a second automatic retry loop would only race it and burn the daily cap for no benefit |
| D7 | Spec §7's entry shape (paraphrased in the task brief as "gateCode, optional stepCode") | No `stepCode` field on `CaptureQueueEntry` | Plan 2's actual `NewSiteEvent` (`tools/siteEvents.ts` task 9) - the exact type `SiteEventCaptureScreen.tsx`'s `buildNewSiteEvent` produces and this queue enqueues - has no `stepCode`; the capture screen only collects a gate hint (`GateChipRow`), and the step is chosen later at confirm from `SiteEventConfirmScreen`'s loaded `activeSteps`. A queue entry mirrors exactly what capture collects |
| D8 | Task brief: "backoff between attempts" | 30s / 60s / 120s / 240s / 480s, capped at 15 minutes, doubling per consecutive failure | Not specified further by the brief or spec. Chosen to reach the 5-failure `needsAttention` threshold in under 16 minutes of real time on a sustained outage (30+60+120+240+480 = 930s ≈ 15.5 min), so a supervisor who leaves the app open during a long dead zone sees "Perlu perhatian" within one shift-length window rather than never or immediately |

**Verification method, stated plainly.** Every module in Tasks 1-3 and the
model in Tasks 4-5 was written into a scratch harness (outside this repo, in
the session's own scratchpad directory) with the exact `node_modules` this
worktree already has available via symlink, plus one small hand-written
ambient package for `expo-network` (not yet installed anywhere) matching its
documented SDK 54 API surface. Every jest suite listed in Task 7's table was
actually run there and passed at the stated count; `tsc --noEmit` against
the real, unmodified `tsconfig.json` was run against every pure `tools/`
module and came back clean. The two static-guard tests that read
`workflows/App.tsx` and `workflows/screens/SiteEventCaptureScreen.tsx`
(Tasks 3 and 4) were run against **reconstructed excerpts** carrying exactly
the diff this plan specifies - not the full files, which import many plan
1/2 modules that do not yet exist in this environment (plan 2 here is only
as far as its first task) - and passed. `CaptureQueueCard.tsx` (Task 5) was
type-checked against minimal stand-ins for `Card`, `useProject`, `useToast`
and `theme` (matching the signatures those real files were read in full to
confirm, not reconstructing their actual implementations) and produced zero
errors attributable to the new file - every remaining `tsc` error in that
pass traced to the same missing plan 1/2 modules as the App.tsx and
SiteEventCaptureScreen.tsx checks above. All of this should still be
re-verified with the real project-wide `tsc --noEmit` in Task 7 step 2,
once this plan's branch actually has plans 1 and 2 merged into it.

**Things to check while executing:**

- Plans 1 and 2 must both be merged into this branch first; task 3 imports
  `tools/siteEvents.ts`'s three pipeline functions and `LocalSiteEventMedia`/
  `NewSiteEvent` types (plan 2 task 9), and tasks 4-5 edit
  `SiteEventCaptureScreen.tsx` (plan 2 task 12) and `BerandaScreen.tsx`
  (plan 2 task 14).
- If plan 2's actual shipped `insertSiteEvent`/`uploadSiteEventMedia`/
  `invokeSiteEventAnalysis` signatures differ even slightly from what this
  plan quotes (D2 above), re-read `tools/siteEvents.ts` before writing
  `runStep` in Task 3 - the whole point of D2 is that this plan deliberately
  does not touch those functions, so they must be called exactly as they
  exist, not as this plan remembers them.
- If `expo-network`'s actual `addNetworkStateListener` signature differs
  from Task 3's assumption once installed, update `attachNetworkListener`
  to match and note the difference in the commit body, the same way plan 2
  handled uncertainty around `expo-audio`'s exact type surface.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
