import * as XLSX from 'xlsx';
import { resolveBoqSheets } from '../multiSheetScanner';
import { parseBoqV2 } from '..';
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

describe('parseBoqV2 multi-sheet', () => {
  it('namespaces codes when multiple sheets are parsed', async () => {
    const buf = await buildFixtureBuffer([
      { name: 'Analisa', cells: [{ address: 'B13', value: '1 m3 Beton' }, { address: 'E19', value: 'Jumlah' }, { address: 'F19', value: 100 }] },
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A9', value: 'I' }, { address: 'B9', value: 'PEKERJAAN PERSIAPAN' },
          { address: 'A11', value: 1 }, { address: 'B11', value: 'Pagar' },
          { address: 'C11', value: 'm1' }, { address: 'D11', value: 10 },
        ],
      },
      {
        name: 'RAB (B)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A9', value: 'I' }, { address: 'B9', value: 'STRUKTUR' },
          { address: 'A11', value: 1 }, { address: 'B11', value: 'Galian' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 20 },
        ],
      },
    ]);
    const result = await parseBoqV2(buf, { boqSheet: ['RAB (A)', 'RAB (B)'] });
    const codes = result.boqRows.map(r => r.code);
    expect(codes).toContain('(A) I.1');
    expect(codes).toContain('(B) I.1');
  });

  it('does NOT namespace codes when only one sheet parsed', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'A9', value: 'I' }, { address: 'B9', value: 'PREP' },
          { address: 'A11', value: 1 }, { address: 'B11', value: 'Pagar' },
          { address: 'C11', value: 'm1' }, { address: 'D11', value: 10 },
        ],
      },
    ]);
    const result = await parseBoqV2(buf, { boqSheet: 'RAB (A)' });
    const codes = result.boqRows.map(r => r.code);
    expect(codes).toContain('I.1');
    expect(codes.some(c => c.startsWith('('))).toBe(false);
  });
});
