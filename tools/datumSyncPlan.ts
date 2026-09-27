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
