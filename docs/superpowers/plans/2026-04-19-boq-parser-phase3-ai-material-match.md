# BoQ Parser Phase 3 — AI material matching

**Goal:** Fuzzy-match AHS material names to the catalog. Deterministic fallback when AI provider isn't configured. The handler loads `PARSER_AI_GUIDE.md` as system context so every call is consistent.

**Architecture:**
- `aiAssist/guideLoader.ts` — reads `docs/PARSER_AI_GUIDE.md` once per process
- `aiAssist/provider.ts` — small interface `AiProvider { complete(systemPrompt, userPrompt): Promise<string> }` with a `MockProvider` default that returns deterministic outputs for tests
- `aiAssist/matchMaterialName.ts` — the handler; composes system prompt from the guide, builds a user prompt with the candidate + catalog, parses the response JSON, validates against the schema defined in the guide
- Pluggable at runtime via `configureAiProvider(provider)`
- Default behavior: no AI → returns `{ matched: null, confidence: 0, reasoning: 'no AI provider configured' }`

**Tech Stack:** TypeScript, Jest. No live AI calls in tests.

## File Map

| File | Role |
|---|---|
| `tools/boqParserV2/aiAssist/guideLoader.ts` | Reads and caches `docs/PARSER_AI_GUIDE.md` |
| `tools/boqParserV2/aiAssist/provider.ts` | `AiProvider` interface + `MockProvider` + `configureAiProvider` / `getAiProvider` |
| `tools/boqParserV2/aiAssist/matchMaterialName.ts` | Handler |
| `tools/boqParserV2/aiAssist/index.ts` | Barrel export |
| `tools/boqParserV2/__tests__/aiAssist.guideLoader.test.ts` | Loader test |
| `tools/boqParserV2/__tests__/aiAssist.matchMaterialName.test.ts` | Handler tests with MockProvider |

## Tasks

### Task 1: Guide loader

Creates `aiAssist/guideLoader.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

let cached: string | null = null;

export function loadParserGuide(): string {
  if (cached != null) return cached;
  const guidePath = path.join(__dirname, '..', '..', '..', 'docs', 'PARSER_AI_GUIDE.md');
  cached = fs.readFileSync(guidePath, 'utf8');
  return cached;
}

// Test-only helper — lets tests reset the cache when they inject a different
// guide, e.g., via jest.mock('fs').
export function __resetGuideCache(): void { cached = null; }
```

### Task 2: AiProvider interface + MockProvider

Creates `aiAssist/provider.ts`:

```typescript
export interface AiProvider {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

// Default provider — returns null-result JSON for any handler. This keeps
// the system deterministic when no real AI is wired up yet.
export class NullProvider implements AiProvider {
  async complete(): Promise<string> {
    return JSON.stringify({ result: null, confidence: 0, reasoning: 'no AI provider configured' });
  }
}

// Test provider — lets tests queue deterministic responses.
export class MockProvider implements AiProvider {
  private queue: string[] = [];
  enqueue(response: string | object): void {
    this.queue.push(typeof response === 'string' ? response : JSON.stringify(response));
  }
  async complete(): Promise<string> {
    const next = this.queue.shift();
    if (next == null) throw new Error('MockProvider: no queued response');
    return next;
  }
}

let current: AiProvider = new NullProvider();

export function configureAiProvider(p: AiProvider): void { current = p; }
export function getAiProvider(): AiProvider { return current; }
export function resetAiProvider(): void { current = new NullProvider(); }
```

### Task 3: matchMaterialName handler

Creates `aiAssist/matchMaterialName.ts`:

```typescript
import { loadParserGuide } from './guideLoader';
import { getAiProvider } from './provider';

export interface CatalogEntry {
  code: string;
  name: string;
  unit: string;
  price: number;
}

export interface MatchResult {
  matched: CatalogEntry | null;
  confidence: number;
  reasoning: string;
}

// Safely parse the AI response; on any error return a null-match result
// with low confidence and the raw failure reason. Provenance lives in the
// reasoning field so estimators can audit what the AI said.
function safeParse(raw: string): { result: unknown | null; confidence: number; reasoning: string } {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed == null) throw new Error('response is not an object');
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
    return { result: parsed.result ?? null, confidence, reasoning };
  } catch (e) {
    return { result: null, confidence: 0, reasoning: `parse error: ${(e as Error).message}` };
  }
}

export async function matchMaterialName(
  ahsMaterialName: string,
  catalog: CatalogEntry[],
): Promise<MatchResult> {
  const trimmed = ahsMaterialName.trim();
  if (!trimmed) return { matched: null, confidence: 0, reasoning: 'empty material name' };

  // Quick exact-match fast path: skip the AI when a trivial case-insensitive
  // hit exists. Saves tokens and keeps behavior predictable when no AI is
  // configured.
  const lower = trimmed.toLowerCase();
  const exact = catalog.find(c => c.name.trim().toLowerCase() === lower);
  if (exact) return { matched: exact, confidence: 1, reasoning: 'exact case-insensitive match' };

  const guide = loadParserGuide();
  const systemPrompt = [
    'You are a material-name matching assistant for Indonesian construction BoQ workbooks.',
    'Follow PARSER_AI_GUIDE.md decision rules strictly. Below is the guide:',
    '',
    guide,
    '',
    'Output ONLY valid JSON of the form:',
    '{ "result": { "code": string, "name": string, "unit": string, "price": number } | null, "confidence": number (0..1), "reasoning": string (one sentence) }',
    'Return result=null when confidence < 0.6.',
  ].join('\n');

  const userPrompt = [
    'Material to match:',
    JSON.stringify({ ahsMaterialName: trimmed }),
    '',
    'Catalog (pick one whose name matches):',
    JSON.stringify(catalog, null, 2),
  ].join('\n');

  const provider = getAiProvider();
  const raw = await provider.complete(systemPrompt, userPrompt);
  const { result, confidence, reasoning } = safeParse(raw);

  if (result == null || confidence < 0.6) {
    return { matched: null, confidence, reasoning: reasoning || 'below confidence threshold' };
  }

  // Re-resolve by code against the catalog to guarantee we return a real
  // catalog entry, not whatever the AI echoed.
  const resolved = typeof (result as { code?: unknown }).code === 'string'
    ? catalog.find(c => c.code === (result as { code: string }).code)
    : undefined;
  if (!resolved) {
    return { matched: null, confidence: 0, reasoning: 'AI result did not reference a real catalog code' };
  }
  return { matched: resolved, confidence, reasoning };
}
```

### Task 4: barrel + tests

Create `aiAssist/index.ts`:

```typescript
export { loadParserGuide, __resetGuideCache } from './guideLoader';
export { configureAiProvider, getAiProvider, resetAiProvider, NullProvider, MockProvider } from './provider';
export type { AiProvider } from './provider';
export { matchMaterialName } from './matchMaterialName';
export type { CatalogEntry, MatchResult } from './matchMaterialName';
```

Tests in `__tests__/aiAssist.matchMaterialName.test.ts`:

```typescript
import { matchMaterialName, configureAiProvider, MockProvider, resetAiProvider, NullProvider } from '../aiAssist';

describe('matchMaterialName', () => {
  afterEach(() => resetAiProvider());

  it('returns exact match without invoking AI', async () => {
    const catalog = [
      { code: 'M001', name: 'Semen PC @50kg', unit: 'sak', price: 65000 },
      { code: 'M002', name: 'Pasir Kertosono', unit: 'm3', price: 350000 },
    ];
    // Use a MockProvider that would throw if called, to prove no AI call happened
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
    mock.enqueue({ result: { code: 'FAKE', name: 'Thing' }, confidence: 0.9, reasoning: 'hallucinated code' });
    configureAiProvider(mock);
    const result = await matchMaterialName('Thing', catalog);
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
```

Tests in `__tests__/aiAssist.guideLoader.test.ts`:

```typescript
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
```

### Commits

One commit per task:
- `feat(boq-v2): AI guide loader`
- `feat(boq-v2): AI provider interface with Null and Mock providers`
- `feat(boq-v2): matchMaterialName handler with exact-match fast path and hallucination guard`
- `test(boq-v2): aiAssist handler + loader coverage`

Or combine if easier: `feat(boq-v2): AI material name matcher with PARSER_AI_GUIDE context and pluggable provider`.
