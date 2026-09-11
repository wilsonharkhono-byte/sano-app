# Room-based Site Events & Finishing-phase Blueprint (SANO × DATUM), release 1

> Give SANO a spatial identity layer (rooms with QR labels), a Site Event capture
> loop (photos + Indonesian voice + text analysed jointly by AI into a draft a
> human confirms), owner and due date on every actionable item, a PM-facing
> "Papan Ruangan" board, and a Finishing-phase mode of the client Blueprint
> report grouped by room.

**Date:** 2026-09-10. **Status:** approved direction, pending implementation
plan. **Source brief:** `/Users/carissatjondro/Dropbox/AI/SANO_DATUM_AI_Site_Execution_Brief.md`.
**Sibling system:** DATUM Studio Brain, a separate Supabase project and repo.

---

## 1. Goal

SANO already owns the commercial and operational spine: baseline, material
requests, usage, approvals, progress entries, defects, Catatan Perubahan, the
client Blueprint report. What it lacks is a **spatial identity layer**. Progress
is recorded against BoQ rows and work groups, never against "Kamar Mandi Utama,
Lt. 2". Because there is no room, there is also no continuous action loop: a
photo is filed, a defect is listed, and nothing carries an owner, a due date or a
closure state tied to a place a supervisor can stand in.

Release 1 adds exactly that loop: rooms as first-class records with printable QR
labels; a scan-photo-speak-send capture under 60 seconds; one edge function that
transcribes the audio and analyses photos plus transcript plus room and gate
context **together** into a structured draft; a one-step human confirm that is
the only writer of human-facing fields; one accountable owner and a due date on
every actionable event, enforced by the database; a "Papan Ruangan" board showing
which rooms are blocked, overdue or quiet; and a Finishing-phase mode of the
client report that groups field updates by room.

DATUM stays the design, decision and rule brain. SANO references DATUM's
area×gate concept (same codes, same shapes, same normalizer) but **never
computes a readiness verdict and never duplicates gate logic**. Release 1 does
not talk to DATUM over the network at all; it only adopts DATUM's shapes so that
a later link is an upsert rather than a migration.

### 1.1 Truth-correctness contract (adapted from CLAUDE.md §12)

CLAUDE.md §12 states the user's contract: "the truth to be correct. i don't want
claude to make up stuff to get the number." Applied to site events, that becomes
six non-negotiable rules.

| # | Rule | Enforcement |
|---|---|---|
| 1 | AI writes **only** `ai_draft`, `transcript`, their `ai_*` companions (`ai_confidence`, `ai_model`, `ai_mismatch`), the pipeline bookkeeping (`status` from `pending_analysis` to `draft`, `last_error`, `analysis_attempts`), and the run audit rows. | Those columns are writable by the service role alone, inside the edge function. A `BEFORE UPDATE` trigger rejects an authenticated user changing the AI columns; the bookkeeping columns are the function's, and the app only ever moves `status` onward from `draft`. |
| 2 | Every human-facing field (`event_type`, `gate_code`, `title`, `summary`, `owner_id`, `due_date`, `is_blocking`, `vo_flag`) is written by the **confirm step**, never by the analysis stage. | `confirm_site_event` is the only path that sets them; the edge function never touches them. |
| 3 | Raw media is never deleted. | No delete policy on `site_event_media`; "Buang" sets `status = 'discarded'` and keeps the row and the files. |
| 4 | Evidence quotes must be **literal substrings** of the transcript or the typed note, or they are dropped. | Pure validator, case-insensitive and whitespace-normalized comparison. A VO suggestion whose quotes all drop is downgraded to `none` with the reason recorded in `ai_draft`. |
| 5 | The AI never estimates cost. | The system prompt forbids it; the output schema has no cost field; the validator drops unknown keys. |
| 6 | Confidence drives the UI, not the database. | See the table below. Low confidence leaves the field blank for the supervisor rather than guessing on their behalf. |

Confidence to UI mapping:

| Confidence | Type and gate chips | VO checkbox | Banner |
|---|---|---|---|
| `high` | Pre-filled | Pre-checked when the model suggested VO | None |
| `medium` | Pre-filled, marked "Periksa" | Present, unchecked | "Periksa hasil AI sebelum konfirmasi." |
| `low` | Left empty, AI guess shown as a grey hint chip the supervisor may tap | Hidden entirely | "AI kurang yakin. Pilih jenis dan gerbang sendiri." |

The client report renderer is protected structurally rather than by policy: its
input type carries only curated text, a room label and a gate label. It has no
fields for owner, due date, flags, event types or confidence, so an internal
value cannot leak into a client PDF even by mistake.

Release 1 is capture plus report. The full in-and-out list is §15; the deferred
items are designed but not built in §17.

---

## 2. Locked decisions

| # | Decision | Choice and rationale |
|---|---|---|
| 1 | Release boundary | Capture plus report. Nudges, mandatory closure evidence and DATUM escalation are release 2. Rationale: brief §11.12, a credible dataset before any automation on top of it. |
| 2 | Room authorship | Rooms are authored **in SANO**, in **DATUM's shape**. `room_code` uses DATUM's normalizer verbatim; `area_type` uses DATUM's 9 values; `datum_area_id` is reserved and stays NULL. Join key is project code plus room code. Codes freeze once a QR is printed; names, floor and type stay editable. After a future link DATUM owns the definition (SANO shows "Kelola di DATUM" read-only) while SANO keeps QR and events. Escape hatch: export rooms in DATUM area shape. |
| 3 | Gates are **data, not code** | `gate_refs` and `gate_step_refs` mirror DATUM's `gates` (code A to H) and `trade_steps` (text code, gate code). Events carry `gate_code` plus optional `step_code` as foreign keys. Codes are never deleted or reused; an `active` flag retires them; labels, descriptions and sort order are editable from an office screen "Kelola gerbang", with the same rules enforced in SQL. The edge function loads the active rows into the prompt and the validator accepts only codes from that list. Release 2 can pull DATUM's lists as a plain upsert keyed on `datum_gate_code` / `datum_step_code`. |
| 4 | New table, existing Catatan Perubahan untouched | Site events live in a new `site_events` table. A confirmed VO hand-off creates a **pending** `site_changes` row through one atomic RPC. `site_changes` (migration 022) is otherwise unchanged. |
| 5 | Owner identity | Owner is a SANO project team member (`profiles` reached through `project_assignments`). No contacts directory in release 1, so no subcontractor accounts and no external owners. |
| 6 | Transcription | Cloud, OpenAI `gpt-4o-mini-transcribe` (roughly USD 0.003 per minute), language locked to Indonesian (`id`), with a vocabulary prompt of site terms. Called by plain `fetch` from the edge function. Raw audio is always stored first. On-device live captions, if ever added, are cosmetic and never become the stored transcript. The Claude API accepts no audio input (verified September 2026), so a separate STT provider is required. |
| 7 | Offline | Native gets a local draft queue. Web gets save-and-retry only, stated plainly in the UI. |
| 8 | Client Blueprint | A Finishing mode: section "01 Update Lapangan" grouped by room, masthead kicker "Laporan Mingguan · Fase Finishing", and an "Area Umum" bucket. The renderer switches on `projects.phase`. |
| 9 | Internal view | "Papan Ruangan": room cards grouped by floor. |
| 10 | Pipeline | Client-orchestrated, one idempotent edge function `site-event-analyze`, following the shape of `supabase/functions/ai-draft-milestones/` (pure `validate.ts` next to `index.ts`, plus an audit table). |
| 11 | Analysis model | `claude-sonnet-5` by default, overridable with `SITE_EVENT_MODEL`. Image input. `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` live in Supabase secrets only. |

---

## 3. Architecture

```
┌──────────────────────┐  media  ┌────────────────────────────────────────────┐
│ PHONE: scan QR       ├────────►│ Storage  site-events/{projectId}/{eventId} │
│ foto konteks (wajib) │         └────────────────────────────────────────────┘
│ + close-ups ≤5       │  insert (client uuid, ON CONFLICT DO NOTHING)
│ + suara ≤90 s        ├────────►┌────────────────────────────────────────────┐
│ + catatan · "Kirim"  │         │ site_events  status = pending_analysis     │
└──────────┬───────────┘         │ site_event_media                           │
           │ tools/captureQueue  └──────────────────┬─────────────────────────┘
           │ queued → uploading →                   │ invoke
           │ analyzing → draft_ready                ▼
           │      ┌────────────────────────────────────────────────────────────┐
           │      │ EDGE site-event-analyze  (JWT + membership → service role) │
           │      │  1 STT    OpenAI gpt-4o-mini-transcribe, lang id           │
           │      │  2 Claude claude-sonnet-5, photos + text analysed together │
           │      │  3 validate.ts (pure, Deno-tested)                         │
           │      │  writes transcript · ai_draft · ai_confidence              │
           │      │  audit  site_event_ai_runs                                 │
           │      └──────────────────────┬─────────────────────────────────────┘
           ▼                             │ draft
┌──────────────────────┐◄────────────────┘
│ Layar Konfirmasi     │  RPC confirm_site_event (SECURITY DEFINER)
│ jenis · gerbang ·    ├──────►┌──────────────────────────────────────────────┐
│ judul · pemilik ·    │       │ human fields + status open + confirmed_at    │
│ tenggat · VO ·terkait│       │ site_changes pending row when VO confirmed   │
└──────────────────────┘       │ SITE_EVENT_ASSIGNED when owner ≠ reporter    │
                               └───────────────────┬──────────────────────────┘
      ┌────────────────────────────────────────────┼──────────────────────────┐
      ▼                                            ▼                          ▼
┌───────────────┐   ┌──────────────────────────────┐   ┌───────────────────────┐
│ Papan Ruangan │   │ Daily Site Log               │   │ Blueprint renderer    │
│ v_room_board  │   │ "Tarik dari kejadian"        │   │ STRUKTUR = unchanged  │
│ cards by floor│   │ room_id/gate_code/source_id  │   │ FINISHING = by room   │
└───────────────┘   └──────────────────────────────┘   └───────────────────────┘

 DATUM (ref nsmyazmxwdvwtdtqjrpx; SANO is ufntlqvacjhmddwltcxf) sits beside this
 as a dashed release-2 edge only: read areas/gates/area_gate_status over
 PostgREST, write POST /api/integrations/sano/escalate. No call in release 1.
```

---

## 4. Data model

Three idempotent migrations, `096`, `097`, `098`. Highest existing is
`supabase/migrations/095_add_project_material_line.sql`. Per repo convention the
remote migration history is divergent and `supabase db push` is broken, so these
are pasted into the Supabase Dashboard SQL editor and must be re-paste safe:
`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`
before every `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, and `DO $$ ... $$`
guards for constraint swaps.

### 4.1 Migration 096 `096_rooms_gates_phase.sql`

#### `projects` additions

| Column | Type | Notes |
|---|---|---|
| `phase` | `TEXT NOT NULL DEFAULT 'STRUKTUR'` | `CHECK (phase IN ('STRUKTUR','FINISHING','SERAH_TERIMA'))`. Drives the Blueprint renderer switch. Every existing project defaults to `STRUKTUR`, so nothing changes for them. |
| `datum_project_code` | `TEXT NULL` | Reserved for the release-2 link. `projects.code` (`001_core_tables.sql:49`, unique) remains the SANO-side join key. |

#### `rooms` additions

`rooms` already exists (`supabase/migrations/035_whatsapp_intelligence.sql:40-52`)
with `id`, `project_id`, `room_code`, `room_name`, `floor`, `area_sqm`,
`created_at`, a unique index on `(project_id, room_code)` where the code is not
null, and RLS at `035:267-274`. Release 1 extends it.

| Column | Type | Notes |
|---|---|---|
| `area_type` | `TEXT NOT NULL DEFAULT 'general'` | `CHECK` over DATUM's nine values: `bathroom`, `kitchen`, `bedroom`, `living`, `dining`, `garden`, `circulation`, `utility`, `general` (DATUM `packages/core/src/areas/mutations.ts:7-16`). |
| `sort_order` | `INT NOT NULL DEFAULT 0` | Display order inside a floor. |
| `datum_area_id` | `UUID NULL` | Set only by a release-2 sync. |
| `qr_printed_at` | `TIMESTAMPTZ NULL` | Stamped when a label sheet is printed. |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | Retire a room without deleting its history. |
| `created_by` | `UUID NULL` | References `profiles(id)`. |

Two guards. First,
`CHECK (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40)`,
added `NOT VALID` and validated **only when no violating row exists**, so a
re-paste against legacy 035-era codes reports the violation instead of failing
the whole script. Second, trigger `rooms_freeze_code` rejects a `room_code`
change when `qr_printed_at IS NOT NULL`: a printed label is a physical object and
the code behind it cannot move. The freeze also covers `project_id`, since the
label is `/r/{projectCode}/{roomCode}` (§8), and it refuses clearing the stamp.
The trigger runs `BEFORE UPDATE`, so an UPDATE that stamps `qr_printed_at` (a
first print or a reprint) records `now()`, not the client's clock. A room
inserted already stamped keeps the inserted value; the app never inserts one
(`createRoom` does not send the column).

`room_code` is produced client-side by `normalizeRoomCode`, a verbatim port of
DATUM's `normalizeAreaCode` (`packages/core/src/areas/extract.ts:100-109`): trim,
uppercase, whitespace to `-`, strip anything outside `[A-Z0-9-]`, collapse
repeated dashes, trim leading and trailing dashes, slice to 40 characters.

Every project gets an **"Area Umum"** room, code `UMUM`, `area_type` `general`,
created **by the app on first room setup**, not by a database trigger. A trigger
would fire for every historical project and every test fixture; the app creates
it where a human can see it happen.

#### `gate_refs`

| Column | Type | Notes |
|---|---|---|
| `code` | `TEXT PRIMARY KEY` | `A` through `H`, matching DATUM's `gate_code` enum (`packages/db/supabase/migrations/20260531000001_core_schema.sql:107`). |
| `name_id`, `short_label` | `TEXT NOT NULL` | Indonesian full name, and the chip label. |
| `description` | `TEXT` | Fed to the prompt so the model can pick a gate on meaning, not on a bare letter. |
| `sort_order`, `active` | `INT NOT NULL DEFAULT 0`, `BOOLEAN NOT NULL DEFAULT true` | Order, and retirement without deletion. |
| `datum_gate_code` | `TEXT NULL` | Release-2 link key. |

Seeded with `ON CONFLICT (code) DO NOTHING` so a re-paste never overwrites an
edited label:

| Code | `name_id` | `short_label` |
|---|---|---|
| A | MEP Rough-in | MEP Rough-in |
| B | Pekerjaan Basah / Waterproofing | Basah |
| C | Plafon | Plafon |
| D | Finishing Lantai / Dinding / Kusen | Finishing |
| E | Finishing Permukaan & Ironwork | Permukaan |
| F | Furniture Built-in | Furniture |
| G | MEP Fit-out | Fit-out |
| H | Penyelesaian Akhir & Serah Terima | Serah Terima |

#### `gate_step_refs`

Same shape one level down, matching DATUM `trade_steps`
(`packages/db/supabase/migrations/20260620000001_trade_steps_schema.sql:11-22`):
`code TEXT PRIMARY KEY` (free text, not a letter),
`gate_code TEXT NOT NULL REFERENCES gate_refs(code)`, `name_id`, `description`,
`sort_order`, `active`, `datum_step_code`, plus `UNIQUE (gate_code, code)`.
`code` alone is already unique; the pair exists because `site_events` points at
a step through `(gate_code, step_code)` (§4.2), and a foreign key needs a unique
constraint on exactly its columns. Ships **empty**: steps are optional detail,
and a pilot that never fills this table still works because
`site_events.step_code` is nullable.

Both reference tables carry a trigger that forbids `DELETE` and forbids updating
`code`; a step's `gate_code` is immutable like its `code`. RLS: any
authenticated user may read; office roles may write.

### 4.2 Migration 097 `097_site_events.sql`

#### `site_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | No default expression is relied on: the client generates it so the offline queue is idempotent. |
| `project_id` | `UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE` | |
| `room_id` | `UUID NOT NULL REFERENCES rooms(id)` | Not null by design: an event without a place is the thing this feature exists to remove. |
| `reporter_id` | `UUID NOT NULL REFERENCES profiles(id)` | |
| `status` | `TEXT NOT NULL` | `CHECK IN ('pending_analysis','draft','open','done','discarded')`. |
| `event_type` | `TEXT NULL` | `CHECK IN ('progres','isu','hambatan','cacat','butuh_keputusan','info')`. Null until confirm. |
| `gate_code`, `step_code` | `TEXT NULL` | `gate_code` FK to `gate_refs(code)`; `(gate_code, step_code)` composite FK to `gate_step_refs(gate_code, code)`. The composite foreign key uses the default `MATCH SIMPLE`, so it is not checked when either `gate_code` or `step_code` is NULL; the `CHECK (step_code IS NULL OR gate_code IS NOT NULL)` blocks a step without a gate; together they guarantee an event never carries a step from a different gate. |
| `title`, `summary` | `TEXT NULL` | Max 80 and 300 characters, enforced by the validator and the form. |
| `raw_text` | `TEXT NULL` | The supervisor's typed note as sent. |
| `transcript` | `TEXT NULL` | Service role only. |
| `transcript_edited` | `TEXT NULL` | Supervisor's correction; wins over `transcript` on re-analysis and in quote matching. |
| `ai_draft` | `JSONB NULL` | Service role only. The full validated draft plus the drop reasons. |
| `ai_confidence` | `TEXT NULL` | `CHECK IN ('high','medium','low')`. Service role only. |
| `ai_mismatch`, `ai_model` | `BOOLEAN NOT NULL DEFAULT false`, `TEXT NULL` | Photo and voice appear to disagree; the exact model id used. |
| `ai_used` | `BOOLEAN NOT NULL DEFAULT true` | Set false when the supervisor authored the event by hand after three failed analyses. |
| `owner_id`, `due_date` | `UUID NULL REFERENCES profiles(id)`, `DATE NULL` | The accountable pair guarded below. |
| `downstream_impact`, `is_blocking` | `TEXT NULL`, `BOOLEAN NOT NULL DEFAULT false` | What is blocked if this is not resolved, and whether it blocks at all. |
| `vo_flag`, `site_change_id` | `TEXT NOT NULL DEFAULT 'none'`, `UUID NULL REFERENCES site_changes(id)` | `CHECK (vo_flag IN ('none','suggested','confirmed','rejected'))`; the id is the Catatan Perubahan row created on VO confirm. |
| `related_event_id` | `UUID NULL REFERENCES site_events(id)` | Self reference, set by the human via "Tautkan". |
| `captured_at`, `created_at`, `confirmed_at` | `TIMESTAMPTZ` | Captured on the phone, landed in the database, confirmed by a human. The first two are `NOT NULL`; only `created_at` defaults to `now()`. |
| `closed_at`, `closed_by`, `closure_note` | `TIMESTAMPTZ`, `UUID`, `TEXT` | |
| `last_error`, `analysis_attempts` | `TEXT NULL`, `INT NOT NULL DEFAULT 0` | The most recent analysis failure, shown to the supervisor, and the retry counter. |

Indexes: `(project_id, room_id, status)`; `(project_id, due_date) WHERE status = 'open'`;
`(owner_id) WHERE status = 'open'`.

#### `site_event_media`

| Column | Type | Notes |
|---|---|---|
| `id`, `event_id` | `UUID` | `id` is client-generated, like the event's; `event_id` is `NOT NULL REFERENCES site_events(id) ON DELETE CASCADE`. |
| `kind`, `role` | `TEXT NOT NULL` | `CHECK (kind IN ('photo','audio','video'))` and `CHECK (role IN ('context','closeup','closure','audio'))`. |
| `storage_path`, `mime_type` | `TEXT` | Path is `NOT NULL`. |
| `duration_s`, `bytes` | `NUMERIC`, `BIGINT` | Duration for audio and video only. |
| `sort_order`, `captured_at` | `INT NOT NULL DEFAULT 0`, `TIMESTAMPTZ` | |

Storage path is `site-events/{projectId}/{eventId}/`, in the existing `photos`
bucket (`tools/storage.ts:8`) **if that bucket accepts `audio/mp4`**, otherwise
in a new private bucket `site-media` with per-project path RLS in the style of
`supabase/migrations/006_project_files_bucket.sql:30-45` (`split_part(name, '/', N)`
prefix matching). Which branch applies is settled in the plan's first task, §18.
Compression reuses the preset at `tools/storage.ts:10-11` (1280 px long edge,
JPEG 0.55); audio is AAC in an M4A container, mono, roughly 64 kbps, via
`expo-audio`. `expo-av` is deprecated and is not used.

#### `site_event_ai_runs`

Modelled on `ai_draft_runs` (`supabase/migrations/029_jadwal_authoring.sql:25-39`).

| Column | Type | Notes |
|---|---|---|
| `id`, `event_id` | `UUID` | PK defaults to `gen_random_uuid()`; `event_id` is `NOT NULL REFERENCES site_events(id) ON DELETE CASCADE`. |
| `stage`, `model`, `prompt_hash` | `TEXT NOT NULL` | `CHECK (stage IN ('transcribe','analyze'))`. |
| `input_summary` | `JSONB NOT NULL` | Photo count, transcript length, gate list size. Never the media itself. |
| `output` | `JSONB` | Raw model output before validation, so a rejection is diagnosable. |
| `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms` | `INT`, `INT`, `NUMERIC`, `INT` | Spend and timing for the `ai_usage_summary` report. |
| `status`, `error` | `TEXT` | `CHECK (status IN ('ok','rejected','error'))`. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

#### Guards (triggers)

| Guard | Rule |
|---|---|
| `site_events_actionable_needs_owner` | On transition to `status = 'open'` with `event_type IN ('isu','hambatan','cacat','butuh_keputusan')`, both `owner_id` and `due_date` must be non-null. This is brief §11.4 made structural rather than advisory. |
| `site_events_vo_needs_change` | `vo_flag = 'confirmed'` requires `site_change_id IS NOT NULL`. A confirmed commercial flag with no Catatan Perubahan row behind it is a number with no paper. |
| `site_events_ai_columns_service_only` | `BEFORE UPDATE`: if `auth.role()` is not `service_role` and any of `ai_draft`, `transcript`, `ai_confidence`, `ai_model`, `ai_mismatch` changed, raise. Column-level policies cannot express "these columns, but only for this role, on an otherwise member-writable row", so a trigger comparing old and new is the mechanism. `transcript_edited` is deliberately outside the set: that one is the human's. |

#### RPC `confirm_site_event`

```
confirm_site_event(p_event_id uuid, p_event_type text, p_gate_code text,
  p_step_code text, p_title text, p_summary text, p_owner_id uuid,
  p_due_date date, p_downstream_impact text, p_is_blocking boolean,
  p_vo_confirm boolean, p_related_event_id uuid, p_transcript_edited text)
returns jsonb
```

`SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC`,
`GRANT EXECUTE ... TO authenticated, service_role`. Behaviour in order:

1. Membership check on the event's project. A non-member is refused.
2. When `p_vo_confirm` is true, insert a `site_changes` row
   (`022_site_changes.sql:13-48`) and keep its id:
   `location` = `room_name || ' · ' || floor`; `description` = `p_summary` plus a
   transcript excerpt; `photo_urls` = the event's photo paths; `decision` =
   `'pending'`; `needs_owner_approval` = `true`; `reported_by` = the event's
   `reporter_id`; and `change_type` mapped as `butuh_keputusan` with
   owner-request evidence to `permintaan_owner`, design evidence to
   `revisi_desain`, everything else to `kondisi_lapangan`. The estimator still
   prices it in the existing Catatan Perubahan review flow; nothing about cost is
   set here.
3. Write the human fields, `status = 'open'`, `confirmed_at = now()`,
   `vo_flag = 'confirmed'` or `'rejected'`, `site_change_id`.
4. When `owner_id` is present and differs from `reporter_id`, call
   `enqueue_notification_user` (`supabase/migrations/092_notification_relevance.sql:100-115`)
   with type `SITE_EVENT_ASSIGNED`, `deeplink_screen = 'SiteEventDetail'`,
   `deeplink_params = {eventId, projectId}`. Wrapped so a notification failure
   never rolls back the confirm; the returned jsonb reports `notified`.

#### RLS

Members of the project read, insert and update `site_events` and
`site_event_media`; office roles reach all projects. The pattern is the
`is_project_member(project_id) OR is_office_role()` shape used by
`050_client_progress_report.sql` and `051_client_report_office_access.sql`, with
the helpers inlined defensively exactly as 050 does at `:85-98`.
`site_event_ai_runs` is readable by office roles and by the event's reporter;
inserts are service role only.

#### View `v_room_board`

`security_invoker` so the caller's RLS applies. One row per room, carrying: open
counts per `event_type` (`open_progres`, `open_isu`, `open_hambatan`,
`open_cacat`, `open_butuh_keputusan`, `open_info`); `overdue_count`
(`due_date < current_date AND status = 'open'`); `last_event_at` (most recent
`confirmed_at`); `last_gate_code` and `last_step_code` from that same event;
`is_quiet` (no confirmed event in 3 days); and `owner_initials`, the distinct
initials of owners on open events.

### 4.3 Migration 098 `098_daily_log_room_link.sql`

| Table | Added columns |
|---|---|
| `daily_log_highlights` (`050_client_progress_report.sql`) | `room_id UUID NULL REFERENCES rooms(id)`, `gate_code TEXT NULL REFERENCES gate_refs(code)`, `source_event_id UUID NULL REFERENCES site_events(id)` |
| `daily_log_photos` | `room_id UUID NULL REFERENCES rooms(id)`, `source_media_id UUID NULL REFERENCES site_event_media(id)` |

All nullable, so existing logs and the Struktur-phase report path are untouched.

`notifications.type` gains `SITE_EVENT_ASSIGNED` through the DO-block
drop-and-re-add swap at `supabase/migrations/088_approval_po_separation.sql:734-756`,
carrying forward the full existing list. This must land before any confirm can
run: the enqueue helpers swallow errors as warnings, so a type the CHECK rejects
would silently produce no notification at all.

`tools/notificationRouting.ts` gains a `SiteEventDetail` entry so the deeplink
resolves in all three navigators: `workflows/navigation.tsx`,
`office/navigation.tsx` and `office/PrincipalNavigation.tsx`.

---

## 5. Capture flow (supervisor, phone)

### 5.1 Enter the room

Three ways in, all landing on the same screen: a "Scan Ruangan" button on Beranda
and inside Progres opening the in-app scanner; the phone's own camera app reading
the QR, which deep-links into the same screen; and a room picker with search as
the fallback when a label is missing, damaged or not yet printed.

### 5.2 Capture

Header shows room name, floor and project phase, plus the titles of up to three
open events already in that room. That list is the release-1 duplicate
protection: the supervisor sees "Pipa AC menonjol di sisi jendela" before
reporting it again.

Elements: **Foto konteks** in the first slot, required, because brief §11.2 is
right that a close-up without context is meaningless a day later; up to 5
optional close-ups; **Suara**, hold to record, 90 second cap, live timer and
waveform, re-recordable; optional **Catatan** free text; a **Gerbang** chip row
defaulting to the room's last tagged gate; and **Kirim**, which enqueues and
returns to the previous screen immediately.

### 5.3 Draft arrives

The queue reports back into a "Draf menunggu" list on Beranda with a count. The
supervisor is never blocked waiting for AI.

### 5.4 Confirm

| Field | Behaviour |
|---|---|
| Jenis | Chip row over the six event types, pre-filled per the confidence table in §1.1 |
| Gerbang, langkah | Chips from the active `gate_refs` / `gate_step_refs` |
| Judul, ringkasan | Editable, 80 and 300 characters |
| Dampak lanjutan, menghambat pekerjaan lain | Free text pre-filled when the model produced one, plus a toggle |
| Pemilik | Defaults to the reporter for actionable types, so the field is never empty by accident. Picker lists the project team from `getProjectTeam` (`tools/projectManagement.ts:142`) |
| Tenggat | Date picker, pre-filled from `due_suggestion` when the model gave a relative one |
| VO | Checkbox, with the surviving quotes rendered beneath as `Dasar: "…"` |
| Ketidakcocokan | Amber banner when `ai_mismatch` is true, requiring an explicit acknowledgement tap before Konfirmasi enables |
| Mungkin terkait | `Mungkin terkait: <title>` with a "Tautkan" action, writing `related_event_id` |
| Transkrip | Expandable and editable; editing offers "Analisis ulang" |
| Konfirmasi | Calls `confirm_site_event` |
| Buang | Sets `status = 'discarded'`. Row and media are kept |

### 5.5 Close

"Selesai" on an open event: optional closure photo, optional note, writes
`closed_at`, `closed_by`, `closure_note`, `status = 'done'`. Closure evidence is
**offered, not required**, in release 1.

---

## 6. Edge function `site-event-analyze`

Location: `supabase/functions/site-event-analyze/` with `index.ts`, a pure
`validate.ts`, a `prompt.ts` and `glossary.ts` holding Indonesian site slang
("kenek", "bobok", "acian", "sparing", "nat") for both the transcriber and the
model. Layout follows `supabase/functions/ai-draft-milestones/` (`index.ts` plus
`validate.ts` plus `validate.test.ts`).

**Auth.** The caller's JWT is verified and project membership is checked before
anything runs; only then does the function use the service role client, as in
`ai-draft-milestones/index.ts:16-18`.

**Idempotency.** Transcription is skipped when `transcript` exists; analysis is
skipped when `ai_draft` exists, unless the request passes `force: true` (which
the "Analisis ulang" button sends). On a validated draft the function writes
`ai_draft`, `ai_confidence`, `ai_mismatch`, `ai_model`, clears `last_error`, and
moves `status` from `pending_analysis` to `draft`; that is the only status
transition the function performs, and a re-run on an already open event never
touches `status`.

**Stage 1, transcription.** Plain `fetch` to OpenAI's transcription endpoint with
`model=gpt-4o-mini-transcribe`, `language=id`, and the glossary as the vocabulary
prompt. The audio is read from Storage, where it was uploaded before the row was
even inserted, so a transcription failure never loses the recording.

**Stage 2, analysis.** `claude-sonnet-5` by default (`SITE_EVENT_MODEL`
overrides), called the way the repo already calls Claude from Deno:
`POST https://api.anthropic.com/v1/messages` with `x-api-key` and
`anthropic-version: 2023-06-01` (`ai-draft-milestones/index.ts:341-355`). Input:

| Input | Detail |
|---|---|
| System prompt | Indonesian. States the role (a junior PM assistant), the rules, and the explicit prohibition on estimating cost. |
| Room and project | Room name, floor and `area_type`; project name and `phase` |
| Gates and steps | Active rows with descriptions, loaded from the tables at call time |
| Typed note, transcript | `raw_text`, and `transcript_edited` when present, otherwise `transcript` |
| Photos | Up to 4, downscaled to 1024 px long edge, as base64 image blocks |
| Open events in the room | Up to 10, title plus id, for the related-event suggestion |
| Work-group names | Up to 30, from `classifyBoqWorkGroup` / `buildWorkGroups` (`tools/boqWorkGroups.ts:264,274`), as scope hints so the model uses the project's own vocabulary |

**Output schema.**

| Field | Type |
|---|---|
| `event_type` | one of the six |
| `gate_code`, `step_code` | codes from the supplied active list; `step_code` may be null |
| `title`, `summary` | Indonesian, at most 80 and 300 characters |
| `discipline` | free text (e.g. "AC", "Plafon", "Kusen") |
| `is_blocking`, `downstream_impact` | boolean, and text or null |
| `due_suggestion` | `{kind: 'relative' \| 'none', days: number}` |
| `vo` | `{flag: 'none' \| 'suggested', reason: string, evidence_quotes: string[]}` |
| `mismatch` | `{flag: boolean, reason: string \| null}` |
| `related_open_event_id` | an id from the supplied list, or null |
| `confidence` | `high` \| `medium` \| `low` |
| `evidence_quotes` | quotes backing the type and gate choice |

**Validation** lives in a pure `validate.ts` with its own Deno tests. It checks
enum membership for every enumerated field; requires `gate_code` and `step_code`
to appear in the active list passed in, dropping any code the model invented;
requires every quote to be a literal substring of the transcript or the typed
note, compared case-insensitively with whitespace collapsed, dropping the rest
with a reason; downgrades a `vo.flag = 'suggested'` whose quotes all dropped to
`none` with the reason recorded in `ai_draft`, because the model does not get to
assert a commercial claim it cannot point at; requires `related_open_event_id` to
be one of the ids supplied; clamps `title` and `summary` length; and drops
unknown keys. A rejection leaves `status = 'pending_analysis'`, writes
`last_error` and increments `analysis_attempts`; after three attempts the UI
offers manual authoring and sets `ai_used = false`.

**Cost guard.** A per-project daily cap, default 200 analysis calls, counted from
`site_event_ai_runs`, and at most 4 photos per call. Every call writes a run row
whether it succeeded or not, and the `ai_usage_summary` report
(`tools/reports.ts:909-928`, today reading only `ai_chat_log`) gains
`site_event_ai_runs` as a second source, so site-event spend surfaces where AI
spend is already reviewed.

---

## 7. Offline queue (native)

Two modules, so the logic is testable without a device: `tools/captureQueue.ts`
(a pure state machine, jest-tested) and `tools/captureQueueStore.ts` (the
AsyncStorage index plus `expo-file-system` copies of the media).

Entry shape: client uuid, `projectId`, `roomId`, `gateCode`, note,
`media[] {localUri, role, uploaded}`, `createdAt`, `state`, `attempts`,
`lastError`. States: `queued` to `uploading` to `analyzing` to `draft_ready` to
`done`, plus `failed` (retryable). Worker triggers: app foreground, network
regained (`expo-network`), and immediately after a capture.

Steps, each individually resumable: upload the media with one done-marker per
file, so a partial upload resumes rather than restarts; insert the `site_events`
row with the client-generated id and `ON CONFLICT DO NOTHING`, so a retry after a
lost response cannot duplicate; insert the media rows; invoke
`site-event-analyze`; mark `draft_ready` and delete the local copies **only after
the server confirms**.

Nothing is auto-discarded, ever. After 5 consecutive failed attempts the entry is
flagged for manual attention and stays put; the supervisor can retry it by hand
at any time. Beranda badge:
`Antrean: N menunggu sinyal, M draf siap dikonfirmasi`. Web is memory-only
save-and-retry and says so: `Di web, kiriman tidak tersimpan bila halaman
ditutup. Gunakan aplikasi Android di lapangan.`

---

## 8. QR labels and deep links

**URL.** `https://sano-app.vercel.app/r/{projectCode}/{roomCode}`, encoded in the
QR and also printed as readable text under it, so a human can type it when a
camera fails. **Label sheet:** an A4 sheet generated from "Kelola ruangan" using
the same `window.print()` export path as `tools/clientReportHtml.ts:360`.
Printing stamps `qr_printed_at` on the rooms included, but only after the user
confirms the print finished: the browser's print call returns the same way
whether the sheet printed or the dialog was cancelled, and a cancelled print
must not freeze the codes. Reprints are allowed and do not clear the stamp.

**Android App Links.** `app.json` gains `android.intentFilters` (action VIEW,
scheme https, host `sano-app.vercel.app`, `pathPrefix: "/r"`, `autoVerify: true`)
and a top-level `scheme: "sano"`. `public/.well-known/assetlinks.json` carries
package `com.sancontractor.supervisor` (`app.json` android.package) and the
SHA-256 signing fingerprint from `eas credentials`. `vercel.json` gains a header
setting `Content-Type: application/json` for that path. Its existing catch-all
rewrite (`vercel.json` rewrites, source `/(.*)`) is not a hazard: Vercel reserves
`/.well-known` and never rewrites it, and the filesystem wins over rewrites.

**Routing.** React Navigation `linking` config on all three containers:
`workflows/navigation.tsx` (`NavigationContainer` at `:63`) resolves `/r/...` to
the capture screen; `office/navigation.tsx` and `office/PrincipalNavigation.tsx`
resolve it to a read-only RoomDetail. A cold start before login holds the URL and
applies it after sign-in. Refusals are explicit, never a silent no-op: an
unassigned project gives `Anda tidak ditugaskan ke proyek ini.`, an inactive room
gives `Ruangan ini sudah tidak aktif. Hubungi kantor.`, and anything that is not
a SANO room URL gives `QR bukan label ruangan SANO.`

**In-app scanner.** `expo-camera` `CameraView` with
`barcodeScannerSettings={{barcodeTypes: ['qr']}}`, accepting only SANO room URLs.
The scanner screen unmounts when it loses focus and resets its scan lock on
focus, so repeated scans in one shift work and the camera never runs in the
background.

**New dependencies:** `expo-camera`, `expo-linking`, `expo-audio`,
`expo-network`, `react-native-qrcode-svg` (its peer `react-native-svg` 15.12.1 is
already present, `package.json:52`). These are native modules, so they need a new
APK build on the EAS channel `preview` (`eas.json:12`). Later JS-only fixes ship
via `eas update --branch preview`.

---

## 9. Papan Ruangan

A "Ruangan" tab for admin and estimator (`office/navigation.tsx`) and for
principal (`office/PrincipalNavigation.tsx`); supervisors get the same data in a
phone layout reached from Progres. **Summary strip:** open hambatan, overdue,
butuh keputusan, and rooms quiet for more than 3 days.

**Room cards, grouped by floor:** room name, last gate and step chip, open counts
by type, owner initials, age of last update, overdue badge. Floors sort in
ascending order and rooms without a floor, Area Umum included, group last, the
same order the report uses in §10.2, so the board and the client report never
disagree about where a room sits. Quiet cards render
grey, which is the visual answer to "which rooms have had no update recently".
**Filters:** floor, event type, owner, overdue only.

**Room timeline:** events newest first with thumbnails, transcript expandable,
actions: "Selesai"; edit owner and due date (office roles and the reporter); open
the linked Catatan Perubahan when one exists.

**Office sub-screens:** "Kelola ruangan" creates rooms, pastes a list from a
sheet, prints QR labels and exports rooms in DATUM area shape. "Kelola gerbang"
edits gate and step labels, descriptions, order and the active flag, and adds a
new step under a gate (code, name, description, order); codes are neither
editable nor deletable. Adding a new gate code is a row insert in the
Dashboard in release 1; the app picks it up on the next load. Project phase is set from the same office area.

Board data comes from `v_room_board`; the timeline reads `site_events` directly.

---

## 10. Blueprint changes

### 10.1 Daily Site Log

`workflows/screens/DailyLogScreen.tsx` and `tools/dailySiteLogs.ts` gain
**"Tarik dari kejadian ruangan"**. It proposes highlight lines from that day's
confirmed events: `progres` and `info` are listed and pre-selected, while `isu`,
`hambatan`, `cacat` and `butuh_keputusan` are listed unchecked with a note that
they need client-safe rewording first.

Pulled lines carry `room_id`, `gate_code` and `source_event_id`, and context
photos are offered with their room label. The curator edits or approves
everything: the curated-draft model from the 2026-06-28 Blueprint spec is
unchanged, so nothing reaches a client report unread by a human.

### 10.2 Renderer

`tools/clientReport.ts` and `tools/clientReportHtml.ts` switch on
`projects.phase`. `STRUKTUR` produces byte-identical output to today, guarded by
a regression test on existing fixtures. `FINISHING` and `SERAH_TERIMA` group
section 01 by room, under these rules:

- Rooms ordered by floor, then `rooms.sort_order`. Group header reads
  `Kamar Mandi Utama · Lt. 2` with a gate chip such as `B · Basah`.
- Area Umum sorts last. Highlight lines with a null `room_id` fall into it, so
  nothing is ever dropped from the report for lack of a room.
- Photo legends read `Figur 3 · Kamar Mandi Utama`. Masthead kicker:
  `Laporan Mingguan · Fase Finishing` (or `Laporan Harian · Fase Finishing`).
- Weekly reports group the whole period's lines the same way.

`BLUEPRINT_CSS` (`tools/clientReportHtml.ts:47`) stays byte-identical, per the
verbatim-port contract in the 2026-06-28 spec §1.2; room grouping styles go in a
new additive block alongside `REPORT_MEDIA_CSS` (`:257`). The renderer input type
stays as narrow as §1.1 requires: curated text, a room label, a gate label, and
nothing else. The frozen `snapshot` on `client_progress_reports` gains the room
grouping and stays frozen: a re-issued report re-derives, an issued one does not.

---

## 11. Notifications

Release 1 adds exactly one type: `SITE_EVENT_ASSIGNED`, fired on confirm when the
owner differs from the reporter, delivered to the owner, reading
`Anda ditugaskan: <title> · <room>`, deeplinking to `SiteEventDetail` with params
`{eventId, projectId}`. No reminders, no digests, no overdue pings: those need a
scheduler and belong with the WhatsApp work in release 2. Brief §11.8 gives the
reason: a system that pings on every event teaches people to ignore it before it
has earned their attention.

---

## 12. Failure handling

| Failure | Behaviour |
|---|---|
| STT fails | Status stays `pending_analysis`, `last_error` set, UI shows `Transkripsi gagal.` with a retry. Analysis may still proceed on photos and typed text alone, at reduced confidence. |
| Analysis or validation fails 3 times | UI offers manual authoring; the event is written with `ai_used = false`. The supervisor is never stuck behind a model. |
| Mismatch flagged | Amber banner requiring an explicit acknowledgement before Konfirmasi enables. |
| Daily cost cap hit | New captures still save and queue; analysis is deferred with `Kuota analisis AI hari ini habis. Draf akan dibuat besok, atau isi manual.` |
| Foreign QR, inactive room, unassigned project | The three explicit refusals in §8. Never a silent no-op. |

---

## 13. Security

The edge function verifies the caller's JWT and project membership before any
work, and only then uses the service role. `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY` live in Supabase secrets, never in the bundle. CI holds no API
keys (`.github/workflows/ci.yml`) and tests never call either provider. Media is
private and reached through signed URLs, reusing the 7-day signed-URL cache in
`tools/storage.ts:12,115-119`. Nothing is deleted: there is no delete policy on
events or media, and discard is a status. `assetlinks.json` exposes only the
package name and the signing certificate fingerprint, which are public by design.

---

## 14. Testing

Jest, in `tools/__tests__/`:

| Test | Covers |
|---|---|
| `normalizeRoomCode` | Ported DATUM fixtures, including the 40-character slice and dash collapsing |
| `validateSiteEventDraft` | Quote substring matching, VO downgrade with reason, gate and step code list membership, clamps, unknown-key dropping |
| `captureQueue` | Every transition, idempotency of re-insert, retry accounting, no auto-discard |
| `groupHighlightsByRoom` plus the phase switch | Ordering by floor and `sort_order`, Area Umum last, null room fallback |
| `roomBoard` aggregates, VO to `site_changes` mapping | Counts by type, overdue, quiet threshold; the three `change_type` branches |
| Deep-link routing | `/r/{project}/{room}` across all three navigators, plus the three refusal paths |
| `migration096/097/098` static guards | In the style of `tools/__tests__/migration092.test.ts`: every CHECK present, `SECURITY DEFINER` and `SET search_path`, the freeze trigger, the AI-column trigger, the owner-and-due guard, REVOKE/GRANT lines, the notification type list carried forward intact |
| Blueprint regression | Byte-identical output for STRUKTUR fixtures, plus a new FINISHING fixture |

Deno tests beside the function: prompt assembly (the active gate list actually
reaches the prompt) and the validator.

Manual pilot checks, which no unit test can stand in for: print an A4 label sheet
and scan every code from a real phone at arm's length; verify the Android App
Link opens the app rather than the browser on a real device running the signed
APK; run STT over 20 real supervisor voice notes and read the transcripts; and
review AI draft acceptance plus VO suggestion precision with the user after week 1.

---

## 15. Scope boundaries

**In:** rooms with QR labels and deep links; site events with joint AI analysis;
confirm with one owner and a due date; closure with optional evidence; Papan
Ruangan; Daily Log pull-through; Finishing-phase Blueprint grouping; one
notification type; the offline queue on native.

**Out of release 1:** WhatsApp of any kind; a contacts or subcontractor
directory; mandatory closure evidence; reminders and any scheduler; DATUM network
calls in either direction; room sync; duplicate detection beyond showing the
room's open events; any prediction or pattern learning; iOS universal links
(custom scheme only until an Apple team is provisioned).

---

## 16. Rollout and pilot

Order: paste `096`, `097`, `098` in the Dashboard SQL editor (096 seeds the
gates); deploy `site-event-analyze` and set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
and optionally `SITE_EVENT_MODEL`; build the APK on EAS channel `preview` (new
native modules mean a build, not an update); host `assetlinks.json` and deploy
web; set the pilot project's `phase` to `FINISHING`; create the rooms including
`UMUM`; print and fix the labels.

**Pilot shape:** one finishing-phase project, 6 to 10 rooms, 2 to 3 supervisors.

**Metrics**, operational rather than model-centric, per brief §13:

| Metric | Target or purpose |
|---|---|
| Actionable events with an owner and due date | 100 percent, structurally guaranteed; measured to prove the guard holds |
| Capture time, and capture to confirm time | Under 60 seconds QR to Kirim; watch for a growing backlog of unconfirmed drafts |
| Median closure time, overdue rate | Baselines for release 2 |
| AI draft acceptance rate | Share of confirms where no AI-filled field was changed |
| VO suggestion precision, mismatch rate | Suggested and then confirmed over suggested; how often photo and voice disagree |
| Transcript edit rate | Proxy for STT quality; the trigger for §18 item 3 |

---

## 17. Release-2 hooks (design summary, not built)

**The DATUM seam.** SANO reads `areas`, `gates` and `area_gate_status` from DATUM
over PostgREST with a dedicated DATUM staff JWT, so DATUM's own RLS
(`current_can_read_project()`, `packages/db/supabase/migrations/20260531000002_rls_policies.sql:54`)
governs the read. Exactly **one** signal is referenced: `area_gate_status.status`
(`not_started`, `in_progress`, `ready_for_handoff`, `blocked`, `passed`,
`not_applicable`, per `packages/core/src/gates/readiness-rules.ts:8-11`), cached
with a short TTL and rendered as DATUM's own string. SANO never recomputes it and
never derives a verdict from it.

**Escalation.** A new DATUM route `POST /api/integrations/sano/escalate` behind a
bearer secret, in the style of DATUM's cron routes
(`apps/web/app/api/cron/readiness-reminders/route.ts`, `CRON_SECRET`). It
composes DATUM's existing `createCard`, `linkCardToArea` and `createCardEvent`,
and stores `{sano_event_id, sano_url}` in `cards.properties`. The card is
authored by a "SANO (sistem)" staff row. The breadcrumb is one-directional: DATUM
already has `punch_items.sano_work_item_ref`
(`packages/db/supabase/migrations/20260620000001_trade_steps_schema.sql:89`) and
its own 2026-06-20 spec ruled out two-way sync. An optional DATUM to SANO webhook
(for example "gate D passed, review the room's open events") copies the pattern
DATUM's main branch already runs for push fan-out:
`packages/db/supabase/migrations/20260820000001_push_fanout_webhook.sql`, a
`pg_net` statement-level trigger posting to a route with a bearer secret held in
the service-role-only table `push_webhook_config` (`:63`). Release 2 would add a
second trigger on `area_gate_status` and a receiving edge function on the SANO
side; SANO already documents the matching `net.http_post` shape at
`supabase/migrations/034_notifications.sql:24`.

**Room sync, "Sinkron ruangan".** Match on `(project_code, room_code)` and set
`datum_area_id`. SANO-only rooms are pushed through a DATUM route reusing its
area insert, which skips existing codes; DATUM-only areas are pulled; name
conflicts are shown as a diff for a human to confirm, never merged silently.
After the link DATUM owns the definition and SANO's room editor goes read-only
with "Kelola di DATUM".

**Subcontractor identity and WhatsApp.** DATUM refuses accounts to outsiders
through its `contacts` model, so escalations are authored by the SANO service
account with the human's name carried in the payload rather than impersonated.
DATUM uses the Meta WhatsApp Cloud API directly, two-way and live on its main
branch; SANO release 2 either provisions its own number or reuses DATUM's sender,
and adds a `project_contacts` directory. `profiles.whatsapp_number` already
exists (`035_whatsapp_intelligence.sql:30-35`).

---

## 18. Pilot calibration items

Every open question, with an owner and the trigger that forces a decision. None
of these blocks the build.

| # | Item | Owner | Trigger |
|---|---|---|---|
| 1 | **Evidence-quote behaviour.** How strict literal-substring matching feels in practice on real Indonesian speech, and whether near-miss quotes should be surfaced as "tidak terverifikasi" rather than dropped. The user asked to trial this together after the first real runs. | User plus Claude, jointly | First week of pilot events, reviewed together with the `ai_draft` drop reasons |
| 2 | **`photos` bucket MIME acceptance for audio.** If the bucket's `allowed_mime_types` rejects `audio/mp4`, a new private `site-media` bucket is created with per-project path RLS in the `006_project_files_bucket.sql` style. | Implementer, plan task 1 | Checked before migration 097 is written; the answer picks one of the two branches in §4.2 |
| 3 | **STT quality on real notes.** Swap `gpt-4o-mini-transcribe` for Deepgram nova-3 or ElevenLabs Scribe if word error rate on site vocabulary is too high. | User plus implementer | The 20-note manual check in §14, and the transcript edit rate metric |
| 4 | **Quiet-room threshold.** 3 days is a constant in `v_room_board`, not a setting. | PM on the pilot project | If the board shows most rooms quiet, or almost none, after two weeks |
| 5 | **Per-project daily AI cap.** Default 200 calls. | Implementer | If the cap is hit during the pilot, or if `site_event_ai_runs` shows spend well under it after a month |
| 6 | **iOS deep links.** Custom scheme `sano://` only in release 1. Universal links need an Apple Developer team, an `apple-app-site-association` file and an entitlement. | User | When an iOS build is actually requested by a supervisor or by the office |
| 7 | **Struktur-phase projects stay unaffected.** The byte-identical Blueprint regression test is the guard; it must be written before the renderer is touched, not after. | Implementer | Any change to `tools/clientReportHtml.ts` or `tools/clientReport.ts` |

---

*This spec covers release 1 only. The DATUM seam in §17 is designed so that
adopting it later is an upsert on `datum_area_id`, `datum_gate_code` and
`datum_step_code`, plus one outbound route. Nothing in release 1 needs to be
unwound to get there.*
