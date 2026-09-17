// tools/progressClaims/workAreaClass.ts
// SANO — which element class a work-area row belongs to, so the right stage
// weights apply (spec §7.3, §17). Pure.
//
// A SANO Input row is labelled "<lantai> ; <elemen>" (and published with
// chapter = lantai, sub_chapter = elemen); a full-RAB row has a chapter title,
// a section and its own label. Floors come from tools/boqWorkGroups.ts so the
// two classifiers never disagree about what "Lantai 1" or "Basement" is.
import { extractFloorContext, floorRank } from '../boqWorkGroups';

export const WORK_AREA_CLASSES = [
  'PILECAP_SLOOF_PLAT_DASAR', 'KOLOM', 'BALOK_PLAT', 'DINDING', 'TANGGA', 'BOREDPILE', 'LAINNYA',
] as const;
export type WorkAreaClass = (typeof WORK_AREA_CLASSES)[number];

export type ElementKind =
  | 'LANTAI_KERJA' | 'BOREDPILE' | 'PILECAP' | 'SLOOF' | 'TANGGA' | 'DINDING' | 'KOLOM' | 'BALOK' | 'PLAT';

/** The element a label fragment names. Order matters: the first match wins ("Pile Cap, Sloof, Plat" is a pile cap row). */
export function elementOf(text: string | null | undefined): ElementKind | null {
  const t = (text ?? '').toLowerCase();
  if (!t) return null;
  if (/lantai kerja|lean concrete/.test(t)) return 'LANTAI_KERJA';
  if (/bored?\s*pile|boredpile|tiang bor|strauss|mini\s*pile|spun\s*pile|tiang pancang/.test(t)) return 'BOREDPILE';
  if (/pile\s*cap|pilecap|\bpoer\b|\bpc[.\s-]?\d|pondasi|foot\s*plate|\btapak\b/.test(t)) return 'PILECAP';
  if (/sloof|tie\s*beam|\bs\d/.test(t)) return 'SLOOF';
  if (/tangga|bordes|\bstair/.test(t)) return 'TANGGA';
  if (/dinding|retaining|\bwall\b|\bgwt\b|ground\s*water|pit\s*lift|kolam|\bsw\d/.test(t)) return 'DINDING';
  if (/kolom|column|\bk\d/.test(t)) return 'KOLOM';
  if (/balok|\bbeam\b|ring\s*balk|\bb\d/.test(t)) return 'BALOK';
  if (/\bplat\b|pelat|\bslab\b|\bdak\b/.test(t)) return 'PLAT';
  return null;
}

export interface WorkAreaRow {
  label: string;
  chapter?: string | null;
  sub_chapter?: string | null;
}

/** Floor and element text of a row: chapter/sub_chapter when published, else the two halves of "<lantai> ; <elemen>". */
export function splitWorkArea(row: WorkAreaRow): { floor: string; element: string } {
  const parts = row.label.split(';');
  const labelFloor = parts.length > 1 ? parts[0].trim() : '';
  const labelElement = parts.length > 1 ? parts.slice(1).join(';').trim() : row.label.trim();
  return {
    floor: (row.chapter ?? '').trim() || labelFloor,
    element: (row.sub_chapter ?? '').trim() || labelElement,
  };
}

const FOUNDATION_RE = /pondasi|sub\s*struktur/i;
/** A floor ranked above Lantai 1 is never "ground", even when it is the lowest one named. */
const GROUND_MAX_RANK = 1;

/**
 * Basement-first ground rule (spec §17): among the floors the rows name, the
 * lowest-ranked one is ground — so with a basement, "Lantai 1" is a suspended
 * slab. Returns null when no row names a floor at or below Lantai 1.
 */
export function groundRank(floors: Array<string | null | undefined>): number | null {
  const ranks = floors
    .map((f) => extractFloorContext(f))
    .filter((f): f is string => f !== null)
    .map((f) => floorRank(f));
  if (ranks.length === 0) return null;
  const lowest = Math.min(...ranks);
  return lowest <= GROUND_MAX_RANK ? lowest : null;
}

export function isGroundFloor(floor: string, ground: number | null): boolean {
  if (FOUNDATION_RE.test(floor)) return true;
  const ctx = extractFloorContext(floor);
  return ctx !== null && ground !== null && floorRank(ctx) === ground;
}

/** Classify every row of one project (or one RAB sheet): ground is decided across all of them. */
export function classifyWorkAreas(rows: WorkAreaRow[]): WorkAreaClass[] {
  const split = rows.map(splitWorkArea);
  const ground = groundRank(split.map((s) => s.floor));
  return rows.map((row, i) => {
    const { floor, element } = split[i];
    const kind = elementOf(element) ?? elementOf(row.label) ?? elementOf(floor);
    switch (kind) {
      case 'PILECAP':
      case 'SLOOF':
        return 'PILECAP_SLOOF_PLAT_DASAR';
      case 'PLAT':
        return isGroundFloor(floor, ground) ? 'PILECAP_SLOOF_PLAT_DASAR' : 'BALOK_PLAT';
      case 'BALOK':
        return 'BALOK_PLAT';
      case 'KOLOM':
        return 'KOLOM';
      case 'DINDING':
        return 'DINDING';
      case 'TANGGA':
        return 'TANGGA';
      case 'BOREDPILE':
        return 'BOREDPILE';
      default:
        return 'LAINNYA';
    }
  });
}
