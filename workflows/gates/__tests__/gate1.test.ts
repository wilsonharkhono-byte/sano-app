import { computeGate1Flag } from '../gate1';
import type { BoqItem, GateResult } from '../../../tools/types';

const poer: BoqItem = {
  id: 'poer', project_id: 'p', code: 'III.A.1.2', label: 'Poer PC.2', unit: 'm3',
  tier1_material: null, tier2_material: null, progress: 0, planned: 1.65, installed: 0,
  parent_code: null, chapter: null, sort_order: 0, element_code: null,
  composite_factors: null, cost_breakdown: null, client_unit_price: null, internal_unit_price: null,
};

// computeGate1Flag returns the WORST of check1a/check1d with the other in `.extra`.
// Extract the 1a (BoQ/material) sub-result wherever it landed.
function get1a(res: GateResult | null): GateResult | null {
  if (!res) return null;
  if (res.check === '1a') return res;
  if (res.extra?.check === '1a') return res.extra;
  return null;
}

describe('computeGate1Flag — Tier 1 per-material remaining', () => {
  it('uses per-material planned (117.48 kg D13) — 2 kg is well within, OK', () => {
    const res = computeGate1Flag(poer, 2, [], [], null, 1, 'Besi beton ulir 13 mm', { planned: 117.48, ordered: 0 });
    const a = get1a(res);
    expect(a?.flag).toBe('OK');
    expect(a?.msg).toContain('117.48');
  });

  it('flags CRITICAL when the material request exceeds per-material remaining by >30%', () => {
    const res = computeGate1Flag(poer, 160, [], [], null, 1, 'Besi beton ulir 13 mm', { planned: 117.48, ordered: 0 });
    expect(get1a(res)?.flag).toBe('CRITICAL');
  });

  it('subtracts already-ordered from per-material planned', () => {
    const res = computeGate1Flag(poer, 12, [], [], null, 1, 'Besi beton ulir 13 mm', { planned: 100, ordered: 90 });
    expect(get1a(res)?.flag).toBe('WARNING');
  });

  it('falls back to BoQ volume remaining when no per-material planned is provided', () => {
    const res = computeGate1Flag(poer, 2, [], [], null, 1, undefined, null);
    const a = get1a(res);
    expect(a?.flag).toBe('WARNING');
    expect(a?.msg).toContain('di atas sisa BoQ');
  });

  it('still surfaces the no-milestone schedule advisory (check 1d INFO) for a clean request', () => {
    // Regression guard: a milestone-less item keeps its 1d INFO advisory; it is not downgraded to OK.
    const res = computeGate1Flag(poer, 2, [], [], null, 1, 'Besi beton ulir 13 mm', { planned: 117.48, ordered: 0 });
    // 1a is OK, 1d is INFO → INFO outranks, so top-level is the 1d advisory with 1a in extra.
    expect(res?.check).toBe('1d');
    expect(res?.flag).toBe('INFO');
    expect(res?.msg).toContain('belum tergabung dalam milestone');
    expect(get1a(res)?.flag).toBe('OK');
  });
});
