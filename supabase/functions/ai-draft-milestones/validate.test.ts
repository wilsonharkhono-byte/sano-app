import { validateDraftBatch, resolveLabelRefs } from './validate';

const today = '2026-04-15';
const validBoqIds = new Set(['b1', 'b2', 'b3']);

describe('validateDraftBatch', () => {
  it('rejects payload with no milestones array', () => {
    const r = validateDraftBatch({}, validBoqIds, today);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it('accepts a well-formed candidate', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'Pondasi',
        planned_date: '2026-06-01',
        boq_ids: ['b1', 'b2'],
        depends_on_labels: [],
        confidence: 0.85,
        explanation: 'Based on reference project',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it('drops unknown boq_ids but keeps the row', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'X',
        planned_date: '2026-06-01',
        boq_ids: ['b1', 'unknown'],
        depends_on_labels: [],
        confidence: 0.5,
        explanation: 'e',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].boq_ids).toEqual(['b1']);
  });

  it('rejects rows missing explanation', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'X',
        planned_date: '2026-06-01',
        boq_ids: [],
        depends_on_labels: [],
        confidence: 0.5,
        explanation: '',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/explanation/);
  });

  it('rejects past planned_date', () => {
    const r = validateDraftBatch({
      milestones: [{
        label: 'X',
        planned_date: '2025-01-01',
        boq_ids: [],
        depends_on_labels: [],
        confidence: 0.5,
        explanation: 'e',
      }],
    }, validBoqIds, today);
    expect(r.valid).toHaveLength(0);
  });

  it('clamps confidence above 1 and below 0', () => {
    const r = validateDraftBatch({
      milestones: [
        { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: [], confidence: 1.5, explanation: 'e' },
        { label: 'B', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: [], confidence: -0.3, explanation: 'e' },
      ],
    }, validBoqIds, today);
    expect(r.valid.map(v => v.confidence)).toEqual([1, 0]);
  });
});

describe('resolveLabelRefs', () => {
  it('resolves valid label references to indices', () => {
    const resolved = resolveLabelRefs([
      { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: [], confidence: 1, explanation: 'e' },
      { label: 'B', planned_date: '2026-06-10', boq_ids: [], depends_on_labels: ['A'], confidence: 1, explanation: 'e' },
    ]);
    expect(resolved[1].depends_on_indices).toEqual([0]);
  });

  it('drops self-references', () => {
    const resolved = resolveLabelRefs([
      { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: ['A'], confidence: 1, explanation: 'e' },
    ]);
    expect(resolved[0].depends_on_indices).toEqual([]);
  });

  it('drops unknown label references', () => {
    const resolved = resolveLabelRefs([
      { label: 'A', planned_date: '2026-06-01', boq_ids: [], depends_on_labels: ['Unknown'], confidence: 1, explanation: 'e' },
    ]);
    expect(resolved[0].depends_on_indices).toEqual([]);
  });
});
