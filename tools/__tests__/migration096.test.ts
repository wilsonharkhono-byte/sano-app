/**
 * Static guard for migration 096 (rooms, gate reference data, project phase).
 *
 * Like the 088/092/095 suites this touches no database: migrations are pasted
 * into the Supabase Dashboard, so the SQL text IS the artifact under test. Each
 * assertion protects a decision a later tidy-up could silently undo. Guards on
 * the SQL read CODE, the file with every full-line comment removed, so the
 * header or the self-check footer can never satisfy a guard the SQL fails.
 *
 *  • The room_code CHECK and the QR freeze trigger: a printed QR is a physical
 *    object naming /r/{projectCode}/{roomCode}. If the code or the project
 *    behind it can move, or its stamp can be cleared, the label lies, and the
 *    release-2 DATUM join on (project_code, room_code) breaks with it.
 *  • rooms is created in 035's exact shape when absent, BEFORE the first
 *    ALTER TABLE rooms: 035 may never have landed on the divergent remote, and
 *    an ALTER against a missing table aborts the paste.
 *  • Members read rooms; only office roles write them. The rooms policy set is
 *    pinned exactly, so a member write policy under ANY name fails, and 035's
 *    member INSERT and UPDATE policies must stay dropped: the freeze trigger
 *    alone does not stop a supervisor renaming, retiring or stamping a room.
 *  • The NOT VALID + conditional VALIDATE dance: 035-era rooms may hold codes
 *    that violate the new shape. A paste must REPORT them, not abort, because
 *    an abort rolls back the whole paste.
 *  • gate_refs / gate_step_refs have no policy that can DELETE (FOR ALL
 *    included) and a trigger that refuses DELETE, refuses to move `code`, and
 *    refuses to move a step to another gate: site_events.gate_code and
 *    (gate_code, step_code) are foreign keys, and a reused letter would
 *    silently re-label history.
 *  • ON CONFLICT DO NOTHING on the seed: a re-paste must never overwrite a
 *    label or description an office user edited.
 *  • Every CREATE POLICY and CREATE TRIGGER follows exactly one DROP ... IF
 *    EXISTS, and every constraint sits in a pg_constraint guard, or the second
 *    paste fails and rolls back.
 *  • The inlined helpers equal their latest definition in any other migration,
 *    and no later migration touches a rooms policy: CREATE OR REPLACE and
 *    DROP/CREATE POLICY mean a re-paste of 096 would revert such a change.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '096_rooms_gates_phase.sql'), 'utf8');
const CODE = SQL.replace(/^\s*--.*$/gm, ''); // comments can never satisfy a guard

const HELPERS = ['is_office_role()', 'is_project_member(p_project_id UUID)'];

/** `CREATE OR REPLACE FUNCTION <sig>` through its closing `$$;`, whitespace collapsed; null when absent. */
function fnText(src: string, sig: string): string | null {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${sig}`);
  if (start < 0) return null;
  return src.slice(start, src.indexOf('\n$$;', start) + 4).replace(/\s+/g, ' ');
}

/** This migration's own definition of a function, read from CODE. */
function fnBody(sig: string): string {
  const text = fnText(CODE, sig);
  if (!text) throw new Error(`${sig} not found in 096`);
  return text;
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

describe('migration 096 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
  });

  it('resets lock_timeout after every DDL statement, then shows the constraint outcome', () => {
    const resets = [...CODE.matchAll(/^RESET lock_timeout;$/gm)];
    expect(resets).toHaveLength(1);
    // Only the result query may follow RESET, so no DDL runs without the timeout,
    // and the grid shows the outcome even when the editor hides WARNINGs.
    expect(CODE.slice(resets[0].index!)).toMatch(
      /^RESET lock_timeout;\s+SELECT conname, convalidated FROM pg_constraint\s+WHERE conname IN \('rooms_room_code_shape','rooms_area_type_check','projects_phase_check','gate_step_refs_gate_code_code_key'\)\s+ORDER BY conname;\s*$/,
    );
  });
});

describe('migration 096 - a second paste cannot fail', () => {
  it('adds every constraint inside a pg_constraint guard for its own name', () => {
    const names = [...CODE.matchAll(/ADD CONSTRAINT (\w+)/g)].map((m) => m[1]);
    expect([...names].sort()).toEqual([
      'gate_step_refs_gate_code_code_key',
      'projects_phase_check',
      'rooms_area_type_check',
      'rooms_room_code_shape',
    ]);
    for (const name of names) {
      expect(CODE).toMatch(
        new RegExp(
          `IF NOT EXISTS \\(\\s*SELECT 1 FROM pg_constraint\\s+WHERE conname = '${name}' AND conrelid = 'public\\.(\\w+)'::regclass\\s*\\) THEN\\s+ALTER TABLE \\1\\s+ADD CONSTRAINT ${name}\\b`,
        ),
      );
    }
  });

  it('drops every policy exactly once, BEFORE its CREATE', () => {
    for (const c of CODE.matchAll(/^CREATE POLICY\s+(\w+)\s+ON\s+(\w+)/gm)) {
      const d = [...CODE.matchAll(new RegExp(`^DROP POLICY IF EXISTS ${c[1]}\\s+ON\\s+${c[2]};`, 'gm'))];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });

  it('drops every trigger exactly once, BEFORE its CREATE', () => {
    const creates = [...CODE.matchAll(/^CREATE TRIGGER\s+(\w+)\s+BEFORE\s[^;]*?\sON\s+(\w+)/gm)];
    expect(creates.map((c) => c[1]).sort()).toEqual([
      'gate_refs_immutable_trg',
      'gate_step_refs_immutable_trg',
      'rooms_freeze_code_trg',
    ]);
    for (const c of creates) {
      const d = [...CODE.matchAll(new RegExp(`^DROP TRIGGER IF EXISTS ${c[1]} ON ${c[2]};`, 'gm'))];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });
});

describe('migration 096 §1 - projects.phase', () => {
  it('adds phase and datum_project_code idempotently', () => {
    expect(CODE).toMatch(/ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS phase\s+TEXT NOT NULL DEFAULT 'STRUKTUR'/);
    expect(CODE).toMatch(/ALTER TABLE projects\s+ADD COLUMN IF NOT EXISTS datum_project_code\s+TEXT/);
  });

  it('constrains phase to the three values the renderer switches on', () => {
    expect(CODE).toMatch(/ADD CONSTRAINT projects_phase_check\s+CHECK \(phase IN \('STRUKTUR','FINISHING','SERAH_TERIMA'\)\)/);
  });
});

describe('migration 096 §2 - rooms', () => {
  it("creates rooms in 035's shape when absent, before the first ALTER", () => {
    expect(CODE).toContain('CREATE TABLE IF NOT EXISTS rooms (');
    expect(CODE).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_project_code');
    // An ALTER against a missing table would abort the paste on a remote that
    // never received 035, so the CREATE has to come first.
    const create = CODE.search(/^CREATE TABLE IF NOT EXISTS rooms \(/m);
    const firstAlter = CODE.search(/^ALTER TABLE rooms\b/m);
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(firstAlter);
  });

  it('adds every DATUM-shaped column idempotently', () => {
    for (const col of ['area_type', 'sort_order', 'datum_area_id', 'qr_printed_at', 'active', 'created_by']) {
      expect(CODE).toMatch(new RegExp(`ALTER TABLE rooms\\s+ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  it("constrains area_type to DATUM's nine values", () => {
    for (const t of ['bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general']) {
      expect(CODE).toContain(`'${t}'`);
    }
    expect(CODE).toMatch(/conname = 'rooms_area_type_check'/);
  });

  it('adds the room_code shape CHECK as NOT VALID', () => {
    expect(CODE).toMatch(/room_code ~ '\^\[A-Z0-9\]\+\(-\[A-Z0-9\]\+\)\*\$'/);
    expect(CODE).toMatch(/length\(room_code\) <= 40/);
    expect(CODE).toMatch(/ADD CONSTRAINT rooms_room_code_shape[\s\S]{0,200}NOT VALID/);
  });

  it('VALIDATE runs only in the clean branch, and the dirty branch warns', () => {
    expect([...CODE.matchAll(/^\s*ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;/gm)]).toHaveLength(1);
    expect(CODE).toMatch(/IF v_bad = 0 THEN\s*\n\s*ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;/);
    expect(CODE).toMatch(/\bELSE\s+RAISE WARNING\s+'096: rooms_room_code_shape left NOT VALID/);
  });

  it('pins both freeze conditions and the row trigger', () => {
    const body = fnBody('rooms_freeze_code()');
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.room_code IS DISTINCT FROM OLD\.room_code THEN\s+RAISE EXCEPTION\s+'ROOM_CODE_FROZEN:/);
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.qr_printed_at IS NULL THEN\s+RAISE EXCEPTION\s+'ROOM_CODE_FROZEN:/);
    expect(CODE).toMatch(/CREATE TRIGGER rooms_freeze_code_trg\s+BEFORE UPDATE ON rooms\s+FOR EACH ROW EXECUTE FUNCTION rooms_freeze_code\(\);/);
  });

  it('freezes project_id too, and lets the database own the stamp', () => {
    const body = fnBody('rooms_freeze_code()');
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.project_id IS DISTINCT FROM OLD\.project_id THEN RAISE EXCEPTION 'ROOM_CODE_FROZEN:/);
    expect(body).toMatch(/IF NEW\.qr_printed_at IS NOT NULL AND NEW\.qr_printed_at IS DISTINCT FROM OLD\.qr_printed_at THEN NEW\.qr_printed_at := now\(\); END IF; RETURN NEW; END; \$\$;$/);
    // The three refusals, then the stamp, then RETURN NEW.
    const at = [
      'NEW.room_code IS DISTINCT FROM OLD.room_code',
      'NEW.qr_printed_at IS NULL THEN',
      'NEW.project_id IS DISTINCT FROM OLD.project_id',
      'NEW.qr_printed_at := now()',
    ].map((s) => body.indexOf(s));
    expect(Math.min(...at)).toBeGreaterThan(-1);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('rooms has exactly two policies: member SELECT, office ALL', () => {
    expect(CODE).toMatch(/^ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;$/m);
    const p = [...CODE.matchAll(/^CREATE POLICY\s+"?(\w+)"?\s+ON\s+rooms\s+FOR\s+(\w+)\s+([^;]*);/gm)]
      .map((m) => `${m[1]}|${m[2]}|${m[3].replace(/\s+/g, ' ').trim()}`)
      .sort();
    expect(p).toEqual([
      'rooms_member_read|SELECT|USING (is_project_member(project_id))',
      'rooms_office_all|ALL|USING (is_office_role()) WITH CHECK (is_office_role())',
    ]);
  });

  it("keeps 035's member INSERT and UPDATE policies dropped", () => {
    expect(CODE).toMatch(/^DROP POLICY IF EXISTS rooms_member_insert ON rooms;$/m);
    expect(CODE).toMatch(/^DROP POLICY IF EXISTS rooms_member_update ON rooms;$/m);
    expect(CODE).not.toMatch(/CREATE\s+POLICY\s+"?rooms_member_(?:insert|update)\b/i);
  });
});

describe('migration 096 §3 - gate_refs', () => {
  it('creates the table idempotently with code as the primary key', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS gate_refs \(\s+code\s+TEXT PRIMARY KEY/);
    expect(CODE).toMatch(/datum_gate_code\s+TEXT/);
  });

  it('seeds all eight gates, each with an Indonesian description for the prompt', () => {
    const seed = CODE.slice(CODE.indexOf('INSERT INTO gate_refs'), CODE.indexOf('CREATE TABLE IF NOT EXISTS gate_step_refs'));
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

  it('the seed INSERT itself ends ON CONFLICT (code) DO NOTHING', () => {
    expect(CODE).toMatch(/INSERT INTO gate_refs[\s\S]*?\)\s*\nON CONFLICT \(code\) DO NOTHING;/);
  });
});

describe('migration 096 §4 - gate_step_refs', () => {
  it('creates the table, referencing gate_refs, and ships it empty', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS gate_step_refs \(/);
    expect(CODE).toMatch(/gate_code\s+TEXT NOT NULL REFERENCES gate_refs\(code\)/);
    expect(CODE).not.toMatch(/INSERT INTO gate_step_refs/);
  });

  it("adds UNIQUE (gate_code, code) inside its guard, for 097's composite foreign key", () => {
    expect(CODE).toMatch(
      /WHERE conname = 'gate_step_refs_gate_code_code_key' AND conrelid = 'public\.gate_step_refs'::regclass\s*\) THEN\s+ALTER TABLE gate_step_refs\s+ADD CONSTRAINT gate_step_refs_gate_code_code_key UNIQUE \(gate_code, code\);\s+END IF;/,
    );
    expect(CODE.search(/ADD CONSTRAINT gate_step_refs_gate_code_code_key/)).toBeGreaterThan(
      CODE.search(/^CREATE TABLE IF NOT EXISTS gate_step_refs \(/m),
    );
  });
});

describe('migration 096 §5 - reference codes are immutable and undeletable', () => {
  const body = () => fnBody('gate_refs_immutable_code()');

  it('refuses DELETE outright', () => {
    expect(body()).toMatch(/IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GATE_REF_IMMUTABLE:/);
  });

  it('refuses to move code', () => {
    expect(body()).toMatch(/IF NEW\.code IS DISTINCT FROM OLD\.code THEN RAISE EXCEPTION 'GATE_REF_IMMUTABLE:/);
  });

  it('refuses to move a step to another gate, reading NEW.gate_code only on gate_step_refs', () => {
    const b = body();
    expect(b).toMatch(
      /IF TG_TABLE_NAME = 'gate_step_refs' THEN IF NEW\.gate_code IS DISTINCT FROM OLD\.gate_code THEN RAISE EXCEPTION 'GATE_REF_IMMUTABLE:[^;]*', OLD\.code, OLD\.gate_code, NEW\.gate_code; END IF; END IF;/,
    );
    // After the DELETE branch has closed (NEW is NULL there), before RETURN NEW,
    // and nowhere else: gate_refs has no gate_code column.
    const guard = b.indexOf("IF TG_TABLE_NAME = 'gate_step_refs' THEN");
    const deleteBranch = b.indexOf("IF TG_OP = 'DELETE' THEN");
    expect(deleteBranch).toBeGreaterThan(-1);
    expect(b.indexOf('END IF;', deleteBranch)).toBeLessThan(guard);
    expect(b.indexOf('NEW.gate_code')).toBeGreaterThan(guard);
    expect(guard).toBeLessThan(b.indexOf('RETURN NEW;'));
  });

  it('is attached to BOTH reference tables, once per row', () => {
    for (const t of ['gate_refs', 'gate_step_refs']) {
      expect(CODE).toMatch(
        new RegExp(`CREATE TRIGGER ${t}_immutable_trg\\s+BEFORE UPDATE OR DELETE ON ${t}\\s+FOR EACH ROW EXECUTE FUNCTION gate_refs_immutable_code\\(\\);`),
      );
    }
  });
});

describe('migration 096 §6 - RLS on the reference tables', () => {
  it('enables RLS on both', () => {
    expect(CODE).toMatch(/ALTER TABLE gate_refs\s+ENABLE ROW LEVEL SECURITY;/);
    expect(CODE).toMatch(/ALTER TABLE gate_step_refs\s+ENABLE ROW LEVEL SECURITY;/);
  });

  it('gives each exactly: authenticated read, office insert, office update', () => {
    for (const t of ['gate_refs', 'gate_step_refs']) {
      const p = [...CODE.matchAll(new RegExp(`^CREATE POLICY\\s+"?(\\w+)"?\\s+ON\\s+${t}\\s+([^;]*);`, 'gm'))]
        .map((m) => `${m[1]}|${m[2].replace(/\s+/g, ' ').trim()}`)
        .sort();
      expect(p).toEqual([
        `${t}_auth_read|FOR SELECT USING (auth.uid() IS NOT NULL)`,
        `${t}_office_insert|FOR INSERT WITH CHECK (is_office_role())`,
        `${t}_office_update|FOR UPDATE USING (is_office_role()) WITH CHECK (is_office_role())`,
      ]);
    }
  });

  it('no reference-table policy can DELETE, FOR ALL included', () => {
    expect(CODE).not.toMatch(/ON\s+gate_(?:step_)?refs\s+FOR\s+(?:DELETE|ALL)\b/);
  });

  it('writes every policy in the one shape these guards parse', () => {
    // A lower-case, FOR-less or indented CREATE POLICY would slip past the exact
    // sets above, and an omitted FOR means ALL, so no other spelling may appear.
    const spelled = CODE.match(/create\s+policy\b/gi) ?? [];
    const canonical = CODE.match(/^CREATE POLICY \w+\s+ON (?:rooms|gate_refs|gate_step_refs) FOR (?:SELECT|INSERT|UPDATE|ALL) /gm) ?? [];
    expect(canonical).toHaveLength(8);
    expect(spelled).toHaveLength(canonical.length);
    expect(CODE).not.toMatch(/\balter\s+policy\b|\bdisable\s+row\s+level\s+security\b/i);
  });
});

describe('migration 096 §7 - self-contained helpers', () => {
  it('inlines is_office_role and is_project_member the way 050/051 do', () => {
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION is_office_role\(\)/);
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION is_project_member\(p_project_id UUID\)/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION is_office_role\(\) TO authenticated;/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION is_project_member\(UUID\) TO authenticated;/);
  });

  it('keeps both inlined helpers SECURITY DEFINER with search_path pinned', () => {
    for (const sig of HELPERS) {
      expect(fnBody(sig)).toMatch(/\bSECURITY DEFINER\b/);
      expect(fnBody(sig)).toMatch(/\bSET search_path = public\b/);
    }
  });

  it('pins search_path on every function it defines', () => {
    const fns = CODE.match(/CREATE OR REPLACE FUNCTION [\s\S]*?\$\$;/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(4);
    for (const fn of fns) expect(fn).toMatch(/SET search_path = public/);
  });

  it('inlined helpers equal their latest definition in any other migration', () => {
    const files = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith('096_'))
      .sort()
      .reverse();
    for (const sig of HELPERS) {
      const latest = files.map((f) => fnText(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'), sig)).find(Boolean);
      expect(fnText(CODE, sig)).toBe(latest);
    }
  });

  it('no later migration touches a rooms policy that re-pasting 096 would revert', () => {
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 96);
    const touching = later.filter((f) =>
      /\bPOLICY\s+"?\w+"?\s+ON\s+(?:public\.)?rooms\b/i.test(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')),
    );
    // If this fails, bring 096's rooms policies up to date in the same change,
    // then compare definitions here the way the helper test does.
    expect(touching).toEqual([]);
  });
});
