/**
 * Static guard for migration 103 (stage weights per BoQ row).
 *
 * Migrations are pasted into the Supabase Dashboard, so the SQL text is the
 * artifact under test. Guards read CODE, the file with every full-line comment
 * removed, so the header or the self-check can never satisfy a guard the SQL
 * fails. Behaviour as real roles is rehearsed on Postgres by
 * supabase/tests/progress_claims_rehearsal/run.sh.
 *
 *  • reference_stage_weights() holds the generated profile, class for class,
 *    so the app and the database never apply different weights to one row.
 *  • The client sends a class, never numbers, and seeding never overwrites.
 *  • Every refusal code has an Indonesian sentence in claimRules.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLAIM_RPC_ERROR_COPY } from '../progressClaims/claimRules';
import { REFERENCE_PROFILE } from '../progressClaims/referenceStageWeights.data';
import { WEIGHT_SUM_TOLERANCE, referenceWeightsFor } from '../progressClaims/stageWeights';
import { WORK_AREA_CLASSES } from '../progressClaims/workAreaClass';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FILE = '103_boq_stage_weights.sql';
const stripComments = (src: string): string => src.replace(/^\s*--.*$/gm, '');
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const CODE = stripComments(SQL);

function fnBody(name: string): string {
  const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined in ${FILE}`);
  const open = CODE.indexOf('$$', start);
  const close = CODE.indexOf('$$;', open + 2);
  return CODE.slice(start, close + 3);
}

const WRITERS = ['seed_reference_stage_weights', 'set_boq_stage_weights', 'reset_boq_stage_weights'];

describe('migration 103 - header states why, paste order and re-paste safety', () => {
  it('links the spec and the plan', () => {
    expect(SQL).toMatch(/2026-09-13-report-driven-progress-design\.md/);
    expect(SQL).toMatch(/2026-09-14-report-driven-progress-plan-b\.md/);
  });

  it('names its place in the paste order, after 102 and before 104', () => {
    expect(SQL).toMatch(/PASTE ORDER\. After 102\./);
    expect(SQL).toMatch(/paste 104 after this file/);
  });

  it('says what makes a second paste safe and names this suite', () => {
    expect(SQL).toMatch(/RE-PASTE SAFETY/);
    expect(SQL).toMatch(/migration103\.test\.ts/);
  });

  it('carries a self-check a human can run after pasting', () => {
    expect(SQL).toMatch(/SELF-CHECK \(run after pasting; writes nothing\)/);
    expect(SQL.match(/EXPECTED:/g) ?? []).toHaveLength(6);
  });
});

describe('migration 103 - paste ergonomics', () => {
  it("sets lock_timeout = '5s' as the first statement and resets it once", () => {
    expect(CODE.trimStart()).toMatch(/^SET lock_timeout = '5s';\n/);
    expect(CODE.match(/^[ \t]*RESET\s+lock_timeout\s*;/gim) ?? []).toHaveLength(1);
  });

  it('ends on a grid showing each function, its security mode and that anon cannot run it', () => {
    expect(CODE.trimEnd()).toMatch(
      /SELECT proname, prosecdef, has_function_privilege\('anon', oid, 'EXECUTE'\) AS anon_exec\s+FROM pg_proc\s+WHERE proname IN \([^)]*\)\s+ORDER BY proname;$/,
    );
  });
});

describe('migration 103 - a second paste cannot fail', () => {
  it('creates its table only when missing and never drops a table or function', () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS boq_stage_weights \(/);
    expect(CODE).not.toMatch(/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(CODE).not.toMatch(/\bDROP\s+(?:TABLE|FUNCTION)\b/i);
  });

  it('defines all eight functions with CREATE OR REPLACE', () => {
    const all = CODE.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? [];
    expect(all).toHaveLength(8);
    expect(CODE.match(/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/gi) ?? []).toHaveLength(8);
  });

  it('drops its one policy before creating it', () => {
    const drop = CODE.indexOf('DROP POLICY IF EXISTS boq_stage_weights_select ON boq_stage_weights;');
    const create = CODE.indexOf('CREATE POLICY boq_stage_weights_select ON boq_stage_weights');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });
});

describe('migration 103 - the reference profile is the generated one', () => {
  const body = fnBody('reference_stage_weights');
  const sqlProfile: Record<string, unknown> = Object.fromEntries(
    [...body.matchAll(/WHEN '(\w+)'\s+THEN '(\{[^']+\})'::jsonb/g)].map((m) => [m[1], JSON.parse(m[2]) as unknown]),
  );

  it('names every work-area class once and nothing else', () => {
    expect(Object.keys(sqlProfile).sort()).toEqual([...WORK_AREA_CLASSES].sort());
  });

  it('gives each class exactly the weights the app applies', () => {
    for (const cls of WORK_AREA_CLASSES) {
      expect({ cls, weights: sqlProfile[cls] }).toEqual({ cls, weights: referenceWeightsFor(cls, REFERENCE_PROFILE) });
    }
  });

  it('returns NULL for an unknown class, so a caller cannot invent one', () => {
    expect(body).toMatch(/ELSE NULL\s+END;/);
  });
});

describe('migration 103 - the shape rule matches validateStageWeights', () => {
  const body = fnBody('stage_weights_valid');

  it('accepts SINGLE only as the number 1', () => {
    expect(body).toMatch(/= ARRAY\['SINGLE'\] THEN\s+CASE WHEN jsonb_typeof\(p_weights -> 'SINGLE'\) = 'number'\s+THEN \(p_weights ->> 'SINGLE'\)::numeric = 1/);
  });

  it('requires exactly the three stages, each 0 to 1, summing to 1 within the app tolerance', () => {
    expect(body).toMatch(/= ARRAY\['BEKISTING', 'PEMBESIAN', 'PENGECORAN'\] THEN/);
    expect(body).toMatch(/BETWEEN 0 AND 1\)/);
    expect(body).toContain(`- 1) <= ${WEIGHT_SUM_TOLERANCE}`);
    expect(CODE).toMatch(/CONSTRAINT boq_stage_weights_shape CHECK \(stage_weights_valid\(weights\)\)/);
  });

  it('is a pure function', () => {
    expect(body).toMatch(/LANGUAGE sql IMMUTABLE/);
  });
});

describe('migration 103 - who may write weights', () => {
  it('runs the actor check and every writer as SECURITY DEFINER with search_path pinned', () => {
    for (const fn of ['progress_actor_role', ...WRITERS]) {
      expect(fnBody(fn)).toMatch(/SECURITY DEFINER SET search_path = public/);
    }
  });

  it('refuses a session-less caller outright, service role included', () => {
    const body = fnBody('progress_actor_role');
    expect(body).toMatch(/IF v_uid IS NULL THEN\s+RAISE EXCEPTION 'CLAIM_AUTH:/);
    expect(body).not.toMatch(/service_role/);
  });

  it('checks membership or office role before the role list', () => {
    const body = fnBody('progress_actor_role');
    const member = body.indexOf('IF NOT (is_project_member(p_project_id) OR is_office_role()) THEN');
    const role = body.indexOf('IF v_role IS NULL OR NOT (v_role = ANY (p_allowed_roles)) THEN');
    expect(member).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(member);
  });

  it('lets supervisors seed but only estimators and admins set or reset', () => {
    expect(fnBody('seed_reference_stage_weights')).toContain("PERFORM progress_actor_role(p_project_id, ARRAY['supervisor', 'estimator', 'admin']);");
    for (const fn of ['set_boq_stage_weights', 'reset_boq_stage_weights']) {
      expect(fnBody(fn)).toContain("PERFORM progress_actor_role(v_item.project_id, ARRAY['estimator', 'admin']);");
    }
  });

  it('seeds from a class only and never overwrites a row', () => {
    const body = fnBody('seed_reference_stage_weights');
    expect(body).toContain('v_weights := reference_stage_weights(v_class);');
    expect(body).toContain('ON CONFLICT DO NOTHING;');
    expect(body).not.toMatch(/DO UPDATE/);
    expect(body).not.toMatch(/->>?\s*'weights'/);
  });

  it('refuses a row of another project or a superseded row', () => {
    expect(fnBody('seed_reference_stage_weights')).toContain('v_item.project_id <> p_project_id OR v_item.superseded_at IS NOT NULL');
    for (const fn of ['set_boq_stage_weights', 'reset_boq_stage_weights']) {
      expect(fnBody(fn)).toMatch(/IF v_item\.superseded_at IS NOT NULL THEN\s+RAISE EXCEPTION 'CLAIM_ROW:/);
      expect(fnBody(fn)).toContain('VALUES (v_item.project_id, v_item.id,');
    }
  });

  it('gives the table a read policy and no write policy', () => {
    expect(CODE.match(/\bCREATE POLICY\b/g) ?? []).toHaveLength(1);
    expect(CODE).toMatch(
      /CREATE POLICY boq_stage_weights_select ON boq_stage_weights\s+FOR SELECT TO authenticated\s+USING \(is_project_member\(project_id\) OR is_office_role\(\)\);/,
    );
  });
});

describe('migration 103 - privileges', () => {
  it.each([
    'stage_weights_valid(JSONB)',
    'reference_stage_weights(TEXT)',
    'seed_reference_stage_weights(UUID, JSONB)',
    'set_boq_stage_weights(UUID, JSONB)',
    'reset_boq_stage_weights(UUID, TEXT)',
  ])('revokes %s from PUBLIC and anon, then grants authenticated and service_role', (sig) => {
    const revoke = CODE.indexOf(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon;`);
    const grant = CODE.indexOf(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('keeps the actor check away from every client role', () => {
    expect(CODE).toContain('REVOKE ALL ON FUNCTION progress_actor_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;');
    expect(CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION progress_actor_role\(UUID, TEXT\[\]\) TO [^;]*authenticated/);
  });
});

describe('migration 103 - refusals the app can explain', () => {
  it('raises only codes that claimRules.ts turns into a sentence', () => {
    const copy = new Set(CLAIM_RPC_ERROR_COPY.map(([code]) => code));
    const raised = [...new Set([...CODE.matchAll(/RAISE EXCEPTION '([A-Z_]+):/g)].map((m) => m[1]))];
    expect(raised.length).toBeGreaterThan(0);
    expect(raised.filter((code) => !copy.has(code))).toEqual([]);
  });
});

describe('migration 103 - nothing later reverts it', () => {
  it('no migration above 103 redefines a 103 function other than the shared inlined helpers', () => {
    const names = ['progress_actor_role', 'stage_weights_valid', 'reference_stage_weights', ...WRITERS];
    const re = new RegExp(
      `\\b(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?|DROP\\s+)FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?(?:${names.join('|')})\\b`,
      'i',
    );
    const later = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 103);
    expect(later.filter((f) => re.test(stripComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))))).toEqual([]);
  });
});
