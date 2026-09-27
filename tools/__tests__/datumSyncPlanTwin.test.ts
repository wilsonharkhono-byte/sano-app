/**
 * tools/datumSyncPlan.ts is the source of truth. The datum-sync edge function
 * carries a byte-identical copy because Deno cannot import from tools/ and
 * jest never runs supabase/functions/ (package.json testPathIgnorePatterns).
 * CI runs only tsc and jest (.github/workflows/ci.yml), so without this suite
 * the Deno copy could drift and production would plan links with rules no
 * test covers.
 *
 * Fix a failure with:
 *   cp tools/datumSyncPlan.ts supabase/functions/datum-sync/plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'tools', 'datumSyncPlan.ts'), 'utf8');
const FUNCTION_DIR = path.join(ROOT, 'supabase', 'functions', 'datum-sync');
const readFn = (file: string) => fs.readFileSync(path.join(FUNCTION_DIR, file), 'utf8');

function exportedNames(src: string): string[] {
  return [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
}

describe('datum-sync/plan.ts is the planner, byte for byte', () => {
  it('is identical to tools/datumSyncPlan.ts', () => {
    expect(readFn('plan.ts')).toBe(SOURCE);
  });

  it('imports nothing and uses no Deno or React Native API, so the same bytes run in Node and Deno', () => {
    expect(SOURCE).not.toMatch(/^\s*import\s/m);
    expect(SOURCE).not.toMatch(/\bDeno\./);
    expect(SOURCE).not.toMatch(/react-native/);
  });

  it('exports the planner functions the function calls', () => {
    expect(exportedNames(SOURCE)).toEqual(expect.arrayContaining([
      'createGateOpen', 'diffGateWords', 'escalationAuthor', 'normalizeCode', 'normalizePersonName', 'planImport',
      'planRoomSync', 'planStaffLinks', 'runVerdict', 'sanoRoomUrl', 'staffCounts',
    ]));
  });
});
