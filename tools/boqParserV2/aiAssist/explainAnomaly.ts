import { loadParserGuide } from './guideLoader';
import { getAiProvider } from './provider';
import type { BoqRowV2 } from '../extractTakeoffs';
import type { BoqRowRecipe } from '../types';

export interface AnomalyInput {
  row: Pick<BoqRowV2, 'code' | 'label' | 'unit' | 'planned' | 'cost_split' | 'total_cost' | 'source_sheet'>;
  recipe: BoqRowRecipe;
  // Delta between sum(components.costContribution) per lineType vs cost_split[lineType].
  // Positive = AI's recipe sum is higher than cached split. Negative = lower.
  deltas: { material: number; labor: number; equipment: number; prelim: number };
}

export interface AnomalyExplanation {
  likelyCause: string;          // One-sentence diagnosis
  suggestedFix: string | null;   // Concrete action, or null
  confidence: number;            // 0..1
  reasoning: string;             // Reasoning trace (one sentence)
}

// Heuristics that short-circuit obvious cases before spending an AI call.
// Each heuristic returns a full AnomalyExplanation or null.
function deterministicDiagnose(input: AnomalyInput): AnomalyExplanation | null {
  const { deltas, recipe } = input;
  const totalAbsDelta = Math.abs(deltas.material) + Math.abs(deltas.labor) + Math.abs(deltas.equipment) + Math.abs(deltas.prelim);

  // No anomaly at all
  if (totalAbsDelta < 1) {
    return {
      likelyCause: 'Recipe reconciles to cost_split within tolerance.',
      suggestedFix: null,
      confidence: 1,
      reasoning: 'sum of component deltas below 1 rupiah',
    };
  }

  // Recipe is completely empty — the formula chain wasn't resolvable
  if (recipe.components.length === 0) {
    return {
      likelyCause: 'The BoQ row\'s cost formula could not be decomposed into AHS references.',
      suggestedFix: 'Verify that the I/J/K columns reference Analisa! cells (possibly through same-sheet helper columns like AF/AG/AH).',
      confidence: 0.9,
      reasoning: 'recipe has no components',
    };
  }

  // Only the material line reconciles — labor/equipment are orphan
  const orphanLabor = Math.abs(deltas.labor) > 1 && recipe.components.filter(c => c.lineType === 'labor').length === 0;
  const orphanEquipment = Math.abs(deltas.equipment) > 1 && recipe.components.filter(c => c.lineType === 'equipment').length === 0;
  if (orphanLabor || orphanEquipment) {
    const missing = [orphanLabor ? 'labor' : null, orphanEquipment ? 'equipment' : null].filter(Boolean).join(' and ');
    return {
      likelyCause: `Cost split for ${missing} is present on the BoQ row but no matching AHS-block components were extracted.`,
      suggestedFix: `Check the ${missing === 'labor' ? 'J' : missing === 'equipment' ? 'K' : 'J and K'} column formula — it may point to a non-Analisa sheet we don't follow.`,
      confidence: 0.8,
      reasoning: 'delta present but no components for that line type',
    };
  }

  // Prelim orphan — very common because prelim items are lump sums
  if (Math.abs(deltas.prelim) > 1 && recipe.components.filter(c => c.lineType === 'prelim').length === 0) {
    return {
      likelyCause: 'Prelim cost is stored on the BoQ row as a lump sum with no AHS breakdown.',
      suggestedFix: null,
      confidence: 0.9,
      reasoning: 'prelim delta with no prelim components (common for preliminary work items)',
    };
  }

  return null;
}

function safeParse(raw: string): AnomalyExplanation {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed == null) throw new Error('response is not an object');
    return {
      likelyCause: typeof parsed.likelyCause === 'string' ? parsed.likelyCause : '',
      suggestedFix: typeof parsed.suggestedFix === 'string' ? parsed.suggestedFix : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
  } catch (e) {
    return {
      likelyCause: 'Could not parse AI response.',
      suggestedFix: null,
      confidence: 0,
      reasoning: `parse error: ${(e as Error).message}`,
    };
  }
}

export async function explainAnomaly(input: AnomalyInput): Promise<AnomalyExplanation> {
  const deterministic = deterministicDiagnose(input);
  if (deterministic) return deterministic;

  const guide = loadParserGuide();
  const systemPrompt = [
    'You are diagnosing reconciliation anomalies in parsed Indonesian construction BoQ workbooks.',
    'Follow PARSER_AI_GUIDE.md. Below is the guide:',
    '',
    guide,
    '',
    'Return ONLY valid JSON:',
    '{ "likelyCause": string (one sentence, cite cell references when possible), "suggestedFix": string | null, "confidence": number (0..1), "reasoning": string (one sentence) }',
    'Never invent numbers. If you are uncertain, set confidence low and suggestedFix to null.',
  ].join('\n');

  const userPrompt = [
    'BoQ row with reconciliation anomaly:',
    JSON.stringify({
      code: input.row.code,
      label: input.row.label,
      sourceSheet: input.row.source_sheet,
      costSplit: input.row.cost_split,
    }, null, 2),
    '',
    'Recipe assembled by the parser:',
    JSON.stringify(input.recipe, null, 2),
    '',
    'Per-line-type deltas (recipe sum minus cost_split):',
    JSON.stringify(input.deltas, null, 2),
  ].join('\n');

  const provider = getAiProvider();
  const raw = await provider.complete(systemPrompt, userPrompt);
  return safeParse(raw);
}
