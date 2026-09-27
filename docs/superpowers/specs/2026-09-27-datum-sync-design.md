# DATUM sync: same gate words, linked rooms, DATUM readiness on the board, decisions escalated

> Release 2, second slice, of the room-based site event loop: SANO's eight gates take DATUM's
> words; a paired project links its rooms to DATUM areas by code and creates the missing ones;
> DATUM's area-by-gate readiness shows on Papan Ruangan exactly as DATUM states it; and every
> confirmed "butuh keputusan" becomes one decision card in DATUM, once.

**Date:** 2026-09-27. **Status:** approved design, pending implementation plan.
**Builds on:** `docs/superpowers/specs/2026-09-10-room-site-events-design.md` §2 decisions 2-3,
§4.1, §17; `/Users/carissatjondro/Dropbox/AI/SANO_DATUM_AI_Site_Execution_Brief.md` §3, §8, §11.6;
`2026-09-26-closure-evidence-and-digest-design.md` §5.5 (the pg_cron guard).
**Repos:** SANO (`ufntlqvacjhmddwltcxf`), migration `107_datum_sync.sql` (highest on main:
`106_site_event_digest.sql`) and edge function `datum-sync`; DATUM (`nsmyazmxwdvwtdtqjrpx`), one
PR with four routes under `apps/web/app/api/integrations/sano/` and migration
`20260927000001_cards_sano_event_unique.sql` (highest on main: `20260926000001_card_event_member_alerts.sql`).

## 1. Goal

Release 1 shaped SANO rooms and gates like DATUM's but never talked to DATUM (2026-09-10 §1,
§15), and the shapes drifted: SANO's gate B reads "Waterproofing + kamar mandi" (101:69-73), DATUM's
"Pekerjaan Basah / Waterproofing" (`20260625000001_uniform_room_steps.sql:14`). A decision found on
site reaches the office only if someone retypes it into a DATUM card. This slice closes both gaps
with one SANO migration, one edge function, four DATUM routes and one DATUM index. The link stays
exception-driven (brief §8); SANO never computes a readiness verdict nor writes gate status (brief §3).

### 1.1 Truth contract, applied (CLAUDE.md §12)

| # | Rule | Enforcement |
|---|---|---|
| 1 | A readiness chip is DATUM's own word, never SANO's inference. | The cache stores `area_gate_status.status` verbatim (six values, CHECK); the board maps each to one fixed Indonesian label and shows the time SANO read it. No code path derives a status. |
| 2 | Old news is marked old, and missing news is never shown as "no news". | Older than 24 h: chips greyed with "lama". Never read: "Status DATUM belum tersinkron". A failed read: an error line. DATUM holding no row for a linked area: its own sentence. |
| 3 | A link is set only by the sync. | `rooms.datum_area_id`, `site_events.datum_card_*` and `projects.datum_project_code` refuse direct writes from app roles (§4.1-§4.3). |
| 4 | Nothing is merged, renamed or deleted to make two lists agree. | POST areas never renames; DATUM-only areas and name conflicts are listed as differences; the sync deletes no row in either database. |
| 5 | A decision reaches DATUM once. | DATUM's unique index on `cards.properties->>'sano_event_id'` makes a repeat return the same card; SANO stores the id only after DATUM answered. |
| 6 | A failed step is recorded, never smoothed over. | Every run writes `datum_sync_runs` with per-step outcome, counts and the first error; the Rooms tab shows the failure as written. |

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | **SANO follows DATUM's gate words**, as DATUM stores them today, not as the June seed did: B is "Pekerjaan Basah / Waterproofing", not "Pekerjaan Kamar Mandi". | The owner's rule is "SANO follows DATUM". DATUM renamed B after the seed (`20260625000001:14`); its own `RulesViewer.tsx:41-50` still carries the old map and is DATUM's drift, not a source. |
| 2 | `short_label` is DATUM's own chip name, `GATE_SHORT_NAME` (`packages/core/src/gates/labels.ts:3-12`), not a new derivation. | DATUM already derives a short name from each gate name and shows it as `A · MEP Rough-in` (`labels.ts:14-17`); a second derivation in SANO would be a third vocabulary. |
| 3 | `gate-status` also returns DATUM's eight gate rows; the function reports any word that differs from `gate_refs`, and writes nothing to `gate_refs`. | 107 is a snapshot. The drift check keeps "SANO follows DATUM" true after it without a fifth route or a silent rewrite of office-edited labels. |
| 4 | DATUM routes authenticate with one shared bearer (constant-time) and read or write with DATUM's service-role client, every query scoped by the `project_code` in the request. | DATUM's own crons and webhooks use the same shape (`apps/web/lib/cron/auth.ts:2-5`, `lib/supabase/admin.ts:10-21`). A DATUM staff JWT (2026-09-10 §17) would need a password-holding bot user and token refresh inside a SANO function. |
| 5 | SANO rooms are the master for membership; DATUM stays the master of its own area rows. | Owner's decision. POST creates only what is missing and never edits an existing area; DATUM-only areas are shown, not imported. |
| 6 | Retired SANO rooms (`active = false`) are **linked** when DATUM already has their code and are **never created** in DATUM. | Linking is a read and keeps history joined; creating would add a room with seeded milestones (`packages/core/src/areas/mutations.ts:63-76`) that no one will work in. |
| 7 | "Area Umum" (`UMUM`) is created in DATUM with `tracked = false`. | Decisions filed there need an area to link to, and DATUM defines an untracked area as one that "still holds cards" but "carries no milestones and raises no signals" (`20260909000002:15-16`). |
| 8 | Escalation cards are authored by a dedicated DATUM staff row named by `SANO_INTEGRATION_STAFF_ID`, go to the project's `UMUM` list, and carry one `decision` event with `status: 'needs_decision'` plus one `note` naming the people. | `cards.created_by_staff_id` and `card_events.logged_by_staff_id` are NOT NULL references to `staff`, whose id is an `auth.users` id (`20260531000001_core_schema.sql:21-22`, `20260601000001_cards_layer.sql:29,75`). Every board has `UMUM` (`20260822000001:42`, `20260822000002:30-33`). `needs_decision` is DATUM's open-decision state (`packages/types/src/event-kinds.ts:14-25`). |
| 9 | `sano_url` is the room link `https://sano-app.vercel.app/r/{projects.code}/{room_code}` (`tools/roomLinks.ts:4,17`). | SANO has no web route to one event; the room link opens the room timeline that lists it. |
| 10 | Steps run in order areas, create, gate-status, escalate; a failed step skips only the steps that need its output. | A DATUM areas read that fails must not block the gate read or escalations for rooms already linked. |
| 11 | One run per project at a time, by a partial unique index; a run left unfinished for 10 minutes is closed as failed by the next one. | A button press during the hourly run must not double-create areas; an edge function that dies mid-run must not lock the project forever. |

**Where this supersedes 2026-09-10.** §2 decision 2 and §17 said DATUM would own room
definitions after the link and SANO's editor would go read-only ("Kelola di DATUM"): replaced
by decisions 5-6, and the editor stays as it is. §17's PostgREST read with a DATUM staff JWT:
replaced by decision 4. §17's "DATUM-only areas are pulled": replaced by "listed as
differences". §17's optional DATUM-to-SANO webhook stays out (§12).

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
SELF-CHECK). It creates no policy on `rooms`, `gate_refs` or `gate_step_refs` and touches none of 096's functions or
triggers, which `migration096.test.ts:432-458` forbids; and it does not redefine 097's
`site_events_human_fields_rpc_only`, so re-pasting 097 reverts nothing in 107.

### 4.1 Pairing: `projects.datum_project_code`

The column exists since 096 (096:130-131). 107 adds `CHECK (datum_project_code IS NULL OR
(datum_project_code = upper(btrim(datum_project_code)) AND datum_project_code <> ''))` inside a
`pg_constraint` guard, and `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_datum_project_code ON
projects (datum_project_code) WHERE datum_project_code IS NOT NULL`. DATUM stores codes upper
case and looks them up that way (`packages/core/src/projects/by-slug.ts:30-34`).

`projects_update_assigned` (023:59-60, widened by 037) lets an assigned estimator update the row, and the design
restricts pairing to admin and principal, so a column rule is needed: trigger
`projects_datum_code_rpc_only` (BEFORE INSERT OR UPDATE) refuses a non-NULL value on INSERT and
any change on UPDATE when `current_user IN ('authenticated', 'anon')`, with
`DATUM_PAIRING_RPC_ONLY:`. The one app path is `set_datum_project_code(p_project_id UUID, p_code
TEXT) RETURNS JSONB`, SECURITY DEFINER, `SET search_path = public`, REVOKE from `PUBLIC, anon`,
GRANT to `authenticated`: refuses unless `profiles.role IN ('admin','principal')` for
`auth.uid()` (`DATUM_PAIRING_AUTH:`), stores `NULLIF(upper(btrim(p_code)), '')`, maps a unique
violation to `DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain`, returns `{ code }`.

### 4.2 `rooms.datum_area_id` is sync-only

`rooms_office_all` (096:312-313) lets every office role write any column. New trigger
`rooms_datum_area_id_sync_only` (own function, BEFORE INSERT OR UPDATE): with `current_user IN
('authenticated','anon')`, INSERT requires NULL and UPDATE requires no change, else
`ROOM_DATUM_LINK_SYNC_ONLY:`. No app code writes it today: `createRoom` omits it and `RoomPatch`
excludes it (`tools/rooms.ts:147-150`).

### 4.3 `site_events`: the escalation columns

`ADD COLUMN IF NOT EXISTS datum_card_id UUID`, `datum_card_url TEXT`, `datum_escalated_at
TIMESTAMPTZ`, plus `CREATE INDEX IF NOT EXISTS idx_site_events_escalation_due ON
site_events(project_id) WHERE status = 'open' AND event_type = 'butuh_keputusan' AND
datum_card_id IS NULL`.

**The guard.** 097's human-fields guard lists its columns explicitly (097:347-370), so new
columns are writable by any member under `site_events_update` (097:450-452) and insertable
under `site_events_insert`. Extending that function in place is possible but would put it on
the list of things a 097 re-paste silently reverts (the 105 hazard, 2026-09-26 §3.2) and break
the pinned body shape in `migration097.test.ts:294-305`. 107 therefore adds a separate trigger
in the exact shape of 097's rule-1 guard (097:261-304): `site_events_datum_columns_service_only`,
BEFORE INSERT OR UPDATE, bypass `COALESCE(auth.role(), '') = 'service_role' OR current_user NOT
IN ('authenticated', 'anon')` (the function's PostgREST writes, the Dashboard), INSERT requires
all three NULL, UPDATE requires all three unchanged, else `SITE_EVENT_DATUM_COLUMNS: kolom
DATUM hanya diisi oleh sinkron` with `ERRCODE = 'insufficient_privilege'`. The SECURITY DEFINER
RPCs also pass the bypass, so the static test pins that no RPC body names a `datum_` column.

### 4.4 `room_datum_gate_status`: the cache

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

### 4.5 `datum_sync_runs` and `datum_sync_requests`

`datum_sync_runs`: `id UUID DEFAULT gen_random_uuid()`, `project_id` (→ `projects`, CASCADE),
`source TEXT CHECK (source IN ('manual','cron'))`, `requested_by UUID NULL` → `profiles`,
`request_id UUID NULL`, `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `finished_at`, `ok
BOOLEAN`, `counts JSONB NOT NULL DEFAULT '{}'`, `differences JSONB NOT NULL DEFAULT '{}'`,
`error TEXT`. `CREATE UNIQUE INDEX datum_sync_runs_one_open ON datum_sync_runs(project_id) WHERE
finished_at IS NULL` is the lock (decision 11); `(project_id, started_at DESC)` serves "last
run". RLS: SELECT for `is_project_member(project_id) OR is_office_role()` (counts and names, no
secrets; the board needs the last good gate read), no write policy.

`datum_sync_requests`: `id UUID DEFAULT gen_random_uuid()`, `project_id` (CASCADE),
`requested_at DEFAULT now()`, `handled_at`, `run_id` → `datum_sync_runs`, `error TEXT`. RLS on,
SELECT for `is_office_role()`, no write policy: only pg_cron (`postgres`) inserts and the
function (service role) updates. Rows are kept (about 2,200 a month for three projects).

### 4.6 Scheduler

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

## 5. DATUM: one PR, four routes

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
  role, created only after `sanoAuth` passed; every query filters by the resolved `project.id`.
  DATUM's own definer functions trust a JWT-less caller (`20260704000003:17-18`), so
  `seed_area_steps` works from it. Every route file sets `export const runtime = "nodejs"`
  (`timingSafeEqual`). The middleware lets `/api` through without a login redirect
  (`middleware.ts:28-37`); the bearer is the only gate.
- **Env (Vercel, production):** `SANO_INTEGRATION_SECRET`; `SANO_INTEGRATION_STAFF_ID`, the id
  of a `staff` row "SANO (sistem)" the owner creates once (an auth user that never signs in,
  role `studio_staff`, `active = false`). A missing staff id makes `escalate` answer 503
  `NOT_CONFIGURED`.
- **Replies:** `{ ok: true, ... }` or `{ ok: false, code, error }`: `UNAUTHORIZED` 401, `NOT_CONFIGURED` 503,
  `BAD_REQUEST` 400, `UNKNOWN_PROJECT`/`UNKNOWN_AREA` 404, `TOPIC_MISSING` 409, `DB_ERROR` 500.

### 5.2 The routes

| Route | Does | Returns |
|---|---|---|
| `GET areas?project_code=` | `areas` of the project: `id, area_code, area_name, floor, area_type, sort_order`, by `sort_order`. | `{ project: { id, project_code, project_name }, areas }` |
| `GET gate-status?project_code=` | `area_gate_status` of the project: `area_id, gate_code, status, stale, last_recomputed_at, updated_at` (`20260531000001:157-172`, `20260601000013:6-7`); and `gates`: `code, name, description, sort_order`. | `{ gates, statuses, read_at }` |
| `POST areas` | Body `{ project_code, areas: [{ area_code, area_name, floor, area_type, tracked? }] }`, at most 200. Per item: `area_code` must equal `normalizeAreaCode(area_code)` (`packages/core/src/areas/extract.ts:116-125`) else item error `CODE_NOT_NORMALIZED`; name 1-120 and floor ≤ 40 (`areas/mutations.ts:9-16`) else `INVALID`; `area_type` in `AREA_TYPES` (`extract.ts:29`). Existing codes are returned untouched. Missing ones are inserted one by one in request order, `sort_order` appended after the project's maximum as `createArea` does (`mutations.ts:37-45`), `tracked` default true; a `23505` race re-reads the row. Each new tracked area gets `seed_area_steps`, best effort and logged as `mutations.ts:71-76`. No UPDATE or DELETE statement exists in the route. | `{ areas: [{ area_code, id, created }], errors: [{ area_code, code }] }` |
| `POST escalate` | Body `{ project_code, area_id, sano_event_id, sano_url, title ≤ 80, summary ≤ 300 \| null, room_name, reporter_name, owner_name, due_date, confirmed_at }`. Steps in §5.3. | `{ card_id, card_url, created }` |

### 5.3 `escalate`, idempotent and self-repairing

1. The area must belong to the project, else 404 `UNKNOWN_AREA`.
2. Look up `cards` where `project_id` matches and `properties->>'sano_event_id' = sano_event_id`.
3. None: the project's `topics` row with `code = 'UMUM'`, else 409 `TOPIC_MISSING`; insert
   `cards` with `topic_id`, `title`, `slug` from core `toSlug` (`packages/core/src/cards/create.ts:25-33`)
   plus the `-2`, `-3` suffix loop of `create.ts:46-57`, `properties: { source: 'sano',
   sano_event_id, sano_url }`, `created_by_staff_id: SANO_INTEGRATION_STAFF_ID`. Core
   `createCard` cannot be reused: it demands a signed-in user and uses that id as author
   (`create.ts:40-44, 66`), and it guesses an area from the title (`:72-101`) where the area
   is known. A `23505` on the new index (§5.4) means a parallel call won: re-read step 2.
4. Ensure, on a new or found card: `linkCardToArea(admin, { cardId, areaId })`
   (`packages/core/src/cards/area-link.ts:65-100`, already treats `23505` as linked); if the
   card has no `decision` event, `createCardEvent(admin, { eventKind: 'decision', payload: {
   topic: title, current_spec: summary, status: 'needs_decision' }, occurredAt: confirmed_at,
   loggedByStaffId })` (`packages/core/src/cards/events/create.ts:41-79`); if it has no `note`
   event, one `note` with body "Dari SANO · {room_name} · dilaporkan {reporter_name} ·
   penanggung jawab {owner_name} · tenggat {due_date} · {sano_url}" (the decision schema
   strips unknown keys, so the people travel as text, not as DATUM staff, per 2026-09-10 §17).
   A card half made by a call that died is completed by the next one.
5. `card_url` is `{origin of the request}/project/{project_code lower case}/cards/{slug}`, the
   page `app/(app)/project/[slug]/cards/[cardSlug]/page.tsx` resolves (`:25-32`).

DATUM's own triggers then mark the area's gate rows stale (`20260601000013:10-58`) and alert
card members (`20260926000001`); the route adds no side effect of its own.

### 5.4 DATUM migration

`20260927000001_cards_sano_event_unique.sql`, in the `20260601000015` shape (`begin; ...
commit;`): `create unique index if not exists cards_sano_event_id_key on public.cards
((properties->>'sano_event_id')) where properties ? 'sano_event_id';`. It serves step 2's
lookup and closes the race step 3 handles. Applied with `pnpm db:preflight` then `pnpm
db:migrate` (`docs/DEPLOY.md:21-35`); an index changes no generated type. Until it is pushed,
repeats are still caught by step 2 but two truly simultaneous calls could make two cards,
which cannot happen from SANO: one run per project at a time (§6.2).

## 6. SANO: edge function `datum-sync`

`supabase/functions/datum-sync/`: `index.ts` (`handle`, `if (import.meta.main)
Deno.serve(handle)`, the `site-event-analyze/index.ts:749` shape), `datum.ts` (the four calls,
each with `AbortSignal.timeout(15000)`), `plan.ts` (§6.3), `deno.json` pinned as `site-event-analyze/deno.json` is. Secrets:
`DATUM_API_BASE_URL`, `DATUM_SANO_SECRET` (same value as DATUM's `SANO_INTEGRATION_SECRET`),
`WEBHOOK_AUTH_SECRET` (already set for 034). Deployed with `--no-verify-jwt`: the webhook
presents the shared secret, not a JWT, so the gateway's check would refuse it; the function
verifies both paths itself before anything else.

### 6.1 Auth

- **Config first:** any missing Supabase or DATUM variable is 500 `CONFIG`.
- **Webhook:** the `Authorization` header equals `Bearer {WEBHOOK_AUTH_SECRET}`, compared as
  SHA-256 digests byte by byte. Unlike `send-push-notification/index.ts:72-79`, an unset
  secret never opens this path. Body must be the webhook's `{ type: 'INSERT', table:
  'datum_sync_requests', record: { id, project_id } }`, else 400. Source `cron`.
- **Button:** anything else is a user JWT, checked the `site-event-analyze/index.ts:202-237`
  way: `getUser()` through a caller client (401 `AUTH`), the caller's own `profiles.role` must
  be `admin` or `principal` (403 `FORBIDDEN`, "Hanya admin atau prinsipal yang dapat
  menyinkronkan DATUM."), body `{ projectId }` a UUID the caller can read in `projects` (404).
  Source `manual`, `requested_by` the caller. Only then the service-role client.

### 6.2 A run

1. Read `projects.code, datum_project_code`. NULL: finish a run row with `ok = false`, error
   "Proyek ini belum ditautkan ke DATUM.", answer 409 `PAIRING_MISSING`.
2. Close this project's runs still open after 10 minutes (`ok = false`, "Sinkron terputus
   sebelum selesai."), then insert the run row. A unique violation on
   `datum_sync_runs_one_open` is 409 `SYNC_RUNNING`, "Sinkron DATUM untuk proyek ini sedang
   berjalan."; a webhook request gets that sentence in `datum_sync_requests.error`.
3. The webhook path answers 202 here and continues in `EdgeRuntime.waitUntil`, so a webhook
   timeout cannot cut a run short; if the runtime stops it anyway, step 2 of the next run
   closes it. The button path runs inline and answers at the end.
4. Steps, each recorded in `counts.steps` as `ok`, `error` or `skipped`:

| Step | Needs | Does |
|---|---|---|
| `areas` | pairing | `GET areas`, keeping DATUM's `project_name` in `counts.datum_project_name`; unknown code is the error "Kode proyek DATUM {code} tidak ditemukan di DATUM." |
| `link` | `areas` | Plan (§6.3), then `UPDATE rooms SET datum_area_id` for each `link` item. |
| `create` | `areas` | `POST areas` with the plan's `create` items, then link the returned ids; item errors go to `differences.create_failed`. **Plausibility gate:** only when some room already matches an area by code or DATUM's project has no areas; else `skipped` with "Tidak ada ruangan yang cocok dengan area DATUM proyek {project_name}. Periksa kode proyek DATUM." A mistyped code naming another real project must not receive this project's rooms. |
| `gate_status` | pairing | `GET gate-status`; upsert `room_datum_gate_status` for every status whose `area_id` is some room's `datum_area_id` (rows for unlinked areas are counted, not stored); compare `gates` with `gate_refs` into `differences.gate_words`. |
| `escalate` | pairing | Oldest 20 by `confirmed_at` of `status = 'open' AND event_type = 'butuh_keputusan' AND confirmed_at IS NOT NULL AND datum_card_id IS NULL`; a room with no `datum_area_id` is skipped with reason "Ruangan belum tertaut ke area DATUM."; otherwise `POST escalate`, then `UPDATE site_events SET datum_card_id, datum_card_url, datum_escalated_at = now()`. One failure is recorded and the next event is tried; more than 20 are counted as deferred. |

5. Finish: `finished_at`, `ok` = every step `ok`, `counts`, `differences`, `error` = the first
   step error; mark the request `handled_at`, `run_id`, `error`. The button gets `{ ok, runId,
   counts, differences, error }` with HTTP 200 whenever the run row was written; a step failure
   is `ok: false` inside it, not a 5xx.

`counts`: `steps`, `rooms_linked` (active rooms with a link after the run), `rooms_linked_now`,
`rooms_created`, `datum_only`, `name_conflicts`, `gate_rows`, `escalated`, `escalate_failed`,
`escalate_skipped`, `escalate_deferred`. `differences`: `datum_only [{ area_code, area_name,
floor }]`, `name_conflicts [{ room_code, sano_name, datum_name }]`, `datum_duplicates`,
`create_failed [{ room_code, reason }]`, `escalate_skipped [{ event_id, title, reason }]`,
`gate_words [{ code, field }]`.

### 6.3 The room planner, `tools/datumSyncPlan.ts`

Pure and dependency-free; the function carries a byte-identical `plan.ts`, kept equal by a twin
test in the `siteEventDraftValidateTwin.test.ts` pattern (`:1-11`: Deno cannot import from
`tools/`, jest never runs `supabase/functions/`). `planRoomSync(rooms, areas)` returns `{ link,
create, datumOnly, nameConflicts, datumDuplicates, retiredMissing }`:

- **Key:** the DATUM code through an inlined copy of the six-step chain; jest proves it equals
  `normalizeRoomCode` (`tools/roomCodes.ts:22-34`) on DATUM's fixtures
  (`apps/web/tests/unit/area-extract.test.ts:21-34`). Rooms with a NULL code (035-era) are ignored.
- **Link:** a room whose code matches exactly one area and whose `datum_area_id` differs,
  active or retired (decision 6).
- **Create:** an active room with no matching area; board order (floor, then `sort_order`);
  `UMUM` with `tracked: false` (decision 7); a name over 120 characters goes to `create_failed`
  as "Nama ruangan lebih dari 120 karakter; DATUM menolaknya." instead.
- **Differences:** an area matching no room is `datumOnly`; two areas normalizing to one key
  are `datumDuplicates` and neither links; a match whose names differ after trim, case fold and
  whitespace collapse is a `nameConflicts` row, linked anyway, never renamed on either side; a
  retired room with no area is `retiredMissing`, counted only.

## 7. Trigger

- **Button:** `syncDatum(projectId)` in new `tools/datumSync.ts` calls
  `supabase.functions.invoke('datum-sync', { body: { projectId } })`, as `tools/siteEvents.ts:309`
  does, and returns `{ run } | { error }` with the refusal codes mapped to their sentences.
- **Hourly:** pg_cron inserts one `datum_sync_requests` row per paired ACTIVE project (§4.6).
  The owner creates one Database Webhook, as 034 did for notifications (034:17-21): Dashboard →
  Database → Webhooks, table `public.datum_sync_requests`, event INSERT, POST to the
  `datum-sync` function URL, header `Authorization: Bearer <WEBHOOK_AUTH_SECRET>`, timeout at
  its maximum. No migration holds a URL or a secret.

## 8. What people see

### 8.1 Rooms tab: card "DATUM"

New `office/screens/rooms/DatumSyncCard.tsx` in the "Kelola ruangan" sub-screen of
`RoomsAdminScreen` (`:229-381`), above "Ekspor untuk DATUM" (`:373-381`), which stays.

| Part | Shows |
|---|---|
| Pairing | "Kode proyek DATUM" and a field with "Simpan" for admin and principal (`canPairDatum(role)`), calling `set_datum_project_code`; its refusals mapped to sentences. Other roles read the code, or "Belum ditautkan". |
| Button | "Sinkron DATUM", disabled while a request is in flight ("Menyinkronkan…"), when unpaired ("Proyek ini belum ditautkan ke DATUM."), and for other roles. Nothing changes on screen until the server answers; then the card reloads the latest run from the table. |
| Last run | `Sinkron terakhir: 27 Sep 10.00 · 12 ruangan ditautkan · 2 dibuat · 1 hanya di DATUM` (`formatWibShort(finished_at)`, `tools/timeWindow.ts:165`), zero parts other than "ditautkan" dropped, then "otomatis" or "oleh {name}", and "DATUM: {datum_project_name}". A failed run: `Sinkron terakhir gagal: 27 Sep 10.00 · {error}` in critical colour and each step that was not `ok`. Open run: "Sinkron sedang berjalan sejak 10.00". No run: "Belum pernah disinkronkan." Read failure: "Status sinkron gagal dimuat." with "Coba lagi". |
| Sinkron otomatis | Only when requests older than 2 h are unhandled: "Sinkron otomatis menunggu: {n} permintaan sejak {time}. Periksa Database Webhook." |
| Differences | From the latest finished run: "Hanya di DATUM", "Nama berbeda" (`KM-1 — SANO "Kamar Mandi 1" · DATUM "KM Anak"`), "Kode ganda di DATUM", "Gagal dibuat di DATUM", "Keputusan belum terkirim" and "Kata gerbang berbeda dengan DATUM", each under "Tidak diubah otomatis. Samakan di SANO atau DATUM bila perlu." |

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

`EVENT_SELECT` (`tools/siteEvents.ts:374-375`) already takes `*`, so the three columns arrive;
it gains `project:projects(datum_project_code)`. In "Tanggung jawab"
(`SiteEventDetailScreen.tsx:311-335`): with `datum_card_id`, "Dikirim ke DATUM · 27 Sep 10.00"
and "Buka kartu DATUM" (`Linking.openURL(datum_card_url)`); an open `butuh_keputusan` without a
card on a paired project reads "Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya."

## 9. Failure handling

| Failure | Behaviour |
|---|---|
| DATUM down or slow (15 s) | That step is `error` with the reason; others run (decision 10); board chips keep their time and turn "lama" after 24 h; escalations wait for the next run. |
| Secrets differ | DATUM answers 401; every DATUM step records "DATUM menolak kunci integrasi (401)."; nothing is written. |
| Code unknown in DATUM | 404 `UNKNOWN_PROJECT`; "Kode proyek DATUM {code} tidak ditemukan di DATUM." |
| Code of the wrong DATUM project | The plausibility gate (§6.2) refuses to create; the card names DATUM's project so the mistake is visible. |
| A room cannot be created | `create_failed` with DATUM's item error or the length refusal. |
| Decision in an unlinked room | Skipped with its reason; sent on the first run after the room links. |
| Card made, SANO write lost | The next run posts again and DATUM returns the same card (§5.3). |
| Function dies mid-run | Next run closes the open run as "terputus"; the lock frees. |
| Button during the hourly run | "Sinkron DATUM untuk proyek ini sedang berjalan." |
| Cron not enabled / webhook missing | 107's NOTICE; the card's "Sinkron otomatis" line (§8.1) shows requests waiting; the button still works. |
| Board or run read fails | A read error with "Coba lagi", never an empty or "never" state. |

## 10. Security

The shared secret lives only in DATUM's Vercel env and SANO's function secrets; no migration,
bundle or test holds it (the 107 static test refuses `Bearer`, `http` and `supabase.co` in the
SQL), and both sides compare it in constant time. It opens exactly four routes: read areas and
gate status of a project named by code, create missing areas, create or return a decision card;
no update, delete or cost read sits behind it. Each side builds its service-role client only
after its own check passed, and DATUM scopes every query to the resolved project. App roles
cannot write the link columns (§4.1-§4.3); the three new tables have SELECT policies only.
Crossing to DATUM: title, summary, room name, reporter and owner names, due date and a SANO room
link, visible to DATUM project members under DATUM's RLS. Rotation: set the new value on both
sides, then "Sinkron DATUM" once.

## 11. Testing

### 11.1 Static migration guard: `tools/__tests__/migration107.test.ts` (jest, comments stripped)

Header (spec link, PASTE ORDER after 106, RE-PASTE SAFETY, "re-pasting 101 restores the old
words: re-paste 107 after it"); `lock_timeout` first and one `RESET`; exactly eight `UPDATE
gate_refs` for A-H setting only `name_id`, `short_label`, `description` and `datum_gate_code =
code`, each string equal to §3's table, and no INSERT or DELETE on `gate_refs`; the pairing
CHECK and partial unique index; the three triggers with their own functions, BEFORE INSERT OR
UPDATE, bypass shapes as §4.1-§4.3; `set_datum_project_code` DEFINER, `search_path`, REVOKE from
`PUBLIC, anon`, GRANT `authenticated`, role test `('admin','principal')`; no redefinition of
096's or 097's functions, no policy on `rooms`, `gate_refs`, `gate_step_refs`; across every
migration, no function body other than 107's pairing RPC names a `datum_` column; the three
tables with RLS on and only SELECT policies; the cron block (`pg_extension`,
unschedule-if-exists, `datum_sync_hourly`, `'0 * * * *'`, the INSERT with `datum_project_code
IS NOT NULL AND status = 'ACTIVE'`, the NOTICE); no `net.http_post`, `Bearer`, `http` or
`supabase.co`; the SELF-CHECK `EXPECTED:` lines.

### 11.2 Docker rehearsal: `supabase/tests/datum_sync_rehearsal/`

Modelled on `site_event_closure_rehearsal/run.sh` (image, `rehearsal.as_user`, `expect`, `expect_error`,
tally; container `sano-pg-datum-rehearsal`): 001-106 once, 107 pasted twice, a fixture of two
projects, each role, an outsider, rooms and an open `butuh_keputusan`, then:

| Area | Cases |
|---|---|
| Gate words | Eight rows equal §3 with `datum_gate_code = code`; a second paste changes nothing. |
| Event columns | Supervisor and admin UPDATE of any `datum_*` column refused with `SITE_EVENT_DATUM_COLUMNS`; INSERT carrying one refused; `service_role` (role and JWT claim set) and `postgres` succeed; `confirm_site_event` and `close_site_event` still work; after a re-paste of 097 the refusal still holds. |
| Room link | Estimator UPDATE of `datum_area_id` refused, a rename still allowed; `service_role` sets it. |
| Pairing | Estimator direct UPDATE refused (`DATUM_PAIRING_RPC_ONLY`); estimator RPC refused (`DATUM_PAIRING_AUTH`); admin RPC stores `' k2-7 '` as `K2-7`; the same code on a second project is `DATUM_PAIRING_TAKEN`; blank clears. |
| Tables | Members read their project's cache and runs, an outsider nothing, a supervisor no requests; no insert, update or delete by `authenticated` on the three tables; the cache status CHECK refuses an unknown value; a second open run for a project is a unique violation, a new one after `finished_at` is fine. |
| Scheduler | Without pg_cron: the NOTICE, no error. With it, pasted twice: one job `datum_sync_hourly`, `0 * * * *`; running its command inserts one request per paired ACTIVE project and none for ON_HOLD or unpaired ones. |

### 11.3 Jest

| File | Covers |
|---|---|
| `tools/__tests__/datumSyncPlan.test.ts` | Link for active and retired rooms; create for active only, board order, `UMUM` untracked, a 121-character name refused; DATUM-only; a case or whitespace difference is not a name conflict, a real one is and still links; duplicate DATUM codes link nothing; NULL codes ignored; already-linked rooms untouched; the inlined normalizer equals `normalizeRoomCode` on DATUM's fixtures. |
| `tools/__tests__/datumSyncPlanTwin.test.ts` | `plan.ts` byte-identical to `tools/datumSyncPlan.ts`. |
| `tools/__tests__/datumGateStatus.test.ts` | Every state of `datumChipsForRoom`; the six labels exactly; the 24 h edge; rows for another area ignored; `HH.mm` versus date across WIB midnight. |
| `tools/__tests__/datumSync.test.ts` | `syncDatum` and the pairing call map every refusal code to its sentence. |

### 11.4 Deno: `supabase/functions/datum-sync/index.test.ts`

`handle` takes injected clients and `fetch`; a fake DATUM serves the four routes from memory.
Auth: the webhook secret takes the cron path; a wrong or unset secret falls to the JWT path and
gets 401; admin and principal JWTs pass, estimator and supervisor get 403; missing config is
500. Pairing missing: 409 and a failed run row. Running: 409. Partial failure: areas 500 marks
`areas`, `link`, `create` as `error` or `skipped` while `gate_status` and `escalate` still run,
and the run carries the first error; a gate-status timeout is recorded. Idempotent escalation:
the same event twice gives one card; an event already carrying a card is not posted; a lost
SANO write is healed by the next run with the same card. Unlinked room skipped; the 21st event
deferred; the plausibility gate stops creation; the webhook path answers 202 and marks its
request. CI runs only tsc and jest, so `deno test` in the function folder is a release step.

### 11.5 Screen tests (React Native Testing Library)

| File | Covers |
|---|---|
| `office/screens/rooms/__tests__/DatumSyncCard.test.tsx` | Pairing field for admin and principal only, refusals shown; button disabled unpaired, in flight and for other roles; nothing shown before the server answers; last run ok, failed with its error, running, never, read error; the automatic-sync line; every Differences group. |
| `office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx` | While loading no DATUM sentence at all; the read-error line with retry; unpaired shows nothing; never, none and chips with labels and "per DATUM"; stale "lama"; the DATUM-stale sentence; rows for another area ignored. |
| `workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx` | Escalated shows time and link; waiting shows the sentence; unpaired shows neither. |

### 11.6 DATUM: `apps/web/tests/unit/sano-integration-routes.test.ts` (vitest)

In the `push-notify-route.test.ts` pattern, with the admin client mocked by an in-memory fake
that records every mutation. Bearer missing, wrong, wrong length (no throw) give 401, right
gives 200, unset secret 503; unknown project 404 on all four routes; reads scoped to the
project. `POST areas`: creates the missing, a second identical call creates nothing and returns
the same ids, an existing area with another name comes back untouched, `CODE_NOT_NORMALIZED`,
`tracked: false` stored, `seed_area_steps` only for new tracked areas. `escalate`: first call
makes card, link, decision and note; a repeat returns the same `card_id` with `created: false`
and inserts nothing; a half-made card is completed; a `23505` race returns the winner;
`UNKNOWN_AREA` for another project's area; `TOPIC_MISSING`; missing staff id 503. Across all
four: the fake records no update and no delete, ever.

## 12. Scope

**In:** 107; `datum-sync`; the Rooms-tab card, board chips and detail row; DATUM's four routes,
auth helper, index and staff row. **Out:** SANO writing gate status into DATUM; photos or any
event other than confirmed `butuh_keputusan`; deleting or renaming anything in either database;
DATUM-to-SANO push (2026-09-10 §17); importing DATUM-only areas; step libraries; an event URL.

## 13. Release order

1. **DATUM PR** merged; Vercel production deploy; env `SANO_INTEGRATION_SECRET` and
   `SANO_INTEGRATION_STAFF_ID` (after creating the "SANO (sistem)" auth user and `staff` row);
   `pnpm db:preflight`, `pnpm db:migrate` for the index.
2. **SANO PR** merged.
3. Paste **107** after 106 and run its self-check; if it printed the pg_cron NOTICE, enable Cron
   and paste again. The new words reach every phone at once: every surface reads `gate_refs`.
   Re-pasting 101 later restores the old words (re-paste 107); a 107 re-paste overwrites
   "Kelola gerbang" edits.
4. Set `DATUM_API_BASE_URL` and `DATUM_SANO_SECRET`; `deno test` in the function folder; deploy
   `datum-sync --no-verify-jwt` from a main worktree.
5. Create the Database Webhook once (§7).
6. Enter the codes in the Rooms tab for Gading Serpong Zelyn, Citraland K2-7 Sonny and Bukit
   Darmo Golf D-18 Selvia.
7. "Sinkron DATUM" on Citraland first; read Differences and the DATUM project name before the
   other two.
8. OTA from main (channel `preview`) for the board chips and detail row; no native module, so no
   build. Old phones lack only those two surfaces.

## 14. Cost

pg_cron and Database Webhooks cost nothing extra. Hourly for three paired active projects is 72
invocations a day, about 2,200 a month (the approved note's ~720 is one project), against a
500,000 allowance; each run makes three DATUM calls plus one per escalation, about 6,500 a month.
The real cost is upkeep, held to four routes, one function, one migration per repo, and the
static, twin and route tests that fail when either side drifts.

## 15. Calibration items

| # | Item | Owner | Trigger |
|---|---|---|---|
| 1 | DATUM's gate B description still describes the old bathroom bundle (`20260531000003_seed_gates_and_checkpoints.sql:10-12`) under the reframed name; SANO copies it verbatim and the analysis prompt reads it. DATUM's `RulesViewer.tsx:41-50` also still says "Pekerjaan Kamar Mandi". Fix both in DATUM; the next run lists B under "Kata gerbang berbeda"; a follow-up SANO migration copies it. | User (DATUM) | Before the pilot relies on AI gate picks for B. |
| 2 | Past events read under new words, mostly kusen work filed as C or D. | PM | 107's grid shows events under C or D. |
| 3 | Hourly includes nights and Sundays. | User | Run log reads as noise; move to `0 23-13 * * 1-6` UTC (06:00-20:00 WIB). |
| 4 | "lama" after 24 h is a constant. | PM | The board reads "lama" every Monday morning. |
| 5 | The "SANO (sistem)" staff row is inactive; some DATUM view may hide its name as author. | User (DATUM) | A card shows no author. |
| 6 | 20 escalations per run. | Implementer | `escalate_deferred > 0` on two runs in a row. |
