// SAN Contractor — Defect Lifecycle Rules
// Full state machine: OPEN → VALIDATED → IN_REPAIR → RESOLVED → VERIFIED → ACCEPTED_BY_PRINCIPAL
//
// Role-based transitions:
//   Supervisor: report (→OPEN), start repair (OPEN/VALIDATED→IN_REPAIR), mark resolved (IN_REPAIR→RESOLVED)
//   Estimator:  validate (OPEN→VALIDATED), assign responsible party, set target date
//   Principal:  verify (RESOLVED→VERIFIED), accept (VERIFIED→ACCEPTED_BY_PRINCIPAL)

import { supabase } from './supabase';
import type { DefectStatus, UserRole } from './types';
import { DefectStatus as DS, DefectSeverity as DSev, UserRole as UR } from './constants';

export interface DefectTransition {
  from: DefectStatus;
  to: DefectStatus;
  allowedRoles: UserRole[];
  label: string;
  requiresFields?: string[];
}

export const DEFECT_TRANSITIONS: DefectTransition[] = [
  // Estimator validates a new defect
  {
    from: DS.OPEN,
    to: DS.VALIDATED,
    allowedRoles: [UR.ESTIMATOR, UR.ADMIN, UR.PRINCIPAL],
    label: 'Validasi',
    requiresFields: ['responsible_party'],
  },
  // Supervisor/admin can start repair immediately from an open issue
  {
    from: DS.OPEN,
    to: DS.IN_REPAIR,
    allowedRoles: [UR.SUPERVISOR, UR.ADMIN, UR.ESTIMATOR],
    label: 'Mulai Perbaikan',
  },
  // Validated → assigned for repair
  {
    from: DS.VALIDATED,
    to: DS.IN_REPAIR,
    allowedRoles: [UR.ESTIMATOR, UR.ADMIN, UR.SUPERVISOR],
    label: 'Mulai Perbaikan',
  },
  // Supervisor marks repair done
  {
    from: DS.IN_REPAIR,
    to: DS.RESOLVED,
    allowedRoles: [UR.SUPERVISOR, UR.ESTIMATOR, UR.ADMIN],
    label: 'Selesai Diperbaiki',
  },
  // Estimator/Principal verifies the repair
  {
    from: DS.RESOLVED,
    to: DS.VERIFIED,
    allowedRoles: [UR.ESTIMATOR, UR.PRINCIPAL],
    label: 'Verifikasi',
  },
  // Principal final acceptance
  {
    from: DS.VERIFIED,
    to: DS.ACCEPTED_BY_PRINCIPAL,
    allowedRoles: [UR.PRINCIPAL],
    label: 'Terima (Prinsipal)',
  },
  // Reject back to IN_REPAIR if verification fails
  {
    from: DS.RESOLVED,
    to: DS.IN_REPAIR,
    allowedRoles: [UR.ESTIMATOR, UR.PRINCIPAL],
    label: 'Tolak — Perbaiki Ulang',
  },
  // Reject back from VERIFIED
  {
    from: DS.VERIFIED,
    to: DS.IN_REPAIR,
    allowedRoles: [UR.PRINCIPAL],
    label: 'Tolak — Perbaiki Ulang',
  },
];

// Get available transitions for current defect status + user role
export function getAvailableTransitions(currentStatus: DefectStatus, role: UserRole): DefectTransition[] {
  return DEFECT_TRANSITIONS.filter(
    t => t.from === currentStatus && t.allowedRoles.includes(role)
  );
}

// Check if a transition is valid
export function canTransition(currentStatus: DefectStatus, targetStatus: DefectStatus, role: UserRole): boolean {
  return DEFECT_TRANSITIONS.some(
    t => t.from === currentStatus && t.to === targetStatus && t.allowedRoles.includes(role)
  );
}

// Execute a defect status transition
export async function transitionDefect(
  defectId: string,
  targetStatus: DefectStatus,
  role: UserRole,
  userId: string,
  extras?: {
    responsible_party?: string;
    target_resolution_date?: string;
    repair_photo_path?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  // Load current defect
  const { data: defect, error: fetchErr } = await supabase
    .from('defects')
    .select('status')
    .eq('id', defectId)
    .single();

  if (fetchErr || !defect) {
    return { success: false, error: 'Defect tidak ditemukan.' };
  }

  if (!canTransition(defect.status as DefectStatus, targetStatus, role)) {
    return { success: false, error: `Transisi ${defect.status} → ${targetStatus} tidak diizinkan untuk role ${role}.` };
  }

  // Build update payload
  const update: Record<string, unknown> = { status: targetStatus };

  if (targetStatus === DS.VALIDATED && extras?.responsible_party) {
    update.responsible_party = extras.responsible_party;
  }
  if (extras?.target_resolution_date) {
    update.target_resolution_date = extras.target_resolution_date;
  }
  if (targetStatus === DS.RESOLVED && extras?.repair_photo_path) {
    update.repair_photo_path = extras.repair_photo_path;
  }
  if (targetStatus === DS.VERIFIED) {
    update.verifier_id = userId;
    update.verified_at = new Date().toISOString();
  }
  if (targetStatus === DS.RESOLVED) {
    update.resolved_at = new Date().toISOString();
  }

  // Atomic guard: only update if status hasn't changed since we read it.
  // Prevents TOCTOU race when two users transition the same defect concurrently.
  const { data: updated, error: updateErr } = await supabase
    .from('defects')
    .update(update)
    .eq('id', defectId)
    .eq('status', defect.status)
    .select('id');

  if (updateErr) {
    return { success: false, error: updateErr.message };
  }

  if (!updated || updated.length === 0) {
    return { success: false, error: 'Status defect sudah berubah. Silakan refresh dan coba lagi.' };
  }

  return { success: true };
}

// Check if a defect blocks handover
export function isHandoverBlocker(status: DefectStatus, severity: string): boolean {
  const openStatuses: DefectStatus[] = [DS.OPEN, DS.VALIDATED, DS.IN_REPAIR, DS.RESOLVED];
  return openStatuses.includes(status) && (severity === DSev.CRITICAL || severity === DSev.MAJOR);
}

// Get handover summary for a project's defects
export interface HandoverSummary {
  eligible: boolean;
  criticalOpen: number;
  majorOpen: number;
  totalBlockers: number;
  blockerIds: string[];
}

export function computeHandoverSummary(
  defects: Array<{ id: string; status: DefectStatus; severity: string; handover_impact: boolean }>
): HandoverSummary {
  const blockers = defects.filter(d => isHandoverBlocker(d.status, d.severity) || d.handover_impact);
  const criticalOpen = blockers.filter(d => d.severity === DSev.CRITICAL).length;
  const majorOpen = blockers.filter(d => d.severity === DSev.MAJOR).length;

  return {
    eligible: blockers.length === 0,
    criticalOpen,
    majorOpen,
    totalBlockers: blockers.length,
    blockerIds: blockers.map(d => d.id),
  };
}
