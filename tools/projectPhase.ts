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
// Supabase reports error null. setProjectPhase reports this via the shared
// tools/readBackUpdate.ts helper (CLAUDE.md §12).

import { readBackUpdate } from './readBackUpdate';
import type { ProjectPhase } from './types';
import type { UserRoleType } from './constants';

export const PHASE_UPDATE_ROLES: readonly UserRoleType[] = ['admin', 'principal', 'estimator'];

export function canSetProjectPhase(role: UserRoleType | null | undefined): boolean {
  return !!role && PHASE_UPDATE_ROLES.includes(role);
}

const PHASE_UPDATE_REFUSED =
  'Fase proyek tidak berubah. Hanya admin, prinsipal, atau estimator yang ditugaskan ke proyek ini yang dapat mengubahnya.';

export async function setProjectPhase(
  projectId: string,
  phase: ProjectPhase,
): Promise<{ error?: string }> {
  const { error } = await readBackUpdate('projects', { phase }, 'id', projectId, 'id, phase', PHASE_UPDATE_REFUSED);
  if (error) return { error };
  return {};
}
