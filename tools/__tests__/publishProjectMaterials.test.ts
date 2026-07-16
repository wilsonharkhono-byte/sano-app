// publishBaselineV2 → supabase pulls in react-native-url-polyfill (ESM) which
// Jest can't parse. Mock supabase, as the other publish tests do.
jest.mock('../supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { buildProjectMaterialLines } from '../publishBaselineV2';
import type { StagingRowV2 } from '../boqParserV2/types';

type Cat = { id: string; code: string; name: string; category: string; tier: 1 | 2 | 3 | 4; unit: string };
const catalog: Cat[] = [
  { id: 'mat-semen', code: 'CEM', name: 'Semen PC', category: 'x', tier: 2, unit: 'sak' },
  { id: 'mat-pasir', code: 'PSR', name: 'Pasir pasang', category: 'x', tier: 3, unit: 'm3' },
];

function materialRow(pd: Record<string, unknown>, review: 'PENDING' | 'REJECTED' = 'PENDING'): StagingRowV2 {
  return {
    row_type: 'material', row_number: 1, raw_data: {}, parsed_data: pd,
    needs_review: false, confidence: 1, review_status: review,
    cost_basis: null, parent_ahs_staging_id: null, ref_cells: null, cost_split: null,
  } as unknown as StagingRowV2;
}

describe('buildProjectMaterialLines', () => {
  it('builds NULL-boq master lines with the sheet\'s absolute Volume', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak 40 kg', volume: 5456, project_material: true }),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 347.45, project_material: true }),
    ];
    const { lines } = buildProjectMaterialLines(rows, 'master-1', catalog as never, new Map());
    expect(lines).toEqual([
      { master_id: 'master-1', material_id: 'mat-semen', boq_item_id: null, planned_quantity: 5456, unit: 'sak 40 kg' },
      { master_id: 'master-1', material_id: 'mat-pasir', boq_item_id: null, planned_quantity: 347.45, unit: 'm3' },
    ]);
  });

  it('skips REJECTED rows and rows that are not project_material', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 100, project_material: true }, 'REJECTED'),
      materialRow({ name: 'Pasir Pasang', unit: 'm3', volume: 50 /* no project_material flag */ }),
    ];
    const { lines } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());
    expect(lines).toHaveLength(0);
  });

  it('sums duplicate materials and reports unresolved ones', () => {
    const rows = [
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 100, project_material: true }),
      materialRow({ name: 'Semen PC', unit: 'sak', volume: 25, project_material: true }),
      materialRow({ name: 'Unobtanium X', unit: 'kg', volume: 5, project_material: true }),
    ];
    const { lines, unresolved } = buildProjectMaterialLines(rows, 'm', catalog as never, new Map());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ material_id: 'mat-semen', planned_quantity: 125, boq_item_id: null });
    expect(unresolved).toEqual(['Unobtanium X']);
  });
});
