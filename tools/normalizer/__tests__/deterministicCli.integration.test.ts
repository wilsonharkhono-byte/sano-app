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
  aal5:     path.join(BOQ_DIR, 'RAB R1 Pakuwon Indah AAL-5.xlsx'),
  pd3:      path.join(BOQ_DIR, 'RAB R2 Pakuwon Indah PD3 no. 23.xlsx'),
  i4:       path.join(BOQ_DIR, 'RAB Nusa Golf I4 no. 29_R3.xlsx'),
  ernawati: path.join(BOQ_DIR, 'RAB ERNAWATI edit.xlsx'),
} as const;

const allPresent = Object.values(FIXTURES).every((p) => fs.existsSync(p));
const describeIf = allPresent ? describe : describe.skip;

jest.setTimeout(180_000);

// NOTE (plesteran/acian direct-ref expansion): finishing rows (Plesteran,
// Acian) were previously EXCLUDED by needsExpansion — their two recipe lumps
// are both non-zero and reference a non-structural Analisa block, so neither
// the zero-cost nor the structural-title branch fired. They now become
// direct-ref candidates and the direct-ref tier expands the referenced block's
// jumlah-row lump into itemized Semen / Pasir / Upah lines.
//
// Update (rebar-formula fallback): I4-29 has 41 structural rows whose label
// matches no rebar adapter prefix (Dak atap, Pit lift, Overflow). They used to
// fall through to a rolled breakdown; selectAdapterByRekapFormula now picks the
// adapter from each row's column-Z REKAP formula, so they become per-diameter
// itemized (I4-29 itemized 281→322, rolled 41→0; aggregate itemized 778→819,
// rolled 41→0). The other three workbooks are unchanged. All rows still
// reconcile within ±1 Rp (max |variance| ~4e-9 Rp).
describeIf('deterministic CLI — field guide §13 counts (regression gate)', () => {
  it('AAL-5: 159 itemized / 0 rolled / 17 direct-ref / 0 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.aal5, silent: true });
    expect(res.itemizedCount).toBe(159);
    expect(res.rolledCount).toBe(0);
    expect(res.rolledDirectCount).toBe(17);
    expect(res.unresolvedCount).toBe(0);
    expect(res.totalCandidates).toBe(176);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('PD3-23: 229 itemized / 0 rolled / 24 direct-ref / 0 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.pd3, silent: true });
    expect(res.itemizedCount).toBe(229);
    expect(res.rolledCount).toBe(0);
    expect(res.rolledDirectCount).toBe(24);
    expect(res.unresolvedCount).toBe(0);
    expect(res.totalCandidates).toBe(253);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('I4-29: 322 itemized / 0 rolled / 41 direct-ref / 0 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.i4, silent: true });
    // The rebar-formula fallback (selectAdapterByRekapFormula) now resolves the
    // 41 oddly-named structural rows (Dak atap, Pit lift, Overflow — whose label
    // matches no adapter prefix but whose column-Z formula cites a known REKAP
    // sheet) into full per-diameter itemized breakdowns: itemized 281→322,
    // rolled 41→0. All still reconcile to ~0 Rp.
    expect(res.itemizedCount).toBe(322);
    expect(res.rolledCount).toBe(0);
    expect(res.rolledDirectCount).toBe(41);
    expect(res.unresolvedCount).toBe(0);
    expect(res.totalCandidates).toBe(363);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('ERNAWATI: 109 itemized / 0 rolled / 18 direct-ref / 0 unresolved, |variance| ≤ 1 Rp', async () => {
    const res = await runDeterministic({ inputPath: FIXTURES.ernawati, silent: true });
    expect(res.itemizedCount).toBe(109);
    expect(res.rolledCount).toBe(0);
    expect(res.rolledDirectCount).toBe(18);
    expect(res.unresolvedCount).toBe(0);
    expect(res.totalCandidates).toBe(127);
    expect(res.maxAbsVariance).toBeLessThanOrEqual(1);
  });

  it('aggregate across all four workbooks matches field guide §13 totals', async () => {
    const [aal5, pd3, i4, ern] = await Promise.all([
      runDeterministic({ inputPath: FIXTURES.aal5,     silent: true }),
      runDeterministic({ inputPath: FIXTURES.pd3,      silent: true }),
      runDeterministic({ inputPath: FIXTURES.i4,       silent: true }),
      runDeterministic({ inputPath: FIXTURES.ernawati, silent: true }),
    ]);
    const itemized     = aal5.itemizedCount     + pd3.itemizedCount     + i4.itemizedCount     + ern.itemizedCount;
    const rolled       = aal5.rolledCount       + pd3.rolledCount       + i4.rolledCount       + ern.rolledCount;
    const rolledDirect = aal5.rolledDirectCount + pd3.rolledDirectCount + i4.rolledDirectCount + ern.rolledDirectCount;
    const unresolved   = aal5.unresolvedCount   + pd3.unresolvedCount   + i4.unresolvedCount   + ern.unresolvedCount;
    expect(itemized).toBe(819);   // was 778; +41 from the I4-29 rebar-formula fallback
    expect(rolled).toBe(0);       // was 41; those I4-29 rows are now itemized
    expect(rolledDirect).toBe(100);
    expect(unresolved).toBe(0);
  });
});
