/**
 * Attendance / HOK (Hari Orang Kerja) Tools
 *
 * CRUD and RPC wrappers for mandor attendance-based payments.
 * Attendance lifecycle: DRAFT → VERIFIED → SETTLED (auto on opname approval)
 */

import { supabase } from './supabase';
import { AttendanceStatus } from './constants';
import type { MandorAttendance, AttendanceWeeklySummary, AttendanceAnomaly } from './types';
import { fetchAllByField, fetchView, rpcNumeric } from './queryHelpers';

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get attendance records for a contract, ordered by date desc */
export async function getAttendanceByContract(contractId: string): Promise<MandorAttendance[]> {
  return fetchAllByField<MandorAttendance>('mandor_attendance', 'contract_id', contractId, 'attendance_date');
}

/** Get attendance records for a project */
export async function getAttendanceByProject(projectId: string): Promise<MandorAttendance[]> {
  return fetchAllByField<MandorAttendance>('mandor_attendance', 'project_id', projectId, 'attendance_date');
}

/** Get unsettled (VERIFIED) attendance total for a contract */
export async function getUnsettledAttendanceTotal(contractId: string): Promise<number> {
  return rpcNumeric('get_unsettled_attendance_total', { p_contract_id: contractId });
}

/** Get weekly summary view */
export async function getAttendanceWeeklySummary(
  contractId: string,
): Promise<AttendanceWeeklySummary[]> {
  return fetchView<AttendanceWeeklySummary>('v_attendance_weekly_summary', 'contract_id', contractId, 'week_start');
}

/** Check if a worker count is anomalous for a contract */
export async function checkAttendanceAnomaly(
  contractId: string,
  workerCount: number,
): Promise<AttendanceAnomaly> {
  const { data, error } = await supabase.rpc('check_attendance_anomaly', {
    p_contract_id: contractId,
    p_worker_count: workerCount,
  });
  if (error || !data || data.length === 0) {
    return { is_anomaly: false, avg_7day: 0, threshold: 10 };
  }
  return data[0] as AttendanceAnomaly;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Record attendance for a day (supervisor) */
export async function recordAttendance(
  contractId: string,
  attendanceDate: string,
  workerCount: number,
  workDescription?: string,
): Promise<{ data?: MandorAttendance; error?: string }> {
  const params: Record<string, unknown> = {
    p_contract_id: contractId,
    p_attendance_date: attendanceDate,
    p_worker_count: workerCount,
  };
  if (workDescription) params.p_work_description = workDescription;

  const { data, error } = await supabase.rpc('record_attendance', params);
  if (error) return { error: error.message };
  return { data: data as MandorAttendance };
}

/** Verify attendance record (estimator) */
export async function verifyAttendance(
  attendanceId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('verify_attendance', {
    p_attendance_id: attendanceId,
  });
  return { error: error?.message };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Format attendance status for display */
export function attendanceStatusLabel(status: MandorAttendance['status']): string {
  switch (status) {
    case AttendanceStatus.DRAFT:    return 'Draft';
    case 'VERIFIED': return 'Terverif.';
    case AttendanceStatus.SETTLED:  return 'Terpotong';
    default:         return status;
  }
}

/** Format attendance status color */
export function attendanceStatusColor(status: MandorAttendance['status']): string {
  switch (status) {
    case AttendanceStatus.DRAFT:    return '#524E49'; // gray
    case 'VERIFIED': return '#1565C0'; // blue
    case AttendanceStatus.SETTLED:  return '#3D8B40'; // green
    default:         return '#524E49';
  }
}
