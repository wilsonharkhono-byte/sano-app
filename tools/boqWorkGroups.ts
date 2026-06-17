// BoQ work-group classifier (client-side).
//
// Turns flat BoQ rows into the work-groups a field supervisor actually orders
// against — "Struktur Pondasi", "Kolom Lantai 1", "Balok & Plat Lantai 2", …
// Pure + deterministic; classifies from a runtime BoqItem's label + chapter
// (sub-chapter is not persisted to boq_items, so it is not available here).
//
// Design: docs/superpowers/specs/2026-06-16-boq-work-group-material-requests-design.md
// Validated against AAL-5, Sonny, Nusa Golf, PD3, Ernawati
// (assets/BOQ/WorkGroup Categorization Preview.xlsx).

import type { WorkGroup } from './types';

export interface BoqWorkGroupClass {
  /** Stable slug, e.g. "struktur-pondasi", "kolom-lantai-1". */
  key: string;
  /** Display label, e.g. "Struktur Pondasi". */
  label: string;
  /** Floor context if found in the source, else null (never invented). */
  floor: string | null;
}

/**
 * Fields the classifier reads. `sub_chapter` is OPTIONAL and used when present:
 * for component-level workbooks (rows like "- Beton" under a "Poer PC.1"
 * sub-chapter) the element type lives only in the sub-chapter. Element-level
 * workbooks (label like "Poer PC.1") classify fine without it.
 */
export interface ClassifyInput {
  label: string;
  chapter: string | null;
  sub_chapter?: string | null;
}

/** A BoQ row groupable into a work-group (classify fields + identity + order). */
export interface GroupableItem extends ClassifyInput {
  id: string;
  sort_order: number;
}

// ── text helpers ────────────────────────────────────────────────────────
function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase()
    .replace(/[()@\-\/\\'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(label: string): string {
  return label.toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatFloorToken(token: string): string {
  const cleaned = token.replace(/[^\da-z]/gi, '').trim();
  if (!cleaned) return token.trim();
  if (/^\d+$/.test(cleaned)) return cleaned;
  return cleaned.toUpperCase();
}

function extractFloorContext(raw: string | null | undefined): string | null {
  const compact = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  if (/\bsemi\s*basement\b/i.test(compact)) return 'Semi Basement';
  if (/\b(basement|basemen)\b/i.test(compact)) return 'Basement';
  if (/\b(mezzanine|mezanin)\b/i.test(compact)) return 'Mezzanine';
  if (/\b(ground\s*floor|lantai\s*dasar|gf)\b/i.test(compact)) return 'Lantai Dasar';
  if (/\b(dak|roof|atap)\b/i.test(compact)) return 'Dak / Atap';
  const m = compact.match(/(?:lantai|lt\.?|floor|level|lvl)\s*([a-z0-9]+)/i);
  if (m?.[1]) return `Lantai ${formatFloorToken(m[1])}`;
  return null;
}

function extractFloor(item: ClassifyInput): string | null {
  return extractFloorContext(item.label)
    ?? extractFloorContext(item.sub_chapter)
    ?? extractFloorContext(item.chapter);
}

// Floor ordering for stable group sort (basement < dasar < numbered < atap).
function floorRank(floor: string | null): number {
  if (!floor) return 0;
  if (/semi\s*basement/i.test(floor)) return -3;
  if (/basement/i.test(floor)) return -2;
  if (/dasar|ground/i.test(floor)) return -1;
  const m = floor.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  if (/dak|atap/i.test(floor)) return 90;
  return 50;
}

// ── taxonomy ──────────────────────────────────────────────────────────
// Finish-work keywords that must NOT be claimed by structural element groups.
// A real structural concrete line never contains these; masonry/finish lines
// that merely mention "kolom praktis" / "plesteran kolom" do.
const FINISH_GUARD = [
  'bekist', 'pembesian', 'tulangan', 'pasangan', 'bata', 'batako', 'praktis',
  'plester', 'acian', 'pengecatan', 'keramik', 'granit', 'waterproof',
];

interface Archetype {
  type: string;
  rank: number;
  keywords: string[];
  excludeKeywords?: string[];
  label: (floor: string | null) => string;
}

const ARCHETYPES: Archetype[] = [
  { type: 'galian', rank: 2,
    keywords: ['galian', 'buang tanah', 'bowplank', 'bouwplank', 'land clearing', 'pembersihan lahan', 'potong tanah'],
    label: () => 'Pekerjaan Tanah & Galian' },
  { type: 'urugan', rank: 3,
    keywords: ['urugan', 'timbunan', 'pemadatan', 'sirtu', 'pasir urug', 'tanah urug', 'sub base', 'base course', 'lantai kerja'],
    label: () => 'Urugan & Pematangan Tanah' },
  { type: 'tiang_pancang', rank: 5,
    keywords: ['tiang pancang', 'bore pile', 'mini pile', 'spun pile', 'cerucuk', 'strauss pile'],
    label: () => 'Pekerjaan Tiang Pancang' },
  // Poer + Sloof + pile cap merged into ONE foundation group.
  { type: 'pondasi', rank: 10,
    keywords: ['pondasi', 'pile cap', 'poer', 'tapak', 'footplate', 'foot plate', 'plat tapak',
               'cakar ayam', 'pit lift', 'sloof', 'tie beam', 'balok pengikat', 'balok bawah'],
    label: () => 'Struktur Pondasi' },
  // Columns separate from beams+plate, per floor.
  { type: 'kolom', rank: 20,
    keywords: ['kolom', 'column', 'tiang beton'],
    excludeKeywords: FINISH_GUARD,
    label: (f) => f ? `Kolom ${f}` : 'Kolom' },
  { type: 'balok_plat', rank: 21,
    keywords: ['balok', 'plat lantai', 'pelat', 'ring balok', 'ring balk', 'shear wall', 'dinding geser',
               'konsol', 'canopy', 'kanopi', 'overtopping', 'topping', 'plat beton'],
    excludeKeywords: FINISH_GUARD,
    label: (f) => f ? `Balok & Plat ${f}` : 'Balok & Plat' },
  { type: 'tangga', rank: 22,
    keywords: ['tangga', 'bordes', 'stair'],
    label: (f) => f ? `Tangga ${f}` : 'Tangga' },
  { type: 'dak', rank: 23,
    keywords: ['dak beton', 'roof slab', 'plat atap', 'plat dak'],
    label: () => 'Dak / Plat Atap' },
  { type: 'bekisting', rank: 24,
    keywords: ['bekisting', 'formwork', 'cetakan beton'],
    label: (f) => f ? `Bekisting Struktur ${f}` : 'Bekisting Struktur' },
  { type: 'pembesian', rank: 25,
    keywords: ['pembesian', 'tulangan', 'besi beton', 'besi ulir', 'besi polos', 'wiremesh', 'wire mesh'],
    label: (f) => f ? `Pembesian Struktur ${f}` : 'Pembesian Struktur' },
  { type: 'pengecoran', rank: 26,
    keywords: ['pengecoran', 'cor beton', 'ready mix', 'readymix'],
    label: (f) => f ? `Pengecoran Beton ${f}` : 'Pengecoran Beton' },
  { type: 'bata', rank: 40,
    keywords: ['pasangan bata', 'bata merah', 'batako', 'bata ringan', 'hebel',
               'dinding bata', 'pasangan dinding', 'roster', 'dinding partisi'],
    label: (f) => f ? `Pasangan Dinding ${f}` : 'Pasangan Dinding' },
  { type: 'plester', rank: 41,
    keywords: ['plester', 'acian', 'plesteran', 'benangan', 'tali air', 'sponengan'],
    label: (f) => f ? `Plesteran & Acian ${f}` : 'Plesteran & Acian' },
  { type: 'lantai', rank: 50,
    keywords: ['keramik', 'granit', 'granite', 'homogeneous', 'vinyl', 'parquet',
               'rabat beton', 'floor hardener', 'step nosing', 'lantai keramik'],
    label: (f) => f ? `Pekerjaan Lantai ${f}` : 'Pekerjaan Lantai' },
  { type: 'plafond', rank: 51,
    keywords: ['plafond', 'plafon', 'ceiling', 'gypsum board', 'grc board', 'kalsiboard'],
    label: (f) => f ? `Pekerjaan Plafond ${f}` : 'Pekerjaan Plafond' },
  { type: 'cat', rank: 52,
    keywords: ['cat tembok', 'pengecatan', 'cat kayu', 'cat besi', 'coating', 'cat dinding'],
    label: (f) => f ? `Pengecatan ${f}` : 'Pengecatan' },
  { type: 'waterproof', rank: 53,
    keywords: ['waterproof', 'water proof', 'membrane', 'kedap air'],
    label: (f) => f ? `Waterproofing ${f}` : 'Waterproofing' },
  { type: 'kusen', rank: 54,
    keywords: ['kusen', 'pintu', 'jendela', 'ventilasi', 'partisi kaca'],
    label: (f) => f ? `Kusen, Pintu & Jendela ${f}` : 'Kusen, Pintu & Jendela' },
  { type: 'sanitair', rank: 55,
    keywords: ['sanitair', 'kloset', 'wastafel', 'shower', 'bathtub', 'floor drain', 'closet duduk'],
    label: (f) => f ? `Perlengkapan Sanitair ${f}` : 'Perlengkapan Sanitair' },
  { type: 'railing', rank: 56,
    keywords: ['railing', 'railling', 'handrail', 'pegangan tangga', 'pagar besi'],
    label: (f) => f ? `Railing & Pagar ${f}` : 'Railing & Pagar' },
  { type: 'atap', rank: 60,
    keywords: ['atap', 'genteng', 'kuda kuda', 'kuda-kuda', 'rangka atap', 'zincalume',
               'spandek', 'reng', 'usuk', 'nok', 'lisplang', 'talang', 'bubungan'],
    label: () => 'Pekerjaan Atap & Penutup' },
  { type: 'mep_pipa', rank: 70,
    keywords: ['instalasi pipa', 'instalasi air', 'plumbing', 'air bersih', 'air kotor',
               'drainase', 'riol', 'septictank', 'septic tank', 'saluran air', 'pipa pvc', 'pipa ppr'],
    label: (f) => f ? `Instalasi Perpipaan ${f}` : 'Instalasi Perpipaan' },
  { type: 'mep_listrik', rank: 71,
    keywords: ['instalasi listrik', 'elektrikal', 'electrical', 'panel listrik', 'stop kontak',
               'saklar', 'titik lampu', 'grounding', 'instalasi daya'],
    label: (f) => f ? `Instalasi Elektrikal ${f}` : 'Instalasi Elektrikal' },
  { type: 'mep_ac', rank: 72,
    keywords: ['air conditioning', 'ac split', 'ducting ac', 'hvac'],
    label: (f) => f ? `Instalasi AC ${f}` : 'Instalasi AC' },
  { type: 'mep_fire', rank: 73,
    keywords: ['sprinkler', 'fire alarm', 'hydrant', 'fire protection', 'apar'],
    label: (f) => f ? `Fire Protection ${f}` : 'Fire Protection' },
];

const UMBRELLA: Array<{ pattern: RegExp; label: string; rank: number }> = [
  { pattern: /pekerjaan\s+persiapan|preliminaries|prelim/i, label: 'Pekerjaan Persiapan', rank: 1 },
  { pattern: /pekerjaan\s+(tanah|galian)/i, label: 'Pekerjaan Tanah & Galian', rank: 2 },
];

const FALLBACK_RANK = 800;

interface InternalClass extends BoqWorkGroupClass {
  rank: number;
  floorRank: number;
}

function classifyInternal(item: ClassifyInput): InternalClass {
  const labelLower = normalize(item.label);
  const floor = extractFloor(item);
  const chapterRaw = item.chapter ?? '';

  // 1. Umbrella chapters keep all their items together.
  for (const u of UMBRELLA) {
    if (u.pattern.test(chapterRaw)) {
      return { key: slug(u.label), label: u.label, floor, rank: u.rank, floorRank: 0 };
    }
  }

  // 2. Match label directly (with finish-work guard on structural archetypes).
  for (const a of ARCHETYPES) {
    if (!a.keywords.some(kw => labelLower.includes(kw))) continue;
    if (a.excludeKeywords?.some(kw => labelLower.includes(kw))) continue;
    const label = a.label(floor);
    return { key: slug(label), label, floor, rank: a.rank, floorRank: floorRank(floor) };
  }

  // 3. Context fallback: label + sub-chapter + chapter combined. The sub-chapter
  //    is where component-level workbooks carry the element type ("Poer PC.1").
  const ctx = normalize([item.label, item.sub_chapter ?? '', item.chapter].join(' '));
  for (const a of ARCHETYPES) {
    if (!a.keywords.some(kw => ctx.includes(kw))) continue;
    if (a.excludeKeywords?.some(kw => ctx.includes(kw))) continue;
    const label = a.label(floor);
    return { key: slug(label), label, floor, rank: a.rank, floorRank: floorRank(floor) };
  }

  // 4. Last resort: chapter name (so same-chapter items still group), else Lainnya.
  const chapterLabel = chapterRaw.trim() || 'Lainnya';
  const label = floor && !/lantai/i.test(chapterLabel) ? `${chapterLabel} ${floor}` : chapterLabel;
  return { key: slug(label), label, floor, rank: FALLBACK_RANK, floorRank: floorRank(floor) };
}

/** Classify a single BoQ row into its work-group (key + display label + floor). */
export function classifyBoqWorkGroup(item: ClassifyInput): BoqWorkGroupClass {
  const { key, label, floor } = classifyInternal(item);
  return { key, label, floor };
}

/**
 * Group BoQ rows into work-groups. Every row lands in exactly one group
 * (full partition); groups are ordered by archetype rank → floor → label so
 * the picker reads foundation → floors → finishes → MEP.
 */
export function buildWorkGroups(items: GroupableItem[]): WorkGroup[] {
  const map = new Map<string, { cls: InternalClass; itemIds: string[]; sortOrder: number }>();

  for (const it of items) {
    const cls = classifyInternal(it);
    const entry = map.get(cls.key);
    if (entry) {
      entry.itemIds.push(it.id);
      entry.sortOrder = Math.min(entry.sortOrder, it.sort_order ?? 0);
    } else {
      map.set(cls.key, { cls, itemIds: [it.id], sortOrder: it.sort_order ?? 0 });
    }
  }

  const groups: WorkGroup[] = [...map.values()].map(({ cls, itemIds, sortOrder }) => ({
    key: cls.key,
    label: cls.label,
    floor: cls.floor,
    itemIds,
    itemCount: itemIds.length,
    sortOrder,
  }));

  // Stable ordering: archetype rank, then floor, then label, then min sort_order.
  groups.sort((a, b) => {
    const ca = map.get(a.key)!.cls;
    const cb = map.get(b.key)!.cls;
    return (ca.rank - cb.rank)
      || (ca.floorRank - cb.floorRank)
      || a.label.localeCompare(b.label)
      || (a.sortOrder - b.sortOrder);
  });

  return groups;
}
