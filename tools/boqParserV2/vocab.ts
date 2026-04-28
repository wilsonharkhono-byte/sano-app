// Closed vocabularies driving the inline-recipe detector. Element-type
// words appear on the parent BoQ row ("- Poer PC.5"); material-type
// words appear on its children ("- Beton", "- Besi D13").
//
// The two arrays do not overlap — that's the disambiguation invariant
// that lets the detector distinguish inline-recipe parents from
// sub-sub-chapter dividers without reading bold/fill formatting.

export const ELEMENT_TYPES = [
  'Poer', 'Sloof', 'Balok', 'Kolom', 'Plat', 'Tangga',
  'Pile', 'Pondasi', 'Lantai', 'Dinding', 'Ringbalk', 'Atap',
];

export const MATERIAL_TYPES = [
  'Beton', 'Besi', 'Bekisting', 'Pasir', 'Semen',
  'Kayu', 'Triplek', 'Mortar', 'Bata', 'Plesteran',
  'Acian', 'Cat', 'Keramik',
];

export const ELEMENT_RE = new RegExp(
  `^[\\s\\-–—]*(${ELEMENT_TYPES.join('|')})\\b`,
  'i',
);

export const MATERIAL_RE = new RegExp(
  `^[\\s\\-–—]*(${MATERIAL_TYPES.join('|')})(\\s+[A-Z]?\\d+)?\\b`,
  'i',
);
