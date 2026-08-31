import * as XLSX from 'xlsx';
import { locateGradeColumn, parseBetonGrade, betonMaterialName } from '../betonGrade';

describe('parseBetonGrade', () => {
  it('canonicalizes K-grades regardless of case, spacing and dash', () => {
    for (const raw of ['K350', 'K-350', 'k 350', 'K 350', 'k-350', '  K350  ']) {
      expect(parseBetonGrade(raw)).toEqual({ kind: 'K', value: 350, canonical: 'K-350' });
    }
  });

  it('accepts any 3-digit K-grade', () => {
    expect(parseBetonGrade('K-225')).toMatchObject({ kind: 'K', value: 225 });
    expect(parseBetonGrade('k300')).toMatchObject({ kind: 'K', value: 300 });
  });

  it("canonicalizes fc' grades, with or without the apostrophe, spacing or MPa suffix", () => {
    for (const raw of ["fc25", "fc' 25", 'FC 25', "fc'25 MPa", "f'c 25", "FC'25 mpa"]) {
      expect(parseBetonGrade(raw)).toEqual({ kind: 'fc', value: 25, canonical: "fc' 25" });
    }
  });

  it('accepts any 2-digit fc grade', () => {
    expect(parseBetonGrade("fc' 30")).toMatchObject({ kind: 'fc', value: 30 });
  });

  it('returns null for blank / whitespace-only cells (the normal "no grade stated" case)', () => {
    expect(parseBetonGrade('')).toBeNull();
    expect(parseBetonGrade('   ')).toBeNull();
  });

  it('REFUSES a bare number rather than guessing K-300 vs fc\' 30', () => {
    // Truth contract (CLAUDE.md §1.1): "30" is ambiguous between two different
    // materials at two different prices. Absent beats wrong.
    expect(parseBetonGrade('30')).toBeNull();
    expect(parseBetonGrade('350')).toBeNull();
  });

  it('returns null for free text, wrong digit counts and decorated values', () => {
    for (const raw of ['mutu tinggi', 'K35', 'K3500', "fc' 5", "fc' 250", 'K-350 (fc 29)', 'beton K-350']) {
      expect(parseBetonGrade(raw)).toBeNull();
    }
  });
});

describe('betonMaterialName', () => {
  it('emits the catalogue alias spelling for K-grades', () => {
    expect(betonMaterialName({ kind: 'K', value: 250, canonical: 'K-250' })).toBe('Readymix K-250');
    expect(betonMaterialName({ kind: 'K', value: 350, canonical: 'K-350' })).toBe('Readymix K-350');
  });

  it("emits the catalogue's canonical row name for fc' grades", () => {
    expect(betonMaterialName({ kind: 'fc', value: 25, canonical: "fc' 25" })).toBe("Ready mix fc' 25 MPa");
    expect(betonMaterialName({ kind: 'fc', value: 30, canonical: "fc' 30" })).toBe("Ready mix fc' 30 MPa");
  });
});

describe('locateGradeColumn', () => {
  function sheet(aoa: (string | number | null)[][]): { ws: XLSX.WorkSheet; range: XLSX.Range } {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    return { ws, range: XLSX.utils.decode_range(ws['!ref']!) };
  }
  const pad = (label: string | null, at: number): (string | null)[] => {
    const row: (string | null)[] = new Array(at).fill(null);
    row[at] = label;
    return row;
  };

  it('finds the column by any accepted label, case/space-insensitively', () => {
    for (const label of ['Mutu Beton', 'mutu beton', 'MUTU  BETON', 'Mutu', 'Grade Beton', 'Kelas Beton']) {
      const { ws, range } = sheet([pad(label, 8)]);
      expect(locateGradeColumn(ws, range)).toBe('I');
    }
  });

  it('finds it in header row 2 as well as row 1', () => {
    const { ws, range } = sheet([['Keterangan', 'Beton Readymix'], pad('Mutu Beton', 8)]);
    expect(locateGradeColumn(ws, range)).toBe('I');
  });

  it('finds it at any column from I rightwards', () => {
    const { ws, range } = sheet([pad('Mutu Beton', 12)]);
    expect(locateGradeColumn(ws, range)).toBe('M');
  });

  it('tolerates a trailing parenthesized annotation, as the Others reader does', () => {
    const { ws, range } = sheet([pad('Mutu Beton (K / fc)', 8)]);
    expect(locateGradeColumn(ws, range)).toBe('I');
  });

  it('NEVER claims a column inside the fixed A–H contract', () => {
    // A "Mutu Beton" label at B would mean the file is not the Tier-1 format;
    // honouring it would silently move the beton-volume column.
    const { ws, range } = sheet([['Keterangan', 'Mutu Beton', 'Besi (lonjor)']]);
    expect(locateGradeColumn(ws, range)).toBeNull();
  });

  it('returns null when the sheet has no grade column (the pre-2026-08 layout)', () => {
    const { ws, range } = sheet([
      ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
      [null, null, 8, 10, 13, 16, 19, 22],
    ]);
    expect(locateGradeColumn(ws, range)).toBeNull();
  });

  it('does not match a near-miss label by substring', () => {
    const { ws, range } = sheet([pad('Keterangan Mutu Beton Rencana', 8)]);
    expect(locateGradeColumn(ws, range)).toBeNull();
  });
});
