/**
 * Project Management — create projects and manage team assignments.
 *
 * Used by admin / principal / estimator in the Office app.
 * Requires migration 023_project_management_rls.sql.
 */

import { supabase } from './supabase';
import { UserRole, type UserRoleType } from './constants';
import { canAssignRole, canChangeMemberRole, canManageTeamMember } from './rolePermissions';

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

/**
 * Who is performing a team write, and what the affected member is today.
 *
 * Every mutating call below takes one of these because of migration 090:
 *   • ROLE — granting or revoking `principal` is refused for EVERY actor here,
 *     principal included. That seat is edited directly in SQL. Admin and
 *     principal still reshuffle supervisor / estimator / admin freely.
 *   • ROSTER — adding or removing a principal MEMBER needs a principal actor;
 *     admin and estimator keep the rest of the roster (migrations 023 + 037).
 *
 * The server-side triggers are authoritative — these client checks exist so
 * the app surfaces the Indonesian reason from tools/rolePermissions.ts instead
 * of a raw Postgres exception, and so a denied action never leaves the device.
 */
export interface TeamMemberActor {
  /** Role of the signed-in user performing the write. */
  actorRole: UserRoleType;
  /** Role the affected member holds right now. */
  memberRole: UserRoleType;
}

export interface RoleChangeActor {
  actorRole: UserRoleType;
  /** Role the member holds BEFORE the change — guarded as tightly as the new one. */
  memberCurrentRole: UserRoleType;
}

export const ROLE_LABELS: Record<string, string> = {
  supervisor:  'Supervisor',
  estimator:   'Estimator',
  admin:       'Admin',
  principal:   'Principal',
};

/**
 * All profiles that are NOT already on the project team — used to populate the
 * add-member picker so already-assigned users don't show up. Matched by id.
 */
export function availableProfiles(
  all: ProfileOption[],
  team: TeamMember[],
): ProfileOption[] {
  const assigned = new Set(team.map(m => m.user_id));
  return all.filter(p => !assigned.has(p.id));
}

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

  // Auto-assign the creator so they immediately have access. Upsert, not
  // insert: a principal creator is already on the roster — migration 093's
  // projects trigger assigns every principal to each new project.
  await supabase.from('project_assignments').upsert(
    { project_id: data.id, user_id: authData.user.id },
    { onConflict: 'project_id,user_id', ignoreDuplicates: true },
  );

  return { data };
}

/**
 * Hard-delete a project and all its descendants. All FKs referencing
 * projects(id) use ON DELETE CASCADE so a single DELETE propagates to
 * BoQ items, AHS versions/lines, milestones, import sessions, purchase
 * orders, assignments, etc. RLS (028_projects_delete_rls.sql) gates this
 * to assigned principals/admins only.
 */
export async function deleteProject(
  projectId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId);

  if (error) return { error: error.message };
  return {};
}

// ─── Team CRUD ───────────────────────────────────────────────────────────────

export async function getProjectTeam(projectId: string): Promise<TeamMember[]> {
  const { data } = await supabase
    .from('project_assignments')
    .select('id, user_id, assigned_at, profiles(full_name, role, phone)')
    .eq('project_id', projectId)
    .order('assigned_at', { ascending: true });

  return (data ?? []).map((row) => {
    const profiles = row.profiles as unknown as { full_name?: string; role?: string; phone?: string | null } | null;
    return {
      assignment_id: row.id,
      user_id:       row.user_id,
      full_name:     profiles?.full_name || '—',
      role:          profiles?.role      || '—',
      phone:         profiles?.phone     ?? null,
      assigned_at:   row.assigned_at,
    };
  });
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
  actor: TeamMemberActor,
): Promise<{ error?: string }> {
  const perm = canManageTeamMember(actor.actorRole, actor.memberRole);
  if (!perm.allowed) return { error: perm.reason };

  const { error } = await supabase
    .from('project_assignments')
    .insert({ project_id: projectId, user_id: userId });

  if (error?.code === '23505') return { error: 'Pengguna sudah terdaftar di proyek ini' };
  return { error: error?.message };
}

export async function removeUserFromProject(
  assignmentId: string,
  actor: TeamMemberActor,
): Promise<{ error?: string }> {
  const perm = canManageTeamMember(actor.actorRole, actor.memberRole);
  if (!perm.allowed) return { error: perm.reason };

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
  actor: { actorRole: UserRoleType },
): Promise<{ data?: { user_id: string; email: string; full_name: string; role: string }; error?: string }> {
  // Registering a brand-new user IS granting them a role, so it goes through
  // the same gate as changing an existing one. The edge function re-checks
  // this server-side; it runs on the service-role key, which the migration 090
  // triggers deliberately let through.
  const perm = canAssignRole(actor.actorRole, input.role as UserRoleType);
  if (!perm.allowed) return { error: perm.reason };

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
  actor: RoleChangeActor,
): Promise<{ error?: string }> {
  const validRoles: string[] = [
    UserRole.SUPERVISOR, UserRole.ESTIMATOR, UserRole.ADMIN, UserRole.PRINCIPAL,
  ];
  if (!validRoles.includes(newRole)) return { error: 'Role tidak valid' };

  const perm = canChangeMemberRole(actor.actorRole, actor.memberCurrentRole, newRole as UserRoleType);
  if (!perm.allowed) return { error: perm.reason };

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  return { error: error?.message };
}
