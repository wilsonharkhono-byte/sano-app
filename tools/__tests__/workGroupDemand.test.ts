import {
  computeSisa,
  buildWorkGroupDemand,
  formatSisaLabel,
  type DemandCatalogMaterial,
  type WorkGroupEnvelopeRow,
} from '../workGroupDemand';

const D13: DemandCatalogMaterial = {
  id: 'mat-d13', name: 'Besi beton ulir 13 mm', unit: 'kg',
  supplier_unit: 'batang', base_qty_per_supplier_unit: 12.5, tier: 1, code: 'REB-DE13',
};
const BETON: DemandCatalogMaterial = {
  id: 'mat-beton', name: "Ready mix fc' 30 MPa", unit: 'm3',
  supplier_unit: null, base_qty_per_supplier_unit: null, tier: 1, code: 'CON-RM30',
};
const SEMEN: DemandCatalogMaterial = {
  id: 'mat-semen', name: 'Semen PCC 40 kg', unit: 'zak',
  supplier_unit: null, base_qty_per_supplier_unit: null, tier: 2, code: 'CEM-PCC40',
};
const PAKU: DemandCatalogMaterial = {
  id: 'mat-paku', name: 'Paku beton', unit: 'kg',
  supplier_unit: null, base_qty_per_supplier_unit: null, tier: 4, code: 'FST-NL01',
};
const CATALOG = [D13, BETON, SEMEN, PAKU];

const row = (m: Partial<WorkGroupEnvelopeRow> & { material_id: string }): WorkGroupEnvelopeRow => ({
  planned: 0, ordered: 0, requested: 0, ...m,
});

describe('computeSisa', () => {
  it('is planned minus both burn legs', () => {
    expect(computeSisa(1000, 200, 125)).toBe(675);
  });

  it('floors at zero — an over-ordered group has no remaining need', () => {
    expect(computeSisa(100, 90, 50)).toBe(0);
  });
});

describe('buildWorkGroupDemand', () => {
  it('splits Tier 1 from Tier 2+ and keeps each list name-sorted', () => {
    const demand = buildWorkGroupDemand(
      [
        row({ material_id: 'mat-semen', planned: 400 }),
        row({ material_id: 'mat-d13', planned: 1000 }),
        row({ material_id: 'mat-beton', planned: 20 }),
        row({ material_id: 'mat-paku', planned: 5 }),
      ],
      CATALOG,
    );

    expect(demand.tier1.map(r => r.materialId)).toEqual(['mat-d13', 'mat-beton']);
    expect(demand.tier2plus.map(r => r.materialId)).toEqual(['mat-paku', 'mat-semen']);
  });

  it('drops a Tier-1 material the group does not plan (belongs in "Tambah material lain")', () => {
    const demand = buildWorkGroupDemand(
      [row({ material_id: 'mat-d13', planned: 0, requested: 40 })],
      CATALOG,
    );
    expect(demand.tier1).toEqual([]);
  });

  it('keeps a Tier 2+ row even without planned demand (project-level tracking)', () => {
    const demand = buildWorkGroupDemand(
      [row({ material_id: 'mat-semen', planned: 0, ordered: 12 })],
      CATALOG,
    );
    expect(demand.tier2plus.map(r => r.materialId)).toEqual(['mat-semen']);
    expect(demand.tier2plus[0].sisaBase).toBe(0);
  });

  it('drops an envelope row with no catalog match rather than naming it "—"', () => {
    const demand = buildWorkGroupDemand([row({ material_id: 'ghost', planned: 99 })], CATALOG);
    expect(demand.tier1).toEqual([]);
    expect(demand.tier2plus).toEqual([]);
  });

  it('carries base numbers through and converts sisa to supplier units', () => {
    const [r] = buildWorkGroupDemand(
      [row({ material_id: 'mat-d13', planned: 3000, ordered: 200, requested: 125 })],
      CATALOG,
    ).tier1;

    expect(r.plannedBase).toBe(3000);
    expect(r.orderedBase).toBe(200);
    expect(r.requestedBase).toBe(125);
    expect(r.sisaBase).toBe(2675);
    expect(r.sisaDisplay).toEqual({
      qty: 214, unit: 'batang', baseQty: 2675, baseUnit: 'kg', converted: true,
    });
  });
});

describe('formatSisaLabel', () => {
  it('shows supplier units with the base quantity alongside for rebar', () => {
    const [r] = buildWorkGroupDemand(
      [row({ material_id: 'mat-d13', planned: 2675 })],
      CATALOG,
    ).tier1;
    expect(formatSisaLabel(r)).toBe('214 batang (≈ 2.675 kg)');
  });

  it('passes a non-converting material straight through', () => {
    const [r] = buildWorkGroupDemand(
      [row({ material_id: 'mat-beton', planned: 20.5 })],
      CATALOG,
    ).tier1;
    expect(formatSisaLabel(r)).toBe('20,5 m3');
  });
});
