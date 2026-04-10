import {
  checkBaselineDeviation,
  checkHistoricalPrice,
  summarizeAhsBaselinePrices,
} from '../gate2';

describe('Gate 2 baseline pricing', () => {
  it('summarizes latest AHS material prices with median and spread', () => {
    const summary = summarizeAhsBaselinePrices([
      { material_id: 'mat-1', unit_price: 10000, line_type: 'material' },
      { material_id: 'mat-1', unit_price: 12000, line_type: 'material' },
      { material_id: 'mat-1', unit_price: 14000, line_type: 'material' },
      { material_id: 'mat-2', unit_price: 5000, line_type: 'material' },
      { material_id: 'mat-2', unit_price: 0, line_type: 'material' },
      { material_id: null, unit_price: 9999, line_type: 'material' },
      { material_id: 'mat-3', unit_price: 7000, line_type: 'labor' },
    ] as any);

    expect(summary.get('mat-1')).toEqual({
      material_id: 'mat-1',
      baseline_unit_price: 12000,
      min_unit_price: 10000,
      max_unit_price: 14000,
      sample_count: 3,
      spread_pct: 33.3,
    });
    expect(summary.get('mat-2')).toEqual({
      material_id: 'mat-2',
      baseline_unit_price: 5000,
      min_unit_price: 5000,
      max_unit_price: 5000,
      sample_count: 1,
      spread_pct: 0,
    });
    expect(summary.has('mat-3')).toBe(false);
  });

  it('returns INFO when PO price stays inside a wide AHS range', () => {
    const result = checkBaselineDeviation(
      { material_name: 'Besi D16', unit_price: 13500 } as any,
      { material_id: 'mat-1' } as any,
      {
        material_id: 'mat-1',
        baseline_unit_price: 12000,
        min_unit_price: 10000,
        max_unit_price: 14000,
        sample_count: 3,
        spread_pct: 33.3,
      },
    );

    expect(result.flag).toBe('INFO');
    expect(result.msg).toContain('rentang baseline AHS');
  });

  it('returns CRITICAL when PO price materially exceeds AHS baseline', () => {
    const result = checkBaselineDeviation(
      { material_name: 'Besi D16', unit_price: 17000 } as any,
      { material_id: 'mat-1' } as any,
      {
        material_id: 'mat-1',
        baseline_unit_price: 12000,
        min_unit_price: 12000,
        max_unit_price: 12000,
        sample_count: 1,
        spread_pct: 0,
      },
    );

    expect(result.flag).toBe('CRITICAL');
    expect(result.msg).toContain('baseline AHS');
  });
});

describe('Gate 2 historical price comparison', () => {
  it('matches vendor history case-insensitively', () => {
    const result = checkHistoricalPrice(
      { material_name: 'Semen', unit_price: 112000 } as any,
      'PT Sumber Makmur',
      [
        { vendor: 'pt sumber makmur', unit_price: 100000, recorded_at: '2026-04-01T00:00:00Z' },
        { vendor: 'PT SUMBER MAKMUR', unit_price: 98000, recorded_at: '2026-03-01T00:00:00Z' },
      ] as any,
    );

    expect(result.flag).toBe('WARNING');
    expect(result.msg).toContain('dari terakhir');
  });
});
