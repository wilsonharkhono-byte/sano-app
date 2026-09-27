# DATUM Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SANO's eight gates take DATUM's words; a paired SANO project links its rooms to DATUM areas by code and creates the missing ones; DATUM's area-by-gate readiness shows on Papan Ruangan exactly as DATUM states it; every confirmed "butuh keputusan" becomes one DATUM decision card, once, authored by the person's own DATUM account when the names match; and a project DATUM mapped first can take its rooms with "Ambil n ruangan dari DATUM".

**Architecture:** Four lanes across two repos. Lane D (DATUM) adds one index migration, a constant-time bearer helper and five routes under `apps/web/app/api/integrations/sano/`, tested with an in-memory service-role fake that records every write. Lane M (SANO database) writes migration 107 (DATUM's gate words, the pairing RPC, three sync-only guard triggers, the confirmer stamp, DATUM's thirteen room types, the readiness cache, the run log, the hourly request queue) with its static guard and a Docker rehearsal. Lane F (SANO sync function) puts every decision in a pure, byte-twinned planner (`tools/datumSyncPlan.ts`, jest in CI) and builds the `datum-sync` edge function around it with injected store, DATUM client and caller check, tested in Deno against a fake DATUM. Lane U (SANO app) adds the read helpers, the Rooms-tab "DATUM" card, the board chips and the event detail's DATUM rows. The lanes meet only through the interfaces in *Shared interfaces*; no file is edited by two lanes.

**Tech Stack:** SANO: TypeScript, React Native (Expo SDK 54 / RN 0.81), React Navigation 6, Supabase Postgres (hand-pasted migrations, pg_cron, Database Webhooks), Deno edge functions (`jsr:@supabase/supabase-js@2.105.1`, `jsr:@std/assert@1.0.19`), jest + ts-jest + React Native Testing Library, Docker `supabase/postgres` for the rehearsal. DATUM: turbo/pnpm monorepo, Next.js 16 route handlers (`runtime = "nodejs"`), `@datum/core` (zod), vitest 4. Indonesian UI copy, no i18n library. No new dependency in either repo and no native module, so SANO's release is an OTA.

**Spec:** `docs/superpowers/specs/2026-09-27-datum-sync-design.md`, every section, with one change the owner made after it was written: **every office role (admin, principal, estimator; `is_office_role()`) may press "Sinkron DATUM"**, not only admin and principal (spec §6.1, §8.1, §10, §11.3-§11.5 and calibration item 9 are read that way throughout; see *Deliberate differences* 1). `CLAUDE.md` §12 (the user's truth contract) binds every task: no success before the server's yes, a failed read renders an error and never an empty state, nothing is guessed to make two lists agree.

**Branches and working trees.**

- SANO: branch `feat/datum-sync`, head `b81706c` when this plan was written, worktree `/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync`, `node_modules` installed. Lanes M, F and U run here.
- DATUM: branch `feat/sano-integration`, head `ff2f0b3`, worktree `/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration`, `node_modules` installed (root and `apps/web`). Lane D runs here. If `apps/web/node_modules` is ever missing, run `pnpm install --frozen-lockfile` from the DATUM worktree root first, and nothing else that changes the lockfile.

Every command below starts with `cd "<worktree>" &&` because agent shells reset their directory between calls.

**How this plan was checked before it was written.** Every code block was applied to the two worktrees (SANO at `b81706c`, DATUM at `ff2f0b3`) and reverted afterwards. Results at the end state: DATUM `pnpm vitest run` in `apps/web` 123 files / 1162 tests passed (the 6 new files among them), `pnpm typecheck` in `apps/web` clean, `npx eslint` on every new file clean, `pnpm vitest run` in `packages/db` 8 files passed; SANO `npx tsc --noEmit -p .` clean, the integration command's 49 suites passed (985 tests), every `tools/__tests__/migration*` suite passed (21 suites) with 107 in place, `deno test` in `supabase/functions/datum-sync` 30 passed, `deno check index.ts` and `deno lint` clean. Intermediate states were rebuilt and run too: the planner after each of F-T1 to F-T5 (3, 19, 22, 31, 34 tests), the function folder after F-T7, F-T8 and F-T9 (5, 20, 30 Deno tests; 4, 6, 8 files linted), and the failing runs of U-T1, U-T5, U-T6 and U-T7 against the files at `b81706c`. Every `replace` in Lane U was asserted to occur exactly once in the file it edits and to produce the verified file. The "verify it fails" steps were reproduced for the module-missing cases (vitest: `Cannot find package '@/lib/...'`; jest: `Cannot find module`), not for every task. **Not run:** the Docker rehearsal (Lane M Task 2; running SQL was out of bounds while planning, so its tally `PASS=72` is counted from its checks and its first run is part of the task), `pnpm db:preflight` (it reads DATUM's remote ledger), and anything against either Supabase project.

---

## Conventions (every task relies on these)

**SANO tests.** Jest in the SANO worktree must be run exactly like this, or the repo's `testPathIgnorePatterns` (which lists `/.claude/worktrees/`) hides every test:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest <path> --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

- Every run step names its suites. Never run the whole suite: a full run rewrites `assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx`. If it ever happens, run `git restore assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx` and never commit that file.
- Render suites need `jest.setTimeout(20000)`; every render test below sets it.
- `Platform` from `react-native` can be `undefined` under this jest setup, so new code reads `Platform?.OS` (none of the new code needs `Platform`).
- Rendering a react-native `Image` needs the per-test `jest.mock('react-native/Libraries/Image/Image', ...)` from `workflows/components/__tests__/StoragePhoto.test.tsx`. None of the new render tests renders an `Image` (they mock `MediaStrip`); if you add one that does, copy that mock.
- SANO type check: `cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx tsc --noEmit -p .` must print nothing for the files the task owns. `supabase/functions/**` is excluded from it.

**SANO edge function (Deno).** From the function folder:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test
```

`deno check index.ts` and `deno lint` run from the same folder. CI runs only tsc and jest (`.github/workflows/ci.yml`), so the Deno tests are a release step as well as a task step. `deno test` writes a `deno.lock` in the folder it runs in: delete it afterwards (`rm -f deno.lock`) and never commit one.

**DATUM tests and checks** (Lane D only):

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/<file>.test.ts
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm typecheck
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && npx eslint <files>
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/packages/db" && pnpm vitest run
```

`apps/web` is compiled with `noUncheckedIndexedAccess`: index into an array in a test with `rows[0]!`. DATUM's migration drift check is `pnpm db:preflight` (from the DATUM worktree root); it reads the remote ledger of DATUM's Supabase project, so agents executing this plan do not run it: the owner runs it right before `pnpm db:migrate` (see *Release*). Never run `pnpm db:migrate`, `db:reset` or `db:types`.

**Git, in both repos.** The SANO worktree is shared by three lanes at once, so:

- Every commit uses an explicit pathspec, exactly `git add <files> && git commit -F <msgfile> -- <files>`, listing only the task's own files. Never `git add -A`, `git add .`, `git commit -a`, `git stash`, `git checkout -- .`, `git restore .` or `git clean`.
- Write the commit message to a file in `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/` with the Write tool. Never build it with a heredoc, and never chain heredocs with `\` continuations. Every message ends with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; each commit step below gives the message in full.
- Before editing a file, `git status --porcelain <file>` should print nothing unless this task already touched it. If it shows a change you did not make, another lane is in the wrong file: stop and report.
- If `tsc` reports errors only in files another lane owns (see *Lanes*), that lane is mid-task. Wait a minute and run it again; never edit their file to make yours pass.

**SANO migrations.** Pasted by hand into the Supabase Dashboard SQL editor (remote migration history is divergent; `supabase db push` is broken). So 107:

- starts with a header comment: spec link, plan link, PASTE ORDER, RE-PASTE SAFETY, and what re-pasting an older file undoes;
- runs `SET lock_timeout = '5s';` first and `RESET lock_timeout;` once, after the last statement that changes anything;
- drops by exact signature before re-creating (`DROP FUNCTION IF EXISTS <exact signature>` before `CREATE OR REPLACE`), uses `DROP POLICY/TRIGGER IF EXISTS` and `CREATE TABLE/INDEX IF NOT EXISTS`, and adds constraints inside `pg_constraint` guards;
- ends with a `-- SELF-CHECK` footer whose `EXPECTED:` lines the static guard counts.
- Its static guard, `tools/__tests__/migration107.test.ts`, reads the SQL with full-line comments stripped (`src.replace(/^\s*--.*$/gm, '')`, as `migration106.test.ts` does), so a comment can never satisfy a guard.

**Copy.** Indonesian copy, the en and em dash, the middle dot, the ellipsis and the arrow are written as plain UTF-8, never as `\uXXXX` escapes (typed escapes arrive as raw characters in this environment). A test that needs an invisible character builds it with `String.fromCharCode(...)`, as `datumSyncPlanPeople.test.ts` does. After writing a file, `LC_ALL=C grep -nP '\xCC[\x80-\xFF]|\xCD[\x80-\xAF]|\xE2\x80[\x8B-\x8F]' <file>` must print nothing.

**Truth contract (CLAUDE.md §12), applied.** A sync button changes only its own label until the server answered; the card then reloads the run table. A failed read renders "... gagal dimuat." with "Coba lagi", never "Belum pernah ..." or an empty list. A link (room, staff, card) is written only by the sync, and only on an exact code or a unique exact name; nothing is renamed, merged or deleted in either database.

**Boundaries.** Never call either Supabase project, never read `.env*`, never run SQL against any database. The one exception is Lane M Task 2, which runs SQL only inside its own disposable Docker container. Never paste a migration, set a secret, deploy a function or apply a DATUM migration: those are the owner's steps (see *Release*).

---

## Shared interfaces

Fixed before any lane starts. Build against them exactly; each is created by the task named beside it.

### DATUM routes (Lane D; called by Lane F)

Base: `${DATUM_API_BASE_URL}/api/integrations/sano`. Every request carries `Authorization: Bearer <secret>` (DATUM env `SANO_INTEGRATION_SECRET`, SANO secret `DATUM_SANO_SECRET`, the same value). Every answer is JSON with `ok`.

```ts
// Refusals, every route: { ok: false, code, error } where
//   UNAUTHORIZED 401 · NOT_CONFIGURED 503 · BAD_REQUEST 400 · UNKNOWN_PROJECT 404
//   UNKNOWN_AREA 404 · TOPIC_MISSING 409 · DB_ERROR 500
// Item errors of POST areas: 'CODE_NOT_NORMALIZED' | 'INVALID' | 'DB_ERROR'

// GET areas?project_code=K2-7                                  (D-T3)
{ ok: true, project: { id: string; project_code: string; project_name: string },
  areas: Array<{ id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number }> }

// GET gate-status?project_code=K2-7                            (D-T3)
{ ok: true,
  gates: Array<{ code: string; name: string; description: string | null; sort_order: number }>,
  statuses: Array<{ area_id: string; gate_code: string; status: string; stale: boolean;
                    last_recomputed_at: string | null; updated_at: string | null }>,
  read_at: string }

// GET staff  (active rows only; nothing but id and full_name)  (D-T3)
{ ok: true, staff: Array<{ id: string; full_name: string }> }

// POST areas  body { project_code, areas: Array<{ area_code; area_name; floor: string | null; area_type; tracked?: boolean }> } (1-200)   (D-T4)
{ ok: true, areas: Array<{ area_code: string; id: string; created: boolean }>,
  errors: Array<{ area_code: string; code: 'CODE_NOT_NORMALIZED' | 'INVALID' | 'DB_ERROR' }> }

// POST escalate  body (D-T5):
{ project_code: string; area_id: string /* uuid */; sano_event_id: string /* uuid */; sano_url: string;
  title: string /* 1-80 */; summary: string | null /* ≤300 */; room_name: string; reporter_name: string;
  confirmer_name: string | null; owner_name: string; due_date: string /* YYYY-MM-DD */;
  confirmed_at: string /* ISO */; author_staff_id: string | null /* uuid */ }
// answer
{ ok: true, card_id: string; card_url: string; created: boolean; author: 'linked' | 'system' }
```

DATUM env: `SANO_INTEGRATION_SECRET` (all five routes), `SANO_INTEGRATION_STAFF_ID` (escalate only; the "SANO (sistem)" staff row).

### SANO planner, `tools/datumSyncPlan.ts` (Lane F; byte copy `supabase/functions/datum-sync/plan.ts`)

```ts
// F-T1 - shared types and the verdict
export type SyncStep = 'areas' | 'link' | 'create' | 'gate_status' | 'staff' | 'escalate' | 'import';
export type StepOutcome = 'ok' | 'error' | 'skipped';
export type SyncSource = 'manual' | 'cron' | 'import';
export interface PlanRoom { id: string; room_code: string | null; room_name: string; floor: string | null; area_type: string; sort_order: number; active: boolean; datum_area_id: string | null }
export interface PlanArea { id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number }
export interface LinkItem { room_id: string; room_code: string; area_id: string }
export interface CreateItem { room_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; tracked: boolean }
export interface CreateFailedItem { room_code: string; reason: string }
export interface DatumOnlyItem { area_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number }
export type ConflictField = 'name' | 'floor' | 'area_type';
export interface FieldConflict { room_code: string; field: ConflictField; sano: string; datum: string }
export interface DuplicateItem { key: string; area_codes: string[] }
export interface RoomSyncPlan { link: LinkItem[]; create: CreateItem[]; createFailed: CreateFailedItem[]; datumOnly: DatumOnlyItem[];
  fieldConflicts: FieldConflict[]; datumDuplicates: DuplicateItem[]; retiredMissing: string[]; matchedCount: number }
export interface ImportItem { area_id: string; area_code: string; room_code: string; room_name: string; floor: string | null; area_type: string; sort_order: number }
export interface ImportSkip { area_code: string; reason: string }
export interface ImportPlan { insert: ImportItem[]; skipped: ImportSkip[] }
export interface PlanProfile { id: string; full_name: string | null; datum_staff_id: string | null }   // no `active`: live profiles has none
export interface PlanStaff { id: string; full_name: string }
export type AmbiguousSide = 'datum' | 'sano' | 'linked_elsewhere';
export type StaleReason = 'staff_gone' | 'name_differs' | 'not_unique';
export interface StaffNameItem { profile_id: string; full_name: string }
export interface StaffAmbiguousItem extends StaffNameItem { side: AmbiguousSide }
export interface StaffStaleItem extends StaffNameItem { staff_id: string; staff_name: string | null; reason: StaleReason }
export interface StaffLinkPlan { set: Array<{ profile_id: string; staff_id: string }>; unchanged: string[]; unmatched: StaffNameItem[]; ambiguous: StaffAmbiguousItem[]; stale: StaffStaleItem[] }
export interface DatumGateWord { code: string; name: string; description: string | null }
export interface SanoGateWord { code: string; name_id: string; description: string | null }
export interface GateWordDiff { code: string; field: 'name' | 'description' | 'missing_in_sano' }
export interface StaffCounts { linked: number; linked_now: number; unmatched: number; ambiguous: number; stale: number }
export interface RunCounts { steps: Partial<Record<SyncStep, StepOutcome>>; step_errors?: Partial<Record<SyncStep, string>>;
  datum_project_name?: string; rooms_linked?: number; rooms_linked_now?: number; rooms_created?: number; rooms_imported?: number;
  datum_only?: number; field_conflicts?: number; retired_missing?: number; gate_rows?: number; gate_rows_unlinked?: number; gate_area_ids?: string[];
  staff?: StaffCounts; escalated?: number; escalated_as_system?: number; escalate_failed?: number; escalate_skipped?: number; escalate_deferred?: number }
export interface EscalateSkipItem { event_id: string; room_code: string; title: string; reason: string }
export interface RunDifferences { datum_only?: Array<{ area_code: string; area_name: string; floor: string | null; area_type: string }>;
  field_conflicts?: FieldConflict[]; datum_duplicates?: DuplicateItem[]; create_failed?: CreateFailedItem[]; import_skipped?: ImportSkip[];
  staff?: { unmatched: StaffNameItem[]; ambiguous: StaffAmbiguousItem[]; stale: StaffStaleItem[] };
  escalate_skipped?: EscalateSkipItem[]; gate_words?: GateWordDiff[] }
export interface RunReport { ok: boolean; runId: string; counts: RunCounts; differences: RunDifferences; error: string | null }
export const STEP_ORDER: ReadonlyArray<SyncStep>;           // ['areas','link','create','import','gate_status','staff','escalate']
export function runVerdict(counts: RunCounts): { ok: boolean; error: string | null };

// F-T2 - codes and rooms
export const PLAN_ROOM_CODE_MAX = 40;
export function normalizeCode(raw: string): string;          // === normalizeRoomCode === DATUM normalizeAreaCode
export function isPlanValidRoomCode(code: string): boolean;  // === isValidRoomCode
export const UMUM_CODE = 'UMUM';
export const NAME_TOO_LONG: string;                          // 'Nama ruangan lebih dari 120 karakter; DATUM menolaknya.'
export function foldText(s: string | null | undefined): string;
export function planRoomSync(rooms: ReadonlyArray<PlanRoom>, areas: ReadonlyArray<PlanArea>): RoomSyncPlan;
export function createGateOpen(plan: RoomSyncPlan, areaCount: number): boolean;
export function createGateSentence(datumProjectName: string): string;

// F-T3 - the import
export const IMPORT_GONE: string;                            // 'Sudah ada di SANO atau tidak lagi ada di DATUM.'
export const importBadCode: (code: string) => string;
export const importRaced: (code: string) => string;
export function planImport(plan: RoomSyncPlan, confirmedCodes: ReadonlyArray<string>): ImportPlan;

// F-T4 - people
export function normalizePersonName(s: string | null | undefined): string;
export function planStaffLinks(profiles: ReadonlyArray<PlanProfile>, staff: ReadonlyArray<PlanStaff>): StaffLinkPlan;
export function staffCounts(plan: StaffLinkPlan): StaffCounts;

// F-T5 - gate words and escalation
export function diffGateWords(datum: ReadonlyArray<DatumGateWord>, sano: ReadonlyArray<SanoGateWord>): GateWordDiff[];
export const ESCALATE_BATCH = 20;
export const ESCALATE_ROOM_UNLINKED: string;                 // 'Ruangan belum tertaut ke area DATUM.'
export function sanoRoomUrl(projectCode: string, roomCode: string): string;   // === buildRoomUrl
export function escalationAuthor(reporterStaffId: string | null, confirmerStaffId: string | null): string | null;
```

### The `datum-sync` function (Lane F; called by Lane U and by the Database Webhook)

```ts
// POST, deployed --no-verify-jwt; handler.ts checks both ways in.
// 1. Button:  Authorization: Bearer <user JWT>, body { projectId: uuid }                                 source 'manual'
// 2. Import:  Authorization: Bearer <user JWT>, body { projectId, importDatumOnly: true, areaCodes: string[] /* 1-200, each 1-40 */ }  source 'import'
//    Both need is_office_role() (admin, principal, estimator).
// 3. Webhook: Authorization: Bearer <WEBHOOK_AUTH_SECRET>, body { type: 'INSERT', table: 'datum_sync_requests', record: { id, project_id } }  source 'cron'
//
// 200 RunReport (above) whenever the run row was written by a button or import call; a failed step is ok: false inside it.
// 202 { ok: true, code: 'ACCEPTED', runId }                  webhook, the run continues in waitUntil
// 409 { ok: false, code: 'PAIRING_MISSING', error: 'Proyek ini belum ditautkan ke DATUM.', runId }
// refusals { ok: false, code, error }:
//   405 METHOD · 500 CONFIG · 400 BAD_REQUEST · 401 AUTH · 404 NOT_FOUND
//   403 FORBIDDEN ('Hanya peran kantor (admin, prinsipal, estimator) yang dapat menyinkronkan DATUM.' /
//                  'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.')
//   409 SYNC_RUNNING ('Sinkron DATUM untuk proyek ini sedang berjalan.') · 500 UNEXPECTED
// Secrets: DATUM_API_BASE_URL, DATUM_SANO_SECRET, WEBHOOK_AUTH_SECRET (+ runtime SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
```

### SANO database objects of migration 107 (Lane M; read and written by Lanes F and U)

```sql
-- projects.datum_project_code (096): CHECK projects_datum_project_code_shape (upper(btrim), non-empty), UNIQUE idx_projects_datum_project_code
-- set_datum_project_code(p_project_id UUID, p_code TEXT) RETURNS JSONB {"code": <text|null>}  SECURITY DEFINER, office roles
--   refusals: 'DATUM_PAIRING_AUTH: ...', 'DATUM_PAIRING_TAKEN: ...', 'DATUM_PAIRING_PROJECT: ...'
-- rooms.area_type CHECK: bathroom kitchen bedroom living dining garden circulation utility general facade terrace hall exterior
-- rooms.datum_area_id                    sync-only (ROOM_DATUM_LINK_SYNC_ONLY)
-- site_events.datum_card_id UUID, datum_card_url TEXT, datum_escalated_at TIMESTAMPTZ, confirmed_by UUID -> profiles (FK site_events_confirmed_by_fkey)
--                                        sync-only (SITE_EVENT_SYSTEM_COLUMNS); confirmed_by stamped from auth.uid() by the trigger
-- profiles.datum_staff_id UUID           sync-only (PROFILE_DATUM_LINK_SYNC_ONLY), UNIQUE idx_profiles_datum_staff_id
-- datum_sync_runs(id, project_id, source 'manual'|'cron'|'import', requested_by -> profiles (FK datum_sync_runs_requested_by_fkey),
--                 request_id, started_at, finished_at, ok, counts JSONB, differences JSONB, error)
--   UNIQUE datum_sync_runs_one_open (project_id) WHERE finished_at IS NULL; SELECT: member or office
-- room_datum_gate_status(room_id, gate_code, project_id, datum_area_id, status (DATUM's six), datum_stale,
--                        datum_updated_at, datum_recomputed_at, synced_at, run_id)  PK (room_id, gate_code); SELECT: member or office
-- datum_sync_requests(id, project_id, requested_at, handled_at, run_id, error); SELECT: office
-- cron job 'datum_sync_hourly' '0 * * * *': one request per paired ACTIVE project
```

### SANO app helpers (Lane U)

```ts
// tools/datumGateStatus.ts - U-T2
export type DatumReadiness = 'not_started' | 'in_progress' | 'ready_for_handoff' | 'blocked' | 'passed' | 'not_applicable';
export const DATUM_READINESS_LABELS: Record<DatumReadiness, string>;
export interface DatumGateRow { room_id: string; gate_code: string; datum_area_id: string; status: DatumReadiness; datum_stale: boolean; synced_at: string }
export type DatumGateStatusResult = { paired: false }
  | { paired: true; lastGateReadAt: string | null; readAreaIds: string[]; roomLinks: Record<string, string | null>; rows: DatumGateRow[] }
  | { error: string };
export async function listDatumGateStatus(projectId: string): Promise<DatumGateStatusResult>;
export type DatumChipState = { kind: 'hidden' } | { kind: 'never' } | { kind: 'none' }
  | { kind: 'chips'; chips: Array<{ gate_code: string; status: DatumReadiness; label: string }>; asOf: string; old: boolean; datumStale: boolean };
export function datumChipsForRoom(room: { room_id: string }, result: DatumGateStatusResult | null, nowIso: string): DatumChipState;

// tools/datumSync.ts - U-T3
export function canPairDatum(role: UserRoleType | null | undefined): boolean;   // admin, principal, estimator
export function canSyncDatum(role: UserRoleType | null | undefined): boolean;   // the same set
export async function setDatumProjectCode(projectId: string, code: string): Promise<{ code: string | null } | { error: string }>;
export type DatumCallResult = { run: RunReport } | { error: string; code: string };
export function syncDatum(projectId: string): Promise<DatumCallResult>;
export function importFromDatum(projectId: string, areaCodes: string[]): Promise<DatumCallResult>;
export interface DatumRun { id; project_id; source; requested_by; requester_name: string | null; started_at; finished_at: string | null;
  ok: boolean | null; counts: RunCounts; differences: RunDifferences; error: string | null }
export interface DatumSyncState { latest: DatumRun | null; latestFinished: DatumRun | null; staffRun: DatumRun | null; waiting: { count: number; oldestAt: string } | null }
export async function getDatumSyncState(projectId: string, nowIso?: string): Promise<DatumSyncState | { error: string }>;

// tools/siteEvents.ts - U-T7: SiteEventWithMedia gains
//   confirmed_by_name: string | null; project_datum_code: string | null
// tools/types.ts - U-T7: SiteEvent gains optional datum_card_id, datum_card_url, datum_escalated_at, confirmed_by
```

**No stubs across lanes.** The only compile-time crossing is Lane U importing the planner's types and `STEP_ORDER`. They all land in Lane F Task 1, which is small and first in Lane F, so Lane U Tasks 3-4 wait for its commit instead of stubbing. Lane M Task 1's guard compares 107's type list with `AREA_TYPES`, which Lane U Task 1 widens; it waits for that commit. Everything else crosses at run time only (HTTP, SQL), where the interfaces above are the contract and each side's tests pin its half.

---

## File structure

| File | Lane | Responsibility |
|---|---|---|
| **DATUM** `packages/db/supabase/migrations/20260927000001_cards_sano_event_unique.sql` (create) | D | Partial unique index on `cards.properties->>'sano_event_id'`. |
| `apps/web/tests/unit/sano-integration-migration.test.ts` (create) | D | Static check of that file: newest, one transaction, the index, nothing else. |
| `apps/web/lib/integrations/sano/auth.ts` (create) | D | `sanoAuth`: SHA-256 digests compared with `timingSafeEqual`; unset secret is `not_configured`. |
| `apps/web/lib/integrations/sano/reply.ts` (create) | D | `sanoError`, `sanoOk`, the code-to-status map. |
| `apps/web/lib/integrations/sano/project.ts` (create) | D | `resolveProject`: `project_code` upper case, 404 sentence. |
| `apps/web/lib/integrations/sano/gate.ts` (create) | D | `openSanoRequest`: bearer first, service-role client second. |
| `apps/web/lib/integrations/sano/areas.ts` (create) | D | `PostAreasBody`, `areaItemError`, `ensureAreas` (insert-only, 23505 re-read, seed). |
| `apps/web/lib/integrations/sano/escalate.ts` (create) | D | `EscalateBody`, `escalationNote`, `escalateDecision` (idempotent, self-repairing). |
| `apps/web/app/api/integrations/sano/areas/route.ts` (create) | D | `GET` areas, `POST` areas. |
| `apps/web/app/api/integrations/sano/gate-status/route.ts` (create) | D | `GET` gates and area-gate status. |
| `apps/web/app/api/integrations/sano/staff/route.ts` (create) | D | `GET` active staff, id and name only. |
| `apps/web/app/api/integrations/sano/escalate/route.ts` (create) | D | `POST` escalate. |
| `apps/web/tests/unit/sano-fake-admin.ts` (create) | D | In-memory service-role fake that records writes; the shared two-project fixture. |
| `apps/web/tests/unit/sano-integration-{auth,reads,areas,escalate,routes}.test.ts` (create) | D | The route suites. |
| **SANO** `supabase/migrations/107_datum_sync.sql` (create) | M | Gate words, pairing, guards, stamp, types, three tables, scheduler. |
| `tools/__tests__/migration107.test.ts` (create) | M | Static guard for 107. |
| `tools/__tests__/migration101.test.ts` (modify) | M | Its "nothing later writes the words" scan exempts 107 by name and checks 107's re-paste sentence. |
| `supabase/tests/datum_sync_rehearsal/{run.sh,fixture.sql,rehearse_107.sql,rehearse_repaste.sql}` (create) | M | 107 as real roles on a disposable Postgres. |
| `tools/datumSyncPlan.ts` (create) | F | The pure planner and every shared sync type. |
| `tools/__tests__/datumSyncPlan{Verdict,,Import,People,Words}.test.ts` (create) | F | Planner tests, one file per task. |
| `tools/__tests__/datumSyncPlanTwin.test.ts` (create) | F | `plan.ts` byte-identical; the function's writes and reads pinned as text. |
| `supabase/functions/datum-sync/plan.ts` (create) | F | Byte copy of the planner. |
| `supabase/functions/datum-sync/deno.json` (create) | F | Pinned imports, as `site-event-analyze/deno.json`. |
| `supabase/functions/datum-sync/datum.ts` (create) | F | `makeDatumApi`: the five calls, 15 s timeout, failure sentences. |
| `supabase/functions/datum-sync/run.ts` (create) | F | `SyncStore`, `startRun`, `executeSync`, `executeImport`. |
| `supabase/functions/datum-sync/handler.ts` (create) | F | `createHandler`: webhook and user paths, `bearerMatches`. |
| `supabase/functions/datum-sync/store.ts` (create) | F | `makeSupabaseStore`: `SyncStore` over the service-role client. |
| `supabase/functions/datum-sync/index.ts` (create) | F | Wiring: env, `verifyCaller`, `EdgeRuntime.waitUntil`, `Deno.serve`. |
| `supabase/functions/datum-sync/testing.ts` (create) | F | `FakeStore`, `fakeDatum`, `world`, `decision` for the Deno tests. |
| `supabase/functions/datum-sync/{datum,run,handler}.test.ts` (create) | F | Deno tests. |
| `tools/types.ts` (modify) | U | `AreaType` thirteen (U-T1); optional DATUM columns on `SiteEvent` (U-T7). |
| `tools/constants.ts` (modify) | U | `AREA_TYPES`, `AREA_TYPE_LABELS` thirteen. |
| `workflows/screens/siteEvent/GateChipRow.tsx`, `workflows/__tests__/GateChipRow.test.tsx` (modify) | U | Comment and fixture take DATUM's words. |
| `office/screens/rooms/__tests__/RoomForm.types.test.tsx` (create) | U | The picker offers thirteen types. |
| `tools/datumGateStatus.ts` + `tools/__tests__/datumGateStatus.test.ts` (create) | U | Board read and chip state. |
| `tools/datumSync.ts` + `tools/__tests__/datumSync.test.ts` (create) | U | Pairing, sync, import calls; the card's read. |
| `office/screens/rooms/datumSyncModel.ts` + `__tests__/datumSyncModel.test.ts` (create) | U | Every sentence of the card, pure. |
| `office/screens/rooms/DatumSyncCard.tsx` + `__tests__/DatumSyncCard.test.tsx` (create) | U | The card. |
| `office/screens/RoomsAdminScreen.tsx`, `office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx` (modify) | U | Mount the card above "Ekspor untuk DATUM". |
| `office/screens/rooms/DatumRoomLine.tsx` (create), `office/screens/rooms/RoomBoardView.tsx` (modify) | U | Chips under each room; the read-error line. |
| `office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx` (create), `RoomBoardView.attention.test.tsx` (modify) | U | Board states; the old suite mocks the DATUM read. |
| `tools/siteEvents.ts`, `tools/__tests__/siteEvents.test.ts` (modify) | U | `EVENT_SELECT` embeds the confirmer and the pairing. |
| `workflows/screens/siteEvent/datumEscalation.ts` (create), `workflows/screens/SiteEventDetailScreen.tsx` (modify) | U | "Dikonfirmasi … oleh", "Dikirim ke DATUM", "Belum dikirim". |
| `workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx` (create) | U | The detail's DATUM rows. |

---

## Lanes

| Lane | Name | Repo | Tasks | Owns |
|---|---|---|---|---|
| D | DATUM | DATUM | D-T1 index migration · D-T2 auth, reply, project, fake · D-T3 three reads · D-T4 POST areas · D-T5 escalate · D-T6 all five routes | everything under `apps/web/lib/integrations/sano/`, `apps/web/app/api/integrations/sano/`, `apps/web/tests/unit/sano-*`, and the one migration file |
| M | SANO database | SANO | M-T1 migration 107 · M-T2 Docker rehearsal | `supabase/migrations/107_datum_sync.sql`, `tools/__tests__/migration107.test.ts`, `tools/__tests__/migration101.test.ts`, `supabase/tests/datum_sync_rehearsal/` |
| F | SANO sync function | SANO | F-T1 types and verdict · F-T2 codes and rooms · F-T3 import · F-T4 people · F-T5 words and escalation · F-T6 twin · F-T7 DATUM client · F-T8 runs · F-T9 handler · F-T10 store and wiring | `tools/datumSyncPlan.ts`, `tools/__tests__/datumSyncPlan*.test.ts`, `supabase/functions/datum-sync/` |
| U | SANO app | SANO | U-T1 thirteen types · U-T2 board read · U-T3 sync calls · U-T4 card words · U-T5 card · U-T6 board chips · U-T7 event detail | `tools/types.ts`, `tools/constants.ts`, `tools/datumGateStatus.ts`, `tools/datumSync.ts`, `tools/siteEvents.ts`, their tests, `office/screens/rooms/{DatumSyncCard,DatumRoomLine,datumSyncModel,RoomBoardView}.*` and their tests, `office/screens/RoomsAdminScreen.tsx` and its test, `workflows/screens/siteEvent/{GateChipRow.tsx,datumEscalation.ts}`, `workflows/__tests__/GateChipRow.test.tsx`, `workflows/screens/SiteEventDetailScreen.tsx` and its new test |

**Cross-lane dependencies** (a task may start only when every task it names is committed):

| Task | Waits for | Why |
|---|---|---|
| M-T1 | **U-T1** | the guard compares 107's CHECK with `AREA_TYPES`, which U-T1 widens to thirteen |
| U-T3 | **F-T1** | `RunCounts`, `RunDifferences`, `RunReport` |
| U-T4 | U-T3, U-T1, **F-T1** | `STEP_ORDER`, `GateWordDiff`, the four new type labels |
| M-T2 | M-T1 | rehearses the committed 107 |
| F-T6 | F-T1 to F-T5 | the twin copies the finished planner |

Inside a lane, tasks run in their order. Lane D never waits: DATUM is its own repo, and SANO only needs D's routes at run time.

**Suggested schedule.**

| Wave | Lane D | Lane M | Lane F | Lane U |
|---|---|---|---|---|
| 1 | D-T1, D-T2 | | F-T1, F-T2 | U-T1, U-T2 |
| 2 | D-T3, D-T4 | M-T1 | F-T3, F-T4, F-T5 | U-T3, U-T4 |
| 3 | D-T5, D-T6 | M-T2 | F-T6, F-T7, F-T8 | U-T5, U-T6 |
| 4 | | | F-T9, F-T10 | U-T7 |

---
## Lane D: DATUM

All six tasks run in the DATUM worktree. Nothing here depends on SANO, and nothing in SANO depends on these commits until run time.

### D-T1 (Lane D, Task 1): The DATUM index: one card per SANO event

Spec §5.4. A partial unique index on `cards.properties->>'sano_event_id'` serves the escalate route's lookup and turns two truly simultaneous creates into one card and one 23505. In the `20260601000015` shape (`begin; ... commit;`). The owner applies it (`pnpm db:preflight`, `pnpm db:migrate`); an index changes no generated type.

**Files:**
- Create: `packages/db/supabase/migrations/20260927000001_cards_sano_event_unique.sql`
- Create: `apps/web/tests/unit/sano-integration-migration.test.ts`

**Depends on:** nothing.

- [ ] **Step 1: Write the failing static check**

Create `apps/web/tests/unit/sano-integration-migration.test.ts` with exactly this content:

```ts
/**
 * sano-integration-migration.test.ts
 *
 * Static check of the one DATUM migration the SANO integration adds
 * (SANO spec 2026-09-27 §5.4). The file is applied by the owner with
 * `pnpm db:preflight` then `pnpm db:migrate`; this suite only reads its text.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "../../../../packages/db/supabase/migrations");
const FILE = "20260927000001_cards_sano_event_unique.sql";
const SQL = readFileSync(join(DIR, FILE), "utf8");
const CODE = SQL.replace(/^\s*--.*$/gm, "");

describe("20260927000001_cards_sano_event_unique.sql", () => {
  it("is the newest migration, so it applies after card_event_member_alerts", () => {
    const files = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    expect(files[files.length - 1]).toBe(FILE);
    expect(files[files.length - 2]).toBe("20260926000001_card_event_member_alerts.sql");
  });

  it("runs in one transaction, like 20260601000015", () => {
    expect(CODE.trim().startsWith("begin;")).toBe(true);
    expect(CODE.trim().endsWith("commit;")).toBe(true);
  });

  it("creates exactly the partial unique index on the SANO event id", () => {
    expect(CODE).toContain(
      "create unique index if not exists cards_sano_event_id_key\n  on public.cards ((properties->>'sano_event_id'))\n  where properties ? 'sano_event_id';",
    );
  });

  it("changes nothing else: no table, column, policy, function or data statement", () => {
    const statements = CODE.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    expect(CODE).not.toMatch(/\b(alter|drop|insert|update|delete|grant|revoke|policy|function)\b/i);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-migration.test.ts
```

Expected: `FAIL` with `ENOENT: no such file or directory, open '.../20260927000001_cards_sano_event_unique.sql'`.

- [ ] **Step 3: Write the migration**

Create `packages/db/supabase/migrations/20260927000001_cards_sano_event_unique.sql` with exactly this content:

```sql
-- 20260927000001_cards_sano_event_unique.sql
-- SANO integration (SANO spec docs/superpowers/specs/2026-09-27-datum-sync-design.md §5.4):
-- one decision card per SANO site event. POST /api/integrations/sano/escalate
-- looks a card up by properties->>'sano_event_id' before it creates one; this
-- index serves that lookup and turns two truly simultaneous creates into one
-- card and one 23505, which the route answers by re-reading the winner.
-- Partial: only cards SANO made carry the key, every other card is untouched.

begin;

create unique index if not exists cards_sano_event_id_key
  on public.cards ((properties->>'sano_event_id'))
  where properties ? 'sano_event_id';

commit;
```

- [ ] **Step 4: Run the static check and the db package's own migration tests**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-migration.test.ts && cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/packages/db" && pnpm vitest run
```

Expected: `Tests  4 passed (4)` for the first, then `Test Files  8 passed (8)` for `packages/db`.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t1.txt` with the Write tool, exactly:

```text
feat(db): one card per SANO event (cards_sano_event_id_key)

Partial unique index on cards.properties->>'sano_event_id' for the SANO
escalate route: it serves the lookup and turns a truly simultaneous
second create into a 23505 the route answers with the winner. Applied
by the owner with pnpm db:preflight then pnpm db:migrate.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && git add packages/db/supabase/migrations/20260927000001_cards_sano_event_unique.sql apps/web/tests/unit/sano-integration-migration.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t1.txt" -- packages/db/supabase/migrations/20260927000001_cards_sano_event_unique.sql apps/web/tests/unit/sano-integration-migration.test.ts
```

### D-T2 (Lane D, Task 2): The bearer, the replies, the project lookup, and the fake

Spec §5.1. `sanoAuth` digests both sides with SHA-256 and compares them with `timingSafeEqual`, so a wrong header leaks nothing and a wrong length never throws; an unset secret is `not_configured`, never a pass. `resolveProject` looks the code up upper case, as `packages/core/src/projects/by-slug.ts:30-34` does. `openSanoRequest` builds the service-role client only after the bearer passed. `sano-fake-admin.ts` is the in-memory service-role client every route suite uses: it implements exactly the builder calls the routes and `linkCardToArea`/`createCardEvent` make, enforces DATUM's unique keys (including the new index), and records every write so a suite can prove no route updates or deletes. It is not a test file (vitest collects only `*.test.ts`).

**Files:**
- Create: `apps/web/lib/integrations/sano/auth.ts`
- Create: `apps/web/lib/integrations/sano/reply.ts`
- Create: `apps/web/lib/integrations/sano/project.ts`
- Create: `apps/web/lib/integrations/sano/gate.ts`
- Create: `apps/web/tests/unit/sano-fake-admin.ts`
- Create: `apps/web/tests/unit/sano-integration-auth.test.ts`

**Depends on:** D-T1 (same lane, for order only).

- [ ] **Step 1: Write the fake service-role client and the shared fixture**

Create `apps/web/tests/unit/sano-fake-admin.ts` with exactly this content:

```ts
/**
 * sano-fake-admin.ts - an in-memory stand-in for the service-role Supabase
 * client, used by the sano-integration-*.test.ts suites (not a test itself:
 * vitest only collects *.test.ts).
 *
 * It implements exactly the builder calls the five SANO routes and the core
 * helpers they reuse (linkCardToArea, createCardEvent) make: from().select()
 * .eq().in().order().limit().single()/.maybeSingle(), insert() with an
 * optional .select().single(), rpc(), and update()/delete() only so that a
 * call to either is RECORDED. Every write lands in `mutations`, so a test can
 * prove the routes never update or delete a row. Unique keys mirror DATUM's
 * schema, including the new partial index on cards.properties->>'sano_event_id'.
 */

export type Row = Record<string, unknown>;
export interface Mutation {
  op: "insert" | "update" | "delete";
  table: string;
  values: unknown;
}
export interface DbError {
  code?: string;
  message: string;
}
type Result = { data: unknown; error: DbError | null };

const UNIQUE_KEYS: Record<string, string[][]> = {
  projects: [["project_code"]],
  areas: [["project_id", "area_code"]],
  topics: [["project_id", "code"]],
  cards: [["project_id", "slug"], ["properties->>sano_event_id"]],
  card_areas: [["card_id", "area_id"]],
};

/** A column or a PostgREST ->> path, as the routes filter on it. */
function readColumn(row: Row, column: string): unknown {
  const arrow = column.indexOf("->>");
  if (arrow < 0) return row[column];
  const base = row[column.slice(0, arrow)] as Record<string, unknown> | null | undefined;
  const value = base?.[column.slice(arrow + 3)];
  return value === undefined || value === null ? null : String(value);
}

function pick(row: Row, columns: string): Row {
  if (columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const c of columns.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = row[c] ?? null;
  return out;
}

export class FakeAdmin {
  tables: Record<string, Row[]> = {};
  mutations: Mutation[] = [];
  rpcCalls: Array<{ fn: string; args: unknown }> = [];
  /** Runs just before each inserted row lands: a test adds a competing row here. */
  beforeInsert: ((table: string, row: Row) => void) | null = null;
  /** The next statement on this table fails with this error. */
  failNext: Record<string, DbError> = {};
  private seq = 0;

  seed(table: string, rows: Row[]): this {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows.map((r) => ({ ...r }))];
    return this;
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  newId(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rpc(fn: string, args: unknown): Promise<Result> {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: null, error: null });
  }

  writes(op: Mutation["op"]): Mutation[] {
    return this.mutations.filter((m) => m.op === op);
  }

  violatesUnique(table: string, row: Row): boolean {
    for (const key of UNIQUE_KEYS[table] ?? []) {
      const mine = key.map((c) => readColumn(row, c));
      if (mine.some((v) => v === null || v === undefined)) continue;
      if (this.rows(table).some((other) => key.every((c, i) => readColumn(other, c) === mine[i]))) return true;
    }
    return false;
  }
}

export class FakeQuery implements PromiseLike<Result> {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private max: number | null = null;
  private columns = "*";
  private selected = false;
  private op: "select" | "insert" | "update" | "delete" = "select";
  private values: Row[] = [];
  private patch: Row = {};
  private cardinality: "many" | "single" | "maybe" = "many";

  constructor(private db: FakeAdmin, private table: string) {}

  select(columns = "*"): this {
    this.columns = columns;
    this.selected = true;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((r) => readColumn(r, column) === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(readColumn(r, column)));
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push({ column, ascending: opts.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }
  single(): this {
    this.cardinality = "single";
    return this;
  }
  maybeSingle(): this {
    this.cardinality = "maybe";
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]): Result {
    const data = this.selected || this.op === "select" ? rows.map((r) => pick(r, this.columns)) : null;
    if (this.cardinality === "many") return { data, error: null };
    if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "more than one row" } };
    if (rows.length === 0) {
      return this.cardinality === "single"
        ? { data: null, error: { code: "PGRST116", message: "no rows" } }
        : { data: null, error: null };
    }
    return { data: data ? data[0] : null, error: null };
  }

  private run(): Result {
    const failure = this.db.failNext[this.table];
    if (failure) {
      delete this.db.failNext[this.table];
      return { data: null, error: failure };
    }
    if (this.op === "insert") {
      const landed: Row[] = [];
      for (const v of this.values) {
        const row: Row = { id: this.db.newId(), created_at: new Date().toISOString(), ...v };
        this.db.beforeInsert?.(this.table, row);
        if (this.db.violatesUnique(this.table, row)) {
          return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${this.table})` } };
        }
        (this.db.tables[this.table] ??= []).push(row);
        landed.push(row);
      }
      this.db.mutations.push({ op: "insert", table: this.table, values: this.values });
      return this.shape(landed);
    }
    if (this.op === "update") {
      const hit = this.matching();
      this.db.mutations.push({ op: "update", table: this.table, values: this.patch });
      for (const r of hit) Object.assign(r, this.patch);
      return this.shape(hit);
    }
    if (this.op === "delete") {
      const hit = this.matching();
      this.db.mutations.push({ op: "delete", table: this.table, values: null });
      this.db.tables[this.table] = this.db.rows(this.table).filter((r) => !hit.includes(r));
      return this.shape(hit);
    }
    let rows = this.matching();
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.column] as number | string;
        const y = b[o.column] as number | string;
        if (x === y) return 0;
        return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
      });
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return this.shape(rows);
  }
}

// ─── A two-project DATUM, as the route suites share it ───────────────────────

export const IDS = {
  p1: "10000000-0000-4000-8000-000000000001",
  p2: "10000000-0000-4000-8000-000000000002",
  areaKm1: "20000000-0000-4000-8000-000000000001",
  areaDapur: "20000000-0000-4000-8000-000000000002",
  areaOther: "20000000-0000-4000-8000-000000000003",
  topicUmum: "30000000-0000-4000-8000-000000000001",
  staffBudi: "40000000-0000-4000-8000-000000000001",
  staffSiti: "40000000-0000-4000-8000-000000000002",
  staffGone: "40000000-0000-4000-8000-000000000003",
  staffSystem: "40000000-0000-4000-8000-000000000009",
  event1: "50000000-0000-4000-8000-000000000001",
  event2: "50000000-0000-4000-8000-000000000002",
};

export function datumFixture(): FakeAdmin {
  return new FakeAdmin()
    .seed("projects", [
      { id: IDS.p1, project_code: "K2-7", project_name: "Citraland K2-7 Sonny" },
      { id: IDS.p2, project_code: "D-18", project_name: "Bukit Darmo Golf D-18" },
    ])
    .seed("areas", [
      { id: IDS.areaDapur, project_id: IDS.p1, area_code: "LT1-DAPUR", area_name: "Dapur", floor: "Lt. 1", area_type: "kitchen", sort_order: 1, tracked: true },
      { id: IDS.areaKm1, project_id: IDS.p1, area_code: "LT1-KM-1", area_name: "Kamar Mandi 1", floor: "Lt. 1", area_type: "bathroom", sort_order: 0, tracked: true },
      { id: IDS.areaOther, project_id: IDS.p2, area_code: "LT1-KM-1", area_name: "KM Lain", floor: "Lt. 1", area_type: "bathroom", sort_order: 0, tracked: true },
    ])
    .seed("gates", [
      { code: "B", name: "Pekerjaan Basah / Waterproofing", description: "Material dinding/lantai.", sort_order: 2, active_weeks: "[12,32]" },
      { code: "A", name: "MEP Rough-in + Persiapan Struktural", description: "Penarikan seluruh sistem MEP.", sort_order: 1, active_weeks: "[1,16]" },
    ])
    .seed("area_gate_status", [
      { project_id: IDS.p1, area_id: IDS.areaKm1, gate_code: "A", status: "passed", stale: false, last_recomputed_at: "2026-09-26T03:00:00.000Z", updated_at: "2026-09-26T03:00:00.000Z", readiness_score: 1, blocking_reason: null },
      { project_id: IDS.p1, area_id: IDS.areaKm1, gate_code: "B", status: "blocked", stale: true, last_recomputed_at: null, updated_at: "2026-09-26T04:00:00.000Z", readiness_score: 0.2, blocking_reason: "Menunggu marmer" },
      { project_id: IDS.p2, area_id: IDS.areaOther, gate_code: "A", status: "in_progress", stale: false, last_recomputed_at: null, updated_at: "2026-09-26T05:00:00.000Z", readiness_score: 0.5, blocking_reason: null },
    ])
    .seed("staff", [
      { id: IDS.staffBudi, full_name: "Budi Santoso", role: "pic", email: "budi@datum.test", whatsapp_number: "+6281", handle: "budi", cost_visible: true, active: true },
      { id: IDS.staffSiti, full_name: "Siti Aminah", role: "designer", email: "siti@datum.test", whatsapp_number: "+6282", handle: "siti", cost_visible: false, active: true },
      { id: IDS.staffGone, full_name: "Pegawai Lama", role: "pic", email: "lama@datum.test", whatsapp_number: null, handle: "lama", cost_visible: false, active: false },
      { id: IDS.staffSystem, full_name: "SANO (sistem)", role: "studio_staff", email: null, whatsapp_number: null, handle: "sano", cost_visible: false, active: false },
    ])
    .seed("topics", [{ id: IDS.topicUmum, project_id: IDS.p1, code: "UMUM", name: "UMUM" }]);
}

export const SECRET = "sano-integration-test-secret";

export function sanoRequest(
  path: string,
  opts: { method?: "GET" | "POST"; auth?: string | null; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  if (auth !== null) headers.authorization = auth;
  return new Request(`https://datum.test/api/integrations/sano/${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/tests/unit/sano-integration-auth.test.ts` with exactly this content:

```ts
/**
 * sano-integration-auth.test.ts
 *
 * The bearer check and the project lookup every SANO route starts with
 * (SANO spec 2026-09-27 §5.1). No route is called here; the five routes get
 * their own suites.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanoAuth } from "@/lib/integrations/sano/auth";
import { resolveProject } from "@/lib/integrations/sano/project";
import { datumFixture, IDS, SECRET } from "./sano-fake-admin";

const req = (auth?: string) =>
  new Request("https://datum.test/api/integrations/sano/staff", { headers: auth === undefined ? {} : { authorization: auth } });

describe("sanoAuth", () => {
  it("is not_configured when the secret is unset or empty, whatever the header says", () => {
    expect(sanoAuth(req(`Bearer ${SECRET}`), undefined)).toBe("not_configured");
    expect(sanoAuth(req("Bearer "), "")).toBe("not_configured");
  });

  it("refuses a missing header, a wrong secret, the bare secret and a wrong-length header, without throwing", () => {
    expect(sanoAuth(req(), SECRET)).toBe("unauthorized");
    expect(sanoAuth(req("Bearer nope"), SECRET)).toBe("unauthorized");
    expect(sanoAuth(req(SECRET), SECRET)).toBe("unauthorized");
    expect(sanoAuth(req(`Bearer ${SECRET}${"x".repeat(500)}`), SECRET)).toBe("unauthorized");
    expect(sanoAuth(req(`bearer ${SECRET}`), SECRET)).toBe("unauthorized");
  });

  it("accepts exactly Bearer <secret>", () => {
    expect(sanoAuth(req(`Bearer ${SECRET}`), SECRET)).toBe("ok");
  });

  it("compares digests in constant time and never with ===", () => {
    const src = readFileSync(join(__dirname, "../../lib/integrations/sano/auth.ts"), "utf8");
    expect(src).toContain("timingSafeEqual(given, expected)");
    expect(src).toMatch(/createHash\("sha256"\)/);
    expect(src).not.toMatch(/===\s*`Bearer/);
  });
});

describe("resolveProject", () => {
  it("trims and upper-cases the code, as DATUM's own project pages look it up", async () => {
    const r = await resolveProject(datumFixture() as never, "  k2-7 ");
    expect(r).toEqual({ ok: true, project: { id: IDS.p1, project_code: "K2-7", project_name: "Citraland K2-7 Sonny" } });
  });

  it("says which code is unknown", async () => {
    expect(await resolveProject(datumFixture() as never, "zz-1")).toEqual({
      ok: false,
      code: "UNKNOWN_PROJECT",
      error: "Proyek DATUM dengan kode ZZ-1 tidak ada.",
    });
  });

  it("refuses a blank code as a bad request, never as an unknown project", async () => {
    expect(await resolveProject(datumFixture() as never, "   ")).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    expect(await resolveProject(datumFixture() as never, null)).toMatchObject({ ok: false, code: "BAD_REQUEST" });
  });

  it("reports a read failure as DB_ERROR", async () => {
    const db = datumFixture();
    db.failNext.projects = { message: "connection reset" };
    expect(await resolveProject(db as never, "K2-7")).toEqual({ ok: false, code: "DB_ERROR", error: "connection reset" });
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-auth.test.ts
```

Expected: `FAIL` with `Error: Cannot find package '@/lib/integrations/sano/auth' imported from ...sano-integration-auth.test.ts`.

- [ ] **Step 4: Write `auth.ts`**

Create `apps/web/lib/integrations/sano/auth.ts` with exactly this content:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

export type SanoAuthResult = "ok" | "unauthorized" | "not_configured";

/**
 * The one gate in front of /api/integrations/sano/* (SANO spec 2026-09-27
 * §5.1). An unset secret never opens it. Both the header and the expected
 * value are SHA-256 digested before the constant-time compare, so a wrong
 * header leaks neither its length nor its content through timing, and
 * timingSafeEqual never throws on a length mismatch (both digests are 32
 * bytes). DATUM's older checks (lib/cron/auth.ts, push/notify) use === and
 * are deliberately left as they are.
 */
export function sanoAuth(req: Request, secret: string | undefined): SanoAuthResult {
  if (!secret) return "not_configured";
  const header = req.headers.get("authorization") ?? "";
  const given = createHash("sha256").update(header, "utf8").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(given, expected) ? "ok" : "unauthorized";
}
```

- [ ] **Step 5: Write `reply.ts`**

Create `apps/web/lib/integrations/sano/reply.ts` with exactly this content:

```ts
import { NextResponse } from "next/server";

/** Every refusal the five SANO routes can give (SANO spec 2026-09-27 §5.1). */
export type SanoErrorCode =
  | "UNAUTHORIZED"
  | "NOT_CONFIGURED"
  | "BAD_REQUEST"
  | "UNKNOWN_PROJECT"
  | "UNKNOWN_AREA"
  | "TOPIC_MISSING"
  | "DB_ERROR";

export const SANO_ERROR_STATUS: Record<SanoErrorCode, number> = {
  UNAUTHORIZED: 401,
  NOT_CONFIGURED: 503,
  BAD_REQUEST: 400,
  UNKNOWN_PROJECT: 404,
  UNKNOWN_AREA: 404,
  TOPIC_MISSING: 409,
  DB_ERROR: 500,
};

export function sanoError(code: SanoErrorCode, error: string): NextResponse {
  return NextResponse.json({ ok: false, code, error }, { status: SANO_ERROR_STATUS[code] });
}

export function sanoOk(body: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: true, ...body });
}
```

- [ ] **Step 6: Write `project.ts`**

Create `apps/web/lib/integrations/sano/project.ts` with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type SanoProject = { id: string; project_code: string; project_name: string };

export type ResolveProjectResult =
  | { ok: true; project: SanoProject }
  | { ok: false; code: "BAD_REQUEST" | "UNKNOWN_PROJECT" | "DB_ERROR"; error: string };

/**
 * The project a SANO request names, looked up the way DATUM's own pages do
 * (packages/core/src/projects/by-slug.ts: project_code, upper case). Every
 * other query in these routes is scoped to the id this returns.
 */
export async function resolveProject(
  admin: SupabaseClient<Database>,
  raw: string | null | undefined,
): Promise<ResolveProjectResult> {
  const code = (raw ?? "").trim().toUpperCase();
  if (!code) return { ok: false, code: "BAD_REQUEST", error: "project_code wajib diisi." };
  const { data, error } = await admin
    .from("projects")
    .select("id, project_code, project_name")
    .eq("project_code", code)
    .maybeSingle();
  if (error) return { ok: false, code: "DB_ERROR", error: error.message };
  if (!data) return { ok: false, code: "UNKNOWN_PROJECT", error: `Proyek DATUM dengan kode ${code} tidak ada.` };
  return { ok: true, project: data as SanoProject };
}
```

- [ ] **Step 7: Write `gate.ts`**

Create `apps/web/lib/integrations/sano/gate.ts` with exactly this content:

```ts
import type { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sanoAuth } from "./auth";
import { sanoError } from "./reply";

export type SanoAdmin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Bearer first, service role second: the admin client is created only after
 * sanoAuth said "ok" (SANO spec 2026-09-27 §5.1, §10).
 */
export function openSanoRequest(req: Request): { admin: SanoAdmin } | { response: NextResponse } {
  const auth = sanoAuth(req, process.env.SANO_INTEGRATION_SECRET);
  if (auth === "not_configured") {
    return { response: sanoError("NOT_CONFIGURED", "Integrasi SANO belum dikonfigurasi di DATUM.") };
  }
  if (auth === "unauthorized") {
    return { response: sanoError("UNAUTHORIZED", "Kunci integrasi SANO tidak cocok.") };
  }
  return { admin: createSupabaseAdminClient() };
}
```

- [ ] **Step 8: Run the test, the type check and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-auth.test.ts && pnpm typecheck && npx eslint lib/integrations/sano tests/unit/sano-fake-admin.ts tests/unit/sano-integration-auth.test.ts
```

Expected: `Tests  8 passed (8)`, then `tsc --noEmit` with no error, then no eslint output.

- [ ] **Step 9: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t2.txt` with the Write tool, exactly:

```text
feat(sano): bearer check, replies and project lookup for the SANO routes

sanoAuth compares SHA-256 digests with timingSafeEqual and treats an
unset SANO_INTEGRATION_SECRET as not configured, never as a pass.
resolveProject reads project_code upper case. openSanoRequest creates
the service-role client only after the bearer passed. The in-memory
fake records every write for the route suites.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && git add apps/web/lib/integrations/sano/auth.ts apps/web/lib/integrations/sano/reply.ts apps/web/lib/integrations/sano/project.ts apps/web/lib/integrations/sano/gate.ts apps/web/tests/unit/sano-fake-admin.ts apps/web/tests/unit/sano-integration-auth.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t2.txt" -- apps/web/lib/integrations/sano/auth.ts apps/web/lib/integrations/sano/reply.ts apps/web/lib/integrations/sano/project.ts apps/web/lib/integrations/sano/gate.ts apps/web/tests/unit/sano-fake-admin.ts apps/web/tests/unit/sano-integration-auth.test.ts
```

### D-T3 (Lane D, Task 3): The three reads: GET areas, GET gate-status, GET staff

Spec §5.2. Every project query is scoped by the resolved project id; `GET staff` hands out active rows with `id` and `full_name` and nothing else (no role, email, WhatsApp number or handle; the inactive SANO (sistem) row never appears). Each route file sets `runtime = "nodejs"` (for `timingSafeEqual`) and `dynamic = "force-dynamic"` (never cached). The middleware already lets `/api` through without a login redirect (`middleware.ts:28-37`); the bearer is the only gate. The areas file gets its `POST` in D-T4.

**Files:**
- Create: `apps/web/app/api/integrations/sano/areas/route.ts`
- Create: `apps/web/app/api/integrations/sano/gate-status/route.ts`
- Create: `apps/web/app/api/integrations/sano/staff/route.ts`
- Create: `apps/web/tests/unit/sano-integration-reads.test.ts`

**Depends on:** D-T2.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/sano-integration-reads.test.ts` with exactly this content:

```ts
/**
 * sano-integration-reads.test.ts
 *
 * The three read routes SANO calls (SANO spec 2026-09-27 §5.2): GET areas,
 * GET gate-status, GET staff. The service-role client is the in-memory fake
 * from sano-fake-admin.ts; every read must be scoped to the project the code
 * names, and GET staff must hand out nothing but id and full name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { datumFixture, FakeAdmin, IDS, SECRET, sanoRequest } from "./sano-fake-admin";

const { holder } = vi.hoisted(() => ({ holder: { admin: null as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => holder.admin }));

import { GET as getAreas } from "@/app/api/integrations/sano/areas/route";
import { GET as getGateStatus } from "@/app/api/integrations/sano/gate-status/route";
import { GET as getStaff } from "@/app/api/integrations/sano/staff/route";

let db: FakeAdmin;

beforeEach(() => {
  db = datumFixture();
  holder.admin = db;
  process.env.SANO_INTEGRATION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SANO_INTEGRATION_SECRET;
});

describe("GET areas", () => {
  it("returns only this project's areas, by sort_order, with DATUM's project name", async () => {
    const res = await getAreas(sanoRequest("areas?project_code=%20k2-7%20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      project: { id: IDS.p1, project_code: "K2-7", project_name: "Citraland K2-7 Sonny" },
      areas: [
        { id: IDS.areaKm1, area_code: "LT1-KM-1", area_name: "Kamar Mandi 1", floor: "Lt. 1", area_type: "bathroom", sort_order: 0 },
        { id: IDS.areaDapur, area_code: "LT1-DAPUR", area_name: "Dapur", floor: "Lt. 1", area_type: "kitchen", sort_order: 1 },
      ],
    });
  });

  it("answers 404 UNKNOWN_PROJECT for a code DATUM does not have", async () => {
    const res = await getAreas(sanoRequest("areas?project_code=ZZ-9"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, code: "UNKNOWN_PROJECT", error: "Proyek DATUM dengan kode ZZ-9 tidak ada." });
  });

  it("answers 400 without a project_code", async () => {
    expect((await getAreas(sanoRequest("areas"))).status).toBe(400);
  });

  it("answers 500 DB_ERROR when the areas read fails", async () => {
    db.failNext.areas = { message: "timeout" };
    const res = await getAreas(sanoRequest("areas?project_code=K2-7"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "DB_ERROR", error: "timeout" });
  });
});

describe("GET gate-status", () => {
  it("returns DATUM's gates in order and this project's status rows with exactly the six columns", async () => {
    const res = await getGateStatus(sanoRequest("gate-status?project_code=K2-7"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.gates.map((g: { code: string }) => g.code)).toEqual(["A", "B"]);
    expect(Object.keys(body.gates[0]).sort()).toEqual(["code", "description", "name", "sort_order"]);
    expect(body.statuses).toHaveLength(2);
    for (const s of body.statuses) {
      expect(Object.keys(s).sort()).toEqual(["area_id", "gate_code", "last_recomputed_at", "stale", "status", "updated_at"]);
      expect(s.area_id).toBe(IDS.areaKm1);
    }
    expect(body.statuses.find((s: { gate_code: string }) => s.gate_code === "B")).toMatchObject({ status: "blocked", stale: true });
    expect(Number.isNaN(Date.parse(body.read_at))).toBe(false);
  });

  it("answers 404 for an unknown project", async () => {
    expect((await getGateStatus(sanoRequest("gate-status?project_code=nope"))).status).toBe(404);
  });
});

describe("GET staff", () => {
  it("lists active staff only, each with exactly id and full_name", async () => {
    const res = await getStaff(sanoRequest("staff"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      staff: [
        { id: IDS.staffBudi, full_name: "Budi Santoso" },
        { id: IDS.staffSiti, full_name: "Siti Aminah" },
      ],
    });
    for (const s of body.staff) expect(Object.keys(s).sort()).toEqual(["full_name", "id"]);
    const text = JSON.stringify(body);
    for (const leaked of ["budi@datum.test", "+6281", "pic", "handle", "SANO (sistem)", "Pegawai Lama"]) {
      expect(text).not.toContain(leaked);
    }
  });
});

describe("the reads write nothing", () => {
  it("records no insert, update or delete across all three", async () => {
    await getAreas(sanoRequest("areas?project_code=K2-7"));
    await getGateStatus(sanoRequest("gate-status?project_code=K2-7"));
    await getStaff(sanoRequest("staff"));
    expect(db.mutations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-reads.test.ts
```

Expected: `FAIL` with `Error: Cannot find package '@/app/api/integrations/sano/areas/route' ...`.

- [ ] **Step 3: Write the areas route (GET only for now)**

Create `apps/web/app/api/integrations/sano/areas/route.ts` with exactly this content:

```ts
/**
 * /api/integrations/sano/areas (SANO spec 2026-09-27 §5.2)
 *
 * GET  ?project_code=K2-7 - the project's areas, by sort_order.
 * POST { project_code, areas: [...] } - creates the areas that are missing,
 *      returns existing ones untouched. No UPDATE or DELETE exists here:
 *      DATUM stays the master of its own area rows.
 */
import { openSanoRequest } from "@/lib/integrations/sano/gate";
import { resolveProject } from "@/lib/integrations/sano/project";
import { sanoError, sanoOk } from "@/lib/integrations/sano/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const opened = openSanoRequest(req);
  if ("response" in opened) return opened.response;
  const { admin } = opened;

  const resolved = await resolveProject(admin, new URL(req.url).searchParams.get("project_code"));
  if (!resolved.ok) return sanoError(resolved.code, resolved.error);

  const { data, error } = await admin
    .from("areas")
    .select("id, area_code, area_name, floor, area_type, sort_order")
    .eq("project_id", resolved.project.id)
    .order("sort_order", { ascending: true });
  if (error) return sanoError("DB_ERROR", error.message);

  return sanoOk({ project: resolved.project, areas: data ?? [] });
}
```

- [ ] **Step 4: Write the gate-status route**

Create `apps/web/app/api/integrations/sano/gate-status/route.ts` with exactly this content:

```ts
/**
 * GET /api/integrations/sano/gate-status?project_code=K2-7
 *
 * SANO reads DATUM's area-by-gate readiness verbatim and shows it on Papan
 * Ruangan (SANO spec 2026-09-27 §5.2, §8.2); it never computes one. Also
 * returns DATUM's eight gate rows, so SANO can report any gate word that
 * drifted from its own gate_refs. Read-only.
 */
import { openSanoRequest } from "@/lib/integrations/sano/gate";
import { resolveProject } from "@/lib/integrations/sano/project";
import { sanoError, sanoOk } from "@/lib/integrations/sano/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const opened = openSanoRequest(req);
  if ("response" in opened) return opened.response;
  const { admin } = opened;

  const resolved = await resolveProject(admin, new URL(req.url).searchParams.get("project_code"));
  if (!resolved.ok) return sanoError(resolved.code, resolved.error);

  const [gates, statuses] = await Promise.all([
    admin.from("gates").select("code, name, description, sort_order").order("sort_order", { ascending: true }),
    admin
      .from("area_gate_status")
      .select("area_id, gate_code, status, stale, last_recomputed_at, updated_at")
      .eq("project_id", resolved.project.id),
  ]);
  if (gates.error) return sanoError("DB_ERROR", gates.error.message);
  if (statuses.error) return sanoError("DB_ERROR", statuses.error.message);

  return sanoOk({ gates: gates.data ?? [], statuses: statuses.data ?? [], read_at: new Date().toISOString() });
}
```

- [ ] **Step 5: Write the staff route**

Create `apps/web/app/api/integrations/sano/staff/route.ts` with exactly this content:

```ts
/**
 * GET /api/integrations/sano/staff
 *
 * Active staff, id and full name only (SANO spec 2026-09-27 §5.2, §10):
 * SANO links its profiles to these by an exact, unique name match. No role,
 * email, WhatsApp number or handle leaves DATUM, and the inactive
 * "SANO (sistem)" author row is never offered for a match. Staff are global,
 * so there is no project_code. Read-only.
 */
import { openSanoRequest } from "@/lib/integrations/sano/gate";
import { sanoError, sanoOk } from "@/lib/integrations/sano/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const opened = openSanoRequest(req);
  if ("response" in opened) return opened.response;

  const { data, error } = await opened.admin
    .from("staff")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (error) return sanoError("DB_ERROR", error.message);

  return sanoOk({ staff: (data ?? []).map((s) => ({ id: s.id, full_name: s.full_name })) });
}
```

- [ ] **Step 6: Run the test, the type check and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-reads.test.ts && pnpm typecheck && npx eslint app/api/integrations/sano tests/unit/sano-integration-reads.test.ts
```

Expected: `Tests  8 passed (8)`, a clean `tsc --noEmit`, no eslint output.

- [ ] **Step 7: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t3.txt` with the Write tool, exactly:

```text
feat(sano): GET areas, gate-status and staff for SANO

Read-only, behind the SANO bearer, every project query scoped to the
project the code names. GET staff returns active rows with id and
full_name only.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && git add apps/web/app/api/integrations/sano/areas/route.ts apps/web/app/api/integrations/sano/gate-status/route.ts apps/web/app/api/integrations/sano/staff/route.ts apps/web/tests/unit/sano-integration-reads.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t3.txt" -- apps/web/app/api/integrations/sano/areas/route.ts apps/web/app/api/integrations/sano/gate-status/route.ts apps/web/app/api/integrations/sano/staff/route.ts apps/web/tests/unit/sano-integration-reads.test.ts
```

### D-T4 (Lane D, Task 4): POST areas: create the missing, return the rest untouched

Spec §5.2. A bad item is an item error (`CODE_NOT_NORMALIZED`, `INVALID`), never a 400 for the batch; existing codes come back untouched whatever SANO calls them; missing ones are inserted one by one after the project's highest `sort_order` (as `createArea` does, `packages/core/src/areas/mutations.ts:37-45`), `tracked` defaulting to true; a 23505 re-reads the winner; each new tracked area gets `seed_area_steps`, best effort and logged the way `createArea` logs it. The file has no UPDATE and no DELETE.

**Files:**
- Create: `apps/web/lib/integrations/sano/areas.ts`
- Modify: `apps/web/app/api/integrations/sano/areas/route.ts` (the import block and a new `POST` at the end)
- Create: `apps/web/tests/unit/sano-integration-areas.test.ts`

**Depends on:** D-T3.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/sano-integration-areas.test.ts` with exactly this content:

```ts
/**
 * sano-integration-areas.test.ts
 *
 * POST /api/integrations/sano/areas (SANO spec 2026-09-27 §5.2): SANO's
 * rooms become DATUM areas when DATUM has none with that code. Existing
 * areas are returned untouched, whatever SANO calls them; nothing is ever
 * updated or deleted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { datumFixture, FakeAdmin, IDS, SECRET, sanoRequest } from "./sano-fake-admin";

const { holder } = vi.hoisted(() => ({ holder: { admin: null as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => holder.admin }));

import { POST } from "@/app/api/integrations/sano/areas/route";

let db: FakeAdmin;

beforeEach(() => {
  db = datumFixture();
  holder.admin = db;
  process.env.SANO_INTEGRATION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SANO_INTEGRATION_SECRET;
  vi.restoreAllMocks();
});

const post = (areas: unknown, project_code = "K2-7") =>
  POST(sanoRequest("areas", { method: "POST", body: { project_code, areas } }));

const km2 = { area_code: "LT1-KM-2", area_name: "Kamar Mandi 2", floor: "Lt. 1", area_type: "bathroom" };
const umum = { area_code: "UMUM", area_name: "Area Umum", floor: null, area_type: "general", tracked: false };

describe("POST areas", () => {
  it("creates the missing areas after the project's last sort_order and seeds only the tracked ones", async () => {
    const res = await post([km2, umum]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.areas.map((a: { area_code: string; created: boolean }) => [a.area_code, a.created])).toEqual([
      ["LT1-KM-2", true],
      ["UMUM", true],
    ]);
    const created = db.rows("areas").filter((a) => a.project_id === IDS.p1 && ["LT1-KM-2", "UMUM"].includes(a.area_code as string));
    expect(created.map((a) => [a.area_code, a.sort_order, a.tracked])).toEqual([
      ["LT1-KM-2", 2, true],
      ["UMUM", 3, false],
    ]);
    expect(db.rpcCalls).toEqual([{ fn: "seed_area_steps", args: { p_area_id: body.areas[0].id } }]);
  });

  it("creates nothing on a second identical call and returns the same ids", async () => {
    const first = await (await post([km2])).json();
    const inserts = db.writes("insert").length;
    const second = await (await post([km2])).json();
    expect(second.areas).toEqual([{ area_code: "LT1-KM-2", id: first.areas[0].id, created: false }]);
    expect(db.writes("insert")).toHaveLength(inserts);
  });

  it("returns an existing area untouched even when SANO names it differently", async () => {
    const body = await (await post([{ area_code: "LT1-KM-1", area_name: "KM Anak", floor: "Lt. 2", area_type: "general" }])).json();
    expect(body.areas).toEqual([{ area_code: "LT1-KM-1", id: IDS.areaKm1, created: false }]);
    expect(db.rows("areas").find((a) => a.id === IDS.areaKm1)).toMatchObject({ area_name: "Kamar Mandi 1", floor: "Lt. 1", area_type: "bathroom" });
    expect(db.mutations).toEqual([]);
  });

  it("refuses an unnormalized code, a long name, a long floor and an unknown type as item errors", async () => {
    const body = await (await post([
      { area_code: "lt1 km 3", area_name: "KM 3", floor: null, area_type: "bathroom" },
      { area_code: "LT1-KM-4", area_name: "x".repeat(121), floor: null, area_type: "bathroom" },
      { area_code: "LT1-KM-5", area_name: "KM 5", floor: "y".repeat(41), area_type: "bathroom" },
      { area_code: "LT1-KM-6", area_name: "KM 6", floor: null, area_type: "sauna" },
      km2,
    ])).json();
    expect(body.errors).toEqual([
      { area_code: "lt1 km 3", code: "CODE_NOT_NORMALIZED" },
      { area_code: "LT1-KM-4", code: "INVALID" },
      { area_code: "LT1-KM-5", code: "INVALID" },
      { area_code: "LT1-KM-6", code: "INVALID" },
    ]);
    expect(body.areas.map((a: { area_code: string }) => a.area_code)).toEqual(["LT1-KM-2"]);
  });

  it("accepts DATUM's four zone types", async () => {
    const body = await (await post(["facade", "terrace", "hall", "exterior"].map((t, i) => ({
      area_code: `ZONA-${i}`, area_name: `Zona ${i}`, floor: null, area_type: t,
    })))).json();
    expect(body.errors).toEqual([]);
    expect(body.areas).toHaveLength(4);
  });

  it("returns the winner when a parallel create took the code first (23505)", async () => {
    const winner = "20000000-0000-4000-8000-00000000abcd";
    db.beforeInsert = (table, row) => {
      if (table !== "areas") return;
      db.beforeInsert = null;
      db.seed("areas", [{ id: winner, project_id: row.project_id, area_code: row.area_code, area_name: "Pemenang", floor: null, area_type: "bathroom", sort_order: 9, tracked: true }]);
    };
    const body = await (await post([km2])).json();
    expect(body.areas).toEqual([{ area_code: "LT1-KM-2", id: winner, created: false }]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("logs a failed seed and still reports the area as created", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc = (fn: string, args: unknown) => {
      db.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: { message: "seed down" } });
    };
    const body = await (await post([km2])).json();
    expect(body.areas[0].created).toBe(true);
    expect(log.mock.calls[0]?.[0]).toMatch(/seed_area_steps gagal untuk area .* seed down/);
  });

  it("answers 400 for a body that is not JSON, has no areas, or has more than 200", async () => {
    expect((await POST(sanoRequest("areas", { method: "POST", body: "{nope" }))).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post(Array.from({ length: 201 }, (_, i) => ({ ...km2, area_code: `A-${i}` })))).status).toBe(400);
  });

  it("answers 404 for an unknown project and writes nothing", async () => {
    const res = await post([km2], "ZZ-1");
    expect(res.status).toBe(404);
    expect(db.mutations).toEqual([]);
  });

  it("never updates or deletes", async () => {
    await post([km2, umum, { area_code: "LT1-KM-1", area_name: "Lain", floor: null, area_type: "general" }]);
    await post([km2, umum]);
    expect(db.writes("update")).toEqual([]);
    expect(db.writes("delete")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-areas.test.ts
```

Expected: `FAIL` on every test: `POST` is not exported by the route yet (`TypeError: POST is not a function` or a missing-export error).

- [ ] **Step 3: Write `areas.ts`**

Create `apps/web/lib/integrations/sano/areas.ts` with exactly this content:

```ts
import { z } from "zod";
import { AREA_TYPES, normalizeAreaCode, type AreaType } from "@datum/core";
import type { SanoAdmin } from "./gate";

/**
 * POST /api/integrations/sano/areas, the part that touches the database
 * (SANO spec 2026-09-27 §5.2). Item fields are loosely typed on purpose: a
 * bad item is an item error, never a 400 for the whole batch.
 */
export const PostAreasBody = z.object({
  project_code: z.string().min(1).max(40),
  areas: z
    .array(
      z.object({
        area_code: z.string().max(1000),
        area_name: z.string().max(1000),
        floor: z.string().max(1000).nullable().optional(),
        area_type: z.string().max(1000),
        tracked: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type PostAreaItem = z.infer<typeof PostAreasBody>["areas"][number];

export type AreaItemErrorCode = "CODE_NOT_NORMALIZED" | "INVALID" | "DB_ERROR";
export type EnsuredArea = { area_code: string; id: string; created: boolean };
export type EnsureAreasResult =
  | { ok: true; areas: EnsuredArea[]; errors: Array<{ area_code: string; code: AreaItemErrorCode }> }
  | { ok: false; error: string };

/** The same limits createArea's schema holds (packages/core/src/areas/mutations.ts:9-16). */
export function areaItemError(item: PostAreaItem): AreaItemErrorCode | null {
  if (!item.area_code || item.area_code !== normalizeAreaCode(item.area_code)) return "CODE_NOT_NORMALIZED";
  const name = item.area_name.trim();
  if (name.length < 1 || name.length > 120) return "INVALID";
  if ((item.floor ?? "").length > 40) return "INVALID";
  if (!(AREA_TYPES as readonly string[]).includes(item.area_type)) return "INVALID";
  return null;
}

/**
 * Existing codes come back untouched. Missing ones are inserted one by one in
 * request order, appended after the project's highest sort_order as createArea
 * does; a 23505 (a parallel create won) re-reads the winner. Each new tracked
 * area gets its milestones from seed_area_steps, best effort and logged the
 * way createArea logs it. There is no UPDATE or DELETE statement here.
 */
export async function ensureAreas(admin: SanoAdmin, projectId: string, items: PostAreaItem[]): Promise<EnsureAreasResult> {
  const { data: existing, error } = await admin
    .from("areas")
    .select("id, area_code, sort_order")
    .eq("project_id", projectId);
  if (error) return { ok: false, error: error.message };

  const byCode = new Map<string, string>((existing ?? []).map((a) => [a.area_code, a.id]));
  let nextSort = (existing ?? []).reduce((max, a) => Math.max(max, a.sort_order ?? 0), -1) + 1;
  const areas: EnsuredArea[] = [];
  const errors: Array<{ area_code: string; code: AreaItemErrorCode }> = [];

  for (const item of items) {
    const bad = areaItemError(item);
    if (bad) {
      errors.push({ area_code: item.area_code, code: bad });
      continue;
    }
    const known = byCode.get(item.area_code);
    if (known) {
      areas.push({ area_code: item.area_code, id: known, created: false });
      continue;
    }

    const tracked = item.tracked ?? true;
    const { data: created, error: insertError } = await admin
      .from("areas")
      .insert({
        project_id: projectId,
        area_code: item.area_code,
        area_name: item.area_name.trim(),
        floor: item.floor ?? null,
        area_type: item.area_type as AreaType,
        sort_order: nextSort,
        tracked,
      })
      .select("id")
      .single();

    if (insertError?.code === "23505") {
      const { data: winner } = await admin
        .from("areas")
        .select("id")
        .eq("project_id", projectId)
        .eq("area_code", item.area_code)
        .maybeSingle();
      if (winner) {
        byCode.set(item.area_code, winner.id);
        areas.push({ area_code: item.area_code, id: winner.id, created: false });
      } else {
        errors.push({ area_code: item.area_code, code: "DB_ERROR" });
      }
      continue;
    }
    if (insertError || !created) {
      errors.push({ area_code: item.area_code, code: "DB_ERROR" });
      continue;
    }

    nextSort += 1;
    byCode.set(item.area_code, created.id);
    areas.push({ area_code: item.area_code, id: created.id, created: true });

    if (tracked) {
      const { error: seedError } = await admin.rpc("seed_area_steps", { p_area_id: created.id });
      if (seedError) {
        console.error(
          `[sano/areas] seed_area_steps gagal untuk area ${created.id} — checklist kosong, perlu backfill: ${seedError.message}`,
        );
      }
    }
  }

  return { ok: true, areas, errors };
}
```

- [ ] **Step 4: Add `POST` to the areas route**

One edit to the imports, then one append.

In `apps/web/app/api/integrations/sano/areas/route.ts`, replace

```ts
import { openSanoRequest } from "@/lib/integrations/sano/gate";
```

with

```ts
import { ensureAreas, PostAreasBody } from "@/lib/integrations/sano/areas";
import { openSanoRequest } from "@/lib/integrations/sano/gate";
```

Then append to the end of the same file:

```ts

export async function POST(req: Request) {
  const opened = openSanoRequest(req);
  if ("response" in opened) return opened.response;
  const { admin } = opened;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return sanoError("BAD_REQUEST", "Body harus JSON.");
  }
  const parsed = PostAreasBody.safeParse(raw);
  if (!parsed.success) return sanoError("BAD_REQUEST", "Body tidak sesuai: project_code dan 1-200 areas wajib.");

  const resolved = await resolveProject(admin, parsed.data.project_code);
  if (!resolved.ok) return sanoError(resolved.code, resolved.error);

  const result = await ensureAreas(admin, resolved.project.id, parsed.data.areas);
  if (!result.ok) return sanoError("DB_ERROR", result.error);
  return sanoOk({ areas: result.areas, errors: result.errors });
}
```

- [ ] **Step 5: Run the test, the type check and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-areas.test.ts tests/unit/sano-integration-reads.test.ts && pnpm typecheck && npx eslint lib/integrations/sano app/api/integrations/sano tests/unit/sano-integration-areas.test.ts
```

Expected: `Tests  18 passed (18)` (10 new, 8 from D-T3), a clean `tsc --noEmit`, no eslint output.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t4.txt` with the Write tool, exactly:

```text
feat(sano): POST areas creates the areas SANO has and DATUM lacks

Insert-only: existing codes return untouched, item errors are named
(CODE_NOT_NORMALIZED, INVALID, DB_ERROR), sort_order appends after the
project's last area, a 23505 re-reads the winner, new tracked areas are
seeded best effort. No update and no delete exist in the route.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && git add apps/web/lib/integrations/sano/areas.ts apps/web/app/api/integrations/sano/areas/route.ts apps/web/tests/unit/sano-integration-areas.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t4.txt" -- apps/web/lib/integrations/sano/areas.ts apps/web/app/api/integrations/sano/areas/route.ts apps/web/tests/unit/sano-integration-areas.test.ts
```

### D-T5 (Lane D, Task 5): POST escalate: one decision card per SANO event, once

Spec §5.3. The area must belong to the project; a card whose `properties.sano_event_id` matches is THE card; otherwise one is created in the project's `UMUM` list, authored by `author_staff_id` when that names an active staff row, else by `SANO_INTEGRATION_STAFF_ID`, with the `-2`, `-3` slug loop of `packages/core/src/cards/create.ts:46-57`; a 23505 (the new index, or a slug taken meanwhile) looks again. Then, on a new or found card: the area link (`linkCardToArea`, which already treats 23505 as linked), one `decision` event with `status: 'needs_decision'` and one `note` naming the SANO people, each only if missing, both logged by the card's own author. Core `createCard` is not reused: it needs a signed-in user as author and guesses the area. `card_url` is the page `app/(app)/project/[slug]/cards/[cardSlug]/page.tsx` resolves.

**Files:**
- Create: `apps/web/lib/integrations/sano/escalate.ts`
- Create: `apps/web/app/api/integrations/sano/escalate/route.ts`
- Create: `apps/web/tests/unit/sano-integration-escalate.test.ts`

**Depends on:** D-T2.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/sano-integration-escalate.test.ts` with exactly this content:

```ts
/**
 * sano-integration-escalate.test.ts
 *
 * POST /api/integrations/sano/escalate (SANO spec 2026-09-27 §5.3): a
 * confirmed SANO decision becomes one card, once, authored by the person's
 * own DATUM account when SANO linked one, else by SANO (sistem). A repeat
 * returns the same card and writes nothing; a card half made by a call that
 * died is completed; a parallel create is answered with the winner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { datumFixture, FakeAdmin, IDS, SECRET, sanoRequest } from "./sano-fake-admin";

const { holder } = vi.hoisted(() => ({ holder: { admin: null as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => holder.admin }));

import { POST } from "@/app/api/integrations/sano/escalate/route";
import { escalationNote } from "@/lib/integrations/sano/escalate";

let db: FakeAdmin;

const body = (over: Record<string, unknown> = {}) => ({
  project_code: "k2-7",
  area_id: IDS.areaKm1,
  sano_event_id: IDS.event1,
  sano_url: "https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1",
  title: "Pilih warna nat kamar mandi",
  summary: "Nat abu atau putih?",
  room_name: "Kamar Mandi 1",
  reporter_name: "Budi Santoso",
  confirmer_name: "Siti Aminah",
  owner_name: "Budi Santoso",
  due_date: "2026-10-01",
  confirmed_at: "2026-09-27T02:00:00.000Z",
  author_staff_id: IDS.staffBudi,
  ...over,
});

const escalate = (over: Record<string, unknown> = {}) =>
  POST(sanoRequest("escalate", { method: "POST", body: body(over) }));

beforeEach(() => {
  db = datumFixture();
  holder.admin = db;
  process.env.SANO_INTEGRATION_SECRET = SECRET;
  process.env.SANO_INTEGRATION_STAFF_ID = IDS.staffSystem;
});

afterEach(() => {
  delete process.env.SANO_INTEGRATION_SECRET;
  delete process.env.SANO_INTEGRATION_STAFF_ID;
});

describe("POST escalate", () => {
  it("makes the card in UMUM with the SANO keys, links the area, and adds one decision and one note", async () => {
    const res = await escalate();
    expect(res.status).toBe(200);
    const reply = await res.json();
    expect(reply).toMatchObject({ ok: true, created: true, author: "linked" });
    expect(reply.card_url).toBe("https://datum.test/project/k2-7/cards/pilih-warna-nat-kamar-mandi");

    const card = db.rows("cards")[0]!;
    expect(card).toMatchObject({
      id: reply.card_id,
      project_id: IDS.p1,
      topic_id: IDS.topicUmum,
      title: "Pilih warna nat kamar mandi",
      slug: "pilih-warna-nat-kamar-mandi",
      created_by_staff_id: IDS.staffBudi,
      properties: { source: "sano", sano_event_id: IDS.event1, sano_url: "https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1" },
    });
    expect(db.rows("card_areas")).toEqual([expect.objectContaining({ card_id: card.id, area_id: IDS.areaKm1 })]);

    const events = db.rows("card_events");
    expect(events.map((e) => e.event_kind)).toEqual(["decision", "note"]);
    expect(events[0]!).toMatchObject({
      payload: { topic: "Pilih warna nat kamar mandi", current_spec: "Nat abu atau putih?", status: "needs_decision" },
      occurred_at: "2026-09-27T02:00:00.000Z",
      logged_by_staff_id: IDS.staffBudi,
      project_id: IDS.p1,
    });
    expect(events[1]!.payload).toEqual({
      body: "Dari SANO · Kamar Mandi 1 · dilaporkan Budi Santoso · dikonfirmasi Siti Aminah · penanggung jawab Budi Santoso · tenggat 2026-10-01 · https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1",
    });
    expect(events[1]!.logged_by_staff_id).toBe(IDS.staffBudi);
  });

  it("falls back to SANO (sistem) when the author is unknown, inactive or absent, and says so", async () => {
    for (const [i, author] of [null, IDS.staffGone, "40000000-0000-4000-8000-0000000000ff"].entries()) {
      const eventId = `50000000-0000-4000-8000-00000000010${i}`;
      const reply = await (await escalate({ sano_event_id: eventId, author_staff_id: author, title: `Keputusan ${i}` })).json();
      expect(reply).toMatchObject({ ok: true, created: true, author: "system" });
      const card = db.rows("cards").find((c) => c.id === reply.card_id)!;
      expect(card.created_by_staff_id).toBe(IDS.staffSystem);
      expect(db.rows("card_events").filter((e) => e.card_id === card.id).every((e) => e.logged_by_staff_id === IDS.staffSystem)).toBe(true);
    }
  });

  it("names a missing confirmer as 'tidak tercatat' and omits an empty summary", async () => {
    const reply = await (await escalate({ confirmer_name: null, summary: null })).json();
    const events = db.rows("card_events").filter((e) => e.card_id === reply.card_id);
    expect(events[0]!.payload).toEqual({ topic: "Pilih warna nat kamar mandi", status: "needs_decision" });
    expect((events[1]!.payload as { body: string }).body).toContain("dikonfirmasi tidak tercatat");
  });

  it("returns the same card on a repeat, inserts nothing, and keeps the author", async () => {
    const first = await (await escalate()).json();
    const writes = db.mutations.length;
    const again = await (await escalate({ author_staff_id: IDS.staffSiti, title: "Judul lain" })).json();
    expect(again).toEqual({ ok: true, card_id: first.card_id, card_url: first.card_url, created: false, author: "linked" });
    expect(db.mutations).toHaveLength(writes);
    expect(db.rows("cards")).toHaveLength(1);
    expect(db.rows("cards")[0]!.created_by_staff_id).toBe(IDS.staffBudi);
  });

  it("completes a card a dead call half made: link, decision and note, with the card's own author", async () => {
    db.seed("cards", [{
      id: "60000000-0000-4000-8000-000000000001", project_id: IDS.p1, topic_id: IDS.topicUmum, title: "Setengah jadi",
      slug: "setengah-jadi", created_by_staff_id: IDS.staffSystem,
      properties: { source: "sano", sano_event_id: IDS.event1, sano_url: "https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1" },
    }]);
    const reply = await (await escalate()).json();
    expect(reply).toMatchObject({ card_id: "60000000-0000-4000-8000-000000000001", created: false, author: "system" });
    expect(db.rows("card_areas")).toHaveLength(1);
    expect(db.rows("card_events").map((e) => [e.event_kind, e.logged_by_staff_id])).toEqual([
      ["decision", IDS.staffSystem],
      ["note", IDS.staffSystem],
    ]);
  });

  it("answers a parallel create (23505 on the SANO key) with the winner's card", async () => {
    const winner = "60000000-0000-4000-8000-00000000beef";
    db.beforeInsert = (table) => {
      if (table !== "cards") return;
      db.beforeInsert = null;
      db.seed("cards", [{
        id: winner, project_id: IDS.p1, topic_id: IDS.topicUmum, title: "Pemenang", slug: "pemenang",
        created_by_staff_id: IDS.staffBudi, properties: { source: "sano", sano_event_id: IDS.event1, sano_url: "x" },
      }]);
    };
    const reply = await (await escalate()).json();
    expect(reply).toMatchObject({ ok: true, card_id: winner, created: false });
    expect(db.rows("cards")).toHaveLength(1);
  });

  it("gives a second card with the same title the next free slug", async () => {
    await escalate();
    const second = await (await escalate({ sano_event_id: IDS.event2 })).json();
    expect(second.card_url).toBe("https://datum.test/project/k2-7/cards/pilih-warna-nat-kamar-mandi-2");
  });

  it("refuses an area of another project with UNKNOWN_AREA and writes nothing", async () => {
    const res = await escalate({ area_id: IDS.areaOther });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, code: "UNKNOWN_AREA" });
    expect(db.mutations).toEqual([]);
  });

  it("answers 409 TOPIC_MISSING when the project has no UMUM list", async () => {
    db.tables.topics = [];
    const res = await escalate();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "TOPIC_MISSING" });
    expect(db.mutations).toEqual([]);
  });

  it("answers 503 NOT_CONFIGURED without the system staff id, before reading anything", async () => {
    delete process.env.SANO_INTEGRATION_STAFF_ID;
    const res = await escalate();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
  });

  it("answers 400 naming the field for a bad body, and 404 for an unknown project", async () => {
    const bad = await escalate({ title: "x".repeat(81) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("title");
    expect((await escalate({ project_code: "ZZ-1" })).status).toBe(404);
  });

  it("never updates or deletes", async () => {
    await escalate();
    await escalate();
    await escalate({ sano_event_id: IDS.event2, author_staff_id: null });
    expect(db.writes("update")).toEqual([]);
    expect(db.writes("delete")).toEqual([]);
  });
});

describe("escalationNote", () => {
  it("names every SANO person, with 'tidak tercatat' for anyone unknown", () => {
    expect(escalationNote({ ...body(), reporter_name: "", confirmer_name: null, owner_name: "" } as never)).toBe(
      "Dari SANO · Kamar Mandi 1 · dilaporkan tidak tercatat · dikonfirmasi tidak tercatat · penanggung jawab tidak tercatat · tenggat 2026-10-01 · https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1",
    );
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-escalate.test.ts
```

Expected: `FAIL` with `Error: Cannot find package '@/app/api/integrations/sano/escalate/route' ...`.

- [ ] **Step 3: Write `escalate.ts`**

Create `apps/web/lib/integrations/sano/escalate.ts` with exactly this content:

```ts
import { z } from "zod";
import { createCardEvent, linkCardToArea, toSlug } from "@datum/core";
import type { SanoAdmin } from "./gate";
import type { SanoProject } from "./project";

/**
 * POST /api/integrations/sano/escalate, the part that touches the database
 * (SANO spec 2026-09-27 §5.3). One confirmed "butuh keputusan" in SANO
 * becomes one decision card in the project's UMUM list, once:
 *   1. the area must belong to the project;
 *   2. a card whose properties.sano_event_id matches is THE card;
 *   3. otherwise one is created, authored by author_staff_id when that names
 *      an active staff row, else by the SANO (sistem) row; a 23505 on the
 *      unique index means a parallel call won, so it is re-read;
 *   4. the card is linked to the area, and given one decision event and one
 *      note event if it lacks them, so a card half made by a call that died
 *      is completed by the next one. A repeat never changes the author.
 * Core createCard is not reused: it needs a signed-in user as author and
 * guesses the area from the title, where the area is known here.
 */
export const EscalateBody = z.object({
  project_code: z.string().min(1).max(40),
  area_id: z.string().uuid(),
  sano_event_id: z.string().uuid(),
  sano_url: z.string().url().max(500),
  title: z.string().trim().min(1).max(80),
  summary: z.string().max(300).nullable(),
  room_name: z.string().min(1).max(200),
  reporter_name: z.string().max(200),
  confirmer_name: z.string().max(200).nullable(),
  owner_name: z.string().max(200),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmed_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "confirmed_at bukan waktu"),
  author_staff_id: z.string().uuid().nullable(),
});
export type EscalateInput = z.infer<typeof EscalateBody>;

export type EscalateResult =
  | { ok: true; card_id: string; card_url: string; created: boolean; author: "linked" | "system" }
  | { ok: false; code: "UNKNOWN_AREA" | "TOPIC_MISSING" | "DB_ERROR"; error: string };

type CardRow = { id: string; slug: string; created_by_staff_id: string };

/** The note always names the SANO people, linked or not: the decision schema strips unknown keys. */
export function escalationNote(input: EscalateInput): string {
  return [
    "Dari SANO",
    input.room_name,
    `dilaporkan ${input.reporter_name || "tidak tercatat"}`,
    `dikonfirmasi ${input.confirmer_name || "tidak tercatat"}`,
    `penanggung jawab ${input.owner_name || "tidak tercatat"}`,
    `tenggat ${input.due_date}`,
    input.sano_url,
  ].join(" · ");
}

async function findCard(admin: SanoAdmin, projectId: string, sanoEventId: string) {
  return admin
    .from("cards")
    .select("id, slug, created_by_staff_id")
    .eq("project_id", projectId)
    .eq("properties->>sano_event_id", sanoEventId)
    .maybeSingle();
}

async function freeSlug(admin: SanoAdmin, projectId: string, title: string): Promise<string> {
  const base = toSlug(title);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const { data } = await admin.from("cards").select("id").eq("project_id", projectId).eq("slug", slug).maybeSingle();
    if (!data) break;
    slug = `${base}-${i}`;
  }
  return slug;
}

export async function escalateDecision(
  admin: SanoAdmin,
  project: SanoProject,
  input: EscalateInput,
  systemStaffId: string,
  origin: string,
): Promise<EscalateResult> {
  const { data: area, error: areaError } = await admin
    .from("areas")
    .select("id")
    .eq("id", input.area_id)
    .eq("project_id", project.id)
    .maybeSingle();
  if (areaError) return { ok: false, code: "DB_ERROR", error: areaError.message };
  if (!area) return { ok: false, code: "UNKNOWN_AREA", error: "Area ini bukan milik proyek DATUM tersebut." };

  let card: CardRow | null = null;
  let created = false;
  for (let attempt = 0; attempt < 3 && !card; attempt++) {
    const found = await findCard(admin, project.id, input.sano_event_id);
    if (found.error) return { ok: false, code: "DB_ERROR", error: found.error.message };
    if (found.data) {
      card = found.data as CardRow;
      break;
    }

    const { data: topic, error: topicError } = await admin
      .from("topics")
      .select("id")
      .eq("project_id", project.id)
      .eq("code", "UMUM")
      .maybeSingle();
    if (topicError) return { ok: false, code: "DB_ERROR", error: topicError.message };
    if (!topic) return { ok: false, code: "TOPIC_MISSING", error: "Daftar UMUM tidak ada di proyek DATUM ini." };

    let author = systemStaffId;
    if (input.author_staff_id) {
      const { data: staff } = await admin
        .from("staff")
        .select("id")
        .eq("id", input.author_staff_id)
        .eq("active", true)
        .maybeSingle();
      if (staff) author = staff.id;
    }

    const slug = await freeSlug(admin, project.id, input.title);
    const { data: inserted, error: insertError } = await admin
      .from("cards")
      .insert({
        project_id: project.id,
        topic_id: topic.id,
        title: input.title,
        slug,
        properties: { source: "sano", sano_event_id: input.sano_event_id, sano_url: input.sano_url },
        created_by_staff_id: author,
      })
      .select("id, slug, created_by_staff_id")
      .single();
    if (insertError?.code === "23505") continue; // a parallel call won, or took the slug: look again
    if (insertError || !inserted) {
      return { ok: false, code: "DB_ERROR", error: insertError?.message ?? "Kartu gagal dibuat." };
    }
    card = inserted as CardRow;
    created = true;
  }
  if (!card) return { ok: false, code: "DB_ERROR", error: "Kartu gagal dibuat setelah tiga percobaan." };

  const link = await linkCardToArea(admin, { cardId: card.id, areaId: input.area_id });
  if (!link.ok) return { ok: false, code: "DB_ERROR", error: link.error };

  const { data: events, error: eventsError } = await admin.from("card_events").select("event_kind").eq("card_id", card.id);
  if (eventsError) return { ok: false, code: "DB_ERROR", error: eventsError.message };
  const kinds = new Set((events ?? []).map((e) => e.event_kind as string));

  if (!kinds.has("decision")) {
    const decision = await createCardEvent(admin, {
      cardId: card.id,
      projectId: project.id,
      eventKind: "decision",
      payload: {
        topic: input.title,
        ...(input.summary ? { current_spec: input.summary } : {}),
        status: "needs_decision",
      },
      occurredAt: input.confirmed_at,
      loggedByStaffId: card.created_by_staff_id,
    });
    if (!decision.ok) return { ok: false, code: "DB_ERROR", error: decision.error };
  }
  if (!kinds.has("note")) {
    const note = await createCardEvent(admin, {
      cardId: card.id,
      projectId: project.id,
      eventKind: "note",
      payload: { body: escalationNote(input) },
      occurredAt: input.confirmed_at,
      loggedByStaffId: card.created_by_staff_id,
    });
    if (!note.ok) return { ok: false, code: "DB_ERROR", error: note.error };
  }

  return {
    ok: true,
    card_id: card.id,
    card_url: `${origin}/project/${project.project_code.toLowerCase()}/cards/${card.slug}`,
    created,
    author: card.created_by_staff_id === systemStaffId ? "system" : "linked",
  };
}
```

- [ ] **Step 4: Write the escalate route**

Create `apps/web/app/api/integrations/sano/escalate/route.ts` with exactly this content:

```ts
/**
 * POST /api/integrations/sano/escalate (SANO spec 2026-09-27 §5.2-§5.3)
 *
 * One confirmed "butuh keputusan" from SANO becomes one decision card here,
 * once. Idempotent on properties.sano_event_id: a repeat returns the same
 * card with created: false and writes nothing new. DATUM's own triggers then
 * mark the area's gate rows stale and alert card members; this route adds no
 * side effect of its own.
 */
import { escalateDecision, EscalateBody } from "@/lib/integrations/sano/escalate";
import { openSanoRequest } from "@/lib/integrations/sano/gate";
import { resolveProject } from "@/lib/integrations/sano/project";
import { sanoError, sanoOk } from "@/lib/integrations/sano/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const opened = openSanoRequest(req);
  if ("response" in opened) return opened.response;
  const { admin } = opened;

  const systemStaffId = process.env.SANO_INTEGRATION_STAFF_ID;
  if (!systemStaffId) {
    return sanoError("NOT_CONFIGURED", "SANO_INTEGRATION_STAFF_ID belum diisi: kartu dari SANO butuh penulis sistem.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return sanoError("BAD_REQUEST", "Body harus JSON.");
  }
  const parsed = EscalateBody.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    return sanoError("BAD_REQUEST", `Isian tidak valid: ${field}.`);
  }

  const resolved = await resolveProject(admin, parsed.data.project_code);
  if (!resolved.ok) return sanoError(resolved.code, resolved.error);

  const result = await escalateDecision(admin, resolved.project, parsed.data, systemStaffId, new URL(req.url).origin);
  if (!result.ok) return sanoError(result.code, result.error);
  return sanoOk({ card_id: result.card_id, card_url: result.card_url, created: result.created, author: result.author });
}
```

- [ ] **Step 5: Run the test, the type check and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-escalate.test.ts && pnpm typecheck && npx eslint lib/integrations/sano app/api/integrations/sano tests/unit/sano-integration-escalate.test.ts
```

Expected: `Tests  13 passed (13)`, a clean `tsc --noEmit`, no eslint output.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t5.txt` with the Write tool, exactly:

```text
feat(sano): POST escalate makes one decision card per SANO event

Idempotent on properties.sano_event_id: a repeat returns the same card
with created false and writes nothing; a card half made by a call that
died is completed; a parallel create is answered with the winner. The
author is the SANO person's own staff row when active, else SANO
(sistem); the note always names the SANO people.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && git add apps/web/lib/integrations/sano/escalate.ts apps/web/app/api/integrations/sano/escalate/route.ts apps/web/tests/unit/sano-integration-escalate.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t5.txt" -- apps/web/lib/integrations/sano/escalate.ts apps/web/app/api/integrations/sano/escalate/route.ts apps/web/tests/unit/sano-integration-escalate.test.ts
```

### D-T6 (Lane D, Task 6): All five routes at once: the bearer, and inserts only

Spec §5.1, §10, §11.6. Missing, wrong, wrong-length and bare bearers are 401 on all five routes and never build the service-role client; an unset secret is 503; the four project routes answer 404 for an unknown code; and across a full SANO sync (read areas, create areas, read gate status, read staff, escalate twice) the database sees inserts only. This suite needs no new code: it pins what D-T2 to D-T5 built, so it passes on its first run. That is the point of it; a later edit that breaks any route's gate fails here.

**Files:**
- Create: `apps/web/tests/unit/sano-integration-routes.test.ts`

**Depends on:** D-T3, D-T4, D-T5.

- [ ] **Step 1: Write the cross-route suite**

Create `apps/web/tests/unit/sano-integration-routes.test.ts` with exactly this content:

```ts
/**
 * sano-integration-routes.test.ts
 *
 * What holds on all five SANO routes at once (SANO spec 2026-09-27 §5.1,
 * §10, §11.6): the bearer is the only gate and an unset secret never opens
 * it; the service-role client is created only after the bearer passed; and
 * across a full SANO sync (read areas, create areas, read gate status, read
 * staff, escalate twice) the database sees inserts only, never an update or
 * a delete.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { datumFixture, FakeAdmin, IDS, SECRET, sanoRequest } from "./sano-fake-admin";

const { holder, created } = vi.hoisted(() => ({ holder: { admin: null as unknown }, created: { count: 0 } }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    created.count += 1;
    return holder.admin;
  },
}));

import { GET as getAreas, POST as postAreas } from "@/app/api/integrations/sano/areas/route";
import { GET as getGateStatus } from "@/app/api/integrations/sano/gate-status/route";
import { GET as getStaff } from "@/app/api/integrations/sano/staff/route";
import { POST as escalate } from "@/app/api/integrations/sano/escalate/route";

let db: FakeAdmin;

const escalateBody = {
  project_code: "K2-7", area_id: IDS.areaKm1, sano_event_id: IDS.event1,
  sano_url: "https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1", title: "Pilih nat", summary: null,
  room_name: "Kamar Mandi 1", reporter_name: "Budi Santoso", confirmer_name: null, owner_name: "Budi Santoso",
  due_date: "2026-10-01", confirmed_at: "2026-09-27T02:00:00.000Z", author_staff_id: null,
};

type Route = { name: string; call: (auth: string | null) => Promise<Response> };
const ROUTES: Route[] = [
  { name: "GET areas", call: (auth) => getAreas(sanoRequest("areas?project_code=K2-7", { auth })) },
  { name: "POST areas", call: (auth) => postAreas(sanoRequest("areas", { method: "POST", auth, body: { project_code: "K2-7", areas: [{ area_code: "X-1", area_name: "X", floor: null, area_type: "general" }] } })) },
  { name: "GET gate-status", call: (auth) => getGateStatus(sanoRequest("gate-status?project_code=K2-7", { auth })) },
  { name: "GET staff", call: (auth) => getStaff(sanoRequest("staff", { auth })) },
  { name: "POST escalate", call: (auth) => escalate(sanoRequest("escalate", { method: "POST", auth, body: escalateBody })) },
];

beforeEach(() => {
  db = datumFixture();
  holder.admin = db;
  created.count = 0;
  process.env.SANO_INTEGRATION_SECRET = SECRET;
  process.env.SANO_INTEGRATION_STAFF_ID = IDS.staffSystem;
});

afterEach(() => {
  delete process.env.SANO_INTEGRATION_SECRET;
  delete process.env.SANO_INTEGRATION_STAFF_ID;
});

describe.each(ROUTES)("$name", ({ call }) => {
  it("answers 401 to a missing, wrong or wrong-length bearer, and never builds the service-role client", async () => {
    for (const auth of [null, "Bearer wrong", `Bearer ${SECRET}x`, SECRET, `Bearer ${"a".repeat(4096)}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, code: "UNAUTHORIZED", error: "Kunci integrasi SANO tidak cocok." });
    }
    expect(created.count).toBe(0);
    expect(db.mutations).toEqual([]);
  });

  it("answers 503 NOT_CONFIGURED when DATUM has no secret, even to the right bearer", async () => {
    delete process.env.SANO_INTEGRATION_SECRET;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(created.count).toBe(0);
  });

  it("answers 200 to the right bearer", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("the four project routes", () => {
  it("answer 404 UNKNOWN_PROJECT for a code DATUM does not have", async () => {
    const auth = `Bearer ${SECRET}`;
    const results = await Promise.all([
      getAreas(sanoRequest("areas?project_code=NOPE", { auth })),
      postAreas(sanoRequest("areas", { method: "POST", auth, body: { project_code: "NOPE", areas: [{ area_code: "X-1", area_name: "X", floor: null, area_type: "general" }] } })),
      getGateStatus(sanoRequest("gate-status?project_code=NOPE", { auth })),
      escalate(sanoRequest("escalate", { method: "POST", auth, body: { ...escalateBody, project_code: "NOPE" } })),
    ]);
    for (const res of results) {
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("UNKNOWN_PROJECT");
    }
  });
});

describe("a full SANO sync against DATUM", () => {
  it("inserts, and never updates or deletes a row", async () => {
    const auth = `Bearer ${SECRET}`;
    await getAreas(sanoRequest("areas?project_code=K2-7", { auth }));
    await postAreas(sanoRequest("areas", { method: "POST", auth, body: { project_code: "K2-7", areas: [
      { area_code: "LT1-KM-1", area_name: "KM beda nama", floor: null, area_type: "general" },
      { area_code: "LT1-KM-2", area_name: "Kamar Mandi 2", floor: "Lt. 1", area_type: "bathroom" },
      { area_code: "UMUM", area_name: "Area Umum", floor: null, area_type: "general", tracked: false },
    ] } }));
    await getGateStatus(sanoRequest("gate-status?project_code=K2-7", { auth }));
    await getStaff(sanoRequest("staff", { auth }));
    await escalate(sanoRequest("escalate", { method: "POST", auth, body: escalateBody }));
    await escalate(sanoRequest("escalate", { method: "POST", auth, body: escalateBody }));

    expect(db.writes("insert").length).toBeGreaterThan(0);
    expect(db.writes("update")).toEqual([]);
    expect(db.writes("delete")).toEqual([]);
    expect(new Set(db.writes("insert").map((m) => m.table))).toEqual(new Set(["areas", "cards", "card_areas", "card_events"]));
  });
});
```

- [ ] **Step 2: Run every SANO suite, the whole web unit suite, the type check and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration/apps/web" && pnpm vitest run tests/unit/sano-integration-routes.test.ts && pnpm vitest run && pnpm typecheck && npx eslint lib/integrations/sano app/api/integrations/sano tests/unit/sano-fake-admin.ts tests/unit/sano-integration-*.ts
```

Expected: the first run `Tests  17 passed (17)`; the full run `Test Files  123 passed (123)` (117 before this lane plus its 6 suites); a clean `tsc --noEmit`; no eslint output.

- [ ] **Step 3: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t6.txt` with the Write tool, exactly:

```text
test(sano): the five SANO routes share one gate and never update

Every route: 401 for a missing, wrong or wrong-length bearer without
building the service-role client, 503 without a secret, 200 with it;
the project routes 404 an unknown code; a full sync inserts only.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && git add apps/web/tests/unit/sano-integration-routes.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/d-t6.txt" -- apps/web/tests/unit/sano-integration-routes.test.ts
```

---

## Lane M: SANO database

Both tasks run in the SANO worktree. Lane M owns only the files named here.

### M-T1 (Lane M, Task 1): Migration 107: DATUM's words, the pairing, sync-only links, the stamp, the cache, the log, the queue

Spec §3, §4, §4.7, §10, §11.1. One file, pasted after 106:

- **Gate words:** eight `UPDATE gate_refs` setting `name_id`, `short_label`, `description` and `datum_gate_code = code` to DATUM's values (spec §3's table, from DATUM `20260531000003_seed_gates_and_checkpoints.sql:6-30` as amended by `20260625000001:14`, short labels from `packages/core/src/gates/labels.ts:3-12`). No INSERT, no DELETE.
- **Pairing:** the shape CHECK and unique index on `projects.datum_project_code` (096:130-131), and `set_datum_project_code(UUID, TEXT)`, DEFINER, `is_office_role()` only, `DATUM_PAIRING_AUTH` / `DATUM_PAIRING_PROJECT` / `DATUM_PAIRING_TAKEN`. No trigger on `projects`.
- **Types:** `rooms_area_type_check` swapped to DATUM's thirteen only when it lacks `'exterior'`, so a 096 re-paste keeps it (096:205-218 adds its own only when absent).
- **Three guards**, each its own function and trigger in the shape of 097's rule-1 guard (097:261-304): `rooms_datum_area_id_sync_only`, `site_events_system_columns_guard` (the three `datum_*` columns and `confirmed_by`), `profiles_datum_staff_id_sync_only`. The event guard's first statement stamps `confirmed_by := auth.uid()` when `confirmed_at` first turns non-null, before the bypass; `confirm_site_event` is the only path that does that and `auth.uid()` still names its caller there (100:189), so 107 redefines no 097, 099, 100 or 105 function.
- **Tables:** `datum_sync_runs` (the partial unique index is the one-open-run lock), `room_datum_gate_status` (DATUM's six states verbatim), `datum_sync_requests`; RLS on, SELECT policies only.
- **Scheduler:** the 106 block (106:368-379) as `datum_sync_hourly`, `0 * * * *`, inserting one request per paired ACTIVE project; a NOTICE without pg_cron. No URL and no secret anywhere in the file.
- Nothing reads or filters `profiles.active`: the live `profiles` table has no such column (035 was never applied live). The guard pins it.

`tools/__tests__/migration101.test.ts` has a scan that fails any later migration writing `gate_refs` words. 107 does so on purpose ("SANO follows DATUM"), so the scan exempts 107 by name and a new test checks 107's header states the hazard both ways (a deliberate difference from spec §3's "gains nothing").

**Files:**
- Create: `supabase/migrations/107_datum_sync.sql`
- Create: `tools/__tests__/migration107.test.ts`
- Modify: `tools/__tests__/migration101.test.ts` (the last `describe` block)

**Depends on:** **U-T1 committed** (`AREA_TYPES` has thirteen values; the guard compares). **M-T2 waits for this commit.**

- [ ] **Step 1: Write the failing static guard**

Create `tools/__tests__/migration107.test.ts` with exactly this content:

```ts
/**
 * Static guard for migration 107 (DATUM sync).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so a comment can never satisfy a guard the SQL fails. Behaviour as
 * real roles (each guard trigger, the confirmer stamp, the pairing RPC, RLS on
 * the three tables, the scheduler with and without pg_cron) is rehearsed on
 * Postgres by supabase/tests/datum_sync_rehearsal/run.sh.
 *
 *  • gate_refs takes DATUM's words for A-H, and nothing else in gate_refs moves.
 *  • The pairing is upper case, unique, and set through one office-only RPC.
 *  • rooms.datum_area_id, the four new site_events columns and
 *    profiles.datum_staff_id are written by the sync, never by an app role.
 *  • confirmed_by is stamped from auth.uid() the moment confirmed_at is set.
 *  • Three tables, RLS on, SELECT policies only; one open run per project.
 *  • The hourly request is scheduled only where pg_cron exists, with no URL
 *    and no secret in the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AREA_TYPES } from '../constants';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '107_datum_sync.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL);
const FILES = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

function fnBody(name: string, code = CODE): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = code.indexOf('$$', start);
  const close = code.indexOf('$$;', open + 2);
  return code.slice(start, close + 3);
}

/** Every CREATE [OR REPLACE] FUNCTION in a file, as [name, text]. */
function functions(code: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const open = code.indexOf('$$', m.index);
    const close = code.indexOf('$$', open + 2);
    if (open < 0 || close < 0) continue;
    out.push([m[1], code.slice(m.index, close + 2)]);
  }
  return out;
}

/** Spec §3's table, verbatim. */
const GATE_WORDS: Record<string, [string, string, string]> = {
  A: ['MEP Rough-in + Persiapan Struktural', 'MEP Rough-in', 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.'],
  B: ['Pekerjaan Basah / Waterproofing', 'Pekerjaan Basah', 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.'],
  C: ['Plafon & Penutupan Selubung', 'Plafon', 'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.'],
  D: ['Finishing Lantai, Dinding & Kusen Aluminium', 'Lantai & Kusen', 'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.'],
  E: ['Finishing Permukaan + Ironwork', 'Cat & Ironwork', 'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.'],
  F: ['Furniture Built-in & Interior', 'Furniture', 'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.'],
  G: ['MEP Fit-out', 'MEP Fit-out', 'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.'],
  H: ['Penyelesaian Akhir & Serah Terima', 'Serah Terima', 'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.'],
};

const DATUM_AREA_TYPES = [
  'bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general',
  'facade', 'terrace', 'hall', 'exterior',
];

/** Sync-only columns whose names no other table uses. */
const SYNC_ONLY_COLUMNS = /\b(?:datum_card_id|datum_card_url|datum_escalated_at|datum_area_id|datum_staff_id)\b/;

describe('migration 107 - header states why, paste order and what a re-paste undoes', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-27-datum-sync-design\.md/);
    expect(SQL).toMatch(/plans\/2026-09-27-datum-sync\.md/);
  });

  it('pastes after 106, and says re-pasting 101 restores the old words', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 106\./);
    expect(SQL).toMatch(/Re-pasting 101 after 107\s+-- restores SANO's old gate words: re-paste 107 after it\./);
    expect(SQL).toMatch(/overwriting any edit made in\s+-- "Kelola gerbang" since the first paste/);
  });

  it('says it is re-paste safe and carries a self-check', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/SELF-CHECK/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(9);
  });

  it('holds no URL, no bearer and no project host, and never posts over HTTP', () => {
    for (const bad of [/Bearer/, /https?:/i, /supabase\.co/, /net\.http_post/]) expect(SQL).not.toMatch(bad);
  });

  it('never mentions profiles.active: the live profiles table has no such column', () => {
    expect(SQL).not.toMatch(/profiles\.active\b/);
    expect(CODE).not.toMatch(/FROM profiles[^;]*\bactive\b/);
  });
});

describe('migration 107 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('changes nothing after RESET: the grid is a SELECT', () => {
    const tail = CODE.slice(CODE.indexOf('RESET lock_timeout;') + 'RESET lock_timeout;'.length);
    expect(tail).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/);
    expect(tail).toMatch(/SELECT g\.code, g\.short_label, g\.name_id, g\.datum_gate_code,/);
  });
});

describe("migration 107 - DATUM's gate words", () => {
  const updates = [...CODE.matchAll(/UPDATE gate_refs SET([\s\S]*?)WHERE code = '([A-H])';/g)];

  it('runs exactly eight UPDATEs, A to H, and no INSERT or DELETE on gate_refs', () => {
    expect(updates.map((m) => m[2])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(CODE.match(/UPDATE gate_refs/g) ?? []).toHaveLength(8);
    expect(CODE).not.toMatch(/INSERT INTO gate_refs|DELETE FROM gate_refs|gate_step_refs/);
  });

  it.each(Object.entries(GATE_WORDS))('%s sets exactly name_id, short_label, description and datum_gate_code = code', (code, words) => {
    const set = updates.find((m) => m[2] === code)?.[1] ?? '';
    const columns = [...set.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]);
    expect(columns).toEqual(['name_id', 'short_label', 'description', 'datum_gate_code']);
    const esc = (s: string) => s.replace(/'/g, "''");
    expect(set).toContain(`name_id         = '${esc(words[0])}'`);
    expect(set).toContain(`short_label     = '${esc(words[1])}'`);
    expect(set).toContain(`description     = '${esc(words[2])}'`);
    expect(set).toMatch(/datum_gate_code = code\s*$/);
  });
});

describe('migration 107 - the pairing', () => {
  it('guards the shape with a CHECK added once, and a partial unique index', () => {
    expect(CODE).toContain("WHERE conname = 'projects_datum_project_code_shape' AND conrelid = 'public.projects'::regclass");
    expect(CODE).toContain(
      "CHECK (datum_project_code IS NULL\n             OR (datum_project_code = upper(btrim(datum_project_code)) AND datum_project_code <> ''));",
    );
    expect(CODE).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_datum_project_code\n  ON projects (datum_project_code) WHERE datum_project_code IS NOT NULL;',
    );
  });

  it('sets it through a DEFINER RPC any office role may call, anon never', () => {
    const fn = fnBody('set_datum_project_code');
    expect(CODE.indexOf('DROP FUNCTION IF EXISTS set_datum_project_code(UUID, TEXT);')).toBeLessThan(
      CODE.indexOf('CREATE OR REPLACE FUNCTION set_datum_project_code('),
    );
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(fn).toMatch(/IF NOT is_office_role\(\) THEN\s+RAISE EXCEPTION 'DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator'/);
    expect(fn).toContain("v_code TEXT := NULLIF(upper(btrim(COALESCE(p_code, ''))), '');");
    expect(fn).toMatch(/EXCEPTION WHEN unique_violation THEN\s+RAISE EXCEPTION 'DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain';/);
    expect(fn).toContain("RAISE EXCEPTION 'DATUM_PAIRING_PROJECT: proyek tidak ditemukan';");
    expect(fn).toContain("RETURN jsonb_build_object('code', v_code);");
    expect(CODE).toContain('REVOKE ALL ON FUNCTION set_datum_project_code(UUID, TEXT) FROM PUBLIC, anon;');
    expect(CODE).toContain('GRANT EXECUTE ON FUNCTION set_datum_project_code(UUID, TEXT) TO authenticated;');
  });

  it('adds no trigger on projects', () => {
    expect(CODE).not.toMatch(/CREATE TRIGGER[^;]*\bON projects\b/);
  });
});

describe("migration 107 - rooms take DATUM's thirteen types", () => {
  const block = () => {
    const start = CODE.indexOf("WHERE conname = 'rooms_area_type_check'");
    return CODE.slice(start, CODE.indexOf('END $$;', start));
  };

  it("swaps the CHECK only when it lacks 'exterior'", () => {
    expect(block()).toContain("IF v_def IS NULL OR v_def NOT LIKE '%''exterior''%' THEN");
    expect(block().indexOf('DROP CONSTRAINT IF EXISTS rooms_area_type_check')).toBeLessThan(block().indexOf('ADD CONSTRAINT rooms_area_type_check'));
  });

  it("lists exactly DATUM's thirteen, which is exactly the app's AREA_TYPES", () => {
    const list = [...(block().match(/CHECK \(area_type IN \(([\s\S]*?)\)\)/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(list).toEqual(DATUM_AREA_TYPES);
    expect(AREA_TYPES.map((t) => t.value)).toEqual(list);
  });
});

describe('migration 107 - sync-only columns', () => {
  const GUARDS: Array<[string, string, string, string]> = [
    ['rooms_datum_area_id_sync_only', 'rooms_datum_area_id_sync_only_trg', 'rooms', 'ROOM_DATUM_LINK_SYNC_ONLY:'],
    ['site_events_system_columns_guard', 'site_events_system_columns_guard_trg', 'site_events', 'SITE_EVENT_SYSTEM_COLUMNS:'],
    ['profiles_datum_staff_id_sync_only', 'profiles_datum_staff_id_sync_only_trg', 'profiles', 'PROFILE_DATUM_LINK_SYNC_ONLY:'],
  ];

  it.each(GUARDS)('%s is its own function, run BEFORE INSERT OR UPDATE by %s on %s', (fn, trg, table, code) => {
    const body = fnBody(fn);
    expect(body).toMatch(/RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public/);
    expect(body).toMatch(
      /IF COALESCE\(auth\.role\(\), ''\) = 'service_role'\s+OR current_user NOT IN \('authenticated', 'anon'\) THEN\s+RETURN NEW;\s+END IF;/,
    );
    expect(body).toContain(`RAISE EXCEPTION '${code}`);
    expect(body).toContain("USING ERRCODE = 'insufficient_privilege';");
    expect(CODE.indexOf(`DROP TRIGGER IF EXISTS ${trg} ON ${table};`)).toBeGreaterThan(-1);
    expect(CODE).toContain(`CREATE TRIGGER ${trg}\n  BEFORE INSERT OR UPDATE ON ${table}\n  FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
  });

  it('the event guard covers the three datum columns and confirmed_by on INSERT and UPDATE', () => {
    const body = fnBody('site_events_system_columns_guard');
    for (const col of ['datum_card_id', 'datum_card_url', 'datum_escalated_at', 'confirmed_by']) {
      expect(body).toContain(`NEW.${col} IS NOT NULL`);
      expect(body).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    }
  });

  it('stamps confirmed_by from auth.uid() before the bypass, only when confirmed_at first turns non-null', () => {
    const body = fnBody('site_events_system_columns_guard');
    const stamp = body.indexOf(
      "IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN\n    NEW.confirmed_by := auth.uid();\n  END IF;",
    );
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(body.indexOf("COALESCE(auth.role(), '') = 'service_role'"));
    expect(body.match(/NEW\.confirmed_by :=/g) ?? []).toHaveLength(1);
  });

  it('adds the four event columns, the escalation index, and the unique staff link index', () => {
    for (const line of [
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_id      UUID;',
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_url     TEXT;',
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_escalated_at TIMESTAMPTZ;',
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS confirmed_by       UUID REFERENCES profiles(id);',
      "  WHERE status = 'open' AND event_type = 'butuh_keputusan' AND datum_card_id IS NULL;",
      'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS datum_staff_id UUID;',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_datum_staff_id\n  ON profiles (datum_staff_id) WHERE datum_staff_id IS NOT NULL;',
    ]) {
      expect(CODE).toContain(line);
    }
  });

  it('across every migration, only these three guards name a sync-only column inside a function', () => {
    const offenders = FILES.flatMap((f) =>
      functions(stripComments(read(f)))
        .filter(([name, text]) => SYNC_ONLY_COLUMNS.test(text) && !(f === FILE && GUARDS.some(([g]) => g === name)))
        .map(([name]) => `${f}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no function that touches site_events names confirmed_by: only the stamp sets it', () => {
    // Worker attendance (017) and client report lines (102) have their own
    // confirmed_by columns; only site_events' is sync-only.
    const offenders = FILES.flatMap((f) =>
      functions(stripComments(read(f)))
        .filter(([, text]) => /\bsite_events\b/.test(text) && /\bconfirmed_by\b/.test(text))
        .map(([name]) => `${f}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('migration 107 - leaves 096-105 alone', () => {
  it('redefines no function of 096, 097, 099, 100 or 105', () => {
    const theirs = ['096_rooms_gates_phase.sql', '097_site_events.sql', '099_site_event_assignment.sql', '100_confirm_vo_evidence_recheck.sql', '105_close_site_event_evidence.sql']
      .flatMap((f) => functions(stripComments(read(f))).map(([name]) => name));
    const mine = functions(CODE).map(([name]) => name);
    expect(mine.filter((n) => theirs.includes(n))).toEqual([]);
  });

  it('creates no policy on rooms, gate_refs or gate_step_refs', () => {
    expect(CODE).not.toMatch(/\bPOLICY\s+(?:IF\s+EXISTS\s+)?"?\w+"?\s+ON\s+(?:public\.)?(?:rooms|gate_refs|gate_step_refs)\b/i);
  });
});

describe('migration 107 - the three tables', () => {
  const TABLES: Array<[string, string, string]> = [
    ['datum_sync_runs', 'datum_sync_runs_read', 'is_project_member(project_id) OR is_office_role()'],
    ['room_datum_gate_status', 'room_datum_gate_status_read', 'is_project_member(project_id) OR is_office_role()'],
    ['datum_sync_requests', 'datum_sync_requests_office_read', 'is_office_role()'],
  ];

  it.each(TABLES)('%s: RLS on, one SELECT policy, no write policy', (table, policy, using) => {
    expect(CODE).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    expect(CODE).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    expect(CODE.indexOf(`DROP POLICY IF EXISTS ${policy} ON ${table};`)).toBeGreaterThan(-1);
    const policies = [...CODE.matchAll(new RegExp(`CREATE POLICY (\\w+) ON ${table}\\s+FOR (\\w+) USING \\(([^;]*)\\);`, 'g'))];
    expect(policies.map((m) => [m[1], m[2], m[3]])).toEqual([[policy, 'SELECT', using]]);
    expect(CODE).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON ${table}[^;]*FOR (?:INSERT|UPDATE|DELETE|ALL)`));
  });

  it('runs: three sources, one open run per project, newest first', () => {
    expect(CODE).toContain("source        TEXT NOT NULL CHECK (source IN ('manual', 'cron', 'import')),");
    expect(CODE).toContain('CREATE UNIQUE INDEX IF NOT EXISTS datum_sync_runs_one_open\n  ON datum_sync_runs(project_id) WHERE finished_at IS NULL;');
    expect(CODE).toContain('ON datum_sync_runs(project_id, started_at DESC);');
  });

  it("the cache: DATUM's six readiness states, keyed by room and gate", () => {
    expect(CODE).toContain(
      "CHECK (status IN ('not_started', 'in_progress', 'ready_for_handoff', 'blocked', 'passed', 'not_applicable')),",
    );
    expect(CODE).toContain('PRIMARY KEY (room_id, gate_code)');
    expect(CODE).toContain('room_id              UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,');
  });
});

describe('migration 107 - scheduler', () => {
  const cronBlock = (): string => {
    const start = CODE.indexOf("IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN");
    return CODE.slice(start, CODE.indexOf('END $$;', start));
  };

  it('schedules only when pg_cron exists, unscheduling the old job first', () => {
    const block = cronBlock();
    expect(block).toContain("IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'datum_sync_hourly') THEN");
    expect(block.indexOf("PERFORM cron.unschedule('datum_sync_hourly');")).toBeLessThan(block.indexOf('cron.schedule('));
    expect(block).toContain("PERFORM cron.schedule('datum_sync_hourly', '0 * * * *',");
  });

  it('inserts one request per paired ACTIVE project, and nothing else', () => {
    expect(cronBlock()).toMatch(
      /\$cmd\$INSERT INTO public\.datum_sync_requests \(project_id\)\s+SELECT id FROM public\.projects\s+WHERE datum_project_code IS NOT NULL AND status = 'ACTIVE'\$cmd\$/,
    );
  });

  it('tells the person pasting how to turn Cron on when it is off', () => {
    expect(cronBlock()).toMatch(/RAISE NOTICE '107: pg_cron belum aktif\. Aktifkan Cron di Dashboard \(Integrations → Cron\), lalu paste 107 lagi\./);
  });

  it('is the last thing that changes anything before RESET', () => {
    expect(CODE.indexOf('PERFORM cron.schedule(')).toBeLessThan(CODE.indexOf('RESET lock_timeout;'));
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/migration107.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `ENOENT: no such file or directory, open '.../supabase/migrations/107_datum_sync.sql'`.

- [ ] **Step 3: Write the migration**

Then scan it for invisible characters: `LC_ALL=C grep -nP '\xCC[\x80-\xFF]|\xCD[\x80-\xAF]|\xE2\x80[\x8B-\x8F]' supabase/migrations/107_datum_sync.sql` must print nothing.

Create `supabase/migrations/107_datum_sync.sql` with exactly this content:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 107 - DATUM sync: DATUM's gate words, the pairing, sync-only links, the
-- confirmer stamp, the readiness cache, the run log and the hourly request.
--
-- Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §3, §4
-- Plan: docs/superpowers/plans/2026-09-27-datum-sync.md (Lane M, Task 1)
--
-- WHY. SANO shaped its rooms and gates like DATUM's in release 1 but never
-- talked to DATUM, and the shapes drifted. This file prepares SANO's side of
-- the link the datum-sync edge function makes:
--   * gate_refs takes DATUM's words for A-H (DATUM gates.name, its short chip
--     name GATE_SHORT_NAME, and gates.description verbatim), and
--     datum_gate_code = code. History keeps its letter.
--   * projects.datum_project_code (096) gets its shape CHECK, a partial
--     unique index, and set_datum_project_code() for any office role.
--   * rooms.datum_area_id, site_events.datum_card_id/_url/_escalated_at,
--     site_events.confirmed_by and profiles.datum_staff_id are written only by
--     the service role (the sync), a DEFINER RPC or the Dashboard: three new
--     guard triggers refuse them from app roles.
--   * site_events.confirmed_by is stamped by a trigger when confirmed_at first
--     turns non-null, i.e. inside confirm_site_event, with auth.uid() - the
--     confirmer. Events confirmed before 107 keep NULL: unknown, never guessed.
--   * rooms.area_type widens to DATUM's thirteen area types.
--   * room_datum_gate_status caches DATUM's readiness verbatim; datum_sync_runs
--     logs every run (one open run per project); datum_sync_requests is the
--     hourly queue a Database Webhook delivers to the function.
--
-- PASTE ORDER. After 106. It reads 096's rooms, gate_refs and
-- is_office_role(), 097's site_events and 106's scheduler pattern.
--
-- RE-PASTE SAFETY. UPDATEs to fixed values, ADD COLUMN / CREATE TABLE /
-- CREATE INDEX IF NOT EXISTS, constraints added inside pg_constraint guards,
-- DROP FUNCTION IF EXISTS by exact signature before each CREATE OR REPLACE,
-- DROP TRIGGER / POLICY IF EXISTS before each create, and the cron job
-- unscheduled before it is scheduled again: a second paste changes nothing,
-- EXCEPT that it writes DATUM's gate words again, overwriting any edit made in
-- "Kelola gerbang" since the first paste (as 101 does).
--
-- WHAT A RE-PASTE OF AN EARLIER FILE UNDOES. Re-pasting 101 after 107
-- restores SANO's old gate words: re-paste 107 after it. Re-pasting 096 keeps
-- the wide area_type CHECK (096 adds its own only when the name is absent).
-- Re-pasting 097, 099, 100 or 105 reverts nothing here: 107 redefines none of
-- their functions and adds its guards as separate triggers.
--
-- SCHEDULER. The last block schedules the hourly request only when pg_cron is
-- enabled. Without it the paste still succeeds and prints a NOTICE; the
-- "Sinkron DATUM" button works either way. No URL and no secret is stored
-- here: delivery is the Database Webhook the owner creates once.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. DATUM's gate words (DATUM 20260531000003_seed_gates_and_checkpoints.sql
--    as amended by 20260625000001:14; short labels from DATUM
--    packages/core/src/gates/labels.ts GATE_SHORT_NAME).
-- ───────────────────────────────────────────────────────────────────────────

UPDATE gate_refs SET
  name_id         = 'MEP Rough-in + Persiapan Struktural',
  short_label     = 'MEP Rough-in',
  description     = 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.',
  datum_gate_code = code
WHERE code = 'A';

UPDATE gate_refs SET
  name_id         = 'Pekerjaan Basah / Waterproofing',
  short_label     = 'Pekerjaan Basah',
  description     = 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.',
  datum_gate_code = code
WHERE code = 'B';

UPDATE gate_refs SET
  name_id         = 'Plafon & Penutupan Selubung',
  short_label     = 'Plafon',
  description     = 'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.',
  datum_gate_code = code
WHERE code = 'C';

UPDATE gate_refs SET
  name_id         = 'Finishing Lantai, Dinding & Kusen Aluminium',
  short_label     = 'Lantai & Kusen',
  description     = 'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.',
  datum_gate_code = code
WHERE code = 'D';

UPDATE gate_refs SET
  name_id         = 'Finishing Permukaan + Ironwork',
  short_label     = 'Cat & Ironwork',
  description     = 'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.',
  datum_gate_code = code
WHERE code = 'E';

UPDATE gate_refs SET
  name_id         = 'Furniture Built-in & Interior',
  short_label     = 'Furniture',
  description     = 'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.',
  datum_gate_code = code
WHERE code = 'F';

UPDATE gate_refs SET
  name_id         = 'MEP Fit-out',
  short_label     = 'MEP Fit-out',
  description     = 'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.',
  datum_gate_code = code
WHERE code = 'G';

UPDATE gate_refs SET
  name_id         = 'Penyelesaian Akhir & Serah Terima',
  short_label     = 'Serah Terima',
  description     = 'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.',
  datum_gate_code = code
WHERE code = 'H';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The pairing: projects.datum_project_code (096) upper case, unique, and
--    set by any office role through one RPC. Direct UPDATEs of projects are
--    already office-only (023/036/037); the CHECK and the index hold whichever
--    path wrote the value, so no trigger is added on projects.
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_datum_project_code_shape' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_datum_project_code_shape
      CHECK (datum_project_code IS NULL
             OR (datum_project_code = upper(btrim(datum_project_code)) AND datum_project_code <> ''));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_datum_project_code
  ON projects (datum_project_code) WHERE datum_project_code IS NOT NULL;

DROP FUNCTION IF EXISTS set_datum_project_code(UUID, TEXT);

CREATE OR REPLACE FUNCTION set_datum_project_code(p_project_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := NULLIF(upper(btrim(COALESCE(p_code, ''))), '');
BEGIN
  IF NOT is_office_role() THEN
    RAISE EXCEPTION 'DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'DATUM_PAIRING_PROJECT: proyek tidak ditemukan';
  END IF;
  BEGIN
    UPDATE projects SET datum_project_code = v_code WHERE id = p_project_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain';
  END;
  RETURN jsonb_build_object('code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION set_datum_project_code(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_datum_project_code(UUID, TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. rooms: DATUM's thirteen area types, and a link only the sync writes
--    (rooms_office_all, 096, lets every office role write any column).
-- ───────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'rooms_area_type_check' AND conrelid = 'public.rooms'::regclass;
  IF v_def IS NULL OR v_def NOT LIKE '%''exterior''%' THEN
    ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_area_type_check;
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_area_type_check
      CHECK (area_type IN (
        'bathroom','kitchen','bedroom','living','dining',
        'garden','circulation','utility','general',
        'facade','terrace','hall','exterior'
      ));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION rooms_datum_area_id_sync_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.datum_area_id IS NOT NULL THEN
      RAISE EXCEPTION 'ROOM_DATUM_LINK_SYNC_ONLY: tautan area DATUM hanya diisi oleh sinkron DATUM'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.datum_area_id IS DISTINCT FROM OLD.datum_area_id THEN
    RAISE EXCEPTION 'ROOM_DATUM_LINK_SYNC_ONLY: tautan area DATUM hanya diubah oleh sinkron DATUM'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_datum_area_id_sync_only_trg ON rooms;
CREATE TRIGGER rooms_datum_area_id_sync_only_trg
  BEFORE INSERT OR UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION rooms_datum_area_id_sync_only();

-- ───────────────────────────────────────────────────────────────────────────
-- 4. site_events: the escalation columns and the confirmer. A separate guard,
--    not an edit of 097's human-fields guard: a 097 re-paste would revert an
--    edit there (the 105 hazard) and break its pinned shape.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_id      UUID;
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_url     TEXT;
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_escalated_at TIMESTAMPTZ;
ALTER TABLE site_events ADD COLUMN IF NOT EXISTS confirmed_by       UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_site_events_escalation_due
  ON site_events(project_id)
  WHERE status = 'open' AND event_type = 'butuh_keputusan' AND datum_card_id IS NULL;

CREATE OR REPLACE FUNCTION site_events_system_columns_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  -- The stamp comes before the bypass: confirm_site_event (a DEFINER RPC,
  -- which the bypass lets through) is the only path that moves confirmed_at
  -- from NULL, and auth.uid() still names its caller there.
  IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN
    NEW.confirmed_by := auth.uid();
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.datum_card_id IS NOT NULL
       OR NEW.datum_card_url IS NOT NULL
       OR NEW.datum_escalated_at IS NOT NULL
       OR NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION 'SITE_EVENT_SYSTEM_COLUMNS: kolom ini hanya diisi oleh sistem'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.datum_card_id IS DISTINCT FROM OLD.datum_card_id
     OR NEW.datum_card_url IS DISTINCT FROM OLD.datum_card_url
     OR NEW.datum_escalated_at IS DISTINCT FROM OLD.datum_escalated_at
     OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    RAISE EXCEPTION 'SITE_EVENT_SYSTEM_COLUMNS: kolom ini hanya diisi oleh sistem'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_events_system_columns_guard_trg ON site_events;
CREATE TRIGGER site_events_system_columns_guard_trg
  BEFORE INSERT OR UPDATE ON site_events
  FOR EACH ROW EXECUTE FUNCTION site_events_system_columns_guard();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. profiles.datum_staff_id: one SANO person per DATUM staff row, set only
--    by the sync (profiles_self_update and profiles_update_managers would
--    otherwise let a person, or a manager, point it anywhere).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS datum_staff_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_datum_staff_id
  ON profiles (datum_staff_id) WHERE datum_staff_id IS NOT NULL;

CREATE OR REPLACE FUNCTION profiles_datum_staff_id_sync_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.datum_staff_id IS NOT NULL THEN
      RAISE EXCEPTION 'PROFILE_DATUM_LINK_SYNC_ONLY: tautan staf DATUM hanya diisi oleh sinkron DATUM'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.datum_staff_id IS DISTINCT FROM OLD.datum_staff_id THEN
    RAISE EXCEPTION 'PROFILE_DATUM_LINK_SYNC_ONLY: tautan staf DATUM hanya diubah oleh sinkron DATUM'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_datum_staff_id_sync_only_trg ON profiles;
CREATE TRIGGER profiles_datum_staff_id_sync_only_trg
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_datum_staff_id_sync_only();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. datum_sync_runs - one row per run. The partial unique index is the lock:
--    one open run per project. Read by members (the board's last good gate
--    read) and office roles (every run: the staff picture is global).
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datum_sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'cron', 'import')),
  requested_by  UUID REFERENCES profiles(id),
  request_id    UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  ok            BOOLEAN,
  counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  differences   JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS datum_sync_runs_one_open
  ON datum_sync_runs(project_id) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_datum_sync_runs_project_started
  ON datum_sync_runs(project_id, started_at DESC);

ALTER TABLE datum_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS datum_sync_runs_read ON datum_sync_runs;
CREATE POLICY datum_sync_runs_read ON datum_sync_runs
  FOR SELECT USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 7. room_datum_gate_status - DATUM's readiness per room and gate, verbatim.
--    Upserted by the sync, never deleted: an old row ages into "lama".
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS room_datum_gate_status (
  room_id              UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  gate_code            TEXT NOT NULL REFERENCES gate_refs(code),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  datum_area_id        UUID NOT NULL,
  status               TEXT NOT NULL
                       CHECK (status IN ('not_started', 'in_progress', 'ready_for_handoff', 'blocked', 'passed', 'not_applicable')),
  datum_stale          BOOLEAN NOT NULL,
  datum_updated_at     TIMESTAMPTZ,
  datum_recomputed_at  TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ NOT NULL,
  run_id               UUID REFERENCES datum_sync_runs(id),
  PRIMARY KEY (room_id, gate_code)
);

CREATE INDEX IF NOT EXISTS idx_room_datum_gate_status_project
  ON room_datum_gate_status(project_id);

ALTER TABLE room_datum_gate_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS room_datum_gate_status_read ON room_datum_gate_status;
CREATE POLICY room_datum_gate_status_read ON room_datum_gate_status
  FOR SELECT USING (is_project_member(project_id) OR is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 8. datum_sync_requests - the hourly queue. pg_cron (postgres) inserts, the
--    function (service role) marks each handled. Office roles read it for the
--    "Sinkron otomatis menunggu" line.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS datum_sync_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at    TIMESTAMPTZ,
  run_id        UUID REFERENCES datum_sync_runs(id),
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_datum_sync_requests_waiting
  ON datum_sync_requests(project_id, requested_at) WHERE handled_at IS NULL;

ALTER TABLE datum_sync_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS datum_sync_requests_office_read ON datum_sync_requests;
CREATE POLICY datum_sync_requests_office_read ON datum_sync_requests
  FOR SELECT USING (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Scheduler: one request per paired ACTIVE project, every hour. The
--    cron.* statements are planned only when their branch runs, so this
--    block pastes cleanly on a project without pg_cron.
-- ───────────────────────────────────────────────────────────────────────────

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

-- Close-out: every statement that changes anything is above this line. Hand a
-- reused editor connection back with its default lock timeout.
RESET lock_timeout;

-- The result grid: DATUM's words per gate, and how many confirmed events now
-- read under each (their letter did not move, their word did).
SELECT g.code, g.short_label, g.name_id, g.datum_gate_code,
       (SELECT count(*) FROM site_events e WHERE e.gate_code = g.code AND e.confirmed_at IS NOT NULL) AS confirmed_events
FROM gate_refs g
ORDER BY g.sort_order;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; checks 1-8 write nothing)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: eight rows A-H, short_label MEP Rough-in, Pekerjaan Basah,
--    Plafon, Lantai & Kusen, Cat & Ironwork, Furniture, MEP Fit-out,
--    Serah Terima, and datum_gate_code equal to code on every row.
--
-- 2. The pairing is guarded and callable by the app:
--      SELECT conname FROM pg_constraint WHERE conname = 'projects_datum_project_code_shape';
--      SELECT proname, prosecdef, has_function_privilege('authenticated', oid, 'EXECUTE') AS app_exec,
--             has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
--      FROM pg_proc WHERE proname = 'set_datum_project_code';
--    EXPECTED: one constraint row; one function row with prosecdef = true,
--    app_exec = true and anon_exec = false.
--
-- 3. The three guards are in place:
--      SELECT tgname, tgrelid::regclass FROM pg_trigger
--      WHERE tgname IN ('rooms_datum_area_id_sync_only_trg', 'site_events_system_columns_guard_trg',
--                       'profiles_datum_staff_id_sync_only_trg') ORDER BY 1;
--    EXPECTED: three rows, on profiles, rooms and site_events.
--
-- 4. The confirmer column is embeddable by the app:
--      SELECT conname FROM pg_constraint WHERE conname = 'site_events_confirmed_by_fkey';
--    EXPECTED: one row. The app reads confirmer:profiles!site_events_confirmed_by_fkey.
--
-- 5. Room types are DATUM's thirteen:
--      SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'rooms_area_type_check';
--    EXPECTED: 13 quoted types, facade, terrace, hall and exterior among them.
--
-- 6. The three tables read, and only read, through RLS:
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE tablename IN ('datum_sync_runs', 'room_datum_gate_status', 'datum_sync_requests') ORDER BY 1;
--    EXPECTED: three rows, each cmd = SELECT.
--
-- 7. The schedule exists (after Cron is enabled):
--      SELECT jobname, schedule FROM cron.job WHERE jobname = 'datum_sync_hourly';
--    EXPECTED: one row, 0 * * * *. An error "relation cron.job does not exist"
--    means pg_cron is not enabled: enable it and paste this file again.
--
-- 8. Nobody is linked yet:
--      SELECT count(*) FILTER (WHERE datum_staff_id IS NOT NULL) AS staff_links FROM profiles;
--      SELECT count(*) FILTER (WHERE datum_area_id IS NOT NULL) AS room_links FROM rooms;
--    EXPECTED: 0 and 0 until the first "Sinkron DATUM".
--
-- 9. Re-paste this whole file.
--    EXPECTED: no error, and checks 1-8 unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 4: Let 101's guard allow exactly 107**

In `tools/__tests__/migration101.test.ts`, replace

```ts
describe('migration 101 - nothing later reverts it', () => {
  it('no later migration writes gate_refs.short_label/name_id/description', () => {
    const later = fs.readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 101);
    const touching = later.filter((f) =>
      /UPDATE\s+gate_refs\s+SET[\s\S]*?(name_id|short_label|description)/i
        .test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))),
    );
    expect(touching).toEqual([]);
  });
});
```

with

```ts
/**
 * 107 replaces these words with DATUM's on purpose (DATUM sync spec
 * 2026-09-27 §3: "SANO follows DATUM"). It is the one later file allowed to
 * write them, and only because its header names the hazard both ways.
 */
const SUPERSEDED_BY = '107_datum_sync.sql';

describe('migration 101 - nothing later reverts it', () => {
  it('no later migration writes gate_refs.short_label/name_id/description, except 107 by design', () => {
    const later = fs.readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 101 && f !== SUPERSEDED_BY);
    const touching = later.filter((f) =>
      /UPDATE\s+gate_refs\s+SET[\s\S]*?(name_id|short_label|description)/i
        .test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))),
    );
    expect(touching).toEqual([]);
  });

  it('107, which does write them, says that re-pasting 101 restores the old words', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, SUPERSEDED_BY), 'utf8');
    expect(sql).toMatch(/Re-pasting 101 after 107\s+-- restores SANO's old gate words: re-paste 107 after it\./);
  });
});
```

- [ ] **Step 5: Run the guard, every migration suite and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/migration --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 21 passed, 21 total` (migration107 alone: `Tests: 40 passed`), and no tsc output.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/m-t1.txt` with the Write tool, exactly:

```text
feat(db): 107 DATUM sync - gate words, pairing, sync-only links, cache, run log, hourly queue

SANO takes DATUM's words for gates A-H. projects.datum_project_code gets
its shape CHECK, a unique index and set_datum_project_code for any office
role. rooms.datum_area_id, site_events.datum_card_*/confirmed_by and
profiles.datum_staff_id are written only by the sync (three new guard
triggers); confirmed_by is stamped from auth.uid() when confirmed_at is
first set. Room types widen to DATUM's thirteen. room_datum_gate_status,
datum_sync_runs (one open run per project) and datum_sync_requests are
read-only to app roles. pg_cron queues one request per paired ACTIVE
project every hour. migration101's later-writes scan exempts 107 by name.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add supabase/migrations/107_datum_sync.sql tools/__tests__/migration107.test.ts tools/__tests__/migration101.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/m-t1.txt" -- supabase/migrations/107_datum_sync.sql tools/__tests__/migration107.test.ts tools/__tests__/migration101.test.ts
```

### M-T2 (Lane M, Task 2): Docker rehearsal of 107 as real roles

Spec §11.2. Modelled on `supabase/tests/site_event_closure_rehearsal/run.sh` (image, `as_user`, `expect`, `expect_error`, tally), in its own container `sano-pg-datum-rehearsal`, reusing that folder's `storage_stub.sql` (105 needs `storage.objects` to paste). It applies 001-106 once, pastes 107 twice, builds a fixture of four projects (paired ACTIVE, unpaired ACTIVE, paired ON_HOLD, unpaired), five people and four rooms, then checks every row of spec §11.2's table as supervisor, estimator, admin, principal, an outsider, the function's `service_role` (role and JWT claim) and `postgres`. It then re-pastes 097 and 096 to prove 107's guards and wide CHECK survive them (and 100 and 105 to undo 097's own revert), re-pastes 101 then 107 to prove the gate-word hazard and its cure, and pastes 107 without and with pg_cron. The scripts run as `supabase_admin` so `SET LOCAL ROLE` can become any role. Writes that RLS must refuse are checked with `writes_nothing`, which passes on 0 rows touched or SQLSTATE 42501 (both the RLS refusal and a missing grant).

**Files:**
- Create: `supabase/tests/datum_sync_rehearsal/fixture.sql`
- Create: `supabase/tests/datum_sync_rehearsal/rehearse_107.sql`
- Create: `supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql`
- Create: `supabase/tests/datum_sync_rehearsal/run.sh`

**Depends on:** M-T1 committed.

- [ ] **Step 1: Write the fixture**

Create `supabase/tests/datum_sync_rehearsal/fixture.sql` with exactly this content:

```sql
-- supabase/tests/datum_sync_rehearsal/fixture.sql
-- Disposable fixture for run.sh: four projects, five people, four rooms, the
-- events the confirmer-stamp and guard checks read, one run, one cache row
-- and one request. Run as supabase_admin, after 107 is pasted. Re-runnable: it
-- deletes its own projects first (everything hanging off them cascades) and
-- clears the staff links it may have set on its own profiles last time.
CREATE SCHEMA IF NOT EXISTS rehearsal_ds;
GRANT USAGE ON SCHEMA rehearsal_ds TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION rehearsal_ds.u(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'sup' THEN 'f101' WHEN 'est' THEN 'f102' WHEN 'adm' THEN 'f103' WHEN 'pri' THEN 'f104' WHEN 'out' THEN 'f105' END)::uuid $$;
-- 1 = REH-DS-A (ACTIVE, paired REHDS-A), 2 = REH-DS-B (ACTIVE, unpaired: the
-- pairing checks use it and leave it unpaired), 3 = REH-DS-C (ON_HOLD, paired
-- REHDS-C), 4 = REH-DS-D (ACTIVE, unpaired, nobody's).
CREATE OR REPLACE FUNCTION rehearsal_ds.p(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000f20' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.room(n INT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000f30' || n)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.ev(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-00000000' || CASE p_name
    WHEN 'open' THEN 'f401' WHEN 'prog' THEN 'f402' WHEN 'c1' THEN 'f403' WHEN 'c2' THEN 'f404'
    WHEN 'c4' THEN 'f405' WHEN 'new1' THEN 'f406' WHEN 'new2' THEN 'f407' END)::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.run1() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT '00000000-0000-4000-8000-00000000f501'::uuid $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.today() RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.as_user(p_name TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', rehearsal_ds.u(p_name)::text, true)
      || set_config('request.jwt.claim.role', 'authenticated', true)
      || set_config('request.jwt.claims', json_build_object('sub', rehearsal_ds.u(p_name), 'role', 'authenticated')::text, true) $$;
-- The datum-sync function's identity: service_role in the JWT, no subject.
CREATE OR REPLACE FUNCTION rehearsal_ds.as_service() RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true)
      || set_config('request.jwt.claim.role', 'service_role', true)
      || set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true) $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.as_nobody() RETURNS TEXT LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '', true)
      || set_config('request.jwt.claim.role', '', true)
      || set_config('request.jwt.claims', '', true) $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.expect(p_label TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE sql AS $$
  SELECT CASE WHEN p_ok THEN 'PASS ' ELSE 'FAIL ' END || p_label || COALESCE(' :: ' || p_detail, '') $$;
CREATE OR REPLACE FUNCTION rehearsal_ds.expect_error(p_label TEXT, p_sql TEXT, p_prefix TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FAIL ' || p_label || ' :: no error';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE p_prefix || '%' THEN 'PASS ' ELSE 'FAIL ' END || p_label || ' :: ' || SQLERRM;
END $$;
-- Runs a statement and returns how many rows it touched: an UPDATE or DELETE
-- that RLS filters is not an error, it just touches nothing.
CREATE OR REPLACE FUNCTION rehearsal_ds.touched(p_sql TEXT) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- True when a write by the current role changed nothing: RLS filtered every
-- row (0 touched), or refused it outright (SQLSTATE 42501, which is both an
-- INSERT's "new row violates row-level security policy" and a missing grant).
CREATE OR REPLACE FUNCTION rehearsal_ds.writes_nothing(p_sql TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 0;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN TRUE;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rehearsal_ds TO authenticated, service_role, postgres;

DELETE FROM projects WHERE id IN (rehearsal_ds.p(1), rehearsal_ds.p(2), rehearsal_ds.p(3), rehearsal_ds.p(4));

INSERT INTO auth.users (id, email)
SELECT rehearsal_ds.u(n), n || '@datum-rehearsal.test'
FROM unnest(ARRAY['sup', 'est', 'adm', 'pri', 'out']) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role) VALUES
  (rehearsal_ds.u('sup'), 'Rehearsal DS Supervisor', 'supervisor'),
  (rehearsal_ds.u('est'), 'Rehearsal DS Estimator',  'estimator'),
  (rehearsal_ds.u('adm'), 'Rehearsal DS Admin',      'admin'),
  (rehearsal_ds.u('pri'), 'Rehearsal DS Principal',  'principal'),
  (rehearsal_ds.u('out'), 'Rehearsal DS Outsider',   'supervisor')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
-- supabase_admin is not an app role, so 107's guard lets this through.
UPDATE profiles SET datum_staff_id = NULL
WHERE id IN (rehearsal_ds.u('sup'), rehearsal_ds.u('est'), rehearsal_ds.u('adm'), rehearsal_ds.u('pri'), rehearsal_ds.u('out'));

INSERT INTO projects (id, code, name, status, datum_project_code) VALUES
  (rehearsal_ds.p(1), 'REH-DS-A', 'Rehearsal DATUM A', 'ACTIVE',  'REHDS-A'),
  (rehearsal_ds.p(2), 'REH-DS-B', 'Rehearsal DATUM B', 'ACTIVE',  NULL),
  (rehearsal_ds.p(3), 'REH-DS-C', 'Rehearsal DATUM C', 'ON_HOLD', 'REHDS-C'),
  (rehearsal_ds.p(4), 'REH-DS-D', 'Rehearsal DATUM D', 'ACTIVE',  NULL);

INSERT INTO project_assignments (project_id, user_id) VALUES
  (rehearsal_ds.p(1), rehearsal_ds.u('sup')), (rehearsal_ds.p(1), rehearsal_ds.u('est')),
  (rehearsal_ds.p(1), rehearsal_ds.u('adm')), (rehearsal_ds.p(1), rehearsal_ds.u('pri')),
  (rehearsal_ds.p(2), rehearsal_ds.u('sup')), (rehearsal_ds.p(2), rehearsal_ds.u('pri')),
  (rehearsal_ds.p(3), rehearsal_ds.u('sup')), (rehearsal_ds.p(3), rehearsal_ds.u('pri'))
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO rooms (id, project_id, room_code, room_name, floor, area_type) VALUES
  (rehearsal_ds.room(1), rehearsal_ds.p(1), 'LT1-KM-1',  'Kamar Mandi 1', 'Lt. 1', 'bathroom'),
  (rehearsal_ds.room(2), rehearsal_ds.p(1), 'LT1-DAPUR', 'Dapur',         'Lt. 1', 'kitchen'),
  (rehearsal_ds.room(3), rehearsal_ds.p(2), 'LT1-KM-1',  'Kamar Mandi 1', 'Lt. 1', 'bathroom'),
  (rehearsal_ds.room(4), rehearsal_ds.p(3), 'LT1-KM-1',  'Kamar Mandi 1', 'Lt. 1', 'bathroom');

-- 'open' and 'prog' are confirmed already (inserted open, as the Dashboard
-- could); c1, c2 and c4 wait for confirm_site_event, which stamps confirmed_by.
INSERT INTO site_events (id, project_id, room_id, reporter_id, status, event_type, title, owner_id, due_date, captured_at, confirmed_at) VALUES
  (rehearsal_ds.ev('open'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), 'open', 'butuh_keputusan', 'Pilih warna nat', rehearsal_ds.u('sup'), rehearsal_ds.today() + 7, now() - interval '1 day', now() - interval '1 day'),
  (rehearsal_ds.ev('prog'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), 'open', 'progres', 'Acian selesai', NULL, NULL, now() - interval '1 day', now() - interval '1 day');
INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at) VALUES
  (rehearsal_ds.ev('c1'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), now() - interval '2 hours'),
  (rehearsal_ds.ev('c2'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), now() - interval '2 hours'),
  (rehearsal_ds.ev('c4'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), now() - interval '2 hours');

-- One finished run, one cache row and one waiting request on project A.
INSERT INTO datum_sync_runs (id, project_id, source, started_at, finished_at, ok, counts)
VALUES (rehearsal_ds.run1(), rehearsal_ds.p(1), 'cron', now() - interval '1 hour', now() - interval '59 minutes', true,
        '{"steps": {"areas": "ok", "gate_status": "ok"}}'::jsonb);
INSERT INTO room_datum_gate_status (room_id, gate_code, project_id, datum_area_id, status, datum_stale, synced_at, run_id)
VALUES (rehearsal_ds.room(1), 'A', rehearsal_ds.p(1), '00000000-0000-4000-8000-00000000f601', 'passed', false, now() - interval '59 minutes', rehearsal_ds.run1());
INSERT INTO datum_sync_requests (project_id, requested_at) VALUES (rehearsal_ds.p(1), now() - interval '3 hours');

SELECT 'fixture ready: ' || (SELECT count(*) FROM site_events WHERE project_id = rehearsal_ds.p(1)) || ' events on A, '
  || (SELECT count(*) FROM rooms WHERE project_id IN (rehearsal_ds.p(1), rehearsal_ds.p(2), rehearsal_ds.p(3))) || ' rooms';
```

- [ ] **Step 2: Write the checks**

Create `supabase/tests/datum_sync_rehearsal/rehearse_107.sql` with exactly this content:

```sql
-- supabase/tests/datum_sync_rehearsal/rehearse_107.sql
-- Behaviour checks for migration 107 as real roles. Run by run.sh, as
-- supabase_admin (so SET LOCAL ROLE can become any role), after fixture.sql.
-- Every line prints PASS or FAIL.
\pset tuples_only on
\pset format unaligned

-- A. Gate words (107 has been pasted twice by now)
SELECT rehearsal_ds.expect('107 gate_refs holds exactly eight rows', (SELECT count(*) = 8 FROM gate_refs));
SELECT rehearsal_ds.expect('107 the eight rows carry DATUM''s words and datum_gate_code = code, after two pastes', (
  SELECT count(*) = 8 FROM gate_refs g JOIN (VALUES
    ('A', 'MEP Rough-in + Persiapan Struktural', 'MEP Rough-in', 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.'),
    ('B', 'Pekerjaan Basah / Waterproofing', 'Pekerjaan Basah', 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.'),
    ('C', 'Plafon & Penutupan Selubung', 'Plafon', 'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.'),
    ('D', 'Finishing Lantai, Dinding & Kusen Aluminium', 'Lantai & Kusen', 'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.'),
    ('E', 'Finishing Permukaan + Ironwork', 'Cat & Ironwork', 'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.'),
    ('F', 'Furniture Built-in & Interior', 'Furniture', 'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.'),
    ('G', 'MEP Fit-out', 'MEP Fit-out', 'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.'),
    ('H', 'Penyelesaian Akhir & Serah Terima', 'Serah Terima', 'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.')
  ) AS w(code, name_id, short_label, description)
    ON w.code = g.code AND w.name_id = g.name_id AND w.short_label = g.short_label
   AND w.description = g.description AND g.datum_gate_code = g.code));

-- B. Event columns: app roles cannot write them
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set datum_card_id', format('UPDATE site_events SET datum_card_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set datum_card_url', format('UPDATE site_events SET datum_card_url = %L WHERE id = %L', 'https://x', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set datum_escalated_at', format('UPDATE site_events SET datum_escalated_at = now() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot set confirmed_by', format('UPDATE site_events SET confirmed_by = %L WHERE id = %L', rehearsal_ds.u('sup'), rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot insert an event carrying datum_card_id', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, datum_card_id) VALUES (%L, %L, %L, %L, now(), gen_random_uuid())',
  rehearsal_ds.ev('new1'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect_error('107 a supervisor cannot insert an event carrying confirmed_by', format(
  'INSERT INTO site_events (id, project_id, room_id, reporter_id, captured_at, confirmed_by) VALUES (%L, %L, %L, %L, now(), %L)',
  rehearsal_ds.ev('new2'), rehearsal_ds.p(1), rehearsal_ds.room(1), rehearsal_ds.u('sup'), rehearsal_ds.u('sup')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect('107 close_site_event still works for a member', (close_site_event(rehearsal_ds.ev('prog'), NULL) ->> 'status') = 'done');
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 an admin cannot set datum_card_id either', format('UPDATE site_events SET datum_card_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
ROLLBACK;

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role writes the three datum columns', rehearsal_ds.touched(format(
  'UPDATE site_events SET datum_card_id = %L, datum_card_url = %L, datum_escalated_at = now() WHERE id = %L',
  '00000000-0000-4000-8000-00000000f701', 'https://datum.example/project/rehds-a/cards/pilih-warna-nat', rehearsal_ds.ev('open'))) = 1);
COMMIT;

BEGIN; SET LOCAL ROLE postgres; SELECT rehearsal_ds.as_nobody() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 postgres (the Dashboard) writes confirmed_by', rehearsal_ds.touched(format(
  'UPDATE site_events SET confirmed_by = %L WHERE id = %L', rehearsal_ds.u('adm'), rehearsal_ds.ev('open'))) = 1);
ROLLBACK;

SELECT rehearsal_ds.expect('107 the card columns landed as the service role wrote them', (
  SELECT datum_card_id = '00000000-0000-4000-8000-00000000f701' AND datum_escalated_at IS NOT NULL FROM site_events WHERE id = rehearsal_ds.ev('open')));

-- C. The confirmer stamp
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a member confirms (setup)', (confirm_site_event(
  rehearsal_ds.ev('c1'), 'butuh_keputusan', NULL, NULL, 'Pilih keramik', NULL, rehearsal_ds.u('sup'),
  rehearsal_ds.today() + 7, NULL, false, false, NULL, NULL) ->> 'status') = 'open');
COMMIT;
SELECT rehearsal_ds.expect('107 confirm_site_event as a member stamps that member', (SELECT confirmed_by = rehearsal_ds.u('sup') FROM site_events WHERE id = rehearsal_ds.ev('c1')));

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role confirms (setup)', (confirm_site_event(
  rehearsal_ds.ev('c2'), 'progres', NULL, NULL, 'Dikonfirmasi sistem', NULL, NULL, NULL, NULL, false, false, NULL, NULL) ->> 'status') = 'open');
COMMIT;
SELECT rehearsal_ds.expect('107 confirm_site_event as service_role stamps NULL: unknown, never guessed', (SELECT confirmed_by IS NULL AND confirmed_at IS NOT NULL FROM site_events WHERE id = rehearsal_ds.ev('c2')));

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 another member closes the decision (setup)', (close_site_event(rehearsal_ds.ev('c1'), 'Keramik putih dipilih pemilik') ->> 'status') = 'done');
COMMIT;
SELECT rehearsal_ds.expect('107 a later update never moves the stamp', (SELECT confirmed_by = rehearsal_ds.u('sup') AND closed_by = rehearsal_ds.u('est') FROM site_events WHERE id = rehearsal_ds.ev('c1')));

-- D. Room link and types
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 an estimator cannot set rooms.datum_area_id', format('UPDATE rooms SET datum_area_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.room(1)), 'ROOM_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect_error('107 an estimator cannot insert a room carrying datum_area_id', format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type, datum_area_id) VALUES (%L, %L, %L, %L, gen_random_uuid())',
  rehearsal_ds.p(1), 'LT2-KAMAR', 'Kamar', 'bedroom'), 'ROOM_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect('107 an estimator still renames a room', rehearsal_ds.touched(format(
  'UPDATE rooms SET room_name = %L WHERE id = %L', 'Kamar Mandi Satu', rehearsal_ds.room(1))) = 1);
SELECT rehearsal_ds.expect('107 facade and exterior are accepted room types', rehearsal_ds.touched(format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type) VALUES (%L, %L, %L, %L), (%L, %L, %L, %L)',
  rehearsal_ds.p(1), 'FASAD', 'Fasad Depan', 'facade', rehearsal_ds.p(1), 'LUAR', 'Carport', 'exterior')) = 2);
SELECT rehearsal_ds.expect_error('107 an unknown room type is refused', format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type) VALUES (%L, %L, %L, %L)',
  rehearsal_ds.p(1), 'SAUNA', 'Sauna', 'foo'), 'new row for relation "rooms" violates check constraint "rooms_area_type_check"');
COMMIT;

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role links a room', rehearsal_ds.touched(format(
  'UPDATE rooms SET datum_area_id = %L WHERE id = %L', '00000000-0000-4000-8000-00000000f601', rehearsal_ds.room(1))) = 1);
COMMIT;

-- E. Staff link
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 a user cannot set their own datum_staff_id', format('UPDATE profiles SET datum_staff_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.u('sup')), 'PROFILE_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect('107 a user still renames themself', rehearsal_ds.touched(format(
  'UPDATE profiles SET full_name = %L WHERE id = %L', 'Rehearsal DS Supervisor Baru', rehearsal_ds.u('sup'))) = 1);
COMMIT;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 an admin cannot set another person''s datum_staff_id', format('UPDATE profiles SET datum_staff_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.u('sup')), 'PROFILE_DATUM_LINK_SYNC_ONLY:');
ROLLBACK;

BEGIN; SET LOCAL ROLE service_role; SELECT rehearsal_ds.as_service() IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 service_role links a profile to a DATUM staff id', rehearsal_ds.touched(format(
  'UPDATE profiles SET datum_staff_id = %L WHERE id = %L', '00000000-0000-4000-8000-00000000f801', rehearsal_ds.u('sup'))) = 1);
SELECT rehearsal_ds.expect_error('107 a second profile with the same staff id is a unique violation', format(
  'UPDATE profiles SET datum_staff_id = %L WHERE id = %L', '00000000-0000-4000-8000-00000000f801', rehearsal_ds.u('est')),
  'duplicate key value violates unique constraint "idx_profiles_datum_staff_id"');
COMMIT;

-- F. Pairing
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an estimator pairs '' k2-7 '' as K2-7', (set_datum_project_code(rehearsal_ds.p(2), ' k2-7 ') ->> 'code') = 'K2-7');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an admin re-pairs it as AB-1', (set_datum_project_code(rehearsal_ds.p(2), 'ab-1') ->> 'code') = 'AB-1');
COMMIT;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('pri') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a principal pairs it back as K2-7', (set_datum_project_code(rehearsal_ds.p(2), ' k2-7 ') ->> 'code') = 'K2-7');
COMMIT;
SELECT rehearsal_ds.expect('107 the stored code is upper case and trimmed', (SELECT datum_project_code = 'K2-7' FROM projects WHERE id = rehearsal_ds.p(2)));
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 a supervisor cannot pair', format('SELECT set_datum_project_code(%L, %L)', rehearsal_ds.p(2), 'X-1'), 'DATUM_PAIRING_AUTH:');
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('adm') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 the same code on a second project is DATUM_PAIRING_TAKEN', format('SELECT set_datum_project_code(%L, %L)', rehearsal_ds.p(3), 'k2-7'), 'DATUM_PAIRING_TAKEN:');
SELECT rehearsal_ds.expect_error('107 an unknown project is refused', format('SELECT set_datum_project_code(%L, %L)', '00000000-0000-4000-8000-00000000ffff', 'Z-1'), 'DATUM_PAIRING_PROJECT:');
SELECT rehearsal_ds.expect('107 a blank code clears the pairing', (set_datum_project_code(rehearsal_ds.p(2), '   ') -> 'code') = 'null'::jsonb);
COMMIT;
SELECT rehearsal_ds.expect('107 project B is unpaired again', (SELECT datum_project_code IS NULL FROM projects WHERE id = rehearsal_ds.p(2)));
SELECT rehearsal_ds.expect_error('107 a lower-case code written directly fails the CHECK', format('UPDATE projects SET datum_project_code = %L WHERE id = %L', 'abc', rehearsal_ds.p(4)),
  'new row for relation "projects" violates check constraint "projects_datum_project_code_shape"');
SELECT rehearsal_ds.expect('107 anon cannot execute the pairing RPC', NOT has_function_privilege('anon', 'set_datum_project_code(uuid, text)', 'EXECUTE'));

-- G. The three tables
BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 a member reads their project''s runs', (SELECT count(*) = 1 FROM datum_sync_runs WHERE project_id = rehearsal_ds.p(1)));
SELECT rehearsal_ds.expect('107 a member reads their project''s DATUM status', (SELECT count(*) = 1 FROM room_datum_gate_status WHERE project_id = rehearsal_ds.p(1)));
SELECT rehearsal_ds.expect('107 a supervisor reads no sync requests', (SELECT count(*) = 0 FROM datum_sync_requests WHERE project_id = rehearsal_ds.p(1)));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('out') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an outsider reads no run, no status and no request', (
  SELECT (SELECT count(*) FROM datum_sync_runs WHERE project_id = rehearsal_ds.p(1)) = 0
     AND (SELECT count(*) FROM room_datum_gate_status WHERE project_id = rehearsal_ds.p(1)) = 0
     AND (SELECT count(*) FROM datum_sync_requests WHERE project_id = rehearsal_ds.p(1)) = 0));
ROLLBACK;

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect('107 an office role reads the sync requests', (SELECT count(*) = 1 FROM datum_sync_requests WHERE project_id = rehearsal_ds.p(1)));
SELECT rehearsal_ds.expect('107 an office role cannot insert a run', rehearsal_ds.writes_nothing(format('INSERT INTO datum_sync_runs (project_id, source) VALUES (%L, %L)', rehearsal_ds.p(4), 'manual')));
SELECT rehearsal_ds.expect('107 an office role cannot update a run', rehearsal_ds.writes_nothing(format('UPDATE datum_sync_runs SET error = %L WHERE id = %L', 'x', rehearsal_ds.run1())));
SELECT rehearsal_ds.expect('107 an office role cannot delete a run', rehearsal_ds.writes_nothing(format('DELETE FROM datum_sync_runs WHERE id = %L', rehearsal_ds.run1())));
SELECT rehearsal_ds.expect('107 an office role cannot insert a status row', rehearsal_ds.writes_nothing(format(
  'INSERT INTO room_datum_gate_status (room_id, gate_code, project_id, datum_area_id, status, datum_stale, synced_at) VALUES (%L, %L, %L, gen_random_uuid(), %L, false, now())',
  rehearsal_ds.room(2), 'A', rehearsal_ds.p(1), 'passed')));
SELECT rehearsal_ds.expect('107 an office role cannot update a status row', rehearsal_ds.writes_nothing(format('UPDATE room_datum_gate_status SET status = %L WHERE room_id = %L', 'blocked', rehearsal_ds.room(1))));
SELECT rehearsal_ds.expect('107 an office role cannot delete a status row', rehearsal_ds.writes_nothing(format('DELETE FROM room_datum_gate_status WHERE room_id = %L', rehearsal_ds.room(1))));
SELECT rehearsal_ds.expect('107 an office role cannot insert a request', rehearsal_ds.writes_nothing(format('INSERT INTO datum_sync_requests (project_id) VALUES (%L)', rehearsal_ds.p(1))));
SELECT rehearsal_ds.expect('107 an office role cannot update a request', rehearsal_ds.writes_nothing(format('UPDATE datum_sync_requests SET error = %L WHERE project_id = %L', 'x', rehearsal_ds.p(1))));
SELECT rehearsal_ds.expect('107 an office role cannot delete a request', rehearsal_ds.writes_nothing(format('DELETE FROM datum_sync_requests WHERE project_id = %L', rehearsal_ds.p(1))));
ROLLBACK;

SELECT rehearsal_ds.expect_error('107 the cache refuses a status DATUM does not have', format(
  'INSERT INTO room_datum_gate_status (room_id, gate_code, project_id, datum_area_id, status, datum_stale, synced_at) VALUES (%L, %L, %L, gen_random_uuid(), %L, false, now())',
  rehearsal_ds.room(2), 'B', rehearsal_ds.p(1), 'done'), 'new row for relation "room_datum_gate_status" violates check constraint');
SELECT rehearsal_ds.expect('107 source = import is accepted', rehearsal_ds.touched(format(
  'INSERT INTO datum_sync_runs (project_id, source, finished_at, ok) VALUES (%L, %L, now(), true)', rehearsal_ds.p(2), 'import')) = 1);

BEGIN;
SELECT rehearsal_ds.expect('107 an open run for project D (setup)', rehearsal_ds.touched(format(
  'INSERT INTO datum_sync_runs (id, project_id, source) VALUES (%L, %L, %L)', '00000000-0000-4000-8000-00000000f502', rehearsal_ds.p(4), 'manual')) = 1);
SELECT rehearsal_ds.expect_error('107 a second open run for the same project is a unique violation', format(
  'INSERT INTO datum_sync_runs (project_id, source) VALUES (%L, %L)', rehearsal_ds.p(4), 'cron'),
  'duplicate key value violates unique constraint "datum_sync_runs_one_open"');
UPDATE datum_sync_runs SET finished_at = now(), ok = true WHERE id = '00000000-0000-4000-8000-00000000f502';
SELECT rehearsal_ds.expect('107 a new run after finished_at is fine', rehearsal_ds.touched(format(
  'INSERT INTO datum_sync_runs (project_id, source) VALUES (%L, %L)', rehearsal_ds.p(4), 'cron')) = 1);
ROLLBACK;
```

- [ ] **Step 3: Write the re-paste checks**

Create `supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql` with exactly this content:

```sql
-- supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql
-- Run by run.sh right after it re-pastes 097 and 096 on top of 107: 107's
-- guards are separate triggers, so neither re-paste reverts them.
\pset tuples_only on
\pset format unaligned

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('sup') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 after re-pasting 097 a supervisor still cannot set datum_card_id', format('UPDATE site_events SET datum_card_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.ev('open')), 'SITE_EVENT_SYSTEM_COLUMNS:');
SELECT rehearsal_ds.expect('107 after re-pasting 097 a member confirms (setup)', (confirm_site_event(
  rehearsal_ds.ev('c4'), 'progres', NULL, NULL, 'Setelah paste ulang', NULL, NULL, NULL, NULL, false, false, NULL, NULL) ->> 'status') = 'open');
COMMIT;
SELECT rehearsal_ds.expect('107 after re-pasting 097 the confirmer is still stamped', (SELECT confirmed_by = rehearsal_ds.u('sup') FROM site_events WHERE id = rehearsal_ds.ev('c4')));

BEGIN; SET LOCAL ROLE authenticated; SELECT rehearsal_ds.as_user('est') IS NOT NULL AS ok \gset
SELECT rehearsal_ds.expect_error('107 after re-pasting 096 an estimator still cannot set rooms.datum_area_id', format('UPDATE rooms SET datum_area_id = gen_random_uuid() WHERE id = %L', rehearsal_ds.room(2)), 'ROOM_DATUM_LINK_SYNC_ONLY:');
SELECT rehearsal_ds.expect('107 after re-pasting 096 a terrace is still an accepted room type', rehearsal_ds.touched(format(
  'INSERT INTO rooms (project_id, room_code, room_name, area_type) VALUES (%L, %L, %L, %L)', rehearsal_ds.p(1), 'TERAS', 'Teras Depan', 'terrace')) = 1);
ROLLBACK;
SELECT rehearsal_ds.expect('107 after re-pasting 096 the area_type CHECK still lists exterior', (
  SELECT pg_get_constraintdef(oid) LIKE '%''exterior''%' FROM pg_constraint WHERE conname = 'rooms_area_type_check'));
```

- [ ] **Step 4: Write the runner**

Make it executable afterwards: `chmod +x supabase/tests/datum_sync_rehearsal/run.sh`.

Create `supabase/tests/datum_sync_rehearsal/run.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# Rehearses migration 107 on a disposable local Supabase Postgres, as the
# roles that will meet it (supervisor, estimator, admin, principal, an
# outsider, the datum-sync function's service_role, and postgres for the
# Dashboard). Needs Docker and a supabase/postgres image; touches nothing but
# the container. The first run applies 001-106 to a fresh container (a few
# storage-policy statements may report errors there; that is expected), after
# the storage stub the closure rehearsal already carries. Every run pastes
# 107 twice, rebuilds the fixture, runs every check, re-pastes 097 and 096 to
# prove 107's guards survive them (then 100 and 105 to undo 097's revert),
# re-pastes 101 then 107 to prove the gate-word hazard and its cure, and
# pastes 107 with and without pg_cron.
#
#   supabase/tests/datum_sync_rehearsal/run.sh            # keep the container
#   supabase/tests/datum_sync_rehearsal/run.sh --stop     # remove it afterwards
set -euo pipefail
IMAGE="${SANO_PG_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.131}"
NAME=sano-pg-datum-rehearsal
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
M="$ROOT/supabase/migrations"
STUB="$ROOT/supabase/tests/site_event_closure_rehearsal/storage_stub.sql"
pg() { docker exec -i "$NAME" psql -d postgres "$@"; }
paste_strict() { pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/$1.sql" >/dev/null 2>&1; }
paste_loose() { pg -U postgres -q < "$M/$1.sql" >/dev/null 2>&1 || true; }

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  until docker exec "$NAME" psql -U postgres -d postgres -tAc "select 1 from pg_proc where proname = 'uid'" 2>/dev/null | grep -q 1; do sleep 1; done
  pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$STUB" >/dev/null
  for f in "$M"/[0-9][0-9][0-9]_*.sql; do
    n="$(basename "$f")"
    [ "${n:0:3}" -ge 107 ] && continue
    pg -U postgres -q < "$f" >/dev/null 2>&1 || true
  done
fi
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$STUB" >/dev/null
# A schedule left from the previous run must not fire into this one.
pg -U supabase_admin -q -c 'DROP EXTENSION IF EXISTS pg_cron' >/dev/null 2>&1 || true

echo "pasting role: $(pg -U postgres -tAc "select current_user || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls from pg_roles where rolname = current_user")"

for pass in first second; do
  if ! paste_strict 107_datum_sync; then
    echo "107 failed on the $pass paste:"
    pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/107_datum_sync.sql" 2>&1 | grep -E 'ERROR' | head -5
    exit 1
  fi
done
pg -U supabase_admin -v ON_ERROR_STOP=1 -q < "$DIR/fixture.sql" >/dev/null

out="$(pg -U supabase_admin -q < "$DIR/rehearse_107.sql" 2>&1)"

# Re-paste hazards: 097 and 096 leave 107's guards and wide CHECK in place.
paste_loose 097_site_events
paste_loose 096_rooms_gates_phase
out="$out"$'\n'"$(pg -U supabase_admin -q < "$DIR/rehearse_repaste.sql" 2>&1)"
for m in 100_confirm_vo_evidence_recheck 105_close_site_event_evidence; do
  paste_strict "$m" || { echo "$m failed on the re-paste after 097"; exit 1; }
done

# Re-pasting 101 restores the old words; re-pasting 107 brings DATUM's back.
paste_strict 101_gate_labels_descriptions || { echo "101 failed on its re-paste"; exit 1; }
word="$(pg -U postgres -tAc "select short_label from gate_refs where code = 'B'")"
if [ "$word" = "Waterproofing + kamar mandi" ]; then
  out="$out"$'\n'"PASS re-pasting 101 after 107 restores SANO's old word for B"
else
  out="$out"$'\n'"FAIL re-pasting 101 after 107 :: B reads '$word'"
fi
paste_strict 107_datum_sync || { echo "107 failed on its re-paste after 101"; exit 1; }
word="$(pg -U postgres -tAc "select short_label from gate_refs where code = 'B'")"
if [ "$word" = "Pekerjaan Basah" ]; then
  out="$out"$'\n'"PASS re-pasting 107 after 101 brings DATUM's word for B back"
else
  out="$out"$'\n'"FAIL re-pasting 107 after 101 :: B reads '$word'"
fi

# Scheduler, without pg_cron: two clean pastes, each printing the NOTICE.
for pass in first second; do
  if notice="$(pg -U postgres -v ON_ERROR_STOP=1 -q < "$M/107_datum_sync.sql" 2>&1 >/dev/null)"; then
    if printf '%s' "$notice" | grep -q '107: pg_cron belum aktif'; then
      out="$out"$'\n'"PASS 107 without pg_cron pastes cleanly and prints the NOTICE ($pass paste)"
    else
      out="$out"$'\n'"FAIL 107 without pg_cron printed no NOTICE ($pass paste)"
    fi
  else
    out="$out"$'\n'"FAIL 107 without pg_cron failed on the $pass paste :: $(printf '%s' "$notice" | grep -m1 ERROR)"
  fi
done

# Scheduler, with pg_cron: created the way the Dashboard does it, as postgres.
if ! pg -U postgres -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS pg_cron' >/dev/null 2>&1; then
  echo "CREATE EXTENSION pg_cron failed: this image does not preload pg_cron, so the Dashboard's branch cannot be rehearsed."
  exit 1
fi
for pass in first second; do
  paste_strict 107_datum_sync || { echo "107 with pg_cron failed on the $pass paste"; exit 1; }
done
jobs="$(pg -U postgres -tAc "select count(*) || '|' || coalesce(string_agg(schedule, ','), '') from cron.job where jobname = 'datum_sync_hourly'")"
if [ "$jobs" = "1|0 * * * *" ]; then
  out="$out"$'\n'"PASS 107 with pg_cron schedules exactly one datum_sync_hourly job at 0 * * * *"
else
  out="$out"$'\n'"FAIL 107 with pg_cron :: $jobs"
fi
# Run the job's own command once, as its owner would, and count what it queued.
pg -U postgres -q -c "DO \$\$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'datum_sync_hourly'); END \$\$;" >/dev/null
queued="$(pg -U postgres -tAc "select string_agg(p.code || '=' || (select count(*) from datum_sync_requests r where r.project_id = p.id and r.requested_at > now() - interval '1 minute'), ',' order by p.code) from projects p where p.code like 'REH-DS-%'")"
if [ "$queued" = "REH-DS-A=1,REH-DS-B=0,REH-DS-C=0,REH-DS-D=0" ]; then
  out="$out"$'\n'"PASS 107 the hourly command queues one request per paired ACTIVE project and none for ON_HOLD or unpaired ones"
else
  out="$out"$'\n'"FAIL 107 the hourly command queued :: $queued"
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

- [ ] **Step 5: Check the script parses and count the checks**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && bash -n supabase/tests/datum_sync_rehearsal/run.sh && grep -cE '^SELECT rehearsal_ds\.expect(_error)?\(' supabase/tests/datum_sync_rehearsal/rehearse_107.sql supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql
```

Expected: no output from `bash -n`, then `rehearse_107.sql:60` and `rehearse_repaste.sql:6`. With the six PASS lines `run.sh` prints itself (two gate-word, two without pg_cron, two with it) the tally is 72.

- [ ] **Step 6: Run the rehearsal (Docker must be running)**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && supabase/tests/datum_sync_rehearsal/run.sh --stop
```

Expected: the last line `PASS=72 FAIL=0 ERROR=0`. This run was not made while planning. If a line fails, read it: a `FAIL` whose detail is a Postgres message is either a real 107 bug (fix 107 in M-T1's files and re-run M-T1's step 5 first) or a fixture assumption this image does not meet (for example a role the image lacks); fix the fixture, never loosen a check. Update the `72` in this step and in step 5's note if you add or remove a check.

- [ ] **Step 7: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/m-t2.txt` with the Write tool, exactly:

```text
test(db): rehearse 107 as real roles on a disposable Postgres

Every guard trigger as supervisor, estimator, admin and principal, the
function's service_role and postgres; the confirmer stamp; the pairing
RPC; RLS on the three tables; the one-open-run index; 097 and 096
re-pastes; the 101/107 gate-word hazard; the scheduler with and without
pg_cron.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add supabase/tests/datum_sync_rehearsal/fixture.sql supabase/tests/datum_sync_rehearsal/rehearse_107.sql supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql supabase/tests/datum_sync_rehearsal/run.sh && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/m-t2.txt" -- supabase/tests/datum_sync_rehearsal/fixture.sql supabase/tests/datum_sync_rehearsal/rehearse_107.sql supabase/tests/datum_sync_rehearsal/rehearse_repaste.sql supabase/tests/datum_sync_rehearsal/run.sh
```

---

## Lane F: SANO sync function

All ten tasks run in the SANO worktree. Tasks 1-5 build the pure planner in `tools/` (jest, which CI runs); Task 6 twins it into the function; Tasks 7-10 build the function around it (Deno). Every decision a run makes lives in the planner, so CI covers it even though CI never runs Deno.

### F-T1 (Lane F, Task 1): The planner's shared types and the run's verdict

Spec §6.2 (counts, differences, the answer), §6.4. The small first task: every type Lane U and the function build against, plus `STEP_ORDER` and `runVerdict` (a run is ok only when every step it recorded is ok; its error is the first failing step's reason, in run order). The file imports nothing and uses no Deno or React Native API, because F-T6 copies its bytes into the Deno function. `counts.step_errors` (the card shows each failed step's reason beside it) and `counts.gate_area_ids` (the areas a gate read covered, so the board says "DATUM belum punya status" only for an area actually read) are additions to spec §6.2's `counts`. `PlanProfile` has no `active` field on purpose: live `profiles` has no such column.

**Files:**
- Create: `tools/datumSyncPlan.ts`
- Create: `tools/__tests__/datumSyncPlanVerdict.test.ts`

**Depends on:** nothing. **U-T3 and U-T4 wait for this commit.**

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumSyncPlanVerdict.test.ts` with exactly this content:

```ts
/**
 * The DATUM sync planner, the run's verdict (spec 2026-09-27 §6.2 step 5): a
 * run is ok only when every step it recorded is ok, and its error is the
 * first failing step's reason in run order.
 */
import { STEP_ORDER, runVerdict } from '../datumSyncPlan';

describe('STEP_ORDER', () => {
  it('is the order a sync or an import runs its steps', () => {
    expect(STEP_ORDER).toEqual(['areas', 'link', 'create', 'import', 'gate_status', 'staff', 'escalate']);
  });
});

describe('runVerdict', () => {
  it('is ok only when every recorded step is ok', () => {
    expect(runVerdict({ steps: { areas: 'ok', link: 'ok', gate_status: 'ok' } })).toEqual({ ok: true, error: null });
    expect(runVerdict({ steps: {} })).toEqual({ ok: false, error: null });
  });

  it("carries the first failing step's reason, in run order", () => {
    expect(runVerdict({
      steps: { areas: 'error', link: 'skipped', create: 'skipped', gate_status: 'ok', staff: 'error', escalate: 'ok' },
      step_errors: { staff: 'staf gagal', areas: 'DATUM menolak kunci integrasi (401).' },
    })).toEqual({ ok: false, error: 'DATUM menolak kunci integrasi (401).' });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanVerdict.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `Cannot find module '../datumSyncPlan' from 'tools/__tests__/datumSyncPlanVerdict.test.ts'`.

- [ ] **Step 3: Write the planner's types and verdict**

Create `tools/datumSyncPlan.ts` with exactly this content:

```ts
// SANO - DATUM sync planner. Pure and dependency-free.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6.2-§6.4.
//
// The edge function supabase/functions/datum-sync carries a byte-identical
// copy as plan.ts: Deno cannot import from tools/, and jest (which CI runs)
// never runs supabase/functions/. tools/__tests__/datumSyncPlanTwin.test.ts
// fails on any drift. Edit THIS file, then:
//   cp tools/datumSyncPlan.ts supabase/functions/datum-sync/plan.ts
//
// No imports, no Deno or React Native API: the same bytes run in both.
// Nothing here writes, fetches or guesses. It decides what a run would do and
// what it must only report (truth contract, spec §1.1): links are set only on
// an exact code or a unique exact name; nothing is renamed, merged or deleted
// to make two lists agree.

// ─── Shapes crossed between the function, the app and this planner ─────────

export type SyncStep = 'areas' | 'link' | 'create' | 'gate_status' | 'staff' | 'escalate' | 'import';
export type StepOutcome = 'ok' | 'error' | 'skipped';
export type SyncSource = 'manual' | 'cron' | 'import';

/** A SANO room as the planner reads it (rooms, 096 + 107). */
export interface PlanRoom {
  id: string;
  room_code: string | null;
  room_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
  active: boolean;
  datum_area_id: string | null;
}

/** A DATUM area as GET /api/integrations/sano/areas returns it. */
export interface PlanArea {
  id: string;
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
}

export interface LinkItem { room_id: string; room_code: string; area_id: string }
export interface CreateItem {
  room_id: string;
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  tracked: boolean;
}
export interface CreateFailedItem { room_code: string; reason: string }
export interface DatumOnlyItem {
  area_id: string;
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
}
export type ConflictField = 'name' | 'floor' | 'area_type';
export interface FieldConflict { room_code: string; field: ConflictField; sano: string; datum: string }
export interface DuplicateItem { key: string; area_codes: string[] }

export interface RoomSyncPlan {
  link: LinkItem[];
  create: CreateItem[];
  createFailed: CreateFailedItem[];
  datumOnly: DatumOnlyItem[];
  fieldConflicts: FieldConflict[];
  datumDuplicates: DuplicateItem[];
  /** Codes of retired rooms DATUM has no area for: counted, never created. */
  retiredMissing: string[];
  /** Rooms (active or retired) whose code matches exactly one DATUM area. */
  matchedCount: number;
}

export interface ImportItem {
  area_id: string;
  area_code: string;
  room_code: string;
  room_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
}
export interface ImportSkip { area_code: string; reason: string }
export interface ImportPlan { insert: ImportItem[]; skipped: ImportSkip[] }

/** A SANO profile. profiles has no `active` column on the live project: never read one. */
export interface PlanProfile { id: string; full_name: string | null; datum_staff_id: string | null }
/** An active DATUM staff row as GET /api/integrations/sano/staff returns it. */
export interface PlanStaff { id: string; full_name: string }

export type AmbiguousSide = 'datum' | 'sano' | 'linked_elsewhere';
export type StaleReason = 'staff_gone' | 'name_differs' | 'not_unique';
export interface StaffNameItem { profile_id: string; full_name: string }
export interface StaffAmbiguousItem extends StaffNameItem { side: AmbiguousSide }
export interface StaffStaleItem extends StaffNameItem { staff_id: string; staff_name: string | null; reason: StaleReason }
export interface StaffLinkPlan {
  set: Array<{ profile_id: string; staff_id: string }>;
  unchanged: string[];
  unmatched: StaffNameItem[];
  ambiguous: StaffAmbiguousItem[];
  stale: StaffStaleItem[];
}

export interface DatumGateWord { code: string; name: string; description: string | null }
export interface SanoGateWord { code: string; name_id: string; description: string | null }
export interface GateWordDiff { code: string; field: 'name' | 'description' | 'missing_in_sano' }

export interface StaffCounts { linked: number; linked_now: number; unmatched: number; ambiguous: number; stale: number }

/** datum_sync_runs.counts (spec §6.2), plus step_errors: the reason beside each step that was not ok. */
export interface RunCounts {
  steps: Partial<Record<SyncStep, StepOutcome>>;
  step_errors?: Partial<Record<SyncStep, string>>;
  datum_project_name?: string;
  rooms_linked?: number;
  rooms_linked_now?: number;
  rooms_created?: number;
  rooms_imported?: number;
  datum_only?: number;
  field_conflicts?: number;
  retired_missing?: number;
  gate_rows?: number;
  gate_rows_unlinked?: number;
  /** DATUM area ids the gate read covered (the linked rooms' areas at read time): the board says "no status" only for these. */
  gate_area_ids?: string[];
  staff?: StaffCounts;
  escalated?: number;
  escalated_as_system?: number;
  escalate_failed?: number;
  escalate_skipped?: number;
  escalate_deferred?: number;
}

export interface EscalateSkipItem { event_id: string; room_code: string; title: string; reason: string }

/** datum_sync_runs.differences (spec §6.2). */
export interface RunDifferences {
  datum_only?: Array<{ area_code: string; area_name: string; floor: string | null; area_type: string }>;
  field_conflicts?: FieldConflict[];
  datum_duplicates?: DuplicateItem[];
  create_failed?: CreateFailedItem[];
  import_skipped?: ImportSkip[];
  staff?: { unmatched: StaffNameItem[]; ambiguous: StaffAmbiguousItem[]; stale: StaffStaleItem[] };
  escalate_skipped?: EscalateSkipItem[];
  gate_words?: GateWordDiff[];
}

/** What the function answers the button with once the run row is written. */
export interface RunReport {
  ok: boolean;
  runId: string;
  counts: RunCounts;
  differences: RunDifferences;
  error: string | null;
}

// ─── The run's verdict (spec §6.2 step 5) ────────────────────────────────────

export const STEP_ORDER: ReadonlyArray<SyncStep> = ['areas', 'link', 'create', 'import', 'gate_status', 'staff', 'escalate'];

/** ok only when every step the run recorded is ok; error is the first step's reason, in run order. */
export function runVerdict(counts: RunCounts): { ok: boolean; error: string | null } {
  const recorded = STEP_ORDER.filter((s) => counts.steps[s] !== undefined);
  const ok = recorded.length > 0 && recorded.every((s) => counts.steps[s] === 'ok');
  const first = recorded.find((s) => counts.steps[s] !== 'ok');
  return { ok, error: first ? counts.step_errors?.[first] ?? null : null };
}
```

- [ ] **Step 4: Run the test and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanVerdict.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Tests: 3 passed, 3 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t1.txt` with the Write tool, exactly:

```text
feat(datum-sync): the planner's shared types and the run verdict

tools/datumSyncPlan.ts, pure and import-free, holds every shape the
function, the app and the planner share (rooms, areas, staff, counts,
differences, the run report), the step order, and runVerdict: ok only
when every recorded step is ok, error the first failing step's reason.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanVerdict.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t1.txt" -- tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanVerdict.test.ts
```

### F-T2 (Lane F, Task 2): Codes, and rooms against areas

Spec §6.2 (`link`, `create` and its plausibility gate), §6.4. The DATUM code runs through an inlined copy of the six-step chain (`tools/roomCodes.ts:22-34`, DATUM `normalizeAreaCode`), proved equal to `normalizeRoomCode` on DATUM's own fixtures (`apps/web/tests/unit/area-extract.test.ts:21-34`). `planRoomSync` links a room (active or retired) whose code matches exactly one area and whose `datum_area_id` differs; creates only active rooms with no area, in board order (floor with no floor last, `sort_order`, name: `listRoomsResult`'s order), `UMUM` untracked, a name over 120 characters refused with its sentence; lists DATUM-only areas, two areas with one key as duplicates (neither linked, created nor imported), and each real name, floor or type difference as one conflict row while still linking. `createGateOpen` is the plausibility gate.

**Files:**
- Modify: `tools/datumSyncPlan.ts` (append)
- Create: `tools/__tests__/datumSyncPlan.test.ts`

**Depends on:** F-T1.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumSyncPlan.test.ts` with exactly this content:

```ts
/**
 * The DATUM sync planner, rooms against areas (spec 2026-09-27 §6.2, §6.4).
 * Pure: what a sync would link, create and only report, with nothing written.
 * The edge function runs a byte-identical copy (datumSyncPlanTwin.test.ts).
 */
import {
  NAME_TOO_LONG,
  createGateOpen,
  createGateSentence,
  foldText,
  isPlanValidRoomCode,
  normalizeCode,
  planRoomSync,
  type PlanArea,
  type PlanRoom,
} from '../datumSyncPlan';
import { isValidRoomCode, normalizeRoomCode } from '../roomCodes';

const room = (over: Partial<PlanRoom> & { id: string }): PlanRoom => ({
  room_code: over.id.toUpperCase(), room_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0,
  active: true, datum_area_id: null, ...over,
});
const area = (over: Partial<PlanArea> & { id: string; area_code: string }): PlanArea => ({
  area_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0, ...over,
});

describe('normalizeCode', () => {
  // DATUM's own fixtures for normalizeAreaCode (apps/web/tests/unit/area-extract.test.ts:21-34).
  const fixtures: Array<[string, string]> = [
    ['l1 kitchen', 'L1-KITCHEN'],
    ['  km/anak  ', 'KMANAK'],
    ['Living—Lt1!', 'LIVINGLT1'],
    ['a--b-', 'A-B'],
    ['-x-', 'X'],
    ['A'.repeat(60), 'A'.repeat(40)],
  ];

  it.each(fixtures)('normalizes %j to %j, exactly as normalizeRoomCode does', (raw, expected) => {
    expect(normalizeCode(raw)).toBe(expected);
    expect(normalizeCode(raw)).toBe(normalizeRoomCode(raw));
  });

  it('judges codes exactly as isValidRoomCode does, including the 40th-character dash', () => {
    for (const code of ['LT1-KM-1', 'UMUM', '', 'LT1--KM', `${'A'.repeat(39)}-`, 'A'.repeat(41), 'lt1']) {
      expect(isPlanValidRoomCode(code)).toBe(isValidRoomCode(code));
    }
  });
});

describe('planRoomSync', () => {
  it('links an active and a retired room to the area with their code, and leaves already-linked rooms alone', () => {
    const plan = planRoomSync(
      [
        room({ id: 'r1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1' }),
        room({ id: 'r2', room_code: 'LT1-GUDANG', room_name: 'Gudang', active: false }),
        room({ id: 'r3', room_code: 'LT1-DAPUR', room_name: 'Dapur', datum_area_id: 'a3' }),
      ],
      [
        area({ id: 'a1', area_code: 'lt1 km 1', area_name: 'Kamar Mandi 1' }),
        area({ id: 'a2', area_code: 'LT1-GUDANG', area_name: 'Gudang' }),
        area({ id: 'a3', area_code: 'LT1-DAPUR', area_name: 'Dapur' }),
      ],
    );
    expect(plan.link).toEqual([
      { room_id: 'r1', room_code: 'LT1-KM-1', area_id: 'a1' },
      { room_id: 'r2', room_code: 'LT1-GUDANG', area_id: 'a2' },
    ]);
    expect(plan.matchedCount).toBe(3);
    expect(plan.create).toEqual([]);
    expect(plan.datumOnly).toEqual([]);
  });

  it('creates only active rooms with no area, in board order, UMUM untracked, and never a retired one', () => {
    const plan = planRoomSync(
      [
        room({ id: 'u', room_code: 'UMUM', room_name: 'Area Umum', floor: null, sort_order: 9999 }),
        room({ id: 'b', room_code: 'LT2-KAMAR', room_name: 'Kamar', floor: 'Lt. 2', sort_order: 0 }),
        room({ id: 'a2', room_code: 'LT1-DAPUR', room_name: 'Dapur', floor: 'Lt. 1', sort_order: 1, area_type: 'kitchen' }),
        room({ id: 'a1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: 'Lt. 1', sort_order: 0, area_type: 'bathroom' }),
        room({ id: 'old', room_code: 'LT1-LAMA', room_name: 'Lama', active: false }),
      ],
      [],
    );
    expect(plan.create.map((c) => [c.area_code, c.tracked])).toEqual([
      ['LT1-KM-1', true], ['LT1-DAPUR', true], ['LT2-KAMAR', true], ['UMUM', false],
    ]);
    expect(plan.create[0]).toEqual({
      room_id: 'a1', area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', tracked: true,
    });
    expect(plan.retiredMissing).toEqual(['LT1-LAMA']);
    expect(plan.matchedCount).toBe(0);
  });

  it('refuses a name over 120 characters with the sentence, instead of sending it', () => {
    const plan = planRoomSync([room({ id: 'r1', room_code: 'LT1-PANJANG', room_name: 'x'.repeat(121) })], []);
    expect(plan.create).toEqual([]);
    expect(plan.createFailed).toEqual([{ room_code: 'LT1-PANJANG', reason: NAME_TOO_LONG }]);
    expect(NAME_TOO_LONG).toBe('Nama ruangan lebih dari 120 karakter; DATUM menolaknya.');
  });

  it('lists DATUM-only areas by sort order', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1' })],
      [
        area({ id: 'a9', area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 5 }),
        area({ id: 'a1', area_code: 'LT1-KM-1' }),
        area({ id: 'a8', area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade', sort_order: 2 }),
      ],
    );
    expect(plan.datumOnly).toEqual([
      { area_id: 'a8', area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade', sort_order: 2 },
      { area_id: 'a9', area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 5 },
    ]);
  });

  it('treats case and whitespace as no conflict, and a real name, floor or type difference as one row each, still linking', () => {
    const plan = planRoomSync(
      [
        room({ id: 'r1', room_code: 'LT1-KM-1', room_name: ' Kamar  mandi 1 ', floor: 'lt. 1', area_type: 'bathroom' }),
        room({ id: 'r2', room_code: 'LT1-KM-2', room_name: 'Kamar Mandi 2', floor: null, area_type: 'bathroom' }),
      ],
      [
        area({ id: 'a1', area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom' }),
        area({ id: 'a2', area_code: 'LT1-KM-2', area_name: 'KM Anak', floor: 'Lt. 2', area_type: 'general' }),
      ],
    );
    expect(plan.fieldConflicts).toEqual([
      { room_code: 'LT1-KM-2', field: 'name', sano: 'Kamar Mandi 2', datum: 'KM Anak' },
      { room_code: 'LT1-KM-2', field: 'floor', sano: '', datum: 'Lt. 2' },
      { room_code: 'LT1-KM-2', field: 'area_type', sano: 'bathroom', datum: 'general' },
    ]);
    expect(plan.link.map((l) => l.room_id)).toEqual(['r1', 'r2']);
  });

  it('lists two DATUM areas with one key as a duplicate, and neither links, creates nor imports it', () => {
    const plan = planRoomSync(
      [room({ id: 'r1', room_code: 'LT1-KM-1' })],
      [area({ id: 'a1', area_code: 'LT1-KM-1' }), area({ id: 'a2', area_code: 'lt1 km 1' }), area({ id: 'a3', area_code: 'X-1' }), area({ id: 'a4', area_code: 'x 1' })],
    );
    expect(plan.datumDuplicates).toEqual([
      { key: 'LT1-KM-1', area_codes: ['LT1-KM-1', 'lt1 km 1'] },
      { key: 'X-1', area_codes: ['X-1', 'x 1'] },
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.datumOnly).toEqual([]);
    expect(plan.matchedCount).toBe(0);
  });

  it('ignores rooms with no code', () => {
    const plan = planRoomSync([room({ id: 'r1', room_code: null })], [area({ id: 'a1', area_code: 'LT1-KM-1' })]);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.datumOnly.map((a) => a.area_code)).toEqual(['LT1-KM-1']);
  });
});

describe('createGateOpen', () => {
  it('opens when a room matches by code, or DATUM has no areas; stays shut for a project DATUM mapped first', () => {
    const matched = planRoomSync([room({ id: 'r1', room_code: 'A-1' })], [area({ id: 'a1', area_code: 'A-1' })]);
    const strangers = planRoomSync([room({ id: 'r1', room_code: 'A-1' })], [area({ id: 'a1', area_code: 'B-1' })]);
    const empty = planRoomSync([room({ id: 'r1', room_code: 'A-1' })], []);
    expect(createGateOpen(matched, 1)).toBe(true);
    expect(createGateOpen(empty, 0)).toBe(true);
    expect(createGateOpen(strangers, 1)).toBe(false);
    expect(createGateSentence('Citraland K2-7')).toBe(
      'Tidak ada ruangan yang cocok dengan area DATUM proyek Citraland K2-7. Periksa kode proyek DATUM, atau ambil ruangannya dari DATUM.',
    );
  });
});

describe('foldText', () => {
  it('treats null as empty', () => {
    expect(foldText(null)).toBe('');
    expect(foldText('  Lt.   2 ')).toBe('lt. 2');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlan.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL`: `Test suite failed to run` with `TS2305: Module '"../datumSyncPlan"' has no exported member 'NAME_TOO_LONG'` (and the other new names).

- [ ] **Step 3: Append codes and rooms to the planner**

Append to the end of `tools/datumSyncPlan.ts` (keep the blank line that opens the block):

```ts

// ─── Codes ───────────────────────────────────────────────────────────────────

/** Mirrors 096's CHECK and tools/roomCodes.ts ROOM_CODE_MAX. */
export const PLAN_ROOM_CODE_MAX = 40;

/**
 * DATUM's normalizeAreaCode, which is also SANO's normalizeRoomCode
 * (tools/roomCodes.ts), inlined: this file may import nothing. jest proves the
 * two agree on DATUM's own fixtures.
 */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, PLAN_ROOM_CODE_MAX);
}

/** tools/roomCodes.ts isValidRoomCode, inlined. */
export function isPlanValidRoomCode(code: string): boolean {
  return code.length > 0 && code.length <= PLAN_ROOM_CODE_MAX && /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code);
}

// ─── Rooms against areas ─────────────────────────────────────────────────────

export const UMUM_CODE = 'UMUM';
export const NAME_TOO_LONG = 'Nama ruangan lebih dari 120 karakter; DATUM menolaknya.';

/** Trim, collapse whitespace, case fold: "Kamar  Mandi 1" and "kamar mandi 1" are one name. */
export function foldText(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** listRoomsResult's order: floor (no floor last), then sort_order, then name. */
function boardOrder(a: PlanRoom, b: PlanRoom): number {
  if (a.floor !== b.floor) {
    if (a.floor === null) return 1;
    if (b.floor === null) return -1;
    return a.floor < b.floor ? -1 : 1;
  }
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.room_name < b.room_name ? -1 : a.room_name > b.room_name ? 1 : 0;
}

export function planRoomSync(rooms: ReadonlyArray<PlanRoom>, areas: ReadonlyArray<PlanArea>): RoomSyncPlan {
  const byKey = new Map<string, PlanArea[]>();
  for (const a of areas) {
    const key = normalizeCode(a.area_code);
    byKey.set(key, [...(byKey.get(key) ?? []), a]);
  }
  const datumDuplicates: DuplicateItem[] = [];
  for (const [key, list] of byKey) {
    if (list.length > 1) datumDuplicates.push({ key, area_codes: list.map((a) => a.area_code) });
  }

  const coded = rooms.filter((r): r is PlanRoom & { room_code: string } => r.room_code !== null);
  const roomKeys = new Set(coded.map((r) => normalizeCode(r.room_code)));

  const link: LinkItem[] = [];
  const createCandidates: PlanRoom[] = [];
  const fieldConflicts: FieldConflict[] = [];
  const retiredMissing: string[] = [];
  let matchedCount = 0;

  for (const room of coded) {
    const list = byKey.get(normalizeCode(room.room_code)) ?? [];
    if (list.length > 1) continue; // listed under datumDuplicates; neither linked nor created
    const area = list[0];
    if (!area) {
      if (room.active) createCandidates.push(room);
      else retiredMissing.push(room.room_code);
      continue;
    }
    matchedCount += 1;
    if (room.datum_area_id !== area.id) link.push({ room_id: room.id, room_code: room.room_code, area_id: area.id });
    if (foldText(room.room_name) !== foldText(area.area_name)) {
      fieldConflicts.push({ room_code: room.room_code, field: 'name', sano: room.room_name, datum: area.area_name });
    }
    if (foldText(room.floor) !== foldText(area.floor)) {
      fieldConflicts.push({ room_code: room.room_code, field: 'floor', sano: room.floor ?? '', datum: area.floor ?? '' });
    }
    if (room.area_type !== area.area_type) {
      fieldConflicts.push({ room_code: room.room_code, field: 'area_type', sano: room.area_type, datum: area.area_type });
    }
  }

  const create: CreateItem[] = [];
  const createFailed: CreateFailedItem[] = [];
  for (const room of [...createCandidates].sort(boardOrder)) {
    const code = room.room_code as string;
    if (room.room_name.trim().length > 120) {
      createFailed.push({ room_code: code, reason: NAME_TOO_LONG });
      continue;
    }
    create.push({
      room_id: room.id,
      area_code: code,
      area_name: room.room_name.trim(),
      floor: room.floor,
      area_type: room.area_type,
      tracked: code !== UMUM_CODE,
    });
  }

  const datumOnly: DatumOnlyItem[] = [];
  for (const [key, list] of byKey) {
    if (list.length !== 1 || roomKeys.has(key)) continue;
    const a = list[0] as PlanArea;
    datumOnly.push({
      area_id: a.id, area_code: a.area_code, area_name: a.area_name, floor: a.floor, area_type: a.area_type, sort_order: a.sort_order,
    });
  }
  datumOnly.sort((a, b) => a.sort_order - b.sort_order || (a.area_code < b.area_code ? -1 : 1));

  return { link, create, createFailed, datumOnly, fieldConflicts, datumDuplicates, retiredMissing, matchedCount };
}

/**
 * The plausibility gate (spec §6.2 "create"): rooms are pushed to DATUM only
 * when some room already matches an area by code, or DATUM's project has no
 * areas yet. A mistyped code that names another real project must not receive
 * this project's rooms; a project DATUM mapped first is steered to the import.
 */
export function createGateOpen(plan: RoomSyncPlan, areaCount: number): boolean {
  return plan.matchedCount > 0 || areaCount === 0;
}

export function createGateSentence(datumProjectName: string): string {
  return `Tidak ada ruangan yang cocok dengan area DATUM proyek ${datumProjectName}. Periksa kode proyek DATUM, atau ambil ruangannya dari DATUM.`;
}
```

- [ ] **Step 4: Run the planner suites and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlan --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 2 passed, 2 total`, `Tests: 19 passed, 19 total` (16 new), no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t2.txt` with the Write tool, exactly:

```text
feat(datum-sync): plan rooms against DATUM areas

normalizeCode is DATUM's normalizeAreaCode inlined, proved equal to
normalizeRoomCode on DATUM's fixtures. planRoomSync links by exact code,
creates only active unmatched rooms (UMUM untracked, board order, long
names refused), lists DATUM-only areas, duplicate DATUM codes and every
name, floor or type difference, and overwrites nothing. createGateOpen
keeps a mistyped project code from receiving this project's rooms.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumSyncPlan.ts tools/__tests__/datumSyncPlan.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t2.txt" -- tools/datumSyncPlan.ts tools/__tests__/datumSyncPlan.test.ts
```

### F-T3 (Lane F, Task 3): The import plan

Spec §6.3 steps 1-2. Only codes the user confirmed AND still DATUM-only in a fresh plan become rooms; a code no longer DATUM-only is skipped with "Sudah ada di SANO atau tidak lagi ada di DATUM.", one whose normalized code fails `isValidRoomCode` with "Kode DATUM {code} tidak bisa menjadi kode ruangan SANO." (the 40th-character dash). `importRaced` is the sentence the function uses for a room made in SANO meanwhile (a 23505).

**Files:**
- Modify: `tools/datumSyncPlan.ts` (append)
- Create: `tools/__tests__/datumSyncPlanImport.test.ts`

**Depends on:** F-T2.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumSyncPlanImport.test.ts` with exactly this content:

```ts
/**
 * The DATUM sync planner, the import (spec 2026-09-27 §6.3): only codes the
 * user confirmed AND still DATUM-only become rooms.
 */
import {
  IMPORT_GONE,
  importBadCode,
  importRaced,
  planImport,
  planRoomSync,
  type PlanArea,
  type PlanRoom,
} from '../datumSyncPlan';

const room = (over: Partial<PlanRoom> & { id: string }): PlanRoom => ({
  room_code: over.id.toUpperCase(), room_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0,
  active: true, datum_area_id: null, ...over,
});
const area = (over: Partial<PlanArea> & { id: string; area_code: string }): PlanArea => ({
  area_name: 'Ruang', floor: 'Lt. 1', area_type: 'general', sort_order: 0, ...over,
});

describe('planImport', () => {
  const plan = planRoomSync(
    [room({ id: 'r1', room_code: 'LT1-KM-1' })],
    [
      area({ id: 'a1', area_code: 'LT1-KM-1' }),
      area({ id: 'a2', area_code: 'LT2-TERAS', area_name: 'Teras Atas', floor: 'Lt. 2', area_type: 'terrace', sort_order: 7 }),
      area({ id: 'a3', area_code: `${'A'.repeat(39)} B`, area_name: 'Kode panjang' }),
    ],
  );

  it('imports only confirmed codes that are still DATUM-only, with code, name, floor, type, order and link', () => {
    const result = planImport(plan, ['LT2-TERAS', 'LT2-TERAS']);
    expect(result).toEqual({
      insert: [{
        area_id: 'a2', area_code: 'LT2-TERAS', room_code: 'LT2-TERAS', room_name: 'Teras Atas', floor: 'Lt. 2',
        area_type: 'terrace', sort_order: 7,
      }],
      skipped: [],
    });
  });

  it('skips a code that is no longer DATUM-only, and a code that cannot become a SANO room code, with reasons', () => {
    const result = planImport(plan, ['LT1-KM-1', 'GONE-1', `${'A'.repeat(39)} B`]);
    expect(result.insert).toEqual([]);
    expect(result.skipped).toEqual([
      { area_code: 'LT1-KM-1', reason: IMPORT_GONE },
      { area_code: 'GONE-1', reason: IMPORT_GONE },
      { area_code: `${'A'.repeat(39)} B`, reason: importBadCode(`${'A'.repeat(39)} B`) },
    ]);
    expect(IMPORT_GONE).toBe('Sudah ada di SANO atau tidak lagi ada di DATUM.');
  });

  it('names the room made in SANO meanwhile', () => {
    expect(importRaced('LT3-RACE')).toBe('Ruangan LT3-RACE sudah dibuat di SANO sebelum impor selesai.');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanImport.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL`: `TS2305: Module '"../datumSyncPlan"' has no exported member 'IMPORT_GONE'`.

- [ ] **Step 3: Append the import plan**

Append to the end of `tools/datumSyncPlan.ts` (keep the blank line that opens the block):

```ts

// ─── The import (spec §6.3) ──────────────────────────────────────────────────

export const IMPORT_GONE = 'Sudah ada di SANO atau tidak lagi ada di DATUM.';
export const importBadCode = (code: string): string => `Kode DATUM ${code} tidak bisa menjadi kode ruangan SANO.`;
export const importRaced = (code: string): string => `Ruangan ${code} sudah dibuat di SANO sebelum impor selesai.`;

/**
 * Only codes the user confirmed AND still DATUM-only in a fresh plan become
 * rooms: nothing enters SANO that the user did not see.
 */
export function planImport(plan: RoomSyncPlan, confirmedCodes: ReadonlyArray<string>): ImportPlan {
  const insert: ImportItem[] = [];
  const skipped: ImportSkip[] = [];
  const seen = new Set<string>();
  for (const code of confirmedCodes) {
    if (seen.has(code)) continue;
    seen.add(code);
    const area = plan.datumOnly.find((a) => a.area_code === code);
    if (!area) {
      skipped.push({ area_code: code, reason: IMPORT_GONE });
      continue;
    }
    const roomCode = normalizeCode(area.area_code);
    if (!isPlanValidRoomCode(roomCode)) {
      skipped.push({ area_code: code, reason: importBadCode(area.area_code) });
      continue;
    }
    insert.push({
      area_id: area.area_id,
      area_code: area.area_code,
      room_code: roomCode,
      room_name: area.area_name,
      floor: area.floor,
      area_type: area.area_type,
      sort_order: area.sort_order,
    });
  }
  return { insert, skipped };
}
```

- [ ] **Step 4: Run the planner suites and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlan --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 3 passed, 3 total`, `Tests: 22 passed, 22 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t3.txt` with the Write tool, exactly:

```text
feat(datum-sync): plan the import of DATUM-only areas

Only confirmed codes that are still DATUM-only become rooms; anything
else is skipped with its reason, so nothing enters SANO that the user
did not see.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanImport.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t3.txt" -- tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanImport.test.ts
```

### F-T4 (Lane F, Task 4): People: one name rule, links only on a unique exact match

Spec §6.4, decision 12. `normalizePersonName` decomposes, drops combining marks, trims, collapses whitespace and lower-cases. `planStaffLinks` sets a link only when exactly one active DATUM staff row and exactly one SANO profile share the key, the profile is unlinked, and no other profile holds that staff id; two on either side, or a staff id held elsewhere, is ambiguous (naming the side); no match or no name is unmatched; an existing link that is no longer its unique match is stale and is neither changed nor cleared. Profiles are matched by name only: there is no `active` on live `profiles`, so none is read or invented.

**Files:**
- Modify: `tools/datumSyncPlan.ts` (append)
- Create: `tools/__tests__/datumSyncPlanPeople.test.ts`

**Depends on:** F-T3.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumSyncPlanPeople.test.ts` with exactly this content:

```ts
/**
 * The DATUM sync planner, people (spec 2026-09-27 §6.4): a SANO profile is
 * linked to a DATUM staff row only on a unique, exact name match on both
 * sides; everything else is listed, never guessed.
 */
import {
  normalizePersonName,
  planStaffLinks,
  staffCounts,
  type PlanProfile,
  type PlanStaff,
} from '../datumSyncPlan';

describe('normalizePersonName', () => {
  it('folds "José  Santoso" and "jose santoso" together', () => {
    expect(normalizePersonName('José  Santoso')).toBe('jose santoso');
    expect(normalizePersonName('jose santoso')).toBe('jose santoso');
  });

  it('strips combining marks, trims and collapses every whitespace run', () => {
    const combiningAcute = String.fromCharCode(0x301);
    expect(normalizePersonName(`  Ñoño${combiningAcute}  \t Dewi `)).toBe('nono dewi');
    expect(normalizePersonName('Zoë\nAgustina')).toBe('zoe agustina');
  });

  it('keeps distinct names distinct, and empty stays empty', () => {
    expect(normalizePersonName('Budi Santoso')).not.toBe(normalizePersonName('Budi Susanto'));
    expect(normalizePersonName('   ')).toBe('');
    expect(normalizePersonName(null)).toBe('');
  });
});

describe('planStaffLinks', () => {
  const profile = (id: string, full_name: string | null, datum_staff_id: string | null = null): PlanProfile => ({ id, full_name, datum_staff_id });
  const staff = (id: string, full_name: string): PlanStaff => ({ id, full_name });

  it('sets a link on a unique match on both sides', () => {
    const plan = planStaffLinks([profile('p1', 'Budi  Santoso')], [staff('s1', 'budi santoso'), staff('s2', 'Siti')]);
    expect(plan.set).toEqual([{ profile_id: 'p1', staff_id: 's1' }]);
    expect(staffCounts(plan)).toEqual({ linked: 1, linked_now: 1, unmatched: 0, ambiguous: 0, stale: 0 });
  });

  it('calls two DATUM staff, or two SANO profiles, with one name ambiguous, naming the side', () => {
    const datumTwice = planStaffLinks([profile('p1', 'Andi')], [staff('s1', 'Andi'), staff('s2', 'ANDI')]);
    expect(datumTwice.ambiguous).toEqual([{ profile_id: 'p1', full_name: 'Andi', side: 'datum' }]);
    const sanoTwice = planStaffLinks([profile('p1', 'Andi'), profile('p2', 'andi')], [staff('s1', 'Andi')]);
    expect(sanoTwice.ambiguous.map((a) => [a.profile_id, a.side])).toEqual([['p1', 'sano'], ['p2', 'sano']]);
    expect(sanoTwice.set).toEqual([]);
  });

  it('calls a staff id already linked to another profile ambiguous', () => {
    const plan = planStaffLinks(
      [profile('p1', 'Rudi Hartono', 's1'), profile('p2', 'Rudi')],
      [staff('s1', 'Rudi Hartono'), staff('s2', 'Rudi')],
    );
    expect(plan.set).toEqual([{ profile_id: 'p2', staff_id: 's2' }]);
    const taken = planStaffLinks([profile('p1', 'Lain', 's1'), profile('p2', 'Rudi Hartono')], [staff('s1', 'Rudi Hartono')]);
    expect(taken.ambiguous).toEqual([{ profile_id: 'p2', full_name: 'Rudi Hartono', side: 'linked_elsewhere' }]);
  });

  it('lists no match, and no name, as unmatched', () => {
    const plan = planStaffLinks([profile('p1', 'Tak Dikenal'), profile('p2', ''), profile('p3', null)], [staff('s1', 'Budi')]);
    expect(plan.unmatched).toEqual([
      { profile_id: 'p1', full_name: 'Tak Dikenal' },
      { profile_id: 'p2', full_name: '' },
      { profile_id: 'p3', full_name: '' },
    ]);
  });

  it('leaves an intact link unchanged', () => {
    const plan = planStaffLinks([profile('p1', 'Budi', 's1')], [staff('s1', 'budi')]);
    expect(plan.unchanged).toEqual(['p1']);
    expect(plan.set).toEqual([]);
  });

  it('reports a link whose staff vanished, was renamed or is no longer unique as stale, and changes nothing', () => {
    const plan = planStaffLinks(
      [profile('p1', 'Budi', 'gone'), profile('p2', 'Siti', 's2'), profile('p3', 'Andi', 's3')],
      [staff('s2', 'Siti Aminah'), staff('s3', 'Andi'), staff('s4', 'Andi')],
    );
    expect(plan.stale).toEqual([
      { profile_id: 'p1', full_name: 'Budi', staff_id: 'gone', staff_name: null, reason: 'staff_gone' },
      { profile_id: 'p2', full_name: 'Siti', staff_id: 's2', staff_name: 'Siti Aminah', reason: 'name_differs' },
      { profile_id: 'p3', full_name: 'Andi', staff_id: 's3', staff_name: 'Andi', reason: 'not_unique' },
    ]);
    expect(plan.set).toEqual([]);
    expect(staffCounts(plan)).toMatchObject({ linked: 3, linked_now: 0, stale: 3 });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanPeople.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL`: `TS2305: Module '"../datumSyncPlan"' has no exported member 'normalizePersonName'`.

- [ ] **Step 3: Append the people rules**

Append to the end of `tools/datumSyncPlan.ts` (keep the blank line that opens the block):

```ts

// ─── People (spec §6.4) ──────────────────────────────────────────────────────

/** The one name rule: decompose, drop combining marks, trim, collapse spaces, lower case. */
export function normalizePersonName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * A link is set only on a unique exact match on BOTH sides: one active DATUM
 * staff row and one SANO profile with that name, the profile unlinked, and the
 * staff id held by no other profile. Anything else is listed, never guessed.
 * An existing link that is no longer its unique match is `stale`: reported,
 * never changed or cleared.
 */
export function planStaffLinks(profiles: ReadonlyArray<PlanProfile>, staff: ReadonlyArray<PlanStaff>): StaffLinkPlan {
  const staffByKey = new Map<string, PlanStaff[]>();
  for (const s of staff) {
    const key = normalizePersonName(s.full_name);
    if (!key) continue;
    staffByKey.set(key, [...(staffByKey.get(key) ?? []), s]);
  }
  const profilesByKey = new Map<string, PlanProfile[]>();
  for (const p of profiles) {
    const key = normalizePersonName(p.full_name);
    if (!key) continue;
    profilesByKey.set(key, [...(profilesByKey.get(key) ?? []), p]);
  }
  const holderOf = new Map<string, string>();
  for (const p of profiles) if (p.datum_staff_id) holderOf.set(p.datum_staff_id, p.id);
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const plan: StaffLinkPlan = { set: [], unchanged: [], unmatched: [], ambiguous: [], stale: [] };
  for (const p of profiles) {
    const key = normalizePersonName(p.full_name);
    const name = p.full_name ?? '';
    const sameStaff = key ? staffByKey.get(key) ?? [] : [];
    const sameProfiles = key ? profilesByKey.get(key) ?? [] : [];

    if (p.datum_staff_id) {
      const linked = staffById.get(p.datum_staff_id);
      if (!linked) {
        plan.stale.push({ profile_id: p.id, full_name: name, staff_id: p.datum_staff_id, staff_name: null, reason: 'staff_gone' });
      } else if (normalizePersonName(linked.full_name) !== key) {
        plan.stale.push({ profile_id: p.id, full_name: name, staff_id: linked.id, staff_name: linked.full_name, reason: 'name_differs' });
      } else if (sameStaff.length !== 1 || sameProfiles.length !== 1) {
        plan.stale.push({ profile_id: p.id, full_name: name, staff_id: linked.id, staff_name: linked.full_name, reason: 'not_unique' });
      } else {
        plan.unchanged.push(p.id);
      }
      continue;
    }

    if (sameStaff.length === 0) {
      plan.unmatched.push({ profile_id: p.id, full_name: name });
    } else if (sameStaff.length > 1) {
      plan.ambiguous.push({ profile_id: p.id, full_name: name, side: 'datum' });
    } else if (sameProfiles.length > 1) {
      plan.ambiguous.push({ profile_id: p.id, full_name: name, side: 'sano' });
    } else {
      const target = sameStaff[0] as PlanStaff;
      const holder = holderOf.get(target.id);
      if (holder && holder !== p.id) plan.ambiguous.push({ profile_id: p.id, full_name: name, side: 'linked_elsewhere' });
      else plan.set.push({ profile_id: p.id, staff_id: target.id });
    }
  }
  return plan;
}

export function staffCounts(plan: StaffLinkPlan): StaffCounts {
  return {
    linked: plan.unchanged.length + plan.stale.length + plan.set.length,
    linked_now: plan.set.length,
    unmatched: plan.unmatched.length,
    ambiguous: plan.ambiguous.length,
    stale: plan.stale.length,
  };
}
```

- [ ] **Step 4: Run the planner suites and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlan --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 4 passed, 4 total`, `Tests: 31 passed, 31 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t4.txt` with the Write tool, exactly:

```text
feat(datum-sync): link SANO people to DATUM staff by unique exact name

normalizePersonName folds accents, case and spacing. planStaffLinks sets
a link only on a match unique on both sides and free; everything else is
unmatched, ambiguous (naming the side) or stale, and stale links are
reported, never changed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanPeople.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t4.txt" -- tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanPeople.test.ts
```

### F-T5 (Lane F, Task 5): Gate words, and the escalation's link and author

Spec §2 decision 3, §5.3, §6.2 `escalate`, decision 9. `diffGateWords` reports DATUM's gate name or description that differs from `gate_refs` (and a DATUM gate SANO lacks) and writes nothing. `sanoRoomUrl` is `buildRoomUrl` inlined (`tools/roomLinks.ts`), proved equal. `escalationAuthor` is the reporter's DATUM account, else the confirmer's, else none (DATUM then authors as SANO (sistem)). `ESCALATE_BATCH` is 20.

**Files:**
- Modify: `tools/datumSyncPlan.ts` (append)
- Create: `tools/__tests__/datumSyncPlanWords.test.ts`

**Depends on:** F-T4. **F-T6 waits for this commit.**

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumSyncPlanWords.test.ts` with exactly this content:

```ts
/**
 * The DATUM sync planner, gate words and escalation (spec 2026-09-27 §2
 * decision 3, §5.3, §6.2): words are reported, never written; the card links
 * back to the room the app itself links to; the author is the reporter's
 * DATUM account, else the confirmer's, else none.
 */
import { diffGateWords, escalationAuthor, sanoRoomUrl } from '../datumSyncPlan';
import { buildRoomUrl } from '../roomLinks';

describe('diffGateWords', () => {
  it('reports each word that differs from gate_refs, and a DATUM gate SANO lacks, writing nothing', () => {
    expect(diffGateWords(
      [
        { code: 'B', name: 'Pekerjaan Basah / Waterproofing', description: 'Baru.' },
        { code: 'A', name: 'MEP Rough-in + Persiapan Struktural', description: 'Sama.' },
        { code: 'Z', name: 'Gerbang baru', description: null },
      ],
      [
        { code: 'A', name_id: 'MEP Rough-in + Persiapan Struktural', description: ' Sama. ' },
        { code: 'B', name_id: 'Pekerjaan Basah / Waterproofing', description: 'Lama.' },
      ],
    )).toEqual([{ code: 'B', field: 'description' }, { code: 'Z', field: 'missing_in_sano' }]);
  });
});

describe('escalation helpers', () => {
  it("builds exactly the app's room link", () => {
    expect(sanoRoomUrl('SANO-K27', 'LT1-KM-1')).toBe(buildRoomUrl('SANO-K27', 'LT1-KM-1'));
    expect(sanoRoomUrl('A B', 'C/D')).toBe(buildRoomUrl('A B', 'C/D'));
  });

  it("authors by the reporter's DATUM account, else the confirmer's, else none", () => {
    expect(escalationAuthor('s1', 's2')).toBe('s1');
    expect(escalationAuthor(null, 's2')).toBe('s2');
    expect(escalationAuthor(null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanWords.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL`: `TS2305: Module '"../datumSyncPlan"' has no exported member 'diffGateWords'`.

- [ ] **Step 3: Append gate words and escalation**

Append to the end of `tools/datumSyncPlan.ts` (keep the blank line that opens the block):

```ts

// ─── Gate words (spec §2 decision 3) ─────────────────────────────────────────

/** Reports, never writes: a DATUM word that differs from gate_refs is listed. */
export function diffGateWords(datum: ReadonlyArray<DatumGateWord>, sano: ReadonlyArray<SanoGateWord>): GateWordDiff[] {
  const out: GateWordDiff[] = [];
  const mine = new Map(sano.map((g) => [g.code, g]));
  for (const g of [...datum].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    const s = mine.get(g.code);
    if (!s) {
      out.push({ code: g.code, field: 'missing_in_sano' });
      continue;
    }
    if (g.name.trim() !== s.name_id.trim()) out.push({ code: g.code, field: 'name' });
    if ((g.description ?? '').trim() !== (s.description ?? '').trim()) out.push({ code: g.code, field: 'description' });
  }
  return out;
}

// ─── Escalation (spec §5.3, §6.2 "escalate") ─────────────────────────────────

export const ESCALATE_BATCH = 20;
export const ESCALATE_ROOM_UNLINKED = 'Ruangan belum tertaut ke area DATUM.';

/** tools/roomLinks.ts buildRoomUrl, inlined: SANO has no web route to one event. */
export function sanoRoomUrl(projectCode: string, roomCode: string): string {
  return `https://sano-app.vercel.app/r/${encodeURIComponent(projectCode)}/${encodeURIComponent(roomCode)}`;
}

/** The reporter's DATUM account, else the confirmer's, else none (DATUM then uses SANO (sistem)). */
export function escalationAuthor(reporterStaffId: string | null, confirmerStaffId: string | null): string | null {
  return reporterStaffId ?? confirmerStaffId ?? null;
}
```

- [ ] **Step 4: Run the planner suites and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlan --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 5 passed, 5 total`, `Tests: 34 passed, 34 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t5.txt` with the Write tool, exactly:

```text
feat(datum-sync): gate-word drift, the room link and the card's author

diffGateWords reports DATUM words that differ from gate_refs and writes
nothing. sanoRoomUrl is buildRoomUrl inlined. escalationAuthor prefers
the reporter's DATUM account, then the confirmer's.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanWords.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t5.txt" -- tools/datumSyncPlan.ts tools/__tests__/datumSyncPlanWords.test.ts
```

### F-T6 (Lane F, Task 6): The byte twin and the function's folder

Spec §6.4 first paragraph, and the `siteEventDraftValidateTwin.test.ts` pattern (`:1-11`): Deno cannot import from `tools/`, and jest never runs `supabase/functions/`, so the function carries a byte-identical `plan.ts` and a jest suite (which CI runs) fails on any drift. `deno.json` pins the same versions `site-event-analyze/deno.json` pins.

**Files:**
- Create: `tools/__tests__/datumSyncPlanTwin.test.ts`
- Create: `supabase/functions/datum-sync/plan.ts` (a copy)
- Create: `supabase/functions/datum-sync/deno.json`

**Depends on:** F-T5.

- [ ] **Step 1: Write the failing twin test**

Create `tools/__tests__/datumSyncPlanTwin.test.ts` with exactly this content:

```ts
/**
 * tools/datumSyncPlan.ts is the source of truth. The datum-sync edge function
 * carries a byte-identical copy because Deno cannot import from tools/ and
 * jest never runs supabase/functions/ (package.json testPathIgnorePatterns).
 * CI runs only tsc and jest (.github/workflows/ci.yml), so without this suite
 * the Deno copy could drift and production would plan links with rules no
 * test covers.
 *
 * Fix a failure with:
 *   cp tools/datumSyncPlan.ts supabase/functions/datum-sync/plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'tools', 'datumSyncPlan.ts'), 'utf8');
const FUNCTION_DIR = path.join(ROOT, 'supabase', 'functions', 'datum-sync');
const readFn = (file: string) => fs.readFileSync(path.join(FUNCTION_DIR, file), 'utf8');

function exportedNames(src: string): string[] {
  return [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
}

describe('datum-sync/plan.ts is the planner, byte for byte', () => {
  it('is identical to tools/datumSyncPlan.ts', () => {
    expect(readFn('plan.ts')).toBe(SOURCE);
  });

  it('imports nothing and uses no Deno or React Native API, so the same bytes run in Node and Deno', () => {
    expect(SOURCE).not.toMatch(/^\s*import\s/m);
    expect(SOURCE).not.toMatch(/\bDeno\./);
    expect(SOURCE).not.toMatch(/react-native/);
  });

  it('exports the planner functions the function calls', () => {
    expect(exportedNames(SOURCE)).toEqual(expect.arrayContaining([
      'createGateOpen', 'diffGateWords', 'escalationAuthor', 'normalizeCode', 'normalizePersonName', 'planImport',
      'planRoomSync', 'planStaffLinks', 'runVerdict', 'sanoRoomUrl', 'staffCounts',
    ]));
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanTwin.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `ENOENT: no such file or directory, open '.../supabase/functions/datum-sync/plan.ts'`.

- [ ] **Step 3: Copy the planner into the function**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && mkdir -p supabase/functions/datum-sync && cp tools/datumSyncPlan.ts supabase/functions/datum-sync/plan.ts
```

Expected: no output.

- [ ] **Step 4: Write `deno.json`**

Create `supabase/functions/datum-sync/deno.json` with exactly this content:

```json
{
  "tasks": {
    "test": "deno test"
  },
  "_comment": "Pinned exactly, as site-event-analyze pins them: this function holds the service-role key and the DATUM integration secret, so the deployed dependency must be the reviewed one. Bump deliberately.",
  "imports": {
    "@supabase/supabase-js": "jsr:@supabase/supabase-js@2.105.1",
    "std/assert": "jsr:@std/assert@1.0.19"
  }
}
```

- [ ] **Step 5: Run the twin, check the copy in Deno**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanTwin.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && cd supabase/functions/datum-sync && deno check plan.ts && rm -f deno.lock
```

Expected: `Tests: 3 passed, 3 total`, then `Check plan.ts`.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t6.txt` with the Write tool, exactly:

```text
feat(datum-sync): twin the planner into the edge function

supabase/functions/datum-sync/plan.ts is a byte copy of
tools/datumSyncPlan.ts, pinned by a jest suite CI runs. deno.json pins
the same supabase-js and std versions as site-event-analyze.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/__tests__/datumSyncPlanTwin.test.ts supabase/functions/datum-sync/plan.ts supabase/functions/datum-sync/deno.json && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t6.txt" -- tools/__tests__/datumSyncPlanTwin.test.ts supabase/functions/datum-sync/plan.ts supabase/functions/datum-sync/deno.json
```

### F-T7 (Lane F, Task 7): The DATUM client

Spec §5.2, §6 ("the five calls, each with `AbortSignal.timeout(15000)`"), §9 rows 1-3. `makeDatumApi` takes the base URL, the secret and `fetch` (injected: the tests pass a fake DATUM). A failure comes back as a sentence, never thrown: 401 is "DATUM menolak kunci integrasi (401).", `UNKNOWN_PROJECT` names the code, a timeout says 15 seconds, a dead network names its error, anything else carries status and code. `testing.ts` starts here with `fakeDatum()`, which serves the five routes from memory behind the same bearer and makes one card per SANO event.

**Files:**
- Create: `supabase/functions/datum-sync/testing.ts`
- Create: `supabase/functions/datum-sync/datum.test.ts`
- Create: `supabase/functions/datum-sync/datum.ts`

**Depends on:** F-T6.

- [ ] **Step 1: Write the fake DATUM**

Create `supabase/functions/datum-sync/testing.ts` with exactly this content:

```ts
// SANO - datum-sync: in-memory fakes for the Deno tests. Never imported by
// index.ts, so never deployed as code that runs.
//
// fakeDatum() serves DATUM's five routes from memory, behind the same
// bearer, and makes one card per SANO event. Task 8 adds FakeStore and the
// shared world.

// ─── A DATUM that answers the five routes from memory ────────────────────────

export interface FakeDatumState {
  secret: string;
  projects: Array<{ id: string; project_code: string; project_name: string }>;
  areas: Array<{ id: string; project_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number; tracked: boolean }>;
  gates: Array<{ code: string; name: string; description: string | null; sort_order: number }>;
  statuses: Array<{ project_id: string; area_id: string; gate_code: string; status: string; stale: boolean; last_recomputed_at: string | null; updated_at: string | null }>;
  staff: Array<{ id: string; full_name: string; active: boolean }>;
  cards: Array<{ id: string; sano_event_id: string; area_id: string; author: string; slug: string }>;
  systemStaffId: string;
  /** Route path (e.g. 'areas', 'staff') to answer with this status instead. */
  failRoute: Record<string, number>;
  calls: Array<{ method: string; path: string; body: unknown }>;
}

export function fakeDatum(seed: Partial<FakeDatumState> = {}): { state: FakeDatumState; fetch: typeof fetch } {
  const state: FakeDatumState = {
    secret: 'datum-secret', projects: [], areas: [], gates: [], statuses: [], staff: [], cards: [],
    systemStaffId: 'staff-system', failRoute: {}, calls: [], ...seed,
  };
  let seq = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const route = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/integrations\/sano\//, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path, body });
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${state.secret}`) return reply(401, { ok: false, code: 'UNAUTHORIZED', error: 'Kunci integrasi SANO tidak cocok.' });
    if (state.failRoute[path]) return reply(state.failRoute[path], { ok: false, code: 'DB_ERROR', error: 'fake failure' });

    const projectCode = (method === 'GET' ? url.searchParams.get('project_code') : body?.project_code) ?? '';
    const project = state.projects.find((p) => p.project_code === String(projectCode).trim().toUpperCase());
    const unknown = () => reply(404, { ok: false, code: 'UNKNOWN_PROJECT', error: `Proyek DATUM dengan kode ${projectCode} tidak ada.` });

    if (path === 'staff' && method === 'GET') {
      return reply(200, { ok: true, staff: state.staff.filter((s) => s.active).map(({ id, full_name }) => ({ id, full_name })) });
    }
    if (path === 'areas' && method === 'GET') {
      if (!project) return unknown();
      const areas = state.areas.filter((a) => a.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, area_code, area_name, floor, area_type, sort_order }) => ({ id, area_code, area_name, floor, area_type, sort_order }));
      return reply(200, { ok: true, project, areas });
    }
    if (path === 'gate-status' && method === 'GET') {
      if (!project) return unknown();
      const statuses = state.statuses.filter((s) => s.project_id === project.id).map(({ project_id: _p, ...s }) => s);
      return reply(200, { ok: true, gates: state.gates, statuses, read_at: new Date().toISOString() });
    }
    if (path === 'areas' && method === 'POST') {
      if (!project) return unknown();
      const out: Array<{ area_code: string; id: string; created: boolean }> = [];
      for (const item of body.areas as Array<{ area_code: string; area_name: string; floor: string | null; area_type: string; tracked: boolean }>) {
        const known = state.areas.find((a) => a.project_id === project.id && a.area_code === item.area_code);
        if (known) {
          out.push({ area_code: item.area_code, id: known.id, created: false });
          continue;
        }
        seq += 1;
        const id = `area-new-${seq}`;
        const sort = Math.max(-1, ...state.areas.filter((a) => a.project_id === project.id).map((a) => a.sort_order)) + 1;
        state.areas.push({ id, project_id: project.id, ...item, sort_order: sort });
        out.push({ area_code: item.area_code, id, created: true });
      }
      return reply(200, { ok: true, areas: out, errors: [] });
    }
    if (path === 'escalate' && method === 'POST') {
      if (!project) return unknown();
      const found = state.cards.find((c) => c.sano_event_id === body.sano_event_id);
      const author = (id: string) => (id === state.systemStaffId ? 'system' : 'linked');
      if (found) {
        return reply(200, { ok: true, card_id: found.id, card_url: `https://datum.test/project/x/cards/${found.slug}`, created: false, author: author(found.author) });
      }
      seq += 1;
      const staffOk = state.staff.some((s) => s.id === body.author_staff_id && s.active);
      const card = { id: `card-${seq}`, sano_event_id: body.sano_event_id, area_id: body.area_id, author: staffOk ? body.author_staff_id : state.systemStaffId, slug: `kartu-${seq}` };
      state.cards.push(card);
      return reply(200, { ok: true, card_id: card.id, card_url: `https://datum.test/project/x/cards/${card.slug}`, created: true, author: author(card.author) });
    }
    return reply(404, { ok: false, code: 'NOT_FOUND', error: 'no route' });
  };
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => Promise.resolve(route(input, init));
  return { state, fetch: fetchImpl as typeof fetch };
}
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/datum-sync/datum.test.ts` with exactly this content:

```ts
import { assertEquals } from 'std/assert';
import { datumFailureSentence, makeDatumApi } from './datum.ts';
import { fakeDatum } from './testing.ts';

Deno.test('every call sends the bearer and reaches the route under /api/integrations/sano', async () => {
  const datum = fakeDatum({ projects: [{ id: 'dp', project_code: 'K2-7', project_name: 'Citraland' }] });
  const api = makeDatumApi({ baseUrl: 'https://datum.test///', secret: 'datum-secret', fetch: datum.fetch });
  const areas = await api.getAreas(' k2-7 ');
  assertEquals(areas.ok, true);
  await api.getGateStatus('K2-7');
  await api.getStaff();
  await api.postAreas('K2-7', [{ area_code: 'A-1', area_name: 'A', floor: null, area_type: 'general', tracked: true }]);
  assertEquals(datum.state.calls.map((c) => `${c.method} ${c.path}`), ['GET areas', 'GET gate-status', 'GET staff', 'POST areas']);
  assertEquals(datum.state.calls[3].body, {
    project_code: 'K2-7',
    areas: [{ area_code: 'A-1', area_name: 'A', floor: null, area_type: 'general', tracked: true }],
  });
});

Deno.test('a wrong secret reads as the 401 sentence', async () => {
  const datum = fakeDatum();
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 'wrong', fetch: datum.fetch });
  const r = await api.getStaff();
  assertEquals(r, { ok: false, status: 401, code: 'UNAUTHORIZED', error: 'DATUM menolak kunci integrasi (401).' });
});

Deno.test('an unknown project code reads as its own sentence', async () => {
  const datum = fakeDatum();
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 'datum-secret', fetch: datum.fetch });
  const r = await api.getAreas('ZZ-1');
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, 'Kode proyek DATUM ZZ-1 tidak ditemukan di DATUM.');
});

Deno.test('a slow DATUM times out with the 15-second sentence, and a dead one names the network error', async () => {
  const hang: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
    });
  const slow = makeDatumApi({ baseUrl: 'https://datum.test', secret: 's', fetch: hang, timeoutMs: 20 });
  assertEquals(await slow.getStaff(), { ok: false, status: 0, code: 'TIMEOUT', error: 'DATUM tidak menjawab dalam 15 detik.' });

  const dead: typeof fetch = () => Promise.reject(new TypeError('connection refused'));
  const down = makeDatumApi({ baseUrl: 'https://datum.test', secret: 's', fetch: dead });
  assertEquals(await down.getStaff(), { ok: false, status: 0, code: 'NETWORK', error: 'DATUM tidak dapat dihubungi: connection refused' });
});

Deno.test('a non-JSON or not-ok answer is a failure with the status and code, never data', async () => {
  const html: typeof fetch = () => Promise.resolve(new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }));
  const api = makeDatumApi({ baseUrl: 'https://datum.test', secret: 's', fetch: html });
  assertEquals(await api.getStaff(), { ok: false, status: 502, code: 'HTTP_502', error: 'DATUM menjawab 502 HTTP_502: Bad Gateway' });
  assertEquals(datumFailureSentence(503, 'NOT_CONFIGURED', 'SANO_INTEGRATION_STAFF_ID belum diisi'), 'DATUM belum siap untuk SANO (503): SANO_INTEGRATION_STAFF_ID belum diisi');
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test datum.test.ts; rm -f deno.lock
```

Expected: `error: Module not found "file:///.../supabase/functions/datum-sync/datum.ts"`.

- [ ] **Step 4: Write the client**

Create `supabase/functions/datum-sync/datum.ts` with exactly this content:

```ts
// SANO - datum-sync: the five DATUM calls.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §5.2, §6.
// Every call carries `Authorization: Bearer <DATUM_SANO_SECRET>` and gives up
// after 15 s. A failure comes back as a sentence the Rooms tab can show as
// written (truth contract rule 6): never thrown, never smoothed over.

export interface DatumAreaRow {
  id: string;
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
}
export interface DatumAreasReply {
  project: { id: string; project_code: string; project_name: string };
  areas: DatumAreaRow[];
}
export interface DatumGate { code: string; name: string; description: string | null; sort_order: number }
export interface DatumStatusRow {
  area_id: string;
  gate_code: string;
  status: string;
  stale: boolean;
  last_recomputed_at: string | null;
  updated_at: string | null;
}
export interface DatumGateStatusReply { gates: DatumGate[]; statuses: DatumStatusRow[]; read_at: string }
export interface DatumPostAreaItem {
  area_code: string;
  area_name: string;
  floor: string | null;
  area_type: string;
  tracked: boolean;
}
export interface DatumPostAreasReply {
  areas: Array<{ area_code: string; id: string; created: boolean }>;
  errors: Array<{ area_code: string; code: string }>;
}
export interface DatumStaffReply { staff: Array<{ id: string; full_name: string }> }
export interface DatumEscalateBody {
  project_code: string;
  area_id: string;
  sano_event_id: string;
  sano_url: string;
  title: string;
  summary: string | null;
  room_name: string;
  reporter_name: string;
  confirmer_name: string | null;
  owner_name: string;
  due_date: string;
  confirmed_at: string;
  author_staff_id: string | null;
}
export interface DatumEscalateReply { card_id: string; card_url: string; created: boolean; author: 'linked' | 'system' }

export type DatumResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; error: string };

export interface DatumApi {
  getAreas(projectCode: string): Promise<DatumResult<DatumAreasReply>>;
  getGateStatus(projectCode: string): Promise<DatumResult<DatumGateStatusReply>>;
  postAreas(projectCode: string, areas: DatumPostAreaItem[]): Promise<DatumResult<DatumPostAreasReply>>;
  getStaff(): Promise<DatumResult<DatumStaffReply>>;
  escalate(body: DatumEscalateBody): Promise<DatumResult<DatumEscalateReply>>;
}

export const DATUM_TIMEOUT_MS = 15_000;

/** The sentence a failed DATUM call leaves in the run log. */
export function datumFailureSentence(status: number, code: string, error: string, projectCode?: string): string {
  if (status === 401) return 'DATUM menolak kunci integrasi (401).';
  if (code === 'UNKNOWN_PROJECT') return `Kode proyek DATUM ${projectCode ?? ''} tidak ditemukan di DATUM.`;
  if (code === 'TIMEOUT') return 'DATUM tidak menjawab dalam 15 detik.';
  if (code === 'NETWORK') return `DATUM tidak dapat dihubungi: ${error}`;
  if (code === 'NOT_CONFIGURED') return `DATUM belum siap untuk SANO (503): ${error}`;
  return `DATUM menjawab ${status} ${code}: ${error}`;
}

export function makeDatumApi(opts: {
  baseUrl: string;
  secret: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}): DatumApi {
  const base = `${opts.baseUrl.replace(/\/+$/, '')}/api/integrations/sano`;
  const timeoutMs = opts.timeoutMs ?? DATUM_TIMEOUT_MS;

  async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, projectCode?: string): Promise<DatumResult<T>> {
    let resp: Response;
    try {
      resp = await opts.fetch(`${base}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${opts.secret}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name ?? '';
      const code = name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      const message = (err as Error)?.message ?? String(err);
      return { ok: false, status: 0, code, error: datumFailureSentence(0, code, message, projectCode) };
    }
    const payload = (await resp.json().catch(() => null)) as ({ ok?: boolean; code?: string; error?: string } & T) | null;
    if (!resp.ok || !payload || payload.ok !== true) {
      const code = payload?.code ?? `HTTP_${resp.status}`;
      const error = payload?.error ?? resp.statusText ?? '';
      return { ok: false, status: resp.status, code, error: datumFailureSentence(resp.status, code, error, projectCode) };
    }
    return { ok: true, data: payload as T };
  }

  const q = (code: string) => `project_code=${encodeURIComponent(code)}`;
  return {
    getAreas: (code) => call<DatumAreasReply>('GET', `areas?${q(code)}`, undefined, code),
    getGateStatus: (code) => call<DatumGateStatusReply>('GET', `gate-status?${q(code)}`, undefined, code),
    postAreas: (code, areas) => call<DatumPostAreasReply>('POST', 'areas', { project_code: code, areas }, code),
    getStaff: () => call<DatumStaffReply>('GET', 'staff', undefined),
    escalate: (body) => call<DatumEscalateReply>('POST', 'escalate', body, body.project_code),
  };
}
```

- [ ] **Step 5: Run the test and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test datum.test.ts && deno lint && rm -f deno.lock
```

Expected: `ok | 5 passed | 0 failed`, then `Checked 4 files` with no problem.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t7.txt` with the Write tool, exactly:

```text
feat(datum-sync): the DATUM client

The five calls behind the SANO bearer, 15 s each. Failures come back as
sentences the run log shows as written: 401, unknown project code,
timeout, network, anything else with status and code.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add supabase/functions/datum-sync/testing.ts supabase/functions/datum-sync/datum.test.ts supabase/functions/datum-sync/datum.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t7.txt" -- supabase/functions/datum-sync/testing.ts supabase/functions/datum-sync/datum.test.ts supabase/functions/datum-sync/datum.ts
```

### F-T8 (Lane F, Task 8): One run: start, sync and import

Spec §6.2-§6.3, §9. `startRun` does steps 1-2: no pairing writes a finished failed run ("Proyek ini belum ditautkan ke DATUM."); runs still open after 10 minutes close as "Sinkron terputus sebelum selesai."; the partial unique index answers `running`. `executeSync` runs `areas`, `link`, `create` (behind the plausibility gate), `gate_status`, `staff`, `escalate`, each recorded as ok, error or skipped with its reason, a failed step skipping only what needs its output (decision 10). `executeImport` runs `areas`, `import`, `gate_status`. Escalation takes the 20 oldest by `confirmed_at`, skips unlinked rooms with their reason, stores the card only after DATUM answered, and counts the rest as deferred; a lost SANO write is healed by the next run, because DATUM returns the same card. An unexpected throw still closes the run. Every database access goes through the `SyncStore` interface (F-T10 implements it over the service-role client; `testing.ts`'s `FakeStore` applies the same rules the database does where a run depends on them).

**Files:**
- Modify: `supabase/functions/datum-sync/testing.ts` (replaced: `FakeStore`, `world`, `decision` join `fakeDatum`)
- Create: `supabase/functions/datum-sync/run.test.ts`
- Create: `supabase/functions/datum-sync/run.ts`

**Depends on:** F-T7.

- [ ] **Step 1: Give `testing.ts` the store fake and the shared world**

Replace the whole of `supabase/functions/datum-sync/testing.ts` with exactly this content:

```ts
// SANO - datum-sync: in-memory fakes for the Deno tests. Never imported by
// index.ts, so never deployed as code that runs.
//
// FakeStore holds SANO's rows and applies the same rules the database does
// where a run depends on them: one open run per project (the partial unique
// index of migration 107), a 23505 on a duplicate room code, the
// datum_staff_id unique index. fakeDatum() serves DATUM's five routes from
// memory, behind the same bearer, and makes one card per SANO event.

import { makeDatumApi } from './datum.ts';
import type { PlanProfile, PlanRoom, RunCounts, RunDifferences, SanoGateWord } from './plan.ts';
import type {
  EscalationDue,
  GateStatusCacheRow,
  ImportedRoomRow,
  ProjectRow,
  RunContext,
  RunRequest,
  SyncStore,
} from './run.ts';

export interface FakeRun {
  id: string;
  project_id: string;
  source: string;
  requested_by: string | null;
  request_id: string | null;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  counts: RunCounts;
  differences: RunDifferences;
  error: string | null;
}

export interface FakeEvent {
  id: string;
  project_id: string;
  room_id: string;
  status: string;
  event_type: string;
  title: string;
  summary: string | null;
  due_date: string;
  confirmed_at: string | null;
  reporter_id: string;
  confirmed_by: string | null;
  owner_id: string;
  datum_card_id: string | null;
  datum_card_url: string | null;
  datum_escalated_at: string | null;
}

export class FakeStore implements SyncStore {
  projects: ProjectRow[] = [];
  rooms: Array<PlanRoom & { project_id: string; created_by?: string | null }> = [];
  runs: FakeRun[] = [];
  requests: Array<{ id: string; handled_at: string | null; run_id: string | null; error: string | null }> = [];
  gateRefs: SanoGateWord[] = [];
  cache: GateStatusCacheRow[] = [];
  profiles: PlanProfile[] = [];
  events: FakeEvent[] = [];
  /** Set to make the next call of that method throw. */
  failNext: Partial<Record<keyof SyncStore, string>> = {};
  /** Runs inside insertImportedRoom before the insert: a test makes a room "meanwhile" here. */
  beforeRoomInsert: ((row: ImportedRoomRow) => void) | null = null;
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private maybeFail(method: keyof SyncStore): void {
    const message = this.failNext[method];
    if (message) {
      delete this.failNext[method];
      throw new Error(message);
    }
  }

  getProject(projectId: string): Promise<ProjectRow | null> {
    this.maybeFail('getProject');
    return Promise.resolve(this.projects.find((p) => p.id === projectId) ?? null);
  }

  closeStaleRuns(projectId: string, olderThanIso: string, nowIso: string): Promise<void> {
    this.maybeFail('closeStaleRuns');
    for (const r of this.runs) {
      if (r.project_id === projectId && r.finished_at === null && r.started_at < olderThanIso) {
        Object.assign(r, { finished_at: nowIso, ok: false, error: 'Sinkron terputus sebelum selesai.' });
      }
    }
    return Promise.resolve();
  }

  openRun(req: RunRequest): Promise<{ runId: string } | { running: true }> {
    this.maybeFail('openRun');
    if (this.runs.some((r) => r.project_id === req.projectId && r.finished_at === null)) return Promise.resolve({ running: true });
    const run: FakeRun = {
      id: this.id('run'), project_id: req.projectId, source: req.source, requested_by: req.requestedBy,
      request_id: req.requestId, started_at: new Date().toISOString(), finished_at: null, ok: null,
      counts: { steps: {} }, differences: {}, error: null,
    };
    this.runs.push(run);
    return Promise.resolve({ runId: run.id });
  }

  insertFinishedRun(req: RunRequest, fields: { finishedAt: string; error: string }): Promise<string> {
    const run: FakeRun = {
      id: this.id('run'), project_id: req.projectId, source: req.source, requested_by: req.requestedBy,
      request_id: req.requestId, started_at: fields.finishedAt, finished_at: fields.finishedAt, ok: false,
      counts: { steps: {} }, differences: {}, error: fields.error,
    };
    this.runs.push(run);
    return Promise.resolve(run.id);
  }

  finishRun(
    runId: string,
    fields: { finishedAt: string; ok: boolean; counts: RunCounts; differences: RunDifferences; error: string | null },
  ): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (run) Object.assign(run, { finished_at: fields.finishedAt, ok: fields.ok, counts: fields.counts, differences: fields.differences, error: fields.error });
    return Promise.resolve();
  }

  markRequest(requestId: string, fields: { handledAt: string; runId: string | null; error: string | null }): Promise<void> {
    const req = this.requests.find((r) => r.id === requestId);
    if (req) Object.assign(req, { handled_at: fields.handledAt, run_id: fields.runId, error: fields.error });
    return Promise.resolve();
  }

  listRooms(projectId: string): Promise<PlanRoom[]> {
    this.maybeFail('listRooms');
    return Promise.resolve(
      this.rooms.filter((r) => r.project_id === projectId).map(({ project_id: _p, created_by: _c, ...room }) => ({ ...room })),
    );
  }

  setRoomLink(roomId: string, areaId: string): Promise<void> {
    this.maybeFail('setRoomLink');
    const room = this.rooms.find((r) => r.id === roomId);
    if (room) room.datum_area_id = areaId;
    return Promise.resolve();
  }

  insertImportedRoom(row: ImportedRoomRow): Promise<string | null> {
    this.maybeFail('insertImportedRoom');
    this.beforeRoomInsert?.(row);
    if (this.rooms.some((r) => r.project_id === row.project_id && r.room_code === row.room_code)) return Promise.resolve(null);
    const id = this.id('room');
    this.rooms.push({
      id, project_id: row.project_id, room_code: row.room_code, room_name: row.room_name, floor: row.floor,
      area_type: row.area_type, sort_order: row.sort_order, active: true, datum_area_id: row.datum_area_id,
      created_by: row.created_by,
    });
    return Promise.resolve(id);
  }

  listGateRefs(): Promise<SanoGateWord[]> {
    this.maybeFail('listGateRefs');
    return Promise.resolve(this.gateRefs.map((g) => ({ ...g })));
  }

  upsertGateStatus(rows: GateStatusCacheRow[]): Promise<void> {
    this.maybeFail('upsertGateStatus');
    for (const row of rows) {
      this.cache = this.cache.filter((c) => !(c.room_id === row.room_id && c.gate_code === row.gate_code));
      this.cache.push({ ...row });
    }
    return Promise.resolve();
  }

  listProfiles(): Promise<PlanProfile[]> {
    this.maybeFail('listProfiles');
    return Promise.resolve(this.profiles.map((p) => ({ ...p })));
  }

  setProfileStaffLink(profileId: string, staffId: string): Promise<void> {
    this.maybeFail('setProfileStaffLink');
    if (this.profiles.some((p) => p.datum_staff_id === staffId)) {
      return Promise.reject(new Error('duplicate key value violates unique constraint "idx_profiles_datum_staff_id"'));
    }
    const profile = this.profiles.find((p) => p.id === profileId);
    if (profile && profile.datum_staff_id === null) profile.datum_staff_id = staffId;
    return Promise.resolve();
  }

  private due(projectId: string): FakeEvent[] {
    return this.events
      .filter((e) => e.project_id === projectId && e.status === 'open' && e.event_type === 'butuh_keputusan' && e.confirmed_at !== null && e.datum_card_id === null)
      .sort((a, b) => ((a.confirmed_at as string) < (b.confirmed_at as string) ? -1 : 1));
  }

  listEscalationDue(projectId: string, limit: number): Promise<EscalationDue[]> {
    this.maybeFail('listEscalationDue');
    const person = (id: string | null) => this.profiles.find((p) => p.id === id) ?? null;
    return Promise.resolve(
      this.due(projectId).slice(0, limit).map((e) => {
        const room = this.rooms.find((r) => r.id === e.room_id)!;
        const reporter = person(e.reporter_id);
        const confirmer = person(e.confirmed_by);
        return {
          id: e.id, title: e.title, summary: e.summary, due_date: e.due_date, confirmed_at: e.confirmed_at as string,
          room_code: room.room_code as string, room_name: room.room_name, room_datum_area_id: room.datum_area_id,
          reporter_name: reporter?.full_name ?? null, reporter_staff_id: reporter?.datum_staff_id ?? null,
          confirmer_name: confirmer?.full_name ?? null, confirmer_staff_id: confirmer?.datum_staff_id ?? null,
          owner_name: person(e.owner_id)?.full_name ?? null,
        };
      }),
    );
  }

  countEscalationDue(projectId: string): Promise<number> {
    return Promise.resolve(this.due(projectId).length);
  }

  setEventCard(eventId: string, cardId: string, cardUrl: string, escalatedAtIso: string): Promise<void> {
    this.maybeFail('setEventCard');
    const ev = this.events.find((e) => e.id === eventId);
    if (ev && ev.datum_card_id === null) Object.assign(ev, { datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso });
    return Promise.resolve();
  }
}

// ─── A DATUM that answers the five routes from memory ────────────────────────

export interface FakeDatumState {
  secret: string;
  projects: Array<{ id: string; project_code: string; project_name: string }>;
  areas: Array<{ id: string; project_id: string; area_code: string; area_name: string; floor: string | null; area_type: string; sort_order: number; tracked: boolean }>;
  gates: Array<{ code: string; name: string; description: string | null; sort_order: number }>;
  statuses: Array<{ project_id: string; area_id: string; gate_code: string; status: string; stale: boolean; last_recomputed_at: string | null; updated_at: string | null }>;
  staff: Array<{ id: string; full_name: string; active: boolean }>;
  cards: Array<{ id: string; sano_event_id: string; area_id: string; author: string; slug: string }>;
  systemStaffId: string;
  /** Route path (e.g. 'areas', 'staff') to answer with this status instead. */
  failRoute: Record<string, number>;
  calls: Array<{ method: string; path: string; body: unknown }>;
}

export function fakeDatum(seed: Partial<FakeDatumState> = {}): { state: FakeDatumState; fetch: typeof fetch } {
  const state: FakeDatumState = {
    secret: 'datum-secret', projects: [], areas: [], gates: [], statuses: [], staff: [], cards: [],
    systemStaffId: 'staff-system', failRoute: {}, calls: [], ...seed,
  };
  let seq = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const route = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/integrations\/sano\//, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, path, body });
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${state.secret}`) return reply(401, { ok: false, code: 'UNAUTHORIZED', error: 'Kunci integrasi SANO tidak cocok.' });
    if (state.failRoute[path]) return reply(state.failRoute[path], { ok: false, code: 'DB_ERROR', error: 'fake failure' });

    const projectCode = (method === 'GET' ? url.searchParams.get('project_code') : body?.project_code) ?? '';
    const project = state.projects.find((p) => p.project_code === String(projectCode).trim().toUpperCase());
    const unknown = () => reply(404, { ok: false, code: 'UNKNOWN_PROJECT', error: `Proyek DATUM dengan kode ${projectCode} tidak ada.` });

    if (path === 'staff' && method === 'GET') {
      return reply(200, { ok: true, staff: state.staff.filter((s) => s.active).map(({ id, full_name }) => ({ id, full_name })) });
    }
    if (path === 'areas' && method === 'GET') {
      if (!project) return unknown();
      const areas = state.areas.filter((a) => a.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id, area_code, area_name, floor, area_type, sort_order }) => ({ id, area_code, area_name, floor, area_type, sort_order }));
      return reply(200, { ok: true, project, areas });
    }
    if (path === 'gate-status' && method === 'GET') {
      if (!project) return unknown();
      const statuses = state.statuses.filter((s) => s.project_id === project.id).map(({ project_id: _p, ...s }) => s);
      return reply(200, { ok: true, gates: state.gates, statuses, read_at: new Date().toISOString() });
    }
    if (path === 'areas' && method === 'POST') {
      if (!project) return unknown();
      const out: Array<{ area_code: string; id: string; created: boolean }> = [];
      for (const item of body.areas as Array<{ area_code: string; area_name: string; floor: string | null; area_type: string; tracked: boolean }>) {
        const known = state.areas.find((a) => a.project_id === project.id && a.area_code === item.area_code);
        if (known) {
          out.push({ area_code: item.area_code, id: known.id, created: false });
          continue;
        }
        seq += 1;
        const id = `area-new-${seq}`;
        const sort = Math.max(-1, ...state.areas.filter((a) => a.project_id === project.id).map((a) => a.sort_order)) + 1;
        state.areas.push({ id, project_id: project.id, ...item, sort_order: sort });
        out.push({ area_code: item.area_code, id, created: true });
      }
      return reply(200, { ok: true, areas: out, errors: [] });
    }
    if (path === 'escalate' && method === 'POST') {
      if (!project) return unknown();
      const found = state.cards.find((c) => c.sano_event_id === body.sano_event_id);
      const author = (id: string) => (id === state.systemStaffId ? 'system' : 'linked');
      if (found) {
        return reply(200, { ok: true, card_id: found.id, card_url: `https://datum.test/project/x/cards/${found.slug}`, created: false, author: author(found.author) });
      }
      seq += 1;
      const staffOk = state.staff.some((s) => s.id === body.author_staff_id && s.active);
      const card = { id: `card-${seq}`, sano_event_id: body.sano_event_id, area_id: body.area_id, author: staffOk ? body.author_staff_id : state.systemStaffId, slug: `kartu-${seq}` };
      state.cards.push(card);
      return reply(200, { ok: true, card_id: card.id, card_url: `https://datum.test/project/x/cards/${card.slug}`, created: true, author: author(card.author) });
    }
    return reply(404, { ok: false, code: 'NOT_FOUND', error: 'no route' });
  };
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => Promise.resolve(route(input, init));
  return { state, fetch: fetchImpl as typeof fetch };
}

// ─── One project, as the run and handler tests share it ──────────────────────


export const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
export const NOW = '2026-09-27T03:00:00.000Z';

export const DATUM_GATES = [
  { code: 'A', name: 'MEP Rough-in + Persiapan Struktural', description: 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.', sort_order: 1 },
  { code: 'B', name: 'Pekerjaan Basah / Waterproofing', description: 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.', sort_order: 2 },
];

/**
 * SANO project SANO-K27 paired to DATUM K2-7. SANO has LT1-KM-1 (DATUM has it
 * too), LT1-DAPUR and UMUM (DATUM has neither). Three profiles: Budi and Siti
 * match DATUM staff exactly (Budi in another case), "Tak Dikenal" matches no one.
 */
export function world() {
  const store = new FakeStore();
  store.projects.push({ id: PROJECT_ID, code: 'SANO-K27', datum_project_code: 'K2-7' });
  store.gateRefs = DATUM_GATES.map((g) => ({ code: g.code, name_id: g.name, description: g.description }));
  store.rooms = [
    { id: 'room-km1', project_id: PROJECT_ID, room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, active: true, datum_area_id: null },
    { id: 'room-dapur', project_id: PROJECT_ID, room_code: 'LT1-DAPUR', room_name: 'Dapur', floor: 'Lt. 1', area_type: 'kitchen', sort_order: 1, active: true, datum_area_id: null },
    { id: 'room-umum', project_id: PROJECT_ID, room_code: 'UMUM', room_name: 'Area Umum', floor: null, area_type: 'general', sort_order: 9999, active: true, datum_area_id: null },
  ];
  store.profiles = [
    { id: 'u-budi', full_name: 'Budi Santoso', datum_staff_id: null },
    { id: 'u-siti', full_name: 'Siti Aminah', datum_staff_id: null },
    { id: 'u-x', full_name: 'Tak Dikenal', datum_staff_id: null },
  ];
  const datum = fakeDatum({
    projects: [{ id: 'dp-1', project_code: 'K2-7', project_name: 'Citraland K2-7 Sonny' }],
    areas: [{ id: 'area-km1', project_id: 'dp-1', area_code: 'LT1-KM-1', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, tracked: true }],
    gates: DATUM_GATES,
    statuses: [
      { project_id: 'dp-1', area_id: 'area-km1', gate_code: 'A', status: 'passed', stale: false, last_recomputed_at: '2026-09-26T03:00:00.000Z', updated_at: '2026-09-26T03:00:00.000Z' },
      { project_id: 'dp-1', area_id: 'area-km1', gate_code: 'B', status: 'blocked', stale: true, last_recomputed_at: null, updated_at: '2026-09-26T04:00:00.000Z' },
    ],
    staff: [
      { id: 'staff-budi', full_name: 'budi  santoso', active: true },
      { id: 'staff-siti', full_name: 'Siti Aminah', active: true },
    ],
  });
  const clock = { now: new Date(NOW) };
  const ctx: RunContext = {
    store,
    datum: makeDatumApi({ baseUrl: 'https://datum.test/', secret: 'datum-secret', fetch: datum.fetch }),
    now: () => clock.now,
  };
  return { store, datum, ctx, clock };
}

let eventSeq = 0;
/** An open, confirmed butuh_keputusan in LT1-KM-1, reported by Budi, confirmed by Siti, owned by Budi. */
export function decision(store: FakeStore, over: Partial<FakeEvent> = {}): FakeEvent {
  eventSeq += 1;
  const ev: FakeEvent = {
    id: `ev-${String(eventSeq).padStart(3, '0')}`, project_id: PROJECT_ID, room_id: 'room-km1', status: 'open',
    event_type: 'butuh_keputusan', title: `Keputusan ${eventSeq}`, summary: null, due_date: '2026-10-01',
    confirmed_at: new Date(Date.parse('2026-09-20T00:00:00.000Z') + eventSeq * 60_000).toISOString(), reporter_id: 'u-budi',
    confirmed_by: 'u-siti', owner_id: 'u-budi', datum_card_id: null, datum_card_url: null, datum_escalated_at: null, ...over,
  };
  store.events.push(ev);
  return ev;
}
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/datum-sync/run.test.ts` with exactly this content:

```ts
import { assert, assertEquals } from 'std/assert';
import { createGateSentence, IMPORT_GONE, importBadCode, importRaced } from './plan.ts';
import { AREAS_UNREAD, PAIRING_MISSING, RUN_INTERRUPTED, executeImport, executeSync, startRun, type RunRequest } from './run.ts';
import { PROJECT_ID, decision, world } from './testing.ts';

const manual: RunRequest = { projectId: PROJECT_ID, source: 'manual', requestedBy: 'u-siti', requestId: null };

async function sync(w: ReturnType<typeof world>, req: RunRequest = manual) {
  const started = await startRun(w.ctx, req);
  if (started.kind !== 'started') throw new Error(`run did not start: ${started.kind}`);
  return executeSync(w.ctx, started.runId, started.project, req);
}

async function importCodes(w: ReturnType<typeof world>, codes: string[]) {
  const req: RunRequest = { ...manual, source: 'import' };
  const started = await startRun(w.ctx, req);
  if (started.kind !== 'started') throw new Error(`run did not start: ${started.kind}`);
  return executeImport(w.ctx, started.runId, started.project, req, codes);
}

Deno.test('a first sync links, creates, caches gate status, links staff, and records every step ok', async () => {
  const w = world();
  const report = await sync(w);

  assertEquals(report.ok, true);
  assertEquals(report.error, null);
  assertEquals(report.counts.steps, { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' });
  assertEquals(report.counts.datum_project_name, 'Citraland K2-7 Sonny');
  assertEquals(w.store.rooms.map((r) => [r.room_code, r.datum_area_id !== null]), [['LT1-KM-1', true], ['LT1-DAPUR', true], ['UMUM', true]]);
  assertEquals(w.store.rooms[0].datum_area_id, 'area-km1');
  assertEquals(report.counts.rooms_linked, 3);
  assertEquals(report.counts.rooms_linked_now, 3);
  assertEquals(report.counts.rooms_created, 2);

  const post = w.datum.state.calls.find((c) => c.method === 'POST' && c.path === 'areas');
  assertEquals(post?.body, {
    project_code: 'K2-7',
    areas: [
      { area_code: 'LT1-DAPUR', area_name: 'Dapur', floor: 'Lt. 1', area_type: 'kitchen', tracked: true },
      { area_code: 'UMUM', area_name: 'Area Umum', floor: null, area_type: 'general', tracked: false },
    ],
  });

  assertEquals(w.store.cache.map((c) => [c.room_id, c.gate_code, c.status, c.datum_stale, c.datum_area_id]), [
    ['room-km1', 'A', 'passed', false, 'area-km1'],
    ['room-km1', 'B', 'blocked', true, 'area-km1'],
  ]);
  assertEquals(w.store.cache[0].run_id, report.runId);
  assertEquals(report.counts.gate_rows, 2);
  // Every linked room's area was covered by this read, including the two just created.
  assertEquals(report.counts.gate_area_ids, ['area-km1', 'area-new-1', 'area-new-2']);

  assertEquals(w.store.profiles.map((p) => [p.id, p.datum_staff_id]), [['u-budi', 'staff-budi'], ['u-siti', 'staff-siti'], ['u-x', null]]);
  assertEquals(report.counts.staff, { linked: 2, linked_now: 2, unmatched: 1, ambiguous: 0, stale: 0 });
  assertEquals(report.differences.staff?.unmatched, [{ profile_id: 'u-x', full_name: 'Tak Dikenal' }]);

  const run = w.store.runs.find((r) => r.id === report.runId)!;
  assertEquals([run.ok, run.error, run.finished_at], [true, null, '2026-09-27T03:00:00.000Z']);
});

Deno.test('the plausibility gate refuses to create when no room matches a DATUM area, and says why', async () => {
  const w = world();
  w.datum.state.areas[0].area_code = 'LT9-LAIN';
  const report = await sync(w);
  assertEquals(report.counts.steps.create, 'skipped');
  assertEquals(report.counts.step_errors?.create, createGateSentence('Citraland K2-7 Sonny'));
  assertEquals(report.ok, false);
  assertEquals(report.error, createGateSentence('Citraland K2-7 Sonny'));
  assertEquals(w.datum.state.calls.some((c) => c.method === 'POST'), false);
  assertEquals(report.differences.datum_only, [{ area_code: 'LT9-LAIN', area_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom' }]);
});

Deno.test('a DATUM project with no areas opens the gate: every active room is created', async () => {
  const w = world();
  w.datum.state.areas = [];
  const report = await sync(w);
  assertEquals(report.counts.steps.create, 'ok');
  assertEquals(report.counts.rooms_created, 3);
});

Deno.test('areas failing marks link and create, while gate_status, staff and escalate still run', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = 'area-km1';
  decision(w.store);
  w.datum.state.failRoute = { areas: 500 };
  const report = await sync(w);
  assertEquals(report.counts.steps, { areas: 'error', link: 'skipped', create: 'skipped', gate_status: 'ok', staff: 'ok', escalate: 'ok' });
  assertEquals(report.counts.step_errors?.link, AREAS_UNREAD);
  assertEquals(report.error, 'DATUM menjawab 500 DB_ERROR: fake failure');
  assertEquals(report.counts.escalated, 1);
  assertEquals(report.counts.gate_rows, 2);
});

Deno.test('a wrong secret fails every DATUM step with the 401 sentence and writes nothing', async () => {
  const w = world();
  w.datum.state.secret = 'rotated';
  decision(w.store);
  const report = await sync(w);
  const sentence = 'DATUM menolak kunci integrasi (401).';
  assertEquals(report.counts.step_errors?.areas, sentence);
  assertEquals(report.counts.step_errors?.gate_status, sentence);
  assertEquals(report.counts.step_errors?.staff, sentence);
  assertEquals(w.store.rooms.every((r) => r.datum_area_id === null), true);
  assertEquals(w.store.cache, []);
  assertEquals(w.store.profiles.every((p) => p.datum_staff_id === null), true);
  assertEquals(w.store.events[0].datum_card_id, null);
});

Deno.test('an unknown DATUM code is named in the run', async () => {
  const w = world();
  w.store.projects[0].datum_project_code = 'ZZ-9';
  const report = await sync(w);
  assertEquals(report.error, 'Kode proyek DATUM ZZ-9 tidak ditemukan di DATUM.');
});

Deno.test("escalation authors by the reporter's link, else the confirmer's, else none, and sends both SANO names", async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = 'area-km1';
  w.datum.state.staff.push({ id: 'staff-andi', full_name: 'Andi', active: true });
  w.store.profiles.push({ id: 'u-andi', full_name: 'Andi', datum_staff_id: null });
  w.store.profiles.push({ id: 'u-nolink', full_name: 'Orang Tanpa Tautan', datum_staff_id: null });
  const byReporter = decision(w.store, { reporter_id: 'u-budi', confirmed_by: 'u-andi' });
  const byConfirmer = decision(w.store, { reporter_id: 'u-nolink', confirmed_by: 'u-andi' });
  const bySystem = decision(w.store, { reporter_id: 'u-nolink', confirmed_by: null });
  const report = await sync(w);

  const sent = w.datum.state.calls.filter((c) => c.path === 'escalate').map((c) => c.body as Record<string, unknown>);
  const bodyOf = (id: string) => sent.find((b) => b.sano_event_id === id)!;
  assertEquals(bodyOf(byReporter.id).author_staff_id, 'staff-budi');
  assertEquals(bodyOf(byConfirmer.id).author_staff_id, 'staff-andi');
  assertEquals(bodyOf(bySystem.id).author_staff_id, null);
  assertEquals([bodyOf(byConfirmer.id).reporter_name, bodyOf(byConfirmer.id).confirmer_name], ['Orang Tanpa Tautan', 'Andi']);
  assertEquals(bodyOf(bySystem.id).confirmer_name, null);
  assertEquals(bodyOf(byReporter.id).sano_url, 'https://sano-app.vercel.app/r/SANO-K27/LT1-KM-1');
  assertEquals(bodyOf(byReporter.id).area_id, 'area-km1');
  assertEquals(report.counts.escalated, 3);
  assertEquals(report.counts.escalated_as_system, 1);
  assert(w.store.events.every((e) => e.datum_card_id !== null && e.datum_escalated_at === '2026-09-27T03:00:00.000Z'));
});

Deno.test('the same event is sent once; a lost SANO write is healed by the next run with the same card', async () => {
  const w = world();
  w.store.rooms[0].datum_area_id = 'area-km1';
  const ev = decision(w.store);
  w.store.failNext.setEventCard = 'network blip';
  const first = await sync(w);
  assertEquals(first.counts.escalate_failed, 1);
  assertEquals(first.counts.steps.escalate, 'error');
  assertEquals(ev.datum_card_id, null);
  assertEquals(w.datum.state.cards.length, 1);

  const second = await sync(w);
  assertEquals(second.counts.escalated, 1);
  assertEquals(ev.datum_card_id, w.datum.state.cards[0].id);
  assertEquals(w.datum.state.cards.length, 1);

  await sync(w);
  assertEquals(w.datum.state.calls.filter((c) => c.path === 'escalate').length, 2);
});

Deno.test('a decision in an unlinked room is skipped with its reason; the 21st is deferred', async () => {
  const w = world();
  w.datum.state.areas = [];
  w.datum.state.failRoute = { areas: 500 };
  decision(w.store, { room_id: 'room-dapur', title: 'Di dapur' });
  for (let i = 0; i < 20; i++) decision(w.store);
  w.store.rooms[0].datum_area_id = 'area-km1';
  const report = await sync(w);
  assertEquals(report.counts.escalate_skipped, 1);
  assertEquals(report.differences.escalate_skipped?.[0], {
    event_id: w.store.events[0].id, room_code: 'LT1-DAPUR', title: 'Di dapur', reason: 'Ruangan belum tertaut ke area DATUM.',
  });
  assertEquals(report.counts.escalated, 19);
  assertEquals(report.counts.escalate_deferred, 1);
});

Deno.test('staff links are set only for unique matches; a stale link is reported and left alone', async () => {
  const w = world();
  w.store.profiles[1].datum_staff_id = 'staff-gone';
  const report = await sync(w);
  assertEquals(w.store.profiles[1].datum_staff_id, 'staff-gone');
  assertEquals(report.differences.staff?.stale, [
    { profile_id: 'u-siti', full_name: 'Siti Aminah', staff_id: 'staff-gone', staff_name: null, reason: 'staff_gone' },
  ]);
  assertEquals(report.counts.staff, { linked: 2, linked_now: 1, unmatched: 1, ambiguous: 0, stale: 1 });
});

Deno.test('a gate word that differs from gate_refs is listed and nothing is written to gate_refs', async () => {
  const w = world();
  w.datum.state.gates = [{ ...w.datum.state.gates[0] }, { ...w.datum.state.gates[1], description: 'Deskripsi baru dari DATUM.' }];
  const before = JSON.stringify(w.store.gateRefs);
  const report = await sync(w);
  assertEquals(report.differences.gate_words, [{ code: 'B', field: 'description' }]);
  assertEquals(JSON.stringify(w.store.gateRefs), before);
});

Deno.test('the import brings only confirmed, still DATUM-only areas, links them, reads their status, and posts nothing', async () => {
  const w = world();
  w.store.rooms = [];
  w.datum.state.areas.push(
    { id: 'area-teras', project_id: 'dp-1', area_code: 'LT2-TERAS', area_name: 'Teras Atas', floor: 'Lt. 2', area_type: 'terrace', sort_order: 4, tracked: true },
    { id: 'area-long', project_id: 'dp-1', area_code: `${'A'.repeat(39)} B`, area_name: 'Kode panjang', floor: null, area_type: 'general', sort_order: 5, tracked: true },
    { id: 'area-race', project_id: 'dp-1', area_code: 'LT3-RACE', area_name: 'Balapan', floor: 'Lt. 3', area_type: 'hall', sort_order: 6, tracked: true },
  );
  w.store.beforeRoomInsert = (row) => {
    if (row.room_code !== 'LT3-RACE') return;
    w.store.rooms.push({ id: 'room-race', project_id: PROJECT_ID, room_code: 'LT3-RACE', room_name: 'Dibuat duluan', floor: null, area_type: 'general', sort_order: 0, active: true, datum_area_id: null });
  };
  const report = await importCodes(w, ['LT1-KM-1', 'LT2-TERAS', `${'A'.repeat(39)} B`, 'LT3-RACE', 'GONE-1']);

  assertEquals(report.counts.steps, { areas: 'ok', import: 'ok', gate_status: 'ok' });
  assertEquals(report.counts.rooms_imported, 2);
  const km1 = w.store.rooms.find((r) => r.room_code === 'LT1-KM-1')!;
  assertEquals(
    { ...km1, id: 'x' },
    { id: 'x', project_id: PROJECT_ID, room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: 'Lt. 1', area_type: 'bathroom', sort_order: 0, active: true, datum_area_id: 'area-km1', created_by: 'u-siti' },
  );
  assertEquals(w.store.rooms.find((r) => r.room_code === 'LT2-TERAS')?.area_type, 'terrace');
  assertEquals(w.store.rooms.find((r) => r.room_code === 'LT3-RACE')?.room_name, 'Dibuat duluan');
  assertEquals(report.differences.import_skipped, [
    { area_code: `${'A'.repeat(39)} B`, reason: importBadCode(`${'A'.repeat(39)} B`) },
    { area_code: 'GONE-1', reason: IMPORT_GONE },
    { area_code: 'LT3-RACE', reason: importRaced('LT3-RACE') },
  ]);
  assertEquals(w.datum.state.calls.some((c) => c.method === 'POST'), false);
  assertEquals(w.store.cache.length, 2);
  assertEquals(report.differences.datum_only?.map((a) => a.area_code), [`${'A'.repeat(39)} B`]);
});

Deno.test('after the import the plausibility gate opens and the next sync creates SANO-only rooms', async () => {
  const w = world();
  const saved = w.store.rooms;
  w.store.rooms = [];
  await importCodes(w, ['LT1-KM-1']);
  w.store.rooms.push(...saved.filter((r) => r.room_code !== 'LT1-KM-1'));
  const report = await sync(w);
  assertEquals(report.counts.steps.create, 'ok');
  assertEquals(report.counts.rooms_created, 2);
});

Deno.test('startRun: pairing missing writes a failed run; one open run blocks another; a ten-minute-old one is closed', async () => {
  const w = world();
  w.store.projects[0].datum_project_code = null;
  const missing = await startRun(w.ctx, manual);
  assertEquals(missing.kind, 'pairing_missing');
  assertEquals(w.store.runs.map((r) => [r.ok, r.error, r.finished_at !== null]), [[false, PAIRING_MISSING, true]]);

  w.store.projects[0].datum_project_code = 'K2-7';
  const first = await startRun(w.ctx, manual);
  assertEquals(first.kind, 'started');
  assertEquals((await startRun(w.ctx, manual)).kind, 'running');

  const open = w.store.runs.find((r) => r.finished_at === null)!;
  open.started_at = '2026-09-27T02:49:00.000Z';
  const later = await startRun(w.ctx, manual);
  assertEquals(later.kind, 'started');
  assertEquals([open.ok, open.error], [false, RUN_INTERRUPTED]);
});

Deno.test('an unexpected throw still finishes the run as failed, so the lock frees', async () => {
  const w = world();
  w.store.failNext.listGateRefs = 'boom';
  const report = await sync(w);
  assertEquals(report.counts.steps.gate_status, 'error');
  assertEquals(report.counts.step_errors?.gate_status, 'Status gerbang DATUM gagal disimpan: boom');
  assertEquals(w.store.runs.every((r) => r.finished_at !== null), true);
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test run.test.ts; rm -f deno.lock
```

Expected: `error: Module not found "file:///.../supabase/functions/datum-sync/run.ts"`.

- [ ] **Step 4: Write the runs**

Create `supabase/functions/datum-sync/run.ts` with exactly this content:

```ts
// SANO - datum-sync: one run, step by step.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6.2-§6.3.
//
// A sync runs areas, link, create, gate_status, staff, escalate in that
// order; an import runs areas, import, gate_status. Each step lands in
// counts.steps as ok, error or skipped, with its reason in counts.step_errors,
// and a failed step skips only the steps that need its output (decision 10).
// Every database access goes through SyncStore (store.ts over the service-role
// client in production, an in-memory fake in the tests), and every DATUM call
// through DatumApi (datum.ts). Nothing here deletes a row, renames anything or
// writes a column other than those store.ts names.

import {
  ESCALATE_BATCH,
  ESCALATE_ROOM_UNLINKED,
  createGateOpen,
  createGateSentence,
  diffGateWords,
  escalationAuthor,
  importRaced,
  planImport,
  planRoomSync,
  planStaffLinks,
  runVerdict,
  sanoRoomUrl,
  staffCounts,
  type CreateFailedItem,
  type EscalateSkipItem,
  type ImportSkip,
  type PlanArea,
  type PlanProfile,
  type PlanRoom,
  type RunCounts,
  type RunDifferences,
  type RunReport,
  type SanoGateWord,
  type SyncSource,
  type SyncStep,
} from './plan.ts';
import type { DatumApi, DatumEscalateBody } from './datum.ts';

export interface ProjectRow { id: string; code: string; datum_project_code: string | null }
export type PairedProject = ProjectRow & { datum_project_code: string };

/** An open, confirmed butuh_keputusan with no card yet, with the names DATUM's note needs. */
export interface EscalationDue {
  id: string;
  title: string;
  summary: string | null;
  due_date: string;
  confirmed_at: string;
  room_code: string;
  room_name: string;
  room_datum_area_id: string | null;
  reporter_name: string | null;
  reporter_staff_id: string | null;
  confirmer_name: string | null;
  confirmer_staff_id: string | null;
  owner_name: string | null;
}

export interface GateStatusCacheRow {
  room_id: string;
  gate_code: string;
  project_id: string;
  datum_area_id: string;
  status: string;
  datum_stale: boolean;
  datum_updated_at: string | null;
  datum_recomputed_at: string | null;
  synced_at: string;
  run_id: string;
}

export interface ImportedRoomRow {
  project_id: string;
  room_code: string;
  room_name: string;
  floor: string | null;
  area_type: string;
  sort_order: number;
  datum_area_id: string;
  created_by: string | null;
}

export interface RunRequest {
  projectId: string;
  source: SyncSource;
  requestedBy: string | null;
  requestId: string | null;
}

/** Every method throws an Error naming the table on a database error. */
export interface SyncStore {
  getProject(projectId: string): Promise<ProjectRow | null>;
  closeStaleRuns(projectId: string, olderThanIso: string, nowIso: string): Promise<void>;
  openRun(req: RunRequest): Promise<{ runId: string } | { running: true }>;
  insertFinishedRun(req: RunRequest, fields: { finishedAt: string; error: string }): Promise<string>;
  finishRun(
    runId: string,
    fields: { finishedAt: string; ok: boolean; counts: RunCounts; differences: RunDifferences; error: string | null },
  ): Promise<void>;
  markRequest(requestId: string, fields: { handledAt: string; runId: string | null; error: string | null }): Promise<void>;
  listRooms(projectId: string): Promise<PlanRoom[]>;
  setRoomLink(roomId: string, areaId: string): Promise<void>;
  /** The new room's id, or null when a room with that code was made meanwhile (23505). */
  insertImportedRoom(row: ImportedRoomRow): Promise<string | null>;
  listGateRefs(): Promise<SanoGateWord[]>;
  upsertGateStatus(rows: GateStatusCacheRow[]): Promise<void>;
  listProfiles(): Promise<PlanProfile[]>;
  setProfileStaffLink(profileId: string, staffId: string): Promise<void>;
  listEscalationDue(projectId: string, limit: number): Promise<EscalationDue[]>;
  countEscalationDue(projectId: string): Promise<number>;
  setEventCard(eventId: string, cardId: string, cardUrl: string, escalatedAtIso: string): Promise<void>;
}

export interface RunContext { store: SyncStore; datum: DatumApi; now: () => Date }

export const RUN_INTERRUPTED = 'Sinkron terputus sebelum selesai.';
export const PAIRING_MISSING = 'Proyek ini belum ditautkan ke DATUM.';
export const SYNC_RUNNING = 'Sinkron DATUM untuk proyek ini sedang berjalan.';
export const AREAS_UNREAD = 'Area DATUM tidak terbaca pada sinkron ini.';
export const STALE_RUN_MS = 10 * 60 * 1000;

const READINESS = new Set(['not_started', 'in_progress', 'ready_for_handoff', 'blocked', 'passed', 'not_applicable']);

const CREATE_ITEM_ERRORS: Record<string, string> = {
  CODE_NOT_NORMALIZED: 'DATUM menolak kodenya: bukan kode yang sudah dinormalkan.',
  INVALID: 'DATUM menolak nama, lantai atau tipenya.',
  DB_ERROR: 'DATUM gagal menyimpannya.',
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export type StartOutcome =
  | { kind: 'started'; runId: string; project: PairedProject }
  | { kind: 'pairing_missing'; runId: string }
  | { kind: 'running' }
  | { kind: 'not_found' };

/** §6.2 steps 1-2: the pairing, the stale-run sweep, then the lock (one open run per project). */
export async function startRun(ctx: RunContext, req: RunRequest): Promise<StartOutcome> {
  const project = await ctx.store.getProject(req.projectId);
  if (!project) return { kind: 'not_found' };
  const now = ctx.now();
  if (!project.datum_project_code) {
    const runId = await ctx.store.insertFinishedRun(req, { finishedAt: now.toISOString(), error: PAIRING_MISSING });
    return { kind: 'pairing_missing', runId };
  }
  await ctx.store.closeStaleRuns(req.projectId, new Date(now.getTime() - STALE_RUN_MS).toISOString(), now.toISOString());
  const opened = await ctx.store.openRun(req);
  if ('running' in opened) return { kind: 'running' };
  return { kind: 'started', runId: opened.runId, project: project as PairedProject };
}

class Recorder {
  counts: RunCounts = { steps: {}, step_errors: {} };
  differences: RunDifferences = {};
  ok(step: SyncStep): void {
    this.counts.steps[step] = 'ok';
  }
  fail(step: SyncStep, reason: string): void {
    this.counts.steps[step] = 'error';
    this.counts.step_errors![step] = reason;
  }
  skip(step: SyncStep, reason: string): void {
    this.counts.steps[step] = 'skipped';
    this.counts.step_errors![step] = reason;
  }
}

async function readAreas(ctx: RunContext, rec: Recorder, code: string): Promise<PlanArea[] | null> {
  const reply = await ctx.datum.getAreas(code);
  if (!reply.ok) {
    rec.fail('areas', reply.error);
    return null;
  }
  rec.ok('areas');
  rec.counts.datum_project_name = reply.data.project.project_name;
  return reply.data.areas;
}

async function readRooms(ctx: RunContext, projectId: string): Promise<{ rooms: PlanRoom[] } | { error: string }> {
  try {
    return { rooms: await ctx.store.listRooms(projectId) };
  } catch (err) {
    return { error: `Ruangan SANO gagal dibaca: ${message(err)}` };
  }
}

function linkLocally(rooms: PlanRoom[], roomId: string, areaId: string): void {
  const room = rooms.find((r) => r.id === roomId);
  if (room) room.datum_area_id = areaId;
}

function recordPlanDifferences(rec: Recorder, plan: ReturnType<typeof planRoomSync>, nowInSano: ReadonlySet<string>): void {
  const datumOnly = plan.datumOnly.filter((a) => !nowInSano.has(a.area_id));
  rec.counts.datum_only = datumOnly.length;
  rec.counts.field_conflicts = plan.fieldConflicts.length;
  rec.counts.retired_missing = plan.retiredMissing.length;
  if (datumOnly.length) {
    rec.differences.datum_only = datumOnly.map((a) => ({
      area_code: a.area_code, area_name: a.area_name, floor: a.floor, area_type: a.area_type,
    }));
  }
  if (plan.fieldConflicts.length) rec.differences.field_conflicts = plan.fieldConflicts;
  if (plan.datumDuplicates.length) rec.differences.datum_duplicates = plan.datumDuplicates;
}

async function linkAndCreate(
  ctx: RunContext,
  rec: Recorder,
  project: PairedProject,
  rooms: PlanRoom[] | null,
  roomsError: string | null,
  areas: PlanArea[] | null,
): Promise<void> {
  if (!areas) {
    rec.skip('link', AREAS_UNREAD);
    rec.skip('create', AREAS_UNREAD);
    return;
  }
  if (!rooms) {
    rec.fail('link', roomsError ?? 'Ruangan SANO gagal dibaca.');
    rec.skip('create', roomsError ?? 'Ruangan SANO gagal dibaca.');
    return;
  }
  const plan = planRoomSync(rooms, areas);
  recordPlanDifferences(rec, plan, new Set());

  let linkedNow = 0;
  let linkError: string | null = null;
  for (const item of plan.link) {
    try {
      await ctx.store.setRoomLink(item.room_id, item.area_id);
      linkLocally(rooms, item.room_id, item.area_id);
      linkedNow += 1;
    } catch (err) {
      linkError ??= `Tautan ruangan ${item.room_code} gagal disimpan: ${message(err)}`;
    }
  }
  if (linkError) rec.fail('link', linkError);
  else rec.ok('link');

  const createFailed: CreateFailedItem[] = [...plan.createFailed];
  let created = 0;
  if (!createGateOpen(plan, areas.length)) {
    rec.skip('create', createGateSentence(rec.counts.datum_project_name ?? project.datum_project_code));
  } else if (plan.create.length === 0) {
    rec.ok('create');
  } else {
    const posted = await ctx.datum.postAreas(
      project.datum_project_code,
      plan.create.map(({ area_code, area_name, floor, area_type, tracked }) => ({ area_code, area_name, floor, area_type, tracked })),
    );
    if (!posted.ok) {
      rec.fail('create', posted.error);
    } else {
      let createError: string | null = null;
      const byCode = new Map(plan.create.map((c) => [c.area_code, c]));
      for (const area of posted.data.areas) {
        const item = byCode.get(area.area_code);
        if (!item) continue;
        try {
          await ctx.store.setRoomLink(item.room_id, area.id);
          linkLocally(rooms, item.room_id, area.id);
          linkedNow += 1;
          if (area.created) created += 1;
        } catch (err) {
          createError ??= `Tautan ruangan ${item.area_code} gagal disimpan: ${message(err)}`;
        }
      }
      for (const e of posted.data.errors) {
        createFailed.push({ room_code: e.area_code, reason: CREATE_ITEM_ERRORS[e.code] ?? `DATUM menolak: ${e.code}` });
      }
      if (createError) rec.fail('create', createError);
      else rec.ok('create');
    }
  }
  rec.counts.rooms_linked_now = linkedNow;
  rec.counts.rooms_created = created;
  if (createFailed.length) rec.differences.create_failed = createFailed;
}

async function gateStatusStep(
  ctx: RunContext,
  rec: Recorder,
  runId: string,
  project: PairedProject,
  rooms: PlanRoom[] | null,
  roomsError: string | null,
): Promise<void> {
  const reply = await ctx.datum.getGateStatus(project.datum_project_code);
  if (!reply.ok) {
    rec.fail('gate_status', reply.error);
    return;
  }
  if (!rooms) {
    rec.fail('gate_status', roomsError ?? 'Ruangan SANO gagal dibaca.');
    return;
  }
  try {
    const refs = await ctx.store.listGateRefs();
    const known = new Set(refs.map((r) => r.code));
    const roomsByArea = new Map<string, string[]>();
    for (const r of rooms) {
      if (r.datum_area_id) roomsByArea.set(r.datum_area_id, [...(roomsByArea.get(r.datum_area_id) ?? []), r.id]);
    }
    const syncedAt = ctx.now().toISOString();
    const rows: GateStatusCacheRow[] = [];
    let unlinked = 0;
    for (const s of reply.data.statuses) {
      const roomIds = roomsByArea.get(s.area_id);
      if (!roomIds || !known.has(s.gate_code) || !READINESS.has(s.status)) {
        unlinked += 1;
        continue;
      }
      for (const roomId of roomIds) {
        rows.push({
          room_id: roomId, gate_code: s.gate_code, project_id: project.id, datum_area_id: s.area_id,
          status: s.status, datum_stale: s.stale === true, datum_updated_at: s.updated_at,
          datum_recomputed_at: s.last_recomputed_at, synced_at: syncedAt, run_id: runId,
        });
      }
    }
    if (rows.length) await ctx.store.upsertGateStatus(rows);
    rec.counts.gate_rows = rows.length;
    rec.counts.gate_rows_unlinked = unlinked;
    rec.counts.gate_area_ids = [...roomsByArea.keys()].sort();
    const words = diffGateWords(reply.data.gates, refs);
    if (words.length) rec.differences.gate_words = words;
    rec.ok('gate_status');
  } catch (err) {
    rec.fail('gate_status', `Status gerbang DATUM gagal disimpan: ${message(err)}`);
  }
}

async function staffStep(ctx: RunContext, rec: Recorder): Promise<void> {
  const reply = await ctx.datum.getStaff();
  if (!reply.ok) {
    rec.fail('staff', reply.error);
    return;
  }
  let profiles: PlanProfile[];
  try {
    profiles = await ctx.store.listProfiles();
  } catch (err) {
    rec.fail('staff', `Profil SANO gagal dibaca: ${message(err)}`);
    return;
  }
  const plan = planStaffLinks(profiles, reply.data.staff);
  let setError: string | null = null;
  let setFailed = 0;
  for (const s of plan.set) {
    try {
      await ctx.store.setProfileStaffLink(s.profile_id, s.staff_id);
    } catch (err) {
      setFailed += 1;
      setError ??= `Tautan staf gagal disimpan: ${message(err)}`;
    }
  }
  const counts = staffCounts(plan);
  rec.counts.staff = { ...counts, linked: counts.linked - setFailed, linked_now: counts.linked_now - setFailed };
  rec.differences.staff = { unmatched: plan.unmatched, ambiguous: plan.ambiguous, stale: plan.stale };
  if (setError) rec.fail('staff', setError);
  else rec.ok('staff');
}

async function escalateStep(ctx: RunContext, rec: Recorder, project: PairedProject): Promise<void> {
  let due: EscalationDue[];
  let total: number;
  try {
    [due, total] = await Promise.all([
      ctx.store.listEscalationDue(project.id, ESCALATE_BATCH),
      ctx.store.countEscalationDue(project.id),
    ]);
  } catch (err) {
    rec.fail('escalate', `Keputusan SANO gagal dibaca: ${message(err)}`);
    return;
  }
  const skipped: EscalateSkipItem[] = [];
  let escalated = 0;
  let asSystem = 0;
  let failed = 0;
  let unlinked = 0;
  let firstError: string | null = null;
  for (const ev of due) {
    if (!ev.room_datum_area_id) {
      unlinked += 1;
      skipped.push({ event_id: ev.id, room_code: ev.room_code, title: ev.title, reason: ESCALATE_ROOM_UNLINKED });
      continue;
    }
    const body: DatumEscalateBody = {
      project_code: project.datum_project_code,
      area_id: ev.room_datum_area_id,
      sano_event_id: ev.id,
      sano_url: sanoRoomUrl(project.code, ev.room_code),
      title: ev.title,
      summary: ev.summary,
      room_name: ev.room_name,
      reporter_name: ev.reporter_name ?? '',
      confirmer_name: ev.confirmer_name,
      owner_name: ev.owner_name ?? '',
      due_date: ev.due_date,
      confirmed_at: ev.confirmed_at,
      author_staff_id: escalationAuthor(ev.reporter_staff_id, ev.confirmer_staff_id),
    };
    const reply = await ctx.datum.escalate(body);
    if (!reply.ok) {
      failed += 1;
      firstError ??= reply.error;
      skipped.push({ event_id: ev.id, room_code: ev.room_code, title: ev.title, reason: `Gagal dikirim: ${reply.error}` });
      continue;
    }
    try {
      await ctx.store.setEventCard(ev.id, reply.data.card_id, reply.data.card_url, ctx.now().toISOString());
      escalated += 1;
      if (reply.data.author === 'system') asSystem += 1;
    } catch (err) {
      failed += 1;
      const reason = `Kartu DATUM sudah dibuat, tetapi SANO gagal mencatatnya: ${message(err)}`;
      firstError ??= reason;
      skipped.push({ event_id: ev.id, room_code: ev.room_code, title: ev.title, reason });
    }
  }
  rec.counts.escalated = escalated;
  rec.counts.escalated_as_system = asSystem;
  rec.counts.escalate_failed = failed;
  rec.counts.escalate_skipped = unlinked;
  rec.counts.escalate_deferred = Math.max(0, total - due.length);
  if (skipped.length) rec.differences.escalate_skipped = skipped;
  if (firstError) rec.fail('escalate', firstError);
  else rec.ok('escalate');
}

async function finish(ctx: RunContext, runId: string, req: RunRequest, rec: Recorder, rooms: PlanRoom[] | null): Promise<RunReport> {
  if (rooms) rec.counts.rooms_linked = rooms.filter((r) => r.active && r.datum_area_id).length;
  const verdict = runVerdict(rec.counts);
  const at = ctx.now().toISOString();
  await ctx.store.finishRun(runId, {
    finishedAt: at, ok: verdict.ok, counts: rec.counts, differences: rec.differences, error: verdict.error,
  });
  if (req.requestId) await ctx.store.markRequest(req.requestId, { handledAt: at, runId, error: verdict.error });
  return { ok: verdict.ok, runId, counts: rec.counts, differences: rec.differences, error: verdict.error };
}

const SYNC_STEPS: ReadonlyArray<SyncStep> = ['areas', 'link', 'create', 'gate_status', 'staff', 'escalate'];
const IMPORT_STEPS: ReadonlyArray<SyncStep> = ['areas', 'import', 'gate_status'];

/**
 * An unexpected throw still closes the run: the step it happened in is
 * `error`, the steps after it `skipped`, both with the reason, and the lock
 * frees at once instead of after ten minutes.
 */
async function guarded(
  ctx: RunContext,
  runId: string,
  req: RunRequest,
  rec: Recorder,
  steps: ReadonlyArray<SyncStep>,
  body: () => Promise<PlanRoom[] | null>,
): Promise<RunReport> {
  let rooms: PlanRoom[] | null = null;
  try {
    rooms = await body();
  } catch (err) {
    const reason = `Kesalahan tak terduga: ${message(err)}`;
    steps
      .filter((s) => rec.counts.steps[s] === undefined)
      .forEach((s, i) => (i === 0 ? rec.fail(s, reason) : rec.skip(s, reason)));
  }
  return finish(ctx, runId, req, rec, rooms);
}

/** §6.2: a sync. */
export function executeSync(ctx: RunContext, runId: string, project: PairedProject, req: RunRequest): Promise<RunReport> {
  const rec = new Recorder();
  return guarded(ctx, runId, req, rec, SYNC_STEPS, async () => {
    const areas = await readAreas(ctx, rec, project.datum_project_code);
    const read = await readRooms(ctx, project.id);
    const rooms = 'rooms' in read ? read.rooms : null;
    const roomsError = 'error' in read ? read.error : null;
    await linkAndCreate(ctx, rec, project, rooms, roomsError, areas);
    await gateStatusStep(ctx, rec, runId, project, rooms, roomsError);
    await staffStep(ctx, rec);
    await escalateStep(ctx, rec, project);
    return rooms;
  });
}

/** §6.3: "Ambil {n} ruangan dari DATUM", only the codes the user confirmed. */
export function executeImport(
  ctx: RunContext,
  runId: string,
  project: PairedProject,
  req: RunRequest,
  confirmedCodes: ReadonlyArray<string>,
): Promise<RunReport> {
  const rec = new Recorder();
  return guarded(ctx, runId, req, rec, IMPORT_STEPS, async () => {
    const areas = await readAreas(ctx, rec, project.datum_project_code);
    const read = await readRooms(ctx, project.id);
    const rooms = 'rooms' in read ? read.rooms : null;
    const roomsError = 'error' in read ? read.error : null;

    if (!areas) {
      rec.skip('import', AREAS_UNREAD);
    } else if (!rooms) {
      rec.fail('import', roomsError ?? 'Ruangan SANO gagal dibaca.');
    } else {
      const plan = planRoomSync(rooms, areas);
      const toImport = planImport(plan, confirmedCodes);
      const skipped: ImportSkip[] = [...toImport.skipped];
      // Areas that now have a SANO room with their code: imported here, or
      // made in SANO meanwhile. Neither is "only in DATUM" any more.
      const imported = new Set<string>();
      const nowInSano = new Set<string>();
      let importError: string | null = null;
      for (const item of toImport.insert) {
        try {
          const roomId = await ctx.store.insertImportedRoom({
            project_id: project.id, room_code: item.room_code, room_name: item.room_name, floor: item.floor,
            area_type: item.area_type, sort_order: item.sort_order, datum_area_id: item.area_id, created_by: req.requestedBy,
          });
          if (roomId === null) {
            nowInSano.add(item.area_id);
            skipped.push({ area_code: item.area_code, reason: importRaced(item.room_code) });
            continue;
          }
          imported.add(item.area_id);
          nowInSano.add(item.area_id);
          rooms.push({
            id: roomId, room_code: item.room_code, room_name: item.room_name, floor: item.floor, area_type: item.area_type,
            sort_order: item.sort_order, active: true, datum_area_id: item.area_id,
          });
        } catch (err) {
          const reason = `Gagal dibuat di SANO: ${message(err)}`;
          importError ??= reason;
          skipped.push({ area_code: item.area_code, reason });
        }
      }
      recordPlanDifferences(rec, plan, nowInSano);
      rec.counts.rooms_imported = imported.size;
      if (skipped.length) rec.differences.import_skipped = skipped;
      if (importError) rec.fail('import', importError);
      else rec.ok('import');
    }
    await gateStatusStep(ctx, rec, runId, project, rooms, roomsError);
    return rooms;
  });
}
```

- [ ] **Step 5: Run the tests and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test datum.test.ts run.test.ts && deno lint && rm -f deno.lock
```

Expected: `ok | 20 passed | 0 failed`, then no lint problem.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t8.txt` with the Write tool, exactly:

```text
feat(datum-sync): a sync run and an import run, step by step

startRun checks the pairing, closes runs left open for ten minutes and
takes the one-open-run lock. executeSync runs areas, link, create
(behind the plausibility gate), gate_status, staff and escalate;
executeImport runs areas, import and gate_status. Each step records ok,
error or skipped with its reason, and a failed step skips only what
needs it. The store is an interface; the Deno tests run it in memory.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add supabase/functions/datum-sync/testing.ts supabase/functions/datum-sync/run.test.ts supabase/functions/datum-sync/run.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t8.txt" -- supabase/functions/datum-sync/testing.ts supabase/functions/datum-sync/run.test.ts supabase/functions/datum-sync/run.ts
```

### F-T9 (Lane F, Task 9): Who may start a run, and how

Spec §6.1, §6.2 step 3, §7, with the owner's change: **sync and import both need `is_office_role()`** (admin, principal, estimator); the spec's admin-and-principal rule for sync is gone (see *Deliberate differences* 1). The webhook path is taken only when `Authorization` equals `Bearer <WEBHOOK_AUTH_SECRET>` (SHA-256 digests compared byte by byte; an unset secret never opens it); its body must be a `datum_sync_requests` INSERT; it answers 202 and runs on in `waitUntil`, marking its request at the end, or at once when the run cannot start. Anything else is the user path: a JWT, the project readable under the caller's RLS, then the office check. The service-role context is built only after a check passed.

**Files:**
- Create: `supabase/functions/datum-sync/handler.test.ts`
- Create: `supabase/functions/datum-sync/handler.ts`

**Depends on:** F-T8.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/datum-sync/handler.test.ts` with exactly this content:

```ts
import { assertEquals } from 'std/assert';
import { FORBIDDEN_IMPORT, FORBIDDEN_SYNC, bearerMatches, createHandler, type CallerCheck, type HandlerDeps } from './handler.ts';
import { PAIRING_MISSING, SYNC_RUNNING } from './run.ts';
import { PROJECT_ID, world } from './testing.ts';

const WEBHOOK_SECRET = 'webhook-secret';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

/** Callers by token, as verifyCaller would find them through getUser() and is_office_role(). */
const CALLERS: Record<string, CallerCheck> = {
  'Bearer jwt-admin': { ok: true, userId: 'u-adm', isOffice: true },
  'Bearer jwt-principal': { ok: true, userId: 'u-pri', isOffice: true },
  'Bearer jwt-estimator': { ok: true, userId: 'u-est', isOffice: true },
  'Bearer jwt-supervisor': { ok: true, userId: 'u-sup', isOffice: false },
};

function setup(over: Partial<HandlerDeps> = {}) {
  const w = world();
  const pending: Promise<unknown>[] = [];
  let contexts = 0;
  const deps: HandlerDeps = {
    configured: true,
    webhookSecret: WEBHOOK_SECRET,
    verifyCaller: (auth) => Promise.resolve(CALLERS[auth] ?? { ok: false, status: 401, code: 'AUTH', error: 'Sesi tidak valid.' }),
    openContext: () => {
      contexts += 1;
      return w.ctx;
    },
    waitUntil: (work) => {
      pending.push(work);
    },
    ...over,
  };
  const handle = createHandler(deps);
  const call = (auth: string | null, body: unknown, method = 'POST') =>
    handle(new Request('https://fn.test/datum-sync', {
      method,
      headers: auth === null ? {} : { Authorization: auth },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }));
  return { w, call, pending, contexts: () => contexts };
}

const webhookBody = { type: 'INSERT', table: 'datum_sync_requests', record: { id: REQUEST_ID, project_id: PROJECT_ID } };

Deno.test('bearerMatches compares exactly "Bearer <secret>" and never opens on an empty secret', async () => {
  assertEquals(await bearerMatches(`Bearer ${WEBHOOK_SECRET}`, WEBHOOK_SECRET), true);
  assertEquals(await bearerMatches(`Bearer ${WEBHOOK_SECRET}x`, WEBHOOK_SECRET), false);
  assertEquals(await bearerMatches(WEBHOOK_SECRET, WEBHOOK_SECRET), false);
  assertEquals(await bearerMatches('Bearer ', ''), false);
});

Deno.test('the webhook secret takes the cron path: 202 at once, the run finishes in waitUntil and marks its request', async () => {
  const s = setup();
  s.w.store.requests.push({ id: REQUEST_ID, handled_at: null, run_id: null, error: null });
  const res = await s.call(`Bearer ${WEBHOOK_SECRET}`, webhookBody);
  assertEquals(res.status, 202);
  const body = await res.json();
  assertEquals(body.code, 'ACCEPTED');
  await Promise.all(s.pending);
  const run = s.w.store.runs.find((r) => r.id === body.runId)!;
  assertEquals([run.source, run.requested_by, run.request_id, run.ok], ['cron', null, REQUEST_ID, true]);
  assertEquals(s.w.store.requests[0], { id: REQUEST_ID, handled_at: '2026-09-27T03:00:00.000Z', run_id: body.runId, error: null });
});

Deno.test('a webhook body that is not a datum_sync_requests INSERT is 400', async () => {
  const s = setup();
  const res = await s.call(`Bearer ${WEBHOOK_SECRET}`, { type: 'UPDATE', table: 'datum_sync_requests', record: webhookBody.record });
  assertEquals(res.status, 400);
  assertEquals(s.contexts(), 0);
});

Deno.test('a wrong or unset webhook secret falls to the JWT path: a webhook body is no sync request (400), a sync request is 401', async () => {
  const wrong = setup();
  assertEquals((await wrong.call('Bearer not-the-secret', webhookBody)).status, 400);
  assertEquals((await wrong.call('Bearer not-the-secret', { projectId: PROJECT_ID })).status, 401);
  const unset = setup({ webhookSecret: '' });
  const res = await unset.call('Bearer ', webhookBody);
  assertEquals(res.status, 400);
  assertEquals((await unset.call('Bearer ', { projectId: PROJECT_ID })).status, 401);
  assertEquals(unset.contexts(), 0);
});

Deno.test('Sinkron DATUM is open to every office role and refused to a supervisor', async () => {
  for (const token of ['Bearer jwt-admin', 'Bearer jwt-principal', 'Bearer jwt-estimator']) {
    const s = setup();
    const res = await s.call(token, { projectId: PROJECT_ID });
    assertEquals(res.status, 200, token);
    const report = await res.json();
    assertEquals(report.ok, true);
    assertEquals(s.w.store.runs[0].source, 'manual');
  }
  const s = setup();
  const res = await s.call('Bearer jwt-supervisor', { projectId: PROJECT_ID });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { ok: false, code: 'FORBIDDEN', error: FORBIDDEN_SYNC });
  assertEquals(s.contexts(), 0);
});

Deno.test('the import is open to every office role, refused to a supervisor, and checks its codes', async () => {
  const s = setup();
  s.w.datum.state.areas.push({ id: 'area-teras', project_id: 'dp-1', area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace', sort_order: 3, tracked: true });
  const ok = await s.call('Bearer jwt-estimator', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['LT2-TERAS'] });
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).counts.rooms_imported, 1);
  assertEquals(s.w.store.runs[0].source, 'import');

  const sup = await s.call('Bearer jwt-supervisor', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['LT2-TERAS'] });
  assertEquals(sup.status, 403);
  assertEquals((await sup.json()).error, FORBIDDEN_IMPORT);

  for (const areaCodes of [[], Array.from({ length: 201 }, (_, i) => `A-${i}`), ['x'.repeat(41)], 'LT2-TERAS']) {
    assertEquals((await s.call('Bearer jwt-admin', { projectId: PROJECT_ID, importDatumOnly: true, areaCodes })).status, 400);
  }
});

Deno.test('missing configuration is 500 CONFIG before anything else', async () => {
  const s = setup({ configured: false });
  const res = await s.call('Bearer jwt-admin', { projectId: PROJECT_ID });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).code, 'CONFIG');
});

Deno.test('an unpaired project answers 409 PAIRING_MISSING and leaves a failed run row', async () => {
  const s = setup();
  s.w.store.projects[0].datum_project_code = null;
  const res = await s.call('Bearer jwt-admin', { projectId: PROJECT_ID });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals([body.code, body.error], ['PAIRING_MISSING', PAIRING_MISSING]);
  assertEquals(s.w.store.runs.map((r) => [r.id, r.ok, r.error]), [[body.runId, false, PAIRING_MISSING]]);
});

Deno.test('a run already open answers 409 SYNC_RUNNING to a sync, an import and the webhook alike', async () => {
  const s = setup();
  s.w.store.runs.push({
    id: 'run-open', project_id: PROJECT_ID, source: 'cron', requested_by: null, request_id: null,
    started_at: '2026-09-27T02:58:00.000Z', finished_at: null, ok: null, counts: { steps: {} }, differences: {}, error: null,
  });
  s.w.store.requests.push({ id: REQUEST_ID, handled_at: null, run_id: null, error: null });
  for (const body of [{ projectId: PROJECT_ID }, { projectId: PROJECT_ID, importDatumOnly: true, areaCodes: ['X-1'] }]) {
    const res = await s.call('Bearer jwt-admin', body);
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { ok: false, code: 'SYNC_RUNNING', error: SYNC_RUNNING });
  }
  const hook = await s.call(`Bearer ${WEBHOOK_SECRET}`, webhookBody);
  assertEquals(hook.status, 409);
  assertEquals(s.w.store.requests[0].error, SYNC_RUNNING);
  assertEquals(s.w.store.requests[0].run_id, null);
});

Deno.test('a bad body, a bad projectId, no header and GET are refused before any work', async () => {
  const s = setup();
  assertEquals((await s.call('Bearer jwt-admin', { projectId: 'nope' })).status, 400);
  assertEquals((await s.call(null, { projectId: PROJECT_ID })).status, 401);
  assertEquals((await s.call('Bearer jwt-admin', null, 'GET')).status, 405);
  assertEquals(s.contexts(), 0);
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test handler.test.ts; rm -f deno.lock
```

Expected: `error: Module not found "file:///.../supabase/functions/datum-sync/handler.ts"`.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/datum-sync/handler.ts` with exactly this content:

```ts
// SANO - datum-sync: who may start a run, and how.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6.1-§6.3, §7.
// Plan: docs/superpowers/plans/2026-09-27-datum-sync.md (Lane F).
//
// Two ways in, both checked here before any service-role work:
//   * The Database Webhook on datum_sync_requests INSERT (hourly, pg_cron):
//     Authorization is exactly `Bearer <WEBHOOK_AUTH_SECRET>`, compared as
//     SHA-256 digests. An unset secret never opens this path. Answers 202
//     and runs on in waitUntil, so a webhook timeout cannot cut a run short.
//   * A signed-in user (the Rooms tab): the caller's JWT, the project read
//     through the caller's own RLS, and is_office_role() - admin, principal
//     or estimator - for a sync and for an import alike. (The spec's first
//     version limited "Sinkron DATUM" to admin and principal; the owner
//     widened it to every office role on 2026-09-27, calibration item 9.)
// The function is deployed with --no-verify-jwt because the webhook presents
// the shared secret, not a JWT; this file is the only gate.

import {
  PAIRING_MISSING,
  SYNC_RUNNING,
  executeImport,
  executeSync,
  startRun,
  type RunContext,
  type RunRequest,
} from './run.ts';

export type CallerCheck =
  | { ok: true; userId: string; isOffice: boolean }
  | { ok: false; status: number; code: string; error: string };

export interface HandlerDeps {
  /** false when any Supabase or DATUM variable is missing: every call is 500 CONFIG. */
  configured: boolean;
  /** WEBHOOK_AUTH_SECRET; empty means the webhook path is closed. */
  webhookSecret: string;
  /** The caller's JWT, their RLS read of the project, and is_office_role(). */
  verifyCaller(authHeader: string, projectId: string): Promise<CallerCheck>;
  /** Builds the service-role store and the DATUM client; called only after a check passed. */
  openContext(): RunContext;
  waitUntil(work: Promise<unknown>): void;
}

export const FORBIDDEN_SYNC = 'Hanya peran kantor (admin, prinsipal, estimator) yang dapat menyinkronkan DATUM.';
export const FORBIDDEN_IMPORT = 'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.';
export const MAX_IMPORT_CODES = 200;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } });
}

const refuse = (status: number, code: string, error: string) => json({ ok: false, code, error }, status);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Constant time: both sides SHA-256 digested, then compared byte by byte. */
export async function bearerMatches(header: string, secret: string): Promise<boolean> {
  if (!secret) return false;
  const enc = new TextEncoder();
  const [given, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(header)),
    crypto.subtle.digest('SHA-256', enc.encode(`Bearer ${secret}`)),
  ]);
  const a = new Uint8Array(given);
  const b = new Uint8Array(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function parseCodes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_IMPORT_CODES) return null;
  if (!raw.every((c) => typeof c === 'string' && c.length >= 1 && c.length <= 40)) return null;
  return raw as string[];
}

async function fromWebhook(deps: HandlerDeps, body: Record<string, unknown>): Promise<Response> {
  const record = body.record as { id?: unknown; project_id?: unknown } | undefined;
  if (body.type !== 'INSERT' || body.table !== 'datum_sync_requests' || !isUuid(record?.id) || !isUuid(record?.project_id)) {
    return refuse(400, 'BAD_REQUEST', 'Bukan kiriman Database Webhook untuk datum_sync_requests.');
  }
  const ctx = deps.openContext();
  const req: RunRequest = { projectId: record.project_id, source: 'cron', requestedBy: null, requestId: record.id };
  const handledAt = () => ctx.now().toISOString();
  const started = await startRun(ctx, req);
  if (started.kind === 'not_found') {
    await ctx.store.markRequest(record.id, { handledAt: handledAt(), runId: null, error: 'Proyek tidak ditemukan.' });
    return refuse(404, 'NOT_FOUND', 'Proyek tidak ditemukan.');
  }
  if (started.kind === 'pairing_missing') {
    await ctx.store.markRequest(record.id, { handledAt: handledAt(), runId: started.runId, error: PAIRING_MISSING });
    return json({ ok: false, code: 'PAIRING_MISSING', error: PAIRING_MISSING, runId: started.runId }, 409);
  }
  if (started.kind === 'running') {
    await ctx.store.markRequest(record.id, { handledAt: handledAt(), runId: null, error: SYNC_RUNNING });
    return refuse(409, 'SYNC_RUNNING', SYNC_RUNNING);
  }
  deps.waitUntil(
    executeSync(ctx, started.runId, started.project, req).catch((err) => {
      console.error(`datum-sync: run ${started.runId} failed after 202:`, err);
    }),
  );
  return json({ ok: true, code: 'ACCEPTED', runId: started.runId }, 202);
}

async function fromUser(deps: HandlerDeps, authHeader: string, body: Record<string, unknown>): Promise<Response> {
  if (!authHeader) return refuse(401, 'AUTH', 'Tidak ada otorisasi.');
  if (!isUuid(body.projectId)) return refuse(400, 'BAD_REQUEST', 'projectId tidak valid.');
  const importing = body.importDatumOnly === true;
  let codes: string[] = [];
  if (importing) {
    const parsed = parseCodes(body.areaCodes);
    if (!parsed) return refuse(400, 'BAD_REQUEST', `areaCodes harus 1-${MAX_IMPORT_CODES} kode DATUM.`);
    codes = parsed;
  }

  const caller = await deps.verifyCaller(authHeader, body.projectId);
  if (!caller.ok) return refuse(caller.status, caller.code, caller.error);
  if (!caller.isOffice) return refuse(403, 'FORBIDDEN', importing ? FORBIDDEN_IMPORT : FORBIDDEN_SYNC);

  const ctx = deps.openContext();
  const req: RunRequest = {
    projectId: body.projectId,
    source: importing ? 'import' : 'manual',
    requestedBy: caller.userId,
    requestId: null,
  };
  const started = await startRun(ctx, req);
  if (started.kind === 'not_found') return refuse(404, 'NOT_FOUND', 'Proyek tidak ditemukan.');
  if (started.kind === 'pairing_missing') {
    return json({ ok: false, code: 'PAIRING_MISSING', error: PAIRING_MISSING, runId: started.runId }, 409);
  }
  if (started.kind === 'running') return refuse(409, 'SYNC_RUNNING', SYNC_RUNNING);

  const report = importing
    ? await executeImport(ctx, started.runId, started.project, req, codes)
    : await executeSync(ctx, started.runId, started.project, req);
  return json(report, 200);
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return refuse(405, 'METHOD', 'Gunakan POST.');
    if (!deps.configured) return refuse(500, 'CONFIG', 'Konfigurasi sinkron DATUM di server tidak lengkap.');

    const authHeader = req.headers.get('Authorization') ?? '';
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Record<string, unknown>;
    } catch {
      return refuse(400, 'BAD_REQUEST', 'Body harus objek JSON.');
    }

    try {
      if (await bearerMatches(authHeader, deps.webhookSecret)) return await fromWebhook(deps, body);
      return await fromUser(deps, authHeader, body);
    } catch (err) {
      console.error('datum-sync: unexpected error', err);
      const message = err instanceof Error ? err.message : String(err);
      return refuse(500, 'UNEXPECTED', `Kesalahan tak terduga: ${message.slice(0, 280)}`);
    }
  };
}
```

- [ ] **Step 4: Run every Deno test and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync/supabase/functions/datum-sync" && deno test && deno lint && rm -f deno.lock
```

Expected: `ok | 30 passed | 0 failed`, then no lint problem.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t9.txt` with the Write tool, exactly:

```text
feat(datum-sync): the webhook path and the office-role button path

The Database Webhook presents WEBHOOK_AUTH_SECRET (constant-time, never
open when unset) and gets 202 while the run continues in waitUntil. A
signed-in caller needs the project under their own RLS and
is_office_role() for a sync or an import: admin, principal or estimator,
the owner's 2026-09-27 decision. Refusals are named codes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add supabase/functions/datum-sync/handler.test.ts supabase/functions/datum-sync/handler.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t9.txt" -- supabase/functions/datum-sync/handler.test.ts supabase/functions/datum-sync/handler.ts
```

### F-T10 (Lane F, Task 10): The store over the service-role client, and the wiring

Spec §6 (`index.ts`, `deno.json`, secrets, `--no-verify-jwt`), §6.2 (the columns each step writes). `makeSupabaseStore` is the only file that talks to SANO's database: it writes exactly the columns spec §6 names (pinned below as text, since CI never runs Deno), sets a staff link or a card id only where it is still NULL, and reads profiles by `id, full_name, datum_staff_id` only. `index.ts` wires the environment, `verifyCaller` (the `site-event-analyze/index.ts:202-237` shape: `getUser()` through a caller client, the project through the caller's RLS, `is_office_role()`), `EdgeRuntime.waitUntil` and `Deno.serve`.

**Files:**
- Modify: `tools/__tests__/datumSyncPlanTwin.test.ts` (append)
- Create: `supabase/functions/datum-sync/store.ts`
- Create: `supabase/functions/datum-sync/index.ts`

**Depends on:** F-T9.

- [ ] **Step 1: Append the failing source checks to the twin suite**

Append to the end of `tools/__tests__/datumSyncPlanTwin.test.ts` (keep the blank line that opens the block):

```ts


/**
 * The function's own files, read as text: the only check CI makes on them.
 * The function never reads profiles.active (live SANO has no such column)
 * and never writes a column spec §6 does not name.
 */
describe('the function source', () => {
  const files = () => fs.readdirSync(FUNCTION_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testing.ts');

  it('never mentions profiles.active: live SANO profiles have no active column', () => {
    for (const f of files()) {
      const src = readFn(f);
      expect(src).not.toMatch(/profiles\.active\b/);
      expect(src).not.toMatch(/from\('profiles'\)[^;]*\bactive\b/);
    }
    const store = readFn('store.ts');
    expect(store).toContain(".from('profiles').select('id, full_name, datum_staff_id')");
  });

  it('writes only the columns spec §6 names', () => {
    const store = readFn('store.ts');
    const updates = [...store.matchAll(/\.from\('(\w+)'\)\s*\.update\(\{([^}]*)\}/g)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]);
    expect(updates).toEqual([
      ['datum_sync_runs', "finished_at: nowIso, ok: false, error: RUN_INTERRUPTED"],
      ['datum_sync_runs', 'finished_at: fields.finishedAt, ok: fields.ok, counts: fields.counts, differences: fields.differences, error: fields.error'],
      ['datum_sync_requests', 'handled_at: fields.handledAt, run_id: fields.runId, error: fields.error'],
      ['rooms', 'datum_area_id: areaId'],
      ['profiles', 'datum_staff_id: staffId'],
      ['site_events', 'datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso'],
    ]);
    expect(store).not.toMatch(/\.delete\(/);
  });

  it('holds no URL or secret of its own', () => {
    for (const f of files()) {
      const src = readFn(f);
      expect(src).not.toMatch(/https?:\/\/(?!sano-app\.vercel\.app)/);
      expect(src).not.toMatch(/supabase\.co/);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanTwin.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 2 failed, 4 passed, 6 total`: the two new tests that read `store.ts` fail with `ENOENT: no such file or directory, open '.../supabase/functions/datum-sync/store.ts'`; the URL check passes already over the files that exist.

- [ ] **Step 3: Write the store**

Create `supabase/functions/datum-sync/store.ts` with exactly this content:

```ts
// SANO - datum-sync: SyncStore over the service-role client.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §4, §6.
// The only file in this function that talks to SANO's database. It writes
// exactly these columns, and tools/__tests__/datumSyncPlanTwin.test.ts (jest,
// which CI runs) pins the list:
//   datum_sync_runs    finished_at, ok, counts, differences, error (+ the insert)
//   datum_sync_requests handled_at, run_id, error
//   rooms              datum_area_id (+ the import's insert)
//   profiles           datum_staff_id, only where it is NULL
//   room_datum_gate_status (upsert)
//   site_events        datum_card_id, datum_card_url, datum_escalated_at, only where the card id is NULL
// Migration 107's guards refuse every one of these writes from app roles; the
// service role passes them. profiles has no `active` column on the live
// project, so none is read.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanProfile, PlanRoom, SanoGateWord } from './plan.ts';
import { RUN_INTERRUPTED, type EscalationDue, type ProjectRow, type SyncStore } from './run.ts';

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const DUE_SELECT =
  'id, title, summary, due_date, confirmed_at, room:rooms(room_code, room_name, datum_area_id), reporter:profiles!site_events_reporter_id_fkey(full_name, datum_staff_id), confirmer:profiles!site_events_confirmed_by_fkey(full_name, datum_staff_id), owner:profiles!site_events_owner_id_fkey(full_name)';

type Person = { full_name: string | null; datum_staff_id?: string | null } | null;
type DueRow = {
  id: string;
  title: string;
  summary: string | null;
  due_date: string;
  confirmed_at: string;
  room: { room_code: string; room_name: string; datum_area_id: string | null } | null;
  reporter: Person;
  confirmer: Person;
  owner: Person;
};

export function makeSupabaseStore(admin: SupabaseClient): SyncStore {
  return {
    async getProject(projectId) {
      const { data, error } = await admin.from('projects').select('id, code, datum_project_code').eq('id', projectId).maybeSingle();
      check('projects', error);
      return (data as ProjectRow | null) ?? null;
    },

    async closeStaleRuns(projectId, olderThanIso, nowIso) {
      const { error } = await admin.from('datum_sync_runs')
        .update({ finished_at: nowIso, ok: false, error: RUN_INTERRUPTED })
        .eq('project_id', projectId)
        .is('finished_at', null)
        .lt('started_at', olderThanIso);
      check('datum_sync_runs', error);
    },

    async openRun(req) {
      const { data, error } = await admin.from('datum_sync_runs')
        .insert({ project_id: req.projectId, source: req.source, requested_by: req.requestedBy, request_id: req.requestId })
        .select('id')
        .single();
      if (error?.code === '23505') return { running: true };
      check('datum_sync_runs', error);
      return { runId: (data as { id: string }).id };
    },

    async insertFinishedRun(req, fields) {
      const { data, error } = await admin.from('datum_sync_runs')
        .insert({
          project_id: req.projectId, source: req.source, requested_by: req.requestedBy, request_id: req.requestId,
          finished_at: fields.finishedAt, ok: false, error: fields.error,
        })
        .select('id')
        .single();
      check('datum_sync_runs', error);
      return (data as { id: string }).id;
    },

    async finishRun(runId, fields) {
      const { error } = await admin.from('datum_sync_runs')
        .update({ finished_at: fields.finishedAt, ok: fields.ok, counts: fields.counts, differences: fields.differences, error: fields.error })
        .eq('id', runId);
      check('datum_sync_runs', error);
    },

    async markRequest(requestId, fields) {
      const { error } = await admin.from('datum_sync_requests')
        .update({ handled_at: fields.handledAt, run_id: fields.runId, error: fields.error })
        .eq('id', requestId);
      check('datum_sync_requests', error);
    },

    async listRooms(projectId) {
      const { data, error } = await admin.from('rooms')
        .select('id, room_code, room_name, floor, area_type, sort_order, active, datum_area_id')
        .eq('project_id', projectId);
      check('rooms', error);
      return (data ?? []) as PlanRoom[];
    },

    async setRoomLink(roomId, areaId) {
      const { error } = await admin.from('rooms')
        .update({ datum_area_id: areaId })
        .eq('id', roomId);
      check('rooms', error);
    },

    async insertImportedRoom(row) {
      const { data, error } = await admin.from('rooms').insert(row).select('id').single();
      if (error?.code === '23505') return null;
      check('rooms', error);
      return (data as { id: string }).id;
    },

    async listGateRefs() {
      const { data, error } = await admin.from('gate_refs').select('code, name_id, description');
      check('gate_refs', error);
      return (data ?? []) as SanoGateWord[];
    },

    async upsertGateStatus(rows) {
      const { error } = await admin.from('room_datum_gate_status').upsert(rows, { onConflict: 'room_id,gate_code' });
      check('room_datum_gate_status', error);
    },

    async listProfiles() {
      const { data, error } = await admin.from('profiles').select('id, full_name, datum_staff_id');
      check('profiles', error);
      return (data ?? []) as PlanProfile[];
    },

    async setProfileStaffLink(profileId, staffId) {
      const { error } = await admin.from('profiles')
        .update({ datum_staff_id: staffId })
        .eq('id', profileId)
        .is('datum_staff_id', null);
      check('profiles', error);
    },

    async listEscalationDue(projectId, limit) {
      const { data, error } = await admin.from('site_events')
        .select(DUE_SELECT)
        .eq('project_id', projectId)
        .eq('status', 'open')
        .eq('event_type', 'butuh_keputusan')
        .not('confirmed_at', 'is', null)
        .is('datum_card_id', null)
        .order('confirmed_at', { ascending: true })
        .limit(limit);
      check('site_events', error);
      return ((data ?? []) as unknown as DueRow[]).map((e): EscalationDue => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        due_date: e.due_date,
        confirmed_at: e.confirmed_at,
        room_code: e.room?.room_code ?? '',
        room_name: e.room?.room_name ?? '',
        room_datum_area_id: e.room?.datum_area_id ?? null,
        reporter_name: e.reporter?.full_name ?? null,
        reporter_staff_id: e.reporter?.datum_staff_id ?? null,
        confirmer_name: e.confirmer?.full_name ?? null,
        confirmer_staff_id: e.confirmer?.datum_staff_id ?? null,
        owner_name: e.owner?.full_name ?? null,
      }));
    },

    async countEscalationDue(projectId) {
      const { count, error } = await admin.from('site_events')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'open')
        .eq('event_type', 'butuh_keputusan')
        .not('confirmed_at', 'is', null)
        .is('datum_card_id', null);
      check('site_events', error);
      return count ?? 0;
    },

    async setEventCard(eventId, cardId, cardUrl, escalatedAtIso) {
      const { error } = await admin.from('site_events')
        .update({ datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso })
        .eq('id', eventId)
        .is('datum_card_id', null);
      check('site_events', error);
    },
  };
}
```

- [ ] **Step 4: Write the entry point**

Create `supabase/functions/datum-sync/index.ts` with exactly this content:

```ts
// SANO - datum-sync edge function.
//
// Spec: docs/superpowers/specs/2026-09-27-datum-sync-design.md §6-§7.
// Plan: docs/superpowers/plans/2026-09-27-datum-sync.md (Lane F).
//
// POST { projectId }                                   "Sinkron DATUM" (any office role)
// POST { projectId, importDatumOnly: true, areaCodes } "Ambil {n} ruangan dari DATUM" (any office role)
// POST <Database Webhook body for datum_sync_requests>  the hourly pg_cron request
//
// Deploy with --no-verify-jwt: the webhook presents WEBHOOK_AUTH_SECRET, not a
// JWT, so the gateway's own check would refuse it. handler.ts checks both
// paths before any service-role work.
//
// Secrets (supabase secrets set): DATUM_API_BASE_URL (DATUM's origin),
// DATUM_SANO_SECRET (the same value as DATUM's SANO_INTEGRATION_SECRET),
// WEBHOOK_AUTH_SECRET (already set for send-push-notification). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY come from the runtime.
//
// Deno tests: `cd supabase/functions/datum-sync && deno test`. CI does not run
// them; they are a release step.

import { createClient } from '@supabase/supabase-js';
import { createHandler, type CallerCheck } from './handler.ts';
import { makeDatumApi } from './datum.ts';
import { makeSupabaseStore } from './store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const DATUM_API_BASE_URL = Deno.env.get('DATUM_API_BASE_URL') ?? '';
const DATUM_SANO_SECRET = Deno.env.get('DATUM_SANO_SECRET') ?? '';
const WEBHOOK_AUTH_SECRET = Deno.env.get('WEBHOOK_AUTH_SECRET') ?? '';

async function verifyCaller(authHeader: string, projectId: string): Promise<CallerCheck> {
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: authError } = await caller.auth.getUser();
  if (authError || !userData?.user) return { ok: false, status: 401, code: 'AUTH', error: 'Sesi tidak valid.' };
  const { data: visible } = await caller.from('projects').select('id').eq('id', projectId).maybeSingle();
  if (!visible) {
    return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Proyek tidak ditemukan atau Anda tidak punya akses.' };
  }
  const office = await caller.rpc('is_office_role');
  return { ok: true, userId: userData.user.id, isOffice: office.data === true };
}

type EdgeRuntimeGlobal = { EdgeRuntime?: { waitUntil(work: Promise<unknown>): void } };

export const handle = createHandler({
  configured: !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && DATUM_API_BASE_URL && DATUM_SANO_SECRET),
  webhookSecret: WEBHOOK_AUTH_SECRET,
  verifyCaller,
  openContext: () => ({
    store: makeSupabaseStore(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })),
    datum: makeDatumApi({ baseUrl: DATUM_API_BASE_URL, secret: DATUM_SANO_SECRET, fetch }),
    now: () => new Date(),
  }),
  waitUntil: (work) => {
    const runtime = (globalThis as unknown as EdgeRuntimeGlobal).EdgeRuntime;
    if (runtime) runtime.waitUntil(work);
  },
});

if (import.meta.main) {
  Deno.serve(handle);
}
```

- [ ] **Step 5: Run the twin suite, every Deno test, the Deno type check of the entry point and the linter**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSyncPlanTwin.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && cd supabase/functions/datum-sync && deno check index.ts && deno test && deno lint && rm -f deno.lock
```

Expected: `Tests: 6 passed, 6 total`, `Check index.ts` (the first run downloads `jsr:@supabase/supabase-js@2.105.1` if it is not cached), `ok | 30 passed | 0 failed`, no lint problem.

- [ ] **Step 6: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t10.txt` with the Write tool, exactly:

```text
feat(datum-sync): the service-role store and the function entry point

makeSupabaseStore writes only the columns the spec names, sets staff
links and card ids only where still NULL, and reads profiles by id,
full_name and datum_staff_id (no active column exists live). index.ts
wires the secrets, the caller check, EdgeRuntime.waitUntil and
Deno.serve; deploy with --no-verify-jwt.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/__tests__/datumSyncPlanTwin.test.ts supabase/functions/datum-sync/store.ts supabase/functions/datum-sync/index.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/f-t10.txt" -- tools/__tests__/datumSyncPlanTwin.test.ts supabase/functions/datum-sync/store.ts supabase/functions/datum-sync/index.ts
```

---

## Lane U: SANO app

All seven tasks run in the SANO worktree. Tasks 3 and 4 wait for Lane F Task 1 (the shared types); nothing else here crosses a lane.

### U-T1 (Lane U, Task 1): DATUM's thirteen room types, and DATUM's gate word in the comments

Spec §4.2 (types), §3 ("no code carries a gate name"). `AreaType`, `AREA_TYPES` and `AREA_TYPE_LABELS` gain DATUM's four zones with DATUM's own labels (`AreaSetup.tsx:32-35`): "Fasad", "Teras / Balkon", "Hall / Lobi", "Area luar lain". `RoomForm.tsx:46` and the paste parser (`tools/rooms.ts:253-266`) read that list and need no edit. `GateChipRow.tsx:20-28`'s comment and `GateChipRow.test.tsx`'s fixture quote 101's old words; they take DATUM's (the test reads its labels through `gateChipLabel`, so only data changes). `migration101.test.ts` is Lane M's.

**Files:**
- Modify: `tools/types.ts` (the `AreaType` block)
- Modify: `tools/constants.ts` (the area-type block)
- Modify: `workflows/screens/siteEvent/GateChipRow.tsx` (the component comment)
- Modify: `workflows/__tests__/GateChipRow.test.tsx` (fixture data)
- Create: `office/screens/rooms/__tests__/RoomForm.types.test.tsx`

**Depends on:** nothing. **M-T1 waits for this commit.**

- [ ] **Step 1: Write the failing test**

Create `office/screens/rooms/__tests__/RoomForm.types.test.tsx` with exactly this content:

```tsx
// office/screens/rooms/__tests__/RoomForm.types.test.tsx
//
// DATUM sync spec 2026-09-27 §4.2: SANO room types are DATUM's thirteen,
// with DATUM's own labels for the four zones. The form reads AREA_TYPES, so
// the picker offers exactly that list, in that order.
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-native-picker/picker', () => {
  const ReactLocal = require('react');
  const { Text, View } = require('react-native');
  const Picker = (props: { children: React.ReactNode }) => ReactLocal.createElement(View, { testID: 'picker' }, props.children);
  Picker.Item = (props: { label: string; value: string }) =>
    ReactLocal.createElement(Text, { testID: `type-${props.value}` }, props.label);
  return { Picker };
});

import RoomForm from '../RoomForm';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

describe('RoomForm type picker', () => {
  it("offers DATUM's thirteen types, the four zones with DATUM's labels", () => {
    const utils = render(<RoomForm saving={false} onCancel={jest.fn()} onSubmit={jest.fn()} />);
    const items = utils.getAllByTestId(/^type-/);
    expect(items.map((i) => i.props.testID.replace('type-', ''))).toEqual([
      'bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general',
      'facade', 'terrace', 'hall', 'exterior',
    ]);
    expect(utils.getByTestId('type-facade').props.children).toBe('Fasad');
    expect(utils.getByTestId('type-terrace').props.children).toBe('Teras / Balkon');
    expect(utils.getByTestId('type-hall').props.children).toBe('Hall / Lobi');
    expect(utils.getByTestId('type-exterior').props.children).toBe('Area luar lain');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/RoomForm.types.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL`: `expect(received).toEqual(expected)`, the received list stops at `general` (nine types).

- [ ] **Step 3: Widen `AreaType`**

In `tools/types.ts`, replace

```ts
/**
 * DATUM's nine area types, verbatim
 * (DATUM packages/core/src/areas/mutations.ts:7-16). Do not add a tenth
 * without adding it in DATUM first - the release-2 link upserts on this value.
 */
export type AreaType =
  | 'bathroom' | 'kitchen' | 'bedroom' | 'living' | 'dining'
  | 'garden' | 'circulation' | 'utility' | 'general';
```

with

```ts
/**
 * DATUM's thirteen area types, verbatim (DATUM
 * packages/core/src/areas/extract.ts AREA_TYPES): the nine room types plus the
 * four zones DATUM added (facade, terrace, hall, exterior). Migration 107
 * widens rooms_area_type_check to exactly these. Do not add another without
 * adding it in DATUM first - the DATUM sync creates areas with this value.
 */
export type AreaType =
  | 'bathroom' | 'kitchen' | 'bedroom' | 'living' | 'dining'
  | 'garden' | 'circulation' | 'utility' | 'general'
  | 'facade' | 'terrace' | 'hall' | 'exterior';
```

- [ ] **Step 4: Widen the list and the labels**

In `tools/constants.ts`, replace

```ts
// ── Area types (096) - DATUM's nine values, Indonesian labels ────────────────
export const AREA_TYPES: ReadonlyArray<{ value: AreaType; label: string }> = [
  { value: 'bathroom',    label: 'Kamar mandi' },
  { value: 'kitchen',     label: 'Dapur' },
  { value: 'bedroom',     label: 'Kamar tidur' },
  { value: 'living',      label: 'Ruang keluarga' },
  { value: 'dining',      label: 'Ruang makan' },
  { value: 'garden',      label: 'Taman' },
  { value: 'circulation', label: 'Sirkulasi' },
  { value: 'utility',     label: 'Utilitas' },
  { value: 'general',     label: 'Umum' },
];

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  bathroom:    'Kamar mandi',
  kitchen:     'Dapur',
  bedroom:     'Kamar tidur',
  living:      'Ruang keluarga',
  dining:      'Ruang makan',
  garden:      'Taman',
  circulation: 'Sirkulasi',
  utility:     'Utilitas',
  general:     'Umum',
};
```

with

```ts
// ── Area types (096, widened by 107) - DATUM's thirteen values ──────────────
// The nine room types keep SANO's labels; the four zones use DATUM's own
// (DATUM apps/web/components/area-setup/AreaSetup.tsx). migration107.test.ts
// compares this list with the CHECK 107 installs.
export const AREA_TYPES: ReadonlyArray<{ value: AreaType; label: string }> = [
  { value: 'bathroom',    label: 'Kamar mandi' },
  { value: 'kitchen',     label: 'Dapur' },
  { value: 'bedroom',     label: 'Kamar tidur' },
  { value: 'living',      label: 'Ruang keluarga' },
  { value: 'dining',      label: 'Ruang makan' },
  { value: 'garden',      label: 'Taman' },
  { value: 'circulation', label: 'Sirkulasi' },
  { value: 'utility',     label: 'Utilitas' },
  { value: 'general',     label: 'Umum' },
  { value: 'facade',      label: 'Fasad' },
  { value: 'terrace',     label: 'Teras / Balkon' },
  { value: 'hall',        label: 'Hall / Lobi' },
  { value: 'exterior',    label: 'Area luar lain' },
];

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  bathroom:    'Kamar mandi',
  kitchen:     'Dapur',
  bedroom:     'Kamar tidur',
  living:      'Ruang keluarga',
  dining:      'Ruang makan',
  garden:      'Taman',
  circulation: 'Sirkulasi',
  utility:     'Utilitas',
  general:     'Umum',
  facade:      'Fasad',
  terrace:     'Teras / Balkon',
  hall:        'Hall / Lobi',
  exterior:    'Area luar lain',
};
```

- [ ] **Step 5: Take DATUM's word in the gate list comment**

In `workflows/screens/siteEvent/GateChipRow.tsx`, replace

```tsx
 * (48pt) for a title plus a two-line description, because each gate now names
 * two trades ("Waterproofing + kamar mandi") and a bare chip label no longer
 * carries enough meaning on its own.
```

with

```tsx
 * (48pt) for a title plus a two-line description, because a bare chip label
 * ("Pekerjaan Basah", DATUM's word since migration 107) does not carry enough
 * meaning on its own.
```

- [ ] **Step 6: Take DATUM's words in the gate list fixture**

Two edits in the same file.

In `workflows/__tests__/GateChipRow.test.tsx`, replace

```tsx
  name_id: 'Waterproofing + kamar mandi',
  short_label: 'Waterproofing + kamar mandi',
  description: 'Lapisan waterproofing pada kamar mandi.',
```

with

```tsx
  name_id: 'Pekerjaan Basah / Waterproofing',
  short_label: 'Pekerjaan Basah',
  description: 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.',
```

In `workflows/__tests__/GateChipRow.test.tsx`, replace

```tsx
const gateA = gate({ code: 'A', short_label: 'MEP rough-in + persiapan sipil', description: 'Deskripsi gerbang A.', sort_order: 10 });
const gateB = gate({ code: 'B', short_label: 'Waterproofing + kamar mandi', description: 'Deskripsi gerbang B.', sort_order: 20 });
const gateCInactive = gate({ code: 'C', short_label: 'Plafon + benangan', description: 'Deskripsi gerbang C.', sort_order: 30, active: false });
```

with

```tsx
const gateA = gate({ code: 'A', short_label: 'MEP Rough-in', description: 'Deskripsi gerbang A.', sort_order: 10 });
const gateB = gate({ code: 'B', short_label: 'Pekerjaan Basah', description: 'Deskripsi gerbang B.', sort_order: 20 });
const gateCInactive = gate({ code: 'C', short_label: 'Plafon', description: 'Deskripsi gerbang C.', sort_order: 30, active: false });
```

- [ ] **Step 7: Run the tests and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/RoomForm.types.test.tsx workflows/__tests__/GateChipRow tools/__tests__/rooms --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 3 passed, 3 total`, no tsc output.

- [ ] **Step 8: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t1.txt` with the Write tool, exactly:

```text
feat(rooms): DATUM's thirteen room types, and DATUM's gate word in comments

AreaType, AREA_TYPES and AREA_TYPE_LABELS gain facade, terrace, hall and
exterior with DATUM's own labels; migration 107 widens the CHECK to the
same thirteen. GateChipRow's comment and test fixture quote DATUM's gate
words instead of 101's.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/types.ts tools/constants.ts workflows/screens/siteEvent/GateChipRow.tsx workflows/__tests__/GateChipRow.test.tsx office/screens/rooms/__tests__/RoomForm.types.test.tsx && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t1.txt" -- tools/types.ts tools/constants.ts workflows/screens/siteEvent/GateChipRow.tsx workflows/__tests__/GateChipRow.test.tsx office/screens/rooms/__tests__/RoomForm.types.test.tsx
```

### U-T2 (Lane U, Task 2): The board's DATUM read and the chip state

Spec §8.2, truth-contract rules 1-2. `listDatumGateStatus` reads the pairing, the finish time of the newest run whose `counts->steps->>gate_status` is `ok`, the project's room links (`rooms.id, datum_area_id`: `RoomBoardRow` does not carry the link) and the cache; any failure or throw is `{ error }`. `datumChipsForRoom` decides the state: hidden (unpaired, or a failed read the board states once), never (unlinked room, or no gate read ever succeeded), none (the last good gate read covered the room's current area, recorded by the function as `counts.gate_area_ids`, and DATUM holds no row for it; a room linked after that read is "never", not "none"), or chips in gate order with DATUM's six fixed labels, the read time (`HH.mm` today in WIB, `27 Sep 10.00` otherwise), `old` past 24 hours and DATUM's own `stale`. Nothing derives a readiness.

**Files:**
- Create: `tools/datumGateStatus.ts`
- Create: `tools/__tests__/datumGateStatus.test.ts`

**Depends on:** nothing.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumGateStatus.test.ts` with exactly this content:

```ts
/**
 * DATUM readiness on Papan Ruangan (spec 2026-09-27 §8.2): DATUM's own word,
 * marked old when old, and never "no news" where SANO simply does not know.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import {
  DATUM_READINESS_LABELS,
  datumAsOfLabel,
  datumChipsForRoom,
  listDatumGateStatus,
  type DatumGateRow,
  type DatumGateStatusResult,
} from '../datumGateStatus';

const mocked = supabase as unknown as { from: jest.Mock };
const calls: string[] = [];

/** Records every builder call and resolves to `result` whichever method is awaited last. */
function chain(table: string, result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'not', 'order', 'limit', 'maybeSingle']) {
    c[name] = (...args: unknown[]) => {
      calls.push(`${table}.${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
      return c;
    };
  }
  c.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

function tables(results: Record<string, { data: unknown; error: unknown }>) {
  mocked.from.mockImplementation((table: string) => chain(table, results[table] ?? { data: null, error: null }));
}

const NOW = '2026-09-27T03:00:00.000Z'; // 10.00 WIB
const row = (over: Partial<DatumGateRow> = {}): DatumGateRow => ({
  room_id: 'r1', gate_code: 'A', datum_area_id: 'a1', status: 'passed', datum_stale: false, synced_at: '2026-09-27T02:00:00.000Z', ...over,
});
const paired = (over: Partial<Extract<DatumGateStatusResult, { paired: true }>> = {}): DatumGateStatusResult => ({
  paired: true, lastGateReadAt: '2026-09-27T02:00:00.000Z', readAreaIds: ['a1'], roomLinks: { r1: 'a1' }, rows: [row()], ...over,
});

beforeEach(() => {
  calls.length = 0;
  mocked.from.mockReset();
});

describe('listDatumGateStatus', () => {
  it('says unpaired, and reads nothing else, when the project has no DATUM code', async () => {
    tables({ projects: { data: { datum_project_code: null }, error: null } });
    expect(await listDatumGateStatus('p1')).toEqual({ paired: false });
    expect(mocked.from).toHaveBeenCalledTimes(1);
  });

  it('reads the last good gate read, the room links and the cache for a paired project', async () => {
    tables({
      projects: { data: { datum_project_code: 'K2-7' }, error: null },
      datum_sync_runs: { data: { finished_at: '2026-09-27T02:00:00.000Z', gate_area_ids: ['a1'] }, error: null },
      rooms: { data: [{ id: 'r1', datum_area_id: 'a1' }, { id: 'r2', datum_area_id: null }], error: null },
      room_datum_gate_status: { data: [row()], error: null },
    });
    expect(await listDatumGateStatus('p1')).toEqual({
      paired: true, lastGateReadAt: '2026-09-27T02:00:00.000Z', readAreaIds: ['a1'], roomLinks: { r1: 'a1', r2: null }, rows: [row()],
    });
    expect(calls).toContain('datum_sync_runs.select:"finished_at, gate_area_ids:counts->gate_area_ids"');
    expect(calls).toContain('datum_sync_runs.eq:"counts->steps->>gate_status":"ok"');
    expect(calls).toContain('datum_sync_runs.order:"finished_at":{"ascending":false}');
    expect(calls).toContain('room_datum_gate_status.eq:"project_id":"p1"');
  });

  it('returns the error, never an empty board, when any read fails or throws', async () => {
    tables({ projects: { data: null, error: { message: 'offline' } } });
    expect(await listDatumGateStatus('p1')).toEqual({ error: 'offline' });
    tables({
      projects: { data: { datum_project_code: 'K2-7' }, error: null },
      room_datum_gate_status: { data: null, error: { message: 'relation does not exist' } },
    });
    expect(await listDatumGateStatus('p1')).toEqual({ error: 'relation does not exist' });
    mocked.from.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await listDatumGateStatus('p1')).toEqual({ error: 'boom' });
  });
});

describe('datumChipsForRoom', () => {
  it('shows nothing while loading, for an unpaired project, and on a read error (the board says why once)', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, null, NOW)).toEqual({ kind: 'hidden' });
    expect(datumChipsForRoom({ room_id: 'r1' }, { paired: false }, NOW)).toEqual({ kind: 'hidden' });
    expect(datumChipsForRoom({ room_id: 'r1' }, { error: 'x' }, NOW)).toEqual({ kind: 'hidden' });
  });

  it('says never for an unlinked room, and for a project whose gate read never succeeded', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ roomLinks: { r1: null } }), NOW)).toEqual({ kind: 'never' });
    expect(datumChipsForRoom({ room_id: 'r9' }, paired(), NOW)).toEqual({ kind: 'never' });
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ lastGateReadAt: null }), NOW)).toEqual({ kind: 'never' });
  });

  it('says DATUM holds nothing only when the last good read covered the area, ignoring rows for another area', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [] }), NOW)).toEqual({ kind: 'none' });
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row({ datum_area_id: 'old-area' })] }), NOW)).toEqual({ kind: 'none' });
  });

  it('says never, not "nothing", for a room linked after the last good read', () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [], readAreaIds: ['other-area'] }), NOW)).toEqual({ kind: 'never' });
  });

  it('shows one chip per gate in gate order with the fixed label, and the time SANO read it', () => {
    const state = datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row({ gate_code: 'B', status: 'blocked' }), row()] }), NOW);
    expect(state).toEqual({
      kind: 'chips',
      chips: [
        { gate_code: 'A', status: 'passed', label: 'lolos' },
        { gate_code: 'B', status: 'blocked', label: 'terhambat' },
      ],
      asOf: '09.00',
      old: false,
      datumStale: false,
    });
  });

  it('marks chips old only past 24 hours', () => {
    const at = (iso: string) => datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row({ synced_at: iso })] }), NOW);
    expect(at('2026-09-26T03:00:00.000Z')).toMatchObject({ old: false });
    expect(at('2026-09-26T02:59:59.000Z')).toMatchObject({ old: true, asOf: '26 Sep 09.59' });
  });

  it("flags DATUM's own stale rows", () => {
    expect(datumChipsForRoom({ room_id: 'r1' }, paired({ rows: [row(), row({ gate_code: 'B', datum_stale: true })] }), NOW)).toMatchObject({ datumStale: true });
  });
});

describe('labels and times', () => {
  it('names the six DATUM states exactly', () => {
    expect(DATUM_READINESS_LABELS).toEqual({
      not_started: 'belum mulai',
      in_progress: 'berjalan',
      ready_for_handoff: 'siap serah terima',
      blocked: 'terhambat',
      passed: 'lolos',
      not_applicable: 'tidak berlaku',
    });
  });

  it('reads HH.mm today and a date otherwise, across WIB midnight (17:00 UTC)', () => {
    expect(datumAsOfLabel('2026-09-27T16:59:00.000Z', '2026-09-27T16:59:30.000Z')).toBe('23.59');
    expect(datumAsOfLabel('2026-09-27T16:59:00.000Z', '2026-09-27T17:00:30.000Z')).toBe('27 Sep 23.59');
    expect(datumAsOfLabel('2026-09-27T17:00:00.000Z', '2026-09-27T17:00:30.000Z')).toBe('00.00');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumGateStatus.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `Cannot find module '../datumGateStatus' from 'tools/__tests__/datumGateStatus.test.ts'`.

- [ ] **Step 3: Write the read and the chip state**

Create `tools/datumGateStatus.ts` with exactly this content:

```ts
// SANO - DATUM readiness on Papan Ruangan (spec 2026-09-27 §8.2).
//
// The chips are DATUM's own word, read verbatim by the datum-sync function
// into room_datum_gate_status (migration 107). Nothing here derives a
// readiness verdict (truth contract rule 1). Old news is marked old, and
// missing news is never shown as "no news" (rule 2): a never-read project
// says so, a failed read says so, and a linked room DATUM holds nothing for
// says that in its own sentence.

import { supabase } from './supabase';
import { formatWibShort, todayIsoWIB } from './timeWindow';

export type DatumReadiness =
  | 'not_started' | 'in_progress' | 'ready_for_handoff' | 'blocked' | 'passed' | 'not_applicable';

/** One fixed Indonesian label per DATUM status (spec §8.2). */
export const DATUM_READINESS_LABELS: Record<DatumReadiness, string> = {
  not_started: 'belum mulai',
  in_progress: 'berjalan',
  ready_for_handoff: 'siap serah terima',
  blocked: 'terhambat',
  passed: 'lolos',
  not_applicable: 'tidak berlaku',
};

export interface DatumGateRow {
  room_id: string;
  gate_code: string;
  datum_area_id: string;
  status: DatumReadiness;
  datum_stale: boolean;
  synced_at: string;
}

export type DatumGateStatusResult =
  | { paired: false }
  | {
      paired: true;
      /** finished_at of the newest run whose gate_status step was ok; null when none ever was. */
      lastGateReadAt: string | null;
      /** The DATUM areas that read covered. A linked area outside it has not been read yet. */
      readAreaIds: string[];
      /** rooms.datum_area_id by room id, for this project. */
      roomLinks: Record<string, string | null>;
      rows: DatumGateRow[];
    }
  | { error: string };

export const DATUM_OLD_AFTER_MS = 24 * 60 * 60 * 1000;

export const DATUM_BOARD_COPY = {
  readError: 'Status DATUM gagal dimuat.',
  retry: 'Coba lagi',
  never: 'Status DATUM belum tersinkron',
  none: 'DATUM belum punya status untuk ruangan ini',
  old: 'lama',
  datumStale: 'sebagian menunggu hitung ulang di DATUM',
} as const;

/** One read per board load: the pairing, the last good gate read, the room links and the cache. */
export async function listDatumGateStatus(projectId: string): Promise<DatumGateStatusResult> {
  try {
    const project = await supabase.from('projects').select('datum_project_code').eq('id', projectId).maybeSingle();
    if (project.error) return { error: project.error.message };
    if (!project.data?.datum_project_code) return { paired: false };

    const [run, rooms, rows] = await Promise.all([
      supabase
        .from('datum_sync_runs')
        .select('finished_at, gate_area_ids:counts->gate_area_ids')
        .eq('project_id', projectId)
        .eq('counts->steps->>gate_status', 'ok')
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('rooms').select('id, datum_area_id').eq('project_id', projectId),
      supabase
        .from('room_datum_gate_status')
        .select('room_id, gate_code, datum_area_id, status, datum_stale, synced_at')
        .eq('project_id', projectId),
    ]);
    const failed = run.error ?? rooms.error ?? rows.error;
    if (failed) return { error: failed.message };

    const roomLinks: Record<string, string | null> = {};
    for (const r of (rooms.data ?? []) as Array<{ id: string; datum_area_id: string | null }>) roomLinks[r.id] = r.datum_area_id;
    const lastRead = run.data as { finished_at: string; gate_area_ids: string[] | null } | null;
    return {
      paired: true,
      lastGateReadAt: lastRead?.finished_at ?? null,
      readAreaIds: lastRead?.gate_area_ids ?? [],
      roomLinks,
      rows: (rows.data ?? []) as DatumGateRow[],
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export type DatumChipState =
  | { kind: 'hidden' }
  | { kind: 'never' }
  | { kind: 'none' }
  | {
      kind: 'chips';
      chips: Array<{ gate_code: string; status: DatumReadiness; label: string }>;
      asOf: string;
      old: boolean;
      datumStale: boolean;
    };

/** "10.00" when the instant is today in WIB, "27 Sep 10.00" otherwise. */
export function datumAsOfLabel(iso: string, nowIso: string): string {
  const full = formatWibShort(iso);
  const sameDay = todayIsoWIB(new Date(iso)) === todayIsoWIB(new Date(nowIso));
  return sameDay ? full.slice(full.lastIndexOf(' ') + 1) : full;
}

/**
 * What one room shows. `hidden` covers an unpaired project (DATUM is not part
 * of it) and a failed read (the board shows one error line instead, so no
 * room pretends to know). Only rows read for the room's CURRENT area count,
 * and "DATUM has nothing" is said only for an area the last good read
 * covered: a room linked in a run whose gate read failed is "not yet read".
 */
export function datumChipsForRoom(
  room: { room_id: string },
  result: DatumGateStatusResult | null,
  nowIso: string,
): DatumChipState {
  if (!result || 'error' in result || !result.paired) return { kind: 'hidden' };
  const link = result.roomLinks[room.room_id] ?? null;
  if (!link || !result.lastGateReadAt) return { kind: 'never' };
  const rows = result.rows
    .filter((r) => r.room_id === room.room_id && r.datum_area_id === link)
    .sort((a, b) => (a.gate_code < b.gate_code ? -1 : a.gate_code > b.gate_code ? 1 : 0));
  if (rows.length === 0) return result.readAreaIds.includes(link) ? { kind: 'none' } : { kind: 'never' };
  const newest = rows.reduce((max, r) => (r.synced_at > max ? r.synced_at : max), rows[0].synced_at);
  return {
    kind: 'chips',
    chips: rows.map((r) => ({ gate_code: r.gate_code, status: r.status, label: DATUM_READINESS_LABELS[r.status] ?? r.status })),
    asOf: datumAsOfLabel(newest, nowIso),
    old: Date.parse(nowIso) - Date.parse(newest) > DATUM_OLD_AFTER_MS,
    datumStale: rows.some((r) => r.datum_stale),
  };
}
```

- [ ] **Step 4: Run the test and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumGateStatus.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Tests: 12 passed, 12 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t2.txt` with the Write tool, exactly:

```text
feat(rooms): read DATUM's readiness for Papan Ruangan

listDatumGateStatus reads the pairing, the last good gate read, the
room links and room_datum_gate_status, and returns an error rather than
an empty board. datumChipsForRoom says hidden, never, none, or DATUM's
own label per gate with the read time, old past 24 hours.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumGateStatus.ts tools/__tests__/datumGateStatus.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t2.txt" -- tools/datumGateStatus.ts tools/__tests__/datumGateStatus.test.ts
```

### U-T3 (Lane U, Task 3): Pairing, sync and import calls, and the card's read

Spec §7 ("Button"), §8.1, with the owner's change: `canSyncDatum` is the same set as `canPairDatum` (admin, principal, estimator). `setDatumProjectCode` calls 107's RPC and maps its refusals; `syncDatum` and `importFromDatum` invoke `datum-sync` the way `tools/siteEvents.ts:309` invokes `site-event-analyze`, reading the refusal code out of a `FunctionsHttpError`'s JSON body and mapping it to its sentence; an answer that is not a run is an error, never a success. `getDatumSyncState` reads the newest two runs of the project (the newest, and the newest finished: one open run at a time), the newest run of any project whose staff step was ok (staff matching is global, spec §4.6), and this project's requests unhandled for more than 2 hours; any failed read is `{ error }`.

**Files:**
- Create: `tools/datumSync.ts`
- Create: `tools/__tests__/datumSync.test.ts`

**Depends on:** **F-T1 committed** (`RunCounts`, `RunDifferences`, `RunReport`).

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/datumSync.test.ts` with exactly this content:

```ts
/**
 * The app's side of the DATUM sync (spec 2026-09-27 §7, §8.1): who may pair
 * and sync, every refusal as a sentence, and the card's read, which never
 * turns a failed read into "belum pernah".
 */
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));

import { supabase } from '../supabase';
import {
  DATUM_IMPORT_FORBIDDEN,
  DATUM_SYNC_REFUSALS,
  canPairDatum,
  canSyncDatum,
  getDatumSyncState,
  importFromDatum,
  mapDatumPairingError,
  setDatumProjectCode,
  syncDatum,
} from '../datumSync';

const mocked = supabase as unknown as { from: jest.Mock; rpc: jest.Mock; functions: { invoke: jest.Mock } };
const calls: string[] = [];

function chain(table: string, result: { data: unknown; error: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'not', 'is', 'lt', 'order', 'limit', 'maybeSingle']) {
    c[name] = (...args: unknown[]) => {
      calls.push(`${table}.${name}:${args.map((a) => JSON.stringify(a)).join(':')}`);
      return c;
    };
  }
  c.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const httpError = (payload: unknown) => ({ message: 'Edge Function returned a non-2xx status code', context: { json: async () => payload } });
const report = { ok: true, runId: 'run-1', counts: { steps: { areas: 'ok' } }, differences: {}, error: null };

beforeEach(() => {
  calls.length = 0;
  mocked.from.mockReset();
  mocked.rpc.mockReset();
  mocked.functions.invoke.mockReset();
});

describe('who may', () => {
  it('lets admin, principal and estimator pair and sync, never a supervisor', () => {
    for (const role of ['admin', 'principal', 'estimator'] as const) {
      expect(canPairDatum(role)).toBe(true);
      expect(canSyncDatum(role)).toBe(true);
    }
    expect(canPairDatum('supervisor')).toBe(false);
    expect(canSyncDatum('supervisor')).toBe(false);
    expect(canSyncDatum(null)).toBe(false);
  });
});

describe('setDatumProjectCode', () => {
  it('calls the 107 RPC and returns the stored code', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { code: 'K2-7' }, error: null });
    expect(await setDatumProjectCode('p1', ' k2-7 ')).toEqual({ code: 'K2-7' });
    expect(mocked.rpc).toHaveBeenCalledWith('set_datum_project_code', { p_project_id: 'p1', p_code: ' k2-7 ' });
  });

  it('maps each refusal to its sentence, and anything else with its message', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain' } });
    expect(await setDatumProjectCode('p1', 'K2-7')).toEqual({ error: 'Kode DATUM ini sudah dipakai proyek lain.' });
    expect(mapDatumPairingError('DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator')).toBe('Hanya admin, prinsipal atau estimator yang dapat menautkan proyek ke DATUM.');
    expect(mapDatumPairingError('DATUM_PAIRING_PROJECT: proyek tidak ditemukan')).toBe('Proyek tidak ditemukan.');
    expect(mapDatumPairingError('network down')).toBe('Kode DATUM gagal disimpan: network down');
  });
});

describe('syncDatum and importFromDatum', () => {
  it('send the spec bodies and return the run the server wrote', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: report, error: null });
    expect(await syncDatum('p1')).toEqual({ run: report });
    expect(await importFromDatum('p1', ['LT2-TERAS'])).toEqual({ run: report });
    expect(mocked.functions.invoke.mock.calls).toEqual([
      ['datum-sync', { body: { projectId: 'p1' } }],
      ['datum-sync', { body: { projectId: 'p1', importDatumOnly: true, areaCodes: ['LT2-TERAS'] } }],
    ]);
  });

  it.each(Object.entries(DATUM_SYNC_REFUSALS))('maps %s to its sentence', async (code, sentence) => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code, error: 'x' }) });
    expect(await syncDatum('p1')).toEqual({ error: sentence, code });
  });

  it('gives the import its own refusal sentence', async () => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: httpError({ ok: false, code: 'FORBIDDEN', error: 'x' }) });
    expect(await importFromDatum('p1', ['A-1'])).toEqual({ error: DATUM_IMPORT_FORBIDDEN, code: 'FORBIDDEN' });
  });

  it('never claims a run it did not get: an unknown answer or a dead network is an error', async () => {
    mocked.functions.invoke.mockResolvedValueOnce({ data: { hello: 1 }, error: null });
    expect(await syncDatum('p1')).toMatchObject({ code: 'UNEXPECTED' });
    mocked.functions.invoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    expect(await syncDatum('p1')).toEqual({ error: 'Sinkron DATUM gagal: Failed to send a request to the Edge Function', code: 'INVOKE_FAILED' });
  });
});

describe('getDatumSyncState', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', started_at: '2026-09-27T03:00:00.000Z',
    finished_at: '2026-09-27T03:00:05.000Z', ok: true, counts: { steps: { staff: 'ok' } }, differences: {}, error: null,
    requester: { full_name: 'Siti' }, ...over,
  });

  it('reads the newest two runs of the project, the newest staff run of any project, and old waiting requests', async () => {
    const open = run({ id: 'run-2', finished_at: null, ok: null, requester: null });
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: [open, run()], error: null }))
      .mockReturnValueOnce(chain('staffRun', { data: run({ id: 'run-0', project_id: 'p9' }), error: null }))
      .mockReturnValueOnce(chain('requests', { data: [{ requested_at: '2026-09-27T00:00:00.000Z' }], error: null, count: 3 }));
    const state = await getDatumSyncState('p1', '2026-09-27T03:00:10.000Z');
    expect(state).toMatchObject({
      latest: { id: 'run-2', requester_name: null },
      latestFinished: { id: 'run-1', requester_name: 'Siti' },
      staffRun: { id: 'run-0' },
      waiting: { count: 3, oldestAt: '2026-09-27T00:00:00.000Z' },
    });
    expect(calls).toContain('staffRun.eq:"counts->steps->>staff":"ok"');
    expect(calls).toContain('requests.lt:"requested_at":"2026-09-27T01:00:10.000Z"');
    expect(calls).toContain('requests.is:"handled_at":null');
  });

  it('says never run, and no wait, with empty answers', async () => {
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: [], error: null }))
      .mockReturnValueOnce(chain('staffRun', { data: null, error: null }))
      .mockReturnValueOnce(chain('requests', { data: [], error: null, count: 0 }));
    expect(await getDatumSyncState('p1')).toEqual({ latest: null, latestFinished: null, staffRun: null, waiting: null });
  });

  it('returns the error, never "belum pernah", when a read fails', async () => {
    mocked.from
      .mockReturnValueOnce(chain('runs', { data: null, error: { message: 'offline' } }))
      .mockReturnValueOnce(chain('staffRun', { data: null, error: null }))
      .mockReturnValueOnce(chain('requests', { data: [], error: null, count: 0 }));
    expect(await getDatumSyncState('p1')).toEqual({ error: 'offline' });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSync.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `Cannot find module '../datumSync' from 'tools/__tests__/datumSync.test.ts'`.

- [ ] **Step 3: Write the calls and the read**

Create `tools/datumSync.ts` with exactly this content:

```ts
// SANO - the app side of the DATUM sync (spec 2026-09-27 §7, §8.1).
//
// Three calls and one read:
//   * setDatumProjectCode - migration 107's set_datum_project_code RPC.
//   * syncDatum / importFromDatum - the datum-sync edge function, the way
//     tools/siteEvents.ts invokes site-event-analyze. The answer is either
//     the run the server wrote ({ run }) or a refusal as a sentence
//     ({ error, code }); nothing is claimed before the server answered.
//   * getDatumSyncState - the Rooms-tab card's read of datum_sync_runs and
//     datum_sync_requests. A failed read is an error, never "belum pernah".
//
// Every office role (admin, principal, estimator) may pair, sync and import.
// The spec's first version kept "Sinkron DATUM" to admin and principal; the
// owner widened it on 2026-09-27 (calibration item 9), and the function
// enforces the same rule with is_office_role().

import { supabase } from './supabase';
import type { UserRoleType } from './constants';
import type { RunCounts, RunDifferences, RunReport } from './datumSyncPlan';

export const DATUM_SYNC_FUNCTION = 'datum-sync';
export const DATUM_OFFICE_ROLES: ReadonlyArray<UserRoleType> = ['admin', 'principal', 'estimator'];

export function canPairDatum(role: UserRoleType | null | undefined): boolean {
  return !!role && DATUM_OFFICE_ROLES.includes(role);
}

/** Same set as pairing: the owner's 2026-09-27 decision (a deliberate difference from spec §6.1). */
export function canSyncDatum(role: UserRoleType | null | undefined): boolean {
  return canPairDatum(role);
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

const PAIRING_COPY: Array<[string, string]> = [
  ['DATUM_PAIRING_AUTH', 'Hanya admin, prinsipal atau estimator yang dapat menautkan proyek ke DATUM.'],
  ['DATUM_PAIRING_TAKEN', 'Kode DATUM ini sudah dipakai proyek lain.'],
  ['DATUM_PAIRING_PROJECT', 'Proyek tidak ditemukan.'],
];

export function mapDatumPairingError(message: string): string {
  const hit = PAIRING_COPY.find(([code]) => message.startsWith(`${code}:`));
  return hit ? hit[1] : `Kode DATUM gagal disimpan: ${message}`;
}

export async function setDatumProjectCode(
  projectId: string,
  code: string,
): Promise<{ code: string | null; error?: undefined } | { error: string; code?: undefined }> {
  const { data, error } = await supabase.rpc('set_datum_project_code', { p_project_id: projectId, p_code: code });
  if (error) return { error: mapDatumPairingError(error.message) };
  return { code: ((data as { code?: string | null } | null)?.code ?? null) };
}

// ─── Sync and import ─────────────────────────────────────────────────────────

export type DatumCallResult = { run: RunReport; error?: undefined } | { error: string; code: string; run?: undefined };

/** The sentence for each refusal the function can give (its codes, handler.ts). */
export const DATUM_SYNC_REFUSALS: Record<string, string> = {
  AUTH: 'Sesi Anda berakhir. Masuk lagi, lalu coba sinkron lagi.',
  NOT_FOUND: 'Proyek tidak ditemukan atau Anda tidak punya akses.',
  FORBIDDEN: 'Hanya peran kantor (admin, prinsipal, estimator) yang dapat menyinkronkan DATUM.',
  PAIRING_MISSING: 'Proyek ini belum ditautkan ke DATUM.',
  SYNC_RUNNING: 'Sinkron DATUM untuk proyek ini sedang berjalan.',
  BAD_REQUEST: 'Permintaan sinkron tidak valid.',
  CONFIG: 'Sinkron DATUM belum dikonfigurasi di server.',
};
export const DATUM_IMPORT_FORBIDDEN = 'Hanya peran kantor yang dapat mengambil ruangan dari DATUM.';

export function mapDatumSyncRefusal(code: string, fallback: string | null | undefined, importing = false): string {
  if (importing && code === 'FORBIDDEN') return DATUM_IMPORT_FORBIDDEN;
  return DATUM_SYNC_REFUSALS[code] ?? `Sinkron DATUM gagal: ${fallback || code}`;
}

interface FunctionReply extends Partial<RunReport> {
  code?: string;
}

function isRunReport(v: FunctionReply | null): v is RunReport {
  return !!v && typeof v.runId === 'string' && typeof v.ok === 'boolean' && !!v.counts;
}

async function invokeDatumSync(body: Record<string, unknown>, importing: boolean): Promise<DatumCallResult> {
  const { data, error } = await supabase.functions.invoke<FunctionReply>(DATUM_SYNC_FUNCTION, { body });
  if (!error) {
    if (isRunReport(data)) return { run: data };
    return { error: mapDatumSyncRefusal('UNEXPECTED', 'jawaban server tidak dikenal', importing), code: 'UNEXPECTED' };
  }
  // FunctionsHttpError carries the Response as `context`; the function always answers JSON.
  const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (context && typeof context.json === 'function') {
    try {
      const payload = (await context.json()) as { code?: string; error?: string } | null;
      if (payload?.code) return { error: mapDatumSyncRefusal(payload.code, payload.error, importing), code: payload.code };
    } catch {
      // fall through to the generic sentence
    }
  }
  return { error: mapDatumSyncRefusal('INVOKE_FAILED', error.message, importing), code: 'INVOKE_FAILED' };
}

export function syncDatum(projectId: string): Promise<DatumCallResult> {
  return invokeDatumSync({ projectId }, false);
}

export function importFromDatum(projectId: string, areaCodes: string[]): Promise<DatumCallResult> {
  return invokeDatumSync({ projectId, importDatumOnly: true, areaCodes }, true);
}

// ─── The card's read ─────────────────────────────────────────────────────────

export interface DatumRun {
  id: string;
  project_id: string;
  source: 'manual' | 'cron' | 'import';
  requested_by: string | null;
  requester_name: string | null;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  counts: RunCounts;
  differences: RunDifferences;
  error: string | null;
}

export interface DatumSyncState {
  /** The newest run of this project, open or finished. */
  latest: DatumRun | null;
  /** The newest finished run of this project: the differences come from here. */
  latestFinished: DatumRun | null;
  /** The newest run, of any project, whose staff step was ok: staff matching is global. */
  staffRun: DatumRun | null;
  /** Hourly requests for this project unhandled for more than 2 hours. */
  waiting: { count: number; oldestAt: string } | null;
}

// One string literal on purpose (the tools/rooms.ts ROOM_COLUMNS rule).
const RUN_COLUMNS =
  'id, project_id, source, requested_by, started_at, finished_at, ok, counts, differences, error, requester:profiles!datum_sync_runs_requested_by_fkey(full_name)';

export const DATUM_WAITING_AFTER_MS = 2 * 60 * 60 * 1000;

type RunRow = Omit<DatumRun, 'requester_name'> & { requester?: { full_name?: string | null } | null };

function toRun(row: RunRow | null): DatumRun | null {
  if (!row) return null;
  const { requester, ...rest } = row;
  return {
    ...rest,
    counts: (rest.counts ?? { steps: {} }) as RunCounts,
    differences: (rest.differences ?? {}) as RunDifferences,
    requester_name: requester?.full_name ?? null,
  };
}

export async function getDatumSyncState(
  projectId: string,
  nowIso: string = new Date().toISOString(),
): Promise<DatumSyncState | { error: string }> {
  try {
    const waitingSince = new Date(Date.parse(nowIso) - DATUM_WAITING_AFTER_MS).toISOString();
    const [recent, staff, waiting] = await Promise.all([
      supabase.from('datum_sync_runs').select(RUN_COLUMNS).eq('project_id', projectId)
        .order('started_at', { ascending: false }).limit(2),
      supabase.from('datum_sync_runs').select(RUN_COLUMNS).eq('counts->steps->>staff', 'ok').not('finished_at', 'is', null)
        .order('finished_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('datum_sync_requests').select('requested_at', { count: 'exact' }).eq('project_id', projectId)
        .is('handled_at', null).lt('requested_at', waitingSince).order('requested_at', { ascending: true }).limit(1),
    ]);
    const failed = recent.error ?? staff.error ?? waiting.error;
    if (failed) return { error: failed.message };

    const runs = ((recent.data ?? []) as unknown as RunRow[]).map((r) => toRun(r) as DatumRun);
    const oldest = ((waiting.data ?? []) as Array<{ requested_at: string }>)[0];
    return {
      latest: runs[0] ?? null,
      latestFinished: runs.find((r) => r.finished_at !== null) ?? null,
      staffRun: toRun(staff.data as unknown as RunRow | null),
      waiting: oldest && (waiting.count ?? 0) > 0 ? { count: waiting.count ?? 0, oldestAt: oldest.requested_at } : null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the test and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSync.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Tests: 16 passed, 16 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t3.txt` with the Write tool, exactly:

```text
feat(rooms): DATUM pairing, sync and import calls, and the run read

Every office role may pair, sync and import (the owner's 2026-09-27
decision). Refusals come back as sentences; a reply that is not a run is
an error. getDatumSyncState reads the latest runs, the newest good staff
run of any project and waiting hourly requests, or returns the error.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/datumSync.ts tools/__tests__/datumSync.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t3.txt" -- tools/datumSync.ts tools/__tests__/datumSync.test.ts
```

### U-T4 (Lane U, Task 4): Every sentence of the card, pure

Spec §8.1's table, word for word where it gives the words: `Sinkron terakhir: 27 Sep 10.00 · 12 ruangan ditautkan · 2 dibuat · 1 hanya di DATUM` (zero parts other than "ditautkan" dropped), "otomatis" or "oleh {name}", "DATUM: {name}"; `Sinkron terakhir gagal: ... · {error}` with each step that was not ok and its reason; "Sinkron sedang berjalan sejak 10.00"; "Belum pernah disinkronkan."; the automatic-sync line; the seven difference groups ("Tidak diambil dari DATUM" is added for the import's skips); "Staf (semua proyek), per {time}" with its three groups and "{m} staf tertaut"; the import offer and its confirmation question; the import's result lines.

**Files:**
- Create: `office/screens/rooms/datumSyncModel.ts`
- Create: `office/screens/rooms/__tests__/datumSyncModel.test.ts`

**Depends on:** U-T3, U-T1, **F-T1** (`STEP_ORDER`, `GateWordDiff`).

- [ ] **Step 1: Write the failing test**

Create `office/screens/rooms/__tests__/datumSyncModel.test.ts` with exactly this content:

```ts
/**
 * The words of the Rooms-tab DATUM card (spec 2026-09-27 §8.1).
 */
import type { DatumRun, DatumSyncState } from '../../../../tools/datumSync';
import {
  differenceGroups,
  importOffer,
  importResultLines,
  lastRunView,
  staffView,
  waitingLine,
  whenLabel,
} from '../datumSyncModel';

const NOW = '2026-09-27T03:30:00.000Z'; // 10.30 WIB

const run = (over: Partial<DatumRun> = {}): DatumRun => ({
  id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', requester_name: 'Siti Aminah',
  started_at: '2026-09-27T03:00:00.000Z', finished_at: '2026-09-27T03:00:05.000Z', ok: true,
  counts: { steps: { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' }, datum_project_name: 'Citraland K2-7 Sonny', rooms_linked: 12, rooms_created: 2, datum_only: 1 },
  differences: {}, error: null, ...over,
});
const state = (over: Partial<DatumSyncState> = {}): DatumSyncState => ({ latest: run(), latestFinished: run(), staffRun: run(), waiting: null, ...over });

describe('lastRunView', () => {
  it("reads a good run with its non-zero parts, who started it, and DATUM's project name", () => {
    expect(lastRunView(state(), NOW)).toEqual({
      tone: 'ok',
      line: 'Sinkron terakhir: 27 Sep 10.00 · 12 ruangan ditautkan · 2 dibuat · 1 hanya di DATUM',
      details: ['oleh Siti Aminah', 'DATUM: Citraland K2-7 Sonny'],
      steps: [],
    });
    const cron = run({ source: 'cron', counts: { steps: { areas: 'ok' }, rooms_linked: 0, rooms_created: 0 } });
    expect(lastRunView(state({ latest: cron }), NOW)).toMatchObject({ line: 'Sinkron terakhir: 27 Sep 10.00 · 0 ruangan ditautkan', details: ['otomatis'] });
  });

  it('reads a failed run in the critical tone with its error and each step that was not ok', () => {
    const failed = run({
      ok: false, error: 'DATUM menolak kunci integrasi (401).',
      counts: {
        steps: { areas: 'error', link: 'skipped', create: 'skipped', gate_status: 'error', staff: 'error', escalate: 'ok' },
        step_errors: { areas: 'DATUM menolak kunci integrasi (401).', link: 'Area DATUM tidak terbaca pada sinkron ini.', create: 'Area DATUM tidak terbaca pada sinkron ini.', gate_status: 'DATUM menolak kunci integrasi (401).', staff: 'DATUM menolak kunci integrasi (401).' },
      },
    });
    const view = lastRunView(state({ latest: failed }), NOW);
    expect(view.tone).toBe('critical');
    expect(view.line).toBe('Sinkron terakhir gagal: 27 Sep 10.00 · DATUM menolak kunci integrasi (401).');
    expect(view.steps).toEqual([
      'Baca area DATUM: gagal · DATUM menolak kunci integrasi (401).',
      'Tautkan ruangan: dilewati · Area DATUM tidak terbaca pada sinkron ini.',
      'Buat area di DATUM: dilewati · Area DATUM tidak terbaca pada sinkron ini.',
      'Baca status gerbang: gagal · DATUM menolak kunci integrasi (401).',
      'Tautkan staf: gagal · DATUM menolak kunci integrasi (401).',
    ]);
  });

  it('reads an open run as running, and no run as never', () => {
    expect(lastRunView(state({ latest: run({ finished_at: null, ok: null }) }), NOW).line).toBe('Sinkron sedang berjalan sejak 10.00');
    expect(lastRunView(state({ latest: null, latestFinished: null }), NOW)).toEqual({ tone: 'muted', line: 'Belum pernah disinkronkan.', details: [], steps: [] });
  });
});

describe('waitingLine', () => {
  it('speaks only when hourly requests have waited more than 2 hours', () => {
    expect(waitingLine(state())).toBeNull();
    expect(waitingLine(state({ waiting: { count: 3, oldestAt: '2026-09-27T00:00:00.000Z' } }))).toBe(
      'Sinkron otomatis menunggu: 3 permintaan sejak 27 Sep 07.00. Periksa Database Webhook.',
    );
  });
});

describe('differenceGroups', () => {
  it('lists every group that has lines, in the card order, and nothing for an empty run', () => {
    expect(differenceGroups(run())).toEqual([]);
    const groups = differenceGroups(run({
      differences: {
        datum_only: [{ area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' }],
        field_conflicts: [
          { room_code: 'KM-1', field: 'name', sano: 'Kamar Mandi 1', datum: 'KM Anak' },
          { room_code: 'KM-1', field: 'floor', sano: 'Lt. 1', datum: 'Lt. 2' },
          { room_code: 'KM-1', field: 'area_type', sano: 'bathroom', datum: 'general' },
        ],
        datum_duplicates: [{ key: 'X-1', area_codes: ['X-1', 'x 1'] }],
        create_failed: [{ room_code: 'LT3-PANJANG', reason: 'Nama ruangan lebih dari 120 karakter; DATUM menolaknya.' }],
        import_skipped: [{ area_code: 'GONE-1', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }],
        escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }],
        gate_words: [{ code: 'B', field: 'description' }],
      },
    }));
    expect(groups).toEqual([
      { title: 'Hanya di DATUM', lines: ['LT2-TERAS · Teras · Lt. 2 · Teras / Balkon'] },
      { title: 'Berbeda dengan DATUM', lines: [
        'KM-1 · nama — SANO "Kamar Mandi 1" · DATUM "KM Anak"',
        'KM-1 · lantai — SANO "Lt. 1" · DATUM "Lt. 2"',
        'KM-1 · tipe — SANO "Kamar mandi" · DATUM "Umum"',
      ] },
      { title: 'Kode ganda di DATUM', lines: ['X-1: X-1, x 1'] },
      { title: 'Gagal dibuat di DATUM', lines: ['LT3-PANJANG · Nama ruangan lebih dari 120 karakter; DATUM menolaknya.'] },
      { title: 'Tidak diambil dari DATUM', lines: ['GONE-1 · Sudah ada di SANO atau tidak lagi ada di DATUM.'] },
      { title: 'Keputusan belum terkirim', lines: ['LT1-DAPUR · Pilih kran · Ruangan belum tertaut ke area DATUM.'] },
      { title: 'Kata gerbang berbeda dengan DATUM', lines: ['Gerbang B · deskripsi'] },
    ]);
  });
});

describe('staffView', () => {
  it('shows the newest good staff step, labelled for every project, with each group and the linked count', () => {
    const view = staffView(run({
      counts: { steps: { staff: 'ok' }, staff: { linked: 28, linked_now: 2, unmatched: 1, ambiguous: 2, stale: 1 } },
      differences: { staff: {
        unmatched: [{ profile_id: 'u1', full_name: 'Ir. Budi' }],
        ambiguous: [{ profile_id: 'u2', full_name: 'Andi', side: 'datum' }, { profile_id: 'u3', full_name: 'Rina', side: 'linked_elsewhere' }],
        stale: [{ profile_id: 'u4', full_name: 'Selvi', staff_id: 's4', staff_name: 'Selvia', reason: 'name_differs' }],
      } },
    }));
    expect(view).toEqual({
      heading: 'Staf (semua proyek), per 27 Sep 10.00',
      groups: [
        { title: 'Tidak ada di DATUM', lines: ['Ir. Budi'] },
        { title: 'Nama ganda', lines: ['Andi · nama ganda di DATUM', 'Rina · staf DATUM ini sudah tertaut ke orang lain'] },
        { title: 'Tautan lama tidak cocok', lines: ['Selvi · tertaut ke "Selvia"'] },
      ],
      linkedLine: '28 staf tertaut',
    });
  });

  it('shows nothing without a finished run whose staff step was ok', () => {
    expect(staffView(null)).toBeNull();
    expect(staffView(run({ counts: { steps: { staff: 'error' } } }))).toBeNull();
    expect(staffView(run({ finished_at: null }))).toBeNull();
  });
});

describe('importOffer and importResultLines', () => {
  it("offers exactly the latest run's DATUM-only areas, naming DATUM's project", () => {
    expect(importOffer(state())).toBeNull();
    const offer = importOffer(state({ latestFinished: run({ differences: { datum_only: [
      { area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
      { area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade' },
    ] } }) }));
    expect(offer).toEqual({
      projectName: 'Citraland K2-7 Sonny',
      areas: [
        { area_code: 'LT2-TERAS', line: 'LT2-TERAS · Teras · Lt. 2 · Teras / Balkon' },
        { area_code: 'FASAD', line: 'FASAD · Fasad Depan · tanpa lantai · Fasad' },
      ],
      buttonLabel: 'Ambil 2 ruangan dari DATUM',
      question: 'Ambil 2 ruangan dari DATUM proyek Citraland K2-7 Sonny? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.',
    });
  });

  it('says how many came in and why each other one did not', () => {
    expect(importResultLines({
      ok: true, runId: 'r', error: null,
      counts: { steps: { import: 'ok' }, rooms_imported: 1 },
      differences: { import_skipped: [{ area_code: 'GONE-1', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }] },
    })).toEqual(['1 ruangan diambil', 'GONE-1: Sudah ada di SANO atau tidak lagi ada di DATUM.']);
  });
});

describe('whenLabel', () => {
  it('drops the date only for today in WIB', () => {
    expect(whenLabel('2026-09-27T03:00:00.000Z', NOW)).toBe('10.00');
    expect(whenLabel('2026-09-26T03:00:00.000Z', NOW)).toBe('26 Sep 10.00');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/datumSyncModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `Cannot find module '../datumSyncModel' from 'office/screens/rooms/__tests__/datumSyncModel.test.ts'`.

- [ ] **Step 3: Write the card's words**

Create `office/screens/rooms/datumSyncModel.ts` with exactly this content:

```ts
// The words of the Rooms-tab "DATUM" card (spec 2026-09-27 §8.1), pure, so
// the card stays thin and every sentence is tested. Nothing here claims more
// than the run row says: a failed run reads as failed with its reason, an
// open run as running, no run as "never", and differences are listed, never
// resolved.

import { AREA_TYPE_LABELS } from '../../../tools/constants';
import type { AreaType } from '../../../tools/types';
import type { DatumRun, DatumSyncState } from '../../../tools/datumSync';
import type { GateWordDiff, RunReport, SyncStep } from '../../../tools/datumSyncPlan';
import { STEP_ORDER } from '../../../tools/datumSyncPlan';
import { formatWibShort, todayIsoWIB } from '../../../tools/timeWindow';

export const DATUM_CARD_COPY = {
  title: 'DATUM',
  pairingLabel: 'Kode proyek DATUM',
  pairingPlaceholder: 'mis. K2-7',
  pairingSave: 'Simpan',
  pairingSaving: 'Menyimpan…',
  unpaired: 'Belum ditautkan',
  sync: 'Sinkron DATUM',
  syncing: 'Menyinkronkan…',
  syncNeedsPairing: 'Proyek ini belum ditautkan ke DATUM.',
  never: 'Belum pernah disinkronkan.',
  readError: 'Status sinkron gagal dimuat.',
  retry: 'Coba lagi',
  loading: 'Memuat status sinkron…',
  differencesNote: 'Tidak diubah otomatis. Samakan di SANO atau DATUM bila perlu.',
  staffNote: 'Samakan nama di SANO atau DATUM, lalu sinkron lagi. Kartu dari orang yang belum tertaut dibuat atas nama SANO (sistem).',
  importCancel: 'Batal',
  importConfirm: 'Ambil',
  importing: 'Mengambil…',
} as const;

export const STEP_LABELS: Record<SyncStep, string> = {
  areas: 'Baca area DATUM',
  link: 'Tautkan ruangan',
  create: 'Buat area di DATUM',
  import: 'Ambil ruangan dari DATUM',
  gate_status: 'Baca status gerbang',
  staff: 'Tautkan staf',
  escalate: 'Kirim keputusan',
};

const OUTCOME_WORDS = { ok: 'berhasil', error: 'gagal', skipped: 'dilewati' } as const;
const FIELD_WORDS = { name: 'nama', floor: 'lantai', area_type: 'tipe' } as const;
const GATE_FIELD_WORDS: Record<GateWordDiff['field'], string> = {
  name: 'nama',
  description: 'deskripsi',
  missing_in_sano: 'tidak ada di SANO',
};
const SIDE_WORDS = {
  datum: 'nama ganda di DATUM',
  sano: 'nama ganda di SANO',
  linked_elsewhere: 'staf DATUM ini sudah tertaut ke orang lain',
} as const;

/** "10.00" today (WIB), "27 Sep 10.00" otherwise. */
export function whenLabel(iso: string, nowIso: string): string {
  const full = formatWibShort(iso);
  return todayIsoWIB(new Date(iso)) === todayIsoWIB(new Date(nowIso)) ? full.slice(full.lastIndexOf(' ') + 1) : full;
}

export function areaTypeLabel(t: string): string {
  return AREA_TYPE_LABELS[t as AreaType] ?? t;
}

export interface LastRunView {
  tone: 'ok' | 'critical' | 'muted';
  line: string;
  /** Who started it, and DATUM's own name for the project. */
  details: string[];
  /** Each step that was not ok, with its reason. */
  steps: string[];
}

function whoLine(run: DatumRun): string {
  return run.source === 'cron' ? 'otomatis' : `oleh ${run.requester_name ?? 'pengguna tidak dikenal'}`;
}

export function lastRunView(state: DatumSyncState, nowIso: string): LastRunView {
  const latest = state.latest;
  if (!latest) return { tone: 'muted', line: DATUM_CARD_COPY.never, details: [], steps: [] };
  if (latest.finished_at === null) {
    return { tone: 'muted', line: `Sinkron sedang berjalan sejak ${whenLabel(latest.started_at, nowIso)}`, details: [whoLine(latest)], steps: [] };
  }
  const when = formatWibShort(latest.finished_at);
  const details = [whoLine(latest)];
  if (latest.counts.datum_project_name) details.push(`DATUM: ${latest.counts.datum_project_name}`);
  if (latest.ok !== true) {
    const steps = STEP_ORDER.filter((s) => latest.counts.steps[s] && latest.counts.steps[s] !== 'ok').map((s) => {
      const reason = latest.counts.step_errors?.[s];
      return `${STEP_LABELS[s]}: ${OUTCOME_WORDS[latest.counts.steps[s]!]}${reason ? ` · ${reason}` : ''}`;
    });
    return { tone: 'critical', line: `Sinkron terakhir gagal: ${when} · ${latest.error ?? 'tanpa keterangan'}`, details, steps };
  }
  const c = latest.counts;
  const parts = [`${c.rooms_linked ?? 0} ruangan ditautkan`];
  if (c.rooms_created) parts.push(`${c.rooms_created} dibuat`);
  if (c.rooms_imported) parts.push(`${c.rooms_imported} diambil dari DATUM`);
  if (c.datum_only) parts.push(`${c.datum_only} hanya di DATUM`);
  if (c.escalated) parts.push(`${c.escalated} keputusan dikirim`);
  return { tone: 'ok', line: `Sinkron terakhir: ${when} · ${parts.join(' · ')}`, details, steps: [] };
}

export function waitingLine(state: DatumSyncState): string | null {
  if (!state.waiting) return null;
  return `Sinkron otomatis menunggu: ${state.waiting.count} permintaan sejak ${formatWibShort(state.waiting.oldestAt)}. Periksa Database Webhook.`;
}

export interface DifferenceGroup { title: string; lines: string[] }

export function differenceGroups(run: DatumRun | null): DifferenceGroup[] {
  if (!run) return [];
  const d = run.differences;
  const groups: DifferenceGroup[] = [
    {
      title: 'Hanya di DATUM',
      lines: (d.datum_only ?? []).map((a) => [a.area_code, a.area_name, a.floor, areaTypeLabel(a.area_type)].filter(Boolean).join(' · ')),
    },
    {
      title: 'Berbeda dengan DATUM',
      lines: (d.field_conflicts ?? []).map((f) =>
        f.field === 'area_type'
          ? `${f.room_code} · ${FIELD_WORDS[f.field]} — SANO "${areaTypeLabel(f.sano)}" · DATUM "${areaTypeLabel(f.datum)}"`
          : `${f.room_code} · ${FIELD_WORDS[f.field]} — SANO "${f.sano}" · DATUM "${f.datum}"`),
    },
    { title: 'Kode ganda di DATUM', lines: (d.datum_duplicates ?? []).map((x) => `${x.key}: ${x.area_codes.join(', ')}`) },
    { title: 'Gagal dibuat di DATUM', lines: (d.create_failed ?? []).map((x) => `${x.room_code} · ${x.reason}`) },
    { title: 'Tidak diambil dari DATUM', lines: (d.import_skipped ?? []).map((x) => `${x.area_code} · ${x.reason}`) },
    { title: 'Keputusan belum terkirim', lines: (d.escalate_skipped ?? []).map((x) => `${x.room_code} · ${x.title} · ${x.reason}`) },
    { title: 'Kata gerbang berbeda dengan DATUM', lines: (d.gate_words ?? []).map((g) => `Gerbang ${g.code} · ${GATE_FIELD_WORDS[g.field]}`) },
  ];
  return groups.filter((g) => g.lines.length > 0);
}

export interface StaffView { heading: string; groups: DifferenceGroup[]; linkedLine: string }

export function staffView(run: DatumRun | null): StaffView | null {
  if (!run || !run.finished_at || run.counts.steps.staff !== 'ok') return null;
  const staff = run.differences.staff ?? { unmatched: [], ambiguous: [], stale: [] };
  const groups: DifferenceGroup[] = [
    { title: 'Tidak ada di DATUM', lines: staff.unmatched.map((s) => s.full_name || '(tanpa nama)') },
    { title: 'Nama ganda', lines: staff.ambiguous.map((s) => `${s.full_name || '(tanpa nama)'} · ${SIDE_WORDS[s.side]}`) },
    {
      title: 'Tautan lama tidak cocok',
      lines: staff.stale.map((s) => `${s.full_name || '(tanpa nama)'} · ${s.staff_name ? `tertaut ke "${s.staff_name}"` : 'staf DATUM-nya tidak aktif lagi'}`),
    },
  ].filter((g) => g.lines.length > 0);
  return {
    heading: `Staf (semua proyek), per ${formatWibShort(run.finished_at)}`,
    groups,
    linkedLine: `${run.counts.staff?.linked ?? 0} staf tertaut`,
  };
}

export interface ImportOffer {
  projectName: string;
  areas: Array<{ area_code: string; line: string }>;
  buttonLabel: string;
  question: string;
}

/** "Ambil {n} ruangan dari DATUM": only when the latest finished run lists DATUM-only areas. */
export function importOffer(state: DatumSyncState): ImportOffer | null {
  const run = state.latestFinished;
  const only = run?.differences.datum_only ?? [];
  if (!run || only.length === 0) return null;
  const projectName = run.counts.datum_project_name ?? 'ini';
  return {
    projectName,
    areas: only.map((a) => ({
      area_code: a.area_code,
      line: [a.area_code, a.area_name, a.floor ?? 'tanpa lantai', areaTypeLabel(a.area_type)].join(' · '),
    })),
    buttonLabel: `Ambil ${only.length} ruangan dari DATUM`,
    question: `Ambil ${only.length} ruangan dari DATUM proyek ${projectName}? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.`,
  };
}

/** What the card says after the import answered. */
export function importResultLines(report: RunReport): string[] {
  const lines = [`${report.counts.rooms_imported ?? 0} ruangan diambil`];
  for (const s of report.differences.import_skipped ?? []) lines.push(`${s.area_code}: ${s.reason}`);
  if (!report.ok && report.error) lines.push(`Gagal: ${report.error}`);
  return lines;
}
```

- [ ] **Step 4: Run the test and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/datumSyncModel.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Tests: 10 passed, 10 total`, no tsc output.

- [ ] **Step 5: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t4.txt` with the Write tool, exactly:

```text
feat(rooms): the DATUM card's words, pure and tested

The last run as the server wrote it (ok, failed with each step, running,
never), the automatic-sync line, the difference groups, the staff picture
for every project, the import offer and its result.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add office/screens/rooms/datumSyncModel.ts office/screens/rooms/__tests__/datumSyncModel.test.ts && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t4.txt" -- office/screens/rooms/datumSyncModel.ts office/screens/rooms/__tests__/datumSyncModel.test.ts
```

### U-T5 (Lane U, Task 5): The Rooms-tab "DATUM" card

Spec §8.1. `DatumSyncCard` sits in the "Kelola ruangan" sub-screen of `RoomsAdminScreen` (`:229-381`), above "Ekspor untuk DATUM" (`:373-381`), which stays. Office roles get the pairing field with "Simpan" (refusals shown as written) and "Sinkron DATUM"; anyone else who reaches the screen reads the code or "Belum ditautkan" (a supervisor never reaches this sub-screen). A press changes only its own button ("Menyinkronkan…", "Mengambil…") until the server answered; then the card reloads the run table. "Ambil n ruangan dari DATUM" opens an inline confirmation (the owner's rule: edit forms expand in place, never as modals) naming DATUM's project and listing every area; "Ambil" sends exactly those codes. The existing `RoomsAdminScreen` suite mocks the card (it mocks every child with I/O) and gains a test that the card is mounted with the project, the role and `refresh`.

**Files:**
- Create: `office/screens/rooms/DatumSyncCard.tsx`
- Create: `office/screens/rooms/__tests__/DatumSyncCard.test.tsx`
- Modify: `office/screens/RoomsAdminScreen.tsx` (one import, one mount)
- Modify: `office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx` (mock the card, reset it, one new test)

**Depends on:** U-T4.

- [ ] **Step 1: Write the failing card test**

Create `office/screens/rooms/__tests__/DatumSyncCard.test.tsx` with exactly this content:

```tsx
// office/screens/rooms/__tests__/DatumSyncCard.test.tsx
//
// DATUM sync spec 2026-09-27 §8.1: the Rooms-tab card. Every office role may
// pair, sync and import (the owner's 2026-09-27 decision); nothing on screen
// claims a result before the server answered; a failed read is an error with
// "Coba lagi", never "Belum pernah disinkronkan."
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('../../../../tools/datumSync', () => {
  const actual = jest.requireActual('../../../../tools/datumSync');
  return {
    ...actual,
    getDatumSyncState: jest.fn(),
    syncDatum: jest.fn(),
    importFromDatum: jest.fn(),
    setDatumProjectCode: jest.fn(),
  };
});

import { getDatumSyncState, importFromDatum, setDatumProjectCode, syncDatum, type DatumRun, type DatumSyncState } from '../../../../tools/datumSync';
import DatumSyncCard from '../DatumSyncCard';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const getState = getDatumSyncState as jest.Mock;
const sync = syncDatum as jest.Mock;
const doImport = importFromDatum as jest.Mock;
const pair = setDatumProjectCode as jest.Mock;

const project: { id: string; code: string; name: string; datum_project_code: string | null } = {
  id: 'p1', code: 'SANO-K27', name: 'Citraland K2-7', datum_project_code: 'K2-7',
};
const run = (over: Partial<DatumRun> = {}): DatumRun => ({
  id: 'run-1', project_id: 'p1', source: 'manual', requested_by: 'u1', requester_name: 'Siti Aminah',
  started_at: '2026-09-26T03:00:00.000Z', finished_at: '2026-09-26T03:00:05.000Z', ok: true,
  counts: { steps: { areas: 'ok', link: 'ok', create: 'ok', gate_status: 'ok', staff: 'ok', escalate: 'ok' }, datum_project_name: 'Citraland K2-7 Sonny', rooms_linked: 12, rooms_created: 2, datum_only: 0, staff: { linked: 28, linked_now: 0, unmatched: 1, ambiguous: 0, stale: 0 } },
  differences: { staff: { unmatched: [{ profile_id: 'u9', full_name: 'Ir. Budi' }], ambiguous: [], stale: [] } },
  error: null, ...over,
});
const state = (over: Partial<DatumSyncState> = {}): DatumSyncState => ({ latest: run(), latestFinished: run(), staffRun: run(), waiting: null, ...over });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

const renderCard = (role: string, over: Partial<typeof project> = {}, onPaired = jest.fn()) =>
  render(<DatumSyncCard project={{ ...project, ...over }} role={role as never} onPaired={onPaired} />);

beforeEach(() => {
  jest.clearAllMocks();
  getState.mockResolvedValue(state());
});

describe('pairing', () => {
  it.each(['admin', 'principal', 'estimator'])('gives %s the field and saves through the RPC', async (role) => {
    pair.mockResolvedValueOnce({ code: 'D-18' });
    const onPaired = jest.fn();
    const utils = renderCard(role, {}, onPaired);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    fireEvent.changeText(utils.getByLabelText('Kode proyek DATUM'), 'd-18');
    await act(async () => { fireEvent.press(utils.getByText('Simpan')); });
    expect(pair).toHaveBeenCalledWith('p1', 'd-18');
    expect(onPaired).toHaveBeenCalled();
  });

  it('shows a refusal as written and keeps the old code', async () => {
    pair.mockResolvedValueOnce({ error: 'Kode DATUM ini sudah dipakai proyek lain.' });
    const utils = renderCard('estimator');
    fireEvent.changeText(utils.getByLabelText('Kode proyek DATUM'), 'D-18');
    await act(async () => { fireEvent.press(utils.getByText('Simpan')); });
    expect(utils.getByText('Kode DATUM ini sudah dipakai proyek lain.')).toBeTruthy();
  });

  it('shows a supervisor the code, or Belum ditautkan, and no field', async () => {
    const paired = renderCard('supervisor');
    await waitFor(() => expect(paired.getByText('K2-7')).toBeTruthy());
    expect(paired.queryByLabelText('Kode proyek DATUM')).toBeNull();
    const unpaired = renderCard('supervisor', { datum_project_code: null });
    await waitFor(() => expect(unpaired.getByText('Belum ditautkan')).toBeTruthy());
  });
});

describe('Sinkron DATUM', () => {
  it.each(['admin', 'principal', 'estimator'])('is open to %s, shows nothing new until the server answers, then reloads', async (role) => {
    const answer = deferred<unknown>();
    sync.mockReturnValueOnce(answer.promise);
    const utils = renderCard(role);
    await waitFor(() => expect(utils.getByText(/Sinkron terakhir: 26 Sep 10.00/)).toBeTruthy());
    fireEvent.press(utils.getByText('Sinkron DATUM'));
    expect(utils.getByText('Menyinkronkan…')).toBeTruthy();
    expect(getState).toHaveBeenCalledTimes(1);
    getState.mockResolvedValueOnce(state({ latest: run({ id: 'run-2', finished_at: '2026-09-27T03:00:05.000Z', counts: { ...run().counts, rooms_linked: 13 } }) }));
    await act(async () => { answer.resolve({ run: { ok: true, runId: 'run-2', counts: { steps: {} }, differences: {}, error: null } }); });
    await waitFor(() => expect(utils.getByText(/13 ruangan ditautkan/)).toBeTruthy());
    expect(sync).toHaveBeenCalledWith('p1');
  });

  it('is disabled for a supervisor and while unpaired, saying why', async () => {
    const sup = renderCard('supervisor');
    await waitFor(() => expect(getState).toHaveBeenCalled());
    fireEvent.press(sup.getByText('Sinkron DATUM'));
    expect(sync).not.toHaveBeenCalled();
    const unpaired = renderCard('admin', { datum_project_code: null });
    await waitFor(() => expect(unpaired.getByText('Proyek ini belum ditautkan ke DATUM.')).toBeTruthy());
    fireEvent.press(unpaired.getByText('Sinkron DATUM'));
    expect(sync).not.toHaveBeenCalled();
  });

  it('shows a refusal as written', async () => {
    sync.mockResolvedValueOnce({ error: 'Sinkron DATUM untuk proyek ini sedang berjalan.', code: 'SYNC_RUNNING' });
    const utils = renderCard('admin');
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await act(async () => { fireEvent.press(utils.getByText('Sinkron DATUM')); });
    expect(utils.getByText('Sinkron DATUM untuk proyek ini sedang berjalan.')).toBeTruthy();
  });
});

describe('the last run', () => {
  it('reads a failed run with its error and each step that was not ok', async () => {
    getState.mockResolvedValueOnce(state({ latest: run({ ok: false, error: 'DATUM menolak kunci integrasi (401).', counts: { steps: { areas: 'error' }, step_errors: { areas: 'DATUM menolak kunci integrasi (401).' } } }) }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Sinkron terakhir gagal: 26 Sep 10.00 · DATUM menolak kunci integrasi (401).')).toBeTruthy());
    expect(utils.getByText('Baca area DATUM: gagal · DATUM menolak kunci integrasi (401).')).toBeTruthy();
  });

  it('reads an open run as running and no run as never', async () => {
    getState.mockResolvedValueOnce(state({ latest: run({ finished_at: null, ok: null }) }));
    const running = renderCard('admin');
    await waitFor(() => expect(running.getByText('Sinkron sedang berjalan sejak 26 Sep 10.00')).toBeTruthy());
    getState.mockResolvedValueOnce(state({ latest: null, latestFinished: null, staffRun: null }));
    const never = renderCard('admin');
    await waitFor(() => expect(never.getByText('Belum pernah disinkronkan.')).toBeTruthy());
  });

  it('shows a read error with Coba lagi, never "Belum pernah", and retries', async () => {
    getState.mockResolvedValueOnce({ error: 'offline' });
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Status sinkron gagal dimuat.')).toBeTruthy());
    expect(utils.queryByText('Belum pernah disinkronkan.')).toBeNull();
    await act(async () => { fireEvent.press(utils.getByText('Coba lagi')); });
    await waitFor(() => expect(utils.getByText(/Sinkron terakhir:/)).toBeTruthy());
  });

  it('shows the automatic-sync line only when requests wait', async () => {
    getState.mockResolvedValueOnce(state({ waiting: { count: 2, oldestAt: '2026-09-27T00:00:00.000Z' } }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Sinkron otomatis menunggu: 2 permintaan sejak 27 Sep 07.00. Periksa Database Webhook.')).toBeTruthy());
  });
});

describe('Ambil dari DATUM', () => {
  const withOnly = () => state({ latestFinished: run({ differences: { datum_only: [
    { area_code: 'LT2-TERAS', area_name: 'Teras', floor: 'Lt. 2', area_type: 'terrace' },
    { area_code: 'FASAD', area_name: 'Fasad Depan', floor: null, area_type: 'facade' },
  ] } }) });

  it('is offered only with DATUM-only areas, and only to office roles', async () => {
    const none = renderCard('admin');
    await waitFor(() => expect(none.getByText(/Sinkron terakhir:/)).toBeTruthy());
    expect(none.queryByText(/Ambil \d+ ruangan dari DATUM/)).toBeNull();
    getState.mockResolvedValueOnce(withOnly());
    const sup = renderCard('supervisor');
    await waitFor(() => expect(sup.getByText(/Sinkron terakhir:/)).toBeTruthy());
    expect(sup.queryByText('Ambil 2 ruangan dari DATUM')).toBeNull();
  });

  it("confirms naming DATUM's project and every area, sends exactly those codes, and reports the answer", async () => {
    getState.mockResolvedValue(withOnly());
    const answer = deferred<unknown>();
    doImport.mockReturnValueOnce(answer.promise);
    const utils = renderCard('estimator');
    await waitFor(() => expect(utils.getByText('Ambil 2 ruangan dari DATUM')).toBeTruthy());
    fireEvent.press(utils.getByText('Ambil 2 ruangan dari DATUM'));
    expect(utils.getByText('Ambil 2 ruangan dari DATUM proyek Citraland K2-7 Sonny? Ruangan dibuat di SANO dan ditautkan; setelah itu SANO yang menjadi acuan.')).toBeTruthy();
    // Once under "Hanya di DATUM", once in the confirmation.
    expect(utils.getAllByText('LT2-TERAS · Teras · Lt. 2 · Teras / Balkon')).toHaveLength(2);
    expect(utils.getByText('FASAD · Fasad Depan · tanpa lantai · Fasad')).toBeTruthy();
    fireEvent.press(utils.getByText('Ambil'));
    expect(doImport).toHaveBeenCalledWith('p1', ['LT2-TERAS', 'FASAD']);
    expect(utils.getByText('Mengambil…')).toBeTruthy();
    fireEvent.press(utils.getByText('Mengambil…'));
    expect(doImport).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer.resolve({ run: { ok: true, runId: 'r', error: null, counts: { steps: { import: 'ok' }, rooms_imported: 1 },
        differences: { import_skipped: [{ area_code: 'FASAD', reason: 'Sudah ada di SANO atau tidak lagi ada di DATUM.' }] } } });
    });
    expect(utils.getByText('1 ruangan diambil')).toBeTruthy();
    expect(utils.getByText('FASAD: Sudah ada di SANO atau tidak lagi ada di DATUM.')).toBeTruthy();
  });
});

describe('differences and staff', () => {
  it('lists each difference group with the note, and the staff picture for every project', async () => {
    getState.mockResolvedValueOnce(state({ latestFinished: run({ differences: {
      field_conflicts: [{ room_code: 'KM-1', field: 'name', sano: 'Kamar Mandi 1', datum: 'KM Anak' }],
      gate_words: [{ code: 'B', field: 'description' }],
      escalate_skipped: [{ event_id: 'e1', room_code: 'LT1-DAPUR', title: 'Pilih kran', reason: 'Ruangan belum tertaut ke area DATUM.' }],
    } }) }));
    const utils = renderCard('admin');
    await waitFor(() => expect(utils.getByText('Berbeda dengan DATUM')).toBeTruthy());
    expect(utils.getByText('KM-1 · nama — SANO "Kamar Mandi 1" · DATUM "KM Anak"')).toBeTruthy();
    expect(utils.getByText('Kata gerbang berbeda dengan DATUM')).toBeTruthy();
    expect(utils.getByText('Keputusan belum terkirim')).toBeTruthy();
    expect(utils.getByText('Tidak diubah otomatis. Samakan di SANO atau DATUM bila perlu.')).toBeTruthy();
    expect(utils.getByText('Staf (semua proyek), per 26 Sep 10.00')).toBeTruthy();
    expect(utils.getByText('Tidak ada di DATUM')).toBeTruthy();
    expect(utils.getByText('Ir. Budi')).toBeTruthy();
    expect(utils.getByText('28 staf tertaut')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/DatumSyncCard.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` with `Cannot find module '../DatumSyncCard' from 'office/screens/rooms/__tests__/DatumSyncCard.test.tsx'`.

- [ ] **Step 3: Write the card**

Create `office/screens/rooms/DatumSyncCard.tsx` with exactly this content:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Card from '../../../workflows/components/Card';
import {
  canPairDatum,
  canSyncDatum,
  getDatumSyncState,
  importFromDatum,
  setDatumProjectCode,
  syncDatum,
  type DatumSyncState,
} from '../../../tools/datumSync';
import type { UserRoleType } from '../../../tools/constants';
import type { Project } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';
import {
  DATUM_CARD_COPY as T,
  differenceGroups,
  importOffer,
  importResultLines,
  lastRunView,
  staffView,
  waitingLine,
  type DifferenceGroup,
} from './datumSyncModel';

/**
 * "DATUM" on the Kelola ruangan sub-screen (spec 2026-09-27 §8.1): the
 * pairing, "Sinkron DATUM", the last run as the server wrote it, the
 * automatic-sync health line, "Ambil n ruangan dari DATUM" with an inline
 * confirmation, the differences and the staff not yet linked.
 *
 * Nothing on screen changes until the server has answered (truth contract):
 * a press only disables its button; afterwards the card reloads the run table
 * and shows what the server wrote. Every office role may pair, sync and
 * import (the owner's 2026-09-27 decision); others only read.
 */
export default function DatumSyncCard(props: {
  project: Pick<Project, 'id' | 'code' | 'name' | 'datum_project_code'>;
  role: UserRoleType | null | undefined;
  /** Reloads the project after the pairing changed (useProject().refresh). */
  onPaired: () => void | Promise<void>;
}) {
  const { project, role, onPaired } = props;
  const office = canPairDatum(role);
  const maySync = canSyncDatum(role);

  const [state, setState] = useState<DatumSyncState | { error: string } | null>(null);
  const request = useRef(0);
  const [pairedCode, setPairedCode] = useState<string | null>(project.datum_project_code ?? null);
  const [draft, setDraft] = useState(project.datum_project_code ?? '');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importLines, setImportLines] = useState<string[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setPairedCode(project.datum_project_code ?? null);
    setDraft(project.datum_project_code ?? '');
  }, [project.id, project.datum_project_code]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setState(null);
    const next = await getDatumSyncState(project.id);
    if (id === request.current) setState(next);
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePairing = async () => {
    setPairing(true);
    setPairError(null);
    const res = await setDatumProjectCode(project.id, draft);
    setPairing(false);
    if (res.error !== undefined) {
      setPairError(res.error);
      return;
    }
    setPairedCode(res.code);
    setDraft(res.code ?? '');
    await onPaired();
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncError(null);
    const res = await syncDatum(project.id);
    setSyncing(false);
    if (res.error !== undefined) setSyncError(res.error);
    await load();
  };

  const offer = useMemo(() => (state && !('error' in state) ? importOffer(state) : null), [state]);

  const runImport = async () => {
    if (!offer) return;
    setImporting(true);
    setImportError(null);
    setImportLines(null);
    const res = await importFromDatum(project.id, offer.areas.map((a) => a.area_code));
    setImporting(false);
    if (res.error !== undefined) {
      setImportError(res.error);
    } else {
      setImportLines(importResultLines(res.run));
      setImportOpen(false);
    }
    await load();
  };

  const syncDisabled = syncing || !pairedCode || !maySync;
  const trimmedDraft = draft.trim().toUpperCase();
  const pairingUnchanged = trimmedDraft === (pairedCode ?? '');

  return (
    <Card title={T.title} subtitle="Tautan proyek ini ke DATUM: ruangan, status gerbang dan keputusan.">
      <Text style={styles.label}>{T.pairingLabel}</Text>
      {office ? (
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={T.pairingPlaceholder}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!pairing}
            accessibilityLabel={T.pairingLabel}
          />
          <TouchableOpacity
            style={[styles.ghostBtn, (pairing || pairingUnchanged) && styles.off]}
            disabled={pairing || pairingUnchanged}
            onPress={() => void savePairing()}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>{pairing ? T.pairingSaving : T.pairingSave}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.value}>{pairedCode ?? T.unpaired}</Text>
      )}
      {pairError ? <Text style={styles.error}>{pairError}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryBtn, syncDisabled && styles.primaryOff]}
        disabled={syncDisabled}
        onPress={() => void runSync()}
        accessibilityRole="button"
        accessibilityState={{ disabled: syncDisabled }}
      >
        <Text style={styles.primaryText}>{syncing ? T.syncing : T.sync}</Text>
      </TouchableOpacity>
      {!pairedCode ? <Text style={styles.hint}>{T.syncNeedsPairing}</Text> : null}
      {syncError ? <Text style={styles.error}>{syncError}</Text> : null}

      <LastRun state={state} onRetry={() => void load()} />

      {offer && office ? (
        <View style={styles.block}>
          {!importOpen ? (
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setImportOpen(true)} accessibilityRole="button">
              <Text style={styles.ghostText}>{offer.buttonLabel}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.body}>{offer.question}</Text>
              {offer.areas.map((a) => (
                <Text key={a.area_code} style={styles.listLine}>{a.line}</Text>
              ))}
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.ghostBtn, importing && styles.off]}
                  disabled={importing}
                  onPress={() => setImportOpen(false)}
                  accessibilityRole="button"
                >
                  <Text style={styles.ghostText}>{T.importCancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, importing && styles.primaryOff]}
                  disabled={importing}
                  onPress={() => void runImport()}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: importing }}
                >
                  <Text style={styles.primaryText}>{importing ? T.importing : T.importConfirm}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ) : null}
      {importError ? <Text style={styles.error}>{importError}</Text> : null}
      {importLines ? importLines.map((line) => <Text key={line} style={styles.body}>{line}</Text>) : null}

      {state && !('error' in state) ? <Differences state={state} /> : null}
    </Card>
  );
}

function LastRun({ state, onRetry }: { state: DatumSyncState | { error: string } | null; onRetry: () => void }) {
  if (state === null) return <Text style={styles.muted}>{T.loading}</Text>;
  if ('error' in state) {
    return (
      <View style={styles.row}>
        <Text style={styles.error}>{T.readError}</Text>
        <TouchableOpacity onPress={onRetry} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.link}>{T.retry}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  const view = lastRunView(state, new Date().toISOString());
  const wait = waitingLine(state);
  return (
    <View style={styles.block}>
      <Text style={[styles.body, view.tone === 'critical' && styles.criticalText]}>{view.line}</Text>
      {view.details.map((d) => <Text key={d} style={styles.muted}>{d}</Text>)}
      {view.steps.map((s) => <Text key={s} style={styles.criticalSmall}>{s}</Text>)}
      {wait ? <Text style={styles.warning}>{wait}</Text> : null}
    </View>
  );
}

function Groups({ groups }: { groups: DifferenceGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <View key={g.title} style={styles.group}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          {g.lines.map((line) => <Text key={line} style={styles.listLine}>{line}</Text>)}
        </View>
      ))}
    </>
  );
}

function Differences({ state }: { state: DatumSyncState }) {
  const groups = differenceGroups(state.latestFinished);
  const staff = staffView(state.staffRun);
  return (
    <>
      {groups.length > 0 ? (
        <View style={styles.block}>
          <Groups groups={groups} />
          <Text style={styles.hint}>{T.differencesNote}</Text>
        </View>
      ) : null}
      {staff ? (
        <View style={styles.block}>
          <Text style={styles.groupTitle}>{staff.heading}</Text>
          <Groups groups={staff.groups} />
          <Text style={styles.body}>{staff.linkedLine}</Text>
          <Text style={styles.hint}>{T.staffNote}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6 },
  value: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text, marginBottom: SPACE.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  input: {
    flex: 1, minWidth: 140, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  ghostBtn: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md,
    minHeight: 44, justifyContent: 'center',
  },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  off: { opacity: 0.5 },
  primaryBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md,
    marginTop: SPACE.md, alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center',
  },
  primaryOff: { backgroundColor: COLORS.surfaceAlt },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  block: { marginTop: SPACE.md },
  confirm: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, gap: SPACE.xs },
  body: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 18 },
  muted: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16 },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginTop: SPACE.xs },
  error: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.critical, lineHeight: 18, marginTop: SPACE.xs },
  criticalText: { color: COLORS.critical, fontFamily: FONTS.medium },
  criticalSmall: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.critical, lineHeight: 16 },
  warning: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.warning, lineHeight: 16, marginTop: SPACE.xs },
  retry: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },
  group: { marginBottom: SPACE.sm },
  groupTitle: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  listLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 16 },
});
```

- [ ] **Step 4: Run the card test**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/DatumSyncCard.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 17 passed, 17 total`.

- [ ] **Step 5: Mock the card in the existing screen suite and add its mount test**

Two edits, then one append.

In `office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx`, replace

```tsx
jest.mock('../rooms/RoomPasteImport', () => ({ __esModule: true, default: () => null }));
```

with

```tsx
jest.mock('../rooms/RoomPasteImport', () => ({ __esModule: true, default: () => null }));
const mockDatumCardProps: Array<Record<string, unknown>> = [];
jest.mock('../rooms/DatumSyncCard', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockDatumCardProps.push(props);
      return ReactLocal.createElement(Text, null, 'kartu datum');
    },
  };
});
```

In `office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx`, replace

```tsx
beforeEach(() => {
  mockParams = undefined;
  mockBoardProps.length = 0;
});
```

with

```tsx
beforeEach(() => {
  mockParams = undefined;
  mockBoardProps.length = 0;
  mockDatumCardProps.length = 0;
});
```

Then append to the end of the same file:

```tsx


describe('RoomsAdminScreen and the DATUM card', () => {
  it('shows the card on Kelola ruangan with the project, the role and the project reload', async () => {
    const utils = render(<RoomsAdminScreen />);
    await act(async () => {});
    expect(utils.queryByText('kartu datum')).toBeNull();
    fireEvent.press(utils.getByText('Kelola ruangan'));
    await waitFor(() => expect(utils.getByText('kartu datum')).toBeTruthy());
    const props = mockDatumCardProps[mockDatumCardProps.length - 1];
    expect(props.project).toBe(mockProjectContext.project);
    expect(props.role).toBe('admin');
    expect(props.onPaired).toBe(mockProjectContext.refresh);
  });
});
```

- [ ] **Step 6: Run it and see the new test fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `FAIL` on `shows the card on Kelola ruangan with the project, the role and the project reload` (`Unable to find an element with text: kartu datum`); the digest test still passes.

- [ ] **Step 7: Mount the card**

Two edits.

In `office/screens/RoomsAdminScreen.tsx`, replace

```tsx
import RoomPasteImport from './rooms/RoomPasteImport';
```

with

```tsx
import RoomPasteImport from './rooms/RoomPasteImport';
import DatumSyncCard from './rooms/DatumSyncCard';
```

In `office/screens/RoomsAdminScreen.tsx`, replace

```tsx
            <Card title="Ekspor untuk DATUM" subtitle="Berkas JSON dalam bentuk area DATUM.">
```

with

```tsx
            <DatumSyncCard project={project} role={profile?.role} onPaired={refresh} />

            <Card title="Ekspor untuk DATUM" subtitle="Berkas JSON dalam bentuk area DATUM.">
```

- [ ] **Step 8: Run both suites and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/DatumSyncCard.test.tsx office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 2 passed, 2 total`, `Tests: 19 passed, 19 total`, no tsc output.

- [ ] **Step 9: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t5.txt` with the Write tool, exactly:

```text
feat(rooms): the DATUM card on Kelola ruangan

Pairing, Sinkron DATUM for every office role, the last run as written,
the automatic-sync line, Ambil n ruangan dari DATUM with an inline
confirmation naming DATUM's project and every area, the differences and
the staff not yet linked. Nothing changes on screen before the server
answers.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add office/screens/rooms/DatumSyncCard.tsx office/screens/rooms/__tests__/DatumSyncCard.test.tsx office/screens/RoomsAdminScreen.tsx office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t5.txt" -- office/screens/rooms/DatumSyncCard.tsx office/screens/rooms/__tests__/DatumSyncCard.test.tsx office/screens/RoomsAdminScreen.tsx office/screens/__tests__/RoomsAdminScreen.digestDeeplink.test.tsx
```

### U-T6 (Lane U, Task 6): DATUM's readiness on Papan Ruangan

Spec §8.2. `RoomBoardView` reads `listDatumGateStatus` inside `load` (`:81-107`), beside `listRoomBoard` rather than before it, so focus and pull-to-refresh reload both and a slow DATUM read never holds the board back; a project switch clears it. A failed read is one line under the summary card with "Coba lagi"; each room shows `DatumRoomLine` under its meta line (`:273-278`): nothing, "Status DATUM belum tersinkron", "DATUM belum punya status untuk ruangan ini", or DATUM's chips (a blocked gate in the critical colour, all grey when old) with "per DATUM 10.00", "· lama" and "· sebagian menunggu hitung ulang di DATUM". SANO's own "Gerbang {code}" meta stays. The existing attention suite mocks the DATUM read as unpaired so it keeps testing only what it tested.

**Files:**
- Create: `office/screens/rooms/DatumRoomLine.tsx`
- Modify: `office/screens/rooms/RoomBoardView.tsx` (six edits)
- Create: `office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx`
- Modify: `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx` (one mock)

**Depends on:** U-T2.

- [ ] **Step 1: Write the failing test**

Create `office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx` with exactly this content:

```tsx
// office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx
//
// DATUM sync spec 2026-09-27 §8.2: DATUM's readiness per room on Papan
// Ruangan, exactly as DATUM states it. While its read is under way nothing
// about DATUM shows; a failed read is one line with "Coba lagi"; an unpaired
// project shows nothing; a room SANO knows nothing about says so.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const ReactLocal = require('react');
    ReactLocal.useEffect(() => effect(), [effect]);
  },
}));
jest.mock('../../../../tools/roomBoard', () => {
  const actual = jest.requireActual('../../../../tools/roomBoard');
  return { ...actual, listRoomBoard: jest.fn() };
});
jest.mock('../../../../tools/datumGateStatus', () => {
  const actual = jest.requireActual('../../../../tools/datumGateStatus');
  return { ...actual, listDatumGateStatus: jest.fn() };
});
jest.mock('../../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => []),
  pendingCloseFor: jest.fn(() => undefined),
}));
jest.mock('../AttentionList', () => ({ __esModule: true, default: () => null }));
jest.mock('../DigestHealthLine', () => ({ __esModule: true, default: () => null }));

import { listRoomBoard } from '../../../../tools/roomBoard';
import { listDatumGateStatus, type DatumGateRow, type DatumGateStatusResult } from '../../../../tools/datumGateStatus';
import type { RoomBoardRow } from '../../../../tools/types';
import RoomBoardView from '../RoomBoardView';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const board = listRoomBoard as jest.Mock;
const datumRead = listDatumGateStatus as jest.Mock;

const room = (over: Partial<RoomBoardRow> = {}): RoomBoardRow => ({
  room_id: 'r1', project_id: 'p1', room_code: 'LT1-KM-1', room_name: 'Kamar Mandi 1', floor: '1', sort_order: 0,
  area_type: 'bathroom', active: true, open_progres: 0, open_isu: 0, open_hambatan: 0, open_cacat: 0,
  open_butuh_keputusan: 0, open_info: 0, overdue_count: 0, last_event_at: null, last_gate_code: null,
  last_step_code: null, is_quiet: false, owner_initials: [], ...over,
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const gateRow = (over: Partial<DatumGateRow> = {}): DatumGateRow => ({
  room_id: 'r1', gate_code: 'A', datum_area_id: 'a1', status: 'passed', datum_stale: false, synced_at: hoursAgo(1), ...over,
});
const paired = (over: Partial<Extract<DatumGateStatusResult, { paired: true }>> = {}): DatumGateStatusResult => ({
  paired: true, lastGateReadAt: hoursAgo(1), readAreaIds: ['a1', 'a2'], roomLinks: { r1: 'a1', r2: null }, rows: [gateRow()], ...over,
});

const renderBoard = () => render(<RoomBoardView projectId="p1" viewerId="u1" onOpenRoom={jest.fn()} onOpenEvent={jest.fn()} />);

beforeEach(() => {
  jest.clearAllMocks();
  board.mockResolvedValue({ rooms: [room(), room({ room_id: 'r2', room_code: 'LT1-DAPUR', room_name: 'Dapur', sort_order: 1 })] });
});

describe('RoomBoardView and DATUM readiness', () => {
  it('says nothing about DATUM while its read is under way, and never holds the board back', async () => {
    datumRead.mockReturnValue(new Promise(() => {}));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('Kamar Mandi 1')).toBeTruthy());
    expect(utils.queryByText(/DATUM/)).toBeNull();
  });

  it('shows one error line with Coba lagi on a failed read, and no room pretends to know', async () => {
    datumRead.mockResolvedValueOnce({ error: 'offline' }).mockResolvedValueOnce(paired());
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('Status DATUM gagal dimuat.')).toBeTruthy());
    expect(utils.queryByText('Status DATUM belum tersinkron')).toBeNull();
    await act(async () => { fireEvent.press(utils.getByText('Coba lagi')); });
    await waitFor(() => expect(utils.getByText('A lolos')).toBeTruthy());
    expect(datumRead).toHaveBeenCalledTimes(2);
  });

  it('shows nothing for an unpaired project', async () => {
    datumRead.mockResolvedValue({ paired: false });
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('Kamar Mandi 1')).toBeTruthy());
    await act(async () => {});
    expect(utils.queryByText(/DATUM/)).toBeNull();
  });

  it("shows chips with DATUM's labels and the read time, and says never for an unlinked room", async () => {
    datumRead.mockResolvedValue(paired({ rows: [gateRow({ gate_code: 'B', status: 'blocked' }), gateRow()] }));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText('A lolos')).toBeTruthy());
    expect(utils.getByText('B terhambat')).toBeTruthy();
    expect(utils.getByText(/^per DATUM /)).toBeTruthy();
    expect(utils.getByText('Status DATUM belum tersinkron')).toBeTruthy();
  });

  it('says DATUM holds nothing for a linked room with no row, ignoring rows read for another area', async () => {
    datumRead.mockResolvedValue(paired({ roomLinks: { r1: 'a1', r2: 'a2' }, rows: [gateRow({ room_id: 'r2', datum_area_id: 'old-area' })] }));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getAllByText('DATUM belum punya status untuk ruangan ini')).toHaveLength(2));
  });

  it('marks chips older than 24 hours "lama", and says when DATUM itself has not recomputed', async () => {
    datumRead.mockResolvedValue(paired({ rows: [gateRow({ synced_at: hoursAgo(25), datum_stale: true })] }));
    const utils = renderBoard();
    await waitFor(() => expect(utils.getByText(/ · lama · sebagian menunggu hitung ulang di DATUM$/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Tests: 4 failed, 2 passed, 6 total`: the four that expect DATUM text fail (`Unable to find an element with text: Status DATUM gagal dimuat.` and the like); the two that expect no DATUM text (while loading, unpaired) pass already, as they must.

- [ ] **Step 3: Write the room line**

Create `office/screens/rooms/DatumRoomLine.tsx` with exactly this content:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DATUM_BOARD_COPY, type DatumChipState } from '../../../tools/datumGateStatus';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';

/**
 * DATUM's readiness for one room on Papan Ruangan (spec 2026-09-27 §8.2),
 * under the room's own meta line. DATUM's word per gate, the time SANO read
 * it, "lama" past 24 hours; or the one sentence that says what is unknown.
 * It sits beside SANO's own "Gerbang X" meta, which is where SANO's latest
 * event was filed, not a readiness verdict.
 */
export default function DatumRoomLine({ state }: { state: DatumChipState }) {
  if (state.kind === 'hidden') return null;
  if (state.kind === 'never') return <Text style={styles.muted}>{DATUM_BOARD_COPY.never}</Text>;
  if (state.kind === 'none') return <Text style={styles.muted}>{DATUM_BOARD_COPY.none}</Text>;
  const tail = `per DATUM ${state.asOf}${state.old ? ` · ${DATUM_BOARD_COPY.old}` : ''}${state.datumStale ? ` · ${DATUM_BOARD_COPY.datumStale}` : ''}`;
  return (
    <View style={styles.row}>
      {state.chips.map((c) => {
        const blocked = c.status === 'blocked' && !state.old;
        return (
          <View key={c.gate_code} style={[styles.chip, blocked && styles.chipBlocked, state.old && styles.chipOld]}>
            <Text style={[styles.chipText, blocked && styles.textBlocked, state.old && styles.textOld]}>
              {c.gate_code} {c.label}
            </Text>
          </View>
        );
      })}
      <Text style={styles.muted}>{tail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center', marginTop: SPACE.xs },
  chip: { backgroundColor: COLORS.infoBg, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipBlocked: { backgroundColor: COLORS.criticalBg },
  chipOld: { backgroundColor: COLORS.surfaceSunken },
  chipText: { fontSize: 10, fontFamily: FONTS.semibold, color: COLORS.info },
  textBlocked: { color: COLORS.critical },
  textOld: { color: COLORS.textMuted },
  muted: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
});
```

- [ ] **Step 4: Read and render DATUM in the board**

Six edits, in file order.

In `office/screens/rooms/RoomBoardView.tsx`, replace

```tsx
import AttentionList from './AttentionList';
import DigestHealthLine from './DigestHealthLine';
```

with

```tsx
import AttentionList from './AttentionList';
import DigestHealthLine from './DigestHealthLine';
import DatumRoomLine from './DatumRoomLine';
import {
  DATUM_BOARD_COPY, datumChipsForRoom, listDatumGateStatus, type DatumGateStatusResult,
} from '../../../tools/datumGateStatus';
```

In `office/screens/rooms/RoomBoardView.tsx`, replace

```tsx
  const [filters, setFilters] = useState<BoardFilters>({});
```

with

```tsx
  const [filters, setFilters] = useState<BoardFilters>({});
  // DATUM's readiness (spec 2026-09-27 §8.2): null until its read answers, so
  // nothing about DATUM shows while loading. Read beside the board, not
  // before it: a slow DATUM cache never holds the board back.
  const [datum, setDatum] = useState<DatumGateStatusResult | null>(null);
```

In `office/screens/rooms/RoomBoardView.tsx`, replace

```tsx
    if (!projectId) {
      rowsFor.current = null;
      setRows([]);
      setLoadError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!opts.silent || rowsFor.current !== projectId) setLoading(true);
    const result = await listRoomBoard(projectId);
```

with

```tsx
    if (!projectId) {
      rowsFor.current = null;
      setRows([]);
      setDatum(null);
      setLoadError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!opts.silent || rowsFor.current !== projectId) {
      setLoading(true);
      setDatum(null);
    }
    void listDatumGateStatus(projectId).then((next) => {
      if (id === request.current) setDatum(next);
    });
    const result = await listRoomBoard(projectId);
```

In `office/screens/rooms/RoomBoardView.tsx`, replace

```tsx
      <Card title="Saringan">
```

with

```tsx
      {datum && 'error' in datum ? (
        <View style={styles.datumError}>
          <Text style={styles.errorText}>{DATUM_BOARD_COPY.readError}</Text>
          <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={styles.datumRetry}>
            <Text style={styles.clear}>{DATUM_BOARD_COPY.retry}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Card title="Saringan">
```

In `office/screens/rooms/RoomBoardView.tsx`, replace

```tsx
                {' · '}{lastUpdateLabel(r.last_event_at)}
              </Text>
```

with

```tsx
                {' · '}{lastUpdateLabel(r.last_event_at)}
              </Text>
              <DatumRoomLine state={datumChipsForRoom(r, datum, new Date().toISOString())} />
```

In `office/screens/rooms/RoomBoardView.tsx`, replace

```tsx
  inactiveNote: {
```

with

```tsx
  datumError: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', marginBottom: SPACE.sm, paddingHorizontal: SPACE.xs },
  datumRetry: { minHeight: 44, justifyContent: 'center' },
  inactiveNote: {
```

- [ ] **Step 5: Keep the attention suite on its own subject**

In `office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx`, replace

```tsx
let mockEntries: Array<Record<string, unknown>> = [];
```

with

```tsx
// DATUM's readiness has its own suite (RoomBoardView.datum.test.tsx).
jest.mock('../../../../tools/datumGateStatus', () => {
  const actual = jest.requireActual('../../../../tools/datumGateStatus');
  return { ...actual, listDatumGateStatus: jest.fn(async () => ({ paired: false })) };
});
let mockEntries: Array<Record<string, unknown>> = [];
```

- [ ] **Step 6: Run both board suites and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest office/screens/rooms/__tests__/RoomBoardView --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 2 passed, 2 total`, `Tests: 10 passed, 10 total`, no tsc output.

- [ ] **Step 7: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t6.txt` with the Write tool, exactly:

```text
feat(rooms): DATUM's readiness chips on Papan Ruangan

One chip per gate in DATUM's own word with the time SANO read it, grey
and lama past 24 hours; never, none and a read error each say what they
are. Read beside the board, so a slow DATUM cache never holds it back.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add office/screens/rooms/DatumRoomLine.tsx office/screens/rooms/RoomBoardView.tsx office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t6.txt" -- office/screens/rooms/DatumRoomLine.tsx office/screens/rooms/RoomBoardView.tsx office/screens/rooms/__tests__/RoomBoardView.datum.test.tsx office/screens/rooms/__tests__/RoomBoardView.attention.test.tsx
```

### U-T7 (Lane U, Task 7): The event detail: the confirmer, and the decision's way to DATUM

Spec §8.3, §4.3. `EVENT_SELECT` (`tools/siteEvents.ts:374-375`) already takes `*`, so the four 107 columns arrive (typed optional on `SiteEvent`: `select('*')` has no such keys before 107 is pasted); it gains `confirmer:profiles!site_events_confirmed_by_fkey(full_name)` and `project:projects(datum_project_code)`, mapped to `confirmed_by_name` and `project_datum_code`. That embed names a foreign key 107 creates, so 107 must be pasted before this code is merged (see *Release*, step 2, and *Deliberate differences*). In "Tanggung jawab" (`SiteEventDetailScreen.tsx:311-335`) the "Dikonfirmasi" row (`:316`) adds "· oleh {name}" only when the confirmer is known; a card shows "Dikirim ke DATUM" with its time and "Buka kartu DATUM" (`Linking.openURL`); an open `butuh_keputusan` without a card on a paired project reads "Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya." Nothing about DATUM shows otherwise.

**Files:**
- Modify: `tools/types.ts` (the end of `SiteEvent`)
- Modify: `tools/siteEvents.ts` (four edits)
- Modify: `tools/__tests__/siteEvents.test.ts` (append)
- Create: `workflows/screens/siteEvent/datumEscalation.ts`
- Modify: `workflows/screens/SiteEventDetailScreen.tsx` (four edits)
- Create: `workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx`

**Depends on:** U-T6 (same lane, for order only).

- [ ] **Step 1: Write the failing screen test**

Create `workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx` with exactly this content:

```tsx
// workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx
//
// DATUM sync spec 2026-09-27 §8.3: the event detail says who confirmed it
// when that is known, when a decision went to DATUM (with its card), or that
// it will go on the next sync; and nothing about DATUM on an unpaired project.
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getState: () => ({ routeNames: [] }) }),
  useRoute: () => ({ params: { eventId: 'ev1', projectId: 'p1' } }),
}));
jest.mock('../../components/Header', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useProject', () => ({ useProject: () => ({ profile: { id: 'u1', role: 'admin' } }) }));
jest.mock('../../../tools/siteEvents', () => ({ getSiteEventResult: jest.fn(), getSiteEvent: jest.fn() }));
jest.mock('../../../tools/gateRefs', () => ({
  listGateRefs: jest.fn(async () => []),
  listGateStepRefs: jest.fn(async () => []),
  gateChipLabel: jest.fn(() => ''),
  stepChipLabel: jest.fn(() => ''),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../../../tools/captureQueueStore', () => ({
  useCaptureQueueEntries: jest.fn(() => []),
  pendingCloseFor: jest.fn(() => undefined),
  supersededCloseFor: jest.fn(() => undefined),
  unreadableCloseFor: jest.fn(() => undefined),
  acknowledgeCloseEntry: jest.fn(),
  discardEntryLocally: jest.fn(),
}));
jest.mock('../../../tools/captureQueueWorker', () => ({ retryQueueEntry: jest.fn() }));
jest.mock('../siteEvent/MediaStrip', () => ({ __esModule: true, default: () => null }));
jest.mock('../siteEvent/ClosureForm', () => ({ __esModule: true, default: () => null }));

import { getSiteEventResult } from '../../../tools/siteEvents';
import SiteEventDetailScreen from '../SiteEventDetailScreen';

// Rendering suites run slowly beside the full jest run; the 5 s default flakes.
jest.setTimeout(20000);

const baseEvent = {
  id: 'ev1', project_id: 'p1', room_id: 'r1', reporter_id: 'u1', status: 'open', event_type: 'butuh_keputusan',
  gate_code: null, step_code: null, title: 'Pilih warna nat', summary: null, raw_text: null, transcript: null,
  transcript_edited: null, ai_draft: null, ai_confidence: null, ai_mismatch: false, ai_model: null, ai_used: false,
  owner_id: 'u1', due_date: '2026-10-01', downstream_impact: null, is_blocking: false, vo_flag: 'none',
  site_change_id: null, related_event_id: null, captured_at: '2026-09-26T02:00:00.000Z', created_at: '2026-09-26T02:00:00.000Z',
  confirmed_at: '2026-09-26T03:00:00.000Z', closed_at: null, closed_by: null, closure_note: null, last_error: null,
  analysis_attempts: 0, room_name: 'Kamar Mandi 1', room_floor: 'Lt. 1', owner_name: 'Budi', reporter_name: 'Budi',
  closed_by_name: null, media: [], datum_card_id: null, datum_card_url: null, datum_escalated_at: null, confirmed_by: null,
  confirmed_by_name: null, project_datum_code: 'K2-7',
};

const show = (over: Record<string, unknown>) => {
  (getSiteEventResult as jest.Mock).mockResolvedValue({ event: { ...baseEvent, ...over } });
  return render(<SiteEventDetailScreen />);
};

beforeEach(() => jest.clearAllMocks());

describe('SiteEventDetailScreen and DATUM', () => {
  it('shows when the decision went to DATUM and opens its card', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const utils = show({
      datum_card_id: 'card-1', datum_card_url: 'https://datum.example/project/k2-7/cards/pilih-warna-nat',
      datum_escalated_at: '2026-09-27T03:00:00.000Z',
    });
    await waitFor(() => expect(utils.getByText('Dikirim ke DATUM')).toBeTruthy());
    expect(utils.getByText('27 Sep 10.00')).toBeTruthy();
    fireEvent.press(utils.getByText('Buka kartu DATUM'));
    expect(open).toHaveBeenCalledWith('https://datum.example/project/k2-7/cards/pilih-warna-nat');
    expect(utils.queryByText('Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.')).toBeNull();
    open.mockRestore();
  });

  it('says an open decision on a paired project goes on the next sync', async () => {
    const utils = show({});
    await waitFor(() => expect(utils.getByText('Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.')).toBeTruthy());
    expect(utils.queryByText('Dikirim ke DATUM')).toBeNull();
  });

  it('says nothing about DATUM on an unpaired project, or for a closed or other event', async () => {
    for (const over of [{ project_datum_code: null }, { status: 'done' }, { event_type: 'isu' }]) {
      const utils = show(over);
      await waitFor(() => expect(utils.getByText('Tanggung jawab')).toBeTruthy());
      expect(utils.queryByText(/DATUM/)).toBeNull();
      utils.unmount();
    }
  });

  it('adds "oleh" to Dikonfirmasi only when the confirmer is known', async () => {
    const known = show({ confirmed_by: 'u2', confirmed_by_name: 'Siti Aminah' });
    await waitFor(() => expect(known.getByText(/ · oleh Siti Aminah$/)).toBeTruthy());
    known.unmount();
    const unknown = show({});
    await waitFor(() => expect(unknown.getByText('Dikonfirmasi')).toBeTruthy());
    expect(unknown.queryByText(/oleh/)).toBeNull();
  });
});
```

Then append to the end of `tools/__tests__/siteEvents.test.ts`:

```ts


describe('getSiteEventResult and DATUM (migration 107)', () => {
  it("asks for the confirmer through 107's foreign key and for the project's DATUM pairing", async () => {
    mocked.from.mockImplementationOnce(() => makeChain({ data: null, error: null }));
    await getSiteEventResult(EVENT);
    const select = calls.find((c) => c.startsWith('select:')) ?? '';
    expect(select).toContain('confirmer:profiles!site_events_confirmed_by_fkey(full_name)');
    expect(select).toContain('project:projects(datum_project_code)');
  });

  it('names the confirmer, carries the pairing and the card, and drops the embeds', async () => {
    mocked.from.mockImplementationOnce(() =>
      makeChain({
        data: {
          id: EVENT, project_id: PROJECT, title: 'Pilih nat', status: 'open', site_event_media: [], rooms: null,
          owner: null, reporter: null, closer: null, confirmer: { full_name: 'Siti Aminah' },
          project: { datum_project_code: 'K2-7' }, confirmed_by: 'u2', datum_card_id: 'card-1',
        },
        error: null,
      }),
    );
    const r = await getSiteEventResult(EVENT);
    expect(r.event?.confirmed_by_name).toBe('Siti Aminah');
    expect(r.event?.project_datum_code).toBe('K2-7');
    expect(r.event?.datum_card_id).toBe('card-1');
    expect((r.event as unknown as { confirmer?: unknown; project?: unknown }).confirmer).toBeUndefined();
    expect((r.event as unknown as { confirmer?: unknown; project?: unknown }).project).toBeUndefined();
  });

  it('leaves both null when the joins find nothing: an unknown confirmer is never guessed', async () => {
    mocked.from.mockImplementationOnce(() =>
      makeChain({ data: { id: EVENT, project_id: PROJECT, site_event_media: [], confirmer: null, project: null }, error: null }),
    );
    const r = await getSiteEventResult(EVENT);
    expect(r.event?.confirmed_by_name).toBeNull();
    expect(r.event?.project_datum_code).toBeNull();
  });
});
```

- [ ] **Step 2: Run both and see them fail**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx tools/__tests__/siteEvents.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Test Suites: 2 failed`: `siteEvents.test.ts` does not compile (`TS2339: Property 'confirmed_by_name' does not exist on type 'SiteEventWithMedia'`), and in the screen suite three tests fail (no "Dikirim ke DATUM", no "Belum dikirim ke DATUM", no "oleh") while the one that expects no DATUM text passes.

- [ ] **Step 3: Type the four 107 columns on `SiteEvent`**

In `tools/types.ts`, replace

```ts
  /** Service role only. Counts failed analysis attempts. */
  analysis_attempts: number;
}
```

with

```ts
  /** Service role only. Counts failed analysis attempts. */
  analysis_attempts: number;
  /**
   * Migration 107, written only by the datum-sync function: the DATUM decision
   * card this event became. Optional because select('*') returns no such key
   * before 107 is pasted.
   */
  datum_card_id?: string | null;
  datum_card_url?: string | null;
  datum_escalated_at?: string | null;
  /** Migration 107: stamped by a trigger inside confirm_site_event. NULL for events confirmed before 107. */
  confirmed_by?: string | null;
}
```

- [ ] **Step 4: Read the confirmer and the pairing with every event**

Four edits, in file order.

In `tools/siteEvents.ts`, replace

```ts
  /** Who closed the event, via `closed_by` -> profiles. Null when unclosed or the join found no row. */
  closed_by_name: string | null;
}
```

with

```ts
  /** Who closed the event, via `closed_by` -> profiles. Null when unclosed or the join found no row. */
  closed_by_name: string | null;
  /** Who confirmed it, via `confirmed_by` (107) -> profiles. Null when unknown: never guessed. */
  confirmed_by_name: string | null;
  /** The project's DATUM pairing, so the detail can say an escalation is still to come. */
  project_datum_code: string | null;
}
```

In `tools/siteEvents.ts`, replace

```ts
const EVENT_SELECT =
  '*, site_event_media(*), rooms(room_name, floor), owner:profiles!site_events_owner_id_fkey(full_name), reporter:profiles!site_events_reporter_id_fkey(full_name), closer:profiles!site_events_closed_by_fkey(full_name)';
```

with

```ts
// The confirmer embed names 107's site_events_confirmed_by_fkey: paste 107
// before this code ships (Release step 2), or every detail read fails.
const EVENT_SELECT =
  '*, site_event_media(*), rooms(room_name, floor), owner:profiles!site_events_owner_id_fkey(full_name), reporter:profiles!site_events_reporter_id_fkey(full_name), closer:profiles!site_events_closed_by_fkey(full_name), confirmer:profiles!site_events_confirmed_by_fkey(full_name), project:projects(datum_project_code)';
```

In `tools/siteEvents.ts`, replace

```ts
    closer?: { full_name?: string } | null;
  };
  const { site_event_media, rooms, owner, reporter, closer, ...event } = row;
```

with

```ts
    closer?: { full_name?: string } | null;
    confirmer?: { full_name?: string } | null;
    project?: { datum_project_code?: string | null } | null;
  };
  const { site_event_media, rooms, owner, reporter, closer, confirmer, project, ...event } = row;
```

In `tools/siteEvents.ts`, replace

```ts
      closed_by_name: closer?.full_name ?? null,
    },
  };
```

with

```ts
      closed_by_name: closer?.full_name ?? null,
      confirmed_by_name: confirmer?.full_name ?? null,
      project_datum_code: project?.datum_project_code ?? null,
    },
  };
```

- [ ] **Step 5: Write the detail's DATUM words**

Create `workflows/screens/siteEvent/datumEscalation.ts` with exactly this content:

```ts
// What the event detail says about DATUM (spec 2026-09-27 §8.3). Pure.
// Only the server's record counts: "Dikirim" needs the card id the sync
// stored after DATUM answered; "Belum dikirim" is said only where a sync
// would send it (an open butuh_keputusan on a paired project).

import { formatWibShort } from '../../../tools/timeWindow';
import type { SiteEventWithMedia } from '../../../tools/siteEvents';

export type DatumEscalationView =
  | { kind: 'sent'; label: string; url: string | null }
  | { kind: 'waiting'; label: string }
  | { kind: 'none' };

export const DATUM_DETAIL_COPY = {
  sentLabel: 'Dikirim ke DATUM',
  open: 'Buka kartu DATUM',
  waiting: 'Belum dikirim ke DATUM. Terkirim pada sinkron berikutnya.',
} as const;

export function datumEscalationView(
  ev: Pick<SiteEventWithMedia, 'status' | 'event_type' | 'datum_card_id' | 'datum_card_url' | 'datum_escalated_at' | 'project_datum_code'>,
): DatumEscalationView {
  if (ev.datum_card_id) {
    return {
      kind: 'sent',
      label: ev.datum_escalated_at ? formatWibShort(ev.datum_escalated_at) : '—',
      url: ev.datum_card_url ?? null,
    };
  }
  if (ev.status === 'open' && ev.event_type === 'butuh_keputusan' && ev.project_datum_code) {
    return { kind: 'waiting', label: DATUM_DETAIL_COPY.waiting };
  }
  return { kind: 'none' };
}

/** "27 Sep 10.00 · oleh Siti" when the confirmer is known; the time alone otherwise. */
export function confirmedLine(when: string, confirmerName: string | null): string {
  return confirmerName ? `${when} · oleh ${confirmerName}` : when;
}
```

- [ ] **Step 6: Show them in Tanggung jawab**

Four edits.

In `workflows/screens/SiteEventDetailScreen.tsx`, replace

```tsx
import { Alert, Platform, ScrollView, View, Text, TouchableOpacity } from 'react-native';
```

with

```tsx
import { Alert, Linking, Platform, ScrollView, View, Text, TouchableOpacity } from 'react-native';
```

In `workflows/screens/SiteEventDetailScreen.tsx`, replace

```tsx
import ClosureForm from './siteEvent/ClosureForm';
```

with

```tsx
import ClosureForm from './siteEvent/ClosureForm';
import { DATUM_DETAIL_COPY, confirmedLine, datumEscalationView } from './siteEvent/datumEscalation';
```

In `workflows/screens/SiteEventDetailScreen.tsx`, replace

```tsx
function formatDateTime(iso: string): string {
```

with

```tsx
function DatumEscalationRows({ event }: { event: SiteEventWithMedia }) {
  const view = datumEscalationView(event);
  if (view.kind === 'none') return null;
  if (view.kind === 'waiting') return <Text style={s.hint}>{view.label}</Text>;
  return (
    <>
      <Row label={DATUM_DETAIL_COPY.sentLabel} value={view.label} />
      {view.url ? (
        <TouchableOpacity style={s.row} onPress={() => void Linking.openURL(view.url as string)} accessibilityRole="link">
          <Text style={[s.rowValue, { color: COLORS.primary }]}>{DATUM_DETAIL_COPY.open}</Text>
        </TouchableOpacity>
      ) : null}
    </>
  );
}

function formatDateTime(iso: string): string {
```

In `workflows/screens/SiteEventDetailScreen.tsx`, replace

```tsx
              {event.confirmed_at ? <Row label="Dikonfirmasi" value={formatDateTime(event.confirmed_at)} /> : null}
```

with

```tsx
              {event.confirmed_at ? (
                <Row label="Dikonfirmasi" value={confirmedLine(formatDateTime(event.confirmed_at), event.confirmed_by_name)} />
              ) : null}
              <DatumEscalationRows event={event} />
```

- [ ] **Step 7: Run the detail suites, the siteEvents suite and the type check**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest workflows/screens/__tests__/SiteEventDetailScreen tools/__tests__/siteEvents.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' && npx tsc --noEmit -p .
```

Expected: `Test Suites: 3 passed, 3 total` (the new suite, the existing `pendingClose` suite, `siteEvents.test.ts`), no tsc output.

- [ ] **Step 8: Commit**

Write `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t7.txt` with the Write tool, exactly:

```text
feat(site-events): the confirmer, and the decision's way to DATUM, on the detail

EVENT_SELECT embeds the confirmer through 107's site_events_confirmed_by_fkey
and the project's DATUM pairing. Dikonfirmasi adds oleh {name} only when
known; a sent decision shows its time and Buka kartu DATUM; an open
decision on a paired project says it goes on the next sync.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Then:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && git add tools/types.ts tools/siteEvents.ts tools/__tests__/siteEvents.test.ts workflows/screens/siteEvent/datumEscalation.ts workflows/screens/SiteEventDetailScreen.tsx workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx && git commit -F "/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/u-t7.txt" -- tools/types.ts tools/siteEvents.ts tools/__tests__/siteEvents.test.ts workflows/screens/siteEvent/datumEscalation.ts workflows/screens/SiteEventDetailScreen.tsx workflows/screens/__tests__/SiteEventDetailScreen.datum.test.tsx
```

---

## After the four lanes: integration check

Whoever merges runs this once, after all 25 task commits are in (6 DATUM, 19 SANO).

- [ ] **Step 1: SANO, every touched suite together**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx jest tools/__tests__/datumSync tools/__tests__/datumGateStatus tools/__tests__/migration tools/__tests__/siteEvents tools/__tests__/rooms tools/__tests__/roomCodes tools/__tests__/roomLinks office/screens workflows/screens/__tests__ workflows/__tests__/GateChipRow --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Expected: `Test Suites: 49 passed, 49 total` (`Tests: 44 skipped, 985 passed`; the skips are existing live-database suites).

- [ ] **Step 2: SANO type check, the function, and nothing left behind**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && npx tsc --noEmit -p . && cmp tools/datumSyncPlan.ts supabase/functions/datum-sync/plan.ts && cd supabase/functions/datum-sync && deno check index.ts && deno test && deno lint && rm -f deno.lock && cd ../../.. && git status --porcelain && git log --oneline b81706c..HEAD | wc -l
```

Expected: no tsc output, no `cmp` output, `Check index.ts`, `ok | 30 passed | 0 failed`, no lint problem, no status lines (or only `assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx`, which must then be restored with `git restore assets/BOQ/SANO_ActualParserOutput_AAL5.xlsx`), and `20` commits: the plan and the nineteen SANO tasks.

- [ ] **Step 3: SANO rehearsal, if Lane M Task 2 ran on an older 107**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/datum-sync" && supabase/tests/datum_sync_rehearsal/run.sh --stop
```

Expected: `PASS=72 FAIL=0 ERROR=0`.

- [ ] **Step 4: DATUM, what CI runs**

```bash
cd "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/.claude/worktrees/sano-integration" && pnpm typecheck && pnpm test && pnpm --filter web lint && git status --porcelain && git log --oneline ff2f0b3..HEAD | wc -l
```

Expected: every turbo task passes (`apps/web`: `Test Files  123 passed (123)`), no lint error, no status lines, and `6` commits.

---

## Release (the owner's steps, from spec §13; no agent pastes, sets a secret or deploys)

1. **DATUM.** Merge the DATUM PR; Vercel deploys it. Create the author row once: in DATUM's Supabase Dashboard, Authentication → Add user (an address nobody reads, a long random password nobody keeps: this user never signs in), copy its id, then in the SQL editor:
   ```sql
   insert into public.staff (id, full_name, role, active)
   values ('<AUTH_USER_ID>', 'SANO (sistem)', 'studio_staff', false)
   on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = false;
   ```
   In Vercel (production) set `SANO_INTEGRATION_SECRET` to a new long random value (for example `openssl rand -hex 32`) and `SANO_INTEGRATION_STAFF_ID` to that id, then redeploy so the functions read them. From a DATUM checkout of `main`: `pnpm db:preflight`, and only if it exits 0, `pnpm db:migrate` (adds `cards_sano_event_id_key`; `docs/DEPLOY.md:21-35`). Until the index is pushed, repeats are still caught by the lookup; only two truly simultaneous calls could make two cards, which SANO's one-run-per-project lock prevents.
2. **SANO, migration first.** Paste **107** (after 106) in the SANO Dashboard SQL editor and run its self-check. If it printed `107: pg_cron belum aktif`, enable Cron (Integrations → Cron) and paste 107 again; `select jobname, schedule from cron.job where jobname = 'datum_sync_hourly';` must show `0 * * * *`. Do this **before** merging the SANO PR: the web app deploys on merge, and its event detail read embeds `site_events_confirmed_by_fkey`, which 107 creates. 107 is safe for the old app (it writes none of 107's columns). The gate words reach every phone at once. Re-pasting 101 later restores the old words (re-paste 107 after it); a 107 re-paste overwrites "Kelola gerbang" edits.
3. **SANO PR.** Merge it (Vercel deploys the web app).
4. **The function.** From a SANO worktree on `main`: run `cd supabase/functions/datum-sync && deno test` (CI does not). Write a temporary env file outside the repo with two lines, `DATUM_API_BASE_URL=<DATUM's production origin, no trailing path>` and `DATUM_SANO_SECRET=<the same value as SANO_INTEGRATION_SECRET>`, then `supabase secrets set --env-file <that file> --project-ref ufntlqvacjhmddwltcxf` and delete the file. `WEBHOOK_AUTH_SECRET` is already set (034). Deploy: `supabase functions deploy datum-sync --no-verify-jwt --project-ref ufntlqvacjhmddwltcxf --use-api`.
5. **The Database Webhook, once** (as 034 did for notifications): Dashboard → Database → Webhooks → new: table `public.datum_sync_requests`, event `INSERT`, method POST to the `datum-sync` function URL (`https://ufntlqvacjhmddwltcxf.supabase.co/functions/v1/datum-sync`), header `Authorization: Bearer <WEBHOOK_AUTH_SECRET>`, timeout at its maximum.
6. **Pair.** In the office app, Ruangan → Kelola ruangan → DATUM: enter the DATUM codes for Gading Serpong Zelyn, Citraland K2-7 Sonny and Bukit Darmo Golf D-18 Selvia (admin, principal or estimator).
7. **First sync, Citraland first.** "Sinkron DATUM"; read "DATUM: {name}" (is it the right DATUM project?) and every difference before the other two. Where DATUM already holds the rooms, the create step says so and "Ambil n ruangan dari DATUM" appears: confirm the list, take them, then sync again.
8. **Names.** Read "Staf belum tertaut" (on live data at planning time: 39 SANO profiles, 55 active DATUM staff, 28 exact unique matches). Make the names of the people who report and confirm decisions agree in SANO or DATUM (same spelling; accents, case and spacing do not matter) and sync again until they are linked. Until then their cards are authored by SANO (sistem) and the note names them.
9. **The hourly path.** After the next full hour, the card's "Sinkron terakhir" should read "otomatis"; if the card says "Sinkron otomatis menunggu", check the webhook (step 5).
10. **OTA** from `main`, channel `preview`, the way the last update was published: board chips, the detail rows and the four new room types reach phones; no native module, so no build. Old phones lack only those.

---

## Spec coverage

| Spec | Where |
|---|---|
| §1.1 rule 1 (DATUM's word, never inferred) | M-T1 (cache CHECK, verbatim), F-T8 (stored as read), U-T2 (fixed labels, no derivation), U-T6 |
| §1.1 rule 2 (old marked old, missing never "no news") | U-T2 (never / none / chips, 24 h), U-T6 (read-error line), U-T4/U-T5 (card read errors); `gate_area_ids` (F-T1, F-T8, U-T2) makes "none" exact |
| §1.1 rule 3 (links only by the sync, names only on unique match) | M-T1 (three guards), F-T4 (planStaffLinks), F-T10 (store writes where NULL), M-T2 (as real roles) |
| §1.1 rule 4 (nothing merged, renamed or deleted) | D-T4 (insert-only), F-T2 (conflicts listed), F-T3 (import only on confirmation), D-T6 and F-T10 (no update/delete pinned) |
| §1.1 rule 5 (a decision reaches DATUM once) | D-T1 (index), D-T5 (idempotent route), F-T8 (card id stored after the answer; heal on repeat) |
| §1.1 rule 6 (failed steps recorded) | F-T1 (`runVerdict`, `step_errors`), F-T8, U-T4, U-T5 |
| §2 decisions 1-3 (DATUM's words, short labels, drift reported) | M-T1, F-T5 (`diffGateWords`), F-T8 (`gate_words`), U-T4 |
| §2 decision 4 (shared bearer, service role, project scoping) | D-T2, D-T3-D-T6 |
| §2 decisions 5-7 (rooms pushed, import once, retired linked not created, UMUM untracked) | F-T2, F-T3, F-T8, D-T4 |
| §2 decision 8 (authors, UMUM list, decision + note) | D-T5, F-T5, F-T8 |
| §2 decision 9 (`sano_url`) | F-T5 (`sanoRoomUrl` = `buildRoomUrl`) |
| §2 decisions 10-11 (step order, partial failure, one run, stale close) | F-T8, M-T1 (lock index), M-T2 |
| §2 decision 12 (staff by normalized name) | F-T4, F-T8, F-T10 |
| §2 decision 13 (`confirmed_by` stamp) | M-T1, M-T2, U-T7 |
| §2 decision 14 (thirteen types) | U-T1, M-T1, M-T2 |
| §2 decision 15 (pairing by office roles) | M-T1, U-T3, U-T5; sync widened the same way (*Deliberate differences* 1) |
| §3 gate words, history, re-paste, comments and fixtures | M-T1, U-T1, M-T2 (101/107 hazard) |
| §4.1-§4.7 data model and scheduler | M-T1, M-T2 |
| §5.1-§5.4 DATUM | D-T1-D-T6 |
| §6.1 auth and modes | F-T9, F-T10 |
| §6.2 a sync run, counts, differences | F-T1, F-T2, F-T5, F-T8 |
| §6.3 the import | F-T3, F-T8, U-T5 |
| §6.4 the planner | F-T1-F-T6 |
| §7 trigger (button, hourly, webhook) | U-T3, M-T1, *Release* 5 |
| §8.1 Rooms-tab card | U-T3, U-T4, U-T5 |
| §8.2 board chips | U-T2, U-T6 |
| §8.3 event detail | U-T7 |
| §9 failure table | each row is a test in F-T7 (DATUM down, 401, unknown code), F-T8 (wrong project, mapped first, changed between listing and import, unusable code, renamed area, create failure, names, old events, unlinked room, lost write, dead run), F-T9 (button during a run), U-T5 (cron line), U-T2/U-T5/U-T6 (read failures) |
| §10 security | D-T2, D-T6 (bearer, no update/delete, staff fields), M-T1/M-T2 (guards, SELECT-only tables), F-T9 (both paths), F-T10 (no secret in code) |
| §11.1 static guard | M-T1 |
| §11.2 rehearsal | M-T2 |
| §11.3 jest | F-T1-F-T6, U-T1-U-T7 |
| §11.4 Deno | F-T7-F-T10 |
| §11.5 screen tests | U-T1, U-T5, U-T6, U-T7 |
| §11.6 DATUM vitest | D-T1-D-T6 |
| §13 release order | *Release* |

## Deliberate differences from the spec's wording

1. **"Sinkron DATUM" is open to every office role (admin, principal, estimator; `is_office_role()`)**, not only admin and principal (spec §6.1, §8.1, §10, §11.3-§11.5). The owner decided this after the spec was written, which resolves calibration item 9. The function checks `is_office_role()` for sync and import alike (F-T9, one sentence per mode), `canSyncDatum` equals `canPairDatum` (U-T3), and the tests accept all three roles and refuse a supervisor.
2. **107 is pasted before the SANO PR is merged** (spec §13 merges first). The web app deploys on merge, and U-T7's `EVENT_SELECT` embeds `site_events_confirmed_by_fkey`, which only 107 creates; merging first would break every event detail read on the web until the paste.
3. **`migration101.test.ts` gains an exemption and one test** (spec §3: "gains nothing"). Its "no later migration writes gate_refs words" scan would fail on 107, which writes them on purpose; it now skips 107 by name and checks that 107's header states the re-paste hazard both ways.
4. **The board says "DATUM belum punya status untuk ruangan ini" only for an area the last good gate read covered** (`counts.gate_area_ids`, F-T8; `readAreaIds`, U-T2). Spec §8.2 conditions "none" on "read succeeded"; without this, a room linked in a run whose gate read failed would be told DATUM has nothing for it. Such a room reads "Status DATUM belum tersinkron" until a read covers it.
5. **`handle` takes an injected `SyncStore`, `DatumApi` and caller check** rather than raw Supabase clients (spec §11.4: "injected clients and fetch"). The Deno tests drive the whole run through an in-memory store and a fake DATUM; `store.ts` (the supabase-js queries) is checked by `deno check` and by jest text pins in `datumSyncPlanTwin.test.ts` (the columns written, no `profiles.active`, no delete), not by a Deno test.
6. **Counts and differences carry a few more keys than §6.2 lists**: `step_errors` (each failed step's reason, shown on the card), `retired_missing`, `gate_rows_unlinked`, `gate_area_ids`; escalation failures are listed in `differences.escalate_skipped` with the reason "Gagal dikirim: …". The card adds a "Tidak diambil dari DATUM" group for the import's skips.
7. **Tests are split by task**: the planner's tests in five files (`datumSyncPlan{Verdict,,Import,People,Words}.test.ts`) instead of `datumSyncPlan.test.ts` alone; DATUM's in six files, with the cross-route checks keeping the spec's name `sano-integration-routes.test.ts`. Each task then owns whole files.
8. **Trigger names carry 097's `_trg` suffix** (`rooms_datum_area_id_sync_only_trg`, and so on); the functions carry the spec's names.
9. **`listDatumGateStatus` also returns `roomLinks`** (`rooms.id, datum_area_id`): `RoomBoardRow` (`v_room_board`) has no link column, and `datumChipsForRoom` needs it.
10. **The import's confirmation is inline in the card**, not a dialog: the owner's standing rule that edit forms expand in place. It still names DATUM's project and lists every area.
11. **Refusal details the spec leaves open**: an unknown project in `set_datum_project_code` raises `DATUM_PAIRING_PROJECT: proyek tidak ditemukan`; a room made in SANO during an import is skipped with "Ruangan {code} sudah dibuat di SANO sebelum impor selesai."; DATUM's item errors become sentences ("DATUM menolak kodenya …", "DATUM menolak nama, lantai atau tipenya.", "DATUM gagal menyimpannya.").
12. **`POST escalate` omits `current_spec` when `summary` is null**: DATUM's decision schema accepts a string or nothing, not null.
13. **Agents never run `pnpm db:preflight`**: it reads DATUM's remote ledger; it is the owner's step right before `pnpm db:migrate`.
14. **The rehearsal runs its checks as `supabase_admin` with `SET LOCAL ROLE`** (the closure rehearsal ran as `postgres`), so it can be the function's `service_role` and `postgres` as well as the app roles.

## Spec statements not turned into tasks

1. **§15 calibration items 1-8** are the owner's to watch after release (DATUM's own gate-B description and `RulesViewer.tsx`, hourly at night, the 24 h constant, the inactive author's name in DATUM views, the batch of 20, short names, old confirmations). Item 9 is resolved by *Deliberate differences* 1.
2. **DATUM's `RulesViewer.tsx:41-50` drift** (spec §2 decision 1) is DATUM's to fix; the sync reports any gate-word difference but changes no DATUM file.
3. **"DATUM's own triggers then mark the area's gate rows stale and alert card members"** (§5.3) needs no code: it is DATUM behaviour the route relies on, and the fake cannot exercise it.
4. **The spec's out-of-scope list (§12)** stays out: no gate status written to DATUM, no photos or other event types, no delete or rename in either database, no DATUM-to-SANO push, no staff picker, no re-import of a DATUM change, no step libraries, no event URL.
5. **A run killed by the platform after its 202** is closed as "Sinkron terputus sebelum selesai." by the next run's sweep (F-T8 tests the sweep); the kill itself cannot be reproduced in a Deno test.
