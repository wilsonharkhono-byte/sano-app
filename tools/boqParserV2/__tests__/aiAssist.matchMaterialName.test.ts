import { matchMaterialName, configureAiProvider, MockProvider, resetAiProvider, NullProvider } from '../aiAssist';

describe('matchMaterialName', () => {
  afterEach(() => resetAiProvider());

  it('returns exact match without invoking AI', async () => {
    const catalog = [
      { code: 'M001', name: 'Semen PC @50kg', unit: 'sak', price: 65000 },
      { code: 'M002', name: 'Pasir Kertosono', unit: 'm3', price: 350000 },
    ];
    const mock = new MockProvider();
    configureAiProvider(mock);
    const result = await matchMaterialName('Semen PC @50kg', catalog);
    expect(result.matched?.code).toBe('M001');
    expect(result.confidence).toBe(1);
    expect(result.reasoning).toMatch(/exact/i);
  });

  it('returns null on empty input', async () => {
    const result = await matchMaterialName('  ', []);
    expect(result.matched).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('accepts a high-confidence AI match and resolves by code', async () => {
    const catalog = [{ code: 'M010', name: 'Bata Biasa (poklu)', unit: 'pcs', price: 750 }];
    const mock = new MockProvider();
    mock.enqueue({ result: { code: 'M010', name: 'Bata Biasa (poklu)', unit: 'pcs', price: 750 }, confidence: 0.9, reasoning: 'typo variant of bata biasa' });
    configureAiProvider(mock);
    const result = await matchMaterialName('bata-biasa poklu', catalog);
    expect(result.matched?.code).toBe('M010');
    expect(result.confidence).toBe(0.9);
  });

  it('rejects low-confidence AI match', async () => {
    const catalog = [{ code: 'X', name: 'Foo', unit: 'u', price: 1 }];
    const mock = new MockProvider();
    mock.enqueue({ result: { code: 'X' }, confidence: 0.3, reasoning: 'weak hit' });
    configureAiProvider(mock);
    const result = await matchMaterialName('something totally different', catalog);
    expect(result.matched).toBeNull();
    expect(result.confidence).toBe(0.3);
  });

  it('rejects AI match with unknown catalog code', async () => {
    const catalog = [{ code: 'REAL', name: 'Thing', unit: 'u', price: 1 }];
    const mock = new MockProvider();
    mock.enqueue({ result: { code: 'FAKE', name: 'Thing-variant' }, confidence: 0.9, reasoning: 'hallucinated code' });
    configureAiProvider(mock);
    const result = await matchMaterialName('Thing-variant', catalog);
    expect(result.matched).toBeNull();
    expect(result.reasoning).toMatch(/did not reference/i);
  });

  it('tolerates malformed AI JSON', async () => {
    const catalog = [{ code: 'X', name: 'Foo', unit: 'u', price: 1 }];
    const mock = new MockProvider();
    mock.enqueue('{not json');
    configureAiProvider(mock);
    const result = await matchMaterialName('weird', catalog);
    expect(result.matched).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toMatch(/parse error/i);
  });

  it('NullProvider yields null result', async () => {
    const catalog = [{ code: 'X', name: 'Foo', unit: 'u', price: 1 }];
    configureAiProvider(new NullProvider());
    const result = await matchMaterialName('nonexact', catalog);
    expect(result.matched).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
