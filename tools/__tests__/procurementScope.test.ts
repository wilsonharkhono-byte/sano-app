import {
  buildBoqScopeTag,
  buildMaterialScopeIndex,
  deriveAutomaticScopeTag,
  normalizeBoqRefToScopeTag,
} from '../procurementScope';

describe('procurementScope', () => {
  it('groups BoQ items into package-level scope tags', () => {
    expect(buildBoqScopeTag({
      code: 'STR-01',
      label: 'Kolom Beton',
      chapter: 'Pekerjaan Struktur',
      parent_code: null,
      element_code: null,
    } as any)).toBe('Pekerjaan Struktur · STR');

    expect(buildBoqScopeTag({
      code: '1.2.1',
      label: 'Balok Beton Lantai 1',
      chapter: 'Pekerjaan Fisik Lantai 1',
      parent_code: null,
      element_code: null,
    } as any)).toBe('Pekerjaan Fisik Lantai 1 · 1');
  });

  it('aggregates material usage candidates by inferred package scope', () => {
    const scopeIndex = buildMaterialScopeIndex(
      [
        { material_id: 'mat-rebar', boq_item_id: 'boq-1', planned_quantity: 3685.5 },
        { material_id: 'mat-rebar', boq_item_id: 'boq-2', planned_quantity: 2499 },
        { material_id: 'mat-rebar', boq_item_id: 'boq-3', planned_quantity: 1738.8 },
      ] as any,
      [
        { id: 'boq-1', code: 'STR-01', label: 'Pondasi', chapter: 'Pekerjaan Struktur', parent_code: null, element_code: null },
        { id: 'boq-2', code: 'STR-02', label: 'Kolom', chapter: 'Pekerjaan Struktur', parent_code: null, element_code: null },
        { id: 'boq-3', code: 'STR-03', label: 'Balok', chapter: 'Pekerjaan Struktur', parent_code: null, element_code: null },
      ] as any,
    );

    expect(scopeIndex.get('mat-rebar')).toEqual([
      {
        scope_tag: 'Pekerjaan Struktur · STR',
        chapter: 'Pekerjaan Struktur',
        total_planned_quantity: 7923.3,
        boq_item_ids: ['boq-1', 'boq-2', 'boq-3'],
        boq_codes: ['STR-01', 'STR-02', 'STR-03'],
      },
    ]);
  });

  it('derives automatic scope tags from material baseline candidates before falling back to manual summary', () => {
    const scopeIndex = buildMaterialScopeIndex(
      [
        { material_id: 'mat-aac', boq_item_id: 'boq-arc', planned_quantity: 2200 },
        { material_id: 'mat-aac', boq_item_id: 'boq-fin', planned_quantity: 400 },
      ] as any,
      [
        { id: 'boq-arc', code: 'ARC-01', label: 'Dinding Bata Ringan', chapter: 'Pekerjaan Arsitektur', parent_code: null, element_code: null },
        { id: 'boq-fin', code: 'FIN-01', label: 'Plester Acian', chapter: 'Pekerjaan Finishing', parent_code: null, element_code: null },
      ] as any,
    );

    expect(deriveAutomaticScopeTag({
      boqMode: 'multi',
      materialId: 'mat-aac',
      draftBoqSummary: 'dinding area lt 1-3',
      materialScopeIndex: scopeIndex,
    })).toBe('Pekerjaan Arsitektur · ARC');

    expect(deriveAutomaticScopeTag({
      boqMode: 'multi',
      materialId: 'mat-custom',
      draftBoqSummary: 'pekerjaan fasad campuran',
      materialScopeIndex: scopeIndex,
    })).toBe('MULTI-BOQ · pekerjaan fasad campuran');
  });

  it('normalizes legacy BoQ refs into usable scope tags', () => {
    expect(normalizeBoqRefToScopeTag('MULTI-BOQ · pasangan bata lt 1-3')).toBe('pasangan bata lt 1-3');
    expect(normalizeBoqRefToScopeTag('STOK UMUM')).toBe('STOK UMUM');
    expect(normalizeBoqRefToScopeTag('STR-02')).toBe('STR-02');
  });
});
