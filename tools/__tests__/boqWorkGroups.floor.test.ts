// tools/__tests__/boqWorkGroups.floor.test.ts
import { extractFloorContext, floorRank } from '../boqWorkGroups';

describe('extractFloorContext and floorRank (shared with the work-area classifier)', () => {
  it.each([
    ['Lt. Basement', 'Basement', -2],
    ['PEKERJAAN FISIK LANTAI BASEMENT', 'Basement', -2],
    ['Lantai Dasar', 'Lantai Dasar', -1],
    ['Lantai 1', 'Lantai 1', 1],
    ['PEKERJAAN FISIK LANTAI 2', 'Lantai 2', 2],
    ['Lantai Atap', 'Dak / Atap', 90],
    ['Umum', null, 0],
    ['Kolam Renang', null, 0],
  ])('%s → %s (rank %d)', (raw, floor, rank) => {
    expect(extractFloorContext(raw)).toBe(floor);
    expect(floorRank(extractFloorContext(raw))).toBe(rank);
  });
});
