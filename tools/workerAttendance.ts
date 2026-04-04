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

/** Get the Monday of the week containing a given date */
export function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return localISO(d);
}

/** Get the Sunday of the week containing a given date (Mon–Sun week) */
export function getWeekEnd(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7); // Sunday
  d.setDate(diff);
  return localISO(d);
}
