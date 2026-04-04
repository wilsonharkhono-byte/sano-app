/**
 * Project Management — create projects and manage team assignments.
 *
 * Used by admin / principal / estimator in the Office app.
 * Requires migration 023_project_management_rls.sql.
 */

import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProjectInput {
  code: string;
  name: string;
  location?: string;
  clientName?: string;
  contractValue?: number;
  startDate?: string;  // ISO date YYYY-MM-DD
  endDate?: string;
}

export interface TeamMember {
  assignment_id: string;
  user_id: string;
  full_name: string;
  role: string;
  phone: string | null;
  assigned_at: string;
}

export interface ProfileOption {
  id: string;
  full_name: string;
  role: string;
  phone: string | null;
}

export const ROLE_LABELS: Record<string, string> = {
  supervisor:  'Supervisor',
  estimator:   'Estimator',
  admin:       'Admin',
  principal:   'Principal',
};

// ─── Project CRUD ────────────────────────────────────────────────────────────

export async function createProject(
  params: ProjectInput,
): Promise<{ data?: { id: string; code: string }; error?: string }> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { error: 'Tidak terautentikasi' };

  const { data, error } = await supabase
    .from('projects')
    .insert({
      code:           params.code.trim().toUpperCase(),
      name:           params.name.trim(),
      location:       params.location?.trim() || null,
      client_name:    params.clientName?.trim() || null,
      contract_value: params.contractValue ?? null,
      start_date:     params.startDate ?? null,
      end_date:       params.endDate ?? null,
    })
    .select('id, code')
    .single();

  if (error) return { error: error.message };

  // Auto-assign the creator so they immediately have access
  await supabase.from('project_assignments').insert({
    project_id: data.id,
    user_id:    authData.user.id,
  });

  return { data };
}

// ─── Team CRUD ───────────────────────────────────────────────────────────────

export async function getProjectTeam(projectId: string): Promise<TeamMember[]> {
  const { data } = await supabase
    .from('project_assignments')
    .select('id, user_id, assigned_at, profiles(full_name, role, phone)')
    .eq('project_id', projectId)
    .order('assigned_at', { ascending: true });

  return (data ?? []).map((row: any) => ({
    assignment_id: row.id,
    user_id:       row.user_id,
    full_name:     row.profiles?.full_name || '—',
    role:          row.profiles?.role      || '—',
    phone:         row.profiles?.phone     ?? null,
    assigned_at:   row.assigned_at,
  }));
}

/** Returns all registered users — used to populate the add-member picker. */
export async function listAllProfiles(): Promise<ProfileOption[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone')
    .order('full_name', { ascending: true });

  return (data ?? []) as ProfileOption[];
}

export async function addUserToProject(
  projectId: string,
  userId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('project_assignments')
    .insert({ project_id: projectId, user_id: userId });

  if (error?.code === '23505') return { error: 'Pengguna sudah terdaftar di proyek ini' };
  return { error: error?.message };
}

export async function removeUserFromProject(
  assignmentId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('project_assignments')
    .delete()
    .eq('id', assignmentId);

  return { error: error?.message };
}

// ─── User Management (admin/principal) ───────────────────────────────────────

export interface InviteInput {
  email: string;
  password: string;
  full_name: string;
  role: string;
  project_id?: string;
}

/**
 * Invite a new user via Edge Function (uses service role on server).
 * Caller must be admin or principal.
 */
export async function inviteUser(
  input: InviteInput,
): Promise<{ data?: { user_id: string; email: string; full_name: string; role: string }; error?: string }> {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: input,
  });

  if (error) return { error: error.message ?? 'Gagal mengundang pengguna.' };
  if (data?.error) return { error: data.error };
  return { data };
}

/**
 * Update a team member's role (requires admin/principal + shared project via RLS).
 */
export async function updateUserRole(
  userId: string,
  newRole: string,
): Promise<{ error?: string }> {
  const validRoles = ['supervisor', 'estimator', 'admin', 'principal'];
  if (!validRoles.includes(newRole)) return { error: 'Role tidak valid' };

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  return { error: error?.message };
}
