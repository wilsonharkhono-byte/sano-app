/**
 * Gates are data (spec §2 decision 3), so the office can relabel them - but the
 * CODE is a foreign key that release 2's site_events will reference. The client
 * refuses a `code` in a patch before the database ever sees it, so the message
 * is Indonesian and the failure is at the call site, not a 500 from a trigger.
 *
 * updateGateRef and updateGateStepRef UPDATE gate_refs/gate_step_refs, which
 * RLS restricts to office roles. A filtered UPDATE is not an error under RLS:
 * PostgREST matches zero rows and Supabase reports error null. Without the
 * read-back added here, a supervisor's refused edit would show a success
 * toast for a change that never happened (CLAUDE.md §12).
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import { gateChipLabel, stepChipLabel, updateGateRef, updateGateStepRef } from '../gateRefs';
import type { GateRef, GateStepRef } from '../types';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

/** update().eq().select().maybeSingle() - the read-back chain both functions share. */
function updateChain(result: { data: unknown; error: { message: string } | null }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

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
  beforeEach(() => jest.clearAllMocks());

  it('refuses a patch carrying code, before touching the database', async () => {
    await expect(
      updateGateRef('B', { code: 'Z' } as never),
    ).rejects.toThrow(/kode/i);
  });

  it('reports the RLS refusal instead of a silent success when the update is filtered', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(updateChain({ data: null, error: null }));
    const result = await updateGateRef('B', { short_label: 'Basah 2' });
    expect(result.error).toMatch(/peran kantor/i);
  });

  it('reports success when the row comes back', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: { code: 'B' }, error: null }),
    );
    await expect(updateGateRef('B', { short_label: 'Basah 2' })).resolves.toEqual({});
  });

  it('passes a database error through', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: null, error: { message: 'boom' } }),
    );
    await expect(updateGateRef('B', { short_label: 'Basah 2' })).resolves.toEqual({ error: 'boom' });
  });
});

describe('updateGateStepRef', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports the RLS refusal instead of a silent success when the update is filtered', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(updateChain({ data: null, error: null }));
    const result = await updateGateStepRef('B4', { name_id: 'Waterproofing 2' });
    expect(result.error).toMatch(/peran kantor/i);
  });

  it('reports success when the row comes back', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: { code: 'B4' }, error: null }),
    );
    await expect(updateGateStepRef('B4', { name_id: 'Waterproofing 2' })).resolves.toEqual({});
  });

  it('passes a database error through', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: null, error: { message: 'boom' } }),
    );
    await expect(updateGateStepRef('B4', { name_id: 'Waterproofing 2' })).resolves.toEqual({
      error: 'boom',
    });
  });
});
