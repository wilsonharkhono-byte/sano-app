import { parseBoqV2 } from '../index';
import { buildFixtureBuffer } from './fixtures';

describe('parseBoqV2 inline recipe handling', () => {
  it('emits one BoQ row per inline-recipe parent with synthetic AHS components', async () => {
    const buf = await buildFixtureBuffer([
      {
        name: 'RAB (A)',
        cells: [
          { address: 'B7', value: 'URAIAN PEKERJAAN' },
          { address: 'C7', value: 'SAT' },
          { address: 'D7', value: 'VOLUME' },
          { address: 'A8', value: 'III' },
          { address: 'B8', value: 'PEKERJAAN STRUKTUR' },
          { address: 'A9', value: 'A' },
          { address: 'B9', value: 'Pondasi' },
          // Inline-recipe group 1
          { address: 'B10', value: '- Poer PC.5' },
          { address: 'B11', value: '- Beton' },
          { address: 'C11', value: 'm3' }, { address: 'D11', value: 2.55 }, { address: 'E11', value: 2631890 }, { address: 'F11', value: 6711320 },
          { address: 'B12', value: '- Besi D13' },
          { address: 'C12', value: 'kg' }, { address: 'D12', value: 105.62 }, { address: 'E12', value: 12009 }, { address: 'F12', value: 1268391 },
          { address: 'B13', value: '- Bekisting Batako' },
          { address: 'C13', value: 'm2' }, { address: 'D13', value: 7.56 }, { address: 'E13', value: 100188 }, { address: 'F13', value: 757421 },
          // Regular leaf row after the recipe
          { address: 'B14', value: '- Sloof S36-1' },
          { address: 'C14', value: 'm3' }, { address: 'D14', value: 6.939 }, { address: 'E14', value: 4626604 }, { address: 'F14', value: 32104003 },
        ],
      },
      // Minimum-viable Analisa sheet so detectAhsBlocks doesn't throw
      { name: 'Analisa', cells: [] },
    ]);

    const result = await parseBoqV2(buf);

    const boqRows = result.stagingRows.filter((r) => r.row_type === 'boq');
    const inlineRecipeBoq = boqRows.find(
      (r) => (r.parsed_data as { label?: string }).label === 'Poer PC.5',
    );
    expect(inlineRecipeBoq).toBeDefined();
    expect(inlineRecipeBoq!.cost_basis).toBe('inline_recipe');
    expect((inlineRecipeBoq!.parsed_data as { unit?: string }).unit).toBe('lot');
    expect((inlineRecipeBoq!.parsed_data as { planned?: number }).planned).toBe(1);
    // Code is chapter-derived: III chapter, A sub-chapter, first sub-item
    // under the section (label starts with "-" → isSubItem=true → III.A.1).
    expect((inlineRecipeBoq!.parsed_data as { code?: string }).code).toBe('III.A.1');
    expect((inlineRecipeBoq!.parsed_data as { total_cost?: number }).total_cost).toBeCloseTo(
      6711320 + 1268391 + 757421,
      0,
    );

    // The 3 child source rows must NOT appear as their own BoQ rows
    expect(boqRows.find((r) => (r.parsed_data as { label?: string }).label === 'Beton')).toBeUndefined();
    expect(boqRows.find((r) => (r.parsed_data as { label?: string }).label === 'Besi D13')).toBeUndefined();
    expect(boqRows.find((r) => (r.parsed_data as { label?: string }).label === 'Bekisting Batako')).toBeUndefined();

    // The leaf Sloof row should still appear as its own BoQ row, code III.A.2
    const sloofBoq = boqRows.find(
      (r) => (r.parsed_data as { label?: string }).label?.includes('Sloof S36-1'),
    );
    expect(sloofBoq).toBeDefined();
    expect((sloofBoq!.parsed_data as { code?: string }).code).toBe('III.A.2');

    // Synthetic ahs_block + 3 ahs components linked to the parent's code
    const blocks = result.stagingRows.filter((r) => r.row_type === 'ahs_block');
    const recipeBlock = blocks.find(
      (r) => (r.parsed_data as { title?: string }).title === 'Poer PC.5 (inline recipe)',
    );
    expect(recipeBlock).toBeDefined();
    expect((recipeBlock!.parsed_data as { linked_boq_code?: string }).linked_boq_code).toBe('III.A.1');

    const components = result.stagingRows.filter(
      (r) => r.row_type === 'ahs' && r.parent_ahs_staging_id === `block:${recipeBlock!.row_number}`,
    );
    expect(components).toHaveLength(3);
    const materialNames = components.map((c) => (c.parsed_data as { material_name?: string }).material_name);
    expect(materialNames).toEqual(['Beton', 'Besi D13', 'Bekisting Batako']);

    // Provenance: parent's ref_cells.source_rows lists each child row
    const sourceRows = (inlineRecipeBoq!.ref_cells as { source_rows?: Array<{ row: number; label: string }> } | null)?.source_rows;
    expect(sourceRows).toBeDefined();
    expect(sourceRows).toHaveLength(3);
    expect(sourceRows!.map((s) => s.label)).toEqual(['Beton', 'Besi D13', 'Bekisting Batako']);
  });
});
