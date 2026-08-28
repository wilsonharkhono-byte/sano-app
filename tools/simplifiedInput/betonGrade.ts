import * as XLSX from 'xlsx';
import { headerCandidates } from './headers';

/**
 * The optional per-row concrete-grade ("Mutu Beton") column of the Tier-1 sheet.
 *
 * WHY THIS EXISTS. The sheet's only concrete column is headed "Beton Readymix",
 * so the parser had nothing but the bare name `Beton Readymix` to emit. That name
 * resolves to NOTHING in the curated catalogue — which carries grade-specific
 * rows (`Ready mix fc' 25 MPa` / `Ready mix fc' 30 MPa`, aliased from
 * `Readymix K-250`, `Ready Mix K-250`, `Ready mix kelas 25`, …). Every Tier-1
 * work area therefore published its concrete with `material_id = NULL`, which
 * silently excluded it from every quantity gate: the single biggest line item in
 * the project was ungated.
 *
 * The fix is an INPUT fix. The estimator states the grade per row; the parser
 * emits a name the catalogue can actually resolve. We never infer the grade from
 * the element type, the zone, or a project default — that would be exactly the
 * confident-looking invented number CLAUDE.md §1.1 forbids. No column, or a
 * blank cell, keeps the old bare name (which publishes unresolved and is
 * reported); an unrecognized value is flagged for review, never guessed.
 */

/**
 * Header labels that mark the grade column, normalized (lowercased, punctuation
 * and repeated spaces collapsed). Matching is EXACT against these, in the same
 * style as `others.ts` — a substring rule would let "Mutu Beton Rencana (catatan)"
 * or "Keterangan Mutu" claim the column and hand us a note instead of a grade.
 */
const GRADE_COLUMN_LABELS = ['mutu beton', 'mutu', 'grade beton', 'kelas beton'];

/** Tier-1 header rows (1-indexed): row 1 group labels, row 2 diameter sub-headers. */
const HEADER_ROWS = [1, 2];

/**
 * First column the grade may occupy. A–H is the sheet's FIXED contract (label,
 * beton m³, ø8…ø22) and the rest of the parser reads those positionally; a
 * "Mutu Beton" label inside that span would mean the file is not the Tier-1
 * format at all. So we never look before column I, and detecting the grade
 * column can never move or shadow A–H.
 */
const FIRST_GRADE_COL = XLSX.utils.decode_col('I'); // 8, 0-indexed

export interface BetonGrade {
  /** 'K' = Indonesian characteristic cube strength; 'fc' = SNI cylinder strength in MPa. */
  kind: 'K' | 'fc';
  /** The numeric strength: 350 for K-350, 25 for fc' 25. */
  value: number;
  /** Canonical rendering for provenance/display: "K-350" or "fc' 25". */
  canonical: string;
}

/**
 * Locate the optional grade column, or null when the sheet doesn't have one
 * (the pre-2026-08 layout, and any sheet an estimator hasn't updated yet).
 * Returns a column letter, e.g. "I".
 */
export function locateGradeColumn(ws: XLSX.WorkSheet, range: XLSX.Range): string | null {
  for (const headerRow of HEADER_ROWS) {
    const r0 = headerRow - 1; // decode_range rows are 0-indexed
    if (r0 < range.s.r || r0 > range.e.r) continue;
    for (let c0 = Math.max(range.s.c, FIRST_GRADE_COL); c0 <= range.e.c; c0++) {
      const cell = ws[XLSX.utils.encode_cell({ r: r0, c: c0 })];
      if (!cell || cell.v == null) continue;
      if (headerCandidates(String(cell.v)).some((l) => GRADE_COLUMN_LABELS.includes(l))) {
        return XLSX.utils.encode_col(c0);
      }
    }
  }
  return null;
}

/**
 * Normalize a grade cell to a canonical grade, or null when it is blank or
 * unrecognized (the caller distinguishes the two — blank is normal, unrecognized
 * is a review flag).
 *
 * Accepted, case- and space-insensitively:
 *   K-grades   "K350" | "K-350" | "k 350" | "K 350"        → K-350   (3 digits)
 *   fc' grades "fc25" | "fc' 25" | "FC 25" | "fc'25 MPa"   → fc' 25  (2 digits)
 *              (and the equally common "f'c 25" spelling)
 *
 * A BARE NUMBER is deliberately NOT accepted. "30" could be K-300 or fc' 30 and
 * the two are different materials at different prices; picking one would be a
 * guess dressed as data. It falls through to the unrecognized path, where the
 * estimator is asked instead.
 */
export function parseBetonGrade(raw: string): BetonGrade | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;

  const k = /^k\s*-?\s*(\d{3})$/.exec(s);
  if (k) {
    const value = Number(k[1]);
    return { kind: 'K', value, canonical: `K-${value}` };
  }

  const fc = /^f\s*'?\s*c\s*'?\s*-?\s*(\d{2})(?:\s*mpa)?$/.exec(s);
  if (fc) {
    const value = Number(fc[1]);
    return { kind: 'fc', value, canonical: `fc' ${value}` };
  }

  return null;
}

/**
 * The material name to emit for a stated grade.
 *
 * K-grades use the catalogue's ALIAS spelling (`Readymix K-250`, seeded in
 * migration 003 and kept through the strict-50 rebuild); fc' grades use the
 * catalogue's CANONICAL row name (`Ready mix fc' 25 MPa`). Both go through
 * publish's exact→alias→fuzzy matcher, so a grade the catalogue doesn't stock
 * still fails LOUDLY as an unresolved component rather than binding to the
 * wrong concrete.
 */
export function betonMaterialName(grade: BetonGrade): string {
  return grade.kind === 'K' ? `Readymix K-${grade.value}` : `Ready mix fc' ${grade.value} MPa`;
}
