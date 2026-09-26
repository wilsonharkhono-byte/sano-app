# Closure Evidence and Morning Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Selesai" asks for proof by event type and the database enforces it (migration 105); a close survives no signal as a second job kind in the offline capture queue; and a 07:00 WIB digest (migration 106), built on one "needs attention" view that the app also shows as "Perlu ditindak" at the top of Papan Ruangan, tells each person once per project what needs action.

**Architecture:** Three lanes that three agents run in parallel in one shared worktree. Lane 1 ("closure rule") re-creates `close_site_event` with an evidence check against `storage.objects`, restates the rule in a pure `closureModel.ts`, and rebuilds `ClosureForm` so its submit only enqueues. Lane 2 ("offline close") turns `CaptureQueueEntry` into `CaptureJob | CloseJob` (schema version 2, v1 records upgraded in place), adds the close state machine and the worker's `insert_media`, `close` and `lookup_closer` steps, and shows close jobs on the Beranda card and the room timeline. Lane 3 ("digest") adds `v_site_event_attention`, the digest log, `enqueue_site_event_digests` and its pg_cron schedule, reads the view into `AttentionList` and the office `DigestHealthLine`, routes the `RoomBoard` deeplink per role, and rehearses 105 and 106 on a disposable Postgres. The lanes meet only through the interfaces in *Shared interfaces* below; no file is edited by two lanes except `tools/siteEvents.ts`, whose line ranges and commit order are fixed in *Lanes*.

**Tech Stack:** TypeScript, React Native (Expo SDK 54 / RN 0.81), React Navigation 6, Supabase Postgres (hand-pasted migrations, pg_cron), AsyncStorage + `expo-file-system/legacy` (already in the binary), jest + ts-jest + React Native Testing Library, Docker `supabase/postgres` for the rehearsal. Indonesian UI copy, no i18n library. No new dependency and no native module, so the release is an OTA, not a build.

**Spec:** `docs/superpowers/specs/2026-09-26-closure-evidence-and-digest-design.md`, every section. `CLAUDE.md` §12 (the user's truth contract) is binding on every task: no optimistic "Selesai", a failed read renders an error and never an empty state, and nothing claims success before the server's yes.

**Branch and working tree:** `feat/closure-evidence-digest`, head `bddcd97` when this plan was written, checked out in the git worktree `/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/closure-digest` with `node_modules` installed. Run every command below from that directory:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/closure-digest"
```

**How this plan was checked before it was written:** every code block below was applied, exactly as written, to this worktree at `bddcd97` (and reverted afterwards), one task after another in this dependency-respecting order: L2-T1, L2-T2, L1-T1, L1-T2, L3-T1, L3-T2, L3-T3, L3-T4, L3-T5, L2-T3, L2-T4, L1-T3, L1-T4, L1-T5, L2-T5, L2-T6, L3-T6, L2-T7, L3-T7. Each task's "verify it fails" run was reproduced against the state just before that task. `npx tsc --noEmit -p .` was clean after Lane 2 Task 3, after Lane 1 Task 4 and after the last task, and all 41 touched suites passed at the end. The Docker rehearsal (Lane 3 Task 7) was written but not run: running SQL was out of bounds while planning, so its expected tally (`PASS=58`) is derived by counting its checks, and its first run is part of the task.

---

## Conventions (every task relies on these)

**Tests.** Jest in this worktree must be run exactly like this, or the repo's `testPathIgnorePatterns` (which lists `/.claude/worktrees/`) hides every test:

```bash
npx jest <path> --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

- Every run step below names its suites. Never run the whole suite: a full run rewrites `assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx`. If it ever happens, run `git restore assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx` afterwards and never commit that file. (For the record: a full run at `bddcd97` already fails `tools/__tests__/publishBreakdownTrial.test.ts` and `tools/__tests__/materialAliasesRls.test.ts`; nothing here touches either.)
- Render suites need `jest.setTimeout(20000)`; every render test below sets it.
- `Platform` from `react-native` can be `undefined` under this jest setup, so new code reads `Platform?.OS`.
- Rendering a react-native `Image` needs the per-test `jest.mock('react-native/Libraries/Image/Image', ...)` pattern from `workflows/components/__tests__/StoragePhoto.test.tsx`. None of the new render tests renders an `Image` (they mock `MediaStrip` and `PhotoGalleryField`); if you add one that does, copy that mock.
- After every task: `npx tsc --noEmit -p .` must print nothing for the files the task owns.

**Git.** The worktree is shared by three agents at once, so:

- Every commit uses an explicit pathspec, exactly `git add <files> && git commit -F <msgfile> -- <files>`, listing only the task's own files. Never `git add -A`, `git add .`, `git commit -a`, `git stash`, `git checkout -- .`, `git restore .` or `git clean`: each of those touches another lane's work.
- Write the commit message to a file in `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/` with the Write tool. Never build it with a heredoc, and never chain heredocs with `\` continuations. Every message ends with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; the commit steps below give each message in full.
- Before editing a file, `git status --porcelain <file>` should print nothing unless this task already touched it. If it shows a change you did not make, another lane is in the wrong file: stop and report.
- If `tsc` reports errors only in files another lane owns (see *Lanes*), that lane is mid-task. Wait a minute and run it again before committing; never edit their file to make yours pass.

**Migrations.** Pasted by hand into the Supabase Dashboard SQL editor (remote migration history is divergent; `supabase db push` is broken). So each file:

- starts with a header comment: spec link, PASTE ORDER, RE-PASTE SAFETY, and what re-pasting an older file undoes;
- runs `SET lock_timeout = '5s';` first and `RESET lock_timeout;` once, after the last statement that changes anything;
- drops by exact signature before re-creating (`DROP FUNCTION IF EXISTS <exact signature>` before `CREATE OR REPLACE`), and uses `DROP POLICY/TRIGGER/VIEW IF EXISTS` and `CREATE TABLE/INDEX IF NOT EXISTS`;
- ends with a `-- SELF-CHECK` footer whose `EXPECTED:` lines the static guard counts, as 104 does.
- The static guard tests read the SQL with full-line comments stripped (`src.replace(/^\s*--.*$/gm, '')`, copied from `migration099.test.ts`), so a comment can never satisfy a guard.
- Typed `\uXXXX` escapes arrive as raw characters in this environment. Write Indonesian copy, the en dash, the middle dot and the arrow as plain UTF-8, never as `\u` escapes, and scan every new SQL file for invisible characters (the step is in each migration task).

**Boundaries.** Never call Supabase, never read `.env`, never run SQL against any database. The one exception is Lane 3 Task 7, which runs SQL only inside its own disposable Docker container. Never paste a migration anywhere; the user pastes them (see *Release*).

---

## Shared interfaces

Lane 2 owns these; Lanes 1 and 3 import them. The signatures are final: build against them exactly.

```ts
// tools/captureQueue.ts - Lane 2 Task 3
export type QueueState =
  | 'queued' | 'uploading' | 'analyzing' | 'draft_ready' | 'closing' | 'done' | 'superseded' | 'failed';
export type QueueJobKind = 'capture' | 'close';

interface QueueJobBase {
  version: 2;
  id: string;                 // capture: the event id; close: a fresh uuid, never the event id
  ownerId: string;
  projectId: string;
  media: QueueMediaItem[];
  state: QueueState;
  localCleanedUp: boolean;
  createdAt: string;
  attempts: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  needsAttention: boolean;
  unrecoverable: boolean;
  lastFailureKind?: 'transient' | 'permanent';
}
export interface CaptureJob extends QueueJobBase {
  kind: 'capture';
  roomId: string; reporterId: string; gateCode: string | null; rawText: string | null; capturedAt: string;
  workGroupNames: string[]; eventInserted: boolean; analysisRequested: boolean;
}
export interface ClosedElsewhere { closedByName: string | null; closedAt: string }
export interface CloseJob extends QueueJobBase {
  kind: 'close';
  eventId: string; roomId: string; eventTitle: string;
  note: string | null;        // exactly what close_site_event receives
  mediaInserted: boolean;
  closeOutcome: null | 'closed' | 'not_open';
  closedElsewhere: ClosedElsewhere | null;
}
export type CaptureQueueEntry = CaptureJob | CloseJob;

// tools/captureQueueStore.ts - Lane 2 Task 4
export interface NewCloseRequest {
  userId: string;
  jobId: string;              // the form passes newSiteEventId()
  eventId: string;
  projectId: string;
  roomId: string;
  eventTitle: string;
  note: string;               // as typed; the job stores note.trim() or null
  closurePhoto: LocalSiteEventMedia | null;
  nowIso: string;
}
export type EnqueueCloseResult = { entry: CloseJob; error?: undefined } | { entry?: undefined; error: string };
export const CLOSE_ALREADY_PENDING = 'Penutupan kejadian ini sudah menunggu kirim.';
export async function enqueueCloseJob(request: NewCloseRequest): Promise<EnqueueCloseResult>; // throws on a copy failure
export function pendingCloseFor(entries: ReadonlyArray<CaptureQueueEntry>, eventId: string): CloseJob | undefined;
export async function acknowledgeCloseEntry(userId: string, entryId: string): Promise<{ error?: string }>;
export function useCaptureQueueEntries(userId: string | null): CaptureQueueEntry[];            // exists today

// tools/captureQueueWorker.ts - exists today, unchanged signatures
export function triggerDrain(): void;
export async function retryQueueEntry(userId: string, entryId: string): Promise<void>;

// tools/timeWindow.ts - Lane 2 Task 1
export const WIB_MONTH_ABBR: ReadonlyArray<string>; // ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
export function formatWibShort(iso: string): string;  // '2026-09-17T07:05:00.000Z' -> '17 Sep 14.05'

// tools/siteEvents.ts - Lane 2 Task 2 (used by Lane 2's worker only)
export async function insertClosureMedia(
  carrier: { id: string; projectId: string; media: LocalSiteEventMedia[] }, // id = the EVENT id
  bytesById: Record<string, number | null>,
): Promise<{ error?: string; kind?: SiteEventErrorKind }>;
export type CloseRpcResult = { ok: true } | { notOpen: true } | { error: string; kind: SiteEventErrorKind };
export async function closeSiteEventRpc(eventId: string, note: string | null): Promise<CloseRpcResult>;
export type CloserLookup = { closedByName: string | null; closedAt: string } | { error: string; kind: SiteEventErrorKind };
export async function lookupSiteEventCloser(eventId: string): Promise<CloserLookup>;
```

**No stubs across lanes.** Lane 1 Tasks 4 and 5 and Lane 3 Task 6 need `enqueueCloseJob`, `pendingCloseFor` or the `CloseJob` type to exist for the type check, even where their tests mock the module. A compile-time stub would mean Lane 1 or 3 editing a Lane 2 file, which this plan forbids, so those tasks wait for Lane 2 Task 4's commit instead. Each lane has independent work to do first (see *Suggested schedule*), so nobody idles.

---

## File structure

| File | Lane | Responsibility |
|---|---|---|
| `supabase/migrations/105_close_site_event_evidence.sql` (create) | 1 | Paste precondition on `storage.objects`; `close_site_event` with the trim and the evidence rule. |
| `tools/__tests__/migration105.test.ts` (create) | 1 | Static guard for 105, `migration099.test.ts` style. |
| `workflows/screens/siteEvent/closureModel.ts` (create) | 1 | Pure: requirement by type, the blocker sentence, code-point counting, every form label, the two toasts. |
| `workflows/__tests__/closureModel.test.ts` (create) | 1 | The rule per type, emoji counting, the copy. |
| `workflows/screens/siteEvent/ClosureForm.tsx` (replace) | 1 | Wajib/Opsional badges, disabled button with its sentence, submit that only enqueues. |
| `workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx` (create) | 1 | Six types, gating, queue-only submit, refusals. |
| `tools/siteEvents.ts`, lines 131-159 (`RPC_ERROR_COPY`) | 1 | Copy for `SITE_EVENT_CLOSURE_PHOTO_REQUIRED` and `SITE_EVENT_CLOSURE_NOTE_REQUIRED`. |
| `tools/__tests__/siteEvents.test.ts` | 1 | Cross-check reads 105; mapper cases; the old `closeSiteEvent` tests removed. |
| `workflows/screens/SiteEventDetailScreen.tsx` | 1 | New `ClosureForm` props; "Menunggu kirim"; retry; closure photo beside the closer. |
| `workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx` (create) | 1 | Pending, flagged, reload on leave, photo split. |
| `tools/timeWindow.ts` | 2 | `WIB_MONTH_ABBR`, `formatWibShort`. |
| `tools/__tests__/timeWindow.test.ts` | 2 | Both, across the 17:00 UTC rollover. |
| `tools/siteEvents.ts`, the new close block and the removal of `closeSiteEvent` | 2 | `insertClosureMedia`, `closeSiteEventRpc`, `lookupSiteEventCloser`. |
| `tools/__tests__/siteEventsClose.test.ts` (create) | 2 | The three calls: idempotent insert, outcome classification, the server's closer. |
| `tools/captureQueue.ts` (replace) | 2 | The union, version 2 and `upgradeEntry`, both transition tables, `nextStep` dispatch, close mutators. |
| `tools/captureQueueWorker.ts` | 2 | `insert_media`, `close`, `lookup_closer`; the event folder as a close job's upload carrier. |
| `tools/captureQueueStore.ts` | 2 | `enqueueCloseJob`, `pendingCloseFor`, `acknowledgeCloseEntry`, discard refusal, closure-photo recovery. |
| `workflows/screens/siteEvent/captureQueueModel.ts` | 2 | Kind-aware `attentionRows`, `supersededReason`. |
| `workflows/screens/siteEvent/CaptureQueueCard.tsx` | 2 | "Batalkan" (confirmed) and "Mengerti". |
| `workflows/screens/siteEvent/timelineModel.ts` | 2 | `canClose(ev, closePending)`. |
| `workflows/screens/siteEvent/RoomTimeline.tsx` | 2 | "Menunggu kirim" badge; no "Selesai" while pending. |
| `tools/__tests__/captureQueue.test.ts`, `captureQueueWorker.test.ts`, `captureQueueStore.test.ts`, `workflows/__tests__/captureQueueModel.test.ts`, `timelineModel.test.ts` | 2 | Extended as each task says. |
| `workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx` (create) | 2 | Mengerti, confirmed Batalkan, waiting count. |
| `supabase/migrations/106_site_event_digest.sql` (create) | 3 | View, log, health view, day label, digest function, type CHECK, schedule. |
| `tools/__tests__/migration106.test.ts` (create) | 3 | Static guard for 106, including the month list against `WIB_MONTH_ABBR`. |
| `tools/notificationRouting.ts` | 3 | `RoomBoard` deeplink: supervisor `RoomBoard`, everyone else `Rooms`. |
| `tools/__tests__/notificationRouting.test.ts` | 3 | Both mappings. |
| `tools/siteEventAttention.ts` (create) | 3 | `listSiteEventAttention`, `getDigestHealth`, pure row helpers. |
| `tools/__tests__/siteEventAttention.test.ts` (create) | 3 | Query shape, read errors, chips. |
| `office/screens/rooms/AttentionList.tsx` (create) | 3 | "Perlu ditindak" with "Milik saya". |
| `office/screens/rooms/DigestHealthLine.tsx` (create) | 3 | "Pengingat terakhir: ..." / "belum pernah terkirim" / read error. |
| `office/screens/rooms/RoomBoardView.tsx` | 3 | Mounts both; pending close ids; reload key. |
| `workflows/screens/RoomBoardScreen.tsx`, `office/screens/RoomsAdminScreen.tsx`, `office/screens/PrincipalRoomsScreen.tsx` | 3 | Read the digest's params; office layouts show owners and the health line. |
| `office/screens/rooms/__tests__/AttentionList.test.tsx`, `DigestHealthLine.test.tsx`, `RoomBoardView.attention.test.tsx` (create) | 3 | The three components. |
| `supabase/tests/site_event_closure_rehearsal/` (create: `storage_stub.sql`, `fixture.sql`, `rehearse_105.sql`, `rehearse_106.sql`, `rehearse_repaste_097.sql`, `rehearse_repaste_105.sql`, `run.sh`) | 3 | Postgres rehearsal of 105 and 106 as real roles. |

---

## Lanes

| Lane | Name | Tasks | Owns |
|---|---|---|---|
| 1 | closure rule | L1-T1 closureModel · L1-T2 migration 105 · L1-T3 RPC copy · L1-T4 ClosureForm · L1-T5 detail screen | `supabase/migrations/105_*`, `tools/__tests__/migration105.test.ts`, `workflows/screens/siteEvent/closureModel.ts`, `workflows/__tests__/closureModel.test.ts`, `workflows/screens/siteEvent/ClosureForm.tsx` and its test, `tools/siteEvents.ts` **lines 131-159 only**, `tools/__tests__/siteEvents.test.ts`, `workflows/screens/SiteEventDetailScreen.tsx` and its test |
| 2 | offline close | L2-T1 formatWibShort · L2-T2 close calls · L2-T3 queue machine + worker · L2-T4 store · L2-T5 Beranda card · L2-T6 room timeline · L2-T7 remove `closeSiteEvent` | `tools/timeWindow.ts` + test, `tools/siteEvents.ts` **new close block and the `closeSiteEvent` deletion only**, `tools/__tests__/siteEventsClose.test.ts`, `tools/captureQueue.ts`, `tools/captureQueueWorker.ts`, `tools/captureQueueStore.ts`, their three tests, `captureQueueModel.ts` + test, `CaptureQueueCard.tsx` + test, `timelineModel.ts` + test, `RoomTimeline.tsx` |
| 3 | digest | L3-T1 routing · L3-T2 migration 106 · L3-T3 attention reads · L3-T4 DigestHealthLine · L3-T5 AttentionList · L3-T6 board mount + screens · L3-T7 Docker rehearsal | `supabase/migrations/106_*`, `tools/__tests__/migration106.test.ts`, `tools/notificationRouting.ts` + test, `tools/siteEventAttention.ts` + test, `office/screens/rooms/AttentionList.tsx`, `DigestHealthLine.tsx`, `RoomBoardView.tsx` and their tests, `workflows/screens/RoomBoardScreen.tsx`, `office/screens/RoomsAdminScreen.tsx`, `office/screens/PrincipalRoomsScreen.tsx`, `supabase/tests/site_event_closure_rehearsal/` |

**`tools/siteEvents.ts` is the one file two lanes edit.** The ranges are disjoint and the order is fixed, so neither lane ever commits the other's hunk:

1. **Lane 2 Task 2** inserts the close block directly above the `discardSiteEvent` doc comment (original line 562) and commits.
2. **Lane 1 Task 3** then edits only the `RPC_ERROR_COPY` array (original lines 131-159) and commits. Before starting, it checks that `git status --porcelain tools/siteEvents.ts` prints nothing.
3. **Lane 2 Task 7** then deletes `closeSiteEvent` (original lines 532-560) and commits. Before starting, it checks the same.

**Cross-lane dependencies** (a task may start only when every task it names is committed):

| Task | Waits for | Why |
|---|---|---|
| L1-T3 | L1-T2, **L2-T2** | the cross-check reads 105; `tools/siteEvents.ts` order |
| L1-T4 | L1-T1, **L2-T4** | `enqueueCloseJob` must exist for the type check (the test mocks it) |
| L1-T5 | L1-T4, **L2-T4** | `pendingCloseFor` |
| L2-T7 | **L1-T3, L1-T4** | nothing may import `closeSiteEvent` any more; `tools/siteEvents.ts` order |
| L3-T2 | L3-T1, **L2-T1** | `KNOWN_DEEPLINK_SCREENS` has `RoomBoard`; `WIB_MONTH_ABBR` |
| L3-T4 | L3-T3, **L2-T1** | `formatWibShort` |
| L3-T6 | L3-T4, L3-T5, **L2-T4** | `pendingCloseFor`, the `CloseJob` kind |
| L3-T7 | **L1-T2**, L3-T2 | runs after Lane 1's 105 is committed; rehearses both migrations |

Everything else inside a lane runs in the lane's task order.

**Suggested schedule.** Lane 2's first two tasks are small and unblock the others, so Lane 2 starts with them while Lanes 1 and 3 do their independent tasks:

| Wave | Lane 1 | Lane 2 | Lane 3 |
|---|---|---|---|
| 1 | L1-T1, L1-T2 | L2-T1, L2-T2 | L3-T1, L3-T3, L3-T5 |
| 2 | L1-T3 | L2-T3, L2-T4 | L3-T2, L3-T4 |
| 3 | L1-T4, L1-T5 | L2-T5, L2-T6 | L3-T6 |
| 4 | | L2-T7 | L3-T7 |

---

## Lane 1: closure rule

### L1-T1 (Lane 1, Task 1): `closureModel.ts`: the rule and the copy, pure

Spec §3.3. `closureRequirement(type)` restates 105's rule; `closureBlocker` gives the sentence under a disabled "Tandai selesai"; `closureCopy` holds every label of the §3.3 table so the form stays thin and the words are tested. Notes are counted in code points (`Array.from(sent).length`), like Postgres `char_length`, on the exact string the job will send (`note.trim()`).

**Files:**
- Create: `workflows/screens/siteEvent/closureModel.ts`
- Create: `workflows/__tests__/closureModel.test.ts`

**Owns (no other lane edits these):** `workflows/screens/siteEvent/closureModel.ts`, `workflows/__tests__/closureModel.test.ts`

**Depends on:** Nothing.

- [ ] **Step 1: Write the failing test**

Create `workflows/__tests__/closureModel.test.ts` with exactly this content:

```ts
/**
 * The "Selesai" form restates migration 105's rule so it can say what is
 * missing before the round trip (closure spec 2026-09-26 §3). The database
 * still decides; these pin that the form asks for the same thing, counted the
 * same way Postgres counts it.
 */
import {
  CLOSE_QUEUED_TOAST,
  CLOSURE_NOTE_MAX,
  CLOSURE_NOTE_MIN,
  WEB_CLOSE_QUEUED_TOAST,
  closureBlocker,
  closureCopy,
  closureRequirement,
  noteLength,
} from '../screens/siteEvent/closureModel';
import type { SiteEventType } from '../../tools/types';

describe('closureRequirement', () => {
  it.each<[SiteEventType, 'wajib' | 'opsional', 'wajib' | 'opsional']>([
    ['cacat', 'wajib', 'opsional'],
    ['isu', 'wajib', 'opsional'],
    ['hambatan', 'wajib', 'opsional'],
    ['butuh_keputusan', 'opsional', 'wajib'],
    ['progres', 'opsional', 'opsional'],
    ['info', 'opsional', 'opsional'],
  ])('%s: photo %s, note %s', (type, photo, note) => {
    expect(closureRequirement(type)).toEqual({ photo, note });
  });

  it('asks nothing of an event with no type, as 105 does', () => {
    expect(closureRequirement(null)).toEqual({ photo: 'opsional', note: 'opsional' });
  });
});

describe('noteLength counts code points, like Postgres char_length', () => {
  it('counts an emoji once, not twice', () => {
    expect('🙂'.length).toBe(2);
    expect(noteLength('🙂')).toBe(1);
    expect(noteLength('Cat ulang 🙂')).toBe(11);
  });

  it('agrees with the bounds 105 uses', () => {
    expect(CLOSURE_NOTE_MIN).toBe(10);
    expect(CLOSURE_NOTE_MAX).toBe(500);
  });
});

describe('closureBlocker', () => {
  it('holds a cacat, isu or hambatan back until a photo is picked', () => {
    for (const type of ['cacat', 'isu', 'hambatan'] as const) {
      expect(closureBlocker({ type, hasPhoto: false, sentNote: 'Sudah ditambal rapi' })).toBe('Ambil foto penutupan dulu.');
      expect(closureBlocker({ type, hasPhoto: true, sentNote: '' })).toBeNull();
    }
  });

  it('holds a butuh_keputusan back until the sent note has ten code points', () => {
    const blocked = 'Tulis catatan keputusan, minimal 10 karakter.';
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: true, sentNote: '' })).toBe(blocked);
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Sembilan.' })).toBe(blocked);
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Ganti cat!' })).toBeNull();
    // Nine visible characters plus an emoji is ten code points, as the server counts it.
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Cat ulang🙂' })).toBeNull();
    expect(closureBlocker({ type: 'butuh_keputusan', hasPhoto: false, sentNote: 'Cat ulan🙂' })).toBe(blocked);
  });

  it('never holds a progres or info back', () => {
    expect(closureBlocker({ type: 'progres', hasPhoto: false, sentNote: '' })).toBeNull();
    expect(closureBlocker({ type: 'info', hasPhoto: false, sentNote: '' })).toBeNull();
  });
});

describe('closureCopy', () => {
  it('labels the photo Wajib, with the on-site helper, for the three photo types', () => {
    for (const type of ['cacat', 'isu', 'hambatan'] as const) {
      const copy = closureCopy(type);
      expect(copy.photoBadge).toBe('Wajib');
      expect(copy.photoHelper).toBe('Wajib. Foto hasil perbaikan, diambil di lokasi yang sama.');
      expect(copy.noteLabel).toBe('Catatan penutupan');
      expect(copy.noteBadge).toBe('Opsional');
      expect(copy.noteHint).toBeNull();
      expect(copy.counter(3)).toBe('3/500');
    }
  });

  it('asks for a decision note on butuh_keputusan, with the minimum in the counter', () => {
    const copy = closureCopy('butuh_keputusan');
    expect(copy.photoBadge).toBe('Opsional');
    expect(copy.photoHelper).toBe('Opsional. Bukti bahwa masalahnya sudah beres.');
    expect(copy.noteLabel).toBe('Catatan keputusan');
    expect(copy.noteBadge).toBe('Wajib');
    expect(copy.noteHint).toBe('Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?');
    expect(copy.counter(4)).toBe('4/500 · minimal 10');
  });

  it("keeps today's optional wording for progres and info", () => {
    for (const type of ['progres', 'info'] as const) {
      const copy = closureCopy(type);
      expect(copy.photoBadge).toBe('Opsional');
      expect(copy.noteLabel).toBe('Catatan penutupan');
      expect(copy.notePlaceholder).toBe('Opsional. Apa yang dikerjakan?');
    }
  });
});

describe('toasts never claim Selesai', () => {
  it('says the close is queued, and that the status follows the server', () => {
    expect(CLOSE_QUEUED_TOAST).toBe('Penutupan masuk antrean. Status menjadi Selesai setelah server menerimanya.');
    expect(WEB_CLOSE_QUEUED_TOAST).toBe('Dikirim dari tab ini. Jangan tutup halaman sampai status berubah menjadi Selesai.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest workflows/__tests__/closureModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2307: Cannot find module '../screens/siteEvent/closureModel' or its corresponding type declarations.`

- [ ] **Step 3: Implement**

Create `workflows/screens/siteEvent/closureModel.ts` with exactly this content:

```ts
// SANO - "Selesai" rules (pure). Closure spec 2026-09-26 §3.1 and §3.3.
//
// Migration 105's close_site_event is the rule; this file restates it so the
// form can say what is missing before the round trip, and says it in the same
// words. The database still refuses whatever this file lets through.

import type { SiteEventType } from '../../../tools/types';

export type Requirement = 'wajib' | 'opsional';

export interface ClosureRequirement {
  photo: Requirement;
  note: Requirement;
}

/** 105: a butuh_keputusan note must be at least this long after trimming. */
export const CLOSURE_NOTE_MIN = 10;
/** 097/105: SITE_EVENT_CLOSURE_NOTE above this. */
export const CLOSURE_NOTE_MAX = 500;

/** 105's photo branch names exactly these three types. */
const PHOTO_REQUIRED_TYPES: ReadonlyArray<SiteEventType> = ['cacat', 'isu', 'hambatan'];

export function closureRequirement(type: SiteEventType | null): ClosureRequirement {
  return {
    photo: type !== null && PHOTO_REQUIRED_TYPES.includes(type) ? 'wajib' : 'opsional',
    note: type === 'butuh_keputusan' ? 'wajib' : 'opsional',
  };
}

/**
 * Code points, like Postgres char_length - not UTF-16 units, which count an
 * emoji twice. Callers pass the SENT note (`note.trim()`): JavaScript's trim
 * strips a superset of 105's E' \t\r\n', so the server's trim is a no-op on
 * it and both sides count the same string.
 */
export function noteLength(sent: string): number {
  return Array.from(sent).length;
}

/** The sentence under a disabled "Tandai selesai", or null when the button may be pressed. */
export function closureBlocker(input: { type: SiteEventType | null; hasPhoto: boolean; sentNote: string }): string | null {
  const req = closureRequirement(input.type);
  if (req.photo === 'wajib' && !input.hasPhoto) return 'Ambil foto penutupan dulu.';
  if (req.note === 'wajib' && noteLength(input.sentNote) < CLOSURE_NOTE_MIN) {
    return 'Tulis catatan keputusan, minimal 10 karakter.';
  }
  return null;
}

export interface ClosureCopy {
  photoBadge: string;
  photoHelper: string;
  noteLabel: string;
  noteBadge: string;
  notePlaceholder: string;
  /** Shown under the note field only when the note is required. */
  noteHint: string | null;
  counter: (sentLength: number) => string;
}

/** Every label spec §3.3's table names, per type. */
export function closureCopy(type: SiteEventType | null): ClosureCopy {
  const req = closureRequirement(type);
  const decision = req.note === 'wajib';
  return {
    photoBadge: req.photo === 'wajib' ? 'Wajib' : 'Opsional',
    photoHelper: req.photo === 'wajib'
      ? 'Wajib. Foto hasil perbaikan, diambil di lokasi yang sama.'
      : 'Opsional. Bukti bahwa masalahnya sudah beres.',
    noteLabel: decision ? 'Catatan keputusan' : 'Catatan penutupan',
    noteBadge: decision ? 'Wajib' : 'Opsional',
    notePlaceholder: decision ? 'Apa keputusannya dan siapa yang memutuskan?' : 'Opsional. Apa yang dikerjakan?',
    noteHint: decision ? 'Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?' : null,
    counter: (n) => (decision ? `${n}/${CLOSURE_NOTE_MAX} · minimal ${CLOSURE_NOTE_MIN}` : `${n}/${CLOSURE_NOTE_MAX}`),
  };
}

/** Native: the close is on the phone and in the queue; the status changes only when the server says so. */
export const CLOSE_QUEUED_TOAST = 'Penutupan masuk antrean. Status menjadi Selesai setelah server menerimanya.';

/** Web: the queue is memory only (captureQueueStore.ts), so nothing survives a closed tab. */
export const WEB_CLOSE_QUEUED_TOAST = 'Dikirim dari tab ini. Jangan tutup halaman sampai status berubah menjadi Selesai.';
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest workflows/__tests__/closureModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T1.txt` with the Write tool (never a heredoc), exactly:

```text
feat(site-events): the closure rule and its copy, pure

What "Selesai" asks for by type, the sentence under a disabled button,
and every label of the form, counted in code points like Postgres
char_length. Closure spec 2026-09-26 §3.3.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add workflows/screens/siteEvent/closureModel.ts workflows/__tests__/closureModel.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T1.txt -- workflows/screens/siteEvent/closureModel.ts workflows/__tests__/closureModel.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `workflows/screens/siteEvent/closureModel.ts`, `workflows/__tests__/closureModel.test.ts`.


### L1-T2 (Lane 1, Task 2): Migration 105: `close_site_event` asks for proof, checked against `storage.objects`

Spec §3.1-§3.2. 097's body (`097_site_events.sql:830-875`) is kept verbatim except the trim (`E' \t\r\n'`, since 097's `btrim` default strips spaces only, 097:843) and the evidence block after `SITE_EVENT_CLOSURE_NOTE`, so a queued close for an already-closed event gets `NOT_OPEN` first. A paste precondition refuses to install a rule its owner could not evaluate. **One deliberate refinement of the spec text:** the ownership branch uses `pg_has_role(current_user, relowner, 'USAGE')` and requires that the table does not `FORCE ROW LEVEL SECURITY`, instead of `'MEMBER'`. RLS exempts an owner through `has_privs_of_role`, which is inherited privilege (`USAGE`); a `NOINHERIT` member passes `MEMBER` and is still filtered, which is exactly the silent refusal the precondition exists to prevent.

**Files:**
- Create: `supabase/migrations/105_close_site_event_evidence.sql`
- Create: `tools/__tests__/migration105.test.ts`

**Owns (no other lane edits these):** `supabase/migrations/105_close_site_event_evidence.sql`, `tools/__tests__/migration105.test.ts`

**Depends on:** Nothing. **Lane 1 Task 3 and Lane 3 Task 7 wait for this commit** (the RPC copy cross-check and the rehearsal read this file).

- [ ] **Step 1: Write the failing static guard**

Style of `migration099.test.ts`: the SQL is read with full-line comments stripped, so a comment can never satisfy a guard.

Create `tools/__tests__/migration105.test.ts` with exactly this content:

```ts
/**
 * Static guard for migration 105 (closure evidence on "Selesai").
 *
 * Like the 099/100/104 suites this touches no database: migrations are pasted
 * into the Supabase Dashboard, so the SQL text IS the artifact under test.
 * Guards read CODE, the file with every full-line comment removed, so the
 * header or the self-check footer can never satisfy a guard the SQL fails.
 * Behaviour as real roles is rehearsed on Postgres by
 * supabase/tests/site_event_closure_rehearsal/run.sh.
 *
 *  • The paste stops unless the owner can read storage.objects past RLS;
 *    otherwise the rule would refuse every closure photo, silently.
 *  • 097's body is kept, refusal order included, so a queued close for an
 *    event someone else closed gets NOT_OPEN, never a photo refusal.
 *  • The photo rule joins storage.objects, so a row without a file is no proof.
 *  • Nothing later redefines close_site_event, which a re-paste of 105 would revert.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '105_close_site_event_evidence.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL); // comments can never satisfy a guard

const SIG = 'close_site_event(UUID, TEXT)';

function fnBody(): string {
  const start = CODE.indexOf('CREATE OR REPLACE FUNCTION close_site_event(');
  if (start < 0) throw new Error('close_site_event is not defined');
  const open = CODE.indexOf('$$', start);
  const close = CODE.indexOf('$$;', open + 2);
  return CODE.slice(start, close + 3);
}

describe('migration 105 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest-design\.md/);
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest\.md/);
  });

  it('names its place in the paste order, after 097, 098, 099 and 100', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 097, 098, 099 and 100\./);
  });

  it('says it is re-paste safe, and that re-pasting 097 reverts 100 and 105', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/Re-pasting 097 alone silently\s+-- reverts both 100 and 105/);
    expect(SQL).toMatch(/re-paste\s+-- 100 and then 105/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(7);
  });
});

describe('migration 105 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid that shows the outcome without reading a notice', () => {
    expect(CODE.trimEnd()).toMatch(/FROM pg_proc\s+WHERE proname = 'close_site_event';$/);
  });
});

describe('migration 105 - the paste precondition', () => {
  const doBlock = (): string => {
    const start = CODE.indexOf('DO $$');
    return CODE.slice(start, CODE.indexOf('END $$;', start) + 'END $$;'.length);
  };

  it('runs before the function is dropped or created', () => {
    const start = CODE.indexOf('DO $$');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(CODE.indexOf('DROP FUNCTION IF EXISTS close_site_event'));
  });

  it('checks the SELECT privilege and RLS bypass or ownership, each with its own message', () => {
    const block = doBlock();
    expect(block).toContain("has_table_privilege(current_user, 'storage.objects', 'SELECT')");
    expect(block).toMatch(/r\.rolsuper, r\.rolbypassrls/);
    expect(block).toContain("pg_has_role(current_user, v_owner, 'USAGE')");
    expect(block).toContain('relforcerowsecurity');
    expect(block).toContain("RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak punya hak SELECT pada storage.objects', current_user;");
    expect(block).toContain("RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak bisa membaca storage.objects melewati RLS', current_user;");
  });

  it('never uses a SITE_EVENT_ code, so no app copy is ever expected for it', () => {
    expect(doBlock()).not.toMatch(/SITE_EVENT_/);
  });
});

describe('migration 105 - a second paste cannot fail', () => {
  it('drops the exact signature before creating, and grants after', () => {
    const drop = CODE.indexOf(`DROP FUNCTION IF EXISTS ${SIG};`);
    const create = CODE.indexOf('CREATE OR REPLACE FUNCTION close_site_event(');
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated, service_role;`);
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(revoke).toBeGreaterThan(create);
    expect(grant).toBeGreaterThan(revoke);
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).toHaveLength(1);
  });

  it('runs no DDL on any table, view, policy, trigger, index or type', () => {
    expect(CODE).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|POLICY|TRIGGER|INDEX|TYPE)\b/i);
  });
});

describe('migration 105 - close_site_event', () => {
  it('keeps the signature, SECURITY DEFINER and a pinned search_path', () => {
    expect(fnBody()).toMatch(/close_site_event\(\s*p_event_id\s+UUID,\s*p_closure_note\s+TEXT\s*\)\s*RETURNS JSONB/);
    expect(fnBody()).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });

  it('trims tabs and line breaks from the note, not only spaces', () => {
    expect(fnBody()).toContain("v_note TEXT := NULLIF(btrim(COALESCE(p_closure_note, ''), E' \\t\\r\\n'), '');");
  });

  it("keeps 097's lock and its four-column SET list", () => {
    expect(fnBody()).toContain('SELECT * INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;');
    expect(fnBody()).toMatch(/SET status = 'done', closed_at = now\(\), closed_by = v_uid, closure_note = v_note\s+WHERE id = p_event_id;/);
    expect(fnBody()).toContain("RETURN jsonb_build_object('event_id', p_event_id, 'status', 'done', 'closed_at', now());");
  });

  it('refuses in order: not found, auth twice, not open, note length, then the two evidence rules', () => {
    const codes = [...fnBody().matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    expect(codes).toEqual([
      'SITE_EVENT_NOT_FOUND',
      'SITE_EVENT_AUTH',
      'SITE_EVENT_AUTH',
      'SITE_EVENT_NOT_OPEN',
      'SITE_EVENT_CLOSURE_NOTE',
      'SITE_EVENT_CLOSURE_PHOTO_REQUIRED',
      'SITE_EVENT_CLOSURE_NOTE_REQUIRED',
    ]);
  });

  it('refuses a session with no auth.uid() unless it is the service role', () => {
    expect(fnBody()).toMatch(/IF v_uid IS NULL AND COALESCE\(auth\.role\(\), ''\) <> 'service_role' THEN/);
  });

  it('asks for a closure photo on exactly cacat, isu and hambatan, and only one whose file exists', () => {
    const body = fnBody();
    expect(body).toContain("IF v_ev.event_type IN ('cacat', 'isu', 'hambatan') AND NOT EXISTS (");
    expect(body).toContain("JOIN storage.objects o ON o.bucket_id = 'site-media' AND o.name = m.storage_path");
    expect(body).toContain("WHERE m.event_id = p_event_id AND m.role = 'closure' AND m.kind = 'photo'");
  });

  it('asks a butuh_keputusan for ten characters of trimmed note', () => {
    expect(fnBody()).toContain("IF v_ev.event_type = 'butuh_keputusan' AND (v_note IS NULL OR char_length(v_note) < 10) THEN");
  });

  it('writes full Indonesian sentences an older app can show as they are', () => {
    expect(fnBody()).toContain(
      "'SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian % hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.'",
    );
    expect(fnBody()).toContain(
      "'SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.'",
    );
  });
});

describe('migration 105 - nothing later reverts it', () => {
  it('no migration above 105 redefines close_site_event', () => {
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 105);
    const touching = later.filter((f) =>
      /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?close_site_event\b/i.test(stripComments(read(f))),
    );
    expect(touching).toEqual([]);
  });

  it('names the signature this suite pins, so a changed one is a deliberate edit', () => {
    expect(SIG).toBe('close_site_event(UUID, TEXT)');
    expect(CODE).toContain(SIG);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/migration105.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `ENOENT: no such file or directory, open '.../supabase/migrations/105_close_site_event_evidence.sql'`.

- [ ] **Step 3: Write the migration**

Plain UTF-8 throughout; no `\u` escapes anywhere.

Create `supabase/migrations/105_close_site_event_evidence.sql` with exactly this content:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 105 - "Selesai" asks for proof by event type, and the database checks it.
--
-- Spec: docs/superpowers/specs/2026-09-26-closure-evidence-and-digest-design.md §3
-- Plan: docs/superpowers/plans/2026-09-26-closure-evidence-and-digest.md (Lane 1, Task 2)
--
-- WHY. Release 1's close_site_event (097) closes any open event without looking
-- at media; the form called the photo "Opsional". A repair marked done with no
-- picture of the repair is a claim nobody can check. This file re-creates
-- close_site_event with one new rule, by type:
--   * cacat, isu, hambatan: at least one site_event_media row for the event with
--     role 'closure' and kind 'photo' WHOSE FILE EXISTS in storage.objects
--     (bucket 'site-media', name = storage_path). Any member's photo counts:
--     the photo is proof about the event, not about the person who taps Selesai.
--   * butuh_keputusan: a closure note of at least 10 characters after trimming.
--   * progres, info: nothing, as before.
-- Everything else is 097's body verbatim, except that the note is now trimmed
-- of tabs and line breaks as well as spaces (097's btrim default stripped
-- spaces only, so ten newlines passed as a note).
--
-- WHY THE FILE, NOT ONLY THE ROW. site_event_media_insert lets any member
-- insert a row and the path guard checks only the folder prefix, so a row
-- pointing at a file that was never uploaded would otherwise count as proof.
--
-- WHY FULL INDONESIAN SENTENCES IN THE REFUSALS. A phone still on an older
-- bundle has no copy for the two new codes, so tools/siteEvents.ts shows
-- "Gagal menyimpan: " plus the raw text. The raw text therefore has to read
-- as a sentence a supervisor can act on.
--
-- PASTE ORDER. After 097, 098, 099 and 100. It reads site_events and
-- site_event_media (097) and storage.objects.
--
-- PASTE PRECONDITION. The check runs as this function's owner, the role that
-- pastes this file (the Dashboard's postgres), against storage.objects, which
-- supabase_storage_admin owns with RLS on. If that role could not read the
-- table past RLS, the rule would refuse EVERY closure photo, silently. The DO
-- block below therefore stops the paste unless the pasting role (a) has
-- SELECT on storage.objects and (b) is a superuser, has BYPASSRLS, or holds
-- the privileges of the table's owner (and the table does not FORCE row
-- security). The message names which check failed. Its prefix is
-- MIGRATION_105_PRECONDITION, not SITE_EVENT_, so no app copy is ever
-- expected for it.
--
-- RE-PASTE SAFETY. One DO block that writes nothing, one DROP FUNCTION IF
-- EXISTS by exact signature, one CREATE OR REPLACE, one REVOKE, one GRANT, and
-- no DDL on any table, view, policy or trigger: a second paste is a no-op.
-- SET/RESET lock_timeout bracket every statement.
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. 097 still carries its own
-- close_site_event (and confirm_site_event). Re-pasting 097 alone silently
-- reverts both 100 and 105: the functions keep working, without the VO
-- re-check and without the evidence rule. After any re-paste of 097, re-paste
-- 100 and then 105. tools/__tests__/migration105.test.ts fails if a migration
-- numbered above 105 redefines close_site_event.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Paste precondition: the owner can see storage.objects past RLS
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_owner OID;
  v_force BOOLEAN;
  v_super BOOLEAN;
  v_bypass BOOLEAN;
BEGIN
  SELECT c.relowner, c.relforcerowsecurity INTO v_owner, v_force
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak menemukan tabel storage.objects', current_user;
  END IF;

  IF NOT has_table_privilege(current_user, 'storage.objects', 'SELECT') THEN
    RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak punya hak SELECT pada storage.objects', current_user;
  END IF;

  SELECT r.rolsuper, r.rolbypassrls INTO v_super, v_bypass FROM pg_roles r WHERE r.rolname = current_user;
  -- USAGE, not MEMBER: RLS exempts the owner through has_privs_of_role, which
  -- is inherited privilege. A NOINHERIT membership would pass MEMBER and
  -- still be filtered by the policies.
  IF NOT (v_super OR v_bypass OR (pg_has_role(current_user, v_owner, 'USAGE') AND NOT v_force)) THEN
    RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak bisa membaca storage.objects melewati RLS', current_user;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. close_site_event - 097's body plus the trim and the evidence rule
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS close_site_event(UUID, TEXT);

CREATE OR REPLACE FUNCTION close_site_event(
  p_event_id     UUID,
  p_closure_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_ev   site_events%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_closure_note, ''), E' \t\r\n'), '');
BEGIN
  SELECT * INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_FOUND: kejadian % tidak ditemukan', p_event_id;
  END IF;

  IF v_uid IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: sesi tidak dikenali'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_uid IS NOT NULL AND NOT (is_project_member(v_ev.project_id) OR is_office_role()) THEN
    RAISE EXCEPTION 'SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- NOT_OPEN before any evidence refusal: a queued close for an event someone
  -- else already closed must learn that, not be told to take a photo it
  -- cannot act on (closure spec §4.4).
  IF v_ev.status <> 'open' THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang %)', v_ev.status;
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_NOTE: catatan penutupan maksimal 500 karakter';
  END IF;

  IF v_ev.event_type IN ('cacat', 'isu', 'hambatan') AND NOT EXISTS (
    SELECT 1 FROM site_event_media m
    JOIN storage.objects o ON o.bucket_id = 'site-media' AND o.name = m.storage_path
    WHERE m.event_id = p_event_id AND m.role = 'closure' AND m.kind = 'photo'
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian % hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.', v_ev.event_type;
  END IF;
  IF v_ev.event_type = 'butuh_keputusan' AND (v_note IS NULL OR char_length(v_note) < 10) THEN
    RAISE EXCEPTION 'SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.';
  END IF;

  UPDATE site_events
  SET status = 'done', closed_at = now(), closed_by = v_uid, closure_note = v_note
  WHERE id = p_event_id;

  RETURN jsonb_build_object('event_id', p_event_id, 'status', 'done', 'closed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION close_site_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_site_event(UUID, TEXT) TO authenticated, service_role;

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

SELECT proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname = 'close_site_event';

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; every check below writes nothing, or rolls
-- back what it wrote)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: one row, prosecdef = true, proconfig = {search_path=public},
--    anon_exec = false.
--
-- 2. The rule is in the live function:
--      SELECT prosrc LIKE '%SITE_EVENT_CLOSURE_PHOTO_REQUIRED%' AS photo_rule,
--             prosrc LIKE '%SITE_EVENT_CLOSURE_NOTE_REQUIRED%' AS note_rule
--      FROM pg_proc WHERE proname = 'close_site_event';
--    EXPECTED: one row, both true. Both false means 097 was re-pasted after
--    this file: re-paste 100, then 105.
--
-- 3. The owner can read storage.objects (the precondition, run by hand):
--      SELECT has_table_privilege(current_user, 'storage.objects', 'SELECT') AS can_select,
--             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls;
--    EXPECTED: can_select = true, and bypasses_rls = true or the role holds
--    supabase_storage_admin's privileges.
--
-- 4. A cacat with no closure photo is refused. Every check runs inside a
--    session that HAS an identity - the SQL editor is `postgres` with no JWT,
--    so an un-wrapped call refuses at the first guard with SITE_EVENT_AUTH:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT close_site_event('<AN_OPEN_CACAT_WITHOUT_CLOSURE_PHOTO>', 'selesai');
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_CLOSURE_PHOTO_REQUIRED.
--
-- 5. A butuh_keputusan with a short note is refused:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT close_site_event('<AN_OPEN_BUTUH_KEPUTUSAN>', 'oke');
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_CLOSURE_NOTE_REQUIRED.
--
-- 6. A closed event still answers NOT_OPEN before any evidence refusal:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SELECT set_config('request.jwt.claims',
--               '{"sub":"<A_MEMBER_UUID>","role":"authenticated"}', true);
--        SELECT close_site_event('<A_DONE_CACAT>', NULL);
--      ROLLBACK;
--    EXPECTED: ERROR starting SITE_EVENT_NOT_OPEN.
--
-- 7. Re-paste this whole file.
--    EXPECTED: no error, and checks 1 and 2 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 4: Run the guard and the neighbouring migration suites**

Run:

```bash
npx jest tools/__tests__/migration105.test.ts tools/__tests__/migration097.test.ts tools/__tests__/migration099.test.ts tools/__tests__/migration100.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, all four suites.

- [ ] **Step 5: Scan the new file for invisible characters**

Run:

```bash
perl -CSD -ne 'print qq($.: $_) if /[\x{200B}-\x{200F}\x{2028}\x{2029}\x{FEFF}\x{00A0}]/' supabase/migrations/105_close_site_event_evidence.sql
```

Expected: no output.

- [ ] **Step 6: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 7: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T2.txt` with the Write tool (never a heredoc), exactly:

```text
feat(db): 105 close_site_event asks for proof by type

cacat, isu and hambatan need a closure photo whose file exists in
storage.objects; butuh_keputusan needs a ten-character decision note;
the note is trimmed of tabs and line breaks. A paste precondition stops
the paste unless the owner can read storage.objects past RLS.
Closure spec 2026-09-26 §3.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add supabase/migrations/105_close_site_event_evidence.sql tools/__tests__/migration105.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T2.txt -- supabase/migrations/105_close_site_event_evidence.sql tools/__tests__/migration105.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `supabase/migrations/105_close_site_event_evidence.sql`, `tools/__tests__/migration105.test.ts`.


### L1-T3 (Lane 1, Task 3): App copy for the two new refusals, and the cross-check reads 105

Spec §3.3 and §8.3. `mapSiteEventRpcError` matches `CODE:` exactly (`tools/siteEvents.ts:161-168`), so `SITE_EVENT_CLOSURE_NOTE_REQUIRED` never collides with `SITE_EVENT_CLOSURE_NOTE`. The cross-check "RPC_ERROR_COPY vs migrations 097, 099 and 100" (`siteEvents.test.ts:682`) also reads 105, still with exact set equality; 106 is deliberately not read, since no client calls its function. This task also deletes the old `closeSiteEvent` tests (`siteEvents.test.ts:367-385`) and its import (line 37): the function's replacements are tested in `siteEventsClose.test.ts` (Lane 2 Task 2), and Lane 2 Task 7 deletes the function once this commit is in.

**Files:**
- Modify: `tools/siteEvents.ts`: the `RPC_ERROR_COPY` array only (lines 131-159). Touch no other line; the rest of the file belongs to Lane 2.
- Test: `tools/__tests__/siteEvents.test.ts`: import (line 37), the `closeSiteEvent` describe (lines 367-385), the mapper test (line 206), the cross-check (lines 682-706)

**Owns (no other lane edits these):** `tools/siteEvents.ts` (lines 131-159 only), `tools/__tests__/siteEvents.test.ts`

**Depends on:** Lane 1 Task 2 (the cross-check reads 105) and **Lane 2 Task 2 committed** (Lane 2 edits `tools/siteEvents.ts` first). Check: `git log --oneline -1 -- tools/siteEvents.ts` shows Lane 2 Task 2's commit, and `git status --porcelain tools/siteEvents.ts` prints nothing before you start.

- [ ] **Step 1: Write the failing tests**

In `tools/__tests__/siteEvents.test.ts`, find this block (it occurs exactly once):

```ts
  buildMediaRows,
  closeSiteEvent,
  confirmSiteEvent,
```

and replace it with:

```ts
  buildMediaRows,
  confirmSiteEvent,
```

In `tools/__tests__/siteEvents.test.ts`, delete this block (it occurs exactly once), including the blank line after it:

```ts
describe('closeSiteEvent', () => {
  it('maps SITE_EVENT_NOT_OPEN to its Indonesian copy', async () => {
    mocked.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang done)' },
    });
    const r = await closeSiteEvent({ eventId: EVENT, projectId: PROJECT, note: 'selesai' });
    expect(r.error).toBe('Hanya kejadian terbuka yang bisa ditandai selesai.');
  });

  it('returns ok, trimming the closure note, on success', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { event_id: EVENT, status: 'done' }, error: null });
    const r = await closeSiteEvent({ eventId: EVENT, projectId: PROJECT, note: '  selesai dikerjakan  ' });
    expect(r.error).toBeUndefined();
    expect(mocked.rpc).toHaveBeenCalledWith('close_site_event', { p_event_id: EVENT, p_closure_note: 'selesai dikerjakan' });
  });
});
```

In `tools/__tests__/siteEvents.test.ts`, find this block (it occurs exactly once):

```ts
    expect(mapSiteEventRpcError('network down')).toBe('Gagal menyimpan: network down');
```

and replace it with:

```ts
    // Migration 105: the two evidence codes, beside 097's SITE_EVENT_CLOSURE_NOTE they must not collide with.
    expect(mapSiteEventRpcError('SITE_EVENT_CLOSURE_NOTE: catatan penutupan maksimal 500 karakter')).toBe('Catatan penutupan maksimal 500 karakter.');
    expect(mapSiteEventRpcError('SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.'))
      .toBe('Catatan keputusan wajib diisi, minimal 10 karakter.');
    expect(mapSiteEventRpcError('SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian cacat hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.'))
      .toBe('Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.');
    expect(mapSiteEventRpcError('network down')).toBe('Gagal menyimpan: network down');
```

In `tools/__tests__/siteEvents.test.ts`, find this block (it occurs exactly once):

```ts
describe('RPC_ERROR_COPY vs migrations 097, 099 and 100', () => {
  it('covers exactly the SITE_EVENT_* codes 097, 099 and 100 actually raise — no more, no less', () => {
```

and replace it with:

```ts
describe('RPC_ERROR_COPY vs migrations 097, 099, 100 and 105', () => {
  it('covers exactly the SITE_EVENT_* codes 097, 099, 100 and 105 actually raise — no more, no less', () => {
```

In `tools/__tests__/siteEvents.test.ts`, find this block (it occurs exactly once):

```ts
    const raised = new Set([
      ...codesIn('097_site_events.sql'),
      ...codesIn('099_site_event_assignment.sql'),
      ...codesIn('100_confirm_vo_evidence_recheck.sql'),
    ]);
```

and replace it with:

```ts
    // 105 re-creates close_site_event with two evidence refusals. 106 is
    // deliberately not read: its only function has no grant to any app role,
    // so no client ever sees a refusal from it.
    const raised = new Set([
      ...codesIn('097_site_events.sql'),
      ...codesIn('099_site_event_assignment.sql'),
      ...codesIn('100_confirm_vo_evidence_recheck.sql'),
      ...codesIn('105_close_site_event_evidence.sql'),
    ]);
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/siteEvents.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL: `covers exactly the SITE_EVENT_* codes 097, 099, 100 and 105 actually raise` (the expected set has `SITE_EVENT_CLOSURE_PHOTO_REQUIRED` and `SITE_EVENT_CLOSURE_NOTE_REQUIRED`, the copy does not), and the mapper test (received `Gagal menyimpan: SITE_EVENT_CLOSURE_NOTE_REQUIRED: ...`).

- [ ] **Step 3: Add the copy**

In `tools/siteEvents.ts`, find this block (it occurs exactly once):

```ts
  ['SITE_EVENT_ASSIGN_NOT_OPEN', 'Hanya kejadian terbuka yang bisa diubah pemilik atau tenggatnya.'],
];
```

and replace it with:

```ts
  ['SITE_EVENT_ASSIGN_NOT_OPEN', 'Hanya kejadian terbuka yang bisa diubah pemilik atau tenggatnya.'],
  // Migration 105 (closure spec 2026-09-26 §3): close_site_event asks for
  // proof by type. Matched on `CODE:` exactly, so SITE_EVENT_CLOSURE_NOTE_REQUIRED
  // never collides with SITE_EVENT_CLOSURE_NOTE above.
  ['SITE_EVENT_CLOSURE_PHOTO_REQUIRED', 'Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.'],
  ['SITE_EVENT_CLOSURE_NOTE_REQUIRED', 'Catatan keputusan wajib diisi, minimal 10 karakter.'],
];
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest tools/__tests__/siteEvents.test.ts tools/__tests__/siteEventsClose.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T3.txt` with the Write tool (never a heredoc), exactly:

```text
feat(site-events): copy for the 105 evidence refusals

SITE_EVENT_CLOSURE_PHOTO_REQUIRED and SITE_EVENT_CLOSURE_NOTE_REQUIRED
get Indonesian sentences; the RPC copy cross-check now also reads 105.
The old closeSiteEvent tests go (its replacements are tested in
siteEventsClose.test.ts). Closure spec 2026-09-26 §3.3, §8.3.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/siteEvents.ts tools/__tests__/siteEvents.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T3.txt -- tools/siteEvents.ts tools/__tests__/siteEvents.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/siteEvents.ts`, `tools/__tests__/siteEvents.test.ts`.


### L1-T4 (Lane 1, Task 4): `ClosureForm`: Wajib and Opsional by type, and a submit that only queues

Spec §3.3 and §4.1. The form gains `userId`, `roomId`, `eventTitle` and `eventType` props (the spec names the last three; `userId` is added so the form needs no `useProject` of its own and the close job belongs to the signed-in profile). `onClosed` becomes `onQueued`: it fires when the close is safely in the queue, not when the server closed anything. Submit calls `enqueueCloseJob` (signature in *Shared interfaces*), `triggerDrain()` and `onQueued()`, and never the RPC. The detail screen's one `<ClosureForm>` mount is updated in the same commit so the project keeps compiling; the rest of the detail screen is Task 5.

**Files:**
- Modify (replace whole file): `workflows/screens/siteEvent/ClosureForm.tsx`
- Create: `workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx`
- Modify: `workflows/screens/SiteEventDetailScreen.tsx`: one import (after line 7), one line after `params` (line 45), the `<ClosureForm>` mount (lines 245-257)

**Owns (no other lane edits these):** `workflows/screens/siteEvent/ClosureForm.tsx`, `workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx`, `workflows/screens/SiteEventDetailScreen.tsx`

**Depends on:** Lane 1 Task 1, and **Lane 2 Task 4 committed** (`enqueueCloseJob` must exist for the type check, even though the test mocks it).

- [ ] **Step 1: Write the failing test**

`Platform` from `react-native` can be `undefined` under this jest setup, so the form reads `Platform?.OS`. `PhotoGalleryField`, `pickPhoto`, the store and the worker are mocked; `closeSiteEventRpc` is mocked only to prove it is never called.

Create `workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx` with exactly this content:

```tsx
// workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx
//
// Closure spec 2026-09-26 §3.3 and §4: the form asks for proof by type, keeps
// "Tandai selesai" disabled until it has it, and on submit only QUEUES the
// close - it never calls the RPC and never says "Selesai" itself.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockToast = jest.fn();
jest.mock('../../../components/Toast', () => ({ useToast: () => ({ show: mockToast }) }));
jest.mock('../../../components/PhotoGalleryField', () => {
  const ReactLocal = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { photoPaths: string[]; helperText?: string; onAdd: () => void }) =>
      ReactLocal.createElement(
        View,
        null,
        ReactLocal.createElement(TouchableOpacity, { onPress: props.onAdd, accessibilityLabel: 'Ambil foto' }, ReactLocal.createElement(Text, null, 'Ambil foto')),
        ReactLocal.createElement(Text, null, props.helperText ?? ''),
        ReactLocal.createElement(Text, null, `${props.photoPaths.length} foto dipilih`),
      ),
  };
});
jest.mock('../../../../tools/storage', () => ({ pickPhoto: jest.fn() }));
jest.mock('../../../../tools/siteEvents', () => ({
  newSiteEventId: jest.fn(),
  closeSiteEventRpc: jest.fn(),
}));
jest.mock('../../../../tools/captureQueueStore', () => ({ enqueueCloseJob: jest.fn() }));
jest.mock('../../../../tools/captureQueueWorker', () => ({ triggerDrain: jest.fn() }));

import { pickPhoto } from '../../../../tools/storage';
import { closeSiteEventRpc, newSiteEventId } from '../../../../tools/siteEvents';
import { enqueueCloseJob } from '../../../../tools/captureQueueStore';
import { triggerDrain } from '../../../../tools/captureQueueWorker';
import type { SiteEventType } from '../../../../tools/types';
import ClosureForm from '../ClosureForm';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const renderForm = (eventType: SiteEventType | null) => {
  const onQueued = jest.fn();
  const onCancel = jest.fn();
  const utils = render(
    <ClosureForm
      userId="u1"
      eventId="ev1"
      projectId="p1"
      roomId="r1"
      eventTitle="Retak acian"
      eventType={eventType}
      onQueued={onQueued}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onQueued, onCancel };
};

const submitButton = (utils: ReturnType<typeof render>) => utils.getByRole('button', { name: /Tandai selesai/ });

let ids = 0;
beforeEach(() => {
  jest.clearAllMocks();
  ids = 0;
  (newSiteEventId as jest.Mock).mockImplementation(() => `id-${++ids}`);
  (pickPhoto as jest.Mock).mockResolvedValue({
    uri: 'file:///cache/closure.jpg', contentType: 'image/jpeg', ext: 'jpg', capturedAt: '2026-09-17T02:00:00.000Z',
  });
  (enqueueCloseJob as jest.Mock).mockResolvedValue({ entry: { id: 'id-2' } });
});

describe('Wajib and Opsional, per type', () => {
  it.each<[SiteEventType, string, string, string]>([
    ['cacat', 'Wajib', 'Catatan penutupan', 'Opsional'],
    ['isu', 'Wajib', 'Catatan penutupan', 'Opsional'],
    ['hambatan', 'Wajib', 'Catatan penutupan', 'Opsional'],
    ['butuh_keputusan', 'Opsional', 'Catatan keputusan', 'Wajib'],
    ['progres', 'Opsional', 'Catatan penutupan', 'Opsional'],
    ['info', 'Opsional', 'Catatan penutupan', 'Opsional'],
  ])('%s: photo %s, "%s" %s', (type, photoBadge, noteLabel, noteBadge) => {
    const utils = renderForm(type);
    const badges = utils.getAllByText(/^(Wajib|Opsional)$/).map((n) => n.props.children);
    expect(badges).toEqual([photoBadge, noteBadge]);
    expect(utils.getByText(noteLabel)).toBeTruthy();
  });

  it('shows the on-site helper for a required photo', () => {
    expect(renderForm('cacat').getByText('Wajib. Foto hasil perbaikan, diambil di lokasi yang sama.')).toBeTruthy();
  });

  it('shows the decision hint and the minimum in the counter for butuh_keputusan', () => {
    const utils = renderForm('butuh_keputusan');
    expect(utils.getByText('Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?')).toBeTruthy();
    expect(utils.getByText('0/500 · minimal 10')).toBeTruthy();
  });
});

describe('the button waits for the proof', () => {
  it('stays disabled for a cacat until a photo is picked', async () => {
    const utils = renderForm('cacat');
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: true });
    expect(utils.getByText('Ambil foto penutupan dulu.')).toBeTruthy();

    fireEvent.press(utils.getByLabelText('Ambil foto'));
    await waitFor(() => expect(utils.getByText('1 foto dipilih')).toBeTruthy());
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: false });
    expect(utils.queryByText('Ambil foto penutupan dulu.')).toBeNull();
  });

  it('stays disabled for a butuh_keputusan until the trimmed note reaches ten characters', () => {
    const utils = renderForm('butuh_keputusan');
    const field = utils.getByLabelText('Catatan keputusan');
    fireEvent.changeText(field, '   Sembilan.   ');
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: true });
    expect(utils.getByText('Tulis catatan keputusan, minimal 10 karakter.')).toBeTruthy();
    expect(utils.getByText('9/500 · minimal 10')).toBeTruthy();

    fireEvent.changeText(field, '  Ganti cat!  ');
    expect(submitButton(utils).props.accessibilityState).toMatchObject({ disabled: false });
    expect(utils.getByText('10/500 · minimal 10')).toBeTruthy();
  });

  it('is enabled at once for progres and info', () => {
    expect(submitButton(renderForm('progres')).props.accessibilityState).toMatchObject({ disabled: false });
    expect(submitButton(renderForm('info')).props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('submit queues, never closes', () => {
  it('enqueues the trimmed note and the closure photo, drains, toasts the queue sentence, and never calls the RPC', async () => {
    const utils = renderForm('cacat');
    fireEvent.press(utils.getByLabelText('Ambil foto'));
    await waitFor(() => expect(utils.getByText('1 foto dipilih')).toBeTruthy());
    fireEvent.changeText(utils.getByLabelText('Catatan penutupan'), '  Sudah ditambal  ');
    fireEvent.press(submitButton(utils));

    await waitFor(() => expect(utils.onQueued).toHaveBeenCalledTimes(1));
    expect(enqueueCloseJob).toHaveBeenCalledWith({
      userId: 'u1',
      jobId: 'id-2',
      eventId: 'ev1',
      projectId: 'p1',
      roomId: 'r1',
      eventTitle: 'Retak acian',
      note: 'Sudah ditambal',
      closurePhoto: expect.objectContaining({
        id: 'id-1', localUri: 'file:///cache/closure.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg',
      }),
      nowIso: expect.any(String),
    });
    expect(triggerDrain).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Penutupan masuk antrean. Status menjadi Selesai setelah server menerimanya.', 'ok');
    expect(closeSiteEventRpc).not.toHaveBeenCalled();
  });

  it('shows the refusal and stays open when the event already has a pending close', async () => {
    (enqueueCloseJob as jest.Mock).mockResolvedValueOnce({ error: 'Penutupan kejadian ini sudah menunggu kirim.' });
    const utils = renderForm('progres');
    fireEvent.press(submitButton(utils));

    await waitFor(() => expect(utils.getByText('Penutupan kejadian ini sudah menunggu kirim.')).toBeTruthy());
    expect(utils.onQueued).not.toHaveBeenCalled();
    expect(triggerDrain).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('says so when the phone could not store the close', async () => {
    (enqueueCloseJob as jest.Mock).mockRejectedValueOnce(new Error('Penyimpanan HP tidak tersedia; coba lagi.'));
    const utils = renderForm('info');
    fireEvent.press(submitButton(utils));

    await waitFor(() =>
      expect(utils.getByText('Penutupan gagal disimpan di ponsel: Penyimpanan HP tidak tersedia; coba lagi.')).toBeTruthy(),
    );
    expect(utils.onQueued).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2322: Type '{ userId: string; eventId: string; projectId: string; roomId: string; eventTitle: string; eventType: ...` is not assignable (the old form's props).

- [ ] **Step 3: Replace the form**

Replace the whole of `workflows/screens/siteEvent/ClosureForm.tsx` with exactly this content:

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import PhotoGalleryField from '../../components/PhotoGalleryField';
import { useToast } from '../../components/Toast';
import { pickPhoto } from '../../../tools/storage';
import { newSiteEventId, type LocalSiteEventMedia } from '../../../tools/siteEvents';
import { enqueueCloseJob } from '../../../tools/captureQueueStore';
import { triggerDrain } from '../../../tools/captureQueueWorker';
import type { SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';
import { formStyles as s } from './styles';
import {
  CLOSE_QUEUED_TOAST,
  CLOSURE_NOTE_MAX,
  WEB_CLOSE_QUEUED_TOAST,
  closureBlocker,
  closureCopy,
  noteLength,
} from './closureModel';

interface Props {
  /** The signed-in profile; the close job belongs to it (a shared phone must not mix people). */
  userId: string;
  eventId: string;
  projectId: string;
  roomId: string;
  eventTitle: string;
  eventType: SiteEventType | null;
  /** Called once the close is safely in the queue - NOT when the server has closed the event. */
  onQueued: () => void;
  onCancel: () => void;
}

function Badge({ label }: { label: string }) {
  const required = label === 'Wajib';
  return (
    <View style={[styles.badge, required ? styles.badgeRequired : styles.badgeOptional]}>
      <Text style={[styles.badgeText, required ? styles.badgeTextRequired : styles.badgeTextOptional]}>{label}</Text>
    </View>
  );
}

/**
 * "Selesai" (closure spec 2026-09-26 §3.3). Asks for proof by event type,
 * the same rule migration 105 enforces, and never closes anything itself: the
 * submit puts a close job in the capture queue and the status turns "Selesai"
 * only when the server has accepted it (spec §1.1 rule 1).
 */
export default function ClosureForm({ userId, eventId, projectId, roomId, eventTitle, eventType, onQueued, onCancel }: Props) {
  const { show: toast } = useToast();
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<LocalSiteEventMedia | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = closureCopy(eventType);
  // The exact string the job will send, and the one both sides count.
  const sentNote = note.trim();
  const blocker = closureBlocker({ type: eventType, hasPhoto: photo !== null, sentNote });
  const disabled = saving || blocker !== null;

  const take = async () => {
    try {
      const picked = await pickPhoto();
      if (!picked) return;
      setPhoto({
        id: newSiteEventId(),
        localUri: picked.uri,
        kind: 'photo',
        role: 'closure',
        mimeType: picked.contentType,
        ext: picked.ext,
        durationS: null,
        sortOrder: 0,
        capturedAt: picked.capturedAt,
      });
    } catch (err) {
      toast((err as Error).message, 'critical');
    }
  };

  const submit = async () => {
    if (disabled) return;
    setSaving(true);
    setError(null);
    try {
      const result = await enqueueCloseJob({
        userId,
        jobId: newSiteEventId(),
        eventId,
        projectId,
        roomId,
        eventTitle,
        note: sentNote,
        closurePhoto: photo,
        nowIso: new Date().toISOString(),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
    } catch (err) {
      setError(`Penutupan gagal disimpan di ponsel: ${(err as Error).message}`);
      return;
    } finally {
      setSaving(false);
    }
    triggerDrain();
    toast(Platform?.OS === 'web' ? WEB_CLOSE_QUEUED_TOAST : CLOSE_QUEUED_TOAST, 'ok');
    onQueued();
  };

  return (
    <View>
      <View style={styles.labelRow}>
        <Text style={[s.label, styles.labelInRow]}>Foto penutupan</Text>
        <Badge label={copy.photoBadge} />
      </View>
      <PhotoGalleryField
        photoPaths={photo ? [photo.localUri] : []}
        maxPhotos={1}
        emptyLabel="Foto hasil"
        helperText={copy.photoHelper}
        onAdd={() => void take()}
        onReplace={() => void take()}
        onRemove={() => setPhoto(null)}
      />

      <View style={styles.labelRow}>
        <Text style={[s.label, styles.labelInRow]}>{copy.noteLabel}</Text>
        <Badge label={copy.noteBadge} />
      </View>
      {copy.noteHint ? <Text style={s.hint}>{copy.noteHint}</Text> : null}
      <TextInput
        style={[s.input, s.textarea]}
        value={note}
        onChangeText={setNote}
        maxLength={CLOSURE_NOTE_MAX}
        multiline
        editable={!saving}
        placeholder={copy.notePlaceholder}
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel={copy.noteLabel}
      />
      <Text style={s.counter}>{copy.counter(noteLength(sentNote))}</Text>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[s.primaryBtn, disabled && s.primaryBtnDisabled]}
        onPress={() => void submit()}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
      >
        <Text style={s.primaryText}>{saving ? 'Menyimpan…' : 'Tandai selesai'}</Text>
      </TouchableOpacity>
      {blocker && !saving ? <Text style={s.hint}>{blocker}</Text> : null}
      <TouchableOpacity style={s.secondaryBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
        <Text style={s.secondaryText}>Batal</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginTop: SPACE.md, marginBottom: 6 },
  labelInRow: { marginTop: 0, marginBottom: 0 },
  badge: { paddingVertical: 2, paddingHorizontal: SPACE.sm, borderRadius: RADIUS },
  badgeRequired: { backgroundColor: COLORS.criticalBg },
  badgeOptional: { backgroundColor: COLORS.surfaceAlt },
  badgeText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  badgeTextRequired: { color: COLORS.critical },
  badgeTextOptional: { color: COLORS.textSec },
});
```

- [ ] **Step 4: Update the detail screen's mount**

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
import { getSiteEvent, getSiteEventResult, type SiteEventWithMedia } from '../../tools/siteEvents';
```

and replace it with:

```tsx
import { getSiteEvent, getSiteEventResult, type SiteEventWithMedia } from '../../tools/siteEvents';
import { useProject } from '../hooks/useProject';
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
  const params = (route.params ?? {}) as { eventId?: string; projectId?: string };
```

and replace it with:

```tsx
  const params = (route.params ?? {}) as { eventId?: string; projectId?: string };
  const { profile } = useProject();
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
            {actions.canClose && closing ? (
              <Card title="Tandai selesai">
                <ClosureForm
                  eventId={event.id}
                  projectId={event.project_id}
                  onClosed={() => {
                    setClosing(false);
                    void load();
                  }}
                  onCancel={() => setClosing(false)}
                />
              </Card>
            ) : null}
```

and replace it with:

```tsx
            {actions.canClose && closing && profile ? (
              <Card title="Tandai selesai">
                <ClosureForm
                  userId={profile.id}
                  eventId={event.id}
                  projectId={event.project_id}
                  roomId={event.room_id}
                  eventTitle={event.title ?? 'Kejadian lapangan'}
                  eventType={event.event_type}
                  onQueued={() => setClosing(false)}
                  onCancel={() => setClosing(false)}
                />
              </Card>
            ) : null}
```

- [ ] **Step 5: Run it to verify it passes**

Run:

```bash
npx jest workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx workflows/__tests__/closureModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites.

- [ ] **Step 6: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 7: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T4.txt` with the Write tool (never a heredoc), exactly:

```text
feat(site-events): Selesai asks for proof by type and only queues

ClosureForm shows Wajib or Opsional per type, keeps Tandai selesai
disabled until the proof is there, and on submit enqueues a close job and
drains - it never calls the RPC and never claims Selesai. Closure spec
2026-09-26 §3.3, §4.1.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add workflows/screens/siteEvent/ClosureForm.tsx workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx workflows/screens/SiteEventDetailScreen.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T4.txt -- workflows/screens/siteEvent/ClosureForm.tsx workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx workflows/screens/SiteEventDetailScreen.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `workflows/screens/siteEvent/ClosureForm.tsx`, `workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx`, `workflows/screens/SiteEventDetailScreen.tsx`.


### L1-T5 (Lane 1, Task 5): The detail screen: "Menunggu kirim", the closure photo beside the closer

Spec §4.5 (detail row) and §3.3 ("Detail after close"). While `pendingCloseFor(entries, event.id)` returns a job, the status chip keeps the server's label ("Terbuka"), a chip "Menunggu kirim" appears, and "Selesai" is replaced by the waiting sentence, or, when the job needs attention, by "Penutupan belum terkirim: {lastError}" and "Coba lagi" (`retryQueueEntry`). When the job leaves the pending set the screen calls `load()` and shows what the server says. The "Selesai" card (`SiteEventDetailScreen.tsx:213-227`) gains a `MediaStrip` of the closure photos; "Bukti" (`:194-211`) keeps the other roles.

**Files:**
- Modify: `workflows/screens/SiteEventDetailScreen.tsx`: React import (line 1); store and worker imports; the queue read after `profile`; a block after the load effect (line 83); the status chip row (line 142); "Bukti" (line 195); the "Selesai" card (lines 213-227); the two `canClose` conditions (lines 239, 245)
- Create: `workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx`

**Owns (no other lane edits these):** `workflows/screens/SiteEventDetailScreen.tsx`, `workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx`

**Depends on:** Lane 1 Task 4 and **Lane 2 Task 4 committed** (`pendingCloseFor`).

- [ ] **Step 1: Write the failing test**

Create `workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx` with exactly this content:

```tsx
// workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx
//
// Closure spec 2026-09-26 §4.5 and §1.1 rule 1: while a close job for this
// event is still on the phone, the detail screen keeps the SERVER's status
// label ("Terbuka"), adds "Menunggu kirim", and offers no second "Selesai".
// When the job leaves the pending set the screen reads the server again
// instead of guessing what happened there.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    canGoBack: () => true,
    getState: () => ({ routeNames: ['Beranda', 'SiteEventDetail'] }),
  }),
  useRoute: () => ({ params: { eventId: 'ev1', projectId: 'p1' } }),
}));
jest.mock('../../components/Header', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useProject', () => ({ useProject: () => ({ profile: { id: 'u1', role: 'supervisor' } }) }));
jest.mock('../../../tools/siteEvents', () => ({ getSiteEventResult: jest.fn(), getSiteEvent: jest.fn() }));
jest.mock('../../../tools/gateRefs', () => ({
  listGateRefs: jest.fn(async () => []),
  listGateStepRefs: jest.fn(async () => []),
  gateChipLabel: jest.fn(() => ''),
  stepChipLabel: jest.fn(() => ''),
}));
let mockPending: Record<string, unknown> | undefined;
jest.mock('../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => []),
  pendingCloseFor: jest.fn(() => mockPending),
}));
jest.mock('../../../tools/captureQueueWorker', () => ({ retryQueueEntry: jest.fn(async () => undefined) }));
jest.mock('../siteEvent/MediaStrip', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: { media: Array<{ role: string }> }) =>
      ReactLocal.createElement(Text, null, `media: ${props.media.map((m) => m.role).join(',') || 'none'}`),
  };
});
jest.mock('../siteEvent/ClosureForm', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => ReactLocal.createElement(Text, null, 'closure form') };
});

import { getSiteEventResult } from '../../../tools/siteEvents';
import { retryQueueEntry } from '../../../tools/captureQueueWorker';
import SiteEventDetailScreen from '../SiteEventDetailScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const baseEvent = {
  id: 'ev1', project_id: 'p1', room_id: 'r1', reporter_id: 'u1', status: 'open', event_type: 'cacat',
  gate_code: null, step_code: null, title: 'Retak acian', summary: null, raw_text: null, transcript: null,
  transcript_edited: null, ai_draft: null, ai_confidence: null, ai_mismatch: false, ai_model: null, ai_used: false,
  owner_id: 'u1', due_date: '2026-09-20', downstream_impact: null, is_blocking: false, vo_flag: 'none',
  site_change_id: null, related_event_id: null, captured_at: '2026-09-16T02:00:00.000Z', created_at: '2026-09-16T02:00:00.000Z',
  confirmed_at: '2026-09-16T03:00:00.000Z', closed_at: null, closed_by: null, closure_note: null, last_error: null,
  analysis_attempts: 0, room_name: 'Kamar 1', room_floor: 'Lt. 1', owner_name: 'Budi', reporter_name: 'Budi',
  closed_by_name: null,
  media: [
    { id: 'm1', event_id: 'ev1', kind: 'photo', role: 'context', storage_path: 'x', mime_type: null, duration_s: null, bytes: null, sort_order: 0, captured_at: null },
    { id: 'm2', event_id: 'ev1', kind: 'photo', role: 'closure', storage_path: 'y', mime_type: null, duration_s: null, bytes: null, sort_order: 1, captured_at: null },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = undefined;
  (getSiteEventResult as jest.Mock).mockResolvedValue({ event: baseEvent });
});

describe('a close waiting on this phone', () => {
  it('keeps the server label, adds Menunggu kirim, and hides Selesai', async () => {
    mockPending = { id: 'job1', kind: 'close', eventId: 'ev1', state: 'queued', needsAttention: false, lastError: null };
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() => expect(utils.getByText('Terbuka')).toBeTruthy());
    expect(utils.getByText('Menunggu kirim')).toBeTruthy();
    expect(
      utils.getByText('Penutupan tersimpan di ponsel ini dan menunggu kirim. Status tetap Terbuka sampai server menerimanya.'),
    ).toBeTruthy();
    expect(utils.queryByText('Selesai')).toBeNull();
    expect(utils.queryByText('closure form')).toBeNull();
  });

  it('shows why a flagged close has not gone, and retries it on Coba lagi', async () => {
    mockPending = {
      id: 'job1', kind: 'close', eventId: 'ev1', state: 'failed', needsAttention: true,
      lastError: 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
    };
    const utils = render(<SiteEventDetailScreen />);

    await waitFor(() =>
      expect(utils.getByText(
        'Penutupan belum terkirim: Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
      )).toBeTruthy(),
    );
    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(retryQueueEntry).toHaveBeenCalledWith('u1', 'job1'));
    expect(utils.getByText('Terbuka')).toBeTruthy();
  });

  it('reads the server again once the job leaves the pending set', async () => {
    mockPending = { id: 'job1', kind: 'close', eventId: 'ev1', state: 'closing', needsAttention: false, lastError: null };
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Menunggu kirim')).toBeTruthy());
    expect(getSiteEventResult).toHaveBeenCalledTimes(1);

    (getSiteEventResult as jest.Mock).mockResolvedValue({
      event: { ...baseEvent, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u2', closed_by_name: 'Sari' },
    });
    mockPending = undefined;
    utils.rerender(<SiteEventDetailScreen />);

    await waitFor(() => expect(getSiteEventResult).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(utils.getByText('Ditutup oleh')).toBeTruthy());
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
  });
});

describe('with nothing queued', () => {
  it('offers Selesai on an open event, and splits closure photos from the other evidence', async () => {
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Selesai')).toBeTruthy());
    expect(utils.queryByText('Menunggu kirim')).toBeNull();
    expect(utils.getByText('media: context')).toBeTruthy();
  });

  it('shows the closure photo next to the closer on a done event', async () => {
    (getSiteEventResult as jest.Mock).mockResolvedValue({
      event: { ...baseEvent, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u2', closed_by_name: 'Sari' },
    });
    const utils = render(<SiteEventDetailScreen />);
    await waitFor(() => expect(utils.getByText('Ditutup oleh')).toBeTruthy());
    expect(utils.getByText('media: closure')).toBeTruthy();
    expect(utils.getByText('Foto penutupan')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, all five tests: `Unable to find an element with text: Menunggu kirim` (twice), `... Penutupan belum terkirim: ...`, `... media: context` ("Bukti" still shows both roles) and `... media: closure` (the "Selesai" card has no photo strip yet).

- [ ] **Step 3: Implement**

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
import React, { useCallback, useEffect, useState } from 'react';
```

and replace it with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
import { getSiteEvent, getSiteEventResult, type SiteEventWithMedia } from '../../tools/siteEvents';
```

and replace it with:

```tsx
import { getSiteEvent, getSiteEventResult, type SiteEventWithMedia } from '../../tools/siteEvents';
import { pendingCloseFor, useCaptureQueueEntries } from '../../tools/captureQueueStore';
import { retryQueueEntry } from '../../tools/captureQueueWorker';
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
  const { profile } = useProject();
```

and replace it with:

```tsx
  const { profile } = useProject();
  const queue = useCaptureQueueEntries(profile?.id ?? null);
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
  useEffect(() => {
    void load();
  }, [load]);
```

and replace it with:

```tsx
  useEffect(() => {
    void load();
  }, [load]);

  // Closure spec §4.5: a close job on this phone keeps the server's status on
  // screen and adds "Menunggu kirim". The moment the job leaves the pending
  // set (closed, superseded, or cancelled), read the server again rather than
  // guess what happened there.
  const pendingClose = event ? pendingCloseFor(queue, event.id) : undefined;
  const hadPendingClose = useRef(false);
  useEffect(() => {
    const pending = pendingClose !== undefined;
    if (hadPendingClose.current && !pending) void load();
    hadPendingClose.current = pending;
  }, [pendingClose, load]);
  const [retrying, setRetrying] = useState(false);
  const retryClose = async () => {
    if (!profile || !pendingClose) return;
    setRetrying(true);
    try {
      await retryQueueEntry(profile.id, pendingClose.id);
    } finally {
      setRetrying(false);
    }
  };
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
                <View style={s.chip}>
                  <Text style={s.chipText}>{SITE_EVENT_STATUS_LABELS[event.status]}</Text>
                </View>
```

and replace it with:

```tsx
                <View style={s.chip}>
                  <Text style={s.chipText}>{SITE_EVENT_STATUS_LABELS[event.status]}</Text>
                </View>
                {pendingClose ? (
                  <View style={[s.chip, { borderColor: COLORS.info, backgroundColor: COLORS.infoBg }]}>
                    <Text style={[s.chipText, { color: COLORS.info }]}>Menunggu kirim</Text>
                  </View>
                ) : null}
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
              <MediaStrip media={event.media} />
```

and replace it with:

```tsx
              <MediaStrip media={event.media.filter((m) => m.role !== 'closure')} />
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
                {event.closure_note ? <Text style={s.bannerText}>{event.closure_note}</Text> : null}
              </Card>
            ) : null}
```

and replace it with:

```tsx
                {event.closure_note ? <Text style={s.bannerText}>{event.closure_note}</Text> : null}
                {/* The database proved a closure photo exists; a person judges what it shows (spec §1.1 rule 6). */}
                <Text style={[s.label, { marginTop: SPACE.sm }]}>Foto penutupan</Text>
                <MediaStrip media={event.media.filter((m) => m.role === 'closure')} />
              </Card>
            ) : null}

            {pendingClose ? (
              <Card title="Penutupan" borderColor={pendingClose.needsAttention ? COLORS.critical : COLORS.info}>
                {pendingClose.needsAttention ? (
                  <>
                    <Text style={s.errorText}>
                      Penutupan belum terkirim: {pendingClose.lastError ?? 'gagal setelah beberapa kali percobaan.'}
                    </Text>
                    <TouchableOpacity
                      style={s.secondaryBtn}
                      onPress={() => void retryClose()}
                      disabled={retrying}
                      accessibilityRole="button"
                    >
                      <Text style={s.secondaryText}>{retrying ? 'Mencoba…' : 'Coba lagi'}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={s.bannerText}>
                    Penutupan tersimpan di ponsel ini dan menunggu kirim. Status tetap Terbuka sampai server menerimanya.
                  </Text>
                )}
              </Card>
            ) : null}
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
            {actions.canClose && !closing ? (
```

and replace it with:

```tsx
            {actions.canClose && !pendingClose && !closing ? (
```

In `workflows/screens/SiteEventDetailScreen.tsx`, find this block (it occurs exactly once):

```tsx
            {actions.canClose && closing && profile ? (
```

and replace it with:

```tsx
            {actions.canClose && !pendingClose && closing && profile ? (
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T5.txt` with the Write tool (never a heredoc), exactly:

```text
feat(site-events): Menunggu kirim on the event detail

A close job on this phone keeps the server's status label, adds
"Menunggu kirim" and hides Selesai; a flagged job shows why and offers
Coba lagi; when the job leaves, the screen reads the server again. The
Selesai card shows the closure photo beside the closer. Closure spec
2026-09-26 §3.3, §4.5.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add workflows/screens/SiteEventDetailScreen.tsx workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L1-T5.txt -- workflows/screens/SiteEventDetailScreen.tsx workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `workflows/screens/SiteEventDetailScreen.tsx`, `workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx`.


---

## Lane 2: offline close

### L2-T1 (Lane 2, Task 1): `formatWibShort` and the Indonesian month list

The superseded close card (spec §4.6) and the office health line (§5.6) print an instant as "17 Sep 14.05" in WIB. Fixed +7 h arithmetic like `todayIsoWIB` (`tools/timeWindow.ts:79-85`), so no Intl lookup. The month list is exported so migration 106's static guard (Lane 3 Task 2) can compare it with `site_event_digest_day`.

**Files:**
- Modify: `tools/timeWindow.ts` (append after `dayRangeWIB`, line 146)
- Test: `tools/__tests__/timeWindow.test.ts` (import block lines 1-8; append at end)

**Owns (no other lane edits these):** `tools/timeWindow.ts`, `tools/__tests__/timeWindow.test.ts`

**Depends on:** Nothing. Do this first: Lane 2 Task 5 and Lane 3 Tasks 2 and 4 import it.

- [ ] **Step 1: Write the failing test**

In `tools/__tests__/timeWindow.test.ts`, find this block (it occurs exactly once):

```ts
  addCalendarDays,
  todayIsoWIB,
} from '../timeWindow';
```

and replace it with:

```ts
  addCalendarDays,
  todayIsoWIB,
  formatWibShort,
  WIB_MONTH_ABBR,
} from '../timeWindow';
```

Append to the end of `tools/__tests__/timeWindow.test.ts` (after its current last line, keeping one blank line between):

```ts
/**
 * Closure spec 2026-09-26 §4.6 and §5.6: the superseded close card and the
 * digest health line print an instant as "17 Sep 14.05" in WIB. Fixed +7 h
 * arithmetic, like todayIsoWIB, so the day and the month roll at 17:00 UTC.
 */
describe('formatWibShort', () => {
  it('prints day, Indonesian month and HH.mm in WIB', () => {
    expect(formatWibShort('2026-09-17T07:05:00.000Z')).toBe('17 Sep 14.05');
    expect(formatWibShort('2026-09-17T00:00:00.000Z')).toBe('17 Sep 07.00');
  });

  it('rolls the date at 17:00 UTC, across a month and a year boundary', () => {
    expect(formatWibShort('2026-09-11T16:59:00.000Z')).toBe('11 Sep 23.59');
    expect(formatWibShort('2026-09-11T17:00:00.000Z')).toBe('12 Sep 00.00');
    expect(formatWibShort('2026-01-31T17:30:00.000Z')).toBe('1 Feb 00.30');
    expect(formatWibShort('2026-12-31T17:00:00.000Z')).toBe('1 Jan 00.00');
  });

  it('reads an offset timestamp the way Postgres returns one', () => {
    expect(formatWibShort('2026-08-05T09:15:00+07:00')).toBe('5 Agu 09.15');
  });

  it('returns an unparseable value unchanged instead of inventing a time', () => {
    expect(formatWibShort('bukan tanggal')).toBe('bukan tanggal');
  });

  it('spells the twelve months the Indonesian way', () => {
    expect(WIB_MONTH_ABBR).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/timeWindow.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2305: Module '"../timeWindow"' has no exported member 'formatWibShort'` (and the same for `WIB_MONTH_ABBR`).

- [ ] **Step 3: Implement**

Append to the end of `tools/timeWindow.ts` (after its current last line, keeping one blank line between):

```ts
/**
 * Indonesian month abbreviations, index 0 = January. Migration 106's
 * site_event_digest_day() spells the same twelve; migration106.test.ts
 * compares the two lists so a push and the app never name a month
 * differently.
 */
export const WIB_MONTH_ABBR: ReadonlyArray<string> = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * "17 Sep 14.05": an instant as a WIB day, short month and 24-hour time with
 * a dot, the Indonesian convention. Same fixed +7 h arithmetic as
 * todayIsoWIB. The day carries no leading zero, like the SQL 'FMDD' in 106.
 * An unparseable input is returned unchanged rather than turned into a
 * made-up time.
 */
export function formatWibShort(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const shifted = new Date(ms + WIB_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${WIB_MONTH_ABBR[shifted.getUTCMonth()]} ${hh}.${mm}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx jest tools/__tests__/timeWindow.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, every test green.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T1.txt` with the Write tool (never a heredoc), exactly:

```text
feat(time): formatWibShort and the Indonesian month list

"17 Sep 14.05" in WIB for the superseded close card and the digest
health line (closure spec 2026-09-26 §4.6, §5.6).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/timeWindow.ts tools/__tests__/timeWindow.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T1.txt -- tools/timeWindow.ts tools/__tests__/timeWindow.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/timeWindow.ts`, `tools/__tests__/timeWindow.test.ts`.


### L2-T2 (Lane 2, Task 2): The three close calls in `tools/siteEvents.ts`

A queued close runs `upload`, `insert_media`, `close` and `lookup_closer` as separate retryable steps (spec §4.4). This task adds the three network calls the worker needs, next to the existing `closeSiteEvent` (removed in Lane 2 Task 7, once nothing imports it). `closeSiteEventRpc` tells `SITE_EVENT_NOT_OPEN` (an outcome) apart from other `SITE_EVENT_*` refusals and Postgres `42501` (permanent) and anything else (transient). `lookupSiteEventCloser` wraps `getSiteEventResult` (`tools/siteEvents.ts:386-412`) so the worker never has to map copy itself. The tests live in a new file, `tools/__tests__/siteEventsClose.test.ts`, because `tools/__tests__/siteEvents.test.ts` belongs to Lane 1 (spec §8.3 lists these cases under `siteEvents.test.ts`; the file split is the only change).

**Files:**
- Modify: `tools/siteEvents.ts`: insert a new block directly above the `discardSiteEvent` doc comment (original line 562). Touch no other line; lines 131-159 belong to Lane 1 Task 3.
- Create: `tools/__tests__/siteEventsClose.test.ts`

**Owns (no other lane edits these):** `tools/siteEvents.ts` (the inserted block only), `tools/__tests__/siteEventsClose.test.ts`

**Depends on:** Nothing. **Commit this before Lane 1 Task 3 starts**: both edit `tools/siteEvents.ts`, and this lane edits it first.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/siteEventsClose.test.ts` with exactly this content:

```ts
/**
 * The three calls a queued "Selesai" makes (closure spec 2026-09-26 §4.4),
 * each retried by the capture queue on its own:
 *
 *  • insertClosureMedia is an idempotent upsert into the EVENT's folder, so a
 *    retry after a lost response is a no-op, never a twin row;
 *  • closeSiteEventRpc tells "somebody closed it first" (NOT_OPEN, an outcome)
 *    apart from a refusal (permanent) and a hiccup (transient);
 *  • lookupSiteEventCloser reports the server's closer, and never turns a read
 *    failure into a claim about who closed the event.
 */
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));
jest.mock('../storage', () => ({
  readUploadBody: jest.fn(),
  resolvePhotoUrl: jest.fn(),
  SITE_MEDIA_PATH_PREFIX: 'site-media:',
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));

import { supabase } from '../supabase';
import {
  closeSiteEventRpc,
  insertClosureMedia,
  lookupSiteEventCloser,
  mapSiteEventRpcError,
  type LocalSiteEventMedia,
} from '../siteEvents';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

const mocked = supabase as unknown as { from: jest.Mock; rpc: jest.Mock };

const closurePhoto = (over: Partial<LocalSiteEventMedia> = {}): LocalSiteEventMedia => ({
  id: 'cm1', localUri: 'file:///q/job1/cm1.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg',
  ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: '2026-09-17T02:00:00.000Z', ...over,
});

/** An awaitable chain like a PostgrestFilterBuilder, resolving to `result` whatever the code awaits. */
function readChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => chain,
    then: (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

beforeEach(() => {
  mocked.from.mockReset();
  mocked.rpc.mockReset();
});

describe('insertClosureMedia', () => {
  it("upserts one closure row inside the event's folder, ignoring duplicates", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    mocked.from.mockReturnValue({ upsert });
    const result = await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [closurePhoto()] }, { cm1: 2048 });
    expect(result).toEqual({});
    expect(mocked.from).toHaveBeenCalledWith('site_event_media');
    expect(upsert).toHaveBeenCalledWith(
      [{
        id: 'cm1', event_id: EVENT, kind: 'photo', role: 'closure',
        storage_path: `site-events/${PROJECT}/${EVENT}/cm1.jpg`, mime_type: 'image/jpeg',
        duration_s: null, bytes: 2048, sort_order: 0, captured_at: '2026-09-17T02:00:00.000Z',
      }],
      { onConflict: 'id', ignoreDuplicates: true },
    );
  });

  it('forces kind photo and role closure whatever the carrier says', async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    mocked.from.mockReturnValue({ upsert });
    await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [closurePhoto({ role: 'context' })] }, {});
    const calls = upsert.mock.calls as unknown as Array<[Array<Record<string, unknown>>]>;
    expect(calls[0][0][0]).toMatchObject({ kind: 'photo', role: 'closure', bytes: null });
  });

  it('writes nothing for a carrier with no photo', async () => {
    expect(await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [] }, {})).toEqual({});
    expect(mocked.from).not.toHaveBeenCalled();
  });

  it("maps the path guard's refusal and calls it permanent", async () => {
    mocked.from.mockReturnValue({
      upsert: jest.fn(async () => ({ error: { code: 'P0001', message: 'SITE_EVENT_MEDIA_PATH: path media harus diawali x' } })),
    });
    expect(await insertClosureMedia({ id: EVENT, projectId: PROJECT, media: [closurePhoto()] }, {})).toEqual({
      error: 'Lokasi berkas media tidak sesuai kejadian.',
      kind: 'permanent',
    });
  });
});

describe('closeSiteEventRpc', () => {
  it('sends the note it is given, trimmed upstream, and reports ok', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { event_id: EVENT, status: 'done' }, error: null });
    expect(await closeSiteEventRpc(EVENT, 'Sudah ditambal')).toEqual({ ok: true });
    expect(mocked.rpc).toHaveBeenCalledWith('close_site_event', { p_event_id: EVENT, p_closure_note: 'Sudah ditambal' });
  });

  it('passes a null note through as null', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: {}, error: null });
    await closeSiteEventRpc(EVENT, null);
    expect(mocked.rpc).toHaveBeenCalledWith('close_site_event', { p_event_id: EVENT, p_closure_note: null });
  });

  it('reads SITE_EVENT_NOT_OPEN as an outcome, not an error', async () => {
    mocked.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa ditandai selesai (status sekarang done)' },
    });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({ notOpen: true });
  });

  it.each([
    ['SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian cacat hanya bisa ditandai selesai dengan foto penutupan.'],
    ['SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.'],
    ['SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini'],
    ['SITE_EVENT_NOT_FOUND: kejadian x tidak ditemukan'],
  ])("calls %s permanent, carrying the mapper's copy", async (message) => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({ error: mapSiteEventRpcError(message), kind: 'permanent' });
  });

  it('maps a refusal it knows to its Indonesian sentence', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SITE_EVENT_AUTH: Anda tidak ditugaskan ke proyek ini' } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({ error: 'Anda tidak ditugaskan ke proyek ini.', kind: 'permanent' });
  });

  it('calls Postgres 42501 permanent', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied for function close_site_event' } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({
      error: 'Gagal menyimpan: permission denied for function close_site_event',
      kind: 'permanent',
    });
  });

  it('calls a network error transient, so the queue keeps trying', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed' } });
    expect(await closeSiteEventRpc(EVENT, null)).toEqual({
      error: 'Gagal menyimpan: TypeError: Network request failed',
      kind: 'transient',
    });
  });
});

describe('lookupSiteEventCloser', () => {
  const doneRow = {
    id: EVENT, status: 'done', closed_at: '2026-09-17T07:05:00.000Z', closed_by: 'u9',
    site_event_media: [], rooms: null, owner: null, reporter: null, closer: { full_name: 'Budi Santoso' },
  };

  it("returns the server's closer and time for a done event", async () => {
    mocked.from.mockReturnValueOnce(readChain({ data: doneRow, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ closedByName: 'Budi Santoso', closedAt: '2026-09-17T07:05:00.000Z' });
  });

  it('returns a null name, never a guess, when the service role closed it', async () => {
    mocked.from.mockReturnValueOnce(readChain({ data: { ...doneRow, closed_by: null, closer: null }, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ closedByName: null, closedAt: '2026-09-17T07:05:00.000Z' });
  });

  it('calls a failed read transient', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockReturnValueOnce(readChain({ data: null, error: { message: 'network down' } }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ error: 'Status kejadian gagal dibaca: network down', kind: 'transient' });
    warn.mockRestore();
  });

  it('calls a missing row or a status other than done permanent, with the NOT_OPEN copy', async () => {
    mocked.from.mockReturnValueOnce(readChain({ data: null, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ error: 'Hanya kejadian terbuka yang bisa ditandai selesai.', kind: 'permanent' });
    mocked.from.mockReturnValueOnce(readChain({ data: { ...doneRow, status: 'open', closed_at: null }, error: null }));
    expect(await lookupSiteEventCloser(EVENT)).toEqual({ error: 'Hanya kejadian terbuka yang bisa ditandai selesai.', kind: 'permanent' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/siteEventsClose.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2724: '"../siteEvents"' has no exported member named 'closeSiteEventRpc'. Did you mean 'closeSiteEvent'?` and `TS2305` for `insertClosureMedia` and `lookupSiteEventCloser`.

- [ ] **Step 3: Implement**

In `tools/siteEvents.ts`, find this block (it occurs exactly once):

```ts
/** "Buang": a status, never a delete (spec §1.1 rule 3). Media rows and files stay. */
```

and replace it with:

```ts
// ─── Offline close (closure spec 2026-09-26 §4) ──────────────────────────────
// The capture queue's close job calls these three one at a time, each safe to
// retry, so "Selesai" survives no signal. The form has no synchronous path.

/**
 * The closure photo's media row, after its file is uploaded. The same upsert
 * with ignoreDuplicates as the capture insert, so a retry after a lost
 * response is a no-op. `carrier.id` is the EVENT id: the row must point inside
 * site-events/{projectId}/{eventId}/ or 097's path guard refuses it.
 */
export async function insertClosureMedia(
  carrier: { id: string; projectId: string; media: LocalSiteEventMedia[] },
  bytesById: Record<string, number | null>,
): Promise<{ error?: string; kind?: SiteEventErrorKind }> {
  const rows = buildMediaRows(
    { ...carrier, media: carrier.media.map((m) => ({ ...m, kind: 'photo' as const, role: 'closure' as const })) },
    bytesById,
  );
  if (rows.length === 0) return {};
  const { error } = await supabase
    .from('site_event_media')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) {
    return { error: mapSiteEventRpcError(error.message), kind: classifyStorageOrPostgrestError(error) };
  }
  return {};
}

/**
 * close_site_event's three possible answers. `notOpen` is not an error: the
 * event is no longer open, usually because somebody closed it first (or this
 * job's own earlier attempt landed and its response was lost). Every other
 * SITE_EVENT_* refusal and Postgres 42501 are decisions, so `permanent`;
 * anything else (a dropped network, a 5xx) is `transient`.
 */
export type CloseRpcResult =
  | { ok: true }
  | { notOpen: true }
  | { error: string; kind: SiteEventErrorKind };

export async function closeSiteEventRpc(eventId: string, note: string | null): Promise<CloseRpcResult> {
  const { error } = await supabase.rpc('close_site_event', { p_event_id: eventId, p_closure_note: note });
  if (!error) return { ok: true };
  const message = error.message ?? '';
  if (message.includes('SITE_EVENT_NOT_OPEN:')) return { notOpen: true };
  const permanent = /SITE_EVENT_[A-Z_]+:/.test(message) || (error as { code?: string }).code === '42501';
  return { error: mapSiteEventRpcError(message), kind: permanent ? 'permanent' : 'transient' };
}

/** Who closed an event, read from the server, for a close job that found it already closed. */
export type CloserLookup =
  | { closedByName: string | null; closedAt: string }
  | { error: string; kind: SiteEventErrorKind };

/**
 * A read failure is transient: only the lookup is repeated. A row that is not
 * there, or not `done`, cannot be explained by retrying, so it is permanent
 * and carries SITE_EVENT_NOT_OPEN's copy. `closedByName` is null when the
 * close was made by the service role (097 leaves closed_by NULL then).
 */
export async function lookupSiteEventCloser(eventId: string): Promise<CloserLookup> {
  const read = await getSiteEventResult(eventId);
  if (read.error !== undefined) {
    return { error: `Status kejadian gagal dibaca: ${read.error}`, kind: 'transient' };
  }
  const event = read.event;
  if (!event || event.status !== 'done' || !event.closed_at) {
    return { error: mapSiteEventRpcError('SITE_EVENT_NOT_OPEN: '), kind: 'permanent' };
  }
  return { closedByName: event.closed_by_name, closedAt: event.closed_at };
}

/** "Buang": a status, never a delete (spec §1.1 rule 3). Media rows and files stay. */
```

- [ ] **Step 4: Run the new test and the existing site-event suite**

Run:

```bash
npx jest tools/__tests__/siteEventsClose.test.ts tools/__tests__/siteEvents.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites green.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T2.txt` with the Write tool (never a heredoc), exactly:

```text
feat(site-events): the three close calls a queued Selesai makes

insertClosureMedia (idempotent upsert into the event's folder),
closeSiteEventRpc (NOT_OPEN is an outcome; SITE_EVENT_* and 42501 are
permanent; anything else transient) and lookupSiteEventCloser (the
server's closer, never a guess). Closure spec 2026-09-26 §4.4.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/siteEvents.ts tools/__tests__/siteEventsClose.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T2.txt -- tools/siteEvents.ts tools/__tests__/siteEventsClose.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/siteEvents.ts`, `tools/__tests__/siteEventsClose.test.ts`.


### L2-T3 (Lane 2, Task 3): The queue becomes two job kinds: machine, worker, and the edits that keep the store and card compiling

`CaptureQueueEntry` becomes the union `CaptureJob | CloseJob` (spec §4.1), `CAPTURE_QUEUE_ENTRY_VERSION` goes to 2 with `upgradeEntry` turning every v1 record into `{ ...raw, version: 2, kind: 'capture' }` (§4.2), the close transition table and `nextStep` dispatch land (§4.3), and the worker learns `insert_media`, `close` and `lookup_closer` (§4.4). `captureQueue.ts` is replaced whole: nearly every function changes shape. The store, the Beranda model and three existing test files get the smallest edits that keep them compiling and green; their close-job behaviour comes in Tasks 4 and 5.

**Files:**
- Modify (replace whole file): `tools/captureQueue.ts`
- Modify: `tools/captureQueueWorker.ts`: import block (lines 47-69); `runStep` through the old `STEP_LABEL` (lines 322-373)
- Modify: `tools/captureQueueStore.ts`: import block (lines 42-47); `recoverMissingMedia` guard (lines 314-319); `enqueueNewCapture` return type (line 397); `discardEntryLocally` guard (lines 426-428)
- Modify: `workflows/screens/siteEvent/captureQueueModel.ts`: import block (lines 3-7); `attentionRows` (lines 92-104)
- Test: `tools/__tests__/captureQueue.test.ts`
- Test: `tools/__tests__/captureQueueWorker.test.ts`
- Test: `tools/__tests__/captureQueueStore.test.ts` (the legacy-entry describe, lines 265-276)
- Test: `workflows/__tests__/captureQueueModel.test.ts` (types only)

**Owns (no other lane edits these):** `tools/captureQueue.ts`, `tools/captureQueueWorker.ts`, `tools/captureQueueStore.ts`, `workflows/screens/siteEvent/captureQueueModel.ts`, `tools/__tests__/captureQueue.test.ts`, `tools/__tests__/captureQueueWorker.test.ts`, `tools/__tests__/captureQueueStore.test.ts`, `workflows/__tests__/captureQueueModel.test.ts`

**Depends on:** Lane 2 Task 2 (the worker imports `insertClosureMedia`, `closeSiteEventRpc`, `lookupSiteEventCloser`).

- [ ] **Step 1: Update the machine tests: types, version 2, both transition tables, the upgrade**

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
  enqueueCapture,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markInserted,
  markUnrecoverable,
  markUploaded,
  nextStep,
  recordFailure,
  retryEntry,
  toNewSiteEvent,
  upgradeEntry,
  waitingCount,
  type CaptureQueueEntry,
  type QueueState,
} from '../captureQueue';
```

and replace it with:

```ts
  enqueueCapture,
  enqueueClose,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  markClosureMediaInserted,
  markInserted,
  markUnrecoverable,
  markUploaded,
  mediaCarrierId,
  nextStep,
  recordFailure,
  retryEntry,
  toNewSiteEvent,
  upgradeEntry,
  waitingCount,
  type CaptureJob,
  type CaptureQueueEntry,
  type CloseJob,
  type QueueState,
} from '../captureQueue';
```

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
const fresh = (): CaptureQueueEntry => enqueueCapture(
```

and replace it with:

```ts
const fresh = (): CaptureJob => enqueueCapture(
```

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
      id: 'e1', version: 1, ownerId: 'u1', state: 'queued',
```

and replace it with:

```ts
      id: 'e1', version: 2, kind: 'capture', ownerId: 'u1', state: 'queued',
```

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
function recordFailures(entry: CaptureQueueEntry, n: number): CaptureQueueEntry {
```

and replace it with:

```ts
function recordFailures<E extends CaptureQueueEntry>(entry: E, n: number): E {
```

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
  const QUEUE_STATES: QueueState[] = ['queued', 'uploading', 'analyzing', 'draft_ready', 'done', 'failed'];
```

and replace it with:

```ts
  const QUEUE_STATES: QueueState[] = ['queued', 'uploading', 'analyzing', 'draft_ready', 'closing', 'done', 'superseded', 'failed'];
```

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
    failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
    done: [],
  };
```

and replace it with:

```ts
    failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
    done: [],
    closing: [],
    superseded: [],
  };
```

In `tools/__tests__/captureQueue.test.ts`, find this block (it occurs exactly once):

```ts
  it('exports the current version as 1', () => {
    expect(CAPTURE_QUEUE_ENTRY_VERSION).toBe(1);
  });

  it('round-trips a well-formed v1 entry unchanged', () => {
    const e = fresh();
    expect(upgradeEntry(e)).toEqual(e);
  });

  it('treats a legacy entry with no version field as v1', () => {
    const e = fresh();
    const { version, ...legacy } = e;
    expect(upgradeEntry(legacy)).toEqual({ ...legacy, version: 1 });
  });

  it('refuses a future/unrecognised version rather than guessing', () => {
    const e = fresh();
    expect(upgradeEntry({ ...e, version: 2 })).toBeNull();
  });
```

and replace it with:

```ts
  /** A record exactly as a v1 build wrote it: no `kind`, version 1. */
  const v1Record = (): Record<string, unknown> => {
    const { kind: _kind, ...rest } = fresh();
    return { ...rest, version: 1 };
  };

  it('exports the current version as 2', () => {
    expect(CAPTURE_QUEUE_ENTRY_VERSION).toBe(2);
  });

  it('upgrades a v1 record to version 2, kind capture, keeping every field', () => {
    const raw = v1Record();
    expect(upgradeEntry(raw)).toEqual({ ...raw, version: 2, kind: 'capture' });
  });

  it('treats a legacy record with no version field as v1 and upgrades it the same way', () => {
    const { version: _version, ...legacy } = v1Record();
    expect(upgradeEntry(legacy)).toEqual({ ...legacy, version: 2, kind: 'capture' });
  });

  it('sets kind on a v1 record, never reads it from the record', () => {
    expect(upgradeEntry({ ...v1Record(), kind: 'close' })).toMatchObject({ kind: 'capture', version: 2 });
  });

  it('round-trips a well-formed v2 capture and a v2 close unchanged', () => {
    const capture = fresh();
    expect(upgradeEntry(capture)).toEqual(capture);
    const close = freshClose();
    expect(upgradeEntry(close)).toEqual(close);
  });

  it('refuses a future version, an unknown kind, and a close record missing eventId', () => {
    expect(upgradeEntry({ ...fresh(), version: 3 })).toBeNull();
    expect(upgradeEntry({ ...fresh(), kind: 'reopen' })).toBeNull();
    const { eventId: _eventId, ...noEvent } = freshClose();
    expect(upgradeEntry(noEvent)).toBeNull();
  });

  it('refuses a close record carrying two photos or a malformed outcome', () => {
    const close = freshClose();
    expect(upgradeEntry({ ...close, media: [...close.media, { ...close.media[0], id: 'm9' }] })).toBeNull();
    expect(upgradeEntry({ ...close, closeOutcome: 'maybe' })).toBeNull();
    expect(upgradeEntry({ ...close, closedElsewhere: { closedByName: 'A' } })).toBeNull();
  });
```

- [ ] **Step 2: Add the close-job machine tests**

Append to the end of `tools/__tests__/captureQueue.test.ts` (after its current last line, keeping one blank line between):

```ts
// ─── Close jobs (closure spec 2026-09-26 §4) ─────────────────────────────────

const closurePhoto = {
  id: 'cm1', localUri: 'file:///q/job1/cm1.jpg', kind: 'photo' as const, role: 'closure' as const,
  mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW,
};

function freshClose(over: { photo?: boolean; note?: string } = {}): CloseJob {
  return enqueueClose({
    id: 'job1', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian',
    note: over.note ?? '  Sudah ditambal  ', closurePhoto: over.photo === false ? null : closurePhoto, nowIso: NOW,
  });
}

describe('enqueueClose', () => {
  it('starts queued with its own id, the event id kept apart, the note trimmed and the photo as a closure photo', () => {
    const job = freshClose();
    expect(job).toMatchObject({
      version: 2, kind: 'close', id: 'job1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian',
      note: 'Sudah ditambal', state: 'queued', mediaInserted: false, closeOutcome: null, closedElsewhere: null,
      localCleanedUp: false, attempts: 0, needsAttention: false, unrecoverable: false,
    });
    expect(job.media).toEqual([{ ...closurePhoto, uploaded: false, bytes: null }]);
  });

  it('stores a blank note as null, exactly what the RPC receives', () => {
    expect(freshClose({ note: ' \n\t ' }).note).toBeNull();
  });

  it('forces kind photo and role closure on whatever the form handed in', () => {
    const job = enqueueClose({
      id: 'j', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'T', note: '',
      closurePhoto: { ...closurePhoto, role: 'context' }, nowIso: NOW,
    });
    expect(job.media[0]).toMatchObject({ kind: 'photo', role: 'closure' });
  });

  it("uploads into the event's folder, not the job's", () => {
    expect(mediaCarrierId(freshClose())).toBe('ev1');
    expect(mediaCarrierId(fresh())).toBe('e1');
  });
});

describe('nextStep for a close job', () => {
  it('with a photo: upload -> insert_media -> close -> cleanup -> done', () => {
    let j = freshClose();
    expect(nextStep(j)).toEqual({ kind: 'upload', mediaId: 'cm1' });
    j = markUploaded(j, 'cm1', 2048, NOW);
    expect(j.state).toBe('uploading');
    expect(nextStep(j)).toEqual({ kind: 'insert_media' });
    j = markClosureMediaInserted(j, NOW);
    expect(j.state).toBe('closing');
    expect(nextStep(j)).toEqual({ kind: 'close' });
    j = markCloseOutcome(j, 'closed', NOW);
    expect(j.state).toBe('closing');
    expect(nextStep(j)).toEqual({ kind: 'cleanup' });
    j = markCleanedUp(j, NOW);
    expect(j.state).toBe('done');
    expect(nextStep(j)).toEqual({ kind: 'none' });
  });

  it('without a photo: straight to close', () => {
    let j = freshClose({ photo: false });
    expect(nextStep(j)).toEqual({ kind: 'close' });
    j = markCloseOutcome(j, 'closed', NOW);
    expect(j.state).toBe('closing');
    expect(nextStep(j)).toEqual({ kind: 'cleanup' });
  });

  it('through not_open: no failure recorded, the closer read once, the RPC never asked again, ends superseded', () => {
    let j = markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW);
    expect(j).toMatchObject({ closeOutcome: 'not_open', consecutiveFailures: 0, lastError: null, needsAttention: false });
    expect(nextStep(j)).toEqual({ kind: 'lookup_closer' });
    j = markClosedElsewhere(j, { closedByName: 'Budi', closedAt: '2026-09-17T07:05:00.000Z' }, NOW);
    expect(nextStep(j)).toEqual({ kind: 'cleanup' });
    j = markCleanedUp(j, NOW);
    expect(j.state).toBe('superseded');
    expect(j.closedElsewhere).toEqual({ closedByName: 'Budi', closedAt: '2026-09-17T07:05:00.000Z' });
    expect(nextStep(j)).toEqual({ kind: 'none' });
  });

  it('a failed lookup resumes at the lookup, not at the RPC', () => {
    let j = markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW);
    j = recordFailure(j, 'Baca status kejadian gagal: jaringan turun', NOW);
    expect(j.state).toBe('failed');
    const retried = retryEntry(j, NOW);
    expect(retried.state).toBe('closing');
    expect(nextStep(retried)).toEqual({ kind: 'lookup_closer' });
  });
});

describe('superseded is terminal, closing is waiting', () => {
  const superseded = (): CloseJob => markCleanedUp(
    markClosedElsewhere(markCloseOutcome(freshClose({ photo: false }), 'not_open', NOW), { closedByName: null, closedAt: NOW }, NOW),
    NOW,
  );

  it('a superseded job is neither ready to attempt nor counted as waiting', () => {
    const j = superseded();
    expect(isReadyToAttempt(j, Date.parse(NOW) + 999_999)).toBe(false);
    expect(waitingCount([j])).toBe(0);
  });

  it('a close job that is still closing counts as waiting for signal', () => {
    const j = markClosureMediaInserted(markUploaded(freshClose(), 'cm1', 1, NOW), NOW);
    expect(j.state).toBe('closing');
    expect(waitingCount([j])).toBe(1);
  });
});

describe('markUnrecoverable per kind', () => {
  it('flags a close job whose photo is not uploaded yet', () => {
    const j = markUnrecoverable(freshClose(), 'Foto penutupan hilang.');
    expect(j).toMatchObject({ unrecoverable: true, needsAttention: true, lastError: 'Foto penutupan hilang.', state: 'queued' });
  });

  it('throws once the close photo is uploaded, and for a close job with no photo at all', () => {
    expect(() => markUnrecoverable(markUploaded(freshClose(), 'cm1', 1, NOW), 'x')).toThrow();
    expect(() => markUnrecoverable(freshClose({ photo: false }), 'x')).toThrow();
  });

  it('still keys a capture job on eventInserted', () => {
    expect(markUnrecoverable(fresh(), 'x').unrecoverable).toBe(true);
    const inserted = markInserted(markUploaded(markUploaded(fresh(), 'm1', 1, NOW), 'm2', 1, NOW), NOW);
    expect(() => markUnrecoverable(inserted, 'x')).toThrow();
  });
});

describe('close transition table, exhaustively', () => {
  const STATES: QueueState[] = ['queued', 'uploading', 'analyzing', 'draft_ready', 'closing', 'done', 'superseded', 'failed'];
  // Hand-copied from CLOSE_TRANSITIONS in captureQueue.ts, deliberately NOT
  // imported, for the same reason as the capture table above.
  const EXPECTED: Record<QueueState, ReadonlyArray<QueueState>> = {
    queued: ['uploading', 'closing', 'failed'],
    uploading: ['uploading', 'closing', 'failed'],
    closing: ['closing', 'done', 'superseded', 'failed'],
    failed: ['queued', 'uploading', 'closing'],
    done: [],
    superseded: [],
    analyzing: [],
    draft_ready: [],
  };
  const pairs: Array<[QueueState, QueueState]> = STATES.flatMap((from) =>
    STATES.map((to): [QueueState, QueueState] => [from, to]),
  );

  it.each(pairs)('from %s to %s', (from, to) => {
    const allowed = from === to || EXPECTED[from].includes(to);
    if (allowed) {
      expect(() => assertTransition(from, to, 'close')).not.toThrow();
    } else {
      expect(() => assertTransition(from, to, 'close')).toThrow(IllegalQueueTransitionError);
    }
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run:

```bash
npx jest tools/__tests__/captureQueue.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2305: Module '"../captureQueue"' has no exported member 'enqueueClose'` (and `CaptureJob`, `CloseJob`, `markCloseOutcome`, ...), `TS2322: Type '"closing"' is not assignable to type 'QueueState'` and `TS2554: Expected 2 arguments, but got 3.`

- [ ] **Step 4: Replace the machine**

Replace the whole of `tools/captureQueue.ts`. Every capture-job rule is carried over unchanged (the capture transition table is byte-for-byte the old `ALLOWED_TRANSITIONS` plus two empty rows); what is new is the `CloseJob` shape, `enqueueClose`, `mediaCarrierId`, `needsLocalMedia`, the close table, `nextCloseStep`, and the three close mutators. Mutators shared by both kinds are generic (`<E extends CaptureQueueEntry>`), so a `CaptureJob` stays a `CaptureJob` through them; capture-only mutators take `CaptureJob`, close-only ones `CloseJob`.

Replace the whole of `tools/captureQueue.ts` with exactly this content:

```ts
// SANO - Offline capture queue: pure state machine (spec §7; closure spec
// 2026-09-26 §4). No I/O, no imports beyond types, so it needs no mocks and
// runs identically on native and web. captureQueueStore.ts persists entries;
// captureQueueWorker.ts drives them through this machine by calling
// tools/siteEvents.ts.
//
// Two job kinds share one store, one worker and one Beranda card:
//   * 'capture' - a new report: upload media, insert the event, kick off the
//     analysis, clean up. Progress is three booleans (eventInserted,
//     analysisRequested, localCleanedUp) plus a per-file `uploaded` flag.
//   * 'close' - "Selesai" on an open event: upload the closure photo (if any),
//     insert its media row, call close_site_event, and, when the server says
//     the event was no longer open, read who closed it. Progress is
//     mediaInserted, closeOutcome, closedElsewhere and localCleanedUp.
// Each flag is backed by one separately retryable network call. `state` is
// always DERIVED from that progress (deriveCaptureState / deriveCloseState),
// never set directly, so state and progress can never disagree. A transition
// table per kind still guards every state change: the derivation is trusted to
// pick a valid target, but assertTransition is the one place that would catch
// a bug in it turning into silent data corruption instead of a thrown error.

import type { LocalSiteEventMedia, NewSiteEvent } from './siteEvents';
// SiteEventMediaKind/Role are declared in tools/types.ts (plan 2 task 2) and
// only used structurally inside siteEvents.ts's own interfaces there, never
// re-exported from that file - so they are imported from their actual home.
import type { SiteEventMediaKind, SiteEventMediaRole } from './types';

export type QueueState =
  | 'queued'
  | 'uploading'
  | 'analyzing'
  | 'draft_ready'
  | 'closing'
  | 'done'
  | 'superseded'
  | 'failed';

export type QueueJobKind = 'capture' | 'close';

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

/** Fields every job carries, whatever its kind. */
interface QueueJobBase {
  /**
   * Schema version this record was written under (see CAPTURE_QUEUE_ENTRY_VERSION
   * and upgradeEntry below). This project ships JS-only fixes via OTA
   * (`eas update --branch preview`), so a phone can load a new bundle while
   * AsyncStorage still holds entries written by the old shape - this field is
   * what lets the store detect that instead of crashing on a mismatched entry.
   */
  version: 2;
  /** A capture job: the same id as the eventual site_events row (spec §7). A close job: a fresh uuid. */
  id: string;
  /** The signed-in profile this entry belongs to. A shared phone must not mix supervisors (§7). */
  ownerId: string;
  projectId: string;
  media: QueueMediaItem[];
  state: QueueState;
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
   * action left is discardEntryLocally.
   */
  unrecoverable: boolean;
  /**
   * Classification of the most recent recordFailure call (see recordFailure's
   * JSDoc for what counts as which). Absent on entries that have never failed
   * and on legacy entries loaded before this field existed - callers should
   * treat a missing value the same as 'transient'.
   */
  lastFailureKind?: 'transient' | 'permanent';
}

export interface CaptureJob extends QueueJobBase {
  kind: 'capture';
  roomId: string;
  reporterId: string;
  gateCode: string | null;
  rawText: string | null;
  capturedAt: string;
  /** Work-group name hints captured at enqueue time, so a later drain doesn't need boqItems loaded. */
  workGroupNames: string[];
  eventInserted: boolean;
  analysisRequested: boolean;
}

/** Who the server says closed the event, when this job's own close found it already closed. */
export interface ClosedElsewhere {
  closedByName: string | null;
  closedAt: string;
}

export interface CloseJob extends QueueJobBase {
  kind: 'close';
  /** The event being closed. The job's own `id` is a fresh uuid, never this (closure spec §4.1). */
  eventId: string;
  roomId: string;
  /** Rendered on the Beranda card, which must work with no signal. */
  eventTitle: string;
  /** Exactly what close_site_event receives: the trimmed note, or null. */
  note: string | null;
  mediaInserted: boolean;
  closeOutcome: null | 'closed' | 'not_open';
  closedElsewhere: ClosedElsewhere | null;
}

export type CaptureQueueEntry = CaptureJob | CloseJob;

// ─── Versioning / safe reload ────────────────────────────────────────────────

/** Bump this whenever an entry's shape changes in a way an old reader can't safely load as-is. */
export const CAPTURE_QUEUE_ENTRY_VERSION = 2 as const;

/**
 * Validates a value loaded from persistence, or returns null if it isn't one
 * this code understands. A record with no `version` field, or version 1, is a
 * capture job written before close jobs existed: it is validated with the v1
 * rules and returned as `{ ...raw, version: 2, kind: 'capture' }` - the kind is
 * SET, never read from the record - so every report queued before this
 * release drains exactly as before. A version 2 record validates by its
 * `kind`. Anything else is refused rather than guessed at; the store leaves a
 * refused record in storage untouched and excludes it from the load.
 */
export function upgradeEntry(raw: unknown): CaptureQueueEntry | null {
  if (!isRecord(raw)) return null;
  const version = raw.version ?? 1;
  if (version === 1) {
    if (!isValidCaptureFields(raw)) return null;
    return { ...(raw as unknown as Omit<CaptureJob, 'version' | 'kind'>), version: 2, kind: 'capture' };
  }
  if (version !== 2) return null;
  if (raw.kind === 'capture') return isValidCaptureFields(raw) ? (raw as unknown as CaptureJob) : null;
  if (raw.kind === 'close') return isValidCloseFields(raw) ? (raw as unknown as CloseJob) : null;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const CAPTURE_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'draft_ready', 'done', 'failed'];
const CLOSE_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'closing', 'done', 'superseded', 'failed'];

function isValidMediaItem(value: unknown): value is QueueMediaItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.localUri === 'string' &&
    typeof value.role === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.ext === 'string' &&
    (value.durationS === null || typeof value.durationS === 'number') &&
    typeof value.sortOrder === 'number' &&
    typeof value.capturedAt === 'string' &&
    typeof value.uploaded === 'boolean' &&
    (value.bytes === null || typeof value.bytes === 'number')
  );
}

function isValidBookkeeping(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.ownerId === 'string' &&
    typeof value.projectId === 'string' &&
    Array.isArray(value.media) &&
    value.media.every(isValidMediaItem) &&
    typeof value.localCleanedUp === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.attempts === 'number' &&
    typeof value.consecutiveFailures === 'number' &&
    isStringOrNull(value.lastError) &&
    isStringOrNull(value.lastAttemptAt) &&
    typeof value.needsAttention === 'boolean' &&
    typeof value.unrecoverable === 'boolean' &&
    (value.lastFailureKind === undefined || value.lastFailureKind === 'transient' || value.lastFailureKind === 'permanent')
  );
}

/** The v1 rules, unchanged: a capture record from before close jobs existed passes exactly these. */
function isValidCaptureFields(value: Record<string, unknown>): boolean {
  return (
    isValidBookkeeping(value) &&
    typeof value.roomId === 'string' &&
    typeof value.reporterId === 'string' &&
    isStringOrNull(value.gateCode) &&
    isStringOrNull(value.rawText) &&
    typeof value.capturedAt === 'string' &&
    Array.isArray(value.workGroupNames) &&
    value.workGroupNames.every((n) => typeof n === 'string') &&
    typeof value.state === 'string' &&
    CAPTURE_STATES.includes(value.state as QueueState) &&
    typeof value.eventInserted === 'boolean' &&
    typeof value.analysisRequested === 'boolean'
  );
}

function isValidClosedElsewhere(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value) && isStringOrNull(value.closedByName) && typeof value.closedAt === 'string';
}

function isValidCloseFields(value: Record<string, unknown>): boolean {
  return (
    isValidBookkeeping(value) &&
    (value.media as unknown[]).length <= 1 &&
    typeof value.eventId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.eventTitle === 'string' &&
    isStringOrNull(value.note) &&
    typeof value.state === 'string' &&
    CLOSE_STATES.includes(value.state as QueueState) &&
    typeof value.mediaInserted === 'boolean' &&
    (value.closeOutcome === null || value.closeOutcome === 'closed' || value.closeOutcome === 'not_open') &&
    isValidClosedElsewhere(value.closedElsewhere)
  );
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

function toQueueMedia(m: LocalSiteEventMedia): QueueMediaItem {
  return {
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
  };
}

export function enqueueCapture(params: NewCaptureParams): CaptureJob {
  const { event } = params;
  return {
    version: CAPTURE_QUEUE_ENTRY_VERSION,
    kind: 'capture',
    id: event.id,
    ownerId: params.ownerId,
    projectId: event.projectId,
    roomId: event.roomId,
    reporterId: event.reporterId,
    gateCode: event.gateCode,
    rawText: event.rawText,
    capturedAt: event.capturedAt,
    media: event.media.map(toQueueMedia),
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

export interface NewCloseParams {
  /** A fresh client uuid for the JOB, never the event id (closure spec §4.1). */
  id: string;
  ownerId: string;
  eventId: string;
  projectId: string;
  roomId: string;
  eventTitle: string;
  /** The note as typed; stored trimmed, or null when blank - exactly what the RPC receives. */
  note: string;
  /** Zero or one closure photo. Its localUri must already point at the queue's own copy. */
  closurePhoto: LocalSiteEventMedia | null;
  nowIso: string;
}

export function enqueueClose(params: NewCloseParams): CloseJob {
  const note = params.note.trim();
  return {
    version: CAPTURE_QUEUE_ENTRY_VERSION,
    kind: 'close',
    id: params.id,
    ownerId: params.ownerId,
    projectId: params.projectId,
    eventId: params.eventId,
    roomId: params.roomId,
    eventTitle: params.eventTitle,
    note: note ? note : null,
    media: params.closurePhoto
      ? [toQueueMedia({ ...params.closurePhoto, kind: 'photo', role: 'closure' })]
      : [],
    state: 'queued',
    mediaInserted: false,
    closeOutcome: null,
    closedElsewhere: null,
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

/**
 * Back to the shape tools/siteEvents.ts's upload/insert functions take.
 * Valid before cleanup only: throws if called once localCleanedUp is true,
 * because at that point media[].localUri points at files the store has
 * already deleted and there is nothing left to rebuild an upload/insert from.
 */
export function toNewSiteEvent(entry: CaptureJob): NewSiteEvent {
  if (entry.localCleanedUp) {
    throw new Error(
      'captureQueue: toNewSiteEvent called on an entry whose local files were already cleaned up.',
    );
  }
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

/**
 * The storage folder a job's media belongs in. A capture job's id IS the
 * event id; a close job's is not, and 097's path guard refuses any media row
 * outside site-events/{projectId}/{eventId}/.
 */
export function mediaCarrierId(entry: CaptureQueueEntry): string {
  return entry.kind === 'close' ? entry.eventId : entry.id;
}

/** { mediaId: bytes } for buildMediaRows/insertSiteEvent, straight from what upload already recorded. */
export function bytesById(entry: CaptureQueueEntry): Record<string, number | null> {
  return Object.fromEntries(entry.media.map((m) => [m.id, m.bytes]));
}

// ─── State derivation and the transition tables ──────────────────────────────

function deriveCaptureState(
  entry: Pick<CaptureJob, 'media' | 'eventInserted' | 'analysisRequested' | 'localCleanedUp'>,
): Exclude<QueueState, 'failed'> {
  if (entry.localCleanedUp) return 'done';
  if (entry.analysisRequested) return 'draft_ready';
  if (entry.eventInserted) return 'analyzing';
  if (entry.media.some((m) => m.uploaded)) return 'uploading';
  return 'queued';
}

function deriveCloseState(
  entry: Pick<CloseJob, 'media' | 'mediaInserted' | 'closeOutcome' | 'localCleanedUp'>,
): Exclude<QueueState, 'failed'> {
  if (entry.localCleanedUp) return entry.closeOutcome === 'not_open' ? 'superseded' : 'done';
  if (entry.closeOutcome !== null || entry.mediaInserted || entry.media.length === 0) return 'closing';
  if (entry.media.some((m) => m.uploaded)) return 'uploading';
  return 'queued';
}

function deriveState(entry: CaptureQueueEntry): Exclude<QueueState, 'failed'> {
  return entry.kind === 'close' ? deriveCloseState(entry) : deriveCaptureState(entry);
}

/**
 * Every legal (from, to) pair, per kind. 'failed' can resume into whatever the
 * derivation says fits the entry's actual progress, because a step can fail
 * at any point; every forward state can also fail. 'done' and 'superseded'
 * are terminal. A capture job never enters 'closing' or 'superseded', and a
 * close job never enters 'analyzing' or 'draft_ready'.
 */
const CAPTURE_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
  queued: ['uploading', 'failed'],
  uploading: ['uploading', 'analyzing', 'failed'],
  analyzing: ['analyzing', 'draft_ready', 'failed'],
  draft_ready: ['draft_ready', 'done', 'failed'],
  failed: ['queued', 'uploading', 'analyzing', 'draft_ready'],
  done: [],
  closing: [],
  superseded: [],
};

const CLOSE_TRANSITIONS: Record<QueueState, ReadonlyArray<QueueState>> = {
  queued: ['uploading', 'closing', 'failed'],
  uploading: ['uploading', 'closing', 'failed'],
  closing: ['closing', 'done', 'superseded', 'failed'],
  failed: ['queued', 'uploading', 'closing'],
  done: [],
  superseded: [],
  analyzing: [],
  draft_ready: [],
};

export class IllegalQueueTransitionError extends Error {
  constructor(from: QueueState, to: QueueState, kind: QueueJobKind) {
    super(`captureQueue: illegal ${kind} transition ${from} -> ${to}`);
    this.name = 'IllegalQueueTransitionError';
  }
}

/**
 * Exported so a test can pin both tables down exhaustively against literal
 * copies of the intended tables. `kind` defaults to 'capture', which keeps
 * every two-argument call written before close jobs existed meaning the same.
 */
export function assertTransition(from: QueueState, to: QueueState, kind: QueueJobKind = 'capture'): void {
  if (from === to) return;
  const table = kind === 'close' ? CLOSE_TRANSITIONS : CAPTURE_TRANSITIONS;
  if (!table[from].includes(to)) {
    throw new IllegalQueueTransitionError(from, to, kind);
  }
}

function withProgress<E extends CaptureQueueEntry>(entry: E, now: string, patch: Partial<CaptureJob> | Partial<CloseJob>): E {
  const next = { ...entry, ...patch } as E;
  const state = deriveState(next);
  assertTransition(entry.state, state, entry.kind);
  return {
    ...next,
    state,
    consecutiveFailures: 0,
    needsAttention: false,
    lastError: null,
    lastFailureKind: undefined,
    lastAttemptAt: now,
  };
}

// ─── What to do next ──────────────────────────────────────────────────────────

export type QueueAction =
  | { kind: 'upload'; mediaId: string }
  | { kind: 'insert' }
  | { kind: 'invoke' }
  | { kind: 'insert_media' }
  | { kind: 'close' }
  | { kind: 'lookup_closer' }
  | { kind: 'cleanup' }
  | { kind: 'none' };

/**
 * Pure "what next", independent of timing. The worker gates on
 * isReadyToAttempt(entry, now) before calling this, so a backing-off or
 * flagged entry is simply not asked.
 */
export function nextStep(entry: CaptureQueueEntry): QueueAction {
  if (entry.state === 'done' || entry.state === 'superseded' || entry.unrecoverable || entry.needsAttention) {
    return { kind: 'none' };
  }
  return entry.kind === 'close' ? nextCloseStep(entry) : nextCaptureStep(entry);
}

function nextCaptureStep(entry: CaptureJob): QueueAction {
  const pending = entry.media.find((m) => !m.uploaded);
  if (pending) return { kind: 'upload', mediaId: pending.id };
  if (!entry.eventInserted) return { kind: 'insert' };
  if (!entry.analysisRequested) return { kind: 'invoke' };
  if (!entry.localCleanedUp) return { kind: 'cleanup' };
  return { kind: 'none' };
}

/**
 * Upload, then the media row, then the RPC. After an outcome of `not_open`
 * the job reads who closed the event before cleaning up, so the card can say
 * so; the RPC is never asked again once any outcome is recorded.
 */
function nextCloseStep(entry: CloseJob): QueueAction {
  const pending = entry.media.find((m) => !m.uploaded);
  if (pending) return { kind: 'upload', mediaId: pending.id };
  if (entry.media.length > 0 && !entry.mediaInserted) return { kind: 'insert_media' };
  if (entry.closeOutcome === null) return { kind: 'close' };
  if (entry.closeOutcome === 'not_open' && entry.closedElsewhere === null) return { kind: 'lookup_closer' };
  if (!entry.localCleanedUp) return { kind: 'cleanup' };
  return { kind: 'none' };
}

// ─── Attempt bookkeeping ──────────────────────────────────────────────────────

/**
 * Call before starting I/O for a step, so attempts/lastAttemptAt reflect
 * reality even if the app is killed mid-step. lastAttemptAt is deliberately
 * written again by whichever mutator ends the attempt - the two writes
 * bracket one attempt (start, then end) and neither is redundant.
 */
export function beginAttempt<E extends CaptureQueueEntry>(entry: E, now: string): E {
  return { ...entry, attempts: entry.attempts + 1, lastAttemptAt: now };
}

export function markUploaded<E extends CaptureQueueEntry>(entry: E, mediaId: string, bytes: number | null, now: string): E {
  const media = entry.media.map((m) => (m.id === mediaId ? { ...m, uploaded: true, bytes } : m));
  return withProgress(entry, now, { media });
}

export function markInserted(entry: CaptureJob, now: string): CaptureJob {
  return withProgress(entry, now, { eventInserted: true });
}

/**
 * The invoke step's own outcome (ok, deferred by the daily cap, or a network
 * error) is deliberately NOT distinguished here: the queue hands off after
 * one best-effort attempt either way. See captureQueueWorker.ts's module
 * comment for why retrying invoke is not the queue's job.
 */
export function markAnalysisRequested(entry: CaptureJob, now: string): CaptureJob {
  return withProgress(entry, now, { analysisRequested: true });
}

export function markClosureMediaInserted(entry: CloseJob, now: string): CloseJob {
  return withProgress(entry, now, { mediaInserted: true });
}

/**
 * `not_open` is an outcome, not a failure: somebody closed the event first.
 * No strike, no lastError, and the RPC is never called for this job again.
 */
export function markCloseOutcome(entry: CloseJob, outcome: 'closed' | 'not_open', now: string): CloseJob {
  return withProgress(entry, now, { closeOutcome: outcome });
}

export function markClosedElsewhere(entry: CloseJob, closedElsewhere: ClosedElsewhere, now: string): CloseJob {
  return withProgress(entry, now, { closedElsewhere });
}

export function markCleanedUp<E extends CaptureQueueEntry>(entry: E, now: string): E {
  return withProgress(entry, now, { localCleanedUp: true });
}

/**
 * `kind` (default 'transient') classifies whether the failure is worth
 * retrying on its own; existing two-argument call sites keep today's
 * behaviour exactly.
 *
 * - 'transient': a network drop, timeout, or 5xx - the same request may
 *   simply succeed on the next attempt. Backs off and retries,
 *   flagging for attention only after MAX_CONSECUTIVE_FAILURES in a row.
 * - 'permanent': a response that retrying cannot fix - an auth/RLS refusal,
 *   a SITE_EVENT_* refusal from an RPC, or any other 4xx that encodes a
 *   decision rather than a transient hiccup. A permanent failure sets
 *   needsAttention immediately, without waiting for five strikes, but - like
 *   every other failure - never deletes the entry; the person still has to
 *   act on it by hand ("Coba lagi" / "Buang" / "Batalkan").
 */
export function recordFailure<E extends CaptureQueueEntry>(
  entry: E,
  error: string,
  now: string,
  kind: 'transient' | 'permanent' = 'transient',
): E {
  assertTransition(entry.state, 'failed', entry.kind);
  const consecutiveFailures = entry.consecutiveFailures + 1;
  return {
    ...entry,
    state: 'failed',
    consecutiveFailures,
    lastError: error,
    lastFailureKind: kind,
    lastAttemptAt: now,
    needsAttention: kind === 'permanent' || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
  };
}

/** "Coba lagi": clears the flag and the failure count so nextStep is asked again. Safe to call on any state. */
export function retryEntry<E extends CaptureQueueEntry>(entry: E, now: string): E {
  if (entry.unrecoverable) return entry;
  const state = deriveState(entry);
  assertTransition(entry.state, state, entry.kind);
  return {
    ...entry,
    state,
    needsAttention: false,
    consecutiveFailures: 0,
    lastError: null,
    lastFailureKind: undefined,
    lastAttemptAt: now,
  };
}

/**
 * True while the job still needs a local file the OS may purge: a capture job
 * until its event is inserted (upload always finishes before insert), a close
 * job until its closure photo is uploaded.
 */
export function needsLocalMedia(entry: CaptureQueueEntry): boolean {
  return entry.kind === 'close' ? entry.media.some((m) => !m.uploaded) : !entry.eventInserted;
}

/**
 * Set by captureQueueStore.ts's load-time recovery pass when a needed local
 * file is gone. Throws once nothing local is needed any more (a capture job
 * whose event is inserted, a close job whose photo is uploaded): marking such
 * a job locally discardable would hide something the server already has.
 */
export function markUnrecoverable<E extends CaptureQueueEntry>(entry: E, reason: string): E {
  if (!needsLocalMedia(entry)) {
    throw new Error(
      entry.kind === 'close'
        ? 'captureQueue: markUnrecoverable called on a close job whose photo is already uploaded; there is no local file left to lose.'
        : 'captureQueue: markUnrecoverable called on an entry whose event is already inserted; the server already knows about it, so it must not be marked locally discardable.',
    );
  }
  const state = deriveState(entry);
  assertTransition(entry.state, state, entry.kind);
  return { ...entry, state, unrecoverable: true, needsAttention: true, lastError: reason };
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/** 30s, 60s, 120s, 240s, 480s, capped at 15 min. Field signal is intermittent, not down for good. */
export function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(30_000 * 2 ** (consecutiveFailures - 1), 15 * 60 * 1000);
}

export function isReadyToAttempt(entry: CaptureQueueEntry, nowMs: number): boolean {
  if (entry.state === 'done' || entry.state === 'superseded' || entry.needsAttention || entry.unrecoverable) return false;
  if (entry.state !== 'failed' || !entry.lastAttemptAt) return true;
  return nowMs - new Date(entry.lastAttemptAt).getTime() >= backoffMs(entry.consecutiveFailures);
}

// ─── Beranda summary selectors ────────────────────────────────────────────────

const WAITING_STATES: ReadonlyArray<QueueState> = ['queued', 'uploading', 'analyzing', 'closing', 'failed'];

export function waitingCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => WAITING_STATES.includes(e.state)).length;
}

export function draftReadyCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.state === 'draft_ready').length;
}

export function attentionCount(entries: ReadonlyArray<CaptureQueueEntry>): number {
  return entries.filter((e) => e.needsAttention).length;
}
```

- [ ] **Step 5: Run the machine tests to verify they pass**

Run:

```bash
npx jest tools/__tests__/captureQueue.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 6: Add the worker's close tests**

In `tools/__tests__/captureQueueWorker.test.ts`, find this block (it occurs exactly once):

```ts
const upload = jest.fn();
const insert = jest.fn();
const invoke = jest.fn();
jest.mock('../siteEvents', () => ({
  uploadSiteEventMedia: (...args: unknown[]) => upload(...args),
  insertSiteEvent: (...args: unknown[]) => insert(...args),
  invokeSiteEventAnalysis: (...args: unknown[]) => invoke(...args),
}));

import { enqueueCapture, recordFailure, type CaptureQueueEntry } from '../captureQueue';
```

and replace it with:

```ts
const upload = jest.fn();
const insert = jest.fn();
const invoke = jest.fn();
const insertClosure = jest.fn();
const closeRpc = jest.fn();
const lookupCloser = jest.fn();
jest.mock('../siteEvents', () => ({
  uploadSiteEventMedia: (...args: unknown[]) => upload(...args),
  insertSiteEvent: (...args: unknown[]) => insert(...args),
  invokeSiteEventAnalysis: (...args: unknown[]) => invoke(...args),
  insertClosureMedia: (...args: unknown[]) => insertClosure(...args),
  closeSiteEventRpc: (...args: unknown[]) => closeRpc(...args),
  lookupSiteEventCloser: (...args: unknown[]) => lookupCloser(...args),
}));

import { enqueueCapture, enqueueClose, recordFailure, type CaptureQueueEntry, type CloseJob } from '../captureQueue';
```

In `tools/__tests__/captureQueueWorker.test.ts`, find this block (it occurs exactly once):

```ts
  invoke.mockReset().mockResolvedValue({ ok: true, code: 'ANALYZED', status: 'draft' });
  stopCaptureQueueWorker();
```

and replace it with:

```ts
  invoke.mockReset().mockResolvedValue({ ok: true, code: 'ANALYZED', status: 'draft' });
  insertClosure.mockReset().mockResolvedValue({});
  closeRpc.mockReset().mockResolvedValue({ ok: true });
  lookupCloser.mockReset().mockResolvedValue({ closedByName: 'Budi Santoso', closedAt: '2026-09-17T07:05:00.000Z' });
  stopCaptureQueueWorker();
```

Append to the end of `tools/__tests__/captureQueueWorker.test.ts` (after its current last line, keeping one blank line between):

```ts
// ─── Close jobs (closure spec 2026-09-26 §4.4) ────────────────────────────────

function seedClose(id: string, createdAt: string, opts: { photo?: boolean } = {}): CloseJob {
  const job = enqueueClose({
    id, ownerId: USER, eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian', note: ' Sudah ditambal ',
    closurePhoto: opts.photo === false
      ? null
      : { id: 'cm1', localUri: 'file:///q/cm1.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: createdAt },
    nowIso: createdAt,
  });
  store.set(id, job);
  return job;
}

const closeJobIn = (id: string): CloseJob => store.get(id) as CloseJob;

describe('a close job', () => {
  it("uploads into the event's folder, inserts the media row, calls the RPC, in that order, then removes the job", async () => {
    upload.mockResolvedValueOnce({ bytesById: { cm1: 2048 } });
    seedClose('job1', '2026-09-17T02:00:00.000Z');
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(upload).toHaveBeenCalledWith({ id: 'ev1', projectId: 'p1', media: [expect.objectContaining({ id: 'cm1', role: 'closure' })] });
    expect(insertClosure).toHaveBeenCalledWith(
      { id: 'ev1', projectId: 'p1', media: [expect.objectContaining({ id: 'cm1', kind: 'photo', role: 'closure' })] },
      { cm1: 2048 },
    );
    expect(closeRpc).toHaveBeenCalledWith('ev1', 'Sudah ditambal');
    const order = [upload, insertClosure, closeRpc].map((m) => m.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(lookupCloser).not.toHaveBeenCalled();
    expect(calls).toContain('removeEntry:job1');
  });

  it('with no photo, calls only the RPC', async () => {
    seedClose('job1', '2026-09-17T02:00:00.000Z', { photo: false });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(insertClosure).not.toHaveBeenCalled();
    expect(closeRpc).toHaveBeenCalledWith('ev1', 'Sudah ditambal');
    expect(calls).toContain('removeEntry:job1');
  });

  it("on NOT_OPEN reads the server, ends superseded with the server's closer, records no failure, and stays until acknowledged", async () => {
    closeRpc.mockResolvedValueOnce({ notOpen: true });
    seedClose('job1', '2026-09-17T02:00:00.000Z', { photo: false });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    expect(lookupCloser).toHaveBeenCalledWith('ev1');
    expect(closeJobIn('job1')).toMatchObject({
      state: 'superseded',
      closeOutcome: 'not_open',
      closedElsewhere: { closedByName: 'Budi Santoso', closedAt: '2026-09-17T07:05:00.000Z' },
      consecutiveFailures: 0,
      lastError: null,
      needsAttention: false,
    });
    expect(calls.filter((c) => c.endsWith(':failed'))).toEqual([]);
    expect(calls).not.toContain('removeEntry:job1');

    triggerDrain();
    await flush();
    await flush();
    expect(closeRpc).toHaveBeenCalledTimes(1);
    expect(lookupCloser).toHaveBeenCalledTimes(1);
    expect(store.has('job1')).toBe(true);
  });

  it('a failed lookup retries only the lookup, never the RPC', async () => {
    closeRpc.mockResolvedValueOnce({ notOpen: true });
    lookupCloser.mockResolvedValueOnce({ error: 'Status kejadian gagal dibaca: jaringan turun', kind: 'transient' });
    seedClose('job1', '2026-09-17T02:00:00.000Z', { photo: false });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();
    await flush();

    const failed = closeJobIn('job1');
    expect(failed).toMatchObject({ state: 'failed', closeOutcome: 'not_open', closedElsewhere: null, consecutiveFailures: 1 });
    expect(failed.lastError).toBe('Baca status kejadian gagal: Status kejadian gagal dibaca: jaringan turun');

    store.set('job1', { ...failed, lastAttemptAt: new Date(0).toISOString() });
    triggerDrain();
    await flush();
    await flush();
    await flush();

    expect(closeRpc).toHaveBeenCalledTimes(1);
    expect(lookupCloser).toHaveBeenCalledTimes(2);
    expect(closeJobIn('job1').state).toBe('superseded');
  });

  it('flags a photo refusal at once, carrying the mapped copy', async () => {
    closeRpc.mockResolvedValueOnce({
      error: 'Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
      kind: 'permanent',
    });
    seedClose('job1', '2026-09-17T02:00:00.000Z', { photo: false });
    startCaptureQueueWorker(USER);
    await flush();
    await flush();

    expect(closeJobIn('job1')).toMatchObject({
      state: 'failed', needsAttention: true, lastFailureKind: 'permanent', consecutiveFailures: 1, closeOutcome: null,
      lastError: 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
    });
  });

  it('a network error on the RPC flags only after five in a row', async () => {
    closeRpc.mockResolvedValue({ error: 'Gagal menyimpan: Network request failed', kind: 'transient' });
    seedClose('job1', '2026-09-17T02:00:00.000Z', { photo: false });
    for (let i = 1; i <= 5; i++) {
      store.set('job1', { ...closeJobIn('job1'), lastAttemptAt: new Date(0).toISOString() });
      startCaptureQueueWorker(USER);
      // eslint-disable-next-line no-await-in-loop
      await flush();
      // eslint-disable-next-line no-await-in-loop
      await flush();
      stopCaptureQueueWorker();
      expect(closeJobIn('job1')).toMatchObject({ consecutiveFailures: i, needsAttention: i === 5 });
    }
    expect(closeRpc).toHaveBeenCalledTimes(5);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run:

```bash
npx jest tools/__tests__/captureQueueWorker.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run`, with the errors inside `tools/captureQueueWorker.ts`: the old `runStep` does not compile against the new machine (`TS2366: Function lacks ending return statement ...`, `TS2339: Property 'workGroupNames' does not exist on type 'CaptureQueueEntry'`, `TS2739` for `STEP_LABEL`).

- [ ] **Step 8: Teach the worker the three close steps**

Two edits in `tools/captureQueueWorker.ts`. First the imports:

In `tools/captureQueueWorker.ts`, find this block (it occurs exactly once):

```ts
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
import {
  insertSiteEvent,
  invokeSiteEventAnalysis,
  uploadSiteEventMedia,
  type SiteEventErrorKind,
} from './siteEvents';
```

and replace it with:

```ts
import {
  beginAttempt,
  bytesById,
  isReadyToAttempt,
  markAnalysisRequested,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  markClosureMediaInserted,
  markInserted,
  markUploaded,
  mediaCarrierId,
  nextStep,
  recordFailure,
  retryEntry,
  toLocalMedia,
  toNewSiteEvent,
  type CaptureJob,
  type CaptureQueueEntry,
  type CloseJob,
  type QueueAction,
} from './captureQueue';
import { deleteLocalMedia, loadQueue, removeEntry, saveEntry } from './captureQueueStore';
import {
  closeSiteEventRpc,
  insertClosureMedia,
  insertSiteEvent,
  invokeSiteEventAnalysis,
  lookupSiteEventCloser,
  uploadSiteEventMedia,
  type SiteEventErrorKind,
} from './siteEvents';
```

In `tools/captureQueueWorker.ts`, replace everything from the line that starts `async function runStep(userId: string, entry: CaptureQueueEntry, step: QueueAction)` up to, but not including, the line that starts `function describeStepError` (leave one blank line before that line) with exactly this content:

```ts
async function runStep(userId: string, entry: CaptureQueueEntry, step: QueueAction): Promise<CaptureQueueEntry> {
  const now = new Date().toISOString();
  switch (step.kind) {
    case 'upload': {
      const item = entry.media.find((m) => m.id === step.mediaId);
      if (!item) return markUploaded(entry, step.mediaId, null, now); // defensive; nextStep only asks for media that exists
      // A close job's media belongs in its EVENT's folder, not under the job id:
      // 097's path guard refuses a media row outside site-events/{projectId}/{eventId}/.
      const result = await uploadSiteEventMedia({ id: mediaCarrierId(entry), projectId: entry.projectId, media: [toLocalMedia(item)] });
      if (result.error) throw new StepFailure(result.error, result.kind);
      return markUploaded(entry, item.id, result.bytesById[item.id] ?? null, now);
    }
    case 'insert': {
      const job = asCapture(entry, step);
      const result = await insertSiteEvent(toNewSiteEvent(job), bytesById(job));
      if (result.error) throw new StepFailure(result.error, result.kind);
      return markInserted(job, now);
    }
    case 'invoke': {
      const job = asCapture(entry, step);
      try {
        const result = await invokeSiteEventAnalysis(job.id, { workGroupNames: job.workGroupNames });
        if (!result.ok) {
          console.warn('[captureQueueWorker] analysis deferred for', job.id, result.code, result.error);
        }
      } catch (err) {
        console.warn('[captureQueueWorker] analysis invoke failed for', job.id, (err as Error).message);
      }
      return markAnalysisRequested(job, now);
    }
    case 'insert_media': {
      const job = asClose(entry, step);
      const result = await insertClosureMedia(
        { id: job.eventId, projectId: job.projectId, media: job.media.map(toLocalMedia) },
        bytesById(job),
      );
      if (result.error) throw new StepFailure(result.error, result.kind);
      return markClosureMediaInserted(job, now);
    }
    case 'close': {
      const job = asClose(entry, step);
      const result = await closeSiteEventRpc(job.eventId, job.note);
      // Somebody closed it first. An outcome, not a failure: no strike, no
      // lastError, and nextStep never asks for the RPC again (closure spec §4.4).
      if ('notOpen' in result) return markCloseOutcome(job, 'not_open', now);
      if ('error' in result) throw new StepFailure(result.error, result.kind);
      return markCloseOutcome(job, 'closed', now);
    }
    case 'lookup_closer': {
      const job = asClose(entry, step);
      const result = await lookupSiteEventCloser(job.eventId);
      if ('error' in result) throw new StepFailure(result.error, result.kind);
      return markClosedElsewhere(job, result, now);
    }
    case 'cleanup': {
      try {
        await deleteLocalMedia(userId, entry.id);
      } catch (err) {
        // The server already has what this job delivered by the time cleanup
        // runs. A locked file or an unmounted SD card must not re-label it as
        // "menunggu sinyal" - which is what recording this as a step failure
        // would do, and there would be no way out of it: discardEntryLocally
        // refuses a delivered job, and "Coba lagi" would only re-run the same
        // failing delete. The store's orphan sweep collects the directory on a
        // later loadQueue instead.
        console.warn('[captureQueueWorker] local cleanup failed for', entry.id, (err as Error).message);
      }
      return markCleanedUp(entry, now);
    }
    case 'none':
      return entry;
  }
}

/** nextStep never mixes kinds; a mismatch here is a bug, reported permanently rather than retried forever. */
function asCapture(entry: CaptureQueueEntry, step: QueueAction): CaptureJob {
  if (entry.kind !== 'capture') throw new StepFailure(`Langkah ${step.kind} bukan untuk penutupan kejadian.`, 'permanent');
  return entry;
}

function asClose(entry: CaptureQueueEntry, step: QueueAction): CloseJob {
  if (entry.kind !== 'close') throw new StepFailure(`Langkah ${step.kind} bukan untuk laporan baru.`, 'permanent');
  return entry;
}

const STEP_LABEL: Record<Exclude<QueueAction['kind'], 'none'>, string> = {
  upload: 'Unggah berkas',
  insert: 'Simpan kejadian',
  invoke: 'Jalankan analisis',
  insert_media: 'Simpan foto penutupan',
  close: 'Tandai selesai',
  lookup_closer: 'Baca status kejadian',
  cleanup: 'Bersihkan berkas lokal',
};
```

- [ ] **Step 9: Run the worker tests to verify they pass**

Run:

```bash
npx jest tools/__tests__/captureQueueWorker.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS: every existing capture test and the six close tests.

- [ ] **Step 10: Keep the store, the Beranda model and their tests compiling**

The store and the model read capture-only fields (`eventInserted`, `rawText`) on what is now a union. These edits change no capture behaviour; close jobs cannot exist yet (nothing enqueues one until Task 4), and the model lists them from Task 5. In `tools/captureQueueStore.ts`:

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
import {
  enqueueCapture,
  markUnrecoverable,
  upgradeEntry,
  type CaptureQueueEntry,
} from './captureQueue';
```

and replace it with:

```ts
import {
  enqueueCapture,
  markUnrecoverable,
  needsLocalMedia,
  upgradeEntry,
  type CaptureJob,
  type CaptureQueueEntry,
} from './captureQueue';
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
  // Upload always finishes before insert is attempted (captureQueue.ts's
  // nextStep ordering), so a still-needed local file can only go missing
  // before eventInserted flips true. After that, or once already flagged,
  // there is nothing new to check.
  if (entry.eventInserted || entry.unrecoverable) return entry;
```

and replace it with:

```ts
  // A capture job needs its files until the event is inserted (upload always
  // finishes first); a close job needs its photo until it is uploaded
  // (captureQueue.ts's needsLocalMedia). After that, or once already flagged,
  // there is nothing new to check.
  if (!needsLocalMedia(entry) || entry.unrecoverable) return entry;
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
export async function enqueueNewCapture(request: NewCaptureRequest): Promise<CaptureQueueEntry> {
```

and replace it with:

```ts
export async function enqueueNewCapture(request: NewCaptureRequest): Promise<CaptureJob> {
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
  if (entry.eventInserted) {
    return { error: 'Kejadian ini sudah tersimpan di server; buang lewat layar konfirmasi.' };
  }
```

and replace it with:

```ts
  if (entry.kind === 'capture' && entry.eventInserted) {
    return { error: 'Kejadian ini sudah tersimpan di server; buang lewat layar konfirmasi.' };
  }
```

- [ ] **Step 11: Update the store's legacy-entry tests for version 2**

In `tools/__tests__/captureQueueStore.test.ts`, find this block (it occurs exactly once):

```ts
describe('legacy entries without a version field (fix 4: upgradeEntry)', () => {
  it('still loads an entry written before the version field existed', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const legacyShape: Record<string, unknown> = { ...entry };
    delete legacyShape.version;
    await AsyncStorage.setItem(entryKey(USER, 'e1'), JSON.stringify(legacyShape));

    const [loaded] = await loadQueue(USER);
    expect(loaded.id).toBe('e1');
    expect(loaded.version).toBe(1);
  });
});
```

and replace it with:

```ts
describe('legacy entries without a version field (fix 4: upgradeEntry)', () => {
  it('still loads an entry written before the version field existed, as a v2 capture job', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const legacyShape: Record<string, unknown> = { ...entry };
    delete legacyShape.version;
    delete legacyShape.kind;
    await AsyncStorage.setItem(entryKey(USER, 'e1'), JSON.stringify(legacyShape));

    const [loaded] = await loadQueue(USER);
    expect(loaded.id).toBe('e1');
    expect(loaded.version).toBe(2);
    expect(loaded.kind).toBe('capture');
  });

  it('loads a v1 record from disk, drains it as a capture job, and rewrites it as v2 on the next save', async () => {
    const entry = await enqueueNewCapture({ userId: USER, event: event(), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    const v1: Record<string, unknown> = { ...entry, version: 1 };
    delete v1.kind;
    await AsyncStorage.setItem(entryKey(USER, 'e1'), JSON.stringify(v1));

    const [loaded] = await loadQueue(USER);
    if (loaded.kind !== 'capture') throw new Error('expected a capture job');
    await saveEntry(markUploaded(loaded, 'm1', 10, '2026-09-11T02:00:05.000Z'));

    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'e1')))!);
    expect(stored).toMatchObject({ version: 2, kind: 'capture', state: 'uploading' });
  });
});
```

- [ ] **Step 12: Keep the Beranda model on capture rows for now**

In `workflows/screens/siteEvent/captureQueueModel.ts` (Task 5 replaces this function with the kind-aware one):

In `workflows/screens/siteEvent/captureQueueModel.ts`, find this block (it occurs exactly once):

```ts
import {
  draftReadyCount,
  waitingCount,
  type CaptureQueueEntry,
} from '../../../tools/captureQueue';
```

and replace it with:

```ts
import {
  draftReadyCount,
  waitingCount,
  type CaptureJob,
  type CaptureQueueEntry,
} from '../../../tools/captureQueue';
```

In `workflows/screens/siteEvent/captureQueueModel.ts`, find this block (it occurs exactly once):

```ts
  return entries
    .filter((e) => e.needsAttention)
    .map((e) => ({
```

and replace it with:

```ts
  return entries
    .filter((e): e is CaptureJob => e.kind === 'capture' && e.needsAttention)
    .map((e) => ({
```

In `workflows/__tests__/captureQueueModel.test.ts`, find this block (it occurs exactly once):

```ts
  recordFailure,
  type CaptureQueueEntry,
} from '../../tools/captureQueue';
```

and replace it with:

```ts
  recordFailure,
  type CaptureJob,
} from '../../tools/captureQueue';
```

In `workflows/__tests__/captureQueueModel.test.ts`, find this block (it occurs exactly once):

```ts
const fresh = (id: string, rawText: string | null = null): CaptureQueueEntry =>
```

and replace it with:

```ts
const fresh = (id: string, rawText: string | null = null): CaptureJob =>
```

In `workflows/__tests__/captureQueueModel.test.ts`, find this block (it occurs exactly once):

```ts
const kickedOff = (id: string): CaptureQueueEntry => {
```

and replace it with:

```ts
const kickedOff = (id: string): CaptureJob => {
```

- [ ] **Step 13: Run every queue suite**

Run:

```bash
npx jest tools/__tests__/captureQueue.test.ts tools/__tests__/captureQueueWorker.test.ts tools/__tests__/captureQueueStore.test.ts tools/__tests__/captureQueueWeb.test.ts tools/__tests__/captureQueueAppWiring.test.ts tools/__tests__/siteEventCaptureScreenQueueWiring.test.ts workflows/__tests__/captureQueueModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, all seven suites.

- [ ] **Step 14: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 15: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T3.txt` with the Write tool (never a heredoc), exactly:

```text
feat(queue): a close job kind beside capture, schema version 2

CaptureQueueEntry becomes CaptureJob | CloseJob. upgradeEntry turns every
v1 record into a v2 capture job, so reports queued today drain as before.
The close table, nextStep dispatch and the worker's insert_media, close
and lookup_closer steps land; NOT_OPEN is an outcome (superseded), not a
failure. Closure spec 2026-09-26 §4.1-§4.4.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/captureQueue.ts tools/captureQueueWorker.ts tools/captureQueueStore.ts workflows/screens/siteEvent/captureQueueModel.ts tools/__tests__/captureQueue.test.ts tools/__tests__/captureQueueWorker.test.ts tools/__tests__/captureQueueStore.test.ts workflows/__tests__/captureQueueModel.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T3.txt -- tools/captureQueue.ts tools/captureQueueWorker.ts tools/captureQueueStore.ts workflows/screens/siteEvent/captureQueueModel.ts tools/__tests__/captureQueue.test.ts tools/__tests__/captureQueueWorker.test.ts tools/__tests__/captureQueueStore.test.ts workflows/__tests__/captureQueueModel.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/captureQueue.ts`, `tools/captureQueueWorker.ts`, `tools/captureQueueStore.ts`, `workflows/screens/siteEvent/captureQueueModel.ts`, `tools/__tests__/captureQueue.test.ts`, `tools/__tests__/captureQueueWorker.test.ts`, `tools/__tests__/captureQueueStore.test.ts`, `workflows/__tests__/captureQueueModel.test.ts`.


### L2-T4 (Lane 2, Task 4): The store: `enqueueCloseJob`, `pendingCloseFor`, `acknowledgeCloseEntry`, and the discard refusal

Spec §4.1, §4.5, §4.6. `enqueueCloseJob` keeps the store's "media copies first, then the entry record" order (`captureQueueStore.ts:24-31`) and refuses a second pending close for the same event. `pendingCloseFor` is what the detail screen, the room timeline and "Perlu ditindak" read to say "Menunggu kirim". `acknowledgeCloseEntry` is "Mengerti" on a superseded job. `discardEntryLocally` refuses a close job the server already answered. A close job whose photo vanished before upload is flagged with the closure sentence instead of the capture one.

**Files:**
- Modify: `tools/captureQueueStore.ts`: import block; after `REASON_MEDIA_MISSING` (line 96); the `markUnrecoverable` call in `recoverMissingMedia` (line 334); a new block above the `deleteLocalMedia` doc comment (line 410); `discardEntryLocally` (after its capture guard)
- Test: `tools/__tests__/captureQueueStore.test.ts` (import block lines 82-95; append at end)

**Owns (no other lane edits these):** `tools/captureQueueStore.ts`, `tools/__tests__/captureQueueStore.test.ts`

**Depends on:** Lane 2 Task 3. **Lane 1 Tasks 4 and 5 and Lane 3 Task 6 wait for this commit** (they import `enqueueCloseJob`, `pendingCloseFor` and the `CloseJob` type).

- [ ] **Step 1: Write the failing tests**

In `tools/__tests__/captureQueueStore.test.ts`, find this block (it occurs exactly once):

```ts
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
  sweepOrphanedFiles,
  __clearWebStoreForTests,
} from '../captureQueueStore';
import { markInserted, markUploaded } from '../captureQueue';
```

and replace it with:

```ts
import {
  acknowledgeCloseEntry,
  CLOSE_ALREADY_PENDING,
  discardEntryLocally,
  enqueueCloseJob,
  enqueueNewCapture,
  entryDirUri,
  entryKey,
  indexKey,
  loadQueue,
  pendingCloseFor,
  REASON_CLOSURE_PHOTO_MISSING,
  removeEntry,
  saveEntry,
  subscribeToQueue,
  sweepOrphanedFiles,
  __clearWebStoreForTests,
  type NewCloseRequest,
} from '../captureQueueStore';
import {
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  markInserted,
  markUploaded,
  type CloseJob,
} from '../captureQueue';
```

Append to the end of `tools/__tests__/captureQueueStore.test.ts` (after its current last line, keeping one blank line between):

```ts
// ─── Close jobs (closure spec 2026-09-26 §4) ──────────────────────────────────

const closeRequest = (over: Partial<NewCloseRequest> = {}): NewCloseRequest => ({
  userId: USER, jobId: 'job1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian',
  note: '  Sudah ditambal  ',
  closurePhoto: {
    id: 'cm1', localUri: 'file:///tmp/cam/m1.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg',
    durationS: null, sortOrder: 0, capturedAt: '2026-09-17T02:00:00.000Z',
  },
  nowIso: '2026-09-17T02:00:01.000Z',
  ...over,
});

describe('enqueueCloseJob (native)', () => {
  it("copies the photo into the job's own folder before writing the entry", async () => {
    const result = await enqueueCloseJob(closeRequest());
    expect(result.error).toBeUndefined();
    expect(calls).toEqual([
      `mkdir:file:///doc/capture-queue/${USER}/job1/`,
      `copy:file:///tmp/cam/m1.jpg->file:///doc/capture-queue/${USER}/job1/cm1.jpg`,
    ]);
    const stored = JSON.parse((await AsyncStorage.getItem(entryKey(USER, 'job1')))!);
    expect(stored).toMatchObject({
      version: 2, kind: 'close', id: 'job1', eventId: 'ev1', note: 'Sudah ditambal', state: 'queued',
    });
    expect(stored.media[0]).toMatchObject({ id: 'cm1', role: 'closure', localUri: `file:///doc/capture-queue/${USER}/job1/cm1.jpg` });
  });

  it('touches no file when there is no photo', async () => {
    const result = await enqueueCloseJob(closeRequest({ closurePhoto: null }));
    expect(result.entry?.media).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses a second pending close for the same event, writing nothing', async () => {
    await enqueueCloseJob(closeRequest({ closurePhoto: null }));
    const second = await enqueueCloseJob(closeRequest({ jobId: 'job2', closurePhoto: null }));
    expect(second).toEqual({ error: CLOSE_ALREADY_PENDING });
    expect(second.error).toBe('Penutupan kejadian ini sudah menunggu kirim.');
    expect(await AsyncStorage.getItem(entryKey(USER, 'job2'))).toBeNull();
  });

  it('accepts a new close once the earlier one was superseded', async () => {
    const first = (await enqueueCloseJob(closeRequest({ closurePhoto: null }))).entry!;
    await saveEntry(supersede(first));
    const again = await enqueueCloseJob(closeRequest({ jobId: 'job2', closurePhoto: null }));
    expect(again.error).toBeUndefined();
  });
});

function supersede(job: CloseJob): CloseJob {
  const now = '2026-09-17T02:01:00.000Z';
  return markCleanedUp(
    markClosedElsewhere(markCloseOutcome(job, 'not_open', now), { closedByName: 'Budi', closedAt: now }, now),
    now,
  );
}

describe('pendingCloseFor', () => {
  it("returns the event's close job unless it is done or superseded", async () => {
    const job = (await enqueueCloseJob(closeRequest({ closurePhoto: null }))).entry!;
    expect(pendingCloseFor([job], 'ev1')).toBe(job);
    expect(pendingCloseFor([job], 'other')).toBeUndefined();
    expect(pendingCloseFor([supersede(job)], 'ev1')).toBeUndefined();
    const done = markCleanedUp(markCloseOutcome(job, 'closed', '2026-09-17T02:01:00.000Z'), '2026-09-17T02:01:00.000Z');
    expect(done.state).toBe('done');
    expect(pendingCloseFor([done], 'ev1')).toBeUndefined();
  });

  it('never mistakes a capture job for a close', async () => {
    const capture = await enqueueNewCapture({ userId: USER, event: event({ id: 'ev1' }), workGroupNames: [], nowIso: '2026-09-11T02:00:01.000Z' });
    expect(pendingCloseFor([capture], 'ev1')).toBeUndefined();
  });
});

describe('close jobs and local discard', () => {
  it('lets Batalkan remove a close job that has no outcome yet, folder and all', async () => {
    await enqueueCloseJob(closeRequest());
    calls.length = 0;
    expect(await discardEntryLocally(USER, 'job1')).toEqual({});
    expect(calls).toContain(`delete:file:///doc/capture-queue/${USER}/job1/`);
    expect(await loadQueue(USER)).toEqual([]);
  });

  it('refuses once the server has answered, and touches nothing', async () => {
    const job = (await enqueueCloseJob(closeRequest({ closurePhoto: null }))).entry!;
    await saveEntry(markCloseOutcome(job, 'closed', '2026-09-17T02:01:00.000Z'));
    calls.length = 0;
    expect(await discardEntryLocally(USER, 'job1')).toEqual({ error: 'Kejadian sudah ditutup di server.' });
    expect(calls).toEqual([]);
    expect((await loadQueue(USER))[0].id).toBe('job1');
  });

  it('flags a close job whose photo vanished before upload, with the closure sentence', async () => {
    const job = (await enqueueCloseJob(closeRequest())).entry!;
    fsFiles.delete(job.media[0].localUri);
    const [reloaded] = await loadQueue(USER);
    expect(reloaded).toMatchObject({ unrecoverable: true, needsAttention: true, lastError: REASON_CLOSURE_PHOTO_MISSING });
  });
});

describe('acknowledgeCloseEntry', () => {
  it('removes a superseded close job', async () => {
    const job = (await enqueueCloseJob(closeRequest({ closurePhoto: null }))).entry!;
    await saveEntry(supersede(job));
    expect(await acknowledgeCloseEntry(USER, 'job1')).toEqual({});
    expect(await loadQueue(USER)).toEqual([]);
  });

  it('refuses a close job that still has work to do', async () => {
    await enqueueCloseJob(closeRequest({ closurePhoto: null }));
    expect((await acknowledgeCloseEntry(USER, 'job1')).error).toBe('Penutupan ini belum selesai diproses.');
    expect(await loadQueue(USER)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run:

```bash
npx jest tools/__tests__/captureQueueStore.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2305: Module '"../captureQueueStore"' has no exported member 'enqueueCloseJob'` (and the other five new names).

- [ ] **Step 3: Implement**

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
  enqueueCapture,
  markUnrecoverable,
```

and replace it with:

```ts
  enqueueCapture,
  enqueueClose,
  markUnrecoverable,
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
  type CaptureQueueEntry,
} from './captureQueue';
```

and replace it with:

```ts
  type CaptureQueueEntry,
  type CloseJob,
} from './captureQueue';
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
  'Laporan tidak bisa dikirim; buang dan laporkan ulang.';
```

and replace it with:

```ts
  'Laporan tidak bisa dikirim; buang dan laporkan ulang.';

/** Closure spec §4.6: what a close job whose photo vanished before upload tells the person. */
export const REASON_CLOSURE_PHOTO_MISSING =
  'Foto penutupan hilang dari HP sebelum terkirim. Batalkan, lalu tandai selesai lagi dengan foto baru.';
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
      const fixed = markUnrecoverable(entry, REASON_MEDIA_MISSING);
```

and replace it with:

```ts
      const fixed = markUnrecoverable(entry, entry.kind === 'close' ? REASON_CLOSURE_PHOTO_MISSING : REASON_MEDIA_MISSING);
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
/** The cleanup step (captureQueueWorker.ts task 3). No-op on web: nothing was ever copied. */
```

and replace it with:

```ts
// ─── Close jobs (closure spec 2026-09-26 §4) ──────────────────────────────────

export interface NewCloseRequest {
  userId: string;
  /** A fresh client uuid for the job (the form calls newSiteEventId()); never the event id. */
  jobId: string;
  eventId: string;
  projectId: string;
  roomId: string;
  eventTitle: string;
  /** The note as typed; the job stores it trimmed, or null when blank. */
  note: string;
  closurePhoto: LocalSiteEventMedia | null;
  nowIso: string;
}

export type EnqueueCloseResult =
  | { entry: CloseJob; error?: undefined }
  | { entry?: undefined; error: string };

export const CLOSE_ALREADY_PENDING = 'Penutupan kejadian ini sudah menunggu kirim.';

/** The event's close job while it still has work to do: not `done`, not `superseded`. */
export function pendingCloseFor(entries: ReadonlyArray<CaptureQueueEntry>, eventId: string): CloseJob | undefined {
  return entries.find(
    (e): e is CloseJob => e.kind === 'close' && e.eventId === eventId && e.state !== 'done' && e.state !== 'superseded',
  );
}

/**
 * "Tandai selesai". Copies the closure photo into the job's own folder
 * (native), THEN writes the entry - the same "media copies first, then the
 * entry record" order enqueueNewCapture keeps. Refuses a second job for an
 * event this user already has a pending close for. Throws on a copy failure,
 * like enqueueNewCapture; the form shows the message.
 */
export async function enqueueCloseJob(request: NewCloseRequest): Promise<EnqueueCloseResult> {
  if (pendingCloseFor(await loadQueue(request.userId), request.eventId)) {
    return { error: CLOSE_ALREADY_PENDING };
  }
  const photos = request.closurePhoto ? [request.closurePhoto] : [];
  const media =
    Platform.OS === 'web' || photos.length === 0 ? photos : await copyMediaIntoQueueDir(request.userId, request.jobId, photos);
  const entry = enqueueClose({
    id: request.jobId,
    ownerId: request.userId,
    eventId: request.eventId,
    projectId: request.projectId,
    roomId: request.roomId,
    eventTitle: request.eventTitle,
    note: request.note,
    closurePhoto: media[0] ?? null,
    nowIso: request.nowIso,
  });
  await saveEntry(entry);
  return { entry };
}

/**
 * "Mengerti" on a superseded close job: the event was closed by somebody else
 * (or by this job's own earlier attempt whose response was lost), and the
 * person has read who and when. Only a superseded close job can be
 * acknowledged; anything else still has work to do or is not a close.
 */
export async function acknowledgeCloseEntry(userId: string, entryId: string): Promise<{ error?: string }> {
  const entry = await readEntryForUser(userId, entryId);
  if (!entry) return {};
  if (entry.kind !== 'close' || entry.state !== 'superseded') {
    return { error: 'Penutupan ini belum selesai diproses.' };
  }
  await deleteLocalMedia(userId, entryId);
  await removeEntry(userId, entryId);
  return {};
}

/** The cleanup step (captureQueueWorker.ts task 3). No-op on web: nothing was ever copied. */
```

In `tools/captureQueueStore.ts`, find this block (it occurs exactly once):

```ts
  if (entry.kind === 'capture' && entry.eventInserted) {
    return { error: 'Kejadian ini sudah tersimpan di server; buang lewat layar konfirmasi.' };
  }
```

and replace it with:

```ts
  if (entry.kind === 'capture' && entry.eventInserted) {
    return { error: 'Kejadian ini sudah tersimpan di server; buang lewat layar konfirmasi.' };
  }
  // A close job with an outcome already reached the server: "Batalkan" would
  // only hide what happened there (closure spec §4.6).
  if (entry.kind === 'close' && entry.closeOutcome !== null) {
    return { error: 'Kejadian sudah ditutup di server.' };
  }
```

- [ ] **Step 4: Run the store suites to verify they pass**

Run:

```bash
npx jest tools/__tests__/captureQueueStore.test.ts tools/__tests__/captureQueueWeb.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T4.txt` with the Write tool (never a heredoc), exactly:

```text
feat(queue): enqueue, find and acknowledge close jobs

enqueueCloseJob copies the closure photo into the job's folder before
writing the entry and refuses a second pending close for the event;
pendingCloseFor feeds every "Menunggu kirim"; acknowledgeCloseEntry is
"Mengerti"; discardEntryLocally refuses a close the server answered.
Closure spec 2026-09-26 §4.1, §4.5, §4.6.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/captureQueueStore.ts tools/__tests__/captureQueueStore.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T4.txt -- tools/captureQueueStore.ts tools/__tests__/captureQueueStore.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/captureQueueStore.ts`, `tools/__tests__/captureQueueStore.test.ts`.


### L2-T5 (Lane 2, Task 5): The Beranda card shows close jobs: Coba lagi, Batalkan, Mengerti

Spec §4.6. `attentionRows` becomes kind-aware: a close job's row is titled "Selesai: {eventTitle}"; a transient failure offers "Coba lagi", a permanent refusal or a vanished photo offers "Batalkan" (confirmed first, and only while no outcome is recorded), and a superseded job offers "Mengerti" with the server's closer and time. Because superseded rows are in `attentionRows`, the card's early return (`CaptureQueueCard.tsx:76`) counts them without a change of its own.

**Files:**
- Modify: `workflows/screens/siteEvent/captureQueueModel.ts`: import block; everything from `export interface AttentionRow {` (line 53) to the end of the file
- Modify: `workflows/screens/siteEvent/CaptureQueueCard.tsx`: imports (lines 6, 8); new handlers above the early return (line 76); the row render (lines 87-110); a label map above `styles`
- Test: `workflows/__tests__/captureQueueModel.test.ts` (import block; append at end)
- Create: `workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx`

**Owns (no other lane edits these):** `workflows/screens/siteEvent/captureQueueModel.ts`, `workflows/screens/siteEvent/CaptureQueueCard.tsx`, `workflows/__tests__/captureQueueModel.test.ts`, `workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx`

**Depends on:** Lane 2 Tasks 1 (`formatWibShort`), 3 and 4 (`acknowledgeCloseEntry`).

- [ ] **Step 1: Write the failing model tests**

In `workflows/__tests__/captureQueueModel.test.ts`, find this block (it occurs exactly once):

```ts
  markUploaded,
  recordFailure,
  type CaptureJob,
} from '../../tools/captureQueue';
```

and replace it with:

```ts
  markUploaded,
  enqueueClose,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  markClosureMediaInserted,
  recordFailure,
  type CaptureJob,
  type CloseJob,
} from '../../tools/captureQueue';
```

Append to the end of `workflows/__tests__/captureQueueModel.test.ts` (after its current last line, keeping one blank line between):

```ts
// ─── Close jobs (closure spec 2026-09-26 §4.6) ────────────────────────────────

const closeJob = (photo = true): CloseJob => enqueueClose({
  id: 'job1', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian', note: 'Sudah ditambal',
  closurePhoto: photo
    ? { id: 'cm1', localUri: 'file:///q/cm1.jpg', kind: 'photo', role: 'closure', mimeType: 'image/jpeg', ext: 'jpg', durationS: null, sortOrder: 0, capturedAt: NOW }
    : null,
  nowIso: NOW,
});

const supersededJob = (closedByName: string | null): CloseJob => markCleanedUp(
  markClosedElsewhere(markCloseOutcome(closeJob(false), 'not_open', NOW), { closedByName, closedAt: '2026-09-17T07:05:00.000Z' }, NOW),
  NOW,
);

describe('attentionRows for close jobs', () => {
  it('offers Coba lagi on a transient failure that ran out of attempts, titled with the event', () => {
    let j = closeJob(false);
    for (let i = 0; i < 5; i++) j = recordFailure(j, 'Tandai selesai gagal: Gagal menyimpan: Network request failed', NOW);
    expect(attentionRows([j])).toEqual([
      { id: 'job1', title: 'Selesai: Retak acian', reason: 'Tandai selesai gagal: Gagal menyimpan: Network request failed', action: 'retry' },
    ]);
  });

  it('offers Batalkan, confirmed first, on a permanent refusal before any outcome', () => {
    const j = recordFailure(closeJob(false), 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.', NOW, 'permanent');
    expect(attentionRows([j])).toEqual([{
      id: 'job1',
      title: 'Selesai: Retak acian',
      reason: 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai lagi.',
      action: 'cancel',
      confirm: 'Batalkan penutupan "Retak acian"? Kejadian tetap terbuka. Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu.',
    }]);
  });

  it('offers Batalkan on an unrecoverable job, with the missing-photo sentence when it carries no error', () => {
    const j = { ...markUnrecoverable(closeJob(), 'x'), lastError: null };
    expect(attentionRows([j])[0]).toMatchObject({
      action: 'cancel',
      reason: 'Foto penutupan hilang dari HP sebelum terkirim. Batalkan, lalu tandai selesai lagi dengan foto baru.',
    });
  });

  it('never offers Batalkan once the server answered, even on a permanent lookup failure', () => {
    const j = recordFailure(markCloseOutcome(closeJob(false), 'not_open', NOW), 'Baca status kejadian gagal: Hanya kejadian terbuka yang bisa ditandai selesai.', NOW, 'permanent');
    expect(attentionRows([j])[0].action).toBe('retry');
  });

  it("names the server's closer and time on a superseded job, and offers Mengerti", () => {
    expect(attentionRows([supersededJob('Budi Santoso')])).toEqual([
      { id: 'job1', title: 'Retak acian', reason: 'Sudah ditutup oleh Budi Santoso pada 17 Sep 14.05.', action: 'acknowledge' },
    ]);
  });

  it('says only when, never a guessed name, when the server recorded no closer', () => {
    expect(attentionRows([supersededJob(null)])[0].reason).toBe('Sudah ditutup pada 17 Sep 14.05.');
  });

  it('lists nothing for a close job that is simply waiting, and counts it as waiting for signal', () => {
    const j = markClosureMediaInserted(markUploaded(closeJob(), 'cm1', 1, NOW), NOW);
    expect(attentionRows([j])).toEqual([]);
    expect(queueBadgeText([j])).toBe('Antrean: 1 menunggu sinyal');
  });
});
```

- [ ] **Step 2: Write the failing card test**

Create `workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx` with exactly this content:

```tsx
// workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx
//
// Closure spec 2026-09-26 §4.6: the Beranda card shows close jobs too - a
// superseded one keeps the card on screen with "Mengerti", and a refused one
// offers "Batalkan", confirmed first.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockToast = jest.fn();
jest.mock('../../../components/Toast', () => ({ useToast: () => ({ show: mockToast }) }));
jest.mock('../../../hooks/useProject', () => ({ useProject: () => ({ profile: { id: 'u1' } }) }));
let mockEntries: unknown[] = [];
jest.mock('../../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => mockEntries),
  discardEntryLocally: jest.fn(async () => ({})),
  acknowledgeCloseEntry: jest.fn(async () => ({})),
}));
jest.mock('../../../../tools/captureQueueWorker', () => ({ retryQueueEntry: jest.fn(async () => undefined) }));

import {
  enqueueClose,
  markCleanedUp,
  markClosedElsewhere,
  markCloseOutcome,
  recordFailure,
  type CloseJob,
} from '../../../../tools/captureQueue';
import { acknowledgeCloseEntry, discardEntryLocally } from '../../../../tools/captureQueueStore';
import CaptureQueueCard from '../CaptureQueueCard';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const NOW = '2026-09-17T02:00:00.000Z';
const job = (): CloseJob => enqueueClose({
  id: 'job1', ownerId: 'u1', eventId: 'ev1', projectId: 'p1', roomId: 'r1', eventTitle: 'Retak acian', note: '',
  closurePhoto: null, nowIso: NOW,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries = [];
});

describe('CaptureQueueCard with close jobs', () => {
  it("stays on screen for a superseded close, names the server's closer, and acknowledges on Mengerti", async () => {
    mockEntries = [markCleanedUp(
      markClosedElsewhere(markCloseOutcome(job(), 'not_open', NOW), { closedByName: 'Sari', closedAt: '2026-09-17T07:05:00.000Z' }, NOW),
      NOW,
    )];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Retak acian')).toBeTruthy();
    expect(utils.getByText('Sudah ditutup oleh Sari pada 17 Sep 14.05.')).toBeTruthy();

    fireEvent.press(utils.getByText('Mengerti'));
    await waitFor(() => expect(acknowledgeCloseEntry).toHaveBeenCalledWith('u1', 'job1'));
  });

  it('asks before Batalkan on a refused close, and only then discards it', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockEntries = [recordFailure(job(), 'Tandai selesai gagal: Foto penutupan wajib untuk jenis ini.', NOW, 'permanent')];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Selesai: Retak acian')).toBeTruthy();

    fireEvent.press(utils.getByText('Batalkan'));
    expect(alert).toHaveBeenCalledWith(
      'Batalkan penutupan',
      'Batalkan penutupan "Retak acian"? Kejadian tetap terbuka. Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu.',
      expect.any(Array),
    );
    expect(discardEntryLocally).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Batalkan')!.onPress!();
    await waitFor(() => expect(discardEntryLocally).toHaveBeenCalledWith('u1', 'job1'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Penutupan dibatalkan. Kejadian tetap terbuka.', 'ok'));
    alert.mockRestore();
  });

  it('counts a close that is still on its way as waiting for signal', () => {
    mockEntries = [job()];
    const utils = render(<CaptureQueueCard />);
    expect(utils.getByText('Antrean: 1 menunggu sinyal')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run:

```bash
npx jest workflows/__tests__/captureQueueModel.test.ts workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, 8 tests: six in `attentionRows for close jobs` (Task 3 filtered close jobs out, so the rows come back empty) and two in the card test (`Unable to find an element with text: Retak acian`, and the same for `Selesai: Retak acian`).

- [ ] **Step 4: Make the model kind-aware**

In `workflows/screens/siteEvent/captureQueueModel.ts`, find this block (it occurs exactly once):

```ts
  type CaptureJob,
  type CaptureQueueEntry,
} from '../../../tools/captureQueue';
```

and replace it with:

```ts
  type CaptureJob,
  type CaptureQueueEntry,
  type CloseJob,
} from '../../../tools/captureQueue';
import { formatWibShort } from '../../../tools/timeWindow';
```

In `workflows/screens/siteEvent/captureQueueModel.ts`, replace everything from the line that starts `export interface AttentionRow {` to the end of the file with exactly this content:

```ts
export interface AttentionRow {
  id: string;
  title: string;
  reason: string;
  /**
   * 'retry' offers "Coba lagi". 'discard' offers "Buang" - only where there
   * is genuinely nothing left to retry AND nothing on the server to lose.
   * 'cancel' offers "Batalkan" on a close job the server refused or whose
   * photo vanished; the event stays open. 'acknowledge' offers "Mengerti" on
   * a close job that found the event already closed.
   */
  action: 'retry' | 'discard' | 'cancel' | 'acknowledge';
  /** The confirmation a 'cancel' row asks before acting; absent on every other row. */
  confirm?: string;
}

const FALLBACK_TITLE = 'Laporan tanpa catatan';
const FALLBACK_REASON = 'Gagal setelah beberapa kali percobaan. Ketuk untuk mencoba lagi.';

/**
 * What a row whose event is already on the server says instead of its last
 * error. Such an entry is only still here because a local step after the
 * insert did not finish; the report itself is not at risk, and offering
 * "Buang" would be a lie in the other direction - discardEntryLocally
 * refuses it precisely because the server already has the row.
 */
const REASON_ALREADY_SENT = 'Sudah terkirim ke server; buka Draf menunggu.';

/** Closure spec §4.6, shown when a close job is unrecoverable and carries no error of its own. */
const REASON_CLOSURE_PHOTO_GONE =
  'Foto penutupan hilang dari HP sebelum terkirim. Batalkan, lalu tandai selesai lagi dengan foto baru.';

/**
 * Beranda's "Perlu perhatian" list: every entry flagged after 5 consecutive
 * failures, by a permanent refusal, or by missing local media - plus every
 * close job that found its event already closed, until the person has read
 * who closed it.
 *
 * A capture row offers "Buang" in exactly two cases, and both mean the same
 * thing: the report never reached the server and no further attempt can
 * change that - its local media is gone (unrecoverable), or the server
 * refused it with a decision rather than a hiccup. An entry whose event IS
 * inserted never gets "Buang", whatever else is true of it.
 *
 * A close row offers "Batalkan" on the same two conditions, and only while no
 * close outcome is recorded: once the server answered, cancelling would only
 * hide what happened there (discardEntryLocally refuses it too).
 */
export function attentionRows(entries: ReadonlyArray<CaptureQueueEntry>): AttentionRow[] {
  return entries
    .filter((e) => e.needsAttention || (e.kind === 'close' && e.state === 'superseded'))
    .map((e) => (e.kind === 'close' ? closeRow(e) : captureRow(e)));
}

function captureRow(e: CaptureJob): AttentionRow {
  return {
    id: e.id,
    title: e.rawText && e.rawText.trim() ? e.rawText.trim() : FALLBACK_TITLE,
    reason: e.eventInserted ? REASON_ALREADY_SENT : e.lastError ?? FALLBACK_REASON,
    action:
      !e.eventInserted && (e.unrecoverable || e.lastFailureKind === 'permanent')
        ? ('discard' as const)
        : ('retry' as const),
  };
}

/** "Sudah ditutup oleh {name} pada {17 Sep 14.05}." - the server's closer, never the queue owner (spec §1.1 rule 3). */
export function supersededReason(job: Pick<CloseJob, 'closedElsewhere'>): string {
  const info = job.closedElsewhere;
  if (!info) return 'Sudah ditutup.';
  const when = formatWibShort(info.closedAt);
  return info.closedByName ? `Sudah ditutup oleh ${info.closedByName} pada ${when}.` : `Sudah ditutup pada ${when}.`;
}

function closeRow(e: CloseJob): AttentionRow {
  if (e.state === 'superseded') {
    return { id: e.id, title: e.eventTitle, reason: supersededReason(e), action: 'acknowledge' };
  }
  const title = `Selesai: ${e.eventTitle}`;
  const cancellable = e.closeOutcome === null && (e.unrecoverable || e.lastFailureKind === 'permanent');
  if (!cancellable) {
    return { id: e.id, title, reason: e.lastError ?? FALLBACK_REASON, action: 'retry' };
  }
  return {
    id: e.id,
    title,
    reason: e.lastError ?? REASON_CLOSURE_PHOTO_GONE,
    action: 'cancel',
    confirm: `Batalkan penutupan "${e.eventTitle}"? Kejadian tetap terbuka. Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu.`,
  };
}
```

- [ ] **Step 5: Give the card its two new actions**

In `workflows/screens/siteEvent/CaptureQueueCard.tsx`, find this block (it occurs exactly once):

```tsx
import { discardEntryLocally, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
```

and replace it with:

```tsx
import { acknowledgeCloseEntry, discardEntryLocally, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
```

In `workflows/screens/siteEvent/CaptureQueueCard.tsx`, find this block (it occurs exactly once):

```tsx
import { attentionRows, queueBadgeText } from './captureQueueModel';
```

and replace it with:

```tsx
import { attentionRows, queueBadgeText, type AttentionRow } from './captureQueueModel';
```

In `workflows/screens/siteEvent/CaptureQueueCard.tsx`, find this block (it occurs exactly once):

```tsx
  if (!badge && attention.length === 0) return null;
```

and replace it with:

```tsx
  /** "Batalkan" on a close job (closure spec §4.6): the event stays open; nothing on the server is touched. */
  const cancelClose = useCallback(async (id: string) => {
    if (!profile) return;
    setPendingId(id);
    try {
      const result = await discardEntryLocally(profile.id, id);
      if (result.error) toast(result.error, 'critical');
      else toast('Penutupan dibatalkan. Kejadian tetap terbuka.', 'ok');
    } finally {
      setPendingId((current) => (current === id ? null : current));
    }
  }, [profile, toast]);

  const onCancelClose = useCallback((row: AttentionRow) => {
    const message = row.confirm ?? `Batalkan penutupan "${row.title}"?`;
    if (Platform?.OS === 'web') {
      if (window.confirm(message)) void cancelClose(row.id);
    } else {
      Alert.alert('Batalkan penutupan', message, [
        { text: 'Tidak', style: 'cancel' },
        { text: 'Batalkan', style: 'destructive', onPress: () => void cancelClose(row.id) },
      ]);
    }
  }, [cancelClose]);

  /** "Mengerti" on a superseded close job: it only leaves the list. */
  const onAcknowledge = useCallback(async (id: string) => {
    if (!profile) return;
    setPendingId(id);
    try {
      const result = await acknowledgeCloseEntry(profile.id, id);
      if (result.error) toast(result.error, 'critical');
    } finally {
      setPendingId((current) => (current === id ? null : current));
    }
  }, [profile, toast]);

  const onRowAction = (row: AttentionRow) => {
    if (row.action === 'discard') onDiscard(row.id, row.title);
    else if (row.action === 'cancel') onCancelClose(row);
    else if (row.action === 'acknowledge') void onAcknowledge(row.id);
    else void onRetry(row.id);
  };

  if (!badge && attention.length === 0) return null;
```

In `workflows/screens/siteEvent/CaptureQueueCard.tsx`, find this block (it occurs exactly once):

```tsx
          {attention.map((row) => {
            const busy = pendingId === row.id;
            const danger = row.action === 'discard';
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.reason} numberOfLines={2}>{row.reason}</Text>
                </View>
                <TouchableOpacity
                  style={[danger ? styles.dangerBtn : styles.retryBtn, busy && styles.btnBusy]}
                  disabled={busy}
                  onPress={() => (danger ? onDiscard(row.id, row.title) : void onRetry(row.id))}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={danger ? `Buang laporan ${row.title}` : `Coba lagi laporan ${row.title}`}
                >
                  <Text style={danger ? styles.dangerText : styles.retryText}>
                    {danger ? 'Buang' : 'Coba lagi'}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
```

and replace it with:

```tsx
          {attention.map((row) => {
            const busy = pendingId === row.id;
            const danger = row.action === 'discard' || row.action === 'cancel';
            const label = ACTION_LABEL[row.action];
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.meta}>
                  <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.reason} numberOfLines={2}>{row.reason}</Text>
                </View>
                <TouchableOpacity
                  style={[danger ? styles.dangerBtn : styles.retryBtn, busy && styles.btnBusy]}
                  disabled={busy}
                  onPress={() => onRowAction(row)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={`${label} ${row.title}`}
                >
                  <Text style={danger ? styles.dangerText : styles.retryText}>{label}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
```

In `workflows/screens/siteEvent/CaptureQueueCard.tsx`, find this block (it occurs exactly once):

```tsx
const styles = StyleSheet.create({
```

and replace it with:

```tsx
const ACTION_LABEL: Record<AttentionRow['action'], string> = {
  retry: 'Coba lagi',
  discard: 'Buang',
  cancel: 'Batalkan',
  acknowledge: 'Mengerti',
};

const styles = StyleSheet.create({
```

- [ ] **Step 6: Run them to verify they pass**

Run:

```bash
npx jest workflows/__tests__/captureQueueModel.test.ts workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites.

- [ ] **Step 7: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 8: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T5.txt` with the Write tool (never a heredoc), exactly:

```text
feat(beranda): close jobs on the queue card

"Selesai: {title}" rows: Coba lagi on a transient failure, Batalkan
(confirmed) on a refusal or a vanished photo before any outcome, and
Mengerti with the server's closer and WIB time on a superseded job.
Closure spec 2026-09-26 §4.6.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add workflows/screens/siteEvent/captureQueueModel.ts workflows/screens/siteEvent/CaptureQueueCard.tsx workflows/__tests__/captureQueueModel.test.ts workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T5.txt -- workflows/screens/siteEvent/captureQueueModel.ts workflows/screens/siteEvent/CaptureQueueCard.tsx workflows/__tests__/captureQueueModel.test.ts workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `workflows/screens/siteEvent/captureQueueModel.ts`, `workflows/screens/siteEvent/CaptureQueueCard.tsx`, `workflows/__tests__/captureQueueModel.test.ts`, `workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx`.


### L2-T6 (Lane 2, Task 6): The room timeline says "Menunggu kirim" and hides its "Selesai"

Spec §4.5: beside the status badge (`RoomTimeline.tsx:186-195`), which keeps the server's label, a second badge "Menunggu kirim" while this phone holds a close job for the event, and no "Selesai" action. The rule lives in `canClose` (`timelineModel.ts:62-65`) so it is tested without rendering the timeline.

**Files:**
- Modify: `workflows/screens/siteEvent/timelineModel.ts` (`canClose`, lines 62-65)
- Test: `workflows/__tests__/timelineModel.test.ts` (the `canClose` describe, lines 68-74)
- Modify: `workflows/screens/siteEvent/RoomTimeline.tsx`: imports (line 11); after the `notice` state (line 63); inside the row map (lines 177-195, 217); styles (lines 290-292)

**Owns (no other lane edits these):** `workflows/screens/siteEvent/timelineModel.ts`, `workflows/__tests__/timelineModel.test.ts`, `workflows/screens/siteEvent/RoomTimeline.tsx`

**Depends on:** Lane 2 Task 4 (`pendingCloseFor`).

- [ ] **Step 1: Write the failing test**

In `workflows/__tests__/timelineModel.test.ts`, find this block (it occurs exactly once):

```ts
    expect(canClose(ev({ id: 'a', status: 'draft' }))).toBe(false);
  });
});
```

and replace it with:

```ts
    expect(canClose(ev({ id: 'a', status: 'draft' }))).toBe(false);
  });

  it('hides Selesai while this phone holds a close for the event that has not reached the server', () => {
    expect(canClose(ev({ id: 'a', status: 'open' }), true)).toBe(false);
    expect(canClose(ev({ id: 'a', status: 'open' }), false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest workflows/__tests__/timelineModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2554: Expected 1 arguments, but got 2.`

- [ ] **Step 3: Implement the rule**

In `workflows/screens/siteEvent/timelineModel.ts`, find this block (it occurs exactly once):

```ts
/** "Selesai" is offered on an open event to any project member (097's close_site_event checks membership). */
export function canClose(ev: Pick<TimelineEvent, 'status'>): boolean {
  return ev.status === 'open';
}
```

and replace it with:

```ts
/**
 * "Selesai" is offered on an open event to any project member (097's
 * close_site_event checks membership), unless this phone already holds a
 * close job for it that has not reached the server (closure spec §4.5).
 */
export function canClose(ev: Pick<TimelineEvent, 'status'>, closePending = false): boolean {
  return ev.status === 'open' && !closePending;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest workflows/__tests__/timelineModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 5: Render the badge and pass the flag**

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
import { getProjectTeamResult, type TeamMember } from '../../../tools/projectManagement';
```

and replace it with:

```tsx
import { getProjectTeamResult, type TeamMember } from '../../../tools/projectManagement';
import { pendingCloseFor, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
```

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
  const [notice, setNotice] = useState<string | null>(null);
```

and replace it with:

```tsx
  const [notice, setNotice] = useState<string | null>(null);
  // Close jobs still on this phone (closure spec §4.5). The status badge
  // keeps the server's word; a pending close only adds "Menunggu kirim".
  const queue = useCaptureQueueEntries(viewer?.id ?? null);
```

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
        const late = isOverdue(e, today);
        return (
```

and replace it with:

```tsx
        const late = isOverdue(e, today);
        const closePending = !!pendingCloseFor(queue, e.id);
        return (
```

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
                      {SITE_EVENT_STATUS_LABELS[e.status]}
                    </Text>
                  </View>
                </View>
```

and replace it with:

```tsx
                      {SITE_EVENT_STATUS_LABELS[e.status]}
                    </Text>
                  </View>
                  {closePending && (
                    <View style={[styles.badge, styles.pendingBadge]}>
                      <Text style={[styles.badgeText, styles.pendingBadgeText]}>Menunggu kirim</Text>
                    </View>
                  )}
                </View>
```

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
              {canClose(e) && onOpenEvent && (
```

and replace it with:

```tsx
              {canClose(e, closePending) && onOpenEvent && (
```

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
  badgeRow: { flexDirection: 'row', marginTop: 3 },
```

and replace it with:

```tsx
  badgeRow: { flexDirection: 'row', gap: SPACE.xs, marginTop: 3 },
```

In `workflows/screens/siteEvent/RoomTimeline.tsx`, find this block (it occurs exactly once):

```tsx
  badgeText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },
```

and replace it with:

```tsx
  badgeText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold },
  pendingBadge: { backgroundColor: COLORS.infoBg },
  pendingBadgeText: { color: COLORS.info },
```

- [ ] **Step 6: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 7: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T6.txt` with the Write tool (never a heredoc), exactly:

```text
feat(rooms): Menunggu kirim on the room timeline

A close job on this phone adds a "Menunggu kirim" badge beside the
server's status and hides the row's Selesai. Closure spec 2026-09-26 §4.5.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add workflows/screens/siteEvent/timelineModel.ts workflows/__tests__/timelineModel.test.ts workflows/screens/siteEvent/RoomTimeline.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T6.txt -- workflows/screens/siteEvent/timelineModel.ts workflows/__tests__/timelineModel.test.ts workflows/screens/siteEvent/RoomTimeline.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `workflows/screens/siteEvent/timelineModel.ts`, `workflows/__tests__/timelineModel.test.ts`, `workflows/screens/siteEvent/RoomTimeline.tsx`.


### L2-T7 (Lane 2, Task 7): Remove `closeSiteEvent`: the form has no synchronous path

Spec §4.4: "`closeSiteEvent` is removed; the form has no synchronous path." Every close goes through the queue (decision 7).

**Files:**
- Modify: `tools/siteEvents.ts`: delete the `closeSiteEvent` function and its doc comment (original lines 532-560). Touch nothing else in the file.

**Owns (no other lane edits these):** `tools/siteEvents.ts` (the deleted block only)

**Depends on:** **Lane 1 Task 3** (it deletes the `closeSiteEvent` tests and import from `tools/__tests__/siteEvents.test.ts`, and edits `RPC_ERROR_COPY` in this same file) **and Lane 1 Task 4** (`ClosureForm` stops importing `closeSiteEvent`). Both must be committed first; check with `git log --oneline -- tools/siteEvents.ts workflows/screens/siteEvent/ClosureForm.tsx`.

- [ ] **Step 1: Confirm nothing uses it**

Run:

```bash
grep -rn "closeSiteEvent\b" --include='*.ts' --include='*.tsx' tools workflows office | grep -v closeSiteEventRpc
```

Expected: only the definition in `tools/siteEvents.ts` itself. Any other hit means Lane 1 Task 3 or 4 is not in yet: stop and wait.

- [ ] **Step 2: Delete it**

In `tools/siteEvents.ts`, delete this block (it occurs exactly once), including the blank line after it:

```ts
/** "Selesai" (spec §5.5). The closure photo is optional; it is uploaded and recorded before the RPC. */
export async function closeSiteEvent(params: {
  eventId: string;
  projectId: string;
  note: string;
  closurePhoto?: LocalSiteEventMedia | null;
}): Promise<{ error?: string }> {
  if (params.closurePhoto) {
    const carrier: MediaCarrier = {
      id: params.eventId,
      projectId: params.projectId,
      media: [{ ...params.closurePhoto, kind: 'photo', role: 'closure' }],
    };
    const uploaded = await uploadSiteEventMedia(carrier);
    if (uploaded.error) return { error: uploaded.error };
    const { error: mediaError } = await supabase
      .from('site_event_media')
      .upsert(buildMediaRows(carrier, uploaded.bytesById), { onConflict: 'id', ignoreDuplicates: true });
    if (mediaError) return { error: mapSiteEventRpcError(mediaError.message) };
  }

  const note = params.note.trim();
  const { error } = await supabase.rpc('close_site_event', {
    p_event_id: params.eventId,
    p_closure_note: note ? note : null,
  });
  if (error) return { error: mapSiteEventRpcError(error.message) };
  return {};
}
```

- [ ] **Step 3: Run the site-event and queue suites**

Run:

```bash
npx jest tools/__tests__/siteEvents.test.ts tools/__tests__/siteEventsClose.test.ts tools/__tests__/captureQueueWorker.test.ts workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, all four suites.

- [ ] **Step 4: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 5: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T7.txt` with the Write tool (never a heredoc), exactly:

```text
refactor(site-events): remove the synchronous closeSiteEvent

Every close goes through the capture queue now (closure spec 2026-09-26
§2 decision 7, §4.4); nothing imports the old path.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/siteEvents.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L2-T7.txt -- tools/siteEvents.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/siteEvents.ts`.


---

## Lane 3: digest

### L3-T1 (Lane 3, Task 1): `RoomBoard` in the deeplink map

Spec §5.5. The digest deeplinks to `RoomBoard`. Only the supervisor navigator registers that route (`workflows/navigation.tsx:185`); for every other role it resolves to `Rooms`, the "Ruangan" tab (`office/navigation.tsx:152`, `office/PrincipalNavigation.tsx:114`). `routeDeeplink` already switches project for `params.projectId` (`workflows/pendingDeeplink.ts:42-56`).

**Files:**
- Modify: `tools/notificationRouting.ts`: the header table (line 12), `BASE_ROUTE_MAP` (lines 36-51), `resolveNotificationRoute` (lines 69-70)
- Test: `tools/__tests__/notificationRouting.test.ts` (append at end)

**Owns (no other lane edits these):** `tools/notificationRouting.ts`, `tools/__tests__/notificationRouting.test.ts`

**Depends on:** Nothing. Lane 3 Task 2's guard checks `KNOWN_DEEPLINK_SCREENS` contains `RoomBoard`.

- [ ] **Step 1: Write the failing test**

Append to the end of `tools/__tests__/notificationRouting.test.ts` (after its current last line, keeping one blank line between):

```ts
// ── Morning digest (closure spec 2026-09-26 §5.5, migration 106) ──────────
describe('resolveNotificationRoute - morning digest', () => {
  it('declares the RoomBoard deeplink', () => {
    expect(KNOWN_DEEPLINK_SCREENS).toContain('RoomBoard');
  });

  it("opens the supervisor's RoomBoard and everyone else's Ruangan tab", () => {
    expect(resolveNotificationRoute('RoomBoard', 'supervisor')).toBe('RoomBoard');
    for (const role of ['admin', 'estimator', 'principal', undefined, null]) {
      expect(resolveNotificationRoute('RoomBoard', role)).toBe('Rooms');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/notificationRouting.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL: `declares the RoomBoard deeplink` and `opens the supervisor's RoomBoard and everyone else's Ruangan tab` (received `RoomBoard` for `admin`).

- [ ] **Step 3: Implement**

In `tools/notificationRouting.ts`, find this block (it occurs exactly once):

```ts
//   SiteEventDetail → SiteEventDetail SiteEventDetail SiteEventDetail
//
```

and replace it with:

```ts
//   SiteEventDetail → SiteEventDetail SiteEventDetail SiteEventDetail
//   RoomBoard       → RoomBoard       Rooms        Rooms
//
```

In `tools/notificationRouting.ts`, find this block (it occurs exactly once):

```ts
  ProgressClaim: 'Progres',
};
```

and replace it with:

```ts
  ProgressClaim: 'Progres',
  // SITE_EVENT_DIGEST (migration 106) opens Papan Ruangan with the "Perlu
  // ditindak" list; params carry projectId, attention and mine.
  RoomBoard: 'RoomBoard',
};
```

In `tools/notificationRouting.ts`, find this block (it occurs exactly once):

```ts
  if (role !== 'supervisor' && target === 'Progres') return 'Reports';
  return target;
```

and replace it with:

```ts
  if (role !== 'supervisor' && target === 'Progres') return 'Reports';
  // Only the supervisor navigator registers RoomBoard; the office and
  // principal navigators show the same board as their "Ruangan" tab.
  if (role !== 'supervisor' && target === 'RoomBoard') return 'Rooms';
  return target;
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest tools/__tests__/notificationRouting.test.ts tools/__tests__/migration104.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, both suites.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T1.txt` with the Write tool (never a heredoc), exactly:

```text
feat(notifications): RoomBoard deeplink resolves per role

RoomBoard for a supervisor, the Ruangan tab (Rooms) for everyone else.
Closure spec 2026-09-26 §5.5.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/notificationRouting.ts tools/__tests__/notificationRouting.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T1.txt -- tools/notificationRouting.ts tools/__tests__/notificationRouting.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/notificationRouting.ts`, `tools/__tests__/notificationRouting.test.ts`.


### L3-T2 (Lane 3, Task 2): Migration 106: the attention view, the digest log, the digest, the type, the schedule

Spec §5.1-§5.5. One predicate (`v_site_event_attention`, `security_invoker`) read by the digest and by the app; `site_event_digest_log` as idempotence key and health source; `enqueue_site_event_digests` with no grant to any app role, one message per person per project, each recipient in its own subtransaction so a log row exists if and only if its notification landed; `SITE_EVENT_DIGEST` added to 104's sixteen types by shape; the pg_cron job at `0 0 * * 1-6` (07:00 WIB) when pg_cron is on, a NOTICE when it is not. The guard also compares `site_event_digest_day`'s month list with `WIB_MONTH_ABBR` from `tools/timeWindow.ts`, which the spec (§8.3) placed in `timeWindow.test.ts`; it lives here so Lane 2 never reads a Lane 3 file.

**Files:**
- Create: `supabase/migrations/106_site_event_digest.sql`
- Create: `tools/__tests__/migration106.test.ts`

**Owns (no other lane edits these):** `supabase/migrations/106_site_event_digest.sql`, `tools/__tests__/migration106.test.ts`

**Depends on:** Lane 3 Task 1 (`KNOWN_DEEPLINK_SCREENS` has `RoomBoard`) and **Lane 2 Task 1 committed** (`WIB_MONTH_ABBR`). **Lane 3 Task 7 waits for this commit.**

- [ ] **Step 1: Write the failing static guard**

Create `tools/__tests__/migration106.test.ts` with exactly this content:

```ts
/**
 * Static guard for migration 106 (the morning attention digest).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so a comment can never satisfy a guard the SQL fails. Behaviour as
 * real roles (who gets which message, idempotence, RLS on the view and the
 * log, the scheduler with and without pg_cron) is rehearsed on Postgres by
 * supabase/tests/site_event_closure_rehearsal/run.sh.
 *
 *  • One predicate, one view, read by the digest and by the app.
 *  • A log row exists if and only if its notification landed, and a second
 *    run the same day sends nothing.
 *  • No app role can execute the digest.
 *  • The type CHECK keeps 104's sixteen types and adds exactly one.
 *  • The schedule is 07:00 WIB, Monday to Saturday, and a paste without
 *    pg_cron says so instead of failing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KNOWN_DEEPLINK_SCREENS } from '../notificationRouting';
import { WIB_MONTH_ABBR } from '../timeWindow';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '106_site_event_digest.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL);

const typeList = (sql: string): string[] => {
  const code = stripComments(sql);
  const at = code.lastIndexOf('ADD CONSTRAINT notifications_type_check');
  const block = code.slice(at, code.indexOf('));', at));
  return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
};

function fnBody(name: string): string {
  const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = CODE.indexOf('$$', start);
  const close = CODE.indexOf('$$;', open + 2);
  return CODE.slice(start, close + 3);
}

function viewText(name: string): string {
  const start = CODE.indexOf(`CREATE OR REPLACE VIEW ${name}`);
  if (start < 0) throw new Error(`${name} is not defined`);
  return CODE.slice(start, CODE.indexOf(';', start) + 1);
}

describe('migration 106 - header states why, paste order and what a re-paste undoes', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest-design\.md/);
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest\.md/);
  });

  it('pastes after 104 and 105, and says re-pasting 098 or 104 drops the digest type', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 104 and 105\./);
    expect(SQL).toMatch(/Re-pasting 098 or 104 after this\s+-- file re-creates the type CHECK without SITE_EVENT_DIGEST/);
    expect(SQL).toMatch(/Re-paste 106 after any re-paste of 098 or 104\./);
  });

  it('says it is re-paste safe and carries a self-check', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/SELF-CHECK/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(10);
  });
});

describe('migration 106 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('adds the blocking index with IF NOT EXISTS', () => {
    expect(CODE).toContain(
      "CREATE INDEX IF NOT EXISTS idx_site_events_blocking_open\n  ON site_events(project_id) WHERE status = 'open' AND is_blocking;",
    );
  });
});

describe('migration 106 - v_site_event_attention, the one predicate', () => {
  it('is dropped first and runs as the caller', () => {
    expect(CODE.indexOf('DROP VIEW IF EXISTS v_site_event_attention;')).toBeGreaterThan(-1);
    expect(CODE.indexOf('DROP VIEW IF EXISTS v_site_event_attention;')).toBeLessThan(CODE.indexOf('CREATE OR REPLACE VIEW v_site_event_attention'));
    expect(viewText('v_site_event_attention')).toContain('WITH (security_invoker = true)');
    expect(CODE).toContain('GRANT SELECT ON v_site_event_attention TO authenticated;');
  });

  it('counts open items past due on the Jakarta calendar, or blocking since before 00:00 WIB today', () => {
    const view = viewText('v_site_event_attention');
    expect(view).toContain("CROSS JOIN (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS today) t");
    expect(view).toMatch(
      /WHERE e\.status = 'open'\s+AND \(e\.due_date < t\.today\s+OR \(e\.is_blocking AND e\.confirmed_at < \(t\.today::timestamp AT TIME ZONE 'Asia\/Jakarta'\)\)\);/,
    );
    expect(view).toContain('COALESCE(e.due_date < t.today, FALSE) AS is_overdue');
    expect(view).toContain('CASE WHEN e.due_date < t.today THEN t.today - e.due_date ELSE 0 END AS days_overdue');
  });

  it('answers owner_on_project only where the reader can know it, NULL elsewhere', () => {
    const view = viewText('v_site_event_attention');
    expect(view).toContain('CASE WHEN e.owner_id IS NULL THEN FALSE');
    expect(view).toContain("WHEN current_user NOT IN ('authenticated', 'anon') OR is_office_role() OR e.owner_id = auth.uid()");
    expect(view).toMatch(/ELSE NULL END AS owner_on_project/);
  });
});

describe('migration 106 - the log and the health view', () => {
  it('creates the log with every column NOT NULL, the kind CHECK and the once-per-day key', () => {
    const start = CODE.indexOf('CREATE TABLE IF NOT EXISTS site_event_digest_log (');
    expect(start).toBeGreaterThan(-1);
    const table = CODE.slice(start, CODE.indexOf(');', start));
    for (const col of ['project_id', 'profile_id', 'run_date', 'kind', 'sent_at']) {
      expect(table).toMatch(new RegExp(`\\n\\s+${col}\\s+[A-Z]+[^\\n]*NOT NULL`));
    }
    expect(table).toContain("CHECK (kind IN ('owner', 'office'))");
    expect(table).toContain('CONSTRAINT site_event_digest_log_once UNIQUE (project_id, profile_id, run_date)');
  });

  it('turns RLS on with one office read policy and no write policy', () => {
    expect(CODE).toContain('ALTER TABLE site_event_digest_log ENABLE ROW LEVEL SECURITY;');
    const policies = [...CODE.matchAll(/CREATE POLICY (\w+) ON site_event_digest_log\s+FOR (\w+) USING \(([^;]*)\);/g)];
    expect(policies.map((m) => [m[1], m[2], m[3]])).toEqual([['site_event_digest_log_office_read', 'SELECT', 'is_office_role()']]);
    expect(CODE).not.toMatch(/CREATE POLICY[^;]*ON site_event_digest_log[^;]*FOR (?:INSERT|UPDATE|DELETE|ALL)/);
  });

  it('describes the scheduler, not a project: the latest run_date across all projects', () => {
    expect(CODE.indexOf('DROP VIEW IF EXISTS v_site_event_digest_health;')).toBeLessThan(CODE.indexOf('CREATE OR REPLACE VIEW v_site_event_digest_health'));
    const view = viewText('v_site_event_digest_health');
    expect(view).toContain('WITH (security_invoker = true)');
    expect(view).toContain('max(l.sent_at) AS last_sent_at');
    expect(view).toContain('count(DISTINCT l.profile_id)::int AS recipients');
    expect(view).toContain('WHERE l.run_date = (SELECT max(x.run_date) FROM site_event_digest_log x)');
  });
});

describe('migration 106 - enqueue_site_event_digests', () => {
  const body = () => fnBody('enqueue_site_event_digests');

  it('is SECURITY DEFINER with search_path pinned, dropped by signature first', () => {
    expect(CODE.indexOf('DROP FUNCTION IF EXISTS enqueue_site_event_digests(DATE);')).toBeLessThan(
      CODE.indexOf('CREATE OR REPLACE FUNCTION enqueue_site_event_digests('),
    );
    expect(body()).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(body()).toContain("p_run_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date");
  });

  it('is executable by no app role', () => {
    expect(CODE).toContain('REVOKE ALL ON FUNCTION enqueue_site_event_digests(DATE) FROM PUBLIC, anon, authenticated;');
    expect(CODE).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+enqueue_site_event_digests/i);
  });

  it('refuses any run date but the Jakarta date of now()', () => {
    expect(body()).toContain('IF p_run_date IS DISTINCT FROM v_today THEN');
    expect(body()).toMatch(/RAISE EXCEPTION 'DIGEST_RUN_DATE: tanggal kiriman harus hari ini \(WIB\)/);
  });

  it('digests only ACTIVE projects, office roles by membership, owners by membership', () => {
    expect(body()).toContain("WHERE p.status = 'ACTIVE'");
    expect(body()).toContain("WHERE pf.role IN ('admin', 'principal')");
    expect(body()).toContain('JOIN project_assignments pa ON pa.project_id = i.project_id AND pa.user_id = i.owner_id');
    expect(body()).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM office o WHERE o\.project_id = i\.project_id AND o\.profile_id = i\.owner_id\s+\)/);
  });

  it('logs first, once per day, and sends only when the log row is new', () => {
    expect(body()).toContain('ON CONFLICT (project_id, profile_id, run_date) DO NOTHING;');
    expect(body()).toContain('GET DIAGNOSTICS v_logged = ROW_COUNT;');
    expect(body()).toContain('IF v_logged > 0 THEN');
  });

  it('delivers through enqueue_notification_user, deeplinking to RoomBoard with the attention params', () => {
    expect(body()).toContain('PERFORM enqueue_notification_user(');
    expect(body()).toContain("'SITE_EVENT_DIGEST',");
    expect(body()).toContain("'RoomBoard',");
    expect(body()).toContain("jsonb_build_object('projectId', r.project_id, 'attention', true, 'mine', r.kind = 'owner')");
    expect(KNOWN_DEEPLINK_SCREENS).toContain('RoomBoard');
  });

  it('rolls a recipient back unless the notification landed in this transaction, and carries on', () => {
    expect(body()).toMatch(/n\.type = 'SITE_EVENT_DIGEST'\s+AND n\.created_at >= now\(\)/);
    expect(body()).toMatch(/RAISE EXCEPTION 'DIGEST_NOT_LANDED:/);
    expect(body()).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'enqueue_site_event_digests:/);
  });

  it('caps titles at 200 and bodies at 240 characters, and names the project code', () => {
    expect(body()).toContain("left(v_n || ' tugas lapangan perlu ditindak · ' || p.code, 200)");
    expect(body()).toContain('left(v_body, 240)');
  });

  it('writes the owner and office sentences of spec §5.4', () => {
    expect(body()).toContain("CASE WHEN v_a > 0 THEN v_a || ' lewat tenggat' END");
    expect(body()).toContain("CASE WHEN v_b > 0 THEN v_b || ' menghambat' END");
    expect(body()).toContain("' tanpa penanggung jawab.'");
    expect(body()).toContain("' milik Anda.'");
    expect(body()).toContain("' Terlama: '");
    expect(body()).toContain("' (tenggat '");
    expect(body()).toContain("' (menghambat sejak '");
  });

  it('never raises a SITE_EVENT_ code, which no client could map', () => {
    expect(CODE).not.toMatch(/RAISE EXCEPTION 'SITE_EVENT_/);
  });
});

describe('migration 106 - the day label', () => {
  it('is STABLE, not IMMUTABLE, because to_char is STABLE', () => {
    const fn = fnBody('site_event_digest_day');
    expect(fn).toMatch(/LANGUAGE sql\s+STABLE/);
    expect(fn).not.toMatch(/IMMUTABLE/);
    expect(fn).toContain("to_char(d, 'FMDD')");
  });

  it("spells the months exactly as the app's formatWibShort does", () => {
    const fn = fnBody('site_event_digest_day');
    const months = [...(fn.match(/ARRAY\[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(months).toEqual([...WIB_MONTH_ABBR]);
  });
});

describe('migration 106 - notifications.type', () => {
  it("keeps 104's sixteen types and adds exactly SITE_EVENT_DIGEST", () => {
    const before = typeList(read('104_progress_claims.sql'));
    const after = typeList(SQL);
    expect(before).toHaveLength(16);
    for (const t of before) expect(after).toContain(t);
    expect(after.filter((t) => !before.includes(t))).toEqual(['SITE_EVENT_DIGEST']);
  });

  it('widens by shape: every CHECK mentioning type is dropped before the add', () => {
    expect(CODE).toContain("AND pg_get_constraintdef(con.oid) ILIKE '%type%'");
    expect(CODE).toContain("AND con.contype = 'c'");
    expect(CODE.indexOf("EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);")).toBeLessThan(
      CODE.indexOf('ADD CONSTRAINT notifications_type_check'),
    );
  });
});

describe('migration 106 - scheduler', () => {
  const cronBlock = (): string => {
    const start = CODE.indexOf("IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN");
    return CODE.slice(start, CODE.indexOf('END $$;', start));
  };

  it('schedules only when pg_cron exists, unscheduling the old job first', () => {
    const block = cronBlock();
    expect(block).toContain("IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'site_event_digest') THEN");
    expect(block).toContain("PERFORM cron.unschedule('site_event_digest');");
    expect(block.indexOf('cron.unschedule')).toBeLessThan(block.indexOf('cron.schedule('));
    expect(block).toContain("PERFORM cron.schedule('site_event_digest', '0 0 * * 1-6',");
    expect(block).toContain('$cmd$SELECT public.enqueue_site_event_digests()$cmd$');
  });

  it('tells the person pasting how to turn Cron on when it is off', () => {
    expect(cronBlock()).toMatch(/RAISE NOTICE '106: pg_cron belum aktif\. Aktifkan Cron di Dashboard \(Integrations → Cron\), lalu paste 106 lagi\./);
  });

  it('is the last thing that changes anything before RESET', () => {
    expect(CODE.indexOf('PERFORM cron.schedule(')).toBeLessThan(CODE.indexOf('RESET lock_timeout;'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/migration106.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `ENOENT: no such file or directory, open '.../supabase/migrations/106_site_event_digest.sql'`.

- [ ] **Step 3: Write the migration**

The en dash in "Terlama: {room} – {title}", the middle dot in the title and the arrow in the NOTICE are typed as plain UTF-8 characters; there is no `\u` escape anywhere in the file.

Create `supabase/migrations/106_site_event_digest.sql` with exactly this content:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 106 - The morning attention digest, and the list it counts.
--
-- Spec: docs/superpowers/specs/2026-09-26-closure-evidence-and-digest-design.md §5
-- Plan: docs/superpowers/plans/2026-09-26-closure-evidence-and-digest.md (Lane 3, Task 2)
--
-- WHY. An overdue item waits in silence until someone opens the board. This
-- file adds ONE "needs attention" predicate, as the view
-- v_site_event_attention, read both by a 07:00 WIB digest and by the app's
-- "Perlu ditindak" list, so the number in a push and the rows seen on tapping
-- it can never disagree:
--   * v_site_event_attention: open events that are past due on the Jakarta
--     calendar, or blocking since before 00:00 WIB today. security_invoker, so
--     097's RLS on site_events decides who sees which row.
--   * site_event_digest_log: one row per (project, person, WIB day) a digest
--     LANDED for. The UNIQUE key is the idempotence guard (a second run the
--     same day inserts nothing) and the same rows are the only evidence the
--     reminders went out, read by v_site_event_digest_health.
--   * enqueue_site_event_digests(): one message per person per project.
--     Someone who is both an owner and an admin or principal there gets only
--     the office summary, which says "n milik Anda". Delivery rides the
--     existing notifications INSERT webhook (034); nothing to deploy.
--   * The SITE_EVENT_DIGEST notification type, and a pg_cron schedule,
--     Monday to Saturday at 00:00 UTC = 07:00 WIB (WIB has no daylight saving).
--
-- PASTE ORDER. After 104 and 105. It widens the notifications type CHECK that
-- 104 last swapped, and reads site_events and rooms (097) and projects.status.
--
-- RE-PASTE SAFETY. CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY / VIEW IF
-- EXISTS before each create, DROP FUNCTION IF EXISTS by exact signature
-- before each CREATE OR REPLACE, the type CHECK dropped by shape and re-added
-- (the 098/104 pattern), and the cron job unscheduled before it is scheduled
-- again: a second paste changes nothing. SET/RESET lock_timeout bracket every
-- statement.
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. Re-pasting 098 or 104 after this
-- file re-creates the type CHECK without SITE_EVENT_DIGEST: every digest then
-- fails inside its own block, is logged as a WARNING nobody reads, and nobody
-- is told. Re-paste 106 after any re-paste of 098 or 104.
--
-- SCHEDULER. The last block schedules the job only when pg_cron is enabled.
-- Without it the paste still succeeds and prints a NOTICE: enable Cron once
-- (Dashboard, Integrations → Cron) and paste this file again.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The blocking half of the predicate gets its own partial index. The
--    overdue half already has 097's idx_site_events_project_due_open.
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_site_events_blocking_open
  ON site_events(project_id) WHERE status = 'open' AND is_blocking;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. v_site_event_attention - the one "needs attention" predicate
--    owner_on_project is exact for office roles, for the owner, and inside
--    the digest (current_user is the function owner there, the distinction
--    097's guards use). A supervisor reads only their own assignment row
--    (023), so for a colleague's item the answer is unknowable to them: NULL,
--    never a false "no".
-- ───────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_site_event_attention;
CREATE OR REPLACE VIEW v_site_event_attention WITH (security_invoker = true) AS
SELECT e.id AS event_id, e.project_id, e.room_id, r.room_code, r.room_name, r.floor,
       e.gate_code, e.event_type, e.title, e.summary, e.owner_id, pr.full_name AS owner_name,
       CASE WHEN e.owner_id IS NULL THEN FALSE
            WHEN current_user NOT IN ('authenticated', 'anon') OR is_office_role() OR e.owner_id = auth.uid()
              THEN EXISTS (SELECT 1 FROM project_assignments pa
                           WHERE pa.project_id = e.project_id AND pa.user_id = e.owner_id)
            ELSE NULL END AS owner_on_project,
       e.due_date, e.is_blocking, e.confirmed_at,
       COALESCE(e.due_date < t.today, FALSE) AS is_overdue,
       CASE WHEN e.due_date < t.today THEN t.today - e.due_date ELSE 0 END AS days_overdue
FROM site_events e
JOIN rooms r ON r.id = e.room_id
LEFT JOIN profiles pr ON pr.id = e.owner_id
CROSS JOIN (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS today) t
WHERE e.status = 'open'
  AND (e.due_date < t.today
       OR (e.is_blocking AND e.confirmed_at < (t.today::timestamp AT TIME ZONE 'Asia/Jakarta')));

GRANT SELECT ON v_site_event_attention TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. site_event_digest_log - idempotence key and health source in one.
--    Read by office roles only; written only by enqueue_site_event_digests
--    (SECURITY DEFINER), so there is deliberately no write policy.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_event_digest_log (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  run_date    DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('owner', 'office')),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_event_digest_log_once UNIQUE (project_id, profile_id, run_date)
);

ALTER TABLE site_event_digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_event_digest_log_office_read ON site_event_digest_log;
CREATE POLICY site_event_digest_log_office_read ON site_event_digest_log
  FOR SELECT USING (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 4. v_site_event_digest_health - the scheduler, not one project: no row, or
--    one row for the latest run_date across all projects. The log records
--    sends, not runs, so "never sent" is the only empty state it can prove.
-- ───────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_site_event_digest_health;
CREATE OR REPLACE VIEW v_site_event_digest_health WITH (security_invoker = true) AS
SELECT l.run_date AS last_run_date,
       max(l.sent_at) AS last_sent_at,
       count(DISTINCT l.profile_id)::int AS recipients
FROM site_event_digest_log l
WHERE l.run_date = (SELECT max(x.run_date) FROM site_event_digest_log x)
GROUP BY l.run_date;

GRANT SELECT ON v_site_event_digest_health TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. site_event_digest_day - "12 Sep", the app's formatWibShort month list.
--    STABLE, not IMMUTABLE, because to_char is only STABLE.
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS site_event_digest_day(DATE);
CREATE OR REPLACE FUNCTION site_event_digest_day(d DATE)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(d, 'FMDD') || ' ' ||
         (ARRAY['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'])[extract(month FROM d)::int]
$$;

REVOKE ALL ON FUNCTION site_event_digest_day(DATE) FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. enqueue_site_event_digests - one message per person per project
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS enqueue_site_event_digests(DATE);
CREATE OR REPLACE FUNCTION enqueue_site_event_digests(
  p_run_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today  DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_sent   INTEGER := 0;
  r        RECORD;
  v_old    RECORD;
  v_n      INTEGER;
  v_a      INTEGER;
  v_b      INTEGER;
  v_c      INTEGER;
  v_d      INTEGER;
  v_title  TEXT;
  v_body   TEXT;
  v_logged INTEGER;
BEGIN
  -- The view reads events as they are NOW; a digest labelled with another
  -- day would describe today's state under that day's name.
  IF p_run_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'DIGEST_RUN_DATE: tanggal kiriman harus hari ini (WIB), %', v_today;
  END IF;

  FOR r IN
    WITH items AS (
      SELECT a.project_id, a.owner_id
      FROM v_site_event_attention a
      JOIN projects p ON p.id = a.project_id
      WHERE p.status = 'ACTIVE'
    ),
    office AS (
      -- Only people who hold an assignment row on the project: the 092
      -- membership rule. Principals are members of every project by 093.
      SELECT DISTINCT pa.project_id, pa.user_id AS profile_id
      FROM project_assignments pa
      JOIN profiles pf ON pf.id = pa.user_id
      WHERE pf.role IN ('admin', 'principal')
        AND pa.project_id IN (SELECT i.project_id FROM items i)
    ),
    owners AS (
      SELECT DISTINCT i.project_id, i.owner_id AS profile_id
      FROM items i
      JOIN project_assignments pa ON pa.project_id = i.project_id AND pa.user_id = i.owner_id
      WHERE NOT EXISTS (
        SELECT 1 FROM office o WHERE o.project_id = i.project_id AND o.profile_id = i.owner_id
      )
    )
    SELECT o.project_id, o.profile_id, 'office'::text AS kind FROM office o
    UNION ALL
    SELECT w.project_id, w.profile_id, 'owner'::text AS kind FROM owners w
    ORDER BY 1, 2
  LOOP
    BEGIN
      INSERT INTO site_event_digest_log (project_id, profile_id, run_date, kind)
      VALUES (r.project_id, r.profile_id, p_run_date, r.kind)
      ON CONFLICT (project_id, profile_id, run_date) DO NOTHING;
      GET DIAGNOSTICS v_logged = ROW_COUNT;

      IF v_logged > 0 THEN
        IF r.kind = 'office' THEN
          SELECT count(*),
                 count(*) FILTER (WHERE a.is_overdue),
                 count(*) FILTER (WHERE a.is_blocking),
                 count(*) FILTER (WHERE a.owner_on_project IS FALSE),
                 count(*) FILTER (WHERE a.owner_id = r.profile_id)
            INTO v_n, v_a, v_b, v_c, v_d
          FROM v_site_event_attention a
          WHERE a.project_id = r.project_id;

          v_body := concat_ws(', ',
                      CASE WHEN v_a > 0 THEN v_a || ' lewat tenggat' END,
                      CASE WHEN v_b > 0 THEN v_b || ' menghambat' END) || '.'
                 || CASE WHEN v_c > 0 THEN ' ' || v_c || ' tanpa penanggung jawab.' ELSE '' END
                 || CASE WHEN v_d > 0 THEN ' ' || v_d || ' milik Anda.' ELSE '' END;
        ELSE
          SELECT count(*),
                 count(*) FILTER (WHERE a.is_overdue),
                 count(*) FILTER (WHERE a.is_blocking)
            INTO v_n, v_a, v_b
          FROM v_site_event_attention a
          WHERE a.project_id = r.project_id AND a.owner_id = r.profile_id;

          -- "Terlama": the overdue item with the earliest due date, else the
          -- blocking item blocking the longest.
          SELECT a.room_code, a.room_name, a.title, a.due_date, a.confirmed_at, a.is_overdue
            INTO v_old
          FROM v_site_event_attention a
          WHERE a.project_id = r.project_id AND a.owner_id = r.profile_id
          ORDER BY a.is_overdue DESC,
                   CASE WHEN a.is_overdue THEN a.due_date END ASC,
                   a.confirmed_at ASC,
                   a.event_id ASC
          LIMIT 1;

          v_body := concat_ws(', ',
                      CASE WHEN v_a > 0 THEN v_a || ' lewat tenggat' END,
                      CASE WHEN v_b > 0 THEN v_b || ' menghambat' END) || '.'
                 || ' Terlama: ' || COALESCE(v_old.room_code, v_old.room_name) || ' – '
                 || left(COALESCE(v_old.title, 'Kejadian lapangan'), 60)
                 || CASE WHEN v_old.is_overdue
                         THEN ' (tenggat ' || site_event_digest_day(v_old.due_date) || ').'
                         ELSE ' (menghambat sejak '
                              || site_event_digest_day((v_old.confirmed_at AT TIME ZONE 'Asia/Jakarta')::date) || ').'
                    END;
        END IF;

        SELECT left(v_n || ' tugas lapangan perlu ditindak · ' || p.code, 200) INTO v_title
        FROM projects p WHERE p.id = r.project_id;

        PERFORM enqueue_notification_user(
          r.project_id,
          r.profile_id,
          'SITE_EVENT_DIGEST',
          v_title,
          left(v_body, 240),
          'RoomBoard',
          jsonb_build_object('projectId', r.project_id, 'attention', true, 'mine', r.kind = 'owner'),
          NULL,
          NULL,
          NULL
        );

        -- enqueue_notification_user inserts zero rows for a non-member and
        -- raises nothing. created_at >= now() bounds the read-back to THIS
        -- transaction (097's pattern). Nothing landed: roll this recipient's
        -- log row back with the block, so a log row exists if and only if its
        -- notification does.
        IF NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.recipient_user_id = r.profile_id
            AND n.project_id = r.project_id
            AND n.type = 'SITE_EVENT_DIGEST'
            AND n.created_at >= now()
        ) THEN
          RAISE EXCEPTION 'DIGEST_NOT_LANDED: notifikasi untuk % di proyek % tidak tersimpan', r.profile_id, r.project_id;
        END IF;

        v_sent := v_sent + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_site_event_digests: % pada proyek %: %', r.profile_id, r.project_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_sent;
END;
$$;

-- No grant to any app role: only pg_cron and the Dashboard (both postgres)
-- run it, so no app user can trigger a round of pushes.
REVOKE ALL ON FUNCTION enqueue_site_event_digests(DATE) FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. notifications.type: 104's sixteen plus SITE_EVENT_DIGEST
--    Widened by shape, exactly as 098 and 104 do.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED',
      'PLAN_CEILING_RAISE',
      'RETURNED',
      'SITE_EVENT_ASSIGNED',
      'PROGRESS_CLAIM_SUBMITTED',
      'PROGRESS_CLAIM_RETURNED',
      'PROGRESS_CLAIM_VERIFIED',
      'SITE_EVENT_DIGEST'
    ));
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Scheduler: 07:00 WIB, Monday to Saturday. pg_cron evaluates schedules
--    in UTC, and WIB is a fixed UTC+7, so '0 0 * * 1-6' is exact all year.
--    The cron.* statements are planned only when their branch runs, so this
--    block pastes cleanly on a project without pg_cron.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'site_event_digest') THEN
      PERFORM cron.unschedule('site_event_digest');
    END IF;
    PERFORM cron.schedule('site_event_digest', '0 0 * * 1-6',
                          $cmd$SELECT public.enqueue_site_event_digests()$cmd$);
  ELSE
    RAISE NOTICE '106: pg_cron belum aktif. Aktifkan Cron di Dashboard (Integrations → Cron), lalu paste 106 lagi. Tanpa itu pengingat pagi tidak pernah berjalan.';
  END IF;
END $$;

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

SELECT proname, prosecdef, has_function_privilege('authenticated', oid, 'EXECUTE') AS app_exec
FROM pg_proc
WHERE proname IN ('enqueue_site_event_digests', 'site_event_digest_day')
ORDER BY proname;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-6 write nothing)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: two rows, enqueue_site_event_digests with prosecdef = true, and
--    app_exec = false on both.
--
-- 2. The views run as the caller, and the log is readable by office only:
--      SELECT relname, reloptions FROM pg_class
--      WHERE relname IN ('v_site_event_attention', 'v_site_event_digest_health') ORDER BY 1;
--    EXPECTED: two rows, each with {security_invoker=true}.
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'site_event_digest_log';
--    EXPECTED: one row, site_event_digest_log_office_read, SELECT.
--
-- 3. The type list is 104's sixteen plus one:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_type_check';
--    EXPECTED: 17 quoted types, SITE_EVENT_DIGEST and PROGRESS_CLAIM_VERIFIED among them.
--
-- 4. The schedule exists (after Cron is enabled):
--      SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'site_event_digest';
--    EXPECTED: one row, 0 0 * * 1-6, SELECT public.enqueue_site_event_digests().
--    An error "relation cron.job does not exist" means pg_cron is not enabled:
--    enable it (Integrations → Cron) and paste this file again.
--
-- 5. Today's attention list for one project, as the Dashboard sees it:
--      SELECT room_code, title, owner_name, owner_on_project, days_overdue, is_blocking
--      FROM v_site_event_attention WHERE project_id = '<PROJECT_UUID>' ORDER BY days_overdue DESC;
--    EXPECTED: the open items past due or blocking since before today, and
--    owner_on_project exact (true or false, never NULL) for every row.
--
-- 6. A wrong run date is refused:
--      SELECT enqueue_site_event_digests(((now() AT TIME ZONE 'Asia/Jakarta')::date + 1));
--    EXPECTED: ERROR starting DIGEST_RUN_DATE.
--
-- 7. A manual run sends only what was not sent today (this one WRITES: it
--    sends real pushes, exactly as the 07:00 job would):
--      SELECT enqueue_site_event_digests();
--    EXPECTED: the number of people told; run it again and it returns 0.
--      SELECT * FROM v_site_event_digest_health;
--    EXPECTED: one row with today's date once anybody was told.
--
-- 8. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-4 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 4: Run the guard and every suite that reads later migrations**

Run:

```bash
npx jest tools/__tests__/migration106.test.ts tools/__tests__/migration104.test.ts tools/__tests__/migration098.test.ts tools/__tests__/migration096.test.ts tools/__tests__/migration103.test.ts tools/__tests__/migration099.test.ts tools/__tests__/migration100.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, all seven suites (104's "a later swap of the notification type CHECK keeps the three claim types" now reads 106 too).

- [ ] **Step 5: Scan the new file for invisible characters**

Run:

```bash
perl -CSD -ne 'print qq($.: $_) if /[\x{200B}-\x{200F}\x{2028}\x{2029}\x{FEFF}\x{00A0}]/' supabase/migrations/106_site_event_digest.sql
```

Expected: no output.

- [ ] **Step 6: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 7: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T2.txt` with the Write tool (never a heredoc), exactly:

```text
feat(db): 106 the morning attention digest

v_site_event_attention (one predicate for the digest and the app),
site_event_digest_log (idempotence key and health source),
enqueue_site_event_digests (no app grant; one message per person per
project; a log row iff its notification landed), SITE_EVENT_DIGEST, and
the 07:00 WIB Monday-Saturday pg_cron job. Closure spec 2026-09-26 §5.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add supabase/migrations/106_site_event_digest.sql tools/__tests__/migration106.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T2.txt -- supabase/migrations/106_site_event_digest.sql tools/__tests__/migration106.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `supabase/migrations/106_site_event_digest.sql`, `tools/__tests__/migration106.test.ts`.


### L3-T3 (Lane 3, Task 3): `tools/siteEventAttention.ts`: the two reads and the row rules

Spec §5.6. `listSiteEventAttention(projectId)` and `getDigestHealth()` return `{ rows } | { error }` and `{ last } | { error }` (the `RoomBoardResult` shape, `tools/roomBoard.ts:31-45`), so a failed read can never render as an empty list or as "never sent". The pure helpers (`filterMine`, `attentionHeading`, `attentionRoomLabel`, `attentionChips`) keep the component thin. `attentionChips` says "Tanpa penanggung jawab" only when `owner_on_project` is `false`, never when it is `null` (a supervisor reading a colleague's item).

**Files:**
- Create: `tools/siteEventAttention.ts`
- Create: `tools/__tests__/siteEventAttention.test.ts`

**Owns (no other lane edits these):** `tools/siteEventAttention.ts`, `tools/__tests__/siteEventAttention.test.ts`

**Depends on:** Nothing.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/siteEventAttention.test.ts` with exactly this content:

```ts
/**
 * "Perlu ditindak" reads migration 106's v_site_event_attention, the same
 * predicate the morning digest counts, and the office health line reads
 * v_site_event_digest_health. A failed read is an error, never an empty list
 * or a "never sent" (closure spec 2026-09-26 §1.1 rule 4).
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import {
  ATTENTION_COLUMNS,
  ATTENTION_LIMIT,
  attentionChips,
  attentionHeading,
  attentionRoomLabel,
  filterMine,
  getDigestHealth,
  listSiteEventAttention,
  type AttentionRow,
} from '../siteEventAttention';

const mocked = supabase as unknown as { from: jest.Mock };
const calls: string[] = [];

/** Records every builder call and resolves to `result` whichever method is awaited last. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'maybeSingle']) {
    c[name] = (...args: unknown[]) => {
      calls.push(`${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
      return c;
    };
  }
  c.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  event_id: 'e1', project_id: 'p1', room_id: 'r1', room_code: 'LT1-R01', room_name: 'Kamar Tidur 1', floor: '1',
  gate_code: null, event_type: 'isu', title: 'Retak dinding', summary: null, owner_id: 'u1', owner_name: 'Budi',
  owner_on_project: true, due_date: '2026-09-14', is_blocking: false, confirmed_at: '2026-09-12T02:00:00Z',
  is_overdue: true, days_overdue: 3, ...over,
});

beforeEach(() => {
  calls.length = 0;
  mocked.from.mockReset();
});

describe('listSiteEventAttention', () => {
  it('reads one project, longest overdue first, capped at 200', async () => {
    mocked.from.mockReturnValueOnce(chain({ data: [row()], error: null }));
    const result = await listSiteEventAttention('p1');
    expect(result).toEqual({ rows: [row()] });
    expect(mocked.from).toHaveBeenCalledWith('v_site_event_attention');
    expect(calls).toEqual([
      `select:${JSON.stringify(ATTENTION_COLUMNS)}`,
      'eq:"project_id":"p1"',
      'order:"days_overdue":{"ascending":false}',
      'order:"due_date":{"ascending":true}',
      'order:"confirmed_at":{"ascending":true}',
      'order:"event_id":{"ascending":true}',
      `limit:${ATTENTION_LIMIT}`,
    ]);
  });

  it('returns the error, never an empty list, when the read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockReturnValueOnce(chain({ data: null, error: { message: 'network down' } }));
    expect(await listSiteEventAttention('p1')).toEqual({ error: 'network down' });
    warn.mockRestore();
  });
});

describe('getDigestHealth', () => {
  it('returns the latest run', async () => {
    const last = { last_run_date: '2026-09-17', last_sent_at: '2026-09-17T00:00:04Z', recipients: 4 };
    mocked.from.mockReturnValueOnce(chain({ data: last, error: null }));
    expect(await getDigestHealth()).toEqual({ last });
    expect(mocked.from).toHaveBeenCalledWith('v_site_event_digest_health');
  });

  it('returns last: null only when the view has no row', async () => {
    mocked.from.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await getDigestHealth()).toEqual({ last: null });
  });

  it('returns the error, never "never sent", when the read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.from.mockReturnValueOnce(chain({ data: null, error: { message: 'permission denied' } }));
    expect(await getDigestHealth()).toEqual({ error: 'permission denied' });
    warn.mockRestore();
  });
});

describe('pure helpers', () => {
  it('filters Milik saya to the viewer, and to nothing when signed out', () => {
    const rows = [row(), row({ event_id: 'e2', owner_id: 'u2' })];
    expect(filterMine(rows, 'u2').map((r) => r.event_id)).toEqual(['e2']);
    expect(filterMine(rows, null)).toEqual([]);
  });

  it('titles the list with the shown count, or says it was capped', () => {
    expect(attentionHeading(3, 3)).toBe('Perlu ditindak (3)');
    expect(attentionHeading(3, 1)).toBe('Perlu ditindak (1)');
    expect(attentionHeading(200, 200)).toBe('Perlu ditindak (200 teratas)');
  });

  it('labels a room by code and name, or by name alone', () => {
    expect(attentionRoomLabel(row())).toBe('LT1-R01 · Kamar Tidur 1');
    expect(attentionRoomLabel(row({ room_code: null }))).toBe('Kamar Tidur 1');
  });

  it('shows Lewat n hari from one day late, and Menghambat on a blocking item', () => {
    expect(attentionChips(row({ days_overdue: 0, is_overdue: false, is_blocking: true }), { showOwner: false, closePending: false }))
      .toEqual([{ label: 'Menghambat', tone: 'block' }]);
    expect(attentionChips(row({ days_overdue: 1 }), { showOwner: false, closePending: false }))
      .toEqual([{ label: 'Lewat 1 hari', tone: 'late' }]);
  });

  it('adds Menunggu kirim while a close for the row is still on this phone', () => {
    expect(attentionChips(row(), { showOwner: false, closePending: true }).map((c) => c.label)).toEqual(['Lewat 3 hari', 'Menunggu kirim']);
  });

  it('names the owner in office layouts, or Tanpa penanggung jawab only when the view knows the owner is gone', () => {
    expect(attentionChips(row(), { showOwner: true, closePending: false }).map((c) => c.label)).toEqual(['Lewat 3 hari', 'Budi']);
    expect(attentionChips(row({ owner_on_project: false }), { showOwner: true, closePending: false }).map((c) => c.label))
      .toEqual(['Lewat 3 hari', 'Tanpa penanggung jawab']);
    expect(attentionChips(row({ owner_on_project: false, owner_id: null, owner_name: null }), { showOwner: true, closePending: false }).map((c) => c.label))
      .toEqual(['Lewat 3 hari', 'Tanpa penanggung jawab']);
    // A supervisor reads NULL for a colleague's item: unknown, so no claim either way.
    expect(attentionChips(row({ owner_on_project: null, owner_name: null }), { showOwner: true, closePending: false }).map((c) => c.label))
      .toEqual(['Lewat 3 hari']);
    expect(attentionChips(row(), { showOwner: false, closePending: false }).map((c) => c.label)).toEqual(['Lewat 3 hari']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest tools/__tests__/siteEventAttention.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2307: Cannot find module '../siteEventAttention' or its corresponding type declarations.`

- [ ] **Step 3: Implement**

Create `tools/siteEventAttention.ts` with exactly this content:

```ts
// SANO - "Perlu ditindak" and the digest health line (closure spec 2026-09-26 §5.6).
//
// Reads migration 106's two views. v_site_event_attention is the SAME
// predicate the 07:00 digest counts, so the number in a push and the rows seen
// on tapping it cannot disagree. Both reads return a read error rather than an
// empty result on failure (the RoomBoardResult shape, tools/roomBoard.ts): a
// dropped connection must never render as "nothing needs attention" (CLAUDE.md §12).

import { supabase } from './supabase';
import type { SiteEventType } from './types';

/** The list shows at most this many rows; the title then says "(200 teratas)". */
export const ATTENTION_LIMIT = 200;

/** Every column of v_site_event_attention, one literal (see the ROOM_COLUMNS note in tools/rooms.ts). */
export const ATTENTION_COLUMNS =
  'event_id, project_id, room_id, room_code, room_name, floor, gate_code, event_type, title, summary, ' +
  'owner_id, owner_name, owner_on_project, due_date, is_blocking, confirmed_at, is_overdue, days_overdue';

export interface AttentionRow {
  event_id: string;
  project_id: string;
  room_id: string;
  room_code: string | null;
  room_name: string;
  floor: string | null;
  gate_code: string | null;
  event_type: SiteEventType | null;
  title: string | null;
  summary: string | null;
  owner_id: string | null;
  owner_name: string | null;
  /** NULL when the reader's own RLS cannot see the owner's membership (a supervisor, for a colleague's item). */
  owner_on_project: boolean | null;
  due_date: string | null;
  is_blocking: boolean;
  confirmed_at: string | null;
  is_overdue: boolean;
  days_overdue: number;
}

export type AttentionResult = { rows: AttentionRow[] } | { error: string };

export async function listSiteEventAttention(projectId: string): Promise<AttentionResult> {
  const { data, error } = await supabase
    .from('v_site_event_attention')
    .select(ATTENTION_COLUMNS)
    .eq('project_id', projectId)
    .order('days_overdue', { ascending: false })
    .order('due_date', { ascending: true })
    .order('confirmed_at', { ascending: true })
    .order('event_id', { ascending: true })
    .limit(ATTENTION_LIMIT);
  if (error) {
    console.warn('listSiteEventAttention failed:', error.message);
    return { error: error.message };
  }
  return { rows: (data ?? []) as unknown as AttentionRow[] };
}

export interface DigestHealth {
  last_run_date: string;
  last_sent_at: string;
  recipients: number;
}

/** `last` is null when the log has no row at all: no digest has ever landed. */
export type DigestHealthResult = { last: DigestHealth | null } | { error: string };

export async function getDigestHealth(): Promise<DigestHealthResult> {
  const { data, error } = await supabase
    .from('v_site_event_digest_health')
    .select('last_run_date, last_sent_at, recipients')
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('getDigestHealth failed:', error.message);
    return { error: error.message };
  }
  return { last: (data as DigestHealth | null) ?? null };
}

// ─── Pure ────────────────────────────────────────────────────────────────────

/** "Milik saya": the same rows, filtered, with no second query. */
export function filterMine(rows: ReadonlyArray<AttentionRow>, viewerId: string | null): AttentionRow[] {
  if (!viewerId) return [];
  return rows.filter((r) => r.owner_id === viewerId);
}

/** "Perlu ditindak (n)", or "(200 teratas)" when the read hit the cap. */
export function attentionHeading(totalRead: number, shown: number): string {
  return totalRead >= ATTENTION_LIMIT ? `Perlu ditindak (${ATTENTION_LIMIT} teratas)` : `Perlu ditindak (${shown})`;
}

/** "LT1-R01 · Kamar Tidur 1", or the name alone when the room has no code. */
export function attentionRoomLabel(row: Pick<AttentionRow, 'room_code' | 'room_name'>): string {
  return row.room_code ? `${row.room_code} · ${row.room_name}` : row.room_name;
}

export type AttentionChipTone = 'late' | 'block' | 'pending' | 'owner' | 'unowned';

export interface AttentionChip {
  label: string;
  tone: AttentionChipTone;
}

/**
 * The row's chips, in order. The owner chip is for office layouts only; it
 * says "Tanpa penanggung jawab" only when the view KNOWS the owner is gone
 * (owner_on_project false), never when the reader simply cannot see it (null).
 */
export function attentionChips(
  row: AttentionRow,
  opts: { showOwner: boolean; closePending: boolean },
): AttentionChip[] {
  const chips: AttentionChip[] = [];
  if (row.days_overdue >= 1) chips.push({ label: `Lewat ${row.days_overdue} hari`, tone: 'late' });
  if (row.is_blocking) chips.push({ label: 'Menghambat', tone: 'block' });
  if (opts.closePending) chips.push({ label: 'Menunggu kirim', tone: 'pending' });
  if (opts.showOwner) {
    if (row.owner_on_project === false) chips.push({ label: 'Tanpa penanggung jawab', tone: 'unowned' });
    else if (row.owner_name) chips.push({ label: row.owner_name, tone: 'owner' });
  }
  return chips;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest tools/__tests__/siteEventAttention.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T3.txt` with the Write tool (never a heredoc), exactly:

```text
feat(rooms): read the attention list and the digest health

Both reads return an error instead of an empty result; the row chips
never claim an owner is gone when the reader simply cannot see it.
Closure spec 2026-09-26 §5.6.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add tools/siteEventAttention.ts tools/__tests__/siteEventAttention.test.ts && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T3.txt -- tools/siteEventAttention.ts tools/__tests__/siteEventAttention.test.ts
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `tools/siteEventAttention.ts`, `tools/__tests__/siteEventAttention.test.ts`.


### L3-T4 (Lane 3, Task 4): `DigestHealthLine`: when the morning digest last went out

Spec §5.6: "Pengingat terakhir: 17 Sep 07.00 · 4 orang", "Pengingat harian belum pernah terkirim" when the view has no row, "Status pengingat harian gagal dimuat." (with "Coba lagi", §6) on a failed read. Office and principal layouts only.

**Files:**
- Create: `office/screens/rooms/DigestHealthLine.tsx`
- Create: `office/screens/rooms/__tests__/DigestHealthLine.test.tsx`

**Owns (no other lane edits these):** `office/screens/rooms/DigestHealthLine.tsx`, `office/screens/rooms/__tests__/DigestHealthLine.test.tsx`

**Depends on:** Lane 3 Task 3 and **Lane 2 Task 1 committed** (`formatWibShort`).

- [ ] **Step 1: Write the failing test**

Create `office/screens/rooms/__tests__/DigestHealthLine.test.tsx` with exactly this content:

```tsx
// office/screens/rooms/__tests__/DigestHealthLine.test.tsx
//
// Closure spec 2026-09-26 §5.6: last run, never sent, read error - and a read
// error never reads as "belum pernah terkirim".
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../tools/siteEventAttention', () => ({ getDigestHealth: jest.fn() }));

import { getDigestHealth } from '../../../../tools/siteEventAttention';
import DigestHealthLine from '../DigestHealthLine';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DigestHealthLine', () => {
  it('names the last send in WIB and how many people it reached', async () => {
    (getDigestHealth as jest.Mock).mockResolvedValue({
      last: { last_run_date: '2026-09-17', last_sent_at: '2026-09-17T00:00:04.000Z', recipients: 4 },
    });
    const { findByText } = render(<DigestHealthLine />);
    expect(await findByText('Pengingat terakhir: 17 Sep 07.00 · 4 orang')).toBeTruthy();
  });

  it('says never sent only when the view has no row', async () => {
    (getDigestHealth as jest.Mock).mockResolvedValue({ last: null });
    const { findByText } = render(<DigestHealthLine />);
    expect(await findByText('Pengingat harian belum pernah terkirim')).toBeTruthy();
  });

  it('says the read failed, never "belum pernah", and retries', async () => {
    (getDigestHealth as jest.Mock)
      .mockResolvedValueOnce({ error: 'network down' })
      .mockResolvedValueOnce({ last: null });
    const utils = render(<DigestHealthLine />);
    expect(await utils.findByText('Status pengingat harian gagal dimuat.')).toBeTruthy();
    expect(utils.queryByText('Pengingat harian belum pernah terkirim')).toBeNull();

    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(utils.getByText('Pengingat harian belum pernah terkirim')).toBeTruthy());
    expect(getDigestHealth).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest office/screens/rooms/__tests__/DigestHealthLine.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2307: Cannot find module '../DigestHealthLine' or its corresponding type declarations.`

- [ ] **Step 3: Implement**

Create `office/screens/rooms/DigestHealthLine.tsx` with exactly this content:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { getDigestHealth, type DigestHealthResult } from '../../../tools/siteEventAttention';
import { formatWibShort } from '../../../tools/timeWindow';
import { COLORS, FONTS, SPACE, TYPE } from '../../../workflows/theme';

/**
 * The office health line under "Perlu ditindak" (closure spec 2026-09-26
 * §5.6). It reads site_event_digest_log through v_site_event_digest_health,
 * which records SENDS, not runs: a morning on which nobody needed a message
 * leaves no trace, so "belum pernah terkirim" is the only empty sentence the
 * table can prove. A failed read says so, never "belum pernah".
 */
export default function DigestHealthLine({ reloadKey }: { reloadKey?: number }) {
  const [result, setResult] = useState<DigestHealthResult | null>(null);

  const load = useCallback(async () => {
    setResult(null);
    setResult(await getDigestHealth());
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (result === null) {
    return <Text style={styles.muted}>Memuat status pengingat harian…</Text>;
  }
  if ('error' in result) {
    return (
      <View style={styles.row}>
        <Text style={styles.error}>Status pengingat harian gagal dimuat.</Text>
        <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.link}>Coba lagi</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (result.last === null) {
    return <Text style={styles.muted}>Pengingat harian belum pernah terkirim</Text>;
  }
  return (
    <Text style={styles.muted}>
      Pengingat terakhir: {formatWibShort(result.last.last_sent_at)} · {result.last.recipients} orang
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  muted: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.sm, paddingHorizontal: SPACE.xs },
  error: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical },
  retry: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest office/screens/rooms/__tests__/DigestHealthLine.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T4.txt` with the Write tool (never a heredoc), exactly:

```text
feat(rooms): the digest health line

Last send in WIB and how many people it reached; "belum pernah
terkirim" only when the log is empty; a failed read says so. Closure
spec 2026-09-26 §5.6.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add office/screens/rooms/DigestHealthLine.tsx office/screens/rooms/__tests__/DigestHealthLine.test.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T4.txt -- office/screens/rooms/DigestHealthLine.tsx office/screens/rooms/__tests__/DigestHealthLine.test.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `office/screens/rooms/DigestHealthLine.tsx`, `office/screens/rooms/__tests__/DigestHealthLine.test.tsx`.


### L3-T5 (Lane 3, Task 5): `AttentionList`: "Perlu ditindak" with Milik saya

Spec §5.6 and the §4.5 row "Perlu ditindak". Title "Perlu ditindak ({n})" or "(200 teratas)"; rows `{room_code} · {room_name}`, the title, and chips "Lewat {d} hari", "Menghambat", "Menunggu kirim" and, in office layouts, the owner or "Tanpa penanggung jawab"; a tap opens `SiteEventDetail`. Loading shows a spinner; an error shows the error and "Coba lagi", never the empty text. "Milik saya" filters the same rows with no second query; `mineRequest` (a fresh object per notification tap) re-applies it. The list receives the pending close ids as a prop, so it never reads the queue itself.

**Files:**
- Create: `office/screens/rooms/AttentionList.tsx`
- Create: `office/screens/rooms/__tests__/AttentionList.test.tsx`

**Owns (no other lane edits these):** `office/screens/rooms/AttentionList.tsx`, `office/screens/rooms/__tests__/AttentionList.test.tsx`

**Depends on:** Lane 3 Task 3.

- [ ] **Step 1: Write the failing test**

Create `office/screens/rooms/__tests__/AttentionList.test.tsx` with exactly this content:

```tsx
// office/screens/rooms/__tests__/AttentionList.test.tsx
//
// Closure spec 2026-09-26 §5.6: loading, a read error that never shows the
// empty text, the empty text in both toggle states, the rows and their chips,
// the Milik saya filter, the deeplink turning it on, "Menunggu kirim", and a
// tap opening the event.
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../tools/siteEventAttention', () => {
  const actual = jest.requireActual('../../../../tools/siteEventAttention');
  return { ...actual, listSiteEventAttention: jest.fn() };
});

import { listSiteEventAttention, type AttentionRow } from '../../../../tools/siteEventAttention';
import AttentionList, { type AttentionListProps } from '../AttentionList';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  event_id: 'e1', project_id: 'p1', room_id: 'r1', room_code: 'LT1-R01', room_name: 'Kamar Tidur 1', floor: '1',
  gate_code: null, event_type: 'isu', title: 'Retak dinding', summary: null, owner_id: 'u1', owner_name: 'Budi',
  owner_on_project: true, due_date: '2026-09-14', is_blocking: false, confirmed_at: '2026-09-12T02:00:00Z',
  is_overdue: true, days_overdue: 3, ...over,
});

const ROWS = [
  row(),
  row({ event_id: 'e2', room_code: null, room_name: 'Area Umum', title: 'Pompa mati', owner_id: 'u2', owner_name: 'Sari', is_blocking: true, days_overdue: 0, is_overdue: false }),
  row({ event_id: 'e3', title: 'Keramik pecah', owner_id: 'u9', owner_name: 'Andi', owner_on_project: false, days_overdue: 1 }),
];

const renderList = (over: Partial<AttentionListProps> = {}) => {
  const onOpenEvent = jest.fn();
  const props: AttentionListProps = {
    projectId: 'p1', viewerId: 'u1', showOwner: false, pendingEventIds: new Set<string>(), onOpenEvent, ...over,
  };
  return { ...render(<AttentionList {...props} />), onOpenEvent, props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (listSiteEventAttention as jest.Mock).mockResolvedValue({ rows: ROWS });
});

describe('AttentionList', () => {
  it('shows a spinner while loading, then the rows with their chips', async () => {
    let resolve!: (v: unknown) => void;
    (listSiteEventAttention as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const utils = renderList();
    expect(utils.getByLabelText('Memuat daftar perlu ditindak')).toBeTruthy();

    resolve({ rows: ROWS });
    await waitFor(() => expect(utils.getByText('Perlu ditindak (3)')).toBeTruthy());
    expect(utils.getByText('Retak dinding')).toBeTruthy();
    expect(utils.getAllByText('LT1-R01 · Kamar Tidur 1')).toHaveLength(2);
    expect(utils.getByText('Area Umum')).toBeTruthy();
    expect(utils.getByText('Lewat 3 hari')).toBeTruthy();
    expect(utils.getByText('Menghambat')).toBeTruthy();
    expect(utils.getByText('Lewat 1 hari')).toBeTruthy();
    expect(listSiteEventAttention).toHaveBeenCalledWith('p1');
  });

  it('shows a read error with Coba lagi, and never the empty text', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValueOnce({ error: 'network down' });
    const utils = renderList();
    await waitFor(() =>
      expect(utils.getByText('Daftar perlu ditindak gagal dimuat. Periksa koneksi lalu coba lagi.')).toBeTruthy(),
    );
    expect(utils.queryByText('Tidak ada yang perlu ditindak.')).toBeNull();

    fireEvent.press(utils.getByText('Coba lagi'));
    await waitFor(() => expect(utils.getByText('Retak dinding')).toBeTruthy());
    expect(listSiteEventAttention).toHaveBeenCalledTimes(2);
  });

  it('says there is nothing to do, in both toggle states', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValue({ rows: [] });
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Tidak ada yang perlu ditindak.')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Milik saya'));
    expect(utils.getByText('Tidak ada tugas Anda yang perlu ditindak.')).toBeTruthy();
  });

  it('filters the same rows to the viewer with Milik saya, with no second query', async () => {
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Perlu ditindak (3)')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Milik saya'));
    expect(utils.getByText('Perlu ditindak (1)')).toBeTruthy();
    expect(utils.getByText('Retak dinding')).toBeTruthy();
    expect(utils.queryByText('Pompa mati')).toBeNull();
    expect(listSiteEventAttention).toHaveBeenCalledTimes(1);
  });

  it('turns Milik saya on from a deeplink, and again on a second tap of the same link', async () => {
    const first = { mine: true };
    const utils = renderList({ mineRequest: first });
    await waitFor(() => expect(utils.getByText('Perlu ditindak (1)')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Milik saya')); // the person turns it off
    expect(utils.getByText('Perlu ditindak (3)')).toBeTruthy();

    utils.rerender(
      <AttentionList {...utils.props} mineRequest={{ mine: true }} />,
    );
    expect(utils.getByText('Perlu ditindak (1)')).toBeTruthy();
  });

  it('marks a row whose close is still on this phone', async () => {
    const utils = renderList({ pendingEventIds: new Set(['e2']) });
    await waitFor(() => expect(utils.getByText('Menunggu kirim')).toBeTruthy());
    expect(utils.getAllByText('Menunggu kirim')).toHaveLength(1);
  });

  it('names owners in office layouts, and says Tanpa penanggung jawab only where the view knows it', async () => {
    const utils = renderList({ showOwner: true });
    await waitFor(() => expect(utils.getByText('Budi')).toBeTruthy());
    expect(utils.getByText('Sari')).toBeTruthy();
    expect(utils.getByText('Tanpa penanggung jawab')).toBeTruthy();
    expect(utils.queryByText('Andi')).toBeNull();
  });

  it('opens the event on a tap', async () => {
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Pompa mati')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Buka kejadian Pompa mati'));
    expect(utils.onOpenEvent).toHaveBeenCalledWith('e2', 'p1');
  });

  it('says the list was capped at 200', async () => {
    (listSiteEventAttention as jest.Mock).mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => row({ event_id: `e${i}`, title: `Item ${i}` })),
    });
    const utils = renderList();
    await waitFor(() => expect(utils.getByText('Perlu ditindak (200 teratas)')).toBeTruthy());
  });

  it('refetches when the board bumps reloadKey', async () => {
    const utils = renderList({ reloadKey: 1 });
    await waitFor(() => expect(listSiteEventAttention).toHaveBeenCalledTimes(1));
    utils.rerender(<AttentionList {...utils.props} reloadKey={2} />);
    await waitFor(() => expect(listSiteEventAttention).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest office/screens/rooms/__tests__/AttentionList.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2307: Cannot find module '../AttentionList' or its corresponding type declarations.`

- [ ] **Step 3: Implement**

Create `office/screens/rooms/AttentionList.tsx` with exactly this content:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Card from '../../../workflows/components/Card';
import {
  attentionChips, attentionHeading, attentionRoomLabel, filterMine, listSiteEventAttention,
  type AttentionChipTone, type AttentionRow,
} from '../../../tools/siteEventAttention';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';

export interface AttentionListProps {
  projectId: string;
  /** The signed-in profile, for "Milik saya". */
  viewerId: string | null;
  /** Office and principal layouts name the owner on each row. */
  showOwner: boolean;
  /**
   * Set from a notification tap's params (spec §5.6). A fresh object per tap
   * re-applies `mine` even when the list is already on screen, because
   * routeDeeplink copies params (workflows/pendingDeeplink.ts).
   */
  mineRequest?: { mine: boolean } | null;
  /** Events this phone holds a pending close job for (captureQueueStore.pendingCloseFor). */
  pendingEventIds: ReadonlySet<string>;
  onOpenEvent: (eventId: string, projectId: string) => void;
  /** Bumped by the board on focus and pull-to-refresh, so this list refetches with it. */
  reloadKey?: number;
}

const CHIP_TONE: Record<AttentionChipTone, { fg: string; bg: string }> = {
  late: { fg: COLORS.high, bg: COLORS.highBg },
  block: { fg: COLORS.critical, bg: COLORS.criticalBg },
  pending: { fg: COLORS.info, bg: COLORS.infoBg },
  owner: { fg: COLORS.accentDark, bg: COLORS.accentBg },
  unowned: { fg: COLORS.warning, bg: COLORS.warningBg },
};

/**
 * "Perlu ditindak" (closure spec 2026-09-26 §5.6): the same rows the 07:00
 * digest counts, at the top of Papan Ruangan for every role. A failed read is
 * shown as a failed read, never as "nothing to do" (spec §1.1 rule 4).
 */
export default function AttentionList(props: AttentionListProps) {
  const { projectId, viewerId, showOwner, mineRequest, pendingEventIds, onOpenEvent, reloadKey } = props;
  const [rows, setRows] = useState<AttentionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(mineRequest?.mine ?? false);

  useEffect(() => {
    if (mineRequest) setMine(mineRequest.mine);
  }, [mineRequest]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listSiteEventAttention(projectId);
    if ('error' in result) {
      setError(result.error);
      setRows(null);
    } else {
      setError(null);
      setRows(result.rows);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const shown = useMemo(() => (rows ? (mine ? filterMine(rows, viewerId) : rows) : []), [rows, mine, viewerId]);
  const title = rows ? attentionHeading(rows.length, shown.length) : 'Perlu ditindak';

  const minePill = (
    <TouchableOpacity
      style={[styles.pill, mine && styles.pillOn]}
      onPress={() => setMine((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ selected: mine }}
      accessibilityLabel="Milik saya"
    >
      <Text style={[styles.pillText, mine && styles.pillTextOn]}>Milik saya</Text>
    </TouchableOpacity>
  );

  return (
    <Card title={title} borderColor={shown.length > 0 ? COLORS.high : undefined} rightAction={minePill}>
      {loading ? <ActivityIndicator color={COLORS.primary} accessibilityLabel="Memuat daftar perlu ditindak" /> : null}

      {!loading && error !== null ? (
        <View>
          <Text style={styles.errorText}>Daftar perlu ditindak gagal dimuat. Periksa koneksi lalu coba lagi.</Text>
          <TouchableOpacity onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
            <Text style={styles.retryText}>Coba lagi</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!loading && error === null && shown.length === 0 ? (
        <Text style={styles.empty}>{mine ? 'Tidak ada tugas Anda yang perlu ditindak.' : 'Tidak ada yang perlu ditindak.'}</Text>
      ) : null}

      {!loading && error === null
        ? shown.map((r) => (
          <TouchableOpacity
            key={r.event_id}
            style={styles.row}
            onPress={() => onOpenEvent(r.event_id, r.project_id)}
            accessibilityRole="button"
            accessibilityLabel={`Buka kejadian ${r.title ?? 'tanpa judul'}`}
          >
            <Text style={styles.room}>{attentionRoomLabel(r)}</Text>
            <Text style={styles.title} numberOfLines={2}>{r.title ?? 'Kejadian lapangan'}</Text>
            <View style={styles.chipRow}>
              {attentionChips(r, { showOwner, closePending: pendingEventIds.has(r.event_id) }).map((c) => (
                <View key={c.label} style={[styles.chip, { backgroundColor: CHIP_TONE[c.tone].bg }]}>
                  <Text style={[styles.chipText, { color: CHIP_TONE[c.tone].fg }]}>{c.label}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        ))
        : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },
  errorText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.critical, lineHeight: 18, marginBottom: SPACE.sm },
  retryBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, textTransform: 'uppercase' },
  pill: { paddingHorizontal: SPACE.sm, paddingVertical: 5, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border },
  pillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  pillTextOn: { color: COLORS.textInverse },
  row: { paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub, minHeight: 48 },
  room: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  title: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text, marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.xs },
  chip: { borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipText: { fontSize: 10, fontFamily: FONTS.semibold },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest office/screens/rooms/__tests__/AttentionList.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 5: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 6: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T5.txt` with the Write tool (never a heredoc), exactly:

```text
feat(rooms): Perlu ditindak with Milik saya

The digest's rows at the top of Papan Ruangan: lateness, blocking,
pending close and owner chips; Milik saya filters without a second query
and a notification tap turns it on. Closure spec 2026-09-26 §5.6.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add office/screens/rooms/AttentionList.tsx office/screens/rooms/__tests__/AttentionList.test.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T5.txt -- office/screens/rooms/AttentionList.tsx office/screens/rooms/__tests__/AttentionList.test.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `office/screens/rooms/AttentionList.tsx`, `office/screens/rooms/__tests__/AttentionList.test.tsx`.


### L3-T6 (Lane 3, Task 6): Mount the list on every Papan Ruangan, and read the digest's params

Spec §5.6. `RoomBoardView` renders `AttentionList` above the summary card, so the supervisor `RoomBoardScreen` and the office and principal Rooms tabs all get it; it computes the pending close ids from the queue (`useCaptureQueueEntries` + `pendingCloseFor`) and bumps a `reloadKey` on every board load so the list and the health line refetch with the board. The three screens read `route.params` (`{ projectId, attention, mine }`) into a memoised `mineRequest`, so a fresh params object per tap re-applies "Milik saya"; `RoomsAdminScreen` also switches to its board (`sub = 'board'`, `RoomsAdminScreen.tsx:36`) when `params.attention` is true. The office and principal layouts pass `showOwners` and `showDigestHealth`. A `SiteEventDetail` route is registered in all three navigators (097 plan), so a row tap needs no navigator change.

**Files:**
- Modify: `office/screens/rooms/RoomBoardView.tsx`: imports (lines 12-14); props (lines 34-42); after the destructure; in `load` (line 58); above the summary `Card` (line 136)
- Modify: `workflows/screens/RoomBoardScreen.tsx` (whole component)
- Modify: `office/screens/RoomsAdminScreen.tsx`: import (line 5); after `navigation` (line 34); the board mount (lines 197-208)
- Modify: `office/screens/PrincipalRoomsScreen.tsx` (whole component)
- Create: `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx`

**Owns (no other lane edits these):** `office/screens/rooms/RoomBoardView.tsx`, `workflows/screens/RoomBoardScreen.tsx`, `office/screens/RoomsAdminScreen.tsx`, `office/screens/PrincipalRoomsScreen.tsx`, `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx`

**Depends on:** Lane 3 Tasks 4 and 5, and **Lane 2 Task 4 committed** (`pendingCloseFor` and the `CloseJob` kind).

- [ ] **Step 1: Write the failing wiring test**

`AttentionList` and `DigestHealthLine` are mocked (their own suites cover them); `useFocusEffect` runs as a plain effect; `pendingCloseFor` is mocked with the same rule as Lane 2's (a close job for the event, not `done`, not `superseded`) because the real store pulls in AsyncStorage and the filesystem.

Create `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx` with exactly this content:

```tsx
// office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx
//
// Closure spec 2026-09-26 §5.6: "Perlu ditindak" sits at the top of every
// Papan Ruangan. The board hands it the viewer, the deeplink's Milik saya
// request and the events this phone still holds a close for; the office and
// principal layouts also get owner names and the digest health line.
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const ReactLocal = require('react');
    ReactLocal.useEffect(() => effect(), [effect]);
  },
}));
jest.mock('../../../../tools/roomBoard', () => {
  const actual = jest.requireActual('../../../../tools/roomBoard');
  return { ...actual, listRoomBoard: jest.fn(async () => ({ rooms: [] })) };
});
let mockEntries: Array<Record<string, unknown>> = [];
jest.mock('../../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => mockEntries),
  pendingCloseFor: jest.fn((entries: Array<Record<string, unknown>>, eventId: string) =>
    entries.find((e) => e.kind === 'close' && e.eventId === eventId && e.state !== 'done' && e.state !== 'superseded')),
}));
const mockAttentionProps: Array<Record<string, unknown>> = [];
jest.mock('../AttentionList', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockAttentionProps.push(props);
      return ReactLocal.createElement(Text, null, 'attention list');
    },
  };
});
jest.mock('../DigestHealthLine', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => ReactLocal.createElement(Text, null, 'digest health') };
});

import { useCaptureQueueEntries } from '../../../../tools/captureQueueStore';
import RoomBoardView from '../RoomBoardView';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const lastProps = () => mockAttentionProps[mockAttentionProps.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  mockAttentionProps.length = 0;
  mockEntries = [];
});

describe('RoomBoardView and Perlu ditindak', () => {
  it("hands the list the viewer, the deeplink request and this phone's pending closes", async () => {
    mockEntries = [
      { kind: 'close', id: 'j1', eventId: 'ev1', state: 'queued' },
      { kind: 'close', id: 'j2', eventId: 'ev2', state: 'superseded' },
      { kind: 'capture', id: 'ev3', state: 'queued' },
    ];
    const mineRequest = { mine: true };
    const onOpenEvent = jest.fn();
    const utils = render(
      <RoomBoardView projectId="p1" viewerId="u1" onOpenRoom={jest.fn()} onOpenEvent={onOpenEvent} mineRequest={mineRequest} />,
    );
    await waitFor(() => expect(utils.getByText('attention list')).toBeTruthy());

    expect(useCaptureQueueEntries).toHaveBeenCalledWith('u1');
    const props = lastProps();
    expect(props).toMatchObject({ projectId: 'p1', viewerId: 'u1', showOwner: false, mineRequest, onOpenEvent });
    expect([...(props.pendingEventIds as Set<string>)]).toEqual(['ev1']);
    expect(utils.queryByText('digest health')).toBeNull();
  });

  it('names owners and shows the digest health line in office layouts', async () => {
    const utils = render(
      <RoomBoardView projectId="p1" viewerId="u9" onOpenRoom={jest.fn()} onOpenEvent={jest.fn()} showOwners showDigestHealth />,
    );
    await waitFor(() => expect(utils.getByText('digest health')).toBeTruthy());
    expect(lastProps()).toMatchObject({ showOwner: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npx jest office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: FAIL, `Test suite failed to run` with `TS2322: Type '{ projectId: string; viewerId: string; onOpenRoom: ...; onOpenEvent: ...` is not assignable (the board has no such props yet).

- [ ] **Step 3: Mount the list in the board**

In `office/screens/rooms/RoomBoardView.tsx`, find this block (it occurs exactly once):

```tsx
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import type { RoomBoardRow, SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';
```

and replace it with:

```tsx
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { pendingCloseFor, useCaptureQueueEntries } from '../../../tools/captureQueueStore';
import type { RoomBoardRow, SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';
import AttentionList from './AttentionList';
import DigestHealthLine from './DigestHealthLine';
```

In `office/screens/rooms/RoomBoardView.tsx`, find this block (it occurs exactly once):

```tsx
  /** Phone layout wraps the filter pills instead of overflowing a 360dp screen. */
  compact?: boolean;
}) {
  const { projectId, onOpenRoom, headerAction, compact } = props;
```

and replace it with:

```tsx
  /** Phone layout wraps the filter pills instead of overflowing a 360dp screen. */
  compact?: boolean;
  /** The signed-in profile: "Milik saya" and this phone's pending closes. */
  viewerId: string | null;
  /** "Perlu ditindak" row tap (closure spec §5.6). */
  onOpenEvent: (eventId: string, projectId: string) => void;
  /** Office and principal layouts name each item's owner. */
  showOwners?: boolean;
  /** Office and principal layouts show when the morning digest last went out. */
  showDigestHealth?: boolean;
  /** From a digest notification's params; a fresh object per tap re-applies it. */
  mineRequest?: { mine: boolean } | null;
}) {
  const { projectId, onOpenRoom, headerAction, compact, viewerId, onOpenEvent, showOwners, showDigestHealth, mineRequest } = props;

  // Close jobs still on this phone, so "Perlu ditindak" can say "Menunggu
  // kirim" on a row the server still has open (closure spec §4.5).
  const queue = useCaptureQueueEntries(viewerId);
  const pendingEventIds = useMemo(
    () => new Set(queue.flatMap((e) => (e.kind === 'close' && pendingCloseFor(queue, e.eventId) ? [e.eventId] : []))),
    [queue],
  );
  // Bumped on every board load, so the list and the health line refetch with it.
  const [reloadKey, setReloadKey] = useState(0);
```

In `office/screens/rooms/RoomBoardView.tsx`, find this block (it occurs exactly once):

```tsx
    if (!opts.silent) setLoading(true);
    const result = await listRoomBoard(projectId);
```

and replace it with:

```tsx
    if (!opts.silent) setLoading(true);
    setReloadKey((k) => k + 1);
    const result = await listRoomBoard(projectId);
```

In `office/screens/rooms/RoomBoardView.tsx`, find this block (it occurs exactly once):

```tsx
      <Card title="Papan Ruangan" subtitle="Ringkasan kejadian per ruangan." rightAction={headerAction}>
```

and replace it with:

```tsx
      <AttentionList
        projectId={projectId}
        viewerId={viewerId}
        showOwner={!!showOwners}
        mineRequest={mineRequest}
        pendingEventIds={pendingEventIds}
        onOpenEvent={onOpenEvent}
        reloadKey={reloadKey}
      />
      {showDigestHealth ? <DigestHealthLine reloadKey={reloadKey} /> : null}

      <Card title="Papan Ruangan" subtitle="Ringkasan kejadian per ruangan." rightAction={headerAction}>
```

- [ ] **Step 4: Run it to verify it passes**

Run:

```bash
npx jest office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS.

- [ ] **Step 5: Supervisor: `RoomBoardScreen` reads the params**

In `workflows/screens/RoomBoardScreen.tsx`, find this block (it occurs exactly once):

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
```

and replace it with:

```tsx
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
```

In `workflows/screens/RoomBoardScreen.tsx`, find this block (it occurs exactly once):

```tsx
export default function RoomBoardScreen() {
  const { project } = useProject();
  const navigation = useNavigation<any>();
```

and replace it with:

```tsx
export default function RoomBoardScreen() {
  const { project, profile } = useProject();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // A SITE_EVENT_DIGEST tap lands here with { projectId, attention, mine }
  // (closure spec §5.6). routeDeeplink copies params per tap, so a second tap
  // of the same notification is a new object and re-applies "Milik saya".
  const params = route.params as { attention?: boolean; mine?: boolean } | undefined;
  const mineRequest = useMemo(
    () => (params?.attention ? { mine: params.mine === true } : null),
    [params],
  );
```

In `workflows/screens/RoomBoardScreen.tsx`, find this block (it occurs exactly once):

```tsx
      <RoomBoardView
        compact
        projectId={project?.id ?? null}
```

and replace it with:

```tsx
      <RoomBoardView
        compact
        projectId={project?.id ?? null}
        viewerId={profile?.id ?? null}
        mineRequest={mineRequest}
        onOpenEvent={(eventId, projectId) => navigation.navigate('SiteEventDetail', { eventId, projectId })}
```

- [ ] **Step 6: Office: `RoomsAdminScreen` opens its board on a digest tap**

In `office/screens/RoomsAdminScreen.tsx`, find this block (it occurs exactly once):

```tsx
import { useNavigation } from '@react-navigation/native';
```

and replace it with:

```tsx
import { useNavigation, useRoute } from '@react-navigation/native';
```

In `office/screens/RoomsAdminScreen.tsx`, find this block (it occurs exactly once):

```tsx
  const navigation = useNavigation<any>();

  const [sub, setSub] = useState<SubModule>('board');
```

and replace it with:

```tsx
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const [sub, setSub] = useState<SubModule>('board');

  // A SITE_EVENT_DIGEST tap resolves to this tab (tools/notificationRouting.ts)
  // with { projectId, attention, mine } (closure spec §5.6): show the board,
  // whatever sub-screen was open, and hand "Milik saya" to the list.
  const params = route.params as { attention?: boolean; mine?: boolean } | undefined;
  const mineRequest = useMemo(
    () => (params?.attention ? { mine: params.mine === true } : null),
    [params],
  );
  useEffect(() => {
    if (params?.attention) setSub('board');
  }, [params]);
```

In `office/screens/RoomsAdminScreen.tsx`, find this block (it occurs exactly once):

```tsx
          <RoomBoardView
            projectId={project?.id ?? null}
```

and replace it with:

```tsx
          <RoomBoardView
            projectId={project?.id ?? null}
            viewerId={profile?.id ?? null}
            showOwners
            showDigestHealth
            mineRequest={mineRequest}
            onOpenEvent={(eventId, projectId) => navigation.navigate('SiteEventDetail', { eventId, projectId })}
```

- [ ] **Step 7: Principal: `PrincipalRoomsScreen` the same way**

In `office/screens/PrincipalRoomsScreen.tsx`, find this block (it occurs exactly once):

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
```

and replace it with:

```tsx
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
```

In `office/screens/PrincipalRoomsScreen.tsx`, find this block (it occurs exactly once):

```tsx
export default function PrincipalRoomsScreen() {
  const { project } = useProject();
  const navigation = useNavigation<any>();
```

and replace it with:

```tsx
export default function PrincipalRoomsScreen() {
  const { project, profile } = useProject();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // A SITE_EVENT_DIGEST tap resolves to this tab (tools/notificationRouting.ts)
  // with { projectId, attention, mine } (closure spec §5.6).
  const params = route.params as { attention?: boolean; mine?: boolean } | undefined;
  const mineRequest = useMemo(
    () => (params?.attention ? { mine: params.mine === true } : null),
    [params],
  );
```

In `office/screens/PrincipalRoomsScreen.tsx`, find this block (it occurs exactly once):

```tsx
      <RoomBoardView
        projectId={project?.id ?? null}
```

and replace it with:

```tsx
      <RoomBoardView
        projectId={project?.id ?? null}
        viewerId={profile?.id ?? null}
        showOwners
        showDigestHealth
        mineRequest={mineRequest}
        onOpenEvent={(eventId, projectId) => navigation.navigate('SiteEventDetail', { eventId, projectId })}
```

- [ ] **Step 8: Type-check the whole project**

Run:

```bash
npx tsc --noEmit -p .
```

Expected: no output. An error in a file this task owns must be fixed before committing; an error only in a file another lane owns (see the Lanes table) means that lane is mid-task: note it, wait a minute, and run again before committing.

- [ ] **Step 9: Run the board suites**

Run:

```bash
npx jest office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx office/screens/rooms/__tests__/AttentionList.test.tsx office/screens/rooms/__tests__/DigestHealthLine.test.tsx tools/__tests__/siteEventAttention.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: PASS, all four suites.

- [ ] **Step 10: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T6.txt` with the Write tool (never a heredoc), exactly:

```text
feat(rooms): Perlu ditindak on every Papan Ruangan

The list sits above the board for supervisors, office roles and
principals; office layouts name owners and show the digest health line;
a digest tap opens the board with Milik saya as the notification asked.
Closure spec 2026-09-26 §5.6.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add office/screens/rooms/RoomBoardView.tsx workflows/screens/RoomBoardScreen.tsx office/screens/RoomsAdminScreen.tsx office/screens/PrincipalRoomsScreen.tsx office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T6.txt -- office/screens/rooms/RoomBoardView.tsx workflows/screens/RoomBoardScreen.tsx office/screens/RoomsAdminScreen.tsx office/screens/PrincipalRoomsScreen.tsx office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `office/screens/rooms/RoomBoardView.tsx`, `workflows/screens/RoomBoardScreen.tsx`, `office/screens/RoomsAdminScreen.tsx`, `office/screens/PrincipalRoomsScreen.tsx`, `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx`.


### L3-T7 (Lane 3, Task 7): Docker rehearsal of 105 and 106 as real roles

Spec §8.2. Modelled on `supabase/tests/progress_claims_rehearsal/run.sh` (same image, `rehearsal.as_user`, `expect`, `expect_error`, PASS/FAIL/ERROR tally, `--stop`), in its own container `sano-pg-closure-rehearsal`. The image has no storage schema (`progress_claims_rehearsal/run.sh:5-7`), so `storage_stub.sql` builds `storage.buckets` and `storage.objects` owned by `supabase_storage_admin` with RLS on, and grants nothing that would answer 105's precondition for it. The run applies 001-104 on a fresh container, pastes 105 and 106 twice each, loads the fixture, runs every check in §8.2's table, re-pastes 097 to prove the revert hazard and 100 plus 105 to prove the repair, and pastes 106 without and then with pg_cron.

**Files:**
- Create: `supabase/tests/site_event_closure_rehearsal/storage_stub.sql`
- Create: `supabase/tests/site_event_closure_rehearsal/fixture.sql`
- Create: `supabase/tests/site_event_closure_rehearsal/rehearse_105.sql`
- Create: `supabase/tests/site_event_closure_rehearsal/rehearse_106.sql`
- Create: `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql`
- Create: `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql`
- Create: `supabase/tests/site_event_closure_rehearsal/run.sh`

**Owns (no other lane edits these):** `supabase/tests/site_event_closure_rehearsal/storage_stub.sql`, `supabase/tests/site_event_closure_rehearsal/fixture.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_105.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_106.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql`, `supabase/tests/site_event_closure_rehearsal/run.sh`

**Depends on:** **Runs after Lane 1's 105 is committed (Lane 1 Task 2)** and after Lane 3 Task 2 (106). Needs Docker and the `supabase/postgres` image; it touches nothing but its own container. It is the one step in this plan that runs SQL, and only against that disposable container: never point it at the live project.

- [ ] **Step 1: Write the storage stub**

Create `supabase/tests/site_event_closure_rehearsal/storage_stub.sql` with exactly this content:

```sql
-- supabase/tests/site_event_closure_rehearsal/storage_stub.sql
-- The supabase/postgres image has no storage schema (the storage API creates
-- it in a real project). Migration 105's paste precondition and its evidence
-- rule both read storage.objects, so this builds the two tables they need the
-- way production has them: owned by supabase_storage_admin, RLS on, and
-- granted to postgres, service_role and authenticated. It grants nothing
-- beyond that: whether postgres can read past RLS is exactly the question the
-- 105 precondition asks, and this stub must not answer it for the real
-- project. Run as supabase_admin, before any migration, on every run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  owner               UUID,
  public              BOOLEAN DEFAULT false,
  file_size_limit     BIGINT,
  allowed_mime_types  TEXT[],
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   TEXT REFERENCES storage.buckets(id),
  name        TEXT,
  owner       UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO postgres, service_role;
GRANT SELECT ON storage.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
```

- [ ] **Step 2: Write the fixture**

Three projects (A active, B active with nothing to do, C on hold), eight people, three rooms, the closure events of §8.2's first row and the digest events D1-D8, and yesterday's log row for the supervisor. Expected digest for project A, derived by hand: the supervisor owns D1 (overdue 3) and D2 (overdue 1, blocking), so "2 lewat tenggat, 1 menghambat. Terlama: LT1-R01 – Retak dinding kamar (tenggat {today-3})"; the project has D1-D5 (D6 is due today, D7 blocking only since this morning), so the office summary is "4 lewat tenggat, 2 menghambat. 2 tanpa penanggung jawab." (D3's owner was removed, D4 has none), plus "1 milik Anda." for the admin who owns D5.

Create `supabase/tests/site_event_closure_rehearsal/fixture.sql` with exactly this content:

```sql
-- supabase/tests/site_event_closure_rehearsal/fixture.sql
-- Disposable fixture for run.sh: three projects, eight people, three rooms,
-- the events every 105 and 106 check reads. Run as supabase_admin, after 105
-- and 106 are pasted. Re-runnable: it deletes its own projects first, and
-- everything hanging off them goes with the cascade.
CREATE SCHEMA IF NOT EXISTS rehearsal;
GRANT USAGE ON SCHEMA rehearsal TO authenticated, postgres;

CREATE OR REPLACE FUNCTION rehearsal.u(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'sup' THEN 'a101' WHEN 'sup2' THEN 'a102' WHEN 'est' THEN 'a103' WHEN 'adm' THEN 'a104'
    WHEN 'adm2' THEN 'a105' WHEN 'pri' THEN 'a106' WHEN 'gone' THEN 'a107' WHEN 'out' THEN 'a108' END)::uuid $$;
-- 1 = REH-CL-A (ACTIVE, everything happens here), 2 = REH-CL-B (ACTIVE, nothing
-- needs attention), 3 = REH-CL-C (ON_HOLD, has an overdue item).
CREATE OR REPLACE FUNCTION rehearsal.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000b10' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.room(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000c10' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.m(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000e1' || lpad(n::text, 2, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.ev(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'cacat' THEN 'd101' WHEN 'isu' THEN 'd102' WHEN 'hambatan' THEN 'd103' WHEN 'bk' THEN 'd104'
    WHEN 'progres' THEN 'd105' WHEN 'info' THEN 'd106' WHEN 'done_cacat' THEN 'd107' WHEN 'outsider' THEN 'd108'
    WHEN 'haz1' THEN 'd109' WHEN 'haz2' THEN 'd110'
    WHEN 'D1' THEN 'd201' WHEN 'D2' THEN 'd202' WHEN 'D3' THEN 'd203' WHEN 'D4' THEN 'd204'
    WHEN 'D5' THEN 'd205' WHEN 'D6' THEN 'd206' WHEN 'D7' THEN 'd207' WHEN 'D8' THEN 'd208' END)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal.today() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date $$;
CREATE OR REPLACE FUNCTION rehearsal.wib_midnight() RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
  SELECT rehearsal.today()::timestamp AT TIME ZONE 'Asia/Jakarta' $$;
CREATE OR REPLACE FUNCTION rehearsal.path(p_event TEXT, p_media INT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'site-events/' || rehearsal.p(1) || '/' || rehearsal.ev(p_event) || '/' || rehearsal.m(p_media) || '.jpg' $$;
CREATE OR REPLACE FUNCTION rehearsal.as_user(p_name TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rehearsal.u(p_name)::text, true)
      || set_config('request.jwt.claim.role', 'authenticated', true)
      || set_config('request.jwt.claims', json_build_object('sub', rehearsal.u(p_name), 'role', 'authenticated')::text, true) $$;
CREATE OR REPLACE FUNCTION rehearsal.expect(p_label TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN p_ok THEN 'PASS ' ELSE 'FAIL ' END || p_label || COALESCE(' :: ' || p_detail, '') $$;
CREATE OR REPLACE FUNCTION rehearsal.expect_error(p_label TEXT, p_sql TEXT, p_prefix TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FAIL ' || p_label || ' :: no error';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE p_prefix || '%' THEN 'PASS ' ELSE 'FAIL ' END || p_label || ' :: ' || SQLERRM;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rehearsal TO authenticated, postgres;

DELETE FROM projects WHERE id IN (rehearsal.p(1), rehearsal.p(2), rehearsal.p(3));
DELETE FROM storage.objects WHERE bucket_id = 'site-media' AND name LIKE 'site-events/' || rehearsal.p(1) || '/%';

INSERT INTO storage.buckets (id, name, public) VALUES ('site-media', 'site-media', false) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
SELECT rehearsal.u(n), n || '@closure-rehearsal.test'
FROM unnest(ARRAY['sup', 'sup2', 'est', 'adm', 'adm2', 'pri', 'gone', 'out']) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role) VALUES
  (rehearsal.u('sup'),  'Rehearsal Supervisor',     'supervisor'),
  (rehearsal.u('sup2'), 'Rehearsal Supervisor Dua', 'supervisor'),
  (rehearsal.u('est'),  'Rehearsal Estimator',      'estimator'),
  (rehearsal.u('adm'),  'Rehearsal Admin',          'admin'),
  (rehearsal.u('adm2'), 'Rehearsal Admin Lain',     'admin'),
  (rehearsal.u('pri'),  'Rehearsal Principal',      'principal'),
  (rehearsal.u('gone'), 'Rehearsal Keluar',         'supervisor'),
  (rehearsal.u('out'),  'Rehearsal Outsider',       'supervisor')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;

-- 093's trigger adds the principal to each new project; the explicit rows
-- below are idempotent with it.
INSERT INTO projects (id, code, name, status) VALUES
  (rehearsal.p(1), 'REH-CL-A', 'Rehearsal Closure A', 'ACTIVE'),
  (rehearsal.p(2), 'REH-CL-B', 'Rehearsal Closure B', 'ACTIVE'),
  (rehearsal.p(3), 'REH-CL-C', 'Rehearsal Closure C', 'ON_HOLD');

INSERT INTO project_assignments (project_id, user_id) VALUES
  (rehearsal.p(1), rehearsal.u('sup')), (rehearsal.p(1), rehearsal.u('sup2')), (rehearsal.p(1), rehearsal.u('est')),
  (rehearsal.p(1), rehearsal.u('adm')), (rehearsal.p(1), rehearsal.u('pri')), (rehearsal.p(1), rehearsal.u('gone')),
  (rehearsal.p(2), rehearsal.u('sup')), (rehearsal.p(2), rehearsal.u('pri')),
  (rehearsal.p(3), rehearsal.u('sup')), (rehearsal.p(3), rehearsal.u('adm')), (rehearsal.p(3), rehearsal.u('pri'))
ON CONFLICT (project_id, user_id) DO NOTHING;
-- 'gone' owned an item and has since been taken off the project.
DELETE FROM project_assignments WHERE project_id = rehearsal.p(1) AND user_id = rehearsal.u('gone');

INSERT INTO rooms (id, project_id, room_code, room_name, floor) VALUES
  (rehearsal.room(1), rehearsal.p(1), 'LT1-R01', 'Kamar Tidur 1', '1'),
  (rehearsal.room(2), rehearsal.p(1), 'LT1-R02', 'Dapur', '1'),
  (rehearsal.room(3), rehearsal.p(3), 'LT1-R01', 'Gudang', '1');

-- Closure events (105): open, owned by sup, due in a week, never attention.
INSERT INTO site_events (id, project_id, room_id, reporter_id, status, event_type, title, owner_id, due_date, captured_at, confirmed_at)
SELECT rehearsal.ev(n), rehearsal.p(1), rehearsal.room(2), rehearsal.u('sup'), 'open', t, 'Uji ' || n,
       rehearsal.u('sup'), rehearsal.today() + 7, now() - interval '1 day', now() - interval '1 day'
FROM (VALUES ('cacat', 'cacat'), ('isu', 'isu'), ('hambatan', 'hambatan'), ('bk', 'butuh_keputusan'),
             ('progres', 'progres'), ('info', 'info'), ('done_cacat', 'cacat'), ('outsider', 'progres'),
             ('haz1', 'cacat'), ('haz2', 'cacat')) AS v(n, t);
UPDATE site_events SET status = 'done', closed_at = now() - interval '1 hour', closed_by = rehearsal.u('sup2')
WHERE id = rehearsal.ev('done_cacat');

-- Files that exist in storage. Deliberately NOT created: m(1), the closure row
-- whose upload never happened.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('site-media', rehearsal.path('isu', 2)),
  ('site-media', rehearsal.path('cacat', 3)),
  ('site-media', rehearsal.path('isu', 4)),
  ('site-media', rehearsal.path('hambatan', 5));

-- Digest events (106), room 1 of project A unless stated.
--   D1 isu, sup, due 3 days ago                 -> overdue 3 (sup's oldest)
--   D2 hambatan, sup, due yesterday, blocking   -> overdue 1 and blocking
--   D3 cacat, gone (removed), due 2 days ago    -> overdue, owner not on project
--   D4 info, no owner, due yesterday            -> overdue, no owner
--   D5 hambatan, adm, due in 5 days, blocking since 23:59 WIB yesterday -> blocking
--   D6 isu, sup, due today                      -> NOT attention (due today is not overdue)
--   D7 hambatan, sup, blocking since 00:01 WIB today -> NOT attention yet
--   D8 isu, sup, due 4 days ago, project C (ON_HOLD) -> attention, but never digested
INSERT INTO site_events (id, project_id, room_id, reporter_id, status, event_type, title, owner_id, due_date, is_blocking, captured_at, confirmed_at) VALUES
  (rehearsal.ev('D1'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'isu', 'Retak dinding kamar', rehearsal.u('sup'), rehearsal.today() - 3, false, now() - interval '5 days', now() - interval '5 days'),
  (rehearsal.ev('D2'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'hambatan', 'Pompa air mati', rehearsal.u('sup'), rehearsal.today() - 1, true, now() - interval '2 days', now() - interval '2 days'),
  (rehearsal.ev('D3'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'cacat', 'Keramik pecah', rehearsal.u('gone'), rehearsal.today() - 2, false, now() - interval '4 days', now() - interval '4 days'),
  (rehearsal.ev('D4'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'info', 'Catatan tanpa pemilik', NULL, rehearsal.today() - 1, false, now() - interval '3 days', now() - interval '3 days'),
  (rehearsal.ev('D5'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'hambatan', 'Menunggu material', rehearsal.u('adm'), rehearsal.today() + 5, true, rehearsal.wib_midnight() - interval '1 minute', rehearsal.wib_midnight() - interval '1 minute'),
  (rehearsal.ev('D6'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'isu', 'Jatuh tempo hari ini', rehearsal.u('sup'), rehearsal.today(), false, now() - interval '1 day', now() - interval '1 day'),
  (rehearsal.ev('D7'), rehearsal.p(1), rehearsal.room(1), rehearsal.u('sup'), 'open', 'hambatan', 'Menghambat sejak pagi', rehearsal.u('sup'), rehearsal.today() + 3, true, rehearsal.wib_midnight() + interval '1 minute', rehearsal.wib_midnight() + interval '1 minute'),
  (rehearsal.ev('D8'), rehearsal.p(3), rehearsal.room(3), rehearsal.u('sup'), 'open', 'isu', 'Proyek ditunda', rehearsal.u('sup'), rehearsal.today() - 4, false, now() - interval '6 days', now() - interval '6 days');

-- Yesterday's digest for sup must not stop today's.
INSERT INTO site_event_digest_log (project_id, profile_id, run_date, kind)
VALUES (rehearsal.p(1), rehearsal.u('sup'), rehearsal.today() - 1, 'owner');

SELECT 'fixture ready: ' || (SELECT count(*) FROM site_events WHERE project_id IN (rehearsal.p(1), rehearsal.p(3))) || ' events, '
  || (SELECT count(*) FROM project_assignments WHERE project_id = rehearsal.p(1)) || ' members on A';
```

- [ ] **Step 3: Write the 105 checks**

Create `supabase/tests/site_event_closure_rehearsal/rehearse_105.sql` with exactly this content:

```sql
-- supabase/tests/site_event_closure_rehearsal/rehearse_105.sql
-- Behaviour checks for migration 105 as real roles. Run by run.sh, as postgres,
-- after fixture.sql. Every line prints PASS or FAIL.
\pset tuples_only on
\pset format unaligned

-- A. Proof by type, as the supervisor who owns every closure event
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('105 a cacat with no closure row is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('cacat'), 'Sudah ditambal'), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
SELECT rehearsal.expect_error('105 an isu with no closure row is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('isu'), 'Sudah ditambal'), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
SELECT rehearsal.expect_error('105 a hambatan with no closure row is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('hambatan'), 'Sudah ditambal'), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(1), rehearsal.ev('cacat'), 'photo', 'closure', rehearsal.path('cacat', 1));
SELECT rehearsal.expect_error('105 a closure row whose file was never uploaded is no proof', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('cacat')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(2), rehearsal.ev('isu'), 'photo', 'context', rehearsal.path('isu', 2));
SELECT rehearsal.expect_error('105 a context photo is not a closure photo', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('isu')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(3), rehearsal.ev('cacat'), 'photo', 'closure', rehearsal.path('cacat', 3));
SELECT rehearsal.expect('105 a cacat closes with a closure row and its file', (close_site_event(rehearsal.ev('cacat'), 'Sudah ditambal') ->> 'status') = 'done');
-- The first member uploads the isu's closure photo; a second member closes it below.
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(4), rehearsal.ev('isu'), 'photo', 'closure', rehearsal.path('isu', 4));
INSERT INTO site_event_media (id, event_id, kind, role, storage_path)
VALUES (rehearsal.m(5), rehearsal.ev('hambatan'), 'photo', 'closure', rehearsal.path('hambatan', 5));
SELECT rehearsal.expect('105 a hambatan closes with a closure row and its file', (close_site_event(rehearsal.ev('hambatan'), NULL) ->> 'status') = 'done');

SELECT rehearsal.expect_error('105 a decision with no note is refused', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('bk')), 'SITE_EVENT_CLOSURE_NOTE_REQUIRED:');
SELECT rehearsal.expect_error('105 a decision with nine characters is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('bk'), 'Sembilan.'), 'SITE_EVENT_CLOSURE_NOTE_REQUIRED:');
SELECT rehearsal.expect_error('105 a decision with ten newlines is refused', format('SELECT close_site_event(%L, %L)', rehearsal.ev('bk'), repeat(E'\n', 10)), 'SITE_EVENT_CLOSURE_NOTE_REQUIRED:');
SELECT rehearsal.expect_error('105 a 501-character note still gets SITE_EVENT_CLOSURE_NOTE', format('SELECT close_site_event(%L, %L)', rehearsal.ev('bk'), repeat('x', 501)), 'SITE_EVENT_CLOSURE_NOTE:');
SELECT rehearsal.expect('105 a decision closes with ten characters padded by spaces and newlines', (close_site_event(rehearsal.ev('bk'), E' \n\tGanti cat!\r\n ') ->> 'status') = 'done');

SELECT rehearsal.expect('105 a progres closes with nothing', (close_site_event(rehearsal.ev('progres'), NULL) ->> 'status') = 'done');
SELECT rehearsal.expect('105 an info closes with nothing', (close_site_event(rehearsal.ev('info'), NULL) ->> 'status') = 'done');
SELECT rehearsal.expect_error('105 a closed cacat with no photo gets NOT_OPEN, not the photo refusal', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('done_cacat')), 'SITE_EVENT_NOT_OPEN:');
COMMIT;

-- B. Any member's photo is proof about the event
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup2') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('105 a second member closes an isu with the photo the first member uploaded', (close_site_event(rehearsal.ev('isu'), NULL) ->> 'status') = 'done');
COMMIT;

-- C. Outsiders
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('105 an outsider gets AUTH', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('outsider')), 'SITE_EVENT_AUTH:');
ROLLBACK;

-- D. What landed
SELECT rehearsal.expect('105 the decision note is stored trimmed', (SELECT closure_note = 'Ganti cat!' FROM site_events WHERE id = rehearsal.ev('bk')));
SELECT rehearsal.expect('105 closed_by and closed_at name the second member on the isu', (SELECT status = 'done' AND closed_by = rehearsal.u('sup2') AND closed_at IS NOT NULL FROM site_events WHERE id = rehearsal.ev('isu')));
SELECT rehearsal.expect('105 closed_by and closed_at name the supervisor on the cacat', (SELECT status = 'done' AND closed_by = rehearsal.u('sup') AND closed_at IS NOT NULL FROM site_events WHERE id = rehearsal.ev('cacat')));
SELECT rehearsal.expect('105 the outsider changed nothing', (SELECT status = 'open' AND closed_by IS NULL FROM site_events WHERE id = rehearsal.ev('outsider')));
SELECT rehearsal.expect('105 the already-closed cacat kept its original closer', (SELECT closed_by = rehearsal.u('sup2') FROM site_events WHERE id = rehearsal.ev('done_cacat')));
```

- [ ] **Step 4: Write the 106 checks**

Create `supabase/tests/site_event_closure_rehearsal/rehearse_106.sql` with exactly this content:

```sql
-- supabase/tests/site_event_closure_rehearsal/rehearse_106.sql
-- Behaviour checks for migration 106 as real roles. Run by run.sh, as postgres,
-- after rehearse_105.sql. Every line prints PASS or FAIL.
\pset tuples_only on
\pset format unaligned

-- A. The view under RLS
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 an outsider sees no attention row', (SELECT count(*) FROM v_site_event_attention) = 0);
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 a supervisor sees the five attention items of project A',
  (SELECT count(*) FROM v_site_event_attention WHERE project_id = rehearsal.p(1)) = 5,
  (SELECT string_agg(title, ', ' ORDER BY title) FROM v_site_event_attention WHERE project_id = rehearsal.p(1)));
SELECT rehearsal.expect('106 owner_on_project is NULL on a colleague''s item for a supervisor',
  (SELECT owner_on_project IS NULL FROM v_site_event_attention WHERE event_id = rehearsal.ev('D3'))
  AND (SELECT owner_on_project IS NULL FROM v_site_event_attention WHERE event_id = rehearsal.ev('D5')));
SELECT rehearsal.expect('106 owner_on_project is exact on the supervisor''s own item and on an item with no owner',
  (SELECT owner_on_project FROM v_site_event_attention WHERE event_id = rehearsal.ev('D1'))
  AND (SELECT owner_on_project IS FALSE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D4')));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 an office role reads exact owner_on_project values',
  (SELECT owner_on_project IS FALSE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D3'))
  AND (SELECT owner_on_project IS TRUE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D5'))
  AND (SELECT owner_on_project IS FALSE FROM v_site_event_attention WHERE event_id = rehearsal.ev('D4')));
ROLLBACK;

SELECT rehearsal.expect('106 due today is not overdue', NOT EXISTS (SELECT 1 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D6')));
SELECT rehearsal.expect('106 due yesterday is one day overdue', (SELECT is_overdue AND days_overdue = 1 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D2')));
SELECT rehearsal.expect('106 blocking since this morning is not attention yet', NOT EXISTS (SELECT 1 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D7')));
SELECT rehearsal.expect('106 blocking since yesterday is attention, not overdue', (SELECT is_blocking AND NOT is_overdue AND days_overdue = 0 FROM v_site_event_attention WHERE event_id = rehearsal.ev('D5')));

-- B. Refusals before anything is sent
SELECT rehearsal.expect_error('106 a run for tomorrow is refused', format('SELECT enqueue_site_event_digests(%L::date)', rehearsal.today() + 1), 'DIGEST_RUN_DATE:');
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('106 an app user cannot run the digest', 'SELECT enqueue_site_event_digests()', 'permission denied for function enqueue_site_event_digests');
ROLLBACK;

BEGIN;
UPDATE site_events SET status = 'done' WHERE status = 'open';
SELECT rehearsal.expect('106 nothing to send: zero messages and no log row',
  enqueue_site_event_digests() = 0 AND NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE run_date = rehearsal.today()));
ROLLBACK;

-- C. Today's run
SELECT enqueue_site_event_digests() AS sent1 \gset
SELECT rehearsal.expect('106 the first run reaches three people', :'sent1'::int = 3, :'sent1');

SELECT rehearsal.expect('106 the owner gets one message: own counts, and the oldest overdue item',
  (SELECT count(*) = 1 AND bool_and(
      n.title = '2 tugas lapangan perlu ditindak · REH-CL-A'
      AND n.body = '2 lewat tenggat, 1 menghambat. Terlama: LT1-R01 – Retak dinding kamar (tenggat ' || site_event_digest_day(rehearsal.today() - 3) || ').'
      AND n.deeplink_screen = 'RoomBoard'
      AND n.deeplink_params = jsonb_build_object('projectId', rehearsal.p(1), 'attention', true, 'mine', true))
   FROM notifications n WHERE n.recipient_user_id = rehearsal.u('sup') AND n.type = 'SITE_EVENT_DIGEST'),
  (SELECT string_agg(title || ' | ' || body, ' || ') FROM notifications WHERE recipient_user_id = rehearsal.u('sup') AND type = 'SITE_EVENT_DIGEST'));

SELECT rehearsal.expect('106 an admin who also owns an item gets only the office summary, with 1 milik Anda',
  (SELECT count(*) = 1 AND bool_and(
      n.title = '5 tugas lapangan perlu ditindak · REH-CL-A'
      AND n.body = '4 lewat tenggat, 2 menghambat. 2 tanpa penanggung jawab. 1 milik Anda.'
      AND n.deeplink_params = jsonb_build_object('projectId', rehearsal.p(1), 'attention', true, 'mine', false))
   FROM notifications n WHERE n.recipient_user_id = rehearsal.u('adm') AND n.type = 'SITE_EVENT_DIGEST'),
  (SELECT string_agg(title || ' | ' || body, ' || ') FROM notifications WHERE recipient_user_id = rehearsal.u('adm') AND type = 'SITE_EVENT_DIGEST'));

SELECT rehearsal.expect('106 the principal gets the office summary, counting a removed owner and a missing owner as tanpa penanggung jawab',
  (SELECT count(*) = 1 AND bool_and(n.body = '4 lewat tenggat, 2 menghambat. 2 tanpa penanggung jawab.')
   FROM notifications n WHERE n.recipient_user_id = rehearsal.u('pri') AND n.type = 'SITE_EVENT_DIGEST'),
  (SELECT string_agg(body, ' || ') FROM notifications WHERE recipient_user_id = rehearsal.u('pri') AND type = 'SITE_EVENT_DIGEST'));

SELECT rehearsal.expect('106 one log row per person, of the right kind',
  (SELECT count(*) = 3
      AND count(*) FILTER (WHERE profile_id = rehearsal.u('sup') AND kind = 'owner') = 1
      AND count(*) FILTER (WHERE profile_id = rehearsal.u('adm') AND kind = 'office') = 1
      AND count(*) FILTER (WHERE profile_id = rehearsal.u('pri') AND kind = 'office') = 1
   FROM site_event_digest_log WHERE run_date = rehearsal.today()));
SELECT rehearsal.expect('106 yesterday''s log row did not stop today''s', (SELECT count(*) = 2 FROM site_event_digest_log WHERE profile_id = rehearsal.u('sup')));
SELECT rehearsal.expect('106 the removed owner gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE profile_id = rehearsal.u('gone')) AND NOT EXISTS (SELECT 1 FROM notifications WHERE recipient_user_id = rehearsal.u('gone')));
SELECT rehearsal.expect('106 an admin not assigned to the project gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE profile_id = rehearsal.u('adm2')));
SELECT rehearsal.expect('106 an estimator is neither an owner nor an office recipient', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE profile_id = rehearsal.u('est')));
SELECT rehearsal.expect('106 a project that is not ACTIVE gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE project_id = rehearsal.p(3)));
SELECT rehearsal.expect('106 an ACTIVE project with nothing to do gets nothing', NOT EXISTS (SELECT 1 FROM site_event_digest_log WHERE project_id = rehearsal.p(2)));
SELECT rehearsal.expect('106 every log row has its notification', (SELECT count(*) FROM site_event_digest_log WHERE run_date = rehearsal.today()) = (SELECT count(*) FROM notifications WHERE type = 'SITE_EVENT_DIGEST'));

SELECT enqueue_site_event_digests() AS sent2 \gset
SELECT rehearsal.expect('106 a second run the same day sends nothing and logs nothing',
  :'sent2'::int = 0
  AND (SELECT count(*) FROM notifications WHERE type = 'SITE_EVENT_DIGEST') = 3
  AND (SELECT count(*) FROM site_event_digest_log WHERE run_date = rehearsal.today()) = 3, :'sent2');

-- D. Who can read the log and the health line
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 a supervisor reads no log row', (SELECT count(*) FROM site_event_digest_log) = 0);
SELECT rehearsal.expect('106 a supervisor reads no health row', (SELECT count(*) FROM v_site_event_digest_health) = 0);
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('106 an office role reads the log', (SELECT count(*) FROM site_event_digest_log) = 4);
SELECT rehearsal.expect('106 the health line names today and three people',
  (SELECT count(*) = 1 AND bool_and(last_run_date = rehearsal.today() AND recipients = 3 AND last_sent_at IS NOT NULL) FROM v_site_event_digest_health));
ROLLBACK;
```

- [ ] **Step 5: Write the re-paste checks**

Create `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql` with exactly this content:

```sql
-- supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql
-- Run by run.sh right after it re-pastes 097 on top of 105: the revert is real.
\pset tuples_only on
\pset format unaligned
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect('re-pasting 097 reverts 105: a cacat with no photo closes', (close_site_event(rehearsal.ev('haz1'), NULL) ->> 'status') = 'done');
COMMIT;
SELECT rehearsal.expect('re-pasting 097 reverts 100: the VO re-check is gone', (SELECT prosrc NOT LIKE '%site_event_norm_quote%' FROM pg_proc WHERE proname = 'confirm_site_event'));
```

Create `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql` with exactly this content:

```sql
-- supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql
-- Run by run.sh after it re-pastes 100 and then 105: the rule is back.
\pset tuples_only on
\pset format unaligned
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal.expect_error('re-pasting 100 and 105 restores the rule: a cacat with no photo is refused again', format('SELECT close_site_event(%L, NULL)', rehearsal.ev('haz2')), 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED:');
ROLLBACK;
SELECT rehearsal.expect('re-pasting 100 restores the VO re-check', (SELECT prosrc LIKE '%site_event_norm_quote%' FROM pg_proc WHERE proname = 'confirm_site_event'));
```

- [ ] **Step 6: Write the runner**

Create `supabase/tests/site_event_closure_rehearsal/run.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# Rehearses migrations 105 and 106 on a disposable local Supabase Postgres, as
# the roles that will meet them (supervisor, second supervisor, estimator,
# admin, principal, a removed owner, an outsider). Needs Docker and a
# supabase/postgres image; touches nothing but the container. That image has
# no storage schema, so storage_stub.sql builds storage.buckets and
# storage.objects the way production has them (owned by
# supabase_storage_admin, RLS on) before any migration. The first run applies
# 001-104 to a fresh container (a few storage-policy statements in 006 and 097
# may report errors there; that is expected). Every run pastes 105 and 106
# twice each, rebuilds the fixture, runs every check, re-pastes 097 to prove
# the revert hazard, and pastes 106 with and without pg_cron.
#
#   supabase/tests/site_event_closure_rehearsal/run.sh            # keep the container
#   supabase/tests/site_event_closure_rehearsal/run.sh --stop     # remove it afterwards
set -euo pipefail
IMAGE="${SANO_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.131}"
NAME=sano-pg-closure-rehearsal
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
M="$ROOT/supabase/migrations"
pg() { docker exec -i "$NAME" psql -d postgres "$@"; }
paste_strict() { pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/$1.sql" >/dev/null 2>&1; }

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  until docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1 from pg_proc where proname = 'uid'" 2>/dev/null | grep -q 1; do sleep 1; done
  pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/storage_stub.sql" >/dev/null
  for f in "$M"/[0-9][0-9][0-9]_*.sql; do
    n="$(basename "$f")"
    [ "${n:0:3}" -ge 105 ] && continue
    pg -U postgres -q < "$f" >/dev/null 2>&1 || true
  done
fi
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/storage_stub.sql" >/dev/null
# A schedule left from the previous run must not fire into this one.
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

echo "pasting role:    $(pg -U postgres -tAc "select current_user || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname = current_user")"
echo "storage.objects: $(pg -U postgres -tAc "select c.relowner::regrole || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' select=' || has_table_privilege('storage.objects', 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'")"

for pass in first second; do
  for m in 105_close_site_event_evidence 106_site_event_digest; do
    if ! paste_strict "$m"; then
      echo "${m:0:3} failed on the $pass paste:"
      pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/$m.sql" 2>&1 | grep -E 'ERROR|MIGRATION_105_PRECONDITION' | head -5
      exit 1
    fi
  done
done
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/fixture.sql" >/dev/null

out="$(cat "$DIR/rehearse_105.sql" "$DIR/rehearse_106.sql" | pg -U postgres -q 2>&1)"

# Re-paste hazard: 097 alone reverts 100 and 105; 100 then 105 restores both.
pg -U postgres -q < "$M/097_site_events.sql" >/dev/null 2>&1 || true
out="$out"$'\n'"$(pg -U postgres -q < "$DIR/rehearse_repaste_097.sql" 2>&1)"
for m in 100_confirm_vo_evidence_recheck 105_close_site_event_evidence; do
  paste_strict "$m" || { echo "$m failed on the re-paste after 097"; exit 1; }
done
out="$out"$'\n'"$(pg -U postgres -q < "$DIR/rehearse_repaste_105.sql" 2>&1)"

# Scheduler, without pg_cron: two clean pastes, each printing the NOTICE.
for pass in first second; do
  if notice="$(pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/106_site_event_digest.sql" 2>&1 >/dev/null)"; then
    if printf '%s' "$notice" | grep -q '106: pg_cron belum aktif'; then
      out="$out"$'\n'"PASS 106 without pg_cron pastes cleanly and prints the NOTICE ($pass paste)"
    else
      out="$out"$'\n'"FAIL 106 without pg_cron printed no NOTICE ($pass paste)"
    fi
  else
    out="$out"$'\n'"FAIL 106 without pg_cron failed on the $pass paste :: $(printf '%s' "$notice" | grep -m1 ERROR)"
  fi
done

# Scheduler, with pg_cron: created the way the Dashboard does it, as postgres.
if ! pg -U postgres -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS pg_cron' >/dev/null 2>&1; then
  echo "CREATE EXTENSION pg_cron failed: this image does not preload pg_cron, so the Dashboard's branch cannot be rehearsed."
  exit 1
fi
for pass in first second; do
  paste_strict 106_site_event_digest || { echo "106 with pg_cron failed on the $pass paste"; exit 1; }
done
jobs="$(pg -U postgres -tAc "select count(*) || '|' || coalesce(string_agg(schedule || '|' || command, ','), '') from cron.job where jobname = 'site_event_digest'")"
if [ "$jobs" = "1|0 0 * * 1-6|SELECT public.enqueue_site_event_digests()" ]; then
  out="$out"$'\n'"PASS 106 with pg_cron schedules exactly one site_event_digest job at 0 0 * * 1-6"
else
  out="$out"$'\n'"FAIL 106 with pg_cron :: $jobs"
fi
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

printf '%s\n' "$out" | grep -E '^FAIL|ERROR' || true
pass="$(printf '%s\n' "$out" | grep -c '^PASS' || true)"
fail="$(printf '%s\n' "$out" | grep -c '^FAIL' || true)"
err="$(printf '%s\n' "$out" | grep -c 'ERROR' || true)"
echo "PASS=$pass FAIL=$fail ERROR=$err"
[ "${1:-}" = "--stop" ] && docker stop "$NAME" >/dev/null
[ "$fail" -eq 0 ] && [ "$err" -eq 0 ]
```

- [ ] **Step 7: Make it executable and check its syntax**

Run:

```bash
chmod +x supabase/tests/site_event_closure_rehearsal/run.sh && bash -n supabase/tests/site_event_closure_rehearsal/run.sh && echo syntax-ok
```

Expected: `syntax-ok`.

- [ ] **Step 8: Run the rehearsal**

Run:

```bash
supabase/tests/site_event_closure_rehearsal/run.sh --stop
```

Expected: two diagnostic lines (`pasting role: postgres super=... bypassrls=...` and `storage.objects: supabase_storage_admin rls=true ...`), then `PASS=58 FAIL=0 ERROR=0`, and exit code 0. If it stops with `105 failed on the first paste:` and a `MIGRATION_105_PRECONDITION` line, the pasting role cannot read `storage.objects` past RLS in this image: **do not grant anything to make it pass.** Report the two diagnostic lines to the user; the same query decides whether 105 can be pasted on the live project (spec §3.2, paste precondition). If it stops with `CREATE EXTENSION pg_cron failed`, the image does not preload pg_cron; report it, since that is the Dashboard's branch.

- [ ] **Step 9: Commit**

Write the message to `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T7.txt` with the Write tool (never a heredoc), exactly:

```text
test(db): rehearse 105 and 106 on Postgres as real roles

Closure evidence per type, the storage-object check, NOT_OPEN before any
evidence refusal, the 097 re-paste hazard and its repair, the digest's
recipients, counts, sentences and idempotence, the view under RLS, and
the schedule with and without pg_cron. Closure spec 2026-09-26 §8.2.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then commit only this task's files:

```bash
git add supabase/tests/site_event_closure_rehearsal/storage_stub.sql supabase/tests/site_event_closure_rehearsal/fixture.sql supabase/tests/site_event_closure_rehearsal/rehearse_105.sql supabase/tests/site_event_closure_rehearsal/rehearse_106.sql supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql supabase/tests/site_event_closure_rehearsal/run.sh && git commit -F /private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/commit-L3-T7.txt -- supabase/tests/site_event_closure_rehearsal/storage_stub.sql supabase/tests/site_event_closure_rehearsal/fixture.sql supabase/tests/site_event_closure_rehearsal/rehearse_105.sql supabase/tests/site_event_closure_rehearsal/rehearse_106.sql supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql supabase/tests/site_event_closure_rehearsal/run.sh
```

Expected: one new commit; `git show --stat --oneline HEAD` lists exactly: `supabase/tests/site_event_closure_rehearsal/storage_stub.sql`, `supabase/tests/site_event_closure_rehearsal/fixture.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_105.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_106.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_097.sql`, `supabase/tests/site_event_closure_rehearsal/rehearse_repaste_105.sql`, `supabase/tests/site_event_closure_rehearsal/run.sh`.


---

## After the three lanes: integration check

Whoever merges runs this once, after all nineteen commits are in.

- [ ] **Step 1: Every touched suite together**

```bash
npx jest tools/__tests__/captureQueue tools/__tests__/siteEvent tools/__tests__/migration09 tools/__tests__/migration10 tools/__tests__/notificationRouting tools/__tests__/timeWindow workflows/__tests__/captureQueueModel workflows/__tests__/closureModel workflows/__tests__/timelineModel workflows/screens/siteEvent/__tests__ workflows/screens/__tests__ office/screens/rooms/__tests__ --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Test Suites: 41 passed, 41 total`.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p .
```

Expected: no output.

- [ ] **Step 3: Nothing left behind**

```bash
git status --porcelain && git log --oneline bddcd97..HEAD | wc -l
```

Expected: no status lines (or only `assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx`, which must then be restored with `git restore assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx`), and `20` commits: the plan and the nineteen tasks.

---

## Release (the user's steps, from spec §10; no agent pastes or deploys)

1. Paste **105**, then **106**, in the Dashboard SQL editor, and run each self-check footer. If 105 stops with `MIGRATION_105_PRECONDITION`, the pasting role cannot read `storage.objects` past RLS on the live project; do not work around it, and bring the message back.
2. If 106 printed the pg_cron NOTICE, enable Cron once (Dashboard, Integrations → Cron) and paste 106 again. `SELECT jobname, schedule FROM cron.job;` must show `site_event_digest | 0 0 * * 1-6`.
3. Deploy nothing else: no edge function, no secret.
4. Merge, then publish an OTA from main (channel `preview`). No native module is added, so an update suffices.
5. Between step 1 and the OTA, a phone on the old bundle that closes a `cacat`, `isu` or `hambatan` without a photo, or a `butuh_keputusan` with a short note, is refused with the full Indonesian sentence 105 raises; the event stays open. Old phones that attach a photo close normally.
6. Re-paste hazards: re-pasting 097 reverts 100 and 105 (re-paste 100, then 105); re-pasting 098 or 104 drops `SITE_EVENT_DIGEST` (re-paste 106).

---

## Spec coverage

| Spec | Where |
|---|---|
| §1.1 rule 1 (Selesai only after the server) | L1-T4 (submit only enqueues, toasts say so), L1-T5 (server label kept, reload on leave), L2-T6 (timeline badge) |
| §1.1 rule 2 (proof where it cannot be skipped) | L1-T2 (105, storage-object join), L3-T7 (rehearsal) |
| §1.1 rule 3 (never claim a closer) | L2-T2 (`lookupSiteEventCloser`), L2-T3 (`not_open` is an outcome), L2-T5 (superseded sentence) |
| §1.1 rule 4 (failed read is not empty) | L3-T3, L3-T4, L3-T5 |
| §1.1 rule 5 (digest lands once or not at all) | L3-T2 (subtransaction, UNIQUE key), L3-T7 |
| §1.1 rule 6 (photo beside the closer) | L1-T5 |
| §2 decisions 1-9 | 1: L1-T2; 2, 3, 6, 8, 9: L3-T2; 4: L3-T2 + L3-T3; 5: L3-T2; 7: L1-T4 + L2-T7 |
| §3.1 rule table | L1-T1 (client), L1-T2 (server), L3-T7 (every row) |
| §3.2 function, order, trim, precondition, re-paste hazard | L1-T2, L3-T7 |
| §3.3 closureModel, ClosureForm table, submit, toasts, RPC copy, detail after close | L1-T1, L1-T4, L1-T3, L1-T5 |
| §4.1 close job fields, `enqueueCloseJob` | L2-T3, L2-T4 |
| §4.2 version 2 and the upgrade | L2-T3 |
| §4.3 state machine, `nextStep`, labels, mutators, `markUnrecoverable`, `isReadyToAttempt`, `WAITING_STATES` | L2-T3 |
| §4.4 worker steps and outcomes, removal of `closeSiteEvent` | L2-T2, L2-T3, L2-T7 |
| §4.5 "Menunggu kirim" surfaces | L1-T5 (detail), L2-T6 (timeline), L3-T5/L3-T6 (Perlu ditindak); board counts unchanged by construction |
| §4.6 the card, discard refusal, `formatWibShort` | L2-T5, L2-T4, L2-T1 |
| §5.1 view | L3-T2 |
| §5.2 log and health view | L3-T2 |
| §5.3 digest function | L3-T2, L3-T7 |
| §5.4 messages | L3-T2, L3-T7 (exact sentences) |
| §5.5 type CHECK, routing, scheduler | L3-T2, L3-T1, L3-T7 |
| §5.6 app: reads, list, Milik saya, params, health line | L3-T3, L3-T5, L3-T6, L3-T4 |
| §6 failure table | every row maps to a test in L2-T3, L2-T4, L2-T5, L3-T3, L3-T4, L3-T5 or L3-T7 |
| §7 security | L1-T2 and L3-T2 guards, L3-T7 (no app EXECUTE, RLS on log and view) |
| §8.1 static guards | L1-T2, L3-T2 |
| §8.2 rehearsal | L3-T7 |
| §8.3 jest | L2-T1, L2-T2, L2-T3, L2-T4, L2-T5, L1-T1, L1-T3, L3-T1, L3-T2 |
| §8.4 screen tests | L1-T4, L1-T5, L3-T4, L3-T5 (plus L2-T5 and L3-T6, not in the spec's list) |
| §10 release | *Release* above |

## Deliberate differences from the spec's wording

1. **105's ownership check uses `pg_has_role(current_user, relowner, 'USAGE')` and requires the table not to `FORCE ROW LEVEL SECURITY`**, instead of `'MEMBER'` (§3.2). Postgres exempts a table owner from RLS through `has_privs_of_role`, which is inherited privilege; a `NOINHERIT` member passes `MEMBER` and is still filtered, which is exactly the silent refusal the precondition exists to prevent. The guard test pins `USAGE`.
2. **`closeSiteEventRpc`'s tests are in `tools/__tests__/siteEventsClose.test.ts`**, not `siteEvents.test.ts` (§8.3), so Lane 1 alone edits `siteEvents.test.ts`.
3. **The month-list comparison with 106 is in `migration106.test.ts`**, not `timeWindow.test.ts` (§8.3), so Lane 2 never reads a Lane 3 file.
4. **`NewCloseRequest` carries `jobId`, generated by the form with `newSiteEventId()`**, and `ClosureForm` takes a `userId` prop. `expo-crypto` is backed by a native module, every existing suite that loads it mocks it (`siteEvents.test.ts:27`), and the store's own suites (`captureQueueStore.test.ts`, `captureQueueWeb.test.ts`) load the real store unmocked; passing the id keeps the store free of that import. The job id is still a fresh uuid, never the event id (§4.1).
5. **The worker's lookup goes through `lookupSiteEventCloser`**, a thin wrapper over `getSiteEventResult` in `tools/siteEvents.ts`, so the worker needs no copy table of its own (§4.4 names `getSiteEventResult`).
6. **`DIGEST_RUN_DATE` carries today's date after the sentence**, and the per-recipient rollback raises `DIGEST_NOT_LANDED`; neither has a `SITE_EVENT_` prefix (§5.3).
7. **"`initialMine`" is passed as `mineRequest: { mine: boolean } | null`**, memoised on `route.params` in each screen (§5.6 says the screens "pass `initialMine`"). An object whose identity changes only with a new navigation is what lets a second tap of the same notification re-apply "Milik saya" without the toggle snapping back on every re-render.
8. **Two tests the spec does not list**: `CaptureQueueCard.test.tsx` (the card's new actions) and `RoomBoardView.attention.test.tsx` (the board's wiring). `AttentionList` receives the pending close ids as a prop rather than reading the queue, so its test needs no store mock.

## Spec statements not turned into tasks

1. **Office and principal phones have no queue card.** The worker runs for every signed-in user (`workflows/App.tsx:207-212`), so an office close drains, and a failed one is visible and retryable on the detail screen (L1-T5). But the "Antrean kiriman" card lives only on the supervisor Beranda, so a **superseded** close job on an office phone has no "Mengerti" and stays in that phone's storage (not counted as waiting, not visible, harmless). The spec gives office roles no card; adding one is a product decision for the user.
2. **Two concurrent digest runs** (§5.3 item 4) are safe by construction (`ON CONFLICT ... DO NOTHING` on the UNIQUE key serialises them), and the rehearsal proves a second sequential run sends nothing; true concurrency is not rehearsed.
3. **§11 calibration items** are the user's to watch after release; none is code.
