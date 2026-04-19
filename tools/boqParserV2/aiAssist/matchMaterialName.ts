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

  const resolved = typeof (result as { code?: unknown }).code === 'string'
    ? catalog.find(c => c.code === (result as { code: string }).code)
    : undefined;
  if (!resolved) {
    return { matched: null, confidence: 0, reasoning: 'AI result did not reference a real catalog code' };
  }
  return { matched: resolved, confidence, reasoning };
}
