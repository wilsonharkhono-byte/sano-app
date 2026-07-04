import {
  REBAR_KG_PER_M,
  REBAR_KG_PER_BATANG,
  BATANG_LENGTH_M,
  rebarFactorByCode,
  rebarFactorByName,
  REBAR_CATALOG_FACTORS,
} from '../rebarBatang';

describe('rebarBatang', () => {
  it('derives every kg-per-batang value as kg/m × 12, rounded to 2 dp', () => {
    for (const [dia, kgPerM] of Object.entries(REBAR_KG_PER_M)) {
      const expected = Math.round(kgPerM * BATANG_LENGTH_M * 100) / 100;
      expect(REBAR_KG_PER_BATANG[Number(dia)]).toBe(expected);
    }
  });

  it('matches the fixed contract values', () => {
    expect(REBAR_KG_PER_BATANG[6]).toBe(2.66);
    expect(REBAR_KG_PER_BATANG[8]).toBe(4.74);
    expect(REBAR_KG_PER_BATANG[10]).toBe(7.4);
    expect(REBAR_KG_PER_BATANG[12]).toBe(10.66);
    expect(REBAR_KG_PER_BATANG[13]).toBe(12.5);
    expect(REBAR_KG_PER_BATANG[16]).toBe(18.94);
    expect(REBAR_KG_PER_BATANG[19]).toBe(26.71);
    expect(REBAR_KG_PER_BATANG[22]).toBe(35.81);
    expect(REBAR_KG_PER_BATANG[25]).toBe(46.24);
    expect(REBAR_KG_PER_BATANG[32]).toBe(75.76);
  });

  it('maps catalog codes to factors', () => {
    expect(rebarFactorByCode('REB-PL08')).toBe(4.74);
    expect(rebarFactorByCode('REB-DE13')).toBe(12.5);
    expect(rebarFactorByCode('REB-DE32')).toBe(75.76);
    expect(rebarFactorByCode('CEM-OPC50')).toBeNull();
    expect(rebarFactorByCode('REB-WR01')).toBeNull(); // bendrat is wire, stays kg
    expect(rebarFactorByCode(null)).toBeNull();
  });

  it('exposes exactly the 10 rebar catalog rows', () => {
    expect(REBAR_CATALOG_FACTORS).toHaveLength(10);
    expect(REBAR_CATALOG_FACTORS.map((f) => f.code).sort()).toEqual([
      'REB-DE10', 'REB-DE13', 'REB-DE16', 'REB-DE19', 'REB-DE22',
      'REB-DE25', 'REB-DE32', 'REB-PL06', 'REB-PL08', 'REB-PL12',
    ]);
  });

  it('matches rebar factors from workbook component names', () => {
    expect(rebarFactorByName('Besi D8')).toBe(4.74);
    expect(rebarFactorByName('Besi D13')).toBe(12.5);
    expect(rebarFactorByName('Besi beton ulir 16 mm')).toBeNull(); // catalog name, no D-token — resolve by code instead
    expect(rebarFactorByName('Besi beton D-10')).toBe(7.4);
    expect(rebarFactorByName('Besi Tulangan Ø16')).toBe(18.94);
    expect(rebarFactorByName('Besi beton P-12')).toBe(10.66);
    expect(rebarFactorByName('Bendrat')).toBeNull();
    expect(rebarFactorByName('Beton decking')).toBeNull();
    expect(rebarFactorByName('Besi beton — waste (5%)')).toBeNull(); // aggregate waste line stays kg
  });
});
