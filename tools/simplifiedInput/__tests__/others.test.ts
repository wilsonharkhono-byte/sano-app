import * as XLSX from 'xlsx';
import { parseOthersSheet } from '../others';

function othersSheet(dataRows: (string | number)[][]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan', 'Total Harga'],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

describe('parseOthersSheet', () => {
  const rows = parseOthersSheet(
    othersSheet([
      ['Semen PC', 2, 'sak 40 kg', 5456, 60000, 327360000],
      ['Pasir Pasang', 3, 'm3', 347.45, 350000, 121607500],
    ]),
  );

  it('emits one project-level material row per Others row (row_type "material")', () => {
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.row_type === 'material')).toBe(true);
    expect(rows.every((r) => (r.parsed_data as any).project_material === true)).toBe(true);
    expect(rows.every((r) => (r.raw_data as any).project_material === true)).toBe(true);
  });

  it('carries name, unit, tier, volume and unit price from the sheet', () => {
    const semen = rows[0].parsed_data as any;
    expect(semen).toMatchObject({
      code: 'OTH-001',
      name: 'Semen PC',
      unit: 'sak 40 kg',
      tier: 2,
      volume: 5456,
      reference_unit_price: 60000,
    });
    const pasir = rows[1].parsed_data as any;
    expect(pasir).toMatchObject({ code: 'OTH-002', name: 'Pasir Pasang', tier: 3, volume: 347.45 });
  });

  it('emits NO boq rows (Tier-2/3 have no BoQ relation)', () => {
    expect(rows.some((r) => r.row_type === 'boq')).toBe(false);
  });

  it('returns [] when there are no Others data rows', () => {
    expect(parseOthersSheet(othersSheet([]))).toEqual([]);
  });
});

describe('parseOthersSheet column location', () => {
  /** Build a sheet from an explicit header row + data rows (no blank spacer assumed). */
  function sheetWith(header: string[], dataRows: (string | number)[][]): XLSX.WorkSheet {
    return XLSX.utils.aoa_to_sheet([header, [], ...dataRows] as (string | number | null)[][]);
  }

  it('follows a "Keterangan" column inserted at A (2026-08-15 incident)', () => {
    // The real shifted sheet: every field one column right of the legacy A–E.
    // Reading fixed positions gave name="Umum", volume=0, tier=null and publish
    // dropped all 13 project materials silently.
    const rows = parseOthersSheet(
      sheetWith(
        ['Keterangan', 'Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan', 'Total Harga'],
        [
          ['Umum', 'Semen PC', 2, 'sak 40 kg', 5456, 60000, 327360000],
          ['Umum', 'Pasir Pasang', 3, 'm3', 347.45, 350000, 121607500],
        ],
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].parsed_data).toMatchObject({
      code: 'OTH-001',
      name: 'Semen PC',
      unit: 'sak 40 kg',
      tier: 2,
      volume: 5456,
      reference_unit_price: 60000,
    });
    expect((rows[0].raw_data as any).source_cell).toBe('B3');
    expect(rows[1].parsed_data).toMatchObject({ name: 'Pasir Pasang', tier: 3, volume: 347.45 });
  });

  it('follows reordered / re-labelled header columns', () => {
    const rows = parseOthersSheet(
      sheetWith(
        ['No', 'Volume', 'Nama Material', 'Harga Satuan', 'Satuan', 'Tier'],
        [[1, 12.5, 'Besi Beton', 9000, 'kg', 2]],
      ),
    );
    expect(rows[0].parsed_data).toMatchObject({
      name: 'Besi Beton',
      unit: 'kg',
      tier: 2,
      volume: 12.5,
      reference_unit_price: 9000,
    });
  });

  it('accepts a trailing parenthesized unit/currency in header labels', () => {
    // "Volume (m3)" / "Harga Satuan (Rp)" are plausible estimator edits; an
    // exact-only match would resolve them to null and drop every row's plan
    // (loudly, but still a degraded parse — see the 2026-08-15 review finding).
    const rows = parseOthersSheet(
      sheetWith(
        ['Material', 'Tier', 'Satuan (unit)', 'Volume (m3)', 'Harga Satuan (Rp)', 'Total Harga (Rp)'],
        [['Semen PC', 2, 'sak 40 kg', 4582, 75000, 343650000]],
      ),
    );
    expect(rows[0].parsed_data).toMatchObject({
      name: 'Semen PC',
      unit: 'sak 40 kg',
      tier: 2,
      volume: 4582,
      reference_unit_price: 75000,
    });
  });

  it('falls back to fixed A–E when no header row is recognizable (legacy sheet)', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['SANO Input Others'],
      [],
      ['Semen PC', 2, 'sak 40 kg', 5456, 60000],
    ] as (string | number | null)[][]);
    expect(parseOthersSheet(ws)[0].parsed_data).toMatchObject({
      name: 'Semen PC',
      unit: 'sak 40 kg',
      tier: 2,
      volume: 5456,
      reference_unit_price: 60000,
    });
  });

  it('leaves a column absent from the header empty rather than reading a neighbour', () => {
    // Truth-correctness: a missing "Harga Satuan" must yield price 0 (which
    // publish reports as a loud skip), never the value of whatever sits next to
    // Volume.
    const rows = parseOthersSheet(
      sheetWith(['Material', 'Tier', 'Satuan', 'Volume', 'Total Harga'], [['Semen PC', 2, 'sak', 10, 600000]]),
    );
    expect(rows[0].parsed_data).toMatchObject({ name: 'Semen PC', volume: 10, reference_unit_price: 0 });
  });
});
