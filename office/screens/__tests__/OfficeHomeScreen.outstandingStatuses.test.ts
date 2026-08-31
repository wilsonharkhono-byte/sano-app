// Spec §5.5 — "Is a returned request still open demand?": yes, it is live
// work parked with the estimator, exactly like PENDING. The office
// dashboard's "permintaan material ditahan" badge count must therefore treat
// RETURNED as outstanding alongside PENDING/UNDER_REVIEW/AUTO_HOLD.
//
// This screen has no existing render-test harness (see office/screens/
// components/__tests__/ApprovalsScreen.materialUsage.test.tsx, which
// deliberately avoids booting the React tree / importing screen modules to
// sidestep react-native-url-polyfill's ESM import under Jest). Rather than
// build a new component-test harness just for a one-line query-filter check
// — out of scope for this fix — this test reads the source text directly,
// mirroring the established pattern of asserting on raw file contents used
// for the SQL migration tests (e.g. tools/__tests__/migration088.test.ts).
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../OfficeHomeScreen.tsx'),
  'utf8',
);

describe('OfficeHomeScreen — outstanding material_request_headers count', () => {
  it('includes RETURNED alongside PENDING/UNDER_REVIEW/AUTO_HOLD in the overall_status filter', () => {
    const match = SOURCE.match(
      /material_request_headers'\)[^\n]*\.in\('overall_status',\s*\[([^\]]+)\]\)/,
    );
    expect(match).not.toBeNull();
    const statuses = (match![1].match(/'([A-Z_]+)'/g) ?? []).map(s => s.replace(/'/g, ''));
    expect(statuses).toEqual(expect.arrayContaining(['PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'RETURNED']));
  });
});
