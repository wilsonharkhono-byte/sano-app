import { topoSortBlocks } from '../publishBaselineV2';

describe('topoSortBlocks', () => {
  it('orders children after parents (deepest-first via reverse)', () => {
    // Block A references B (A is child of B)
    const stagingRows = [
      { row_number: 1, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'A' } },
      { row_number: 2, row_type: 'ahs_block' as const, parent_ahs_staging_id: null, parsed_data: { title: 'B' } },
      // Component in block A with nested_ahs → block B (via synthetic parent key)
      { row_number: 3, row_type: 'ahs' as const, parent_ahs_staging_id: 'block:2', parsed_data: {} },
    ];
    const ordered = topoSortBlocks(stagingRows as never);
    const titles = ordered.map(b => (b.parsed_data as { title: string }).title);
    // Parent B must be processed before child A
    expect(titles.indexOf('B')).toBeLessThan(titles.indexOf('A'));
  });
});
