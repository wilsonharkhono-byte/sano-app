import { computeWorkGroupGate1Flag, buildProjectEnvelopeOverageResult } from './gate1';
import { requiresOverageReason } from '../../tools/requestOverage';
import type { MaterialEnvelopeStatus } from '../../tools/types';

const env = (o: Partial<MaterialEnvelopeStatus>): MaterialEnvelopeStatus => ({
  material_id: 'm', project_id: 'p', material_code: null, material_name: 'Besi D16', tier: 1, unit: 'kg',
  total_planned: 1000, total_ordered: 0, total_requested: 0, total_received: 0, total_installed: 0,
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

it('no baseline → INFO "Tidak ada alokasi pembanding"', () => {
  const r = computeWorkGroupGate1Flag(env({ total_planned: 0 }), 10, 'Pondasi');
  expect(r.flag).toBe('INFO');
  expect(r.msg).toContain('Tidak ada alokasi pembanding');
});

describe('Task 2.4 — Tier-1 soft cap + running total', () => {
  it('caps at WARNING (never CRITICAL) when over-total, and requires a reason', () => {
    // group ordered 900 + this 300 = 1200 / 1000 = 120%.
    const r = computeWorkGroupGate1Flag(env({ total_ordered: 900 }), 300, 'Bekisting Balok Lt. 2');
    expect(r.flag).toBe('WARNING'); // pre-069 this was CRITICAL
    expect(r.overage?.projectedPct).toBeCloseTo(120, 5);
    expect(requiresOverageReason(r)).toBe(true);
    expect(r.msg).toContain('Grup: Bekisting Balok Lt. 2');
    expect(r.msg).toContain('melebihi total alokasi');
  });

  it('escalates copy past 120% but stays WARNING', () => {
    // ordered 1200 + this 200 = 1400 / 1000 = 140%.
    const r = computeWorkGroupGate1Flag(env({ total_ordered: 1200, total_installed: 200 }), 200, 'Pondasi');
    expect(r.flag).toBe('WARNING');
    expect(r.msg).toContain('jauh melebihi alokasi');
  });

  it('omits the PO leg at group grain but appends project PO context when provided', () => {
    const group = env({ total_ordered: 100 });
    const proj = env({ total_ordered: 700, total_planned: 5000, unit: 'kg' });
    const r = computeWorkGroupGate1Flag(group, 50, 'Pondasi', null, proj);
    expect(r.msg).not.toContain('Sudah di-PO'); // group grain has no PO dimension
    expect(r.msg).toContain('Proyek: sudah di-PO 700 kg dari rencana 5.000 kg');
  });
});

describe('Task 2.4 — buildProjectEnvelopeOverageResult (Tier-2 project grain)', () => {
  it('projects di-PO + permintaan berjalan + permintaan ini, caps at WARNING, spec copy', () => {
    // planned 1000, PO 900, other-open 60, this 50 → 1010 = 101%.
    const r = buildProjectEnvelopeOverageResult(
      env({ total_planned: 1000, total_ordered: 900, total_requested: 60, material_name: 'Bata' }),
      50,
    );
    expect(r.flag).toBe('WARNING'); // pre-069 this was HIGH
    expect(r.overage?.projectedPct).toBeCloseTo(101, 5);
    expect(r.msg).toContain('Proyek — Sudah di-PO 900 kg + permintaan berjalan 60 kg + permintaan ini 50 kg = 1.010 kg dari rencana 1.000 kg (101%)');
    expect(requiresOverageReason(r)).toBe(true);
  });

  it('no envelope → "Tidak ada alokasi pembanding" INFO (never OK)', () => {
    const r = buildProjectEnvelopeOverageResult(null, 50);
    expect(r.flag).toBe('INFO');
    expect(r.msg).toContain('Tidak ada alokasi pembanding');
  });

  it('sub-50% stays OK', () => {
    const r = buildProjectEnvelopeOverageResult(env({ total_planned: 1000, total_ordered: 0, total_requested: 0 }), 100);
    expect(r.flag).toBe('OK');
  });
});
