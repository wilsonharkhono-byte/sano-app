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

/**
 * The function's own files, read as text: the only check CI makes on them.
 * The function never reads profiles.active (live SANO has no such column)
 * and never writes a column spec §6 does not name.
 */
describe('the function source', () => {
  const files = () => fs.readdirSync(FUNCTION_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testing.ts');

  it('never mentions profiles.active: live SANO profiles have no active column', () => {
    for (const f of files()) {
      const src = readFn(f);
      expect(src).not.toMatch(/profiles\.active\b/);
      expect(src).not.toMatch(/from\('profiles'\)[^;]*\bactive\b/);
    }
    const store = readFn('store.ts');
    expect(store).toContain(".from('profiles').select('id, full_name, datum_staff_id')");
  });

  it('writes only the columns spec §6 names', () => {
    const store = readFn('store.ts');
    const updates = [...store.matchAll(/\.from\('(\w+)'\)\s*\.update\(\{([^}]*)\}/g)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]);
    expect(updates).toEqual([
      ['datum_sync_runs', "finished_at: nowIso, ok: false, error: RUN_INTERRUPTED"],
      ['datum_sync_runs', 'finished_at: fields.finishedAt, ok: fields.ok, counts: fields.counts, differences: fields.differences, error: fields.error'],
      ['datum_sync_requests', 'handled_at: fields.handledAt, run_id: fields.runId, error: fields.error'],
      ['rooms', 'datum_area_id: areaId'],
      ['profiles', 'datum_staff_id: staffId'],
      ['site_events', 'datum_card_id: cardId, datum_card_url: cardUrl, datum_escalated_at: escalatedAtIso'],
    ]);
    expect(store).not.toMatch(/\.delete\(/);
  });

  it('holds no URL or secret of its own', () => {
    for (const f of files()) {
      const src = readFn(f);
      expect(src).not.toMatch(/https?:\/\/(?!sano-app\.vercel\.app)/);
      expect(src).not.toMatch(/supabase\.co/);
    }
  });
});
