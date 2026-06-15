/**
 * Regression test for the "material tab only shows the last BoQ row of each
 * kind" bug. v2 attaches per-material `ahs` staging rows to the AHS *block*,
 * and a block back-references only ONE BoQ code via `linked_boq_code`. So when
 * many BoQ rows share one concrete block (every Poer row → "Pengecoran Beton
 * KHUSUS POER"), `pivotByMaterial` — which iterated those block-linked `ahs`
 * rows — surfaced only the single linked row (e.g. Poer PC.12) under each
 * material, hiding every other Poer/Sloof/Kolom row that consumes it.
 *
 * Fix: `pivotByMaterial` derives material lines from each BoQ row's own
 * `recipe.components` (same authoritative source the BoQ tab already uses via
 * `synthesizeRecipeLines`), so every row that consumes a material shows up.
 */
import { pivotByMaterial } from '../auditPivot';
import type { AuditBoqRow, AuditAhsRow } from '../auditPivot';
import type { BoqRowRecipe, RecipeComponent } from '../boqParserV2/types';

const POER_BLOCK = 'Pengecoran Beton Readymix (KHUSUS POER)';
const READYMIX = 'Beton readymix K-350 slump 18 ± 2 cm';

function comp(partial: Partial<RecipeComponent>): RecipeComponent {
  return {
    sourceCell: { sheet: 'RAB (A)', address: 'R64' },
    referencedCell: { sheet: 'Analisa', address: 'F172' },
    referencedBlockTitle: POER_BLOCK,
    referencedBlockRow: 171,
    quantityPerUnit: 1.2,
    unitPrice: 1015650,
    costContribution: 1218780,
    lineType: 'material',
    confidence: 1,
    materialName: READYMIX,
    unit: 'm3',
    ...partial,
  };
}

function recipe(components: RecipeComponent[]): BoqRowRecipe {
  return {
    perUnit: { material: 0, labor: 0, equipment: 0, prelim: 0 },
    subkonPerUnit: 0,
    components,
    markup: null,
    totalCached: 0,
  };
}

function poer(code: string, label: string, planned: number, extraComps: RecipeComponent[] = []): AuditBoqRow {
  return {
    stagingId: `boq-${code}`,
    rowNumber: 100,
    code,
    label,
    unit: 'm3',
    planned,
    chapter: 'PEKERJAAN STRUKTUR',
    sourceSheet: 'RAB (A)',
    sourceRow: 64,
    reviewStatus: 'PENDING',
    needsReview: false,
    confidence: 1,
    costBasis: null,
    costSplit: null,
    subkonCostPerUnit: null,
    totalCost: null,
    recipe: recipe([comp({}), ...extraComps]),
  };
}

// A block-linked AHS staging row that points back to only ONE Poer row —
// exactly what the v2 parser produces for a shared block.
function linkedAhs(boqCode: string): AuditAhsRow {
  return {
    stagingId: 'ahs-linked', rowNumber: 50, boqCode, blockTitle: POER_BLOCK,
    titleRow: 171, jumlahRow: 172, lineType: 'material', materialCode: null,
    materialName: READYMIX, materialSpec: null, tier: 2, coefficient: 1.2,
    unit: 'm3', unitPrice: 1015650, wasteFactor: 0, sourceRow: 172,
    linkMethod: null, reviewStatus: 'PENDING', needsReview: false, confidence: 1,
    costBasis: null, parentAhsStagingId: null, refCells: null, costSplit: null,
    parserVersion: 'v2',
  };
}

describe('pivotByMaterial — recipe.components fan-out', () => {
  it('surfaces every BoQ row that consumes a shared material, not just the block-linked one', () => {
    const boqRows = [
      poer('III.B.1.1', '- Poer PC.1', 5),
      poer('III.B.1.2', '- Poer PC.2', 3),
      poer('III.B.1.12', '- Poer PC.12', 5.148),
    ];
    // Block links only to the last Poer row (PC.12) — the staging reality.
    const ahsRows = [linkedAhs('III.B.1.12')];

    const pivot = pivotByMaterial(boqRows, ahsRows, []);
    const readymix = pivot.find(m => m.displayName === READYMIX);
    expect(readymix).toBeDefined();

    // All three Poer rows must appear — not just PC.12 — and no double count.
    expect(readymix!.lines).toHaveLength(3);
    const codes = readymix!.lines.map(l => l.boq?.code).sort();
    expect(codes).toEqual(['III.B.1.1', 'III.B.1.12', 'III.B.1.2']);

    // Totals aggregate every row: Σ(1.2 × planned) and Σ(costContribution × planned).
    expect(readymix!.grandQty).toBeCloseTo(1.2 * (5 + 3 + 5.148), 3);
    expect(readymix!.grandCost).toBeCloseTo(1218780 * (5 + 3 + 5.148), 0);
    expect(readymix!.displayUnit).toBe('m3');
  });

  it('uses the component native unit (kg) for the material, not the BoQ row unit (m3)', () => {
    const besiD8 = comp({
      referencedCell: { sheet: 'Analisa', address: 'F128' },
      referencedBlockTitle: 'Pembesian U24 & U40',
      materialName: 'Besi D8',
      unit: 'kg',
      quantityPerUnit: 75.26,
      unitPrice: 9000,
      costContribution: 677340,
      disaggregatedFrom: 'Pembesian U24 & U40',
    });
    const boqRows = [poer('III.B.1.1', '- Poer PC.1', 5, [besiD8])];

    const pivot = pivotByMaterial(boqRows, [], []);
    const besi = pivot.find(m => m.displayName === 'Besi D8');
    expect(besi).toBeDefined();
    expect(besi!.displayUnit).toBe('kg');
    expect(besi!.grandQty).toBeCloseTo(75.26 * 5, 3);
  });

  it('falls back to block-linked AHS rows for rows without a recipe (v1)', () => {
    const v1Boq: AuditBoqRow = { ...poer('III.B.1.1', '- Poer PC.1', 5), recipe: null };
    const ahsRows = [linkedAhs('III.B.1.1')];

    const pivot = pivotByMaterial([v1Boq], ahsRows, []);
    const readymix = pivot.find(m => m.displayName === READYMIX);
    expect(readymix).toBeDefined();
    expect(readymix!.lines).toHaveLength(1);
    expect(readymix!.lines[0].boq?.code).toBe('III.B.1.1');
  });
});
