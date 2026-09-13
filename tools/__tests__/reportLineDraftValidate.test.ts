// tools/__tests__/reportLineDraftValidate.test.ts
import {
  validateReportLineLinks, isLiteralQuote, normalizeForQuoteMatch, isWeightBearingStage,
  REPORT_LINE_STAGES, WEIGHT_BEARING_STAGES, LINK_QUOTE_MIN_CHARS,
} from '../reportLineDraftValidate';

const ctx = {
  lines: [
    { index: 0, text: 'Galian Pondasi Pile Cap :: Pekerjaan galian pile cap dilanjutkan dari pekerjaan kemarin.' },
    { index: 1, text: 'Pengerjaan Bekisting Pile Cap :: Melanjutkan pekerjaan bekisting pile cap.' },
  ],
  boqCodes: ['T1-002', 'T1-003'],
};
const link = (over: Record<string, unknown> = {}) => ({
  line_index: 1, boq_item_code: 't1-002', stage: 'BEKISTING', activity_state: 'LANJUT', confidence: 'high',
  quote: 'Melanjutkan pekerjaan bekisting', ...over,
});

describe('validateReportLineLinks', () => {
  it('refuses an answer without a links array', () => {
    expect(validateReportLineLinks(null, ctx)).toEqual({ ok: false, reason: expect.any(String) });
    expect(validateReportLineLinks({ links: 'x' }, ctx).ok).toBe(false);
  });

  it('resolves the row code case-insensitively and keeps a literal quote', () => {
    const r = validateReportLineLinks({ links: [link()] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(r.links[1]).toEqual({
      line_index: 1, boq_item_code: 'T1-002', stage: 'BEKISTING', activity_state: 'LANJUT',
      confidence: 'high', quote: 'Melanjutkan pekerjaan bekisting',
    });
  });

  it('returns exactly one link per context line, in context order, filling unanswered lines as unlinked low', () => {
    const r = validateReportLineLinks({ links: [link()] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(r.links.map((l) => l.line_index)).toEqual([0, 1]);
    expect(r.links[0]).toEqual({ line_index: 0, boq_item_code: null, stage: null, activity_state: 'LANJUT', confidence: 'low', quote: null });
    expect(r.dropped.some((d) => d.line_index === 0 && d.field === 'links[]')).toBe(true);
  });

  it('turns an unknown row code into null with low confidence', () => {
    const r = validateReportLineLinks({ links: [link({ boq_item_code: 'T9-999' })] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(r.links[1].boq_item_code).toBeNull();
    expect(r.links[1].confidence).toBe('low');
    expect(r.dropped.some((d) => d.field === 'boq_item_code')).toBe(true);
  });

  it('drops a paraphrased quote and lowers high to medium when the row is kept', () => {
    const r = validateReportLineLinks({ links: [link({ quote: 'bekisting dilanjutkan lagi' })] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(r.links[1].quote).toBeNull();
    expect(r.links[1].confidence).toBe('medium');
  });

  it('drops an unknown stage and defaults an unknown activity state to LANJUT', () => {
    const r = validateReportLineLinks({ links: [link({ stage: 'COR', activity_state: 'done' })] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(r.links[1].stage).toBeNull();
    expect(r.links[1].activity_state).toBe('LANJUT');
  });

  it('ignores an index that is not a report line and keeps the first of a duplicate index', () => {
    const r = validateReportLineLinks(
      { links: [link({ line_index: 7 }), link({ confidence: 'medium' }), link({ confidence: 'low' })] },
      ctx,
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.links[1].confidence).toBe('medium');
    expect(r.dropped.filter((d) => d.field === 'line_index')).toHaveLength(2);
  });

  it('a link with no row is always low confidence, whatever the model claims', () => {
    const r = validateReportLineLinks({ links: [link({ boq_item_code: null, confidence: 'high', quote: null })] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(r.links[1].confidence).toBe('low');
  });

  it('strips unknown keys: the output carries exactly the six link fields', () => {
    const r = validateReportLineLinks({ links: [link({ percent: 40, cost: 1 })] }, ctx);
    if (!r.ok) throw new Error('expected ok');
    expect(Object.keys(r.links[1]).sort()).toEqual(['activity_state', 'boq_item_code', 'confidence', 'line_index', 'quote', 'stage']);
  });
});

describe('quote matching', () => {
  it('normalizes quotes, dashes, zero-width characters, whitespace and case', () => {
    expect(normalizeForQuoteMatch('Pile​ Cap  – “Sloof”')).toBe('pile cap - "sloof"');
    expect(isLiteralQuote('galian PILE cap', 'Pekerjaan galian pile cap dilanjutkan')).toBe(true);
  });
  it(`refuses quotes shorter than ${LINK_QUOTE_MIN_CHARS} characters`, () => {
    expect(isLiteralQuote('cap', 'pile cap')).toBe(false);
  });
});

describe('stage vocabulary', () => {
  it('weight-bearing stages are a subset of all stages', () => {
    for (const s of WEIGHT_BEARING_STAGES) expect(REPORT_LINE_STAGES).toContain(s);
    expect(isWeightBearingStage('PENGECORAN')).toBe(true);
    expect(isWeightBearingStage('GALIAN')).toBe(false);
    expect(isWeightBearingStage(null)).toBe(false);
  });
});
