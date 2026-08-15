/**
 * Static guard for migration 088 (approval / PO separation of duties).
 *
 * Design authority:
 *   docs/superpowers/specs/2026-08-15-approval-po-separation-of-duties-design.md
 *
 * This suite does NOT touch a database. It asserts the frozen contract that the
 * screens (ApprovalsScreen, Gate2Screen), the pure helpers (tools/poQuantityGate.ts,
 * tools/rolePermissions.ts) and the earlier migrations (002/033/036/060/068/071)
 * depend on. The DB half of a dual-layer gate cannot be exercised from jest —
 * migrations are pasted into the Supabase Dashboard (remote history diverged) —
 * so the guard here is the SQL text itself: if someone edits 088 and drops the
 * estimator narrowing, the RETURNED sticky rule, or an override-coverage
 * predicate, the TS half would silently disagree with the server. This fails
 * first.
 *
 * The live-DB verification that genuinely proves the four-role matrix is the
 * skipped block at the bottom — it awaits the user pasting migration 088.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluatePoQuantityGate,
  checkOverrideCoverage,
} from '../poQuantityGate';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/088_approval_po_separation.sql'),
  'utf8',
);

describe('migration 088 — §4 RETURNED status + return-reason columns', () => {
  it('rewrites the overall_status CHECK to include RETURNED alongside the original five', () => {
    expect(SQL).toMatch(/DROP CONSTRAINT IF EXISTS material_request_headers_overall_status_check/);
    expect(SQL).toMatch(
      /CHECK \(overall_status IN \(\s*'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_HOLD', 'RETURNED'\s*\)\)/,
    );
  });

  it('adds the return-reason carrier columns idempotently', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS returned_reason TEXT/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES profiles\(id\)/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ/);
  });
});

describe('migration 088 — §5.1 PO writes narrowed to admin + principal', () => {
  it('DROPS 036\'s blanket office_all policies rather than supplementing them', () => {
    // Migration 060's header documents the trap: a blanket is_office_role()
    // FOR ALL left in place keeps the excluded role writing.
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "purchase_orders_office_all" ON purchase_orders/);
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "purchase_order_lines_office_all" ON purchase_order_lines/);
  });

  it('defines is_po_writer() as admin + principal only, definer-safe', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION is_po_writer\(\)/);
    expect(SQL).toMatch(/role IN \('admin', 'principal'\)/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION is_po_writer\(\) TO authenticated/);
  });

  it('narrows 002\'s office insert/update policies on both PO tables (no estimator)', () => {
    for (const policy of [
      'purchase_orders_office_insert',
      'purchase_orders_office_update',
      'po_lines_office_insert',
      'po_lines_office_update',
    ]) {
      expect(SQL).toContain(`DROP POLICY IF EXISTS "${policy}"`);
      expect(SQL).toContain(`CREATE POLICY "${policy}"`);
    }
    // The narrowed policies must not re-admit the estimator anywhere.
    expect(SQL).not.toMatch(/'admin', 'estimator', 'principal'/);
  });

  it('keeps office-wide READ for all three office roles (estimator stays 👁)', () => {
    expect(SQL).toMatch(/CREATE POLICY "purchase_orders_office_read" ON purchase_orders\s*\n\s*FOR SELECT/);
    expect(SQL).toMatch(/CREATE POLICY "po_lines_office_read" ON purchase_order_lines\s*\n\s*FOR SELECT/);
    expect(SQL).toMatch(/is_office_role\(\)/);
  });

  it('leaves submit_receipt and the receiving tables untouched', () => {
    // Supervisors receive through the migration-060 SECURITY DEFINER RPC; this
    // migration must not redefine it, nor narrow receipts / receipt_lines.
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION submit_receipt/);
    expect(SQL).not.toMatch(/ON receipts\b/);
    expect(SQL).not.toMatch(/ON receipt_lines\b/);
  });
});

describe('migration 088 — §5.2 transition guard on material_request_headers', () => {
  it('follows 059\'s guard shape (definer plpgsql, pinned search_path)', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION guard_material_request_status_transition\(\)/);
    expect(SQL).toMatch(
      /RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/,
    );
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS material_request_headers_status_guard_trg/);
    expect(SQL).toMatch(/BEFORE UPDATE OF overall_status\s*\n?\s*ON material_request_headers/);
  });

  it('lets the no-JWT contexts through the actor check (057/059/060 house style)', () => {
    expect(SQL).toMatch(/IF auth\.uid\(\) IS NULL THEN\s*\n\s*RETURN NEW;/);
  });

  it('judges only real status changes, and never 033\'s nested promotion', () => {
    expect(SQL).toMatch(/NEW\.overall_status IS NOT DISTINCT FROM OLD\.overall_status/);
    expect(SQL).toMatch(/pg_trigger_depth\(\) > 1/);
  });

  it('implements the exact §5.2 transition table', () => {
    // Estimator/principal own every reviewer verdict, from all four open states —
    // including RETURNED, which may be re-decided directly (no PENDING round trip).
    expect(SQL).toMatch(
      /v_to IN \('APPROVED', 'REJECTED'\)\s*\n\s*AND v_from IN \('PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'RETURNED'\)\s*\n\s*THEN v_actor IN \('estimator', 'principal'\)/,
    );
    // Re-open is the estimator's, and optional.
    expect(SQL).toMatch(
      /v_to = 'PENDING' AND v_from = 'RETURNED'\s*\n\s*THEN v_actor IN \('estimator', 'principal'\)/,
    );
    // Returning an APPROVED request is the admin's (and the principal's).
    expect(SQL).toMatch(
      /v_to = 'RETURNED' AND v_from = 'APPROVED'\s*\n\s*THEN v_actor IN \('admin', 'principal'\)/,
    );
    // Manual "Tahan" stays principal-only, unchanged.
    expect(SQL).toMatch(/v_to = 'AUTO_HOLD'\s*\n\s*THEN v_actor = 'principal'/);
    // Everything else is refused — a whitelist, so a future status is denied by
    // default rather than silently permitted.
    expect(SQL).toMatch(/ELSE FALSE\s*\n\s*END/);
  });

  it('names the actor role and the attempted transition in the exception', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'MR_TRANSITION_DENIED[^']*%[^']*%[^']*%'/);
  });

  it('requires a non-empty reason to return an approved request', () => {
    expect(SQL).toMatch(/btrim\(COALESCE\(NEW\.returned_reason, ''\)\) = ''/);
    expect(SQL).toMatch(/MR_RETURN_REASON_REQUIRED/);
  });
});

describe('migration 088 — §5.2 last paragraph: RETURNED is sticky against 033', () => {
  it('re-creates 033\'s promotion trigger function with RETURNED excluded', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION recompute_header_flag\(\)/);
    expect(SQL).toMatch(/v_current_status IN \('PENDING', 'AUTO_HOLD'\)/);
    expect(SQL).toMatch(
      /v_current_status NOT IN \('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED'\)/,
    );
  });

  it('does not gratuitously redefine 033\'s other two trigger functions', () => {
    expect(SQL).not.toMatch(/FUNCTION recompute_line_flag\(\)/);
    expect(SQL).not.toMatch(/FUNCTION recompute_line_flag_from_allocation\(\)/);
    expect(SQL).not.toMatch(/FUNCTION dispatch_line_flag/);
  });
});

describe('migration 088 — §5.3 hard PO quantity gate, in lockstep with tools/poQuantityGate.ts', () => {
  it('fires on purchase_order_lines for the quantity-bearing columns only', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION guard_po_line_quantity_gate\(\)/);
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS purchase_order_lines_qty_gate_trg/);
    expect(SQL).toMatch(
      /AFTER INSERT OR UPDATE OF quantity, material_id, po_id\s*\n\s*ON purchase_order_lines/,
    );
  });

  it('reads the same envelope figures as the TS half (CANCELLED excluded, CLOSED_SHORT capped)', () => {
    // v_material_envelope_status is where migration 068 already encodes
    // "cancelled POs do not count" and "CLOSED_SHORT counts LEAST(qty, received)".
    // Re-deriving that arithmetic here would be the divergence; reading the view
    // is what keeps the two halves identical.
    expect(SQL).toMatch(/FROM v_material_envelope_status/);
    expect(SQL).not.toMatch(/po\.status = 'CLOSED_SHORT'/);
  });

  it('treats an unlinked or plan-less material as unmeasured — never a block', () => {
    // The TS half's rule, stated as a test on the real helper so the SQL mirror
    // below is anchored to observed behaviour rather than to a comment.
    const noPlan = evaluatePoQuantityGate(
      [{ material_id: 'm1', material_name: 'Semen', quantity: 500 }],
      [{ material_id: 'm1', total_planned: 0, total_ordered: 0 }],
    );
    expect(noPlan.hasBreach).toBe(false);
    expect(noPlan.unmeasured).toHaveLength(1);

    const freeText = evaluatePoQuantityGate(
      [{ material_id: null, material_name: 'Paku lokal', quantity: 999 }],
      [],
    );
    expect(freeText.hasBreach).toBe(false);

    expect(SQL).toMatch(/IF NEW\.material_id IS NULL THEN/);
    expect(SQL).toMatch(/IF v_planned IS NULL OR v_planned <= 0 THEN/);
  });

  it('blocks only a real overage — the TS boundary case must not block either', () => {
    const exact = evaluatePoQuantityGate(
      [{ material_id: 'm1', material_name: 'Besi D13', quantity: 40 }],
      [{ material_id: 'm1', total_planned: 100, total_ordered: 60 }],
    );
    expect(exact.hasBreach).toBe(false);

    const over = evaluatePoQuantityGate(
      [{ material_id: 'm1', material_name: 'Besi D13', quantity: 41 }],
      [{ material_id: 'm1', total_planned: 100, total_ordered: 60 }],
    );
    expect(over.hasBreach).toBe(true);

    // Post-write the view's total_ordered already includes this line, so
    // "existing + this_line > planned" is exactly "v_ordered > v_planned".
    expect(SQL).toMatch(/IF v_ordered <= v_planned THEN/);
  });

  it('aggregates per material across the PO, as 071 and the TS helper both do', () => {
    const split = evaluatePoQuantityGate(
      [
        { material_id: 'm1', material_name: 'Besi D13', quantity: 30 },
        { material_id: 'm1', material_name: 'Besi D13', quantity: 30 },
      ],
      [{ material_id: 'm1', total_planned: 100, total_ordered: 50 }],
    );
    expect(split.breaches[0].attempted).toBe(60);

    expect(SQL).toMatch(
      /SELECT COALESCE\(SUM\(pol\.quantity\), 0\)[\s\S]{0,200}WHERE pol\.po_id = NEW\.po_id\s*\n\s*AND pol\.material_id = NEW\.material_id/,
    );
  });

  it('accepts exactly the override contract checkOverrideCoverage enforces', () => {
    const breaches = [
      { material_id: 'm1', material_name: 'Besi D13', remaining: 40, attempted: 60, over: 20 },
    ];
    expect(checkOverrideCoverage(breaches, [
      { material_id: 'm1', attempted_qty: 60, remaining_at_escalation: 40 },
    ]).covered).toBe(true);
    // Approved for less than this PO attempts → not covered.
    expect(checkOverrideCoverage(breaches, [
      { material_id: 'm1', attempted_qty: 59, remaining_at_escalation: 40 },
    ]).covered).toBe(false);

    expect(SQL).toMatch(/t\.entity_type = 'po_qty_gate'/);
    expect(SQL).toMatch(/t\.action IN \('APPROVE', 'OVERRIDE'\)/);
    expect(SQL).toMatch(
      /\(e->>'material_id'\)::UUID = NEW\.material_id\s*\n\s*AND \(e->>'attempted_qty'\)::NUMERIC >= v_attempted/,
    );
  });

  it('never judges an edit that cannot raise the cumulative', () => {
    // §7 grandfathering has to survive contact with a legacy over-plan line:
    // if the gate judged a downward correction, the pre-existing overage would
    // block the write that fixes it and stay locked in forever.
    expect(SQL).toMatch(
      /TG_OP = 'UPDATE'\s*\n\s*AND NEW\.po_id IS NOT DISTINCT FROM OLD\.po_id\s*\n\s*AND NEW\.material_id IS NOT DISTINCT FROM OLD\.material_id\s*\n\s*AND NEW\.quantity <= OLD\.quantity/,
    );
  });

  it('raises with the machine-readable prefix the client already branches on', () => {
    // Gate2Screen matches /PO_QTY_BREACH/ on the RPC error; the trigger must
    // speak the same contract or a direct-REST block reads as an unknown crash.
    expect(SQL).toMatch(/RAISE EXCEPTION 'PO_QTY_BREACH:/);
  });
});

describe('migration 088 — §5.4 a returned request notifies the estimator', () => {
  it('widens the notifications.type CHECK to admit RETURNED (else the enqueue fails SILENTLY)', () => {
    // The enqueue is wrapped in EXCEPTION WHEN OTHERS THEN RAISE WARNING (034/067
    // never-block pattern), so a type the CHECK rejects does not surface as an
    // error — it drops the notification and the estimator learns nothing. The
    // branch and the CHECK must therefore ship together.
    expect(SQL).toMatch(/ADD CONSTRAINT notifications_type_check/);
    expect(SQL).toMatch(/EXECUTE format\('ALTER TABLE public\.notifications DROP CONSTRAINT %I', c\)/);
    // Strict superset of 079's live list — nothing dropped.
    for (const type of [
      'AUTO_HOLD', 'APPROVED', 'REJECTED',
      'PO_READY', 'RECEIPT_MISMATCH',
      'GATE2_OVER_BUDGET', 'GATE4_INVOICE_MISMATCH',
      'REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING',
      'PLAN_REVISED', 'PLAN_CEILING_RAISE',
      'RETURNED',
    ]) {
      expect(SQL).toMatch(
        new RegExp(`ADD CONSTRAINT notifications_type_check[\\s\\S]{0,600}'${type}'`),
      );
    }
  });

  it('emits on RETURNED, targeted at the estimator, carrying the reason', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION notify_header_status_change\(\)/);
    // The 085 early-return that swallowed RETURNED must now admit it.
    expect(SQL).toMatch(
      /NEW\.overall_status NOT IN \('AUTO_HOLD', 'APPROVED', 'REJECTED', 'RETURNED'\)/,
    );
    expect(SQL).toMatch(/v_type\s+:= 'RETURNED';/);
    // Targeted at the actor who must act next (066's p_target_role), not the
    // whole project.
    expect(SQL).toMatch(/v_target\s+:= 'estimator';/);
    // Self-explanatory: the reason in the body AND in the deeplink payload.
    expect(SQL).toMatch(/NEW\.returned_reason/);
    expect(SQL).toMatch(/jsonb_build_object\('returnedReason', v_reason\)/);
    // Named author, taken from the server-stamped returned_by.
    expect(SQL).toMatch(/FROM profiles WHERE id = NEW\.returned_by/);
    expect(SQL).toMatch(/v_actor\s+:= NEW\.returned_by;/);
  });

  it('keeps 085\'s three existing branches and its admin PO handoff intact', () => {
    // 085 is LIVE. A CREATE OR REPLACE that drops its detail-payload work would
    // silently revert bodies to 067's generic wording — invisible until a user
    // reports "Permintaan ditolak" with no subject again.
    expect(SQL).toMatch(/v_summary\s+:= mr_request_summary\(NEW\.id\);/);
    expect(SQL).toMatch(/mr_request_summary\(NEW\.id, TRUE\)/);              // AUTO_HOLD subject
    expect(SQL).toMatch(/' di-flag ' \|\| COALESCE\(NEW\.overall_flag, 'CRITICAL'\)/);
    expect(SQL).toMatch(/COALESCE\(v_summary, 'material'\) \|\| ' disetujui'/);
    expect(SQL).toMatch(/COALESCE\(v_summary, 'material'\) \|\| ' ditolak'/);
    expect(SQL).toMatch(/COALESCE\(' oleh ' \|\| v_reviewer, ''\)/);
    expect(SQL).toMatch(/'REQUEST_APPROVED_FOR_PO'/);
    expect(SQL).toMatch(/' disetujui\. Buat PO di SANO\.'/);
    expect(SQL).toMatch(/'admin'\s+-- p_target_role/);
    // Never-block wrappers survive on both enqueues.
    expect(SQL).toMatch(/RAISE WARNING 'enqueue_notification \(header status\) failed: %', SQLERRM/);
    expect(SQL).toMatch(/RAISE WARNING 'enqueue_notification \(REQUEST_APPROVED_FOR_PO\) failed: %', SQLERRM/);
  });

  it('does not redefine 085\'s other functions (they would revert to 067/034 wording)', () => {
    expect(SQL).not.toMatch(/FUNCTION notify_header_created\(\)/);
    expect(SQL).not.toMatch(/FUNCTION mr_request_summary/);
    expect(SQL).not.toMatch(/FUNCTION notify_po_ready\(\)/);
    expect(SQL).not.toMatch(/FUNCTION notify_receipt_mismatch\(\)/);
    expect(SQL).not.toMatch(/FUNCTION notify_plan_ceiling_raise\(\)/);
    expect(SQL).not.toMatch(/FUNCTION enqueue_notification/);
  });
});

describe('migration 088 — §5.5 RETURNED counts as open demand', () => {
  it('adds RETURNED to 069\'s compute_tier2_flag whitelist', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION compute_tier2_flag\(/);
    expect(SQL).toMatch(
      /mrh\.overall_status IN \('PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'APPROVED', 'RETURNED'\)/,
    );
    // 072's v_material_envelope_status.total_requested excludes only REJECTED;
    // the two advisory surfaces must not disagree about the same request.
    expect(SQL).not.toMatch(/IN \('PENDING', 'UNDER_REVIEW', 'AUTO_HOLD', 'APPROVED'\)/);
  });

  it('re-creates 069\'s body verbatim otherwise — same signature, same bands', () => {
    expect(SQL).toMatch(/p_material_id UUID,\s*\n\s*p_project_id UUID,\s*\n\s*p_requested_qty NUMERIC\s*\n\) RETURNS TEXT/);
    expect(SQL).toMatch(/SELECT total_planned, total_ordered\s*\n\s*INTO v_total_planned, v_po_ordered\s*\n\s*FROM v_material_envelope_status/);
    // The WARNING cap (Task 2.4) and the INFO band are unchanged — this is an
    // advisory signal and must change NO gate.
    expect(SQL).toMatch(/IF v_burn_pct > 80 THEN RETURN 'WARNING'; END IF;/);
    expect(SQL).toMatch(/IF v_burn_pct > 50 THEN RETURN 'INFO'; END IF;/);
    // The fulfilled-line exclusion that avoids the request+PO double count —
    // and, critically, 073's CANCELLED-PO join within it. 088 re-creates this
    // function, so rebuilding from 069's older body would silently revert
    // 073 (Task 2.9) and let a line linked to a later-CANCELLED PO stay
    // excluded from the burn. Pin the join so that regression fails here.
    expect(SQL).toMatch(
      /FROM purchase_order_lines pol\s*\n\s*JOIN purchase_orders po ON po\.id = pol\.po_id\s*\n\s*WHERE pol\.request_line_id IS NOT NULL\s*\n\s*AND po\.status <> 'CANCELLED'/,
    );
  });

  it('does not redefine 069\'s other two tier functions', () => {
    expect(SQL).not.toMatch(/FUNCTION compute_tier1_workgroup_flag/);
    expect(SQL).not.toMatch(/FUNCTION compute_tier3_flag/);
    expect(SQL).not.toMatch(/FUNCTION compute_tier1_flag/);
  });
});

describe('migration 088 — §7 grandfathering + re-paste safety', () => {
  it('creates no policy without dropping it first', () => {
    const created = [...SQL.matchAll(/CREATE POLICY "([a-z_]+)"/g)].map(m => m[1]);
    const dropped = new Set(
      [...SQL.matchAll(/DROP POLICY IF EXISTS "([a-z_]+)"/g)].map(m => m[1]),
    );
    expect(created.length).toBeGreaterThan(0);
    expect(created.filter(name => !dropped.has(name))).toEqual([]);
  });

  it('creates no trigger without dropping it first', () => {
    const created = [...SQL.matchAll(/CREATE TRIGGER ([a-z_]+)/g)].map(m => m[1]);
    const dropped = new Set([...SQL.matchAll(/DROP TRIGGER IF EXISTS ([a-z_]+)/g)].map(m => m[1]));
    expect(created.length).toBe(2);
    expect(created.filter(name => !dropped.has(name))).toEqual([]);
  });

  it('replaces functions rather than creating them (no re-paste 42723)', () => {
    const bareCreates = [...SQL.matchAll(/^CREATE FUNCTION /gm)];
    expect(bareCreates).toHaveLength(0);
  });

  it('backfills nothing — no existing PO or request may be invalidated', () => {
    expect(SQL).not.toMatch(/^UPDATE (purchase_order|material_request)/m);
  });

  it('documents what it changes, why, and the deploy order', () => {
    expect(SQL).toMatch(/2026-08-15-approval-po-separation-of-duties-design\.md/);
    expect(SQL).toMatch(/Paste order/);
    expect(SQL).toMatch(/before shipping the app build/i);
    // The dual-layer lockstep obligation (project memory: 033/048/049).
    expect(SQL).toMatch(/tools\/poQuantityGate\.ts/);
  });

  it('declares the already-live functions it replaces, and what that costs on re-paste', () => {
    // 033's recompute_header_flag, 085's notify_header_status_change and 069's
    // compute_tier2_flag are all live. Pasting their home migration AFTER this
    // file reverts §5.2 / §5.4 / §5.5 silently — the reader has to be told.
    expect(SQL).toMatch(/pasting 069 or 085 AFTER this file/);
    expect(SQL).toMatch(/067 —/);
    expect(SQL).toMatch(/069 —/);
    expect(SQL).toMatch(/085 —/);
  });
});

/**
 * Live-DB verification — CANNOT run until the user pastes migration 088 into the
 * Supabase Dashboard SQL editor (remote migration history is diverged, so
 * `supabase db push` is unavailable and jest cannot apply the DDL itself).
 *
 * Per spec §8 these MUST run under the AUTHENTICATED role for each of the four
 * roles, never the service role: a service-role key bypasses RLS entirely and
 * would pass against a completely open policy set — exactly what hid the
 * material_aliases gap (migration 040). Use the sign-in pattern in
 * materialAliasesRls.test.ts (create user → signInWithPassword → assert), not
 * adminClient.
 *
 * Un-skip and implement once 088 is live.
 */
describe.skip('migration 088 — live DB (awaiting the user pasting 088)', () => {
  it.todo('estimator: INSERT into purchase_orders is refused by RLS');
  it.todo('estimator: INSERT into purchase_order_lines is refused by RLS');
  it.todo('estimator: SELECT on purchase_orders still returns the project\'s POs');
  it.todo('admin: creating a PO + lines within plan still succeeds end-to-end');
  it.todo('admin: UPDATE overall_status PENDING → APPROVED raises MR_TRANSITION_DENIED');
  it.todo('admin: UPDATE overall_status AUTO_HOLD → APPROVED raises MR_TRANSITION_DENIED');
  it.todo('admin: APPROVED → RETURNED without a reason raises MR_RETURN_REASON_REQUIRED');
  it.todo('admin: APPROVED → RETURNED with a reason stamps returned_by = auth.uid()');
  it.todo('estimator: RETURNED → APPROVED succeeds directly (no PENDING round trip)');
  it.todo('estimator: * → AUTO_HOLD raises MR_TRANSITION_DENIED (principal-only Tahan)');
  it.todo('principal: every transition in the §5.2 table succeeds');
  it.todo('supervisor: any overall_status write is refused (RLS, before the trigger)');
  it.todo('a RETURNED request is not re-promoted to AUTO_HOLD when a HIGH line flag lands');
  it.todo('PO line within plan inserts; over plan raises PO_QTY_BREACH');
  it.todo('over plan with an APPROVED po_qty_gate override covering the qty inserts');
  it.todo('a CANCELLED PO\'s lines do not count toward the next PO\'s cumulative');
  it.todo('a CLOSED_SHORT PO counts LEAST(line qty, received) toward the cumulative');
  it.todo('a PO line predating 088 stays editable (price edit does not re-run the gate)');
  it.todo('an over-plan line predating 088 can still be corrected downward');
  it.todo('supervisor receiving via submit_receipt is unaffected');
  // §5.4 — the return must actually reach the estimator, not just change a row.
  it.todo('APPROVED → RETURNED writes a notifications row of type RETURNED (CHECK admits it)');
  it.todo('the RETURNED notification reaches estimators only, not the whole project');
  it.todo('the RETURNED notification body names the returning admin and the reason');
  it.todo('the RETURNED notification deeplinks to ApprovalsScreen with headerId + returnedReason');
  it.todo('approving still fires 085\'s APPROVED + admin REQUEST_APPROVED_FOR_PO pair (no regression)');
  it.todo('rejecting still fires 085\'s material-naming REJECTED body (no regression)');
  // §5.5 — the same request must read as demand on every advisory surface.
  it.todo('compute_tier2_flag counts a RETURNED request\'s lines as open demand');
  it.todo('compute_tier2_flag agrees with v_material_envelope_status.total_requested on a RETURNED request');
  it.todo('a RETURNED request still cannot AUTO_HOLD anything — the tier flags stay capped at WARNING');
});
