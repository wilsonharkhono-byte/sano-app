jest.mock('../supabase', () => ({ supabase: {} }));

import { availableProfiles, type ProfileOption, type TeamMember } from '../projectManagement';

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
