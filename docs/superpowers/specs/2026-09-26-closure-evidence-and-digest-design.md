# Closure evidence on Selesai, offline close, and the morning attention digest

> Release 2, first slice, of the room-based site event loop: "Selesai" asks for proof by
> event type and the database enforces it; closing works with no signal through the existing
> capture queue; and one morning message per person per project, plus the same list at the
> top of Papan Ruangan, says what needs action.

**Date:** 2026-09-26. **Status:** approved design, pending implementation plan.
**Builds on:** `docs/superpowers/specs/2026-09-10-room-site-events-design.md` §5.5 (closure
evidence "offered, not required"), §11 (one notification type, "no reminders, no digests"),
§15 (mandatory evidence and any scheduler were out of release 1), §17, §18.
**Migrations:** `105_close_site_event_evidence.sql`, `106_site_event_digest.sql` (highest on
main today: `104_progress_claims.sql`).

## 1. Goal

Release 1 gave every actionable event an owner and a due date, but the end of the loop is
soft. `close_site_event` (097:832-872) closes any open event without looking at media, and
the form calls the photo "Opsional" (`ClosureForm.tsx:67`). `closeSiteEvent`
(`tools/siteEvents.ts:533-560`) uploads, inserts and calls the RPC synchronously, so a
supervisor with no signal cannot close at all. An overdue item waits in silence until someone
opens the board. This slice adds proof at close, by type, checked by the database (105); a
close that survives no signal, as a second job kind in the capture queue; and a 07:00 WIB
digest (106) built on one "needs attention" predicate that the app also shows as a list.

### 1.1 Truth contract, applied (CLAUDE.md §12)

| # | Rule | Enforcement |
|---|---|---|
| 1 | An event reads "Selesai" only after the server closed it. | No optimistic status. A queued close renders "Menunggu kirim"; every status label reads the server `status`. |
| 2 | Proof is checked where it cannot be skipped. | 105 re-checks inside `close_site_event`, including that the photo's storage object exists, not only its row. |
| 3 | The app never says a person closed something they did not. | A queued close that finds the event already closed shows the server's `closed_by` and `closed_at`, never the queue owner. |
| 4 | A failed read is never an empty list. | The attention list and the health line render a read error, as `RoomBoardView.tsx:60-66` does. |
| 5 | A digest is never claimed without landing, and never sent twice. | Log row and notification row commit in one subtransaction or not at all; a UNIQUE key stops a second run. |
| 6 | The database proves a photo exists; a person judges what it shows. | The detail screen puts the closure photo next to the closer's name and time. |

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | **Any** existing closure photo on the event satisfies the rule, whoever uploaded it. | The photo is proof about the event, not about the person. The supervisor photographs the repair and the PM or owner often taps Selesai; tying the rule to "the closer's own photo" would refuse that normal split. The RPC has no media parameter, and adding one would break every build in the field. |
| 2 | The digest is a SQL function scheduled by `pg_cron`, not an edge function. | Recipients, counts and the membership join live in the database; the idempotence key is a table in the same transaction; delivery already rides the `notifications` INSERT webhook to `send-push-notification` (034:9-10, 17-21). Nothing to deploy, no secret, no `pg_net` hop. |
| 3 | 07:00 WIB, Monday to Saturday (`0 0 * * 1-6` UTC). | Sites start around 07:00 to 08:00 on a six-day week and rest on Sunday. WIB is a fixed UTC+7 with no daylight saving (`tools/timeWindow.ts:18-23`), so 00:00 UTC is exactly 07:00 WIB all year. |
| 4 | One predicate, defined once as the view `v_site_event_attention`, read by the digest and the app list. | The number in the push and the rows seen on tapping it cannot disagree, and the list exists for people who never get a push. `security_invoker` keeps 097's RLS on `site_events` in force. |
| 5 | Someone who is both an owner and an admin or principal on a project gets **only** the office summary, which carries "n milik Anda". | One message per person per project. Two pushes about the same items teach people to ignore both (2026-09-10 §11). |
| 6 | `site_event_digest_log` is both the idempotence key and the health source. | `UNIQUE (project_id, profile_id, run_date)` makes a second run the same day (cron retry, manual call, overlap) insert nothing. The same rows are the only evidence reminders went out, so no separate heartbeat can disagree with them. |
| 7 | Every close goes through the queue, online or not. | One path, and no optimistic Selesai even on good signal. A lost response is resolved by reading the server (§4.4), not by guessing. |
| 8 | `p_run_date` must equal the Jakarta date of `now()`, else `DIGEST_RUN_DATE`. | The view reads events as they are now; a digest labelled with another day would describe today's state under that day's name. The parameter makes the log key explicit and the refusal testable. |
| 9 | Only projects with `projects.status = 'ACTIVE'` (001:56-57) are digested. | ON_HOLD, COMPLETED and CANCELLED projects keep their items on the list, but a daily push about a paused or finished project is noise. |

## 3. Closure rule: migration 105

### 3.1 The rule

| `event_type` | Proof needed to close | Refusal |
|---|---|---|
| `cacat`, `isu`, `hambatan` | At least one `site_event_media` row for the event with `role = 'closure'`, `kind = 'photo'`, whose object exists in `storage.objects` (`bucket_id = 'site-media'`, `name = storage_path`), **and whose `storage_path` no other, non-closure row of the same event also names** | `SITE_EVENT_CLOSURE_PHOTO_REQUIRED` |
| `butuh_keputusan` | `p_closure_note` of at least 10 characters after trimming | `SITE_EVENT_CLOSURE_NOTE_REQUIRED` |
| `progres`, `info` | Nothing, as today | none |

**(As built)** A closure row is also no proof when its `storage_path` matches a non-closure
row of the same event: `site_event_media_insert` lets any member insert a media row with no
upload of its own, so without this exclusion the event's own `context` photo — whose file
genuinely exists — could be re-registered as `closure` by a bare row insert, no photo ever
taken. The inner `NOT EXISTS` in §3.2 checks this per candidate closure row.

Unchanged for every type: only an open event closes (`SITE_EVENT_NOT_OPEN`), the note is
capped at 500 characters (`SITE_EVENT_CLOSURE_NOTE`), and any project member or office role
may close (097:850-857; `detailModel.ts:14-16` keeps the role question out of the RPC). The
media CHECK already admits `'closure'` (097:185); only enforcement is new.

### 3.2 The function

105 re-creates `close_site_event(p_event_id UUID, p_closure_note TEXT) RETURNS JSONB` in
097's shape (097:830-875): `DROP FUNCTION IF EXISTS close_site_event(UUID, TEXT);`, `CREATE OR
REPLACE ... SECURITY DEFINER SET search_path = public`, then `REVOKE ALL ... FROM PUBLIC,
anon;` and `GRANT EXECUTE ... TO authenticated, service_role;`. The body is 097's verbatim
except the trim and the evidence block:

```sql
v_note TEXT := NULLIF(btrim(COALESCE(p_closure_note, ''), E' \t\r\n'), '');
-- ... 097's NOT_FOUND, AUTH, AUTH, NOT_OPEN and 500-character checks, unchanged ...
IF v_ev.event_type IN ('cacat', 'isu', 'hambatan') AND NOT EXISTS (
  SELECT 1 FROM site_event_media m
  JOIN storage.objects o ON o.bucket_id = 'site-media' AND o.name = m.storage_path
  WHERE m.event_id = p_event_id AND m.role = 'closure' AND m.kind = 'photo'
    AND NOT EXISTS (
      -- (as built) refuses a closure row that only reuses another row's path
      SELECT 1 FROM site_event_media c
      WHERE c.event_id = m.event_id AND c.role <> 'closure' AND c.storage_path = m.storage_path
    )
) THEN
  RAISE EXCEPTION 'SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian % hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.', v_ev.event_type;
END IF;
IF v_ev.event_type = 'butuh_keputusan' AND (v_note IS NULL OR char_length(v_note) < 10) THEN
  RAISE EXCEPTION 'SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.';
END IF;
```

- **Trim:** 097's `btrim` default strips spaces only (097:843), so ten newlines would pass.
- **Order:** `NOT_FOUND`, `AUTH` twice, `NOT_OPEN`, `CLOSURE_NOTE`, then evidence, so a queued
  close for an event someone else already closed gets `NOT_OPEN` (§4.4), never a photo
  refusal it cannot act on. The SET list (`status = 'done', closed_at = now(), closed_by =
  v_uid, closure_note = v_note`) and the return object are unchanged.
- **Why the storage object:** `site_event_media_insert` (097:464-472) lets any member insert a
  row and the path guard (097:201-223) checks only the prefix, so a row pointing at a file
  never uploaded would otherwise count as proof.
- **(As built) Why the path also can't be shared:** the same insert path that lets a row point
  at a never-uploaded file also lets a `closure` row point at the event's own `context`
  photo's path, whose file genuinely exists — a direct insert, no app needed. The inner
  `NOT EXISTS` refuses a closure row whenever another, non-closure row of the same event
  already names that `storage_path`.
- **Why full Indonesian sentences:** older builds lack the new codes in `RPC_ERROR_COPY`, so
  `mapSiteEventRpcError` shows `Gagal menyimpan: ` plus the raw text (`tools/siteEvents.ts:162-168`).
- **Paste precondition (as built: three checks, in order, not two).** The check runs as the
  function owner (the Dashboard's `postgres`) against `storage.objects`, owned by
  `supabase_storage_admin` with RLS on. If `postgres` could not read that table, the rule
  would refuse **every** closure photo, silently. 105 opens with a `DO` block that checks, in
  order: (a) `has_schema_privilege(current_user, 'storage', 'USAGE')` — without it the next
  check's own table-name lookup fails with a bare "permission denied for schema storage"; (b)
  `has_table_privilege(current_user, 'storage.objects', 'SELECT')`; (c) RLS bypass or
  ownership: `rolsuper` or `rolbypassrls`, or `pg_has_role(current_user, relowner, 'USAGE')`
  — not `'MEMBER'`: RLS exempts the owner through inherited privilege, and a NOINHERIT
  membership would pass `'MEMBER'` and still be filtered by the policies — with the table not
  forcing row security. Bypassing RLS is no use without SELECT on the table, and SELECT is no
  use without USAGE on the schema. Each check has its own `MIGRATION_105_PRECONDITION: <role>
  ...` message, naming exactly which one failed: "tidak punya hak USAGE pada schema storage",
  "tidak punya hak SELECT pada storage.objects", or "tidak bisa membaca storage.objects
  melewati RLS". The prefix is not `SITE_EVENT_`, so the client cross-check (§8.3) never asks
  for app copy for it.
- **Re-paste hazard (stated in the 105 header too).** 097 still carries its own
  `close_site_event` and `confirm_site_event`: **re-pasting 097 alone silently reverts both
  100 and 105**, leaving working functions without the VO re-check and the evidence rule.
  After any re-paste of 097, re-paste 100 and then 105. 105 has no DDL on any table, view,
  policy or trigger, so its own second paste is a no-op; `migration105.test.ts` fails if a
  migration above 105 redefines `close_site_event`.

### 3.3 Client

- **`workflows/screens/siteEvent/closureModel.ts`** (new, pure): `closureRequirement(type)`
  gives `{ photo, note }`, each `'wajib' | 'opsional'`; `closureBlocker({ type, hasPhoto,
  sentNote })` gives the sentence that keeps the button disabled, or null. The form sends
  `note.trim()` and counts **that exact string** in code points (`Array.from(sent).length`,
  like Postgres `char_length`, not UTF-16 units); JavaScript's `trim` strips a superset of
  `E' \t\r\n'`, so the server's trim is a no-op on it and both sides count alike.
- **`ClosureForm`** gains `eventType`, `roomId` and `eventTitle` props:

| | `cacat` / `isu` / `hambatan` | `butuh_keputusan` | `progres` / `info` |
|---|---|---|---|
| Foto penutupan | Badge "Wajib". Helper: "Wajib. Foto hasil perbaikan, diambil di lokasi yang sama." | Badge "Opsional", today's helper | Badge "Opsional", today's helper |
| Catatan | "Catatan penutupan", Opsional | "Catatan keputusan", badge "Wajib", hint "Wajib, minimal 10 karakter. Apa keputusannya dan siapa yang memutuskan?", counter `n/500 · minimal 10` | "Catatan penutupan", Opsional |
| "Tandai selesai" enabled when | a photo is picked | the sent note has 10 characters | always |
| Line under a disabled button | "Ambil foto penutupan dulu." | "Tulis catatan keputusan, minimal 10 karakter." | none |

- **Submit** calls `enqueueCloseJob` (§4.1), `triggerDrain()`, `onQueued()`. Toast: "Penutupan
  masuk antrean. Status menjadi Selesai setelah server menerimanya."; on web, where the queue
  is memory only (`captureQueueStore.ts:33-36`), "Dikirim dari tab ini. Jangan tutup halaman
  sampai status berubah menjadi Selesai."
- **`RPC_ERROR_COPY`** (`tools/siteEvents.ts:131-159`) gains `SITE_EVENT_CLOSURE_PHOTO_REQUIRED`
  → "Foto penutupan wajib untuk jenis ini. Ambil foto hasil perbaikan lalu tandai selesai
  lagi." and `SITE_EVENT_CLOSURE_NOTE_REQUIRED` → "Catatan keputusan wajib diisi, minimal 10
  karakter." The mapper matches `CODE:` exactly, so the second never collides with
  `SITE_EVENT_CLOSURE_NOTE:`.
- **Detail after close.** The "Selesai" card (`SiteEventDetailScreen.tsx:213-227`) already
  shows closer, time and note (`closer:profiles!site_events_closed_by_fkey`,
  `tools/siteEvents.ts:369-370`); it gains a `MediaStrip` of the `closure` photos, and "Bukti"
  (`:194-211`) keeps the other roles. A service-role close leaves `closed_by` NULL (097:841,
  867) and the card reads "Ditutup" plus the time, as today.

## 4. Offline close: a second job kind in the capture queue

Same AsyncStorage store, same worker, same `CaptureQueueCard`; capture jobs behave as today.

### 4.1 The close job

`CaptureQueueEntry` becomes a union on `kind`: `CaptureJob` (today's fields plus `kind:
'capture'`) or `CloseJob`:

| Field | Meaning |
|---|---|
| `version: 2`, `kind: 'close'` | Schema version and job kind. |
| `id` | A fresh client uuid, **not** the event id: a capture entry keyed on the event id can still sit on the phone between analysis and cleanup, and the media folder is `capture-queue/{userId}/{entryId}/` (`captureQueueStore.ts:85-87`). |
| `ownerId`, `eventId`, `projectId`, `roomId`, `eventTitle` | Who queued it, the event, and a title for the card, which must render with no signal. |
| `note`, `media` | `note.trim()` or null, exactly what the RPC receives; zero or one `QueueMediaItem` with `role: 'closure'`, `kind: 'photo'`. |
| `mediaInserted`; `closeOutcome` (`null`, `'closed'`, `'not_open'`); `closedElsewhere` (`null` or `{ closedByName: string \| null, closedAt: string }`) | Progress, each backed by one retryable call. |
| `localCleanedUp`, `createdAt`, `attempts`, `consecutiveFailures`, `lastError`, `lastAttemptAt`, `needsAttention`, `unrecoverable`, `lastFailureKind?` | As on the capture job (`captureQueue.ts:41-87`). |

`enqueueCloseJob({ userId, eventId, projectId, roomId, eventTitle, note, closurePhoto, nowIso
})` in `captureQueueStore.ts` copies the photo with `copyMediaIntoQueueDir` (native only)
before writing the entry, keeping "media copies first, then the entry record" (`:24-31`),
and refuses with "Penutupan kejadian ini sudah menunggu kirim." when this user already has a
close job for `eventId` that is not `done` or `superseded`.

### 4.2 Version 2 and the upgrade

`CAPTURE_QUEUE_ENTRY_VERSION` goes from 1 to 2 (`captureQueue.ts:92`). In `upgradeEntry`
(`:104-110`), `version ?? 1` equal to 1 passes today's `isValidV1Entry` and returns `{ ...raw,
version: 2, kind: 'capture' }` (`kind` set, never read from the record), so every report
queued today drains as before; version 2 validates by kind (`capture` the same check, `close`
a new `isValidCloseEntry`); anything else is null, which the store leaves untouched and
excludes (`captureQueueStore.ts:365-375`). A v1 record becomes v2 on its next `saveEntry`.
The key prefix `sano.captureQueue.v1` (`:50`) is a namespace, not the schema version, and
stays: renaming it would orphan every queued report. After an OTA rollback to a v1-only
bundle, v2 records are skipped, not deleted, and their files survive because the orphan
sweep keys on the AsyncStorage key (`:197-228`).

### 4.3 State machine

`QueueState` gains `'closing'` and `'superseded'`. Transition tables are per kind; the
capture table (`captureQueue.ts:283-290`) is unchanged.

| Close job from | To | `deriveCloseState` gives it when |
|---|---|---|
| `queued` | `uploading`, `closing`, `failed` | nothing has happened yet |
| `uploading` | `uploading`, `closing`, `failed` | the photo is uploaded but its row is not in |
| `closing` | `closing`, `done`, `superseded`, `failed` | the row is in, or there is no photo, or an outcome is recorded but not cleaned up |
| `failed` | `queued`, `uploading`, `closing` | set only by `recordFailure` |
| `done` / `superseded` | nothing | cleaned up after outcome `closed` / `not_open` |

`nextStep` returns `none` for `done`, `superseded`, `unrecoverable` or `needsAttention`, then
dispatches on `entry.kind` to `nextCaptureStep` (today's body, `:341-349`) or `nextCloseStep`,
which asks in order for `upload`, `insert_media`, `close`, `lookup_closer` (outcome `not_open`
without `closedElsewhere`) and `cleanup`; `STEP_LABEL` (`captureQueueWorker.ts:368-373`)
gains "Simpan foto penutupan", "Tandai selesai", "Baca status kejadian". New mutators
`markClosureMediaInserted`, `markCloseOutcome`, `markClosedElsewhere` go through
`withProgress`/`assertTransition`; the rest are shared. A close job's `markUnrecoverable` and
`recoverMissingMedia` key on "photo not yet uploaded" (capture keeps `eventInserted`).
`isReadyToAttempt` treats `superseded` as terminal; `WAITING_STATES` gains `closing`, so the
Beranda badge counts a waiting close as "menunggu sinyal".

**(As built) The unreadable close.** A `lookup_closer` step that fails for good lands in
`failed` like any other permanent failure (`recordFailure`: `lastFailureKind: 'permanent'`,
`needsAttention: true`), but this job also already carries `closeOutcome: 'not_open'` from the
`close` step that ran before it. That pairing is neither pending nor superseded: the server
has already said the event is no longer open, yet nothing could be read about who closed it or
when. `isCloseStatusUnreadable(job)` in `captureQueue.ts` names it exactly
(`closeOutcome === 'not_open' && lastFailureKind === 'permanent'`); `pendingCloseFor`
(`captureQueueStore.ts`) excludes it so it never reads as "will still try", `unreadableCloseFor`
finds it, and `acknowledgeCloseEntry` is the only way off it, the same as a superseded job.
`pendingCloseFor`, `supersededCloseFor` and `unreadableCloseFor` all return `null` when nothing
matches, so every caller tests them the same way.

### 4.4 Worker steps and outcomes

| Step | Call | Result |
|---|---|---|
| `upload` | Shared, but a close job's carrier id is `entry.eventId`: the object must land in `site-events/{projectId}/{eventId}/` or 097's path guard refuses the row. | `markUploaded` |
| `insert_media` | `insertClosureMedia(carrier, bytesById)`, today's upsert with `ignoreDuplicates` (`tools/siteEvents.ts:547-550`) lifted out, so a retry is a no-op. | `markClosureMediaInserted` |
| `close` | `closeSiteEventRpc(eventId, note)` returns `{ ok }`, `{ notOpen }` for `SITE_EVENT_NOT_OPEN:`, or `{ error, kind }`: other `SITE_EVENT_*:` refusals and Postgres `42501` are `permanent`, anything else `transient`. | `ok` → outcome `closed`. `notOpen` → outcome `not_open`, **not a failure**: no strike, no `lastError`, and the RPC is never called again. |
| `lookup_closer` | `getSiteEventResult(eventId)` (`tools/siteEvents.ts:386-412`), wrapped **(as built)** by `lookupSiteEventCloser(eventId)` (`tools/siteEvents.ts:599-609`). | Status `done` with `closed_at` set records `closed_by_name`, `closed_at`. A read error is transient and the next pass repeats only the lookup. Not found, or any other status, is permanent, mapped through the `SITE_EVENT_NOT_OPEN` copy — paired with the job's own `not_open` outcome, this is the unreadable case §4.3 names. |
| `cleanup` | Shared. | `processEntry` still removes only `done` entries (`:285-287`); `superseded` stays until acknowledged. |

`closeSiteEvent` is removed; the form has no synchronous path. **Lost response:** the retry
gets `NOT_OPEN`, the lookup reads the queue owner's own name, and the card says "Sudah
ditutup oleh {own name} pada {time}", true either way, so the job never guesses whose attempt
landed. **Refusals** follow the existing `recordFailure` rule unchanged (`captureQueue.ts:406-423`,
`captureQueueWorker.ts:304-309`): transient failures back off and flag after
`MAX_CONSECUTIVE_FAILURES` (5) in a row, not counting offline ones; a permanent one flags at
once. `SITE_EVENT_CLOSURE_PHOTO_REQUIRED` reaches a job only if it carries no photo for a
type that needs one (the form prevents it) or the object is missing at close time; it is
permanent and the card offers "Batalkan", after which the person closes with a new photo.

### 4.5 Where "Menunggu kirim" shows

`pendingCloseFor(entries, eventId)` returns the event's close job unless `done` or `superseded`.

| Surface | While a close job is pending |
|---|---|
| Detail | Status chip keeps the server label; while it is still "Terbuka" the chip "Menunggu kirim" joins it and "Selesai" is replaced by "Penutupan tersimpan di ponsel ini dan menunggu kirim. Status tetap Terbuka sampai server menerimanya." **(As built)** once the server's own status is no longer "Terbuka" — someone else closed the event while this job's lookup is still pending — the "Menunggu kirim" chip drops and the sentence becomes "Kejadian ini sudah ditutup di server. Penutupan yang tersimpan di ponsel ini akan dicek saat terkirim." If the job needs attention: "Penutupan belum terkirim: {lastError}", then exactly one of "Coba lagi" (`retryQueueEntry`, shown only when the shared `closeJobCancelKind` rule, §4.6, says `'retry'`) or "Batalkan" (shown only on `'cancel'`, with the card's own confirm sentence, whose "Kejadian tetap terbuka." clause is rewritten to "Kejadian ini sudah ditutup di server." once the server status is not open). A superseded or unreadable job (§4.3) instead shows its own reason and "Mengerti", superseded taking precedence when both exist for the event. Acting on any of these makes the screen call `load()` and show what the server says. |
| Room timeline | A second badge beside the status badge (`RoomTimeline.tsx:186-195`); its "Selesai" action is hidden. **(As built)** `pendingCloseBadge(job)` (`timelineModel.ts`) reads "Belum terkirim" while the job needs attention, else "Menunggu kirim"; `pendingCloseLeft(before, after)` compares the pending-close id set across a reload and tells the timeline to reload once an event's pending close disappears (closed, superseded, cancelled, or turned unreadable) — the timeline's own version of the detail screen's `hadPendingClose` rule. |
| Perlu ditindak (§5.6) | The row stays, since the server still has it open, with a "Menunggu kirim" chip. |
| Board counts | Unchanged: `v_room_board` counts server state, where the event is still open. |

### 4.6 The card

`attentionRows` (`captureQueueModel.ts:92-104`) becomes kind-aware:

| Close job | Title | Reason | Action |
|---|---|---|---|
| Needs attention, transient | "Selesai: {eventTitle}" | `lastError` | "Coba lagi" |
| Permanent or unrecoverable, no outcome yet | "Selesai: {eventTitle}" | `lastError`, or "Foto penutupan hilang dari HP sebelum terkirim. Batalkan, lalu tandai selesai lagi dengan foto baru." | "Batalkan", confirmed with "Batalkan penutupan "{title}"? Kejadian tetap terbuka." plus, **(as built)** only when the closure photo's media row is in (`mediaInserted`), the trailing "Foto yang sudah terkirim tetap tersimpan sebagai bukti di kejadian itu." |
| `superseded` | "{eventTitle}" | "Sudah ditutup oleh {closedByName} pada {17 Sep 14.05}." or, with no name, "Sudah ditutup pada {…}." | "Mengerti", which removes it (`acknowledgeCloseEntry`) |
| **(As built)** unreadable — `closeOutcome = 'not_open'` plus a permanent lookup failure (§4.3's `isCloseStatusUnreadable`) | "Selesai: {eventTitle}" | `REASON_CLOSE_STATUS_UNREADABLE`: "Kejadian sudah tidak terbuka di server; statusnya tidak bisa dibaca." | "Mengerti", which removes it (`acknowledgeCloseEntry`) |

**(As built)** One rule decides the action column for every row above,
`closeJobCancelKind(job)` in `workflows/screens/siteEvent/captureQueueModel.ts`:
`'acknowledge'` for `superseded` or unreadable, `'cancel'` for a permanent refusal or a lost
photo with no outcome recorded yet, `'retry'` for a transient failure still under attention,
`null` otherwise — the same rule the detail screen reads (§4.5), so no two surfaces offer
different ways out of the same job.

`discardEntryLocally` refuses a close job with an outcome, worded by which one **(as built)**:
"Kejadian sudah ditutup di server." when the outcome is `closed`, "Kejadian sudah tidak
terbuka di server." when it is `not_open`; the early return (`CaptureQueueCard.tsx:76`) also
counts `superseded` rows. **(As built)** "Mengerti" (`acknowledgeCloseEntry`) removes the
queue entry's key first, then deletes its local folder best-effort — a folder that cannot be
deleted now is left for the next session's orphan sweep, never a reason to fail "Mengerti".
Times use a new pure `formatWibShort(iso)` in `tools/timeWindow.ts`: fixed +7 h arithmetic like
`todayIsoWIB` (`:79-85`), months `Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des`, `HH.mm`.

## 5. Morning digest: migration 106

### 5.1 `v_site_event_attention`

```sql
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
```

- **The predicate** is the approved one: open, and either past due on the Jakarta calendar
  (the "today" of `v_room_board`, 097:900-904, and of `confirm_site_event`'s `v_today`), or
  blocking since before 00:00 WIB today. Blocking since this morning is not yet attention.
- **`owner_on_project`** backs "tanpa penanggung jawab": no owner, or an owner no longer on
  the project, who never gets a digest because delivery is membership-gated (092:128-135). A
  supervisor reads only their own `project_assignments` row (023:67-75), so for a colleague's
  item the answer is unknowable to them and the column is NULL, not a false "no". It is exact
  for office roles (036:84-86), for the owner, and inside the digest function, where
  `current_user` is `postgres` (the distinction 097's guard uses, 097:314-316).
- Retired rooms still list their open items. 106 adds `idx_site_events_blocking_open ON
  site_events(project_id) WHERE status = 'open' AND is_blocking`; the overdue half already
  has `idx_site_events_project_due_open` (097:168).

### 5.2 Log table and health view

`CREATE TABLE IF NOT EXISTS site_event_digest_log`, every column NOT NULL: `project_id`
(→ `projects` ON DELETE CASCADE), `profile_id` (→ `profiles` ON DELETE CASCADE), `run_date
DATE`, `kind TEXT CHECK (kind IN ('owner', 'office'))`, `sent_at TIMESTAMPTZ DEFAULT now()`,
and `CONSTRAINT site_event_digest_log_once UNIQUE (project_id, profile_id, run_date)`. RLS
on with one policy, `FOR SELECT USING (is_office_role())`, and no write policy: only the
SECURITY DEFINER function writes. `v_site_event_digest_health` (`security_invoker`) returns
no row, or one row `(last_run_date, last_sent_at, recipients)` for the latest `run_date`
across all projects (`max(sent_at)`, `count(DISTINCT profile_id)` on that date): it describes
the scheduler, not one project.

### 5.3 `enqueue_site_event_digests`

`enqueue_site_event_digests(p_run_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date)
RETURNS INTEGER`: SECURITY DEFINER, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC,
anon, authenticated` — **(as built) also `service_role`**, on this function and on
`site_event_digest_day`: Supabase's default privileges grant `service_role` EXECUTE on every
new function, and a round of pushes is not something the service role should be able to
trigger either — and **no grant**, so only `pg_cron` and the Dashboard (both `postgres`) run it
and no app role can trigger a round of pushes.

1. A `p_run_date` other than the Jakarta date of `now()` raises `DIGEST_RUN_DATE: tanggal
   kiriman harus hari ini (WIB)` (no `SITE_EVENT_` prefix: no client ever sees it).
2. Recipients, from `v_site_event_attention` joined to `projects` with `status = 'ACTIVE'`.
   **Office:** every `project_assignments` row on a project with an attention item whose
   profile role is `admin` or `principal`. The office recipient must hold that row on that
   project (the 092 membership rule, 092:128-135): an admin not assigned to a project gets
   no summary for it, while principals are members of every project by 093 (an explicit
   removal sticks, 093:41-43). **Owner:** each distinct `owner_id` with a
   `project_assignments` row on that project, unless an office recipient there.
3. Per recipient, in its own `BEGIN ... EXCEPTION WHEN OTHERS` block: **(as built)** first
   count that recipient's current attention rows and build the title and body from them — a
   fresh read, separate from the recipient query above, since every item this person was
   picked for may have closed in the gap between the two. A zero count `CONTINUE`s straight to
   the next recipient: no log row, no notification, and no `WARNING` — an office "0 tugas"
   push logged as sent, or an owner's body built from nothing, would both say something false.
   Only once there is something to report does the function `INSERT INTO
   site_event_digest_log ... ON CONFLICT (project_id, profile_id, run_date) DO NOTHING`,
   skipping the rest of the block when nothing was inserted (already sent today for this
   person, project and kind); else `PERFORM enqueue_notification_user(project_id, profile_id,
   'SITE_EVENT_DIGEST', title, body, 'RoomBoard', params, NULL, NULL, NULL)` (092:100-137) and
   read back `notifications` for that recipient, project and type with `created_at >= now()`
   (097:790-803). If nothing landed, `RAISE EXCEPTION 'DIGEST_NOT_LANDED: ...'` so the block
   rolls back everything it did for this recipient, **including the log row just inserted**;
   the handler logs a `WARNING` and the loop goes on. A log row exists if and only if its
   notification does.
4. Return the number that landed (0 when nobody needs anything). Two concurrent runs
   serialize on the UNIQUE key and the second inserts nothing.

### 5.4 Messages

Counts overlap: an item overdue and blocking counts once in `n` and in each of "lewat
tenggat" and "menghambat". A zero part is dropped with its separator. Dates use a STABLE
`site_event_digest_day(d DATE)` (STABLE because `to_char` is; an IMMUTABLE label would be
false): `to_char(d, 'FMDD') || ' ' ||
(ARRAY['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'])[extract(month
FROM d)]`. Titles carry the project code because a push banner has no project line (the
in-app list names it, `NotificationList.tsx:15-17`); titles cap at 200 characters as 097 does
(097:780), bodies at 240.

| Kind | Title | Body |
|---|---|---|
| owner | `{n} tugas lapangan perlu ditindak · {projects.code}` | `{a} lewat tenggat, {b} menghambat. Terlama: {room_code} – {left(title, 60)} (tenggat {12 Sep}).` If none of the owner's items is overdue, the oldest blocking one ends `(menghambat sejak {WIB day of confirmed_at}).` |
| office | the same, with the project-wide `n` | `{a} lewat tenggat, {b} menghambat. {c} tanpa penanggung jawab. {d} milik Anda.` |

"Terlama" is the owner's overdue item with the earliest `due_date` (ties: earliest
`confirmed_at`, then `event_id`), else the blocking item with the earliest `confirmed_at`.
`c` counts `owner_on_project IS FALSE`; `d` counts items the recipient owns. Params: owner
`{ projectId, attention: true, mine: true }`, office the same with `mine: false`.

### 5.5 Type, routing and scheduler

**Type CHECK**, widened by shape as 098:59-88 and 104:381-408 do: a `DO` block drops every
`contype = 'c'` constraint on `public.notifications` whose definition is `ILIKE '%type%'` and
adds `notifications_type_check` with 104's sixteen types plus `SITE_EVENT_DIGEST`
(`migration104.test.ts:452-455` already makes a later swap keep the claim types). Re-pasting
098 or 104 after 106 drops `SITE_EVENT_DIGEST` and turns every digest into a WARNING nobody
reads; the 106 header says so. **Routing:** `tools/notificationRouting.ts` gains `RoomBoard:
'RoomBoard'` (`:36-51`) and one rule: for any role but supervisor, `RoomBoard` resolves to
`Rooms`, the "Ruangan" tab (`office/navigation.tsx:152`, `office/PrincipalNavigation.tsx:114`);
the supervisor navigator registers `RoomBoard` (`workflows/navigation.tsx:185`), and
`routeDeeplink` already switches project for `params.projectId` (`workflows/pendingDeeplink.ts:42-56`).

**Scheduler.** Nothing in the repo schedules anything today: no migration calls
`cron.schedule` or `net.http_post`, 034's retry job was set up by hand (034:22-24), CI has
only `ci.yml`, and there is no Vercel cron. 106 ends with the block below; its `cron.*`
statements are planned only when their branch runs, so it pastes cleanly without `pg_cron`,
which evaluates schedules in UTC.

```sql
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
```

### 5.6 App

- **`tools/siteEventAttention.ts`** (new): `listSiteEventAttention(projectId)` reads the view
  for the project, ordered by `days_overdue` desc, `due_date` asc, `confirmed_at` asc, limit
  200, returning `{ rows } | { error }` (the `RoomBoardResult` shape, `tools/roomBoard.ts:31-45`);
  `getDigestHealth()` returns `{ last } | { error }`, `last` null when the view has no row.
- **"Perlu ditindak"** (`office/screens/rooms/AttentionList.tsx`) renders at the top of
  `RoomBoardView`, above the summary card, so the supervisor `RoomBoardScreen` and the office
  and principal Rooms tabs all get it. Title "Perlu ditindak ({n})". **(As built)** when the
  read hit the 200-item cap the title instead reads "Perlu ditindak (200 teratas)", or with
  "Milik saya" on, "Perlu ditindak ({shown} dari 200 teratas)" — the filtered count, never a
  bare `n` that would read as everything the viewer owns (`attentionHeading`,
  `tools/siteEventAttention.ts`). Row: `{room_code} · {room_name}`, title, chips "Lewat {d}
  hari" (d ≥ 1), "Menghambat", "Menunggu kirim" (§4.5) and, in office layouts, the owner's name
  or "Tanpa penanggung jawab" when `owner_on_project` is false; a tap opens `SiteEventDetail`
  with `{ eventId, projectId }`.

| State | Renders |
|---|---|
| loading | a spinner in the card, **(as built)** shown only while there is no data yet for the current project: a refresh keeps the previous rows on screen, and only a retry after a failed read goes back to the spinner |
| error | "Daftar perlu ditindak gagal dimuat. Periksa koneksi lalu coba lagi." and "Coba lagi"; never the empty text |
| empty | "Tidak ada yang perlu ditindak."; with Milik saya on and the read under the cap, "Tidak ada tugas Anda yang perlu ditindak."; **(as built)** with Milik saya on and the read at the 200-item cap, "Tidak ada tugas Anda di 200 teratas." — the viewer may own items past the first 200, so the text says only what the capped read can prove |

- **(As built)** Every read takes a number from a ref counter; only the latest one may set
  state, so a slow earlier answer can never overwrite a newer one (`AttentionList.tsx`). The
  board (`RoomBoardView.tsx`, via `useFocusEffect`) bumps a `reloadKey` on every focus after
  the first and on pull-to-refresh; the list itself reads once on mount and again whenever
  `reloadKey` changes — so, together, the board reads once on mount and once per later focus.
- **"Milik saya"** is a pill in the list header filtering the same rows to `owner_id ===
  profile.id`, with no second query. **(As built)** `attentionMineRequest(params)`
  (`tools/siteEventAttention.ts`) is what the three screens use to turn a `SITE_EVENT_DIGEST`
  tap's route params into `{ mine } | null`: `RoomBoardScreen`, `PrincipalRoomsScreen` and
  `RoomsAdminScreen` each call it and pass the result down as a `mineRequest` prop (not a
  generic `initialMine`), a fresh object per tap (`pendingDeeplink.ts:37-38`) so a second tap
  of the same notification re-applies it even with the list already on screen.
  `RoomsAdminScreen` sets `sub = 'board'` (`:43-46`) when `mineRequest` is non-null.
- **Health line** (`DigestHealthLine.tsx`), office layouts only, via a `showDigestHealth` prop
  from `RoomsAdminScreen` and `PrincipalRoomsScreen`: "Pengingat terakhir: 17 Sep 07.00 · 4
  orang" (`formatWibShort`); "Pengingat harian belum pernah terkirim" when the view has no
  row; "Status pengingat harian gagal dimuat." on a failed read. The log records sends, not
  runs, so a day on which nobody needed a message leaves no trace: "belum pernah terkirim" is
  the only empty-state sentence the table can prove.

## 6. Failure handling

| Failure | Behaviour |
|---|---|
| Close with no signal | The job waits; detail and timeline say "Menunggu kirim"; nothing says Selesai. |
| Someone else closed first | Job ends `superseded`; the card shows their name and time; the uploaded photo stays on the event as extra evidence. |
| RPC refusal (photo, note, RLS, removed from project) | Mapped copy on the card and the detail; flagged at once with "Batalkan". |
| Closure photo purged by the OS before upload | `unrecoverable`; "Batalkan", then close again with a new photo. |
| Cron not enabled | 106 prints the NOTICE; the health line says "belum pernah terkirim"; the list still works. |
| One recipient's digest fails | WARNING, their log row rolls back, everyone else is served; a manual call the same day retries only them. |
| Owner removed from the project | Gets nothing (membership join); the office sees the item under "tanpa penanggung jawab". |
| Attention or health read fails | Read error with retry, never an empty or "never" state. |

## 7. Security

`close_site_event` keeps SECURITY DEFINER, a pinned `search_path`, no anon EXECUTE and the
four-column SET list; the storage check compares an exact name the path guard pins to the
event's folder. `enqueue_site_event_digests` has no grant to any app role; the log is readable
by office roles only and written only by that function. Both views are `security_invoker`,
so 097's `site_events_select` and the rooms policies decide what each person sees, and
`owner_on_project` is NULL where the reader's own RLS cannot see membership. Notification
reads stay membership-gated (092:562-571). No new secret, edge function or outbound call.

## 8. Testing

### 8.1 Static migration guards (jest, `migration099.test.ts` style: SQL read with full-line comments stripped)

| File | Pins |
|---|---|
| `tools/__tests__/migration105.test.ts` | Header links this spec, PASTE ORDER (after 097, 098, 099, 100), RE-PASTE SAFETY, and "re-pasting 097 reverts 100 and 105"; `SET lock_timeout = '5s';` first and one `RESET`; the precondition `DO` block before the function, checking, **(as built) in order,** USAGE on the storage schema (`has_schema_privilege(current_user, 'storage', 'USAGE')`, before the table check), the SELECT privilege (`has_table_privilege(current_user, 'storage.objects', 'SELECT')`) and RLS bypass or ownership (`pg_has_role(current_user, v_owner, 'USAGE')`, not `'MEMBER'`), each with its own `MIGRATION_105_PRECONDITION:` message; DROP by signature before CREATE, REVOKE and GRANT after, exact grantees; DEFINER and `search_path`; the `E' \t\r\n'` trim; the exact four-column SET list; RAISE codes in order `NOT_FOUND`, `AUTH`, `AUTH`, `NOT_OPEN`, `CLOSURE_NOTE`, `CLOSURE_PHOTO_REQUIRED`, `CLOSURE_NOTE_REQUIRED` (all `SITE_EVENT_`); the photo branch names exactly `cacat`, `isu`, `hambatan`, joins `storage.objects` on `'site-media'` and `m.storage_path` with `role = 'closure'`, and **(as built)** its inner `NOT EXISTS (... c.role <> 'closure' AND c.storage_path = m.storage_path)` excludes a reused non-closure path; `char_length(v_note) < 10`; no table, view, policy or trigger DDL; no migration above 105 redefines `close_site_event`; the self-check `EXPECTED:` count. |
| `tools/__tests__/migration106.test.ts` | Header (spec, paste order after 104 and 105, what re-pasting 098 or 104 undoes); `lock_timeout`; the log table `IF NOT EXISTS`, UNIQUE key, `kind` CHECK; RLS on, one SELECT policy, no write policy; `DROP VIEW IF EXISTS` and `security_invoker = true` on both views; the predicate text and `'Asia/Jakarta'`; DEFINER, `search_path`, REVOKE from `PUBLIC, anon, authenticated` **(as built) and `service_role`** on both `enqueue_site_event_digests` and `site_event_digest_day`, no GRANT on either function, and a self-check grid reporting whether `authenticated` or `service_role` can execute them; `ON CONFLICT (project_id, profile_id, run_date) DO NOTHING`; `enqueue_notification_user` and `'RoomBoard'`; `DIGEST_RUN_DATE:`; `status = 'ACTIVE'`; the CHECK widened by shape with 104's sixteen types kept and exactly `SITE_EVENT_DIGEST` added; the cron guard (`pg_extension`, unschedule-if-exists, name, `'0 0 * * 1-6'`, command) and the NOTICE naming "Integrations → Cron"; no `SITE_EVENT_` RAISE code. |

### 8.2 Docker rehearsal: `supabase/tests/site_event_closure_rehearsal/`

Modelled on `supabase/tests/progress_claims_rehearsal/run.sh` (same image, `rehearsal.as_user`,
`expect`, `expect_error`, PASS/FAIL/ERROR tally; own container `sano-pg-closure-rehearsal`).
That image has no storage schema (`run.sh:5-7`), so `storage_stub.sql` first creates
`storage.buckets` and `storage.objects` **owned by `supabase_storage_admin` with RLS on**, as
in production, so the precondition and the existence check face the live RLS question. The
first run applies 001-104; every run pastes 105 and 106 **twice** each, loads the fixture, then:

**(As built)** 76 checks in total: `rehearse_105.sql` runs 30, `rehearse_repaste_097.sql` and
`rehearse_repaste_105.sql` run 2 and 2, `rehearse_106.sql` runs 39, and the scheduler's own
bash PASS/FAIL assertions in `run.sh` (no SQL rehearsal helper, so not part of the 106 count)
run 3.

| Area | Cases |
|---|---|
| Closure, every row of §3.1 (30) | `cacat`, `isu`, `hambatan`: refused with no closure row; **(as built)** the full three-type matrix for a closure row whose object was never uploaded ("file missing") and for an event holding only a `context` photo ("only a context photo"); **(as built)** a closure row that reuses a non-closure row's own path is refused too (the context-photo reuse rule, §3.1); closed with row plus object; closed by a second member using a photo a first member uploaded. `butuh_keputusan`: refused with NULL, nine characters, ten newlines; closed with ten characters padded by spaces and newlines; 501 gets `SITE_EVENT_CLOSURE_NOTE`. `progres`, `info` close with nothing. A closed `cacat` with no photo gets `NOT_OPEN`, not the photo refusal. An outsider gets `AUTH`. Note stored trimmed; `closed_by`, `closed_at` set. |
| Re-paste hazard (2 + 2) | Paste 097: a `cacat` with no photo closes (the revert is real). Paste 100 and 105: refused again. |
| Digest | Owner only (one row, counts, the "Terlama" item); office (admin and principal one row each, "tanpa penanggung jawab" counting a NULL owner and a removed owner); both roles (an admin owner gets only the office row, "1 milik Anda"); nothing to send (zero rows); second run the same day returns 0 and adds nothing; yesterday's log row does not block today; the removed owner gets no row; a non-ACTIVE project gets nothing; `DIGEST_RUN_DATE` for tomorrow; `authenticated` and, **(as built)**, `service_role` cannot execute the digest function or `site_event_digest_day`; a supervisor reads zero log rows, an office role reads them. **(As built)** `DIGEST_NOT_LANDED`, forced by a trigger that drops the recipient's own notification row right after insert, leaving no log row and exactly one `WARNING`; the zero-count race, forced by a trigger that closes every open event right after the recipient query's own snapshot, so the later count comes back zero and the recipient gets no log row, no notification and no `WARNING`; "Terlama" ending "(menghambat sejak …)" when nothing the owner has is overdue; a due-date tie on "Terlama" breaking on the earlier `confirmed_at`. |
| View under RLS | Outsider sees nothing; a supervisor sees the project's rows with `owner_on_project` NULL on colleagues' items; an office role sees exact values; due today is not overdue, due yesterday has `days_overdue = 1`; blocking confirmed today absent, yesterday present. |
| *(Digest + View under RLS together: 39, all in `rehearse_106.sql`)* | |
| Scheduler (3) | `DROP EXTENSION IF EXISTS pg_cron`, paste 106 twice: the NOTICE, no error (2 checks). `CREATE EXTENSION pg_cron` (preloaded in supabase/postgres images; the run fails if not, since that is the Dashboard's branch), paste 106 twice: exactly one `cron.job` named `site_event_digest` with schedule `0 0 * * 1-6` (1 check). |

### 8.3 Jest

| File | Covers |
|---|---|
| `tools/__tests__/captureQueue.test.ts` | A v1 record and a legacy record with no `version` both upgrade to `version: 2`, `kind: 'capture'`, every field kept; v2 capture and close pass; version 3, an unknown `kind`, a close record missing `eventId` are null; the close transition table exhaustively; `nextStep` with and without a photo and through `not_open`; `superseded` neither ready nor waiting; `markUnrecoverable` per kind. |
| `tools/__tests__/captureQueueWorker.test.ts` | Success calls upload, insert and RPC in order with carrier id `eventId`, then removes the entry; `NOT_OPEN` reads the event, ends `superseded` with the server's name and time, records no failure, never calls the RPC again, stays until acknowledged; a failed lookup retries only the lookup; a photo refusal flags at once with the mapped copy; a network error on the RPC flags after five. **(As built)** a lost response — the close landed but its own reply never arrived — is resolved by the retry meeting `NOT_OPEN`, reading the server, and ending `superseded` after exactly two RPC calls total, never a guess at whose attempt won. |
| `tools/__tests__/captureQueueStore.test.ts` | A v1 record on disk loads and drains; `enqueueCloseJob` copies before writing and refuses a second pending job for the event; `discardEntryLocally` refuses a close job with an outcome. **(As built)** the copy-before-write order holds for a close job too (photo copied, then the entry written; no entry at all if the copy fails); on `web`, where the queue is memory-only, no file is ever copied and `discardEntryLocally` works the same way minus the filesystem call. |
| `tools/__tests__/siteEvents.test.ts` | The cross-check "RPC_ERROR_COPY vs migrations 097, 099 and 100" (about line 682) also reads `105_close_site_event_evidence.sql`, still with exact set equality; 106 is deliberately not read, since no client calls it. The mapper test adds both codes beside `SITE_EVENT_CLOSURE_NOTE`. `closeSiteEventRpc` classifies `NOT_OPEN`, other `SITE_EVENT_*`, `42501` and a network error. |
| `workflows/__tests__/closureModel.test.ts`, `captureQueueModel.test.ts` | Requirement per type, blocker sentences, code-point counting with an emoji; close rows, their three actions, the superseded sentence with and without a name. |
| `tools/__tests__/notificationRouting.test.ts`, `timeWindow.test.ts` | `RoomBoard` → `RoomBoard` for a supervisor, `Rooms` for admin, estimator, principal; `formatWibShort` across a UTC date boundary, its month list equal to the array parsed from 106's `site_event_digest_day`. |

### 8.4 Screen tests (React Native Testing Library; mock `Image` per test as `StoragePhoto.test.tsx` does)

| File | Covers |
|---|---|
| `workflows/screens/siteEvent/__tests__/ClosureForm.test.tsx` | Wajib and Opsional for all six types; disabled until the photo or the ten-character note; submit enqueues and never calls the RPC. |
| `office/screens/rooms/__tests__/AttentionList.test.tsx` | Loading, error (no empty text), empty in both toggle states, rows, the Milik saya filter, the deeplink turning it on, "Menunggu kirim" on a pending row, a tap opening `SiteEventDetail`. |
| `office/screens/rooms/__tests__/DigestHealthLine.test.tsx` | Last run, never sent, read error. |
| `workflows/screens/__tests__/SiteEventDetailScreen.pendingClose.test.tsx` | A pending job shows "Menunggu kirim" and hides Selesai while the status label stays "Terbuka", and drops both once the server's own status is no longer open; when the job disappears the screen reloads. **(As built)** a flagged job offers exactly one of Coba lagi or Batalkan per `closeJobCancelKind`, the Batalkan confirm carrying the photo sentence only when `mediaInserted`; a superseded job names the server's closer and time, an unreadable one says only that the event is no longer open, "Mengerti" acknowledges either and reloads, and a superseded job takes precedence when both exist for the same event. |
| `workflows/screens/siteEvent/__tests__/CaptureQueueCard.test.tsx` | **(As built, beyond the original list)** A superseded close names the server's closer and acknowledges on Mengerti; Batalkan on a refused close asks first, then discards; an unreadable close offers Mengerti, not Coba lagi; a failed Mengerti keeps the row so it can be pressed again; close rows keep the capture rows' own accessibility labels; a close still on its way counts as waiting for signal. |
| `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx` | **(As built, beyond the original list)** The board hands `AttentionList` the viewer, the deeplink's `mineRequest` and this phone's pending closes; office layouts show owners and the digest health line; the board reads once on mount and once per later focus, with the list and health line reloading only on the later ones; a project switch shows the spinner, never the previous project's rows. |
| `office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx` | **(As built, beyond the original list)** A `SITE_EVENT_DIGEST` tap switches Kelola ruangan back to the board and hands on Milik saya. |

## 9. Scope boundaries

**In:** the 105 evidence rule and its form; offline close in the capture queue; the 106
view, log, function, type and schedule; the Perlu ditindak list with Milik saya; the office
health line; the RoomBoard deeplink. **Out:** WhatsApp delivery; before and after photos in
the client report; restricting who may close; a per-project reminder time; Sunday
reminders; quiet-room reminders.

## 10. Release notes, paste order and phone rollout

1. Paste **105**, then **106**, in the Dashboard SQL editor, and run each self-check footer.
2. If 106 printed the pg_cron NOTICE, enable Cron once (Dashboard, Integrations → Cron) and
   paste 106 again; `SELECT jobname, schedule FROM cron.job;` must show `site_event_digest |
   0 0 * * 1-6`.
3. Deploy nothing else: no edge function, no secret.
4. Merge, then publish an OTA from main (channel `preview`). No native module is added
   (AsyncStorage, `expo-file-system`, `expo-network` are already in the binary), so an
   update suffices, not a build.
5. **Between step 1 and the OTA**, a phone on the old bundle that closes a `cacat`, `isu` or
   `hambatan` without a photo, or a `butuh_keputusan` with a note under ten characters, is
   refused and the event stays open. The old form shows the generic fallback, e.g. "Gagal
   menyimpan: SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian cacat hanya bisa ditandai selesai
   dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan." Old phones
   that attach a photo close normally, because the old client inserts the media row before
   the RPC. This is acceptable: the refusal is true and readable, and the OTA follows the merge.
6. **Re-paste hazards:** re-pasting 097 reverts 100 and 105 (re-paste 100, then 105);
   re-pasting 098 or 104 drops `SITE_EVENT_DIGEST` (re-paste 106).

## 11. Calibration items

| # | Item | Owner | Trigger |
|---|---|---|---|
| 1 | Principals on many active projects get one summary per project each morning. | User | Principals report the morning list as noise after two weeks. |
| 2 | Indonesian public holidays still get the Monday to Saturday run. | User | The first holiday morning with complaints. |
| 3 | The rule proves a closure photo exists, not what it shows or when it was taken. | PM on the pilot | A closure photo that turns out not to show the repair. |
| 4 | Live projects with no admin assigned (Citraland today) send the office summary only to the principal. | User | An admin expects a summary and gets none: assign them to the project. |
