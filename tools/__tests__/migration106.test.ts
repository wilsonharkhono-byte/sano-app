/**
 * Static guard for migration 106 (the morning attention digest).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so a comment can never satisfy a guard the SQL fails. Behaviour as
 * real roles (who gets which message, idempotence, RLS on the view and the
 * log, the scheduler with and without pg_cron) is rehearsed on Postgres by
 * supabase/tests/site_event_closure_rehearsal/run.sh.
 *
 *  • One predicate, one view, read by the digest and by the app.
 *  • A log row exists if and only if its notification landed, and a second
 *    run the same day sends nothing.
 *  • No app role can execute the digest.
 *  • The type CHECK keeps 104's sixteen types and adds exactly one.
 *  • The schedule is 07:00 WIB, Monday to Saturday, and a paste without
 *    pg_cron says so instead of failing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KNOWN_DEEPLINK_SCREENS } from '../notificationRouting';
import { WIB_MONTH_ABBR } from '../timeWindow';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '106_site_event_digest.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL);

const typeList = (sql: string): string[] => {
  const code = stripComments(sql);
  const at = code.lastIndexOf('ADD CONSTRAINT notifications_type_check');
  const block = code.slice(at, code.indexOf('));', at));
  return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
};

function fnBody(name: string): string {
  const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = CODE.indexOf('$$', start);
  const close = CODE.indexOf('$$;', open + 2);
  return CODE.slice(start, close + 3);
}

function viewText(name: string): string {
  const start = CODE.indexOf(`CREATE OR REPLACE VIEW ${name}`);
  if (start < 0) throw new Error(`${name} is not defined`);
  return CODE.slice(start, CODE.indexOf(';', start) + 1);
}

describe('migration 106 - header states why, paste order and what a re-paste undoes', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest-design\.md/);
    expect(SQL).toMatch(/2026-09-26-closure-evidence-and-digest\.md/);
  });

  it('pastes after 104 and 105, and says re-pasting 098 or 104 drops the digest type', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 104 and 105\./);
    expect(SQL).toMatch(/Re-pasting 098 or 104 after this\s+-- file re-creates the type CHECK without SITE_EVENT_DIGEST/);
    expect(SQL).toMatch(/Re-paste 106 after any re-paste of 098 or 104\./);
  });

  it('says it is re-paste safe and carries a self-check', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/SELF-CHECK/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(10);
  });
});

describe('migration 106 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('adds the blocking index with IF NOT EXISTS', () => {
    expect(CODE).toContain(
      "CREATE INDEX IF NOT EXISTS idx_site_events_blocking_open\n  ON site_events(project_id) WHERE status = 'open' AND is_blocking;",
    );
  });
});

describe('migration 106 - v_site_event_attention, the one predicate', () => {
  it('is dropped first and runs as the caller', () => {
    expect(CODE.indexOf('DROP VIEW IF EXISTS v_site_event_attention;')).toBeGreaterThan(-1);
    expect(CODE.indexOf('DROP VIEW IF EXISTS v_site_event_attention;')).toBeLessThan(CODE.indexOf('CREATE OR REPLACE VIEW v_site_event_attention'));
    expect(viewText('v_site_event_attention')).toContain('WITH (security_invoker = true)');
    expect(CODE).toContain('GRANT SELECT ON v_site_event_attention TO authenticated;');
  });

  it('counts open items past due on the Jakarta calendar, or blocking since before 00:00 WIB today', () => {
    const view = viewText('v_site_event_attention');
    expect(view).toContain("CROSS JOIN (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS today) t");
    expect(view).toMatch(
      /WHERE e\.status = 'open'\s+AND \(e\.due_date < t\.today\s+OR \(e\.is_blocking AND e\.confirmed_at < \(t\.today::timestamp AT TIME ZONE 'Asia\/Jakarta'\)\)\);/,
    );
    expect(view).toContain('COALESCE(e.due_date < t.today, FALSE) AS is_overdue');
    expect(view).toContain('CASE WHEN e.due_date < t.today THEN t.today - e.due_date ELSE 0 END AS days_overdue');
  });

  it('answers owner_on_project only where the reader can know it, NULL elsewhere', () => {
    const view = viewText('v_site_event_attention');
    expect(view).toContain('CASE WHEN e.owner_id IS NULL THEN FALSE');
    expect(view).toContain("WHEN current_user NOT IN ('authenticated', 'anon') OR is_office_role() OR e.owner_id = auth.uid()");
    expect(view).toMatch(/ELSE NULL END AS owner_on_project/);
  });
});

describe('migration 106 - the log and the health view', () => {
  it('creates the log with every column NOT NULL, the kind CHECK and the once-per-day key', () => {
    const start = CODE.indexOf('CREATE TABLE IF NOT EXISTS site_event_digest_log (');
    expect(start).toBeGreaterThan(-1);
    const table = CODE.slice(start, CODE.indexOf(');', start));
    for (const col of ['project_id', 'profile_id', 'run_date', 'kind', 'sent_at']) {
      expect(table).toMatch(new RegExp(`\\n\\s+${col}\\s+[A-Z]+[^\\n]*NOT NULL`));
    }
    expect(table).toContain("CHECK (kind IN ('owner', 'office'))");
    expect(table).toContain('CONSTRAINT site_event_digest_log_once UNIQUE (project_id, profile_id, run_date)');
  });

  it('turns RLS on with one office read policy and no write policy', () => {
    expect(CODE).toContain('ALTER TABLE site_event_digest_log ENABLE ROW LEVEL SECURITY;');
    const policies = [...CODE.matchAll(/CREATE POLICY (\w+) ON site_event_digest_log\s+FOR (\w+) USING \(([^;]*)\);/g)];
    expect(policies.map((m) => [m[1], m[2], m[3]])).toEqual([['site_event_digest_log_office_read', 'SELECT', 'is_office_role()']]);
    expect(CODE).not.toMatch(/CREATE POLICY[^;]*ON site_event_digest_log[^;]*FOR (?:INSERT|UPDATE|DELETE|ALL)/);
  });

  it('describes the scheduler, not a project: the latest run_date across all projects', () => {
    expect(CODE.indexOf('DROP VIEW IF EXISTS v_site_event_digest_health;')).toBeLessThan(CODE.indexOf('CREATE OR REPLACE VIEW v_site_event_digest_health'));
    const view = viewText('v_site_event_digest_health');
    expect(view).toContain('WITH (security_invoker = true)');
    expect(view).toContain('max(l.sent_at) AS last_sent_at');
    expect(view).toContain('count(DISTINCT l.profile_id)::int AS recipients');
    expect(view).toContain('WHERE l.run_date = (SELECT max(x.run_date) FROM site_event_digest_log x)');
  });
});

describe('migration 106 - enqueue_site_event_digests', () => {
  const body = () => fnBody('enqueue_site_event_digests');

  it('is SECURITY DEFINER with search_path pinned, dropped by signature first', () => {
    expect(CODE.indexOf('DROP FUNCTION IF EXISTS enqueue_site_event_digests(DATE);')).toBeLessThan(
      CODE.indexOf('CREATE OR REPLACE FUNCTION enqueue_site_event_digests('),
    );
    expect(body()).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(body()).toContain("p_run_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date");
  });

  it('is executable by no app role', () => {
    expect(CODE).toContain('REVOKE ALL ON FUNCTION enqueue_site_event_digests(DATE) FROM PUBLIC, anon, authenticated;');
    expect(CODE).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+enqueue_site_event_digests/i);
  });

  it('refuses any run date but the Jakarta date of now()', () => {
    expect(body()).toContain('IF p_run_date IS DISTINCT FROM v_today THEN');
    expect(body()).toMatch(/RAISE EXCEPTION 'DIGEST_RUN_DATE: tanggal kiriman harus hari ini \(WIB\)/);
  });

  it('digests only ACTIVE projects, office roles by membership, owners by membership', () => {
    expect(body()).toContain("WHERE p.status = 'ACTIVE'");
    expect(body()).toContain("WHERE pf.role IN ('admin', 'principal')");
    expect(body()).toContain('JOIN project_assignments pa ON pa.project_id = i.project_id AND pa.user_id = i.owner_id');
    expect(body()).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM office o WHERE o\.project_id = i\.project_id AND o\.profile_id = i\.owner_id\s+\)/);
  });

  it('logs first, once per day, and sends only when the log row is new', () => {
    expect(body()).toContain('ON CONFLICT (project_id, profile_id, run_date) DO NOTHING;');
    expect(body()).toContain('GET DIAGNOSTICS v_logged = ROW_COUNT;');
    expect(body()).toContain('IF v_logged > 0 THEN');
  });

  it('delivers through enqueue_notification_user, deeplinking to RoomBoard with the attention params', () => {
    expect(body()).toContain('PERFORM enqueue_notification_user(');
    expect(body()).toContain("'SITE_EVENT_DIGEST',");
    expect(body()).toContain("'RoomBoard',");
    expect(body()).toContain("jsonb_build_object('projectId', r.project_id, 'attention', true, 'mine', r.kind = 'owner')");
    expect(KNOWN_DEEPLINK_SCREENS).toContain('RoomBoard');
  });

  it('rolls a recipient back unless the notification landed in this transaction, and carries on', () => {
    expect(body()).toMatch(/n\.type = 'SITE_EVENT_DIGEST'\s+AND n\.created_at >= now\(\)/);
    expect(body()).toMatch(/RAISE EXCEPTION 'DIGEST_NOT_LANDED:/);
    expect(body()).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'enqueue_site_event_digests:/);
  });

  it('caps titles at 200 and bodies at 240 characters, and names the project code', () => {
    expect(body()).toContain("left(v_n || ' tugas lapangan perlu ditindak · ' || p.code, 200)");
    expect(body()).toContain('left(v_body, 240)');
  });

  it('writes the owner and office sentences of spec §5.4', () => {
    expect(body()).toContain("CASE WHEN v_a > 0 THEN v_a || ' lewat tenggat' END");
    expect(body()).toContain("CASE WHEN v_b > 0 THEN v_b || ' menghambat' END");
    expect(body()).toContain("' tanpa penanggung jawab.'");
    expect(body()).toContain("' milik Anda.'");
    expect(body()).toContain("' Terlama: '");
    expect(body()).toContain("' (tenggat '");
    expect(body()).toContain("' (menghambat sejak '");
  });

  it('never raises a SITE_EVENT_ code, which no client could map', () => {
    expect(CODE).not.toMatch(/RAISE EXCEPTION 'SITE_EVENT_/);
  });
});

describe('migration 106 - the day label', () => {
  it('is STABLE, not IMMUTABLE, because to_char is STABLE', () => {
    const fn = fnBody('site_event_digest_day');
    expect(fn).toMatch(/LANGUAGE sql\s+STABLE/);
    expect(fn).not.toMatch(/IMMUTABLE/);
    expect(fn).toContain("to_char(d, 'FMDD')");
  });

  it("spells the months exactly as the app's formatWibShort does", () => {
    const fn = fnBody('site_event_digest_day');
    const months = [...(fn.match(/ARRAY\[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(months).toEqual([...WIB_MONTH_ABBR]);
  });
});

describe('migration 106 - notifications.type', () => {
  it("keeps 104's sixteen types and adds exactly SITE_EVENT_DIGEST", () => {
    const before = typeList(read('104_progress_claims.sql'));
    const after = typeList(SQL);
    expect(before).toHaveLength(16);
    for (const t of before) expect(after).toContain(t);
    expect(after.filter((t) => !before.includes(t))).toEqual(['SITE_EVENT_DIGEST']);
  });

  it('widens by shape: every CHECK mentioning type is dropped before the add', () => {
    expect(CODE).toContain("AND pg_get_constraintdef(con.oid) ILIKE '%type%'");
    expect(CODE).toContain("AND con.contype = 'c'");
    expect(CODE.indexOf("EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);")).toBeLessThan(
      CODE.indexOf('ADD CONSTRAINT notifications_type_check'),
    );
  });
});

describe('migration 106 - scheduler', () => {
  const cronBlock = (): string => {
    const start = CODE.indexOf("IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN");
    return CODE.slice(start, CODE.indexOf('END $$;', start));
  };

  it('schedules only when pg_cron exists, unscheduling the old job first', () => {
    const block = cronBlock();
    expect(block).toContain("IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'site_event_digest') THEN");
    expect(block).toContain("PERFORM cron.unschedule('site_event_digest');");
    expect(block.indexOf('cron.unschedule')).toBeLessThan(block.indexOf('cron.schedule('));
    expect(block).toContain("PERFORM cron.schedule('site_event_digest', '0 0 * * 1-6',");
    expect(block).toContain('$cmd$SELECT public.enqueue_site_event_digests()$cmd$');
  });

  it('tells the person pasting how to turn Cron on when it is off', () => {
    expect(cronBlock()).toMatch(/RAISE NOTICE '106: pg_cron belum aktif\. Aktifkan Cron di Dashboard \(Integrations → Cron\), lalu paste 106 lagi\./);
  });

  it('is the last thing that changes anything before RESET', () => {
    expect(CODE.indexOf('PERFORM cron.schedule(')).toBeLessThan(CODE.indexOf('RESET lock_timeout;'));
  });
});
