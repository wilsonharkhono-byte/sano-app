// tools/__tests__/analyticsMaterialChain.test.ts
import { buildMaterialChain, type MaterialChainInput } from '../analytics/materialChain';

export const catalog = new Map([
  ['besi13', { name: 'Besi beton ulir 13 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['besi16', { name: 'Besi beton ulir 16 mm', category: 'Struktur', unit: 'kg', is_asset: false }],
  ['semen', { name: 'Semen PCC 40 kg', category: 'Material Beton', unit: 'zak', is_asset: false }],
  ['bata', { name: 'Bata ringan', category: 'Dinding', unit: 'pcs', is_asset: false }],
  ['scaf', { name: 'Scaffolding', category: 'Peralatan', unit: 'set', is_asset: true }],
]);
const planned = [
  { material_id: 'besi13', boq_item_id: 'k1', planned_quantity: 1000 },
  { material_id: 'besi16', boq_item_id: 'k2', planned_quantity: 3000 },
  { material_id: 'semen', boq_item_id: 'k1', planned_quantity: 200 },
  { material_id: 'bata', boq_item_id: 'd1', planned_quantity: 500 },
  { material_id: 'scaf', boq_item_id: null, planned_quantity: 10 },
];
const req = (material: string, quantity: number, status: string, created: string, reviewed: string | null = null) => ({
  material_id: material, quantity, status, created_at: `${created}T02:00:00Z`, reviewed_at: reviewed ? `${reviewed}T02:00:00Z` : null, allocations: [],
});
const requests = [
  req('besi13', 500, 'APPROVED', '2026-08-10', '2026-08-12'),
  req('besi16', 900, 'PENDING', '2026-08-20'),
  req('besi16', 300, 'REJECTED', '2026-08-21', '2026-08-22'),
  req('semen', 100, 'APPROVED', '2026-09-01'),
];
const weights = [{ boq_item_id: 'k1', weights: { BEKISTING: 0.3, PEMBESIAN: 0.4, PENGECORAN: 0.3 } }];
const vline = (row: string, pct: Record<string, number>, at: string) => ({ boq_item_id: row, verified_pct: pct, verified_at: `${at}T03:00:00Z` });
const dline = (id: string, row: string, stage: string | null, state: string, periodEnd: string, reportNo: number, lineIndex = 0) => ({
  id, boq_item_id: row, stage, activity_state: state, line_text: '', line_index: lineIndex, report_id: `r${reportNo}`, report_no: reportNo, revision: 1, period_end: periodEnd, issued_at: null,
});

export function input(over: Partial<MaterialChainInput> = {}): MaterialChainInput {
  return { today: '2026-09-17', planned, requests, catalog, weights, verifiedLines: [], diary: { lines: [], readable: true }, ...over };
}

describe('buildMaterialChain groups', () => {
  it('makes one chain per planned material group, largest plan first, with the work it feeds', () => {
    const { groups, unplannedRequested } = buildMaterialChain(input());
    expect(groups.map((g) => g.chipLabel)).toEqual(['Besi (kg) → Pembesian', 'Bata (pcs) → Pasangan', 'Semen (zak) → Pengecoran']);
    expect(groups[0]).toMatchObject({ key: 'Struktur · kg', category: 'Struktur', unit: 'kg', planned: 4000, rows: 2 });
    expect(unplannedRequested).toEqual([]);
  });

  it('lists requested groups without a plan instead of charting them', () => {
    const { groups, unplannedRequested } = buildMaterialChain(input({ planned: planned.filter((p) => p.material_id !== 'semen') }));
    expect(groups.map((g) => g.key)).toEqual(['Struktur · kg', 'Dinding · pcs']);
    expect(unplannedRequested).toEqual(['Material Beton (zak)']);
  });
});

describe('buildMaterialChain procurement series', () => {
  it('cumulates requests by the week made and approvals by the week decided, rejected left out, as % of plan', () => {
    const g = buildMaterialChain(input()).groups[0];
    expect(g.weeks.slice(0, 6)).toEqual(['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    expect(g.thisWeekIndex).toBe(5);
    expect(g.requested.slice(0, 6)).toEqual([12.5, 35, 35, 35, 35, 35]);
    expect(g.approved.slice(0, 6)).toEqual([12.5, 12.5, 12.5, 12.5, 12.5, 12.5]);
    expect(g.today).toMatchObject({ requested: 35, approved: 12.5, verified: null, diary: null });
  });

  it('falls back to the request week when an approved header has no decision time', () => {
    const g = buildMaterialChain(input({ requests: [req('besi13', 400, 'APPROVED', '2026-09-02')] })).groups[0];
    expect(g.weeks[0]).toBe('2026-08-31');
    expect(g.approved[0]).toBe(10);
  });

  it('starts the axis this week when nothing was ever recorded', () => {
    const g = buildMaterialChain(input({ requests: [] })).groups[0];
    expect(g.weeks).toEqual(['2026-09-14']);
    expect(g.requested).toEqual([0]);
    expect(g.projectionNote).toBe('Belum ada progres terverifikasi.');
  });
});
