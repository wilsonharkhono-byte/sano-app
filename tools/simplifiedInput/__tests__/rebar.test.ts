import { buildRebarComponent, REBAR_BATANG_BY_DIAMETER, REBAR_COLUMNS } from '../rebar';

describe('rebar batang component builder', () => {
  it('maps the six file diameters to the isolated batang catalog rows', () => {
    expect(REBAR_COLUMNS.map((c) => c.diameter)).toEqual([8, 10, 13, 16, 19, 22]);
    expect(REBAR_BATANG_BY_DIAMETER[10]).toEqual({
      code: 'REB-DE10-BTG',
      name: 'Besi beton ulir 10 mm (batang)',
    });
    expect(REBAR_BATANG_BY_DIAMETER[8].name).toBe('Besi beton polos 8 mm (batang)');
  });

  it('builds a batang component whose coefficient reproduces the lonjor count', () => {
    const betonM3 = 39.02277465724567; // "Lt. Basement ; Kolom" beton volume
    const lonjor = 517; // ø10 count
    const c = buildRebarComponent(10, lonjor, betonM3, 'SANO Input Tier 1', 'D14');
    expect(c.materialName).toBe('Besi beton ulir 10 mm (batang)');
    expect(c.unit).toBe('batang');
    expect(c.lineType).toBe('material');
    expect(c.unitPrice).toBe(0);
    // master_planned = boq.planned (betonM3) × coefficient must equal the lonjor count
    expect(c.quantityPerUnit * betonM3).toBeCloseTo(lonjor, 6);
  });

  it('throws on a diameter with no batang mapping', () => {
    expect(() => buildRebarComponent(25, 10, 5, 'S', 'A1')).toThrow(/diameter 25/);
  });
});
