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
