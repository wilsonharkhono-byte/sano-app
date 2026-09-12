/**
 * Static guard for migration 099 (reassigning an open site event).
 *
 * Like the 088/092/095/096 suites this touches no database: migrations are
 * pasted into the Supabase Dashboard, so the SQL text IS the artifact under
 * test. Guards read CODE, the file with every full-line comment removed, so
 * the header or the self-check footer can never satisfy a guard the SQL fails.
 *
 *  • The RPC exists because 097's site_events_human_fields_rpc_only refuses a
 *    direct write to owner_id and due_date. Inside a SECURITY DEFINER function
 *    that trigger returns early, so EVERY rule it would have enforced has to be
 *    written out here. Each of the refusals below is one of those rules;
 *    losing one silently reopens the hole the trigger was closing.
 *  • REVOKE before GRANT, and anon never gets EXECUTE: the function moves
 *    accountability, so an unauthenticated caller must not reach it at all.
 *  • search_path is pinned, or a SECURITY DEFINER function can be aimed at an
 *    attacker's schema.
 *  • No DDL on any table and exactly one CREATE OR REPLACE, so a second paste
 *    is a no-op (the migration history on this project is divergent and files
 *    get re-pasted).
 *  • No later migration redefines the function, which a re-paste of 099 would
 *    revert.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '099_site_event_assignment.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL); // comments can never satisfy a guard

const SIG = 'update_site_event_assignment(UUID, UUID, DATE)';

describe('migration 099 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/2026-09-10-papan-ruangan-blueprint\.md/);
  });

  it('names its place in the paste order, after 098', () => {
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/After 096, 097 and 098/);
  });

  it('says out loud that it must be re-paste safe, and what a re-paste can undo', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/migration099\.test\.ts/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting\)/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(9);
  });
});

describe('migration 099 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid that shows the outcome without reading a notice', () => {
    expect(CODE.trimEnd()).toMatch(/SELECT proname, prosecdef, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname = 'update_site_event_assignment';$/);
  });
});

describe('migration 099 - a second paste cannot fail', () => {
  it('defines exactly one function, with CREATE OR REPLACE and no DROP FUNCTION', () => {
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).toHaveLength(1);
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION update_site_event_assignment\(/);
    expect(CODE).not.toMatch(/\bDROP\s+FUNCTION\b/i);
  });

  it('runs no DDL on any table, view, policy or trigger', () => {
    expect(CODE).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|POLICY|TRIGGER|INDEX|TYPE)\b/i);
  });
});

describe('migration 099 - the RPC is the only door through 097 D5', () => {
  it('is SECURITY DEFINER with search_path pinned', () => {
    expect(CODE).toMatch(/SECURITY DEFINER/);
    expect(CODE).toMatch(/SET search_path = public/);
  });

  it('revokes from PUBLIC and anon, then grants only to authenticated and service_role', () => {
    const revoke = CODE.indexOf('REVOKE ALL ON FUNCTION update_site_event_assignment');
    const grant = CODE.indexOf('GRANT EXECUTE ON FUNCTION update_site_event_assignment');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION update_site_event_assignment\(UUID, UUID, DATE\) FROM PUBLIC, anon;/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION update_site_event_assignment\(UUID, UUID, DATE\) TO authenticated, service_role;/);
  });

  it('locks the row it is about to move before reading anything from it', () => {
    expect(CODE).toMatch(/SELECT \* INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;/);
  });

  it('refuses to move an owner or due date on anything but an open event', () => {
    // Written as the exact guard, not just "the SITE_EVENT_NOT_OPEN code exists
    // somewhere": that weaker check would still pass a widened status set (e.g.
    // 'open' or 'done') that lets a closed event be reassigned.
    expect(CODE).toMatch(/IF v_ev\.status <> 'open' THEN/);
  });

  it('raises one named refusal per rule the D5 trigger cannot enforce here', () => {
    const codes = [...CODE.matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    expect(codes).toEqual([
      'SITE_EVENT_NOT_FOUND',
      'SITE_EVENT_AUTH',           // no session
      'SITE_EVENT_AUTH',           // not a member and not office
      'SITE_EVENT_ASSIGN_ROLE',    // not the reporter and not office
      'SITE_EVENT_NOT_OPEN',
      'SITE_EVENT_OWNER_NOT_MEMBER',
      'SITE_EVENT_OWNER_REQUIRED',
      'SITE_EVENT_DUE',
    ]);
  });

  it('refuses a caller who is neither an office role nor the reporter', () => {
    expect(CODE).toMatch(/NOT \(is_office_role\(\) OR v_ev\.reporter_id = v_uid\)/);
  });

  it('never lets the current owner reassign their own event', () => {
    // Spec §9 lists office roles and the reporter only. owner_id must not
    // appear in any authorisation test.
    const authBlock = CODE.slice(CODE.indexOf('BEGIN'), CODE.indexOf('IF v_ev.status'));
    expect(authBlock).not.toMatch(/v_ev\.owner_id\s*=\s*v_uid/);
  });

  it('requires the new owner to be a member of the event project', () => {
    expect(CODE).toMatch(/SELECT 1 FROM project_assignments pa\s+WHERE pa\.project_id = v_ev\.project_id AND pa\.user_id = p_owner_id/);
  });

  it('keeps both an owner and a due date on the four actionable types', () => {
    expect(CODE).toMatch(/v_ev\.event_type IN \('isu', 'hambatan', 'cacat', 'butuh_keputusan'\)\s+AND \(p_owner_id IS NULL OR p_due_date IS NULL\)/);
  });

  it('checks a MOVED due date against today, so an already-late event stays reassignable', () => {
    expect(CODE).toMatch(/p_due_date IS DISTINCT FROM v_ev\.due_date\s+AND p_due_date < v_today/);
    expect(CODE).toMatch(/v_today\s+DATE := \(now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date;/);
  });

  it('writes only owner_id and due_date, never another human field', () => {
    const update = CODE.slice(CODE.indexOf('UPDATE site_events'), CODE.indexOf('WHERE id = p_event_id;'));
    expect(update).toMatch(/SET owner_id = p_owner_id, due_date = p_due_date/);
    for (const col of ['event_type', 'gate_code', 'step_code', 'title', 'summary', 'is_blocking', 'vo_flag', 'status']) {
      expect(update).not.toContain(col);
    }
  });
});

describe('migration 099 - the notification', () => {
  it('enqueues SITE_EVENT_ASSIGNED to a NEW owner who is not the caller', () => {
    expect(CODE).toMatch(/p_owner_id IS DISTINCT FROM v_ev\.owner_id\s+AND p_owner_id IS DISTINCT FROM v_uid/);
    expect(CODE).toMatch(/'SITE_EVENT_ASSIGNED'/);
    expect(CODE).toMatch(/'SiteEventDetail'/);
    expect(CODE).toMatch(/jsonb_build_object\('eventId', p_event_id, 'projectId', v_ev\.project_id\)/);
  });

  it('never lets a notification failure roll back the reassignment', () => {
    expect(CODE).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'update_site_event_assignment: notification failed: %', SQLERRM;/);
  });

  it('keeps the enqueue call itself inside the exception handler, not only the read-back', () => {
    // If enqueue_notification_user is hoisted above the BEGIN, a failed
    // enqueue (a dropped notifications FK, a bad type) propagates uncaught
    // and rolls back the reassignment the block above just committed to.
    const block = CODE.slice(
      CODE.indexOf('IF p_owner_id IS NOT NULL\n     AND p_owner_id IS DISTINCT FROM v_ev.owner_id'),
      CODE.indexOf('EXCEPTION WHEN OTHERS'),
    );
    expect(block).toMatch(/BEGIN[\s\S]*PERFORM enqueue_notification_user\(/);
  });

  it('reports what actually landed rather than what was attempted', () => {
    expect(CODE).toMatch(/v_notified := EXISTS \(\s*SELECT 1 FROM notifications n/);
    expect(CODE).toMatch(/'notified', v_notified/);
  });

  it('bounds the read-back to this call, or a stale notification from an earlier confirm could be reported as this one', () => {
    // Mirrors confirm_site_event (097): now() is transaction start and
    // notifications.created_at defaults to now() (034), so a row from a
    // previous confirm/reassign of the same event to the same owner cannot
    // satisfy this call's read-back.
    const readback = CODE.slice(CODE.indexOf('v_notified := EXISTS'), CODE.indexOf('EXCEPTION WHEN OTHERS'));
    expect(readback).toMatch(/n\.related_entity_id = p_event_id/);
    expect(readback).toMatch(/n\.recipient_user_id = p_owner_id/);
    expect(readback).toMatch(/n\.type = 'SITE_EVENT_ASSIGNED'/);
    expect(readback).toMatch(/n\.created_at >= now\(\)/);
  });

  it('uses the 092 enqueue helper with its full ten-argument shape', () => {
    const call = CODE.slice(CODE.indexOf('PERFORM enqueue_notification_user('));
    const args = call.slice(0, call.indexOf(');') + 2);
    expect((args.match(/,/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(args).toMatch(/ARRAY\[v_uid\]/);
  });
});

describe('migration 099 - nothing later reverts it', () => {
  it('no later migration redefines update_site_event_assignment', () => {
    const later = fs.readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 99);
    const touching = later.filter((f) =>
      /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?update_site_event_assignment\b/i
        .test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))),
    );
    expect(touching).toEqual([]);
  });

  it('names the signature this suite pins, so a changed one is a deliberate edit', () => {
    expect(SIG).toBe('update_site_event_assignment(UUID, UUID, DATE)');
    expect(CODE).toContain('update_site_event_assignment(UUID, UUID, DATE)');
  });
});
