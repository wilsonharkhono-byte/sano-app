import { ELEMENT_RE, MATERIAL_RE } from '../vocab';

describe('ELEMENT_RE', () => {
  it.each([
    '- Poer PC.5',
    '  - Sloof S36-1',
    '— Balok B25-1',
    'Kolom K24',
    '  Plat Lantai 1',
    'Tangga utama',
    'Pile P1',
    'Pondasi batu kali',
    'Lantai kerja',
    'Dinding bata',
    'Ringbalk RB1',
    'Atap baja ringan',
  ])('matches element type label: %s', (label) => {
    expect(ELEMENT_RE.test(label)).toBe(true);
  });

  it.each([
    'Beton readymix',
    '- Besi D13',
    'Bekisting Batako',
    'Pekerjaan Galian',
    '',
    '   ',
  ])('does not match non-element label: %s', (label) => {
    expect(ELEMENT_RE.test(label)).toBe(false);
  });
});

describe('MATERIAL_RE', () => {
  it.each([
    '- Beton',
    '  - Besi D13',
    '- Besi D16',
    'Bekisting Batako',
    'Bekisting Kayu',
    'Pasir Lumajang',
    'Semen PC',
    'Mortar instan',
    'Bata merah',
    'Plesteran konvensional',
    'Acian mortar',
    'Cat dasar',
    'Keramik 30x30',
    'Triplek 9mm',
    'Kayu meranti',
  ])('matches material type label: %s', (label) => {
    expect(MATERIAL_RE.test(label)).toBe(true);
  });

  it.each([
    'Poer PC.5',
    'Sloof S36-1',
    'Wiremesh M8',
    '',
  ])('does not match non-material label: %s', (label) => {
    expect(MATERIAL_RE.test(label)).toBe(false);
  });
});
