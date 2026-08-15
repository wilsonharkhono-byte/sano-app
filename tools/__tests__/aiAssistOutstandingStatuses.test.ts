// Spec §5.5 — "Is a returned request still open demand?": yes, it is live
// work parked with the estimator, exactly like PENDING. The ai-assist edge
// function's "Permintaan" snapshot count (surfaced to the AI chat context)
// must therefore treat RETURNED as outstanding alongside PENDING/
// UNDER_REVIEW/AUTO_HOLD.
//
// supabase/functions/* is a Deno edge function excluded from Jest entirely
// (package.json "jest.testPathIgnorePatterns": ["supabase/functions/", ...]),
// so it cannot be imported and exercised directly here. This test instead
// reads the source text, mirroring the established pattern of asserting on
// raw file contents used for the SQL migration tests (e.g.
// tools/__tests__/migration088.test.ts) — this file lives outside the
// ignored path, so it still runs.
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../supabase/functions/ai-assist/index.ts'),
  'utf8',
);

describe('ai-assist edge function — outstanding material_request_headers count', () => {
  it('includes RETURNED alongside PENDING/UNDER_REVIEW/AUTO_HOLD in the overall_status filter', () => {
    const match = SOURCE.match(
      /from\('material_request_headers'\)[\s\S]*?\.in\('overall_status',\s*\[([^\]]+)\]\)/,
    );
    expect(match).not.toBeNull();
    const statuses = (match![1].match(/'([A-Z_]+)'/g) ?? []).map(s => s.replace(/'/g, ''));
    expect(statuses).toEqual(expect.arrayContaining(['PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'RETURNED']));
  });
});
