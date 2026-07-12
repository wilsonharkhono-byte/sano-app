// Task 3.4 — critical-gate audit wiring.
//
// The three gate screens (PermintaanScreen / Gate2Screen / TerimaScreen) route
// their CRITICAL gate outcomes through two thin, non-fatal helpers in
// tools/audit.ts. These tests pin the contract those screens rely on:
//   1. a CRITICAL flag writes an anomaly_events row;
//   2. any non-CRITICAL flag writes nothing;
//   3. a failing audit write is swallowed (resolves { ok:false }) and NEVER
//      throws — so it can never fail the business flow it hangs off of.

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

import { auditCriticalGateEvent, auditRequestSubmitIfCritical } from '../audit';
import { supabase } from '../supabase';

const mockFrom = supabase.from as jest.Mock;

const BASE_EVENT = {
  project_id: 'proj-1',
  user_id: 'user-1',
  event_type: 'gate3_quantity_over_po' as const,
  entity_type: 'receipt',
  entity_id: 'receipt-1',
  description: 'over-receive',
};

/**
 * Wire supabase.from() so every table used by the audit path resolves.
 * Returns the individual insert/read jest.fns so tests can assert on them.
 */
function makeSupabaseMock(opts: {
  anomalyError?: { message: string } | null;
  activityError?: { message: string } | null;
  headerFlag?: string | null;
  headerError?: { message: string } | null;
} = {}) {
  const anomalyInsert = jest.fn().mockResolvedValue({ error: opts.anomalyError ?? null });
  const activityInsert = jest.fn().mockResolvedValue({ error: opts.activityError ?? null });
  const headerSingle = jest.fn().mockResolvedValue({
    data: opts.headerError ? null : { overall_flag: opts.headerFlag ?? 'OK' },
    error: opts.headerError ?? null,
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'anomaly_events') return { insert: anomalyInsert };
    if (table === 'activity_log') return { insert: activityInsert };
    if (table === 'material_request_headers') {
      return { select: () => ({ eq: () => ({ single: headerSingle }) }) };
    }
    return { insert: jest.fn().mockResolvedValue({ error: null }) };
  });

  return { anomalyInsert, activityInsert, headerSingle };
}

describe('auditCriticalGateEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('writes an anomaly_events row when the flag is CRITICAL', async () => {
    const { anomalyInsert } = makeSupabaseMock();

    const result = await auditCriticalGateEvent('CRITICAL', BASE_EVENT);

    expect(result.ok).toBe(true);
    expect(anomalyInsert).toHaveBeenCalledTimes(1);
    expect(anomalyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'proj-1',
        event_type: 'gate3_quantity_over_po',
        severity: 'CRITICAL',
        entity_id: 'receipt-1',
      }),
    );
  });

  it.each(['OK', 'INFO', 'WARNING', 'HIGH', null, undefined])(
    'writes nothing when the flag is %s (not CRITICAL)',
    async (flag) => {
      const { anomalyInsert } = makeSupabaseMock();

      const result = await auditCriticalGateEvent(flag as any, BASE_EVENT);

      expect(result.ok).toBe(true);
      expect(anomalyInsert).not.toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
    },
  );

  it('is non-fatal (resolves { ok:false }, never throws) when the insert fails', async () => {
    const { anomalyInsert } = makeSupabaseMock({ anomalyError: { message: 'rls denied' } });

    // The absence of a rejection IS the assertion: the business flow that
    // awaits this must keep running.
    const result = await auditCriticalGateEvent('CRITICAL', BASE_EVENT);

    expect(anomalyInsert).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('rls denied');
  });
});

describe('gate2_qty_breach payload contract (review fix 3a/3b)', () => {
  // Pins the shape Gate2Screen relies on for its two gate2_qty_breach legs:
  // entity_type is 'project' (a PO never gets created on either leg — the
  // pre-flight block and the server RAISE both abort creation), and metadata
  // carries the richer detail the review asked for instead of a bare count.
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('pre-flight leg: entity_type "project" + per-material attempted/remaining/over metadata', async () => {
    const { anomalyInsert } = makeSupabaseMock();

    await auditCriticalGateEvent('CRITICAL', {
      project_id: 'proj-1',
      user_id: 'user-1',
      event_type: 'gate2_qty_breach',
      entity_type: 'project',
      entity_id: 'proj-1',
      description: 'PO melebihi alokasi tanpa override: Semen',
      metadata: {
        supplier: 'Toko A',
        breaches: [
          { material_id: 'mat-1', material_name: 'Semen', attempted: 120, remaining: 100, over: 20 },
        ],
      },
    });

    expect(anomalyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'gate2_qty_breach',
        entity_type: 'project',
        entity_id: 'proj-1',
        metadata: expect.objectContaining({
          breaches: [
            expect.objectContaining({
              material_id: 'mat-1',
              material_name: 'Semen',
              attempted: 120,
              remaining: 100,
              over: 20,
            }),
          ],
        }),
      }),
    );
  });

  it('server-RAISE leg: entity_type "project" + parsed server detail metadata', async () => {
    const { anomalyInsert } = makeSupabaseMock();

    await auditCriticalGateEvent('CRITICAL', {
      project_id: 'proj-1',
      user_id: 'user-1',
      event_type: 'gate2_qty_breach',
      entity_type: 'project',
      entity_id: 'proj-1',
      description: 'Server menolak PO melebihi alokasi (PO_QTY_BREACH)',
      metadata: { supplier: 'Toko A', server_detail: 'Semen: attempted 120 > remaining 100' },
    });

    expect(anomalyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'gate2_qty_breach',
        entity_type: 'project',
        metadata: expect.objectContaining({
          server_detail: 'Semen: attempted 120 > remaining 100',
        }),
      }),
    );
  });
});

describe('auditRequestSubmitIfCritical', () => {
  const PARAMS = { projectId: 'proj-1', userId: 'user-1', requestHeaderId: 'hdr-1', summary: 'Semen x10' };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('emits a gate1_auto_hold event when the server overall_flag is CRITICAL', async () => {
    const { anomalyInsert, headerSingle } = makeSupabaseMock({ headerFlag: 'CRITICAL' });

    const result = await auditRequestSubmitIfCritical(PARAMS);

    expect(headerSingle).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(anomalyInsert).toHaveBeenCalledTimes(1);
    expect(anomalyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'gate1_auto_hold',
        entity_type: 'material_request',
        entity_id: 'hdr-1',
        severity: 'CRITICAL',
      }),
    );
  });

  it('emits nothing when the server overall_flag is not CRITICAL', async () => {
    const { anomalyInsert, headerSingle } = makeSupabaseMock({ headerFlag: 'WARNING' });

    const result = await auditRequestSubmitIfCritical(PARAMS);

    expect(headerSingle).toHaveBeenCalledTimes(1);
    expect(anomalyInsert).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('is non-fatal when the flag read fails', async () => {
    const { anomalyInsert } = makeSupabaseMock({ headerError: { message: 'boom' } });

    const result = await auditRequestSubmitIfCritical(PARAMS);

    expect(result.ok).toBe(false);
    expect(anomalyInsert).not.toHaveBeenCalled();
  });
});
