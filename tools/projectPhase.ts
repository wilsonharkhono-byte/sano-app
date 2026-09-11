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
