import { buildReceiptLinesPayload, type ReceiveLineDraft } from '../receiptLinesPayload';

// A draft with sensible defaults; individual tests override what they exercise.
function draft(over: Partial<ReceiveLineDraft>): ReceiveLineDraft {
  return {
    po_line_id: 'pol-1',
    material_id: 'mat-1',
    material_name: 'Semen 50kg',
    qtyInput: '10',
    factor: null,
    baseUnit: 'sak',
    ...over,
  };
}

describe('buildReceiptLinesPayload', () => {
  it('carries a filled line through with identity conversion (no factor)', () => {
    const out = buildReceiptLinesPayload([draft({ qtyInput: '12', factor: null, baseUnit: 'sak' })]);
    expect(out).toEqual([
      { po_line_id: 'pol-1', material_id: 'mat-1', material_name: 'Semen 50kg', quantity: 12, unit: 'sak' },
    ]);
  });

  it('converts a rebar line from supplier (batang) to base (kg) via its factor', () => {
    // 5 batang × 7.4 kg/batang = 37 kg
    const out = buildReceiptLinesPayload([
      draft({ po_line_id: 'pol-r', material_id: 'mat-r', material_name: 'Besi D10', qtyInput: '5', factor: 7.4, baseUnit: 'kg' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBeCloseTo(37, 6);
    expect(out[0].unit).toBe('kg');
    expect(out[0].po_line_id).toBe('pol-r');
    expect(out[0].material_id).toBe('mat-r');
  });

  it('skips zero-qty, blank, and non-numeric lines (they must never reach the CHECK(quantity_actual > 0) column)', () => {
    const out = buildReceiptLinesPayload([
      draft({ po_line_id: 'a', qtyInput: '0' }),
      draft({ po_line_id: 'b', qtyInput: '' }),
      draft({ po_line_id: 'c', qtyInput: '   ' }),
      draft({ po_line_id: 'd', qtyInput: 'abc' }),
      draft({ po_line_id: 'e', qtyInput: '-3' }),
    ]);
    expect(out).toEqual([]);
  });

  it('returns only the positive lines from a mixed 3-line PO (partial receive)', () => {
    const out = buildReceiptLinesPayload([
      draft({ po_line_id: 'l1', material_id: 'm1', material_name: 'Pasir', qtyInput: '2', baseUnit: 'm3' }),
      draft({ po_line_id: 'l2', material_id: 'm2', material_name: 'Batu', qtyInput: '', baseUnit: 'm3' }),
      draft({ po_line_id: 'l3', material_id: 'm3', material_name: 'Semen', qtyInput: '30', baseUnit: 'sak' }),
    ]);
    expect(out.map((l) => l.po_line_id)).toEqual(['l1', 'l3']);
    expect(out.map((l) => l.material_id)).toEqual(['m1', 'm3']);
  });

  it('preserves a NULL material_id (free-text line) while keeping its po_line_id', () => {
    const out = buildReceiptLinesPayload([
      draft({ po_line_id: 'pol-free', material_id: null, material_name: 'Kayu bekas', qtyInput: '4', baseUnit: 'batang' }),
    ]);
    expect(out).toEqual([
      { po_line_id: 'pol-free', material_id: null, material_name: 'Kayu bekas', quantity: 4, unit: 'batang' },
    ]);
  });

  it('carries a NULL po_line_id through (legacy/header-only PO synthesized as one line)', () => {
    const out = buildReceiptLinesPayload([
      draft({ po_line_id: null, material_id: 'mat-1', qtyInput: '9', baseUnit: 'sak' }),
    ]);
    expect(out[0].po_line_id).toBeNull();
    expect(out[0].quantity).toBe(9);
  });

  it('treats a null/0 factor as 1:1 (no accidental scaling)', () => {
    expect(buildReceiptLinesPayload([draft({ qtyInput: '8', factor: 0 })])[0].quantity).toBe(8);
    expect(buildReceiptLinesPayload([draft({ qtyInput: '8', factor: null })])[0].quantity).toBe(8);
  });

  it('returns [] for an empty draft array', () => {
    expect(buildReceiptLinesPayload([])).toEqual([]);
  });
});
