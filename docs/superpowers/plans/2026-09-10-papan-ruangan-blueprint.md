# Papan Ruangan & Finishing-phase Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the confirmed site events plan 2 captures into the two surfaces they exist for. Internally, a "Papan Ruangan" board reads `v_room_board` and answers one question per room: is it blocked, is it overdue, has anybody touched it this week; tapping a room opens its timeline, where an office role or the reporter can move the owner and the due date, and anybody can close an event. Externally, the client Blueprint report gains a Finishing mode: section "01 Update Lapangan" grouped by room, a masthead that states the phase, figure legends that name the room, and a Daily Site Log that can pull that day's confirmed events into the curator's draft without ever letting internal language walk into a client PDF on its own. A STRUKTUR-phase project renders byte-for-byte the report it rendered yesterday, and a golden regression test written before the renderer is touched is what proves it.

**Architecture:** One new pure module, `tools/clientReportRooms.ts`, owns the room comparator, the room label, the gate chip and the grouping; both the client report and Papan Ruangan sort rooms through it, so the two surfaces cannot disagree about where a room sits. `tools/clientReport.ts` switches on `projects.phase` and attaches `roomGroups` to the draft; `tools/clientReportHtml.ts` emits a third, additive `<style>` block only in a room phase and leaves `BLUEPRINT_CSS` byte-identical, guarded by a SHA-256 pin. `tools/dailyLogPull.ts` is pure and turns a day's confirmed events into *proposals*; nothing is saved until the curator approves it. `tools/roomBoard.ts` reads `v_room_board` (migration 097) and holds the summary, filter and age rules the three role layouts share. Migration `099_site_event_assignment.sql` adds the single narrow RPC `update_site_event_assignment`, because plan 2's `site_events_human_fields_rpc_only` trigger deliberately refuses a direct PostgREST write to `owner_id` or `due_date`. `tools/reports.ts` gains `site_event_ai_runs` as a second source for the AI usage report.

**Tech Stack:** TypeScript, React Native (Expo SDK 54 / RN 0.81), React Navigation 6 bottom tabs, Supabase Postgres with hand-pasted migrations, jest + ts-jest, `node:crypto` (test-only, for the CSS hash pin). Indonesian UI copy, no i18n library. No new runtime dependency is added by this plan.

**Spec:** `docs/superpowers/specs/2026-09-10-room-site-events-design.md` (sections 1.1, 2 decisions 8 and 9, 4.2, 4.3, 9, 10, 11, 14, 16, 18 item 7). Two earlier specs are binding conventions, not background: `docs/superpowers/specs/2026-06-28-client-progress-report-blueprint-design.md` (the verbatim-port contract for `BLUEPRINT_CSS`, the number-free report, the curated-draft model, the frozen snapshot) and `docs/superpowers/specs/2026-07-16-client-report-print-and-photo-layout-design.md` (the justified gallery, the figure legend, the A4 print rules).

**Branch and working tree:** `feat/papan-ruangan-blueprint`, cut from `main` **after plan 2 has merged**, checked out in the git worktree `/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/room-site-events`. The main tree stays on `main`. Because that path contains `/.claude/worktrees/`, the repo's `testPathIgnorePatterns` would hide every test, so every `npx jest <path>` in this plan must be run as:

```bash
npx jest <path> --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'
```

Never set `ALLOW_PROD_DB_TESTS`. Never apply a migration to the live database; migrations are pasted by the user into the Dashboard SQL editor. Never call the live Supabase, OpenAI or Anthropic endpoints from a test or a verification step.

**Commit identity:** the repo's commits are authored by `Test User <test@example.com>`, which is already the configured git user here, so a plain `git commit` is correct. End every commit message with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Plan sequence

This is **plan 4 of 4** for the 2026-09-10 spec. The four are strictly ordered.

| # | Plan | Scope |
|---|---|---|
| 1 | Room Spine & QR Deep Links (merged) | Migration 096, `tools/roomCodes.ts`, `tools/roomLinks.ts`, `tools/rooms.ts`, `tools/gateRefs.ts`, `tools/projectPhase.ts`, `tools/roomLabelsHtml.ts`, office "Kelola ruangan" + "Kelola gerbang", QR label sheet, deep links on all three containers, scanner, `RoomScreen`, office `RoomDetailScreen`. |
| 2 | Site Event Capture & AI Draft | Migrations `097_site_events.sql` and `098_daily_log_room_link.sql`; `tools/siteEventDraftValidate.ts`, `tools/siteEventRules.ts`, `tools/siteEvents.ts`, `tools/voiceRecorder.ts`; `tools/storage.ts` bucket routing; edge function `site-event-analyze`; capture, confirm and detail screens; `SiteEventDetail` deeplink in all three navigators. |
| 3 | Offline queue | `tools/captureQueue.ts`, `tools/captureQueueStore.ts`, the resumable worker, the Beranda queue badge, the web limitation copy. |
| **4** | **Papan Ruangan + Blueprint Finishing mode (this document)** | The golden regression guard; `tools/clientReportRooms.ts`; the `projects.phase` switch in `tools/clientReport.ts` and `tools/clientReportHtml.ts`; `tools/dailyLogPull.ts` and the Daily Site Log pull-through; `tools/roomBoard.ts` and the board for office, principal and supervisor; the room timeline with owner and due-date editing; migration `099_site_event_assignment.sql`; `site_event_ai_runs` in `ai_usage_summary`. |

**Prerequisites, precisely.** Plans 1 and 2 are hard prerequisites for the plan as a whole. Two parts need **only plans 1 and 2** and can be reviewed independently of plan 3:

- Tasks 1, 2 and 3 (the golden guard, `tools/clientReportRooms.ts` and the renderer) need plan 1 alone at compile time: `AREA_UMUM_CODE`, `AREA_UMUM_NAME`, `PROJECT_PHASE_LABELS` (`tools/constants.ts:213-256`), `ProjectPhase` and `GateRef` (`tools/types.ts:55,89`), `listRooms` (`tools/rooms.ts:38`), `listGateRefs` and `gateChipLabel` (`tools/gateRefs.ts`). They read `daily_log_highlights.room_id` and `.gate_code`, which migration 098 adds, so they need 098 pasted to show anything, but they compile and their tests pass without it.
- Task 4 (the Daily Site Log pull-through) needs plan 2's `tools/siteEvents.ts`, `SITE_MEDIA_PATH_PREFIX` in `tools/storage.ts` (plan 2 task 8, deviation D17) and migration 098's columns.

Tasks 5 through 8 need plan 2 in full: `v_room_board` and `close_site_event` (migration 097, plan 2 task 4), `SiteEventDetail` registered in all three navigators (plan 2 task 14), `site_event_ai_runs` and its RLS (migration 097). **Plan 3 is not a prerequisite for any task here**; the board reads committed rows and does not care how they got there.

**Not in this plan (release 2):** overdue reminders, digests and any scheduler; WhatsApp delivery; DATUM reads of `area_gate_status`, the escalation route and room sync; mandatory closure evidence; a subcontractor or contacts directory; per-room progress percentages of any kind (the client report stays number-free, per the 2026-06-28 spec); changing the 3-day quiet threshold into a setting (spec §18 item 4 keeps it a constant in `v_room_board` for the pilot).

---

## Decisions settled from the repo before writing

Each of these picks a branch the spec left open, or corrects a detail the spec could not know. The evidence is quoted so a reviewer can re-run it.

1. **The golden is captured from the renderer as it stands, not hand-written.** `tools/clientReportHtml.ts` is 462 lines of template literal; a hand-authored expectation would be wrong and unreviewable. The test writes the file itself under `UPDATE_CLIENT_REPORT_GOLDEN=1`, and that capture is task 1 step 3, before a single character of the renderer changes. Captured values, verified in the scratch sandbox: the weekly golden is 22,284 bytes, the daily one 21,315 bytes, and the first `<style>` block (which is `BLUEPRINT_CSS` exactly) is 10,182 characters hashing to `03c76aa8bd3f22b6d86ca7af607e779744f86729e15e30969b62e14325417e33`.

2. **Two locks, not one.** A golden file can be regenerated by anybody who runs the update flag, which makes it a change-detector rather than a contract. The 2026-06-28 spec §1.2 calls `BLUEPRINT_CSS` a verbatim port, so it gets a second lock the regeneration flag cannot satisfy: the SHA-256 literal above, asserted against the first `<style>` block of the rendered page. Changing that literal is a deliberate act that names the design owner in the diff.

3. **Room styles are a third `<style>` block, emitted only in a room phase.** `renderClientReportHtml` already emits `<style>${BLUEPRINT_CSS}</style><style>${REPORT_MEDIA_CSS}</style>` (`tools/clientReportHtml.ts:459-460`), the additive pattern the 2026-07-16 spec established for the gallery. A third block keeps `BLUEPRINT_CSS` untouched *and* keeps a STRUKTUR page byte-identical, because the block is not emitted at all when `phase` is absent or `STRUKTUR`.

4. **`phase` and `roomGroups` are optional on `ClientReportDraft`.** `client_progress_reports.snapshot` stores the whole draft as JSONB (`tools/clientReport.ts:286`, `supabase/migrations/050_client_progress_report.sql`), and `getClientReportSnapshot` casts the stored JSON straight back to `ClientReportDraft` (`tools/clientReport.ts:373-380`). Every report issued before this plan has neither field. Making them optional, and treating absent as `STRUKTUR`, is what keeps an issued report re-rendering exactly as it was sent. This is the frozen-snapshot rule of the 2026-06-28 spec, honoured by the type rather than by a migration.

5. **Owner and due date after confirm need an RPC, not an UPDATE.** Plan 2 task 4 adds the trigger `site_events_human_fields_rpc_only` (its deviation D5), which raises when an `authenticated` session changes `event_type`, `gate_code`, `title`, `summary`, `owner_id`, `due_date`, `is_blocking` or `vo_flag` directly. Spec §9 nevertheless requires the timeline to let office roles and the reporter move the owner and the due date. Migration `099_site_event_assignment.sql` is the one narrow door: `SECURITY DEFINER`, so `current_user` inside it is the function owner and the trigger returns early, with every rule the trigger would have enforced written out in full.

6. **The current owner may not reassign their own event.** Spec §9 names "office roles and the reporter". An owner handing their own overdue item to somebody else is exactly the accountability hole the feature closes, so 099 does not add them, and the timeline does not show the control to them. Recorded as deviation D3 below, because it is an explicit reading of a spec line rather than a quotation of one.

7. **The office "Ruangan" tab keeps mounting `RoomsAdminScreen`.** `office/navigation.tsx:141` mounts `RoomsAdminScreen` for the `Rooms` tab, and that screen already owns a sub-module switch (`office/screens/RoomsAdminScreen.tsx:22,29,172`: `type SubModule = 'rooms' | 'gates'`, and `if (sub === 'gates') return <GatesAdminScreen .../>`). Making the board the tab's main view is therefore a third value on that switch plus a changed default, not a navigator change. Nothing about plan 1's screen, its route, its icon or its deep link moves.

8. **Principal gets the tab plan 1 deferred.** `office/PrincipalNavigation.tsx:22-26` already declares a hidden `RoomDetail` route and maps its icon and label, but there is no `Rooms` tab. Spec §9 asks for one. Adding it is four lines plus a lazy import, and it mounts a read-only board component rather than `RoomsAdminScreen`, because a principal does not author rooms (plan 1 put room authoring behind `canSetProjectPhase`-style office checks).

9. **The supervisor reaches the board from the Progres hub, next to the scanner.** `workflows/screens/ProgresScreen.tsx:343,349` has a hub button `{ key: 'ruangan', icon: 'qr-code', label: 'Ruangan' }` that navigates to `RoomScan`. A supervisor standing on site wants the scanner; a supervisor reviewing the day wants the board. Replacing the button would take the scanner away from the one-tap path the capture flow depends on, so the hub gains a **second** button, `{ key: 'papan', icon: 'grid', label: 'Papan' }`, that opens `RoomBoard`. Both are two taps from Beranda and neither displaces the other.

10. **`ai_usage_summary` keeps `ai_chat_log` as its primary source and adds a parallel section.** `generateAIUsageSummary` (`tools/reports.ts:909-1082`) buckets per user, per day and per model, with `haiku_count` / `sonnet_count` in both the summary and each user row. `site_event_ai_runs` has no `user_id` and no `role`; it has `stage`, `model`, `tokens_in`, `tokens_out`, `cost_usd` and `status` (spec §4.2). Folding it into `users` would need an invented user, so the second source lands as its own `site_events` object in `data`, with per-stage rows. Recorded as deviation D6.

11. **The board reads `v_room_board`; the timeline reads `site_events`.** Spec §9's last line. `v_room_board` is `security_invoker`, so the caller's RLS applies and a supervisor sees only their projects; no extra filtering is written on the client beyond `project_id`.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/__tests__/clientReportGolden.test.ts` (create, task 1) | The regression guard: two byte-identical STRUKTUR goldens plus the `BLUEPRINT_CSS` SHA-256 pin. Extended in task 3 with the phase-equivalence cases. |
| `tools/__tests__/golden/clientReport.struktur.mingguan.html` (create, task 1) | Captured weekly STRUKTUR output. Generated, never hand-edited. |
| `tools/__tests__/golden/clientReport.struktur.harian.html` (create, task 1) | Captured daily STRUKTUR output. Generated, never hand-edited. |
| `tools/clientReportRooms.ts` (create, task 2) | Pure. `compareRoomsForDisplay`, `formatRoomLabel`, `groupHighlightsByRoom`, `roomNameById`, and the narrow `ClientReportRoomGroup` type spec §1.1 requires. |
| `tools/__tests__/clientReportRooms.test.ts` (create, task 2) | Ordering, Area Umum last, null-room fallback, gate chip, label. |
| `tools/clientReport.ts` (modify, task 3) | `phase` on `AssembleParams` and `ClientReportDraft`; `roomGroups`; `room` on `ClientReportPhoto`; rooms and gates read only in a room phase. |
| `tools/clientReportHtml.ts` (modify, task 3) | `REPORT_ROOM_CSS` (additive third block), the phase kicker, the per-room section 01, the room-labelled figure legend. `BLUEPRINT_CSS` untouched. |
| `tools/__tests__/finishingRender.test.ts` (create, task 3) | The Finishing renderer: kicker, room heads, chips, continuous daily numbering, legend, no percentages, flat fallback. |
| `tools/__tests__/clientReport.test.ts` (modify, task 3) | `assembleClientReportDraft` in both phases against a mocked client. |
| `workflows/screens/ClientReportBuilderScreen.tsx` (modify, task 3) | Passes `project.phase` into `assembleClientReportDraft`; the view mode re-renders the frozen snapshot unchanged. |
| `tools/dailySiteLogs.ts` (modify, task 4) | 098's `room_id`, `gate_code`, `source_event_id` on highlights and `room_id`, `source_media_id` on photos: types, selects **and** inserts. |
| `tools/dailyLogPull.ts` (create, task 4) | Pure. `proposeHighlightsFromEvents`, `proposePhotosFromEvents`, `mergePulledHighlights`, the client-safe split and the rewording note. |
| `tools/__tests__/dailyLogPull.test.ts` (create, task 4) | The split, the carried links, the ordering, the already-pulled guard, the `site-media:` prefix. |
| `tools/__tests__/dailySiteLogs.test.ts` (modify, task 4) | The new columns reach the insert payloads. |
| `tools/siteEvents.ts` (modify, tasks 4 and 7) | `listConfirmedEventsForDay` (task 4); `listRoomTimeline` and `updateSiteEventAssignment` (task 7). |
| `tools/timeWindow.ts` (modify, task 7) | `todayIsoWIB()`, the one definition of "today" the board, the form and migration 099 share. |
| `tools/__tests__/timeWindow.test.ts` (modify, task 7) | `todayIsoWIB` across the 17:00Z rollover. |
| `workflows/screens/DailyLogScreen.tsx` (modify, task 4) | "Tarik dari kejadian ruangan": the picker, the rewording warning, the photo offers. |
| `workflows/screens/dailyLog/PullEventsSheet.tsx` (create, task 4) | The proposal picker itself, so `DailyLogScreen` stays readable. |
| `workflows/screens/ProgresScreen.tsx` (modify, tasks 4 and 5) | The new highlight fields on the quick-add path; the "Papan" hub button. |
| `tools/roomBoard.ts` (create, task 5) | `listRoomBoard` plus the pure `boardSummary`, `filterBoard`, `floorOptions`, `ownerOptions`, `lastUpdateLabel`, `openChips`. |
| `tools/__tests__/roomBoard.test.ts` (create, task 5) | Every pure rule above. |
| `office/screens/rooms/RoomBoardView.tsx` (create, task 5) | The board itself: summary strip, filters, floor groups, room cards. Shared by office, principal and supervisor. |
| `office/screens/RoomsAdminScreen.tsx` (modify, task 5) | The board becomes the tab's main view; "Kelola ruangan" and "Kelola gerbang" become sub-screens. |
| `office/screens/PrincipalRoomsScreen.tsx` (create, task 5) | The principal tab's read-only board wrapper. |
| `office/PrincipalNavigation.tsx` (modify, task 5) | The "Ruangan" tab plan 1 deferred here. |
| `workflows/screens/RoomBoardScreen.tsx` (create, task 5) | The supervisor phone layout, reached from the Progres hub. |
| `workflows/navigation.tsx` (modify, task 5) | The hidden `RoomBoard` route. |
| `supabase/migrations/099_site_event_assignment.sql` (create, task 6) | `update_site_event_assignment` and its grants. |
| `tools/__tests__/migration099.test.ts` (create, task 6) | Static guard in the 096 style: comment-stripped `CODE`, `SECURITY DEFINER`, pinned `search_path`, the refusal set, REVOKE/GRANT, no later redefinition. |
| `workflows/screens/siteEvent/timelineModel.ts` (create, task 7) | Pure. Timeline ordering, the overdue and age labels, who may reassign, the due-date rule the RPC enforces. |
| `workflows/__tests__/timelineModel.test.ts` (create, task 7) | Every rule above. |
| `workflows/screens/siteEvent/RoomTimeline.tsx` (create, task 7) | The event list with thumbnails, transcript expansion and the action row. |
| `workflows/screens/siteEvent/AssignmentEditor.tsx` (create, task 7) | The owner and due-date form behind the RPC. |
| `office/screens/RoomDetailScreen.tsx` (modify, task 7) | The timeline replaces plan 1's "Riwayat kejadian menyusul" placeholder. |
| `workflows/screens/RoomScreen.tsx` (modify, task 7) | The same timeline on the supervisor's room screen. |
| `tools/reports.ts` (modify, task 8) | `site_event_ai_runs` as the second source of `ai_usage_summary`. |
| `tools/__tests__/reportsSiteEventAi.test.ts` (create, task 8) | The second source: totals, per-stage rows, an empty table, a failed read. |

---

## Task 1: The Blueprint regression guard, written before the renderer is touched

Spec §18 item 7 names this the guard for "Struktur-phase projects stay unaffected", with the explicit instruction that it is written **before** the renderer is touched, not after. Nothing else in this plan may be committed until this task is green.

**Files:**
- Create: `tools/__tests__/clientReportGolden.test.ts`
- Create (generated): `tools/__tests__/golden/clientReport.struktur.mingguan.html`, `tools/__tests__/golden/clientReport.struktur.harian.html`

- [ ] **Step 1: Confirm the tree is untouched before capturing anything**

A golden captured from an already-modified renderer proves nothing. Verify first:

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/room-site-events"
git status --porcelain tools/clientReportHtml.ts tools/clientReport.ts
```

Expected: no output at all. If either file is listed as modified, stop and find out why before continuing; the capture in step 3 would bake the modification into the contract.

- [ ] **Step 2: Write the guard**

Create `tools/__tests__/clientReportGolden.test.ts`:

```ts
/**
 * Spec §18 item 7: Struktur-phase projects stay unaffected, and the guard is
 * written BEFORE the renderer is touched, not after.
 *
 * Two locks, deliberately different in kind:
 *
 *  1. GOLDEN FILES. Two STRUKTUR drafts (a daily one with no photos, a weekly
 *     one with photos and captions) are rendered and compared BYTE FOR BYTE
 *     against HTML captured from the renderer as it stood before the
 *     Finishing-phase work began. Any change to markup, ordering, whitespace or
 *     CSS fails here. Regenerate with UPDATE_CLIENT_REPORT_GOLDEN=1 only when a
 *     STRUKTUR change is genuinely intended; the diff is then reviewable.
 *  2. BLUEPRINT_CSS HASH. The golden can be regenerated, so the verbatim-port
 *     contract (2026-06-28 spec §1.2) gets a second lock a regeneration cannot
 *     quietly satisfy: the SHA-256 of the FIRST <style> block, which is
 *     BLUEPRINT_CSS exactly as it ships. The literal below is the value of that
 *     block before this plan; changing it means editing the blueprint port, and
 *     that needs the design owner, not a test update.
 *
 * The two drafts between them exercise every branch the renderer takes on a
 * STRUKTUR page: weekly vs daily row numbering, the revision tag, escaping
 * (the "<selesai>" in one note), a photo with an empty caption (dropped from
 * the legend but kept in the gallery), and the no-photo path.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft } from '../clientReport';

const GOLDEN_DIR = path.join(__dirname, 'golden');
const UPDATE = process.env.UPDATE_CLIENT_REPORT_GOLDEN === '1';

const WEEKLY: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, revision: 2, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang · 2 kenek · 1 mandor',
  safetyIncidents: 0, nextPlan: 'Penyelesaian railing tangga & pemasangan kusen lantai 2.',
  updates: [
    { date: '10 Jun', area: 'Tangga', note: 'Finishing anak tangga berjalan; railing menyusul.' },
    { date: '12 Jun', area: 'Kamar Mandi Utama', note: 'Waterproofing lapis kedua <selesai>.' },
    { date: '14 Jun', area: 'Ruang Keluarga', note: 'Rangka plafon terpasang.' },
  ],
  hero: { url: 'https://cdn.example/hero.jpg', caption: 'Kondisi lapangan pagi hari', date: '14 Jun' },
  thumbs: [
    { url: 'https://cdn.example/b.jpg', caption: 'Mock-up keramik KM utama', date: '12 Jun' },
    { url: 'https://cdn.example/c.jpg', caption: '', date: '10 Jun' },
  ],
};

const DAILY: ClientReportDraft = {
  ...WEEKLY, kind: 'harian', reportNo: 8, revision: 1,
  periodStart: '2026-06-14', periodEnd: '2026-06-14', hero: null, thumbs: [],
};

function checkGolden(name: string, html: string): void {
  const file = path.join(GOLDEN_DIR, name);
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, html, 'utf8');
  }
  expect(fs.readFileSync(file, 'utf8')).toBe(html);
}

describe('STRUKTUR client report is byte-identical to the captured golden', () => {
  it('renders the weekly report exactly as before', () => {
    checkGolden('clientReport.struktur.mingguan.html', renderClientReportHtml(WEEKLY));
  });

  it('renders the daily report exactly as before', () => {
    checkGolden('clientReport.struktur.harian.html', renderClientReportHtml(DAILY));
  });
});

describe('BLUEPRINT_CSS is the verbatim port and stays byte-identical', () => {
  const html = renderClientReportHtml(WEEKLY);
  const first = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));

  it('hashes to the value pinned before the Finishing-phase work', () => {
    expect(first).toHaveLength(10182);
    expect(crypto.createHash('sha256').update(first, 'utf8').digest('hex'))
      .toBe('03c76aa8bd3f22b6d86ca7af607e779744f86729e15e30969b62e14325417e33');
  });

  it('emits exactly two stylesheets on a STRUKTUR report', () => {
    expect(html.match(/<style>/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('.rgroup');
  });
});
```

- [ ] **Step 3: Watch it fail, then capture the golden**

```bash
npx jest tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -20
```

Expected: the two golden cases fail with `ENOENT: no such file or directory, open '.../golden/clientReport.struktur.mingguan.html'`; the two `BLUEPRINT_CSS` cases already pass. That pair of outcomes is the point: the hash lock is satisfied by the untouched renderer, so the literal in the test is right, and only the files are missing.

Now capture:

```bash
UPDATE_CLIENT_REPORT_GOLDEN=1 npx jest tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -10
wc -c tools/__tests__/golden/*.html
```

Expected: `Tests: 4 passed, 4 total`, and

```
   21315 tools/__tests__/golden/clientReport.struktur.harian.html
   22284 tools/__tests__/golden/clientReport.struktur.mingguan.html
```

If either byte count differs, the renderer in this tree is not the renderer this plan was written against. Stop and reconcile before going further.

- [ ] **Step 4: Prove the lock actually locks**

A guard nobody has seen fail is not a guard. Perturb the renderer, watch the test fail, then restore it:

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('tools/clientReportHtml.ts')
s = p.read_text()
p.write_text(s.replace('  .row{ display:grid;', '  .row{ display:grid ;', 1))
PY
npx jest tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -12
git checkout -- tools/clientReportHtml.ts
```

Expected: **all four** cases fail. The two goldens fail on the changed byte, and both `BLUEPRINT_CSS` cases fail because the block is now 10,183 characters and hashes differently. Then `git checkout` restores the file. Re-run the test one last time:

```bash
npx jest tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -8
```

Expected: `Tests: 4 passed, 4 total`.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: no output.

```bash
git add tools/__tests__/clientReportGolden.test.ts tools/__tests__/golden
git commit -m "$(cat <<'EOF'
test(report): pin STRUKTUR blueprint output before the Finishing-phase work

Spec §18 item 7 requires the regression guard to exist before the renderer
is touched. Two locks: byte-identical goldens for a weekly and a daily
STRUKTUR report, and a SHA-256 pin on BLUEPRINT_CSS that regenerating a
golden cannot quietly satisfy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**From here on, this test runs in every task's verification step.** If it ever fails, the change that broke it is wrong until proven otherwise.

---

## Task 2: `tools/clientReportRooms.ts` - the one room comparator

Spec §10.2 orders report rooms "by floor, then `rooms.sort_order`", with Area Umum last. Spec §9 orders board rooms "in ascending order and rooms without a floor, Area Umum included, group last, the same order the report uses in §10.2, so the board and the client report never disagree about where a room sits". One comparator, exported once, is how that promise is kept rather than restated.

Spec §1.1 also protects the renderer structurally: the group type carries a room label, a gate label and curated text, and has no field for an owner, a due date, an event type, a flag or a confidence. An internal value cannot leak into a client PDF because there is nowhere to put it.

**Files:**
- Create: `tools/clientReportRooms.ts`
- Test: `tools/__tests__/clientReportRooms.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/clientReportRooms.test.ts`:

```ts
// tools/clientReportRooms.ts imports tools/gateRefs.ts for gateChipLabel, and
// that module imports the Supabase client at load time. Nothing here touches
// the network, so the client is stubbed away entirely.
jest.mock('../supabase', () => ({ supabase: {} }));

import {
  compareRoomsForDisplay, formatRoomLabel, groupHighlightsByRoom, roomNameById,
  type GroupableLine, type RoomLookupRow,
} from '../clientReportRooms';
import type { GateRef } from '../types';

const gate = (code: string, short: string, sort_order: number): GateRef => ({
  code, name_id: short, short_label: short, description: null, sort_order, active: true,
  datum_gate_code: null, created_at: '2026-09-01T00:00:00Z',
});
const GATES: GateRef[] = [gate('B', 'Basah', 2), gate('D', 'Finishing', 4)];

const room = (id: string, name: string, floor: string | null, sort_order: number, code = id.toUpperCase()): RoomLookupRow =>
  ({ id, room_code: code, room_name: name, floor, sort_order });

const ROOMS: RoomLookupRow[] = [
  room('r2', 'Kamar Mandi Utama', '2', 0),
  room('r1', 'Ruang Keluarga', '1', 1),
  room('r10', 'Loteng', '10', 0),
  room('rx', 'Gudang', null, 0),
  room('ru', 'Area Umum', null, 9999, 'UMUM'),
];

const line = (area: string, note: string, room_id: string | null, gate_code: string | null): GroupableLine =>
  ({ date: '14 Jun', area, note, room_id, gate_code });

describe('compareRoomsForDisplay', () => {
  it('orders by floor ascending, numerically, with 10 after 2', () => {
    const sorted = [...ROOMS].sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['Ruang Keluarga', 'Kamar Mandi Utama', 'Loteng', 'Gudang', 'Area Umum']);
  });

  it('puts floorless rooms after every floored room and Area Umum after those', () => {
    const sorted = [room('ru', 'Area Umum', null, 9999, 'UMUM'), room('rx', 'Gudang', null, 0), room('r1', 'A', '3', 0)]
      .sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['A', 'Gudang', 'Area Umum']);
  });

  it('breaks a floor tie on sort_order, then on name', () => {
    const sorted = [room('c', 'C', '1', 5), room('a', 'A', '1', 5), room('b', 'B', '1', 1)]
      .sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['B', 'A', 'C']);
  });

  it('ranks "Lt. 2", "2" and "Lantai 2" as the same floor', () => {
    const sorted = [room('a', 'A', 'Lantai 2', 2), room('b', 'B', '2', 1), room('c', 'C', 'Lt. 2', 0)]
      .sort(compareRoomsForDisplay).map((r) => r.room_name);
    expect(sorted).toEqual(['C', 'B', 'A']);
  });
});

describe('formatRoomLabel', () => {
  it('reads "Kamar Mandi Utama · Lt. 2"', () => {
    expect(formatRoomLabel(ROOMS[0])).toBe('Kamar Mandi Utama · Lt. 2');
  });
  it('does not spell the floor prefix twice', () => {
    expect(formatRoomLabel(room('a', 'Balkon', 'Lt. 3', 0))).toBe('Balkon · Lt. 3');
    expect(formatRoomLabel(room('a', 'Balkon', 'Lantai 3', 0))).toBe('Balkon · Lantai 3');
  });
  it('drops the separator when there is no floor', () => {
    expect(formatRoomLabel(room('a', 'Area Umum', null, 9999, 'UMUM'))).toBe('Area Umum');
  });
});

describe('groupHighlightsByRoom', () => {
  it('orders groups by floor then sort_order, Area Umum last', () => {
    const groups = groupHighlightsByRoom([
      line('Plafon', 'Rangka terpasang', 'r10', null),
      line('Dinding', 'Aci selesai', 'r1', 'B'),
      line('Halaman', 'Bongkaran diangkut', 'ru', null),
      line('Lantai', 'Keramik dipasang', 'r2', 'D'),
    ], ROOMS, GATES);
    expect(groups.map((g) => g.roomLabel)).toEqual([
      'Ruang Keluarga · Lt. 1', 'Kamar Mandi Utama · Lt. 2', 'Loteng · Lt. 10', 'Area Umum',
    ]);
  });

  it('drops a line into Area Umum when it has no room, rather than dropping the line', () => {
    const groups = groupHighlightsByRoom([line('Umum', 'Pagar sementara dipasang', null, null)], ROOMS, GATES);
    expect(groups).toHaveLength(1);
    expect(groups[0].roomLabel).toBe('Area Umum');
    expect(groups[0].updates).toEqual([{ date: '14 Jun', area: 'Umum', note: 'Pagar sementara dipasang' }]);
  });

  it('still buckets a room-less line when the project never created Area Umum', () => {
    const groups = groupHighlightsByRoom([line('Umum', 'Catatan', null, null)], [ROOMS[0]], GATES);
    expect(groups.map((g) => g.roomLabel)).toEqual(['Area Umum']);
  });

  it('buckets a line whose room is not in this project into Area Umum too', () => {
    const groups = groupHighlightsByRoom([line('Umum', 'Catatan', 'gone', null)], ROOMS, GATES);
    expect(groups.map((g) => g.roomLabel)).toEqual(['Area Umum']);
  });

  it('chips the gate most of the group carries, ties going to the office ordering', () => {
    const groups = groupHighlightsByRoom([
      line('A', 'a', 'r2', 'B'), line('B', 'b', 'r2', 'D'), line('C', 'c', 'r2', 'B'),
    ], ROOMS, GATES);
    expect(groups[0].gateLabel).toBe('B · Basah');

    const tie = groupHighlightsByRoom([line('A', 'a', 'r2', 'D'), line('B', 'b', 'r2', 'B')], ROOMS, GATES);
    expect(tie[0].gateLabel).toBe('B · Basah');
  });

  it('leaves the chip off when no line carries a known gate', () => {
    expect(groupHighlightsByRoom([line('A', 'a', 'r2', null)], ROOMS, GATES)[0].gateLabel).toBeNull();
    expect(groupHighlightsByRoom([line('A', 'a', 'r2', 'Z')], ROOMS, GATES)[0].gateLabel).toBeNull();
  });

  it('keeps the curated line order inside a group and carries nothing but its text', () => {
    const groups = groupHighlightsByRoom([
      line('Satu', 'pertama', 'r2', null), line('Dua', 'kedua', 'r2', null),
    ], ROOMS, GATES);
    expect(groups[0].updates.map((u) => u.area)).toEqual(['Satu', 'Dua']);
    expect(Object.keys(groups[0].updates[0]).sort()).toEqual(['area', 'date', 'note']);
  });
});

describe('roomNameById', () => {
  it('maps a photo room to its bare name for the figure legend', () => {
    expect(roomNameById(ROOMS).get('r2')).toBe('Kamar Mandi Utama');
  });
});
```

Run it and watch it fail:

```bash
npx jest tools/__tests__/clientReportRooms.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -8
```

Expected: `Cannot find module '../clientReportRooms' from 'tools/__tests__/clientReportRooms.test.ts'`.

- [ ] **Step 2: Write the module**

Create `tools/clientReportRooms.ts`:

```ts
// SANO - Client report room grouping (spec 2026-09-10 §10.2).
//
// Pure. Turns a period's curated highlight lines into room groups the
// Finishing-phase renderer prints, and supplies the ONE room comparator both
// the client report and Papan Ruangan sort by, so the two surfaces can never
// disagree about where a room sits (spec §9).
//
// Spec §1.1 protects the renderer structurally: ClientReportRoomGroup carries
// a room label, a gate label and curated text, and has no field for an owner,
// a due date, an event type, a flag or a confidence. An internal value cannot
// leak into a client PDF because there is nowhere to put it.

import { AREA_UMUM_CODE, AREA_UMUM_NAME } from './constants';
import { gateChipLabel } from './gateRefs';
import type { GateRef } from './types';

/** The minimum a row needs to be ordered and labelled: Room and RoomBoardRow both satisfy it. */
export interface DisplayRoom {
  room_code: string | null;
  room_name: string;
  floor: string | null;
  sort_order: number;
}

/** A room that lines can point at. */
export interface RoomLookupRow extends DisplayRoom {
  id: string;
}

/** A curated highlight line, plus the two links migration 098 added. */
export interface GroupableLine {
  date: string;
  area: string;
  note: string;
  room_id: string | null;
  gate_code: string | null;
}

/** What the renderer receives. Curated text, a room label, a gate label. Nothing else. */
export interface ClientReportRoomGroup {
  roomLabel: string;
  gateLabel: string | null;
  updates: Array<{ date: string; area: string; note: string }>;
}

/** Area Umum absolutely last, then rooms with no floor, then floored rooms. */
function orderBucket(room: DisplayRoom): 0 | 1 | 2 {
  if ((room.room_code ?? '').toUpperCase() === AREA_UMUM_CODE) return 2;
  return (room.floor ?? '').trim() === '' ? 1 : 0;
}

/**
 * "Lt. 2" and "2" and "Lantai 2" all rank as floor 2, so a floor column typed
 * three ways still sorts ascending. A label with no digits at all ranks after
 * every numbered floor and then falls back to its own text.
 */
function floorRank(floor: string | null): { num: number; text: string } {
  const trimmed = (floor ?? '').trim();
  const digits = trimmed.match(/-?\d+/);
  return {
    num: digits ? parseInt(digits[0], 10) : Number.MAX_SAFE_INTEGER,
    text: trimmed.toLowerCase(),
  };
}

/**
 * Floor ascending, then rooms.sort_order, then name. Used by the report
 * grouping AND by Papan Ruangan: spec §9 requires both to agree.
 */
export function compareRoomsForDisplay(a: DisplayRoom, b: DisplayRoom): number {
  const ba = orderBucket(a);
  const bb = orderBucket(b);
  if (ba !== bb) return ba - bb;
  const fa = floorRank(a.floor);
  const fb = floorRank(b.floor);
  if (fa.num !== fb.num) return fa.num - fb.num;
  // Text only decides between two labels that carry NO number at all
  // ("Basement" vs "Mezanin"); once a floor number is read, "2", "Lt. 2" and
  // "Lantai 2" are the same floor and sort_order takes over.
  if (fa.num === Number.MAX_SAFE_INTEGER && fa.text !== fb.text) return fa.text < fb.text ? -1 : 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.room_name.localeCompare(b.room_name, 'id-ID');
}

/** "Kamar Mandi Utama · Lt. 2". A floor already spelled "Lt. 2" is not prefixed twice. */
export function formatRoomLabel(room: DisplayRoom): string {
  const floor = (room.floor ?? '').trim();
  if (floor === '') return room.room_name;
  const spelled = /^(lt\.?|lantai)\b/i.test(floor) ? floor : `Lt. ${floor}`;
  return `${room.room_name} · ${spelled}`;
}

/**
 * The group's gate chip: the gate most of its lines carry. Ties go to the gate
 * the office ordered first, so the chip never flickers between two equally
 * common gates. Lines with no gate, and codes no active gate matches, are
 * ignored rather than guessed at.
 */
function pickGateLabel(lines: GroupableLine[], gates: GateRef[]): string | null {
  const byCode = new Map(gates.map((g) => [g.code, g]));
  const counts = new Map<string, number>();
  for (const line of lines) {
    const code = line.gate_code;
    if (!code || !byCode.has(code)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: GateRef | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    const gate = byCode.get(code)!;
    if (count > bestCount || (count === bestCount && best !== null && gate.sort_order < best.sort_order)) {
      best = gate;
      bestCount = count;
    }
  }
  return best ? gateChipLabel(best) : null;
}

/** Room name by id, for photo legends ("Figur 3 · Kamar Mandi Utama"). */
export function roomNameById(rooms: RoomLookupRow[]): Map<string, string> {
  return new Map(rooms.map((r) => [r.id, r.room_name]));
}

/**
 * Group a period's lines by room, ordered by floor then sort_order, Area Umum
 * last. A line whose room_id is null - or points at a room this project no
 * longer lists - falls into Area Umum, so nothing is ever dropped from a client
 * report for lack of a room (spec §10.2).
 */
export function groupHighlightsByRoom(
  lines: GroupableLine[],
  rooms: RoomLookupRow[],
  gates: GateRef[],
): ClientReportRoomGroup[] {
  // A project whose Area Umum was never created still needs the bucket, or a
  // room-less line would have nowhere to go.
  const fallbackRoom: RoomLookupRow = rooms.find((r) => (r.room_code ?? '').toUpperCase() === AREA_UMUM_CODE)
    ?? { id: '', room_code: AREA_UMUM_CODE, room_name: AREA_UMUM_NAME, floor: null, sort_order: 9999 };

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const buckets = new Map<string, { room: RoomLookupRow; lines: GroupableLine[] }>();

  for (const line of lines) {
    const room = (line.room_id ? byId.get(line.room_id) : undefined) ?? fallbackRoom;
    const bucket = buckets.get(room.id) ?? { room, lines: [] };
    bucket.lines.push(line);
    buckets.set(room.id, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => compareRoomsForDisplay(a.room, b.room))
    .map((bucket) => ({
      roomLabel: formatRoomLabel(bucket.room),
      gateLabel: pickGateLabel(bucket.lines, gates),
      updates: bucket.lines.map((l) => ({ date: l.date, area: l.area, note: l.note })),
    }));
}
```

- [ ] **Step 3: Verify and commit**

```bash
npx jest tools/__tests__/clientReportRooms.test.ts tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: `Tests: 19 passed, 19 total` (15 here plus task 1's 4), and no `tsc` output.

```bash
git add tools/clientReportRooms.ts tools/__tests__/clientReportRooms.test.ts
git commit -m "$(cat <<'EOF'
feat(report): one room comparator for the client report and Papan Ruangan

Spec §9 and §10.2 require the board and the client report to agree about
where a room sits, so both sort through compareRoomsForDisplay. The group
type carries a room label, a gate label and curated text only (spec §1.1):
there is nowhere to put an owner, a due date or a confidence.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The phase switch in the renderer and in report assembly

Spec §10.2. `STRUKTUR` produces byte-identical output to today, which task 1 now enforces mechanically. `FINISHING` and `SERAH_TERIMA` group section 01 by room, state the phase in the masthead kicker, and name the room in the figure legend. `BLUEPRINT_CSS` stays byte-identical and the room styles go in a new additive block alongside `REPORT_MEDIA_CSS`.

**Files:**
- Modify: `tools/clientReportHtml.ts`, `tools/clientReport.ts`, `workflows/screens/ClientReportBuilderScreen.tsx`
- Create: `tools/__tests__/finishingRender.test.ts`
- Modify: `tools/__tests__/clientReportGolden.test.ts`, `tools/__tests__/clientReport.test.ts`

- [ ] **Step 1: Write the failing renderer test**

Create `tools/__tests__/finishingRender.test.ts`:

```ts
/**
 * The Finishing-phase half of the renderer (spec §10.2). Its opposite number is
 * tools/__tests__/clientReportGolden.test.ts, which proves the STRUKTUR page did
 * not move; between them every branch of the phase switch is pinned.
 *
 * The "no numeric percentage" case is not decoration. The 2026-06-28 spec makes
 * the client report number-free on purpose, and room grouping is the first
 * change since then that touches section 01. A per-room completion figure is
 * exactly the kind of thing that would feel helpful and would be wrong.
 */
import { renderClientReportHtml } from '../clientReportHtml';
import type { ClientReportDraft } from '../clientReport';

const BASE: ClientReportDraft = {
  kind: 'mingguan', reportNo: 7, periodStart: '2026-06-08', periodEnd: '2026-06-14',
  projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy', subtitle: 'Finishing Interior',
  statusLabel: 'Sesuai Jadwal', weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang',
  safetyIncidents: 0, nextPlan: 'Railing tangga.',
  updates: [{ date: '14 Jun', area: 'Lantai', note: 'Keramik dipasang' }],
  hero: { url: 'https://cdn/a.jpg', caption: 'Progres KM utama', date: '14 Jun', room: 'Kamar Mandi Utama' },
  thumbs: [],
  phase: 'FINISHING',
  roomGroups: [
    { roomLabel: 'Ruang Keluarga · Lt. 1', gateLabel: 'C · Plafon', updates: [{ date: '10 Jun', area: 'Plafon', note: 'Rangka terpasang' }] },
    { roomLabel: 'Kamar Mandi Utama · Lt. 2', gateLabel: 'B · Basah', updates: [{ date: '12 Jun', area: 'Lantai', note: 'Keramik dipasang' }, { date: '14 Jun', area: 'Dinding', note: 'Nat selesai' }] },
    { roomLabel: 'Area Umum', gateLabel: null, updates: [{ date: '13 Jun', area: 'Halaman', note: 'Bongkaran diangkut' }] },
  ],
};

/** The draft the manual A4 print check renders (task 9 step 4). */
const PREVIEW: ClientReportDraft = {
  ...BASE, reportNo: 12, periodStart: '2026-09-05', periodEnd: '2026-09-11',
  crewTotal: 9, crewBreakdown: '4 tukang · 3 kenek · 1 mandor',
  nextPlan: 'Pemasangan sanitair lantai 2.',
  roomGroups: [
    { roomLabel: 'Ruang Keluarga · Lt. 1', gateLabel: 'C · Plafon', updates: [
      { date: '06 Sep', area: 'Plafon', note: 'Rangka hollow terpasang penuh.' },
      { date: '09 Sep', area: 'Dinding', note: 'Plamir lapis pertama selesai.' }] },
    { roomLabel: 'Kamar Mandi Utama · Lt. 2', gateLabel: 'B · Basah', updates: [
      { date: '07 Sep', area: 'Lantai', note: 'Waterproofing lapis kedua selesai.' },
      { date: '10 Sep', area: 'Dinding', note: 'Keramik dinding terpasang, nat menyusul.' }] },
    { roomLabel: 'Kamar Tidur Anak · Lt. 2', gateLabel: 'D · Finishing', updates: [
      { date: '11 Sep', area: 'Kusen', note: 'Kusen pintu terpasang dan disetel.' }] },
    { roomLabel: 'Area Umum', gateLabel: null, updates: [
      { date: '08 Sep', area: 'Halaman', note: 'Sisa bongkaran diangkut keluar tapak.' }] },
  ],
  hero: { url: 'https://placehold.co/1600x1000/png', caption: 'Kondisi KM utama', date: '10 Sep', room: 'Kamar Mandi Utama' },
  thumbs: [
    { url: 'https://placehold.co/1600x1000/png', caption: 'Rangka plafon ruang keluarga', date: '06 Sep', room: 'Ruang Keluarga' },
    { url: 'https://placehold.co/1600x1000/png', caption: 'Kusen kamar anak', date: '11 Sep', room: 'Kamar Tidur Anak' },
  ],
};

const html = renderClientReportHtml(BASE);

it('kicker states the phase', () => {
  expect(html).toContain('Laporan Mingguan · Fase Finishing');
  expect(renderClientReportHtml({ ...BASE, kind: 'harian' })).toContain('Laporan Harian · Fase Finishing');
  expect(renderClientReportHtml({ ...BASE, phase: 'SERAH_TERIMA' })).toContain('Laporan Mingguan · Fase Serah Terima');
});

it('prints one head per room in the order given, Area Umum last', () => {
  const heads = [...html.matchAll(/<span class="rname">([^<]+)<\/span>/g)].map((m) => m[1]);
  expect(heads).toEqual(['Ruang Keluarga · Lt. 1', 'Kamar Mandi Utama · Lt. 2', 'Area Umum']);
  const chips = [...html.matchAll(/<span class="rgate">([^<]+)<\/span>/g)].map((m) => m[1]);
  expect(chips).toEqual(['C · Plafon', 'B · Basah']);
});

it('emits the additive room stylesheet and nothing inside BLUEPRINT_CSS', () => {
  expect(html.match(/<style>/g)).toHaveLength(3);
  expect(html).toContain('.rgroup{ margin-top:10px; }');
});

it('numbers daily rows continuously across groups', () => {
  const daily = renderClientReportHtml({ ...BASE, kind: 'harian' });
  const dates = [...daily.matchAll(/<span class="date">([^<]*)<\/span>/g)].map((m) => m[1]);
  expect(dates).toEqual(['01', '02', '03', '04']);
});

it('labels the figure legend with the room', () => {
  expect(html).toContain('Figur 1 · Kamar Mandi Utama');
  expect(html).toContain('class="figlegend byroom"');
});

it('renders no numeric percentage in the report body', () => {
  const body = html.slice(html.lastIndexOf('</style>'));
  expect(body).not.toMatch(/\d+\s*%/);
});

it('falls back to the flat list when a room phase has no groups', () => {
  const flat = renderClientReportHtml({ ...BASE, roomGroups: [] });
  expect(flat).not.toContain('<span class="rname">');
  expect(flat).toContain('Keramik dipasang');
  expect(flat).toContain('Laporan Mingguan · Fase Finishing');
});

// Opt-in escape hatch for the manual A4 print check (task 9 step 4). The
// renderer imports react-native, so it cannot be driven from a plain node
// script; this suite already carries the jest transform that makes it
// importable. No env var, no file written, and the case is a no-op.
it('writes a print preview when asked', () => {
  const out = process.env.WRITE_FINISHING_PREVIEW;
  if (!out) return;
  const fs = require('node:fs') as typeof import('node:fs');
  fs.writeFileSync(out, renderClientReportHtml(PREVIEW), 'utf8');
  expect(fs.readFileSync(out, 'utf8').length).toBeGreaterThan(1000);
});
```

Run it:

```bash
npx jest tools/__tests__/finishingRender.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -12
```

Expected: a TypeScript compile failure, `error TS2353: Object literal may only specify known properties, and 'phase' does not exist in type 'ClientReportDraft'` (and the same for `roomGroups` and for `room` on the hero photo). That is the right first failure: the types have to carry the new fields before the renderer can read them.

- [ ] **Step 2: Widen `ClientReportDraft` and `ClientReportPhoto`**

In `tools/clientReport.ts`, extend the import on line 8 and the three interfaces. Replace:

```ts
import type { MilestoneStatus } from './types';
import { aggregatePeriod } from './dailySiteLogs';
```

with:

```ts
import type { MilestoneStatus, ProjectPhase } from './types';
import { aggregatePeriod } from './dailySiteLogs';
import { listRooms } from './rooms';
import { listGateRefs } from './gateRefs';
import { groupHighlightsByRoom, roomNameById, type ClientReportRoomGroup } from './clientReportRooms';
```

In `AssembleParams` (currently ending at `milestoneStatuses: MilestoneStatus[];`), add:

```ts
  /** projects.phase (096). Omitted reads as STRUKTUR, which is the pre-096 behaviour. */
  phase?: ProjectPhase;
```

Replace the one-line `ClientReportPhoto`:

```ts
export interface ClientReportPhoto { url: string; caption: string; date: string; }
```

with:

```ts
export interface ClientReportPhoto {
  url: string;
  caption: string;
  date: string;
  /**
   * Room NAME only, and only in a room phase: the figure legend prints
   * "Figur 3 · Kamar Mandi Utama" (spec §10.2). Null when the photo carries no
   * room, which prints exactly as it did before.
   */
  room?: string | null;
}
```

And at the end of `ClientReportDraft`, after `thumbs: ClientReportPhoto[];`, add:

```ts
  /**
   * 096. Absent on every snapshot frozen before the Finishing mode shipped;
   * the renderer treats absent and 'STRUKTUR' identically, so an issued report
   * re-renders exactly as it was sent.
   */
  phase?: ProjectPhase;
  /**
   * Section 01 grouped by room. Present only in a room phase; the renderer
   * falls back to the flat `updates` when it is missing or empty, so a line is
   * never lost. Carries labels and curated text only - spec §1.1.
   */
  roomGroups?: ClientReportRoomGroup[];
```

- [ ] **Step 3: Add the additive stylesheet**

In `tools/clientReportHtml.ts`, extend the import block at line 29 with the phase labels:

```ts
import type { ClientReportDraft } from './clientReport';
import { PROJECT_PHASE_LABELS } from './constants';
```

Then, immediately after the `REPORT_MEDIA_CSS` template literal closes (the line reading `` @media print{ .flrow{ break-inside:avoid; } } `` followed by `` `; ``), insert:

```ts

// Additive again - BLUEPRINT_CSS stays byte-identical (2026-06-28 spec §1.2),
// and this block is only ever emitted alongside it. Finishing-phase section 01
// prints one bordered head per room ("Kamar Mandi Utama · Lt. 2" with a sand
// gate chip) above that room's existing .row list, so the row treatment the
// blueprint defines is untouched. The first .row of a group drops the
// blueprint's :first-child top border, which would otherwise double the head's
// own rule.
const REPORT_ROOM_CSS = `
  .rgroup{ margin-top:10px; }
  .rgroup:first-child{ margin-top:6px; }
  .rhead{ display:flex; align-items:baseline; justify-content:space-between; gap:12px;
    padding:4px 0 3px; border-bottom:1.2px solid var(--line); }
  .rname{ font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .rgate{ font-size:8.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase;
    color:var(--sand); white-space:nowrap; }
  .rgroup .row:first-child{ border-top:0; }
  /* the figure legend carries its room, so its first column wraps and widens */
  .figlegend.byroom .flrow{ grid-template-columns:112px 52px 1fr; }
  .figlegend.byroom.nodate .flrow{ grid-template-columns:112px 1fr; }
  .figlegend.byroom .fl-no{ white-space:normal; }
  @media print{ .rgroup{ break-inside:auto; } .rhead{ break-inside:avoid; break-after:avoid; } }
`;
```

`--sand` and `--line` are already declared by `BLUEPRINT_CSS`; this block consumes them rather than restating them, which is the same relationship `REPORT_MEDIA_CSS` has to the port.

- [ ] **Step 4: Switch the renderer on the phase**

Still in `tools/clientReportHtml.ts`, inside `renderClientReportHtml`, replace the first line of the body:

```ts
  const kicker = draft.kind === 'harian' ? 'Laporan Harian' : 'Laporan Mingguan';
```

with:

```ts
  // Spec §10.2: the masthead states the phase the project is actually in.
  // An undefined phase is a pre-096 snapshot and renders exactly as before.
  const roomMode = draft.phase === 'FINISHING' || draft.phase === 'SERAH_TERIMA';
  const kicker = (draft.kind === 'harian' ? 'Laporan Harian' : 'Laporan Mingguan')
    + (roomMode ? ` · Fase ${PROJECT_PHASE_LABELS[draft.phase!]}` : '');
```

Replace the `updateRows` assignment:

```ts
  const updateRows = draft.updates.map((u, i) => `
      <div class="row"><span class="date">${showDates ? esc(u.date) : String(i + 1).padStart(2, '0')}</span><span class="area">${esc(u.area)}</span><span class="note">${esc(u.note)}</span></div>`).join('');
```

with the row factory plus the grouped build:

```ts
  const updateRow = (u: { date: string; area: string; note: string }, i: number) => `
      <div class="row"><span class="date">${showDates ? esc(u.date) : String(i + 1).padStart(2, '0')}</span><span class="area">${esc(u.area)}</span><span class="note">${esc(u.note)}</span></div>`;

  // Room grouping needs BOTH a room phase and groups to print. A Finishing
  // project whose report was assembled before 098 landed, or a frozen snapshot
  // issued then, has no groups and keeps the flat list rather than losing lines.
  const roomGroups = roomMode ? (draft.roomGroups ?? []) : [];
  let figureRow = 0; // daily row numbers run on across groups, never restart
  const updateRows = roomGroups.length > 0
    ? roomGroups.map((g) => `
      <div class="rgroup">
        <div class="rhead"><span class="rname">${esc(g.roomLabel)}</span>${g.gateLabel ? `<span class="rgate">${esc(g.gateLabel)}</span>` : ''}</div>${g.updates.map((u) => updateRow(u, figureRow++)).join('')}
      </div>`).join('')
    : draft.updates.map(updateRow).join('');
```

In the legend builder, replace the row template:

```ts
        <div class="flrow"><span class="fl-no">Figur ${no}</span>${showDates ? `<span class="fl-d">${esc(p.date)}</span>` : ''}<span class="fl-t">${esc(p.caption)}</span></div>`)
```

with:

```ts
        <div class="flrow"><span class="fl-no">Figur ${no}${roomMode && p.room ? ` · ${esc(p.room)}` : ''}</span>${showDates ? `<span class="fl-d">${esc(p.date)}</span>` : ''}<span class="fl-t">${esc(p.caption)}</span></div>`)
```

and the wrapper:

```ts
    ? `<div class="figlegend${showDates ? '' : ' nodate'}">${legendRows}</div>`
```

with:

```ts
    ? `<div class="figlegend${showDates ? '' : ' nodate'}${roomMode ? ' byroom' : ''}">${legendRows}</div>`
```

Finally, the head. Replace:

```ts
<style>${REPORT_MEDIA_CSS}</style></head>
```

with:

```ts
<style>${REPORT_MEDIA_CSS}</style>${roomMode ? `
<style>${REPORT_ROOM_CSS}</style>` : ''}</head>
```

The conditional is what keeps the STRUKTUR page byte-identical: no third block, and not even the newline that would introduce it.

- [ ] **Step 5: Assemble the draft in a room phase**

In `tools/clientReport.ts`, inside `assembleClientReportDraft`, after `const reportNo = await assignNextReportNo(params.projectId);` insert:

```ts
  const phase: ProjectPhase = params.phase ?? 'STRUKTUR';
  const roomMode = phase === 'FINISHING' || phase === 'SERAH_TERIMA';

  // Rooms and gates are read ONLY in a room phase: a Struktur project makes
  // exactly the two queries it made before this change.
  const [rooms, gates] = roomMode
    ? await Promise.all([listRooms(params.projectId, { includeInactive: true }), listGateRefs()])
    : [[], []];
  const roomNames = roomNameById(rooms);
```

`includeInactive: true` is deliberate. A room retired mid-project still owns the highlight lines written while it was live, and dropping it would move those lines into Area Umum on a report that already went out under the room's own name.

Replace the `photos` block:

```ts
  const photos = await Promise.all(
    agg.featuredPhotos.map(async (p: { storage_path: string; caption: string | null; log_date: string }) => ({
      url: await resolvePhotoUrl(p.storage_path),
      caption: p.caption ?? '',
      date: fmtCaptionDate(p.log_date),
    })),
  );
```

with:

```ts
  const photos = await Promise.all(
    agg.featuredPhotos.map(async (p: { storage_path: string; caption: string | null; log_date: string; room_id: string | null }) => ({
      url: await resolvePhotoUrl(p.storage_path),
      caption: p.caption ?? '',
      date: fmtCaptionDate(p.log_date),
      ...(roomMode && p.room_id && roomNames.has(p.room_id) ? { room: roomNames.get(p.room_id)! } : {}),
    })),
  );

  const updates = agg.highlights.map((h) => ({ date: fmtCaptionDate(h.log_date), area: h.area, note: h.note }));
  const roomGroups: ClientReportRoomGroup[] | undefined = roomMode
    ? groupHighlightsByRoom(
        agg.highlights.map((h) => ({
          date: fmtCaptionDate(h.log_date), area: h.area, note: h.note,
          room_id: h.room_id ?? null, gate_code: h.gate_code ?? null,
        })),
        rooms,
        gates,
      )
    : undefined;
```

In the returned object, add the phase spread as the **first** key and use the hoisted `updates`:

```ts
  return {
    ...(roomMode ? { phase, roomGroups } : {}),
    kind: params.kind,
```

and replace

```ts
    updates: agg.highlights.map((h: { log_date: string; area: string; note: string }) => ({ date: fmtCaptionDate(h.log_date), area: h.area, note: h.note })),
```

with

```ts
    updates,
```

Spreading conditionally rather than writing `phase: roomMode ? phase : undefined` matters: an explicit `undefined` survives `JSON.stringify` as a **missing** key in the snapshot but is a **present** key in memory, and `'phase' in draft` is the cheapest thing a reviewer can check. **Corrected after review (C1): there is no parallel `roomGroups` list on the draft.** Keeping one alongside `updates` left the renderer reading the groups while `ClientReportBuilderScreen` edited `updates`, so in a room phase a curator's rewording, deletion and added line never reached the client PDF — the last human gate before a client document, silently inert. Instead `assembleClientReportDraft` stamps each line of the one `updates` list with its room and gate **labels** (`tagLinesByRoom`) and `renderClientReportHtml` re-groups that list at print time (`groupUpdatesByRoom`), so every edit control works in Finishing untouched, the labels stay frozen against a later room rename, and a draft carrying no labels falls back to the flat list rather than losing lines.

- [ ] **Step 6: Pass the phase from the builder screen**

In `workflows/screens/ClientReportBuilderScreen.tsx`, in `generate` (line 80), add one line to the `assembleClientReportDraft` argument, after `milestoneStatuses`:

```ts
        milestoneStatuses: milestones.map((m) => m.status),
        // Falls back to the database default until migration 096 is pasted:
        // select('*') on a projects row with no phase column yields undefined
        // at runtime, even though Project.phase is typed required. Same guard
        // RoomsAdminScreen.tsx:40 and RoomDetailScreen.tsx:34 use.
        phase: project.phase ?? 'STRUKTUR',
```

Per the C1 correction above, the screen also gains a per-line room picker in a room phase (`listRooms` once per draft, `formatRoomLabel` for the label so it matches assembly's byte for byte); everything else on it is unchanged. View mode already re-renders the frozen snapshot through `exportPdf(viewing.snapshot)` (line 273) and never re-derives, which is exactly the behaviour the 2026-06-28 spec asks for: an issued report carries its own `phase` and its lines' frozen room labels, and prints the way it was sent, even if the project's phase has moved on since.

- [ ] **Step 7: Extend the golden guard with the phase-equivalence cases**

Now that `ClientReportDraft` carries the fields, add two cases to the first `describe` in `tools/__tests__/clientReportGolden.test.ts`, after the daily case:

```ts
  it('treats an explicit STRUKTUR phase exactly like an absent one', () => {
    expect(renderClientReportHtml({ ...WEEKLY, phase: 'STRUKTUR' })).toBe(renderClientReportHtml(WEEKLY));
  });

  it('ignores room groups outside a room phase, so a stray field cannot change the sheet', () => {
    const withGroups = { ...WEEKLY, roomGroups: [{ roomLabel: 'X · Lt. 1', gateLabel: 'B · Basah', updates: WEEKLY.updates }] };
    expect(renderClientReportHtml(withGroups)).toBe(renderClientReportHtml(WEEKLY));
  });
```

The second case is the one that earns its place: a `roomGroups` array that reached a STRUKTUR draft by accident must be inert, not half-applied.

- [ ] **Step 8: Extend the assembly test**

In `tools/__tests__/clientReport.test.ts`, add two mocks beside the existing ones at the top of the file (after line 6):

```ts
jest.mock('../rooms', () => ({ listRooms: jest.fn() }));
jest.mock('../gateRefs', () => ({
  listGateRefs: jest.fn(),
  gateChipLabel: (g: { code: string; short_label: string }) => `${g.code} · ${g.short_label}`,
}));
```

and the matching imports beside `import { aggregatePeriod } from '../dailySiteLogs';`:

```ts
import { listRooms } from '../rooms';
import { listGateRefs } from '../gateRefs';
```

Then append this block to the end of the file:

```ts
describe('assembleClientReportDraft phase switch', () => {
  const AGG = {
    highlights: [
      { area: 'Plafon', note: 'Rangka terpasang', boq_item_id: null, sort_order: 0, log_date: '2026-06-10', room_id: 'r1', gate_code: 'C' },
      { area: 'Lantai', note: 'Keramik dipasang', boq_item_id: null, sort_order: 1, log_date: '2026-06-12', room_id: 'r2', gate_code: 'B' },
      { area: 'Halaman', note: 'Bongkaran diangkut', boq_item_id: null, sort_order: 2, log_date: '2026-06-13', room_id: null, gate_code: null },
    ],
    featuredPhotos: [
      { storage_path: 'a.jpg', caption: 'Hero', is_featured: true, captured_at: null, log_date: '2026-06-14', room_id: 'r2' },
      { storage_path: 'b.jpg', caption: 'Thumb', is_featured: true, captured_at: null, log_date: '2026-06-12', room_id: null },
    ],
    weather: 'Cerah', crewTotal: 8, crewBreakdown: '3 tukang', safetyIncidents: 0,
  };
  const ROOMS = [
    { id: 'r2', room_code: 'KM-UTAMA', room_name: 'Kamar Mandi Utama', floor: '2', sort_order: 0 },
    { id: 'r1', room_code: 'RK', room_name: 'Ruang Keluarga', floor: '1', sort_order: 0 },
    { id: 'ru', room_code: 'UMUM', room_name: 'Area Umum', floor: null, sort_order: 9999 },
  ];
  const GATES = [
    { code: 'B', name_id: 'Basah', short_label: 'Basah', description: null, sort_order: 2, active: true, datum_gate_code: null, created_at: 'x' },
    { code: 'C', name_id: 'Plafon', short_label: 'Plafon', description: null, sort_order: 3, active: true, datum_gate_code: null, created_at: 'x' },
  ];
  const PARAMS = {
    projectId: 'proj-1', kind: 'mingguan' as const,
    periodStart: '2026-06-08', periodEnd: '2026-06-14',
    projectName: 'Graha Family T-61', clientName: 'Bpk. Jason Jordy',
    milestoneStatuses: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (aggregatePeriod as jest.Mock).mockResolvedValue(AGG);
    (listRooms as jest.Mock).mockResolvedValue(ROOMS);
    (listGateRefs as jest.Mock).mockResolvedValue(GATES);
    (mockSupabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
  });

  it('a STRUKTUR draft reads no rooms and carries neither phase nor roomGroups', async () => {
    const draft = await assembleClientReportDraft(PARAMS);
    expect(listRooms).not.toHaveBeenCalled();
    expect(listGateRefs).not.toHaveBeenCalled();
    expect('phase' in draft).toBe(false);
    expect('roomGroups' in draft).toBe(false);
    expect(draft.updates).toHaveLength(3);
    expect('room' in (draft.hero ?? {})).toBe(false);
  });

  it('an explicit STRUKTUR phase behaves the same way', async () => {
    const draft = await assembleClientReportDraft({ ...PARAMS, phase: 'STRUKTUR' });
    expect(listRooms).not.toHaveBeenCalled();
    expect('roomGroups' in draft).toBe(false);
  });

  it('a FINISHING draft groups by room, Area Umum last, and keeps the flat list too', async () => {
    const draft = await assembleClientReportDraft({ ...PARAMS, phase: 'FINISHING' });
    expect(listRooms).toHaveBeenCalledWith('proj-1', { includeInactive: true });
    expect(draft.phase).toBe('FINISHING');
    expect(draft.roomGroups?.map((g) => g.roomLabel)).toEqual([
      'Ruang Keluarga · Lt. 1', 'Kamar Mandi Utama · Lt. 2', 'Area Umum',
    ]);
    expect(draft.roomGroups?.map((g) => g.gateLabel)).toEqual(['C · Plafon', 'B · Basah', null]);
    expect(draft.updates).toHaveLength(3);
  });

  it('names the room on a photo that has one, and leaves the rest alone', async () => {
    const draft = await assembleClientReportDraft({ ...PARAMS, phase: 'SERAH_TERIMA' });
    expect(draft.hero?.room).toBe('Kamar Mandi Utama');
    expect('room' in draft.thumbs[0]).toBe(false);
  });
});
```

- [ ] **Step 9: Verify and commit**

```bash
npx jest tools/__tests__/clientReportGolden.test.ts tools/__tests__/finishingRender.test.ts tools/__tests__/clientReport.test.ts tools/__tests__/clientReportHtml.test.ts tools/__tests__/clientReportRooms.test.ts tools/__tests__/clientReportGallery.integration.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -12
npx tsc --noEmit 2>&1 | tail -5
```

Expected: `Test Suites: 6 passed, 6 total`, every suite green including the two golden cases, and no `tsc` output. **If `clientReportGolden.test.ts` fails here, the renderer change leaked into the STRUKTUR path.** Do not regenerate the golden; find the leak. The usual culprit is emitting the third `<style>` tag or its preceding newline unconditionally.

```bash
git add tools/clientReport.ts tools/clientReportHtml.ts tools/__tests__/finishingRender.test.ts \
  tools/__tests__/clientReportGolden.test.ts tools/__tests__/clientReport.test.ts \
  workflows/screens/ClientReportBuilderScreen.tsx
git commit -m "$(cat <<'EOF'
feat(report): Finishing-phase client report grouped by room

Spec §10.2. The renderer switches on projects.phase: STRUKTUR is unchanged
and the golden guard proves it byte for byte, while FINISHING and
SERAH_TERIMA group section 01 by room, state the phase in the kicker and
name the room in the figure legend. Room styles are a third additive
stylesheet emitted only in a room phase; BLUEPRINT_CSS is untouched.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Daily Site Log - "Tarik dari kejadian ruangan"

Spec §10.1. The Daily Site Log gains a pull-through from that day's confirmed events. `progres` and `info` arrive pre-selected; `isu`, `hambatan`, `cacat` and `butuh_keputusan` are **listed but unchecked**, with a note saying they need client-safe rewording first. Pulled lines carry `room_id`, `gate_code` and `source_event_id`; context photos are offered with their room label. The curator edits or approves everything, so the curated-draft model from the 2026-06-28 spec is unchanged.

**Files:**
- Modify: `tools/dailySiteLogs.ts`, `tools/siteEvents.ts`, `workflows/screens/DailyLogScreen.tsx`, `workflows/screens/ProgresScreen.tsx`
- Create: `tools/dailyLogPull.ts`, `workflows/screens/dailyLog/PullEventsSheet.tsx`
- Test: `tools/__tests__/dailyLogPull.test.ts`; modify `tools/__tests__/dailySiteLogs.test.ts`

- [ ] **Step 1: Carry 098's columns through `tools/dailySiteLogs.ts`**

Migration 098 (plan 2 task 5) added `room_id`, `gate_code` and `source_event_id` to `daily_log_highlights` and `room_id`, `source_media_id` to `daily_log_photos`. All five are nullable, so this is purely additive.

In `tools/dailySiteLogs.ts`, extend `DailyLogHighlight` (line 8) with:

```ts
  /** 098. Set when the line was pulled from a room event, or picked by hand. */
  room_id: string | null;
  gate_code: string | null;
  source_event_id: string | null;
```

and `DailyLogPhoto` (line 16) with:

```ts
  /** 098. The room the photo belongs to, and the site-event media row it came from. */
  room_id: string | null;
  source_media_id: string | null;
```

Making them required-but-nullable rather than optional is deliberate: every construction site in the app is then forced by `tsc` to say what it means, which is how `ProgresScreen.tsx:157` and the three literals in `DailyLogScreen.tsx` get found in step 6 instead of silently writing `undefined`.

Widen all four select lists. In `getDailyLog` (lines 78 and 85) and again in `aggregatePeriod` (lines 165 and 172):

```ts
    .select('id, log_id, area, note, boq_item_id, sort_order, room_id, gate_code, source_event_id')
```

```ts
    .select('id, log_id, storage_path, caption, is_featured, captured_at, room_id, source_media_id')
```

In `getDailyLog`'s return, normalise the nullable columns so a row written before 098 does not surface `undefined`:

```ts
  return {
    ...log,
    highlights: (highlights ?? []).map((h: any) => ({
      ...h,
      room_id: h.room_id ?? null, gate_code: h.gate_code ?? null,
      source_event_id: h.source_event_id ?? null,
    })) as DailyLogHighlight[],
    photos: (photos ?? []).map((p: any) => ({
      ...p,
      room_id: p.room_id ?? null, source_media_id: p.source_media_id ?? null,
    })) as DailyLogPhoto[],
  } as DailySiteLog;
```

And, critically, widen both **inserts** in `upsertDailyLog`, or a pulled line would lose its links on the first save. Replace the highlights insert map:

```ts
    input.highlights.map((h, i) => ({
      log_id: log.id, area: h.area, note: h.note,
      boq_item_id: h.boq_item_id, sort_order: h.sort_order ?? i,
      // 098. Null for a line the curator typed; set for one pulled from a
      // confirmed site event, which is what lets the Finishing-phase report
      // group it and what stops "Tarik" proposing the same event twice.
      room_id: h.room_id ?? null, gate_code: h.gate_code ?? null,
      source_event_id: h.source_event_id ?? null,
    })),
```

and the photos insert map:

```ts
    input.photos.map((p) => ({
      log_id: log.id, storage_path: p.storage_path, caption: p.caption,
      is_featured: p.is_featured, captured_at: p.captured_at,
      room_id: p.room_id ?? null, source_media_id: p.source_media_id ?? null,
    })),
```

- [ ] **Step 2: Extend the daily-log test**

In `tools/__tests__/dailySiteLogs.test.ts`, the existing `upsertDailyLog` case and the `toggleFeaturedPhoto` helper both build literals that now need the five fields. Update the literals in place: in the `upsertDailyLog` case,

```ts
      highlights: [{ area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0, room_id: null, gate_code: null, source_event_id: null }],
      photos: [{ storage_path: 'daily-log/x.jpg', caption: 'Foto', is_featured: true, captured_at: null, room_id: null, source_media_id: null }],
```

and in the `toggleFeaturedPhoto` describe,

```ts
  const photo = (path: string, featured: boolean): DailyLogPhoto => ({
    storage_path: path, caption: null, is_featured: featured, captured_at: null,
    room_id: null, source_media_id: null,
  });
```

Then append two cases that pin the insert payloads, because a select-only change would pass every existing assertion while silently dropping the links on save:

```ts
describe('upsertDailyLog carries the 098 room links', () => {
  function wire() {
    const upsertChain = {
      upsert: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'log-9' }, error: null }),
    };
    const delChain = { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ error: null }) };
    const hlIns = { insert: jest.fn().mockResolvedValue({ error: null }) };
    const phIns = { insert: jest.fn().mockResolvedValue({ error: null }) };
    (mockSupabase.from as jest.Mock)
      .mockReturnValueOnce(upsertChain).mockReturnValueOnce(delChain)
      .mockReturnValueOnce(hlIns).mockReturnValueOnce(delChain).mockReturnValueOnce(phIns);
    return { hlIns, phIns };
  }
  const base = {
    project_id: 'p', log_date: '2026-09-11', weather: null, crew_total: null,
    crew_breakdown: null, safety_incidents: 0, author_id: 'u',
  };

  beforeEach(() => jest.clearAllMocks());

  it('writes room_id, gate_code and source_event_id for a pulled line', async () => {
    const { hlIns, phIns } = wire();
    await upsertDailyLog({
      ...base,
      highlights: [{ area: 'Kamar Mandi Utama', note: 'Nat selesai', boq_item_id: null, sort_order: 0, room_id: 'r2', gate_code: 'B', source_event_id: 'e1' }],
      photos: [{ storage_path: 'site-media:site-events/p/e1/m1.jpg', caption: null, is_featured: false, captured_at: null, room_id: 'r2', source_media_id: 'm1' }],
    });
    expect(hlIns.insert).toHaveBeenCalledWith([expect.objectContaining({ room_id: 'r2', gate_code: 'B', source_event_id: 'e1' })]);
    expect(phIns.insert).toHaveBeenCalledWith([expect.objectContaining({ room_id: 'r2', source_media_id: 'm1' })]);
  });

  it('writes nulls for a line the curator typed by hand', async () => {
    const { hlIns } = wire();
    await upsertDailyLog({
      ...base,
      highlights: [{ area: 'Tangga', note: 'Finishing', boq_item_id: null, sort_order: 0, room_id: null, gate_code: null, source_event_id: null }],
      photos: [],
    });
    expect(hlIns.insert).toHaveBeenCalledWith([expect.objectContaining({ room_id: null, gate_code: null, source_event_id: null })]);
  });
});
```

- [ ] **Step 3: Write the failing test for the pure proposal module**

Create `tools/__tests__/dailyLogPull.test.ts`:

```ts
jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../storage', () => ({ SITE_MEDIA_PATH_PREFIX: 'site-media:' }));

import {
  CLIENT_SAFE_EVENT_TYPES, mergePulledHighlights, proposeHighlightsFromEvents, proposePhotosFromEvents,
  type PullableEvent,
} from '../dailyLogPull';
import type { RoomLookupRow } from '../clientReportRooms';
import type { DailyLogHighlight } from '../dailySiteLogs';

const ROOMS: RoomLookupRow[] = [
  { id: 'r2', room_code: 'KM-UTAMA', room_name: 'Kamar Mandi Utama', floor: '2', sort_order: 0 },
  { id: 'r1', room_code: 'RK', room_name: 'Ruang Keluarga', floor: '1', sort_order: 0 },
  { id: 'ru', room_code: 'UMUM', room_name: 'Area Umum', floor: null, sort_order: 9999 },
];

function ev(p: Partial<PullableEvent> & { id: string }): PullableEvent {
  return {
    event_type: 'progres', title: 'Judul', summary: 'Ringkasan', room_id: 'r1',
    gate_code: 'C', confirmed_at: '2026-09-11T02:00:00Z', media: [], ...p,
  };
}

describe('proposeHighlightsFromEvents', () => {
  it('pre-selects only the two client-safe types', () => {
    expect([...CLIENT_SAFE_EVENT_TYPES]).toEqual(['progres', 'info']);
    const out = proposeHighlightsFromEvents([
      ev({ id: 'a', event_type: 'progres' }), ev({ id: 'b', event_type: 'info' }),
      ev({ id: 'c', event_type: 'isu' }), ev({ id: 'd', event_type: 'hambatan' }),
      ev({ id: 'e', event_type: 'cacat' }), ev({ id: 'f', event_type: 'butuh_keputusan' }),
    ], ROOMS);
    expect(out.filter((o) => o.preselected).map((o) => o.eventType)).toEqual(['progres', 'info']);
    expect(out.filter((o) => o.needsRewording).map((o) => o.eventType))
      .toEqual(['isu', 'hambatan', 'cacat', 'butuh_keputusan']);
  });

  it('lists the four internal types rather than hiding them', () => {
    const out = proposeHighlightsFromEvents([ev({ id: 'c', event_type: 'cacat' })], ROOMS);
    expect(out).toHaveLength(1);
    expect(out[0].preselected).toBe(false);
  });

  it('carries room_id, gate_code and source_event_id onto the line', () => {
    const [p] = proposeHighlightsFromEvents([ev({ id: 'a', room_id: 'r2', gate_code: 'B' })], ROOMS);
    expect(p.highlight).toEqual({
      area: 'Kamar Mandi Utama', note: 'Ringkasan', boq_item_id: null, sort_order: 0,
      room_id: 'r2', gate_code: 'B', source_event_id: 'a',
    });
  });

  it('falls back to the title when there is no summary, and skips an event with neither', () => {
    const out = proposeHighlightsFromEvents([
      ev({ id: 'a', summary: null, title: 'Hanya judul' }),
      ev({ id: 'b', summary: null, title: null }),
      ev({ id: 'c', summary: '   ', title: '  ' }),
    ], ROOMS);
    expect(out.map((o) => o.eventId)).toEqual(['a']);
    expect(out[0].highlight.note).toBe('Hanya judul');
  });

  it('orders proposals by room the way the board and the report order rooms', () => {
    const out = proposeHighlightsFromEvents([
      ev({ id: 'u', room_id: 'ru' }), ev({ id: 'two', room_id: 'r2' }), ev({ id: 'one', room_id: 'r1' }),
    ], ROOMS);
    expect(out.map((o) => o.roomLabel)).toEqual(['Ruang Keluarga', 'Kamar Mandi Utama', 'Area Umum']);
  });

  it('never proposes an event this log already pulled', () => {
    const out = proposeHighlightsFromEvents([ev({ id: 'a' }), ev({ id: 'b' })], ROOMS, ['a']);
    expect(out.map((o) => o.eventId)).toEqual(['b']);
  });

  it('ignores an unconfirmed event, which has no type yet', () => {
    expect(proposeHighlightsFromEvents([ev({ id: 'a', event_type: null })], ROOMS)).toEqual([]);
  });
});

describe('proposePhotosFromEvents', () => {
  const media = (id: string, role: 'context' | 'closeup' | 'closure' | 'audio', sort = 0) =>
    ({ id, kind: role === 'audio' ? ('audio' as const) : ('photo' as const), role, storage_path: `site-events/p/e/${id}.jpg`, sort_order: sort });

  it('offers context photos only, prefixed for the private bucket, never pre-featured', () => {
    const out = proposePhotosFromEvents([
      ev({ id: 'a', room_id: 'r2', media: [media('m1', 'context'), media('m2', 'closeup'), media('m3', 'closure'), media('m4', 'audio')] }),
    ], ROOMS);
    expect(out).toHaveLength(1);
    expect(out[0].roomLabel).toBe('Kamar Mandi Utama');
    expect(out[0].photo).toEqual({
      storage_path: 'site-media:site-events/p/e/m1.jpg', caption: null, is_featured: false,
      captured_at: '2026-09-11T02:00:00Z', room_id: 'r2', source_media_id: 'm1',
    });
  });

  it('skips media already pulled into this log', () => {
    const out = proposePhotosFromEvents([ev({ id: 'a', media: [media('m1', 'context'), media('m2', 'context', 1)] })], ROOMS, ['m1']);
    expect(out.map((o) => o.mediaId)).toEqual(['m2']);
  });
});

describe('mergePulledHighlights', () => {
  const line = (area: string, note: string): DailyLogHighlight =>
    ({ area, note, boq_item_id: null, sort_order: 0, room_id: null, gate_code: null, source_event_id: null });

  it('appends the picks after the curator lines and renumbers', () => {
    const picked = proposeHighlightsFromEvents([ev({ id: 'a', room_id: 'r1' })], ROOMS);
    const merged = mergePulledHighlights([line('Tangga', 'Finishing'), line('', '')], picked);
    expect(merged.map((h) => [h.area, h.sort_order])).toEqual([['Tangga', 0], ['Ruang Keluarga', 1]]);
  });
});
```

Run it:

```bash
npx jest tools/__tests__/dailyLogPull.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -6
```

Expected: `Cannot find module '../dailyLogPull'`.

- [ ] **Step 4: Write `tools/dailyLogPull.ts`**

```ts
// SANO - "Tarik dari kejadian ruangan" (spec §10.1).
//
// Pure. Turns a day's CONFIRMED site events into PROPOSED daily-log lines and
// photo offers. It proposes; it never saves. The curated-draft model from the
// 2026-06-28 Blueprint spec is unchanged: every line the client eventually
// reads was read, edited and approved by a human first.
//
// The split that matters: `progres` and `info` were already written for a
// reader and arrive pre-selected. `isu`, `hambatan`, `cacat` and
// `butuh_keputusan` are internal language - a defect list is not a client
// update - so they are LISTED but unchecked, with a note saying they need
// client-safe rewording. Nothing is hidden from the curator and nothing
// internal walks into a report on its own.

import { AREA_UMUM_NAME } from './constants';
import { SITE_MEDIA_PATH_PREFIX } from './storage';
import { compareRoomsForDisplay, type RoomLookupRow } from './clientReportRooms';
import type { DailyLogHighlight, DailyLogPhoto } from './dailySiteLogs';
import type { SiteEventMedia, SiteEventType } from './types';

/** Types whose wording is already safe for a client to read. */
export const CLIENT_SAFE_EVENT_TYPES: ReadonlyArray<SiteEventType> = ['progres', 'info'];

export const REWORDING_NOTE =
  'Tulis ulang dengan bahasa yang aman untuk klien sebelum dimasukkan ke laporan.';

export const PULL_EMPTY_NOTE =
  'Belum ada kejadian terkonfirmasi di tanggal ini.';

/** The shape tools/siteEvents.ts hands over; only what a proposal needs. */
export interface PullableEvent {
  id: string;
  event_type: SiteEventType | null;
  title: string | null;
  summary: string | null;
  room_id: string;
  gate_code: string | null;
  confirmed_at: string | null;
  media: Array<Pick<SiteEventMedia, 'id' | 'kind' | 'role' | 'storage_path' | 'sort_order'>>;
}

export interface ProposedHighlight {
  eventId: string;
  eventType: SiteEventType;
  roomLabel: string;
  /** Pre-ticked in the picker. False for the four internal types. */
  preselected: boolean;
  /** Shown as a warning line under the proposal. */
  needsRewording: boolean;
  highlight: DailyLogHighlight;
}

export interface ProposedPhoto {
  mediaId: string;
  eventId: string;
  roomLabel: string;
  photo: DailyLogPhoto;
}

function roomOrderIndex(rooms: RoomLookupRow[]): Map<string, number> {
  const ordered = [...rooms].sort(compareRoomsForDisplay);
  return new Map(ordered.map((r, i) => [r.id, i]));
}

function eventOrder(a: PullableEvent, b: PullableEvent, order: Map<string, number>): number {
  const ra = order.get(a.room_id) ?? Number.MAX_SAFE_INTEGER;
  const rb = order.get(b.room_id) ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return String(a.confirmed_at ?? '').localeCompare(String(b.confirmed_at ?? ''));
}

/**
 * One proposal per confirmed event that carries text, ordered the way the board
 * and the report order rooms. An event already pulled into this log (its id is
 * in `alreadyPulled`) is left out, so tapping "Tarik" twice cannot duplicate a
 * line.
 */
export function proposeHighlightsFromEvents(
  events: PullableEvent[],
  rooms: RoomLookupRow[],
  alreadyPulled: ReadonlyArray<string> = [],
): ProposedHighlight[] {
  const order = roomOrderIndex(rooms);
  const nameById = new Map(rooms.map((r) => [r.id, r.room_name]));
  const pulled = new Set(alreadyPulled);

  return events
    .filter((e) => e.event_type !== null && !pulled.has(e.id))
    .filter((e) => (e.summary ?? e.title ?? '').trim() !== '')
    .sort((a, b) => eventOrder(a, b, order))
    .map((e) => {
      const type = e.event_type as SiteEventType;
      const roomLabel = nameById.get(e.room_id) ?? AREA_UMUM_NAME;
      const safe = CLIENT_SAFE_EVENT_TYPES.includes(type);
      return {
        eventId: e.id,
        eventType: type,
        roomLabel,
        preselected: safe,
        needsRewording: !safe,
        highlight: {
          area: roomLabel,
          note: (e.summary ?? e.title ?? '').trim(),
          boq_item_id: null,
          sort_order: 0,
          room_id: e.room_id,
          gate_code: e.gate_code,
          source_event_id: e.id,
        },
      };
    });
}

/**
 * Context photos, offered with their room label. Never pre-featured: the
 * curator decides what a client sees, exactly as they do for photos they upload
 * themselves. Captions start empty for the same reason - an internal title is
 * not a caption.
 */
export function proposePhotosFromEvents(
  events: PullableEvent[],
  rooms: RoomLookupRow[],
  alreadyPulled: ReadonlyArray<string> = [],
): ProposedPhoto[] {
  const order = roomOrderIndex(rooms);
  const nameById = new Map(rooms.map((r) => [r.id, r.room_name]));
  const pulled = new Set(alreadyPulled);
  const out: ProposedPhoto[] = [];

  for (const e of [...events].sort((a, b) => eventOrder(a, b, order))) {
    const context = e.media
      .filter((m) => m.kind === 'photo' && m.role === 'context' && !pulled.has(m.id))
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const m of context) {
      out.push({
        mediaId: m.id,
        eventId: e.id,
        roomLabel: nameById.get(e.room_id) ?? AREA_UMUM_NAME,
        photo: {
          // D17: the prefix routes the path to the private site-media bucket,
          // so every renderer that already calls resolvePhotoUrl signs it.
          storage_path: `${SITE_MEDIA_PATH_PREFIX}${m.storage_path}`,
          caption: null,
          is_featured: false,
          captured_at: e.confirmed_at,
          room_id: e.room_id,
          source_media_id: m.id,
        },
      });
    }
  }
  return out;
}

/** Append the picked proposals to the log's existing lines, renumbering as the form does. */
export function mergePulledHighlights(
  existing: DailyLogHighlight[],
  picked: ProposedHighlight[],
): DailyLogHighlight[] {
  const kept = existing.filter((h) => h.area.trim() !== '' || h.note.trim() !== '');
  return [...kept, ...picked.map((p) => p.highlight)].map((h, i) => ({ ...h, sort_order: i }));
}
```

Only `context` photos are offered. A close-up is meaningless to a client without the wide shot beside it (spec §5.2 says exactly that about capture), and a closure photo is evidence for an internal record, not a progress picture.

- [ ] **Step 5: Read the day's confirmed events**

Append to `tools/siteEvents.ts` (plan 2 task 9), beside the other reads:

```ts
// ─── Daily Site Log pull-through (plan 4, spec §10.1) ────────────────────────

const PULL_SELECT =
  'id, event_type, title, summary, room_id, gate_code, confirmed_at, ' +
  'site_event_media(id, kind, role, storage_path, sort_order)';

/**
 * The day's CONFIRMED events, for "Tarik dari kejadian ruangan". `draft` and
 * `pending_analysis` are excluded because no human has read them yet, and
 * `discarded` because a discarded event is a decision, not an oversight.
 * `done` is included: an event opened and closed on the same day is still the
 * day's news.
 *
 * The window is a WIB calendar day with an EXCLUSIVE end, per
 * tools/timeWindow.ts - an inclusive '...T23:59:59' bound drops the last
 * fraction of a second of the day.
 */
export async function listConfirmedEventsForDay(
  projectId: string,
  isoDate: string,
): Promise<PullableEvent[]> {
  const { data, error } = await supabase
    .from('site_events')
    .select(PULL_SELECT)
    .eq('project_id', projectId)
    .in('status', ['open', 'done'])
    .gte('confirmed_at', wibStartOfDayIso(isoDate))
    .lt('confirmed_at', wibEndOfDayExclusiveIso(isoDate))
    .order('confirmed_at', { ascending: true });
  if (error) {
    console.warn('listConfirmedEventsForDay failed:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as Array<PullableEvent & { site_event_media?: PullableEvent['media'] | null }>)
    .map(({ site_event_media, ...e }) => ({ ...e, media: site_event_media ?? [] }));
}
```

with the two imports it needs at the top of the file:

```ts
import { wibStartOfDayIso, wibEndOfDayExclusiveIso } from './timeWindow';
import type { PullableEvent } from './dailyLogPull';
```

Add the matching cases to `tools/__tests__/siteEvents.test.ts`:

```ts
describe('listConfirmedEventsForDay', () => {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const c: any = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lt']) c[m] = jest.fn().mockReturnValue(c);
    c.order = jest.fn().mockResolvedValue(result);
    return c;
  }

  it('windows on the WIB day and takes confirmed statuses only', async () => {
    const c = chain({ data: [{ id: 'e1', event_type: 'progres', title: 'T', summary: 'S', room_id: 'r1', gate_code: 'C', confirmed_at: '2026-09-11T02:00:00Z', site_event_media: [{ id: 'm1', kind: 'photo', role: 'context', storage_path: 'x.jpg', sort_order: 0 }] }], error: null });
    (supabase.from as jest.Mock).mockReturnValue(c);

    const out = await listConfirmedEventsForDay('p1', '2026-09-11');
    expect(c.in).toHaveBeenCalledWith('status', ['open', 'done']);
    expect(c.gte).toHaveBeenCalledWith('confirmed_at', '2026-09-10T17:00:00.000Z');
    expect(c.lt).toHaveBeenCalledWith('confirmed_at', '2026-09-11T17:00:00.000Z');
    expect(out).toHaveLength(1);
    expect(out[0].media).toHaveLength(1);
    expect('site_event_media' in out[0]).toBe(false);
  });

  it('returns an empty list rather than throwing when the read fails', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'nope' } }));
    expect(await listConfirmedEventsForDay('p1', '2026-09-11')).toEqual([]);
  });

  it('gives an event with no media an empty array', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: [{ id: 'e1', event_type: 'info', title: null, summary: 'S', room_id: 'r1', gate_code: null, confirmed_at: 'x', site_event_media: null }], error: null }));
    expect((await listConfirmedEventsForDay('p1', '2026-09-11'))[0].media).toEqual([]);
  });
});
```

The two ISO literals are what `wibStartOfDayIso('2026-09-11')` and `wibEndOfDayExclusiveIso('2026-09-11')` actually return: `tools/timeWindow.ts` normalises the `+07:00` literal through `Date`, so the value that reaches PostgREST is the UTC spelling of the same instant. Asserting the literal rather than re-calling the helper is the point; a change to the day boundary has to be deliberate.

- [ ] **Step 6: The picker**

Create `workflows/screens/dailyLog/PullEventsSheet.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { REWORDING_NOTE, PULL_EMPTY_NOTE, type ProposedHighlight, type ProposedPhoto } from '../../../tools/dailyLogPull';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

/**
 * "Tarik dari kejadian ruangan" (spec §10.1). A picker, not an importer: it
 * shows every confirmed event of the day, pre-ticks only the two client-safe
 * types, and hands the curator's selection back. Nothing here saves.
 *
 * The four internal types are deliberately VISIBLE and unticked. Hiding them
 * would leave the curator unaware that the day had a blocker in it; ticking
 * them would put "Cacat: nat retak di KM utama" in front of a client in the
 * words a supervisor used for their own foreman.
 */
export default function PullEventsSheet(props: {
  loading: boolean;
  highlights: ProposedHighlight[];
  photos: ProposedPhoto[];
  onCancel: () => void;
  onApply: (picked: { highlights: ProposedHighlight[]; photos: ProposedPhoto[] }) => void;
}) {
  const { loading, highlights, photos, onCancel, onApply } = props;

  const [pickedH, setPickedH] = useState<Set<string>>(
    () => new Set(highlights.filter((h) => h.preselected).map((h) => h.eventId)),
  );
  const [pickedP, setPickedP] = useState<Set<string>>(() => new Set());

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  const chosen = useMemo(() => ({
    highlights: highlights.filter((h) => pickedH.has(h.eventId)),
    photos: photos.filter((p) => pickedP.has(p.mediaId)),
  }), [highlights, photos, pickedH, pickedP]);

  const total = chosen.highlights.length + chosen.photos.length;

  if (loading) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.note}>Memuat kejadian…</Text>
      </View>
    );
  }

  if (highlights.length === 0 && photos.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.note}>{PULL_EMPTY_NOTE}</Text>
        <TouchableOpacity style={styles.ghostBtn} onPress={onCancel}>
          <Text style={styles.ghostText}>Tutup</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {highlights.length > 0 && <Text style={styles.section}>Catatan ({highlights.length})</Text>}
      {highlights.map((h) => {
        const on = pickedH.has(h.eventId);
        return (
          <TouchableOpacity
            key={h.eventId}
            style={styles.row}
            onPress={() => toggle(pickedH, h.eventId, setPickedH)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Ionicons
              name={on ? 'checkbox' : 'square-outline'}
              size={20}
              color={on ? COLORS.primary : COLORS.textMuted}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowMeta}>
                {h.roomLabel} · {SITE_EVENT_TYPE_LABELS[h.eventType]}
              </Text>
              <Text style={styles.rowNote}>{h.highlight.note}</Text>
              {h.needsRewording && <Text style={styles.warn}>{REWORDING_NOTE}</Text>}
            </View>
          </TouchableOpacity>
        );
      })}

      {photos.length > 0 && <Text style={styles.section}>Foto konteks ({photos.length})</Text>}
      {photos.map((p) => {
        const on = pickedP.has(p.mediaId);
        return (
          <TouchableOpacity
            key={p.mediaId}
            style={styles.row}
            onPress={() => toggle(pickedP, p.mediaId, setPickedP)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <Ionicons
              name={on ? 'checkbox' : 'square-outline'}
              size={20}
              color={on ? COLORS.primary : COLORS.textMuted}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowMeta}>{p.roomLabel}</Text>
              <Text style={styles.rowNote}>Foto konteks · beri keterangan setelah ditarik</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghostBtn} onPress={onCancel}>
          <Text style={styles.ghostText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, total === 0 && { opacity: 0.5 }]}
          disabled={total === 0}
          onPress={() => onApply(chosen)}
        >
          <Text style={styles.primaryText}>Tarik {total > 0 ? `(${total})` : ''}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE.xs, paddingTop: SPACE.sm },
  section: { fontSize: TYPE.xs, fontFamily: FONTS.bold, color: COLORS.accentDark, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACE.md },
  row: { flexDirection: 'row', gap: SPACE.sm, alignItems: 'flex-start', paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub },
  rowBody: { flex: 1 },
  rowMeta: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec },
  rowNote: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, marginTop: 2, lineHeight: 18 },
  warn: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.warning, marginTop: 4, lineHeight: 16 },
  note: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, paddingVertical: SPACE.sm },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  primaryBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },
});
```

- [ ] **Step 7: Wire it into `DailyLogScreen`**

In `workflows/screens/DailyLogScreen.tsx`, add the imports:

```tsx
import PullEventsSheet from './dailyLog/PullEventsSheet';
import { listConfirmedEventsForDay } from '../../tools/siteEvents';
import { listRooms } from '../../tools/rooms';
import {
  mergePulledHighlights, proposeHighlightsFromEvents, proposePhotosFromEvents,
  type ProposedHighlight, type ProposedPhoto,
} from '../../tools/dailyLogPull';
```

Replace the three inline highlight literals with a shared constant, so the five new fields are written in exactly one place. Above `todayIso()`:

```tsx
const EMPTY_HIGHLIGHT: DailyLogHighlight = {
  area: '', note: '', boq_item_id: null, sort_order: 0,
  room_id: null, gate_code: null, source_event_id: null,
};
```

then `useState<DailyLogHighlight[]>([EMPTY_HIGHLIGHT])`, `setHighlights(existing.highlights.length ? existing.highlights : [EMPTY_HIGHLIGHT])`, and `addHighlight` becomes `setHighlights((prev) => [...prev, { ...EMPTY_HIGHLIGHT, sort_order: prev.length }])`. In `addPhoto`, the appended literal gains `room_id: null, source_media_id: null`.

Add the pull state and loader next to the other hooks:

```tsx
  const [pullOpen, setPullOpen] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullH, setPullH] = useState<ProposedHighlight[]>([]);
  const [pullP, setPullP] = useState<ProposedPhoto[]>([]);

  // Only offered once the project has rooms: a Struktur project with no rooms
  // would show an empty sheet and teach the curator to ignore the button.
  const openPull = async () => {
    if (!project) return;
    setPullOpen(true);
    setPullLoading(true);
    try {
      const [events, rooms] = await Promise.all([
        listConfirmedEventsForDay(project.id, logDate),
        listRooms(project.id, { includeInactive: true }),
      ]);
      // Anything already on this log is excluded, so re-opening the sheet after
      // a pull never offers the same event or photo twice.
      const pulledEvents = highlights.map((h) => h.source_event_id).filter((v): v is string => !!v);
      const pulledMedia = photos.map((p) => p.source_media_id).filter((v): v is string => !!v);
      setPullH(proposeHighlightsFromEvents(events, rooms, pulledEvents));
      setPullP(proposePhotosFromEvents(events, rooms, pulledMedia));
    } catch (err: any) {
      toast(err.message ?? 'Gagal memuat kejadian ruangan', 'critical');
      setPullOpen(false);
    } finally {
      setPullLoading(false);
    }
  };

  const applyPull = (picked: { highlights: ProposedHighlight[]; photos: ProposedPhoto[] }) => {
    setHighlights((prev) => mergePulledHighlights(prev, picked.highlights));
    setPhotos((prev) => [...prev, ...picked.photos.map((p) => p.photo)]);
    setPullOpen(false);
    toast(`${picked.highlights.length + picked.photos.length} item ditarik — silakan tinjau`, 'ok');
  };
```

Finally, give the "Update Lapangan" card the button and the sheet. Change its opening tag to carry a right action and mount the sheet above the highlight list:

```tsx
        <Card
          title="Update Lapangan"
          subtitle="Catatan progres naratif. Kaitkan ke item BoQ bila relevan (opsional)."
          rightAction={
            <TouchableOpacity onPress={() => (pullOpen ? setPullOpen(false) : void openPull())} accessibilityRole="button">
              <Text style={styles.pullLink}>{pullOpen ? 'Tutup' : 'Tarik dari kejadian ruangan'}</Text>
            </TouchableOpacity>
          }
        >
          {pullOpen && (
            <PullEventsSheet
              loading={pullLoading}
              highlights={pullH}
              photos={pullP}
              onCancel={() => setPullOpen(false)}
              onApply={applyPull}
            />
          )}
          {highlights.map((h, i) => (
```

and add the one style:

```tsx
  pullLink: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary },
```

The pulled photo rows land in `photos` with `is_featured: false`, so the existing "Dokumentasi" card shows them unstarred and the curator still has to mark what a client sees. That is the same rule the 2026-06-28 work established when it stopped force-featuring every upload (`workflows/screens/DailyLogScreen.tsx:64-69`).

- [ ] **Step 8: Fix the one other writer of a highlight**

`workflows/screens/ProgresScreen.tsx:157` builds a highlight inline when a supervisor pushes a progress note into the day's log. `tsc` will name it. Add the three nulls:

```tsx
        highlights: [...highlights, { area: item?.label ?? 'Progres', note, boq_item_id: boqId, sort_order: highlights.length, room_id: null, gate_code: null, source_event_id: null }],
```

A quick-add from Progres is not room-scoped in release 1, so nulls are the truth here, and the Finishing report will bucket the line into Area Umum rather than dropping it.

- [ ] **Step 9: Verify and commit**

```bash
npx jest tools/__tests__/dailyLogPull.test.ts tools/__tests__/dailySiteLogs.test.ts tools/__tests__/siteEvents.test.ts tools/__tests__/clientReport.test.ts tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -5
```

Expected: every suite passes, and no `tsc` output. If `tsc` reports `Property 'room_id' is missing` anywhere else, that is the widened type doing its job: add the nulls there too rather than making the fields optional.

```bash
git add tools/dailySiteLogs.ts tools/dailyLogPull.ts tools/siteEvents.ts \
  tools/__tests__/dailyLogPull.test.ts tools/__tests__/dailySiteLogs.test.ts tools/__tests__/siteEvents.test.ts \
  workflows/screens/dailyLog/PullEventsSheet.tsx workflows/screens/DailyLogScreen.tsx workflows/screens/ProgresScreen.tsx
git commit -m "$(cat <<'EOF'
feat(daily-log): tarik dari kejadian ruangan

Spec §10.1. The day's confirmed events become PROPOSED log lines and photo
offers: progres and info pre-selected, the four internal types listed and
unticked with a rewording note. Pulled lines carry 098's room_id, gate_code
and source_event_id through to the insert, so the Finishing report can group
them and a second pull cannot duplicate them. Nothing is saved without the
curator.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Papan Ruangan

Spec §9. A summary strip (open hambatan, overdue, butuh keputusan, rooms quiet more than 3 days), room cards grouped by floor with the last gate and step chip, open counts by type, owner initials, the age of the last update, an overdue badge and a grey card when the room is quiet, plus filters on floor, event type, owner and overdue-only. One component, three mounts: the office tab, a new principal tab, and a phone layout the supervisor reaches from Progres.

**Files:**
- Create: `tools/roomBoard.ts`, `office/screens/rooms/RoomBoardView.tsx`, `office/screens/PrincipalRoomsScreen.tsx`, `workflows/screens/RoomBoardScreen.tsx`
- Modify: `office/screens/RoomsAdminScreen.tsx`, `office/PrincipalNavigation.tsx`, `workflows/navigation.tsx`, `workflows/screens/ProgresScreen.tsx`
- Test: `tools/__tests__/roomBoard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/roomBoard.test.ts`:

```ts
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import {
  boardSummary, filterBoard, floorOptions, lastUpdateLabel, openChips, openCount, ownerOptions,
} from '../roomBoard';
import type { RoomBoardRow } from '../types';

function row(p: Partial<RoomBoardRow> & { room_id: string }): RoomBoardRow {
  return {
    project_id: 'p1', room_code: p.room_id.toUpperCase(), room_name: p.room_id, floor: '1',
    sort_order: 0, area_type: 'general', active: true,
    open_progres: 0, open_isu: 0, open_hambatan: 0, open_cacat: 0,
    open_butuh_keputusan: 0, open_info: 0, overdue_count: 0,
    last_event_at: null, last_gate_code: null, last_step_code: null,
    is_quiet: true, owner_initials: [], ...p,
  } as RoomBoardRow;
}

describe('boardSummary', () => {
  it('adds the three open counts the strip shows', () => {
    const s = boardSummary([
      row({ room_id: 'a', open_hambatan: 2, open_butuh_keputusan: 1, overdue_count: 1, is_quiet: false, last_event_at: '2026-09-10T00:00:00Z' }),
      row({ room_id: 'b', open_hambatan: 1, overdue_count: 3, is_quiet: false, last_event_at: '2026-09-10T00:00:00Z' }),
    ]);
    expect(s).toEqual({ hambatan: 3, overdue: 4, butuhKeputusan: 1, quietRooms: 0 });
  });

  it('counts a quiet room only when it has ever had an event', () => {
    const s = boardSummary([
      row({ room_id: 'used', is_quiet: true, last_event_at: '2026-09-01T00:00:00Z' }),
      row({ room_id: 'never', is_quiet: true, last_event_at: null }),
    ]);
    expect(s.quietRooms).toBe(1);
  });
});

describe('filterBoard', () => {
  const rows = [
    row({ room_id: 'a', floor: '1', open_isu: 2, overdue_count: 1, owner_initials: ['AS'] }),
    row({ room_id: 'b', floor: '2', open_cacat: 1, owner_initials: ['BW', 'AS'] }),
    row({ room_id: 'c', floor: null, owner_initials: [] }),
  ];
  it('filters by floor, including the floorless bucket', () => {
    expect(filterBoard(rows, { floor: '2' }).map((r) => r.room_id)).toEqual(['b']);
    expect(filterBoard(rows, { floor: '' }).map((r) => r.room_id)).toEqual(['c']);
  });
  it('filters by event type, keeping only rooms that actually have one open', () => {
    expect(filterBoard(rows, { eventType: 'isu' }).map((r) => r.room_id)).toEqual(['a']);
    expect(filterBoard(rows, { eventType: 'info' })).toEqual([]);
  });
  it('filters by owner initials and by overdue only', () => {
    expect(filterBoard(rows, { owner: 'AS' }).map((r) => r.room_id)).toEqual(['a', 'b']);
    expect(filterBoard(rows, { overdueOnly: true }).map((r) => r.room_id)).toEqual(['a']);
  });
  it('combines filters', () => {
    expect(filterBoard(rows, { owner: 'AS', overdueOnly: true }).map((r) => r.room_id)).toEqual(['a']);
  });
  it('returns everything when nothing is set', () => {
    expect(filterBoard(rows, {})).toHaveLength(3);
  });
});

describe('option lists', () => {
  it('lists floors in board order and owners sorted', () => {
    const rows = [row({ room_id: 'a', floor: '1', owner_initials: ['BW'] }), row({ room_id: 'b', floor: '2', owner_initials: ['AS', 'BW'] }), row({ room_id: 'c', floor: '1' })];
    expect(floorOptions(rows)).toEqual(['1', '2']);
    expect(ownerOptions(rows)).toEqual(['AS', 'BW']);
  });
});

describe('lastUpdateLabel', () => {
  const now = new Date('2026-09-11T08:00:00Z');
  it('never invents a date for a room that has had no event', () => {
    expect(lastUpdateLabel(null, now)).toBe('Belum ada kejadian');
    expect(lastUpdateLabel('not-a-date', now)).toBe('Belum ada kejadian');
  });
  it('reads today, yesterday and N days', () => {
    expect(lastUpdateLabel('2026-09-11T01:00:00Z', now)).toBe('Hari ini');
    expect(lastUpdateLabel('2026-09-10T01:00:00Z', now)).toBe('Kemarin');
    expect(lastUpdateLabel('2026-09-05T01:00:00Z', now)).toBe('6 hari lalu');
  });
});

describe('openChips and openCount', () => {
  it('shows only the types with open events, in the declared order', () => {
    const r = row({ room_id: 'a', open_progres: 1, open_hambatan: 2 });
    expect(openChips(r)).toEqual([
      { type: 'progres', label: 'Progres', count: 1 },
      { type: 'hambatan', label: 'Hambatan', count: 2 },
    ]);
    expect(openCount(r, 'cacat')).toBe(0);
  });
});
```

Run it; expected: `Cannot find module '../roomBoard'`.

- [ ] **Step 2: Write `tools/roomBoard.ts`**

```ts
// SANO - Papan Ruangan (spec §9).
//
// One read of v_room_board (migration 097) plus the pure summary, filter and
// age rules the three role layouts share. The board and the Finishing-phase
// client report order rooms with the SAME comparator
// (tools/clientReportRooms.ts), so they can never disagree about where a room
// sits.
//
// Nothing here derives a verdict. The view counts what is open, what is
// overdue and when the room was last touched; a room with no events reads
// "Belum ada kejadian", never "selesai".

import { supabase } from './supabase';
import { compareRoomsForDisplay } from './clientReportRooms';
import { SITE_EVENT_TYPE_LABELS } from './constants';
import type { RoomBoardRow, SiteEventType } from './types';

/** Every column of v_room_board, one literal (see the ROOM_COLUMNS note in tools/rooms.ts). */
export const ROOM_BOARD_COLUMNS =
  'room_id, project_id, room_code, room_name, floor, sort_order, area_type, active, ' +
  'open_progres, open_isu, open_hambatan, open_cacat, open_butuh_keputusan, open_info, ' +
  'overdue_count, last_event_at, last_gate_code, last_step_code, is_quiet, owner_initials';

export async function listRoomBoard(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<RoomBoardRow[]> {
  let q = supabase.from('v_room_board').select(ROOM_BOARD_COLUMNS).eq('project_id', projectId);
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) {
    console.warn('listRoomBoard failed:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as RoomBoardRow[]).slice().sort(compareRoomsForDisplay);
}

// ─── Pure ────────────────────────────────────────────────────────────────────

export const OPEN_COUNT_COLUMNS: Record<SiteEventType, keyof RoomBoardRow> = {
  progres: 'open_progres',
  isu: 'open_isu',
  hambatan: 'open_hambatan',
  cacat: 'open_cacat',
  butuh_keputusan: 'open_butuh_keputusan',
  info: 'open_info',
};

export function openCount(row: RoomBoardRow, type: SiteEventType): number {
  return Number(row[OPEN_COUNT_COLUMNS[type]] ?? 0);
}

/** The four numbers in the strip above the cards (spec §9). */
export interface BoardSummary {
  hambatan: number;
  overdue: number;
  butuhKeputusan: number;
  quietRooms: number;
}

export function boardSummary(rows: RoomBoardRow[]): BoardSummary {
  return rows.reduce<BoardSummary>((acc, r) => ({
    hambatan: acc.hambatan + Number(r.open_hambatan ?? 0),
    overdue: acc.overdue + Number(r.overdue_count ?? 0),
    butuhKeputusan: acc.butuhKeputusan + Number(r.open_butuh_keputusan ?? 0),
    // A room with no event at all is not "quiet since an update stopped"; it
    // has simply never been used, and counting it would inflate the number the
    // PM acts on. The view's is_quiet covers both, so the strip narrows it.
    quietRooms: acc.quietRooms + (r.is_quiet && r.last_event_at !== null ? 1 : 0),
  }), { hambatan: 0, overdue: 0, butuhKeputusan: 0, quietRooms: 0 });
}

export interface BoardFilters {
  floor?: string | null;
  eventType?: SiteEventType | null;
  /** Owner initials as v_room_board reports them; the picker offers only what is on the board. */
  owner?: string | null;
  overdueOnly?: boolean;
}

export function filterBoard(rows: RoomBoardRow[], f: BoardFilters): RoomBoardRow[] {
  return rows.filter((r) => {
    if (f.floor != null && (r.floor ?? '') !== f.floor) return false;
    if (f.eventType && openCount(r, f.eventType) === 0) return false;
    if (f.owner && !(r.owner_initials ?? []).includes(f.owner)) return false;
    if (f.overdueOnly && Number(r.overdue_count ?? 0) === 0) return false;
    return true;
  });
}

/** Floor values present on the board, in board order, "" for the floorless ones. */
export function floorOptions(rows: RoomBoardRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const floor = r.floor ?? '';
    if (!seen.includes(floor)) seen.push(floor);
  }
  return seen;
}

/** Owner initials present on the board, sorted, deduplicated. */
export function ownerOptions(rows: RoomBoardRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const i of r.owner_initials ?? []) set.add(i);
  return [...set].sort();
}

/** "Hari ini" / "2 hari lalu" / "Belum ada kejadian". Never guesses a date. */
export function lastUpdateLabel(lastEventAt: string | null, now: Date = new Date()): string {
  if (!lastEventAt) return 'Belum ada kejadian';
  const then = new Date(lastEventAt);
  if (Number.isNaN(then.getTime())) return 'Belum ada kejadian';
  const days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  if (days <= 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  return `${days} hari lalu`;
}

/** The chips a card shows: only the types that actually have open events. */
export function openChips(row: RoomBoardRow): Array<{ type: SiteEventType; label: string; count: number }> {
  return (Object.keys(OPEN_COUNT_COLUMNS) as SiteEventType[])
    .map((type) => ({ type, label: SITE_EVENT_TYPE_LABELS[type], count: openCount(row, type) }))
    .filter((c) => c.count > 0);
}
```

- [ ] **Step 3: Write the board itself**

Create `office/screens/rooms/RoomBoardView.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../../workflows/components/Card';
import {
  listRoomBoard, boardSummary, filterBoard, floorOptions, ownerOptions,
  lastUpdateLabel, openChips, type BoardFilters,
} from '../../../tools/roomBoard';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import type { RoomBoardRow, SiteEventType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../../workflows/theme';

/**
 * Papan Ruangan (spec §9). One read of v_room_board, the summary strip, the
 * filters, and room cards grouped by floor. Shared by all three role layouts:
 * the office tab, the principal tab and the supervisor's phone screen. The
 * only thing that varies is `onOpenRoom`, because a supervisor's room screen
 * and an office room detail are different routes.
 *
 * Nothing here derives a verdict. The strip counts what is open and what is
 * late; a room with no events reads "Belum ada kejadian", never "selesai".
 * Rooms sort through tools/clientReportRooms.ts, the same comparator the
 * client report uses, so the board and the report agree (spec §9).
 */
export default function RoomBoardView(props: {
  projectId: string | null;
  onOpenRoom: (row: RoomBoardRow) => void;
  /** Rendered in the strip card's title row. The office tab puts its sub-screen link here. */
  headerAction?: React.ReactNode;
  /** Phone layout wraps the filter pills instead of overflowing a 360dp screen. */
  compact?: boolean;
}) {
  const { projectId, onOpenRoom, headerAction, compact } = props;

  const [rows, setRows] = useState<RoomBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<BoardFilters>({});

  const load = useCallback(async () => {
    if (!projectId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setRows(await listRoomBoard(projectId));
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => boardSummary(rows), [rows]);
  const shown = useMemo(() => filterBoard(rows, filters), [rows, filters]);
  const floors = useMemo(() => floorOptions(rows), [rows]);
  const owners = useMemo(() => ownerOptions(rows), [rows]);

  // Floors in board order; the comparator already put Area Umum and the
  // floorless rooms last, so first-appearance order is the right order.
  const byFloor = useMemo(() => {
    const groups: Array<[string, RoomBoardRow[]]> = [];
    for (const r of shown) {
      const key = r.floor || 'Tanpa lantai';
      const last = groups[groups.length - 1];
      if (last && last[0] === key) last[1].push(r);
      else groups.push([key, [r]]);
    }
    return groups;
  }, [shown]);

  const setFilter = (patch: BoardFilters) => setFilters((prev) => ({ ...prev, ...patch }));
  const anyFilter = filters.floor != null || !!filters.eventType || !!filters.owner || !!filters.overdueOnly;

  if (!projectId) {
    return <Card><Text style={styles.empty}>Pilih proyek terlebih dahulu.</Text></Card>;
  }

  return (
    <>
      <Card title="Papan Ruangan" subtitle="Ringkasan kejadian per ruangan." rightAction={headerAction}>
        <View style={styles.strip}>
          <Stat label="Hambatan" value={summary.hambatan} color={COLORS.critical} />
          <Stat label="Lewat tenggat" value={summary.overdue} color={COLORS.high} />
          <Stat label="Butuh keputusan" value={summary.butuhKeputusan} color={COLORS.warning} />
          <Stat label="Sepi > 3 hari" value={summary.quietRooms} color={COLORS.textMuted} />
        </View>
      </Card>

      <Card title="Saringan">
        <View style={[styles.pillRow, compact && styles.pillRowWrap]}>
          <Pill label="Semua lantai" on={filters.floor == null} onPress={() => setFilter({ floor: null })} />
          {floors.map((f) => (
            <Pill
              key={f || 'none'}
              label={f || 'Tanpa lantai'}
              on={filters.floor === f}
              onPress={() => setFilter({ floor: filters.floor === f ? null : f })}
            />
          ))}
        </View>
        <View style={[styles.pillRow, compact && styles.pillRowWrap]}>
          {(Object.keys(SITE_EVENT_TYPE_LABELS) as SiteEventType[]).map((t) => (
            <Pill
              key={t}
              label={SITE_EVENT_TYPE_LABELS[t]}
              on={filters.eventType === t}
              onPress={() => setFilter({ eventType: filters.eventType === t ? null : t })}
            />
          ))}
        </View>
        <View style={[styles.pillRow, compact && styles.pillRowWrap]}>
          {owners.map((o) => (
            <Pill key={o} label={o} on={filters.owner === o} onPress={() => setFilter({ owner: filters.owner === o ? null : o })} />
          ))}
          <Pill
            label="Lewat tenggat"
            on={!!filters.overdueOnly}
            onPress={() => setFilter({ overdueOnly: !filters.overdueOnly })}
          />
          {anyFilter && (
            <TouchableOpacity onPress={() => setFilters({})} accessibilityRole="button">
              <Text style={styles.clear}>Hapus saringan</Text>
            </TouchableOpacity>
          )}
        </View>
      </Card>

      {loading && <Card><ActivityIndicator color={COLORS.primary} /></Card>}

      {!loading && shown.length === 0 && (
        <Card>
          <Text style={styles.empty}>
            {rows.length === 0
              ? 'Belum ada ruangan di proyek ini. Buat ruangan di "Kelola ruangan".'
              : 'Tidak ada ruangan yang cocok dengan saringan ini.'}
          </Text>
        </Card>
      )}

      {!loading && byFloor.map(([floor, group]) => (
        <Card key={floor} title={floor}>
          {group.map((r) => (
            <TouchableOpacity
              key={r.room_id}
              style={[styles.roomRow, r.is_quiet && styles.quiet]}
              onPress={() => onOpenRoom(r)}
              accessibilityRole="button"
              accessibilityLabel={`Buka ruangan ${r.room_name}`}
            >
              <View style={styles.roomHead}>
                <Text style={styles.roomName}>{r.room_name}</Text>
                {r.overdue_count > 0 && (
                  <View style={styles.overdue}>
                    <Text style={styles.overdueText}>{r.overdue_count} lewat tenggat</Text>
                  </View>
                )}
              </View>
              <Text style={styles.roomMeta}>
                {r.last_gate_code
                  ? `Gerbang ${r.last_gate_code}${r.last_step_code ? ` · ${r.last_step_code}` : ''}`
                  : 'Belum ada gerbang'}
                {' · '}{lastUpdateLabel(r.last_event_at)}
              </Text>
              <View style={styles.chipRow}>
                {openChips(r).map((c) => (
                  <View key={c.type} style={styles.chip}>
                    <Text style={styles.chipText}>{c.label} {c.count}</Text>
                  </View>
                ))}
                {openChips(r).length === 0 && <Text style={styles.noneText}>Tidak ada kejadian terbuka</Text>}
                {r.owner_initials.length > 0 && (
                  <Text style={styles.owners}>
                    <Ionicons name="person-outline" size={11} color={COLORS.textSec} /> {r.owner_initials.join(' · ')}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </Card>
      ))}
    </>
  );
}

function Stat(props: { label: string; value: number; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: props.value > 0 ? props.color : COLORS.textMuted }]}>{props.value}</Text>
      <Text style={styles.statLabel}>{props.label}</Text>
    </View>
  );
}

function Pill(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.pill, props.on && styles.pillOn]}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.on }}
    >
      <Text style={[styles.pillText, props.on && styles.pillTextOn]}>{props.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 18 },
  strip: { flexDirection: 'row', gap: SPACE.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: SPACE.sm, backgroundColor: COLORS.surfaceSunken, borderRadius: RADIUS_SM },
  statValue: { fontSize: TYPE.xl, fontFamily: FONTS.bold },
  statLabel: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.textSec, textAlign: 'center', marginTop: 2 },
  pillRow: { flexDirection: 'row', gap: SPACE.xs, alignItems: 'center', marginBottom: SPACE.xs },
  pillRowWrap: { flexWrap: 'wrap' },
  pill: { paddingHorizontal: SPACE.sm, paddingVertical: 5, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: COLORS.border },
  pillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec },
  pillTextOn: { color: COLORS.textInverse },
  clear: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, paddingHorizontal: SPACE.xs },
  roomRow: { paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  quiet: { opacity: 0.55 },
  roomHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm },
  roomName: { flex: 1, fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  overdue: { backgroundColor: COLORS.highBg, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  overdueText: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.high, textTransform: 'uppercase', letterSpacing: 0.4 },
  roomMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center', marginTop: SPACE.xs },
  chip: { backgroundColor: COLORS.accentBg, borderRadius: RADIUS_SM, paddingHorizontal: SPACE.sm, paddingVertical: 2 },
  chipText: { fontSize: 10, fontFamily: FONTS.semibold, color: COLORS.accentDark },
  noneText: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted },
  owners: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginLeft: 'auto' },
});
```

The quiet card is `opacity: 0.55` rather than a grey background because the card surface already carries the shadow and border the whole app uses; fading the whole row keeps the "nothing has happened here" reading without inventing a second card treatment.

- [ ] **Step 4: Make the board the office tab's main view**

`office/navigation.tsx` does not change. `office/screens/RoomsAdminScreen.tsx` gains a third sub-module, and the board becomes the default. Add two imports:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
```

```tsx
import GatesAdminScreen from './GatesAdminScreen';
import RoomBoardView from './rooms/RoomBoardView';
```

Widen the sub-module type (line 22) and its default (line 29):

```tsx
// 'board' is the tab's main view (spec §9); the two authoring screens plan 1
// shipped become sub-screens reached from it. Plan 1's route, icon, label and
// deep link are untouched: this is one more value on a switch that already
// existed.
type SubModule = 'board' | 'rooms' | 'gates';
```

```tsx
  const [sub, setSub] = useState<SubModule>('board');
```

Add the navigator handle beside the other hooks:

```tsx
  const { project, profile, refresh } = useProject();
  const { show: toast } = useToast();
  const navigation = useNavigation<any>();
```

Replace the single early return (line 172) with two:

```tsx
  if (sub === 'gates') return <GatesAdminScreen onBack={() => setSub('board')} />;

  if (sub === 'board') {
    return (
      <View style={styles.flex}>
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <RoomBoardView
            projectId={project?.id ?? null}
            onOpenRoom={(row) => {
              if (!project || !row.room_code) return;
              navigation.navigate('RoomDetail', { projectCode: project.code, roomCode: row.room_code });
            }}
            headerAction={
              <TouchableOpacity onPress={() => setSub('rooms')} accessibilityRole="button">
                <Text style={styles.linkBtn}>Kelola ruangan</Text>
              </TouchableOpacity>
            }
          />
        </ScrollView>
      </View>
    );
  }
```

"Kelola gerbang" keeps the link plan 1 put on the Ruangan card (`office/screens/RoomsAdminScreen.tsx:206`), so both sub-screens stay reachable in at most two taps. Give the authoring view a way back by adding a row above its heading:

```tsx
        <TouchableOpacity onPress={() => setSub('board')} style={styles.back} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Papan Ruangan</Text>
        </TouchableOpacity>
        <Text style={styles.sectionHead}>Kelola ruangan</Text>
```

and the two styles it needs, after `roomSub`:

```tsx
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
```

Project phase stays where plan 1 put it, on the "Kelola ruangan" sub-screen. Spec §9's last line ("Project phase is set from the same office area") is satisfied, and setting a phase is an authoring act, not a monitoring one.

- [ ] **Step 5: The principal tab**

Create `office/screens/PrincipalRoomsScreen.tsx`:

```tsx
import React from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Header from '../../workflows/components/Header';
import { useProject } from '../../workflows/hooks/useProject';
import RoomBoardView from './rooms/RoomBoardView';
import { COLORS, SPACE } from '../../workflows/theme';

/**
 * The principal's "Ruangan" tab (spec §9). Read-only by construction: it mounts
 * the board and nothing else. Room authoring and gate editing stay in the
 * office tab, which a principal does not have; tapping a room opens the same
 * read-only RoomDetail a scanned QR lands on.
 */
export default function PrincipalRoomsScreen() {
  const { project } = useProject();
  const navigation = useNavigation<any>();

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <RoomBoardView
          projectId={project?.id ?? null}
          onOpenRoom={(row) => {
            if (!project || !row.room_code) return;
            navigation.navigate('RoomDetail', { projectCode: project.code, roomCode: row.room_code });
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
});
```

In `office/PrincipalNavigation.tsx`, add the lazy import beside `RoomDetailScreen` (line 18):

```tsx
const PrincipalRoomsScreen = lazyScreen(() => import('./screens/PrincipalRoomsScreen'));
```

add `Rooms: undefined;` to `PrincipalTabParamList` between `Approvals` and `Reports`, add `Rooms: 'business-outline',` to `ICON_MAP`, `Rooms: 'business',` to `ICON_MAP_ACTIVE` and `Rooms: 'Ruangan',` to `LABEL_MAP` (all between their `Approvals` and `Reports` entries, so the tab order matches), and mount it between the two matching screens:

```tsx
        <Tab.Screen name="Approvals" component={ApprovalsScreen} />
        <Tab.Screen name="Rooms" component={PrincipalRoomsScreen} />
        <Tab.Screen name="Reports" component={OfficeReportsScreen} />
```

The hidden `RoomDetail` route plan 1 already registered is what `onOpenRoom` targets, so nothing about linking changes.

- [ ] **Step 6: The supervisor's phone layout**

Create `workflows/screens/RoomBoardScreen.tsx`:

```tsx
import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import { useProject } from '../hooks/useProject';
import RoomBoardView from '../../office/screens/rooms/RoomBoardView';
import { COLORS, FONTS, SPACE, TYPE } from '../theme';

/**
 * Papan Ruangan on a phone (spec §9: "supervisors get the same data in a phone
 * layout reached from Progres"). Same component, same data, `compact` so the
 * filter pills wrap instead of overflowing a 360dp screen.
 *
 * Tapping a room opens the supervisor's own RoomScreen, not the office detail:
 * that is where "Lapor" lives (plan 2 task 12), so the board doubles as a way
 * into capture for a room whose label is out of reach.
 */
export default function RoomBoardScreen() {
  const { project } = useProject();
  const navigation = useNavigation<any>();

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => navigation.navigate('Progres')} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color={COLORS.textSec} />
          <Text style={styles.backText}>Kembali</Text>
        </TouchableOpacity>
        <RoomBoardView
          compact
          projectId={project?.id ?? null}
          onOpenRoom={(row) => {
            if (!project || !row.room_code) return;
            navigation.navigate('Room', { projectCode: project.code, roomCode: row.room_code });
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.textSec },
});
```

In `workflows/navigation.tsx`, add the lazy import after `RoomScreen` (line 20):

```tsx
const RoomBoardScreen = lazyScreen(() => import('./screens/RoomBoardScreen'));
```

add `RoomBoard:  undefined;` to `TabParamList` after `Room`, add `RoomBoard:  'grid-outline',` to `ICON_MAP` and `RoomBoard:  'grid',` to `ICON_MAP_ACTIVE`, and register the hidden screen after the `Room` one:

```tsx
        <Tab.Screen
          name="RoomBoard"
          component={RoomBoardScreen}
          options={{
            tabBarAccessibilityLabel: 'Papan Ruangan',
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
          }}
        />
```

`RoomBoard` is deliberately **not** added to the `buildLinking` map: it has no URL, so `getPathFromState` keeps the address bar at `/` when it is focused, which is the rule `workflows/linking.ts` established for every non-deep-linked route.

- [ ] **Step 7: The Progres hub entry**

Spec §9 says supervisors reach the board from Progres. The hub's existing "Ruangan" button opens the scanner (`workflows/screens/ProgresScreen.tsx:343,349`), which is the one-tap path the whole capture flow depends on, so it stays exactly as it is and a second button is added beside it. In the hub array:

```tsx
                { key: 'ruangan' as const, icon: 'qr-code', label: 'Ruangan', color: COLORS.info },
                { key: 'papan' as const, icon: 'grid', label: 'Papan', color: COLORS.accentDark },
```

and in the handler:

```tsx
                    if (btn.key === 'ruangan') navigation.navigate('RoomScan');
                    else if (btn.key === 'papan') navigation.navigate('RoomBoard');
                    else setActiveModule(btn.key as SubModule);
```

`styles.hubGrid` already sets `flexWrap: 'wrap'` (`:608`), so a fourth button wraps onto a second line on a phone rather than being squeezed.

- [ ] **Step 8: Verify and commit**

```bash
npx jest tools/__tests__/roomBoard.test.ts tools/__tests__/clientReportRooms.test.ts tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
npx expo export --platform web 2>&1 | tail -5
```

Expected: `Tests: 32 passed, 32 total` across the three suites (11 in `roomBoard`, 15 in `clientReportRooms`, 6 in `clientReportGolden`), no `tsc` output, and a successful web export. The export matters here specifically: `RoomBoardScreen` is the first `workflows/` screen to import from `office/`, and an untracked or mistyped path is the one class of error CI's `tsc` run catches but a stale Metro cache can hide (see the "CI misses untracked files" entry in the project memory).

```bash
git add tools/roomBoard.ts tools/__tests__/roomBoard.test.ts \
  office/screens/rooms/RoomBoardView.tsx office/screens/PrincipalRoomsScreen.tsx office/screens/RoomsAdminScreen.tsx \
  office/PrincipalNavigation.tsx workflows/screens/RoomBoardScreen.tsx workflows/navigation.tsx workflows/screens/ProgresScreen.tsx
git commit -m "$(cat <<'EOF'
feat(rooms): Papan Ruangan for office, principal and supervisor

Spec §9. One board component over v_room_board: summary strip, floor/type/
owner/overdue filters, room cards grouped by floor with the last gate chip,
open counts, owner initials, an overdue badge and a faded card when a room
has gone quiet. The office Ruangan tab now opens on the board with "Kelola
ruangan" and "Kelola gerbang" as sub-screens, principal gets the tab plan 1
deferred, and the Progres hub gains a "Papan" button beside the scanner.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migration `099_site_event_assignment.sql`

Spec §9 requires the room timeline to let office roles and the reporter move an open event's owner and its due date. Plan 2 task 4's `site_events_human_fields_rpc_only` trigger (its deviation D5) refuses any direct write to those columns by an `authenticated` session, deliberately, so that `confirm_site_event` stays the only path into the human fields. This migration adds the one narrow RPC that guard is willing to let through.

**Files:**
- Create: `supabase/migrations/099_site_event_assignment.sql`
- Test: `tools/__tests__/migration099.test.ts`

- [ ] **Step 1: Write the failing static guard**

Create `tools/__tests__/migration099.test.ts`:

```ts
/**
 * Static guard for migration 099 (reassigning an open site event).
 *
 * Like the 088/092/095/096 suites this touches no database: migrations are
 * pasted into the Supabase Dashboard, so the SQL text IS the artifact under
 * test. Guards read CODE, the file with every full-line comment removed, so
 * the header or the self-check footer can never satisfy a guard the SQL fails.
 *
 *  • The RPC exists because 097's site_events_human_fields_rpc_only refuses a
 *    direct write to owner_id and due_date. Inside a SECURITY DEFINER function
 *    that trigger returns early, so EVERY rule it would have enforced has to be
 *    written out here. Each of the refusals below is one of those rules;
 *    losing one silently reopens the hole the trigger was closing.
 *  • REVOKE before GRANT, and anon never gets EXECUTE: the function moves
 *    accountability, so an unauthenticated caller must not reach it at all.
 *  • search_path is pinned, or a SECURITY DEFINER function can be aimed at an
 *    attacker's schema.
 *  • No DDL on any table and exactly one CREATE OR REPLACE, so a second paste
 *    is a no-op (the migration history on this project is divergent and files
 *    get re-pasted).
 *  • No later migration redefines the function, which a re-paste of 099 would
 *    revert.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '099_site_event_assignment.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL); // comments can never satisfy a guard

const SIG = 'update_site_event_assignment(UUID, UUID, DATE)';

describe('migration 099 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/2026-09-10-papan-ruangan-blueprint\.md/);
  });

  it('names its place in the paste order, after 098', () => {
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/After 096, 097 and 098/);
  });

  it('says out loud that it must be re-paste safe, and what a re-paste can undo', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/migration099\.test\.ts/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting\)/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(9);
  });
});

describe('migration 099 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid that shows the outcome without reading a notice', () => {
    expect(CODE.trimEnd()).toMatch(/SELECT proname, prosecdef, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname = 'update_site_event_assignment';$/);
  });
});

describe('migration 099 - a second paste cannot fail', () => {
  it('defines exactly one function, with CREATE OR REPLACE and no DROP FUNCTION', () => {
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).toHaveLength(1);
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION update_site_event_assignment\(/);
    expect(CODE).not.toMatch(/\bDROP\s+FUNCTION\b/i);
  });

  it('runs no DDL on any table, view, policy or trigger', () => {
    expect(CODE).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|POLICY|TRIGGER|INDEX|TYPE)\b/i);
  });
});

describe('migration 099 - the RPC is the only door through 097 D5', () => {
  it('is SECURITY DEFINER with search_path pinned', () => {
    expect(CODE).toMatch(/SECURITY DEFINER/);
    expect(CODE).toMatch(/SET search_path = public/);
  });

  it('revokes from PUBLIC and anon, then grants only to authenticated and service_role', () => {
    const revoke = CODE.indexOf('REVOKE ALL ON FUNCTION update_site_event_assignment');
    const grant = CODE.indexOf('GRANT EXECUTE ON FUNCTION update_site_event_assignment');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION update_site_event_assignment\(UUID, UUID, DATE\) FROM PUBLIC, anon;/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION update_site_event_assignment\(UUID, UUID, DATE\) TO authenticated, service_role;/);
  });

  it('locks the row it is about to move before reading anything from it', () => {
    expect(CODE).toMatch(/SELECT \* INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;/);
  });

  it('raises one named refusal per rule the D5 trigger cannot enforce here', () => {
    const codes = [...CODE.matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    expect(codes).toEqual([
      'SITE_EVENT_NOT_FOUND',
      'SITE_EVENT_AUTH',           // no session
      'SITE_EVENT_AUTH',           // not a member and not office
      'SITE_EVENT_ASSIGN_ROLE',    // not the reporter and not office
      'SITE_EVENT_NOT_OPEN',
      'SITE_EVENT_OWNER_NOT_MEMBER',
      'SITE_EVENT_OWNER_REQUIRED',
      'SITE_EVENT_DUE',
    ]);
  });

  it('refuses a caller who is neither an office role nor the reporter', () => {
    expect(CODE).toMatch(/NOT \(is_office_role\(\) OR v_ev\.reporter_id = v_uid\)/);
  });

  it('never lets the current owner reassign their own event', () => {
    // Spec §9 lists office roles and the reporter only. owner_id must not
    // appear in any authorisation test.
    const authBlock = CODE.slice(CODE.indexOf('BEGIN'), CODE.indexOf('IF v_ev.status'));
    expect(authBlock).not.toMatch(/v_ev\.owner_id\s*=\s*v_uid/);
  });

  it('requires the new owner to be a member of the event project', () => {
    expect(CODE).toMatch(/SELECT 1 FROM project_assignments pa\s+WHERE pa\.project_id = v_ev\.project_id AND pa\.user_id = p_owner_id/);
  });

  it('keeps both an owner and a due date on the four actionable types', () => {
    expect(CODE).toMatch(/v_ev\.event_type IN \('isu', 'hambatan', 'cacat', 'butuh_keputusan'\)\s+AND \(p_owner_id IS NULL OR p_due_date IS NULL\)/);
  });

  it('checks a MOVED due date against today, so an already-late event stays reassignable', () => {
    expect(CODE).toMatch(/p_due_date IS DISTINCT FROM v_ev\.due_date\s+AND p_due_date < v_today/);
    expect(CODE).toMatch(/v_today\s+DATE := \(now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date;/);
  });

  it('writes only owner_id and due_date, never another human field', () => {
    const update = CODE.slice(CODE.indexOf('UPDATE site_events'), CODE.indexOf('WHERE id = p_event_id;'));
    expect(update).toMatch(/SET owner_id = p_owner_id, due_date = p_due_date/);
    for (const col of ['event_type', 'gate_code', 'step_code', 'title', 'summary', 'is_blocking', 'vo_flag', 'status']) {
      expect(update).not.toContain(col);
    }
  });
});

describe('migration 099 - the notification', () => {
  it('enqueues SITE_EVENT_ASSIGNED to a NEW owner who is not the caller', () => {
    expect(CODE).toMatch(/p_owner_id IS DISTINCT FROM v_ev\.owner_id\s+AND p_owner_id IS DISTINCT FROM v_uid/);
    expect(CODE).toMatch(/'SITE_EVENT_ASSIGNED'/);
    expect(CODE).toMatch(/'SiteEventDetail'/);
    expect(CODE).toMatch(/jsonb_build_object\('eventId', p_event_id, 'projectId', v_ev\.project_id\)/);
  });

  it('never lets a notification failure roll back the reassignment', () => {
    expect(CODE).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'update_site_event_assignment: notification failed: %', SQLERRM;/);
  });

  it('reports what actually landed rather than what was attempted', () => {
    expect(CODE).toMatch(/v_notified := EXISTS \(\s*SELECT 1 FROM notifications n/);
    expect(CODE).toMatch(/'notified', v_notified/);
  });

  it('uses the 092 enqueue helper with its full ten-argument shape', () => {
    const call = CODE.slice(CODE.indexOf('PERFORM enqueue_notification_user('));
    const args = call.slice(0, call.indexOf(');') + 2);
    expect((args.match(/,/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(args).toMatch(/ARRAY\[v_uid\]/);
  });
});

describe('migration 099 - nothing later reverts it', () => {
  it('no later migration redefines update_site_event_assignment', () => {
    const later = fs.readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 99);
    const touching = later.filter((f) =>
      /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?update_site_event_assignment\b/i
        .test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))),
    );
    expect(touching).toEqual([]);
  });

  it('names the signature this suite pins, so a changed one is a deliberate edit', () => {
    expect(SIG).toBe('update_site_event_assignment(UUID, UUID, DATE)');
    expect(CODE).toContain('update_site_event_assignment(UUID, UUID, DATE)');
  });
});
```

Run it; expected: `ENOENT: no such file or directory, open '.../supabase/migrations/099_site_event_assignment.sql'`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/099_site_event_assignment.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 099 - Reassigning an open site event: owner and due date.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §9, §11
-- Plan: docs/superpowers/plans/2026-09-10-papan-ruangan-blueprint.md (task 6)
--
-- WHY. The room timeline lets office roles and the reporter move an open
-- event's owner or its due date. They cannot do it with a PostgREST UPDATE:
-- 097's site_events_human_fields_rpc_only refuses any direct write to
-- owner_id or due_date, deliberately, so that confirm_site_event stays the
-- only path into the human fields (spec §1.1 rule 2). This file adds the one
-- narrow RPC that guard is willing to let through, with every rule
-- confirm_site_event applies to the same two columns applied again here:
-- the owner is a project member, an actionable event keeps BOTH an owner and
-- a due date, and a due date is never moved into the past.
--
-- Like 097's RPCs this runs SECURITY DEFINER, so inside it current_user is the
-- function owner rather than `authenticated`, and 097's guard returns early.
-- That is exactly why the checks below are written out in full: the trigger is
-- not watching this statement.
--
-- PASTE ORDER. After 096, 097 and 098. It calls is_project_member() and
-- is_office_role() (096/097), reads site_events (097), and enqueues the
-- SITE_EVENT_ASSIGNED notification type that 098 added to the
-- notifications.type CHECK. Pasted before 098, every reassignment would
-- silently notify nobody: the enqueue helpers turn a CHECK violation into a
-- WARNING nobody reads.
--
-- RE-PASTE SAFETY. One CREATE OR REPLACE FUNCTION, one REVOKE, one GRANT, and
-- no DDL on any table: a second paste is a no-op. The signature never changes,
-- so no DROP FUNCTION is needed and none is written - a DROP would break the
-- GRANT during the window between the two statements.
-- What a re-paste CAN undo: pasted after a later migration that redefines
-- update_site_event_assignment(), 099 reverts that change. The static test in
-- tools/__tests__/migration099.test.ts fails when a later migration redefines
-- it, so 099 is brought up to date in the same change.
--
-- WHO MAY REASSIGN. Spec §9: office roles and the reporter. The current owner
-- is deliberately NOT on that list - an owner handing their own work to
-- somebody else is the accountability hole this feature exists to close. A
-- non-member of the project is refused before anything else is read.
-- ═══════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION update_site_event_assignment(
  p_event_id UUID,
  p_owner_id UUID,
  p_due_date DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_ev       site_events%ROWTYPE;
  v_room     TEXT;
  v_today    DATE := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_changed  BOOLEAN;
  v_notified BOOLEAN := FALSE;
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
  IF v_uid IS NOT NULL AND NOT (is_office_role() OR v_ev.reporter_id = v_uid) THEN
    RAISE EXCEPTION 'SITE_EVENT_ASSIGN_ROLE: hanya pelapor atau peran kantor yang dapat mengubah pemilik dan tenggat'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_ev.status <> 'open' THEN
    RAISE EXCEPTION 'SITE_EVENT_NOT_OPEN: hanya kejadian terbuka yang bisa diubah pemiliknya (status sekarang %)', v_ev.status;
  END IF;

  -- Spec §2 decision 5 and enqueue_notification_user (092:100): an owner who is
  -- not on the project cannot see the event and would never be notified.
  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_assignments pa
    WHERE pa.project_id = v_ev.project_id AND pa.user_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota tim proyek ini';
  END IF;

  -- Brief §11.4, the same rule 097's site_events_actionable_needs_owner holds:
  -- raised here first so the app shows a sentence, not a trigger message.
  IF v_ev.event_type IN ('isu', 'hambatan', 'cacat', 'butuh_keputusan')
     AND (p_owner_id IS NULL OR p_due_date IS NULL) THEN
    RAISE EXCEPTION 'SITE_EVENT_OWNER_REQUIRED: kejadian % yang terbuka wajib punya pemilik dan tenggat', v_ev.event_type;
  END IF;

  -- Only a MOVED due date is checked against today: an event that is already
  -- overdue must still be reassignable without first inventing a new date.
  IF p_due_date IS NOT NULL
     AND p_due_date IS DISTINCT FROM v_ev.due_date
     AND p_due_date < v_today THEN
    RAISE EXCEPTION 'SITE_EVENT_DUE: tenggat tidak boleh sebelum hari ini (%)', v_today;
  END IF;

  v_changed := (p_owner_id IS DISTINCT FROM v_ev.owner_id)
            OR (p_due_date IS DISTINCT FROM v_ev.due_date);

  UPDATE site_events
  SET owner_id = p_owner_id, due_date = p_due_date
  WHERE id = p_event_id;

  -- Spec §11: the one notification type, to a NEW owner only, and never to the
  -- person doing the assigning. A notification failure must not roll back the
  -- reassignment.
  IF p_owner_id IS NOT NULL
     AND p_owner_id IS DISTINCT FROM v_ev.owner_id
     AND p_owner_id IS DISTINCT FROM v_uid THEN
    BEGIN
      SELECT r.room_name INTO v_room FROM rooms r WHERE r.id = v_ev.room_id;
      PERFORM enqueue_notification_user(
        v_ev.project_id,
        p_owner_id,
        'SITE_EVENT_ASSIGNED',
        left('Anda ditugaskan: ' || COALESCE(v_ev.title, 'Kejadian lapangan') || ' · ' || COALESCE(v_room, 'Ruangan'), 200),
        CASE
          WHEN p_due_date IS NULL THEN 'Kejadian lapangan baru untuk Anda.'
          ELSE 'Tenggat ' || to_char(p_due_date, 'DD-MM-YYYY')
        END,
        'SiteEventDetail',
        jsonb_build_object('eventId', p_event_id, 'projectId', v_ev.project_id),
        p_event_id,
        ARRAY[v_uid]
      );
      -- Report what actually landed, not what was attempted: the helper inserts
      -- zero rows for a non-member and raises nothing.
      v_notified := EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.related_entity_id = p_event_id
          AND n.recipient_user_id = p_owner_id
          AND n.type = 'SITE_EVENT_ASSIGNED'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'update_site_event_assignment: notification failed: %', SQLERRM;
      v_notified := FALSE;
    END;
  END IF;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'owner_id', p_owner_id,
    'due_date', p_due_date,
    'changed', v_changed,
    'notified', v_notified
  );
END;
$$;

REVOKE ALL ON FUNCTION update_site_event_assignment(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_site_event_assignment(UUID, UUID, DATE) TO authenticated, service_role;

RESET lock_timeout;

SELECT proname, prosecdef, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
FROM pg_proc
WHERE proname = 'update_site_event_assignment';

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting)
--
-- 1. The grid above already answers the first check:
--    EXPECTED: one row, prosecdef = true, anon_exec = false.
--
-- 2. search_path is pinned:
--      SELECT proconfig FROM pg_proc WHERE proname = 'update_site_event_assignment';
--    EXPECTED: {search_path=public}.
--
-- 3. A non-member is refused. As any signed-in user who is NOT on the event's
--    project, from the app or from the SQL editor with a set role:
--      SELECT update_site_event_assignment('<event id>', NULL, NULL);
--    EXPECTED: ERROR starting SITE_EVENT_AUTH.
--
-- 4. An actionable event cannot lose its owner:
--      SELECT update_site_event_assignment('<an open isu/hambatan/cacat id>', NULL, NULL);
--    EXPECTED: ERROR starting SITE_EVENT_OWNER_REQUIRED.
--
-- 5. An outsider cannot be made the owner:
--      SELECT update_site_event_assignment('<event id>', '<a profile NOT on the project>', current_date + 3);
--    EXPECTED: ERROR starting SITE_EVENT_OWNER_NOT_MEMBER.
--
-- 6. A real reassignment lands, and 097's guard did not block it:
--      SELECT update_site_event_assignment('<event id>', '<a team member>', current_date + 3);
--    EXPECTED: a JSON object with changed = true. Then:
--      SELECT owner_id, due_date FROM site_events WHERE id = '<event id>';
--    EXPECTED: the new pair.
--
-- 7. The new owner was told:
--      SELECT type, title FROM notifications
--      WHERE related_entity_id = '<event id>' AND type = 'SITE_EVENT_ASSIGNED';
--    EXPECTED: at least one row. NO row means 098 was never pasted.
--
-- 8. Re-paste this whole file.
--    EXPECTED: no error, and check 6 still behaves the same way.
-- ═══════════════════════════════════════════════════════════════════════════
```

Two details are worth naming because they look like omissions and are not. The service-role branch (`v_uid IS NULL AND auth.role() <> 'service_role'`) exists so a future server-side job can call the function without a session while a genuinely anonymous call is refused; it mirrors the shape 097's RPCs use. And `v_today` reads the Jakarta date rather than `current_date`, because a Supabase instance runs in UTC and a due date set at 08:00 WIB on the 12th would otherwise be compared against the 11th.

- [ ] **Step 3: Verify and commit**

```bash
npx jest tools/__tests__/migration099.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -8
```

Expected: `Tests: 24 passed, 24 total`.

```bash
git add supabase/migrations/099_site_event_assignment.sql tools/__tests__/migration099.test.ts
git commit -m "$(cat <<'EOF'
feat(db): 099 lets office roles and the reporter reassign an open site event

097's site_events_human_fields_rpc_only refuses a direct write to owner_id
and due_date, so spec §9's timeline edit needs one narrow SECURITY DEFINER
RPC. It re-applies every rule the trigger would have enforced: the owner is
a project member, an actionable event keeps both an owner and a due date, a
moved due date is never in the past, and the current owner may not hand
their own work on. A new owner gets the SITE_EVENT_ASSIGNED notification
098 added to the type CHECK.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**This file is pasted by the user, not applied by any tool.** It is listed in task 9's user-run steps.

---

## Task 7: The room timeline, and editing owner and due date

Spec §9: "Room timeline: events newest first with thumbnails, transcript expandable, actions: 'Selesai'; edit owner and due date (office roles and the reporter); open the linked Catatan Perubahan when one exists." One component, mounted on the office `RoomDetailScreen` (where plan 1 left a "Riwayat kejadian menyusul" placeholder) and on the supervisor's `RoomScreen`.

**Files:**
- Create: `workflows/screens/siteEvent/timelineModel.ts`, `workflows/screens/siteEvent/RoomTimeline.tsx`, `workflows/screens/siteEvent/AssignmentEditor.tsx`
- Modify: `tools/siteEvents.ts`, `office/screens/RoomDetailScreen.tsx`, `workflows/screens/RoomScreen.tsx`
- Test: `workflows/__tests__/timelineModel.test.ts`; extend `tools/__tests__/siteEvents.test.ts`

- [ ] **Step 1: Write the failing test for the pure rules**

Create `workflows/__tests__/timelineModel.test.ts`:

```ts
/**
 * The timeline's rules, which are the same rules migration 099 and 097's
 * close_site_event enforce in SQL. They live here so the screen and the
 * database cannot drift: a control the user can see but the server refuses is
 * worse than no control at all.
 *
 * The case that matters most is "refuses the current owner": spec §9 lists
 * office roles and the reporter, and an owner reassigning their own overdue
 * item is precisely the accountability gap this feature closes.
 */
import {
  canClose, canEditAssignment, dueLabel, fmtDate, sortTimeline, validateAssignment,
  type TimelineEvent,
} from '../screens/siteEvent/timelineModel';

const TODAY = '2026-09-11';

function ev(p: Partial<TimelineEvent> & { id: string }): TimelineEvent {
  return {
    status: 'open', event_type: 'progres', title: 'T', summary: 'S', owner_id: null, due_date: null,
    confirmed_at: '2026-09-10T02:00:00Z', created_at: '2026-09-10T01:00:00Z', closed_at: null,
    site_change_id: null, reporter_id: 'u-rep', gate_code: null, step_code: null, is_blocking: false,
    ...p,
  } as TimelineEvent;
}

describe('sortTimeline', () => {
  it('puts the newest human action first and falls back to arrival', () => {
    const out = sortTimeline([
      ev({ id: 'old', confirmed_at: '2026-09-01T00:00:00Z' }),
      ev({ id: 'draft', confirmed_at: null, created_at: '2026-09-11T09:00:00Z' }),
      ev({ id: 'mid', confirmed_at: '2026-09-05T00:00:00Z' }),
    ]).map((e) => e.id);
    expect(out).toEqual(['draft', 'mid', 'old']);
  });

  it('is stable on a tie and does not mutate its input', () => {
    const input = [ev({ id: 'a' }), ev({ id: 'b' })];
    expect(sortTimeline(input).map((e) => e.id)).toEqual(['b', 'a']);
    expect(input.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('canEditAssignment', () => {
  const open = ev({ id: 'x', reporter_id: 'u-rep' });
  it('lets an office role and the reporter edit', () => {
    expect(canEditAssignment(open, { id: 'u-adm', role: 'admin' })).toBe(true);
    expect(canEditAssignment(open, { id: 'u-est', role: 'estimator' })).toBe(true);
    expect(canEditAssignment(open, { id: 'u-pri', role: 'principal' })).toBe(true);
    expect(canEditAssignment(open, { id: 'u-rep', role: 'supervisor' })).toBe(true);
  });
  it('refuses the current owner and any other member', () => {
    expect(canEditAssignment({ ...open, owner_id: 'u-own' } as TimelineEvent, { id: 'u-own', role: 'supervisor' })).toBe(false);
    expect(canEditAssignment(open, { id: 'u-other', role: 'supervisor' })).toBe(false);
  });
  it('refuses on an event that is not open, and with no session', () => {
    expect(canEditAssignment(ev({ id: 'x', status: 'done', reporter_id: 'u-rep' }), { id: 'u-rep', role: 'supervisor' })).toBe(false);
    expect(canEditAssignment(open, null)).toBe(false);
    expect(canEditAssignment(open, { id: null, role: 'admin' })).toBe(false);
  });
});

describe('canClose', () => {
  it('offers Selesai only on an open event', () => {
    expect(canClose(ev({ id: 'a', status: 'open' }))).toBe(true);
    expect(canClose(ev({ id: 'a', status: 'done' }))).toBe(false);
    expect(canClose(ev({ id: 'a', status: 'draft' }))).toBe(false);
  });
});

describe('validateAssignment', () => {
  it('requires both an owner and a due date on the four actionable types', () => {
    for (const t of ['isu', 'hambatan', 'cacat', 'butuh_keputusan'] as const) {
      const e = ev({ id: 'a', event_type: t });
      expect(validateAssignment(e, { ownerId: null, dueDate: '2026-09-20' }, TODAY))
        .toBe('Kejadian ini wajib punya pemilik dan tenggat.');
      expect(validateAssignment(e, { ownerId: 'u', dueDate: null }, TODAY))
        .toBe('Kejadian ini wajib punya pemilik dan tenggat.');
      expect(validateAssignment(e, { ownerId: 'u', dueDate: '2026-09-20' }, TODAY)).toBeNull();
    }
  });

  it('lets progres and info carry neither', () => {
    expect(validateAssignment(ev({ id: 'a', event_type: 'progres' }), { ownerId: null, dueDate: null }, TODAY)).toBeNull();
    expect(validateAssignment(ev({ id: 'a', event_type: 'info' }), { ownerId: null, dueDate: null }, TODAY)).toBeNull();
  });

  it('refuses a due date MOVED into the past', () => {
    expect(validateAssignment(ev({ id: 'a', due_date: '2026-09-20' }), { ownerId: 'u', dueDate: '2026-09-01' }, TODAY))
      .toBe('Tenggat tidak boleh sebelum hari ini.');
  });

  it('keeps an already-late event reassignable without a new date', () => {
    const late = ev({ id: 'a', event_type: 'isu', due_date: '2026-09-01' });
    expect(validateAssignment(late, { ownerId: 'u2', dueDate: '2026-09-01' }, TODAY)).toBeNull();
  });
});

describe('dueLabel and fmtDate', () => {
  it('reads the date, or how late it is', () => {
    expect(dueLabel(ev({ id: 'a', due_date: null }), TODAY)).toBeNull();
    expect(dueLabel(ev({ id: 'a', due_date: '2026-09-20' }), TODAY)).toBe('Tenggat 20-09-2026');
    expect(dueLabel(ev({ id: 'a', due_date: '2026-09-10' }), TODAY)).toBe('Lewat tenggat 1 hari');
    expect(dueLabel(ev({ id: 'a', due_date: '2026-09-04' }), TODAY)).toBe('Lewat tenggat 7 hari');
  });
  it('never calls a closed event late', () => {
    expect(dueLabel(ev({ id: 'a', status: 'done', due_date: '2026-09-01' }), TODAY)).toBe('Tenggat 01-09-2026');
  });
  it('spells a date the way the notification does', () => {
    expect(fmtDate('2026-09-11')).toBe('11-09-2026');
  });
});
```

Run it; expected: `Cannot find module '../screens/siteEvent/timelineModel'`.

- [ ] **Step 2: Write the pure model**

Create `workflows/screens/siteEvent/timelineModel.ts`:

```ts
// SANO - Room timeline rules (pure). Spec §9.
//
// The timeline shows a room's events newest first and offers three actions:
// "Selesai", editing the owner and due date, and opening the linked Catatan
// Perubahan. Which of those a given viewer gets is a rule, not a styling
// choice, and migration 099 enforces the same rule in SQL - so it lives here,
// tested, rather than inline in a screen where the two could drift apart.
//
// isOverdue comes from plan 2's detailModel rather than being restated: one
// definition of "late" across the detail screen and the timeline.

import { isOverdue } from './detailModel';
import type { SiteEvent } from '../../../tools/types';

export { isOverdue };

/** What the timeline needs from an event to order and label it. */
export type TimelineEvent = Pick<
  SiteEvent,
  'id' | 'status' | 'event_type' | 'title' | 'summary' | 'owner_id' | 'due_date'
  | 'confirmed_at' | 'created_at' | 'closed_at' | 'site_change_id' | 'reporter_id'
  | 'gate_code' | 'step_code' | 'is_blocking'
>;

/**
 * Newest first, on the moment a human last acted: an event is placed by its
 * confirmation, and one still waiting for a human by its arrival. Ties break on
 * id so the order is stable across re-reads rather than shuffling.
 */
export function sortTimeline<T extends Pick<TimelineEvent, 'id' | 'confirmed_at' | 'created_at'>>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const ta = a.confirmed_at ?? a.created_at;
    const tb = b.confirmed_at ?? b.created_at;
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * Spec §9: office roles and the reporter. Migration 099 raises
 * SITE_EVENT_ASSIGN_ROLE for anybody else, and SITE_EVENT_NOT_OPEN for an
 * event that is not open, so hiding the control here only spares the user a
 * refusal they would otherwise meet after typing.
 *
 * The current OWNER is deliberately absent: handing your own work to somebody
 * else is the accountability gap this feature closes.
 */
export const OFFICE_ROLES: ReadonlyArray<string> = ['admin', 'estimator', 'principal'];

export function canEditAssignment(
  ev: Pick<TimelineEvent, 'status' | 'reporter_id'>,
  viewer: { id: string | null; role: string | null } | null,
): boolean {
  if (ev.status !== 'open') return false;
  if (!viewer?.id) return false;
  return OFFICE_ROLES.includes(viewer.role ?? '') || ev.reporter_id === viewer.id;
}

/** "Selesai" is offered on an open event to any project member (097's close_site_event checks membership). */
export function canClose(ev: Pick<TimelineEvent, 'status'>): boolean {
  return ev.status === 'open';
}

/**
 * The due-date rule migration 099 applies, restated so the form can refuse
 * before the round trip: a MOVED due date may not be in the past, but an event
 * that is already late stays reassignable without inventing a new date.
 * Returns null when the pair is acceptable.
 */
export function validateAssignment(
  ev: Pick<TimelineEvent, 'event_type' | 'due_date'>,
  next: { ownerId: string | null; dueDate: string | null },
  today: string,
): string | null {
  const actionable = ev.event_type === 'isu' || ev.event_type === 'hambatan'
    || ev.event_type === 'cacat' || ev.event_type === 'butuh_keputusan';
  if (actionable && (!next.ownerId || !next.dueDate)) {
    return 'Kejadian ini wajib punya pemilik dan tenggat.';
  }
  if (next.dueDate && next.dueDate !== ev.due_date && next.dueDate < today) {
    return 'Tenggat tidak boleh sebelum hari ini.';
  }
  return null;
}

/** "Tenggat 12-09-2026" / "Lewat tenggat 2 hari" / null when the event carries no date. */
export function dueLabel(ev: Pick<TimelineEvent, 'status' | 'due_date'>, today: string): string | null {
  if (!ev.due_date) return null;
  if (!isOverdue(ev, today)) return `Tenggat ${fmtDate(ev.due_date)}`;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ev.due_date}T00:00:00Z`)) / 86400000);
  return days === 1 ? 'Lewat tenggat 1 hari' : `Lewat tenggat ${days} hari`;
}

/** DD-MM-YYYY, the spelling migration 099's notification body uses. */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
```

`ACTIONABLE_EVENT_TYPES` from `tools/constants.ts` (plan 2 task 2) says the same thing as the four-way comparison in `validateAssignment`. The comparison is written out because `validateAssignment` takes `Pick<TimelineEvent, 'event_type' | ...>`, whose `event_type` is nullable, and `ACTIONABLE_EVENT_TYPES.includes(null)` does not type-check against `ReadonlyArray<SiteEventType>`. If plan 2 ships a nullable-safe `isActionableType` in `tools/siteEventRules.ts`, use that instead and delete the comparison.

- [ ] **Step 3: Read the timeline and call the RPC**

Append to `tools/siteEvents.ts`:

```ts
// ─── Room timeline and reassignment (plan 4, spec §9) ───────────────────────

export interface TimelineEventRow extends SiteEvent {
  media: SiteEventMedia[];
  owner_name: string | null;
  reporter_name: string | null;
}

const TIMELINE_SELECT =
  '*, site_event_media(*), ' +
  'owner:profiles!site_events_owner_id_fkey(full_name), ' +
  'reporter:profiles!site_events_reporter_id_fkey(full_name)';

/**
 * A room's events for the timeline. `discarded` is excluded because a discard
 * is a decision, not history a PM needs to scroll past; the rows and their
 * files are still there (spec §1.1 rule 3), just not on this list.
 */
export async function listRoomTimeline(roomId: string, limit = 50): Promise<TimelineEventRow[]> {
  const { data, error } = await supabase
    .from('site_events')
    .select(TIMELINE_SELECT)
    .eq('room_id', roomId)
    .neq('status', 'discarded')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('listRoomTimeline failed:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as Array<SiteEvent & {
    site_event_media?: SiteEventMedia[] | null;
    owner?: { full_name?: string } | null;
    reporter?: { full_name?: string } | null;
  }>).map(({ site_event_media, owner, reporter, ...e }) => ({
    ...(e as SiteEvent),
    media: [...(site_event_media ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    owner_name: owner?.full_name ?? null,
    reporter_name: reporter?.full_name ?? null,
  }));
}

export interface AssignmentResult {
  event_id: string;
  owner_id: string | null;
  due_date: string | null;
  changed: boolean;
  notified: boolean;
}

/**
 * Migration 099. A direct UPDATE on owner_id or due_date is refused by 097's
 * site_events_human_fields_rpc_only trigger, deliberately, so this RPC is the
 * only path. Its named refusals go through the same mapSiteEventRpcError
 * table as confirm and close, so the user reads one sentence.
 */
export async function updateSiteEventAssignment(
  eventId: string,
  ownerId: string | null,
  dueDate: string | null,
): Promise<{ result?: AssignmentResult; error?: string }> {
  const { data, error } = await supabase.rpc('update_site_event_assignment', {
    p_event_id: eventId,
    p_owner_id: ownerId,
    p_due_date: dueDate,
  });
  if (error) return { error: mapSiteEventRpcError(error.message) };
  return { result: data as AssignmentResult };
}
```

Plan 2's `SITE_EVENT_ERRORS` table (task 9) gains the two codes only 099 raises, beside the ones `confirm_site_event` already contributes:

```ts
  SITE_EVENT_ASSIGN_ROLE: 'Hanya pelapor atau peran kantor yang dapat mengubah pemilik dan tenggat.',
  SITE_EVENT_NOT_OPEN: 'Kejadian ini sudah tidak terbuka.',
```

Append the matching cases to `tools/__tests__/siteEvents.test.ts`:

```ts
describe('listRoomTimeline', () => {
  function chain(result: { data: unknown; error: { message: string } | null }) {
    const c: any = {};
    for (const m of ['select', 'eq', 'neq', 'order']) c[m] = jest.fn().mockReturnValue(c);
    c.limit = jest.fn().mockResolvedValue(result);
    return c;
  }

  it('flattens the joins, sorts media and never shows a discarded event', async () => {
    const c = chain({ data: [{
      id: 'e1', room_id: 'r1', status: 'open', created_at: 'x',
      site_event_media: [{ id: 'm2', sort_order: 1 }, { id: 'm1', sort_order: 0 }],
      owner: { full_name: 'Andi Saputra' }, reporter: { full_name: 'Budi' },
    }], error: null });
    (supabase.from as jest.Mock).mockReturnValue(c);

    const out = await listRoomTimeline('r1');
    expect(c.neq).toHaveBeenCalledWith('status', 'discarded');
    expect(out[0].media.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(out[0].owner_name).toBe('Andi Saputra');
    expect(out[0].reporter_name).toBe('Budi');
    expect('site_event_media' in out[0]).toBe(false);
  });

  it('returns an empty list rather than throwing when the read fails', async () => {
    (supabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'nope' } }));
    expect(await listRoomTimeline('r1')).toEqual([]);
  });
});

describe('updateSiteEventAssignment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls the 099 RPC with its three parameters', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: { event_id: 'e1', owner_id: 'u2', due_date: '2026-09-20', changed: true, notified: true }, error: null });
    const out = await updateSiteEventAssignment('e1', 'u2', '2026-09-20');
    expect(supabase.rpc).toHaveBeenCalledWith('update_site_event_assignment', {
      p_event_id: 'e1', p_owner_id: 'u2', p_due_date: '2026-09-20',
    });
    expect(out.result?.notified).toBe(true);
  });

  it('turns each named refusal into an Indonesian sentence', async () => {
    const cases: Array<[string, string]> = [
      ['SITE_EVENT_ASSIGN_ROLE: hanya pelapor', 'Hanya pelapor atau peran kantor yang dapat mengubah pemilik dan tenggat.'],
      ['SITE_EVENT_OWNER_NOT_MEMBER: pemilik harus anggota', 'Pemilik harus anggota tim proyek ini.'],
      ['SITE_EVENT_OWNER_REQUIRED: wajib', 'Kejadian ini wajib punya pemilik dan tenggat.'],
      ['SITE_EVENT_DUE: tenggat', 'Tenggat tidak boleh sebelum hari ini.'],
      ['SITE_EVENT_NOT_OPEN: status', 'Kejadian ini sudah tidak terbuka.'],
    ];
    for (const [raw, friendly] of cases) {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: raw } });
      expect((await updateSiteEventAssignment('e1', 'u2', null)).error).toBe(friendly);
    }
  });

  it('clears the owner by passing nulls through', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: { event_id: 'e1', owner_id: null, due_date: null, changed: true, notified: false }, error: null });
    const out = await updateSiteEventAssignment('e1', null, null);
    expect(supabase.rpc).toHaveBeenCalledWith('update_site_event_assignment', {
      p_event_id: 'e1', p_owner_id: null, p_due_date: null,
    });
    expect(out.result?.notified).toBe(false);
  });
});
```

`updateSiteEventAssignment` and `listRoomTimeline` join the existing import list at the top of that suite.

- [ ] **Step 4: The assignment form**

Create `workflows/screens/siteEvent/AssignmentEditor.tsx`:

```tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import OwnerField from './OwnerField';
import DueDateField from './DueDateField';
import { validateAssignment, type TimelineEvent } from './timelineModel';
import type { TeamMember } from '../../../tools/projectManagement';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

/**
 * Owner and due date on an already-confirmed event (spec §9), saved through
 * migration 099's update_site_event_assignment. The form re-applies 099's rules
 * before the round trip so the refusal arrives as a sentence under the field
 * rather than as a Postgres error after a spinner; 099 is still the authority,
 * and its message is shown verbatim when it disagrees.
 *
 * Reuses plan 2's OwnerField and DueDateField so an owner is picked the same
 * way here as on the confirm screen.
 */
export default function AssignmentEditor(props: {
  event: TimelineEvent;
  team: TeamMember[];
  today: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (ownerId: string | null, dueDate: string | null) => void;
}) {
  const { event, team, today, saving, onCancel, onSave } = props;
  const [ownerId, setOwnerId] = useState<string | null>(event.owner_id);
  const [dueDate, setDueDate] = useState<string>(event.due_date ?? '');
  const [error, setError] = useState<string | null>(null);

  const actionable = event.event_type === 'isu' || event.event_type === 'hambatan'
    || event.event_type === 'cacat' || event.event_type === 'butuh_keputusan';

  const submit = () => {
    const next = { ownerId, dueDate: dueDate.trim() || null };
    const problem = validateAssignment(event, next, today);
    setError(problem);
    if (problem) return;
    onSave(next.ownerId, next.dueDate);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Pemilik</Text>
      <OwnerField team={team} value={ownerId} onChange={setOwnerId} required={actionable} disabled={saving} />
      <Text style={styles.label}>Tenggat</Text>
      <DueDateField value={dueDate} onChange={setDueDate} today={today} required={actionable} disabled={saving} />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.ghostBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.ghostText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
          <Text style={styles.primaryText}>{saving ? 'Menyimpan…' : 'Simpan'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: SPACE.sm, gap: SPACE.xs },
  label: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.textSec, marginTop: SPACE.sm },
  error: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical, marginTop: SPACE.xs, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  primaryBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.md, alignItems: 'center' },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse },
});
```

- [ ] **Step 5: The timeline**

Create `workflows/screens/siteEvent/RoomTimeline.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../../components/Card';
import AssignmentEditor from './AssignmentEditor';
import {
  canClose, canEditAssignment, dueLabel, isOverdue, sortTimeline, type TimelineEvent,
} from './timelineModel';
import { listRoomTimeline, signedMediaUrl, updateSiteEventAssignment, type TimelineEventRow } from '../../../tools/siteEvents';
import { getProjectTeam, type TeamMember } from '../../../tools/projectManagement';
import { SITE_EVENT_TYPE_LABELS } from '../../../tools/constants';
import { COLORS, FONTS, RADIUS_SM, SPACE, TYPE } from '../../theme';

/**
 * A room's events, newest first (spec §9). Thumbnails are signed one by one
 * through plan 2's storage routing, the transcript expands in place, and the
 * action row offers "Selesai", the owner and due-date edit, and the linked
 * Catatan Perubahan when the event has one.
 *
 * Who may do what is decided in timelineModel.ts, which restates the rules
 * migration 099 and 097's close_site_event enforce. The screen hides a control
 * the viewer cannot use; the database is still what refuses.
 */
export default function RoomTimeline(props: {
  roomId: string;
  projectId: string;
  viewer: { id: string | null; role: string | null } | null;
  today: string;
  /** Provided where a "Selesai" flow exists (plan 2 task 14's detail screen). */
  onOpenEvent?: (eventId: string) => void;
  onOpenSiteChange?: (siteChangeId: string) => void;
}) {
  const { roomId, projectId, viewer, today, onOpenEvent, onOpenSiteChange } = props;

  const [rows, setRows] = useState<TimelineEventRow[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [events, members] = await Promise.all([listRoomTimeline(roomId), getProjectTeam(projectId)]);
    setRows(events);
    setTeam(members);
    setLoading(false);

    // One signed URL per first photo. Signing every close-up on a room with
    // fifty events would be fifty round trips for pictures nobody scrolled to.
    const pairs = await Promise.all(
      events.map(async (e) => {
        const first = e.media.find((m) => m.kind === 'photo');
        if (!first) return null;
        const url = await signedMediaUrl(first.storage_path);
        return url ? ([e.id, url] as const) : null;
      }),
    );
    setThumbs(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)));
  }, [roomId, projectId]);

  useEffect(() => { void load(); }, [load]);

  const ordered = useMemo(() => sortTimeline(rows), [rows]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async (eventId: string, ownerId: string | null, dueDate: string | null) => {
    setSaving(true);
    setError(null);
    const res = await updateSiteEventAssignment(eventId, ownerId, dueDate);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setEditing(null);
    await load();
  };

  if (loading) return <Card title="Riwayat kejadian"><ActivityIndicator color={COLORS.primary} /></Card>;

  if (ordered.length === 0) {
    return (
      <Card title="Riwayat kejadian">
        <Text style={styles.empty}>Belum ada kejadian di ruangan ini.</Text>
      </Card>
    );
  }

  return (
    <Card title={`Riwayat kejadian (${ordered.length})`}>
      {error && <Text style={styles.error}>{error}</Text>}
      {ordered.map((e) => {
        const open = expanded.has(e.id);
        const transcript = e.transcript_edited ?? e.transcript;
        const late = isOverdue(e, today);
        return (
          <View key={e.id} style={styles.row}>
            <View style={styles.head}>
              {thumbs[e.id]
                ? <Image source={{ uri: thumbs[e.id] }} style={styles.thumb} accessibilityIgnoresInvertColors />
                : <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="image-outline" size={16} color={COLORS.textMuted} /></View>}
              <View style={styles.headBody}>
                <Text style={styles.title} numberOfLines={2}>{e.title ?? 'Menunggu konfirmasi'}</Text>
                <Text style={styles.meta}>
                  {e.event_type ? SITE_EVENT_TYPE_LABELS[e.event_type] : 'Draf'}
                  {e.gate_code ? ` · ${e.gate_code}${e.step_code ? ` ${e.step_code}` : ''}` : ''}
                  {e.owner_name ? ` · ${e.owner_name}` : ''}
                </Text>
                {dueLabel(e, today) && (
                  <Text style={[styles.due, late && styles.dueLate]}>{dueLabel(e, today)}</Text>
                )}
              </View>
            </View>

            {e.summary && <Text style={styles.summary}>{e.summary}</Text>}

            {transcript && (
              <TouchableOpacity onPress={() => toggle(e.id)} accessibilityRole="button">
                <Text style={styles.link}>{open ? 'Sembunyikan transkrip' : 'Lihat transkrip'}</Text>
              </TouchableOpacity>
            )}
            {open && transcript && <Text style={styles.transcript}>{transcript}</Text>}

            <View style={styles.actions}>
              {canClose(e) && onOpenEvent && (
                <TouchableOpacity onPress={() => onOpenEvent(e.id)} accessibilityRole="button">
                  <Text style={styles.link}>Selesai</Text>
                </TouchableOpacity>
              )}
              {canEditAssignment(e, viewer) && (
                <TouchableOpacity onPress={() => setEditing(editing === e.id ? null : e.id)} accessibilityRole="button">
                  <Text style={styles.link}>{editing === e.id ? 'Tutup' : 'Ubah pemilik / tenggat'}</Text>
                </TouchableOpacity>
              )}
              {e.site_change_id && onOpenSiteChange && (
                <TouchableOpacity onPress={() => onOpenSiteChange(e.site_change_id!)} accessibilityRole="button">
                  <Text style={styles.link}>Buka Catatan Perubahan</Text>
                </TouchableOpacity>
              )}
            </View>

            {editing === e.id && (
              <AssignmentEditor
                event={e as TimelineEvent}
                team={team}
                today={today}
                saving={saving}
                onCancel={() => setEditing(null)}
                onSave={(ownerId, dueDate) => void save(e.id, ownerId, dueDate)}
              />
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec },
  error: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.critical, marginBottom: SPACE.sm },
  row: { paddingVertical: SPACE.md, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  head: { flexDirection: 'row', gap: SPACE.sm },
  thumb: { width: 48, height: 48, borderRadius: RADIUS_SM, backgroundColor: COLORS.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  headBody: { flex: 1 },
  title: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  meta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
  due: { fontSize: TYPE.xs, fontFamily: FONTS.medium, color: COLORS.textSec, marginTop: 2 },
  dueLate: { color: COLORS.high, fontFamily: FONTS.bold },
  summary: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, marginTop: SPACE.xs, lineHeight: 18 },
  transcript: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 17, backgroundColor: COLORS.surfaceSunken, padding: SPACE.sm, borderRadius: RADIUS_SM },
  link: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.primary, paddingVertical: 4 },
  actions: { flexDirection: 'row', gap: SPACE.md, flexWrap: 'wrap', marginTop: SPACE.xs },
});
```

- [ ] **Step 6: Mount it on the two room screens**

In `office/screens/RoomDetailScreen.tsx`, plan 1 left a placeholder (`:85-87`): *"Kelola ruangan ini dari tab Ruangan. Riwayat kejadian menyusul pada pembaruan berikutnya."* Replace the second sentence and mount the timeline after the detail card. Add the imports:

```tsx
import { useNavigation } from '@react-navigation/native';
import RoomTimeline from '../../workflows/screens/siteEvent/RoomTimeline';
import { todayIsoWIB } from '../../tools/timeWindow';
```

change the note to `Kelola ruangan ini dari tab Ruangan.`, and after the closing `</Card>` of the detail card add:

```tsx
        {!loading && target && room && (
          <RoomTimeline
            roomId={room.id}
            projectId={target.id}
            viewer={{ id: profile?.id ?? null, role: profile?.role ?? null }}
            today={todayIsoWIB()}
            onOpenEvent={(eventId) => navigation.navigate('SiteEventDetail', { eventId, projectId: target.id })}
            onOpenSiteChange={() => navigation.navigate('Approvals')}
          />
        )}
```

`profile` joins the `useProject()` destructure on line 21, and `const navigation = useNavigation<any>();` sits beside `useRoute`. `SiteEventDetail` is registered in the office and principal navigators by plan 2 task 14 step 7, so "Selesai" opens the same detail screen a notification opens.

In `workflows/screens/RoomScreen.tsx`, mount the same component after plan 2 task 12's "Kejadian terbuka" card:

```tsx
        {!loading && !refusal && room && (
          <RoomTimeline
            roomId={room.id}
            projectId={project!.id}
            viewer={{ id: profile?.id ?? null, role: profile?.role ?? null }}
            today={todayIsoWIB()}
            onOpenEvent={(eventId) => navigation.navigate('SiteEventDetail', { eventId, projectId: project!.id })}
            onOpenSiteChange={() => navigation.navigate('Progres')}
          />
        )}
```

with `profile` added to that screen's `useProject()` destructure (currently `{ projects, project, setActiveProject }` on line 31) and the same two imports.

`todayIsoWIB` is a two-line addition to `tools/timeWindow.ts`, beside the existing day-boundary helpers, so "today" means the same thing on the board, in the form and in migration 099:

```ts
/** Today's calendar date in WIB, YYYY-MM-DD. The one definition of "today" in the app. */
export function todayIsoWIB(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
```

and one case in `tools/__tests__/timeWindow.test.ts`:

```ts
describe('todayIsoWIB', () => {
  it('reads the Jakarta date, not the UTC one, across the 17:00Z rollover', () => {
    const real = Date.now;
    try {
      Date.now = () => Date.parse('2026-09-11T17:30:00Z'); // 00:30 on the 12th in WIB
      expect(todayIsoWIB()).toBe('2026-09-12');
      Date.now = () => Date.parse('2026-09-11T16:30:00Z'); // 23:30 on the 11th in WIB
      expect(todayIsoWIB()).toBe('2026-09-11');
    } finally {
      Date.now = real;
    }
  });
});
```

**"Buka Catatan Perubahan" opens the list, not the row.** `site_changes` review lives on `ApprovalsScreen` for office roles and inside `ProgresScreen`'s local `perubahan` sub-module for supervisors (`workflows/screens/ProgresScreen.tsx:26,303`), and neither accepts a row id as a route param. Adding one would be a change to two screens the spec does not ask for. Release 1 therefore opens the right screen and lets the user find the row; this is deviation D5 below, and the release-2 note.

- [ ] **Step 7: Verify and commit**

```bash
npx jest workflows/__tests__/timelineModel.test.ts tools/__tests__/siteEvents.test.ts tools/__tests__/timeWindow.test.ts tools/__tests__/migration099.test.ts tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -5
```

Expected: every suite passes (13 new cases in `timelineModel`, 5 new in `siteEvents`, 1 new in `timeWindow`), and no `tsc` output.

```bash
git add workflows/screens/siteEvent/timelineModel.ts workflows/screens/siteEvent/RoomTimeline.tsx \
  workflows/screens/siteEvent/AssignmentEditor.tsx workflows/__tests__/timelineModel.test.ts \
  tools/siteEvents.ts tools/timeWindow.ts tools/__tests__/siteEvents.test.ts tools/__tests__/timeWindow.test.ts \
  office/screens/RoomDetailScreen.tsx workflows/screens/RoomScreen.tsx
git commit -m "$(cat <<'EOF'
feat(rooms): room timeline with owner and due-date editing

Spec §9. A room's events newest first with a signed thumbnail, an expandable
transcript, "Selesai", and an owner/due-date form behind migration 099's
RPC. Who may reassign is one tested rule (office roles and the reporter,
never the current owner) that restates what 099 enforces in SQL, so the
screen and the database cannot drift.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `site_event_ai_runs` as a second source of the AI usage report

Plan 2 deviation D18 deferred this here: migration 097 creates `site_event_ai_runs` with its RLS (office roles read everything, the reporter reads their own), and this plan only has to query it. Spec §16's metrics table wants transcript-edit rate and per-run spend visible; `generateAIUsageSummary` is where spend already lives.

**Files:**
- Modify: `tools/reports.ts`
- Test: `tools/__tests__/reportsSiteEventAi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/reportsSiteEventAi.test.ts`:

```ts
/**
 * The second source of ai_usage_summary (plan 2 deviation D18).
 *
 * ai_chat_log stays the primary source and is untouched: it buckets per user,
 * per day and per model, and site_event_ai_runs has no user_id at all (its
 * rows are written by the edge function under the service role). Folding the
 * two together would mean inventing a user, so the runs land as their own
 * section with per-stage rows.
 *
 * The case that earns its place is the last one. site_event_ai_runs is
 * readable only by office roles and the event's reporter (migration 097), and
 * on a project where 097 has not been pasted the table does not exist at all.
 * Reporting "0 spend" in either case would be a confident lie; the section
 * carries the reason instead.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
import { supabase } from '../supabase';
import { readSiteEventAiUsage } from '../reports';
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

function chain(result: { data: unknown; error: { message: string } | null }) {
  const c: any = {};
  c.select = jest.fn().mockReturnValue(c);
  c.gte = jest.fn().mockReturnValue(c);
  c.lt = jest.fn().mockReturnValue(c);
  c.eq = jest.fn().mockReturnValue(Object.assign(Promise.resolve(result), c));
  return c;
}

const RUNS = [
  { stage: 'transcribe', model: 'gpt-4o-mini-transcribe', tokens_in: 0, tokens_out: 0, cost_usd: 0.003, status: 'ok' },
  { stage: 'analyze', model: 'claude-sonnet-5', tokens_in: 4000, tokens_out: 500, cost_usd: 0.013, status: 'ok' },
  { stage: 'analyze', model: 'claude-sonnet-5', tokens_in: 2000, tokens_out: 300, cost_usd: 0.007, status: 'rejected' },
  { stage: 'analyze', model: 'claude-sonnet-5', tokens_in: null, tokens_out: null, cost_usd: null, status: 'error' },
];

describe('readSiteEventAiUsage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('totals tokens and spend and breaks them down per stage', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: RUNS, error: null }));
    const out = await readSiteEventAiUsage('p1', null, null);
    expect(out.total_runs).toBe(4);
    expect(out.total_input_tokens).toBe(6000);
    expect(out.total_output_tokens).toBe(800);
    expect(out.total_tokens).toBe(6800);
    expect(out.total_cost_usd).toBe(0.023);
    expect(out.by_stage.map((s) => s.stage)).toEqual(['analyze', 'transcribe']);
    const analyze = out.by_stage[0];
    expect(analyze).toMatchObject({
      run_count: 3, ok_count: 1, rejected_count: 1, error_count: 1,
      input_tokens: 6000, output_tokens: 800, total_tokens: 6800, cost_usd: 0.02,
      models: ['claude-sonnet-5'],
    });
  });

  it('applies the date window when one is given', async () => {
    const c = chain({ data: [], error: null });
    (mockSupabase.from as jest.Mock).mockReturnValue(c);
    await readSiteEventAiUsage('p1', '2026-09-01T00:00:00Z', '2026-09-12T00:00:00Z');
    expect(c.gte).toHaveBeenCalledWith('created_at', '2026-09-01T00:00:00Z');
    expect(c.lt).toHaveBeenCalledWith('created_at', '2026-09-12T00:00:00Z');
  });

  it('reads an empty table as zero spend, not as an error', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: [], error: null }));
    const out = await readSiteEventAiUsage('p1', null, null);
    expect(out).toEqual({
      total_runs: 0, total_input_tokens: 0, total_output_tokens: 0,
      total_tokens: 0, total_cost_usd: 0, by_stage: [],
    });
  });

  it('says WHY it is empty when the read fails, rather than reporting zero spend', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: { message: 'permission denied for table site_event_ai_runs' } }));
    const out = await readSiteEventAiUsage('p1', null, null);
    expect(out.total_runs).toBe(0);
    expect(out.error).toBe('permission denied for table site_event_ai_runs');
  });
});
```

Run it; expected: `'"../reports"' has no exported member named 'readSiteEventAiUsage'`.

- [ ] **Step 2: Add the reader to `tools/reports.ts`**

Insert immediately above `export async function generateAIUsageSummary` (line 909), so the reader sits with its only caller:

```ts
// ── Site-event AI runs: the second source of ai_usage_summary ───────────────
// Plan 2 deviation D18. migration 097's site_event_ai_runs carries one row per
// pipeline stage (transcribe, analyze) with its own tokens and cost. It has no
// user_id - the edge function writes it under the service role - so it cannot
// join the per-user buckets below and lands as its own section instead.

export interface SiteEventAiStageRow {
  stage: string;
  run_count: number;
  ok_count: number;
  rejected_count: number;
  error_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  models: string[];
}

export interface SiteEventAiUsage {
  total_runs: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  by_stage: SiteEventAiStageRow[];
  /** Present only when the read failed, so a missing 097 reads as an explanation, not a zero. */
  error?: string;
}

export const EMPTY_SITE_EVENT_AI_USAGE: SiteEventAiUsage = {
  total_runs: 0, total_input_tokens: 0, total_output_tokens: 0,
  total_tokens: 0, total_cost_usd: 0, by_stage: [],
};

/** Six decimals: a single analyze run costs fractions of a cent, and float noise must not show up as spend. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export async function readSiteEventAiUsage(
  projectId: string,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<SiteEventAiUsage> {
  // The runs table has no project_id of its own; it reaches one through its
  // event. !inner makes that an INNER JOIN, so a run whose event the caller
  // cannot read under 097's RLS drops out instead of leaking a token count.
  let q = supabase
    .from('site_event_ai_runs')
    .select('stage, model, tokens_in, tokens_out, cost_usd, status, created_at, site_events!inner(project_id)')
    .eq('site_events.project_id', projectId);
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lt('created_at', dateTo);

  const { data, error } = await q;
  if (error) return { ...EMPTY_SITE_EVENT_AI_USAGE, by_stage: [], error: error.message };

  const rows = (data ?? []) as Array<{
    stage: string; model: string | null; tokens_in: number | null;
    tokens_out: number | null; cost_usd: number | null; status: string | null;
  }>;

  const stages = new Map<string, SiteEventAiStageRow & { modelSet: Set<string> }>();
  let inTok = 0; let outTok = 0; let cost = 0;

  for (const r of rows) {
    const tin = Number(r.tokens_in ?? 0);
    const tout = Number(r.tokens_out ?? 0);
    const c = Number(r.cost_usd ?? 0);
    inTok += tin; outTok += tout; cost += c;

    const key = r.stage ?? 'unknown';
    if (!stages.has(key)) {
      stages.set(key, {
        stage: key, run_count: 0, ok_count: 0, rejected_count: 0, error_count: 0,
        input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0,
        models: [], modelSet: new Set<string>(),
      });
    }
    const s = stages.get(key)!;
    s.run_count += 1;
    if (r.status === 'ok') s.ok_count += 1;
    else if (r.status === 'rejected') s.rejected_count += 1;
    else s.error_count += 1;
    s.input_tokens += tin;
    s.output_tokens += tout;
    s.total_tokens += tin + tout;
    s.cost_usd += c;
    if (r.model) s.modelSet.add(r.model);
  }

  const by_stage = [...stages.values()]
    .map(({ modelSet, ...s }) => ({ ...s, cost_usd: round6(s.cost_usd), models: [...modelSet].sort() }))
    .sort((a, b) => a.stage.localeCompare(b.stage));

  return {
    total_runs: rows.length,
    total_input_tokens: inTok,
    total_output_tokens: outTok,
    total_tokens: inTok + outTok,
    total_cost_usd: round6(cost),
    by_stage,
  };
}
```

- [ ] **Step 3: Fold it into the report payload**

`generateAIUsageSummary` already computes `dateFrom` and `dateTo` (lines 920-922) before its `ai_chat_log` read. Call the new reader alongside it, and attach the result to both return paths.

In the early-return branch (the `if (error)` block at line 930), add to `data`:

```ts
        site_events: { ...EMPTY_SITE_EVENT_AI_USAGE, error: 'Tidak terbaca: laporan utama gagal dimuat.' },
```

and in the success path, read it before building the payload:

```ts
  const siteEvents = await readSiteEventAiUsage(projectId, dateFrom, dateTo);
```

then add one key to `data`, after `usage_by_day`:

```ts
      site_events: siteEvents,
```

`ai_chat_log` stays the primary source: `summary`, `users` and `usage_by_day` do not change shape, so every existing consumer of this report keeps working and a reader who has never seen a site event sees `site_events.total_runs: 0`.

- [ ] **Step 4: Verify and commit**

```bash
npx jest tools/__tests__/reportsSiteEventAi.test.ts tools/__tests__/reports.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: `Tests: 4 passed, 4 total` in the new suite, `tools/__tests__/reports.test.ts` unchanged and still green, and no `tsc` output.

```bash
git add tools/reports.ts tools/__tests__/reportsSiteEventAi.test.ts
git commit -m "$(cat <<'EOF'
feat(reports): site_event_ai_runs as the second source of ai_usage_summary

Plan 2 deviation D18. The runs table has no user_id, so it lands as its own
section with per-stage token and spend rows rather than being folded into
the per-user buckets. A failed read reports WHY it is empty instead of
claiming zero spend.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification, the manual print check, and the user-run steps

- [ ] **Step 1: The whole suite, with the worktree override**

```bash
cd "/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/room-site-events"
npx jest --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -20
```

Expected: every suite passes, with no `ALLOW_PROD_DB_TESTS` set anywhere in the environment (`env | grep ALLOW_PROD` must print nothing). The suites this plan added or changed are: `clientReportGolden`, `clientReportRooms`, `finishingRender`, `clientReport`, `dailyLogPull`, `dailySiteLogs`, `siteEvents`, `timeWindow`, `roomBoard`, `timelineModel`, `migration099`, `reportsSiteEventAi`.

- [ ] **Step 2: The regression guard specifically**

```bash
npx jest tools/__tests__/clientReportGolden.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' --verbose 2>&1 | tail -14
git diff --stat HEAD -- tools/__tests__/golden
```

Expected: `Tests: 6 passed, 6 total` (task 1's four plus task 3's two), and **no diff at all** on the golden directory since task 1. A modified golden file at this point means a STRUKTUR report changed and the change was absorbed rather than investigated.

- [ ] **Step 3: Type-check and web export**

```bash
npx tsc --noEmit 2>&1 | tail -5
npx expo export --platform web 2>&1 | tail -8
```

Expected: no `tsc` output, and an export that ends in `Exported: dist`. The export is not redundant with `tsc`: CI runs `tsc` and `jest` only (`.github/workflows/ci.yml`), so an untracked new file passes CI and fails on Vercel. Every file this plan creates is new.

- [ ] **Step 4: Manual A4 print check of a FINISHING report**

No unit test can tell you whether a room head looks like a heading at 96 dpi or whether a group breaks across a page badly. Render one and look at it. The renderer imports `react-native`, so it cannot be driven from a plain node script; the opt-in case in `finishingRender.test.ts` (task 3 step 1) writes the file through the jest transform that already makes it importable:

```bash
WRITE_FINISHING_PREVIEW=/tmp/finishing-preview.html \
  npx jest tools/__tests__/finishingRender.test.ts --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/' 2>&1 | tail -5
wc -c /tmp/finishing-preview.html
open /tmp/finishing-preview.html
```

Expected: `Tests: 8 passed, 8 total`, a file of roughly 24 KB, and the page open in a browser. Do the same for the STRUKTUR golden:

```bash
open tools/__tests__/golden/clientReport.struktur.mingguan.html
```

Then print to PDF at A4, margins none, background graphics on, and check five things against the blueprint reference (`Daily Report - TEMPLATE.pdf` and `SANO_Laporan_Harian-Mingguan_Blueprint.html` in `assets/Client Progress Report Template/` of the **main** tree; that folder is untracked and does not exist in this worktree):

1. The masthead kicker reads `Laporan Mingguan · Fase Finishing` and still fits on one line.
2. Each room head sits on its own rule, with the sand gate chip right-aligned, and the first row under it has no doubled border.
3. No room head is orphaned at the foot of a page (`break-after: avoid` on `.rhead`).
4. Figure legends read `Figur 1 · Kamar Mandi Utama` and the three-column legend grid still lines up.
5. **No number that looks like progress appears anywhere.** The 2026-06-28 spec makes the report number-free; `finishingRender.test.ts` asserts no `%` in the body, but a percentage spelled "separuh" is a human check.

Put the two printed PDFs side by side: everything outside section 01 and the figure legend must look identical, because everything outside those two is rendered by code this plan did not touch.

- [ ] **Step 5: Open a PR**

```bash
git push -u origin feat/papan-ruangan-blueprint
gh pr create --title "Papan Ruangan & Finishing-phase Blueprint" --body "$(cat <<'EOF'
Plan 4 of 4 for the 2026-09-10 room site events spec.

- Blueprint regression guard first (spec §18 item 7): byte-identical STRUKTUR goldens plus a SHA-256 pin on BLUEPRINT_CSS.
- `tools/clientReportRooms.ts`: one room comparator shared by the client report and Papan Ruangan.
- Finishing-phase renderer: section 01 grouped by room, phase kicker, room-labelled figure legends, a third additive stylesheet.
- Daily Site Log "Tarik dari kejadian ruangan": proposals only, internal event types listed but unticked.
- Papan Ruangan over `v_room_board` for office, principal and supervisor, plus the room timeline.
- Migration `099_site_event_assignment.sql` (hand-pasted) for owner and due-date edits, which 097's D5 trigger otherwise refuses.
- `site_event_ai_runs` as the second source of `ai_usage_summary` (plan 2 deviation D18).

Migrations are pasted by the user; see the user-run steps below.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: User-run steps (not run by any agent)**

These are for the user, in this order, after the PR merges:

1. **Paste `supabase/migrations/099_site_event_assignment.sql`** into the Supabase Dashboard SQL editor. It must come after 096, 097 and 098; pasted before 098 every reassignment would notify nobody, because the enqueue helpers turn a rejected `notifications.type` into a WARNING. Run the eight self-checks in the file's footer.
2. **Set the pilot project's phase to `FINISHING`.** In the app: office tab "Ruangan" → "Kelola ruangan" → "Fase proyek". Or in SQL: `UPDATE projects SET phase = 'FINISHING' WHERE code = '<pilot code>';`. Until this is set the project keeps rendering the STRUKTUR report, which is correct, not a bug.
3. **Confirm the pilot project has rooms, including `UMUM`.** "Kelola ruangan" creates Area Umum on the first room (plan 1). Without it, a room-less highlight still reaches the report through the in-memory fallback, but the board has nowhere to show general-area events.
4. **Deploy web** (Vercel, automatic from `main`) and, if supervisors need the Papan tab on the phone, **publish an OTA update** to the `preview` channel: `eas update --branch preview`. This plan adds no native module, so an OTA update is enough and no new APK build is needed.
5. **Generate one Finishing weekly report from real data** and read it end to end before sending it to a client. The golden test proves the STRUKTUR path did not move; only a human can confirm that the room grouping reads well for this particular project.

---

## Self-review and deviations

### How the code in this plan was verified

Every TypeScript, TSX and SQL block was extracted into a scratch sandbox at `/private/tmp/claude-501/-Users-carissatjondro-Dropbox-AI-Claude-Code/4fdfe5b0-e5ab-428f-a706-b8f2cb0ee097/scratchpad/plan4/sandbox`, a copy of the worktree's `tools/`, `workflows/`, `office/` and `supabase/` plus a symlinked `node_modules`, with plan 2's not-yet-existing modules replaced by shims whose types are copied verbatim from plan 2 (`SiteEvent`, `SiteEventMedia`, `RoomBoardRow`, `SITE_EVENT_TYPE_LABELS`, `SITE_MEDIA_PATH_PREFIX`, `isOverdue`, `OwnerField`, `DueDateField`, `signedMediaUrl`).

| What | Result |
|---|---|
| `tools/__tests__/clientReportGolden.test.ts` (task 1) run against the **pristine** `tools/clientReportHtml.ts` | 4 passed. The golden files were captured from that pristine renderer: 22,284 bytes weekly, 21,315 bytes daily. The `BLUEPRINT_CSS` block is 10,182 characters and hashes to `03c76aa8bd3f22b6d86ca7af607e779744f86729e15e30969b62e14325417e33`, which is the literal in the test. |
| Byte-identity of the modified renderer against the pristine one, on the weekly draft, the daily draft and an explicit `phase: 'STRUKTUR'` | 3 passed, using a scratch copy of the original renderer as the comparison. This is the check the golden file encodes; running both ways is why the plan can promise the STRUKTUR path did not move. |
| `clientReportRooms`, `finishingRender`, `roomBoard`, `dailyLogPull`, `clientReport`, `clientReportHtml`, `dailySiteLogs`, `clientReportGallery.integration` | 107 passed across 8 suites. |
| The four new `assembleClientReportDraft` phase cases (task 3 step 8) | 4 passed. |
| The two new `upsertDailyLog` insert cases (task 4 step 2) | 2 passed, plus the 7 existing `dailySiteLogs` cases still green with the widened literals. |
| `listConfirmedEventsForDay` (task 4 step 5) | 3 passed. The WIB literals in the test are the values `wibStartOfDayIso`/`wibEndOfDayExclusiveIso` actually return (`2026-09-10T17:00:00.000Z` / `2026-09-11T17:00:00.000Z`), confirmed by running them; my first draft asserted `+07:00` spellings and failed, which is exactly why the literal is asserted rather than the helper re-called. |
| `tools/__tests__/migration099.test.ts` against the real 099 SQL | 24 passed. The `EXPECTED:` count guard was 8 in my first draft and is 9 in the plan, because self-check 6 carries two. |
| `workflows/__tests__/timelineModel.test.ts` | 13 passed. |
| `listRoomTimeline` and `updateSiteEventAssignment` | 5 passed. |
| `readSiteEventAiUsage` | 4 passed. |
| The `WRITE_FINISHING_PREVIEW` case (task 3 step 1, used by task 9 step 4) | Wrote a 24,397-byte preview with four room heads. It exists because the renderer imports `react-native`: my first draft of task 9 used a plain `npx tsx` script, which cannot resolve that import outside jest. |
| `npx tsc --noEmit` over the sandbox with `RoomBoardView.tsx`, `PrincipalRoomsScreen.tsx`, `RoomBoardScreen.tsx`, `AssignmentEditor.tsx`, `RoomTimeline.tsx`, the patched `RoomsAdminScreen.tsx`, `PrincipalNavigation.tsx`, `navigation.tsx` and `ProgresScreen.tsx` | clean, no output. |

Not verified by running, and why: `npx expo export --platform web` was not run (it would write into the worktree another agent is using); the manual A4 print check is task 9 step 4 by construction; migration 099 was never executed against a database, only statically guarded, because migrations in this project are pasted by the user.

### Deviations from the spec

| # | Spec text | Plan | Why |
|---|---|---|---|
| D1 | §18 item 7: "The byte-identical Blueprint regression test is the guard; it must be written before the renderer is touched" | Task 1 writes the golden test **and** a second, independent SHA-256 lock on `BLUEPRINT_CSS` | A golden file can be regenerated with a flag, which makes it a change-detector rather than a contract. The 2026-06-28 spec §1.2 calls the CSS a verbatim port, so it gets a lock that regenerating a golden cannot satisfy. |
| D2 | §18 item 7 implies one test file covering both phases | The phase-equivalence cases (`phase: 'STRUKTUR'` behaves like no phase; stray `roomGroups` are inert) are added to the golden suite in **task 3**, not task 1 | `ClientReportDraft` has no `phase` field until task 3, so writing those cases in task 1 would be a TypeScript error (TS2353 on an object literal), not a red test. The golden and CSS locks themselves are fully in place from task 1. |
| D3 | §9: "edit owner and due date (office roles and the reporter)" | The current **owner** is explicitly excluded, in `canEditAssignment` and again in migration 099 | The spec lists two groups and the owner is in neither. An owner handing their own overdue item to somebody else is the accountability gap the feature exists to close, so the reading is enforced rather than left ambiguous. Called out because it is an interpretation of a list, not a quotation. |
| D4 | §9: "supervisors get the same data in a phone layout reached from Progres" | The Progres hub gains a **second** button ("Papan"); the existing "Ruangan" button keeps opening the scanner | `ProgresScreen.tsx:343,349` already maps "Ruangan" to `RoomScan`, and that one-tap path is what the whole capture flow depends on. Replacing it would trade a capture entry point for a monitoring one. |
| D5 | §9: "open the linked Catatan Perubahan when one exists" | Release 1 opens the **screen** that lists Catatan Perubahan (`Approvals` for office and principal, `Progres` for supervisors), not the specific row | Neither surface accepts a row id as a route param: `ApprovalsScreen` loads its own list and `ProgresScreen`'s `perubahan` view is local component state (`:26,303`). Adding row-level routing is a change to two screens the spec does not ask for. Noted as a release-2 follow-up. |
| D6 | §16 metrics, and plan 2 D18: "`ai_usage_summary` gains `site_event_ai_runs`" | The runs land as their own `data.site_events` section with per-stage rows, not folded into the existing `users` array | `site_event_ai_runs` has no `user_id` (the edge function writes it under the service role) and no `role`, while `generateAIUsageSummary` buckets everything per user. Folding them together would mean inventing a user. `summary`, `users` and `usage_by_day` keep their shape, so no existing consumer breaks. |
| D7 | §10.2: "The frozen `snapshot` on `client_progress_reports` gains the room grouping and stays frozen" | `phase` and `roomGroups` are **optional** on `ClientReportDraft`, and the renderer treats absent exactly like `'STRUKTUR'` | No migration is needed: the snapshot is JSONB holding the whole draft (`tools/clientReport.ts:286,373-380`). Optionality is what lets every pre-existing issued report re-render byte-for-byte as it was sent. |
| D8 | The task brief named the print reference `assets/Client Progress Report Template/daily_blueprint.pdf` | Task 9 step 4 cites `Daily Report - TEMPLATE.pdf` and `SANO_Laporan_Harian-Mingguan_Blueprint.html` in that folder, and says the folder lives in the **main** tree only | `daily_blueprint.pdf` does not exist. `ls "assets/Client Progress Report Template/"` in the main tree lists those two among others; the folder is untracked (`git status` shows `?? "assets/Client Progress Report Template/"`) and is absent from this worktree. |
| D9 | §9: "Quiet cards render grey" | Quiet cards render at `opacity: 0.55` rather than on a grey background | The card surface already carries the app's border and shadow; a second background treatment would read as a different kind of card. Fading the row gives the same "nothing has happened here" reading inside the existing system. |
| D10 | §9's summary strip counts "rooms quiet for more than 3 days" | The strip counts a quiet room **only if it has ever had an event** | `v_room_board.is_quiet` is true both for a room that went silent and for one nobody has ever used. A freshly created project would otherwise open with every room counted as quiet, which is a number a PM would learn to ignore in a week. The card itself still fades for both, and reads "Belum ada kejadian" for the second. |

### Open risks this plan does not close

- **`OwnerField` and `DueDateField` come from plan 2 task 13.** `AssignmentEditor` uses them with the prop types plan 2 declares. If plan 2 ships different props, task 7 step 4 is where that shows up, as a `tsc` error naming the prop.
- **`SITE_EVENT_TYPE_LABELS` key order drives the board's chip order and the filter row.** `tools/constants.ts` (plan 2 task 2) declares it `progres, isu, hambatan, cacat, butuh_keputusan, info`; `roomBoard.test.ts` pins that order through `openChips`. A reordering there changes the UI and fails that test, which is the intended signal.
- **The 3-day quiet threshold is a constant inside `v_room_board`.** Spec §18 item 4 keeps it that way for the pilot, so changing it after the pilot is a new migration, not a setting. The board reads `is_quiet` and never recomputes it.
