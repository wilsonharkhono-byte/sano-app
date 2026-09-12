/**
 * CI runs jest and never Deno, so the edge function's security- and
 * spend-relevant shape is pinned here as text (spec §13): the caller's JWT and
 * project membership are checked BEFORE the service-role client exists; the
 * only outbound calls are the two provider endpoints, both bounded by the
 * shared deadline; the daily cap is read before the attempt is claimed; every
 * write to site_events goes through the stage builders or one of two inline
 * literals, touches only the columns migration 097 reserves for this function,
 * and never lands on an event a human has already confirmed or discarded.
 *
 * stages.ts's own column-allowlist assertions live in stages.test.ts, which CI
 * does not run — so they are duplicated here against the file as text.
 */
import fs from 'node:fs';
import path from 'node:path';

const FUNCTION_DIR = path.join(__dirname, '..', '..', 'supabase', 'functions', 'site-event-analyze');
const SRC = fs.readFileSync(path.join(FUNCTION_DIR, 'index.ts'), 'utf8');
const STAGES = fs.readFileSync(path.join(FUNCTION_DIR, 'stages.ts'), 'utf8');

/**
 * The seven columns 097's site_events_ai_columns_service_only() reserves for
 * the service role, plus `status` — the one ordinary column the function may
 * move (pending_analysis → draft). Nothing else may be written by either file.
 */
const AI_WRITABLE_COLUMNS = [
  'ai_confidence',
  'ai_draft',
  'ai_mismatch',
  'ai_model',
  'analysis_attempts',
  'last_error',
  'status',
  'transcript',
];

/** site_event_ai_runs columns, which buildRunRow legitimately emits alongside them. */
const RUN_ROW_COLUMNS = [
  'cost_usd',
  'error',
  'event_id',
  'input_summary',
  'latency_ms',
  'model',
  'output',
  'prompt_hash',
  'stage',
  'tokens_in',
  'tokens_out',
];

describe('site-event-analyze index.ts', () => {
  it('verifies the JWT, reads through RLS and checks membership before creating the service-role client', () => {
    const getUser = SRC.indexOf('caller.auth.getUser()');
    const rlsRead = SRC.indexOf("caller.from('site_events')");
    const member = SRC.indexOf("caller.rpc('is_project_member'");
    const office = SRC.indexOf("caller.rpc('is_office_role')");
    const service = SRC.indexOf('createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    expect(getUser).toBeGreaterThan(-1);
    expect(rlsRead).toBeGreaterThan(getUser);
    expect(member).toBeGreaterThan(rlsRead);
    expect(office).toBeGreaterThan(rlsRead);
    expect(service).toBeGreaterThan(Math.max(member, office));
    expect(SRC.match(/createClient\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/g)).toHaveLength(1);
  });

  it('calls only the OpenAI transcription endpoint and the Claude Messages API', () => {
    expect(SRC).toContain("'https://api.openai.com/v1/audio/transcriptions'");
    expect(SRC).toContain("'https://api.anthropic.com/v1/messages'");
    expect(SRC.match(/https:\/\/[a-z.]+/g)?.sort()).toEqual(['https://api.anthropic.com', 'https://api.openai.com']);
    expect(SRC).toContain("'anthropic-version': '2023-06-01'");
  });

  it('uses the spec models and locks transcription to Indonesian', () => {
    expect(SRC).toMatch(/Deno\.env\.get\('SITE_EVENT_MODEL'\) \?\? 'claude-sonnet-5'/);
    expect(SRC).toContain("const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'");
    expect(SRC).toContain("form.append('language', 'id')");
    expect(SRC).toContain("form.append('response_format', 'json')");
  });

  it('never writes a human field', () => {
    expect(SRC).not.toMatch(/\b(event_type|title|summary|owner_id|due_date|is_blocking|vo_flag|site_change_id|confirmed_at|closed_at|related_event_id|downstream_impact)\s*:/);
  });

  it('never writes transcript_edited — STT output may not clobber the supervisor’s correction', () => {
    // It is read (effectiveTranscript prefers it), so it must still appear;
    // the alternation above cannot catch it because EventRow declares it.
    expect(SRC).toContain('transcript_edited');
    for (const source of [SRC, STAGES]) {
      expect(source.match(/\.update\([^;]*transcript_edited/g) ?? []).toHaveLength(0);
      expect(source.match(/\.insert\([^;]*transcript_edited/g) ?? []).toHaveLength(0);
    }
  });

  it('guards every named-builder analysis write on the event still being pending or a draft', () => {
    const guarded = SRC.match(
      /update\(sanitizeJsonForPostgres\((claimUpdate|releaseClaimUpdate|successUpdate|failureUpdate|quotaUpdate)\([^;]*?\.in\('status', \['pending_analysis', 'draft'\]\)/g,
    ) ?? [];
    // claim, release, quota (before the claim and after stage 1), failure, success.
    expect(guarded).toHaveLength(6);
  });

  it('guards the transcript and STT-error-only writes on status too, same as the others', () => {
    expect(SRC).toMatch(
      /update\(sanitizeJsonForPostgres\(\{ transcript: sttText \}\)\)[^;]*?\.in\('status', \['pending_analysis', 'draft'\]\)/,
    );
    expect(SRC).toMatch(
      /update\(sanitizeJsonForPostgres\(\{ last_error: sttError \}\)\)[^;]*?\.in\('status', \['pending_analysis', 'draft'\]\)/,
    );
  });

  it('sanitises every site_events write before it reaches Postgres — no bare .update( or .insert(', () => {
    const allUpdates = SRC.match(/\.update\(/g) ?? [];
    const sanitizedUpdates = SRC.match(/\.update\(sanitizeJsonForPostgres\(/g) ?? [];
    expect(allUpdates.length).toBeGreaterThan(0);
    expect(sanitizedUpdates.length).toBe(allUpdates.length);
    // The audit row carries the model's raw tool input, so the insert needs it
    // just as much: one NUL there loses the only record that money was spent.
    const allInserts = SRC.match(/\.insert\(/g) ?? [];
    const sanitizedInserts = SRC.match(/\.insert\(sanitizeJsonForPostgres\(/g) ?? [];
    expect(allInserts.length).toBeGreaterThan(0);
    expect(sanitizedInserts.length).toBe(allInserts.length);
  });

  it('writes only allowlisted columns from the two inline update literals', () => {
    const inline = SRC.match(/\.update\(sanitizeJsonForPostgres\(\{([^}]*)\}\)\)/g) ?? [];
    expect(inline.length).toBeGreaterThan(0);
    for (const literal of inline) {
      const keys = (literal.match(/\{([^}]*)\}/)?.[1] ?? '')
        .split(',')
        .map((part) => part.split(':')[0].trim())
        .filter(Boolean);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(AI_WRITABLE_COLUMNS).toContain(key);
    }
  });

  it('claims the attempt (filtered on analysis_attempts) before calling either provider', () => {
    const claimIdx = SRC.indexOf(".eq('analysis_attempts', ev.analysis_attempts)");
    const openaiIdx = SRC.indexOf("'https://api.openai.com/v1/audio/transcriptions'");
    const claudeIdx = SRC.indexOf("'https://api.anthropic.com/v1/messages'");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(openaiIdx);
    expect(claimIdx).toBeLessThan(claudeIdx);
    expect(SRC).toContain('Analisis sedang berjalan atau sudah selesai. Muat ulang.');
  });

  it('reads the daily cap BEFORE the claim, so a quota block is not a failed attempt', () => {
    const capIdx = SRC.indexOf(".eq('stage', 'analyze')");
    const claimIdx = SRC.indexOf(".eq('analysis_attempts', ev.analysis_attempts)");
    expect(capIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(capIdx).toBeLessThan(claimIdx);
    expect(SRC).toContain('startOfJakartaDayUtcIso(new Date())');
    // And an abort before either provider hands the claim back.
    expect(SRC).toMatch(/\.eq\('analysis_attempts', ev\.analysis_attempts \+ 1\)/);
    expect(SRC).toContain('releaseClaimUpdate(ev)');
  });

  it('parses SITE_EVENT_DAILY_CAP with the strict helper, never with bare Number()', () => {
    // Number('20O') is NaN and every comparison against NaN is false, which
    // silently removes the only cap on the Anthropic bill.
    expect(SRC).not.toMatch(/Number\(Deno\.env\.get\('SITE_EVENT_DAILY_CAP'\)/);
    expect(SRC).toContain("parseDailyCap(Deno.env.get('SITE_EVENT_DAILY_CAP'))");
  });

  it('takes the quota message from util.ts instead of restating it', () => {
    expect(SRC).not.toContain('Kuota analisis AI hari ini habis');
    expect(SRC).toMatch(/AI_QUOTA_MESSAGE/);
  });

  it('gives every failure response a code, the 409 claim conflict included', () => {
    expect(SRC).toContain("code: 'ANALYSIS_IN_PROGRESS'");
    const positions: number[] = [];
    for (let at = SRC.indexOf('ok: false'); at > -1; at = SRC.indexOf('ok: false', at + 1)) positions.push(at);
    expect(positions.length).toBeGreaterThan(0);
    for (const at of positions) expect(SRC.slice(at, at + 200)).toMatch(/code: /);
  });

  it('bounds both provider calls with the shared deadline and one retry at most', () => {
    expect(SRC).not.toMatch(/await fetch\(/);
    expect(SRC.match(/await postWithRetry\(/g) ?? []).toHaveLength(2);
    expect(SRC).toMatch(/const deadline = Date\.now\(\) \+ DEADLINE_MS/);
    expect(SRC).toMatch(/attempts >= 2/);
    expect(SRC).toContain('MIN_PROVIDER_BUDGET_MS');
    // A photo is skipped on its real byte count, never base64-encoded blind.
    expect(SRC).toMatch(/blob\.size > MAX_IMAGE_BYTES/);
  });

  it('serves only when run as the entry point, so tests can import it', () => {
    expect(SRC).toMatch(/if \(import\.meta\.main\) \{\s*Deno\.serve\(handle\);\s*\}/);
  });
});

describe('site-event-analyze stages.ts (Deno-only tests are not run by CI)', () => {
  it('pins ANALYSIS_WRITABLE_COLUMNS to migration 097’s AI columns plus status', () => {
    const list = STAGES.match(/ANALYSIS_WRITABLE_COLUMNS[^=]*=\s*\[([^\]]*)\]/s)?.[1] ?? '';
    const columns = (list.match(/'([a-z_]+)'/g) ?? []).map((quoted) => quoted.replace(/'/g, '')).sort();
    expect(columns).toEqual([...AI_WRITABLE_COLUMNS].sort());
  });

  it('no stage update builder emits a key outside that allowlist', () => {
    const keys = (STAGES.match(/^\s{4}([a-z_]+):/gm) ?? []).map((line) => line.trim().replace(':', ''));
    expect(keys.length).toBeGreaterThan(0);
    const allowed = new Set([...AI_WRITABLE_COLUMNS, ...RUN_ROW_COLUMNS]);
    for (const key of keys) expect(allowed.has(key)).toBe(true);
    // The builders the function actually calls are all present.
    for (const builder of ['successUpdate', 'failureUpdate', 'quotaUpdate', 'claimUpdate', 'releaseClaimUpdate']) {
      expect(STAGES).toContain(`export function ${builder}(`);
    }
  });

  it('quotaUpdate writes the exact string canOfferManualAuthoring compares against', () => {
    expect(STAGES).toMatch(/last_error: AI_QUOTA_MESSAGE,?\s*\n?\s*\}/);
    expect(STAGES).not.toContain('Kuota analisis AI hari ini habis');
  });
});
