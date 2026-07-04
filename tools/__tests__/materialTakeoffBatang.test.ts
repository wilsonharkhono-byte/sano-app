import { batangOrderColumns } from '../materialTakeoff';

describe('batangOrderColumns', () => {
  it('converts kg rebar rows to whole batang, rounded UP', () => {
    // 100 kg of D8 → 100 / 4.74 = 21.1 → order 22 batang
    expect(batangOrderColumns('Besi D8', 'kg', 100)).toEqual([22, 4.74]);
    // exact multiple stays exact: 14 × 7.4 = 103.6 kg of D10 → 14 batang
    expect(batangOrderColumns('Besi D10', 'kg', 103.6)).toEqual([14, 7.4]);
  });

  it('leaves non-rebar and non-kg rows blank', () => {
    expect(batangOrderColumns('Semen OPC 50 kg', 'zak', 10)).toEqual(['', '']);
    expect(batangOrderColumns('Bendrat', 'kg', 5)).toEqual(['', '']);
    expect(batangOrderColumns('Beton decking', 'kg', 12)).toEqual(['', '']);
    // derived waste line has no diameter token — stays kg (never guessed)
    expect(batangOrderColumns('Besi beton — waste (5%)', 'kg', 8)).toEqual(['', '']);
    // a rebar-looking name in a non-kg unit must not convert
    expect(batangOrderColumns('Besi D8', 'btg', 22)).toEqual(['', '']);
  });
});
