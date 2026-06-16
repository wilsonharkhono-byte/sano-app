import { computeGate1Flag } from '../gate1';
import type { BoqItem } from '../../../tools/types';

const poer: BoqItem = {
  id: 'poer', project_id: 'p', code: 'III.A.1.2', label: 'Poer PC.2', unit: 'm3',
  tier1_material: null, tier2_material: null, progress: 0, planned: 1.65, installed: 0,
  parent_code: null, chapter: null, sort_order: 0, element_code: null,
  composite_factors: null, cost_breakdown: null, client_unit_price: null, internal_unit_price: null,
};

describe('computeGate1Flag — Tier 1 per-material remaining', () => {
  it('uses per-material planned (117.48 kg D13) — 2 kg is well within, OK', () => {
    const res = computeGate1Flag(
      poer, 2, [], [], null, 1, 'Besi beton ulir 13 mm',
      { planned: 117.48, ordered: 0 },
    );
    expect(res?.check).toBe('1a');
    expect(res?.flag).toBe('OK');
    expect(res?.msg).toContain('117.48');
  });

  it('flags CRITICAL when the material request exceeds per-material remaining by >30%', () => {
    const res = computeGate1Flag(
      poer, 160, [], [], null, 1, 'Besi beton ulir 13 mm',
      { planned: 117.48, ordered: 0 },
    );
    expect(res?.flag).toBe('CRITICAL');
  });

  it('subtracts already-ordered from per-material planned', () => {
    // planned 100, ordered 90 → remaining 10; request 12 → +20% → WARNING
    const res = computeGate1Flag(
      poer, 12, [], [], null, 1, 'Besi beton ulir 13 mm',
      { planned: 100, ordered: 90 },
    );
    expect(res?.flag).toBe('WARNING');
  });

  it('falls back to BoQ volume remaining when no per-material planned is provided', () => {
    // 2 against 1.65 m³ → 21% over → WARNING (legacy behavior preserved)
    const res = computeGate1Flag(poer, 2, [], [], null, 1, undefined, null);
    expect(res?.flag).toBe('WARNING');
    expect(res?.msg).toContain('di atas sisa BoQ');
  });
});
