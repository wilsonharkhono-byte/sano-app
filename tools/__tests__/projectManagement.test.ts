jest.mock('../supabase', () => ({ supabase: {} }));

import { supabase } from '../supabase';
import {
  availableProfiles, getProjectTeam, getProjectTeamResult, type ProfileOption, type TeamMember,
} from '../projectManagement';

const profile = (id: string, name: string, role = 'supervisor'): ProfileOption => ({
  id, full_name: name, role, phone: null,
});
const member = (userId: string): TeamMember => ({
  assignment_id: `a-${userId}`, user_id: userId, full_name: 'x', role: 'supervisor', phone: null, assigned_at: '2026-06-15',
});

describe('availableProfiles', () => {
  const all = [profile('u1', 'Ana'), profile('u2', 'Budi'), profile('u3', 'Citra')];

  it('returns everyone when the team is empty', () => {
    expect(availableProfiles(all, []).map(p => p.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('excludes profiles already on the team (matched by user_id)', () => {
    expect(availableProfiles(all, [member('u2')]).map(p => p.id)).toEqual(['u1', 'u3']);
  });

  it('returns empty when everyone is already assigned', () => {
    expect(availableProfiles(all, [member('u1'), member('u2'), member('u3')])).toEqual([]);
  });

  it('handles an empty profile list', () => {
    expect(availableProfiles([], [member('u1')])).toEqual([]);
  });
});

// ── The principal seat is principal-only (migration 090) ────────────────────
//
// `supabase` is mocked as `{}` above, so ANY call that reaches the network in
// these tests throws a TypeError instead of returning `{ error }`. That is the
// assertion: a denied action must short-circuit in the guard and never issue
// the request — the server-side trigger is the backstop, not the first line.

import {
  addUserToProject,
  removeUserFromProject,
  updateUserRole,
  inviteUser,
} from '../projectManagement';
import { UserRole } from '../constants';

describe('addUserToProject — principal members', () => {
  it('refuses to add a principal when the actor is an admin', async () => {
    const { error } = await addUserToProject('p1', 'u1', {
      actorRole: UserRole.ADMIN, memberRole: UserRole.PRINCIPAL,
    });
    expect(error).toBeTruthy();
  });

  it('refuses when the actor is an estimator (a team manager since migration 037)', async () => {
    const { error } = await addUserToProject('p1', 'u1', {
      actorRole: UserRole.ESTIMATOR, memberRole: UserRole.PRINCIPAL,
    });
    expect(error).toBeTruthy();
  });
});

describe('removeUserFromProject — principal members', () => {
  it('refuses to remove a principal when the actor is an admin', async () => {
    const { error } = await removeUserFromProject('a1', {
      actorRole: UserRole.ADMIN, memberRole: UserRole.PRINCIPAL,
    });
    expect(error).toBeTruthy();
  });
});

describe('updateUserRole — the principal role', () => {
  it('refuses to promote to principal when the actor is an admin', async () => {
    const { error } = await updateUserRole('u1', UserRole.PRINCIPAL, {
      actorRole: UserRole.ADMIN, memberCurrentRole: UserRole.SUPERVISOR,
    });
    expect(error).toBeTruthy();
  });

  it('refuses to demote a sitting principal when the actor is an admin', async () => {
    const { error } = await updateUserRole('u1', UserRole.SUPERVISOR, {
      actorRole: UserRole.ADMIN, memberCurrentRole: UserRole.PRINCIPAL,
    });
    expect(error).toBeTruthy();
  });

  it('refuses even when the actor is the principal — the seat is SQL-only', async () => {
    const promote = await updateUserRole('u1', UserRole.PRINCIPAL, {
      actorRole: UserRole.PRINCIPAL, memberCurrentRole: UserRole.SUPERVISOR,
    });
    expect(promote.error).toBeTruthy();
    const demote = await updateUserRole('u1', UserRole.SUPERVISOR, {
      actorRole: UserRole.PRINCIPAL, memberCurrentRole: UserRole.PRINCIPAL,
    });
    expect(demote.error).toBeTruthy();
  });

  it('still rejects an unknown role string before anything else', async () => {
    const { error } = await updateUserRole('u1', 'superadmin', {
      actorRole: UserRole.PRINCIPAL, memberCurrentRole: UserRole.SUPERVISOR,
    });
    expect(error).toBe('Role tidak valid');
  });
});

describe('inviteUser — registering a brand-new principal', () => {
  it('refuses when the actor is an admin', async () => {
    const { error } = await inviteUser(
      { email: 'a@b.c', password: 'password1', full_name: 'X', role: UserRole.PRINCIPAL },
      { actorRole: UserRole.ADMIN },
    );
    expect(error).toBeTruthy();
  });

  it('refuses even when the actor is the principal — seat is created via SQL only', async () => {
    const { error } = await inviteUser(
      { email: 'a@b.c', password: 'password1', full_name: 'X', role: UserRole.PRINCIPAL },
      { actorRole: UserRole.PRINCIPAL },
    );
    expect(error).toBeTruthy();
  });
});

// ── getProjectTeamResult / getProjectTeam ────────────────────────────────────
//
// getProjectTeam used to discard a query error entirely and return [], which
// a caller cannot tell apart from "this project genuinely has no team" — the
// OwnerField/AssignmentEditor empty copy ("Tim proyek belum diatur") is wrong
// for a dropped connection (CLAUDE.md §12). getProjectTeamResult distinguishes
// the two; getProjectTeam stays a thin wrapper for callers outside this pass.

describe('getProjectTeamResult / getProjectTeam (Supabase mocked)', () => {
  const mockSupabase = supabase as unknown as { from: jest.Mock };

  afterEach(() => {
    delete (supabase as { from?: unknown }).from;
  });

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a-u1', user_id: 'u1', assigned_at: '2026-06-15',
    profiles: { full_name: 'Ana', role: 'supervisor', phone: '0800' },
    ...over,
  });

  function teamChain(result: { data: unknown; error: { message: string } | null }): Record<string, jest.Mock> {
    const chain: Record<string, jest.Mock> = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(() => Promise.resolve(result)),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    return chain;
  }

  it('shapes each assignment row into a TeamMember', async () => {
    mockSupabase.from = jest.fn(() => teamChain({ data: [row()], error: null }));
    await expect(getProjectTeamResult('p1')).resolves.toEqual({
      team: [{ assignment_id: 'a-u1', user_id: 'u1', full_name: 'Ana', role: 'supervisor', phone: '0800', assigned_at: '2026-06-15' }],
    });
  });

  it('falls back to an em dash for a missing profile join', async () => {
    mockSupabase.from = jest.fn(() => teamChain({ data: [row({ profiles: null })], error: null }));
    const result = await getProjectTeamResult('p1');
    expect(result.team?.[0]).toMatchObject({ full_name: '—', role: '—', phone: null });
  });

  it('reports a read failure distinctly rather than an empty team, and warns', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSupabase.from = jest.fn(() => teamChain({ data: null, error: { message: 'nope' } }));
    await expect(getProjectTeamResult('p1')).resolves.toEqual({ team: null, error: 'nope' });
    expect(warnSpy).toHaveBeenCalledWith('getProjectTeam failed:', 'nope');
    warnSpy.mockRestore();
  });

  it('getProjectTeam wraps getProjectTeamResult and returns [] on a read failure, for untouched callers', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSupabase.from = jest.fn(() => teamChain({ data: null, error: { message: 'nope' } }));
    await expect(getProjectTeam('p1')).resolves.toEqual([]);
    warnSpy.mockRestore();
  });

  it('getProjectTeam returns the same members as getProjectTeamResult on success', async () => {
    mockSupabase.from = jest.fn(() => teamChain({ data: [row()], error: null }));
    await expect(getProjectTeam('p1')).resolves.toEqual([
      { assignment_id: 'a-u1', user_id: 'u1', full_name: 'Ana', role: 'supervisor', phone: '0800', assigned_at: '2026-06-15' },
    ]);
  });
});
