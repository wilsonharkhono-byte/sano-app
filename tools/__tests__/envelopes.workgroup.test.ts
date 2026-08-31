// Mock supabase to prevent the react-native-url-polyfill ESM import in Jest
// (same shim as envelopes.batch.test.ts).
jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { getWorkGroupEnvelope } from '../envelopes';
import { remainingFree, remainingToOrder } from '../envelopeMath';
import { supabase } from '../supabase';

/**
 * getWorkGroupEnvelope after migration 094.
 *
 * Before 094 this wrapper read `get_workgroup_envelope`, whose column named
 * total_ordered actually held REQUEST allocations, and mirrored that one figure
 * into BOTH total_ordered and total_requested. The legs now come from
 * get_workgroup_material_envelopes (086 — split and honest) and the old RPC is
 * consulted ONLY for the columns whose meaning 094 does not change
 * (material_name, unit, total_installed, boq_item_count), which is what makes
 * the change safe in either deploy order.
 */

const rpc = supabase.rpc as jest.Mock;

interface Leg { material_id: string; planned: number; ordered: number; requested: number }

/** Wire both RPCs: 086 is awaited directly, 061/094 is awaited via .single(). */
function mockRpcs(opts: {
  legs?: Leg[];
  legsError?: { message: string } | null;
  meta?: Record<string, unknown> | null;
  metaError?: { message: string } | null;
}) {
  rpc.mockImplementation((fn: string) => {
    if (fn === 'get_workgroup_material_envelopes') {
      return Promise.resolve({ data: opts.legs ?? [], error: opts.legsError ?? null });
    }
    if (fn === 'get_workgroup_envelope') {
      return {
        single: () => Promise.resolve({
          data: opts.metaError ? null : (opts.meta ?? META),
          error: opts.metaError ?? null,
        }),
      };
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
}

const META = {
  material_name: 'Besi beton ulir 13 mm',
  unit: 'kg',
  total_installed: 120,
  boq_item_count: 6,
};

const IDS = ['boq-1', 'boq-2'];

beforeEach(() => rpc.mockReset());

describe('getWorkGroupEnvelope — split legs (migration 094)', () => {
  it('reports the PO leg and the open-request leg SEPARATELY', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 1000, ordered: 300, requested: 200 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    expect(env).not.toBeNull();
    expect(env!.total_planned).toBe(1000);
    expect(env!.total_ordered).toBe(300);   // genuinely on a live PO
    expect(env!.total_requested).toBe(200); // still in flight
    // The regression this whole change exists to prevent: the two legs must not
    // be the same number mirrored twice.
    expect(env!.total_ordered).not.toBe(env!.total_requested);
  });

  it('takes name / unit / installed / boq count from the RPC, unchanged in meaning', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 1000, ordered: 0, requested: 0 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    expect(env!.material_name).toBe('Besi beton ulir 13 mm');
    expect(env!.unit).toBe('kg');
    expect(env!.total_installed).toBe(120); // feeds gate1's check-1d pace advisory
    expect(env!.boq_item_count).toBe(6);
    expect(env!.material_id).toBe('mat-1');
    expect(env!.project_id).toBe('proj-1');
  });

  it('remaining_to_order = planned − ORDERED (requests do not reduce it)', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 1000, ordered: 300, requested: 200 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    // 1000 − 300. NOT 500: this column answers "how much may still become a PO",
    // the same question the project view's column answers.
    expect(env!.remaining_to_order).toBe(700);
  });

  it('remaining_to_order goes NEGATIVE when the group is already over-ordered', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 1000, ordered: 1200, requested: 0 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    // Deliberately unfloored, matching v_material_envelope_status and the
    // over-order display contract in MaterialUsagePanel.
    expect(env!.remaining_to_order).toBe(-200);
  });

  it('burn_pct measures TOTAL demand (ordered + requested), not the PO leg', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 800, ordered: 300, requested: 200 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    // (300 + 200) / 800 = 62.5%. Reading the PO leg alone would say 37.5% and
    // silently halve a live gate input.
    expect(env!.burn_pct).toBeCloseTo(62.5, 5);
  });

  it('burn_pct is 0, not NaN, when the group has no plan', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 0, ordered: 0, requested: 50 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    expect(env!.burn_pct).toBe(0);
    expect(env!.total_planned).toBe(0); // → the gate's "no baseline" INFO branch
  });

  it('a material absent from the group plan reads as planned 0, not a crash', async () => {
    mockRpcs({ legs: [{ material_id: 'other-mat', planned: 500, ordered: 10, requested: 0 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    expect(env!.total_planned).toBe(0);
    expect(env!.total_ordered).toBe(0);
    expect(env!.total_requested).toBe(0);
  });

  it('picks the right material out of a multi-material group result', async () => {
    mockRpcs({
      legs: [
        { material_id: 'mat-0', planned: 10, ordered: 1, requested: 2 },
        { material_id: 'mat-1', planned: 1000, ordered: 300, requested: 200 },
        { material_id: 'mat-2', planned: 40, ordered: 4, requested: 5 },
      ],
    });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    expect(env!.total_planned).toBe(1000);
    expect(env!.total_ordered).toBe(300);
  });

  it('coerces PostgREST numeric strings (they arrive as text)', async () => {
    mockRpcs({
      legs: [{ material_id: 'mat-1', planned: '1000' as unknown as number,
               ordered: '300' as unknown as number, requested: '200' as unknown as number }],
    });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);

    expect(env!.total_planned).toBe(1000);
    expect(env!.remaining_to_order).toBe(700); // string math would give "1000300"
  });
});

describe('getWorkGroupEnvelope — failure is "unknown", never a confident zero', () => {
  it('returns null when the legs RPC fails', async () => {
    mockRpcs({ legsError: { message: 'boom' } });
    expect(await getWorkGroupEnvelope('proj-1', 'mat-1', IDS)).toBeNull();
  });

  it('returns null when the meta RPC fails', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 1000, ordered: 0, requested: 0 }],
               metaError: { message: 'denied' } });
    expect(await getWorkGroupEnvelope('proj-1', 'mat-1', IDS)).toBeNull();
  });

  it('returns null (and calls nothing) for an empty BoQ scope', async () => {
    mockRpcs({});
    expect(await getWorkGroupEnvelope('proj-1', 'mat-1', [])).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the SBY-001 divergence, in one assertion', () => {
  it('the estimator\'s "sisa" and the actually-free "sisa" are different numbers', async () => {
    mockRpcs({ legs: [{ material_id: 'mat-1', planned: 1000, ordered: 300, requested: 200 }] });

    const env = await getWorkGroupEnvelope('proj-1', 'mat-1', IDS);
    const legs = {
      planned: env!.total_planned,
      ordered: env!.total_ordered,
      requested: env!.total_requested,
    };

    // What "Sisa untuk di-PO" answers — the hard-gate headroom the server
    // enforces. Requests are deliberately absent (a PO fulfils a request).
    expect(remainingToOrder(legs)).toBe(700);
    expect(env!.remaining_to_order).toBe(700);

    // What an approver actually needs — the uncommitted remainder. 200 kg of
    // this material is already spoken for by the queue being approved.
    expect(remainingFree(legs)).toBe(500);

    // The gap between the two is the incident. Splitting the legs is what makes
    // it computable at all: pre-094 both fields held the SAME mirrored figure,
    // so remainingFree() would have subtracted the PO leg from itself.
    expect(remainingToOrder(legs)).not.toBe(remainingFree(legs));
  });
});
