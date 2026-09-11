/**
 * Gates are data (spec §2 decision 3), so the office can relabel them - but the
 * CODE is a foreign key that release 2's site_events will reference. The client
 * refuses a `code` (and, for steps, `gate_code`) in a patch before the database
 * ever sees it, so the message is Indonesian and the failure is at the call
 * site, not a 500 from a trigger.
 *
 * updateGateRef and updateGateStepRef UPDATE gate_refs/gate_step_refs, which
 * RLS restricts to office roles. A filtered UPDATE is not an error under RLS:
 * PostgREST matches zero rows and Supabase reports error null. Without the
 * read-back added here, a supervisor's refused edit would show a success
 * toast for a change that never happened (CLAUDE.md §12).
 */
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../supabase';
import {
  gateChipLabel, stepChipLabel, updateGateRef, updateGateStepRef, createGateStepRef,
  GATE_COLUMNS, STEP_COLUMNS,
} from '../gateRefs';
import type { GateRef, GateStepRef } from '../types';

const mockSupabase = supabase as jest.Mocked<typeof supabase>;

/** update().eq().select().maybeSingle() - the read-back chain both update functions share. */
function updateChain(result: { data: unknown; error: { message: string } | null }) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

/** insert().select().single() - createGateStepRef's chain. */
function insertChain(result: { data: unknown; error: { code?: string; message: string } | null }) {
  return {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
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

describe('GATE_COLUMNS / STEP_COLUMNS', () => {
  /** Splits a select-list literal into its individual column names, for exact (not substring) matching. */
  const columnNames = (cols: string): string[] => cols.split(',').map((c) => c.trim());

  it('GATE_COLUMNS lists every field of GateRef, including created_at', () => {
    const cols = columnNames(GATE_COLUMNS);
    for (const key of Object.keys(gate())) {
      expect(cols).toContain(key);
    }
  });

  it('STEP_COLUMNS lists every field of GateStepRef, including created_at', () => {
    const cols = columnNames(STEP_COLUMNS);
    for (const key of Object.keys(step())) {
      expect(cols).toContain(key);
    }
  });
});

describe('updateGateRef', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a patch carrying code, before touching the database', async () => {
    await expect(
      updateGateRef('B', { code: 'Z' } as never),
    ).rejects.toThrow(/kode/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('reports the RLS refusal instead of a silent success when the update is filtered', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(updateChain({ data: null, error: null }));
    const result = await updateGateRef('B', { short_label: 'Basah 2' });
    expect(result.error).toMatch(/peran kantor/i);
  });

  it('reports success when the row comes back, returning the confirmed row', async () => {
    const updated = gate({ short_label: 'Basah 2' });
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: updated, error: null }),
    );
    await expect(updateGateRef('B', { short_label: 'Basah 2' })).resolves.toEqual({ gate: updated });
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

  it('refuses a patch carrying code, before touching the database', async () => {
    await expect(
      updateGateStepRef('B4', { code: 'Z' } as never),
    ).rejects.toThrow(/kode/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('refuses a patch carrying gate_code, before touching the database', async () => {
    await expect(
      updateGateStepRef('B4', { gate_code: 'C' } as never),
    ).rejects.toThrow(/kode/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('reports the RLS refusal instead of a silent success when the update is filtered', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(updateChain({ data: null, error: null }));
    const result = await updateGateStepRef('B4', { name_id: 'Waterproofing 2' });
    expect(result.error).toMatch(/peran kantor/i);
  });

  it('reports success when the row comes back, returning the confirmed row', async () => {
    const updated = step({ name_id: 'Waterproofing 2' });
    (mockSupabase.from as jest.Mock).mockReturnValue(
      updateChain({ data: updated, error: null }),
    );
    await expect(updateGateStepRef('B4', { name_id: 'Waterproofing 2' })).resolves.toEqual({ step: updated });
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

describe('createGateStepRef', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a blank code, before touching the database', async () => {
    const result = await createGateStepRef({ code: '   ', gate_code: 'B', name_id: 'Waterproofing' });
    expect(result.error).toMatch(/kode langkah/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('refuses a blank or whitespace-only gate_code, before touching the database', async () => {
    const result = await createGateStepRef({ code: 'B4', gate_code: '   ', name_id: 'Waterproofing' });
    expect(result.error).toMatch(/gerbang induk/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('refuses a blank name, before touching the database', async () => {
    const result = await createGateStepRef({ code: 'B4', gate_code: 'B', name_id: '  ' });
    expect(result.error).toMatch(/nama langkah/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('maps a duplicate code (23505) to an Indonesian message', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      insertChain({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
    );
    const result = await createGateStepRef({ code: 'B4', gate_code: 'B', name_id: 'Waterproofing' });
    expect(result.error).toBe('Kode langkah "B4" sudah dipakai.');
  });

  it('maps a foreign key violation (23503) to a friendly "gate not found" message', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      insertChain({
        data: null,
        error: { code: '23503', message: 'insert or update on table "gate_step_refs" violates foreign key constraint' },
      }),
    );
    const result = await createGateStepRef({ code: 'Z9', gate_code: 'Z', name_id: 'Langkah baru' });
    expect(result.error).toBe('Gerbang "Z" tidak ditemukan.');
  });

  it('does not validate gate_code against a fixed A-H pattern - any non-blank code reaches the database', async () => {
    const created = step({ code: 'Z9', gate_code: 'Z', name_id: 'Langkah baru' });
    (mockSupabase.from as jest.Mock).mockReturnValue(
      insertChain({ data: created, error: null }),
    );
    const result = await createGateStepRef({ code: 'z9', gate_code: 'Z', name_id: 'Langkah baru' });
    expect(result.step).toEqual(created);
  });

  it('passes a database error through', async () => {
    (mockSupabase.from as jest.Mock).mockReturnValue(
      insertChain({ data: null, error: { message: 'boom' } }),
    );
    const result = await createGateStepRef({ code: 'B4', gate_code: 'B', name_id: 'Waterproofing' });
    expect(result.error).toBe('boom');
  });
});
