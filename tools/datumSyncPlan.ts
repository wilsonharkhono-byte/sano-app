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
