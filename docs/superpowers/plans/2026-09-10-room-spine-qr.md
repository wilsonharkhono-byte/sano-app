# Room Spine & QR Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SANO a spatial identity layer it does not have today - rooms that are authored in the office, carry a frozen DATUM-shaped code, print as an A4 sheet of QR labels, and open the right screen in the right role when a supervisor scans one with the phone camera or the in-app scanner. Gates become reference data an office user can relabel, and a project gains a `phase` the later Blueprint renderer will switch on. Nothing in this plan captures a site event; it builds the spine the next three plans hang off.

**Architecture:** Migration `096_rooms_gates_phase.sql` extends the dormant `rooms` table from 035 with DATUM's shape (`area_type`, `sort_order`, `qr_printed_at`, `active`, `datum_area_id`), adds `projects.phase`, and creates two reference tables `gate_refs` (seeded A to H) and `gate_step_refs` (ships empty) whose codes are immutable and undeletable by trigger. Five small pure-first TypeScript modules sit in `tools/` - `roomCodes` (a verbatim port of DATUM's normalizer), `roomLinks` (build and parse the QR URL), `rooms`, `gateRefs`, `projectPhase` - plus `roomLabelsHtml`, which renders an A4 label sheet as an HTML string and prints it through the same `window.print()` popup path the client report already uses. Two office screens author the data; one supervisor screen is the landing target for a scanned label; React Navigation `linking` config on all three containers resolves `/r/{projectCode}/{roomCode}` per role, backed by Android App Links (`assetlinks.json` served from `public/.well-known/`) and the custom scheme `sano://`.

**Tech Stack:** TypeScript, React Native (Expo SDK 54 / RN 0.81), React Navigation 6 bottom tabs, Supabase Postgres with hand-pasted migrations, jest + ts-jest, `expo-camera` for the in-app scanner, `expo-linking` for the scheme, `qrcode` for SVG QR generation on web. Indonesian UI copy, no i18n library.

**Spec:** `docs/superpowers/specs/2026-09-10-room-site-events-design.md` (sections 2, 4.1, 8, 9, 13, 14, 16, 18).

**Branch and working tree:** `feat/room-site-events`, checked out in the git worktree `/Users/carissatjondro/Dropbox/AI/Claude Code/.claude/worktrees/room-site-events`. The main tree stays on `main`. Because that path contains `/.claude/worktrees/`, the repo's `testPathIgnorePatterns` would hide every test, so every `npx jest <path>` in this plan must be run as `npx jest <path> --testPathIgnorePatterns='/node_modules/' '__tests__/fixtures\.ts$' '__tests__/_serverGateHarness\.ts$' 'supabase/functions/' 'tmp/'`. Never set `ALLOW_PROD_DB_TESTS`. Never apply a migration to the live database; migrations are pasted by the user.

**Commit identity:** the repo's commits are authored by `Test User <test@example.com>`, which is already the configured git user here - a plain `git commit` is correct. End every commit message with the trailer line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Plan sequence

This is **plan 1 of 4** for the 2026-09-10 spec. The four are strictly ordered; each assumes the previous one has landed.

| # | Plan | Scope |
|---|---|---|
| **1** | **Room Spine & QR Deep Links (this document)** | Migration 096 (rooms, `gate_refs`, `gate_step_refs`, `projects.phase`), `tools/roomCodes.ts`, `tools/roomLinks.ts`, `tools/rooms.ts`, `tools/gateRefs.ts`, `tools/projectPhase.ts`, `tools/roomLabelsHtml.ts`, office "Kelola ruangan" + "Kelola gerbang", A4 QR label sheet, Android App Links + `sano://`, React Navigation linking on all three containers, in-app QR scanner, supervisor `RoomScreen` landing target, office read-only `RoomDetailScreen`. |
| 2 | Site Event capture + AI draft | Migrations `097_site_events.sql` (site_events, site_event_media, site_event_ai_runs, the three guard triggers, `confirm_site_event`, `v_room_board`) and `098_daily_log_room_link.sql` (daily-log room columns, the `SITE_EVENT_ASSIGNED` notification-type swap, `tools/notificationRouting.ts` entry). Edge function `supabase/functions/site-event-analyze/` with a pure `validate.ts`. Capture screen (foto konteks, close-ups, suara, catatan, gerbang chips) and the confirm screen. |
| 3 | Offline queue | `tools/captureQueue.ts` (pure state machine, jest-tested) and `tools/captureQueueStore.ts` (AsyncStorage index + `expo-file-system` media copies), the resumable upload/insert/invoke worker, the Beranda queue badge, and the plain-spoken web limitation copy. |
| 4 | Papan Ruangan + Blueprint Finishing mode | The `v_room_board`-backed board (office tab + principal tab + the supervisor phone layout reached from Progres), room timeline with "Selesai" and owner/due editing, Daily Site Log "Tarik dari kejadian ruangan", and the `projects.phase` switch in `tools/clientReport.ts` / `tools/clientReportHtml.ts` with the byte-identical STRUKTUR regression guard. |

**Not in this plan:** `site_events` in any form, media capture, transcription, the Claude analysis call, the offline queue, the room board, and every Blueprint change. `RoomScreen` therefore lands with a deliberate empty state; task 11 states exactly what it says.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/roomCodes.ts` (create) | `normalizeRoomCode` (verbatim port of DATUM's `normalizeAreaCode`), `isValidRoomCode`, `ROOM_CODE_MAX`. No imports. |
| `tools/__tests__/roomCodes.test.ts` (create) | DATUM's own fixtures plus the SANO cases: Indonesian room names, dash collapsing, the 40-character slice, empty input. |
| `tools/roomLinks.ts` (create) | `ROOM_LINK_HOST`, the two prefixes, `buildRoomUrl`, `parseRoomUrl`. Pure. |
| `tools/__tests__/roomLinks.test.ts` (create) | Round-trip, both accepted prefixes, trailing slash, query string, and every rejection path. |
| `supabase/migrations/096_rooms_gates_phase.sql` (create) | `projects.phase` + `datum_project_code`; the `rooms` columns, shape CHECK and freeze trigger; `gate_refs` + seed; `gate_step_refs`; the immutability triggers; RLS. Self-check queries at the end. |
| `tools/__tests__/migration096.test.ts` (create) | Static guards on the SQL text, in the style of `tools/__tests__/migration092.test.ts`. |
| `tools/types.ts` (modify) | `ProjectPhase`, `AreaType`, `phase` + `datum_project_code` on `Project`, and the `Room`, `GateRef`, `GateStepRef` interfaces. |
| `tools/constants.ts` (modify) | `PROJECT_PHASES`, `PROJECT_PHASE_LABELS`, `AREA_TYPES`, `AREA_TYPE_LABELS`, `AREA_UMUM_CODE`. |
| `tools/rooms.ts` (create) | Supabase reads and writes for rooms, plus the pure `parseRoomPaste` and `roomsToDatumAreas`. |
| `tools/__tests__/rooms.test.ts` (create) | The pure helpers only. `../supabase` is mocked at the top, because the module imports it. |
| `tools/gateRefs.ts` (create) | Gate and step reference reads and writes, plus the pure `gateChipLabel` / `stepChipLabel`. |
| `tools/__tests__/gateRefs.test.ts` (create) | The pure chip labels and the `code`-in-patch refusal. |
| `tools/projectPhase.ts` (create) | `canSetProjectPhase`, `setProjectPhase`, and the honest report when RLS silently filters the row. |
| `tools/__tests__/projectPhase.test.ts` (create) | The role guard and the zero-rows-updated branch. |
| `tools/roomLabelsHtml.ts` (create) | Pure `renderRoomLabelSheetHtml`, and the web-only `exportRoomLabelSheet` popup print path. |
| `tools/__tests__/roomLabelsHtml.test.ts` (create) | One label per room, HTML escaping, a page break every 9 labels. |
| `office/screens/RoomsAdminScreen.tsx` (create) | "Kelola ruangan": phase picker, rooms grouped by floor, add form, paste import, print, DATUM export, switch to gates. |
| `office/screens/rooms/RoomForm.tsx` (create) | The add form with a live `normalizeRoomCode` preview. |
| `office/screens/rooms/RoomPasteImport.tsx` (create) | The paste textarea, its parsed preview and its warning list. |
| `office/screens/GatesAdminScreen.tsx` (create) | "Kelola gerbang": editable label, description, order, active; code read-only; steps under each gate. |
| `office/screens/RoomDetailScreen.tsx` (create) | Read-only room detail, the office and principal deep-link landing target. |
| `office/navigation.tsx` (modify) | New visible "Ruangan" tab, hidden `RoomDetail` screen, `linking` on the container. |
| `office/PrincipalNavigation.tsx` (modify) | Hidden `RoomDetail` screen, `linking` on the container. |
| `workflows/linking.ts` (create) | `buildLinking(screens)` - the prefixes plus a screen path map, shared by all three containers. |
| `workflows/__tests__/linking.test.ts` (create) | The three configs, and `getStateFromPath` resolving the real URL. |
| `workflows/navigation.tsx` (modify) | Hidden `RoomScan` and `Room` screens, `linking` on the container. |
| `workflows/screens/RoomScanScreen.tsx` (create) | `expo-camera` QR scanner on native, the room picker on web. |
| `workflows/screens/RoomScreen.tsx` (create) | The scan landing target: project resolution, room resolution, header, gate chips, empty state. |
| `workflows/screens/components/RoomPicker.tsx` (create) | Search-by-name-or-floor room list, the fallback when no label is readable. |
| `workflows/screens/BerandaScreen.tsx` (modify) | "Scan Ruangan" card. |
| `workflows/screens/ProgresScreen.tsx` (modify) | "Ruangan" entry in the hub grid. |
| `workflows/hooks/useProject.tsx` (modify) | Nothing in the query - `select('*')` already returns `phase`; only the doc comment changes. |
| `app.json` (modify) | `scheme: "sano"`, `expo-camera` plugin, `android.intentFilters`. |
| `public/.well-known/assetlinks.json` (create) | Android App Links verification file. |
| `vercel.json` (modify) | `Content-Type: application/json` header for `/.well-known/assetlinks.json`. |
| `package.json` (modify) | `expo-camera`, `expo-linking`, `qrcode`, `@types/qrcode`. |

---

### Task 1: `tools/roomCodes.ts` - the DATUM normalizer, ported verbatim

**Files:**
- Create: `tools/roomCodes.ts`
- Test: `tools/__tests__/roomCodes.test.ts`

- [ ] **Step 1: Read the source of truth before porting**

```bash
sed -n '96,110p' "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/packages/core/src/areas/extract.ts"
sed -n '18,30p' "/Users/carissatjondro/Dropbox/AI/DATUM Studio Brain/packages/core/src/areas/extract.test.ts"
```

Expected: a seven-call chain (`trim`, `toUpperCase`, `replace(/\s+/g,"-")`, `replace(/[^A-Z0-9-]/g,"")`, `replace(/-+/g,"-")`, `replace(/^-|-$/g,"")`, `slice(0, 40)`) and three DATUM test cases (`"l1 kitchen"` → `"L1-KITCHEN"`, `"L1.Kitchen!"` → `"L1KITCHEN"`, `"   "` → `""`). If the chain differs from what Step 3 writes, port what you actually read and say so in the commit body - DATUM is the authority, not this plan.

- [ ] **Step 2: Write the failing test**

Create `tools/__tests__/roomCodes.test.ts`:

```ts
/**
 * normalizeRoomCode is a VERBATIM port of DATUM's normalizeAreaCode
 * (DATUM Studio Brain packages/core/src/areas/extract.ts:100-109). The first
 * describe block is DATUM's own suite, copied so a drift on either side fails
 * here: release 2 links a SANO room to a DATUM area on (project_code,
 * room_code), and a normalizer that gains one extra rule turns that upsert into
 * a manual reconciliation.
 *
 * The second block is the SANO half - the Indonesian names an estimator
 * actually types, and the 40-character slice, which is the one place where
 * normalize can hand back a string isValidRoomCode rejects.
 */
import { normalizeRoomCode, isValidRoomCode, ROOM_CODE_MAX } from '../roomCodes';

describe('normalizeRoomCode - DATUM parity fixtures', () => {
  it('uppercases, trims, slugifies', () => {
    expect(normalizeRoomCode('l1 kitchen')).toBe('L1-KITCHEN');
    expect(normalizeRoomCode('  KM-ANAK  ')).toBe('KM-ANAK');
    expect(normalizeRoomCode('L1--KITCHEN--')).toBe('L1-KITCHEN');
  });

  it('strips non-alphanumeric-hyphen characters', () => {
    expect(normalizeRoomCode('L1.Kitchen!')).toBe('L1KITCHEN');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeRoomCode('   ')).toBe('');
  });
});

describe('normalizeRoomCode - SANO room names', () => {
  it('turns a typed Indonesian room name into a label code', () => {
    expect(normalizeRoomCode('Kamar Mandi Utama Lt.2')).toBe('KAMAR-MANDI-UTAMA-LT2');
    expect(normalizeRoomCode('Lt.2 Kamar Mandi Utama')).toBe('LT2-KAMAR-MANDI-UTAMA');
  });

  it('collapses runs of separators and trims leading/trailing dashes', () => {
    expect(normalizeRoomCode('-- Lt 2 // Dapur --')).toBe('LT-2-DAPUR');
    expect(normalizeRoomCode('Lt 2   Dapur')).toBe('LT-2-DAPUR');
  });

  it('is idempotent - a normalized code normalizes to itself', () => {
    const once = normalizeRoomCode('Kamar Mandi Utama Lt.2');
    expect(normalizeRoomCode(once)).toBe(once);
  });

  it('slices to 40 characters, exactly like DATUM', () => {
    const long = 'RUANG TAMU UTAMA LANTAI DUA SAYAP BARAT DEPAN'; // 45 chars
    const code = normalizeRoomCode(long);
    expect(code).toBe('RUANG-TAMU-UTAMA-LANTAI-DUA-SAYAP-BARAT-');
    expect(code).toHaveLength(ROOM_CODE_MAX);
  });
});

describe('isValidRoomCode', () => {
  it('accepts the shape the database CHECK accepts', () => {
    expect(isValidRoomCode('UMUM')).toBe(true);
    expect(isValidRoomCode('L2-KM-UTAMA')).toBe(true);
    expect(isValidRoomCode('PC5')).toBe(true);
  });

  it('rejects empty, lowercase, spaced, and doubled-dash codes', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('l2-km')).toBe(false);
    expect(isValidRoomCode('L2 KM')).toBe(false);
    expect(isValidRoomCode('L2--KM')).toBe(false);
  });

  it('rejects leading and trailing dashes', () => {
    expect(isValidRoomCode('-L2')).toBe(false);
    expect(isValidRoomCode('L2-')).toBe(false);
  });

  it('rejects anything longer than 40 characters', () => {
    expect(isValidRoomCode('A'.repeat(ROOM_CODE_MAX))).toBe(true);
    expect(isValidRoomCode('A'.repeat(ROOM_CODE_MAX + 1))).toBe(false);
  });

  // The one honest seam between the two functions: the slice happens LAST in
  // DATUM's chain, so a 45-character name whose 40th character is a separator
  // comes back with a trailing dash - a string normalize produced and
  // isValidRoomCode refuses. The office form must surface that rather than
  // save it; the database CHECK in 096 refuses it too.
  it('rejects a normalized code the 40-character slice left with a trailing dash', () => {
    const code = normalizeRoomCode('RUANG TAMU UTAMA LANTAI DUA SAYAP BARAT DEPAN');
    expect(code.endsWith('-')).toBe(true);
    expect(isValidRoomCode(code)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest tools/__tests__/roomCodes.test.ts
```

Expected: `Cannot find module '../roomCodes' from 'tools/__tests__/roomCodes.test.ts'`, suite fails to run.

- [ ] **Step 4: Write the module**

Create `tools/roomCodes.ts`:

```ts
// SANO - Room codes.
//
// normalizeRoomCode is a VERBATIM port of DATUM's normalizeAreaCode
// (DATUM Studio Brain, packages/core/src/areas/extract.ts:100-109). Spec §2
// decision 2: rooms are authored in SANO but shaped like DATUM areas, and the
// release-2 link matches on (project_code, room_code). Two normalizers that
// disagree by one rule turn that link from an upsert into a reconciliation
// meeting, so this function is not the place to be clever. Change it only when
// DATUM changes, and port the change verbatim.
//
// The chain, in order: trim, uppercase, whitespace runs to a single dash, drop
// everything outside [A-Z0-9-], collapse repeated dashes, trim leading and
// trailing dashes, slice to 40 characters.

/** Maximum stored length. Mirrors DATUM's slice and the CHECK in migration 096. */
export const ROOM_CODE_MAX = 40;

export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, ROOM_CODE_MAX);
}

/**
 * The exact shape migration 096 enforces:
 *   CHECK (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40)
 *
 * Note that normalizeRoomCode can return a string this refuses: the slice runs
 * LAST, so a long name whose 40th character is a separator comes back with a
 * trailing dash. That is not a bug to paper over - the office form shows the
 * preview and refuses to save, and the database refuses too.
 */
const ROOM_CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export function isValidRoomCode(code: string): boolean {
  return code.length > 0 && code.length <= ROOM_CODE_MAX && ROOM_CODE_RE.test(code);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest tools/__tests__/roomCodes.test.ts
```

Expected: `Tests: 12 passed, 12 total`.

- [ ] **Step 6: Commit**

```bash
git add tools/roomCodes.ts tools/__tests__/roomCodes.test.ts
git commit -m "$(cat <<'EOF'
feat(rooms): port DATUM's area-code normalizer as normalizeRoomCode

Verbatim port of packages/core/src/areas/extract.ts:100-109, with DATUM's own
test fixtures copied so a drift on either side fails here. isValidRoomCode
mirrors the CHECK migration 096 will add, including the case where the
40-character slice leaves a trailing dash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `tools/roomLinks.ts` - build and parse the QR URL

**Files:**
- Create: `tools/roomLinks.ts`
- Test: `tools/__tests__/roomLinks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/roomLinks.test.ts`:

```ts
/**
 * The QR label is a physical object with a URL printed on it. Everything that
 * reads that URL - the phone camera, the in-app scanner, a human typing the
 * text under the code - funnels through parseRoomUrl, so its refusals are the
 * app's refusals. Spec §8: anything that is not a SANO room URL gives
 * "QR bukan label ruangan SANO.", never a silent no-op.
 *
 * parseRoomUrl deliberately normalizes the room code it returns (a typed-in
 * lowercase URL still finds the room) but leaves the project code alone beyond
 * trimming - project codes are the estimator's own strings and are matched
 * case-insensitively by the screen, not rewritten here.
 */
import { buildRoomUrl, parseRoomUrl, ROOM_LINK_HOST } from '../roomLinks';

describe('buildRoomUrl', () => {
  it('builds the https URL the QR encodes', () => {
    expect(buildRoomUrl('GA17', 'L2-KM-UTAMA')).toBe(
      'https://sano-app.vercel.app/r/GA17/L2-KM-UTAMA',
    );
  });

  it('uses the shared host constant', () => {
    expect(buildRoomUrl('GA17', 'UMUM')).toContain(ROOM_LINK_HOST);
  });

  it('percent-encodes codes that would otherwise break the path', () => {
    expect(buildRoomUrl('SPH 4', 'UMUM')).toBe(
      'https://sano-app.vercel.app/r/SPH%204/UMUM',
    );
  });
});

describe('parseRoomUrl - accepted forms', () => {
  it('round-trips what buildRoomUrl produced', () => {
    expect(parseRoomUrl(buildRoomUrl('GA17', 'L2-KM-UTAMA'))).toEqual({
      projectCode: 'GA17',
      roomCode: 'L2-KM-UTAMA',
    });
  });

  it('accepts the custom scheme', () => {
    expect(parseRoomUrl('sano://r/GA17/L2-KM-UTAMA')).toEqual({
      projectCode: 'GA17',
      roomCode: 'L2-KM-UTAMA',
    });
  });

  it('accepts a trailing slash', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/UMUM/')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });

  it('ignores a query string and a fragment', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/UMUM?utm=qr#top')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });

  it('decodes percent-encoded segments', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/SPH%204/UMUM')).toEqual({
      projectCode: 'SPH 4',
      roomCode: 'UMUM',
    });
  });

  it('normalizes a hand-typed lowercase room code', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/l2-km-utama')).toEqual({
      projectCode: 'GA17',
      roomCode: 'L2-KM-UTAMA',
    });
  });

  it('is case-insensitive about the host and the scheme', () => {
    expect(parseRoomUrl('HTTPS://SANO-APP.VERCEL.APP/r/GA17/UMUM')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });

  it('tolerates surrounding whitespace from a scanner payload', () => {
    expect(parseRoomUrl('  sano://r/GA17/UMUM  ')).toEqual({
      projectCode: 'GA17',
      roomCode: 'UMUM',
    });
  });
});

describe('parseRoomUrl - refusals', () => {
  it('rejects another host', () => {
    expect(parseRoomUrl('https://example.com/r/GA17/UMUM')).toBeNull();
    expect(parseRoomUrl('https://sano-app.vercel.app.evil.com/r/GA17/UMUM')).toBeNull();
  });

  it('rejects another scheme', () => {
    expect(parseRoomUrl('http://sano-app.vercel.app/r/GA17/UMUM')).toBeNull();
    expect(parseRoomUrl('datum://r/GA17/UMUM')).toBeNull();
  });

  it('rejects another path prefix', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/x/GA17/UMUM')).toBeNull();
    expect(parseRoomUrl('https://sano-app.vercel.app/GA17/UMUM')).toBeNull();
  });

  it('rejects a wrong number of segments', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17')).toBeNull();
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/UMUM/EXTRA')).toBeNull();
  });

  it('rejects a room code that normalizes to nothing', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/%20%20')).toBeNull();
  });

  it('rejects a malformed percent escape instead of throwing', () => {
    expect(parseRoomUrl('https://sano-app.vercel.app/r/GA17/%E0%A4%A')).toBeNull();
  });

  it('rejects plain text and empty input', () => {
    expect(parseRoomUrl('Kamar Mandi Utama')).toBeNull();
    expect(parseRoomUrl('')).toBeNull();
    expect(parseRoomUrl('   ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tools/__tests__/roomLinks.test.ts
```

Expected: `Cannot find module '../roomLinks'`.

- [ ] **Step 3: Write the module**

Create `tools/roomLinks.ts`:

```ts
// SANO - Room deep links.
//
// One URL shape, printed on a physical label and encoded in its QR:
//   https://sano-app.vercel.app/r/{projectCode}/{roomCode}
// with the custom scheme sano://r/{projectCode}/{roomCode} as the fallback the
// Android App Link falls back to and as the iOS path in release 1 (spec §18
// item 6: universal links need an Apple team SANO does not have yet).
//
// Parsing is done by hand rather than with `new URL`: for a non-special scheme
// like sano:, WHATWG URL puts the first path segment in `host`, so "sano://r/…"
// parses as host "r" - a shape difference that would have to be special-cased
// anyway. String parsing is shorter, has no polyfill dependency, and is exactly
// as testable.

import { normalizeRoomCode } from './roomCodes';

export const ROOM_LINK_HOST = 'sano-app.vercel.app';
export const ROOM_LINK_HTTPS_PREFIX = `https://${ROOM_LINK_HOST}`;
export const ROOM_LINK_SCHEME_PREFIX = 'sano://';
/** The one path segment every room link starts with. */
export const ROOM_LINK_PATH = 'r';

export interface RoomLinkTarget {
  projectCode: string;
  roomCode: string;
}

/** The URL encoded in the QR and printed as readable text beneath it. */
export function buildRoomUrl(projectCode: string, roomCode: string): string {
  return `${ROOM_LINK_HTTPS_PREFIX}/${ROOM_LINK_PATH}/${encodeURIComponent(projectCode)}/${encodeURIComponent(roomCode)}`;
}

/**
 * Returns the target of a SANO room link, or null for anything else.
 *
 * null is not an error state to swallow: every caller turns it into the exact
 * refusal from spec §8, "QR bukan label ruangan SANO." The room code comes back
 * normalized (so a hand-typed lowercase URL still resolves); the project code
 * comes back trimmed but otherwise untouched, and callers match it
 * case-insensitively against projects.code.
 */
export function parseRoomUrl(url: string): RoomLinkTarget | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  let path: string;

  if (lower.startsWith('https://')) {
    const afterScheme = trimmed.slice('https://'.length);
    const slash = afterScheme.indexOf('/');
    const host = (slash === -1 ? afterScheme : afterScheme.slice(0, slash)).toLowerCase();
    // Exact host match - a suffix check would accept sano-app.vercel.app.evil.com.
    if (host !== ROOM_LINK_HOST) return null;
    path = slash === -1 ? '' : afterScheme.slice(slash);
  } else if (lower.startsWith(ROOM_LINK_SCHEME_PREFIX)) {
    path = `/${trimmed.slice(ROOM_LINK_SCHEME_PREFIX.length).replace(/^\/+/, '')}`;
  } else {
    return null;
  }

  path = path.split('#')[0].split('?')[0];

  const parts = path.split('/').filter((p) => p.length > 0);
  if (parts.length !== 3) return null;
  if (parts[0].toLowerCase() !== ROOM_LINK_PATH) return null;

  let projectCode: string;
  let roomCode: string;
  try {
    projectCode = decodeURIComponent(parts[1]).trim();
    roomCode = normalizeRoomCode(decodeURIComponent(parts[2]));
  } catch {
    // decodeURIComponent throws URIError on a malformed escape; a broken QR is
    // a refusal, not a crash.
    return null;
  }

  if (!projectCode || !roomCode) return null;
  return { projectCode, roomCode };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tools/__tests__/roomLinks.test.ts
```

Expected: `Tests: 18 passed, 18 total`.

- [ ] **Step 5: Commit**

```bash
git add tools/roomLinks.ts tools/__tests__/roomLinks.test.ts
git commit -m "$(cat <<'EOF'
feat(rooms): build and parse the /r/{project}/{room} QR link

buildRoomUrl is what the label prints; parseRoomUrl is what the camera, the
in-app scanner and a hand-typed URL all funnel through. Exact host match (a
suffix check would accept sano-app.vercel.app.evil.com), both accepted
prefixes, and null for everything else so callers can give the spec §8 refusal
instead of a silent no-op.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration `096_rooms_gates_phase.sql` with a static guard test

**Files:**
- Create: `supabase/migrations/096_rooms_gates_phase.sql`
- Test: `tools/__tests__/migration096.test.ts`

The remote migration history is divergent and `supabase db push` is broken, so this file is pasted into the Supabase Dashboard SQL editor by hand and must be safe to paste twice. Nothing in this task runs against a database under jest; the guard is the SQL text, exactly as `tools/__tests__/migration092.test.ts` guards 092.

- [ ] **Step 1: Confirm the objects the SQL builds on**

```bash
sed -n '40,53p' supabase/migrations/035_whatsapp_intelligence.sql
sed -n '266,275p' supabase/migrations/035_whatsapp_intelligence.sql
sed -n '47,50p' supabase/migrations/001_core_tables.sql
sed -n '33,45p' supabase/migrations/036_office_global_project_access.sql
grep -n "'rooms'" supabase/migrations/036_office_global_project_access.sql
sed -n '84,99p' supabase/migrations/050_client_progress_report.sql
```

Expected: `rooms` exists from 035 with `id, project_id, room_code, room_name, floor, area_sqm, created_at` and a unique index on `(project_id, room_code) WHERE room_code IS NOT NULL`; `rooms` RLS at 035:266-274 lets any project member read, insert and update - 096 keeps the member read policy and drops the two member write policies, because office roles author rooms (spec decision 2, §9 "Kelola ruangan"); `projects.code TEXT NOT NULL UNIQUE` at 001:49; `is_office_role()` is defined at 036:33-45; `rooms` is in 036's office-widening table list (so a `rooms_office_all` FOR ALL policy already exists wherever 035 landed); 050:85-98 is the "inline the helper defensively with CREATE OR REPLACE" pattern this migration copies. 035 is not a hard prerequisite: it may never have landed on the divergent remote (the reason 050 and 051 inline its helpers), so 096 creates `rooms` in 035's exact shape when absent, a no-op where 035 landed.

- [ ] **Step 2: Write the failing static guard test**

Create `tools/__tests__/migration096.test.ts`:

```ts
/**
 * Static guard for migration 096 (rooms, gate reference data, project phase).
 *
 * Like the 088/092/095 suites this touches no database: migrations are pasted
 * into the Supabase Dashboard, so the SQL text IS the artifact under test. Each
 * assertion protects a decision a later tidy-up could silently undo. Guards on
 * the SQL read CODE, the file with every full-line comment removed, so the
 * header or the self-check footer can never satisfy a guard the SQL fails.
 *
 *  • The room_code CHECK and the QR freeze trigger: a printed QR is a physical
 *    object naming /r/{projectCode}/{roomCode}. If the code or the project
 *    behind it can move, or its stamp can be cleared, the label lies, and the
 *    release-2 DATUM join on (project_code, room_code) breaks with it.
 *  • rooms is created in 035's exact shape when absent, BEFORE the first
 *    ALTER TABLE rooms: 035 may never have landed on the divergent remote, and
 *    an ALTER against a missing table aborts the paste.
 *  • Members read rooms; only office roles write them. The rooms policy set is
 *    pinned exactly, so a member write policy under ANY name fails, and 035's
 *    member INSERT and UPDATE policies must stay dropped: the freeze trigger
 *    alone does not stop a supervisor renaming, retiring or stamping a room.
 *  • The NOT VALID + conditional VALIDATE dance: 035-era rooms may hold codes
 *    that violate the new shape. A paste must REPORT them, not abort, because
 *    an abort rolls back the whole paste.
 *  • gate_refs / gate_step_refs have no policy that can DELETE (FOR ALL
 *    included) and a trigger that refuses DELETE, refuses to move `code`, and
 *    refuses to move a step to another gate: site_events.gate_code and
 *    (gate_code, step_code) are foreign keys, and a reused letter would
 *    silently re-label history.
 *  • ON CONFLICT DO NOTHING on the seed: a re-paste must never overwrite a
 *    label or description an office user edited.
 *  • Every CREATE POLICY and CREATE TRIGGER follows exactly one DROP ... IF
 *    EXISTS, and every constraint sits in a pg_constraint guard, or the second
 *    paste fails and rolls back.
 *  • The inlined helpers equal their latest definition in any other migration,
 *    and no later migration touches a rooms policy: CREATE OR REPLACE and
 *    DROP/CREATE POLICY mean a re-paste of 096 would revert such a change.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '096_rooms_gates_phase.sql'), 'utf8');
const CODE = SQL.replace(/^\s*--.*$/gm, ''); // comments can never satisfy a guard

const HELPERS = ['is_office_role()', 'is_project_member(p_project_id UUID)'];

/** `CREATE OR REPLACE FUNCTION <sig>` through its closing `$$;`, whitespace collapsed; null when absent. */
function fnText(src: string, sig: string): string | null {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${sig}`);
  if (start < 0) return null;
  return src.slice(start, src.indexOf('\n$$;', start) + 4).replace(/\s+/g, ' ');
}

/** This migration's own definition of a function, read from CODE. */
function fnBody(sig: string): string {
  const text = fnText(CODE, sig);
  if (!text) throw new Error(`${sig} not found in 096`);
  return text;
}

describe('migration 096 - header states why, paste order and re-paste safety', () => {
  it('links the spec and names its place in the paste order', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/096.*097.*098/s);
  });

  it('says out loud that it must be re-paste safe', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
  });
});

describe('migration 096 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
  });

  it('resets lock_timeout after every DDL statement, then shows the constraint outcome', () => {
    const resets = [...CODE.matchAll(/^RESET lock_timeout;$/gm)];
    expect(resets).toHaveLength(1);
    // Only the result query may follow RESET, so no DDL runs without the timeout,
    // and the grid shows the outcome even when the editor hides WARNINGs.
    expect(CODE.slice(resets[0].index!)).toMatch(
      /^RESET lock_timeout;\s+SELECT conname, convalidated FROM pg_constraint\s+WHERE conname IN \('rooms_room_code_shape','rooms_area_type_check','projects_phase_check','gate_step_refs_gate_code_code_key'\)\s+ORDER BY conname;\s*$/,
    );
  });
});

describe('migration 096 - a second paste cannot fail', () => {
  it('adds every constraint inside a pg_constraint guard for its own name', () => {
    const names = [...CODE.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    expect([...names].sort()).toEqual([
      'gate_step_refs_gate_code_code_key',
      'projects_phase_check',
      'rooms_area_type_check',
      'rooms_room_code_shape',
    ]);
    for (const name of names) {
      expect(CODE).toMatch(
        new RegExp(
          `IF NOT EXISTS \\(\\s*SELECT 1 FROM pg_constraint\\s+WHERE conname = '${name}' AND conrelid = 'public\\.(\\w+)'::regclass\\s*\\) THEN\\s+ALTER TABLE \\1\\s+ADD CONSTRAINT ${name}\\b`,
        ),
      );
    }
  });

  it('drops every policy exactly once, BEFORE its CREATE', () => {
    for (const c of CODE.matchAll(/^CREATE POLICY\s+(\w+)\s+ON\s+(\w+)/gm)) {
      const d = [...CODE.matchAll(new RegExp(`^DROP POLICY IF EXISTS ${c[1]}\\s+ON\\s+${c[2]};`, 'gm'))];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });

  it('drops every trigger exactly once, BEFORE its CREATE', () => {
    const creates = [...CODE.matchAll(/^CREATE TRIGGER\s+(\w+)\s+BEFORE\s[^;]*?\sON\s+(\w+)/gm)];
    expect(creates.map((c) => c[1]).sort()).toEqual([
      'gate_refs_immutable_trg',
      'gate_step_refs_immutable_trg',
      'rooms_freeze_code_trg',
    ]);
    for (const c of creates) {
      const d = [...CODE.matchAll(new RegExp(`^DROP TRIGGER IF EXISTS ${c[1]} ON ${c[2]};`, 'gm'))];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });
});

describe('migration 096 §1 - projects.phase', () => {
  it('adds phase and datum_project_code idempotently', () => {
    expect(CODE).toMatch(/ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS phase\s+TEXT NOT NULL DEFAULT 'STRUKTUR'/);
    expect(CODE).toMatch(/ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS datum_project_code\s+TEXT/);
  });

  it('constrains phase to the three values the renderer switches on', () => {
    expect(CODE).toMatch(/ADD CONSTRAINT projects_phase_check\s+CHECK \(phase IN \('STRUKTUR','FINISHING','SERAH_TERIMA'\)\)/);
  });
});

describe('migration 096 §2 - rooms', () => {
  it("creates rooms in 035's shape when absent, before the first ALTER", () => {
    expect(CODE).toContain('CREATE TABLE IF NOT EXISTS rooms (');
    expect(CODE).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_project_code');
    // An ALTER against a missing table would abort the paste on a remote that
    // never received 035, so the CREATE has to come first.
    const create = CODE.search(/^CREATE TABLE IF NOT EXISTS rooms \(/m);
    const firstAlter = CODE.search(/^ALTER TABLE rooms\b/m);
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(firstAlter);
  });

  it('adds every DATUM-shaped column idempotently', () => {
    for (const col of ['area_type', 'sort_order', 'datum_area_id', 'qr_printed_at', 'active', 'created_by']) {
      expect(CODE).toMatch(new RegExp(`ALTER TABLE rooms\\s+ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  it("constrains area_type to DATUM's nine values", () => {
    for (const t of ['bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general']) {
      expect(CODE).toContain(`'${t}'`);
    }
    expect(CODE).toMatch(/conname = 'rooms_area_type_check'/);
  });

  it('adds the room_code shape CHECK as NOT VALID', () => {
    expect(CODE).toMatch(/room_code ~ '\^\[A-Z0-9\]\+\(-\[A-Z0-9\]\+\)\*\$'/);
    expect(CODE).toMatch(/length\(room_code\) <= 40/);
    expect(CODE).toMatch(/ADD CONSTRAINT rooms_room_code_shape[\s\S]{0,200}NOT VALID/);
  });

  it('VALIDATE runs only in the clean branch, and the dirty branch warns', () => {
    expect([...CODE.matchAll(/^\s*ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;/gm)]).toHaveLength(1);
    expect(CODE).toMatch(/IF v_bad = 0 THEN\s*\n\s*ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;/);
    expect(CODE).toMatch(/\bELSE\s+RAISE WARNING\s+'096: rooms_room_code_shape left NOT VALID/);
  });

  it('pins both freeze conditions and the row trigger', () => {
    const body = fnBody('rooms_freeze_code()');
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.room_code IS DISTINCT FROM OLD\.room_code THEN\s+RAISE EXCEPTION\s+'ROOM_CODE_FROZEN:/);
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.qr_printed_at IS NULL THEN\s+RAISE EXCEPTION\s+'ROOM_CODE_FROZEN:/);
    expect(CODE).toMatch(/CREATE TRIGGER rooms_freeze_code_trg\s+BEFORE UPDATE ON rooms\s+FOR EACH ROW EXECUTE FUNCTION rooms_freeze_code\(\);/);
  });

  it('freezes project_id too, and lets the database own the stamp', () => {
    const body = fnBody('rooms_freeze_code()');
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.project_id IS DISTINCT FROM OLD\.project_id THEN RAISE EXCEPTION 'ROOM_CODE_FROZEN:/);
    expect(body).toMatch(/IF NEW\.qr_printed_at IS NOT NULL AND NEW\.qr_printed_at IS DISTINCT FROM OLD\.qr_printed_at THEN NEW\.qr_printed_at := now\(\); END IF; RETURN NEW; END; \$\$;$/);
    // The three refusals, then the stamp, then RETURN NEW.
    const at = [
      'NEW.room_code IS DISTINCT FROM OLD.room_code',
      'NEW.qr_printed_at IS NULL THEN',
      'NEW.project_id IS DISTINCT FROM OLD.project_id',
      'NEW.qr_printed_at := now()',
    ].map((s) => body.indexOf(s));
    expect(Math.min(...at)).toBeGreaterThan(-1);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('rooms has exactly two policies: member SELECT, office ALL', () => {
    expect(CODE).toMatch(/^ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;$/m);
    const p = [...CODE.matchAll(/^CREATE POLICY\s+"?(\w+)"?\s+ON\s+rooms\s+FOR\s+(\w+)\s+([^;]*);/gm)]
      .map((m) => `${m[1]}|${m[2]}|${m[3].replace(/\s+/g, ' ').trim()}`)
      .sort();
    expect(p).toEqual([
      'rooms_member_read|SELECT|USING (is_project_member(project_id))',
      'rooms_office_all|ALL|USING (is_office_role()) WITH CHECK (is_office_role())',
    ]);
  });

  it("keeps 035's member INSERT and UPDATE policies dropped", () => {
    expect(CODE).toMatch(/^DROP POLICY IF EXISTS rooms_member_insert ON rooms;$/m);
    expect(CODE).toMatch(/^DROP POLICY IF EXISTS rooms_member_update ON rooms;$/m);
    expect(CODE).not.toMatch(/CREATE\s+POLICY\s+"?rooms_member_(?:insert|update)\b/i);
  });
});

describe('migration 096 §3 - gate_refs', () => {
  it('creates the table idempotently with code as the primary key', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS gate_refs \(\s+code\s+TEXT PRIMARY KEY/);
    expect(CODE).toMatch(/datum_gate_code\s+TEXT/);
  });

  it('seeds all eight gates, each with an Indonesian description for the prompt', () => {
    const seed = CODE.slice(CODE.indexOf('INSERT INTO gate_refs'), CODE.indexOf('CREATE TABLE IF NOT EXISTS gate_step_refs'));
    for (const code of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(seed).toMatch(new RegExp(`\\('${code}',`));
    }
    expect(seed).toMatch(/'MEP Rough-in'/);
    expect(seed).toMatch(/'Pekerjaan Basah \/ Waterproofing'/);
    expect(seed).toMatch(/'Penyelesaian Akhir & Serah Terima'/);
    // Eight rows, eight descriptions - the model picks a gate on meaning, not
    // on a bare letter (spec §4.1).
    expect((seed.match(/Pemasangan|Plesteran|Rangka|Pengecatan|Kitchen set|Pembersihan/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('the seed INSERT itself ends ON CONFLICT (code) DO NOTHING', () => {
    expect(CODE).toMatch(/INSERT INTO gate_refs[\s\S]*?\)\s*\nON CONFLICT \(code\) DO NOTHING;/);
  });
});

describe('migration 096 §4 - gate_step_refs', () => {
  it('creates the table, referencing gate_refs, and ships it empty', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS gate_step_refs \(/);
    expect(CODE).toMatch(/gate_code\s+TEXT NOT NULL REFERENCES gate_refs\(code\)/);
    expect(CODE).not.toMatch(/INSERT INTO gate_step_refs/);
  });

  it("adds UNIQUE (gate_code, code) inside its guard, for 097's composite foreign key", () => {
    expect(CODE).toMatch(
      /WHERE conname = 'gate_step_refs_gate_code_code_key' AND conrelid = 'public\.gate_step_refs'::regclass\s*\) THEN\s+ALTER TABLE gate_step_refs\s+ADD CONSTRAINT gate_step_refs_gate_code_code_key UNIQUE \(gate_code, code\);\s+END IF;/,
    );
    expect(CODE.search(/ADD CONSTRAINT gate_step_refs_gate_code_code_key/)).toBeGreaterThan(
      CODE.search(/^CREATE TABLE IF NOT EXISTS gate_step_refs \(/m),
    );
  });
});

describe('migration 096 §5 - reference codes are immutable and undeletable', () => {
  const body = () => fnBody('gate_refs_immutable_code()');

  it('refuses DELETE outright', () => {
    expect(body()).toMatch(/IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GATE_REF_IMMUTABLE:/);
  });

  it('refuses to move code', () => {
    expect(body()).toMatch(/IF NEW\.code IS DISTINCT FROM OLD\.code THEN RAISE EXCEPTION 'GATE_REF_IMMUTABLE:/);
  });

  it('refuses to move a step to another gate, reading NEW.gate_code only on gate_step_refs', () => {
    const b = body();
    expect(b).toMatch(
      /IF TG_TABLE_NAME = 'gate_step_refs' THEN IF NEW\.gate_code IS DISTINCT FROM OLD\.gate_code THEN RAISE EXCEPTION 'GATE_REF_IMMUTABLE:[^;]*', OLD\.code, OLD\.gate_code, NEW\.gate_code; END IF; END IF;/,
    );
    // After the DELETE branch has closed (NEW is NULL there), before RETURN NEW,
    // and nowhere else: gate_refs has no gate_code column.
    const guard = b.indexOf("IF TG_TABLE_NAME = 'gate_step_refs' THEN");
    const deleteBranch = b.indexOf("IF TG_OP = 'DELETE' THEN");
    expect(deleteBranch).toBeGreaterThan(-1);
    expect(b.indexOf('END IF;', deleteBranch)).toBeLessThan(guard);
    expect(b.indexOf('NEW.gate_code')).toBeGreaterThan(guard);
    expect(guard).toBeLessThan(b.indexOf('RETURN NEW;'));
  });

  it('is attached to BOTH reference tables, once per row', () => {
    for (const t of ['gate_refs', 'gate_step_refs']) {
      expect(CODE).toMatch(
        new RegExp(`CREATE TRIGGER ${t}_immutable_trg\\s+BEFORE UPDATE OR DELETE ON ${t}\\s+FOR EACH ROW EXECUTE FUNCTION gate_refs_immutable_code\\(\\);`),
      );
    }
  });
});

describe('migration 096 §6 - RLS on the reference tables', () => {
  it('enables RLS on both', () => {
    expect(CODE).toMatch(/ALTER TABLE gate_refs\s+ENABLE ROW LEVEL SECURITY;/);
    expect(CODE).toMatch(/ALTER TABLE gate_step_refs\s+ENABLE ROW LEVEL SECURITY;/);
  });

  it('gives each exactly: authenticated read, office insert, office update', () => {
    for (const t of ['gate_refs', 'gate_step_refs']) {
      const p = [...CODE.matchAll(new RegExp(`^CREATE POLICY\\s+"?(\\w+)"?\\s+ON\\s+${t}\\s+([^;]*);`, 'gm'))]
        .map((m) => `${m[1]}|${m[2].replace(/\s+/g, ' ').trim()}`)
        .sort();
      expect(p).toEqual([
        `${t}_auth_read|FOR SELECT USING (auth.uid() IS NOT NULL)`,
        `${t}_office_insert|FOR INSERT WITH CHECK (is_office_role())`,
        `${t}_office_update|FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role())`,
      ]);
    }
  });

  it('no reference-table policy can DELETE, FOR ALL included', () => {
    expect(CODE).not.toMatch(/ON\s+gate_(?:step_)?refs\s+FOR\s+(?:DELETE|ALL)\b/);
  });

  it('writes every policy in the one shape these guards parse', () => {
    // A lower-case, FOR-less or indented CREATE POLICY would slip past the exact
    // sets above, and an omitted FOR means ALL, so no other spelling may appear.
    const spelled = CODE.match(/create\s+policy\b/gi) ?? [];
    const canonical = CODE.match(/^CREATE POLICY \w+\s+ON (?:rooms|gate_refs|gate_step_refs) FOR (?:SELECT|INSERT|UPDATE|ALL) /gm) ?? [];
    expect(canonical).toHaveLength(8);
    expect(spelled).toHaveLength(canonical.length);
    expect(CODE).not.toMatch(/\balter\s+policy\b|\bdisable\s+row\s+level\s+security\b/i);
  });
});

describe('migration 096 §7 - self-contained helpers', () => {
  it('inlines is_office_role and is_project_member the way 050/051 do', () => {
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION is_office_role\(\)/);
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION is_project_member\(p_project_id UUID\)/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION is_office_role\(\) TO authenticated;/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION is_project_member\(UUID\) TO authenticated;/);
  });

  it('keeps both inlined helpers SECURITY DEFINER with search_path pinned', () => {
    for (const sig of HELPERS) {
      expect(fnBody(sig)).toMatch(/\bSECURITY DEFINER\b/);
      expect(fnBody(sig)).toMatch(/\bSET search_path = public\b/);
    }
  });

  it('pins search_path on every function it defines', () => {
    const fns = CODE.match(/CREATE OR REPLACE FUNCTION [\s\S]*?\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(4);
    for (const fn of fns) expect(fn).toMatch(/SET search_path = public/);
  });

  it('inlined helpers equal their latest definition in any other migration', () => {
    const files = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith('096_'))
      .sort()
      .reverse();
    for (const sig of HELPERS) {
      const latest = files.map((f) => fnText(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'), sig)).find(Boolean);
      expect(fnText(CODE, sig)).toBe(latest);
    }
  });

  it('no later migration touches a rooms policy that re-pasting 096 would revert', () => {
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 96);
    const touching = later.filter((f) =>
      /\bPOLICY\s+"?\w+"?\s+ON\s+(?:public\.)?rooms\b/i.test(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')),
    );
    // If this fails, bring 096's rooms policies up to date in the same change,
    // then compare definitions here the way the helper test does.
    expect(touching).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest tools/__tests__/migration096.test.ts
```

Expected: `ENOENT: no such file or directory, open '.../supabase/migrations/096_rooms_gates_phase.sql'`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/096_rooms_gates_phase.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 096 - Rooms, gate reference data, and project phase.
--
-- Spec: docs/superpowers/specs/2026-09-10-room-site-events-design.md §4.1
-- Plan: docs/superpowers/plans/2026-09-10-room-spine-qr.md (task 3)
--
-- WHY. SANO records progress against BoQ rows and work groups, never against
-- "Kamar Mandi Utama, Lt. 2". Without a room there is no place a supervisor can
-- stand in, and so no continuous loop: a photo is filed, a defect is listed,
-- and nothing carries an owner or a due date tied to a location. This migration
-- lays the spatial spine - rooms in DATUM's shape, gates as DATA rather than
-- code, and a project phase the client-report renderer will later switch on.
--
-- PASTE ORDER. 096 first, then 097 (site_events) and finally 098 (daily-log
-- room link + the notification type swap) when those land. 096 seeds the gates
-- that 097's site_events.gate_code references, so it cannot go second.
--
-- RE-PASTE SAFETY. The remote migration history is divergent and
-- `supabase db push` is broken, so this file is pasted into the Supabase
-- Dashboard SQL editor by hand and must survive being pasted twice:
--   • ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS everywhere;
--   • every CHECK and UNIQUE constraint added inside a pg_constraint existence
--     guard;
--   • DROP POLICY IF EXISTS before every CREATE POLICY;
--   • DROP TRIGGER IF EXISTS before every CREATE TRIGGER;
--   • CREATE OR REPLACE for every function;
--   • the gate seed uses ON CONFLICT (code) DO NOTHING, so a re-paste can never
--     overwrite a label or description an office user has edited.
-- The editor runs the paste as one transaction, so a script error rolls the
-- whole paste back rather than half-applying it. lock_timeout (the first
-- statement) turns a paste stuck behind a long transaction into such an error.
-- What a re-paste CAN undo: pasted after a later migration that changes
-- is_office_role, is_project_member or the rooms policies, 096 reverts that
-- change (CREATE OR REPLACE and DROP/CREATE POLICY both win). The helper-
-- equality test in tools/__tests__/migration096.test.ts fails CI when a later
-- migration redefines either helper, and a sibling test fails when one touches
-- a rooms policy, so 096 is brought up to date in the same change.
--
-- THE TWO ROOM GUARDS.
--   1. room_code shape. Codes are produced client-side by normalizeRoomCode
--      (tools/roomCodes.ts), a verbatim port of DATUM's normalizeAreaCode, and
--      the CHECK here is the same rule in SQL. It is added NOT VALID and then
--      VALIDATEd only when no existing row violates it: where 035 landed, rooms
--      may already hold free-text codes. A paste against dirty data must REPORT
--      the offending rows, not abort: an abort rolls back the whole paste, and
--      nothing else in this file lands. The price of NOT VALID: while the CHECK
--      is NOT VALID, ANY update to a violating row fails - even a rename or a
--      deactivation - until its code is fixed or cleared in SQL.
--   2. QR freeze. Once qr_printed_at is stamped, the room is behind a printed
--      physical label, /r/{projectCode}/{roomCode} (spec §8); a trigger refuses
--      to move its code or its project, and refuses to clear the stamp. The
--      database owns the stamp: any new value becomes now(). Names, floor and
--      type stay editable. To fix a mistyped code before printing, deactivate
--      the room and create it again - the app offers no rename path either.
--
-- ROOMS DO NOT REQUIRE 035. 035 created rooms, but it may never have been
-- applied on the divergent remote (the reason 050 and 051 inline its helpers),
-- and no app code reads or writes rooms, so nothing proves the table exists
-- live. §2 therefore creates it in 035's exact shape when absent; where 035
-- landed that is a no-op.
--
-- WHO WRITES ROOMS. Office roles author rooms; supervisors scan and read (spec
-- decision 2, §9 "Kelola ruangan"). 035 also let every project member insert
-- and update rooms. This file drops those two policies without re-creating
-- them, so a member keeps SELECT only and office roles write through
-- rooms_office_all.
--
-- WHY THE GATES CANNOT BE DELETED. site_events.gate_code (migration 097) is a
-- foreign key to gate_refs(code), and (gate_code, step_code) a composite
-- foreign key to gate_step_refs(gate_code, code). A deleted-and-reused letter
-- would silently re-label a year of history. There is therefore NO delete
-- policy on either reference table, and a trigger refuses DELETE, refuses to
-- move `code`, and refuses to move a step to another gate. Retire a gate with
-- active = false.
--
-- WHAT THIS FILE DOES NOT DO. It creates no "Area Umum" room. A database
-- trigger would fire for every historical project and every test fixture; the
-- app creates it on first room setup, where a human can see it happen
-- (spec §4.1). It also does not widen projects UPDATE: the phase is writable by
-- whoever can already update a project - is_office_manager() on any project
-- (036:73-76), plus an admin, principal or estimator ASSIGNED to it through
-- projects_update_assigned (023:58-60, widened to estimators by 037). No
-- column-level guard restricts phase to managers.
-- ═══════════════════════════════════════════════════════════════════════════

-- A stalled transaction on projects makes this paste fail and roll back after 5 s instead of queueing app reads behind it; re-paste later.
SET lock_timeout = '5s';

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Helpers, inlined defensively (the 050:85-98 / 051:12-31 pattern)
--    Both already exist where 035 and 036 landed, and CREATE OR REPLACE with
--    the identical body is a no-op there. Together with the rooms table that
--    §2 creates when absent, this keeps the file independent of 035.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_office_role()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'principal', 'estimator')
  );
$$;
GRANT EXECUTE ON FUNCTION is_office_role() TO authenticated;

CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_assignments
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION is_project_member(UUID) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. projects - phase, and the reserved DATUM link key
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS phase              TEXT NOT NULL DEFAULT 'STRUKTUR';
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS datum_project_code TEXT;

COMMENT ON COLUMN projects.phase IS
  'STRUKTUR | FINISHING | SERAH_TERIMA. Drives the client-report renderer '
  'switch (spec §10.2). Every existing project defaults to STRUKTUR, so the '
  'current report output is unchanged.';
COMMENT ON COLUMN projects.datum_project_code IS
  'Reserved for the release-2 DATUM link. projects.code (001:49, unique) stays '
  'the SANO-side join key.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_phase_check' AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_phase_check
      CHECK (phase IN ('STRUKTUR','FINISHING','SERAH_TERIMA'));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. rooms - the 035 table, created here if absent, extended into DATUM's
--    area shape
-- ───────────────────────────────────────────────────────────────────────────

-- 035's definition verbatim (035:40-52). Where 035 landed, all three statements
-- are no-ops; on a remote that never received 035 they create the table the
-- ALTERs below extend, instead of letting the first ALTER abort the paste.
CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_code   TEXT,
  room_name   TEXT NOT NULL,
  floor       TEXT,
  area_sqm    NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_project_code
  ON rooms(project_id, room_code) WHERE room_code IS NOT NULL;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS area_type     TEXT NOT NULL DEFAULT 'general';
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS sort_order    INT NOT NULL DEFAULT 0;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS datum_area_id UUID;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS qr_printed_at TIMESTAMPTZ;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS active        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS created_by    UUID REFERENCES profiles(id);

COMMENT ON COLUMN rooms.area_type IS
  'DATUM area_type, nine values (packages/core/src/areas/mutations.ts:7-16).';
COMMENT ON COLUMN rooms.qr_printed_at IS
  'Stamped when a label sheet including this room is printed; the database sets '
  'it to now(). Freezes room_code and project_id, and cannot be cleared.';
COMMENT ON COLUMN rooms.datum_area_id IS
  'Set only by a release-2 sync. NULL in release 1.';

CREATE INDEX IF NOT EXISTS idx_rooms_project_active
  ON rooms(project_id, active);
CREATE INDEX IF NOT EXISTS idx_rooms_project_floor_sort
  ON rooms(project_id, floor, sort_order);

-- area_type over DATUM's nine values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_area_type_check' AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_area_type_check
      CHECK (area_type IN (
        'bathroom','kitchen','bedroom','living','dining',
        'garden','circulation','utility','general'
      ));
  END IF;
END $$;

-- room_code shape. Added NOT VALID, then validated only when the table is
-- already clean, so a re-paste against legacy 035-era codes reports the
-- violation instead of failing the whole script.
DO $$
DECLARE
  v_bad INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_room_code_shape' AND conrelid = 'public.rooms'::regclass
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_room_code_shape
      CHECK (
        room_code IS NULL
        OR (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40)
      )
      NOT VALID;
  END IF;

  SELECT count(*) INTO v_bad
  FROM rooms
  WHERE room_code IS NOT NULL
    AND NOT (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40);

  IF v_bad = 0 THEN
    ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;
    RAISE NOTICE '096: rooms_room_code_shape VALIDATED (no existing violations).';
  ELSE
    RAISE WARNING
      '096: rooms_room_code_shape left NOT VALID - % existing row(s) violate it. '
      'Until each code is fixed or cleared, ANY other update to that row fails, even a rename or deactivation. '
      'List them with: SELECT id, project_id, room_code FROM rooms WHERE room_code IS NOT NULL '
      'AND NOT (room_code ~ ''^[A-Z0-9]+(-[A-Z0-9]+)*$'' AND length(room_code) <= 40); '
      'Fix or clear those codes in SQL, then run: ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;',
      v_bad;
  END IF;
END $$;

-- A printed label is a physical object: the code and project behind it cannot move.
CREATE OR REPLACE FUNCTION rooms_freeze_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF OLD.qr_printed_at IS NOT NULL AND NEW.room_code IS DISTINCT FROM OLD.room_code THEN
    RAISE EXCEPTION
      'ROOM_CODE_FROZEN: kode ruangan "%" sudah tercetak pada label QR (%). '
      'Nama, lantai dan tipe boleh diubah; kode tidak. Nonaktifkan ruangan ini '
      'dan buat ruangan baru bila kodenya salah.',
      OLD.room_code, OLD.qr_printed_at;
  END IF;
  -- Clearing the stamp would reopen the code to a second UPDATE. A reprint may
  -- move the stamp forward (to now(), below); nothing may remove it.
  IF OLD.qr_printed_at IS NOT NULL AND NEW.qr_printed_at IS NULL THEN
    RAISE EXCEPTION
      'ROOM_CODE_FROZEN: tanda cetak label QR ruangan "%" tidak boleh dihapus. '
      'Kode ruangan tetap terkunci setelah labelnya dicetak.',
      OLD.room_code;
  END IF;
  -- The label is /r/{projectCode}/{roomCode}: a printed room cannot change
  -- project any more than it can change code.
  IF OLD.qr_printed_at IS NOT NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'ROOM_CODE_FROZEN: ruangan "%" sudah tercetak; labelnya menunjuk ke proyek ini.', OLD.room_code;
  END IF;
  -- The database owns the stamp, so a client clock never lands: any new stamp,
  -- first print or reprint, records the time of this UPDATE.
  IF NEW.qr_printed_at IS NOT NULL AND NEW.qr_printed_at IS DISTINCT FROM OLD.qr_printed_at THEN
    NEW.qr_printed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rooms_freeze_code_trg ON rooms;
CREATE TRIGGER rooms_freeze_code_trg
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION rooms_freeze_code();

-- RLS. Members read, office roles write (header, WHO WRITES ROOMS). The member
-- read policy (035:267-268) and the office FOR ALL policy (036's table loop)
-- are re-asserted with identical definitions, a no-op where they exist. 035's
-- rooms_office_delete is left as it is; rooms_office_all already covers DELETE.
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rooms_member_read   ON rooms;
CREATE POLICY rooms_member_read   ON rooms FOR SELECT USING (is_project_member(project_id));

-- No member writes. Office roles author rooms, and the freeze trigger alone does
-- not stop a member from renaming, retiring or stamping a room.
DROP POLICY IF EXISTS rooms_member_insert ON rooms;
DROP POLICY IF EXISTS rooms_member_update ON rooms;

DROP POLICY IF EXISTS rooms_office_all   ON rooms;
CREATE POLICY rooms_office_all   ON rooms FOR ALL USING (is_office_role()) WITH CHECK (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- 3. gate_refs - the finishing gates, as DATA
--    Mirrors DATUM's gate_code enum A..H. Labels, descriptions, order and the
--    active flag are editable from "Kelola gerbang"; the code never is.
--    The description is fed to the analysis prompt in release 2 so the model
--    picks a gate on meaning rather than on a bare letter.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gate_refs (
  code            TEXT PRIMARY KEY,
  name_id         TEXT NOT NULL,
  short_label     TEXT NOT NULL,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  datum_gate_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO gate_refs (code, name_id, short_label, description, sort_order) VALUES
  ('A', 'MEP Rough-in', 'MEP Rough-in',
   'Pemasangan jalur listrik, air bersih, air kotor dan pipa AC di dalam dinding atau plafon sebelum ditutup.', 10),
  ('B', 'Pekerjaan Basah / Waterproofing', 'Basah',
   'Plesteran, acian, screed dan waterproofing - pekerjaan yang masih basah dan butuh waktu kering sebelum dilanjutkan.', 20),
  ('C', 'Plafon', 'Plafon',
   'Rangka dan penutup plafon, termasuk drop ceiling, shaft dan lubang perawatan.', 30),
  ('D', 'Finishing Lantai / Dinding / Kusen', 'Finishing',
   'Pemasangan keramik, granit, parket, pelapis dinding, kusen pintu dan jendela.', 40),
  ('E', 'Finishing Permukaan & Ironwork', 'Permukaan',
   'Pengecatan, coating, railing dan pekerjaan besi atau stainless yang menempel pada permukaan jadi.', 50),
  ('F', 'Furniture Built-in', 'Furniture',
   'Kitchen set, lemari tanam, meja built-in dan perabot lain yang dipasang permanen di ruangan.', 60),
  ('G', 'MEP Fit-out', 'Fit-out',
   'Pemasangan armatur lampu, saklar, stop kontak, sanitair, unit AC dan perangkat MEP yang terlihat.', 70),
  ('H', 'Penyelesaian Akhir & Serah Terima', 'Serah Terima',
   'Pembersihan akhir, perbaikan cacat sisa, uji fungsi dan serah terima ruangan kepada pemilik.', 80)
ON CONFLICT (code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. gate_step_refs - the optional level below a gate. Ships EMPTY: steps are
--    detail, and site_events.step_code (097) is nullable, so a pilot that never
--    fills this table still works. Free-text code, e.g. 'B4'.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gate_step_refs (
  code            TEXT PRIMARY KEY,
  gate_code       TEXT NOT NULL REFERENCES gate_refs(code),
  name_id         TEXT NOT NULL,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  datum_step_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_step_refs_gate
  ON gate_step_refs(gate_code, sort_order);

-- Migration 097 references (gate_code, code) from site_events, so an event
-- cannot carry a step from a different gate. A foreign key needs a unique
-- constraint on exactly its columns; code alone is already the primary key, so
-- this never refuses a row the table would otherwise accept.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gate_step_refs_gate_code_code_key' AND conrelid = 'public.gate_step_refs'::regclass
  ) THEN
    ALTER TABLE gate_step_refs
      ADD CONSTRAINT gate_step_refs_gate_code_code_key UNIQUE (gate_code, code);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Reference codes are immutable and undeletable
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gate_refs_immutable_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'GATE_REF_IMMUTABLE: baris % tidak boleh dihapus - kodenya dipakai sebagai '
      'referensi oleh kejadian lapangan. Nonaktifkan dengan active = false.',
      TG_TABLE_NAME;
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION
      'GATE_REF_IMMUTABLE: kode "%" tidak boleh diubah menjadi "%" - kode adalah '
      'kunci referensi kejadian lapangan. Ubah nama atau labelnya saja.',
      OLD.code, NEW.code;
  END IF;

  -- A step's gate is as fixed as its code: 097 files events under the pair.
  -- Nested, so the gate_refs trigger never evaluates NEW.gate_code, a column
  -- gate_refs does not have.
  IF TG_TABLE_NAME = 'gate_step_refs' THEN
    IF NEW.gate_code IS DISTINCT FROM OLD.gate_code THEN
      RAISE EXCEPTION 'GATE_REF_IMMUTABLE: langkah "%" tidak boleh dipindah dari gerbang % ke %.', OLD.code, OLD.gate_code, NEW.gate_code;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gate_refs_immutable_trg ON gate_refs;
CREATE TRIGGER gate_refs_immutable_trg
  BEFORE UPDATE OR DELETE ON gate_refs
  FOR EACH ROW EXECUTE FUNCTION gate_refs_immutable_code();

DROP TRIGGER IF EXISTS gate_step_refs_immutable_trg ON gate_step_refs;
CREATE TRIGGER gate_step_refs_immutable_trg
  BEFORE UPDATE OR DELETE ON gate_step_refs
  FOR EACH ROW EXECUTE FUNCTION gate_refs_immutable_code();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. RLS on the reference tables - everyone reads, office roles write.
--    No DELETE policy on either table, deliberately (see the header).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE gate_refs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_step_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gate_refs_auth_read     ON gate_refs;
CREATE POLICY gate_refs_auth_read     ON gate_refs FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS gate_refs_office_insert ON gate_refs;
CREATE POLICY gate_refs_office_insert ON gate_refs FOR INSERT WITH CHECK (is_office_role());
DROP POLICY IF EXISTS gate_refs_office_update ON gate_refs;
CREATE POLICY gate_refs_office_update ON gate_refs FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role());

DROP POLICY IF EXISTS gate_step_refs_auth_read     ON gate_step_refs;
CREATE POLICY gate_step_refs_auth_read     ON gate_step_refs FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS gate_step_refs_office_insert ON gate_step_refs;
CREATE POLICY gate_step_refs_office_insert ON gate_step_refs FOR INSERT WITH CHECK (is_office_role());
DROP POLICY IF EXISTS gate_step_refs_office_update ON gate_step_refs;
CREATE POLICY gate_step_refs_office_update ON gate_step_refs FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role());

-- ───────────────────────────────────────────────────────────────────────────
-- Close-out: every DDL statement is above this line
-- ───────────────────────────────────────────────────────────────────────────

-- Hand a reused editor connection back with its default lock timeout.
RESET lock_timeout;

-- The result grid the editor shows for this paste. The editor can hide the §2
-- WARNING, so read the outcome here: convalidated = false on
-- rooms_room_code_shape means legacy codes violate the shape (self-check 4).
SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('rooms_room_code_shape','rooms_area_type_check','projects_phase_check','gate_step_refs_gate_code_code_key')
ORDER BY conname;

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-CHECK (run after pasting; copy each query without its leading --).
-- Steps 1-8 change nothing (7 and 8 are meant to abort). Step 9 edits a gate
-- label, step 10 creates a throwaway room and deletes it again, and step 11
-- re-pastes the file and restores the label.
--
-- 1. Columns landed:
--      SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_name = 'rooms' AND column_name IN
--        ('area_type','sort_order','datum_area_id','qr_printed_at','active','created_by');
--    EXPECTED: six rows.
--
-- 2. Rooms policies - members read, office roles write:
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'rooms' ORDER BY 1;
--    EXPECTED: rooms_member_read (SELECT) and rooms_office_all (ALL), plus
--    rooms_office_delete (DELETE) where 035 landed. No member insert or update
--    policy.
--
-- 3. Phase defaulted for every existing project:
--      SELECT phase, count(*) FROM projects GROUP BY 1;
--    EXPECTED: one row, STRUKTUR, = the project count.
--
-- 4. The constraints are VALID, not merely present. The paste's own result grid
--    is this query:
--      SELECT conname, convalidated FROM pg_constraint
--      WHERE conname IN ('rooms_room_code_shape','rooms_area_type_check',
--                        'projects_phase_check','gate_step_refs_gate_code_code_key')
--      ORDER BY conname;
--    EXPECTED: four rows, convalidated = true. A false on rooms_room_code_shape
--    means the §2 WARNING fired. Until it is fixed, ANY update to a violating
--    room fails, even a rename or a deactivation. List those rooms with:
--      SELECT id, project_id, room_code FROM rooms WHERE room_code IS NOT NULL
--      AND NOT (room_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(room_code) <= 40);
--    fix or clear their codes in SQL, then run:
--      ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;
--
-- 5. Gates seeded:
--      SELECT code, short_label, active FROM gate_refs ORDER BY sort_order;
--    EXPECTED: eight rows, A..H, all active.
--
-- 6. Step table exists and is empty:
--      SELECT count(*) FROM gate_step_refs;
--    EXPECTED: 0.
--
-- 7. A code cannot be deleted:
--      DELETE FROM gate_refs WHERE code = 'H';
--    EXPECTED: ERROR  GATE_REF_IMMUTABLE: ...  (run it; it is safe, it aborts.)
--
-- 8. A code cannot be moved:
--      UPDATE gate_refs SET code = 'Z' WHERE code = 'H';
--    EXPECTED: ERROR  GATE_REF_IMMUTABLE: ...
--
-- 9. A label CAN be edited (use a value that differs from the seed, so step 11
--    can tell an edit that survived from a seed that overwrote it):
--      UPDATE gate_refs SET short_label = 'Serah Terima (uji)' WHERE code = 'H';
--    EXPECTED: UPDATE 1.
--
-- 10. The QR freeze, end to end. Run this block as one query: it creates a
--     throwaway room on the first project, proves the freeze, and deletes the
--     room; on any failure the error names the check and the block rolls back.
--      DO $$
--      DECLARE v_id UUID; v_project UUID; v_other UUID;
--      BEGIN
--        INSERT INTO rooms (project_id, room_code, room_name)
--        SELECT id, 'SELFCHECK-096', 'Self-check 096' FROM projects LIMIT 1
--        RETURNING id, project_id INTO v_id, v_project;
--        IF v_id IS NULL THEN RAISE EXCEPTION 'SELF-CHECK: tidak ada proyek'; END IF;
--        UPDATE rooms SET room_code = 'SELFCHECK-096-B' WHERE id = v_id;
--        UPDATE rooms SET qr_printed_at = now() WHERE id = v_id;
--        BEGIN
--          UPDATE rooms SET room_code = 'LAIN' WHERE id = v_id;
--          RAISE EXCEPTION 'SELF-CHECK GAGAL: kode berubah setelah dicetak';
--        EXCEPTION WHEN raise_exception THEN
--          IF SQLERRM NOT LIKE 'ROOM_CODE_FROZEN:%' THEN RAISE; END IF;
--        END;
--        BEGIN
--          UPDATE rooms SET qr_printed_at = NULL WHERE id = v_id;
--          RAISE EXCEPTION 'SELF-CHECK GAGAL: tanda cetak bisa dihapus';
--        EXCEPTION WHEN raise_exception THEN
--          IF SQLERRM NOT LIKE 'ROOM_CODE_FROZEN:%' THEN RAISE; END IF;
--        END;
--        -- Moving a printed room needs a second project to move it to. With
--        -- only one project this sub-check is skipped, and a NOTICE says so.
--        SELECT id INTO v_other FROM projects WHERE id <> v_project LIMIT 1;
--        IF v_other IS NULL THEN
--          RAISE NOTICE 'SELF-CHECK: hanya satu proyek, cek pindah proyek dilewati';
--        ELSE
--          BEGIN
--            UPDATE rooms SET project_id = v_other WHERE id = v_id;
--            RAISE EXCEPTION 'SELF-CHECK GAGAL: ruangan tercetak bisa pindah proyek';
--          EXCEPTION WHEN raise_exception THEN
--            IF SQLERRM NOT LIKE 'ROOM_CODE_FROZEN:%' THEN RAISE; END IF;
--          END;
--        END IF;
--        UPDATE rooms SET room_name = 'Nama Baru' WHERE id = v_id;
--        DELETE FROM rooms WHERE id = v_id;
--      END $$;
--    EXPECTED: DO, with no ERROR. An ERROR starting SELF-CHECK names the guard
--    that is missing, and the throwaway room is gone either way.
--
-- 11. Re-paste this whole file.
--    EXPECTED: no error, and the step-9 edit survived:
--      SELECT short_label FROM gate_refs WHERE code = 'H';
--    EXPECTED: 'Serah Terima (uji)'. Then restore the seed label:
--      UPDATE gate_refs SET short_label = 'Serah Terima' WHERE code = 'H';
-- ═══════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest tools/__tests__/migration096.test.ts
```

Expected: all describe blocks green, `Tests: 36 passed, 36 total`. If `§7 pins search_path` fails, one of the four functions is missing `SET search_path = public` - add it rather than relaxing the assertion; an unpinned `SECURITY DEFINER` function is a search-path hijack.

- [ ] **Step 6: Paste the migration in the Supabase Dashboard**

This is a **user-run step**, not an agent step. Hand the user the file and the self-check list:

1. Open the Supabase Dashboard SQL editor for project `ufntlqvacjhmddwltcxf`.
2. Paste the whole of `supabase/migrations/096_rooms_gates_phase.sql` and run it.
3. Read the result grid the paste ends on: four constraints with `convalidated`. The editor can hide the NOTICE / WARNING output, so the grid is the record. `convalidated = false` on `rooms_room_code_shape` means legacy rooms hold codes the new shape refuses, and while it stays NOT VALID, ANY update to those rooms fails, even a rename or a deactivation - run the SELECT from self-check 4, fix or clear those codes in SQL, then run the `VALIDATE CONSTRAINT` line by hand. An ERROR instead of a grid means nothing landed: the editor runs the paste as one transaction and rolled all of it back. `canceling statement due to lock timeout` means a long transaction held a table for 5 s; paste again later.
4. Run self-checks 1 to 11 from the file footer. Self-check 2 must show no member insert or update policy on `rooms`. Self-check 10 is one `DO` block: it creates a throwaway room on the first project, proves the QR freeze (code, stamp, and project when a second project exists), and deletes the room. It must finish without an ERROR.

Nothing later in this plan reads `gate_refs` successfully until this paste lands, so do it before task 6.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/096_rooms_gates_phase.sql tools/__tests__/migration096.test.ts
git commit -m "$(cat <<'MSG'
feat(db): 096 - rooms in DATUM shape, gate reference data, project phase

rooms gains area_type/sort_order/qr_printed_at/active/datum_area_id, a
room_code shape CHECK added NOT VALID and validated only when the table is
clean, and a trigger that, once a QR label has been printed, freezes the code
and the project, refuses to clear the stamp, and sets the stamp to now().
rooms is created in 035's exact shape when absent, since 035 may never have
landed on the divergent remote. Members keep SELECT only: 035's member INSERT
and UPDATE policies are dropped, because office roles author rooms.
gate_refs seeds A..H with Indonesian descriptions the release-2 prompt will
read; gate_step_refs ships empty, with UNIQUE (gate_code, code) for 097's
composite foreign key. Both reference tables refuse DELETE and refuse to move
`code`, and a step cannot move to another gate, because site_events will point
at them by foreign key and a reused letter would silently re-label history.

Static guards in tools/__tests__/migration096.test.ts, in the 092 style - the
SQL text is the artifact, since the remote history is divergent and this file
is pasted into the Dashboard by hand.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Types and constants

**Files:** modify `tools/types.ts`, `tools/constants.ts`.

No test of its own: every later task's suite fails to compile if these are wrong.

- [ ] **Step 1: Add the room and gate types to `tools/types.ts`**

Insert after the `ProjectAssignment` interface (currently ends at `tools/types.ts:46`, immediately before the `// ─── Baseline & Planning ───` banner):

```ts
// ─── Spatial spine: rooms, gates, phase ───────────────────────────────

/** Drives the client-report renderer switch (spec §10.2). */
export type ProjectPhase = 'STRUKTUR' | 'FINISHING' | 'SERAH_TERIMA';

/**
 * DATUM's nine area types, verbatim
 * (DATUM packages/core/src/areas/mutations.ts:7-16). Do not add a tenth
 * without adding it in DATUM first - the release-2 link upserts on this value.
 */
export type AreaType =
  | 'bathroom' | 'kitchen' | 'bedroom' | 'living' | 'dining'
  | 'garden' | 'circulation' | 'utility' | 'general';

export interface Room {
  id: string;
  project_id: string;
  room_code: string;
  room_name: string;
  floor: string | null;
  area_sqm: number | null;
  area_type: AreaType;
  sort_order: number;
  datum_area_id: string | null;
  /** Stamped by markRoomsPrinted. Non-null means room_code is frozen (096). */
  qr_printed_at: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface GateRef {
  code: string;
  name_id: string;
  short_label: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  datum_gate_code: string | null;
}

export interface GateStepRef {
  code: string;
  gate_code: string;
  name_id: string;
  description: string | null;
  sort_order: number;
  active: boolean;
  datum_step_code: string | null;
}
```

Then extend `Project` (`tools/types.ts:30-40`) with the two new columns:

```ts
export interface Project {
  id: string;
  code: string;
  name: string;
  location: string | null;
  client_name: string | null;
  contract_value: number | null;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatusType;
  /** 096. Defaults to STRUKTUR for every pre-existing project. */
  phase: ProjectPhase;
  /** 096. Reserved for the release-2 DATUM link; NULL in release 1. */
  datum_project_code: string | null;
}
```

`phase` is required, not optional: the value is `NOT NULL DEFAULT 'STRUKTUR'` in the database and `useProject` selects `*`, so every `Project` the app holds really does carry it. Nothing in the repo constructs a `Project` object literal (checked: no `: Project =` and no `as Project` outside `ProjectMaterialMasterLine`), so no call site breaks.

- [ ] **Step 2: Add the label tables to `tools/constants.ts`**

Append at the end of `tools/constants.ts` (after `DefectStatus`, currently the file ends at line 206):

```ts
// ── Project phase (096) ─────────────────────────────────────────────────────
// Type-only import: erased at compile time, so this does not create a runtime
// cycle with tools/types.ts (which type-imports from here).
import type { AreaType, ProjectPhase } from './types';

export const PROJECT_PHASES: ReadonlyArray<{ value: ProjectPhase; label: string }> = [
  { value: 'STRUKTUR',     label: 'Struktur' },
  { value: 'FINISHING',    label: 'Finishing' },
  { value: 'SERAH_TERIMA', label: 'Serah Terima' },
];

export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  STRUKTUR:     'Struktur',
  FINISHING:    'Finishing',
  SERAH_TERIMA: 'Serah Terima',
};

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

/**
 * Every project gets one catch-all room with this code, created by the app on
 * first room setup (spec §4.1 - deliberately not a database trigger). The
 * Finishing-phase report buckets room-less highlights into it, and it sorts last.
 */
export const AREA_UMUM_CODE = 'UMUM';
export const AREA_UMUM_NAME = 'Area Umum';
```

Move the `import type` line to the top of the file with the other imports if the repo's lint prefers it; the placement above is only to show what to add.

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
```

Expected: the one known pre-existing `workflows/App.tsx` error documented in `.github/workflows/ci.yml:50-54`, and nothing new.

```bash
git add tools/types.ts tools/constants.ts
git commit -m "$(cat <<'MSG'
feat(types): Room, GateRef, GateStepRef, ProjectPhase, AreaType

Project gains the two 096 columns. AreaType is DATUM's nine values verbatim:
the release-2 link upserts on it, so a tenth value has to exist in DATUM first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `tools/rooms.ts` - room access plus two pure helpers

**Files:**
- Create: `tools/rooms.ts`
- Test: `tools/__tests__/rooms.test.ts`

`parseRoomPaste` and `roomsToDatumAreas` are pure, but the test still has to `jest.mock('../supabase', ...)`. Verified: `tools/supabase.ts:1` imports `react-native-url-polyfill/auto`, which is untransformed ESM and is **not** in the repo's `transformIgnorePatterns` allowlist (`package.json:80-82`), so any suite that reaches it dies with `SyntaxError: Cannot use import statement outside a module`. Every suite in this plan that imports a module touching `./supabase` - `rooms`, `gateRefs`, `roomLabelsHtml` - carries the same mock. `roomCodes`, `roomLinks` and `linking` do not need it.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/rooms.test.ts`:

```ts
/**
 * Only the pure halves are covered here. The Supabase halves are thin
 * single-statement wrappers whose real failure modes are RLS and constraint
 * violations - neither reproducible under jest, both covered by the migration
 * self-checks in 096 and by the manual pilot pass in spec §14.
 *
 * parseRoomPaste is the one place a human hands the system a list, so its
 * refusals matter: a room silently dropped from an import is a room with no
 * label, and a duplicate code is a second physical sticker pointing at the
 * first room's history.
 */
// tools/supabase.ts pulls in untransformed ESM (react-native-url-polyfill),
// which jest cannot load. The pure helpers never touch the client, but the
// module-level import still has to be stubbed.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { parseRoomPaste, roomsToDatumAreas } from '../rooms';
import type { Room } from '../types';

const room = (over: Partial<Room>): Room => ({
  id: 'r1', project_id: 'p1', room_code: 'UMUM', room_name: 'Area Umum',
  floor: null, area_sqm: null, area_type: 'general', sort_order: 0,
  datum_area_id: null, qr_printed_at: null, active: true, created_by: null,
  created_at: '2026-09-10T00:00:00Z', ...over,
});

describe('parseRoomPaste', () => {
  it('accepts pipe, tab and semicolon as the column separator', () => {
    const a = parseRoomPaste('Lt. 2 | Kamar Mandi Utama');
    const b = parseRoomPaste('Lt. 2\tKamar Mandi Utama');
    const c = parseRoomPaste('Lt. 2 ; Kamar Mandi Utama');
    for (const r of [a, b, c]) {
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({
        floor: 'Lt. 2', room_name: 'Kamar Mandi Utama',
        room_code: 'LT-2-KAMAR-MANDI-UTAMA', area_type: 'general',
      });
    }
  });

  it('derives the code from floor + name, in that order', () => {
    const { rows } = parseRoomPaste('Lt. 1 | Dapur');
    expect(rows[0].room_code).toBe('LT-1-DAPUR');
  });

  it('reads a third column as the area type, in Indonesian or English', () => {
    const { rows } = parseRoomPaste('Lt. 2 | Kamar Mandi Utama | Kamar mandi\nLt. 1 | Dapur | kitchen');
    expect(rows[0].area_type).toBe('bathroom');
    expect(rows[1].area_type).toBe('kitchen');
  });

  it('falls back to general and warns on an unknown area type', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 2 | Musholla | Surau');
    expect(rows[0].area_type).toBe('general');
    expect(warnings.join(' ')).toMatch(/Baris 1.*Surau.*Umum/);
  });

  it('skips blank lines without warning about them', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 1 | Dapur\n\n   \nLt. 2 | Kamar Tidur');
    expect(rows).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it('accepts a name-only line (no floor)', () => {
    const { rows } = parseRoomPaste('Dapur');
    expect(rows[0]).toMatchObject({ floor: '', room_name: 'Dapur', room_code: 'DAPUR' });
  });

  it('drops a duplicate code and names both line numbers', () => {
    const { rows, warnings } = parseRoomPaste('Lt. 1 | Dapur\nLt. 1 | dapur');
    expect(rows).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/Baris 2.*LT-1-DAPUR.*baris 1/i);
  });

  it('drops a line whose code does not survive normalization', () => {
    const { rows, warnings } = parseRoomPaste('!!! | ???');
    expect(rows).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/Baris 1/);
  });

  it('drops a line whose 40-character slice left an invalid code', () => {
    const { rows, warnings } = parseRoomPaste('RUANG TAMU UTAMA | LANTAI DUA SAYAP BARAT DEPAN');
    expect(rows).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/40/);
  });

  it('numbers rows from 0 in sort_order, in paste order', () => {
    const { rows } = parseRoomPaste('Lt. 1 | Dapur\nLt. 1 | Ruang Makan');
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
  });

  it('returns nothing for empty input', () => {
    expect(parseRoomPaste('').rows).toHaveLength(0);
    expect(parseRoomPaste('   \n  ').rows).toHaveLength(0);
  });
});

describe('roomsToDatumAreas', () => {
  it('emits DATUM area shape and nothing else', () => {
    const out = roomsToDatumAreas([
      room({ room_code: 'LT-2-KM', room_name: 'Kamar Mandi', floor: 'Lt. 2', area_type: 'bathroom', sort_order: 3 }),
    ]);
    expect(out).toEqual([
      { area_code: 'LT-2-KM', area_name: 'Kamar Mandi', floor: 'Lt. 2', area_type: 'bathroom', sort_order: 3 },
    ]);
  });

  it('sends an empty string rather than null for a missing floor', () => {
    expect(roomsToDatumAreas([room({ floor: null })])[0].floor).toBe('');
  });

  it('exports inactive rooms too - DATUM decides, not SANO', () => {
    expect(roomsToDatumAreas([room({ active: false })])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tools/__tests__/rooms.test.ts
```

Expected: `Cannot find module '../rooms'`.

- [ ] **Step 3: Write the module**

Create `tools/rooms.ts`:

```ts
// SANO - Rooms.
//
// Rooms are the spatial spine: from release 2 every site event is anchored to
// one. They are authored HERE but shaped like DATUM areas (room_code from
// normalizeRoomCode, area_type over DATUM's nine values) so that the release-2
// link is an upsert on (project_code, room_code) rather than a migration
// (spec §2 decision 2).
//
// There is deliberately no renameRoomCode. Before printing, a wrong code is
// fixed by deactivating the room and creating it again; after printing, the
// database refuses outright (096 rooms_freeze_code) because the code is behind
// a physical sticker.

import { supabase } from './supabase';
import { normalizeRoomCode, isValidRoomCode, ROOM_CODE_MAX } from './roomCodes';
import { AREA_TYPES, AREA_UMUM_CODE, AREA_UMUM_NAME } from './constants';
import type { AreaType, Room } from './types';

const ROOM_COLUMNS =
  'id, project_id, room_code, room_name, floor, area_sqm, area_type, sort_order, ' +
  'datum_area_id, qr_printed_at, active, created_by, created_at';

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listRooms(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Room[]> {
  let q = supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('project_id', projectId)
    .order('floor', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true })
    .order('room_name', { ascending: true });

  if (!opts.includeInactive) q = q.eq('active', true);

  const { data, error } = await q;
  if (error) {
    console.warn('listRooms failed:', error.message);
    return [];
  }
  return (data ?? []) as Room[];
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface NewRoomInput {
  project_id: string;
  room_name: string;
  floor: string;
  area_type: AreaType;
  sort_order?: number;
  area_sqm?: number | null;
  created_by?: string | null;
  /** Optional explicit code; otherwise derived from floor + name. */
  room_code?: string;
}

export async function createRoom(input: NewRoomInput): Promise<{ room?: Room; error?: string }> {
  const name = input.room_name.trim();
  if (!name) return { error: 'Nama ruangan wajib diisi.' };

  const code = normalizeRoomCode(input.room_code ?? `${input.floor} ${name}`);
  if (!isValidRoomCode(code)) {
    return {
      error: `Kode ruangan "${code}" tidak valid (maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung). Persingkat nama atau lantainya.`,
    };
  }

  const { data, error } = await supabase
    .from('rooms')
    .insert({
      project_id: input.project_id,
      room_code:  code,
      room_name:  name,
      floor:      input.floor.trim() || null,
      area_type:  input.area_type,
      sort_order: input.sort_order ?? 0,
      area_sqm:   input.area_sqm ?? null,
      created_by: input.created_by ?? null,
    })
    .select(ROOM_COLUMNS)
    .single();

  if (error?.code === '23505') {
    return { error: `Kode "${code}" sudah dipakai ruangan lain di proyek ini.` };
  }
  if (error) return { error: error.message };
  return { room: data as Room };
}

/** Everything except the code. The code is never editable - see the header. */
export type RoomPatch = Partial<
  Pick<Room, 'room_name' | 'floor' | 'area_type' | 'sort_order' | 'area_sqm' | 'active'>
>;

export async function updateRoom(id: string, patch: RoomPatch): Promise<{ error?: string }> {
  if (Object.prototype.hasOwnProperty.call(patch, 'room_code')) {
    throw new Error('updateRoom tidak boleh mengubah room_code - kode ruangan bersifat tetap.');
  }
  const { error } = await supabase.from('rooms').update(patch).eq('id', id);
  return { error: error?.message };
}

export async function setRoomActive(id: string, active: boolean): Promise<{ error?: string }> {
  return updateRoom(id, { active });
}

/**
 * The catch-all room. Select-then-insert rather than upsert: the unique index
 * is partial (035:52-53), so ON CONFLICT cannot name it, and a concurrent
 * second call is caught by the 23505 branch and treated as success.
 */
export async function ensureAreaUmum(
  projectId: string,
  createdBy?: string | null,
): Promise<{ room?: Room; error?: string }> {
  const { data: found } = await supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('project_id', projectId)
    .eq('room_code', AREA_UMUM_CODE)
    .maybeSingle();

  if (found) return { room: found as Room };

  const created = await createRoom({
    project_id: projectId,
    room_name:  AREA_UMUM_NAME,
    floor:      '',
    area_type:  'general',
    sort_order: 9999, // sorts last, per spec §10.2
    room_code:  AREA_UMUM_CODE,
    created_by: createdBy ?? null,
  });

  if (created.error?.includes('sudah dipakai')) {
    const { data } = await supabase
      .from('rooms').select(ROOM_COLUMNS)
      .eq('project_id', projectId).eq('room_code', AREA_UMUM_CODE).maybeSingle();
    return data ? { room: data as Room } : { error: created.error };
  }
  return created;
}

/** Stamped after a label sheet is printed. Reprints do not clear it (spec §8). */
export async function markRoomsPrinted(ids: string[]): Promise<{ error?: string }> {
  if (ids.length === 0) return {};
  const { error } = await supabase
    .from('rooms')
    .update({ qr_printed_at: new Date().toISOString() })
    .in('id', ids);
  return { error: error?.message };
}

// ─── Pure: paste import ──────────────────────────────────────────────────────

export interface ParsedRoomRow {
  /** 1-based, so warnings can name the line the user is looking at. */
  line: number;
  floor: string;
  room_name: string;
  area_type: AreaType;
  room_code: string;
  sort_order: number;
}

export interface RoomPasteResult {
  rows: ParsedRoomRow[];
  warnings: string[];
}

/** Indonesian labels, DATUM values, and the shorthands supervisors type. */
const AREA_TYPE_LOOKUP: Record<string, AreaType> = (() => {
  const m: Record<string, AreaType> = {};
  for (const t of AREA_TYPES) {
    m[t.value] = t.value;
    m[t.label.toLowerCase()] = t.value;
  }
  Object.assign(m, {
    'km': 'bathroom', 'toilet': 'bathroom', 'wc': 'bathroom',
    'kamar': 'bedroom',
    'ruang tamu': 'living', 'living room': 'living',
    'koridor': 'circulation', 'tangga': 'circulation', 'lorong': 'circulation',
    'gudang': 'utility', 'shaft': 'utility', 'panel': 'utility',
    'umum': 'general', 'lain-lain': 'general',
  } as Record<string, AreaType>);
  return m;
})();

/**
 * One room per line: `floor <sep> name <sep> area type?`, where <sep> is `|`,
 * a tab or `;`. A single-column line is treated as a bare name.
 *
 * Nothing is silently dropped: every skipped line produces a warning naming its
 * line number and the reason, because a room missing from the import is a room
 * with no QR label and no events.
 */
export function parseRoomPaste(text: string): RoomPasteResult {
  const rows: ParsedRoomRow[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>(); // code → line that claimed it

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i].trim();
    if (!raw) continue;

    const cols = raw.split(/\s*[|;\t]\s*/).map((c) => c.trim());
    const floor = cols.length >= 2 ? cols[0] : '';
    const name = cols.length >= 2 ? cols[1] : cols[0];
    const typeRaw = cols.length >= 3 ? cols[2] : '';

    if (!name) {
      warnings.push(`Baris ${line} dilewati: nama ruangan kosong.`);
      continue;
    }

    let area_type: AreaType = 'general';
    if (typeRaw) {
      const hit = AREA_TYPE_LOOKUP[typeRaw.toLowerCase()];
      if (hit) area_type = hit;
      else warnings.push(`Baris ${line}: tipe area "${typeRaw}" tidak dikenal, dipakai "Umum".`);
    }

    const room_code = normalizeRoomCode(`${floor} ${name}`);
    if (!isValidRoomCode(room_code)) {
      warnings.push(
        `Baris ${line} dilewati: kode "${room_code}" tidak valid (maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung).`,
      );
      continue;
    }

    const claimed = seen.get(room_code);
    if (claimed !== undefined) {
      warnings.push(`Baris ${line} dilewati: kode ${room_code} sudah dipakai baris ${claimed}.`);
      continue;
    }
    seen.set(room_code, line);

    rows.push({ line, floor, room_name: name, area_type, room_code, sort_order: rows.length });
  }

  return { rows, warnings };
}

// ─── Pure: DATUM export ──────────────────────────────────────────────────────

export interface DatumAreaExport {
  area_code: string;
  area_name: string;
  floor: string;
  area_type: AreaType;
  sort_order: number;
}

/**
 * The escape hatch from spec §2 decision 2: rooms in DATUM's own area shape, so
 * a human can hand them to DATUM without SANO ever calling it. Inactive rooms
 * are included - whether an area is retired is DATUM's call, not ours.
 */
export function roomsToDatumAreas(rooms: Room[]): DatumAreaExport[] {
  return rooms.map((r) => ({
    area_code: r.room_code,
    area_name: r.room_name,
    floor: r.floor ?? '',
    area_type: r.area_type,
    sort_order: r.sort_order,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tools/__tests__/rooms.test.ts
```

Expected: `Tests: 14 passed, 14 total`.

- [ ] **Step 5: Commit**

```bash
git add tools/rooms.ts tools/__tests__/rooms.test.ts
git commit -m "$(cat <<'MSG'
feat(rooms): room CRUD, Area Umum bootstrap, paste import, DATUM export

updateRoom throws on a room_code key rather than accepting it: before printing
the fix is deactivate-and-recreate, after printing the database refuses (096).
parseRoomPaste warns by line number for every line it drops - a room missing
from an import is a room with no label and no events.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `tools/gateRefs.ts` - gate and step reference data

**Files:** create `tools/gateRefs.ts`, `tools/__tests__/gateRefs.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/gateRefs.test.ts`:

```ts
/**
 * Gates are data (spec §2 decision 3), so the office can relabel them - but the
 * CODE is a foreign key that release 2's site_events will reference. The client
 * refuses a `code` in a patch before the database ever sees it, so the message
 * is Indonesian and the failure is at the call site, not a 500 from a trigger.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { gateChipLabel, stepChipLabel, updateGateRef } from '../gateRefs';
import type { GateRef, GateStepRef } from '../types';

const gate = (over: Partial<GateRef> = {}): GateRef => ({
  code: 'B', name_id: 'Pekerjaan Basah / Waterproofing', short_label: 'Basah',
  description: null, sort_order: 20, active: true, datum_gate_code: null, ...over,
});

const step = (over: Partial<GateStepRef> = {}): GateStepRef => ({
  code: 'B4', gate_code: 'B', name_id: 'Waterproofing', description: null,
  sort_order: 40, active: true, datum_step_code: null, ...over,
});

describe('chip labels', () => {
  it('renders a gate as "code · short label"', () => {
    expect(gateChipLabel(gate())).toBe('B · Basah');
  });

  it('renders a step as "gate code · step code step name"', () => {
    expect(stepChipLabel(step(), gate())).toBe('B · B4 Waterproofing');
  });

  it('falls back to the step gate_code when the gate is unknown', () => {
    expect(stepChipLabel(step(), undefined)).toBe('B · B4 Waterproofing');
  });
});

describe('updateGateRef', () => {
  it('refuses a patch carrying code, before touching the database', async () => {
    await expect(
      updateGateRef('B', { code: 'Z' } as never),
    ).rejects.toThrow(/kode/i);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** - `npx jest tools/__tests__/gateRefs.test.ts` → `Cannot find module '../gateRefs'`.

- [ ] **Step 3: Write the module**

Create `tools/gateRefs.ts`:

```ts
// SANO - Gate reference data (spec §2 decision 3, §4.1).
//
// gate_refs mirrors DATUM's gate_code enum A..H and gate_step_refs mirrors its
// trade_steps. Labels, descriptions, order and the active flag are editable
// from "Kelola gerbang"; codes are not, and cannot be deleted - migration 096
// enforces both with a trigger, and these wrappers refuse earlier so the user
// gets an Indonesian sentence instead of a Postgres exception.

import { supabase } from './supabase';
import type { GateRef, GateStepRef } from './types';

const GATE_COLUMNS = 'code, name_id, short_label, description, sort_order, active, datum_gate_code';
const STEP_COLUMNS = 'code, gate_code, name_id, description, sort_order, active, datum_step_code';

export async function listGateRefs(opts: { activeOnly?: boolean } = {}): Promise<GateRef[]> {
  let q = supabase.from('gate_refs').select(GATE_COLUMNS).order('sort_order', { ascending: true });
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) { console.warn('listGateRefs failed:', error.message); return []; }
  return (data ?? []) as GateRef[];
}

export async function listGateStepRefs(opts: { activeOnly?: boolean } = {}): Promise<GateStepRef[]> {
  let q = supabase.from('gate_step_refs').select(STEP_COLUMNS)
    .order('gate_code', { ascending: true }).order('sort_order', { ascending: true });
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) { console.warn('listGateStepRefs failed:', error.message); return []; }
  return (data ?? []) as GateStepRef[];
}

export type GateRefPatch = Partial<Pick<GateRef, 'name_id' | 'short_label' | 'description' | 'sort_order' | 'active'>>;
export type GateStepRefPatch = Partial<Pick<GateStepRef, 'name_id' | 'description' | 'sort_order' | 'active'>>;

function refuseCodeChange(patch: object): void {
  if (Object.prototype.hasOwnProperty.call(patch, 'code')) {
    throw new Error('Kode gerbang tidak boleh diubah - kode adalah kunci referensi kejadian lapangan.');
  }
}

export async function updateGateRef(code: string, patch: GateRefPatch): Promise<{ error?: string }> {
  refuseCodeChange(patch);
  const { error } = await supabase.from('gate_refs').update(patch).eq('code', code);
  return { error: error?.message };
}

export async function createGateStepRef(input: {
  code: string; gate_code: string; name_id: string;
  description?: string | null; sort_order?: number;
}): Promise<{ step?: GateStepRef; error?: string }> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { error: 'Kode langkah wajib diisi.' };
  if (!input.name_id.trim()) return { error: 'Nama langkah wajib diisi.' };

  const { data, error } = await supabase.from('gate_step_refs').insert({
    code,
    gate_code: input.gate_code,
    name_id: input.name_id.trim(),
    description: input.description ?? null,
    sort_order: input.sort_order ?? 0,
  }).select(STEP_COLUMNS).single();

  if (error?.code === '23505') return { error: `Kode langkah "${code}" sudah dipakai.` };
  if (error) return { error: error.message };
  return { step: data as GateStepRef };
}

export async function updateGateStepRef(code: string, patch: GateStepRefPatch): Promise<{ error?: string }> {
  refuseCodeChange(patch);
  const { error } = await supabase.from('gate_step_refs').update(patch).eq('code', code);
  return { error: error?.message };
}

// ─── Pure: chip labels ───────────────────────────────────────────────────────

/** "B · Basah" - the chip a supervisor taps and the report prints. */
export function gateChipLabel(gate: GateRef): string {
  return `${gate.code} · ${gate.short_label}`;
}

/** "B · B4 Waterproofing". */
export function stepChipLabel(step: GateStepRef, gate?: GateRef): string {
  return `${gate?.code ?? step.gate_code} · ${step.code} ${step.name_id}`;
}
```

- [ ] **Step 4: Run it, expect PASS** - `npx jest tools/__tests__/gateRefs.test.ts` → `Tests: 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add tools/gateRefs.ts tools/__tests__/gateRefs.test.ts
git commit -m "$(cat <<'MSG'
feat(gates): read and edit gate_refs / gate_step_refs, chip labels

The client refuses a `code` in a patch before the 096 trigger has to, so the
user reads an Indonesian sentence instead of a Postgres exception.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: `tools/projectPhase.ts` and the `useProject` note

**Files:** create `tools/projectPhase.ts`, `tools/__tests__/projectPhase.test.ts`; modify `workflows/hooks/useProject.tsx`.

The important finding here: `projects` UPDATE passes when **either** policy allows it. `projects_manager_update` (`036:73-76`) uses `is_office_manager()`, which covers admin and principal on every project. `projects_update_assigned` (`023:58-60`) uses `is_project_assignment_manager()`, which `037` widened to admin, principal **and estimator** when that user is assigned to the project. So an assigned estimator may set the phase, while an unassigned estimator or any supervisor may not. Under RLS a filtered UPDATE is not an error; PostgREST returns zero rows and Supabase reports `error: null`. A refused update would therefore look like it worked and change nothing. That is exactly the silent-wrong-answer failure CLAUDE.md §12 forbids, so `setProjectPhase` selects the row back and reports the truth.

- [ ] **Step 1: Write the failing test**

Create `tools/__tests__/projectPhase.test.ts`:

```ts
/**
 * projects UPDATE passes for admin/principal on any project (036:73-76) and for
 * an admin, principal or estimator ASSIGNED to the project (023:58-60, widened
 * by 037). RLS does not raise on a filtered UPDATE; it returns zero rows with
 * error null. Without the read-back below, an unassigned estimator would see
 * "Fase diperbarui" and the phase would be unchanged.
 */
import { canSetProjectPhase, setProjectPhase } from '../projectPhase';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));
const mockSupabase = supabase as jest.Mocked<typeof supabase>;

function chain(result: { data: unknown; error: { message: string } | null }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

describe('canSetProjectPhase', () => {
  it('offers the control to office roles only', () => {
    expect(canSetProjectPhase('admin')).toBe(true);
    expect(canSetProjectPhase('principal')).toBe(true);
    expect(canSetProjectPhase('estimator')).toBe(true);
    expect(canSetProjectPhase('supervisor')).toBe(false);
    expect(canSetProjectPhase(undefined)).toBe(false);
  });
});

describe('setProjectPhase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports success when the row comes back', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      chain({ data: { id: 'p1', phase: 'FINISHING' }, error: null }),
    );
    await expect(setProjectPhase('p1', 'FINISHING')).resolves.toEqual({});
  });

  it('reports the RLS refusal instead of a silent success', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(chain({ data: null, error: null }));
    const res = await setProjectPhase('p1', 'FINISHING');
    expect(res.error).toMatch(/ditugaskan/i);
  });

  it('passes a real database error through', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      chain({ data: null, error: { message: 'boom' } }),
    );
    await expect(setProjectPhase('p1', 'FINISHING')).resolves.toEqual({ error: 'boom' });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** - `Cannot find module '../projectPhase'`.

- [ ] **Step 3: Write the module**

Create `tools/projectPhase.ts`:

```ts
// SANO - Project phase (096).
//
// STRUKTUR | FINISHING | SERAH_TERIMA. Release 1 only stores it; the client
// report renderer switches on it in plan 4.
//
// ACCESS. projects UPDATE passes for admin/principal on any project
// (is_office_manager, 036:73-76) and for an admin, principal or estimator
// assigned to the project (is_project_assignment_manager, 023:58-60 widened by
// 037). canSetProjectPhase only decides whether to SHOW the control, so it
// offers it to all three office roles; the database decides the rest. A
// refused UPDATE is FILTERED by RLS, not rejected: zero rows change and
// Supabase reports error null. We therefore select the row back and treat "no
// row" as the refusal it is, rather than reporting a success that did not
// happen (CLAUDE.md §12).

import { supabase } from './supabase';
import type { ProjectPhase } from './types';

export const PHASE_UPDATE_ROLES = ['admin', 'principal', 'estimator'] as const;

export function canSetProjectPhase(role: string | null | undefined): boolean {
  return !!role && (PHASE_UPDATE_ROLES as readonly string[]).includes(role);
}

export async function setProjectPhase(
  projectId: string,
  phase: ProjectPhase,
): Promise<{ error?: string }> {
  const { data, error } = await supabase
    .from('projects')
    .update({ phase })
    .eq('id', projectId)
    .select('id, phase')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) {
    return {
      error:
        'Fase proyek tidak berubah. Hanya admin, prinsipal, atau estimator yang ditugaskan ke proyek ini yang dapat mengubahnya.',
    };
  }
  return {};
}
```

- [ ] **Step 4: Update the `useProject` comment**

`workflows/hooks/useProject.tsx:79-82` already selects every column:

```ts
      const { data: projectList, error: projErr } = await supabase
        .from('projects')
        .select('*')
        .order('code', { ascending: true });
```

`phase` and `datum_project_code` therefore arrive with no query change - the only edit is a note so the next reader does not "fix" the `*` into a column list and quietly drop them. Replace the comment block at `:74-78` with:

```ts
      // Fetch projects directly and let RLS decide visibility:
      //   • office roles (admin/principal/estimator) see every project
      //   • site supervisors see only the projects they are assigned to
      // (see 036_office_global_project_access.sql). No client-side assignment
      // pre-filter — that was what siloed estimators from each other's work.
      //
      // select('*') is load-bearing: Project carries phase + datum_project_code
      // (096), and RoomScreen reads project.phase straight off this context.
      // Narrowing this to a column list silently drops them.
```

- [ ] **Step 5: Run it, expect PASS, then type-check and commit**

```bash
npx jest tools/__tests__/projectPhase.test.ts
npx tsc --noEmit
git add tools/projectPhase.ts tools/__tests__/projectPhase.test.ts workflows/hooks/useProject.tsx
git commit -m "$(cat <<'MSG'
feat(projects): setProjectPhase, and say so when RLS refuses

projects UPDATE passes for admin/principal on any project and for an assigned
estimator (036, 023, 037). RLS filters rather than raises, so a refused update
returns zero rows with error null. Read the row back and report the refusal
instead of a success that did not happen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: `tools/roomLabelsHtml.ts` - the A4 QR label sheet

**Files:** create `tools/roomLabelsHtml.ts`, `tools/__tests__/roomLabelsHtml.test.ts`; modify `package.json`.

**Dependency note, a deliberate deviation from the spec.** Spec §8 lists `react-native-qrcode-svg` in the new-dependency set. This plan uses **`qrcode`** (plus `@types/qrcode`) instead, because the label sheet is an **HTML string handed to `window.print()`**, not a React tree: `react-native-qrcode-svg` renders a `react-native-svg` component, which cannot be serialized into that string without a renderer round-trip. `qrcode.toString(url, { type: 'svg' })` returns exactly the `<svg>` markup the sheet needs. Record in the commit body that spec §8's dependency list should be amended to `qrcode` + `@types/qrcode`; if a future screen needs an on-screen QR inside a React tree, `react-native-qrcode-svg` can be added then, for that use.

- [ ] **Step 1: Install the dependency**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

If npm reports `ERESOLVE`, re-run both with `--legacy-peer-deps` - that is the flag `vercel.json:2` already uses for this repo. Confirm:

```bash
node -e "console.log(require('qrcode/package.json').version)"
```

- [ ] **Step 2: Write the failing test**

Create `tools/__tests__/roomLabelsHtml.test.ts`:

```ts
/**
 * The renderer is pure so the sheet can be asserted without a browser. The
 * things that actually go wrong on a printed sheet are: a room missing, a page
 * break in the wrong place, and a room name with a stray character breaking the
 * markup. All three are covered.
 */
// roomLabelsHtml imports ./rooms for markRoomsPrinted, which imports
// ./supabase - see the note in task 5.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { renderRoomLabelSheetHtml, LABELS_PER_PAGE } from '../roomLabelsHtml';
import type { Room } from '../types';

const room = (i: number, over: Partial<Room> = {}): Room => ({
  id: `r${i}`, project_id: 'p1', room_code: `LT1-R${i}`, room_name: `Ruang ${i}`,
  floor: 'Lt. 1', area_sqm: null, area_type: 'general', sort_order: i,
  datum_area_id: null, qr_printed_at: null, active: true, created_by: null,
  created_at: '2026-09-10T00:00:00Z', ...over,
});

const svg = (id: string) => `<svg data-room="${id}"></svg>`;
const svgMap = (rooms: Room[]) => Object.fromEntries(rooms.map((r) => [r.id, svg(r.id)]));

const render = (rooms: Room[]) =>
  renderRoomLabelSheetHtml({
    projectName: 'Nusa Golf I4',
    projectCode: 'GA17',
    rooms,
    qrSvgByRoomId: svgMap(rooms),
  });

describe('renderRoomLabelSheetHtml', () => {
  it('emits one label per room, with its QR, name, floor, code and URL', () => {
    const rooms = [room(1), room(2)];
    const html = render(rooms);
    expect((html.match(/class="label"/g) ?? []).length).toBe(2);
    expect(html).toContain('data-room="r1"');
    expect(html).toContain('Ruang 1');
    expect(html).toContain('Lt. 1');
    expect(html).toContain('LT1-R1');
    expect(html).toContain('https://sano-app.vercel.app/r/GA17/LT1-R1');
  });

  it('prints the project code on every label so a stray sticker is traceable', () => {
    expect((render([room(1), room(2)]).match(/GA17/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('breaks a page every 9 labels', () => {
    expect(LABELS_PER_PAGE).toBe(9);
    const nine = render(Array.from({ length: 9 }, (_, i) => room(i)));
    const ten  = render(Array.from({ length: 10 }, (_, i) => room(i)));
    expect((nine.match(/class="page"/g) ?? []).length).toBe(1);
    expect((ten.match(/class="page"/g) ?? []).length).toBe(2);
  });

  it('carries A4 page geometry and a 3-column grid', () => {
    const html = render([room(1)]);
    expect(html).toMatch(/@page\s*\{[^}]*A4/);
    expect(html).toMatch(/grid-template-columns:\s*repeat\(3,/);
    expect(html).toMatch(/page-break-after:\s*always/);
  });

  it('escapes HTML in room and project names', () => {
    const html = renderRoomLabelSheetHtml({
      projectName: 'Nusa & <b>Golf</b>',
      projectCode: 'GA17',
      rooms: [room(1, { room_name: '<script>alert(1)</script>' })],
      qrSvgByRoomId: svgMap([room(1)]),
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Nusa &amp; &lt;b&gt;Golf&lt;/b&gt;');
  });

  it('does NOT escape the QR svg - it is markup we generated', () => {
    expect(render([room(1)])).toContain('<svg data-room="r1"></svg>');
  });

  it('renders an em-dash placeholder for a room with no floor', () => {
    expect(render([room(1, { floor: null })])).toContain('—');
  });

  it('handles an empty room list without emitting a page', () => {
    expect(render([])).not.toContain('class="page"');
  });
});
```

- [ ] **Step 3: Run it, expect FAIL** - `Cannot find module '../roomLabelsHtml'`.

- [ ] **Step 4: Write the module**

Create `tools/roomLabelsHtml.ts`:

```ts
// SANO - A4 QR label sheet.
//
// 3 × 3 labels per A4 page. Each label carries the QR, the room name, the
// floor, the project code, the room code as text and the full URL in small
// print - spec §8: "so a human can type it when a camera fails".
//
// The print path is the same popup + window.print() route the client report
// already uses (tools/clientReportHtml.ts:462-496); Expo web has no native
// print API and this one is proven in production here.
//
// DEPENDENCY DEVIATION. Spec §8 named react-native-qrcode-svg. That renders a
// react-native-svg component, which cannot be serialized into an HTML string
// without a renderer round-trip. `qrcode` returns the <svg> markup directly,
// which is what this sheet needs. Amend spec §8's dependency list accordingly.

import { Platform } from 'react-native';
import QRCode from 'qrcode';
import { buildRoomUrl } from './roomLinks';
import { markRoomsPrinted } from './rooms';
import type { Project, Room } from './types';

/** 3 columns × 3 rows. Changing this changes the page-break arithmetic below. */
export const LABELS_PER_PAGE = 9;

export interface RoomLabelSheetInput {
  projectName: string;
  projectCode: string;
  rooms: Room[];
  /** room.id → the <svg> markup for that room's QR. */
  qrSvgByRoomId: Record<string, string>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SHEET_CSS = `
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #141210; }
.page { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
        gap: 4mm; width: 194mm; height: 281mm; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.label { border: 1px dashed #B5AFA8; border-radius: 3mm; padding: 4mm;
         display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
         text-align: center; overflow: hidden; }
.label .qr { width: 32mm; height: 32mm; }
.label .qr svg { width: 100%; height: 100%; }
.label .name { font-size: 11pt; font-weight: 700; line-height: 1.15; margin-top: 2mm; }
.label .floor { font-size: 9pt; color: #524E49; margin-top: 1mm; }
.label .code { font-size: 9pt; font-weight: 600; letter-spacing: .04em; margin-top: 2mm; }
.label .proj { font-size: 7pt; color: #847E78; letter-spacing: .08em; text-transform: uppercase; margin-top: 1mm; }
.label .url { font-size: 6pt; color: #847E78; margin-top: auto; word-break: break-all; line-height: 1.2; }
@media screen { body { background: #D2D0C4; padding: 8mm; } .page { background: #FDFAF6; margin: 0 auto 8mm; padding: 4mm; } }
`;

export function renderRoomLabelSheetHtml(input: RoomLabelSheetInput): string {
  const { projectName, projectCode, rooms, qrSvgByRoomId } = input;

  const pages: string[] = [];
  for (let i = 0; i < rooms.length; i += LABELS_PER_PAGE) {
    const labels = rooms.slice(i, i + LABELS_PER_PAGE).map((r) => {
      const url = buildRoomUrl(projectCode, r.room_code);
      return `
      <div class="label">
        <div class="qr">${qrSvgByRoomId[r.id] ?? ''}</div>
        <div class="name">${esc(r.room_name)}</div>
        <div class="floor">${esc(r.floor || '—')}</div>
        <div class="code">${esc(r.room_code)}</div>
        <div class="proj">${esc(projectCode)}</div>
        <div class="url">${esc(url)}</div>
      </div>`;
    }).join('');
    pages.push(`<div class="page">${labels}</div>`);
  }

  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Label Ruangan - ${esc(projectName)}</title>
<style>${SHEET_CSS}</style>
</head><body>${pages.join('')}</body></html>`;
}

/**
 * Generate the QR codes, open the print popup, then stamp qr_printed_at. The
 * stamp happens AFTER the popup opens, because that is the point at which the
 * codes have physically left the system - and 096 freezes room_code from then on.
 */
export async function exportRoomLabelSheet(
  project: Pick<Project, 'id' | 'code' | 'name'>,
  rooms: Room[],
): Promise<void> {
  if (Platform.OS !== 'web') {
    throw new Error('Cetak label QR hanya tersedia di versi web. Buka SANO di browser kantor.');
  }
  if (rooms.length === 0) throw new Error('Tidak ada ruangan yang dipilih untuk dicetak.');

  const qrSvgByRoomId: Record<string, string> = {};
  for (const r of rooms) {
    qrSvgByRoomId[r.id] = await QRCode.toString(buildRoomUrl(project.code, r.room_code), {
      type: 'svg',
      errorCorrectionLevel: 'M', // survives a smudge on a site wall
      margin: 0,
    });
  }

  const html = renderRoomLabelSheetHtml({
    projectName: project.name,
    projectCode: project.code,
    rooms,
    qrSvgByRoomId,
  });

  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup diblokir. Izinkan popup untuk mencetak label.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();

  const { error } = await markRoomsPrinted(rooms.map((r) => r.id));
  if (error) {
    throw new Error(`Label tercetak, tetapi penandaan "sudah dicetak" gagal: ${error}. Kode ruangan belum terkunci - coba cetak ulang.`);
  }
}
```

- [ ] **Step 5: Run it, expect PASS** - `npx jest tools/__tests__/roomLabelsHtml.test.ts` → `Tests: 8 passed`.

- [ ] **Step 6: Commit**

```bash
git add tools/roomLabelsHtml.ts tools/__tests__/roomLabelsHtml.test.ts package.json package-lock.json
git commit -m "$(cat <<'MSG'
feat(rooms): A4 QR label sheet, 3x3 per page, printed via window.print()

Uses `qrcode` rather than the react-native-qrcode-svg named in spec §8: the
sheet is an HTML string, not a React tree, and qrcode.toString returns the
<svg> markup directly. Spec §8's dependency list should be amended to
qrcode + @types/qrcode.

Printing stamps qr_printed_at, which freezes room_code (096) - a printed label
is a physical object.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Office screens - "Kelola ruangan" and "Kelola gerbang"

**Files:**
- Create: `office/screens/rooms/RoomForm.tsx`, `office/screens/rooms/RoomPasteImport.tsx`, `office/screens/RoomsAdminScreen.tsx`, `office/screens/GatesAdminScreen.tsx`
- Modify: `office/navigation.tsx`

Structure follows `office/screens/EquipmentScreen.tsx`: `<Header />` at the top (it carries the project selector, so these screens read `useProject().project` rather than owning a picker), `Card` sections, `StyleSheet.create` at the bottom, `useToast` for feedback and `Alert.alert` for errors, `@react-native-picker/picker` inside a `pickerWrap`. Copy is Indonesian inline; there is no i18n layer.

- [ ] **Step 1: `office/screens/rooms/RoomForm.tsx`**

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { normalizeRoomCode, isValidRoomCode, ROOM_CODE_MAX } from '../../../tools/roomCodes';
import { AREA_TYPES } from '../../../tools/constants';
import type { AreaType } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

interface Props {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: { floor: string; room_name: string; area_type: AreaType }) => void;
}

/**
 * The code preview is the point of this form: it is derived, frozen once
 * printed, and the join key to DATUM later. The user sees exactly what will be
 * stored before they commit to it, and Simpan stays disabled while it is invalid.
 */
export default function RoomForm({ saving, onCancel, onSubmit }: Props) {
  const [floor, setFloor] = useState('');
  const [name, setName] = useState('');
  const [areaType, setAreaType] = useState<AreaType>('general');

  const code = normalizeRoomCode(`${floor} ${name}`);
  const codeOk = isValidRoomCode(code);
  const canSave = !!name.trim() && codeOk && !saving;

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Lantai</Text>
      <TextInput
        style={styles.input} value={floor} onChangeText={setFloor}
        placeholder="Lt. 2" placeholderTextColor={COLORS.textMuted}
      />

      <Text style={styles.label}>Nama ruangan</Text>
      <TextInput
        style={styles.input} value={name} onChangeText={setName}
        placeholder="Kamar Mandi Utama" placeholderTextColor={COLORS.textMuted}
      />

      <Text style={styles.label}>Tipe area</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={areaType} onValueChange={(v) => setAreaType(v as AreaType)}>
          {AREA_TYPES.map((t) => <Picker.Item key={t.value} label={t.label} value={t.value} />)}
        </Picker>
      </View>

      <Text style={styles.label}>Kode ruangan (otomatis)</Text>
      <Text style={[styles.codePreview, !codeOk && styles.codeBad]}>{code || '—'}</Text>
      <Text style={styles.hint}>
        {codeOk
          ? 'Kode ini dicetak pada label QR dan tidak bisa diubah setelah dicetak.'
          : `Kode belum valid: maksimal ${ROOM_CODE_MAX} karakter, huruf besar, angka dan tanda hubung. Persingkat nama atau lantainya.`}
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnOff]}
          disabled={!canSave}
          onPress={() => onSubmit({ floor: floor.trim(), room_name: name.trim(), area_type: areaType })}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>{saving ? 'Menyimpan…' : 'Simpan ruangan'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6, marginTop: SPACE.sm + 2 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  codePreview: { fontSize: TYPE.lg, fontFamily: FONTS.bold, letterSpacing: 0.6, color: COLORS.text },
  codeBad: { color: COLORS.critical },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnOff: { backgroundColor: COLORS.surfaceAlt },
  saveText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
});
```

- [ ] **Step 2: `office/screens/rooms/RoomPasteImport.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { parseRoomPaste, type ParsedRoomRow } from '../../../tools/rooms';
import { AREA_TYPE_LABELS } from '../../../tools/constants';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../../workflows/theme';

interface Props {
  saving: boolean;
  onCancel: () => void;
  onImport: (rows: ParsedRoomRow[]) => void;
}

/**
 * Preview before import, always. The warning list is the honest half: every
 * line the parser dropped is named with its line number and its reason, so a
 * room never goes missing quietly.
 */
export default function RoomPasteImport({ saving, onCancel, onImport }: Props) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseRoomPaste(text), [text]);

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Satu ruangan per baris: lantai, nama, lalu tipe area (opsional). Pemisah kolom: | , titik koma, atau tab.
        {'\n'}Contoh: Lt. 2 | Kamar Mandi Utama | Kamar mandi
      </Text>

      <TextInput
        style={styles.textarea} value={text} onChangeText={setText}
        multiline numberOfLines={8} textAlignVertical="top"
        placeholder={'Lt. 1 | Dapur | Dapur\nLt. 2 | Kamar Mandi Utama | Kamar mandi'}
        placeholderTextColor={COLORS.textMuted}
      />

      {parsed.rows.length > 0 && (
        <>
          <Text style={styles.subHead}>{parsed.rows.length} ruangan akan dibuat</Text>
          {parsed.rows.slice(0, 20).map((r) => (
            <View key={r.room_code} style={styles.previewRow}>
              <Text style={styles.previewCode}>{r.room_code}</Text>
              <Text style={styles.previewName} numberOfLines={1}>
                {r.room_name}{r.floor ? ` · ${r.floor}` : ''} · {AREA_TYPE_LABELS[r.area_type]}
              </Text>
            </View>
          ))}
          {parsed.rows.length > 20 && (
            <Text style={styles.hint}>…dan {parsed.rows.length - 20} baris lagi.</Text>
          )}
        </>
      )}

      {parsed.warnings.length > 0 && (
        <View style={styles.warnBox}>
          <Text style={styles.warnHead}>{parsed.warnings.length} baris perlu diperiksa</Text>
          {parsed.warnings.map((w, i) => <Text key={i} style={styles.warnLine}>• {w}</Text>)}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, (parsed.rows.length === 0 || saving) && styles.saveBtnOff]}
          disabled={parsed.rows.length === 0 || saving}
          onPress={() => onImport(parsed.rows)}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>
            {saving ? 'Mengimpor…' : `Impor ${parsed.rows.length} ruangan`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginBottom: SPACE.sm },
  textarea: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, minHeight: 140, fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text,
  },
  subHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.4, textTransform: 'uppercase',
    color: COLORS.textSec, marginTop: SPACE.md, marginBottom: SPACE.xs,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 3 },
  previewCode: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text, minWidth: 132 },
  previewName: { flex: 1, fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec },
  warnBox: { marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS, backgroundColor: COLORS.warningBg },
  warnHead: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.warning, marginBottom: SPACE.xs },
  warnLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveBtnOff: { backgroundColor: COLORS.surfaceAlt },
  saveText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
});
```

- [ ] **Step 3: `office/screens/RoomsAdminScreen.tsx`**

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useProject } from '../../workflows/hooks/useProject';
import { useToast } from '../../workflows/components/Toast';
import GatesAdminScreen from './GatesAdminScreen';
import RoomForm from './rooms/RoomForm';
import RoomPasteImport from './rooms/RoomPasteImport';
import {
  listRooms, createRoom, setRoomActive, ensureAreaUmum, roomsToDatumAreas,
  type ParsedRoomRow,
} from '../../tools/rooms';
import { exportRoomLabelSheet } from '../../tools/roomLabelsHtml';
import { canSetProjectPhase, setProjectPhase } from '../../tools/projectPhase';
import { AREA_TYPE_LABELS, PROJECT_PHASES } from '../../tools/constants';
import type { ProjectPhase, Room } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../workflows/theme';

type SubModule = 'rooms' | 'gates';
type Mode = 'none' | 'add' | 'paste';

export default function RoomsAdminScreen() {
  const { project, profile, refresh } = useProject();
  const { show: toast } = useToast();

  const [sub, setSub] = useState<SubModule>('rooms');
  const [mode, setMode] = useState<Mode>('none');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const canPhase = canSetProjectPhase(profile?.role);

  const load = useCallback(async () => {
    if (!project) { setRooms([]); setLoading(false); return; }
    setLoading(true);
    setRooms(await listRooms(project.id, { includeInactive: true }));
    setLoading(false);
  }, [project]);

  useEffect(() => { void load(); }, [load]);

  // Rooms grouped by floor, floors in first-appearance order (listRooms already
  // orders by floor, then sort_order, then name).
  const byFloor = useMemo(() => {
    const groups = new Map<string, Room[]>();
    for (const r of rooms) {
      const key = r.floor || 'Tanpa lantai';
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [rooms]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = async (input: { floor: string; room_name: string; area_type: Room['area_type'] }) => {
    if (!project) return;
    setSaving(true);
    // Area Umum is created by the app on first room setup, never by a trigger
    // (spec §4.1) - this is that moment.
    await ensureAreaUmum(project.id, profile?.id ?? null);
    const res = await createRoom({
      project_id: project.id,
      sort_order: rooms.filter((r) => (r.floor || '') === input.floor).length,
      created_by: profile?.id ?? null,
      ...input,
    });
    setSaving(false);
    if (res.error) { Alert.alert('Gagal menambah ruangan', res.error); return; }
    toast(`Ruangan ${res.room?.room_code} dibuat.`, 'ok');
    setMode('none');
    await load();
  };

  const handleImport = async (parsed: ParsedRoomRow[]) => {
    if (!project) return;
    setSaving(true);
    await ensureAreaUmum(project.id, profile?.id ?? null);
    const failures: string[] = [];
    for (const row of parsed) {
      const res = await createRoom({
        project_id: project.id,
        room_name: row.room_name,
        floor: row.floor,
        area_type: row.area_type,
        sort_order: row.sort_order,
        created_by: profile?.id ?? null,
      });
      if (res.error) failures.push(`${row.room_code}: ${res.error}`);
    }
    setSaving(false);
    setMode('none');
    await load();
    if (failures.length > 0) {
      // Partial success is reported in full - a half-imported list that claims
      // success is the failure mode this app refuses (CLAUDE.md §12).
      Alert.alert(
        `${parsed.length - failures.length} dari ${parsed.length} ruangan dibuat`,
        `Gagal:\n${failures.join('\n')}`,
      );
    } else {
      toast(`${parsed.length} ruangan dibuat.`, 'ok');
    }
  };

  const handlePrint = async (only: 'selected' | 'all') => {
    if (!project) return;
    const target = only === 'selected'
      ? rooms.filter((r) => selected.has(r.id))
      : rooms.filter((r) => r.active);
    try {
      await exportRoomLabelSheet(project, target);
      toast(`${target.length} label dikirim ke printer.`, 'ok');
      await load(); // pick up qr_printed_at
    } catch (err: any) {
      Alert.alert('Cetak label gagal', err?.message ?? String(err));
    }
  };

  const handleDatumExport = () => {
    if (!project) return;
    if (Platform.OS !== 'web') {
      Alert.alert('Ekspor DATUM', 'Ekspor hanya tersedia di versi web. Buka SANO di browser kantor.');
      return;
    }
    const payload = JSON.stringify(
      { project_code: project.code, project_name: project.name, areas: roomsToDatumAreas(rooms) },
      null, 2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `datum-areas-${project.code}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Berkas DATUM diunduh.', 'ok');
  };

  const handlePhase = async (phase: ProjectPhase) => {
    if (!project) return;
    const { error } = await setProjectPhase(project.id, phase);
    if (error) { Alert.alert('Gagal mengubah fase', error); return; }
    toast('Fase proyek diperbarui.', 'ok');
    await refresh();
  };

  if (sub === 'gates') return <GatesAdminScreen onBack={() => setSub('rooms')} />;

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.sectionHead}>Kelola ruangan</Text>

        {!project && <Card><Text style={styles.empty}>Pilih proyek terlebih dahulu.</Text></Card>}

        {project && (
          <>
            <Card title="Fase proyek" subtitle="Menentukan bentuk laporan progres klien.">
              {canPhase ? (
                <View style={styles.pickerWrap}>
                  <Picker selectedValue={project.phase} onValueChange={(v) => void handlePhase(v as ProjectPhase)}>
                    {PROJECT_PHASES.map((p) => <Picker.Item key={p.value} label={p.label} value={p.value} />)}
                  </Picker>
                </View>
              ) : (
                <Text style={styles.hint}>
                  Fase saat ini: {PROJECT_PHASES.find((p) => p.value === project.phase)?.label ?? project.phase}.
                  {'\n'}Hanya admin, prinsipal, atau estimator yang ditugaskan ke proyek ini yang dapat mengubahnya.
                </Text>
              )}
            </Card>

            <Card
              title={`Ruangan (${rooms.length})`}
              subtitle="Kode ruangan dibuat otomatis dan terkunci setelah labelnya dicetak."
              rightAction={
                <TouchableOpacity onPress={() => setSub('gates')} accessibilityRole="button">
                  <Text style={styles.linkBtn}>Kelola gerbang</Text>
                </TouchableOpacity>
              }
            >
              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setMode(mode === 'add' ? 'none' : 'add')}>
                  <Ionicons name="add" size={16} color={COLORS.text} />
                  <Text style={styles.ghostText}>Tambah ruangan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setMode(mode === 'paste' ? 'none' : 'paste')}>
                  <Ionicons name="clipboard-outline" size={16} color={COLORS.text} />
                  <Text style={styles.ghostText}>Tempel dari lembar</Text>
                </TouchableOpacity>
              </View>

              {mode === 'add' && <RoomForm saving={saving} onCancel={() => setMode('none')} onSubmit={handleAdd} />}
              {mode === 'paste' && <RoomPasteImport saving={saving} onCancel={() => setMode('none')} onImport={handleImport} />}

              {loading && <Text style={styles.empty}>Memuat…</Text>}
              {!loading && rooms.length === 0 && (
                <Text style={styles.empty}>Belum ada ruangan. Tambahkan satu per satu atau tempel daftarnya.</Text>
              )}

              {byFloor.map(([floor, list]) => (
                <View key={floor} style={styles.floorGroup}>
                  <Text style={styles.floorHead}>{floor}</Text>
                  {list.map((r) => (
                    <View key={r.id} style={styles.roomRow}>
                      <TouchableOpacity
                        onPress={() => toggleSelected(r.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected.has(r.id) }}
                        accessibilityLabel={`Pilih ${r.room_name} untuk dicetak`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name={selected.has(r.id) ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={selected.has(r.id) ? COLORS.primary : COLORS.textMuted}
                        />
                      </TouchableOpacity>
                      <View style={styles.roomMeta}>
                        <Text style={[styles.roomName, !r.active && styles.roomOff]} numberOfLines={1}>
                          {r.room_name}
                        </Text>
                        <Text style={styles.roomSub}>
                          {r.room_code} · {AREA_TYPE_LABELS[r.area_type]}
                          {r.qr_printed_at ? ' · label tercetak' : ''}
                          {r.active ? '' : ' · nonaktif'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={async () => {
                          const { error } = await setRoomActive(r.id, !r.active);
                          if (error) Alert.alert('Gagal', error); else await load();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={r.active ? `Nonaktifkan ${r.room_name}` : `Aktifkan ${r.room_name}`}
                      >
                        <Text style={styles.linkBtn}>{r.active ? 'Nonaktifkan' : 'Aktifkan'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ))}
            </Card>

            <Card title="Label QR" subtitle="Cetak pada kertas A4, sembilan label per halaman.">
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, selected.size === 0 && styles.primaryBtnOff]}
                  disabled={selected.size === 0}
                  onPress={() => void handlePrint('selected')}
                >
                  <Text style={styles.primaryText}>Cetak {selected.size} terpilih</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => void handlePrint('all')}>
                  <Ionicons name="qr-code-outline" size={16} color={COLORS.text} />
                  <Text style={styles.ghostText}>Cetak semua aktif</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>
                Mencetak mengunci kode ruangan: label yang sudah menempel di dinding tidak boleh berubah artinya.
              </Text>
            </Card>

            <Card title="Ekspor untuk DATUM" subtitle="Berkas JSON dalam bentuk area DATUM.">
              <TouchableOpacity style={styles.ghostBtn} onPress={handleDatumExport}>
                <Ionicons name="download-outline" size={16} color={COLORS.text} />
                <Text style={styles.ghostText}>Unduh JSON</Text>
              </TouchableOpacity>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.sm,
  },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.md },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginTop: SPACE.sm },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, backgroundColor: COLORS.surface, overflow: 'hidden' },
  btnRow: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md,
  },
  ghostText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.md },
  primaryBtnOff: { backgroundColor: COLORS.surfaceAlt },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  linkBtn: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.info },
  floorGroup: { marginTop: SPACE.md },
  floorHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.4, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.xs,
  },
  roomRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingVertical: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub,
  },
  roomMeta: { flex: 1 },
  roomName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  roomOff: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  roomSub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
});
```

- [ ] **Step 4: `office/screens/GatesAdminScreen.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useToast } from '../../workflows/components/Toast';
import { listGateRefs, listGateStepRefs, updateGateRef, updateGateStepRef, stepChipLabel } from '../../tools/gateRefs';
import type { GateRef, GateStepRef } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../workflows/theme';

interface Props { onBack: () => void }

/**
 * Gates are data, not code (spec §2 decision 3). The office edits the label a
 * supervisor reads and the description the release-2 prompt reads. The CODE is
 * shown read-only: it is the foreign key events reference, and migration 096
 * refuses to move or delete it.
 */
export default function GatesAdminScreen({ onBack }: Props) {
  const { show: toast } = useToast();
  const [gates, setGates] = useState<GateRef[]>([]);
  const [steps, setSteps] = useState<GateStepRef[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ short_label: string; name_id: string; description: string; sort_order: string }>({
    short_label: '', name_id: '', description: '', sort_order: '0',
  });

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([listGateRefs(), listGateStepRefs()]);
    setGates(g); setSteps(s);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (g: GateRef) => {
    setEditing(g.code);
    setDraft({
      short_label: g.short_label, name_id: g.name_id,
      description: g.description ?? '', sort_order: String(g.sort_order),
    });
  };

  const save = async (code: string) => {
    const order = Number(draft.sort_order);
    if (!draft.short_label.trim() || !draft.name_id.trim()) {
      Alert.alert('Belum lengkap', 'Nama dan label singkat wajib diisi.');
      return;
    }
    if (!Number.isFinite(order)) {
      Alert.alert('Urutan tidak valid', 'Urutan harus berupa angka.');
      return;
    }
    const { error } = await updateGateRef(code, {
      short_label: draft.short_label.trim(),
      name_id: draft.name_id.trim(),
      description: draft.description.trim() || null,
      sort_order: order,
    });
    if (error) { Alert.alert('Gagal menyimpan', error); return; }
    setEditing(null);
    toast(`Gerbang ${code} diperbarui.`, 'ok');
    await load();
  };

  const toggleActive = async (g: GateRef) => {
    const { error } = await updateGateRef(g.code, { active: !g.active });
    if (error) Alert.alert('Gagal', error); else await load();
  };

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityRole="button">
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={styles.backText}>Kelola ruangan</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHead}>Kelola gerbang</Text>
        <Text style={styles.hint}>
          Kode gerbang (A sampai H) tetap selamanya - kejadian lapangan menunjuk ke kode itu.
          Nama, label dan penjelasannya boleh diubah; gerbang yang tidak dipakai dinonaktifkan, bukan dihapus.
        </Text>

        {gates.map((g) => {
          const gateSteps = steps.filter((s) => s.gate_code === g.code);
          return (
            <Card key={g.code} title={`${g.code} · ${g.short_label}`} borderColor={g.active ? COLORS.accent : COLORS.textMuted}>
              {editing === g.code ? (
                <>
                  <Text style={styles.label}>Nama lengkap</Text>
                  <TextInput style={styles.input} value={draft.name_id} onChangeText={(v) => setDraft({ ...draft, name_id: v })} />
                  <Text style={styles.label}>Label singkat (chip)</Text>
                  <TextInput style={styles.input} value={draft.short_label} onChangeText={(v) => setDraft({ ...draft, short_label: v })} />
                  <Text style={styles.label}>Penjelasan</Text>
                  <TextInput
                    style={[styles.input, styles.inputMulti]} multiline numberOfLines={3} textAlignVertical="top"
                    value={draft.description} onChangeText={(v) => setDraft({ ...draft, description: v })}
                  />
                  <Text style={styles.hint}>Penjelasan ini dibaca AI saat memilih gerbang untuk sebuah kejadian.</Text>
                  <Text style={styles.label}>Urutan</Text>
                  <TextInput
                    style={styles.input} keyboardType="number-pad"
                    value={draft.sort_order} onChangeText={(v) => setDraft({ ...draft, sort_order: v })}
                  />
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                      <Text style={styles.cancelText}>Batal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveBtn} onPress={() => void save(g.code)}>
                      <Text style={styles.saveText}>Simpan</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.gateName}>{g.name_id}</Text>
                  {!!g.description && <Text style={styles.gateDesc}>{g.description}</Text>}
                  <Text style={styles.codeLine}>Kode: {g.code} (tetap) · Urutan: {g.sort_order}</Text>

                  {gateSteps.length > 0 && (
                    <View style={styles.stepBox}>
                      <Text style={styles.subHead}>Langkah</Text>
                      {gateSteps.map((s) => (
                        <View key={s.code} style={styles.stepRow}>
                          <Text style={styles.stepLabel} numberOfLines={1}>{stepChipLabel(s, g)}</Text>
                          <Switch
                            value={s.active}
                            onValueChange={async () => {
                              const { error } = await updateGateStepRef(s.code, { active: !s.active });
                              if (error) Alert.alert('Gagal', error); else await load();
                            }}
                          />
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => void toggleActive(g)}>
                      <Text style={styles.cancelText}>{g.active ? 'Nonaktifkan' : 'Aktifkan'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.saveBtn} onPress={() => startEdit(g)}>
                      <Text style={styles.saveText}>Ubah</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Card>
          );
        })}

        {gates.length === 0 && (
          <Card>
            <Text style={styles.empty}>
              Belum ada data gerbang. Pastikan migrasi 096 sudah dijalankan di Supabase.
            </Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.xs,
  },
  hint: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 16, marginBottom: SPACE.md },
  gateName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  gateDesc: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 18 },
  codeLine: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm },
  label: { fontSize: TYPE.sm, fontFamily: FONTS.medium, color: COLORS.text, marginBottom: 6, marginTop: SPACE.sm + 2 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS,
    padding: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text,
  },
  inputMulti: { minHeight: 76 },
  subHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.4, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.xs,
  },
  stepBox: { marginTop: SPACE.md, paddingTop: SPACE.sm, borderTopWidth: 1, borderTopColor: COLORS.borderSub },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 2 },
  stepLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.base },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  cancelText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textSec },
  saveBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center' },
  saveText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.md },
});
```

- [ ] **Step 5: Mount the "Ruangan" tab in `office/navigation.tsx`**

Four edits. Add the lazy import after `EquipmentScreen` (`:18`):

```tsx
const RoomsAdminScreen = lazyScreen(() => import('./screens/RoomsAdminScreen'));
```

Add `Rooms: undefined;` to `OfficeTabParamList` after `Equipment` (`:30`). Add to all three maps (`ICON_MAP` `:45`, `ICON_MAP_ACTIVE` `:58`, `LABEL_MAP` `:71`), keeping the existing outline/solid pairing:

```tsx
  Rooms: 'business-outline',   // ICON_MAP
  Rooms: 'business',           // ICON_MAP_ACTIVE
  Rooms: 'Ruangan',            // LABEL_MAP
```

Add the screen after the `Equipment` tab (`:130`):

```tsx
        <Tab.Screen name="Rooms" component={RoomsAdminScreen} />
```

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit
npx jest --silent
git add office/screens/RoomsAdminScreen.tsx office/screens/GatesAdminScreen.tsx office/screens/rooms office/navigation.tsx
git commit -m "$(cat <<'MSG'
feat(office): Kelola ruangan + Kelola gerbang

Rooms grouped by floor with a live code preview, a paste importer that names
every line it drops, per-room active toggle, A4 label printing, DATUM JSON
export, and the project phase picker for office roles. setProjectPhase reads the
row back, because RLS silently filters an update by an unassigned estimator.

Gate codes are displayed read-only; only labels, descriptions, order and the
active flag are editable, matching the 096 trigger.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Deep links - dependencies, `app.json`, `assetlinks.json`, `vercel.json`, linking config

**Files:** modify `package.json`, `app.json`, `vercel.json`, `workflows/navigation.tsx`, `office/navigation.tsx`, `office/PrincipalNavigation.tsx`; create `workflows/linking.ts`, `public/.well-known/assetlinks.json`.

- [ ] **Step 1: Install the native dependencies**

```bash
npx expo install expo-linking expo-camera
```

Expected: both added to `package.json` at the versions Expo SDK 54 pins (`expo-camera` ~17.x, `expo-linking` ~8.x). `expo install` picks the SDK-compatible version; plain `npm install` does not. Confirm:

```bash
node -e "const p=require('./package.json').dependencies; console.log(p['expo-camera'], p['expo-linking'], p['qrcode'])"
```

These are **native** modules. They do not reach a device through `eas update`; task 13 builds a new APK.

- [ ] **Step 2: `app.json`**

Add the top-level `scheme`, the camera plugin, and the Android intent filter. The full `expo` object after the edit (three changed regions marked):

```json
{
  "expo": {
    "name": "SANO",
    "slug": "san-contractor-supervisor",
    "version": "3.0.1",
    "scheme": "sano",
    "icon": "./assets/icon.png",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#D2D0C4"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.sancontractor.supervisor",
      "infoPlist": {
        "NSCameraUsageDescription": "Camera digunakan untuk foto bukti material dan progres.",
        "NSLocationWhenInUseUsageDescription": "Lokasi digunakan untuk verifikasi GPS pada foto penerimaan material."
      }
    },
    "android": {
      "package": "com.sancontractor.supervisor",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#D2D0C4"
      },
      "permissions": [
        "android.permission.CAMERA",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_COARSE_LOCATION"
      ],
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "sano-app.vercel.app",
              "pathPrefix": "/r"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    "updates": {
      "url": "https://u.expo.dev/30991bf9-4ebe-42a1-8daf-69d631fcad86"
    },
    "runtimeVersion": {
      "policy": "appVersion"
    },
    "plugins": [
      "expo-image-picker",
      "expo-location",
      "expo-asset",
      "expo-font",
      "expo-camera"
    ],
    "extra": {
      "eas": {
        "projectId": "30991bf9-4ebe-42a1-8daf-69d631fcad86"
      },
      "sanoBoqRecipeDetail": false
    }
  }
}
```

`scheme: "sano"` also gives iOS its release-1 path: universal links need an Apple Developer team SANO does not have (spec §18 item 6), so iOS gets the custom scheme only.

- [ ] **Step 3: `public/.well-known/assetlinks.json`**

`public/` does not exist yet; create it. `expo export --platform web` copies everything under `public/` into `dist/`, which is what Vercel serves.

```bash
mkdir -p public/.well-known
```

Create `public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.sancontractor.supervisor",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_SHA256_FROM_EAS_CREDENTIALS"
      ]
    }
  }
]
```

**The fingerprint must be pasted in before this file is deployed.** Get it with:

```bash
eas credentials -p android
```

Choose the project's Android build credentials and read the line labelled **"Keystore: SHA256 Fingerprint"** - a colon-separated hex string such as `AB:CD:12:...`. Paste that exact string (colons included, uppercase) in place of `REPLACE_WITH_SHA256_FROM_EAS_CREDENTIALS`. Until it is real, Android App Link verification fails and `https://sano-app.vercel.app/r/...` opens the browser instead of the app - the `sano://` scheme and the in-app scanner still work, so this is a degraded state, not a broken one. Do not invent a fingerprint to make the file look finished.

- [ ] **Step 4: `vercel.json`**

The existing catch-all rewrite is not a hazard: Vercel reserves `/.well-known` and the filesystem wins over rewrites. The header is still required - Android refuses an `assetlinks.json` served as anything but `application/json`. Full file after the edit:

```json
{
  "installCommand": "npm install --legacy-peer-deps",
  "buildCommand": "npx expo export --platform web",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/.well-known/assetlinks.json",
      "headers": [
        { "key": "Content-Type", "value": "application/json" }
      ]
    }
  ]
}
```

- [ ] **Step 5: Verify the export actually carries the file**

```bash
npx expo export --platform web && ls dist/.well-known
```

Expected: `assetlinks.json`. If the directory is missing, the `public/` convention is not active on this Expo version - fall back to a `vercel.json` rewrite from `/.well-known/assetlinks.json` to a file you place under `dist/` in the build command, and record the change. This check matters because CI never runs `expo export` (`.github/workflows/ci.yml:70-80`), so a web-only breakage reaches Vercel unseen.

- [ ] **Step 6: `workflows/linking.ts`**

```ts
// SANO - React Navigation deep-link config, shared by all three containers.
//
// One URL shape (tools/roomLinks.ts) resolving to a different screen per role:
// a supervisor lands on the room itself, office and principal land on a
// read-only detail. Spec §8.
//
// Only the routes that need a path are declared. React Navigation 6 does NOT
// leave the others path-less: its getPathFromState falls back to the route
// name, so switching tabs on web would rewrite the address bar to /Permintaan,
// /Home and so on (verified 2026-09-10 against @react-navigation/core 6.4.17).
// This app had no linking config before, so its address bar never changed. The
// getPathFromState override below keeps it that way for every route that is not
// a declared, non-root link.
//
// Cold start before login: App.tsx renders LoginScreen and mounts no
// NavigationContainer, so the URL is not consumed. On web it stays in the
// address bar and resolves when the container mounts after sign-in; on native
// Linking.getInitialURL() still returns it at that point. No extra machinery.

import { getPathFromState as defaultGetPathFromState } from '@react-navigation/native';
import type { LinkingOptions } from '@react-navigation/native';
import { ROOM_LINK_HTTPS_PREFIX, ROOM_LINK_SCHEME_PREFIX } from '../tools/roomLinks';

export const LINKING_PREFIXES = [ROOM_LINK_HTTPS_PREFIX, ROOM_LINK_SCHEME_PREFIX];

/** The path pattern every container maps to its own room screen. */
export const ROOM_PATH = 'r/:projectCode/:roomCode';

type NavState = Parameters<typeof defaultGetPathFromState>[0];
type PathOptions = Parameters<typeof defaultGetPathFromState>[1];

/** Name of the deepest focused route, walking nested navigator state. */
export function focusedRouteName(state: NavState | undefined): string | undefined {
  let current: any = state;
  let name: string | undefined;
  while (current && Array.isArray(current.routes) && current.routes.length > 0) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    name = route.name;
    current = route.state;
  }
  return name;
}

export function buildLinking<T extends object>(
  screens: Record<string, string>,
): LinkingOptions<T> {
  const linked = new Set(Object.keys(screens).filter((name) => screens[name] !== ''));
  return {
    prefixes: [...LINKING_PREFIXES],
    config: { screens },
    getPathFromState(state: NavState, options?: PathOptions) {
      const leaf = focusedRouteName(state);
      return leaf !== undefined && linked.has(leaf) ? defaultGetPathFromState(state, options) : '/';
    },
  } as LinkingOptions<T>;
}
```

- [ ] **Step 7: Wire the three containers**

`workflows/navigation.tsx` - add the import beside the others and build the config above the component:

```tsx
import { buildLinking, ROOM_PATH } from './linking';

const linking = buildLinking<TabParamList>({
  Beranda:  '',
  RoomScan: 'scan',
  Room:     ROOM_PATH,
});
```

then change the container at `:63`:

```tsx
    <NavigationContainer ref={navigationRef} linking={linking}>
```

`office/navigation.tsx` - same shape, landing on the read-only detail:

```tsx
import { buildLinking, ROOM_PATH } from '../workflows/linking';

const linking = buildLinking<OfficeTabParamList>({
  Home:       '',
  RoomDetail: ROOM_PATH,
});
```

and at `:92`:

```tsx
    <NavigationContainer ref={navigationRef} linking={linking}>
```

`office/PrincipalNavigation.tsx` - identical, with its own param list:

```tsx
import { buildLinking, ROOM_PATH } from '../workflows/linking';

const linking = buildLinking<PrincipalTabParamList>({
  Home:       '',
  RoomDetail: ROOM_PATH,
});
```

and at `:62`:

```tsx
    <NavigationContainer ref={navigationRef} linking={linking}>
```

The `RoomScan`, `Room` and `RoomDetail` routes are registered in task 11; until then `tsc` will flag the unknown keys, which is the correct order - the config is what task 11's screens have to satisfy.

- [ ] **Step 8: Do not commit yet**

`workflows/navigation.tsx` now references `RoomScan` and `Room`, and both office
containers reference `RoomDetail`, none of which exist until task 11. `tsc` will
fail here, and that is the correct order: the linking config is the contract
task 11's screens have to satisfy. Everything from this task is committed
together with task 11, in its step 7.

---

### Task 11: Supervisor screens - scanner, room landing, picker, and the office detail

**Files:**
- Create: `workflows/screens/components/RoomPicker.tsx`, `workflows/screens/RoomScanScreen.tsx`, `workflows/screens/RoomScreen.tsx`, `office/screens/RoomDetailScreen.tsx`
- Modify: `workflows/navigation.tsx`, `office/navigation.tsx`, `office/PrincipalNavigation.tsx`, `workflows/screens/BerandaScreen.tsx`, `workflows/screens/ProgresScreen.tsx`

- [ ] **Step 1: `workflows/screens/components/RoomPicker.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AREA_TYPE_LABELS } from '../../../tools/constants';
import type { Room } from '../../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../../theme';

interface Props {
  rooms: Room[];
  onSelect: (room: Room) => void;
  /** Shown above the list - why the picker is on screen. */
  note?: string;
}

/** The fallback for a missing, damaged or unprinted label (spec §5.1). */
export default function RoomPicker({ rooms, onSelect, note }: Props) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rooms;
    return rooms.filter((r) =>
      r.room_name.toLowerCase().includes(needle) ||
      (r.floor ?? '').toLowerCase().includes(needle) ||
      r.room_code.toLowerCase().includes(needle),
    );
  }, [rooms, q]);

  return (
    <View style={styles.wrap}>
      {!!note && <Text style={styles.note}>{note}</Text>}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.search} value={q} onChangeText={setQ}
          placeholder="Cari nama ruangan atau lantai" placeholderTextColor={COLORS.textMuted}
          accessibilityLabel="Cari ruangan"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>Tidak ada ruangan yang cocok.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onSelect(item)} accessibilityRole="button">
            <View style={styles.rowMeta}>
              <Text style={styles.rowName} numberOfLines={1}>{item.room_name}</Text>
              <Text style={styles.rowSub}>
                {(item.floor || 'Tanpa lantai')} · {AREA_TYPE_LABELS[item.area_type]} · {item.room_code}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  note: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginBottom: SPACE.sm, lineHeight: 18 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS, paddingHorizontal: SPACE.md, marginBottom: SPACE.sm,
  },
  search: { flex: 1, paddingVertical: SPACE.md, fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: COLORS.borderSub,
  },
  rowMeta: { flex: 1 },
  rowName: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.text },
  rowSub: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 1 },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.lg },
});
```

- [ ] **Step 2: `workflows/screens/RoomScanScreen.tsx`**

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import RoomPicker from './components/RoomPicker';
import { useProject } from '../hooks/useProject';
import { useToast } from '../components/Toast';
import { parseRoomUrl } from '../../tools/roomLinks';
import { listRooms } from '../../tools/rooms';
import type { Room } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../theme';

/**
 * Two ways to reach a room without a working label: the in-app scanner (native)
 * and the picker (web, and native when permission is refused). A QR that is not
 * a SANO room URL gets the spec §8 refusal, never a silent no-op.
 */
export default function RoomScanScreen() {
  const navigation = useNavigation<any>();
  const { project } = useProject();
  const { show: toast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [rooms, setRooms] = useState<Room[]>([]);
  // One scan per visit: CameraView fires onBarcodeScanned on every frame.
  const handled = useRef(false);

  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    if (!project) return;
    void listRooms(project.id).then(setRooms);
  }, [project]);

  const goToRoom = useCallback((projectCode: string, roomCode: string) => {
    navigation.navigate('Room', { projectCode, roomCode });
  }, [navigation]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (handled.current) return;
    const target = parseRoomUrl(data);
    if (!target) {
      handled.current = true;
      toast('QR bukan label ruangan SANO.', 'critical');
      // Let the supervisor try again on the next label after a beat.
      setTimeout(() => { handled.current = false; }, 1500);
      return;
    }
    handled.current = true;
    goToRoom(target.projectCode, target.roomCode);
  }, [goToRoom, toast]);

  const pickerNote = isWeb
    ? 'Pemindai QR hanya tersedia di aplikasi Android. Pilih ruangan dari daftar.'
    : 'Pilih ruangan dari daftar bila labelnya hilang atau rusak.';

  return (
    <View style={styles.flex}>
      <Header />
      <View style={styles.content}>
        <Text style={styles.sectionHead}>Scan ruangan</Text>

        {!isWeb && permission?.granted && (
          <View style={styles.cameraBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
            />
            <View style={styles.reticle} pointerEvents="none" />
          </View>
        )}

        {!isWeb && !permission?.granted && (
          <View style={styles.permBox}>
            <Ionicons name="camera-outline" size={28} color={COLORS.textSec} />
            <Text style={styles.permText}>
              SANO perlu izin kamera untuk memindai label QR ruangan.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestPermission()}>
              <Text style={styles.primaryText}>Izinkan kamera</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.pickerBox}>
          <RoomPicker
            rooms={rooms}
            note={pickerNote}
            onSelect={(r) => project && goToRoom(project.code, r.room_code)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, padding: SPACE.base },
  sectionHead: {
    fontSize: TYPE.xs, fontFamily: FONTS.semibold, letterSpacing: 0.6, textTransform: 'uppercase',
    color: COLORS.textSec, marginBottom: SPACE.sm,
  },
  cameraBox: { height: 260, borderRadius: RADIUS, overflow: 'hidden', backgroundColor: COLORS.primary, marginBottom: SPACE.base },
  reticle: {
    position: 'absolute', top: '20%', left: '20%', right: '20%', bottom: '20%',
    borderWidth: 2, borderColor: COLORS.textInverse, borderRadius: RADIUS,
  },
  permBox: { alignItems: 'center', gap: SPACE.sm, padding: SPACE.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS, marginBottom: SPACE.base },
  permText: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', lineHeight: 18 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.lg },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickerBox: { flex: 1 },
});
```

- [ ] **Step 3: `workflows/screens/RoomScreen.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Header from '../components/Header';
import Card from '../components/Card';
import { useProject } from '../hooks/useProject';
import { listRooms } from '../../tools/rooms';
import { listGateRefs, gateChipLabel } from '../../tools/gateRefs';
import { normalizeRoomCode } from '../../tools/roomCodes';
import { AREA_TYPE_LABELS, PROJECT_PHASE_LABELS } from '../../tools/constants';
import type { GateRef, Room } from '../../tools/types';
import { COLORS, FONTS, RADIUS, SPACE, TYPE } from '../theme';

type Refusal = 'not-assigned' | 'not-found' | 'inactive';

const REFUSAL_COPY: Record<Refusal, string> = {
  'not-assigned': 'Anda tidak ditugaskan ke proyek ini.',
  'not-found':    'Ruangan ini tidak ditemukan di proyek tersebut. Periksa labelnya atau hubungi kantor.',
  'inactive':     'Ruangan ini sudah tidak aktif. Hubungi kantor.',
};

/**
 * Where a scanned label lands. Release 1 shows the room and stops there: event
 * capture is plan 2. Every failure is one of the three explicit refusals from
 * spec §8 - a blank screen would be the worst possible answer to a supervisor
 * standing in the room holding a phone.
 */
export default function RoomScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { projects, project, setActiveProject } = useProject();
  const params = (route.params ?? {}) as { projectCode?: string; roomCode?: string };

  const [room, setRoom] = useState<Room | null>(null);
  const [gates, setGates] = useState<GateRef[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [loading, setLoading] = useState(true);

  const wantedCode = normalizeRoomCode(params.roomCode ?? '');
  const target = projects.find(
    (p) => p.code.toLowerCase() === (params.projectCode ?? '').toLowerCase(),
  );

  // Switch the whole app to the scanned project so Header, and everything else
  // reading useProject(), agree with what is on screen.
  useEffect(() => {
    if (target && target.id !== project?.id) setActiveProject(target.id);
  }, [target, project?.id, setActiveProject]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setRefusal(null);
      if (!target) {
        if (alive) { setRefusal('not-assigned'); setLoading(false); }
        return;
      }
      const [all, g] = await Promise.all([
        listRooms(target.id, { includeInactive: true }),
        listGateRefs({ activeOnly: true }),
      ]);
      if (!alive) return;
      const found = all.find((r) => r.room_code === wantedCode) ?? null;
      setRoom(found);
      setGates(g);
      if (!found) setRefusal('not-found');
      else if (!found.active) setRefusal('inactive');
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [target, wantedCode]);

  const phaseLabel = target ? PROJECT_PHASE_LABELS[target.phase] ?? target.phase : '';

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Beranda')}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          <Text style={styles.backText}>Beranda</Text>
        </TouchableOpacity>

        {loading && <Card><Text style={styles.empty}>Memuat ruangan…</Text></Card>}

        {!loading && refusal && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.refusal}>{REFUSAL_COPY[refusal]}</Text>
            <Text style={styles.refusalMeta}>
              Kode dipindai: {params.projectCode ?? '—'} / {wantedCode || '—'}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('RoomScan')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Pilih ruangan lain</Text>
            </TouchableOpacity>
          </Card>
        )}

        {!loading && !refusal && room && (
          <>
            <Card>
              <Text style={styles.roomName}>{room.room_name}</Text>
              <Text style={styles.roomMeta}>
                {(room.floor || 'Tanpa lantai')} · {AREA_TYPE_LABELS[room.area_type]}
              </Text>
              <View style={styles.phasePill}>
                <Text style={styles.phaseText}>Fase {phaseLabel}</Text>
              </View>
              <Text style={styles.roomCode}>{room.room_code}</Text>
            </Card>

            <Card title="Gerbang finishing" subtitle="Tahapan pekerjaan yang dikenali sistem.">
              <View style={styles.chipRow}>
                {gates.map((g) => (
                  <View key={g.code} style={styles.chip}>
                    <Text style={styles.chipText}>{gateChipLabel(g)}</Text>
                  </View>
                ))}
              </View>
              {gates.length === 0 && (
                <Text style={styles.empty}>Data gerbang belum tersedia. Hubungi kantor.</Text>
              )}
            </Card>

            <Card>
              <Text style={styles.emptyHead}>Belum ada kejadian di ruangan ini</Text>
              <Text style={styles.emptyBody}>
                Pelaporan kejadian - foto, suara dan catatan - menyusul pada pembaruan berikutnya.
                Untuk sekarang gunakan Progres dan Catatan Perubahan seperti biasa.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginBottom: SPACE.sm },
  backText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.text },
  roomName: { fontSize: TYPE.xl, fontFamily: FONTS.bold, color: COLORS.text },
  roomMeta: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: 2 },
  phasePill: {
    alignSelf: 'flex-start', marginTop: SPACE.sm, paddingVertical: 3, paddingHorizontal: SPACE.sm,
    borderRadius: RADIUS, backgroundColor: COLORS.accentBg,
  },
  phaseText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.accentDark },
  roomCode: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm, letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS, paddingVertical: 5, paddingHorizontal: SPACE.sm + 2 },
  chipText: { fontSize: TYPE.xs, fontFamily: FONTS.semibold, color: COLORS.text },
  refusal: { fontSize: TYPE.base, fontFamily: FONTS.medium, color: COLORS.critical, lineHeight: 21 },
  refusalMeta: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS, padding: SPACE.md, alignItems: 'center', marginTop: SPACE.base },
  primaryText: { fontSize: TYPE.sm, fontFamily: FONTS.semibold, color: COLORS.textInverse, textTransform: 'uppercase', letterSpacing: 0.4 },
  emptyHead: { fontSize: TYPE.base, fontFamily: FONTS.semibold, color: COLORS.text },
  emptyBody: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.xs, lineHeight: 19 },
  empty: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, textAlign: 'center', paddingVertical: SPACE.md },
});
```

- [ ] **Step 4: `office/screens/RoomDetailScreen.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import Header from '../../workflows/components/Header';
import Card from '../../workflows/components/Card';
import { useProject } from '../../workflows/hooks/useProject';
import { listRooms } from '../../tools/rooms';
import { normalizeRoomCode } from '../../tools/roomCodes';
import { buildRoomUrl } from '../../tools/roomLinks';
import { AREA_TYPE_LABELS, PROJECT_PHASE_LABELS } from '../../tools/constants';
import type { Room } from '../../tools/types';
import { COLORS, FONTS, SPACE, TYPE } from '../../workflows/theme';

/**
 * Where a scanned label lands for admin, estimator and principal: read-only.
 * Office roles author rooms in "Kelola ruangan"; this screen exists so a
 * scanned QR does something sensible in every role rather than dead-ending.
 */
export default function RoomDetailScreen() {
  const route = useRoute<any>();
  const { projects } = useProject();
  const params = (route.params ?? {}) as { projectCode?: string; roomCode?: string };

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);

  const wantedCode = normalizeRoomCode(params.roomCode ?? '');
  const target = projects.find(
    (p) => p.code.toLowerCase() === (params.projectCode ?? '').toLowerCase(),
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (!target) { if (alive) { setRoom(null); setLoading(false); } return; }
      const all = await listRooms(target.id, { includeInactive: true });
      if (!alive) return;
      setRoom(all.find((r) => r.room_code === wantedCode) ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [target, wantedCode]);

  return (
    <View style={styles.flex}>
      <Header />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {loading && <Card><Text style={styles.body}>Memuat ruangan…</Text></Card>}

        {!loading && !target && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.body}>
              Proyek dengan kode "{params.projectCode ?? '—'}" tidak ditemukan.
            </Text>
          </Card>
        )}

        {!loading && target && !room && (
          <Card borderColor={COLORS.critical}>
            <Text style={styles.body}>
              Ruangan {wantedCode || '—'} tidak ada di proyek {target.name}. Periksa di "Kelola ruangan".
            </Text>
          </Card>
        )}

        {!loading && target && room && (
          <Card title={room.room_name} subtitle={`${room.floor || 'Tanpa lantai'} · ${AREA_TYPE_LABELS[room.area_type]}`}>
            <Text style={styles.row}>Proyek: {target.name} ({target.code})</Text>
            <Text style={styles.row}>Fase: {PROJECT_PHASE_LABELS[target.phase] ?? target.phase}</Text>
            <Text style={styles.row}>Kode ruangan: {room.room_code}</Text>
            <Text style={styles.row}>Status: {room.active ? 'Aktif' : 'Nonaktif'}</Text>
            <Text style={styles.row}>
              Label QR: {room.qr_printed_at ? `tercetak ${new Date(room.qr_printed_at).toLocaleDateString('id-ID')}` : 'belum dicetak'}
            </Text>
            <Text style={styles.url}>{buildRoomUrl(target.code, room.room_code)}</Text>
            <Text style={styles.note}>
              Kelola ruangan ini dari tab Ruangan. Riwayat kejadian menyusul pada pembaruan berikutnya.
            </Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  content: { padding: SPACE.base, paddingBottom: SPACE.xxxl },
  body: { fontSize: TYPE.base, fontFamily: FONTS.regular, color: COLORS.textSec, lineHeight: 20 },
  row: { fontSize: TYPE.sm, fontFamily: FONTS.regular, color: COLORS.text, paddingVertical: 2 },
  url: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: SPACE.sm },
  note: { fontSize: TYPE.xs, fontFamily: FONTS.regular, color: COLORS.textSec, marginTop: SPACE.md, lineHeight: 16 },
});
```

- [ ] **Step 5: Register the screens as hidden tabs**

`workflows/navigation.tsx` - lazy imports beside the others (`:17`):

```tsx
const RoomScanScreen = lazyScreen(() => import('./screens/RoomScanScreen'));
const RoomScreen = lazyScreen(() => import('./screens/RoomScreen'));
```

`TabParamList` (`:19-26`) gains:

```tsx
  RoomScan:   undefined;
  Room:       { projectCode: string; roomCode: string };
```

`ICON_MAP` and `ICON_MAP_ACTIVE` gain entries. They are never rendered for a hidden tab, but `screenOptions` looks every route name up on every render and an undefined `name` prop on `Ionicons` is a warning waiting to happen:

```tsx
  RoomScan:   'qr-code-outline',   // ICON_MAP
  Room:       'business-outline',
  RoomScan:   'qr-code',           // ICON_MAP_ACTIVE
  Room:       'business',
```

Then the two screens, after the hidden `Notifikasi` block (`:129`), using the same hide pattern:

```tsx
        {/* Reached by QR scan, deep link, or the Beranda card - never a tab. */}
        <Tab.Screen
          name="RoomScan"
          component={RoomScanScreen}
          options={{
            tabBarAccessibilityLabel: 'Scan ruangan',
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
          }}
        />
        <Tab.Screen
          name="Room"
          component={RoomScreen}
          options={{
            tabBarAccessibilityLabel: 'Ruangan',
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
          }}
        />
```

`office/navigation.tsx` - lazy import, `RoomDetail: { projectCode: string; roomCode: string };` on `OfficeTabParamList`, `RoomDetail: 'business-outline'` / `'business'` / `'Ruangan'` in the three maps, and after the `Rooms` tab:

```tsx
const RoomDetailScreen = lazyScreen(() => import('./screens/RoomDetailScreen'));
```

```tsx
        <Tab.Screen name="RoomDetail" component={RoomDetailScreen} options={{ tabBarButton: () => null }} />
```

`office/PrincipalNavigation.tsx` - the same three map entries, `RoomDetail: { projectCode: string; roomCode: string };` on `PrincipalTabParamList`, plus:

```tsx
const RoomDetailScreen = lazyScreen(() => import('./screens/RoomDetailScreen'));
```

```tsx
        <Tab.Screen name="RoomDetail" component={RoomDetailScreen} options={{ tabBarButton: () => null }} />
```

- [ ] **Step 6: Entry points on Beranda and Progres**

`workflows/screens/BerandaScreen.tsx` - insert directly after the "Progress Proyek" card (which closes at `:141`), before the `{/* ── Control alerts ── */}` comment:

```tsx
        {/* ── Scan ruangan ──────────────────────────────────────────────── */}
        <Card title="Ruangan" borderColor={COLORS.info}>
          <Text style={styles.alertBody}>
            Pindai label QR di pintu ruangan untuk membukanya langsung.
          </Text>
          <TouchableOpacity
            style={styles.alertBtn}
            onPress={() => navigation.navigate('RoomScan')}
            accessibilityLabel="Scan ruangan"
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="qr-code-outline" size={16} color={COLORS.text} />
            <Text style={styles.alertBtnText}>Scan Ruangan</Text>
          </TouchableOpacity>
        </Card>
```

Check the exact style names on the neighbouring alert cards (`styles.alertBody`, `styles.alertBtn`, and whatever the button label style is called) and reuse them verbatim rather than adding new ones.

`workflows/screens/ProgresScreen.tsx` - add a third entry to the hub grid at `:337-340`:

```tsx
              {([
                { key: 'progress' as SubModule, icon: 'trending-up', label: 'Tambah Progres', color: COLORS.accent },
                { key: 'perubahan' as SubModule, icon: 'create', label: 'Catatan Perubahan', color: COLORS.warning },
                { key: 'ruangan' as const, icon: 'qr-code', label: 'Ruangan', color: COLORS.info },
              ]).map(btn => (
```

and make the press handler route the new key out to the navigator instead of switching sub-module, since `Room`/`RoomScan` live in the tab navigator, not inside this screen:

```tsx
                  onPress={() => {
                    if (btn.key === 'ruangan') navigation.navigate('RoomScan');
                    else setActiveModule(btn.key as SubModule);
                  }}
```

`ProgresScreen` does not currently import `useNavigation`; add it beside the existing `@react-navigation/native` imports, or if there are none, add:

```tsx
import { useNavigation } from '@react-navigation/native';
```

and inside the component: `const navigation = useNavigation<any>();`

- [ ] **Step 7: Type-check, run the suite, and commit tasks 10 and 11 together**

```bash
npx tsc --noEmit
npx jest --silent
git add package.json package-lock.json app.json vercel.json \
        public/.well-known/assetlinks.json workflows/linking.ts \
        workflows/screens/RoomScreen.tsx workflows/screens/RoomScanScreen.tsx \
        workflows/screens/components/RoomPicker.tsx office/screens/RoomDetailScreen.tsx \
        workflows/navigation.tsx office/navigation.tsx office/PrincipalNavigation.tsx \
        workflows/screens/BerandaScreen.tsx workflows/screens/ProgresScreen.tsx
git commit -m "$(cat <<'MSG'
feat(rooms): QR scanner, supervisor RoomScreen, office RoomDetail

RoomScreen is where a scanned label lands: it resolves the project code against
the user's own visible projects and gives one of the three explicit spec §8
refusals when it cannot - unassigned project, unknown room, inactive room.
Release 1 stops at the room header and an empty state; capture is plan 2.

The scanner falls back to a searchable picker on web and whenever camera
permission is refused, so a missing or damaged label never blocks anyone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: Routing test

**Files:** create `workflows/__tests__/linking.test.ts`.

`workflows/__tests__/` does not exist yet; jest's default `testMatch` picks up anything under a `__tests__` directory, so no config change is needed. `getStateFromPath` **is** available from `@react-navigation/native` on the installed version 6.1.18 - it re-exports `@react-navigation/core`, which owns it - and it resolves under jest without a transform (verified: `@react-navigation/*` ships CommonJS, and the type-only `LinkingOptions` import in `workflows/linking.ts` is erased). No react-native module is loaded by this suite.

- [ ] **Step 1: Write the failing test**

Create `workflows/__tests__/linking.test.ts`:

```ts
/**
 * One printed URL, three navigators. A supervisor lands on the room; office and
 * principal land on the read-only detail. If a container's config drifts, a
 * physical label stops working for that role and nobody finds out until someone
 * is standing in the room, so this asserts the real path against the real
 * resolver rather than just the object shape.
 */
import { getStateFromPath } from '@react-navigation/native';
import { buildLinking, LINKING_PREFIXES, ROOM_PATH } from '../linking';

const SUPERVISOR = { Beranda: '', RoomScan: 'scan', Room: ROOM_PATH };
const OFFICE     = { Home: '', RoomDetail: ROOM_PATH };
const PRINCIPAL  = { Home: '', RoomDetail: ROOM_PATH };

describe('buildLinking', () => {
  it('accepts both the https origin and the custom scheme', () => {
    expect(LINKING_PREFIXES).toEqual(['https://sano-app.vercel.app', 'sano://']);
    expect(buildLinking(SUPERVISOR).prefixes).toEqual(LINKING_PREFIXES);
  });

  it('passes the screen map straight through', () => {
    expect(buildLinking(SUPERVISOR).config).toEqual({ screens: SUPERVISOR });
    expect(buildLinking(OFFICE).config).toEqual({ screens: OFFICE });
  });

  it('gives every container the SAME path pattern', () => {
    expect(SUPERVISOR.Room).toBe(ROOM_PATH);
    expect(OFFICE.RoomDetail).toBe(ROOM_PATH);
    expect(PRINCIPAL.RoomDetail).toBe(ROOM_PATH);
  });
});

describe('getStateFromPath - the printed URL resolves per role', () => {
  const path = '/r/GA17/L2-KM-UTAMA';

  it('routes a supervisor to Room with both params', () => {
    expect(getStateFromPath(path, buildLinking(SUPERVISOR).config)).toEqual({
      routes: [{ name: 'Room', params: { projectCode: 'GA17', roomCode: 'L2-KM-UTAMA' }, path }],
    });
  });

  it('routes office and principal to RoomDetail', () => {
    for (const screens of [OFFICE, PRINCIPAL]) {
      const state = getStateFromPath(path, buildLinking(screens).config) as any;
      expect(state.routes[0].name).toBe('RoomDetail');
      expect(state.routes[0].params).toEqual({ projectCode: 'GA17', roomCode: 'L2-KM-UTAMA' });
    }
  });

  it('resolves the root path to the role home tab', () => {
    expect((getStateFromPath('/', buildLinking(SUPERVISOR).config) as any).routes[0].name).toBe('Beranda');
    expect((getStateFromPath('/', buildLinking(OFFICE).config) as any).routes[0].name).toBe('Home');
  });

  it('resolves the scanner path only for the supervisor', () => {
    expect((getStateFromPath('/scan', buildLinking(SUPERVISOR).config) as any).routes[0].name).toBe('RoomScan');
    expect(getStateFromPath('/scan', buildLinking(OFFICE).config)).toBeUndefined();
  });

  it('does not resolve a path with a missing segment', () => {
    expect(getStateFromPath('/r/GA17', buildLinking(SUPERVISOR).config)).toBeUndefined();
  });
});

describe('getPathFromState - the web address bar only carries declared links', () => {
  // Without the override React Navigation writes /Permintaan, /Home ... into
  // the address bar on every tab switch. Before this plan the bar never changed.
  it('keeps the room path and sends every undeclared tab to the root', () => {
    const linking = buildLinking(SUPERVISOR);
    const room = { index: 0, routes: [{ name: 'Room', params: { projectCode: 'GA17', roomCode: 'L2-KM' } }] };
    const tab  = { index: 0, routes: [{ name: 'Permintaan' }] };
    expect(linking.getPathFromState!(room as any, linking.config as any)).toBe('/r/GA17/L2-KM');
    expect(linking.getPathFromState!(tab as any, linking.config as any)).toBe('/');
  });
});
```

- [ ] **Step 2: Note the ordering, honestly**

This is the one task in the plan whose test follows its subject rather than
preceding it: `workflows/linking.ts` was written in task 10 step 6, because the
three containers could not be wired without it. `buildLinking` is a two-line
data structure, so the risk it carries is not initial correctness but **drift**:
a later edit to one container's screen map, silently breaking a physical label
for one role. That is what this suite guards, and it should pass on its first
run. If it fails on the first run, the containers and the config already
disagree; fix the config, not the test.

- [ ] **Step 3: Run it, expect PASS**

```bash
npx jest workflows/__tests__/linking.test.ts
```

Expected: `Tests: 9 passed, 9 total`. If `getStateFromPath` is undefined on your installed version, drop the second describe block to config-shape assertions only and note the version in the commit body - do not silently weaken the first block too.

- [ ] **Step 4: Commit**

```bash
git add workflows/__tests__/linking.test.ts
git commit -m "$(cat <<'MSG'
test(links): the printed URL resolves per role in all three navigators

Asserts against getStateFromPath with the real config, not just the object
shape: a drift in one container's screen map would otherwise only surface as a
label that silently does nothing for that role.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Final verification

**Files:** none new.

- [ ] **Step 1: Full suite**

```bash
npx jest --silent
```

Expected: every suite passes, including the eight new ones (`roomCodes`, `roomLinks`, `migration096`, `rooms`, `gateRefs`, `projectPhase`, `roomLabelsHtml`, `linking`). The prod-DB suites CI excludes (`serverGateEnforcement`, `materialLinkTrial`, `materialAliasesRls`, `publishBreakdownTrial`, `notificationDispatch`, `dump_real_parser_output`) run locally against the real project when `.env` is present - if one of them fails for an unrelated reason, confirm it fails on `main` too before treating it as this branch's problem.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: only the one pre-existing `workflows/App.tsx` error documented at `.github/workflows/ci.yml:50-54`. Anything else is this branch's and must be fixed, not marked `continue-on-error`.

- [ ] **Step 3: Web export - the check CI does not do**

```bash
npx expo export --platform web && ls dist/.well-known
```

Expected: the export completes and prints `assetlinks.json`. CI runs only `tsc` and `jest` (`.github/workflows/ci.yml:55-80`), never `expo export`, and MEMORY records the trap directly: an untracked or web-broken source file passes CI and fails only on Vercel. Also confirm nothing new is untracked:

```bash
git status --porcelain | grep -E '^\?\?' | grep -Ev '^\?\? (tmp/|outputs/|assets/|docs/audits/|sano-normalizer-kit)' || echo "no new untracked source files"
```

- [ ] **Step 4: Paste the migration, if not already done**

Task 3 step 6. Nothing that reads `gate_refs` or `rooms.area_type` works until it lands. Re-run self-checks 1 to 10 from the file footer.

- [ ] **Step 5: Put the real fingerprint in `assetlinks.json`, then deploy web**

**User-run.** Native deps and a new intent filter mean the App Link cannot be verified against a placeholder:

```bash
eas credentials -p android
```

Read the **"Keystore: SHA256 Fingerprint"** line, paste it into `public/.well-known/assetlinks.json`, commit, and merge so Vercel redeploys. Verify it is live and correctly typed:

```bash
curl -sI https://sano-app.vercel.app/.well-known/assetlinks.json | grep -i content-type
curl -s  https://sano-app.vercel.app/.well-known/assetlinks.json
```

Expected: `content-type: application/json` and the JSON with the real fingerprint.

- [ ] **Step 6: Build the APK**

**User-run.** `expo-camera` and `expo-linking` are native modules and the intent filter is a manifest change, so this needs a **build**, not an update:

```bash
eas build -p android --profile preview
```

`eas.json:11-13` puts that profile on channel `preview`, which is the channel the June-onwards supervisor APKs use. Later JS-only fixes to these screens ship with `eas update --branch preview`; this one cannot.

- [ ] **Step 7: The manual checks no unit test can stand in for (spec §14)**

- Print one A4 sheet and scan every code from a real phone at arm's length.
- On a device running the signed APK, open `https://sano-app.vercel.app/r/{code}/{room}` from a chat message: it must open SANO, not Chrome. If it opens Chrome, the fingerprint is wrong or the deploy has not propagated - Android caches verification, so reinstall the APK before concluding anything.
- Scan a non-SANO QR: expect exactly `QR bukan label ruangan SANO.`
- Sign in as a supervisor who is not on the project and open a label for it: expect `Anda tidak ditugaskan ke proyek ini.`
- Deactivate a room, then scan its label: expect `Ruangan ini sudah tidak aktif. Hubungi kantor.`
- Try to rename a printed room's code in the Dashboard: expect `ROOM_CODE_FROZEN`.

- [ ] **Step 8: Report**

Summarise for the user: migrations pasted and self-checked, suites green, export clean, APK build id and channel, the fingerprint's real value in place, and which of the step 7 manual checks were actually performed versus deferred. Do not report a manual check as done unless it was done on a real device.

---

## Self-review

Read this plan once more against the spec before starting, and check these specifically.

**Deviations from the spec, all deliberate and recorded in-plan:**

1. **`qrcode` instead of `react-native-qrcode-svg`** (task 8). The label sheet is an HTML string handed to `window.print()`, not a React tree. Spec §8's dependency list should be amended.
2. **Project phase is set by office roles, enforced by the database** (tasks 7 and 9). `projects` UPDATE passes for admin and principal on any project (`036:73-76`) and for an admin, principal or estimator assigned to the project (`023:58-60`, widened by `037`). The picker is offered to all three office roles, and `setProjectPhase` reads the row back so a user whose update RLS filtered is told the truth. Corrected by the orchestrator on 2026-09-10; the first draft said admin and principal only.
3. **No "Ruangan" tab for principal** (task 9 step 5). Spec §9 wants one for principal too, but that tab is the Papan Ruangan board, which is plan 4. Principal gets the hidden `RoomDetail` route now so a scanned label resolves in that role.
4. **`useProject` needed no query change** (task 7 step 4). The spec implies wiring; the hook already does `select('*')`. Only the comment changes, so the next reader does not narrow it.
5. **Linking config declares only the routes that need paths, and overrides `getPathFromState`.** React Navigation 6 falls back to route names for undeclared routes, so without the override every tab switch would rewrite the web address bar. The override keeps the bar at `/` except for declared links (task 10 step 6, tested in task 12). Corrected by the orchestrator on 2026-09-10.

**Things to check while executing:**

- Task 3 step 6 (pasting 096) is a hard prerequisite for tasks 6, 9 and 11. `listGateRefs` returns `[]` against a database without the table, which the Gates screen renders as "Pastikan migrasi 096 sudah dijalankan" rather than a crash - but do not mistake that empty state for a working feature.
- `tools/constants.ts` gains an `import type` from `tools/types.ts`, which type-imports from `constants.ts`. The cycle is type-only and erased at compile time, so there is no runtime cycle; if the TS version in use complains, invert it by declaring `ProjectPhase` and `AreaType` in `constants.ts` and re-exporting from `types.ts`, the way `UserRole` is already handled at `tools/types.ts:21`.
- `ROOM_CODE_MAX` appears in four places by design: `tools/roomCodes.ts`, the CHECK in 096, the form hint, and the paste-import warning. If DATUM ever changes the slice, all four move together.
- The `Room` route's `projectCode` is compared case-insensitively against `projects.code`; `parseRoomUrl` trims it but does not uppercase it, because project codes are the estimator's own strings.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
