import { loadParserGuide, __resetGuideCache } from '../aiAssist';

describe('loadParserGuide', () => {
  beforeEach(() => __resetGuideCache());

  it('loads the guide and includes all six sections', () => {
    const text = loadParserGuide();
    expect(text).toMatch(/##\s+A\./i);
    expect(text).toMatch(/##\s+F\./i);
  });

  it('caches across calls', () => {
    const a = loadParserGuide();
    const b = loadParserGuide();
    expect(a).toBe(b);
  });
});
