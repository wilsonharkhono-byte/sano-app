import { selectAdapter } from '../../rebarDisaggregator/selectAdapter';
import { balokSloofAdapter } from '../../rebarDisaggregator/adapters/balokSloof';
import { poerAdapter } from '../../rebarDisaggregator/adapters/poer';
import { platAdapter } from '../../rebarDisaggregator/adapters/plat';
import { kolomAdapter } from '../../rebarDisaggregator/adapters/kolom';

describe('selectAdapter', () => {
  it.each([
    ['Sloof S24-1', 'balokSloof', 'S24-1'],
    [' - Sloof S24-1', 'balokSloof', 'S24-1'],
    ['Balok B23-1', 'balokSloof', 'B23-1'],
    ['Poer PC.1', 'poer', 'PC.1'],
    ['Poer PC.5', 'poer', 'PC.5'],
    ['Plat S2', 'plat', 'S2'],
    ['Plat S1', 'plat', 'S1'],
    ['Kolom K24', 'kolom', 'K24'],
    ['Kolom KB2A', 'kolom', 'KB2A'],
    ['  - Kolom K2A5', 'kolom', 'K2A5'],
  ])('matches %s → %s adapter, typeCode "%s"', (label, adapterName, typeCode) => {
    const result = selectAdapter(label);
    expect(result).not.toBeNull();
    expect(result!.adapter.name).toBe(adapterName);
    expect(result!.typeCode).toBe(typeCode);
  });

  it.each([
    'Pasangan bata merah',
    'Pengecoran lantai kerja',
    '',
    '   ',
    'Galian tanah',
  ])('returns null for non-rebar label: %s', (label) => {
    expect(selectAdapter(label)).toBeNull();
  });
});
