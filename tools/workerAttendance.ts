/**
 * Worker Attendance Tools
 *
 * CRUD and RPC wrappers for per-worker daily attendance entries.
 * Lifecycle: DRAFT → SUBMITTED → CONFIRMED → SETTLED (on opname approval)
 *            DRAFT → SUBMITTED → OVERRIDDEN → SETTLED (admin dispute path)
 */

import { supabase } from './supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

export type AttendanceStatus = 'DRAFT' | 'SUBMITTED' | 'CONFIRMED' | 'OVERRIDDEN' | 'SETTLED';
export type AttendanceSource = 'manual' | 'attendance_app';

export interface WorkerAttendanceEntry {
  id: string;
  contract_id: string;
  project_id: string;
  worker_id: string;
  attendance_date: string;
  is_present: boolean;
  overtime_hours: number;
  daily_rate_snapshot: number;
  tier1_rate_snapshot: number;
  tier2_rate_snapshot: number;
  tier1_threshold_snapshot: number;
  tier2_threshold_snapshot: number;
  regular_pay: number;
  overtime_pay: number;
  day_total: number;
  status: AttendanceStatus;
  work_description: string | null;
  recorded_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  override_by: string | null;
  override_at: string | null;
  override_note: string | null;
  settled_in_opname_id: string | null;
  settled_at: string | null;
  source: AttendanceSource;
  app_validated: boolean;
  app_validated_at: string | null;
  is_locked: boolean;
  created_at: string;
  // Joined
  worker_name?: string;
  skill_level?: string;
}

export interface WorkerAttendanceWeekly {
  contract_id: string;
  mandor_name: string;
  project_id: string;
  week_start: string;
  worker_id: string;
  worker_name: string;
  skill_level: string;
  days_present: number;
  days_absent: number;
  total_overtime_hours: number;
  total_regular_pay: number;
  total_overtime_pay: number;
  total_pay: number;
  draft_count: number;
  submitted_count: number;
  confirmed_count: number;
  overridden_count: number;
  settled_count: number;
}

export interface BatchEntryInput {
  worker_id: string;
  is_present: boolean;
  overtime_hours: number;
  work_description?: string;
}

// ─── Queries ───────────────────────────────────────────────────────────────

/** Get attendance entries for a contract on a specific date */
export async function getAttendanceByDate(
  contractId: string,
  date: string,
): Promise<WorkerAttendanceEntry[]> {
  const { data } = await supabase
    .from('worker_attendance_entries')
    .select('*, mandor_workers(worker_name, skill_level)')
    .eq('contract_id', contractId)
    .eq('attendance_date', date)
    .order('created_at');

  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown> & { mandor_workers?: { worker_name: string; skill_level: string } };
    return {
      ...row,
      worker_name: r.mandor_workers?.worker_name,
      skill_level: r.mandor_workers?.skill_level,
      mandor_workers: undefined,
    };
  }) as WorkerAttendanceEntry[];
}

/** Get attendance entries for a contract in a date range (week view) */
export async function getAttendanceByWeek(
  contractId: string,
  weekStart: string,
  weekEnd: string,
): Promise<WorkerAttendanceEntry[]> {
  const { data } = await supabase
    .from('worker_attendance_entries')
    .select('*, mandor_workers(worker_name, skill_level)')
    .eq('contract_id', contractId)
    .gte('attendance_date', weekStart)
    .lte('attendance_date', weekEnd)
    .order('attendance_date')
    .order('created_at');

  return (data ?? []).map((row) => {
    const r = row as unknown as Record<string, unknown> & { mandor_workers?: { worker_name: string; skill_level: string } };
    return {
      ...row,
      worker_name: r.mandor_workers?.worker_name,
      skill_level: r.mandor_workers?.skill_level,
      mandor_workers: undefined,
    };
  }) as WorkerAttendanceEntry[];
}

/** Get weekly summary view */
export async function getWeeklySummary(
  contractId: string,
): Promise<WorkerAttendanceWeekly[]> {
  const { data } = await supabase
    .from('v_worker_attendance_weekly')
    .select('*')
    .eq('contract_id', contractId)
    .order('week_start', { ascending: false });
  return data ?? [];
}

/** Get unsettled worker attendance total for a contract */
export async function getUnsettledWorkerTotal(contractId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_unsettled_worker_attendance_total', {
    p_contract_id: contractId,
  });
  if (error) return 0;
  return data ?? 0;
}

// ─── Mutations (RPC wrappers) ──────────────────────────────────────────────

/** Record attendance for a single worker on a single day */
export async function recordWorkerAttendance(params: {
  contractId: string;
  workerId: string;
  attendanceDate: string;
  isPresent?: boolean;
  overtimeHours?: number;
  workDescription?: string;
}): Promise<{ data?: WorkerAttendanceEntry; error?: string }> {
  const rpcParams: Record<string, unknown> = {
    p_contract_id: params.contractId,
    p_worker_id: params.workerId,
    p_attendance_date: params.attendanceDate,
    p_is_present: params.isPresent ?? true,
    p_overtime_hours: params.overtimeHours ?? 0,
  };
  if (params.workDescription) rpcParams.p_work_description = params.workDescription;

  const { data, error } = await supabase.rpc('record_worker_attendance', rpcParams);
  if (error) return { error: error.message };
  return { data: data as WorkerAttendanceEntry };
}

/** Record attendance for all workers for one day (batch) */
export async function recordWorkerAttendanceBatch(params: {
  contractId: string;
  attendanceDate: string;
  entries: BatchEntryInput[];
}): Promise<{ count?: number; error?: string }> {
  const { data, error } = await supabase.rpc('record_worker_attendance_batch', {
    p_contract_id: params.contractId,
    p_attendance_date: params.attendanceDate,
    p_entries: params.entries,
  });
  if (error) return { error: error.message };
  return { count: data as number };
}

/** Confirm weekly attendance (supervisor, Mon-Sat) */
export async function confirmWeeklyAttendance(params: {
  contractId: string;
  weekStart: string;
}): Promise<{ count?: number; error?: string }> {
  const { data, error } = await supabase.rpc('confirm_weekly_attendance', {
    p_contract_id: params.contractId,
    p_week_start: params.weekStart,
  });
  if (error) return { error: error.message };
  return { count: data as number };
}

/** Supervisor confirms individual entry */
export async function supervisorConfirmEntry(
  entryId: string,
): Promise<{ data?: WorkerAttendanceEntry; error?: string }> {
  const { data, error } = await supabase.rpc('supervisor_confirm_attendance', {
    p_entry_id: entryId,
  });
  if (error) return { error: error.message };
  return { data: data as WorkerAttendanceEntry };
}

/** Admin/estimator override an entry */
export async function overrideAttendanceEntry(params: {
  entryId: string;
  overtimeHours?: number;
  isPresent?: boolean;
  overrideNote?: string;
}): Promise<{ data?: WorkerAttendanceEntry; error?: string }> {
  const rpcParams: Record<string, unknown> = {
    p_entry_id: params.entryId,
  };
  if (params.overtimeHours !== undefined) rpcParams.p_overtime_hours = params.overtimeHours;
  if (params.isPresent !== undefined) rpcParams.p_is_present = params.isPresent;
  if (params.overrideNote) rpcParams.p_override_note = params.overrideNote;

  const { data, error } = await supabase.rpc('override_attendance_entry', rpcParams);
  if (error) return { error: error.message };
  return { data: data as WorkerAttendanceEntry };
}

// ─── Harian Opname ─────────────────────────────────────────────────────────

/** Create a harian opname header for a given week */
export async function createHarianOpname(params: {
  contractId: string;
  weekNumber: number;
  opnameDate: string;
  weekStart: string;
  weekEnd: string;
}): Promise<{ data?: unknown; error?: string }> {
  const { data, error } = await supabase.rpc('create_harian_opname', {
    p_contract_id: params.contractId,
    p_week_number: params.weekNumber,
    p_opname_date: params.opnameDate,
    p_week_start: params.weekStart,
    p_week_end: params.weekEnd,
  });
  if (error) return { error: error.message };
  return { data };
}

/** Recompute harian opname totals from attendance */
export async function recomputeHarianOpname(
  headerId: string,
): Promise<{ data?: unknown; error?: string }> {
  const { data, error } = await supabase.rpc('recompute_harian_opname', {
    p_header_id: headerId,
  });
  if (error) return { error: error.message };
  return { data };
}

// ─── Formatting ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Diajukan',
  CONFIRMED: 'Dikonfirmasi',
  OVERRIDDEN: 'Di-override',
  SETTLED: 'Terpotong',
};

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  DRAFT: '#524E49',
  SUBMITTED: '#E65100',
  CONFIRMED: '#1565C0',
  OVERRIDDEN: '#6A1B9A',
  SETTLED: '#3D8B40',
};

export function attendanceStatusLabel(status: AttendanceStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function attendanceStatusColor(status: AttendanceStatus): string {
  return STATUS_COLORS[status] ?? '#524E49';
}

/** Format a pay preview string: "Rp 150.000 + Rp 25.000 OT = Rp 175.000" */
export function formatPayPreview(
  regularPay: number,
  overtimePay: number,
): string {
  const fmt = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  if (overtimePay > 0) {
    return `${fmt(regularPay)} + ${fmt(overtimePay)} OT = ${fmt(regularPay + overtimePay)}`;
  }
  return fmt(regularPay);
}

/** Returns local YYYY-MM-DD without UTC conversion (avoids midnight-UTC+7 off-by-one) */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * ISO dates for Mon..Sat (6 days) of the week starting at `weekStartISO`.
 * R19: Sunday is excluded from the payroll week and from the grid.
 */
export function getWeekDates(weekStartISO: string): string[] {
  const dates: string[] = [];
  const base = new Date(weekStartISO + 'T00:00:00');
  for (let i = 0; i < 6; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    dates.push(localISO(d));
  }
  return dates;
}

/** Get the Monday of the week containing a given date */
export function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return localISO(d);
}

/**
 * Get the Saturday of the week containing a given date.
 * R19: the payroll week is Mon–Sat, Sunday excluded — so week_end = week_start + 5.
 * This is what `confirm_weekly_attendance` (Mon–Sat) and the harian opname
 * `BETWEEN week_start AND week_end` range both expect.
 */
export function getWeekEnd(date: Date): string {
  const d = new Date(getWeekStart(date) + 'T00:00:00');
  d.setDate(d.getDate() + 5); // Monday + 5 = Saturday
  return localISO(d);
}

// ─── Tri-state attendance grid (pure logic — testable, no I/O) ──────────────
//
// U2-REVISED: presence must be EXPLICITLY marked; an absent worker is NEVER
// silently paid. A cell with no persisted entry starts 'unmarked' — it pays
// zero, is excluded from the save payload, and blocks the weekly Konfirmasi.

export const NORMAL_DAY_HOURS = 7; // R4: a normal day is always 7 h

export type CellPresence = 'unmarked' | 'present' | 'absent';

export interface GridCell {
  presence: CellPresence;
  overtimeHours: number;
  existingId?: string;
  status?: AttendanceStatus | string;
}

/** grid[workerId][dateISO] = GridCell */
export type PresenceGrid = Record<string, Record<string, GridCell>>;

export interface PersistedCell {
  id: string;
  is_present: boolean;
  overtime_hours: number;
  status: AttendanceStatus;
}

/** key `${workerId}|${date}` → PersistedCell */
export type PersistedMap = Record<string, PersistedCell>;

/** Minimal shape of a persisted entry the grid logic needs. */
export interface PersistedEntryInput {
  id: string;
  worker_id: string;
  attendance_date: string;
  is_present: boolean;
  overtime_hours: number;
  status: AttendanceStatus;
}

export function cellKey(workerId: string, date: string): string {
  return `${workerId}|${date}`;
}

/** Index persisted entries by (worker, date) — the DB truth for reconciliation. */
export function buildPersistedMap(entries: PersistedEntryInput[]): PersistedMap {
  const map: PersistedMap = {};
  for (const e of entries) {
    map[cellKey(e.worker_id, e.attendance_date)] = {
      id: e.id,
      is_present: e.is_present,
      overtime_hours: e.overtime_hours,
      status: e.status,
    };
  }
  return map;
}

/**
 * F5/R12: a persisted cell past DRAFT is office-controlled and locked in the
 * field — presence and OT are read-only; corrections happen via office override.
 */
export function isCellLocked(status?: string): boolean {
  return !!status && status !== 'DRAFT';
}

/** Tap cycle: unmarked → present → absent → present … (F3, keeps U1 tap speed). */
export function cyclePresence(current: CellPresence): CellPresence {
  return current === 'present' ? 'absent' : 'present';
}

/** Whether a cell holds an unsaved edit relative to what is persisted in the DB. */
export function isCellDirty(
  cell: Pick<GridCell, 'presence' | 'overtimeHours'>,
  persisted?: PersistedCell,
): boolean {
  if (cell.presence === 'unmarked') return false; // nothing to save
  const present = cell.presence === 'present';
  const ot = present ? (cell.overtimeHours ?? 0) : 0; // absent ⇒ OT 0 (R17)
  if (!persisted) return true; // marked but nothing persisted yet
  return persisted.is_present !== present || persisted.overtime_hours !== ot;
}

/** Build the initial grid: persisted cells map to present/absent, the rest start unmarked. */
export function buildInitialGrid(
  workerIds: string[],
  weekDates: string[],
  entries: PersistedEntryInput[],
): PresenceGrid {
  const map = buildPersistedMap(entries);
  const grid: PresenceGrid = {};
  for (const wid of workerIds) {
    grid[wid] = {};
    for (const date of weekDates) {
      const p = map[cellKey(wid, date)];
      grid[wid][date] = p
        ? {
            presence: p.is_present ? 'present' : 'absent',
            overtimeHours: p.overtime_hours,
            existingId: p.id,
            status: p.status,
          }
        : { presence: 'unmarked', overtimeHours: 0 };
    }
  }
  return grid;
}

/**
 * F4: after a save, reconcile the grid against a fresh DB read-back.
 * Cells whose day saved successfully adopt the persisted value (become clean).
 * Cells on a FAILED day keep the user's intended marks (stay dirty), so a
 * partial failure never silently loses edits and never reports fake success.
 */
export function reconcileGridAfterSave(
  prevGrid: PresenceGrid,
  workerIds: string[],
  weekDates: string[],
  freshEntries: PersistedEntryInput[],
  failedDates: Iterable<string>,
): PresenceGrid {
  const map = buildPersistedMap(freshEntries);
  const failed = new Set(failedDates);
  const next: PresenceGrid = {};
  for (const wid of workerIds) {
    next[wid] = {};
    for (const date of weekDates) {
      const persisted = map[cellKey(wid, date)];
      const prev: GridCell = prevGrid[wid]?.[date] ?? { presence: 'unmarked', overtimeHours: 0 };
      if (failed.has(date)) {
        // Save failed for this day → keep the user's marks (still dirty),
        // but carry any pre-existing persisted status/id.
        next[wid][date] = {
          ...prev,
          status: persisted?.status ?? prev.status,
          existingId: persisted?.id ?? prev.existingId,
        };
      } else if (persisted) {
        next[wid][date] = {
          presence: persisted.is_present ? 'present' : 'absent',
          overtimeHours: persisted.overtime_hours,
          existingId: persisted.id,
          status: persisted.status,
        };
      } else {
        next[wid][date] = prev; // nothing to save (e.g. unmarked) → unchanged
      }
    }
  }
  return next;
}

export interface DateSavePayload {
  attendanceDate: string;
  entries: BatchEntryInput[];
}

/**
 * Build the per-date save payloads. Excludes:
 *   - 'unmarked' cells (never default-present — U2)
 *   - non-DRAFT / locked cells (office-only — F5)
 *   - cells that already match the DB (nothing changed)
 * A date with no cell to save is skipped entirely (no RPC call).
 */
export function buildSavePayloads(
  weekDates: string[],
  workerIds: string[],
  grid: PresenceGrid,
  persisted: PersistedMap,
): DateSavePayload[] {
  const payloads: DateSavePayload[] = [];
  for (const date of weekDates) {
    const entries: BatchEntryInput[] = [];
    for (const wid of workerIds) {
      const cell = grid[wid]?.[date];
      if (!cell || cell.presence === 'unmarked') continue;
      if (isCellLocked(cell.status)) continue;
      if (!isCellDirty(cell, persisted[cellKey(wid, date)])) continue;
      const present = cell.presence === 'present';
      entries.push({
        worker_id: wid,
        is_present: present,
        overtime_hours: present ? (cell.overtimeHours ?? 0) : 0,
      });
    }
    if (entries.length > 0) payloads.push({ attendanceDate: date, entries });
  }
  return payloads;
}

/** OT waterfall: first (threshold − 7) h at tier1, remainder at tier2 (R3). */
export function computeOvertimePay(
  hours: number,
  tier1Rate: number,
  tier2Rate: number,
  tier2Threshold: number,
): number {
  if (hours <= 0) return 0;
  const tier1Cap = tier2Threshold - NORMAL_DAY_HOURS;
  const t1h = Math.min(hours, tier1Cap);
  const t2h = Math.max(0, hours - tier1Cap);
  return t1h * tier1Rate + t2h * tier2Rate;
}

export interface WorkerRateInput {
  dailyRate: number;
  tier1Rate: number;
  tier2Rate: number;
  tier2Threshold: number;
}

export interface WorkerWeekTotal {
  days: number;
  totalOT: number;
  weekPay: number;
}

/**
 * Pay preview for one worker's week. Only 'present' cells pay; 'unmarked' and
 * 'absent' contribute ZERO days, ZERO OT and ZERO pay (U2 / R1 / R17).
 */
export function computeWorkerWeekTotal(
  cells: Array<Pick<GridCell, 'presence' | 'overtimeHours'>>,
  rate: WorkerRateInput,
): WorkerWeekTotal {
  let days = 0;
  let totalOT = 0;
  let otPay = 0;
  for (const c of cells) {
    if (c.presence !== 'present') continue;
    days++;
    const ot = c.overtimeHours ?? 0;
    if (ot > 0) {
      totalOT += ot;
      otPay += computeOvertimePay(ot, rate.tier1Rate, rate.tier2Rate, rate.tier2Threshold);
    }
  }
  return { days, totalOT, weekPay: days * rate.dailyRate + otPay };
}

/** Number of cells still 'unmarked' across the whole week (blocks Konfirmasi). */
export function countUnmarkedCells(
  weekDates: string[],
  workerIds: string[],
  grid: PresenceGrid,
): number {
  let n = 0;
  for (const wid of workerIds) {
    for (const date of weekDates) {
      if ((grid[wid]?.[date]?.presence ?? 'unmarked') === 'unmarked') n++;
    }
  }
  return n;
}

/** Number of editable cells that differ from the DB (i.e. have unsaved edits). */
export function countDirtyCells(
  weekDates: string[],
  workerIds: string[],
  grid: PresenceGrid,
  persisted: PersistedMap,
): number {
  let n = 0;
  for (const wid of workerIds) {
    for (const date of weekDates) {
      const cell = grid[wid]?.[date];
      if (!cell || isCellLocked(cell.status)) continue;
      if (isCellDirty(cell, persisted[cellKey(wid, date)])) n++;
    }
  }
  return n;
}

/** Konfirmasi badge count = persisted rows still in DRAFT (never grid cells). */
export function countDraftEntries(entries: Array<{ status: AttendanceStatus | string }>): number {
  return entries.filter((e) => e.status === 'DRAFT').length;
}

/**
 * Konfirmasi is enabled only when there ARE DRAFT rows to confirm, there are no
 * unsaved edits, and no cell is still unmarked (F3 / F4 / U3).
 */
export function canConfirmWeek(params: {
  persistedDraftCount: number;
  hasUnsavedEdits: boolean;
  unmarkedCount: number;
}): boolean {
  return (
    params.persistedDraftCount > 0 &&
    !params.hasUnsavedEdits &&
    params.unmarkedCount === 0
  );
}
