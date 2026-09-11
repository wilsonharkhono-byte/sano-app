/**
 * Static guard for migration 098 (daily log room links, SITE_EVENT_ASSIGNED).
 *
 * The notification type swap is the dangerous half. The enqueue helpers catch
 * every error as a WARNING, so a type missing from the CHECK does not fail
 * anything: the notification silently never exists (088 §8 documents the same
 * hazard). Dropping an OLD type is just as silent, for every flow that uses it.
 * So this suite derives the expected list from 088's own text rather than
 * restating it, and fails if a later migration swapped the constraint first.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '098_daily_log_room_link.sql'), 'utf8');

/** The quoted type names inside the LAST notifications_type_check in a file. */
function typeList(sql: string): string[] {
  const start = sql.lastIndexOf('ADD CONSTRAINT notifications_type_check');
  if (start < 0) throw new Error('no notifications_type_check in this SQL');
  const end = sql.indexOf('));', start);
  return [...sql.slice(start, end).matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
}

describe('migration 098 - header', () => {
  it('links the spec, pastes after 097, and names the client routing file', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/097/);
    expect(SQL).toMatch(/tools\/notificationRouting\.ts/);
  });
});

describe('migration 098 §1 - daily log room links', () => {
  it('adds the three highlight columns idempotently, with foreign keys', () => {
    expect(SQL).toMatch(/ALTER TABLE daily_log_highlights\s+ADD COLUMN IF NOT EXISTS room_id\s+UUID REFERENCES rooms\(id\) ON DELETE SET NULL;/);
    expect(SQL).toMatch(/ALTER TABLE daily_log_highlights\s+ADD COLUMN IF NOT EXISTS gate_code\s+TEXT REFERENCES gate_refs\(code\);/);
    expect(SQL).toMatch(/ALTER TABLE daily_log_highlights\s+ADD COLUMN IF NOT EXISTS source_event_id\s+UUID REFERENCES site_events\(id\) ON DELETE SET NULL;/);
  });

  it('adds the two photo columns idempotently, with foreign keys', () => {
    expect(SQL).toMatch(/ALTER TABLE daily_log_photos\s+ADD COLUMN IF NOT EXISTS room_id\s+UUID REFERENCES rooms\(id\) ON DELETE SET NULL;/);
    expect(SQL).toMatch(/ALTER TABLE daily_log_photos\s+ADD COLUMN IF NOT EXISTS source_media_id\s+UUID REFERENCES site_event_media\(id\) ON DELETE SET NULL;/);
  });

  it('keeps every new column nullable with no default, so existing logs are untouched', () => {
    const adds = SQL.match(/ADD COLUMN IF NOT EXISTS [^;]+;/g) ?? [];
    expect(adds).toHaveLength(5);
    for (const add of adds) expect(add).not.toMatch(/NOT NULL|DEFAULT/);
  });
});

describe('migration 098 §2 - notifications.type', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

  it('builds on 088, the latest migration before this one that swapped the type CHECK', () => {
    const swappers = files
      .filter((f) => Number(f.slice(0, 3)) < 98)
      .filter((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').includes('ADD CONSTRAINT notifications_type_check'));
    expect(swappers[swappers.length - 1]).toBe('088_approval_po_separation.sql');
  });

  it('carries forward every type 088 allowed and adds exactly SITE_EVENT_ASSIGNED', () => {
    const before = typeList(fs.readFileSync(path.join(MIGRATIONS, '088_approval_po_separation.sql'), 'utf8'));
    const after = typeList(SQL);
    expect(before).toHaveLength(12);
    for (const t of before) expect(after).toContain(t);
    expect(after.filter((t) => !before.includes(t))).toEqual(['SITE_EVENT_ASSIGNED']);
    expect(new Set(after).size).toBe(after.length);
  });

  it('swaps by shape inside a DO block, the 067/078/079/088 pattern', () => {
    expect(SQL).toMatch(/DO \$\$/);
    expect(SQL).toMatch(/con\.conrelid = 'public\.notifications'::regclass/);
    expect(SQL).toMatch(/pg_get_constraintdef\(con\.oid\) ILIKE '%type%'/);
    expect(SQL).toMatch(/EXECUTE format\('ALTER TABLE public\.notifications DROP CONSTRAINT %I', c\.conname\)/);
  });

  it('allows the exact type confirm_site_event enqueues in 097', () => {
    const sql097 = fs.readFileSync(path.join(MIGRATIONS, '097_site_events.sql'), 'utf8');
    expect(sql097).toMatch(/'SITE_EVENT_ASSIGNED'/);
    expect(typeList(SQL)).toContain('SITE_EVENT_ASSIGNED');
  });
});
