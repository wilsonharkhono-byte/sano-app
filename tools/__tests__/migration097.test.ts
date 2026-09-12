/**
 * Static guard for migration 097 (site events, media, AI runs, confirm RPC,
 * room board, private media bucket).
 *
 * Like 092/095/096 this touches no database: migrations are pasted into the
 * Supabase Dashboard, so the SQL text is the artifact under test. Guards on the
 * SQL read CODE, the file with every full-line comment removed, so the header
 * or the self-check footer can never satisfy a guard the SQL itself fails.
 *
 * The spec's truth contract (§1.1) is enforced here in SQL, so each assertion
 * protects a rule a later tidy-up could quietly undo:
 *
 *  • AI and bookkeeping columns are service-role only, on INSERT as well as
 *    UPDATE (an insert policy would otherwise let a client pre-fill ai_draft).
 *    Both branches are pinned column by column, as an exact set: a dropped
 *    column is a hole, not a smaller list.
 *  • Human fields change only inside confirm_site_event / close_site_event: a
 *    direct PostgREST write may only correct the transcript or discard. The
 *    guard's shape is pinned too - one bypass, three RETURNs - because the
 *    app's own role IS 'authenticated', so a single extra early return for it
 *    would disable the whole rule while every column assertion still passed.
 *  • An open actionable event always has an owner and a due date.
 *  • A step is keyed through its gate (composite foreign key plus a CHECK),
 *    so an event can never carry a step from another gate.
 *  • A confirmed VO always has a Catatan Perubahan row behind it, raised by the
 *    event's own reporter, and only when a quote survived validation.
 *  • Nothing is deletable: no DELETE policy anywhere, discard is a status.
 *  • The VO change_type regex uses the SAME keywords as siteEventRules.ts.
 *  • Media is private: bucket public = false, no public URL path, no update or
 *    delete policy on the objects. Each storage policy is asserted separately,
 *    because a file-wide match lets one policy vouch for the other.
 *  • The board's overdue count uses the same Jakarta date the RPC validates
 *    against, or the board disagrees with the form that accepted the item.
 *  • 096's paste-ergonomics pattern carries over: SET/RESET lock_timeout
 *    bracket every statement, the view is dropped before it is recreated, and
 *    each RPC is dropped by full signature before CREATE OR REPLACE so a future
 *    signature change cannot leave a granted overload behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VO_DESIGN_KEYWORDS, VO_OWNER_REQUEST_KEYWORDS } from '../siteEventRules';
import { DRAFT_SUMMARY_MAX, DRAFT_TITLE_MAX, SITE_EVENT_TYPE_CODES } from '../siteEventDraftValidate';
import { ACTIONABLE_EVENT_TYPES, SITE_MEDIA_BUCKET } from '../constants';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '097_site_events.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL); // comments can never satisfy a guard

const HELPERS = ['is_office_role()', 'is_project_member(p_project_id UUID)'];

/** A named function's body as defined by this migration's code. */
function fnBody(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`);
  const m = CODE.match(re);
  if (!m) throw new Error(`${name} not found in 097`);
  return m[0];
}

/**
 * 096's comparator, so the two inlined helpers can be compared with 096's
 * copies byte for byte. Throws, naming the file, on a definition it cannot
 * read: an unreadable helper must fail the suite, never drop out of a
 * comparison.
 */
function fnText(src: string, sig: string, file: string): string | null {
  const name = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
  const heads = [...src.matchAll(new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}`, 'gi'))];
  if (heads.length === 0) return null;
  const head = heads[heads.length - 1];
  const afterHead = head.index! + head[0].length;
  const open = src.indexOf('$$', afterHead);
  const close = open < 0 ? -1 : src.indexOf('$$', open + 2);
  if (close < 0 || src.slice(close - 1, close + 3) !== '\n$$;') {
    throw new Error(`${file} defines ${sig}, but its body does not close on a "$$;" line, so it cannot be compared with 096's copy`);
  }
  return `CREATE OR REPLACE FUNCTION ${sig}${src.slice(afterHead, close + 3)}`.replace(/\s+/g, ' ');
}

/** The CREATE TABLE statement for one table. */
function tableDdl(name: string): string {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`);
  const m = CODE.match(re);
  if (!m) throw new Error(`table ${name} not found in 097`);
  return m[0];
}

/**
 * One policy statement, from CREATE POLICY to its closing semicolon. No policy
 * body in this file contains a semicolon, so the first one ends the statement.
 */
function policyBody(name: string): string {
  const m = CODE.match(new RegExp(`CREATE POLICY "?${name}"?[\\s\\S]*?;`));
  if (!m) throw new Error(`policy ${name} not found in 097`);
  return m[0];
}

/** The slice of src between two markers, both of which must exist. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0) throw new Error(`marker not found: ${from}`);
  if (b < 0) throw new Error(`marker not found: ${to}`);
  return src.slice(a, b);
}

/** Every column the text guards with NEW.x IS DISTINCT FROM OLD.x, sorted. */
const guardedColumns = (src: string): string[] =>
  [...src.matchAll(/NEW\.(\w+) IS DISTINCT FROM OLD\.\1\b/g)].map((m) => m[1]).sort();

const quoteList = (values: ReadonlyArray<string>) => values.map((v) => `'${v}'`).join(', ');

describe('migration 097 - header', () => {
  it('links the spec and states the paste order', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/096.*097.*098/s);
  });

  it('states re-paste safety and records why media gets its own private bucket', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/WHY A NEW BUCKET/);
    expect(SQL).toMatch(/photos/);
  });

  it('tells the reader a refused bucket INSERT rolls the whole paste back', () => {
    // The Dashboard runs the paste as ONE transaction. A self-check that implies
    // "some of it landed, fix the bucket and re-run" would send a reader looking
    // for objects that are not there.
    expect(SQL).toMatch(/ONE transaction, so nothing in this file landed/);
  });
});

describe("migration 097 - paste ergonomics (096's lock_timeout pattern)", () => {
  it("sets lock_timeout = '5s' before the first CREATE, and resets it exactly once after the last DDL statement", () => {
    const setIdx = CODE.indexOf("SET lock_timeout = '5s';");
    const resetIdx = CODE.indexOf('RESET lock_timeout;');
    const firstCreateIdx = CODE.indexOf('CREATE OR REPLACE FUNCTION is_office_role');
    const lastGrantIdx = CODE.indexOf('GRANT SELECT ON v_room_board TO authenticated;');

    expect(setIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(-1);
    // Exactly one RESET: a second would mean some DDL below the first is
    // running without the timeout guard.
    expect(CODE.indexOf('RESET lock_timeout;', resetIdx + 1)).toBe(-1);
    expect(setIdx).toBeLessThan(firstCreateIdx);
    expect(resetIdx).toBeGreaterThan(lastGrantIdx);
  });
});

describe('migration 097 §1 - site_events', () => {
  const ddl = () => tableDdl('site_events');

  it('takes a client-generated id with no default', () => {
    expect(ddl()).toMatch(/\n\s+id\s+UUID PRIMARY KEY,/);
    expect(ddl()).not.toMatch(/id\s+UUID PRIMARY KEY DEFAULT/);
  });

  it('anchors every event to a project, a room and a reporter', () => {
    expect(ddl()).toMatch(/project_id\s+UUID NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/);
    expect(ddl()).toMatch(/room_id\s+UUID NOT NULL REFERENCES rooms\(id\)/);
    expect(ddl()).toMatch(/reporter_id\s+UUID NOT NULL REFERENCES profiles\(id\)/);
  });

  it('constrains status, event_type, confidence and vo_flag', () => {
    expect(ddl()).toContain(`CHECK (status IN ('pending_analysis', 'draft', 'open', 'done', 'discarded'))`);
    expect(ddl()).toContain(`CHECK (event_type IS NULL OR event_type IN (${quoteList(SITE_EVENT_TYPE_CODES)}))`);
    expect(ddl()).toContain(`CHECK (ai_confidence IS NULL OR ai_confidence IN ('high', 'medium', 'low'))`);
    expect(ddl()).toContain(`CHECK (vo_flag IN ('none', 'suggested', 'confirmed', 'rejected'))`);
  });

  it('keys the gate, the VO change row and related events by foreign key', () => {
    expect(ddl()).toMatch(/gate_code\s+TEXT REFERENCES gate_refs\(code\),/);
    expect(ddl()).toMatch(/site_change_id\s+UUID REFERENCES site_changes\(id\)/);
    expect(ddl()).toMatch(/related_event_id\s+UUID REFERENCES site_events\(id\)/);
  });

  it('keys a step through its gate, so an event can never carry a step from another gate', () => {
    // A single-column step_code key would accept ('B', 'D1'). 096 makes
    // (gate_code, code) UNIQUE on gate_step_refs and a step's gate immutable.
    expect(ddl()).toMatch(/\n\s+step_code\s+TEXT,\n/);
    expect(CODE).not.toMatch(/step_code\s+TEXT\s+REFERENCES/);
    expect(CODE).not.toMatch(/REFERENCES gate_step_refs\s*\(\s*code\s*\)/);
    expect(ddl()).toContain('CONSTRAINT site_events_step_needs_gate CHECK (step_code IS NULL OR gate_code IS NOT NULL)');
    expect(ddl()).toMatch(
      /CONSTRAINT site_events_step_in_gate FOREIGN KEY \(gate_code, step_code\)\s+REFERENCES gate_step_refs \(gate_code, code\)\n/,
    );
    // The default MATCH SIMPLE is what lets a gate-only event through; MATCH FULL would refuse it.
    expect(ddl()).not.toMatch(/MATCH FULL/);
  });

  it('limits title and summary to the validator constants', () => {
    expect(ddl()).toContain(`CHECK (title IS NULL OR char_length(title) <= ${DRAFT_TITLE_MAX})`);
    expect(ddl()).toContain(`CHECK (summary IS NULL OR char_length(summary) <= ${DRAFT_SUMMARY_MAX})`);
  });

  it('keeps captured_at without a default and created_at with one', () => {
    expect(ddl()).toMatch(/captured_at\s+TIMESTAMPTZ NOT NULL,/);
    expect(ddl()).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  });

  it('creates the three spec indexes idempotently', () => {
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS idx_site_events_project_room_status\s+ON site_events\(project_id, room_id, status\)/);
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS idx_site_events_project_due_open\s+ON site_events\(project_id, due_date\) WHERE status = 'open'/);
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS idx_site_events_owner_open\s+ON site_events\(owner_id\) WHERE status = 'open'/);
  });
});

describe('migration 097 §2 - site_event_media', () => {
  const ddl = () => tableDdl('site_event_media');

  it('cascades from the event and constrains kind and role', () => {
    expect(ddl()).toMatch(/event_id\s+UUID NOT NULL REFERENCES site_events\(id\) ON DELETE CASCADE/);
    expect(ddl()).toContain(`CHECK (kind IN ('photo', 'audio', 'video'))`);
    expect(ddl()).toContain(`CHECK (role IN ('context', 'closeup', 'closure', 'audio'))`);
    expect(ddl()).toMatch(/storage_path\s+TEXT NOT NULL/);
  });

  it('keeps audio and the audio role together', () => {
    expect(ddl()).toContain(`CHECK ((kind = 'audio') = (role = 'audio'))`);
  });

  it('refuses a media row whose path is outside its own event folder', () => {
    const body = fnBody('site_event_media_path_guard');
    // The project comes from the EVENT, never from the path being checked: a
    // path that names its own project would authorise itself.
    expect(body).toMatch(/SELECT project_id INTO v_project_id FROM site_events WHERE id = NEW\.event_id;/);
    expect(body).not.toMatch(/v_project_id\s*:=/);
    expect(body).toMatch(/'site-events\/' \|\| v_project_id::text \|\| '\/' \|\| NEW\.event_id::text \|\| '\/'/);
    // A prefix test, not a substring test: position()/strpos()/LIKE '%..%' would
    // accept another event's folder reached through a '../' style path.
    expect(body).toMatch(/IF left\(NEW\.storage_path, char_length\(v_prefix\)\) <> v_prefix THEN/);
    expect(body).not.toMatch(/\bposition\s*\(|\bstrpos\s*\(|\bLIKE\b/i);
    expect(body).toMatch(/SITE_EVENT_MEDIA_PATH:/);
  });
});

describe('migration 097 §3 - site_event_ai_runs', () => {
  const ddl = () => tableDdl('site_event_ai_runs');

  it('mirrors ai_draft_runs with a stage and a status', () => {
    expect(ddl()).toMatch(/id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(ddl()).toContain(`CHECK (stage IN ('transcribe', 'analyze'))`);
    expect(ddl()).toContain(`CHECK (status IN ('ok', 'rejected', 'error'))`);
    expect(ddl()).toMatch(/input_summary\s+JSONB NOT NULL/);
    for (const col of ['tokens_in', 'tokens_out', 'cost_usd', 'latency_ms', 'prompt_hash', 'output', 'error']) {
      expect(ddl()).toMatch(new RegExp(`\\n\\s+${col}\\s`));
    }
  });
});

describe('migration 097 §4 - guards', () => {
  it('AI and bookkeeping columns are service-role only, on INSERT and UPDATE', () => {
    const body = fnBody('site_events_ai_columns_service_only');
    expect(body).toMatch(/auth\.role\(\)/);
    expect(body).toMatch(/'service_role'/);
    expect(body).toMatch(/SITE_EVENT_AI_COLUMNS:/);
    expect(body).not.toMatch(/transcript_edited/);

    // UPDATE branch: the exact set, so a dropped column fails rather than
    // shrinking the list quietly.
    const upd = between(body, 'NEW.ai_draft IS DISTINCT FROM OLD.ai_draft', 'SITE_EVENT_AI_COLUMNS: kolom hasil AI hanya boleh diubah');
    expect(guardedColumns(upd)).toEqual([
      'ai_confidence', 'ai_draft', 'ai_mismatch', 'ai_model', 'analysis_attempts', 'last_error', 'transcript',
    ]);
  });

  it('the AI guard closes the INSERT hole column by column', () => {
    // A member may insert an event, so an INSERT arriving with ai_draft already
    // filled in is exactly what this branch exists to refuse. Asserting only
    // "IF TG_OP = 'INSERT' THEN" lets any single column fall out of the list.
    const ins = between(
      fnBody('site_events_ai_columns_service_only'),
      "IF TG_OP = 'INSERT' THEN",
      'SITE_EVENT_AI_COLUMNS: kolom hasil AI hanya boleh diisi',
    );
    for (const test of [
      'NEW.transcript IS NOT NULL',
      'NEW.ai_draft IS NOT NULL',
      'NEW.ai_confidence IS NOT NULL',
      'NEW.ai_model IS NOT NULL',
      'NEW.ai_mismatch IS DISTINCT FROM FALSE',
      'NEW.last_error IS NOT NULL',
      'NEW.analysis_attempts IS DISTINCT FROM 0',
    ]) {
      expect(ins).toContain(test);
    }
    // Seven columns and nothing else reading NEW in that branch.
    expect(ins.match(/NEW\.\w+/g) ?? []).toHaveLength(7);
  });

  it('the human-fields guard has one bypass and no other early exit', () => {
    const body = fnBody('site_events_human_fields_rpc_only');
    // PostgREST runs as 'authenticated', which is exactly the role this guard
    // exists to restrain. One extra `IF current_user = 'authenticated' THEN
    // RETURN NEW` would disable rule 2 outright while every column assertion
    // below still passed, so the shape is pinned: the bypass opens the body,
    // current_user appears once, and there are three RETURNs (bypass, INSERT
    // branch, UPDATE branch).
    expect(body).toMatch(/AS \$\$\s+BEGIN\s+IF current_user NOT IN \('authenticated', 'anon'\) THEN\s+RETURN NEW;\s+END IF;/);
    expect(body.match(/current_user/g) ?? []).toHaveLength(1);
    expect(body.match(/\bRETURN\b/g) ?? []).toHaveLength(3);
  });

  it('a fresh insert may carry only room, gate, note and capture time', () => {
    const ins = between(
      fnBody('site_events_human_fields_rpc_only'),
      "IF TG_OP = 'INSERT' THEN",
      'SITE_EVENT_HUMAN_FIELDS: kiriman baru',
    );
    for (const test of [
      "NEW.status <> 'pending_analysis'",
      'NEW.reporter_id IS DISTINCT FROM auth.uid()',
      'NEW.event_type IS NOT NULL',
      'NEW.step_code IS NOT NULL',
      'NEW.title IS NOT NULL',
      'NEW.summary IS NOT NULL',
      'NEW.owner_id IS NOT NULL',
      'NEW.due_date IS NOT NULL',
      'NEW.downstream_impact IS NOT NULL',
      'NEW.is_blocking',
      "NEW.vo_flag <> 'none'",
      'NEW.site_change_id IS NOT NULL',
      'NEW.related_event_id IS NOT NULL',
      'NEW.confirmed_at IS NOT NULL',
      'NEW.closed_at IS NOT NULL',
      'NEW.closed_by IS NOT NULL',
      'NEW.closure_note IS NOT NULL',
      'NEW.transcript_edited IS NOT NULL',
      'NEW.ai_used IS DISTINCT FROM TRUE',
    ]) {
      expect(ins).toContain(test);
    }
  });

  it('human fields change only through the SECURITY DEFINER RPCs', () => {
    const body = fnBody('site_events_human_fields_rpc_only');
    // The whole list, as a set. id is in it: an event's primary key reaches
    // media paths, the notification and the Catatan Perubahan text, so
    // renumbering a row would orphan all three.
    const upd = between(body, 'IF NEW.id IS DISTINCT FROM OLD.id', 'SITE_EVENT_HUMAN_FIELDS: isi kejadian');
    expect(guardedColumns(upd)).toEqual([
      'ai_used', 'captured_at', 'closed_at', 'closed_by', 'closure_note', 'confirmed_at', 'created_at',
      'downstream_impact', 'due_date', 'event_type', 'gate_code', 'id', 'is_blocking', 'owner_id',
      'project_id', 'raw_text', 'related_event_id', 'reporter_id', 'room_id', 'site_change_id',
      'step_code', 'summary', 'title', 'vo_flag',
    ]);
    expect(body).toMatch(/SITE_EVENT_HUMAN_FIELDS:/);
  });

  it('lets a client correct the transcript only before confirmation, and discard only a draft', () => {
    const body = fnBody('site_events_human_fields_rpc_only');
    expect(body).toMatch(
      /IF NEW\.transcript_edited IS DISTINCT FROM OLD\.transcript_edited\s+AND OLD\.status NOT IN \('pending_analysis', 'draft'\) THEN\s+RAISE EXCEPTION 'SITE_EVENT_HUMAN_FIELDS: transkrip hanya bisa dikoreksi sebelum konfirmasi'/,
    );
    expect(body).toMatch(
      /IF NEW\.status IS DISTINCT FROM OLD\.status\s+AND NOT \(OLD\.status IN \('pending_analysis', 'draft'\) AND NEW\.status = 'discarded'\) THEN\s+RAISE EXCEPTION 'SITE_EVENT_HUMAN_FIELDS: status hanya bisa diubah ke dibuang sebelum konfirmasi'/,
    );
  });

  it('an open actionable event must have an owner and a due date', () => {
    const body = fnBody('site_events_actionable_needs_owner');
    expect(body).toMatch(/NEW\.status = 'open'/);
    expect(body).toContain(`NEW.event_type IN (${quoteList(ACTIONABLE_EVENT_TYPES)})`);
    expect(body).toMatch(/NEW\.owner_id IS NULL OR NEW\.due_date IS NULL/);
    expect(body).toMatch(/SITE_EVENT_OWNER_REQUIRED:/);
  });

  it('a confirmed VO must have a Catatan Perubahan row', () => {
    const body = fnBody('site_events_vo_needs_change');
    expect(body).toMatch(/NEW\.vo_flag = 'confirmed' AND NEW\.site_change_id IS NULL/);
    expect(body).toMatch(/SITE_EVENT_VO_WITHOUT_CHANGE:/);
  });

  it('every guard runs BEFORE the write, on INSERT and UPDATE alike', () => {
    // AFTER would let the refused value land first (and, for the path guard,
    // be read by the service role in between); INSERT-only would let an UPDATE
    // walk a row past the same rule.
    const trg = [...CODE.matchAll(/CREATE TRIGGER (\w+)\s+([A-Z][A-Z ]*[A-Z]) ON (\w+)\s+FOR EACH ROW EXECUTE FUNCTION (\w+)\(\);/g)]
      .map((m) => `${m[1]} | ${m[2]} ON ${m[3]} | ${m[4]}`)
      .sort();
    expect(trg).toEqual([
      'site_event_media_path_guard_trg | BEFORE INSERT OR UPDATE ON site_event_media | site_event_media_path_guard',
      'site_events_actionable_needs_owner_trg | BEFORE INSERT OR UPDATE ON site_events | site_events_actionable_needs_owner',
      'site_events_ai_columns_service_only_trg | BEFORE INSERT OR UPDATE ON site_events | site_events_ai_columns_service_only',
      'site_events_human_fields_rpc_only_trg | BEFORE INSERT OR UPDATE ON site_events | site_events_human_fields_rpc_only',
      'site_events_vo_needs_change_trg | BEFORE INSERT OR UPDATE ON site_events | site_events_vo_needs_change',
    ]);
    // Counted anywhere on a line too, so a trigger written in another shape
    // cannot hide from the list above.
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b/gi) ?? []).toHaveLength(trg.length);
  });

  it('drops every trigger exactly once, BEFORE its CREATE', () => {
    const creates = [...CODE.matchAll(/^[ \t]*CREATE TRIGGER (\w+)\s[^;]*?\bON\s+(\w+)/gm)];
    expect(creates).toHaveLength(5);
    for (const c of creates) {
      const d = [...CODE.matchAll(new RegExp(`^[ \\t]*DROP TRIGGER IF EXISTS ${c[1]} ON ${c[2]};`, 'gm'))];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });
});

describe('migration 097 §5 - RLS', () => {
  it('enables RLS on all three tables', () => {
    for (const t of ['site_events', 'site_event_media', 'site_event_ai_runs']) {
      expect(CODE).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
  });

  it('site_events has exactly three policies, and the update policy keeps its WITH CHECK', () => {
    // Without WITH CHECK an update could move a row into a project the writer
    // cannot see. The set is exact, so a fourth policy under any name fails.
    const p = [...CODE.matchAll(/^CREATE POLICY "?(\w+)"? ON (?:public\.)?site_events\s+FOR (\w+) ([^;]*);/gm)]
      .map((m) => `${m[1]}|${m[2]}|${m[3].replace(/\s+/g, ' ').trim()}`)
      .sort();
    expect(p).toEqual([
      'site_events_insert|INSERT|WITH CHECK ((is_project_member(project_id) OR is_office_role()) AND reporter_id = auth.uid())',
      'site_events_select|SELECT|USING (is_project_member(project_id) OR is_office_role())',
      'site_events_update|UPDATE|USING (is_project_member(project_id) OR is_office_role()) WITH CHECK (is_project_member(project_id) OR is_office_role())',
    ]);
  });

  it('gives media read and insert only, both scoped through the event\'s project', () => {
    for (const name of ['site_event_media_select', 'site_event_media_insert']) {
      expect(policyBody(name)).toMatch(
        /EXISTS \(\s*SELECT 1 FROM site_events e\s+WHERE e\.id = site_event_media\.event_id\s+AND \(is_project_member\(e\.project_id\) OR is_office_role\(\)\)\s*\)/,
      );
    }
    expect(policyBody('site_event_media_select')).toMatch(/FOR SELECT USING \(/);
    expect(policyBody('site_event_media_insert')).toMatch(/FOR INSERT WITH CHECK \(/);
    expect(CODE).not.toMatch(/CREATE POLICY \w+ ON site_event_media\s+FOR UPDATE/);
  });

  it('lets office roles and the reporter read AI runs, and nobody but the service role insert them', () => {
    expect(CODE).toMatch(/CREATE POLICY site_event_ai_runs_select ON site_event_ai_runs\s+FOR SELECT USING \(\s*is_office_role\(\)\s+OR EXISTS/);
    expect(CODE).not.toMatch(/CREATE POLICY \w+ ON site_event_ai_runs\s+FOR (INSERT|UPDATE|ALL)/);
  });

  it('has no DELETE policy anywhere (spec §1.1 rule 3)', () => {
    expect(CODE).not.toMatch(/FOR DELETE/);
    expect(CODE).not.toMatch(/FOR ALL/);
  });

  it('drops every policy exactly once, BEFORE its CREATE', () => {
    const creates = [...CODE.matchAll(/^CREATE POLICY "?(\w+)"? ON (?:public\.|storage\.)?(\w+)/gm)];
    expect(creates.length).toBeGreaterThanOrEqual(8);
    for (const c of creates) {
      const d = [
        ...CODE.matchAll(new RegExp(`^DROP POLICY IF EXISTS "?${c[1]}"?\\s+ON\\s+(?:public\\.|storage\\.)?${c[2]}\\s*;`, 'gm')),
      ];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });
});

describe('migration 097 §6 - private media bucket', () => {
  it('uses the same bucket name as the app', () => {
    expect(SITE_MEDIA_BUCKET).toBe('site-media');
  });

  it('creates site-media as a private bucket, re-paste safe', () => {
    expect(CODE).toMatch(/INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
    expect(CODE).toMatch(/'site-media',\s*'site-media',\s*false,/);
    // All three settings are re-asserted on conflict. Leaving `public` out
    // would let a Dashboard flip to public survive every future re-paste, and
    // the file says it owns that setting.
    expect(CODE).toMatch(
      /ON CONFLICT \(id\) DO UPDATE\s+SET\s+public = EXCLUDED\.public,\s+file_size_limit = EXCLUDED\.file_size_limit,\s+allowed_mime_types = EXCLUDED\.allowed_mime_types;/,
    );
  });

  it('accepts every media type the app records, web WebM audio included', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'video/mp4']) {
      expect(CODE).toContain(`'${mime}'`);
    }
  });

  it('scopes EACH object policy to the bucket, the prefix and the caller\'s projects', () => {
    // Asserted per policy, not file-wide: one policy carrying the bucket scope
    // would otherwise vouch for the other, and an unscoped INSERT policy hands
    // authenticated users write access to every bucket on the project.
    for (const [name, cmd, clause] of [
      ['site_media_select', 'SELECT', 'USING'],
      ['site_media_insert', 'INSERT', 'WITH CHECK'],
    ] as const) {
      const p = policyBody(name);
      expect(p).toMatch(new RegExp(`ON storage\\.objects\\s+FOR ${cmd}\\s+TO authenticated\\s+${clause} \\(`));
      expect(p).toContain(`bucket_id = 'site-media'`);
      expect(p).toContain(`split_part(name, '/', 1) = 'site-events'`);
      // Segment 2 is the project id: PostgREST's object name excludes the
      // bucket, so site-events/{projectId}/... puts it there (tools/storage.ts).
      expect(p).toMatch(
        /public\.is_office_role\(\)\s+OR EXISTS \(\s*SELECT 1 FROM public\.project_assignments pa\s+WHERE pa\.project_id::text = split_part\(storage\.objects\.name, '\/', 2\)\s+AND pa\.user_id = auth\.uid\(\)\s*\)/,
      );
    }
    expect(CODE).not.toMatch(/ON storage\.objects\s+FOR (UPDATE|DELETE)/);
  });
});

describe('migration 097 §7 - confirm_site_event', () => {
  const body = () => fnBody('confirm_site_event');
  const SIGNATURE = 'UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT';
  /** The notification block, from its IF to the function's RETURN. */
  const notifyBlock = () => between(body(), 'IF p_owner_id IS NOT NULL AND p_owner_id <> v_ev.reporter_id', 'RETURN jsonb_build_object');

  it('has the spec signature, in order', () => {
    expect(body()).toMatch(
      /confirm_site_event\(\s*p_event_id\s+UUID,\s*p_event_type\s+TEXT,\s*p_gate_code\s+TEXT,\s*p_step_code\s+TEXT,\s*p_title\s+TEXT,\s*p_summary\s+TEXT,\s*p_owner_id\s+UUID,\s*p_due_date\s+DATE,\s*p_downstream_impact\s+TEXT,\s*p_is_blocking\s+BOOLEAN,\s*p_vo_confirm\s+BOOLEAN,\s*p_related_event_id\s+UUID,\s*p_transcript_edited\s+TEXT\s*\)\s*RETURNS JSONB/,
    );
  });

  it('is SECURITY DEFINER with a pinned search_path, and executable only by authenticated and service_role', () => {
    expect(body()).toMatch(/SECURITY DEFINER/);
    expect(body()).toMatch(/SET search_path = public/);
    expect(CODE).toContain(`REVOKE ALL ON FUNCTION confirm_site_event(${SIGNATURE}) FROM PUBLIC, anon;`);
    expect(CODE).toContain(`GRANT EXECUTE ON FUNCTION confirm_site_event(${SIGNATURE}) TO authenticated, service_role;`);
  });

  it('drops its own signature first, so a signature change cannot leave a granted overload', () => {
    // 092's pattern. CREATE OR REPLACE cannot change a parameter list, so
    // without the DROP the old function would survive alongside the new one,
    // still callable and still carrying the GRANT below.
    const drop = CODE.indexOf(`DROP FUNCTION IF EXISTS confirm_site_event(\n  ${SIGNATURE}\n);`);
    const create = CODE.indexOf('CREATE OR REPLACE FUNCTION confirm_site_event(');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
    // A DROP takes the function's privileges with it, so the grants come after.
    expect(CODE.indexOf('REVOKE ALL ON FUNCTION confirm_site_event')).toBeGreaterThan(create);
    expect(CODE.indexOf('GRANT EXECUTE ON FUNCTION confirm_site_event')).toBeGreaterThan(create);
  });

  it('locks the row and refuses a non-member', () => {
    expect(body()).toMatch(/SELECT \* INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;/);
    expect(body()).toMatch(/NOT \(is_project_member\(v_ev\.project_id\) OR is_office_role\(\)\)/);
  });

  it('confirms only a draft, or a pending event authored by hand', () => {
    expect(body()).toMatch(/v_ev\.status NOT IN \('pending_analysis', 'draft'\)/);
    expect(body()).toMatch(/v_ai_used\s*:=\s*v_ev\.ai_draft IS NOT NULL/);
  });

  it('re-checks the confirm rules the form checks', () => {
    expect(body()).toMatch(/char_length\(v_title\) > 80/);
    expect(body()).toMatch(/char_length\(v_summary\) > 300/);
    expect(body()).toMatch(/gate_step_refs/);
    expect(body()).toMatch(/project_assignments[\s\S]{0,120}p_owner_id/);
    expect(body()).toMatch(/Asia\/Jakarta/);
  });

  it('accepts a related event only from the same project', () => {
    expect(body()).toMatch(
      /p_related_event_id = p_event_id\s+OR NOT EXISTS \(\s*SELECT 1 FROM site_events WHERE id = p_related_event_id AND project_id = v_ev\.project_id\s*\)/,
    );
    expect(body()).toMatch(/SITE_EVENT_RELATED:/);
  });

  it('names a step outside the chosen gate before the composite key refuses it', () => {
    const b = body();
    expect(b).toMatch(/IF p_step_code IS NOT NULL AND p_gate_code IS NULL THEN\s+RAISE EXCEPTION 'SITE_EVENT_STEP_NOT_IN_GATE:/);
    expect(b).toMatch(
      /SELECT gate_code INTO v_step_gate FROM gate_step_refs WHERE code = p_step_code AND active;\s+IF NOT FOUND THEN\s+RAISE EXCEPTION 'SITE_EVENT_STEP:/,
    );
    expect(b).toMatch(/IF v_step_gate <> p_gate_code THEN\s+RAISE EXCEPTION 'SITE_EVENT_STEP_NOT_IN_GATE: langkah "%" bukan bagian dari gerbang %\./);
    expect(b.lastIndexOf('SITE_EVENT_STEP_NOT_IN_GATE:')).toBeLessThan(b.indexOf('UPDATE site_events SET'));
  });

  it('refuses a VO confirm when no quote survived validation', () => {
    // The type is decided in its own IF, before any length is taken:
    // jsonb_array_length raises a raw Postgres error on a JSON scalar (a draft
    // carrying "evidence_quotes": null, say), which would reach the client with
    // no SITE_EVENT_ prefix for tools/siteEvents.ts to translate - and SQL does
    // not promise to evaluate the arms of an OR left to right.
    const b = body();
    expect(b).toMatch(/v_quotes := v_ev\.ai_draft -> 'vo' -> 'evidence_quotes';/);
    expect(b).toMatch(
      /IF COALESCE\(v_ev\.ai_draft -> 'vo' ->> 'flag', 'none'\) <> 'suggested'\s+OR v_quotes IS NULL\s+OR jsonb_typeof\(v_quotes\) <> 'array' THEN\s+RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE:/,
    );
    expect(b).toMatch(/IF jsonb_array_length\(v_quotes\) = 0 THEN\s+RAISE EXCEPTION 'SITE_EVENT_VO_NO_EVIDENCE:/);
    expect(b.indexOf('jsonb_typeof(v_quotes)')).toBeLessThan(b.indexOf('jsonb_array_length(v_quotes)'));
  });

  it('maps change_type with the same keywords as siteEventRules.ts', () => {
    expect(body()).toContain(`v_evidence ~ '(${VO_OWNER_REQUEST_KEYWORDS.join('|')})'`);
    expect(body()).toContain(`v_evidence ~ '(${VO_DESIGN_KEYWORDS.join('|')})'`);
    expect(body()).toMatch(/p_event_type = 'butuh_keputusan' AND v_evidence ~/);
    expect(body()).toMatch(/regexp_replace\(lower\(/);
    expect(body()).toMatch(/'permintaan_owner'[\s\S]*'revisi_desain'[\s\S]*'kondisi_lapangan'/);
  });

  it('hands a confirmed VO to Catatan Perubahan as a pending row with private photo paths', () => {
    expect(body()).toMatch(/INSERT INTO site_changes\s*\(/);
    expect(body()).toMatch(/'pending'/);
    expect(body()).toMatch(/needs_owner_approval/);
    expect(body()).toMatch(/'site-media:' \|\| m\.storage_path/);
    expect(body()).toMatch(/v_room\.room_name/);
    // reported_by is the EVENT's reporter, not whoever pressed Konfirmasi: the
    // Catatan Perubahan review credits the person who saw the thing on site.
    expect(body()).toMatch(/'pending',\s+v_ev\.reporter_id\s*\)\s+RETURNING id INTO v_change_id;/);
  });

  it('records rejected only when a VO was actually suggested', () => {
    expect(body()).toMatch(/WHEN p_vo_confirm THEN 'confirmed'\s+WHEN COALESCE\(v_ev\.ai_draft -> 'vo' ->> 'flag', 'none'\) = 'suggested' THEN 'rejected'\s+ELSE 'none'/);
  });

  it('opens the event and never writes an AI or bookkeeping column', () => {
    expect(body()).toMatch(/status\s*=\s*'open'/);
    expect(body()).toMatch(/confirmed_at\s*=\s*now\(\)/);
    for (const col of ['ai_draft', 'transcript', 'ai_confidence', 'ai_model', 'ai_mismatch', 'last_error', 'analysis_attempts']) {
      expect(body()).not.toMatch(new RegExp(`\\b${col}\\s*=[^=]`));
    }
  });

  it('notifies a different owner, wrapped so a failure never rolls back the confirm', () => {
    const blk = notifyBlock();
    expect(body()).toMatch(/p_owner_id IS NOT NULL AND p_owner_id <> v_ev\.reporter_id/);
    // The enqueue sits INSIDE the block that catches for it. Outside, a CHECK
    // violation on notifications.type (098 not yet pasted) would take the whole
    // confirm down with it.
    expect(blk).toMatch(/THEN\s+BEGIN\s+PERFORM enqueue_notification_user\(\s*v_ev\.project_id,\s*p_owner_id,\s*'SITE_EVENT_ASSIGNED'/);
    expect(blk).toMatch(/'SiteEventDetail'/);
    expect(blk).toMatch(/jsonb_build_object\('eventId', p_event_id, 'projectId', v_ev\.project_id\)/);
    // The actor is excluded, so confirming for yourself never pings you.
    expect(blk).toMatch(/p_event_id,\s+ARRAY\[v_uid\]\s*\);/);
    expect(blk).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'confirm_site_event: notification failed: %', SQLERRM;\s+v_notified := FALSE;\s+END;/);
  });

  it('reports notified from what actually landed, in this transaction', () => {
    // enqueue_notification_user inserts zero rows for a non-member and raises
    // nothing, so an assumed TRUE would be a lie in exactly the case that
    // matters. The time bound keeps a row from an earlier confirm of the same
    // event to the same owner from being counted as this call's.
    const blk = notifyBlock();
    expect(blk).toMatch(
      /v_notified := EXISTS \(\s*SELECT 1 FROM notifications n\s+WHERE n\.related_entity_id = p_event_id\s+AND n\.recipient_user_id = p_owner_id\s+AND n\.type = 'SITE_EVENT_ASSIGNED'\s+AND n\.created_at >= now\(\)\s*\);/,
    );
    expect(blk.indexOf('BEGIN')).toBeLessThan(blk.indexOf('v_notified := EXISTS'));
    expect(blk.indexOf('v_notified := EXISTS')).toBeLessThan(blk.indexOf('EXCEPTION WHEN OTHERS'));
    expect(body()).not.toMatch(/v_notified\s*:=\s*TRUE/);
    expect(body()).toMatch(/v_notified\s+BOOLEAN := FALSE;/);
    expect(body()).toMatch(/'notified', v_notified/);
  });

  it('raises every documented prefix', () => {
    for (const code of [
      'SITE_EVENT_NOT_FOUND', 'SITE_EVENT_AUTH', 'SITE_EVENT_STATE', 'SITE_EVENT_TYPE', 'SITE_EVENT_TITLE',
      'SITE_EVENT_SUMMARY', 'SITE_EVENT_IMPACT', 'SITE_EVENT_GATE', 'SITE_EVENT_STEP', 'SITE_EVENT_STEP_NOT_IN_GATE',
      'SITE_EVENT_OWNER_REQUIRED', 'SITE_EVENT_OWNER_NOT_MEMBER', 'SITE_EVENT_DUE', 'SITE_EVENT_RELATED',
      'SITE_EVENT_VO_NO_EVIDENCE',
    ]) {
      expect(body()).toContain(`'${code}:`);
    }
  });
});

describe('migration 097 §8 - close_site_event', () => {
  const body = () => fnBody('close_site_event');

  it('is SECURITY DEFINER, pinned, dropped by signature first, and granted like confirm', () => {
    expect(body()).toMatch(/close_site_event\(\s*p_event_id\s+UUID,\s*p_closure_note\s+TEXT\s*\)\s*RETURNS JSONB/);
    expect(body()).toMatch(/SECURITY DEFINER/);
    expect(body()).toMatch(/SET search_path = public/);
    const drop = CODE.indexOf('DROP FUNCTION IF EXISTS close_site_event(UUID, TEXT);');
    const create = CODE.indexOf('CREATE OR REPLACE FUNCTION close_site_event(');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
    expect(CODE).toContain('REVOKE ALL ON FUNCTION close_site_event(UUID, TEXT) FROM PUBLIC, anon;');
    expect(CODE).toContain('GRANT EXECUTE ON FUNCTION close_site_event(UUID, TEXT) TO authenticated, service_role;');
    expect(CODE.indexOf('GRANT EXECUTE ON FUNCTION close_site_event')).toBeGreaterThan(create);
  });

  it('locks the row and refuses a non-member, exactly as confirm does', () => {
    // "Selesai" is the other writer of human fields. Without the lock two taps
    // race; without the membership check anyone with the event id can close it.
    expect(body()).toMatch(/SELECT \* INTO v_ev FROM site_events WHERE id = p_event_id FOR UPDATE;/);
    expect(body()).toMatch(
      /IF v_uid IS NOT NULL AND NOT \(is_project_member\(v_ev\.project_id\) OR is_office_role\(\)\) THEN\s+RAISE EXCEPTION 'SITE_EVENT_AUTH:/,
    );
    expect(body()).toMatch(/IF v_uid IS NULL AND COALESCE\(auth\.role\(\), ''\) <> 'service_role' THEN/);
  });

  it('closes only an open event and writes nothing but the four closure columns', () => {
    const b = body();
    expect(b).toMatch(/v_ev\.status <> 'open'/);
    expect(b).toMatch(/SITE_EVENT_NOT_OPEN:/);
    expect(b).toMatch(/char_length\(v_note\) > 500/);
    expect(b).toMatch(/SITE_EVENT_CLOSURE_NOTE:/);
    // The SET list, exactly: an AI or bookkeeping column added here would be
    // written by a SECURITY DEFINER function the guards deliberately let past.
    expect(between(b, 'UPDATE site_events', 'WHERE id = p_event_id;').replace(/\s+/g, ' ').trim()).toBe(
      "UPDATE site_events SET status = 'done', closed_at = now(), closed_by = v_uid, closure_note = v_note",
    );
  });
});

describe('migration 097 §9 - v_room_board', () => {
  const view = () => CODE.slice(CODE.indexOf('CREATE OR REPLACE VIEW v_room_board'));

  it('is a security_invoker view readable by authenticated users', () => {
    expect(CODE).toMatch(/CREATE OR REPLACE VIEW v_room_board\s+WITH \(security_invoker = true\) AS/);
    expect(CODE).toMatch(/GRANT SELECT ON v_room_board TO authenticated;/);
  });

  it('drops the view before recreating it, so a future column-list change cannot be refused on re-paste', () => {
    const dropIdx = CODE.indexOf('DROP VIEW IF EXISTS v_room_board;');
    const createIdx = CODE.indexOf('CREATE OR REPLACE VIEW v_room_board');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('carries every column the board and the capture screen read', () => {
    for (const col of [
      'open_progres', 'open_isu', 'open_hambatan', 'open_cacat', 'open_butuh_keputusan', 'open_info',
      'overdue_count', 'last_event_at', 'last_gate_code', 'last_step_code', 'is_quiet', 'owner_initials',
    ]) {
      expect(view()).toMatch(new RegExp(`AS ${col}\\b`));
    }
    expect(view()).toMatch(/interval '3 days'/);
  });

  it('counts open events only, and calls overdue by the same Jakarta date the RPC uses', () => {
    // Counting done/discarded rows would make a finished room look busy; a UTC
    // current_date would disagree with confirm_site_event, which floors a due
    // date at the Jakarta date, for the first seven hours of every WIB day.
    expect(view()).toMatch(/FROM site_events e\s+WHERE e\.status = 'open'\s+GROUP BY e\.room_id/);
    expect(view()).toMatch(/count\(\*\) FILTER \(WHERE e\.due_date < \(now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date\)\s+AS n_overdue/);
    expect(view()).not.toMatch(/due_date < current_date/);
  });
});

describe('migration 097 §10 - self-contained helpers', () => {
  it('inlines is_office_role and is_project_member the way 050/051/096 do', () => {
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION is_office_role\(\)/);
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION is_project_member\(p_project_id UUID\)/);
  });

  it('defines both helpers byte-identically with 096, and grants them to authenticated only', () => {
    // These two decide app-wide policy, and 097 re-pastes them with CREATE OR
    // REPLACE. A widened role list or a dropped SECURITY DEFINER here would
    // silently change 050/051/096's policies on the next paste of THIS file.
    const other = stripComments(fs.readFileSync(path.join(MIGRATIONS, '096_rooms_gates_phase.sql'), 'utf8'));
    for (const sig of HELPERS) {
      expect(fnText(CODE, sig, FILE)).toBe(fnText(other, sig, '096_rooms_gates_phase.sql'));
    }
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION is_office_role\(\) TO authenticated;/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION is_project_member\(UUID\) TO authenticated;/);
    // Nothing in this file is granted to anon, helpers, RPCs and view alike.
    expect(CODE).not.toMatch(/GRANT[^;]*\banon\b/);
  });

  it('pins search_path on every function it defines', () => {
    const fns = CODE.match(/CREATE OR REPLACE FUNCTION [\s\S]*?\n\$\$;/g) ?? [];
    expect(fns.length).toBe(9);
    for (const fn of fns) expect(fn).toMatch(/SET search_path = public/);
  });
});
