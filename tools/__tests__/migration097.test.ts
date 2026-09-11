/**
 * Static guard for migration 097 (site events, media, AI runs, confirm RPC,
 * room board, private media bucket).
 *
 * Like 092/095/096 this touches no database: migrations are pasted into the
 * Supabase Dashboard, so the SQL text is the artifact under test. The spec's
 * truth contract (§1.1) is enforced here in SQL, so each assertion protects a
 * rule a later tidy-up could quietly undo:
 *
 *  • AI and bookkeeping columns are service-role only, on INSERT as well as
 *    UPDATE (an insert policy would otherwise let a client pre-fill ai_draft).
 *  • Human fields change only inside confirm_site_event / close_site_event:
 *    a direct PostgREST write may only correct the transcript or discard.
 *  • An open actionable event always has an owner and a due date.
 *  • A step is keyed through its gate (composite foreign key plus a CHECK),
 *    so an event can never carry a step from another gate.
 *  • A confirmed VO always has a Catatan Perubahan row behind it.
 *  • Nothing is deletable: no DELETE policy anywhere, discard is a status.
 *  • The VO change_type regex uses the SAME keywords as siteEventRules.ts.
 *  • Media is private: bucket public = false, no public URL path, no update
 *    or delete policy on the objects.
 *  • 096's paste-ergonomics pattern carries over: SET/RESET lock_timeout
 *    bracket every statement, and the view is dropped before it is recreated
 *    so a future column-list change cannot be refused on re-paste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VO_DESIGN_KEYWORDS, VO_OWNER_REQUEST_KEYWORDS } from '../siteEventRules';
import { DRAFT_SUMMARY_MAX, DRAFT_TITLE_MAX, SITE_EVENT_TYPE_CODES } from '../siteEventDraftValidate';
import { ACTIONABLE_EVENT_TYPES, SITE_MEDIA_BUCKET } from '../constants';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '097_site_events.sql'), 'utf8');

/** A named function's body as defined by this migration's text. */
function fnBody(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`);
  const m = SQL.match(re);
  if (!m) throw new Error(`${name} not found in 097`);
  return m[0];
}

/** The CREATE TABLE statement for one table. */
function tableDdl(name: string): string {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`);
  const m = SQL.match(re);
  if (!m) throw new Error(`table ${name} not found in 097`);
  return m[0];
}

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
});

describe('migration 097 - paste ergonomics (096\'s lock_timeout pattern)', () => {
  it("sets lock_timeout = '5s' before the first CREATE, and resets it exactly once after the last DDL statement", () => {
    const setIdx = SQL.indexOf("SET lock_timeout = '5s';");
    const resetIdx = SQL.indexOf('RESET lock_timeout;');
    const firstCreateIdx = SQL.indexOf('CREATE OR REPLACE FUNCTION is_office_role');
    const lastGrantIdx = SQL.indexOf('GRANT SELECT ON v_room_board TO authenticated;');

    expect(setIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(-1);
    // Exactly one RESET: a second would mean some DDL below the first is
    // running without the timeout guard.
    expect(SQL.indexOf('RESET lock_timeout;', resetIdx + 1)).toBe(-1);
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
    expect(SQL).not.toMatch(/step_code\s+TEXT\s+REFERENCES/);
    expect(SQL).not.toMatch(/REFERENCES gate_step_refs\s*\(\s*code\s*\)/);
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
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_site_events_project_room_status\s+ON site_events\(project_id, room_id, status\)/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_site_events_project_due_open\s+ON site_events\(project_id, due_date\) WHERE status = 'open'/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_site_events_owner_open\s+ON site_events\(owner_id\) WHERE status = 'open'/);
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
    expect(body).toMatch(/'site-events\/' \|\| v_project_id::text \|\| '\/' \|\| NEW\.event_id::text \|\| '\/'/);
    expect(body).toMatch(/SITE_EVENT_MEDIA_PATH:/);
    expect(SQL).toMatch(/CREATE TRIGGER site_event_media_path_guard_trg\s+BEFORE INSERT OR UPDATE ON site_event_media/);
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
    for (const col of ['ai_draft', 'transcript', 'ai_confidence', 'ai_model', 'ai_mismatch', 'last_error', 'analysis_attempts']) {
      expect(body).toMatch(new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}\\b`));
    }
    expect(body).not.toMatch(/transcript_edited/);
    expect(body).toMatch(/IF TG_OP = 'INSERT' THEN/);
    expect(body).toMatch(/SITE_EVENT_AI_COLUMNS:/);
    expect(SQL).toMatch(/CREATE TRIGGER site_events_ai_columns_service_only_trg\s+BEFORE INSERT OR UPDATE ON site_events/);
  });

  it('human fields change only through the SECURITY DEFINER RPCs', () => {
    const body = fnBody('site_events_human_fields_rpc_only');
    expect(body).toMatch(/current_user NOT IN \('authenticated', 'anon'\)/);
    expect(body).toMatch(/NEW\.status <> 'pending_analysis'/);
    expect(body).toMatch(/NEW\.reporter_id IS DISTINCT FROM auth\.uid\(\)/);
    for (const col of ['event_type', 'title', 'summary', 'owner_id', 'due_date', 'is_blocking', 'vo_flag', 'site_change_id', 'confirmed_at', 'closed_at', 'ai_used']) {
      expect(body).toMatch(new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}\\b`));
    }
    expect(body).toMatch(/OLD\.status IN \('pending_analysis', 'draft'\) AND NEW\.status = 'discarded'/);
    expect(body).toMatch(/SITE_EVENT_HUMAN_FIELDS:/);
    expect(SQL).toMatch(/CREATE TRIGGER site_events_human_fields_rpc_only_trg\s+BEFORE INSERT OR UPDATE ON site_events/);
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

  it('drops every trigger before creating it', () => {
    const creates = SQL.match(/CREATE TRIGGER (\w+)/g) ?? [];
    expect(creates.length).toBe(5);
    for (const c of creates) {
      const name = c.replace('CREATE TRIGGER ', '');
      expect(SQL).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${name} ON`));
    }
  });
});

describe('migration 097 §5 - RLS', () => {
  it('enables RLS on all three tables', () => {
    for (const t of ['site_events', 'site_event_media', 'site_event_ai_runs']) {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
  });

  it('lets members and office roles read, insert and update events; the inserter must be the reporter', () => {
    expect(SQL).toMatch(/CREATE POLICY site_events_select ON site_events\s+FOR SELECT USING \(is_project_member\(project_id\) OR is_office_role\(\)\)/);
    expect(SQL).toMatch(/CREATE POLICY site_events_insert ON site_events\s+FOR INSERT WITH CHECK \(\(is_project_member\(project_id\) OR is_office_role\(\)\) AND reporter_id = auth\.uid\(\)\)/);
    expect(SQL).toMatch(/CREATE POLICY site_events_update ON site_events\s+FOR UPDATE USING \(is_project_member\(project_id\) OR is_office_role\(\)\)/);
  });

  it('gives media read and insert only; evidence rows are never edited', () => {
    expect(SQL).toMatch(/CREATE POLICY site_event_media_select ON site_event_media\s+FOR SELECT/);
    expect(SQL).toMatch(/CREATE POLICY site_event_media_insert ON site_event_media\s+FOR INSERT/);
    expect(SQL).not.toMatch(/CREATE POLICY \w+ ON site_event_media\s+FOR UPDATE/);
  });

  it('lets office roles and the reporter read AI runs, and nobody but the service role insert them', () => {
    expect(SQL).toMatch(/CREATE POLICY site_event_ai_runs_select ON site_event_ai_runs\s+FOR SELECT USING \(\s*is_office_role\(\)\s+OR EXISTS/);
    expect(SQL).not.toMatch(/CREATE POLICY \w+ ON site_event_ai_runs\s+FOR (INSERT|UPDATE|ALL)/);
  });

  it('has no DELETE policy anywhere (spec §1.1 rule 3)', () => {
    expect(SQL).not.toMatch(/FOR DELETE/);
    expect(SQL).not.toMatch(/FOR ALL/);
  });

  it('drops every policy before creating it', () => {
    const creates = SQL.match(/CREATE POLICY "?(\w+)"?/g) ?? [];
    expect(creates.length).toBeGreaterThanOrEqual(8);
    for (const c of creates) {
      const name = c.replace(/CREATE POLICY "?/, '').replace(/"$/, '');
      expect(SQL).toMatch(new RegExp(`DROP POLICY IF EXISTS "?${name}"?\\s+ON`));
    }
  });
});

describe('migration 097 §6 - private media bucket', () => {
  it('uses the same bucket name as the app', () => {
    expect(SITE_MEDIA_BUCKET).toBe('site-media');
  });

  it('creates site-media as a private bucket, re-paste safe', () => {
    expect(SQL).toMatch(/INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/);
    expect(SQL).toMatch(/'site-media',\s*'site-media',\s*false,/);
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
  });

  it('accepts every media type the app records, web WebM audio included', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'video/mp4']) {
      expect(SQL).toContain(`'${mime}'`);
    }
  });

  it('scopes object read and insert to project members by path, and grants nothing else', () => {
    expect(SQL).toMatch(/CREATE POLICY "site_media_select" ON storage\.objects\s+FOR SELECT\s+TO authenticated/);
    expect(SQL).toMatch(/CREATE POLICY "site_media_insert" ON storage\.objects\s+FOR INSERT\s+TO authenticated/);
    expect(SQL).toMatch(/bucket_id = 'site-media'/);
    expect(SQL).toMatch(/split_part\(name, '\/', 1\) = 'site-events'/);
    expect(SQL).toMatch(/pa\.project_id::text = split_part\(storage\.objects\.name, '\/', 2\)/);
    expect(SQL).not.toMatch(/ON storage\.objects\s+FOR (UPDATE|DELETE)/);
  });
});

describe('migration 097 §7 - confirm_site_event', () => {
  const body = () => fnBody('confirm_site_event');
  const SIGNATURE = 'UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, BOOLEAN, BOOLEAN, UUID, TEXT';

  it('has the spec signature, in order', () => {
    expect(body()).toMatch(
      /confirm_site_event\(\s*p_event_id\s+UUID,\s*p_event_type\s+TEXT,\s*p_gate_code\s+TEXT,\s*p_step_code\s+TEXT,\s*p_title\s+TEXT,\s*p_summary\s+TEXT,\s*p_owner_id\s+UUID,\s*p_due_date\s+DATE,\s*p_downstream_impact\s+TEXT,\s*p_is_blocking\s+BOOLEAN,\s*p_vo_confirm\s+BOOLEAN,\s*p_related_event_id\s+UUID,\s*p_transcript_edited\s+TEXT\s*\)\s*RETURNS JSONB/,
    );
  });

  it('is SECURITY DEFINER with a pinned search_path, and executable only by authenticated and service_role', () => {
    expect(body()).toMatch(/SECURITY DEFINER/);
    expect(body()).toMatch(/SET search_path = public/);
    expect(SQL).toContain(`REVOKE ALL ON FUNCTION confirm_site_event(${SIGNATURE}) FROM PUBLIC, anon;`);
    expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION confirm_site_event(${SIGNATURE}) TO authenticated, service_role;`);
  });

  it('locks the row and refuses a non-member', () => {
    expect(body()).toMatch(/FROM site_events WHERE id = p_event_id FOR UPDATE/);
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
    // The type test sits in its own IF, before the length test: SQL may
    // evaluate the arms of an OR in any order, and jsonb_array_length on a
    // JSON scalar raises a raw Postgres error with no SITE_EVENT_ prefix.
    expect(body()).toMatch(/v_quotes := v_ev\.ai_draft -> 'vo' -> 'evidence_quotes';/);
    expect(body()).toMatch(/v_quotes IS NULL\s+OR jsonb_typeof\(v_quotes\) <> 'array' THEN/);
    expect(body()).toMatch(/IF jsonb_array_length\(v_quotes\) = 0 THEN/);
    expect(body()).toMatch(/SITE_EVENT_VO_NO_EVIDENCE:/);
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
    expect(body()).toMatch(/v_ev\.reporter_id/);
    expect(body()).toMatch(/'site-media:' \|\| m\.storage_path/);
    expect(body()).toMatch(/v_room\.room_name/);
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
    const b = body();
    expect(b).toMatch(/p_owner_id IS NOT NULL AND p_owner_id <> v_ev\.reporter_id/);
    expect(b).toMatch(/enqueue_notification_user\(\s*v_ev\.project_id,\s*p_owner_id,\s*'SITE_EVENT_ASSIGNED'/);
    expect(b).toMatch(/'SiteEventDetail'/);
    expect(b).toMatch(/jsonb_build_object\('eventId', p_event_id, 'projectId', v_ev\.project_id\)/);
    expect(b).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'confirm_site_event: notification failed: %', SQLERRM;/);
    expect(b).toMatch(/'notified', v_notified/);
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

  it('is SECURITY DEFINER, pinned, and granted like confirm', () => {
    expect(body()).toMatch(/close_site_event\(\s*p_event_id\s+UUID,\s*p_closure_note\s+TEXT\s*\)\s*RETURNS JSONB/);
    expect(body()).toMatch(/SECURITY DEFINER/);
    expect(body()).toMatch(/SET search_path = public/);
    expect(SQL).toContain('REVOKE ALL ON FUNCTION close_site_event(UUID, TEXT) FROM PUBLIC, anon;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION close_site_event(UUID, TEXT) TO authenticated, service_role;');
  });

  it('closes only an open event and stamps who and when', () => {
    expect(body()).toMatch(/v_ev\.status <> 'open'/);
    expect(body()).toMatch(/SITE_EVENT_NOT_OPEN:/);
    expect(body()).toMatch(/status\s*=\s*'done'/);
    expect(body()).toMatch(/closed_at\s*=\s*now\(\)/);
    expect(body()).toMatch(/closed_by\s*=\s*v_uid/);
    expect(body()).toMatch(/closure_note\s*=\s*v_note/);
  });
});

describe('migration 097 §9 - v_room_board', () => {
  it('is a security_invoker view readable by authenticated users', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW v_room_board\s+WITH \(security_invoker = true\) AS/);
    expect(SQL).toMatch(/GRANT SELECT ON v_room_board TO authenticated;/);
  });

  it('drops the view before recreating it, so a future column-list change cannot be refused on re-paste', () => {
    const dropIdx = SQL.indexOf('DROP VIEW IF EXISTS v_room_board;');
    const createIdx = SQL.indexOf('CREATE OR REPLACE VIEW v_room_board');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('carries every column the board and the capture screen read', () => {
    const view = SQL.slice(SQL.indexOf('CREATE OR REPLACE VIEW v_room_board'));
    for (const col of [
      'open_progres', 'open_isu', 'open_hambatan', 'open_cacat', 'open_butuh_keputusan', 'open_info',
      'overdue_count', 'last_event_at', 'last_gate_code', 'last_step_code', 'is_quiet', 'owner_initials',
    ]) {
      expect(view).toMatch(new RegExp(`AS ${col}\\b`));
    }
    // Jakarta, so the board agrees with confirm_site_event's due-date floor.
    expect(view).toMatch(/due_date < \(now\(\) AT TIME ZONE 'Asia\/Jakarta'\)::date/);
    expect(view).not.toMatch(/due_date < current_date/);
    expect(view).toMatch(/interval '3 days'/);
  });
});

describe('migration 097 §10 - self-contained helpers', () => {
  it('inlines is_office_role and is_project_member the way 050/051/096 do', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION is_office_role\(\)/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION is_project_member\(p_project_id UUID\)/);
  });

  it('pins search_path on every function it defines', () => {
    const fns = SQL.match(/CREATE OR REPLACE FUNCTION [\s\S]*?\n\$\$;/g) ?? [];
    expect(fns.length).toBe(9);
    for (const fn of fns) expect(fn).toMatch(/SET search_path = public/);
  });
});
