/**
 * Static guard for migration 096 (rooms, gate reference data, project phase).
 *
 * Like the 088/092/095 suites this touches no database: migrations are pasted
 * into the Supabase Dashboard, so the SQL text IS the artifact under test. Each
 * assertion protects a decision a later tidy-up could silently undo. Guards on
 * the SQL read CODE, the file with every full-line comment removed, so the
 * header or the self-check footer can never satisfy a guard the SQL fails. The
 * scans that list policies, constraints and triggers ignore case, so lower-case
 * SQL cannot slip past them.
 *
 *  • The room_code CHECK and the QR freeze trigger: a printed QR is a physical
 *    object naming /r/{projectCode}/{roomCode}. If the code or the project
 *    behind it can move, or its stamp can be cleared, the label lies, and the
 *    release-2 DATUM join on (project_code, room_code) breaks with it.
 *  • Both trigger functions open on their first refusal and hold exactly one
 *    RETURN, so no early exit (a service-role bypass, say) skips a guard.
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
 *  • ON CONFLICT DO NOTHING on the seed, and no other statement writes gate
 *    rows: a re-paste must never overwrite a label or description an office
 *    user edited.
 *  • Every CREATE POLICY and CREATE TRIGGER follows exactly one DROP ... IF
 *    EXISTS, and every constraint sits in a pg_constraint guard, or the second
 *    paste fails and rolls back.
 *  • The inlined helpers equal their latest definition in any other migration
 *    (a definition this suite cannot read fails, naming its file), and no later
 *    migration redefines rooms_freeze_code or gate_refs_immutable_code, or
 *    touches a policy on rooms, gate_refs or gate_step_refs or one of 096's
 *    triggers: CREATE OR REPLACE and DROP/CREATE mean a re-paste of 096 would
 *    revert such a change.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '096_rooms_gates_phase.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL); // comments can never satisfy a guard

const HELPERS = ['is_office_role()', 'is_project_member(p_project_id UUID)'];

/**
 * The last `CREATE [OR REPLACE] FUNCTION [public.]<sig>` in src, in any case,
 * through the `\n$$;` that closes its body, whitespace collapsed and the head
 * spelled one way so only the definition itself is compared. Null when src
 * never defines sig. Throws, naming the file, when src defines it but the body
 * does not close on a `$$;` line: an unreadable definition must fail the suite,
 * never drop out of a comparison.
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

/** This migration's own definition of a function, read from CODE. */
function fnBody(sig: string): string {
  const text = fnText(CODE, sig, FILE);
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
    const resets = [...CODE.matchAll(/^[ \t]*RESET\s+lock_timeout\s*;/gim)];
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
    // Any case and a quoted name still count, so an unguarded lower-case
    // ADD CONSTRAINT lands in this list and fails it.
    const names = [...CODE.matchAll(/\bADD\s+CONSTRAINT\s+"?(\w+)"?/gi)].map((m) => m[1]);
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
          'i',
        ),
      );
    }
  });

  it('drops every policy exactly once, BEFORE its CREATE', () => {
    const creates = [...CODE.matchAll(/^[ \t]*CREATE\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:public\.)?(\w+)/gim)];
    expect(creates).toHaveLength(8);
    for (const c of creates) {
      const d = [
        ...CODE.matchAll(new RegExp(`^[ \\t]*DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"?${c[1]}"?\\s+ON\\s+(?:public\\.)?${c[2]}\\s*;`, 'gim')),
      ];
      expect(d).toHaveLength(1);
      expect(d[0].index!).toBeLessThan(c.index!);
    }
  });

  it('drops every trigger exactly once, BEFORE its CREATE', () => {
    const creates = [
      ...CODE.matchAll(/^[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)"?\s[^;]*?\bON\s+(?:public\.)?(\w+)/gim),
    ];
    expect(creates.map((c) => c[1]).sort()).toEqual([
      'gate_refs_immutable_trg',
      'gate_step_refs_immutable_trg',
      'rooms_freeze_code_trg',
    ]);
    // Counted anywhere on a line too, so a trigger created mid-line cannot hide
    // from the list above.
    expect(CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b/gi) ?? []).toHaveLength(creates.length);
    for (const c of creates) {
      const d = [
        ...CODE.matchAll(new RegExp(`^[ \\t]*DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+"?${c[1]}"?\\s+ON\\s+(?:public\\.)?${c[2]}\\s*;`, 'gim')),
      ];
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
    const firstAlter = CODE.search(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?rooms\b/i);
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
    expect([
      ...CODE.matchAll(/^[ \t]*ALTER\s+TABLE\s+(?:public\.)?rooms\s+VALIDATE\s+CONSTRAINT\s+rooms_room_code_shape\s*;/gim),
    ]).toHaveLength(1);
    expect(CODE).toMatch(/IF v_bad = 0 THEN\s*\n\s*ALTER TABLE rooms VALIDATE CONSTRAINT rooms_room_code_shape;/);
    expect(CODE).toMatch(/\bELSE\s+RAISE WARNING\s+'096: rooms_room_code_shape left NOT VALID/);
  });

  it('pins both freeze conditions and the row trigger', () => {
    const body = fnBody('rooms_freeze_code()');
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.room_code IS DISTINCT FROM OLD\.room_code THEN\s+RAISE EXCEPTION\s+'ROOM_CODE_FROZEN:/);
    expect(body).toMatch(/IF OLD\.qr_printed_at IS NOT NULL AND NEW\.qr_printed_at IS NULL THEN\s+RAISE EXCEPTION\s+'ROOM_CODE_FROZEN:/);
    expect(CODE).toMatch(/CREATE TRIGGER rooms_freeze_code_trg\s+BEFORE UPDATE ON rooms\s+FOR EACH ROW EXECUTE FUNCTION rooms_freeze_code\(\);/);
  });

  it('opens on the code freeze and returns once, so no early exit skips a guard', () => {
    const body = fnBody('rooms_freeze_code()');
    // A bypass such as IF auth.role() = 'service_role' THEN RETURN NEW has to
    // sit before the first refusal or add a second RETURN; both fail here.
    expect(body).toMatch(/AS \$\$ BEGIN IF OLD\.qr_printed_at IS NOT NULL AND NEW\.room_code IS DISTINCT FROM OLD\.room_code THEN /);
    expect(body.match(/\bRETURN\b/gi) ?? []).toHaveLength(1);
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
    const p = [...CODE.matchAll(/^[ \t]*CREATE\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:public\.)?rooms\s+FOR\s+(\w+)\s+([^;]*);/gim)]
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

  it('no other statement writes gate rows, so a re-paste cannot overwrite an edit', () => {
    // A second INSERT ... DO UPDATE, or an UPDATE that "fixes" a seeded label,
    // would clobber an office user's edit on every re-paste.
    expect(CODE.match(/\bINSERT\s+INTO\s+(?:public\.)?gate_refs\b/gi) ?? []).toHaveLength(1);
    expect(CODE).not.toMatch(
      /\b(?:UPDATE\s+(?:ONLY\s+)?|DELETE\s+FROM\s+(?:ONLY\s+)?|TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?)(?:public\.)?gate_(?:step_)?refs\b/i,
    );
  });
});

describe('migration 096 §4 - gate_step_refs', () => {
  it('creates the table, referencing gate_refs, and ships it empty', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS gate_step_refs \(/);
    expect(CODE).toMatch(/gate_code\s+TEXT NOT NULL REFERENCES gate_refs\(code\)/);
    expect(CODE).not.toMatch(/\bINSERT\s+INTO\s+(?:public\.)?gate_step_refs\b/i);
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

  it('opens on the DELETE refusal and returns once, at the end', () => {
    const b = body();
    // An early RETURN OLD for gate_step_refs (or any early exit) has to sit
    // before the DELETE refusal or add a second RETURN; both fail here.
    expect(b).toMatch(/AS \$\$ BEGIN IF TG_OP = 'DELETE' THEN RAISE /);
    expect(b.match(/\bRETURN\b/gi) ?? []).toHaveLength(1);
    expect(b).toMatch(/ END IF; RETURN NEW; END; \$\$;$/);
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
      const p = [...CODE.matchAll(new RegExp(`^[ \\t]*CREATE\\s+POLICY\\s+"?(\\w+)"?\\s+ON\\s+(?:public\\.)?${t}\\s+([^;]*);`, 'gim'))]
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
    expect(CODE).not.toMatch(/\bON\s+(?:public\.)?gate_(?:step_)?refs\s+FOR\s+(?:DELETE|ALL)\b/i);
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
    const fns = CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*?\$\$;/gi) ?? [];
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
      // fnText throws, naming the file, on a definition it cannot read, so a
      // later helper in another shape can never be skipped here.
      const latest = files
        .map((f) => fnText(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')), sig, f))
        .find(Boolean);
      expect(fnBody(sig)).toBe(latest);
    }
  });

  it('no later migration changes an object that re-pasting 096 would revert', () => {
    // CREATE OR REPLACE, DROP/CREATE POLICY and DROP/CREATE TRIGGER all win on a
    // re-paste. If this fails, bring 096 up to date in the same change, then
    // compare definitions here the way the helper test does.
    const reverted: Array<[string, RegExp]> = [
      [
        'a policy on rooms, gate_refs or gate_step_refs',
        /\bPOLICY\s+(?:IF\s+EXISTS\s+)?"?\w+"?\s+ON\s+(?:public\.)?(?:rooms|gate_refs|gate_step_refs)\b/i,
      ],
      [
        'rooms_freeze_code() or gate_refs_immutable_code()',
        /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|DROP\s+)FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(?:rooms_freeze_code|gate_refs_immutable_code)\b/i,
      ],
      [
        "one of 096's triggers",
        /\bTRIGGER\s+(?:IF\s+EXISTS\s+)?"?(?:rooms_freeze_code_trg|gate_refs_immutable_trg|gate_step_refs_immutable_trg)\b/i,
      ],
    ];
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 96);
    const touching = later.flatMap((f) => {
      const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      return reverted.filter(([, re]) => re.test(sql)).map(([what]) => `${f} changes ${what}; re-pasting 096 would revert it`);
    });
    expect(touching).toEqual([]);
  });
});
