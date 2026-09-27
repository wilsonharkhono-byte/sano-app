/**
 * The DATUM sync planner, people (spec 2026-09-27 §6.4): a SANO profile is
 * linked to a DATUM staff row only on a unique, exact name match on both
 * sides; everything else is listed, never guessed.
 */
import {
  normalizePersonName,
  planStaffLinks,
  staffCounts,
  type PlanProfile,
  type PlanStaff,
} from '../datumSyncPlan';

describe('normalizePersonName', () => {
  it('folds "José  Santoso" and "jose santoso" together', () => {
    expect(normalizePersonName('José  Santoso')).toBe('jose santoso');
    expect(normalizePersonName('jose santoso')).toBe('jose santoso');
  });

  it('strips combining marks, trims and collapses every whitespace run', () => {
    const combiningAcute = String.fromCharCode(0x301);
    expect(normalizePersonName(`  Ñoño${combiningAcute}  \t Dewi `)).toBe('nono dewi');
    expect(normalizePersonName('Zoë\nAgustina')).toBe('zoe agustina');
  });

  it('keeps distinct names distinct, and empty stays empty', () => {
    expect(normalizePersonName('Budi Santoso')).not.toBe(normalizePersonName('Budi Susanto'));
    expect(normalizePersonName('   ')).toBe('');
    expect(normalizePersonName(null)).toBe('');
  });
});

describe('planStaffLinks', () => {
  const profile = (id: string, full_name: string | null, datum_staff_id: string | null = null): PlanProfile => ({ id, full_name, datum_staff_id });
  const staff = (id: string, full_name: string): PlanStaff => ({ id, full_name });

  it('sets a link on a unique match on both sides', () => {
    const plan = planStaffLinks([profile('p1', 'Budi  Santoso')], [staff('s1', 'budi santoso'), staff('s2', 'Siti')]);
    expect(plan.set).toEqual([{ profile_id: 'p1', staff_id: 's1' }]);
    expect(staffCounts(plan)).toEqual({ linked: 1, linked_now: 1, unmatched: 0, ambiguous: 0, stale: 0 });
  });

  it('calls two DATUM staff, or two SANO profiles, with one name ambiguous, naming the side', () => {
    const datumTwice = planStaffLinks([profile('p1', 'Andi')], [staff('s1', 'Andi'), staff('s2', 'ANDI')]);
    expect(datumTwice.ambiguous).toEqual([{ profile_id: 'p1', full_name: 'Andi', side: 'datum' }]);
    const sanoTwice = planStaffLinks([profile('p1', 'Andi'), profile('p2', 'andi')], [staff('s1', 'Andi')]);
    expect(sanoTwice.ambiguous.map((a) => [a.profile_id, a.side])).toEqual([['p1', 'sano'], ['p2', 'sano']]);
    expect(sanoTwice.set).toEqual([]);
  });

  it('calls a staff id already linked to another profile ambiguous', () => {
    const plan = planStaffLinks(
      [profile('p1', 'Rudi Hartono', 's1'), profile('p2', 'Rudi')],
      [staff('s1', 'Rudi Hartono'), staff('s2', 'Rudi')],
    );
    expect(plan.set).toEqual([{ profile_id: 'p2', staff_id: 's2' }]);
    const taken = planStaffLinks([profile('p1', 'Lain', 's1'), profile('p2', 'Rudi Hartono')], [staff('s1', 'Rudi Hartono')]);
    expect(taken.ambiguous).toEqual([{ profile_id: 'p2', full_name: 'Rudi Hartono', side: 'linked_elsewhere' }]);
  });

  it('lists no match, and no name, as unmatched', () => {
    const plan = planStaffLinks([profile('p1', 'Tak Dikenal'), profile('p2', ''), profile('p3', null)], [staff('s1', 'Budi')]);
    expect(plan.unmatched).toEqual([
      { profile_id: 'p1', full_name: 'Tak Dikenal' },
      { profile_id: 'p2', full_name: '' },
      { profile_id: 'p3', full_name: '' },
    ]);
  });

  it('leaves an intact link unchanged', () => {
    const plan = planStaffLinks([profile('p1', 'Budi', 's1')], [staff('s1', 'budi')]);
    expect(plan.unchanged).toEqual(['p1']);
    expect(plan.set).toEqual([]);
  });

  it('reports a link whose staff vanished, was renamed or is no longer unique as stale, and changes nothing', () => {
    const plan = planStaffLinks(
      [profile('p1', 'Budi', 'gone'), profile('p2', 'Siti', 's2'), profile('p3', 'Andi', 's3')],
      [staff('s2', 'Siti Aminah'), staff('s3', 'Andi'), staff('s4', 'Andi')],
    );
    expect(plan.stale).toEqual([
      { profile_id: 'p1', full_name: 'Budi', staff_id: 'gone', staff_name: null, reason: 'staff_gone' },
      { profile_id: 'p2', full_name: 'Siti', staff_id: 's2', staff_name: 'Siti Aminah', reason: 'name_differs' },
      { profile_id: 'p3', full_name: 'Andi', staff_id: 's3', staff_name: 'Andi', reason: 'not_unique' },
    ]);
    expect(plan.set).toEqual([]);
    expect(staffCounts(plan)).toMatchObject({ linked: 3, linked_now: 0, stale: 3 });
  });
});
