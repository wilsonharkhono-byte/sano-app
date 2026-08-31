import * as XLSX from 'xlsx';
import { parseTier1Sheet, BETON_MATERIAL_NAME, UNRECOGNIZED_GRADE_FLAG } from '../tier1';

function tier1Sheet(dataRows: (string | number)[][]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
    [null, null, 8, 10, 13, 16, 19, 22],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

/** Names of the components of the n-th parsed row. */
function componentNames(row: { parsed_data: Record<string, unknown> }): string[] {
  return ((row.parsed_data.recipe as any).components as any[]).map((c) => c.materialName);
}
function betonName(row: { parsed_data: Record<string, unknown> }): string | undefined {
  return componentNames(row).find((n) => n === BETON_MATERIAL_NAME || /readymix|ready mix/i.test(n));
}

describe('parseTier1Sheet', () => {
  const ws = tier1Sheet([
    ['Lt. Basement ; Kolom', 39.02277465724567, 0, 517, 57, 174, 91, 60],
    [], // blank spacer between zones
    ['Bunker; Tangga', 2.76, 7, 9, 19, 0, 0, 0],
  ]);
  const rows = parseTier1Sheet(ws);

  it('emits one boq row per non-blank work area with sequential codes', () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.parsed_data.code)).toEqual(['T1-001', 'T1-002']);
  });

  it('splits the label into chapter/sub_chapter and sets planned = beton m³', () => {
    const r = rows[0];
    expect(r.raw_data.chapter).toBe('Lt. Basement');
    expect(r.raw_data.subChapter).toBe('Kolom');
    expect(r.parsed_data.unit).toBe('m³');
    expect(r.parsed_data.planned).toBeCloseTo(39.02277465724567, 9);
  });

  it('builds a beton component with coefficient 1.0 plus one rebar component per nonzero diameter', () => {
    const comps = (rows[0].parsed_data.recipe as any).components;
    const beton = comps.find((c: any) => c.materialName === BETON_MATERIAL_NAME);
    expect(beton.quantityPerUnit).toBe(1.0);
    expect(beton.unit).toBe('m³');
    // ø8 was 0 → skipped; ø10/13/16/19/22 present → 5 rebar + 1 beton = 6
    expect(comps).toHaveLength(6);
    const d10 = comps.find((c: any) => c.materialName === 'Besi beton ulir 10 mm');
    expect(d10.unit).toBe('batang');
    expect(d10.quantityPerUnit * (rows[0].parsed_data.planned as number)).toBeCloseTo(517, 6);
  });

  it('skips fully blank rows and stops at the end of data', () => {
    const comps2 = (rows[1].parsed_data.recipe as any).components;
    // Bunker; Tangga: ø8=7, ø10=9, ø13=19 → 3 rebar + 1 beton
    expect(comps2).toHaveLength(4);
    expect(rows[1].raw_data.chapter).toBe('Bunker');
    expect(rows[1].raw_data.subChapter).toBe('Tangga');
  });
});

describe('parseTier1Sheet rebar-only work areas', () => {
  // Real case: "Umum ; Kolom Balok Praktis" — practical columns/beams cast from
  // the surrounding pours, so the estimator left Beton Readymix blank but still
  // took off 684 lonjor ø8 + 805 lonjor ø10 (~9,200 kg of rebar).
  const rows = parseTier1Sheet(
    tier1Sheet([
      ['Umum ; Kolom Balok Praktis', null as unknown as number, 684, 805, 0, 0, 0, 0],
      ['Lt. 1 ; Judul Saja', null as unknown as number, 0, 0, 0, 0, 0, 0],
    ]),
  );

  it('stages a publishable lump-sum row instead of a planned = 0 ghost', () => {
    const r = rows[0];
    expect(r.parsed_data.planned).toBe(1);
    expect(r.parsed_data.unit).toBe('ls');
    expect(r.needs_review).toBe(false);
    expect(r.raw_data.chapter).toBe('Umum');
    expect(r.raw_data.subChapter).toBe('Kolom Balok Praktis');
  });

  it('omits the Beton Readymix component rather than claiming 0 m³', () => {
    const comps = (rows[0].parsed_data.recipe as any).components;
    expect(comps.some((c: any) => c.materialName === BETON_MATERIAL_NAME)).toBe(false);
    expect(comps).toHaveLength(2);
  });

  it('INVARIANT: planned × coefficient reproduces the sheet lonjor count EXACTLY', () => {
    const planned = rows[0].parsed_data.planned as number;
    const comps = (rows[0].parsed_data.recipe as any).components;
    const d8 = comps.find((c: any) => c.materialName === 'Besi beton polos 8 mm');
    const d10 = comps.find((c: any) => c.materialName === 'Besi beton ulir 10 mm');
    expect(d8.unit).toBe('batang');
    expect(planned * d8.quantityPerUnit).toBe(684);
    expect(planned * d10.quantityPerUnit).toBe(805);
  });

  it('leaves a truly empty work area (no beton, no rebar) at planned 0 as before', () => {
    const r = rows[1];
    expect(r.parsed_data.planned).toBe(0);
    expect(r.parsed_data.unit).toBe('m³');
    expect(r.needs_review).toBe(true);
    expect((r.parsed_data.recipe as any).components).toHaveLength(1); // the beton lump only
  });
});

// ── optional "Mutu Beton" column ───────────────────────────────────────────
// The sheet's only concrete column is headed "Beton Readymix", so the parser
// emitted that bare name — which resolves to nothing in the grade-specific
// catalogue, leaving every Tier-1 work area's concrete at material_id NULL and
// therefore outside every quantity gate. The estimator now states the grade per
// row; the parser emits a name the catalogue can resolve. The column is
// OPTIONAL and lives at/after column I, so the fixed A–H contract is untouched.

/** Tier-1 sheet with a grade column. `gradeAt` is a 0-indexed column (8 = "I"). */
function tier1SheetWithGrade(
  header: string,
  dataRows: (string | number | null)[][],
  gradeAt = 8,
): XLSX.WorkSheet {
  const headerRow: (string | number | null)[] = ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'];
  headerRow[gradeAt] = header;
  const aoa: (string | number | null)[][] = [
    headerRow,
    [null, null, 8, 10, 13, 16, 19, 22],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}
/** One data row: label, beton m³, ø8..ø22, then the grade cell at `gradeAt`. */
function gradeRow(
  label: string,
  beton: number | null,
  rebar: number[],
  grade: string | number | null,
  gradeAt = 8,
): (string | number | null)[] {
  const row: (string | number | null)[] = [label, beton, ...rebar];
  while (row.length < gradeAt) row.push(null);
  row[gradeAt] = grade;
  return row;
}

describe('Tier-1 sheet WITHOUT a Mutu Beton column (backward compatibility)', () => {
  const rows = parseTier1Sheet(tier1Sheet([['Lt. 1 ; Kolom', 12.5, 0, 100, 0, 0, 0, 0]]));

  it('emits the legacy bare "Beton Readymix" name, unflagged', () => {
    expect(betonName(rows[0])).toBe(BETON_MATERIAL_NAME);
    expect(rows[0].needs_review).toBe(false);
    expect(rows[0].parsed_data.planned).toBeCloseTo(12.5, 9);
  });

  it('adds NO grade keys to raw_data — the staged row is byte-for-byte the old shape', () => {
    expect(Object.keys(rows[0].raw_data).sort()).toEqual([
      'chapter',
      'source_cell',
      'source_row',
      'source_sheet',
      'subChapter',
    ]);
  });
});

describe('Tier-1 sheet WITH a Mutu Beton column', () => {
  it('emits the catalogue alias name for a K-grade', () => {
    const rows = parseTier1Sheet(
      tier1SheetWithGrade('Mutu Beton', [gradeRow('Lt. 1 ; Kolom', 12.5, [0, 100, 0, 0, 0, 0], 'K-350')]),
    );
    expect(betonName(rows[0])).toBe('Readymix K-350');
    expect(rows[0].needs_review).toBe(false);
    expect(rows[0].raw_data.beton_grade).toBe('K-350');
  });

  it('accepts the loose K spellings estimators actually type', () => {
    const rows = parseTier1Sheet(
      tier1SheetWithGrade('Mutu', [
        gradeRow('A ; x', 1, [1, 0, 0, 0, 0, 0], 'K350'),
        gradeRow('B ; x', 1, [1, 0, 0, 0, 0, 0], 'k 350'),
        gradeRow('C ; x', 1, [1, 0, 0, 0, 0, 0], 'K 250'),
      ]),
    );
    expect(rows.map(betonName)).toEqual(['Readymix K-350', 'Readymix K-350', 'Readymix K-250']);
  });

  it("emits the catalogue row name for an fc' grade", () => {
    const rows = parseTier1Sheet(
      tier1SheetWithGrade('Grade Beton', [gradeRow('Lt. 1 ; Plat', 8, [0, 50, 0, 0, 0, 0], "fc' 25")]),
    );
    expect(betonName(rows[0])).toBe("Ready mix fc' 25 MPa");
    expect(rows[0].raw_data.beton_grade).toBe("fc' 25");
  });

  it("accepts the loose fc' spellings too", () => {
    const rows = parseTier1Sheet(
      tier1SheetWithGrade('Kelas Beton', [
        gradeRow('A ; x', 1, [1, 0, 0, 0, 0, 0], 'fc25'),
        gradeRow('B ; x', 1, [1, 0, 0, 0, 0, 0], 'FC 30'),
        gradeRow('C ; x', 1, [1, 0, 0, 0, 0, 0], "fc'25 MPa"),
      ]),
    );
    expect(rows.map(betonName)).toEqual([
      "Ready mix fc' 25 MPa",
      "Ready mix fc' 30 MPa",
      "Ready mix fc' 25 MPa",
    ]);
  });

  it('names each row per ITS OWN grade when they differ down the sheet', () => {
    const rows = parseTier1Sheet(
      tier1SheetWithGrade('Mutu Beton', [
        gradeRow('Lt. 1 ; Kolom', 12.5, [0, 100, 0, 0, 0, 0], 'K-350'),
        gradeRow('Lt. 1 ; Plat', 30.0, [0, 200, 0, 0, 0, 0], "fc' 25"),
        gradeRow('Lt. 2 ; Balok', 18.0, [0, 150, 0, 0, 0, 0], null), // grade left blank
        gradeRow('Lt. 2 ; Sloof', 5.0, [0, 40, 0, 0, 0, 0], 'K-250'),
      ]),
    );
    expect(rows.map(betonName)).toEqual([
      'Readymix K-350',
      "Ready mix fc' 25 MPa",
      BETON_MATERIAL_NAME, // blank cell → unchanged legacy behaviour
      'Readymix K-250',
    ]);
    expect(rows.every((r) => r.needs_review === false)).toBe(true);
    expect(rows[2].raw_data.beton_grade).toBeUndefined();
  });

  it('finds the column when it sits in header row 2, or further right than I', () => {
    const rowsR2 = parseTier1Sheet(
      XLSX.utils.aoa_to_sheet([
        ['Keterangan', 'Beton Readymix', 'Besi (lonjor)'],
        [null, null, 8, 10, 13, 16, 19, 22, 'Mutu Beton'],
        [],
        gradeRow('Lt. 1 ; Kolom', 12.5, [0, 100, 0, 0, 0, 0], 'K-350'),
      ] as (string | number | null)[][]),
    );
    expect(betonName(rowsR2[0])).toBe('Readymix K-350');

    const rowsFarRight = parseTier1Sheet(
      tier1SheetWithGrade('Mutu Beton', [gradeRow('Lt. 1 ; Kolom', 12.5, [0, 100, 0, 0, 0, 0], 'K-350', 11)], 11),
    );
    expect(betonName(rowsFarRight[0])).toBe('Readymix K-350');
  });

  it('leaves quantity, unit and rebar untouched — only the concrete NAME changes', () => {
    const rows = parseTier1Sheet(
      tier1SheetWithGrade('Mutu Beton', [gradeRow('Lt. 1 ; Kolom', 12.5, [0, 100, 0, 0, 0, 0], 'K-350')]),
    );
    const comps = (rows[0].parsed_data.recipe as any).components;
    const beton = comps.find((c: any) => c.materialName === 'Readymix K-350');
    expect(beton).toMatchObject({ quantityPerUnit: 1.0, unit: 'm³', unitPrice: 0, lineType: 'material' });
    expect(rows[0].parsed_data.unit).toBe('m³');
    expect(rows[0].parsed_data.planned).toBeCloseTo(12.5, 9);
    const d10 = comps.find((c: any) => c.materialName === 'Besi beton ulir 10 mm');
    expect(d10.quantityPerUnit * 12.5).toBeCloseTo(100, 6);
    expect(comps).toHaveLength(2);
  });
});

describe('Tier-1 unrecognized Mutu Beton value', () => {
  const rows = parseTier1Sheet(
    tier1SheetWithGrade('Mutu Beton', [
      gradeRow('Lt. 1 ; Kolom', 12.5, [0, 100, 0, 0, 0, 0], 'mutu tinggi'),
      gradeRow('Lt. 1 ; Plat', 8, [0, 50, 0, 0, 0, 0], 350), // bare number: K-300? fc' 350? unknowable
      gradeRow('Lt. 2 ; Balok', 18, [0, 150, 0, 0, 0, 0], 'K-350'), // the good row nearby
    ]),
  );

  it('falls back to the legacy name instead of guessing a grade', () => {
    expect(betonName(rows[0])).toBe(BETON_MATERIAL_NAME);
    expect(betonName(rows[1])).toBe(BETON_MATERIAL_NAME);
  });

  it('records a distinct parse warning naming the row and the raw value', () => {
    expect(rows[0].needs_review).toBe(true);
    expect(rows[0].raw_data.flag_reason).toBe(UNRECOGNIZED_GRADE_FLAG);
    expect(rows[0].raw_data.beton_grade_raw).toBe('mutu tinggi');
    expect(rows[0].raw_data.beton_grade_cell).toBe('I4');
    expect(rows[0].raw_data.source_sheet).toBe('SANO Input Tier 1');
    expect(rows[0].raw_data.source_row).toBe(4);
    // The bare number is refused too, and says so.
    expect(rows[1].raw_data.flag_reason).toBe(UNRECOGNIZED_GRADE_FLAG);
    expect(rows[1].raw_data.beton_grade_raw).toBe('350');
  });

  it('does not contaminate the other rows', () => {
    expect(betonName(rows[2])).toBe('Readymix K-350');
    expect(rows[2].needs_review).toBe(false);
    expect(rows[2].raw_data.flag_reason).toBeUndefined();
  });
});

describe('Tier-1 rebar-only row with a Mutu Beton cell', () => {
  const rows = parseTier1Sheet(
    tier1SheetWithGrade('Mutu Beton', [
      gradeRow('Umum ; Kolom Balok Praktis', null, [684, 805, 0, 0, 0, 0], 'K-350'),
      gradeRow('Umum ; Praktis 2', null, [100, 0, 0, 0, 0, 0], 'mutu tinggi'),
    ]),
  );

  it('still emits NO beton component — a grade does not conjure concrete', () => {
    for (const r of rows) {
      expect(componentNames(r).some((n) => /readymix|ready mix/i.test(n))).toBe(false);
    }
    expect(componentNames(rows[0])).toEqual(['Besi beton polos 8 mm', 'Besi beton ulir 10 mm']);
    expect(rows[0].parsed_data.unit).toBe('ls');
    expect(rows[0].parsed_data.planned).toBe(1);
  });

  it('is unaffected by the grade cell — no flag even when the value is junk', () => {
    // The grade only ever names the beton component; flagging a row that emits
    // none would send it to review over a cell that changes nothing.
    expect(rows.every((r) => r.needs_review === false)).toBe(true);
    expect(rows.every((r) => r.raw_data.flag_reason === undefined)).toBe(true);
    expect(rows[0].raw_data.rebar_only).toBe(true);
    expect(rows[0].raw_data.beton_grade).toBeUndefined();
  });
});
