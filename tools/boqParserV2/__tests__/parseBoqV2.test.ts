import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2', () => {
  it('parses a minimal Analisa + Material + RAB workbook end-to-end', async () => {
    const buffer = await buildFixtureBuffer([
      {
        name: 'Material',
        cells: [
          { address: 'A1', value: 'Kode' },
          { address: 'B1', value: 'Nama' },
          { address: 'C1', value: 'Satuan' },
          { address: 'D1', value: 'Harga' },
          { address: 'A2', value: 'M001' },
          { address: 'B2', value: 'Semen PC' },
          { address: 'C2', value: 'sak' },
          { address: 'D2', value: 75000 },
        ],
      },
      {
        name: 'Analisa',
        cells: [
          { address: 'B142', value: '1 m3 Lantai Kerja' },
          { address: 'B144', value: 'Semen PC' },
          { address: 'E144', formula: 'Material!$D$2', result: 75000 },
          { address: 'F144', value: 75000 },
          { address: 'B150', value: 'Jumlah' },
          { address: 'F150', formula: 'SUM(F142:F149)', result: 75000 },
          { address: 'I150', formula: 'F150', result: 75000 },
        ],
      },
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B11', value: 'A.1' },
          { address: 'C11', value: 'Lantai Kerja' },
          { address: 'D11', value: 100 },
          { address: 'G11', value: 'm3' },
        ],
      },
    ]);

    const result = await parseBoqV2(buffer, { boqSheet: 'RAB (A)' });

    expect(result.materialRows.length).toBe(1);
    expect(result.ahsBlocks.length).toBe(1);
    expect(result.boqRows.length).toBe(1);
    expect(result.validationReport.blocks[0].status).toBe('ok');

    const component = result.stagingRows.find(r => r.row_type === 'ahs');
    expect(component?.cost_basis).toBe('catalog');
  });
});

describe('parseBoqV2 nested AHS resolution', () => {
  it('links nested_ahs component to its parent block title row', async () => {
    const buffer = await buildFixtureBuffer([
      {
        name: 'Analisa',
        cells: [
          { address: 'B140', value: '1 m3 Beton K250' },
          { address: 'B144', value: 'Semen' },
          { address: 'E144', value: 75000 },
          { address: 'F144', value: 37500 },
          { address: 'B148', value: 'Jumlah' },
          { address: 'F148', formula: 'SUM(F140:F147)', result: 37500 },
          { address: 'I148', formula: 'F148', result: 37500 },
          { address: 'B175', value: '1 m3 Beton site mix' },
          { address: 'B177', value: 'Beton ready-mix' },
          { address: 'E177', formula: '$I$148', result: 37500 },
          { address: 'F177', value: 37500 },
          { address: 'B180', value: 'Jumlah' },
          { address: 'F180', formula: 'SUM(F175:F179)', result: 37500 },
          { address: 'I180', formula: 'F180', result: 37500 },
        ],
      },
    ]);
    const result = await parseBoqV2(buffer);
    const nested = result.stagingRows.find(
      r => r.cost_basis === 'nested_ahs',
    );
    expect(nested).toBeDefined();
    expect(nested?.parent_ahs_staging_id).not.toBeNull();
    const parentBlock = result.stagingRows.find(
      r =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === '1 m3 Beton K250',
    );
    expect(nested?.parent_ahs_staging_id).toBe(
      `block:${parentBlock?.row_number}`,
    );
  });

  it('resolves nested_ahs parent link when analisaSheet is overridden', async () => {
    const buffer = await buildFixtureBuffer([
      {
        name: 'AHS',
        cells: [
          { address: 'B140', value: '1 m3 Beton K250' },
          { address: 'B144', value: 'Semen' },
          { address: 'E144', value: 75000 },
          { address: 'F144', value: 37500 },
          { address: 'B148', value: 'Jumlah' },
          { address: 'F148', formula: 'SUM(F140:F147)', result: 37500 },
          { address: 'I148', formula: 'F148', result: 37500 },
          { address: 'B175', value: '1 m3 Beton site mix' },
          { address: 'B177', value: 'Beton ready-mix' },
          { address: 'E177', formula: '$I$148', result: 37500 },
          { address: 'F177', value: 37500 },
          { address: 'B180', value: 'Jumlah' },
          { address: 'F180', formula: 'SUM(F175:F179)', result: 37500 },
          { address: 'I180', formula: 'F180', result: 37500 },
        ],
      },
    ]);
    const result = await parseBoqV2(buffer, { analisaSheet: 'AHS' });
    const nested = result.stagingRows.find(
      r => r.cost_basis === 'nested_ahs',
    );
    expect(nested).toBeDefined();
    expect(nested?.parent_ahs_staging_id).not.toBeNull();
    const parentBlock = result.stagingRows.find(
      r =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === '1 m3 Beton K250',
    );
    expect(nested?.parent_ahs_staging_id).toBe(
      `block:${parentBlock?.row_number}`,
    );
  });
});
