/**
 * Pins CREATE_DEFERRED_REASON (../datumSyncModel.ts) against
 * supabase/functions/datum-sync/run.ts's CREATE_DEFERRED sentence, which it
 * deliberately duplicates because the Deno function cannot be imported from
 * the app (same reason tools/datumSyncPlan.ts keeps plan.ts a byte-identical
 * copy - see tools/__tests__/datumSyncPlanTwin.test.ts). The Rooms-tab DATUM
 * card splits a deferred create from a failed one by exact equality with
 * this sentence; if run.ts's wording drifts and this copy does not, a
 * deferred room would silently be shown as failed.
 *
 * Fix a failure by copying run.ts's current CREATE_DEFERRED text into
 * CREATE_DEFERRED_REASON in ../datumSyncModel.ts - run.ts is the source of
 * truth for what DATUM actually times out on.
 */
// The model reads constants from tools/datumSync, which loads the client.
jest.mock('../../../../tools/supabase', () => ({ supabase: {} }));

import fs from 'node:fs';
import path from 'node:path';

import { CREATE_DEFERRED_REASON } from '../datumSyncModel';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const RUN_TS = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'datum-sync', 'run.ts'), 'utf8');

function extractCreateDeferred(src: string): string {
  const m = src.match(/export const CREATE_DEFERRED = '([^']*)';/);
  if (!m) {
    throw new Error(
      "Could not find \"export const CREATE_DEFERRED = '...';\" in supabase/functions/datum-sync/run.ts " +
        '- did its declaration style change? Update the regex in this test.',
    );
  }
  return m[1];
}

describe('CREATE_DEFERRED_REASON matches run.ts CREATE_DEFERRED, verbatim', () => {
  it("is byte-identical to the Deno function's sentence", () => {
    expect(CREATE_DEFERRED_REASON).toBe(extractCreateDeferred(RUN_TS));
  });
});
