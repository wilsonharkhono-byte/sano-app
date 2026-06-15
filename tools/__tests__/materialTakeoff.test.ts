import {
  breakdownsToRollupInput,
  buildOrderList,
  buildRollupFromBreakdowns,
} from '../materialTakeoff';
import type { RowBreakdown, BreakdownRow, BreakdownGroup } from '../boqParserV2/breakdownSheetReader.types';

// --- terse builders -----------------------------------------------------------

function line(
  group: BreakdownGroup,
  materialName: string,
  nativeUnit: string,
  qtyPerBoqUnit: number,
): BreakdownRow {
  return {
    group,
    componentGroup: `${group.toUpperCase()} (x)`,
    materialName,
    specNote: null,
    qtyPerNativeUnit: qtyPerBoqUnit,
    nativeUnit,
    nativeBasis: null,
    unitPrice: 1000,
    qtyPerBoqUnit,
    costPerBoqUnit: qtyPerBoqUnit * 1000,
    totalQty: 0, // unused by the adapter (it multiplies qtyPerBoqUnit × volume)
    totalCost: 0,
  };
}

function bd(
  boqCode: string,
  description: string,
  volume: number,
  reconciles: boolean,
  components: BreakdownRow[],
): RowBreakdown {
  return {
    boqCode,
    description,
    unit: 'm³',
    volume,
    unitCost: 0,
    lineTotal: 0,
    components,
    reconciliation: {
      computedUnitCost: 0,
      sourceUnitCost: 0,
      unitCostVariance: 0,
      computedLineTotal: 0,
      sourceLineTotal: 0,
      lineTotalVariance: 0,
      reconciles,
    },
    sourceSheet: `Breakdown ${boqCode}`,
  };
}

const boqRow = (code: string, subChapter: string) =>
  ({ code, sub_chapter: subChapter, chapter: 'PEKERJAAN FISIK LANTAI 1' } as never);

describe('breakdownsToRollupInput', () => {
  it('keeps only material-group lines and joins the sub_chapter label by code', () => {
    const breakdowns = [
      bd('III.A.3.2.1', '- Kolom K174', 2, true, [
        line('material', 'Besi beton D10', 'kg', 100),
        line('labor', 'Upah cor', 'm3', 1),
        line('equipment', 'Sewa pump', 'm3', 1),
      ]),
    ];
    const input = breakdownsToRollupInput(breakdowns, [boqRow('III.A.3.2.1', 'Kolom Lantai 1')]);
    expect(input).toHaveLength(1);
    expect(input[0].subChapter).toBe('Kolom Lantai 1');
    expect(input[0].reconciled).toBe(true);
    // labor + equipment dropped; only the material line remains
    expect(input[0].components).toHaveLength(1);
    expect(input[0].components[0]).toMatchObject({ materialName: 'Besi beton D10', unit: 'kg', quantityPerUnit: 100 });
  });

  it('passes reconciles=false straight through (rollup will exclude it)', () => {
    const input = breakdownsToRollupInput(
      [bd('III.A.4.1', '- Plat', 5, false, [line('material', 'Beton', 'm3', 1.05)])],
      [boqRow('III.A.4.1', 'Plat Lantai 1')],
    );
    expect(input[0].reconciled).toBe(false);
  });
});

describe('rollup + order list integration', () => {
  const breakdowns = [
    bd('III.A.3.2.1', '- Kolom K174', 2, true, [
      line('material', 'Beton readymix K-350', 'm3', 1.05),
      line('material', 'Besi beton D10', 'kg', 100),
    ]),
    bd('III.A.3.2.2', '- Kolom K212', 3, true, [
      line('material', 'Beton readymix K-350', 'm3', 1.05),
      line('material', 'Besi beton D10', 'kg', 50),
    ]),
    bd('III.A.4.1', '- Plat tebal 13.5', 10, false, [
      line('material', 'Beton readymix K-350', 'm3', 1.05),
    ]),
  ];
  const boqRows = [
    boqRow('III.A.3.2.1', 'Kolom Lantai 1'),
    boqRow('III.A.3.2.2', 'Kolom Lantai 1'),
    boqRow('III.A.4.1', 'Plat Lantai 1'),
  ];

  it('groups columns under one block and sums Σ(qty×vol) over reconciled bullets', () => {
    const groups = buildRollupFromBreakdowns(breakdowns, boqRows);
    const kolom = groups.find((g) => g.key === 'III.A.3.2')!;
    expect(kolom.label).toBe('Kolom Lantai 1');
    expect(kolom.reconciledCount).toBe(2);
    expect(kolom.totalVolume).toBe(5);
    const beton = kolom.materials.find((m) => m.materialName === 'Beton readymix K-350')!;
    expect(beton.totalQty).toBeCloseTo(1.05 * 2 + 1.05 * 3, 6); // 5.25
    const besi = kolom.materials.find((m) => m.materialName === 'Besi beton D10')!;
    expect(besi.totalQty).toBeCloseTo(100 * 2 + 50 * 3, 6); // 350
  });

  it('excludes the unreconciled Plat bullet from totals', () => {
    const groups = buildRollupFromBreakdowns(breakdowns, boqRows);
    const plat = groups.find((g) => g.key === 'III.A.4')!;
    expect(plat.reconciledCount).toBe(0);
    expect(plat.materials).toHaveLength(0);
    expect(plat.excluded).toHaveLength(1);
  });

  it('order list sums the same material across blocks and ignores excluded', () => {
    const groups = buildRollupFromBreakdowns(breakdowns, boqRows);
    const order = buildOrderList(groups);
    const beton = order.find((m) => m.materialName === 'Beton readymix K-350')!;
    // only the 2 reconciled Kolom bullets count; the excluded Plat does not
    expect(beton.totalQty).toBeCloseTo(5.25, 6);
  });
});
