// SAN Contractor — Defect Lifecycle Rules
// Full state machine: OPEN → VALIDATED → IN_REPAIR → RESOLVED → VERIFIED → ACCEPTED_BY_PRINCIPAL
//
// Role-based transitions:
//   Supervisor: report (→OPEN), start repair (OPEN/VALIDATED→IN_REPAIR), mark resolved (IN_REPAIR→RESOLVED)
//   Estimator:  validate (OPEN→VALIDATED), assign responsible party, set target date
//   Principal:  verify (RESOLVED→VERIFIED), accept (VERIFIED→ACCEPTED_BY_PRINCIPAL)

import { supabase } from './supabase';
import type { DefectStatus, UserRole } from './types';

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
    from: 'OPEN',
    to: 'VALIDATED',
    allowedRoles: ['estimator', 'admin', 'principal'],
    label: 'Validasi',
    requiresFields: ['responsible_party'],
  },
  // Supervisor/admin can start repair immediately from an open issue
  {
    from: 'OPEN',
    to: 'IN_REPAIR',
    allowedRoles: ['supervisor', 'admin', 'estimator'],
    label: 'Mulai Perbaikan',
  },
  // Validated → assigned for repair
  {
    from: 'VALIDATED',
    to: 'IN_REPAIR',
    allowedRoles: ['estimator', 'admin', 'supervisor'],
    label: 'Mulai Perbaikan',
  },
  // Supervisor marks repair done
  {
    from: 'IN_REPAIR',
    to: 'RESOLVED',
    allowedRoles: ['supervisor', 'estimator', 'admin'],
    label: 'Selesai Diperbaiki',
  },
  // Estimator/Principal verifies the repair
  {
    from: 'RESOLVED',
    to: 'VERIFIED',
    allowedRoles: ['estimator', 'principal'],
    label: 'Verifikasi',
  },
  // Principal final acceptance
  {
    from: 'VERIFIED',
    to: 'ACCEPTED_BY_PRINCIPAL',
    allowedRoles: ['principal'],
    label: 'Terima (Prinsipal)',
  },
  // Reject back to IN_REPAIR if verification fails
  {
    from: 'RESOLVED',
    to: 'IN_REPAIR',
    allowedRoles: ['estimator', 'principal'],
    label: 'Tolak — Perbaiki Ulang',
  },
  // Reject back from VERIFIED
  {
    from: 'VERIFIED',
    to: 'IN_REPAIR',
    allowedRoles: ['principal'],
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

  if (targetStatus === 'VALIDATED' && extras?.responsible_party) {
    update.responsible_party = extras.responsible_party;
  }
  if (extras?.target_resolution_date) {
    update.target_resolution_date = extras.target_resolution_date;
  }
  if (targetStatus === 'RESOLVED' && extras?.repair_photo_path) {
    update.repair_photo_path = extras.repair_photo_path;
  }
  if (targetStatus === 'VERIFIED') {
    update.verifier_id = userId;
    update.verified_at = new Date().toISOString();
  }
  if (targetStatus === 'RESOLVED') {
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
  const openStatuses: DefectStatus[] = ['OPEN', 'VALIDATED', 'IN_REPAIR', 'RESOLVED'];
  return openStatuses.includes(status) && (severity === 'Critical' || severity === 'Major');
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
  const criticalOpen = blockers.filter(d => d.severity === 'Critical').length;
  const majorOpen = blockers.filter(d => d.severity === 'Major').length;

  return {
    eligible: blockers.length === 0,
    criticalOpen,
    majorOpen,
    totalBlockers: blockers.length,
    blockerIds: blockers.map(d => d.id),
  };
}
