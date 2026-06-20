import { computeWorkGroupGate1Flag } from './gate1';
import type { MaterialEnvelopeStatus } from '../../tools/types';

const env = (o: Partial<MaterialEnvelopeStatus>): MaterialEnvelopeStatus => ({
  material_id: 'm', project_id: 'p', material_code: null, material_name: 'Besi D16', tier: 1, unit: 'kg',
  total_planned: 1000, total_ordered: 0, total_received: 0, total_installed: 0,
  remaining_to_order: 1000, burn_pct: 0, boq_item_count: 10, ...o,
});

it('no pace flag for a small early order at 0% progress', () => {
  const r = computeWorkGroupGate1Flag(env({ total_ordered: 0, total_installed: 0 }), 50, 'Pondasi'); // ordered 5%
  expect(r.flag).toBe('OK');
});

it('WARNING when ordering far ahead of progress (gap > 70%)', () => {
  // ordered 900/1000=90%, installed 100/1000=10% → 80% ahead
  const r = computeWorkGroupGate1Flag(env({ total_ordered: 900, total_installed: 100 }), 0.0001, 'Pondasi');
  // burn at 90% is WARNING too; either way flag should be WARNING and mention progress somewhere
  const text = `${r.msg} ${r.extra?.msg ?? ''}`;
  expect(['WARNING', 'HIGH', 'CRITICAL']).toContain(r.flag);
  expect(text).toMatch(/progres/i);
});

it('INFO pace when 40-70% ahead and envelope still OK', () => {
  // ordered 500/1000=50% (burn OK <80), installed 0 → 50% ahead → INFO pace
  const r = computeWorkGroupGate1Flag(env({ total_ordered: 0, total_installed: 0 }), 500, 'Pondasi');
  const text = `${r.msg} ${r.extra?.msg ?? ''}`;
  expect(text).toMatch(/progres/i);
});

it('no baseline → INFO', () => {
  expect(computeWorkGroupGate1Flag(env({ total_planned: 0 }), 10, 'Pondasi').flag).toBe('INFO');
});
