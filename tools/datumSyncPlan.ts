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
/** 'code': a linked area whose code DATUM changed; the link is kept by id. */
export type ConflictField = 'code' | 'name' | 'floor' | 'area_type';
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
  /** Rooms (active or retired) linked to one of DATUM's areas, or whose code matches exactly one. */
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
  /** Status rows of areas no SANO room links to: counted, not stored. (Unknown gates or statuses are differences.gate_status_unknown.) */
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

/**
 * DATUM status rows SANO could not store, one line per gate and status: the
 * gate is not in gate_refs ('gate'), or the status is none of DATUM's six
 * readiness words ('status'). rows = how many such rows the read held.
 */
export interface GateStatusUnknownItem { gate_code: string; status: string; unknown: 'gate' | 'status'; rows: number }

/**
 * DATUM's per-item warning on a POST areas item that came back created: true
 * (e.g. its gate schedule, or its seed, did not run). Additive on DATUM's
 * side: never a reason to treat the create as failed, the area is still
 * created and the room still linked.
 */
export interface ScheduleWarningItem { area_code: string; code: string; reason: string }

/** datum_sync_runs.differences (spec §6.2). */
export interface RunDifferences {
  datum_only?: Array<{ area_code: string; area_name: string; floor: string | null; area_type: string }>;
  field_conflicts?: FieldConflict[];
  datum_duplicates?: DuplicateItem[];
  create_failed?: CreateFailedItem[];
  schedule_warnings?: ScheduleWarningItem[];
  import_skipped?: ImportSkip[];
  staff?: { unmatched: StaffNameItem[]; ambiguous: StaffAmbiguousItem[]; stale: StaffStaleItem[] };
  escalate_skipped?: EscalateSkipItem[];
  gate_words?: GateWordDiff[];
  gate_status_unknown?: GateStatusUnknownItem[];
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
export const codeHeldElsewhere = (code: string, holder: string): string =>
  `Area DATUM dengan kode ${code} sudah tertaut ke ruangan ${holder}. Samakan kodenya di SANO atau DATUM.`;

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

/**
 * A room linked to an area DATUM still has keeps that link, whatever the two
 * codes say now: DATUM staff may edit an area's code (updateArea), and
 * following the code would create a second area and leave the first, with its
 * history, as "only in DATUM". A different code is a `code` conflict. Only a
 * room with no link, or a link to an area DATUM no longer has, is matched by
 * code, and never to an area another room holds by link.
 */
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
  const byId = new Map(areas.map((a) => [a.id, a]));

  const coded = rooms.filter((r): r is PlanRoom & { room_code: string } => r.room_code !== null);
  const roomKeys = new Set(coded.map((r) => normalizeCode(r.room_code)));
  /** Area id -> the code of the first room whose link names it. */
  const holderOf = new Map<string, string>();
  for (const r of coded) {
    if (r.datum_area_id && byId.has(r.datum_area_id) && !holderOf.has(r.datum_area_id)) holderOf.set(r.datum_area_id, r.room_code);
  }

  const link: LinkItem[] = [];
  const createCandidates: Array<{ room: PlanRoom & { room_code: string }; refused: string | null }> = [];
  const fieldConflicts: FieldConflict[] = [];
  const retiredMissing: string[] = [];
  let matchedCount = 0;

  const compare = (room: PlanRoom & { room_code: string }, area: PlanArea): void => {
    if (normalizeCode(room.room_code) !== normalizeCode(area.area_code)) {
      fieldConflicts.push({ room_code: room.room_code, field: 'code', sano: room.room_code, datum: area.area_code });
    }
    if (foldText(room.room_name) !== foldText(area.area_name)) {
      fieldConflicts.push({ room_code: room.room_code, field: 'name', sano: room.room_name, datum: area.area_name });
    }
    if (foldText(room.floor) !== foldText(area.floor)) {
      fieldConflicts.push({ room_code: room.room_code, field: 'floor', sano: room.floor ?? '', datum: area.floor ?? '' });
    }
    if (room.area_type !== area.area_type) {
      fieldConflicts.push({ room_code: room.room_code, field: 'area_type', sano: room.area_type, datum: area.area_type });
    }
  };

  for (const room of coded) {
    const linked = room.datum_area_id ? byId.get(room.datum_area_id) : undefined;
    if (linked) {
      matchedCount += 1;
      compare(room, linked);
      continue;
    }
    const list = byKey.get(normalizeCode(room.room_code)) ?? [];
    if (list.length > 1) continue; // listed under datumDuplicates; neither linked nor created
    const area = list[0];
    if (!area) {
      if (room.active) createCandidates.push({ room, refused: null });
      else retiredMissing.push(room.room_code);
      continue;
    }
    const holder = holderOf.get(area.id);
    if (holder !== undefined) {
      // POST areas would hand back that same area, and two rooms would share it.
      if (room.active) createCandidates.push({ room, refused: codeHeldElsewhere(room.room_code, holder) });
      continue;
    }
    matchedCount += 1;
    link.push({ room_id: room.id, room_code: room.room_code, area_id: area.id });
    compare(room, area);
  }

  const create: CreateItem[] = [];
  const createFailed: CreateFailedItem[] = [];
  for (const { room, refused } of [...createCandidates].sort((a, b) => boardOrder(a.room, b.room))) {
    const code = room.room_code;
    if (refused) {
      createFailed.push({ room_code: code, reason: refused });
      continue;
    }
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
    if (holderOf.has(a.id)) continue;
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

// ─── The import (spec §6.3) ──────────────────────────────────────────────────

export const IMPORT_GONE = 'Sudah ada di SANO atau tidak lagi ada di DATUM.';
export const importBadCode = (code: string): string => `Kode DATUM ${code} tidak bisa menjadi kode ruangan SANO.`;
export const importBadType = (code: string, type: string): string => `Tipe area DATUM "${type}" untuk ${code} tidak dikenal SANO.`;
export const importNoName = (code: string): string => `Area DATUM ${code} tidak punya nama.`;
export const importRaced = (code: string): string => `Ruangan ${code} sudah dibuat di SANO sebelum impor selesai.`;

/**
 * DATUM's thirteen area types, the only values 107's rooms_area_type_check
 * accepts. tools/constants.ts AREA_TYPES, inlined: jest proves they agree.
 */
export const PLAN_AREA_TYPES: ReadonlyArray<string> = [
  'bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation',
  'utility', 'general', 'facade', 'terrace', 'hall', 'exterior',
];

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
    if (!PLAN_AREA_TYPES.includes(area.area_type)) {
      skipped.push({ area_code: code, reason: importBadType(area.area_code, area.area_type) });
      continue;
    }
    const roomName = area.area_name.trim();
    if (!roomName) {
      skipped.push({ area_code: code, reason: importNoName(area.area_code) });
      continue;
    }
    insert.push({
      area_id: area.area_id,
      area_code: area.area_code,
      room_code: roomCode,
      room_name: roomName,
      floor: area.floor,
      area_type: area.area_type,
      sort_order: area.sort_order,
    });
  }
  return { insert, skipped };
}

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
/** Another decision in a room whose area DATUM just answered UNKNOWN_AREA for: not sent again this run. */
export const ESCALATE_AREA_UNKNOWN = 'DATUM tidak mengenal area ruangan ini; dicoba lagi pada sinkron berikutnya.';

/** tools/roomLinks.ts buildRoomUrl, inlined: SANO has no web route to one event. */
export function sanoRoomUrl(projectCode: string, roomCode: string): string {
  return `https://sano-app.vercel.app/r/${encodeURIComponent(projectCode)}/${encodeURIComponent(roomCode)}`;
}

/** The reporter's DATUM account, else the confirmer's, else none (DATUM then uses SANO (sistem)). */
export function escalationAuthor(reporterStaffId: string | null, confirmerStaffId: string | null): string | null {
  return reporterStaffId ?? confirmerStaffId ?? null;
}
