/**
 * Static guard for migration 105 (closure evidence on "Selesai").
 *
 * Like the 099/100/104 suites this touches no database: migrations are pasted
 * into the Supabase Dashboard, so the SQL text IS the artifact under test.
 * Guards read CODE, the file with every full-line comment removed, so the
 * header or the self-check footer can never satisfy a guard the SQL fails.
 * Behaviour as real roles is rehearsed on Postgres by
 * supabase/tests/site_event_closure_rehearsal/run.sh.
 *
 *  • The paste stops unless the owner can read storage.objects past RLS;
 *    otherwise the rule would refuse every closure photo, silently.
 *  • 097's body is kept, refusal order included, so a queued close for an
 *    event someone else closed gets NOT_OPEN, never a photo refusal.
 *  • The photo rule joins storage.objects, so a row without a file is no proof.
 *  • Nothing later redefines close_site_event, which a re-paste of 105 would revert.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '105_close_site_event_evidence.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL); // comments can never satisfy a guard

const SIG = 'close_site_event(UUID, TEXT)';

function fnBody(): string {
  const start = CODE.indexOf('CREATE OR REPLACE FUNCTION close_site_event(');
  if (start < 0) throw new Error('close_site_event is not defined');
  const open = CODE.indexOf('$$', start);
  const close = CODE.indexOf('$$;', open + 2);
  return CODE.slice(start, close + 3);
}

describe('migration 105 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest-design\.md/);
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest\.md/);
  });

  it('names its place in the paste order, after 097, 098, 099 and 100', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 097, 098, 099 and 100\./);
  });

  it('says it is re-paste safe, and that re-pasting 097 reverts 100 and 105', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/Re-pasting 097 alone silently\s+-- reverts both 100 and 105/);
    expect(SQL).toMatch(/re-paste\s+-- 100 and then 105/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(7);
  });
});

describe('migration 105 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid that shows the outcome without reading a notice', () => {
    expect(CODE.trimEnd()).toMatch(/FROM pg_proc\s+WHERE proname = 'close_site_event';$/);
  });
});

describe('migration 105 - the paste precondition', () => {
  const doBlock = (): string => {
    const start = CODE.indexOf('DO $$');
    return CODE.slice(start, CODE.indexOf('END $$;', start) + 'END $$;'.length);
  };

  it('runs before the function is dropped or created', () => {
    const start = CODE.indexOf('DO $$');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(CODE.indexOf('DROP FUNCTION IF EXISTS close_site_event'));
  });

  it('checks the SELECT privilege and RLS bypass or ownership, each with its own message', () => {
    const block = doBlock();
    expect(block).toContain("has_table_privilege(current_user, 'storage.objects', 'SELECT')");
    expect(block).toMatch(/r\.rolsuper, r\.rolbypassrls/);
    expect(block).toContain("pg_has_role(current_user, v_owner, 'USAGE')");
    expect(block).toContain('relforcerowsecurity');
    expect(block).toContain("RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak punya hak SELECT pada storage.objects', current_user;");
    expect(block).toContain("RAISE EXCEPTION 'MIGRATION_105_PRECONDITION: % tidak bisa membaca storage.objects melewati RLS', current_user;");
  });

  it('never uses a SITE_EVENT_ code, so no app copy is ever expected for it', () => {
    expect(doBlock()).not.toMatch(/SITE_EVENT_/);
  });
});

describe('migration 105 - a second paste cannot fail', () => {
  it('drops the exact signature before creating, and grants after', () => {
    const drop = CODE.indexOf(`DROP FUNCTION IF EXISTS ${SIG};`);
    const create = CODE.indexOf('CREATE OR REPLACE FUNCTION close_site_event(');
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated, service_role;`);
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(revoke).toBeGreaterThan(create);
    expect(grant).toBeGreaterThan(revoke);
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? []).toHaveLength(1);
  });

  it('runs no DDL on any table, view, policy, trigger, index or type', () => {
    expect(CODE).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|POLICY|TRIGGER|INDEX|TYPE)\b/i);
  });
});

describe('migration 105 - close_site_event', () => {
  it('keeps the signature, SECURITY DEFINER and a pinned search_path', () => {
    expect(fnBody()).toMatch(/close_site_event\(\s*p_event_id\s+UUID,\s*p_closure_note\s+TEXT\s*\)\s*RETURNS JSONB/);
    expect(fnBody()).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });

  it('trims tabs and line breaks from the note, not only spaces', () => {
    expect(fnBody()).toContain("v_note TEXT := NULLIF(btrim(COALESCE(p_closure_note, ''), E' \\t\\r\\n'), '');");
  });

  it("keeps 097's lock and its four-column SET list", () => {
    expect(fnBody()).toContain('SELECT * INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;');
    expect(fnBody()).toMatch(/SET status = 'done', closed_at = now\(\), closed_by = v_uid, closure_note = v_note\s+WHERE id = p_event_id;/);
    expect(fnBody()).toContain("RETURN jsonb_build_object('event_id', p_event_id, 'status', 'done', 'closed_at', now());");
  });

  it('refuses in order: not found, auth twice, not open, note length, then the two evidence rules', () => {
    const codes = [...fnBody().matchAll(/RAISE EXCEPTION '(SITE_EVENT_\w+):/g)].map((m) => m[1]);
    expect(codes).toEqual([
      'SITE_EVENT_NOT_FOUND',
      'SITE_EVENT_AUTH',
      'SITE_EVENT_AUTH',
      'SITE_EVENT_NOT_OPEN',
      'SITE_EVENT_CLOSURE_NOTE',
      'SITE_EVENT_CLOSURE_PHOTO_REQUIRED',
      'SITE_EVENT_CLOSURE_NOTE_REQUIRED',
    ]);
  });

  it('refuses a session with no auth.uid() unless it is the service role', () => {
    expect(fnBody()).toMatch(/IF v_uid IS NULL AND COALESCE\(auth\.role\(\), ''\) <> 'service_role' THEN/);
  });

  it('asks for a closure photo on exactly cacat, isu and hambatan, and only one whose file exists', () => {
    const body = fnBody();
    expect(body).toContain("IF v_ev.event_type IN ('cacat', 'isu', 'hambatan') AND NOT EXISTS (");
    expect(body).toContain("JOIN storage.objects o ON o.bucket_id = 'site-media' AND o.name = m.storage_path");
    expect(body).toContain("WHERE m.event_id = p_event_id AND m.role = 'closure' AND m.kind = 'photo'");
  });

  it('asks a butuh_keputusan for ten characters of trimmed note', () => {
    expect(fnBody()).toContain("IF v_ev.event_type = 'butuh_keputusan' AND (v_note IS NULL OR char_length(v_note) < 10) THEN");
  });

  it('writes full Indonesian sentences an older app can show as they are', () => {
    expect(fnBody()).toContain(
      "'SITE_EVENT_CLOSURE_PHOTO_REQUIRED: kejadian % hanya bisa ditandai selesai dengan foto penutupan. Perbarui aplikasi, lalu ambil foto hasil perbaikan.'",
    );
    expect(fnBody()).toContain(
      "'SITE_EVENT_CLOSURE_NOTE_REQUIRED: kejadian butuh keputusan wajib punya catatan keputusan minimal 10 karakter.'",
    );
  });
});

describe('migration 105 - nothing later reverts it', () => {
  it('no migration above 105 redefines close_site_event', () => {
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 105);
    const touching = later.filter((f) =>
      /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?close_site_event\b/i.test(stripComments(read(f))),
    );
    expect(touching).toEqual([]);
  });

  it('names the signature this suite pins, so a changed one is a deliberate edit', () => {
    expect(SIG).toBe('close_site_event(UUID, TEXT)');
    expect(CODE).toContain(SIG);
  });
});
