/**
 * CI runs jest and never Deno, so the edge function's security-relevant shape
 * is pinned here as text (spec §13): the caller's JWT and project membership
 * are checked BEFORE the service-role client exists; the only outbound calls
 * are the two provider endpoints; every write to site_events goes through the
 * stage builders or the transcript write; and a write never lands on an event
 * a human has already confirmed or discarded.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'functions', 'site-event-analyze', 'index.ts'),
  'utf8',
);

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

  it('guards every analysis write on the event still being pending or a draft', () => {
    const guarded = SRC.match(/update\((successUpdate|failureUpdate|quotaUpdate)\([^;]*?\.in\('status', \['pending_analysis', 'draft'\]\)/g) ?? [];
    expect(guarded).toHaveLength(3);
  });

  it('counts the daily cap from analyze runs since the start of the Jakarta day', () => {
    expect(SRC).toContain("Deno.env.get('SITE_EVENT_DAILY_CAP') ?? '200'");
    expect(SRC).toContain(".eq('stage', 'analyze')");
    expect(SRC).toContain('startOfJakartaDayUtcIso(new Date())');
  });

  it('takes the quota message from util.ts instead of restating it', () => {
    expect(SRC).not.toContain('Kuota analisis AI hari ini habis');
    expect(SRC).toMatch(/AI_QUOTA_MESSAGE/);
  });

  it('serves only when run as the entry point, so tests can import it', () => {
    expect(SRC).toMatch(/if \(import\.meta\.main\) \{\s*Deno\.serve\(handle\);\s*\}/);
  });
});
