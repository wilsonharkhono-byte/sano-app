/**
 * Regression test for the "only the last BoQ row of each kind shows AHS lines"
 * bug. v2 attaches per-material `ahs` staging rows to the AHS *block*, and a
 * block can only point back to ONE BoQ code via `linked_boq_code`. So when
 * many BoQ rows share one block (e.g. every Poer row → "Pengecoran Beton
 * KHUSUS POER"), only one row's MATERIAL/UPAH/PERALATAN sections populate —
 * all the others render "Belum ada baris" even though each row already carries
 * its own per-material breakdown in `recipe.components`.
 *
 * Fix: `pivotByBoq` synthesizes per-row lines from `boq.recipe.components`
 * when no block-linked AHS lines resolve to that row.
 */
import { pivotByBoq } from '../auditPivot';
import type { AuditBoqRow } from '../auditPivot';
import type { BoqRowRecipe, RecipeComponent } from '../boqParserV2/types';

function comp(partial: Partial<RecipeComponent>): RecipeComponent {
  return {
    sourceCell: { sheet: 'RAB (A)', address: 'R64' },
    referencedCell: { sheet: 'Analisa', address: 'F176' },
    referencedBlockTitle: 'Pengecoran Beton Readymix (KHUSUS POER)',
    referencedBlockRow: 171,
    quantityPerUnit: 1,
    unitPrice: 1000,
    costContribution: 1000,
    lineType: 'material',
    confidence: 1,
    ...partial,
  };
}

function boqRow(partial: Partial<AuditBoqRow>): AuditBoqRow {
  return {
    stagingId: 'boq-1',
    rowNumber: 100,
    code: 'III.B.1.14',
    label: '- Poer PC.11',
    unit: 'm3',
    planned: 5.7024,
    chapter: 'PEKERJAAN FISIK LANTAI BASEMENT',
    sourceSheet: 'RAB (A)',
    sourceRow: 64,
    reviewStatus: 'PENDING',
    needsReview: false,
    confidence: 1,
    costBasis: null,
    costSplit: null,
    subkonCostPerUnit: null,
    totalCost: null,
    recipe: null,
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

describe('pivotByBoq — recipe.components synthesis', () => {
  it('synthesizes per-row lines from recipe.components when no block-linked AHS lines resolve', () => {
    const boq = boqRow({
      recipe: recipe([
        comp({ lineType: 'material', unitPrice: 1218780, quantityPerUnit: 1, costContribution: 1218780 }),
        comp({ lineType: 'labor', unitPrice: 800000, quantityPerUnit: 1, costContribution: 800000, referencedCell: { sheet: 'Analisa', address: 'G176' } }),
        comp({ lineType: 'equipment', unitPrice: 75000, quantityPerUnit: 1, costContribution: 75000, referencedCell: { sheet: 'Analisa', address: 'H176' } }),
        comp({ lineType: 'material', materialName: 'Besi D22', unitPrice: 11282.5, quantityPerUnit: 90.17, costContribution: 1017353.28, disaggregatedFrom: 'Pembesian U24 & U40', referencedBlockTitle: 'Pembesian U24 & U40' }),
      ]),
    });

    // No AHS staging rows at all → block-linked path produces nothing.
    const [breakdown] = pivotByBoq([boq], []);

    expect(breakdown.lines).toHaveLength(4);
    expect(breakdown.lines.filter(l => l.ahs.lineType === 'material')).toHaveLength(2);
    expect(breakdown.lines.filter(l => l.ahs.lineType === 'labor')).toHaveLength(1);
    expect(breakdown.lines.filter(l => l.ahs.lineType === 'equipment')).toHaveLength(1);
  });

  it('per-line perUnitCost equals costContribution and totalCost scales by planned', () => {
    const boq = boqRow({
      planned: 2,
      recipe: recipe([
        comp({ lineType: 'material', unitPrice: 1000, quantityPerUnit: 1.5, costContribution: 1500 }),
      ]),
    });

    const [breakdown] = pivotByBoq([boq], []);

    expect(breakdown.lines[0].perUnitCost).toBeCloseTo(1500, 2);
    expect(breakdown.lines[0].totalCost).toBeCloseTo(3000, 2); // 1500 × planned(2)
    expect(breakdown.material.perUnit).toBeCloseTo(1500, 2);
    expect(breakdown.material.total).toBeCloseTo(3000, 2);
  });

  it('falls back to referencedBlockTitle when the component has no materialName', () => {
    const boq = boqRow({
      recipe: recipe([
        comp({ lineType: 'material', referencedBlockTitle: 'Pengecoran Beton Readymix (KHUSUS POER)', materialName: undefined }),
      ]),
    });

    const [breakdown] = pivotByBoq([boq], []);

    expect(breakdown.lines[0].ahs.materialName).toBe('Pengecoran Beton Readymix (KHUSUS POER)');
  });

  it('uses materialName when present (disaggregated rebar)', () => {
    const boq = boqRow({
      recipe: recipe([
        comp({ lineType: 'material', materialName: 'Besi D22', referencedBlockTitle: 'Pembesian U24 & U40' }),
      ]),
    });

    const [breakdown] = pivotByBoq([boq], []);

    expect(breakdown.lines[0].ahs.materialName).toBe('Besi D22');
  });

  it('prefers recipe synthesis over the incomplete block-linked path for v2 rows', () => {
    // Simulates III.B.1.15 (the one row the shared block back-references). The
    // block-linked path attaches a single mis-labeled 'material' line; the
    // row's own recipe is more complete and correctly classified, so recipe
    // synthesis must win when the row has components.
    const boq = boqRow({
      code: 'III.B.1.15',
      recipe: recipe([
        comp({ lineType: 'material', costContribution: 999 }),
        comp({ lineType: 'labor', costContribution: 500, referencedCell: { sheet: 'Analisa', address: 'G176' } }),
      ]),
    });
    const ahsRow = {
      stagingId: 'ahs-1', rowNumber: 50, boqCode: 'III.B.1.15', blockTitle: 'Pengecoran Beton Readymix (KHUSUS POER)',
      titleRow: 171, jumlahRow: 176, lineType: 'material' as const, materialCode: null, materialName: 'Beton readymix',
      materialSpec: null, tier: 2 as const, coefficient: 1, unit: 'm3', unitPrice: 1218780, wasteFactor: 0,
      sourceRow: 176, linkMethod: null, reviewStatus: 'PENDING', needsReview: false, confidence: 1,
      costBasis: null, parentAhsStagingId: null, refCells: null, costSplit: null, parserVersion: 'v2' as const,
    };

    const [breakdown] = pivotByBoq([boq], [ahsRow]);

    // Recipe synthesis wins: 2 correctly-classified lines, not the 1
    // mis-labeled block-linked line. No duplication.
    expect(breakdown.lines).toHaveLength(2);
    expect(breakdown.lines.every(l => l.ahs.stagingId.startsWith('recipe:'))).toBe(true);
    expect(breakdown.lines.filter(l => l.ahs.lineType === 'labor')).toHaveLength(1);
  });
});
