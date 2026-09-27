/**
 * The DATUM sync planner, gate words and escalation (spec 2026-09-27 §2
 * decision 3, §5.3, §6.2): words are reported, never written; the card links
 * back to the room the app itself links to; the author is the reporter's
 * DATUM account, else the confirmer's, else none.
 */
import { diffGateWords, escalationAuthor, sanoRoomUrl } from '../datumSyncPlan';
import { buildRoomUrl } from '../roomLinks';

describe('diffGateWords', () => {
  it('reports each word that differs from gate_refs, and a DATUM gate SANO lacks, writing nothing', () => {
    expect(diffGateWords(
      [
        { code: 'B', name: 'Pekerjaan Basah / Waterproofing', description: 'Baru.' },
        { code: 'A', name: 'MEP Rough-in + Persiapan Struktural', description: 'Sama.' },
        { code: 'Z', name: 'Gerbang baru', description: null },
      ],
      [
        { code: 'A', name_id: 'MEP Rough-in + Persiapan Struktural', description: ' Sama. ' },
        { code: 'B', name_id: 'Pekerjaan Basah / Waterproofing', description: 'Lama.' },
      ],
    )).toEqual([{ code: 'B', field: 'description' }, { code: 'Z', field: 'missing_in_sano' }]);
  });
});

describe('escalation helpers', () => {
  it("builds exactly the app's room link", () => {
    expect(sanoRoomUrl('SANO-K27', 'LT1-KM-1')).toBe(buildRoomUrl('SANO-K27', 'LT1-KM-1'));
    expect(sanoRoomUrl('A B', 'C/D')).toBe(buildRoomUrl('A B', 'C/D'));
  });

  it("authors by the reporter's DATUM account, else the confirmer's, else none", () => {
    expect(escalationAuthor('s1', 's2')).toBe('s1');
    expect(escalationAuthor(null, 's2')).toBe('s2');
    expect(escalationAuthor(null, null)).toBeNull();
  });
});
