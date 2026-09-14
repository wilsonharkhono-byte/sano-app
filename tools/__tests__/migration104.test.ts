/**
 * Static guard for migration 104 (the weekly stage claim).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so a comment can never satisfy a guard the SQL fails. Behaviour as
 * real roles (submit, return, verify, corrections, notifications) is
 * rehearsed on Postgres by supabase/tests/progress_claims_rehearsal/run.sh.
 *
 *  • verify_progress_claim is the only writer of progress, and it writes the
 *    difference from the row's existing entries, so their sum always equals
 *    boq_items.installed.
 *  • The notification type list is 098's thirteen plus exactly three.
 *  • The app calls every RPC with the parameter names the SQL declares, and
 *    every refusal code has app copy and the reverse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KNOWN_DEEPLINK_SCREENS } from '../notificationRouting';
import { CLAIM_RPC_ERROR_COPY } from '../progressClaims/claimRules';

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const FILE = '104_progress_claims.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL);
const CODE_103 = stripComments(read('103_boq_stage_weights.sql'));
const FILES = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fnBody(name: string, code = CODE): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = code.indexOf('$$', start);
  const close = code.indexOf('$$;', open + 2);
  return code.slice(start, close + 3);
}

const typeList = (sql: string): string[] => {
  const code = stripComments(sql);
  const at = code.lastIndexOf('ADD CONSTRAINT notifications_type_check');
  const block = code.slice(at, code.indexOf('));', at));
  return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
};

const RPCS: Record<string, { sig: string; roles: string }> = {
  save_progress_claim_line: { sig: 'save_progress_claim_line(UUID, UUID, JSONB, TEXT, JSONB, TEXT)', roles: "ARRAY['supervisor', 'estimator', 'admin']" },
  remove_progress_claim_line: { sig: 'remove_progress_claim_line(UUID)', roles: "ARRAY['supervisor', 'estimator', 'admin']" },
  submit_progress_claim: { sig: 'submit_progress_claim(UUID)', roles: "ARRAY['supervisor', 'estimator', 'admin']" },
  return_progress_claim: { sig: 'return_progress_claim(UUID, TEXT)', roles: "ARRAY['estimator', 'admin']" },
  verify_progress_claim: { sig: 'verify_progress_claim(UUID, JSONB, TEXT)', roles: "ARRAY['estimator', 'admin']" },
};
const HELPERS = ['stage_pct_valid(JSONB, JSONB)', 'stage_pct_round(JSONB)', 'stage_row_fraction(JSONB, JSONB)', 'zero_stage_pct(JSONB)'];
const CLAIM_TYPES = ['PROGRESS_CLAIM_SUBMITTED', 'PROGRESS_CLAIM_RETURNED', 'PROGRESS_CLAIM_VERIFIED'];

describe('migration 104 - header states why, paste order and what a re-paste undoes', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-13-report-driven-progress-design\.md/);
    expect(SQL).toMatch(/2026-09-14-report-driven-progress-plan-b\.md/);
  });

  it('names its place in the paste order, after 103', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 103/);
  });

  it('names what a later re-paste of 098, 059 or 002 undoes', () => {
    expect(SQL).toMatch(/WHAT A LATER RE-PASTE OF AN OLDER FILE UNDOES/);
    for (const f of ['098', '059', '002', '036']) expect(SQL).toMatch(new RegExp(`--\\s+\\* ${f}:`));
  });

  it('says what makes a second paste safe and names this suite', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/migration104\.test\.ts/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting; writes nothing\)/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(12);
  });
});

describe('migration 104 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on the privileges grid', () => {
    expect(CODE.trimEnd()).toMatch(
      /SELECT proname, prosecdef, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname IN \([^)]*\)\s+ORDER BY proname;$/,
    );
  });
});

describe('migration 104 - a second paste cannot fail', () => {
  it('creates tables and indexes only when missing and drops no table or function', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS progress_claims \(/);
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS progress_claim_lines \(/);
    expect(CODE).not.toMatch(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(CODE).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(CODE).not.toMatch(/\bDROP\s+(?:TABLE|FUNCTION)\b/i);
  });

  it('defines every function with CREATE OR REPLACE', () => {
    const all = CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(CODE.match(/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/gi) ?? []).toHaveLength(all.length);
  });

  it('drops every policy and trigger before creating it', () => {
    for (const m of CODE.matchAll(/CREATE POLICY (\w+) ON (\w+)/g)) {
      const drop = CODE.indexOf(`DROP POLICY IF EXISTS ${m[1]} ON ${m[2]};`);
      expect({ policy: m[1], dropFirst: drop > -1 && drop < (m.index ?? 0) }).toEqual({ policy: m[1], dropFirst: true });
    }
    expect(CODE).toMatch(/DROP TRIGGER IF EXISTS boq_stage_weights_shape_lock_trg ON boq_stage_weights;\s+CREATE TRIGGER boq_stage_weights_shape_lock_trg/);
  });

  it('adds the progress_ai_runs foreign key only when it is missing', () => {
    expect(CODE).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'progress_ai_runs_claim_id_fkey'\) THEN/);
  });
});

describe('migration 104 - one claim in progress per project', () => {
  it('enforces it with a partial unique index', () => {
    expect(CODE).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS progress_claims_one_open\s+ON progress_claims \(project_id\) WHERE status IN \('DRAFT', 'SUBMITTED', 'RETURNED'\);/);
  });

  it('dates a claim by the WIB Monday of the week it opened', () => {
    expect(CODE).toMatch(/CONSTRAINT progress_claims_week_monday CHECK \(extract\(isodow FROM week_start\) = 1\)/);
    expect(fnBody('save_progress_claim_line')).toMatch(/v_week\s+DATE := date_trunc\('week', now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date;/);
  });

  it('requires a verifier and a time on every verified claim', () => {
    expect(CODE).toMatch(/CONSTRAINT progress_claims_verified_fields CHECK \(\(status = 'VERIFIED'\) = \(verified_by IS NOT NULL AND verified_at IS NOT NULL\)\)/);
  });
});

describe('migration 104 - the tables are read-only to the app', () => {
  it('has exactly two policies, both SELECT for members and office roles', () => {
    const policies = [...CODE.matchAll(/CREATE POLICY (\w+) ON (\w+)\s+FOR (\w+) TO authenticated\s+USING \(is_project_member\(project_id\) OR is_office_role\(\)\);/g)];
    expect(policies.map((m) => [m[1], m[2], m[3]])).toEqual([
      ['progress_claims_select', 'progress_claims', 'SELECT'],
      ['progress_claim_lines_select', 'progress_claim_lines', 'SELECT'],
    ]);
    expect(CODE.match(/\bCREATE POLICY\b/g) ?? []).toHaveLength(4);
  });
});

describe('migration 104 - the direct supervisor paths into progress close', () => {
  it('drops the supervisor insert policies of 002 and the boq_items progress policy of 059', () => {
    expect(CODE).toContain('DROP POLICY IF EXISTS "progress_entries_assigned_insert" ON progress_entries;');
    expect(CODE).toContain('DROP POLICY IF EXISTS "progress_photos_assigned_insert" ON progress_photos;');
    expect(CODE).toContain('DROP POLICY IF EXISTS "boq_items_assigned_progress_update" ON boq_items;');
  });

  it('turns 036 office access to progress entries and photos into read-only policies', () => {
    for (const t of ['progress_entries', 'progress_photos']) {
      expect(CODE).toContain(`DROP POLICY IF EXISTS ${t}_office_all ON ${t};`);
      expect(CODE).toMatch(new RegExp(`CREATE POLICY ${t}_office_read ON ${t}\\s+FOR SELECT TO authenticated\\s+USING \\(is_office_role\\(\\)\\);`));
    }
  });

  it('revokes sync_boq_progress from every client role', () => {
    expect(CODE).toContain("IF to_regprocedure('public.sync_boq_progress(uuid)') IS NOT NULL THEN");
    expect(CODE).toContain("EXECUTE 'REVOKE ALL ON FUNCTION public.sync_boq_progress(uuid) FROM PUBLIC, anon, authenticated';");
  });

  it('refuses any other change to installed or progress with a trigger only verification unlocks', () => {
    const guard = fnBody('boq_items_progress_single_writer');
    expect(guard).toContain("IF auth.uid() IS NULL OR current_setting('sano.progress_writer', true) IS NOT DISTINCT FROM 'verify' THEN");
    expect(guard).toContain('NEW.installed IS DISTINCT FROM OLD.installed OR NEW.progress IS DISTINCT FROM OLD.progress');
    expect(guard).toMatch(/RAISE EXCEPTION 'PROGRESS_SINGLE_WRITER:/);
    expect(CODE).toMatch(/DROP TRIGGER IF EXISTS boq_items_progress_single_writer_trg ON boq_items;\s+CREATE TRIGGER boq_items_progress_single_writer_trg\s+BEFORE INSERT OR UPDATE ON boq_items/);
    const verify = fnBody('verify_progress_claim');
    const unlock = verify.indexOf("PERFORM set_config('sano.progress_writer', 'verify', true);");
    expect(unlock).toBeGreaterThan(-1);
    expect(verify.indexOf('FOR v_line IN SELECT * FROM progress_claim_lines')).toBeGreaterThan(unlock);
    expect(verify.indexOf("PERFORM set_config('sano.progress_writer', '', true);")).toBeGreaterThan(verify.indexOf('END LOOP;'));
    const names = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]);
    expect(names.filter((n) => fnBody(n).includes("'sano.progress_writer', 'verify'"))).toEqual(['verify_progress_claim']);
    expect(CODE_103).not.toContain('sano.progress_writer');
  });

  it('lets a correction entry be negative but never zero', () => {
    expect(CODE).toMatch(/conrelid = 'public\.progress_entries'::regclass\s+AND con\.contype = 'c'\s+AND pg_get_constraintdef\(con\.oid\) ILIKE '%quantity%'/);
    expect(CODE).toContain('ADD CONSTRAINT progress_entries_quantity_nonzero CHECK (quantity <> 0);');
  });

  it('writes progress only inside verify_progress_claim, and 103 never does', () => {
    const names = [...CODE.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]);
    expect(names.filter((n) => /INSERT INTO progress_entries|UPDATE boq_items\b/.test(fnBody(n)))).toEqual(['verify_progress_claim']);
    expect(CODE_103).not.toMatch(/INSERT INTO progress_entries|UPDATE boq_items\b/);
  });
});

describe('migration 104 - each RPC', () => {
  it.each(Object.entries(RPCS))('%s is SECURITY DEFINER, pins search_path and checks the caller with its roles', (name, { roles }) => {
    const body = fnBody(name);
    expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(body).toMatch(new RegExp(`PERFORM progress_actor_role\\((?:p_project_id|v_claim\\.project_id), ${esc(roles)}\\);`));
  });

  it('locks the claim before reading its status', () => {
    for (const fn of ['submit_progress_claim', 'return_progress_claim', 'verify_progress_claim']) {
      const body = fnBody(fn);
      const lock = body.indexOf('SELECT * INTO v_claim FROM progress_claims WHERE id = p_claim_id FOR UPDATE;');
      expect(lock).toBeGreaterThan(-1);
      expect(body.indexOf('v_claim.status')).toBeGreaterThan(lock);
    }
    expect(fnBody('remove_progress_claim_line')).toContain('SELECT * INTO v_claim FROM progress_claims WHERE id = v_line.claim_id FOR UPDATE;');
    expect(fnBody('save_progress_claim_line')).toMatch(/WHERE project_id = p_project_id AND status IN \('DRAFT', 'SUBMITTED', 'RETURNED'\)\s+FOR UPDATE;/);
  });

  it('adds to a draft or returned claim only, and verifies or returns a submitted one only', () => {
    expect(fnBody('save_progress_claim_line')).toMatch(/IF v_claim\.status = 'SUBMITTED' THEN\s+RAISE EXCEPTION 'CLAIM_LOCKED:/);
    for (const fn of ['remove_progress_claim_line', 'submit_progress_claim']) {
      expect(fnBody(fn)).toMatch(/IF v_claim\.status NOT IN \('DRAFT', 'RETURNED'\) THEN\s+RAISE EXCEPTION 'CLAIM_STATE:/);
    }
    for (const fn of ['return_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toMatch(/IF v_claim\.status <> 'SUBMITTED' THEN\s+RAISE EXCEPTION 'CLAIM_STATE:/);
    }
  });

  it('refuses rows without weights or planned volume at save, submit and verify', () => {
    for (const fn of ['save_progress_claim_line', 'submit_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toMatch(/RAISE EXCEPTION 'CLAIM_NO_WEIGHTS:/);
      expect(fnBody(fn)).toMatch(/RAISE EXCEPTION 'CLAIM_NO_PLANNED:/);
    }
  });

  it('keeps photos inside the project progress folder, twelve at most', () => {
    const body = fnBody('save_progress_claim_line');
    expect(body).toContain("starts_with(r #>> '{}', 'progress/' || p_project_id::text || '/')");
    expect(body).toContain("position('..' IN r #>> '{}') > 0");
    expect(body).toContain('jsonb_array_length(v_refs) > 12');
  });

  it('needs a reason for any lower figure: a dropped stage at save, and a dropped stage or quantity at verify', () => {
    expect(fnBody('save_progress_claim_line')).toMatch(/IF v_reason IS NULL AND EXISTS \(/);
    const verify = fnBody('verify_progress_claim');
    expect(verify).toContain('v_needs_reason := v_regressed OR v_delta < 0;');
    expect(verify.indexOf('v_delta := v_after - v_before;')).toBeLessThan(verify.indexOf('v_needs_reason := v_regressed OR v_delta < 0;'));
    expect(verify).toMatch(/IF v_needs_reason AND v_reason IS NULL THEN\s+RAISE EXCEPTION 'CLAIM_REGRESS_REASON:/);
  });

  it('needs a note to return a claim', () => {
    expect(fnBody('return_progress_claim')).toMatch(/IF v_note IS NULL THEN\s+RAISE EXCEPTION 'CLAIM_RETURN_NOTE:/);
  });
});

describe('migration 104 - verification', () => {
  const body = fnBody('verify_progress_claim');

  it('never lets the submitter, or anyone who filled a line, verify', () => {
    expect(body).toMatch(/IF v_claim\.submitted_by = v_uid OR EXISTS \(\s+SELECT 1 FROM progress_claim_lines l\s+WHERE l\.claim_id = p_claim_id AND \(l\.created_by = v_uid OR l\.updated_by = v_uid\)\s+\) THEN\s+RAISE EXCEPTION 'CLAIM_SELF_VERIFY:/);
  });

  it('verifies every line of the claim exactly once', () => {
    expect(body).toContain('jsonb_array_length(p_lines) <> v_lines');
    expect(body).toContain("count(DISTINCT e ->> 'line_id')");
    expect(body).toMatch(/RAISE EXCEPTION 'CLAIM_LINES: daftar baris tidak cocok/);
  });

  it('locks each BoQ row before writing it', () => {
    expect(body).toContain('SELECT * INTO v_item FROM boq_items WHERE id = v_line.boq_item_id FOR UPDATE;');
  });

  it('writes the difference from the existing entries, so they always sum to installed', () => {
    expect(body).toContain('SELECT COALESCE(sum(quantity), 0) INTO v_before FROM progress_entries WHERE boq_item_id = v_item.id;');
    expect(body).toContain('v_after := round(v_item.planned * v_frac_new, 4);');
    expect(body).toContain('v_delta := v_after - v_before;');
    expect(body).toMatch(/IF v_delta <> 0 THEN\s+INSERT INTO progress_entries/);
    expect(body).toContain('UPDATE boq_items SET installed = v_after, progress = round(v_frac_new * 100, 1) WHERE id = v_item.id;');
  });

  it('credits the entry to the submitter and attaches the claim photos to increases only', () => {
    expect(body).toContain('v_claim.project_id, v_item.id, v_claim.submitted_by, v_delta, v_item.unit,');
    expect(body).toMatch(/IF v_delta > 0 THEN\s+INSERT INTO progress_photos/);
  });

  it('freezes the weights and records on the line what it wrote', () => {
    expect(body).toMatch(/weights_snapshot\s+= v_weights/);
    expect(body).toMatch(/installed_before\s+= v_before/);
    expect(body).toMatch(/delta_quantity\s+= v_delta/);
    expect(body).toMatch(/progress_entry_id = v_entry_id/);
  });

  it('keeps installed as it stood and logs a mismatch with the entries instead of overwriting it silently', () => {
    expect(CODE).toContain('  installed_cached_before NUMERIC,');
    expect(CODE).toContain('ALTER TABLE progress_claim_lines ADD COLUMN IF NOT EXISTS installed_cached_before NUMERIC;');
    expect(body).toContain('v_cached_before := v_item.installed;');
    expect(body).toMatch(/IF abs\(COALESCE\(v_cached_before, 0\) - v_before\) > 0\.0001 THEN\s+INSERT INTO activity_log/);
    expect(body).toMatch(/installed_cached_before = v_cached_before/);
  });

  it('uses the same percent math as tools/progressClaims/stageMath.ts', () => {
    const frac = fnBody('stage_row_fraction');
    expect(frac).toContain("/ sum((w.v #>> '{}')::numeric)");
    expect(frac).toContain(', 6)');
    expect(fnBody('stage_pct_valid')).toContain('BETWEEN 0 AND 100');
    expect(fnBody('stage_pct_round')).toContain("round((v #>> '{}')::numeric, 1)");
  });
});

describe('migration 104 - notifications', () => {
  it('builds on 098, the latest migration before 104 that swapped the type CHECK', () => {
    const swappers = FILES.filter((f) => Number(f.slice(0, 3)) < 104).filter((f) => read(f).includes('ADD CONSTRAINT notifications_type_check'));
    expect(swappers[swappers.length - 1]).toBe('098_daily_log_room_link.sql');
  });

  it('carries forward every type 098 allowed and adds exactly the three claim types', () => {
    const before = typeList(read('098_daily_log_room_link.sql'));
    expect(before).toHaveLength(13);
    expect(typeList(SQL)).toEqual([...before, ...CLAIM_TYPES]);
  });

  it('drops whichever type CHECK it replaces', () => {
    expect(CODE).toMatch(/conrelid = 'public\.notifications'::regclass\s+AND con\.contype = 'c'\s+AND pg_get_constraintdef\(con\.oid\) ILIKE '%type%'/);
  });

  it.each([
    ['submit_progress_claim', 'enqueue_notification(', "'PROGRESS_CLAIM_SUBMITTED'", "'ProgressClaimVerify',"],
    ['return_progress_claim', 'enqueue_notification_user(', "'PROGRESS_CLAIM_RETURNED'", "'ProgressClaim',"],
    ['verify_progress_claim', 'enqueue_notification_user(', "'PROGRESS_CLAIM_VERIFIED'", "'ProgressClaim',"],
  ])('%s enqueues inside a handler that cannot roll the claim back', (fn, call, type, screen) => {
    const body = fnBody(fn);
    const start = body.indexOf(`PERFORM ${call}`);
    const handler = body.search(new RegExp(`EXCEPTION WHEN OTHERS THEN\\s+RAISE WARNING '${fn}: notification failed: %', SQLERRM;`));
    expect(start).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(start);
    expect(body.slice(0, start).trimEnd().endsWith('BEGIN')).toBe(true);
    expect(body.slice(start, handler)).toContain(type);
    expect(body.slice(start, handler)).toContain(screen);
  });

  it('tells the estimators, or the admins when the project has none, and never the submitter', () => {
    const body = fnBody('submit_progress_claim');
    expect(body).toMatch(/p\.role = 'estimator' AND pa\.user_id <> v_uid\s+\) THEN 'estimator' ELSE 'admin' END;/);
    expect(body).toMatch(/v_uid,\s+-- p_exclude_user_id/);
  });

  it('tells the principals when nobody assigned can verify, and reports both counts', () => {
    const body = fnBody('submit_progress_claim');
    expect(body).toMatch(/IF v_verifiers = 0 THEN\s+PERFORM enqueue_notification\(/);
    expect(body).toMatch(/v_uid,\s+'principal'\s+\);/);
    expect(body).toMatch(/'notified', v_notified, 'verifiers_notified', v_verifiers/);
  });

  it('tells the submitter on return and verify, never the actor', () => {
    for (const fn of ['return_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toMatch(/v_claim\.submitted_by,[\s\S]*ARRAY\[v_uid\],\s+NULL\s+\);/);
    }
  });

  it('uses deeplinks the app declares, carrying the section each navigator reads', () => {
    expect(KNOWN_DEEPLINK_SCREENS).toEqual(expect.arrayContaining(['ProgressClaimVerify', 'ProgressClaim']));
    expect(fnBody('submit_progress_claim')).toContain("jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'initialSection', 'klaim')");
    for (const fn of ['return_progress_claim', 'verify_progress_claim']) {
      expect(fnBody(fn)).toContain("jsonb_build_object('projectId', v_claim.project_id, 'claimId', p_claim_id, 'module', 'progress', 'initialSection', 'klaim')");
    }
  });
});

describe('migration 104 - weights stay consistent with claims', () => {
  it('refuses to switch a claimed row between one and three stages', () => {
    const body = fnBody('boq_stage_weights_shape_lock');
    expect(body).toContain("(NEW.weights ? 'SINGLE') IS DISTINCT FROM (OLD.weights ? 'SINGLE')");
    expect(body).toMatch(/JOIN progress_claims c ON c\.id = l\.claim_id\s+WHERE l\.boq_item_id = NEW\.boq_item_id AND c\.status = 'VERIFIED'/);
    expect(body).toMatch(/RAISE EXCEPTION 'WEIGHTS_SHAPE_LOCKED:/);
    expect(CODE).toMatch(/CREATE TRIGGER boq_stage_weights_shape_lock_trg\s+BEFORE UPDATE OF weights ON boq_stage_weights/);
  });
});

describe('migration 104 - read views', () => {
  it.each(['progress_claim_latest_verified', 'progress_entry_totals'])("%s applies the caller's RLS and anon cannot read it", (view) => {
    expect(CODE).toMatch(new RegExp(`CREATE OR REPLACE VIEW ${view} WITH \\(security_invoker = on\\) AS`));
    expect(CODE).toMatch(new RegExp(`REVOKE ALL ON [^;]*\\b${view}\\b[^;]* FROM PUBLIC, anon;`));
    expect(CODE).toMatch(new RegExp(`GRANT SELECT ON [^;]*\\b${view}\\b[^;]* TO authenticated, service_role;`));
  });

  it('keeps one row per BoQ item, the newest verification first', () => {
    expect(CODE).toMatch(/SELECT DISTINCT ON \(l\.boq_item_id\)/);
    expect(CODE).toMatch(/ORDER BY l\.boq_item_id, c\.verified_at DESC, l\.updated_at DESC;/);
  });

  it('never creates a view without OR REPLACE', () => {
    expect(CODE).not.toMatch(/\bCREATE\s+VIEW\b/i);
  });
});

describe('migration 104 - privileges', () => {
  it.each([...Object.values(RPCS).map((r) => r.sig), ...HELPERS])('revokes %s from PUBLIC and anon, then grants authenticated and service_role', (sig) => {
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('keeps the internal lookup and the trigger function away from clients', () => {
    expect(CODE).toContain('REVOKE ALL ON FUNCTION latest_verified_stage_pct(UUID) FROM PUBLIC, anon, authenticated;');
    expect(CODE).toContain('REVOKE ALL ON FUNCTION boq_stage_weights_shape_lock() FROM PUBLIC, anon, authenticated;');
    expect(CODE).toContain('REVOKE ALL ON FUNCTION boq_items_progress_single_writer() FROM PUBLIC, anon, authenticated;');
    expect(CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION latest_verified_stage_pct\(UUID\) TO [^;]*authenticated/);
  });
});

describe('migration 104 - the app and the database agree', () => {
  const CLAIMS_TS = fs.readFileSync(path.join(ROOT, 'tools', 'progressClaims', 'claims.ts'), 'utf8');
  const sqlParams = (name: string, code: string): string[] => {
    const start = code.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    const header = code.slice(start, code.indexOf('RETURNS', start));
    return [...header.matchAll(/\b(p_\w+)\s+[A-Z]/g)].map((m) => m[1]).sort();
  };

  it('calls every claim and weight RPC with exactly the parameters the SQL declares', () => {
    const calls = [...CLAIMS_TS.matchAll(/callRpc(?:<[^>]+>)?\('(\w+)', \{([^}]*)\}/g)];
    expect(calls.map((m) => m[1]).sort()).toEqual(
      [...Object.keys(RPCS), 'reset_boq_stage_weights', 'seed_reference_stage_weights', 'set_boq_stage_weights'].sort(),
    );
    for (const [, name, args] of calls) {
      const code = name.includes('stage_weights') ? CODE_103 : CODE;
      expect({ name, params: [...args.matchAll(/\b(p_\w+):/g)].map((m) => m[1]).sort() }).toEqual({ name, params: sqlParams(name, code) });
    }
  });

  it('raises exactly the codes claimRules.ts explains, across 103 and 104', () => {
    const raised = [...new Set([...`${CODE_103}\n${CODE}`.matchAll(/RAISE EXCEPTION '([A-Z_]+):/g)].map((m) => m[1]))].sort();
    expect(raised).toEqual(CLAIM_RPC_ERROR_COPY.map(([code]) => code).sort());
  });
});

describe('migration 104 - nothing later reverts it', () => {
  it('no migration above 104 redefines a claim function', () => {
    const names = [...Object.keys(RPCS), 'stage_pct_valid', 'stage_pct_round', 'stage_row_fraction', 'zero_stage_pct', 'latest_verified_stage_pct', 'boq_stage_weights_shape_lock'];
    const re = new RegExp(`\\b(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+)FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?(?:${names.join('|')})\\b`, 'i');
    const later = FILES.filter((f) => Number(f.slice(0, 3)) > 104);
    expect(later.filter((f) => re.test(stripComments(read(f))))).toEqual([]);
  });

  it('a later swap of the notification type CHECK keeps the three claim types', () => {
    const later = FILES.filter((f) => Number(f.slice(0, 3)) > 104 && read(f).includes('ADD CONSTRAINT notifications_type_check'));
    for (const f of later) expect(typeList(read(f))).toEqual(expect.arrayContaining(CLAIM_TYPES));
  });
});
