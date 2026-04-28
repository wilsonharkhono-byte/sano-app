import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2 cost_split synthesis', () => {
  it('emits ahs_block + components for hand-priced rows with non-zero buckets', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'A7', value: 'NO' },
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          // Header labels for split columns the parser already detects
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          // Hand-priced row: literal split values, no formula chain
          { address: 'B10', value: 'Direksi keet, gudang material' },
          { address: 'C10', value: 'ls' },
          { address: 'D10', value: 1 },
          { address: 'I10', value: 12000000 },
          { address: 'J10', value: 7000000 },
          { address: 'K10', value: 1000000 },
        ],
      },
      { name: 'Analisa', cells: [] },
    ]);

    const result = await parseBoqV2(buf);

    const boqRow = result.stagingRows.find(
      (r) =>
        r.row_type === 'boq' &&
        (r.parsed_data as { label?: string }).label === 'Direksi keet, gudang material',
    );
    expect(boqRow).toBeDefined();
    expect(boqRow!.cost_basis).toBe('inline_split');

    const block = result.stagingRows.find(
      (r) =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === 'Direksi keet, gudang material (hand-priced)',
    );
    expect(block).toBeDefined();
    expect(block!.cost_basis).toBe('inline_split');

    const components = result.stagingRows.filter(
      (r) => r.row_type === 'ahs' && r.parent_ahs_staging_id === `block:${block!.row_number}`,
    );
    expect(components).toHaveLength(3);
    const names = components.map((c) => (c.parsed_data as { material_name?: string }).material_name);
    expect(names).toEqual(['Material', 'Upah', 'Peralatan']);
    const prices = components.map((c) => (c.parsed_data as { unit_price?: number }).unit_price);
    expect(prices).toEqual([12000000, 7000000, 1000000]);
  });

  it('skips zero-value buckets', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'I7', value: 'Material' },
          { address: 'J7', value: 'Upah' },
          { address: 'K7', value: 'Peralatan' },
          { address: 'B10', value: 'Tangga utama' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 1 },
          { address: 'I10', value: 7000000 },
          { address: 'J10', value: 0 },
          { address: 'K10', value: 0 },
        ],
      },
      { name: 'Analisa', cells: [] },
    ]);

    const result = await parseBoqV2(buf);
    const block = result.stagingRows.find(
      (r) =>
        r.row_type === 'ahs_block' &&
        (r.parsed_data as { title?: string }).title === 'Tangga utama (hand-priced)',
    );
    expect(block).toBeDefined();
    const components = result.stagingRows.filter(
      (r) => r.row_type === 'ahs' && r.parent_ahs_staging_id === `block:${block!.row_number}`,
    );
    expect(components).toHaveLength(1);
    expect((components[0].parsed_data as { material_name?: string }).material_name).toBe('Material');
  });

  it('does not synthesize when cost_split is null', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'B10', value: 'Galian tanah' },
          { address: 'C10', value: 'm3' },
          { address: 'D10', value: 100 },
          { address: 'E10', value: 50000 },
          { address: 'F10', value: 5000000 },
        ],
      },
      { name: 'Analisa', cells: [] },
    ]);
    const result = await parseBoqV2(buf);
    const blocks = result.stagingRows.filter(
      (r) =>
        r.row_type === 'ahs_block' &&
        ((r.parsed_data as { title?: string }).title ?? '').includes('hand-priced'),
    );
    expect(blocks).toHaveLength(0);
  });
});
