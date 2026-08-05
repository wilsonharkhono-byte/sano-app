import fs from 'node:fs';
import path from 'node:path';
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
      'REB-DE25', 'REB-DE29', 'REB-DE32', 'REB-PL06', 'REB-PL08',
    ]);
    expect(rebarFactorByCode('REB-DE29')).toBe(62.22); // ulir 29 mm — SNI 0.006165·29²·12
    // Deleted by the strict-50 catalogue rebuild — resolving them by code would
    // promise a bar the catalogue no longer carries.
    expect(rebarFactorByCode('REB-PL10')).toBeNull();
    expect(rebarFactorByCode('REB-PL12')).toBeNull();
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

describe('rebarBatang ↔ material catalogue', () => {
  // Guards the drift this task fixed: material_master.csv is the catalogue's
  // source of truth (strict-50 rebuild), tools/rebarBatang.ts must mirror it
  // exactly or Mode Besi's diameter list and the kg↔batang factors diverge.
  const CSV = fs.readFileSync(
    path.join(__dirname, '../../assets/mock/material_master.csv'),
    'utf8',
  );

  function catalogRebarRows(): Array<{ code: string; kgPerBatang: number }> {
    return CSV.split(/\r?\n/)
      .slice(1) // header row
      .map((line) => line.split(','))
      .filter((cells) => (cells[0] ?? '').startsWith('REB-'))
      .map((cells) => ({ code: cells[0], kgPerBatang: Number(cells[6]) }));
  }

  it('REBAR_CATALOG_FACTORS matches every REB- row in material_master.csv', () => {
    const byCode = (rows: Array<{ code: string; kgPerBatang: number }>) =>
      Object.fromEntries(rows.map((r) => [r.code, r.kgPerBatang]));
    expect(byCode(REBAR_CATALOG_FACTORS)).toEqual(byCode(catalogRebarRows()));
  });

  it('every catalogue rebar row carries a kg-per-batang factor', () => {
    for (const row of catalogRebarRows()) {
      expect(Number.isFinite(row.kgPerBatang)).toBe(true);
      expect(row.kgPerBatang).toBeGreaterThan(0);
    }
  });
});
