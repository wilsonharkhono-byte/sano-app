/**
 * Static guard for migration 107 (DATUM sync).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so a comment can never satisfy a guard the SQL fails. Behaviour as
 * real roles (each guard trigger, the confirmer stamp, the pairing RPC, RLS on
 * the three tables, the scheduler with and without pg_cron) is rehearsed on
 * Postgres by supabase/tests/datum_sync_rehearsal/run.sh.
 *
 *  • gate_refs takes DATUM's words for A-H, and nothing else in gate_refs moves.
 *  • The pairing is upper case, unique, and set through one office-only RPC.
 *  • rooms.datum_area_id, the four new site_events columns and
 *    profiles.datum_staff_id are written by the sync, never by an app role.
 *  • confirmed_by is stamped from auth.uid() the moment confirmed_at is set.
 *  • Three tables, RLS on, SELECT policies only; one open run per project.
 *  • The hourly request is scheduled only where pg_cron exists, with no URL
 *    and no secret in the file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AREA_TYPES } from '../constants';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '107_datum_sync.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const read = (f: string): string => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const SQL = read(FILE);
const CODE = stripComments(SQL);
const FILES = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

function fnBody(name: string, code = CODE): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const open = code.indexOf('$$', start);
  const close = code.indexOf('$$;', open + 2);
  return code.slice(start, close + 3);
}

/** Every CREATE [OR REPLACE] FUNCTION in a file, as [name, text]. */
function functions(code: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const open = code.indexOf('$$', m.index);
    const close = code.indexOf('$$', open + 2);
    if (open < 0 || close < 0) continue;
    out.push([m[1], code.slice(m.index, close + 2)]);
  }
  return out;
}

/** Spec §3's table, verbatim. */
const GATE_WORDS: Record<string, [string, string, string]> = {
  A: ['MEP Rough-in + Persiapan Struktural', 'MEP Rough-in', 'Penarikan seluruh sistem MEP dan persiapan struktural untuk menerima finishing.'],
  B: ['Pekerjaan Basah / Waterproofing', 'Pekerjaan Basah', 'Material dinding/lantai (marmer/batu alam) dan sanitair. Sebelum plafon kamar mandi ditutup.'],
  C: ['Plafon & Penutupan Selubung', 'Plafon', 'Penutupan plafon setelah MEP + kamar mandi selesai. Kusen kayu + kaca enclosure.'],
  D: ['Finishing Lantai, Dinding & Kusen Aluminium', 'Lantai & Kusen', 'Finalisasi jenis finishing lantai per ruangan dan spesifikasi kusen aluminium.'],
  E: ['Finishing Permukaan + Ironwork', 'Cat & Ironwork', 'Cat dinding/plafon, cat duco, ironwork. Landscape mulai paralel.'],
  F: ['Furniture Built-in & Interior', 'Furniture', 'Kitchen set, wardrobe, wall panel, TV unit. Dipasang sebelum MEP fit-out.'],
  G: ['MEP Fit-out', 'MEP Fit-out', 'Saklar, stop kontak, AC, sanitair fixtures, smart home, network/CTV. Sesuai layout furniture.'],
  H: ['Penyelesaian Akhir & Serah Terima', 'Serah Terima', 'Kaca shower, lampu dekoratif, poles marmer, general cleaning, punch list.'],
};

const DATUM_AREA_TYPES = [
  'bathroom', 'kitchen', 'bedroom', 'living', 'dining', 'garden', 'circulation', 'utility', 'general',
  'facade', 'terrace', 'hall', 'exterior',
];

/** Sync-only columns whose names no other table uses. */
const SYNC_ONLY_COLUMNS = /\b(?:datum_card_id|datum_card_url|datum_escalated_at|datum_area_id|datum_staff_id)\b/;

describe('migration 107 - header states why, paste order and what a re-paste undoes', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-27-datum-sync-design\.md/);
    expect(SQL).toMatch(/plans\/2026-09-27-datum-sync\.md/);
  });

  it('pastes after 106, and says re-pasting 101 restores the old words', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 106\./);
    expect(SQL).toMatch(/Re-pasting 101 after 107\s+-- restores SANO's old gate words: re-paste 107 after it\./);
    expect(SQL).toMatch(/overwriting any edit made in\s+-- "Kelola gerbang" since the first paste/);
  });

  it('says it is re-paste safe and carries a self-check', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/SELF-CHECK/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(9);
  });

  it('holds no URL, no bearer and no project host, and never posts over HTTP', () => {
    for (const bad of [/Bearer/, /https?:/i, /supabase\.co/, /net\.http_post/]) expect(SQL).not.toMatch(bad);
  });

  it('never mentions profiles.active: the live profiles table has no such column', () => {
    expect(SQL).not.toMatch(/profiles\.active\b/);
    expect(CODE).not.toMatch(/FROM profiles[^;]*\bactive\b/);
  });
});

describe('migration 107 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('changes nothing after RESET: the grid is a SELECT', () => {
    const tail = CODE.slice(CODE.indexOf('RESET lock_timeout;') + 'RESET lock_timeout;'.length);
    expect(tail).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/);
    expect(tail).toMatch(/SELECT g\.code, g\.short_label, g\.name_id, g\.datum_gate_code,/);
  });
});

describe("migration 107 - DATUM's gate words", () => {
  const updates = [...CODE.matchAll(/UPDATE gate_refs SET([\s\S]*?)WHERE code = '([A-H])';/g)];

  it('runs exactly eight UPDATEs, A to H, and no INSERT or DELETE on gate_refs', () => {
    expect(updates.map((m) => m[2])).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(CODE.match(/UPDATE gate_refs/g) ?? []).toHaveLength(8);
    expect(CODE).not.toMatch(/INSERT INTO gate_refs|DELETE FROM gate_refs|gate_step_refs/);
  });

  it.each(Object.entries(GATE_WORDS))('%s sets exactly name_id, short_label, description and datum_gate_code = code', (code, words) => {
    const set = updates.find((m) => m[2] === code)?.[1] ?? '';
    const columns = [...set.matchAll(/^\s*(\w+)\s*=/gm)].map((m) => m[1]);
    expect(columns).toEqual(['name_id', 'short_label', 'description', 'datum_gate_code']);
    const esc = (s: string) => s.replace(/'/g, "''");
    expect(set).toContain(`name_id         = '${esc(words[0])}'`);
    expect(set).toContain(`short_label     = '${esc(words[1])}'`);
    expect(set).toContain(`description     = '${esc(words[2])}'`);
    expect(set).toMatch(/datum_gate_code = code\s*$/);
  });
});

describe('migration 107 - the pairing', () => {
  it('guards the shape with a CHECK added once, and a partial unique index', () => {
    expect(CODE).toContain("WHERE conname = 'projects_datum_project_code_shape' AND conrelid = 'public.projects'::regclass");
    expect(CODE).toContain(
      "CHECK (datum_project_code IS NULL\n             OR (datum_project_code = upper(btrim(datum_project_code)) AND datum_project_code <> ''));",
    );
    expect(CODE).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_datum_project_code\n  ON projects (datum_project_code) WHERE datum_project_code IS NOT NULL;',
    );
  });

  it('sets it through a DEFINER RPC any office role may call, anon never', () => {
    const fn = fnBody('set_datum_project_code');
    expect(CODE.indexOf('DROP FUNCTION IF EXISTS set_datum_project_code(UUID, TEXT);')).toBeLessThan(
      CODE.indexOf('CREATE OR REPLACE FUNCTION set_datum_project_code('),
    );
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    expect(fn).toMatch(/IF NOT is_office_role\(\) THEN\s+RAISE EXCEPTION 'DATUM_PAIRING_AUTH: hanya admin, prinsipal atau estimator'/);
    expect(fn).toContain("v_code TEXT := NULLIF(upper(btrim(COALESCE(p_code, ''))), '');");
    expect(fn).toMatch(/EXCEPTION WHEN unique_violation THEN\s+RAISE EXCEPTION 'DATUM_PAIRING_TAKEN: kode DATUM ini sudah dipakai proyek lain';/);
    expect(fn).toContain("RAISE EXCEPTION 'DATUM_PAIRING_PROJECT: proyek tidak ditemukan';");
    expect(fn).toContain("RETURN jsonb_build_object('code', v_code);");
    expect(CODE).toContain('REVOKE ALL ON FUNCTION set_datum_project_code(UUID, TEXT) FROM PUBLIC, anon;');
    expect(CODE).toContain('GRANT EXECUTE ON FUNCTION set_datum_project_code(UUID, TEXT) TO authenticated;');
  });

  it('adds no trigger on projects', () => {
    expect(CODE).not.toMatch(/CREATE TRIGGER[^;]*\bON projects\b/);
  });
});

describe("migration 107 - rooms take DATUM's thirteen types", () => {
  const block = () => {
    const start = CODE.indexOf("WHERE conname = 'rooms_area_type_check'");
    return CODE.slice(start, CODE.indexOf('END $$;', start));
  };

  it("swaps the CHECK only when it lacks 'exterior'", () => {
    expect(block()).toContain("IF v_def IS NULL OR v_def NOT LIKE '%''exterior''%' THEN");
    expect(block().indexOf('DROP CONSTRAINT IF EXISTS rooms_area_type_check')).toBeLessThan(block().indexOf('ADD CONSTRAINT rooms_area_type_check'));
  });

  it("lists exactly DATUM's thirteen, which is exactly the app's AREA_TYPES", () => {
    const list = [...(block().match(/CHECK \(area_type IN \(([\s\S]*?)\)\)/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(list).toEqual(DATUM_AREA_TYPES);
    expect(AREA_TYPES.map((t) => t.value)).toEqual(list);
  });
});

describe('migration 107 - sync-only columns', () => {
  const GUARDS: Array<[string, string, string, string]> = [
    ['rooms_datum_area_id_sync_only', 'rooms_datum_area_id_sync_only_trg', 'rooms', 'ROOM_DATUM_LINK_SYNC_ONLY:'],
    ['site_events_system_columns_guard', 'site_events_system_columns_guard_trg', 'site_events', 'SITE_EVENT_SYSTEM_COLUMNS:'],
    ['profiles_datum_staff_id_sync_only', 'profiles_datum_staff_id_sync_only_trg', 'profiles', 'PROFILE_DATUM_LINK_SYNC_ONLY:'],
  ];

  it.each(GUARDS)('%s is its own function, run BEFORE INSERT OR UPDATE by %s on %s', (fn, trg, table, code) => {
    const body = fnBody(fn);
    expect(body).toMatch(/RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public/);
    expect(body).toMatch(
      /IF COALESCE\(auth\.role\(\), ''\) = 'service_role'\s+OR current_user NOT IN \('authenticated', 'anon'\) THEN\s+RETURN NEW;\s+END IF;/,
    );
    expect(body).toContain(`RAISE EXCEPTION '${code}`);
    expect(body).toContain("USING ERRCODE = 'insufficient_privilege';");
    expect(CODE.indexOf(`DROP TRIGGER IF EXISTS ${trg} ON ${table};`)).toBeGreaterThan(-1);
    expect(CODE).toContain(`CREATE TRIGGER ${trg}\n  BEFORE INSERT OR UPDATE ON ${table}\n  FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
  });

  it('the event guard covers the three datum columns and confirmed_by on INSERT and UPDATE', () => {
    const body = fnBody('site_events_system_columns_guard');
    for (const col of ['datum_card_id', 'datum_card_url', 'datum_escalated_at', 'confirmed_by']) {
      expect(body).toContain(`NEW.${col} IS NOT NULL`);
      expect(body).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`);
    }
  });

  it("the room guard's UPDATE branch compares NEW.datum_area_id IS DISTINCT FROM OLD.datum_area_id, not just non-null: a rename of an already-linked room must stay allowed", () => {
    const body = fnBody('rooms_datum_area_id_sync_only');
    expect(body).toContain('NEW.datum_area_id IS DISTINCT FROM OLD.datum_area_id');
  });

  it("the profile guard's UPDATE branch compares NEW.datum_staff_id IS DISTINCT FROM OLD.datum_staff_id, not just non-null: a self-rename of an already-linked person must stay allowed", () => {
    const body = fnBody('profiles_datum_staff_id_sync_only');
    expect(body).toContain('NEW.datum_staff_id IS DISTINCT FROM OLD.datum_staff_id');
  });

  it('stamps confirmed_by from auth.uid() before the bypass, only when confirmed_at first turns non-null', () => {
    const body = fnBody('site_events_system_columns_guard');
    const stamp = body.indexOf(
      "IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN\n    NEW.confirmed_by := auth.uid();\n  END IF;",
    );
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(body.indexOf("COALESCE(auth.role(), '') = 'service_role'"));
    expect(body.match(/NEW\.confirmed_by :=/g) ?? []).toHaveLength(1);
  });

  it('adds the four event columns, the escalation index, and the unique staff link index', () => {
    for (const line of [
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_id      UUID;',
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_card_url     TEXT;',
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS datum_escalated_at TIMESTAMPTZ;',
      'ALTER TABLE site_events ADD COLUMN IF NOT EXISTS confirmed_by       UUID REFERENCES profiles(id);',
      "  WHERE status = 'open' AND event_type = 'butuh_keputusan' AND datum_card_id IS NULL;",
      'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS datum_staff_id UUID;',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_datum_staff_id\n  ON profiles (datum_staff_id) WHERE datum_staff_id IS NOT NULL;',
    ]) {
      expect(CODE).toContain(line);
    }
  });

  it('across every migration, only these three guards name a sync-only column inside a function', () => {
    const offenders = FILES.flatMap((f) =>
      functions(stripComments(read(f)))
        .filter(([name, text]) => SYNC_ONLY_COLUMNS.test(text) && !(f === FILE && GUARDS.some(([g]) => g === name)))
        .map(([name]) => `${f}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('no function that touches site_events names confirmed_by: only the stamp sets it', () => {
    // Worker attendance (017) and client report lines (102) have their own
    // confirmed_by columns; only site_events' is sync-only.
    const offenders = FILES.flatMap((f) =>
      functions(stripComments(read(f)))
        .filter(([, text]) => /\bsite_events\b/.test(text) && /\bconfirmed_by\b/.test(text))
        .map(([name]) => `${f}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('migration 107 - leaves 096-105 alone', () => {
  it('redefines no function of 096, 097, 099, 100 or 105', () => {
    const theirs = ['096_rooms_gates_phase.sql', '097_site_events.sql', '099_site_event_assignment.sql', '100_confirm_vo_evidence_recheck.sql', '105_close_site_event_evidence.sql']
      .flatMap((f) => functions(stripComments(read(f))).map(([name]) => name));
    const mine = functions(CODE).map(([name]) => name);
    expect(mine.filter((n) => theirs.includes(n))).toEqual([]);
  });

  it('creates no policy on rooms, gate_refs or gate_step_refs', () => {
    expect(CODE).not.toMatch(/\bPOLICY\s+(?:IF\s+EXISTS\s+)?"?\w+"?\s+ON\s+(?:public\.)?(?:rooms|gate_refs|gate_step_refs)\b/i);
  });
});

describe('migration 107 - the three tables', () => {
  const TABLES: Array<[string, string, string]> = [
    ['datum_sync_runs', 'datum_sync_runs_read', 'is_project_member(project_id) OR is_office_role()'],
    ['room_datum_gate_status', 'room_datum_gate_status_read', 'is_project_member(project_id) OR is_office_role()'],
    ['datum_sync_requests', 'datum_sync_requests_office_read', 'is_office_role()'],
  ];

  it.each(TABLES)('%s: RLS on, one SELECT policy, no write policy', (table, policy, using) => {
    expect(CODE).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    expect(CODE).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    expect(CODE.indexOf(`DROP POLICY IF EXISTS ${policy} ON ${table};`)).toBeGreaterThan(-1);
    const policies = [...CODE.matchAll(new RegExp(`CREATE POLICY (\\w+) ON ${table}\\s+FOR (\\w+) USING \\(([^;]*)\\);`, 'g'))];
    expect(policies.map((m) => [m[1], m[2], m[3]])).toEqual([[policy, 'SELECT', using]]);
    expect(CODE).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON ${table}[^;]*FOR (?:INSERT|UPDATE|DELETE|ALL)`));
  });

  it('runs: three sources, one open run per project, newest first', () => {
    expect(CODE).toContain("source        TEXT NOT NULL CHECK (source IN ('manual', 'cron', 'import')),");
    expect(CODE).toContain('CREATE UNIQUE INDEX IF NOT EXISTS datum_sync_runs_one_open\n  ON datum_sync_runs(project_id) WHERE finished_at IS NULL;');
    expect(CODE).toContain('ON datum_sync_runs(project_id, started_at DESC);');
  });

  it("the cache: DATUM's six readiness states, keyed by room and gate", () => {
    expect(CODE).toContain(
      "CHECK (status IN ('not_started', 'in_progress', 'ready_for_handoff', 'blocked', 'passed', 'not_applicable')),",
    );
    expect(CODE).toContain('PRIMARY KEY (room_id, gate_code)');
    expect(CODE).toContain('room_id              UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,');
  });
});

describe('migration 107 - scheduler', () => {
  const cronBlock = (): string => {
    const start = CODE.indexOf("IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN");
    return CODE.slice(start, CODE.indexOf('END $$;', start));
  };

  it('schedules only when pg_cron exists, unscheduling the old job first', () => {
    const block = cronBlock();
    expect(block).toContain("IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'datum_sync_hourly') THEN");
    expect(block.indexOf("PERFORM cron.unschedule('datum_sync_hourly');")).toBeLessThan(block.indexOf('cron.schedule('));
    expect(block).toContain("PERFORM cron.schedule('datum_sync_hourly', '0 * * * *',");
  });

  it('inserts one request per paired ACTIVE project, and nothing else', () => {
    expect(cronBlock()).toMatch(
      /\$cmd\$INSERT INTO public\.datum_sync_requests \(project_id\)\s+SELECT id FROM public\.projects\s+WHERE datum_project_code IS NOT NULL AND status = 'ACTIVE'\$cmd\$/,
    );
  });

  it('tells the person pasting how to turn Cron on when it is off', () => {
    expect(cronBlock()).toMatch(/RAISE NOTICE '107: pg_cron belum aktif\. Aktifkan Cron di Dashboard \(Integrations → Cron\), lalu paste 107 lagi\./);
  });

  it('is the last thing that changes anything before RESET', () => {
    expect(CODE.indexOf('PERFORM cron.schedule(')).toBeLessThan(CODE.indexOf('RESET lock_timeout;'));
  });
});
