/**
 * Static guard for migration 078 (plan_revisions audit trail).
 *
 * Does NOT touch a database. Asserts the frozen public-contract surface the
 * client publish path + notifications depend on: the two tables, the
 * append-only RLS shape (SELECT/INSERT only, no UPDATE/DELETE policy), the
 * classification CHECK domain, the widened notification type, and the
 * notify_plan_revised RPC. If someone edits 078 and drops one of these, the
 * TS wiring in publishBaselineV2 / BaselineScreen would silently diverge —
 * this fails first.
 */
import fs from 'node:fs';
import path from 'node:path';

const SQL = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/078_plan_revisions.sql'),
  'utf8',
);

describe('migration 078 — frozen contract surface', () => {
  it('creates both tables idempotently', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS plan_revisions\b/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS plan_revision_lines\b/);
  });

  it('plan_revisions carries the spec columns (old nullable, new not null, summary jsonb)', () => {
    expect(SQL).toMatch(/old_ahs_version_id\s+UUID REFERENCES ahs_versions/);
    expect(SQL).toMatch(/new_ahs_version_id\s+UUID NOT NULL REFERENCES ahs_versions/);
    expect(SQL).toMatch(/acknowledged_at\s+TIMESTAMPTZ/);
    expect(SQL).toMatch(/summary\s+JSONB NOT NULL/);
  });

  it('plan_revision_lines FK-cascades on the revision and records before/after/at-time', () => {
    expect(SQL).toMatch(/revision_id\s+UUID NOT NULL REFERENCES plan_revisions\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/planned_before\s+NUMERIC NOT NULL/);
    expect(SQL).toMatch(/planned_after\s+NUMERIC NOT NULL/);
    expect(SQL).toMatch(/ordered_at_time\s+NUMERIC/);
    expect(SQL).toMatch(/requested_at_time\s+NUMERIC/);
  });

  it('classification CHECK holds all seven classes', () => {
    for (const cls of [
      'RAISE_ABSOLVING_OVERAGE',
      'RAISE',
      'LOWER_BELOW_ORDERED',
      'REMOVED_WITH_ACTIVITY',
      'ADDED',
      'LOWER',
      'UNCHANGED_SUMMARY',
    ]) {
      expect(SQL).toContain(`'${cls}'`);
    }
  });

  it('is append-only: SELECT + INSERT policies, and NO UPDATE/DELETE policy', () => {
    expect(SQL).toMatch(/FOR SELECT USING/);
    expect(SQL).toMatch(/FOR INSERT WITH CHECK \(is_office_role\(\)\)/);
    // No UPDATE/DELETE policy anywhere in the migration.
    expect(SQL).not.toMatch(/FOR UPDATE/);
    expect(SQL).not.toMatch(/FOR DELETE/);
  });

  it('enables RLS on both tables', () => {
    expect(SQL).toMatch(/ALTER TABLE plan_revisions ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/ALTER TABLE plan_revision_lines ENABLE ROW LEVEL SECURITY/);
  });

  it('widens the notification type CHECK with PLAN_REVISED (superset of 067)', () => {
    expect(SQL).toContain("'PLAN_REVISED'");
    // Superset: earlier types still present.
    for (const t of ['REQUEST_APPROVED_FOR_PO', 'REQUEST_PENDING', 'GATE2_OVER_BUDGET']) {
      expect(SQL).toContain(`'${t}'`);
    }
  });

  it('defines notify_plan_revised targeting supervisor + principal, gated + never-block', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION notify_plan_revised\(/);
    expect(SQL).toMatch(/PERFORM assert_project_access\(p_project_id\)/);
    expect(SQL).toContain("'supervisor'");
    expect(SQL).toContain("'principal'");
    expect(SQL).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION notify_plan_revised\(UUID, UUID, TEXT\) TO authenticated/);
  });

  it('is SECURITY DEFINER with a pinned search_path', () => {
    expect(SQL).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });
});
