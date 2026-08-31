/**
 * Static guard for migration 092 (notification relevance).
 *
 * User rule (2026-08-26): "only the relevant parties. the correct supervisor and
 * estimator." Concretely:
 *   • the supervisor  = material_request_headers.requested_by (NOT NULL — always
 *     knowable, so request outcomes are addressed to that person, never to the
 *     supervisor role);
 *   • the estimator   = reviewed_by, which holds whoever last decided the
 *     request and is deliberately preserved when an admin RETURNS it
 *     (ApprovalsScreen.handleRequestReturn) — so a handback is addressed to the
 *     estimator who approved it, not to every estimator on the project;
 *   • an UNCLAIMED request (reviewed_by NULL) has no owner the schema can name,
 *     so the estimator role inbox is the honest target and mr_owning_estimator
 *     must return NULL rather than guess.
 *
 * Like the 088/089 suites, this touches no database. 092 RE-CREATES three live
 * functions (notify_header_status_change — last 089; notify_po_ready and
 * notify_receipt_mismatch — last 085), so the risk it guards is a silent
 * revert to the all-members fan-out: pasting 034/067/085/088/089 after 092
 * would bring the noise back with no failing test anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '092_notification_relevance.sql'), 'utf8');

/** A named function's body as defined by this migration's text. */
function fnBody(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name}[\\s\\S]*?\\n\\$\\$;`);
  const m = SQL.match(re);
  if (!m) throw new Error(`${name} not found in 092`);
  return m[0];
}

/** One branch of notify_header_status_change, by the status it handles. */
function statusBranch(status: 'AUTO_HOLD' | 'APPROVED' | 'REJECTED' | 'RETURNED'): string {
  const b = fnBody('notify_header_status_change');
  const marks = {
    AUTO_HOLD: [`IF NEW.overall_status = 'AUTO_HOLD' THEN`, `ELSIF NEW.overall_status = 'APPROVED'`],
    APPROVED:  [`ELSIF NEW.overall_status = 'APPROVED'`, `ELSIF NEW.overall_status = 'REJECTED'`],
    REJECTED:  [`ELSIF NEW.overall_status = 'REJECTED'`, `\n  ELSE\n`],
    RETURNED:  [`\n  ELSE\n`, `-- 067: approval handoff`],
  }[status];
  const start = b.indexOf(marks[0]);
  const end = b.indexOf(marks[1], start + 1);
  if (start < 0 || end < 0) throw new Error(`branch ${status} not found`);
  return b.slice(start, end);
}

describe('migration 092 — mr_owning_estimator names the correct estimator, or nobody', () => {
  const body = () => fnBody('mr_owning_estimator');

  it('resolves reviewed_by — the person who last decided this request', () => {
    expect(body()).toMatch(/pa\.user_id\s*=\s*p_reviewed_by/);
  });

  it('requires that person to actually be an estimator', () => {
    // A manual Tahan (088 §3) stamps a PRINCIPAL into reviewed_by; a principal
    // does not own the estimator review queue.
    expect(body()).toMatch(/p\.role\s*=\s*'estimator'/);
  });

  it('requires CURRENT project membership, so a departed estimator cannot swallow it', () => {
    expect(body()).toMatch(/FROM project_assignments pa/);
    expect(body()).toMatch(/pa\.project_id = p_project_id/);
  });

  it('returns a nullable UUID — it never invents an assignee', () => {
    expect(body()).toMatch(/RETURNS UUID/);
    expect(body()).not.toMatch(/COALESCE/); // no "pick some estimator" fallback inside
  });
});

describe('migration 092 — enqueue_notification_user (single known recipient)', () => {
  const body = () => fnBody('enqueue_notification_user');

  it('targets exactly one user AND still requires project membership', () => {
    expect(body()).toMatch(/FROM project_assignments pa/);
    expect(body()).toMatch(/pa\.project_id = p_project_id/);
    expect(body()).toMatch(/pa\.user_id\s*=\s*p_user_id/);
  });

  it('supports both duplicate guards the call sites rely on', () => {
    expect(body()).toMatch(/NOT \(pa\.user_id = ANY \(v_exclude\)\)/);
    expect(body()).toMatch(/p_skip_roles IS NULL OR p\.role <> ALL \(p_skip_roles\)/);
  });

  it('strips NULLs from the exclusion array so it cannot silently drop the row', () => {
    // x = ANY(ARRAY[NULL]) is NULL, not false — NOT NULL is NULL, which would
    // filter out EVERY row. array_remove is what keeps optional excludes safe.
    expect(body()).toMatch(/array_remove\(COALESCE\(p_exclude_user_ids, ARRAY\[\]::UUID\[\]\), NULL\)/);
  });

  it('is a no-op for a NULL user, never an error', () => {
    expect(body()).toMatch(/IF p_user_id IS NULL THEN\s*\n\s*RETURN;/);
  });

  it('drops the older signature so it cannot install as an ambiguous overload', () => {
    // Same hazard 066 documented when it added a parameter to enqueue_notification.
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS enqueue_notification_user\(/);
  });
});

describe('migration 092 — RETURNED goes to the estimator who approved it', () => {
  it('addresses the owning estimator personally, not the estimator role', () => {
    const branch = statusBranch('RETURNED');
    expect(branch).toMatch(/v_owner := mr_owning_estimator\(NEW\.project_id, NEW\.reviewed_by\)/);
    expect(branch).toMatch(/enqueue_notification_user\(\s*NEW\.project_id, v_owner, 'RETURNED'/);
  });

  it('excludes the admin who returned it', () => {
    expect(statusBranch('RETURNED')).toMatch(/ARRAY\[NEW\.returned_by\],\s+-- the admin who returned it, excluded/);
  });

  it('falls back to the estimator inbox when no owner can be named — never silent', () => {
    const branch = statusBranch('RETURNED');
    const fallback = branch.slice(branch.indexOf('ELSE'));
    expect(fallback).toMatch(/v_inbox := ARRAY\['estimator'\]/);
    expect(fallback).toMatch(/'estimator'\s+-- p_target_role \(066\)/);
  });

  it('still sends the requesting supervisor their own copy, without duplicating', () => {
    const branch = statusBranch('RETURNED');
    const req = branch.slice(branch.indexOf('IF NEW.requested_by IS NOT NULL THEN'));
    expect(req).toMatch(/enqueue_notification_user\(\s*NEW\.project_id, NEW\.requested_by, 'RETURNED'/);
    // Excludes the acting admin AND the owner already notified above; skips the
    // role only when the inbox fan-out was actually used.
    expect(req).toMatch(/ARRAY\[NEW\.returned_by, v_owner\]/);
    expect(req).toMatch(/v_inbox\s+-- NULL unless the inbox was used/);
  });

  it('keeps 089s reason handling: never invented, truncated visibly, full text in params', () => {
    const body = fnBody('notify_header_status_change');
    expect(body).toMatch(/NULLIF\(btrim\(COALESCE\(NEW\.returned_reason, ''\)\), ''\)/);
    expect(body).toMatch(/left\(v_reason, 119\) \|\| '…'/);
    expect(body).toMatch(/jsonb_build_object\('returnedReason', v_reason\)/);
  });
});

describe('migration 092 — AUTO_HOLD reaches the reviewer and the requester only', () => {
  it('prefers the owning estimator over the role inbox', () => {
    const branch = statusBranch('AUTO_HOLD');
    expect(branch).toMatch(/v_owner := mr_owning_estimator\(NEW\.project_id, NEW\.reviewed_by\)/);
    expect(branch).toMatch(/enqueue_notification_user\(\s*NEW\.project_id, v_owner, 'AUTO_HOLD'/);
    expect(branch).toMatch(/'estimator'\s+-- p_target_role \(066\): the unclaimed-review inbox/);
  });

  it('excludes the human who caused the transition, and only when there was one', () => {
    // 033's system promotion leaves reviewed_by untouched → v_actor NULL → no
    // exclusion. A principal's manual Tahan stamps it → they are excluded.
    expect(statusBranch('AUTO_HOLD')).toMatch(
      /v_actor := CASE WHEN NEW\.reviewed_by IS DISTINCT FROM OLD\.reviewed_by\s*\n\s*THEN NEW\.reviewed_by ELSE NULL END;/,
    );
  });

  it('tells the requesting supervisor their request is stuck, without duplicating', () => {
    const branch = statusBranch('AUTO_HOLD');
    expect(branch).toMatch(/enqueue_notification_user\(\s*NEW\.project_id, NEW\.requested_by, 'AUTO_HOLD'/);
    expect(branch).toMatch(/ARRAY\[v_actor, v_owner\], v_inbox/);
  });

  it('no longer fans out to the principal role (093 puts them on every project)', () => {
    expect(statusBranch('AUTO_HOLD')).not.toMatch(/'principal'/);
  });
});

describe('migration 092 — APPROVED / REJECTED reach the requesting supervisor only', () => {
  it.each(['APPROVED', 'REJECTED'] as const)('%s notifies requested_by and nobody else', status => {
    const branch = statusBranch(status);
    expect(branch).toMatch(new RegExp(`enqueue_notification_user\\(\\s*NEW\\.project_id, NEW\\.requested_by, '${status}'`));
    expect(branch).toMatch(/ARRAY\[NEW\.reviewed_by\],\s+-- never self-notify/);
    // No role-wide fan-out inside the outcome branch at all.
    expect(branch).not.toMatch(/PERFORM enqueue_notification\(/);
  });

  it('addresses the supervisor personally ("Permintaan Anda"), not as a broadcast', () => {
    expect(statusBranch('APPROVED')).toMatch(/'Permintaan Anda '/);
    expect(statusBranch('REJECTED')).toMatch(/'Permintaan Anda '/);
  });

  it("keeps 067/088's admin PO handoff on APPROVED", () => {
    const body = fnBody('notify_header_status_change');
    expect(body).toMatch(/'REQUEST_APPROVED_FOR_PO'/);
    expect(body).toMatch(/'admin'\s+-- p_target_role \(066\)/);
  });
});

describe('migration 092 — no all-members fan-out survives anywhere', () => {
  it('every remaining role fan-out names a role as its last argument', () => {
    // The old shape passed the actor with no 9th arg (NULL target = everyone).
    const calls = SQL.split('PERFORM enqueue_notification(').slice(1)
      .map(c => c.slice(0, c.indexOf(');')));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/'(estimator|principal|admin|supervisor)'\s*(--[^\n]*)?\s*$/);
    }
  });

  it('drops the v_target variable whose NULL default meant "everyone"', () => {
    expect(fnBody('notify_header_status_change')).not.toMatch(/v_target\s+TEXT\s*:=\s*NULL/);
  });

  it('only fires on the four decided statuses', () => {
    expect(fnBody('notify_header_status_change'))
      .toMatch(/NOT IN \('AUTO_HOLD', 'APPROVED', 'REJECTED', 'RETURNED'\)/);
  });
});

describe('migration 092 — PO_READY and RECEIPT_MISMATCH are role-scoped', () => {
  it('PO_READY notifies admins (send) and supervisors (receive) — nobody else', () => {
    const body = fnBody('notify_po_ready');
    expect(body).toMatch(/'admin'\s+-- p_target_role/);
    expect(body).toMatch(/'supervisor'\s+-- p_target_role/);
    // The old everyone-call passed NULL with a "notify everyone" comment.
    expect(body).not.toMatch(/notify everyone/);
  });

  it('documents WHY PO_READY cannot name one supervisor instead of guessing', () => {
    // Truth contract: purchase_orders has no link back to a request header, so
    // the requesting supervisor is unknowable here. That must stay written down
    // — a future edit that "improves" this by matching boq_ref text would be
    // inventing a link the schema does not have.
    expect(SQL).toMatch(/KNOWN LIMITATION/);
    expect(SQL).toMatch(/request_header_id to purchase_orders/);
  });

  it('RECEIPT_MISMATCH goes to admins, escalates to principal only on CRITICAL, still excludes the receiver', () => {
    const body = fnBody('notify_receipt_mismatch');
    expect(body).toMatch(/'admin'\s+-- p_target_role/);
    const critical = body.slice(body.indexOf("IF NEW.gate3_flag = 'CRITICAL' THEN"));
    expect(critical).toMatch(/'principal'\s+-- p_target_role/);
    expect((body.match(/NEW\.received_by/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('migration 092 — reading requires current project membership', () => {
  it('re-creates notifications_select_own with recipient AND membership', () => {
    const m = SQL.match(/CREATE POLICY notifications_select_own[\s\S]*?\);/);
    expect(m).not.toBeNull();
    const policy = m![0];
    expect(policy).toMatch(/auth\.uid\(\) = recipient_user_id/);
    expect(policy).toMatch(/FROM project_assignments pa/);
    expect(policy).toMatch(/pa\.project_id = notifications\.project_id/);
    expect(policy).toMatch(/pa\.user_id\s*=\s*auth\.uid\(\)/);
  });

  it('does not touch the UPDATE (mark-read) policy or INSERT denial', () => {
    expect(SQL).not.toMatch(/notifications_update_own/);
    expect(SQL).not.toMatch(/FOR INSERT/);
  });
});

describe('migration 092 — contracts every sibling migration honours', () => {
  it('cannot block the business write (every enqueue is exception-wrapped)', () => {
    const performs = (SQL.match(/PERFORM enqueue_notification/g) ?? []).length;
    const warnings = (SQL.match(/RAISE WARNING/g) ?? []).length;
    expect(performs).toBeGreaterThanOrEqual(8);
    expect(warnings).toBeGreaterThanOrEqual(performs);
  });

  it('is re-paste safe: CREATE OR REPLACE + DROP ... IF EXISTS only', () => {
    expect(SQL).not.toMatch(/^\s*CREATE FUNCTION/m);
    expect(SQL).toMatch(/DROP POLICY IF EXISTS notifications_select_own/);
    // No schema change: types were all added by earlier migrations.
    expect(SQL).not.toMatch(/notifications_type_check/);
    expect(SQL).not.toMatch(/ALTER TABLE/);
  });

  it('creates no triggers (all three functions are already wired by 034)', () => {
    expect(SQL).not.toMatch(/CREATE TRIGGER/);
    expect(SQL).not.toMatch(/CREATE CONSTRAINT TRIGGER/);
  });
});

describe.skip('migration 092 — live DB (awaiting the user pasting 092)', () => {
  it.todo('returning an approved request notifies ONLY the estimator who approved it');
  it.todo('a second estimator on the same project receives nothing for that return');
  it.todo('approving a request notifies the requester and the admins, and no other supervisor');
  it.todo('an AUTO_HOLD on an unclaimed request falls back to the estimator inbox');
  it.todo('a returned request whose approver left the project still reaches the inbox');
  it.todo('a user removed from a project stops seeing its past notifications');
});
