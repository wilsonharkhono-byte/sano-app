/**
 * Static guard for migration 093 (the principal is on every project by default).
 *
 * User rule (2026-08-26): "make the principal level to be by default in all
 * project that is generated in the future as well. i don't need to input
 * myself into the project first before i can add more people."
 *
 * Like the 088–092 suites, this touches no database. Two risks are guarded:
 *   1. Silent revert — 093 RE-CREATES enforce_principal_assignment_guard
 *      (live since 090). Re-pasting 090 after 093 removes the nested-write
 *      carve-out and the auto-assign dies inside its EXCEPTION wrapper.
 *   2. Silent weakening — the carve-out must not have loosened any of 090's
 *      protections (only-a-principal-touches-principal-rows, cascade
 *      passthrough, trusted-context passthrough).
 */
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '093_principal_default_membership.sql'), 'utf8');
const SQL_090 = fs.readFileSync(path.join(MIGRATIONS, '090_principal_seat_principal_only.sql'), 'utf8');

/** A named function's body as defined by a migration's text. */
function fnBody(sql: string, name: string): string {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name}[\\s\\S]*?\\n\\$\\$;`);
  const m = sql.match(re);
  if (!m) throw new Error(`${name} not found`);
  return m[0];
}

describe('migration 093 — auto-assign triggers', () => {
  it('every new project gets every principal (AFTER INSERT ON projects)', () => {
    expect(SQL).toMatch(/CREATE TRIGGER projects_auto_assign_principals_trg\s*\n\s*AFTER INSERT ON projects/);
    const body = fnBody(SQL, 'auto_assign_principals_to_project');
    expect(body).toMatch(/WHERE p\.role = 'principal'/);
    expect(body).toMatch(/ON CONFLICT \(project_id, user_id\) DO NOTHING/);
  });

  it('a newly seated principal joins every existing project', () => {
    expect(SQL).toMatch(/CREATE TRIGGER profiles_principal_membership_trg\s*\n\s*AFTER INSERT OR UPDATE OF role ON profiles/);
    const body = fnBody(SQL, 'auto_assign_principal_to_all_projects');
    expect(body).toMatch(/IF NEW\.role <> 'principal' THEN\s*\n\s*RETURN NULL;/);
    // Fires only on a real seat change, not on unrelated profile updates.
    expect(body).toMatch(/OLD\.role IS NOT DISTINCT FROM NEW\.role/);
    expect(body).toMatch(/ON CONFLICT \(project_id, user_id\) DO NOTHING/);
  });

  it('membership auto-assign can never make the business write fail', () => {
    for (const name of ['auto_assign_principals_to_project', 'auto_assign_principal_to_all_projects']) {
      const body = fnBody(SQL, name);
      expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN/);
      expect(body).toMatch(/RAISE WARNING/);
    }
  });

  it('back-fills current principals onto current projects, re-paste-safe', () => {
    expect(SQL).toMatch(/INSERT INTO project_assignments \(project_id, user_id\)\s*\n\s*SELECT pr\.id, p\.id\s*\n\s*FROM projects pr\s*\n\s*CROSS JOIN profiles p\s*\n\s*WHERE p\.role = 'principal'\s*\n\s*ON CONFLICT \(project_id, user_id\) DO NOTHING/);
  });
});

describe('migration 093 — the 090 guard is extended, not weakened', () => {
  const guard = () => fnBody(SQL, 'enforce_principal_assignment_guard');

  it("preserves every line of 090's enforce_principal_assignment_guard", () => {
    const before = fnBody(SQL_090, 'enforce_principal_assignment_guard')
      .split('\n').map(l => l.trim()).filter(Boolean);
    const after = new Set(guard().split('\n').map(l => l.trim()).filter(Boolean));
    const dropped = before.filter(l => !after.has(l));
    expect(dropped).toEqual([]);
  });

  it('adds ONLY the nested-write carve-out (088 carve-out 3 precedent)', () => {
    expect(guard()).toMatch(/IF pg_trigger_depth\(\) > 1 THEN\s*\n\s*RETURN v_row;/);
  });

  it('the carve-out sits AFTER the trusted-context branch and BEFORE the role checks', () => {
    const g = guard();
    const trusted = g.indexOf('IF auth.uid() IS NULL THEN');
    const nested = g.indexOf('pg_trigger_depth() > 1');
    const roleCheck = g.indexOf("v_actor_role <> 'principal'");
    expect(trusted).toBeGreaterThan(-1);
    expect(nested).toBeGreaterThan(trusted);
    expect(roleCheck).toBeGreaterThan(nested);
  });

  it('still refuses a direct non-principal actor touching a principal row', () => {
    expect(guard()).toMatch(/RAISE EXCEPTION 'principal team membership may only be changed by a principal/);
  });

  it('re-creates the guard trigger so the function swap cannot be half-applied', () => {
    expect(SQL).toMatch(/DROP TRIGGER IF EXISTS project_assignments_principal_guard_trg/);
    expect(SQL).toMatch(/CREATE TRIGGER project_assignments_principal_guard_trg\s*\n\s*BEFORE INSERT OR DELETE ON project_assignments/);
  });
});

describe('migration 093 — scope and re-paste safety', () => {
  it('touches no policies and no other live functions', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/);
    expect(SQL.match(/CREATE OR REPLACE FUNCTION/g) ?? []).toHaveLength(3);
    // 090's OTHER function (the profiles.role seat lock) is deliberately
    // untouched — re-pasting 093 must never revert or duplicate it.
    expect(SQL).not.toMatch(/enforce_profile_role_immutable/);
  });

  it('is re-paste safe', () => {
    expect(SQL).not.toMatch(/^\s*CREATE FUNCTION/m);
    const creates = SQL.match(/CREATE TRIGGER (\w+)/g) ?? [];
    const drops = SQL.match(/DROP TRIGGER IF EXISTS (\w+)/g) ?? [];
    expect(drops.length).toBe(creates.length);
  });
});

describe.skip('migration 093 — live DB (awaiting the user pasting 093)', () => {
  it.todo('an admin creating a project succeeds and the principal appears on its roster');
  it.todo('a principal creating a project has exactly one assignment row (no dup)');
  it.todo('an admin still cannot add or remove a principal directly');
  it.todo('principal-targeted notifications (PLAN_CEILING_RAISE) now deliver on every project');
});
