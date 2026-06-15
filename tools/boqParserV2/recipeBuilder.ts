import type { HarvestLookup, CostSplit, BoqRowRecipe, RecipeComponent } from './types';
import type { AhsBlock } from './detectBlocks';
import { evaluateFormula } from './formulaEval';

type LineType = RecipeComponent['lineType'];

export interface BuildRecipeInput {
  sourceRow: number;
  sourceSheet: string;
  costSplit: CostSplit;
  subkonPerUnit: number;
  splitColumns: {
    material: string;
    labor: string;
    equipment: string;
    subkon: string | null;
    prelim: string | null;
  };
  markupCell: string;
  totalCell: string;
  lookup: HarvestLookup;
  blocks: AhsBlock[];
  analisaSheet: string;
}

function findBlockFor(
  blocks: AhsBlock[],
  cell: { sheet: string; address: string },
  analisaSheet: string,
): AhsBlock | null {
  if (cell.sheet !== analisaSheet) return null;
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(cell.address);
  if (!m) return null;
  const row = parseInt(m[2], 10);
  return blocks.find(b => row >= b.titleRow && row <= b.jumlahRow) ?? null;
}

function evalColumn(
  col: string,
  lineType: LineType,
  input: BuildRecipeInput,
): { components: RecipeComponent[]; markup: BoqRowRecipe['markup'] } {
  const addr = `${col}${input.sourceRow}`;
  const cell = input.lookup.get(`${input.sourceSheet}!${addr}`);
  if (!cell) return { components: [], markup: null };

  const res = evaluateFormula(cell, input.lookup, { targetSheet: input.analisaSheet });
  const components: RecipeComponent[] = res.components.map(c => {
    const block = findBlockFor(input.blocks, c.referencedCell, input.analisaSheet);
    // Honor the truth-correctness contract: a quantity/cost we could not compute
    // (NaN — e.g. produced by an unresolved Excel function in the formula) must
    // stay visibly unresolved, never silently coerced to a confident 0. We keep
    // the NaN so downstream review/reconciliation flags the row, and drop the
    // confidence to 0 so it can never masquerade as a verified value.
    const unresolved =
      !Number.isFinite(c.coefficient) ||
      !Number.isFinite(c.costContribution) ||
      !Number.isFinite(c.unitPrice);
    return {
      sourceCell: c.sourceCell,
      referencedCell: c.referencedCell,
      referencedBlockTitle: block?.title ?? null,
      referencedBlockRow: block?.titleRow ?? null,
      quantityPerUnit: c.coefficient,
      unitPrice: c.unitPrice,
      costContribution: c.costContribution,
      lineType,
      confidence: unresolved ? 0 : c.confidence * res.confidence,
    };
  });
  return {
    components,
    markup: res.markup
      ? { factor: res.markup.factor, sourceCell: res.markup.sourceCell, sourceLabel: null }
      : null,
  };
}

export function buildRecipe(input: BuildRecipeInput): BoqRowRecipe {
  const mat = evalColumn(input.splitColumns.material, 'material', input);
  const lab = evalColumn(input.splitColumns.labor, 'labor', input);
  const eqp = evalColumn(input.splitColumns.equipment, 'equipment', input);
  const subkon = input.splitColumns.subkon
    ? evalColumn(input.splitColumns.subkon, 'subkon', input)
    : { components: [], markup: null };
  const prelim = input.splitColumns.prelim
    ? evalColumn(input.splitColumns.prelim, 'prelim', input)
    : { components: [], markup: null };

  const priceCell = input.lookup.get(`${input.sourceSheet}!${input.markupCell}${input.sourceRow}`);
  const priceEval = priceCell
    ? evaluateFormula(priceCell, input.lookup, { targetSheet: input.analisaSheet })
    : null;

  const totalCell = input.lookup.get(`${input.sourceSheet}!${input.totalCell}${input.sourceRow}`);
  const totalCached = totalCell ? Number(totalCell.value ?? 0) : 0;

  return {
    perUnit: input.costSplit,
    subkonPerUnit: input.subkonPerUnit,
    components: [
      ...mat.components,
      ...lab.components,
      ...eqp.components,
      ...subkon.components,
      ...prelim.components,
    ],
    markup: priceEval?.markup
      ? { factor: priceEval.markup.factor, sourceCell: priceEval.markup.sourceCell, sourceLabel: null }
      : (mat.markup ?? lab.markup ?? eqp.markup ?? null),
    totalCached,
  };
}
