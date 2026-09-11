/**
 * Gates are data (spec §2 decision 3), so the office can relabel them - but the
 * CODE is a foreign key that release 2's site_events will reference. The client
 * refuses a `code` in a patch before the database ever sees it, so the message
 * is Indonesian and the failure is at the call site, not a 500 from a trigger.
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { gateChipLabel, stepChipLabel, updateGateRef } from '../gateRefs';
import type { GateRef, GateStepRef } from '../types';

const gate = (over: Partial<GateRef> = {}): GateRef => ({
  code: 'B', name_id: 'Pekerjaan Basah / Waterproofing', short_label: 'Basah',
  description: null, sort_order: 20, active: true, datum_gate_code: null,
  created_at: '2026-09-10T00:00:00Z', ...over,
});

const step = (over: Partial<GateStepRef> = {}): GateStepRef => ({
  code: 'B4', gate_code: 'B', name_id: 'Waterproofing', description: null,
  sort_order: 40, active: true, datum_step_code: null,
  created_at: '2026-09-10T00:00:00Z', ...over,
});

describe('chip labels', () => {
  it('renders a gate as "code · short label"', () => {
    expect(gateChipLabel(gate())).toBe('B · Basah');
  });

  it('renders a step as "gate code · step code step name"', () => {
    expect(stepChipLabel(step(), gate())).toBe('B · B4 Waterproofing');
  });

  it('falls back to the step gate_code when the gate is unknown', () => {
    expect(stepChipLabel(step(), undefined)).toBe('B · B4 Waterproofing');
  });
});

describe('updateGateRef', () => {
  it('refuses a patch carrying code, before touching the database', async () => {
    await expect(
      updateGateRef('B', { code: 'Z' } as never),
    ).rejects.toThrow(/kode/i);
  });
});
