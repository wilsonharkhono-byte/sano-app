/**
 * The DATUM sync planner, the run's verdict (spec 2026-09-27 §6.2 step 5): a
 * run is ok only when every step it recorded is ok, and its error is the
 * first failing step's reason in run order.
 */
import { STEP_ORDER, runVerdict } from '../datumSyncPlan';

describe('STEP_ORDER', () => {
  it('is the order a sync or an import runs its steps', () => {
    expect(STEP_ORDER).toEqual(['areas', 'link', 'create', 'import', 'gate_status', 'staff', 'escalate']);
  });
});

describe('runVerdict', () => {
  it('is ok only when every recorded step is ok', () => {
    expect(runVerdict({ steps: { areas: 'ok', link: 'ok', gate_status: 'ok' } })).toEqual({ ok: true, error: null });
    expect(runVerdict({ steps: {} })).toEqual({ ok: false, error: null });
  });

  it("carries the first failing step's reason, in run order", () => {
    expect(runVerdict({
      steps: { areas: 'error', link: 'skipped', create: 'skipped', gate_status: 'ok', staff: 'error', escalate: 'ok' },
      step_errors: { staff: 'staf gagal', areas: 'DATUM menolak kunci integrasi (401).' },
    })).toEqual({ ok: false, error: 'DATUM menolak kunci integrasi (401).' });
  });
});
