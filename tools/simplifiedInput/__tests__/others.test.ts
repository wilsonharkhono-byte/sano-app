import * as XLSX from 'xlsx';
import { parseOthersSheet, ANCHOR_CODE } from '../others';

function othersSheet(dataRows: (string | number)[][]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Material', 'Tier', 'Satuan', 'Volume', 'Harga Satuan', 'Total Harga'],
    [],
    ...dataRows,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

describe('parseOthersSheet', () => {
  const ws = othersSheet([
    ['Semen PC', 2, 'sak 40 kg', 5456, 60000, 327360000],
    ['Pasir Pasang', 3, 'm3', 347.45, 350000, 121607500],
  ]);
  const anchor = parseOthersSheet(ws)!;

  it('produces a single MATERIAL-UMUM anchor boq row with planned 1', () => {
    expect(anchor.parsed_data.code).toBe(ANCHOR_CODE);
    expect(anchor.parsed_data.unit).toBe('ls');
    expect(anchor.parsed_data.planned).toBe(1);
    expect(anchor.raw_data.chapter).toBe('Material Umum');
  });

  it('makes each Others row a component whose master_planned equals its Volume', () => {
    const comps = (anchor.parsed_data.recipe as any).components;
    expect(comps).toHaveLength(2);
    const semen = comps.find((c: any) => c.materialName === 'Semen PC');
    // master_planned = anchor.planned (1) × coefficient
    expect((anchor.parsed_data.planned as number) * semen.quantityPerUnit).toBeCloseTo(5456, 6);
    expect(semen.unit).toBe('sak 40 kg');
    expect(semen.unitPrice).toBe(60000);
  });

  it('captures file tier/price per material for the reconcile helper', () => {
    const mats = (anchor.raw_data as any).others_materials;
    expect(mats).toEqual([
      { name: 'Semen PC', tier: 2, unit: 'sak 40 kg', volume: 5456, unitPrice: 60000 },
      { name: 'Pasir Pasang', tier: 3, unit: 'm3', volume: 347.45, unitPrice: 350000 },
    ]);
  });

  it('returns null when there are no Others data rows', () => {
    expect(parseOthersSheet(othersSheet([]))).toBeNull();
  });
});
