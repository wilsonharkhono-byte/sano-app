// tools/__tests__/reportProgressTwins.test.ts
/**
 * report-progress-analyze carries byte-identical copies of two files it cannot
 * import (Deno cannot reach tools/, and cost.ts belongs to site-event-analyze),
 * plus one function twinned from tools/clientReportPhotos.ts. CI runs only tsc
 * and jest, never `deno test`, so this suite is what keeps the deployed
 * function honest. Fix a failure with:
 *   cp tools/reportLineDraftValidate.ts supabase/functions/report-progress-analyze/validate.ts
 *   cp supabase/functions/site-event-analyze/cost.ts supabase/functions/report-progress-analyze/cost.ts
 * and by pasting photoPathFromSignedUrl from tools/clientReportPhotos.ts into util.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const FN = ['supabase', 'functions', 'report-progress-analyze'];

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} missing`);
  const next = src.indexOf('\nexport ', start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

describe('report-progress-analyze twins', () => {
  it('validate.ts is tools/reportLineDraftValidate.ts byte for byte', () => {
    expect(read(...FN, 'validate.ts')).toBe(read('tools', 'reportLineDraftValidate.ts'));
  });

  it('cost.ts is site-event-analyze/cost.ts byte for byte', () => {
    expect(read(...FN, 'cost.ts')).toBe(read('supabase', 'functions', 'site-event-analyze', 'cost.ts'));
  });

  it('util.ts photoPathFromSignedUrl matches the app helper body for body', () => {
    expect(functionBody(read(...FN, 'util.ts'), 'photoPathFromSignedUrl'))
      .toBe(functionBody(read('tools', 'clientReportPhotos.ts'), 'photoPathFromSignedUrl'));
  });

  it('the validator has no imports (it must load unchanged under Deno)', () => {
    expect(/^\s*import\s/m.test(read('tools', 'reportLineDraftValidate.ts'))).toBe(false);
  });
});
