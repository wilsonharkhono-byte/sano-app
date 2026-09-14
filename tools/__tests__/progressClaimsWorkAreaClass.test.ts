// tools/__tests__/progressClaimsWorkAreaClass.test.ts
import { classifyWorkAreas, elementOf, groundRank, isGroundFloor, splitWorkArea } from '../progressClaims/workAreaClass';

describe('elementOf', () => {
  it.each([
    ['Pile Cap, Sloof, Plat Lantai', 'PILECAP'],
    ['Sloof S1', 'SLOOF'],
    ['Kolom Balok Praktis', 'KOLOM'],
    ['Balok, Plat Lantai', 'BALOK'],
    ['Plat Lantai', 'PLAT'],
    ['Dinding Beton', 'DINDING'],
    ['Retaining Wall Belakang', 'DINDING'],
    ['Balok, Plat Lantai, Dinding Beton', 'DINDING'],
    ['Tangga', 'TANGGA'],
    ['Boredpile', 'BOREDPILE'],
    ['Strauss pile dia. 30', 'BOREDPILE'],
    ['Lantai kerja t=5cm', 'LANTAI_KERJA'],
    ['Balok, Plat Lantai, Janggutan, Tanggulan', 'BALOK'],
    ['Planter Box', null],
    ['', null],
  ])('%s → %s', (text, kind) => {
    expect(elementOf(text)).toBe(kind);
  });
});

describe('splitWorkArea', () => {
  it('prefers the published chapter and sub_chapter', () => {
    expect(splitWorkArea({ label: 'x ; y', chapter: 'Lantai 2', sub_chapter: 'Kolom' })).toEqual({ floor: 'Lantai 2', element: 'Kolom' });
  });

  it('falls back to the two halves of "<lantai> ; <elemen>"', () => {
    expect(splitWorkArea({ label: 'Lt. Basement ; Tandon Air Bawah' })).toEqual({ floor: 'Lt. Basement', element: 'Tandon Air Bawah' });
  });

  it('treats a label without a separator as the element', () => {
    expect(splitWorkArea({ label: '- Balok B24-1' })).toEqual({ floor: '', element: '- Balok B24-1' });
  });
});

describe('ground floor, basement-first', () => {
  it('Lantai 1 is ground when no basement is named', () => {
    expect(groundRank(['Umum', 'Lantai 1', 'Lantai 2', 'Lantai Atap'])).toBe(1);
  });

  it('a basement makes Lantai 1 a suspended floor', () => {
    const ground = groundRank(['Lt. Basement', 'Lantai 1', 'Kolam Renang']);
    expect(ground).toBe(-2);
    expect(isGroundFloor('Lt. Basement', ground)).toBe(true);
    expect(isGroundFloor('Lantai 1', ground)).toBe(false);
  });

  it('a foundation chapter is always ground, and only upper floors named means no ground at all', () => {
    expect(isGroundFloor('PEKERJAAN TANAH DAN PONDASI', null)).toBe(true);
    expect(groundRank(['Lantai 2', 'Lantai 3'])).toBeNull();
  });
});

describe('classifyWorkAreas', () => {
  const rows = (pairs: Array<[string, string]>) =>
    pairs.map(([chapter, sub]) => ({ label: `${chapter} ; ${sub}`, chapter, sub_chapter: sub }));

  it('classifies the Citraland K2-7 work areas', () => {
    expect(classifyWorkAreas(rows([
      ['Umum', 'Kolom Balok Praktis'],
      ['Lantai 1', 'Pile Cap, Sloof, Plat Lantai'],
      ['Lantai 1', 'Kolom'],
      ['Lantai 1', 'Dinding Beton'],
      ['Lantai 1', 'Tangga'],
      ['Lantai 1', 'Boredpile'],
      ['Lantai 2', 'Balok, Plat Lantai'],
      ['Lantai Atap', 'Kolom'],
    ]))).toEqual(['KOLOM', 'PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'DINDING', 'TANGGA', 'BOREDPILE', 'BALOK_PLAT', 'KOLOM']);
  });

  it('puts a basement slab in the ground class, a Lantai 1 slab above it in balok & plat, and an unknown element in lainnya', () => {
    expect(classifyWorkAreas(rows([
      ['Lt. Basement', 'Plat Lantai'],
      ['Lantai 1', 'Plat Lantai'],
      ['Lantai 2', 'Planter Box'],
    ]))).toEqual(['PILECAP_SLOOF_PLAT_DASAR', 'BALOK_PLAT', 'LAINNYA']);
  });
});
