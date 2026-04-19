import * as XLSX from 'xlsx';
import { resolveBoqSheets } from '../multiSheetScanner';
import { buildFixtureBuffer } from './fixtures';

describe('resolveBoqSheets', () => {
  it('returns explicit string as single-element array', async () => {
    const buf = await buildFixtureBuffer([{ name: 'RAB (A)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] }]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, 'RAB (A)')).toEqual(['RAB (A)']);
  });

  it('returns explicit array verbatim', async () => {
    const buf = await buildFixtureBuffer([
      { name: 'RAB (A)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] },
      { name: 'RAB (B)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] },
    ]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, ['RAB (A)', 'RAB (B)'])).toEqual(['RAB (A)', 'RAB (B)']);
  });

  it('auto mode picks RAB (*) sheets with real rows', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Item 1' }, { address: 'C10', value: 'm1' }, { address: 'D10', value: 10 },
        ],
      },
      { name: 'Material', cells: [{ address: 'B1', value: 'Name' }] },
      {
        name: 'RAB (B)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Item 2' }, { address: 'C10', value: 'm2' }, { address: 'D10', value: 20 },
        ],
      },
    ]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, 'auto')).toEqual(['RAB (A)', 'RAB (B)']);
  });

  it('auto mode skips empty RAB sheets', async () => {
    const buf = await buildFixtureBuffer([
      { name: 'RAB (A)', cells: [{ address: 'B7', value: 'URAIAN PEKERJAAN' }] },
      {
        name: 'RAB (B)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'B10', value: 'Item' }, { address: 'C10', value: 'm1' }, { address: 'D10', value: 10 },
        ],
      },
    ]);
    const wb = XLSX.read(buf, { cellFormula: true });
    expect(resolveBoqSheets(wb, 'auto')).toEqual(['RAB (B)']);
  });
});
