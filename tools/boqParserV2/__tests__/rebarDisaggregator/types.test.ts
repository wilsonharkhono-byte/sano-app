import type { RecipeComponent } from '../../types';

describe('RecipeComponent disaggregator fields', () => {
  it('accepts materialName, disaggregatedFrom, role as optional', () => {
    const component: RecipeComponent = {
      sourceCell: { sheet: 'REKAP Balok', address: 'M267' },
      referencedCell: { sheet: 'REKAP Balok', address: 'M267' },
      referencedBlockTitle: null,
      referencedBlockRow: null,
      quantityPerUnit: 39.59,
      unitPrice: 10442.5,
      costContribution: 413432,
      lineType: 'material',
      confidence: 1,
      materialName: 'Besi D8',
      disaggregatedFrom: 'Pembesian U24 & U40',
      role: 'stirrup',
    };
    expect(component.materialName).toBe('Besi D8');
    expect(component.disaggregatedFrom).toBe('Pembesian U24 & U40');
    expect(component.role).toBe('stirrup');
  });

  it('accepts components without the new fields (backward compat)', () => {
    const component: RecipeComponent = {
      sourceCell: { sheet: 'RAB (A)', address: 'I59' },
      referencedCell: { sheet: 'Analisa', address: 'F82' },
      referencedBlockTitle: 'Pengecoran Beton',
      referencedBlockRow: 77,
      quantityPerUnit: 1,
      unitPrice: 2428240.77,
      costContribution: 2428240.77,
      lineType: 'material',
      confidence: 1,
    };
    expect(component.materialName).toBeUndefined();
    expect(component.role).toBeUndefined();
  });
});
