/**
 * Static guard for migration 096 (rooms, gate reference data, project phase).
 *
 * Like the 088/092/095 suites this touches no database: migrations are pasted
 * into the Supabase Dashboard, so the SQL text IS the artifact under test. Each
 * assertion protects a decision a later tidy-up could silently undo.
 *
 *  • The room_code CHECK and the freeze trigger: a printed QR is a physical
 *    object. If the code behind it can move, the label lies, and the release-2
 *    DATUM join on (project_code, room_code) breaks with it.
 *  • The NOT VALID + conditional VALIDATE dance: 035-era rooms may hold codes
 *    that violate the new shape. A re-paste must REPORT them, not abort the
 *    whole script half-applied.
 *  • gate_refs / gate_step_refs have NO delete policy and a trigger that
 *    refuses DELETE and refuses to move `code`: site_events.gate_code is a
 *    foreign key, and a reused letter would silently re-label history.
 *  • ON CONFLICT DO NOTHING on the seed: a re-paste must never overwrite a
 *    label or description an office user edited.
 *  • Every CREATE POLICY is preceded by DROP POLICY IF EXISTS, or the second
 *    paste fails with "policy already exists" and leaves the script partial.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '096_rooms_gates_phase.sql'), 'utf8');

/** A named function's body as defined by this migration's text. */
function fnBody(name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name}[\\s\\S]*?\\n\\$\\$;`);
  const m = SQL.match(re);
  if (!m) throw new Error(`${name} not found in 096`);
  return m[0];
}

describe('migration 096 - header states why, paste order and re-paste safety', () => {
  it('links the spec and names its place in the paste order', () => {
    expect(SQL).toMatch(/2026-09-10-room-site-events-design\.md/);
    expect(SQL).toMatch(/PASTE ORDER/);
    expect(SQL).toMatch(/096.*097.*098/s);
  });

  it('says out loud that it must be re-paste safe', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
  });
});

describe('migration 096 §1 - projects.phase', () => {
  it('adds phase and datum_project_code idempotently', () => {
    expect(SQL).toMatch(/ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS phase\s+TEXT NOT NULL DEFAULT 'STRUKTUR'/);
    expect(SQL).toMatch(/ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS datum_project_code\s+TEXT/);
  });

  it('constrains phase to the three values the renderer switches on', () => {
    expect(SQL).toMatch(/CHECK \(phase IN \('STRUKTUR','FINISHING','SERAH_TERIMA'\)\)/);
  });

  it('adds the CHECK inside a pg_constraint guard so a re-paste does not fail', () => {
    expect(SQL).toMatch(/conname = 'projects_phase_check'/);
  });
});

describe('migration 096 §2 - rooms', () => {
  it('adds every DATUM-shaped column idempotently', () => {
    for (const col of ['area_type', 'sort_order', 'datum_area_id', 'qr_printed_at', 'active', 'created_by']) {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE rooms\\s+ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  it("constrains area_type to DATUM's nine values", () => {
    for (const t of ['bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general']) {
      expect(SQL).toContain(`'${t}'`);
    }
    expect(SQL).toMatch(/conname = 'rooms_area_type_check'/);
  });

  it('adds the room_code shape CHECK as NOT VALID', () => {
    expect(SQL).toMatch(/room_code ~ '\^\[A-Z0-9\]\+\(-\[A-Z0-9\]\+\)\*\$'/);
    expect(SQL).toMatch(/length\(room_code\) <= 40/);
    expect(SQL).toMatch(/ADD CONSTRAINT rooms_room_code_shape[\s\S]{0,200}NOT VALID/);
  });

  it('validates the CHECK only when no violating row exists, and warns otherwise', () => {
    const block = SQL.slice(SQL.indexOf('rooms_room_code_shape'));
    expect(block).toMatch(/IF v_bad = 0 THEN[\s\S]*?VALIDATE CONSTRAINT rooms_room_code_shape/);
    expect(block).toMatch(/RAISE WARNING/);
  });

  it('freezes room_code once a QR has been printed', () => {
    const body = fnBody('rooms_freeze_code');
    expect(body).toMatch(/OLD\.qr_printed_at IS NOT NULL/);
    expect(body).toMatch(/NEW\.room_code IS DISTINCT FROM OLD\.room_code/);
    expect(body).toMatch(/ROOM_CODE_FROZEN:/);
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS rooms_freeze_code_trg ON rooms;/);
    expect(SQL).toMatch(/CREATE TRIGGER rooms_freeze_code_trg\s+BEFORE UPDATE ON rooms/);
    expect(SQL).toMatch(/OLD\.qr_printed_at IS NOT NULL AND NEW\.qr_printed_at IS NULL/);
  });

  it('re-asserts the member and office policies with a DROP first', () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS rooms_member_read\s+ON rooms;/);
    expect(SQL).toMatch(/DROP POLICY IF EXISTS rooms_office_all\s+ON rooms;/);
    expect(SQL).toMatch(/CREATE POLICY rooms_office_all\s+ON rooms\s+FOR ALL/);
  });
});

describe('migration 096 §3 - gate_refs', () => {
  it('creates the table idempotently with code as the primary key', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS gate_refs \(/);
    expect(SQL).toMatch(/code\s+TEXT PRIMARY KEY/);
    expect(SQL).toMatch(/datum_gate_code\s+TEXT/);
  });

  it('seeds all eight gates, each with an Indonesian description for the prompt', () => {
    const seed = SQL.slice(SQL.indexOf('INSERT INTO gate_refs'), SQL.indexOf('gate_step_refs'));
    for (const code of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(seed).toMatch(new RegExp(`\\('${code}',`));
    }
    expect(seed).toMatch(/'MEP Rough-in'/);
    expect(seed).toMatch(/'Pekerjaan Basah \/ Waterproofing'/);
    expect(seed).toMatch(/'Penyelesaian Akhir & Serah Terima'/);
    // Eight rows, eight descriptions - the model picks a gate on meaning, not
    // on a bare letter (spec §4.1).
    expect((seed.match(/Pemasangan|Plesteran|Rangka|Pengecatan|Kitchen set|Pembersihan/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('never overwrites an edited label on a re-paste', () => {
    expect(SQL).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
  });
});

describe('migration 096 §4 - gate_step_refs', () => {
  it('creates the table, referencing gate_refs, and ships it empty', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS gate_step_refs \(/);
    expect(SQL).toMatch(/gate_code\s+TEXT NOT NULL REFERENCES gate_refs\(code\)/);
    expect(SQL).not.toMatch(/INSERT INTO gate_step_refs/);
  });
});

describe('migration 096 §5 - reference codes are immutable and undeletable', () => {
  const body = () => fnBody('gate_refs_immutable_code');

  it('refuses DELETE outright', () => {
    expect(body()).toMatch(/IF TG_OP = 'DELETE' THEN/);
    expect(body()).toMatch(/GATE_REF_IMMUTABLE:/);
  });

  it('refuses to move code', () => {
    expect(body()).toMatch(/NEW\.code IS DISTINCT FROM OLD\.code/);
  });

  it('is attached to BOTH reference tables', () => {
    expect(SQL).toMatch(/CREATE TRIGGER gate_refs_immutable_trg\s+BEFORE UPDATE OR DELETE ON gate_refs/);
    expect(SQL).toMatch(/CREATE TRIGGER gate_step_refs_immutable_trg\s+BEFORE UPDATE OR DELETE ON gate_step_refs/);
  });
});

describe('migration 096 §6 - RLS on the reference tables', () => {
  it('enables RLS on both', () => {
    expect(SQL).toMatch(/ALTER TABLE gate_refs\s+ENABLE ROW LEVEL SECURITY;/);
    expect(SQL).toMatch(/ALTER TABLE gate_step_refs\s+ENABLE ROW LEVEL SECURITY;/);
  });

  it('lets any authenticated user read and only office roles write', () => {
    expect(SQL).toMatch(/CREATE POLICY gate_refs_auth_read\s+ON gate_refs\s+FOR SELECT USING \(auth\.uid\(\) IS NOT NULL\)/);
    expect(SQL).toMatch(/CREATE POLICY gate_refs_office_insert\s+ON gate_refs\s+FOR INSERT WITH CHECK \(is_office_role\(\)\)/);
    expect(SQL).toMatch(/CREATE POLICY gate_refs_office_update\s+ON gate_refs\s+FOR UPDATE USING \(is_office_role\(\)\)/);
    expect(SQL).toMatch(/CREATE POLICY gate_step_refs_auth_read\s+ON gate_step_refs\s+FOR SELECT/);
  });

  it('grants no DELETE policy on either reference table', () => {
    expect(SQL).not.toMatch(/CREATE POLICY \w*gate_refs\w*[\s\S]{0,80}FOR DELETE/);
    expect(SQL).not.toMatch(/CREATE POLICY \w*gate_step_refs\w*[\s\S]{0,80}FOR DELETE/);
  });

  it('drops every policy before creating it', () => {
    const creates = SQL.match(/CREATE POLICY (\w+)/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) {
      const name = c.replace('CREATE POLICY ', '');
      expect(SQL).toMatch(new RegExp(`DROP POLICY IF EXISTS ${name}\\b`));
    }
  });
});

describe('migration 096 §7 - self-contained helpers', () => {
  it('inlines is_office_role and is_project_member the way 050/051 do', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION is_office_role\(\)/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION is_project_member\(p_project_id UUID\)/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION is_office_role\(\) TO authenticated;/);
  });

  it('pins search_path on every function it defines', () => {
    const fns = SQL.match(/CREATE OR REPLACE FUNCTION [\s\S]*?\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(4);
    for (const fn of fns) expect(fn).toMatch(/SET search_path = public/);
  });
});
