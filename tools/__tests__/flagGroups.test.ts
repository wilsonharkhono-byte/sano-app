import { groupReviewRows, subGroupByParentBlock, pendingRowIds, FLAG_GROUP_LABELS, FLAG_GROUP_HINTS } from '../flagGroups';
import type { ImportStagingRow } from '../types';

function row(partial: Partial<ImportStagingRow>): ImportStagingRow {
  return {
    id: 'id', session_id: 's', row_number: 1, row_type: 'ahs',
    raw_data: {}, parsed_data: {}, confidence: 0.5, needs_review: true,
    review_status: 'PENDING', reviewer_notes: null, created_at: '',
    ...partial,
  } as ImportStagingRow;
}

describe('groupReviewRows', () => {
  it('buckets by flag_reason in fixed order; orphan and literal groups are batchable', () => {
    const orphan = row({ row_type: 'ahs_block', raw_data: { flag_reason: 'orphan_ahs_block' } });
    const literal = row({ raw_data: { flag_reason: 'literal_component', blockTitle: 'Bekisting Balok' } });
    const groups = groupReviewRows([literal, orphan]); // input order shouldn't matter
    expect(groups.map(g => g.key)).toEqual(['orphan_ahs_block', 'literal_component']);
    expect(groups[0].batchable).toBe(true);
    expect(groups[1].batchable).toBe(true);
    expect(groups[0].label).toBe(FLAG_GROUP_LABELS.orphan_ahs_block);
  });

  it('omits empty groups and routes unknown/absent reasons to __other__', () => {
    const mystery = row({ raw_data: {} }); // flagged but no flag_reason
    const groups = groupReviewRows([mystery]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('__other__');
    expect(groups[0].batchable).toBe(false);
  });
});

describe('subGroupByParentBlock', () => {
  it('groups by blockTitle preserving first-appearance order, with counts', () => {
    const a1 = row({ raw_data: { blockTitle: 'Bekisting Balok' } });
    const b1 = row({ raw_data: { blockTitle: 'Pengecoran' } });
    const a2 = row({ raw_data: { blockTitle: 'Bekisting Balok' } });
    const subs = subGroupByParentBlock([a1, b1, a2]);
    expect(subs.map(s => s.title)).toEqual(['Bekisting Balok', 'Pengecoran']);
    expect(subs[0].rows).toHaveLength(2);
    expect(subs[1].rows).toHaveLength(1);
  });

  it('falls back to "Tanpa nama blok" when blockTitle is missing', () => {
    const subs = subGroupByParentBlock([row({ raw_data: {} })]);
    expect(subs[0].title).toBe('Tanpa nama blok');
  });
});

describe('pendingRowIds', () => {
  it('returns ids of only PENDING rows', () => {
    const p = row({ id: 'p', review_status: 'PENDING' });
    const a = row({ id: 'a', review_status: 'APPROVED' });
    expect(pendingRowIds([p, a])).toEqual(['p']);
  });
});

describe('FLAG_GROUP_HINTS', () => {
  it('explains the orphan-block group on its header', () => {
    expect(FLAG_GROUP_HINTS.orphan_ahs_block).toBe(
      'Resep harga ini ada di sheet Analisa, tapi tidak ada baris BoQ yang memakainya.',
    );
  });
});
