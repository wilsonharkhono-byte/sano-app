/**
 * Static guard for migration 089 (a returned request also notifies its requester).
 *
 * Design authority:
 *   docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md §5.4
 *   (extended after ship: §5.4 targeted only the estimator, leaving the supervisor
 *   who raised the request uninformed until they happened to open Permintaan.)
 *
 * Like the 088 suite, this touches no database. 089 RE-CREATES a live function
 * (notify_header_status_change, last defined by 088), so the risk it guards is a
 * silent revert: if a future edit rebuilds that function from an older body, the
 * estimator branch, the 067 admin handoff, or 085's payload work would vanish
 * with no failing test anywhere. These assertions are that alarm.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '089_returned_notifies_requester.sql'), 'utf8');
const SQL_088 = fs.readFileSync(path.join(MIGRATIONS, '088_approval_po_separation.sql'), 'utf8');

/** The notify_header_status_change body as defined by a given migration's text. */
function notifyBody(sql: string): string {
  const m = sql.match(/CREATE OR REPLACE FUNCTION notify_header_status_change[\s\S]*?\n\$\$;/);
  if (!m) throw new Error('notify_header_status_change not found');
  return m[0];
}

describe('migration 089 — the requester is notified too', () => {
  it('inserts a notification for the requesting user specifically, not for the supervisor role', () => {
    const body = notifyBody(SQL);
    // Targeted at ONE known user. enqueue_notification can only target a role,
    // which would ping every supervisor on the project.
    expect(body).toMatch(/pa\.user_id\s*=\s*NEW\.requested_by/);
    // ...so it must NOT have been done by widening the role-targeted helper call.
    expect(body).not.toMatch(/v_target\s*:=\s*'supervisor'/);
  });

  it('never notifies the admin who returned it, and never double-notifies an estimator', () => {
    const body = notifyBody(SQL);
    expect(body).toMatch(/NEW\.returned_by IS NULL OR pa\.user_id <> NEW\.returned_by/);
    // The role-targeted enqueue above already reached estimators.
    expect(body).toMatch(/p\.role <> 'estimator'/);
  });

  it('only fires on RETURNED', () => {
    const body = notifyBody(SQL);
    expect(body).toMatch(/IF NEW\.overall_status = 'RETURNED' AND NEW\.requested_by IS NOT NULL THEN/);
  });

  it('deeplinks to ApprovalsScreen, which routing resolves to Permintaan for a supervisor', () => {
    const body = notifyBody(SQL);
    // A supervisor's navigator registers no Approvals route; resolving happens
    // client-side in tools/notificationRouting.ts, so the stored deeplink stays
    // the same as every sibling type.
    const insert = body.slice(body.indexOf('IF NEW.overall_status = \'RETURNED\' AND'));
    expect(insert).toMatch(/'ApprovalsScreen'/);
  });

  it('cannot block the business write (failures are warnings, like every sibling enqueue)', () => {
    const body = notifyBody(SQL);
    expect(body).toMatch(/RAISE WARNING 'requester RETURNED notification failed: %', SQLERRM;/);
  });

  it('carries the reason, truncated visibly, with the full text in deeplink params', () => {
    const body = notifyBody(SQL);
    expect(body).toMatch(/v_body_req :=/);
    expect(body).toMatch(/left\(v_reason, 119\) \|\| '…'/);
    // v_params already carries the untruncated reason from 088.
    expect(body).toMatch(/jsonb_build_object\('returnedReason', v_reason\)/);
  });
});

describe('migration 089 — does not silently revert migration 088', () => {
  it("preserves every line of 088's notify_header_status_change", () => {
    const before = notifyBody(SQL_088).split('\n').map(l => l.trim()).filter(Boolean);
    const after = new Set(notifyBody(SQL).split('\n').map(l => l.trim()).filter(Boolean));
    const dropped = before.filter(l => !after.has(l));
    expect(dropped).toEqual([]);
  });

  it("keeps 088's estimator targeting and 085's admin PO handoff", () => {
    const body = notifyBody(SQL);
    expect(body).toMatch(/v_target := 'estimator';/);
    expect(body).toMatch(/REQUEST_APPROVED_FOR_PO/);
    expect(body).toMatch(/NOT IN \('AUTO_HOLD', 'APPROVED', 'REJECTED', 'RETURNED'\)/);
  });

  it('re-creates nothing else (no policy, trigger or other function)', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/);
    expect(SQL).not.toMatch(/CREATE TRIGGER/);
    expect(SQL.match(/CREATE OR REPLACE FUNCTION/g) ?? []).toHaveLength(1);
    // 'RETURNED' is already an allowed notifications.type (088 section 8).
    expect(SQL).not.toMatch(/notifications_type_check/);
  });

  it('is re-paste safe', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(SQL).not.toMatch(/^\s*CREATE FUNCTION/m);
  });
});

describe.skip('migration 089 — live DB (awaiting the user pasting 089)', () => {
  it.todo('returning a request enqueues a RETURNED row for the requesting supervisor');
  it.todo('the requester row is separate from the estimator row (two recipients, one event)');
  it.todo('an admin returning their own request receives no notification');
  it.todo('a requester whose role is estimator receives exactly one notification, not two');
  it.todo('the supervisor tapping it lands on Permintaan, not Approvals');
});
