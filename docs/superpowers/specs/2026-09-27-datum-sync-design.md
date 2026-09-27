# DATUM sync: same gate words, linked rooms, DATUM readiness on the board, decisions escalated

> Release 2, second slice, of the room-based site event loop: SANO's eight gates take DATUM's
> words; a paired project links its rooms to DATUM areas by code and creates the missing ones;
> DATUM's area-by-gate readiness shows on Papan Ruangan exactly as DATUM states it; every
> confirmed "butuh keputusan" becomes one decision card in DATUM, once, authored by the person's
> own DATUM account when the names match; and a project DATUM mapped first can take its rooms.

**Date:** 2026-09-27, revised after the owner's review the same day. **Status:** approved design,
pending implementation plan.
**Builds on:** `docs/superpowers/specs/2026-09-10-room-site-events-design.md` §2 decisions 2-3,
§4.1, §17; `/Users/carissatjondro/Dropbox/AI/SANO_DATUM_AI_Site_Execution_Brief.md` §3, §8, §11.6;
`2026-09-26-closure-evidence-and-digest-design.md` §5.5 (the pg_cron guard).
**Repos:** SANO (`ufntlqvacjhmddwltcxf`), migration `107_datum_sync.sql` (highest on main:
`106_site_event_digest.sql`) and edge function `datum-sync`; DATUM (`nsmyazmxwdvwtdtqjrpx`), one
PR with five routes under `apps/web/app/api/integrations/sano/` and migration
`20260927000001_cards_sano_event_unique.sql` (highest on main: `20260926000001_card_event_member_alerts.sql`).

## 1. Goal

Release 1 shaped SANO rooms and gates like DATUM's but never talked to DATUM (2026-09-10 §1,
§15), and the shapes drifted: SANO's gate B reads "Waterproofing + kamar mandi" (101:69-73), DATUM's
"Pekerjaan Basah / Waterproofing" (`20260625000001_uniform_room_steps.sql:14`). A decision found on
site reaches the office only if someone retypes it into a DATUM card. This slice closes both gaps
with one SANO migration, one edge function, five DATUM routes and one DATUM index. The link stays
exception-driven (brief §8); SANO never computes a readiness verdict nor writes gate status (brief §3).

### 1.1 Truth contract, applied (CLAUDE.md §12)

| # | Rule | Enforcement |
|---|---|---|
| 1 | A readiness chip is DATUM's own word, never SANO's inference. | The cache stores `area_gate_status.status` verbatim (six values, CHECK); the board maps each to one fixed Indonesian label and shows the time SANO read it. No code path derives a status. |
| 2 | Old news is marked old, and missing news is never shown as "no news". | Older than 24 h: chips greyed with "lama". Never read: "Status DATUM belum tersinkron". A failed read: an error line. DATUM holding no row for a linked area: its own sentence. |
| 3 | A link is set only by the sync, and a person is linked only on an exact, unique name match. | `rooms.datum_area_id`, `site_events.datum_card_*`, `site_events.confirmed_by` and `profiles.datum_staff_id` refuse direct writes from app roles (§4.2-§4.4); ambiguous or missing names are listed, never guessed (§6.4). |
| 4 | Nothing is merged, renamed or deleted to make two lists agree. | POST areas never renames; DATUM-only areas and name, floor or type conflicts are listed as differences; DATUM rooms enter SANO only when an office user confirms the import; the sync deletes no row in either database. |
| 5 | A decision reaches DATUM once. | DATUM's unique index on `cards.properties->>'sano_event_id'` makes a repeat return the same card; SANO stores the id only after DATUM answered. |
| 6 | A failed step is recorded, never smoothed over. | Every run writes `datum_sync_runs` with per-step outcome, counts and the first error; the Rooms tab shows the failure as written. |

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | **SANO follows DATUM's gate words**, as DATUM stores them today, not as the June seed did: B is "Pekerjaan Basah / Waterproofing", not "Pekerjaan Kamar Mandi". | The owner's rule is "SANO follows DATUM". DATUM renamed B after the seed (`20260625000001:14`); its own `RulesViewer.tsx:41-50` still carries the old map and is DATUM's drift, not a source. |
| 2 | `short_label` is DATUM's own chip name, `GATE_SHORT_NAME` (`packages/core/src/gates/labels.ts:3-12`), not a new derivation. | DATUM already derives a short name from each gate name and shows it as `A · MEP Rough-in` (`labels.ts:14-17`); a second derivation in SANO would be a third vocabulary. |
| 3 | `gate-status` also returns DATUM's eight gate rows; the function reports any word that differs from `gate_refs`, and writes nothing to `gate_refs`. | 107 is a snapshot. The drift check keeps "SANO follows DATUM" true after it without a fifth route or a silent rewrite of office-edited labels. |
| 4 | DATUM routes authenticate with one shared bearer (constant-time) and read or write with DATUM's service-role client, every project query scoped by the `project_code` in the request. | DATUM's own crons and webhooks use the same shape (`apps/web/lib/cron/auth.ts:2-5`, `lib/supabase/admin.ts:10-21`). A DATUM staff JWT (2026-09-10 §17) would need a password-holding bot user and token refresh inside a SANO function. |
| 5 | Rooms are set up in SANO (code, name, floor, type, QR) and pushed to DATUM on create; DATUM stays the master of its own area rows. One exception: "Ambil {n} ruangan dari DATUM" imports DATUM-only areas once, on an office user's confirmation, after which SANO is the master again. | Owner's decision. A project DATUM mapped first (architect before site) must not be retyped. After the import a DATUM change to name, floor or type is a difference, never an overwrite. |
| 6 | Retired SANO rooms (`active = false`) are **linked** when DATUM already has their code and are **never created** in DATUM. | Linking is a read and keeps history joined; creating would add a room with seeded milestones (`packages/core/src/areas/mutations.ts:63-76`) that no one will work in. |
| 7 | "Area Umum" (`UMUM`) is created in DATUM with `tracked = false`. | Decisions filed there need an area to link to, and DATUM defines an untracked area as one that "still holds cards" but "carries no milestones and raises no signals" (`20260909000002:15-16`). |
| 8 | Escalation cards are authored by the DATUM staff linked to the event's reporter, else to its confirmer, else a "SANO (sistem)" staff row named by `SANO_INTEGRATION_STAFF_ID`; they go to the project's `UMUM` list, and carry one `decision` event with `status: 'needs_decision'` plus one `note` naming the people. | `cards.created_by_staff_id` and `card_events.logged_by_staff_id` are NOT NULL references to `staff`, whose id is an `auth.users` id (`20260531000001_core_schema.sql:21-22`, `20260601000001_cards_layer.sql:29,75`). Every board has `UMUM` (`20260822000001:42`, `20260822000002:30-33`). `needs_decision` is DATUM's open-decision state (`packages/types/src/event-kinds.ts:14-25`). |
| 9 | `sano_url` is the room link `https://sano-app.vercel.app/r/{projects.code}/{room_code}` (`tools/roomLinks.ts:4,17`). | SANO has no web route to one event; the room link opens the room timeline that lists it. |
| 10 | Steps run in order areas, link, create, gate-status, staff, escalate; a failed step skips only the steps that need its output. | A DATUM areas read that fails must not block the gate read or escalations for rooms already linked. |
| 11 | One run per project at a time, by a partial unique index; a run left unfinished for 10 minutes is closed as failed by the next one. | A button press during the hourly run must not double-create areas; an edge function that dies mid-run must not lock the project forever. |
| 12 | SANO profiles link to DATUM staff by normalized full name, set only on a unique exact match; staff matching is global and runs once in every sync. | Owner's decision ("similar staff name"). DATUM's `staff.full_name` is not unique (`20260531000001:23`; only `handle` is, `20260717000001:44`), so a match must be unique on both sides or it is not a match. |
| 13 | 107 stamps `site_events.confirmed_by` with a trigger, without touching `confirm_site_event`. | Nothing records who confirmed an event: 097 has no such column and `confirm_site_event` sets only `confirmed_at` (100:414). Redefining the RPC would join the 097/100 re-paste hazard; `auth.uid()` still names the caller inside the DEFINER RPC (100:189). |
| 14 | SANO room types widen to DATUM's thirteen `area_type` values, with DATUM's labels. | DATUM added `facade`, `terrace`, `hall`, `exterior` (`20260909000002:9-12`); an imported area of those types could otherwise only be stored under an invented type. |
| 15 | Pairing may be set by any office role (admin, principal, estimator), never a supervisor. **As built:** the owner extended this to "Sinkron DATUM" itself during review (§6.1), so sync, import and pairing share one office-role gate; calibration item 9 below is resolved. | Owner's decision. The same roles already write rooms (096:312-313) and update projects. |

**Where this supersedes 2026-09-10.** §2 decision 2 and §17 said DATUM would own room
definitions after the link and SANO's editor would go read-only ("Kelola di DATUM"): replaced
by decisions 5-6, and the editor stays as it is. §17's PostgREST read with a DATUM staff JWT:
replaced by decision 4. §17's "DATUM-only areas are pulled": replaced by "listed, and imported
once on confirmation" (decision 5). §17's "the human's name carried in the payload rather than
impersonated": kept for the note, while the author becomes the person's own DATUM account when
linked (decision 8). §17's optional DATUM-to-SANO webhook stays out (§12).

**As built, decision 5's create step.** `POST areas` also builds a new tracked area's gate
schedule the way DATUM's own add-room does — `ensureGateScheduleForArea` then
`writePlannedDates` (DATUM `apps/web/lib/integrations/sano/areas.ts`) — so DATUM may recompute
the project's gate windows off a room SANO created, the same side effect a human adding that room
in DATUM already causes. The "never update" promise narrows to what §1.1 rule 4 always meant:
DATUM's own code guarantees "an existing area or card is never updated or deleted"
(`areas.ts`). A schedule or seed step that fails after the insert does not fail the create; the
item comes back `created: true` with `warning: { code: 'SCHEDULE_FAILED' | 'SEED_FAILED',
reason }`, and SANO lists it under "Jadwal DATUM belum tersusun" (§8.1) rather than hiding it.

## 3. Same words (107, part 1)

107 runs eight `UPDATE gate_refs SET name_id, short_label, description, datum_gate_code = code
WHERE code = 'X'` statements, the 101 shape (101:63-109), with DATUM's values from
`20260531000003_seed_gates_and_checkpoints.sql:6-30` as amended by `20260625000001:14`:

| Code | `name_id` (DATUM `gates.name`) | `short_label` | `description` (verbatim) |
|---|---|---|---|
| A | MEP Rough-in + Persiapan Struktural | MEP Rough-in | Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing. |
| B | Pekerjaan Basah / Waterproofing | Pekerjaan Basah | Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup. |
| C | Plafon & Penutupan Selubung | Plafon | Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure. |
| D | Finishing Lantai, Dinding & Kusen Aluminium | Lantai & Kusen | Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium. |
| E | Finishing Permukaan + Ironwork | Cat & Ironwork | Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel. |
| F | Furniture Built-in & Interior | Furniture | Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out. |
| G | MEP Fit-out | MEP Fit-out | Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture. |
| H | Penyelesaian Akhir & Serah Terima | Serah Terima | Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list. |

- **History keeps its letter.** `site_events.gate_code`, `daily_log_highlights.gate_code` and
  `last_gate_code` on the board store letters, so every past event now reads under the new
  word; an event about kusen kayu filed as D ("Lantai + kusen") now sits under D "Kusen
  Aluminium". Issued client reports are frozen snapshots and keep the old words (2026-09-10
  §10.2). 107's result grid counts confirmed events per gate so the owner sees what moved.
- **Re-paste.** Like 101, a re-paste overwrites later "Kelola gerbang" edits; the header says so.
  Re-pasting 101 after 107 restores SANO's old words: the header says to re-paste 107 after it.
- **No code carries a gate name.** Every surface reads `gate_refs`: `gateChipLabel`
  (`tools/gateRefs.ts:120-123`), `tools/clientReportRooms.ts:28`, the capture list
  (`GateChipRow.tsx:37-61`) and the analysis prompt (`site-event-analyze/index.ts:518`,
  `prompt.ts:141`). Edits are comments and fixtures only: `GateChipRow.tsx:20-28` quotes
  "Waterproofing + kamar mandi" and becomes "Pekerjaan Basah"; `tools/__tests__/migration101.test.ts`
  keeps pinning 101's own text and gains nothing. DATUM's descriptions are shorter than 101's, and
  `GateChipRow` clamps to two lines anyway (`:55-61`).

## 4. Data model (107, part 2)

107 follows 106's conventions (`lock_timeout`, `IF NOT EXISTS`, drop before create, result grid,
SELF-CHECK). It creates no policy on `rooms`, `gate_refs` or `gate_step_refs` and touches none of
096's functions or triggers, which `migration096.test.ts:432-458` forbids; it redefines no 097,
099, 100 or 105 function, so re-pasting any of them reverts nothing in 107. Every new guard is
its own function and trigger in the shape of 097's rule-1 guard (097:261-304): bypass
`COALESCE(auth.role(), '') = 'service_role' OR current_user NOT IN ('authenticated', 'anon')`
(the function's PostgREST writes, DEFINER RPCs, the Dashboard), then INSERT requires the columns
NULL and UPDATE requires them unchanged, with `ERRCODE = 'insufficient_privilege'`.

### 4.1 Pairing: `projects.datum_project_code`

The column exists since 096 (096:130-131). 107 adds `CHECK (datum_project_code IS NULL OR
(datum_project_code = upper(btrim(datum_project_code)) AND datum_project_code <> ''))` inside a
`pg_constraint` guard, and `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_datum_project_code ON
projects (datum_project_code) WHERE datum_project_code IS NOT NULL`. DATUM stores codes upper
case and looks them up that way (`packages/core/src/projects/by-slug.ts:30-34`).

The app path is `set_datum_project_code(p_project_id UUID, p_code TEXT) RETURNS JSONB`, SECURITY
DEFINER, `SET search_path = public`, REVOKE from `PUBLIC, anon`, GRANT to `authenticated`:
refuses unless `is_office_role()` (admin, principal, estimator; 096:104-111) with
`DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator`, refuses an unknown project, stores
`NULLIF(upper(btrim(p_code)), '')`, maps a unique violation to `DATUM_PAIRING_TAKEN: kode DATUM
ini sudah dipakai proyek lain`, returns `{ code }`. No column trigger: direct UPDATEs of
`projects` are already limited to office roles (`projects_update_assigned`, 023:59-60, widened
to estimators by 037; `is_office_manager()`, 036:73-76), the same people decision 15 allows, and
the CHECK and index hold whichever path wrote the value.

### 4.2 `rooms`: sync-only link, DATUM's thirteen types

- **`datum_area_id` is sync-only.** `rooms_office_all` (096:312-313) lets every office role write
  any column. New trigger `rooms_datum_area_id_sync_only`, error `ROOM_DATUM_LINK_SYNC_ONLY:`. No
  app code writes it: `createRoom` omits it and `RoomPatch` excludes it (`tools/rooms.ts:147-150`).
- **Types.** A `DO` block drops `rooms_area_type_check` when its definition lacks `'exterior'` and
  re-adds it over DATUM's `AREA_TYPES` (`packages/core/src/areas/extract.ts:29-43`): the nine plus
  `facade`, `terrace`, `hall`, `exterior`. Existing rows are a subset, so it validates at once. A
  re-paste of 096 keeps the wide CHECK, since 096 adds it only when the name is absent
  (096:205-218). `tools/types.ts:58-65` already says a type may be added only after DATUM has
  it, which is the case. Client: `AreaType` (`tools/types.ts:63`) and `AREA_TYPES` / `AREA_TYPE_LABELS`
  (`tools/constants.ts:226-248`) gain DATUM's own labels "Fasad", "Teras / Balkon", "Hall / Lobi",
  "Area luar lain" (`apps/web/components/area-setup/AreaSetup.tsx:32-35`); `RoomForm.tsx:46` and
  the paste parser (`tools/rooms.ts:253-266`) read that list and need no other edit. **As built,**
  the paste parser also folds everyday synonyms to DATUM's four newer types: `teras`/`balkon` →
  `terrace`, `lobi`/`lobby` → `hall`, `luar` → `exterior` (`tools/rooms.ts:266-269`).

### 4.3 `site_events`: escalation columns and `confirmed_by`

`ADD COLUMN IF NOT EXISTS datum_card_id UUID`, `datum_card_url TEXT`, `datum_escalated_at
TIMESTAMPTZ`, `confirmed_by UUID REFERENCES profiles(id)`, plus `CREATE INDEX IF NOT EXISTS
idx_site_events_escalation_due ON site_events(project_id) WHERE status = 'open' AND event_type =
'butuh_keputusan' AND datum_card_id IS NULL`.

**The guard.** 097's human-fields guard lists its columns explicitly (097:347-370), so new
columns are writable by any member under `site_events_update` (097:450-452) and insertable under
`site_events_insert`. Extending that function in place would put it on the list a 097 re-paste
silently reverts (the 105 hazard, 2026-09-26 §3.2) and break its pinned shape in
`migration097.test.ts:294-305`. 107 adds `site_events_system_columns_guard` instead, BEFORE
INSERT OR UPDATE, error `SITE_EVENT_SYSTEM_COLUMNS: kolom ini hanya diisi oleh sistem`, covering
the three `datum_*` columns and `confirmed_by`. Its first statement, before the bypass, is the
stamp: `IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN
NEW.confirmed_by := auth.uid(); END IF;`. `confirmed_at` moves only inside `confirm_site_event`
(the human-fields guard refuses it elsewhere), whose caller `auth.uid()` still names (100:189),
so the stamp is the confirmer; a service-role or Dashboard confirm stamps NULL. Events confirmed
before 107 keep NULL: unknown, never guessed. The static test pins that no RPC body names a
`datum_` column or `confirmed_by`.

### 4.4 `profiles.datum_staff_id`

`ADD COLUMN IF NOT EXISTS datum_staff_id UUID`, `CREATE UNIQUE INDEX IF NOT EXISTS
idx_profiles_datum_staff_id ON profiles (datum_staff_id) WHERE datum_staff_id IS NOT NULL`, and
trigger `profiles_datum_staff_id_sync_only`, error `PROFILE_DATUM_LINK_SYNC_ONLY:`. It is needed:
`profiles_self_update` (001:420) lets anyone update their own row and `profiles_update_managers`
(024:7) lets managers update others. 057/090's `profiles_role_immutable_trg` and 093's
`profiles_principal_membership_trg` are untouched.

### 4.5 `room_datum_gate_status`: the cache

| Column | Type | Notes |
|---|---|---|
| `room_id`, `gate_code` | `UUID` → `rooms(id) ON DELETE CASCADE`, `TEXT` → `gate_refs(code)` | `PRIMARY KEY (room_id, gate_code)`. |
| `project_id` | `UUID NOT NULL` → `projects(id) ON DELETE CASCADE` | For RLS and the board read. |
| `datum_area_id` | `UUID NOT NULL` | The area the row was read for; the board ignores a row whose value differs from `rooms.datum_area_id`. |
| `status` | `TEXT NOT NULL` | `CHECK IN ('not_started','in_progress','ready_for_handoff','blocked','passed','not_applicable')`, DATUM's enum (`20260531000001:154`, `readiness-rules.ts:5-11`). |
| `datum_stale` | `BOOLEAN NOT NULL` | DATUM's own `stale` flag (`20260601000013:6-7`): DATUM has not recomputed since a card changed. |
| `datum_updated_at`, `datum_recomputed_at` | `TIMESTAMPTZ` | `updated_at`, `last_recomputed_at` as DATUM has them. |
| `synced_at`, `run_id` | `TIMESTAMPTZ NOT NULL`, `UUID` → `datum_sync_runs(id)` | When SANO read it, and in which run. |

Rows are upserted, never deleted: a row not refreshed ages into "lama" (§8.2). RLS on, one
policy `FOR SELECT USING (is_project_member(project_id) OR is_office_role())`, no write policy.

### 4.6 `datum_sync_runs` and `datum_sync_requests`

`datum_sync_runs`: `id UUID DEFAULT gen_random_uuid()`, `project_id` (→ `projects`, CASCADE),
`source TEXT CHECK (source IN ('manual','cron','import'))`, `requested_by UUID NULL` →
`profiles`, `request_id UUID NULL`, `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
`finished_at`, `ok BOOLEAN`, `counts JSONB NOT NULL DEFAULT '{}'`, `differences JSONB NOT NULL
DEFAULT '{}'`, `error TEXT`. `CREATE UNIQUE INDEX datum_sync_runs_one_open ON
datum_sync_runs(project_id) WHERE finished_at IS NULL` is the lock (decision 11); `(project_id,
started_at DESC)` serves "last run". RLS: SELECT for `is_project_member(project_id) OR
is_office_role()` (counts and names, no secrets; the board needs the last good gate read), no
write policy.

**Staff results in a per-project log.** Staff matching (§6.4) reads every profile and every
active DATUM staff row, whatever the run's project; each run executes it once and writes its
outcome under `counts.steps.staff`, `counts.staff` and `differences.staff` of that run's row. The
answer depends on no project, so the newest run with `steps.staff = 'ok'`, from any project, is
the current staff picture; the Rooms tab (office roles, who read all runs) shows that one,
labelled "semua proyek", on every project. Three projects syncing hourly repeat an identical,
idempotent step, which costs one DATUM read each.

`datum_sync_requests`: `id UUID DEFAULT gen_random_uuid()`, `project_id` (CASCADE),
`requested_at DEFAULT now()`, `handled_at`, `run_id` → `datum_sync_runs`, `error TEXT`. RLS on,
SELECT for `is_office_role()`, no write policy: only pg_cron (`postgres`) inserts and the
function (service role) updates. Rows are kept (about 2,200 a month for three projects).

### 4.7 Scheduler

The 106 block (106:368-379) with its own job name. Hourly, UTC-independent:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'datum_sync_hourly') THEN
      PERFORM cron.unschedule('datum_sync_hourly');
    END IF;
    PERFORM cron.schedule('datum_sync_hourly', '0 * * * *',
      $cmd$INSERT INTO public.datum_sync_requests (project_id)
           SELECT id FROM public.projects
           WHERE datum_project_code IS NOT NULL AND status = 'ACTIVE'$cmd$);
  ELSE
    RAISE NOTICE '107: pg_cron belum aktif. Aktifkan Cron di Dashboard (Integrations → Cron), lalu paste 107 lagi. Tanpa itu sinkron DATUM hanya berjalan lewat tombol.';
  END IF;
END $$;
```

`status = 'ACTIVE'` is 106's rule (2026-09-26 §2 decision 9); the button still syncs any paired
project. The command holds no URL and no secret: delivery is the Database Webhook (§7).

## 5. DATUM: one PR, five routes

### 5.1 Shared pieces, `apps/web/lib/integrations/sano/`

- **`auth.ts`**: `sanoAuth(req, secret): 'ok' | 'unauthorized' | 'not_configured'`. Unset
  secret gives `not_configured` (503 `NOT_CONFIGURED`), never a pass. The header must be exactly
  `Bearer <secret>`; both sides are SHA-256 digested and compared with `crypto.timingSafeEqual`,
  so length and content leak nothing. DATUM's existing checks use `===`
  (`lib/cron/auth.ts:2-5`, `app/api/push/notify/route.ts:29-31`) and are left alone.
- **`project.ts`**: `resolveProject(admin, raw)` reads `projects` by `project_code =
  raw.trim().toUpperCase()` (the `by-slug.ts:30-34` lookup); none is 404 `UNKNOWN_PROJECT`, "Proyek
  DATUM dengan kode {code} tidak ada."
- **Database access:** `createSupabaseAdminClient()` (`lib/supabase/admin.ts:10-21`), service
  role, created only after `sanoAuth` passed; every project query filters by the resolved
  `project.id`; `staff` is global and is read, never written.
  DATUM's own definer functions trust a JWT-less caller (`20260704000003:17-18`), so
  `seed_area_steps` works from it. Every route file sets `export const runtime = "nodejs"`
  (`timingSafeEqual`). The middleware lets `/api` through without a login redirect
  (`middleware.ts:28-37`); the bearer is the only gate. **As built:** if
  `createSupabaseAdminClient()` itself throws — the service-role key unset — that is answered the
  same way as an unset shared secret, `NOT_CONFIGURED` JSON, never Next's own HTML 500
  (`lib/integrations/sano/gate.ts` `openSanoRequest`).
- **Env (Vercel, production):** `SANO_INTEGRATION_SECRET`; `SANO_INTEGRATION_STAFF_ID`, the id
  of a `staff` row "SANO (sistem)" the owner creates once (an auth user that never signs in,
  role `studio_staff`, `active = false`, so `GET staff` never offers it for a name match). A
  missing staff id makes `escalate` answer 503 `NOT_CONFIGURED`.
- **Replies:** `{ ok: true, ... }` or `{ ok: false, code, error }`: `UNAUTHORIZED` 401, `NOT_CONFIGURED` 503,
  `BAD_REQUEST` 400, `UNKNOWN_PROJECT`/`UNKNOWN_AREA` 404, `TOPIC_MISSING`/`EVENT_IN_OTHER_PROJECT`
  409, `DB_ERROR` 500.

### 5.2 The routes

| Route | Does | Returns |
|---|---|---|
| `GET areas?project_code=` | `areas` of the project: `id, area_code, area_name, floor, area_type, sort_order`, by `sort_order`. | `{ project: { id, project_code, project_name }, areas }` |
| `GET gate-status?project_code=` | `area_gate_status` of the project: `area_id, gate_code, status, stale, last_recomputed_at, updated_at` (`20260531000001:157-172`, `20260601000013:6-7`); and `gates`: `code, name, description, sort_order`. | `{ gates, statuses, read_at }` |
| `POST areas` | Body `{ project_code, areas: [{ area_code, area_name, floor, area_type, tracked? }] }`, at most 200 (SANO's own `datum-sync` batches its calls at 25, §6.2). Per item: `area_code` must equal `normalizeAreaCode(area_code)` (`packages/core/src/areas/extract.ts:116-125`) else item error `CODE_NOT_NORMALIZED`; name 1-120 and floor ≤ 40 (`areas/mutations.ts:9-16`) else `INVALID`; `area_type` in `AREA_TYPES` (`extract.ts:29`). Only a malformed envelope is 400; a bad item is its own item error and the rest of the batch still goes through. Existing codes are returned untouched. Missing ones are inserted one by one in request order, `sort_order` appended after the project's maximum as `createArea` does (`mutations.ts:37-45`), `tracked` default true; a `23505` race re-reads the row. Each new tracked area gets `seed_area_steps`, best effort and logged as `mutations.ts:71-76`, then — **as built** — its gate schedule the way DATUM's own add-room gives it: `ensureGateScheduleForArea` then `writePlannedDates` (`lib/projects/area-mutations.ts`, `lib/steps/mutations.ts`), also best effort. Either failure is a per-item `warning` on a `created: true` item (`SCHEDULE_FAILED` or `SEED_FAILED`, the more informative one winning when both would apply), never a reason to fail the create — the area still stands, since SANO still has to link its room to it. No UPDATE or DELETE statement exists in the route. | `{ areas: [{ area_code, id, created, warning?: { code, reason } }], errors: [{ area_code, code, reason }] }` |
| `GET staff` | Active `staff` rows only: `id, full_name` (`20260531000001:21-31`). The matcher needs nothing else, so no role, email, WhatsApp number or handle leaves DATUM. No `project_code`: staff are not per project. | `{ staff: [{ id, full_name }] }` |
| `POST escalate` | Body `{ project_code, area_id, sano_event_id (lower-cased by the schema, so a differently-cased repeat is the same event), sano_url (an https link on SANO's own origin `https://sano-app.vercel.app`, checked field by field, never just `.url()`), title ≤ 80, summary ≤ 300 \| null, room_name, reporter_name, confirmer_name \| null, owner_name, due_date, confirmed_at, author_staff_id \| null }`. Steps in §5.3. | `{ card_id, card_url, created, author: 'linked' \| 'system' }` |

### 5.3 `escalate`, idempotent and self-repairing

1. The area must belong to the project, else 404 `UNKNOWN_AREA`.
2. Look up `cards` where `project_id` matches and `properties @> {"sano_event_id": ...}`
   (Supabase `.contains`, served by the GIN index `cards_properties_gin_idx`, `20260601000015`).
   **As built:** the new partial unique index (§5.4) cannot serve this read — a `->>` equality
   does not imply its `properties ? 'sano_event_id'` predicate — it only turns two truly
   simultaneous creates into one `23505`, closed the same way in step 3.
3. None: the project's `topics` row with `code = 'UMUM'`, else 409 `TOPIC_MISSING`; insert
   `cards` with `topic_id`, `title`, `slug` from core `toSlug` (`packages/core/src/cards/create.ts:25-33`)
   plus the `-2`, `-3` suffix loop of `create.ts:46-57`, `properties: { source: 'sano',
   sano_event_id, sano_url }`, and as author `author_staff_id` when it names an active `staff`
   row, else `SANO_INTEGRATION_STAFF_ID` (the reply's `author` says which). A failed read of
   `author_staff_id`'s `staff` row is its own `DB_ERROR`, never silently read as "no such staff":
   falling back to the system row there would be permanent, since a repeat never changes the
   author. Core `createCard` cannot be reused: it demands a signed-in user and uses that id as
   author (`create.ts:40-44, 66`), and it guesses an area from the title (`:72-101`) where the
   area is known. A `23505` on the new index (§5.4) means a parallel call won — re-read step 2 —
   or, **as built**, that the id it holds belongs to another project: 409
   `EVENT_IN_OTHER_PROJECT`, since a SANO event id spans every project by construction and that
   can only be an integration bug, never a real repeat.
4. Ensure, on a new or found card: `linkCardToArea(admin, { cardId, areaId })`
   (`packages/core/src/cards/area-link.ts:65-100`, already treats `23505` as linked); if the
   card has no `decision` event, `createCardEvent(admin, { eventKind: 'decision', payload: {
   topic: title, current_spec: summary, status: 'needs_decision' }, occurredAt: confirmed_at,
   loggedByStaffId })` (`packages/core/src/cards/events/create.ts:41-79`) with the card's author;
   if it has no `note` event, one `note` with body "Dari SANO · {room_name} · dilaporkan
   {reporter_name} · dikonfirmasi {confirmer_name, or 'tidak tercatat'} · penanggung jawab
   {owner_name} · tenggat {due_date} · {sano_url}". The note always names the SANO people,
   linked or not: the decision schema strips unknown keys (`event-kinds.ts:14-25`). A card half
   made by a call that died is completed by the next one; a repeat never changes the author.
5. `card_url` is `{origin of the request}/project/{project_code lower case}/cards/{slug}`, the
   page `app/(app)/project/[slug]/cards/[cardSlug]/page.tsx` resolves (`:25-32`).

DATUM's own triggers then mark the area's gate rows stale (`20260601000013:10-58`) and alert
card members (`20260926000001`); the route adds no side effect of its own. **As built:** the
route never inserts a `card_members` row, so a card `escalate` creates starts with none — the
alert trigger has nobody to tell. Calibration item 10 below.

### 5.4 DATUM migration

`20260927000001_cards_sano_event_unique.sql`, in the `20260601000015` shape (`begin; ...
commit;`): `create unique index if not exists cards_sano_event_id_key on public.cards
((properties->>'sano_event_id')) where properties ? 'sano_event_id';`. **As built,** it closes
only the race step 3 handles; step 2's own lookup is served by the GIN index
(`cards_properties_gin_idx`), since a partial index requiring `properties ? 'sano_event_id'`
cannot serve a `@>` containment read. Applied with `pnpm db:preflight` then `pnpm
db:migrate` (`docs/DEPLOY.md:21-35`); an index changes no generated type. Until it is pushed,
repeats are still caught by step 2 but two truly simultaneous calls could make two cards,
which cannot happen from SANO: one run per project at a time (§6.2). Its shape is pinned by
`packages/db/tests/sano-event-unique-migration.test.ts`.

## 6. SANO: edge function `datum-sync`

`supabase/functions/datum-sync/`: `index.ts` (`handle`, `if (import.meta.main)
Deno.serve(handle)`, the `site-event-analyze/index.ts:749` shape), `datum.ts` (the five calls,
each with `AbortSignal.timeout(15000)`), `plan.ts` (§6.4), `deno.json` pinned as
`site-event-analyze/deno.json` is. Secrets: `DATUM_API_BASE_URL`, `DATUM_SANO_SECRET` (same value
as DATUM's `SANO_INTEGRATION_SECRET`), `WEBHOOK_AUTH_SECRET` (already set for 034). Deployed with
`--no-verify-jwt`: the webhook presents the shared secret, not a JWT, so the gateway's check
would refuse it; the function verifies both paths itself before anything else.

### 6.1 Auth and modes

- **Config first:** any missing Supabase or DATUM variable is 500 `CONFIG`.
- **Webhook:** the `Authorization` header equals `Bearer {WEBHOOK_AUTH_SECRET}`, compared as
  SHA-256 digests byte by byte. Unlike `send-push-notification/index.ts:72-79`, an unset secret
  never opens this path. Body must be the webhook's `{ type: 'INSERT', table:
  'datum_sync_requests', record: { id, project_id } }`, else 400. Mode sync, source `cron`.
- **User JWT:** anything else, checked the `site-event-analyze/index.ts:202-237` way: `getUser()`
  through a caller client (401 `AUTH`), `projectId` a UUID the caller can read in `projects`
  (404, or on a read error 500 `UNEXPECTED` naming it), then `caller.rpc('is_office_role')` —
  admin, principal or estimator (`caller.ts` `makeVerifyCaller`). A role check that itself errors
  is its own 403 `FORBIDDEN` naming the reason, never read as pass or fail — both `FORBIDDEN` and
  `UNEXPECTED` show the server's own message, not a fixed sentence. **As built (calibration item 9,
  resolved):** the design's first cut gated a sync to admin and principal only; the owner widened
  it to every office role during review, so one check now gates a sync and an import alike. Body
  `{ projectId }` is a sync (403 "Hanya peran kantor (admin, prinsipal, estimator) yang dapat
  menyinkronkan DATUM."), source `manual`. Body `{ projectId, importDatumOnly: true, areaCodes }`
  — **as built** 1-500 codes of 1-200 characters each (`MAX_IMPORT_CODES`,
  `MAX_IMPORT_CODE_LENGTH`; outside those bounds is 400 `BAD_REQUEST` before the caller is even
  checked), the list the user confirmed — is an import (403 "Hanya peran kantor yang dapat
  mengambil ruangan dari DATUM."), source `import`. `requested_by` is the caller. Only then the
  service-role client.

### 6.2 A sync run

1. Read `projects.code, datum_project_code`. NULL: finish a run row with `ok = false`, error
   "Proyek ini belum ditautkan ke DATUM.", answer 409 `PAIRING_MISSING`.
2. Close this project's runs still open after 10 minutes (`ok = false`, "Sinkron terputus sebelum
   selesai."), then insert the run row. A unique violation on `datum_sync_runs_one_open` is 409
   `SYNC_RUNNING`, "Sinkron DATUM untuk proyek ini sedang berjalan."; a webhook request gets that
   sentence in `datum_sync_requests.error`.
3. The webhook path answers 202 here and continues in `EdgeRuntime.waitUntil`, so a webhook
   timeout cannot cut a run short; if the runtime stops it anyway, step 2 of the next run closes
   it. The button path runs inline and answers at the end.
4. Steps in this order, each recorded in `counts.steps` as `ok`, `error` or `skipped`:

| Step | Needs | Does |
|---|---|---|
| `areas` | pairing | `GET areas`, keeping DATUM's `project_name` in `counts.datum_project_name`; unknown code is the error "Kode proyek DATUM {code} tidak ditemukan di DATUM." |
| `link` | `areas` | Plan (§6.4), then `UPDATE rooms SET datum_area_id` for each `link` item. |
| `create` | `areas` | `POST areas` with the plan's `create` items — **as built**, batched at `CREATE_BATCH = 25` per call (lowered from DATUM's own 200-item ceiling once DATUM started building each new area's gate schedule, so one POST reliably clears the 15 s `DATUM_TIMEOUT_MS`) — then link the returned ids; item errors go to `differences.create_failed`, and a per-item schedule or seed `warning` on a created area goes to `differences.schedule_warnings` without failing the create. **As built:** a batch that would start at or after `CREATE_BATCH_START_BEFORE_MS` (45 s into the run) is not sent — its rooms go to `create_failed` as `CREATE_DEFERRED`, "Belum dikirim ke DATUM: waktu sinkron ini habis. Dikirim pada sinkron berikutnya." — and a reply that says DATUM is unreachable (`datumUnreachable`: no answer, 401 or 503) ends the loop at once, since every later call would fail the same way. **Plausibility gate:** only when some room already matches an area by code or DATUM's project has no areas; else `skipped` with "Tidak ada ruangan yang cocok dengan area DATUM proyek {project_name}. Periksa kode proyek DATUM, atau ambil ruangannya dari DATUM." A mistyped code naming another real project must not receive this project's rooms; a project DATUM mapped first is steered to the import (§6.3), after which codes match and the gate opens. |
| `gate_status` | pairing | `GET gate-status`; upsert `room_datum_gate_status` for every status whose `area_id` is some room's `datum_area_id` (rows for unlinked areas are counted in `gate_rows_unlinked`, not stored); **as built**, a gate code `gate_refs` does not have, or a status none of DATUM's six words, is also never stored — counted per gate/status pair in `differences.gate_status_unknown` instead; compare `gates` with `gate_refs` into `differences.gate_words`. |
| `staff` | DATUM reachable | `GET staff` and every `profiles` row; `planStaffLinks` (§6.4); `UPDATE profiles SET datum_staff_id` for its `set` items only. Global, per §4.6. |
| `escalate` | pairing | **As built:** up to 20 open, confirmed `butuh_keputusan` with no card yet from rooms linked to a DATUM area, and up to 20 more from unlinked ones, queried separately, oldest `confirmed_at` first (`listEscalationDue`, `ESCALATE_BATCH = 20`), so decisions in unlinked rooms never take the linked batch's slot. The unlinked ones are all skipped at once with "Ruangan belum tertaut ke area DATUM." (`ESCALATE_ROOM_UNLINKED`), no DATUM call made. For each linked one, once its area has not already answered `UNKNOWN_AREA` this run (else skipped with "DATUM tidak mengenal area ruangan ini; dicoba lagi pada sinkron berikutnya.", `ESCALATE_AREA_UNKNOWN`) and the run is still before `ESCALATE_START_BEFORE_MS` (100 s): `POST escalate` with `author_staff_id` = the reporter's `datum_staff_id`, else the `confirmed_by` profile's, else null, and both SANO names, then `UPDATE site_events SET datum_card_id, datum_card_url, datum_escalated_at = now()`. A reply that says DATUM is unreachable (`datumUnreachable`) ends the loop at once; any other failure is recorded and the next decision is tried. Linked decisions the loop never reaches are `escalate_deferred`, never `escalate_failed`. Runs after `staff`, so a link made this run already counts. |

5. Finish: `finished_at`, `ok` = every step `ok`, `counts`, `differences`, `error` = the first
   step error; mark the request `handled_at`, `run_id`, `error`. The button gets `{ ok, runId,
   counts, differences, error }` with HTTP 200 whenever the run row was written; a step failure
   is `ok: false` inside it, not a 5xx.

`counts`: `steps` (plus, **as built**, `step_errors`: the reason beside each step that was not
`ok`), `datum_project_name`, `rooms_linked` (active rooms with a link after the run),
`rooms_linked_now`, `rooms_created`, `rooms_imported`, `datum_only`, `field_conflicts`,
`retired_missing`, `gate_rows`, `gate_rows_unlinked` (status rows read for areas no room links
to: counted, not stored), `gate_area_ids` (the linked areas the gate read covered), `staff`
(`linked`, `linked_now`, `unmatched`, `ambiguous`, `stale`), `escalated`,
`escalated_as_system`, `escalate_failed`, `escalate_skipped`, `escalate_deferred`. `differences`:
`datum_only [{ area_code, area_name, floor, area_type }]`, `field_conflicts [{ room_code, field
('code' | 'name' | 'floor' | 'area_type' — **as built**, `code` for a linked area whose code
DATUM changed), sano, datum }]`, `datum_duplicates`, `create_failed`, **as built**
`schedule_warnings [{ area_code, code, reason }]`, `import_skipped [{ area_code, reason }]`,
`staff { unmatched, ambiguous, stale }`, `escalate_skipped`, `gate_words [{ code, field }]`, **as
built** `gate_status_unknown [{ gate_code, status, unknown: 'gate' | 'status', rows }]`.

### 6.3 The import: "Ambil {n} ruangan dari DATUM"

A second mode of the same function, not a route (decision 5). Steps 1-3 of §6.2 as a run with
source `import`, then `areas`, `import`, `gate_status` and nothing else:

1. `GET areas` fresh and plan again. Each confirmed code is imported only if it is still in the
   plan's `datumOnly`; otherwise `import_skipped` with "Sudah ada di SANO atau tidak lagi ada di
   DATUM.": nothing enters SANO that the user did not see.
2. The room code is the DATUM code through the same chain and must pass `isValidRoomCode`
   (`tools/roomCodes.ts:47-49`), else skipped with "Kode DATUM {code} tidak bisa menjadi kode
   ruangan SANO." (a 40th-character dash, 2026-09-10 §4.1). **As built,** two more per-code
   guards before the insert: an `area_type` outside DATUM's thirteen (§4.2) is skipped with
   "Tipe area DATUM "{type}" untuk {code} tidak dikenal SANO." (`importBadType`); an empty
   `area_name` is skipped with "Area DATUM {code} tidak punya nama." (`importNoName`).
3. INSERT `rooms` with the service role: `project_id`, `room_code`, `room_name = area_name`,
   `floor`, `area_type` (DATUM's thirteen, §4.2), `sort_order` = DATUM's, `datum_area_id =
   area.id`, `created_by` = the caller. A `23505` on `idx_rooms_project_code` (096:172-173), a
   room made meanwhile, is skipped, not overwritten.
4. `gate_status` runs so the new rooms show DATUM's readiness at once.

The import is not behind the plausibility gate: its confirmation names DATUM's project and lists
every area (§8.1), which is the human check the gate stands in for when no one is asked. From
then on SANO is the master: a DATUM change to an imported area's name, floor or type is a
`field_conflicts` row, never written into SANO.

### 6.4 The planner, `tools/datumSyncPlan.ts`

Pure and dependency-free; the function carries a byte-identical `plan.ts`, kept equal by a twin
test in the `siteEventDraftValidateTwin.test.ts` pattern (`:1-11`: Deno cannot import from
`tools/`, jest never runs `supabase/functions/`).

`planRoomSync(rooms, areas)` returns `{ link, create, datumOnly, fieldConflicts,
datumDuplicates, retiredMissing }`:

- **Key:** the DATUM code through an inlined copy of the six-step chain; jest proves it equals
  `normalizeRoomCode` (`tools/roomCodes.ts:22-34`) on DATUM's fixtures
  (`apps/web/tests/unit/area-extract.test.ts:21-34`). Rooms with a NULL code (035-era) are ignored.
- **Link:** a room whose code matches exactly one area and whose `datum_area_id` differs, active
  or retired (decision 6). **As built:** a room already linked to an area keeps that link even
  once DATUM has changed the area's code — following the new code would create a second area and
  strand the first, history and all, as "only in DATUM" — so only an *unlinked* room, or one
  linked to an area DATUM no longer has, is matched by code.
- **Create:** an active room with no matching area; board order (floor, then `sort_order`);
  `UMUM` with `tracked: false` (decision 7); a name over 120 characters goes to `create_failed`
  as "Nama ruangan lebih dari 120 karakter; DATUM menolaknya." instead. **As built,** a room whose
  code-matched area is already the link of another room also goes to `create_failed` instead of
  being created — "Area DATUM dengan kode {code} sudah tertaut ke ruangan {holder}. Samakan
  kodenya di SANO atau DATUM." (`codeHeldElsewhere`) — since `POST areas` would hand back that
  same area and two rooms would share it.
- **Differences:** an area matching no room is `datumOnly`; two areas normalizing to one key are
  `datumDuplicates`, neither links nor imports; for a match, **as built** `code` (a linked area's
  code no longer equal to the room's — kept linked anyway), `name` (trim, case fold, whitespace
  collapse), `floor` (the same, NULL as empty) and `area_type` (exact) that differ are one
  `fieldConflicts` row each (`ConflictField = 'code' | 'name' | 'floor' | 'area_type'`), linked
  anyway and never overwritten on either side; a retired room with no area is `retiredMissing`,
  counted only.

`normalizePersonName(s)` is the one name rule: `s.normalize('NFD')`, drop `\p{M}` (diacritics),
trim, collapse whitespace runs to one space, lower case; empty means "no name".
`planStaffLinks(profiles, staff)` keys both sides with it and returns `{ set, unchanged,
unmatched, ambiguous, stale }`:

- **Set** only when exactly one active DATUM staff row and exactly one SANO profile share the
  key, the profile has no link, and no other profile holds that staff id (the unique index).
- **Unmatched:** no DATUM staff with that key, or no name. **Ambiguous:** two or more DATUM staff,
  or two or more SANO profiles, share the key, or the only match is already linked to another
  profile.
- **Stale:** a profile already linked whose link is not its unique match now (the staff row is
  gone or inactive, or either name changed). Reported with the reason; the link is not changed or
  cleared, so a person's cards keep one author until someone makes the names agree.

## 7. Trigger

- **Button:** `syncDatum(projectId)` in new `tools/datumSync.ts` calls
  `supabase.functions.invoke('datum-sync', { body: { projectId } })`, as `tools/siteEvents.ts:309`
  does, and returns `{ run } | { error }` with the refusal codes mapped to their sentences.
  `importFromDatum(projectId, areaCodes)` sends `{ projectId, importDatumOnly: true, areaCodes }`
  the same way.
- **Hourly:** pg_cron inserts one `datum_sync_requests` row per paired ACTIVE project (§4.7).
  The owner creates one Database Webhook, as 034 did for notifications (034:17-21): Dashboard →
  Database → Webhooks, table `public.datum_sync_requests`, event INSERT, POST to the
  `datum-sync` function URL, header `Authorization: Bearer <WEBHOOK_AUTH_SECRET>`, timeout at
  its maximum. No migration holds a URL or a secret. **As built:** the function marks the
  request's `handled_at` and `run_id` before it answers the webhook's POST with 202
  (`handler.ts` `fromWebhook`), so the Rooms tab never reads a delivered request as still waiting
  even if the runtime stops the run right after; if that happens, the next run's ten-minute sweep
  (§6.2 step 2) closes the orphaned run and marks its request "Sinkron terputus sebelum selesai."
  (`RUN_INTERRUPTED`), so the two rows agree.

## 8. What people see

### 8.1 Rooms tab: card "DATUM"

New `office/screens/rooms/DatumSyncCard.tsx` in the "Kelola ruangan" sub-screen of
`RoomsAdminScreen` (`:229-381`), above "Ekspor untuk DATUM" (`:373-381`), which stays. **As
built,** the same card also renders in a "DATUM" section on `PrincipalRoomsScreen.tsx`, reloading
the room board (`onRoomsChanged`) after a sync or import, so a principal reaches it without
opening "Kelola ruangan."

| Part | Shows |
|---|---|
| Pairing | "Kode proyek DATUM" and a field with "Simpan" for office roles (`canPairDatum(role)`: admin, principal, estimator), calling `set_datum_project_code`; its refusals mapped to sentences. A supervisor never reaches this sub-screen; any other viewer reads the code, or "Belum ditautkan". |
| Button | "Sinkron DATUM", disabled while a request is in flight ("Menyinkronkan…"), when unpaired ("Proyek ini belum ditautkan ke DATUM."), and for other roles. Nothing changes on screen until the server answers; then the card reloads the latest run from the table. |
| Last run | `Sinkron terakhir: 27 Sep 10.00 · 12 ruangan ditautkan · 2 dibuat · 1 hanya di DATUM` (`formatWibShort(finished_at)`, `tools/timeWindow.ts:165`), zero parts other than "ditautkan" dropped, then "otomatis" or "oleh {name}", and "DATUM: {datum_project_name}". A failed run: `Sinkron terakhir gagal: 27 Sep 10.00 · {error}` in critical colour and each step that was not `ok`. Open run: "Sinkron sedang berjalan sejak 10.00". No run: "Belum pernah disinkronkan." Read failure: "Status sinkron gagal dimuat." with "Coba lagi". |
| Sinkron otomatis | Only when requests older than 2 h are unhandled: "Sinkron otomatis menunggu: {n} permintaan sejak {time}. Periksa Database Webhook." |
| Ambil dari DATUM | When the latest finished run lists DATUM-only areas, for office roles: "Ambil {n} ruangan dari DATUM". It opens a confirmation naming DATUM's project and listing every area (code, name, floor, type): "Ambil {n} ruangan dari DATUM proyek {datum_project_name}? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan." "Ambil" sends exactly the listed codes; the button is disabled until the server answers, then the card shows "{k} ruangan diambil" and each skipped code with its reason, and reloads. |
| Differences | From the latest finished run: "Hanya di DATUM", "Berbeda dengan DATUM" (one line per field — **as built** including `kode` alongside nama, lantai and tipe, since a linked area’s code can drift from the room’s without breaking the link: `KM-1 · nama — SANO "Kamar Mandi 1" · DATUM "KM Anak"`), "Kode ganda di DATUM", "Gagal dibuat di DATUM" (**as built** keeping deferred creates apart from real refusals — "Belum dibuat di DATUM (menunggu sinkron berikutnya)" for a room `CREATE_DEFERRED` never reached DATUM with), **as built** "Jadwal DATUM belum tersusun" (an area DATUM created but whose gate schedule or step list it failed to build, `differences.schedule_warnings`: the room is already linked, only its DATUM-side schedule is missing — "Susun jadwalnya dengan 'Hitung ulang jadwal' di DATUM."), "Keputusan belum terkirim", **as built** "Status gerbang DATUM tidak tersimpan" (a gate code or readiness word DATUM sent that SANO does not recognize, `differences.gate_status_unknown`) and "Kata gerbang berbeda dengan DATUM", each under "Tidak diubah otomatis. Samakan di SANO atau DATUM bila perlu." |
| Staf belum tertaut | From the newest run whose staff step was `ok`, any project (§4.6), headed "Staf (semua proyek), per {time}": "Tidak ada di DATUM" (unmatched), "Nama ganda" (ambiguous, naming which side), "Tautan lama tidak cocok" (stale, with the linked DATUM name if still known), then "{m} staf tertaut". Under it: "Samakan nama di SANO atau DATUM, lalu sinkron lagi. Kartu dari orang yang belum tertaut dibuat atas nama SANO (sistem)." No picker in this build. |

### 8.2 Papan Ruangan: DATUM readiness per room (all roles)

`tools/datumGateStatus.ts`: `listDatumGateStatus(projectId)` returns `{ paired, lastGateReadAt,
rows } | { error }` from `projects.datum_project_code`, the newest run whose
`counts->steps->>gate_status = 'ok'`, and the project's cache rows; the pure
`datumChipsForRoom(room, result, nowIso)` decides the state. `RoomBoardView` reads it inside
`load` (`:81-107`) beside `listRoomBoard`, so focus and pull-to-refresh reload both, and renders
under each room's meta line (`:273-278`):

| State | Renders |
|---|---|
| Project unpaired | Nothing: DATUM is not part of this project. |
| Read failed | One line under the summary card, "Status DATUM gagal dimuat." with "Coba lagi"; no room shows chips, and the line says why. |
| Room not linked, or no gate read ever succeeded | "Status DATUM belum tersinkron" |
| Linked, read succeeded, DATUM holds no row for the area | "DATUM belum punya status untuk ruangan ini" |
| Rows (only those whose `datum_area_id` equals the room's) | One chip per gate in gate order, `{code} {label}`: not_started "belum mulai", in_progress "berjalan", ready_for_handoff "siap serah terima", blocked "terhambat", passed "lolos", not_applicable "tidak berlaku"; then "per DATUM 10.00" (`HH.mm` today WIB, `27 Sep 10.00` otherwise) from `synced_at`. |
| `synced_at` older than 24 h | Chips grey and "· lama". |
| Any row `datum_stale` | "· sebagian menunggu hitung ulang di DATUM" |

The chips sit beside SANO's own "Gerbang {last_gate_code}" meta, which stays: that is where
SANO's latest event was filed, not a readiness verdict. Supervisors see chips after the OTA.

### 8.3 Event detail

`EVENT_SELECT` (`tools/siteEvents.ts:374-375`) already takes `*`, so the four new columns
arrive; it gains `project:projects(datum_project_code)` and
`confirmer:profiles!site_events_confirmed_by_fkey(full_name)`. In "Tanggung jawab"
(`SiteEventDetailScreen.tsx:311-335`): the "Dikonfirmasi" row (`:316`) adds "oleh {name}" when
`confirmed_by` is known; with `datum_card_id`, "Dikirim ke DATUM · 27 Sep 10.00" and "Buka kartu
DATUM" (`Linking.openURL(datum_card_url)`); an open `butuh_keputusan` without a card on a paired
project reads "Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya." — **as built**, unless
its room has no `datum_area_id`, when it reads "Belum dikirim ke DATUM: Ruangan belum tertaut ke
area DATUM." instead, since the sync sends nothing from an unlinked room
(`workflows/screens/siteEvent/datumEscalation.ts`).

## 9. Failure handling

| Failure | Behaviour |
|---|---|
| DATUM down or slow (15 s) | That step is `error` with the reason; others run (decision 10); board chips keep their time and turn "lama" after 24 h; escalations wait for the next run. |
| Secrets differ | DATUM answers 401; every DATUM step records "DATUM menolak kunci integrasi (401)."; nothing is written. |
| Code unknown in DATUM | 404 `UNKNOWN_PROJECT`; "Kode proyek DATUM {code} tidak ditemukan di DATUM." |
| Code of the wrong DATUM project | The plausibility gate (§6.2) refuses to create; the card names DATUM's project, and the import's confirmation names it again. |
| DATUM mapped the project first | The gate skips creation and points to "Ambil {n} ruangan dari DATUM"; after the import, syncs create and link normally. |
| An area changes between listing and import | Skipped with its reason; nothing the user did not see is imported. |
| A DATUM code cannot be a SANO code | Skipped with "Kode DATUM {code} tidak bisa menjadi kode ruangan SANO."; fix the code in DATUM. |
| DATUM renames, moves or retypes a linked area | A "Berbeda dengan DATUM" line; SANO keeps its own values. |
| A room cannot be created | `create_failed` with DATUM's item error, the length refusal, or `codeHeldElsewhere`; **as built**, or `CREATE_DEFERRED` when the run's own clock ran out before that batch could start — retried, not refused, on the next run. |
| DATUM created an area but its schedule failed | **As built:** the area and the room's link still stand; `differences.schedule_warnings` lists it under "Jadwal DATUM belum tersusun", fixed by "Hitung ulang jadwal" in DATUM. |
| A name matches no one, or several | "Staf belum tertaut"; the card is authored by SANO (sistem) and its note names the SANO people. |
| A linked name no longer matches | "Tautan lama tidak cocok"; the link stays until the names agree. |
| Event confirmed before 107 | `confirmed_by` NULL; the note says "dikonfirmasi tidak tercatat"; the author falls to the reporter's link or SANO (sistem). |
| Decision in an unlinked room | Skipped with its reason; sent on the first run after the room links. |
| Card made, SANO write lost | The next run posts again and DATUM returns the same card (§5.3). |
| Function dies mid-run | Next run closes the open run as "terputus"; the lock frees. |
| Button during the hourly run | "Sinkron DATUM untuk proyek ini sedang berjalan." (also for an import) |
| Cron not enabled / webhook missing | 107's NOTICE; the card's "Sinkron otomatis" line (§8.1) shows requests waiting; the button still works. |
| Board, run or staff read fails | A read error with "Coba lagi", never an empty or "never" state. |

## 10. Security

The shared secret lives only in DATUM's Vercel env and SANO's function secrets; no migration,
bundle or test holds it (the 107 static test refuses `Bearer`, `http` and `supabase.co` in the
SQL), and both sides compare it in constant time. It opens exactly five routes: read areas and
gate status of a project named by code, read active staff names, create missing areas, create or
return a decision card; no update, delete or cost read sits behind it. `GET staff` returns id
and full name only. A card's author is a staff id SANO supplies, accepted only if it names an
active staff row; SANO supplies only ids its own name match set, which app users cannot write
(§4.4). Each side builds its service-role client only after its own check passed, and DATUM
scopes every project query to the resolved project. On SANO, sync, import and pairing all need
an office role (`is_office_role()`: admin, principal, estimator) — **as built**, sync was widened
from admin-and-principal-only to the same office-role gate during review (calibration item 9,
resolved) — and supervisors can do none of the three. App roles cannot write `rooms.datum_area_id`,
`site_events.datum_*`, `site_events.confirmed_by` or `profiles.datum_staff_id` (§4.2-§4.4); the
three new tables have SELECT policies only. Crossing to DATUM: title, summary, room name, the
reporter's, confirmer's and owner's names, due date and a SANO room link, visible to DATUM
project members under DATUM's RLS. Rotation: set the new value on both sides, then "Sinkron
DATUM" once.

## 11. Testing

### 11.1 Static migration guard: `tools/__tests__/migration107.test.ts` (jest, comments stripped)

Header (spec link, PASTE ORDER after 106, RE-PASTE SAFETY, "re-pasting 101 restores the old
words: re-paste 107 after it"); `lock_timeout` first and one `RESET`; exactly eight `UPDATE
gate_refs` for A-H setting only `name_id`, `short_label`, `description` and `datum_gate_code =
code`, each string equal to §3's table, and no INSERT or DELETE on `gate_refs`; the pairing CHECK
and partial unique index; `set_datum_project_code` DEFINER, `search_path`, REVOKE from `PUBLIC,
anon`, GRANT `authenticated`, gated on `is_office_role()`, and no trigger on `projects`; the
`rooms_area_type_check` swap guarded on `'exterior'` with exactly DATUM's thirteen values; the
three guard triggers (`rooms_datum_area_id_sync_only`, `site_events_system_columns_guard`,
`profiles_datum_staff_id_sync_only`) with their own functions, BEFORE INSERT OR UPDATE, 097's
rule-1 bypass, and the `confirmed_by := auth.uid()` stamp placed before the bypass and
conditioned on `OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL`; the unique index on
`profiles.datum_staff_id`; no redefinition of any 096, 097, 099, 100 or 105 function and no
policy on `rooms`, `gate_refs`, `gate_step_refs`; across every migration, no function body other
than 107's names a `datum_` column or `confirmed_by`; the three tables with RLS on and only
SELECT policies, `source` CHECK with `'import'`; the cron block (`pg_extension`,
unschedule-if-exists, `datum_sync_hourly`, `'0 * * * *'`, the INSERT with `datum_project_code IS
NOT NULL AND status = 'ACTIVE'`, the NOTICE); no `net.http_post`, `Bearer`, `http` or
`supabase.co`; the SELF-CHECK `EXPECTED:` lines; and `AREA_TYPES` in `tools/constants.ts` equals
the thirteen values the migration lists.

### 11.2 Docker rehearsal: `supabase/tests/datum_sync_rehearsal/`

Modelled on `site_event_closure_rehearsal/run.sh` (image, `rehearsal.as_user`, `expect`,
`expect_error`, tally; container `sano-pg-datum-rehearsal`): 001-106 once, 107 pasted twice, a
fixture of two projects, each role, an outsider, rooms and an open `butuh_keputusan`, then:

| Area | Cases |
|---|---|
| Gate words | Eight rows equal §3 with `datum_gate_code = code`; a second paste changes nothing. |
| Event columns | Supervisor and admin UPDATE or INSERT of any `datum_*` column or `confirmed_by` refused with `SITE_EVENT_SYSTEM_COLUMNS`; `service_role` (role and JWT claim set) and `postgres` succeed; `close_site_event` still works; after a re-paste of 097 the refusal still holds. |
| Confirmer stamp | `confirm_site_event` as a member stamps that member; as `service_role` it stamps NULL; a later update never moves the stamp. |
| Room link and types | Estimator UPDATE of `datum_area_id` refused, a rename still allowed; `service_role` sets it; `facade` and `exterior` accepted, `foo` refused; a re-paste of 096 keeps the wide CHECK. |
| Staff link | A user updating their own `datum_staff_id`, and an admin updating anyone's, refused with `PROFILE_DATUM_LINK_SYNC_ONLY`; a self-rename still allowed; `service_role` sets it; a second profile with the same staff id is a unique violation. |
| Pairing | Estimator, admin and principal RPC store `' k2-7 '` as `K2-7`; supervisor RPC refused (`DATUM_PAIRING_AUTH`); the same code on a second project is `DATUM_PAIRING_TAKEN`; blank clears; a lower-case direct UPDATE fails the CHECK. |
| Tables | Members read their project's cache and runs, an outsider nothing, a supervisor no requests; no insert, update or delete by `authenticated` on the three tables; the cache status CHECK refuses an unknown value; `source = 'import'` accepted; a second open run for a project is a unique violation, a new one after `finished_at` is fine. |
| Scheduler | Without pg_cron: the NOTICE, no error. With it, pasted twice: one job `datum_sync_hourly`, `0 * * * *`; running its command inserts one request per paired ACTIVE project and none for ON_HOLD or unpaired ones. |

**As built,** review rounds added `rehearse_repaste.sql`, run right after `run.sh` re-pastes 097
and 096 on top of 107: a supervisor still refused on `datum_card_id` after 097's re-paste; a
member's confirm still stamps `confirmed_by` as the confirmer, not the reporter who filed the
event (fooled once, before that check was tightened); an estimator still refused on
`datum_area_id` after 096's re-paste, a terrace still an accepted room type and the CHECK still
lists `exterior`; and one more catalog-count equality. `run.sh` also gained its own inline checks
for both re-paste hazards (a 101-then-107 gate-word round trip) and for the scheduler with
pg_cron, ending in one more catalog-count equality after every re-paste in the run. `run.sh` now
tallies 80 checks end to end (`PASS=80 FAIL=0 ERROR=0` on a clean run): 66 in
`rehearse_107.sql`, 7 in `rehearse_repaste.sql`, 7 written directly in `run.sh`.

### 11.3 Jest

| File | Covers |
|---|---|
| `tools/__tests__/datumSyncPlan.test.ts` | Rooms: link for active and retired rooms, and — **as built** — a linked room keeps its link and reports a `code` conflict once DATUM changes the area's code; create for active only, board order, `UMUM` untracked, a 121-character name refused, and (**as built**) `codeHeldElsewhere` when the matching area is already another room's link; DATUM-only; a case or whitespace difference is no conflict, a real code, name, floor or type difference is one row each and still links; duplicate DATUM codes neither link nor import; NULL codes ignored; already-linked rooms untouched; the inlined normalizer equals `normalizeRoomCode` on DATUM's fixtures. |
| `tools/__tests__/datumSyncPlanImport.test.ts` | **As built:** `planImport`, including `importBadType` and `importNoName` alongside the unusable-code and gone-from-DATUM skips. |
| `tools/__tests__/datumSyncPlanWords.test.ts` | **As built:** `diffGateWords` against DATUM's and SANO's gate rows. |
| `tools/__tests__/datumSyncPlanVerdict.test.ts` | **As built:** `runVerdict` — ok only when every recorded step is ok, the first non-ok step's reason otherwise. |
| `tools/__tests__/datumSyncPlanPeople.test.ts` | Names: `normalizePersonName` folds "José  Santoso" and "jose santoso" together, strips combining marks, trims, keeps distinct names distinct, empty stays empty. Staff: a unique match sets; two DATUM staff or two SANO profiles with one name are ambiguous; a staff already linked elsewhere is ambiguous; no match is unmatched; an intact link is unchanged; a link whose staff vanished or was renamed is stale and not changed. |
| `tools/__tests__/datumSyncPlanTwin.test.ts` | `plan.ts` byte-identical to `tools/datumSyncPlan.ts`. |
| `tools/__tests__/datumGateStatus.test.ts` | Every state of `datumChipsForRoom`; the six labels exactly; the 24 h edge; rows for another area ignored; `HH.mm` versus date across WIB midnight. |
| `tools/__tests__/datumSync.test.ts` | `syncDatum`, `importFromDatum` and the pairing call map every refusal code to its sentence; `canPairDatum` and (**as built**) `canSyncDatum` true for admin, principal and estimator, false for supervisor. |
| `office/screens/rooms/__tests__/datumSyncModel.test.ts` | **As built:** the Rooms-tab card's words pulled into a pure model (`datumSyncModel.ts`) — every Differences group (including `kode` conflicts, "Jadwal DATUM belum tersusun" and "Status gerbang DATUM tidak tersimpan"), the last-run line, and the "Ambil" offer's 500-code/200-character caps — so the rendering component itself stays thin. |

**As built,** the planner's own jest coverage split across six files as it grew (above), rather
than the one file first planned; together with the gate-status and sync-call tests that reads as
41 `it`/`test` cases found in the files (not run).

### 11.4 Deno: `supabase/functions/datum-sync/index.test.ts`

`handle` takes injected clients and `fetch`; a fake DATUM serves the five routes from memory.
Auth: the webhook secret takes the cron path; a wrong or unset secret falls to the JWT path and
gets 401; **as built** (calibration item 9, resolved) sync and import are both open to every
office role — admin, principal and estimator — and both refuse a supervisor; missing config is
500. Pairing missing: 409 and a failed run row. Running: 409, for sync and import alike. Partial
failure: areas 500 marks `areas`, `link`, `create` as `error` or `skipped` while `gate_status`,
`staff` and `escalate` still run, and the run carries the first error. **As built,** the create
loop itself: a batch that would start past `CREATE_BATCH_START_BEFORE_MS` is deferred
(`CREATE_DEFERRED`) rather than sent, and a `datumUnreachable` reply (0, 401 or 503) ends the loop
at once. Import: only confirmed codes still DATUM-only become rooms, with code, name, floor,
type, sort order and link; a code no longer DATUM-only, an unusable code, an unrecognized type or
empty name (**as built**), and a meanwhile-created room are skipped with reasons; no `POST`
reaches DATUM; the plausibility gate stops creation until the import, then lets it through.
Staff: links set only for `set` items, stale ones untouched. Escalation: the author is the
reporter's link, else the confirmer's, else null, and the note names both; the same event twice
gives one card; a lost SANO write is healed by the next run; an unlinked room is skipped without
a DATUM call; **as built**, a second decision in an area DATUM already answered `UNKNOWN_AREA`
for this run is skipped without retrying it; the 21st linked event is deferred, never counted as
failed. The webhook path answers 202 and marks its request before it does (**as built**,
`handled_at` and `run_id` both). CI runs only tsc and jest, so `deno test` in the function folder
is a release step. **As built,** the five `*.test.ts` files (`caller`, `datum`, `handler`, `run`,
`store`) carry 53 `Deno.test` cases in total.

### 11.5 Screen tests (React Native Testing Library)

| File | Covers |
|---|---|
| `office/screens/rooms/__tests__/DatumSyncCard.test.tsx` | Pairing field for office roles, refusals shown; sync button open to every office role — **as built**, admin, principal and estimator alike (calibration item 9, resolved) — disabled unpaired and in flight; nothing shown before the server answers; last run ok, failed, running, never, read error; the automatic-sync line; "Ambil {n}" shown only with DATUM-only areas, its confirmation naming DATUM's project and every area, sending exactly those codes (**as built**, capped at 500 and excluding any over 200 characters), disabled until the answer, then imported and skipped counts; every Differences group; "Staf belum tertaut" groups and its "semua proyek" time. |
| `office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx` | While loading no DATUM sentence at all; the read-error line with retry; unpaired shows nothing; never, none and chips with labels and "per DATUM"; stale "lama"; the DATUM-stale sentence; rows for another area ignored. |
| `office/screens/__tests__/PrincipalRoomsScreen.datum.test.tsx` | **As built:** the "DATUM" section renders `DatumSyncCard` for a principal and reloads the room board (`onRoomsChanged`) after a sync or import. |
| `workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx` | Escalated shows time and link; waiting shows the sentence; **as built**, an open decision in an unlinked room instead reads "Belum dikirim ke DATUM: Ruangan belum tertaut ke area DATUM."; unpaired shows neither; "Dikonfirmasi … oleh {name}" only when `confirmed_by` is known. |
| `office/screens/rooms/__tests__/RoomForm.types.test.tsx` | The type picker offers the thirteen types with DATUM's labels. |

**As built,** these five files together read as 62 `it`/`test` cases found in the files (not
run): 22 in `DatumSyncCard.test.tsx`, 23 in `datumSyncModel.test.ts` (§11.3), 7 in
`RoomBoardView.datum.test.tsx`, 6 in `SiteEventDetailScreen.datum.test.tsx`, 3 in
`PrincipalRoomsScreen.datum.test.tsx` and 1 in `RoomForm.types.test.tsx`; `tools/siteEvents.ts`'s
`PGRST200` retry (a read that drops the `confirmer` embed when 107 is not yet applied) is proven
alongside them.

### 11.6 DATUM: `apps/web/tests/unit/sano-integration-routes.test.ts` (vitest)

In the `push-notify-route.test.ts` pattern, with the admin client mocked by an in-memory fake
that records every mutation. Bearer missing, wrong, wrong length (no throw) give 401, right gives
200, unset secret 503, **as built** a missing service-role key also 503 `NOT_CONFIGURED` as JSON
(never Next's own HTML 500), on all five routes; unknown project 404 on the four project routes;
reads scoped to the project. `GET staff`: active rows only, each with exactly `id` and
`full_name` (no role, email, WhatsApp number or handle), the inactive SANO (sistem) row absent.
`POST areas`: creates the missing, a second identical call creates nothing and returns the same
ids, an existing area with another name comes back untouched, `CODE_NOT_NORMALIZED`, `tracked:
false` stored, `seed_area_steps` and (**as built**) the gate schedule (`ensureGateScheduleForArea`
+ `writePlannedDates`) only for new tracked areas, either failure a per-item `warning` rather than
an error, item errors carrying a `reason` string. `escalate`: first call makes card, link,
decision and note; `author_staff_id` of an active row authors card and events (`author:
'linked'`), an unknown or inactive one falls back to the system row (`'system'`); a repeat
returns the same `card_id` with `created: false`, inserts nothing and keeps the author; a
half-made card is completed; a `23505` race returns the winner, or — **as built** — 409
`EVENT_IN_OTHER_PROJECT` when it names a card in a different project; `UNKNOWN_AREA`;
`TOPIC_MISSING`; missing staff id 503; the lookup itself is `.contains` against the GIN index,
never the new partial unique index. Across all five: the fake records no update and no delete,
ever. The new index's own shape is pinned separately by
`packages/db/tests/sano-event-unique-migration.test.ts`. **As built,** this suite currently reads
as 6 `it` blocks, four of them run once per route via `describe.each` over the five routes (about
22 executions) plus 2 more standalone cases — read from the file, not run.

## 12. Scope

**In:** 107; `datum-sync` with its sync and import modes; the Rooms-tab card, board chips and
detail row; name-matched staff links; DATUM's five routes, auth helper, index and staff row.
**Out:** SANO writing gate status into DATUM; photos or any event other than confirmed
`butuh_keputusan`; deleting or renaming anything in either database; DATUM-to-SANO push
(2026-09-10 §17); a manual staff picker; re-importing a DATUM change into a SANO room; step
libraries; an event URL.

## 13. Release order

1. **DATUM PR** merged; Vercel production deploy; env `SANO_INTEGRATION_SECRET` and
   `SANO_INTEGRATION_STAFF_ID` (after creating the "SANO (sistem)" auth user and `staff` row —
   the author row `escalate` falls back to); `pnpm db:preflight`, `pnpm db:migrate` for the
   index.
2. **As built,** paste **107** after 106 next, before the SANO PR merges, and run its
   self-check; if it printed the pg_cron NOTICE, enable Cron and paste again. Pasting it first
   means the `datum_*` columns and `rooms.datum_area_id` exist before the SANO PR's app code —
   which reads and writes them — reaches production; Expo web auto-deploys from `main` on merge,
   so merging first would ship code against a schema that is not there yet. The new gate words
   reach every phone at once: every surface reads `gate_refs`. Re-pasting 101 later restores the
   old words (re-paste 107); a 107 re-paste overwrites "Kelola gerbang" edits.
3. **SANO PR** merged.
4. Set `DATUM_API_BASE_URL` and `DATUM_SANO_SECRET`; `deno test` in the function folder; deploy
   `datum-sync --no-verify-jwt` from a main worktree.
5. Create the Database Webhook once (§7).
6. Enter the codes in the Rooms tab for Gading Serpong Zelyn, Citraland K2-7 Sonny and Bukit
   Darmo Golf D-18 Selvia.
7. "Sinkron DATUM" on Citraland first; read Differences and the DATUM project name before the
   other two. Where DATUM already holds the rooms, use "Ambil {n} ruangan dari DATUM", then sync.
8. The owner reads "Staf belum tertaut" and makes the names agree in SANO or DATUM (same
   spelling; accents and case do not matter), then syncs again until the people who report and
   confirm decisions are linked.
9. OTA from main (channel `preview`) for the board chips, the detail rows and the four new room
   types in the phone's room views; no native module, so no build. Old phones lack only those.

## 14. Cost

pg_cron and Database Webhooks cost nothing extra. Hourly for three paired active projects is 72
invocations a day, about 2,200 a month (the approved note's ~720 is one project), against a
500,000 allowance; each run makes four DATUM calls plus one per escalation, about 9,000 a month.
The real cost is upkeep, held to five routes, one function, one migration per repo, and the
static, twin and route tests that fail when either side drifts.

## 15. Calibration items

| # | Item | Owner | Trigger |
|---|---|---|---|
| 1 | DATUM's gate B description still describes the old bathroom bundle (`20260531000003_seed_gates_and_checkpoints.sql:10-12`) under the confirmed name; SANO copies it verbatim and the analysis prompt reads it. DATUM's `RulesViewer.tsx:41-50` also still says "Pekerjaan Kamar Mandi". Fix both in DATUM; the next run lists B under "Kata gerbang berbeda"; a follow-up SANO migration copies it. | User (DATUM) | Before the pilot relies on AI gate picks for B. |
| 2 | Past events read under new words, mostly kusen work filed as C or D. | PM | 107's grid shows events under C or D. |
| 3 | Hourly includes nights and Sundays. | User | Run log reads as noise; move to `0 0-13 * * 1-6` (07:00-20:00 WIB, Monday to Saturday). |
| 4 | "lama" after 24 h is a constant. | PM | The board reads "lama" every Monday morning. |
| 5 | The "SANO (sistem)" staff row is inactive; some DATUM view may hide its name as author. | User (DATUM) | A card shows no author. |
| 6 | 20 escalations per run. | Implementer | `escalate_deferred > 0` on two runs in a row. |
| 7 | Exact names miss titles and short forms ("Ir. Budi" vs "Budi", "Selvi" vs "Selvia"). | User | "Staf belum tertaut" stays long after one round of renaming: consider a picker. |
| 8 | Only events confirmed after 107 know their confirmer. | PM | Old open decisions escalate as SANO (sistem). |
| 9 | Sync is admin and principal, import and pairing are any office role. **Resolved as built:** the owner widened sync to every office role during review, so this no longer applies (§6.1, §10). | User | An estimator pairs a project and cannot press "Sinkron DATUM". |
| 10 | **As built:** a card `escalate` creates has no `card_members` row, so DATUM's new-event alert (`20260926000001_card_event_member_alerts.sql`) notifies no one until someone is added to the card. | User (DATUM) | A decision card sits unread with no notification trail. |
