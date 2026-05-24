/**
 * Regression test pinning the deterministic CLI's per-workbook counts so
 * future refactors can't silently regress what the field guide §13 promises.
 *
 * Truth-correctness gate: every written breakdown must reconcile within
 * ±1 Rp. If `maxAbsVariance > 1` we are writing lies — that is the worst
 * possible outcome and fails the test loudly.
 *
 * Workbooks are large; parseBoqV2 + template extraction take 20–40s each.
 * We bump jest's timeout accordingly and skip the entire suite if the
 * source fixtures aren't present (so this works in a clean checkout
 * without the BOQ samples shipped).
 */
import * as fs from 'fs';
import * as path from 'path';
import { runDeterministic } from '../cli-deterministic';

const BOQ_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'BOQ');

const FIXTURES = {
  aal5: path.join(BOQ_DIR, 'RAB R1 Pakuwon Indah AAL-5.xlsx'),
  pd3:  path.join(BOQ_DIR, 'RAB R2 Pakuwon Indah PD3 no. 23.xlsx'),
  i4:   path.join(BOQ_DIR, 'RAB Nusa Golf I4 no. 29_R3.xlsx'),
} as const;

const allPresent = Object.values(FIXTURES).every((p) => fs.existsSync(p));
const describeIf = allPresent ? describe : describe.skip;

jest.setTimeout(180_000);

describeIf('deterministic CLI — field guide §13 counts (regression gate)', () => {
  it('AAL-5: 74 itemized / 85 rolled / 5 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.aal5, silent: true });
    expect(res.itemizedCount).toBe(74);
    expect(res.rolledCount).toBe(85);
    expect(res.unresolvedCount).toBe(5);
    expect(res.totalCandidates).toBe(164);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('PD3-23: 76 itemized / 153 rolled / 12 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.pd3, silent: true });
    expect(res.itemizedCount).toBe(76);
    expect(res.rolledCount).toBe(153);
    expect(res.unresolvedCount).toBe(12);
    expect(res.totalCandidates).toBe(241);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('I4-29: 46 itemized / 276 rolled / 17 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.i4, silent: true });
    expect(res.itemizedCount).toBe(46);
    expect(res.rolledCount).toBe(276);
    expect(res.unresolvedCount).toBe(17);
    expect(res.totalCandidates).toBe(339);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('aggregate across all three workbooks matches field guide §13 totals', async () => {
    const [aal5, pd3, i4] = await Promise.all([
      runDeterministic({ inputPath: FIXTURES.aal5, silent: true }),
      runDeterministic({ inputPath: FIXTURES.pd3,  silent: true }),
      runDeterministic({ inputPath: FIXTURES.i4,   silent: true }),
    ]);
    const itemized = aal5.itemizedCount + pd3.itemizedCount + i4.itemizedCount;
    const rolled   = aal5.rolledCount   + pd3.rolledCount   + i4.rolledCount;
    const unresolved = aal5.unresolvedCount + pd3.unresolvedCount + i4.unresolvedCount;
    expect(itemized).toBe(196);
    expect(rolled).toBe(514);
    expect(unresolved).toBe(34);
  });
});
