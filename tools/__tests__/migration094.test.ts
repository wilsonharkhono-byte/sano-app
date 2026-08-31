/**
 * Static guard for migration 094 (envelope semantics).
 *
 * Like the 086/088/090/092/093 suites this touches no database — migrations here
 * are pasted into the Supabase Dashboard (remote history diverged), so the DB
 * half cannot be exercised from jest. The guard is the SQL text itself.
 *
 * What it protects, and why each one is a real risk rather than a spell-check:
 *
 *  • The fulfilled-line exclusion on total_requested. It is a NO-OP on data
 *    where purchase_order_lines.request_line_id is still NULL, so deleting it
 *    would break nothing visible today and double-count every fulfilled request
 *    the day those links start being written. Nothing else would fail first.
 *
 *  • remaining_to_order staying RAW. The 094 header records the evidence for
 *    NOT flooring it (MaterialUsagePanel renders the negative as the over-order
 *    signal; 071 and tools/poQuantityGate.ts recompute the figure themselves and
 *    document that it can be negative). A later "tidy-up" that wraps it in
 *    GREATEST would silently blind that panel — and would put the TS twin out of
 *    step with the server. This suite asserts BOTH ends of that decision, the
 *    SQL and the consumer it was made for.
 *
 *  • Column ORDER. CREATE OR REPLACE VIEW forbids reordering and consumers may
 *    read positionally (068:37-40). remaining_free must stay LAST.
 *
 *  • security_invoker. CREATE OR REPLACE VIEW resets reloptions — dropping the
 *    WITH clause silently reopens the cross-tenant leak 061 closed.
 *
 *  • The §3 rebuild's honesty: the split legs, the burn_pct that still sums BOTH
 *    of them (re-pointing it to the PO leg alone would halve a live gate input
 *    while looking like a rename), and the deterministic latest-master.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/094_envelope_semantics.sql'),
  'utf8',
);

/** The view's SELECT list — everything between the CREATE and its FROM. */
function viewSelectList(): string {
  const start = SQL.indexOf('CREATE OR REPLACE VIEW v_material_envelope_status');
  const end = SQL.indexOf('FROM v_material_envelopes env', start);
  if (start < 0 || end < 0) throw new Error('v_material_envelope_status body not found in 094');
  return SQL.slice(start, end);
}

/** The §3 function definition, from CREATE FUNCTION to its terminating $$;. */
function workgroupEnvelopeFn(): string {
  const re = /CREATE FUNCTION get_workgroup_envelope\([\s\S]*?\n\$\$;/;
  const m = SQL.match(re);
  if (!m) throw new Error('get_workgroup_envelope not found in 094');
  return m[0];
}

/** The §2 function definition. */
function workgroupMaterialEnvelopesFn(): string {
  const re = /CREATE OR REPLACE FUNCTION get_workgroup_material_envelopes\([\s\S]*?\n\$\$;/;
  const m = SQL.match(re);
  if (!m) throw new Error('get_workgroup_material_envelopes not found in 094');
  return m[0];
}

describe('migration 094 §1 — v_material_envelope_status', () => {
  it('restates security_invoker (CREATE OR REPLACE VIEW resets reloptions)', () => {
    expect(SQL).toMatch(
      /CREATE OR REPLACE VIEW v_material_envelope_status\s*\n\s*WITH \(security_invoker = on\)/,
    );
  });

  it('excludes request lines already fulfilled by a live PO from total_requested', () => {
    const list = viewSelectList();
    const body = SQL.slice(SQL.indexOf('AS total_requested', SQL.indexOf(list) + list.length) - 1200);
    // The exclusion predicate, mirroring compute_tier2_flag (088:1021-1027).
    expect(SQL).toMatch(/AND mrl\.id NOT IN \(\s*\n\s*SELECT pol\.request_line_id/);
    expect(body).toMatch(/WHERE pol\.request_line_id IS NOT NULL\s*\n\s*AND po\.status <> 'CANCELLED'/);
    // …and the non-rejected base predicate it refines, still present.
    expect(SQL).toMatch(/mrh\.overall_status NOT IN \('REJECTED'\)/);
  });

  it('appends remaining_free, floored at 0, net of BOTH ordered and requested', () => {
    const list = viewSelectList();
    expect(list).toMatch(
      /GREATEST\(\s*\n\s*0,\s*\n\s*env\.total_planned\s*\n\s*- COALESCE\(ordered\.total_ordered, 0\)\s*\n\s*- COALESCE\(requested\.total_requested, 0\)\s*\n\s*\) AS remaining_free/,
    );
  });

  it('keeps remaining_to_order RAW — no GREATEST clamp (see the header decision)', () => {
    const list = viewSelectList();
    expect(list).toMatch(
      /env\.total_planned - COALESCE\(ordered\.total_ordered, 0\) AS remaining_to_order/,
    );
    expect(list).not.toMatch(/GREATEST\([^)]*\)\s*AS remaining_to_order/);
  });

  it('keeps every pre-existing column in its 072 position, with remaining_free LAST', () => {
    const list = viewSelectList();
    const order = [
      'env.material_id',
      'env.project_id',
      'env.material_code',
      'env.material_name',
      'env.tier',
      'env.unit',
      'env.total_planned',
      'env.boq_item_count',
      'AS total_ordered',
      'AS total_received',
      'AS remaining_to_order',
      'AS burn_pct',
      'AS total_requested',
      'AS remaining_free',
    ];
    const positions = order.map(token => {
      const at = list.indexOf(token);
      expect(at).toBeGreaterThanOrEqual(0);
      return at;
    });
    for (let i = 1; i < positions.length; i++) {
      // Strictly increasing = the declared order matches `order` above.
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    // Nothing was appended after remaining_free.
    expect(list.trimEnd().endsWith('AS remaining_free')).toBe(true);
  });

  it('preserves 072\'s CLOSED_SHORT per-line cap on the ordered leg', () => {
    expect(SQL).toMatch(/WHEN po\.status = 'CLOSED_SHORT' THEN\s*\n\s*LEAST\(\s*\n\s*pol\.quantity/);
    expect(SQL).toMatch(/rl2\.po_line_id = pol\.id/);
  });

  it('preserves the received leg\'s id-link-then-name fallback', () => {
    expect(SQL).toMatch(
      /rl\.material_id = env\.material_id\s*\n\s*OR \(rl\.material_id IS NULL AND rl\.material_name = mc2\.name\)/,
    );
  });
});

describe('migration 094 §2 — get_workgroup_material_envelopes keeps its frozen contract', () => {
  const fn = () => workgroupMaterialEnvelopesFn();

  it('uses CREATE OR REPLACE with the identical signature and OUT columns', () => {
    // A DROP + CREATE here would break every 086 caller during the deploy window.
    expect(SQL).not.toMatch(/DROP FUNCTION IF EXISTS get_workgroup_material_envelopes/);
    expect(fn()).toMatch(
      /CREATE OR REPLACE FUNCTION get_workgroup_material_envelopes\(\s*\n\s*p_project_id UUID,\s*\n\s*p_boq_item_ids UUID\[\]/,
    );
    expect(fn()).toMatch(
      /RETURNS TABLE \(\s*\n\s*material_id UUID,\s*\n\s*planned NUMERIC,\s*\n\s*ordered NUMERIC,\s*\n\s*requested NUMERIC\s*\n\s*\)/,
    );
  });

  it('adds the is_asset routing 084 §6(a) gave v_material_envelopes', () => {
    expect(fn()).toMatch(
      /WHERE NOT EXISTS \(\s*\n\s*SELECT 1 FROM material_catalog mc\s*\n\s*WHERE mc\.id = COALESCE\(p\.mat_id, x\.mat_id\)\s*\n\s*AND mc\.is_asset IS TRUE\s*\n\s*\)/,
    );
  });

  it('keeps 086\'s deterministic latest-master, PO-split and FULL OUTER JOIN', () => {
    expect(fn()).toMatch(/ORDER BY created_at DESC, id DESC\s*\n\s*LIMIT 1/);
    expect(fn()).toMatch(/FILTER \(WHERE po_link\.request_line_id IS NOT NULL\)/);
    expect(fn()).toMatch(/FILTER \(WHERE po_link\.request_line_id IS NULL\)/);
    expect(fn()).toMatch(/FULL OUTER JOIN allocation_rows x ON x\.mat_id = p\.mat_id/);
    // LIMIT 1 on the live-PO probe: without it a line split across two POs
    // fans the allocation row out and counts it twice.
    expect(fn()).toMatch(/WHERE pol\.request_line_id = l\.id\s*\n\s*AND po\.status <> 'CANCELLED'\s*\n\s*LIMIT 1/);
  });

  it('stays read-only, RLS-composed and guarded, and re-grants execute', () => {
    expect(fn()).toMatch(/\bSTABLE\b/);
    expect(fn()).toMatch(/\bSECURITY INVOKER\b/);
    expect(fn()).toMatch(/PERFORM assert_project_access\(p_project_id\)/);
    expect(fn()).not.toMatch(/\bSECURITY DEFINER\b/);
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION get_workgroup_material_envelopes\(UUID, UUID\[\]\)\s*\n?\s*TO authenticated/,
    );
  });
});

describe('migration 094 §3 — get_workgroup_envelope rebuilt honestly', () => {
  const fn = () => workgroupEnvelopeFn();

  it('is re-paste-safe: DROP before CREATE (the return shape changed)', () => {
    const drop = SQL.indexOf('DROP FUNCTION IF EXISTS get_workgroup_envelope(UUID, UUID, UUID[])');
    const create = SQL.indexOf('CREATE FUNCTION get_workgroup_envelope(');
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(drop);
  });

  it('splits ordered from requested and declares both, plus remaining_free', () => {
    expect(fn()).toMatch(
      /RETURNS TABLE \(\s*\n\s*material_id UUID,\s*\n\s*material_name TEXT,\s*\n\s*unit TEXT,\s*\n\s*total_planned NUMERIC,\s*\n\s*total_ordered NUMERIC,\s*\n\s*total_requested NUMERIC,\s*\n\s*total_installed NUMERIC,\s*\n\s*remaining_to_order NUMERIC,\s*\n\s*remaining_free NUMERIC,\s*\n\s*burn_pct NUMERIC,\s*\n\s*boq_item_count BIGINT\s*\n\s*\)/,
    );
    expect(fn()).toMatch(/FILTER \(WHERE po_link\.request_line_id IS NOT NULL\), 0\) AS ordered_qty/);
    expect(fn()).toMatch(/FILTER \(WHERE po_link\.request_line_id IS NULL\), 0\)\s*AS requested_qty/);
  });

  it('makes remaining_to_order mean planned − ORDERED (it meant planned − requests)', () => {
    expect(fn()).toMatch(
      /COALESCE\(planned\.qty, 0\) - COALESCE\(demand\.ordered_qty, 0\)\s*\n?\s*AS remaining_to_order/,
    );
  });

  it('keeps burn_pct on TOTAL demand — ordered PLUS requested, not the PO leg alone', () => {
    // Re-pointing this to ordered_qty alone would halve a live gate input while
    // looking like a cosmetic rename. It must name both legs.
    expect(fn()).toMatch(
      /\(\(COALESCE\(demand\.ordered_qty, 0\) \+ COALESCE\(demand\.requested_qty, 0\)\)\s*\n?\s*\/ planned\.qty\) \* 100/,
    );
  });

  it('floors remaining_free at 0 net of both legs', () => {
    expect(fn()).toMatch(
      /GREATEST\(\s*\n\s*0,\s*\n\s*COALESCE\(planned\.qty, 0\)\s*\n\s*- COALESCE\(demand\.ordered_qty, 0\)\s*\n\s*- COALESCE\(demand\.requested_qty, 0\)\s*\n\s*\)\s*AS remaining_free/,
    );
  });

  it('adds the id DESC latest-master tiebreaker 086 named as the row to fix', () => {
    expect(fn()).toMatch(
      /FROM project_material_master\s*\n\s*WHERE project_id = p_project_id[\s\S]{0,120}ORDER BY created_at DESC, id DESC\s*\n\s*LIMIT 1/,
    );
  });

  it('routes assets out by returning NOTHING, never a zero row', () => {
    // A zero row would read downstream as "planned 0" and render a soft
    // no-baseline heads-up for a material that must not be requestable at all.
    expect(fn()).toMatch(
      /IF EXISTS \(\s*\n\s*SELECT 1 FROM material_catalog mc\s*\n\s*WHERE mc\.id = p_material_id AND mc\.is_asset IS TRUE\s*\n\s*\) THEN\s*\n\s*RETURN;/,
    );
  });

  it('keeps total_installed\'s formula, the guard, SECURITY INVOKER and STABLE', () => {
    expect(fn()).toMatch(
      /SUM\(pmml\.planned_quantity \* CASE WHEN bi\.planned > 0\s*\n\s*THEN LEAST\(bi\.installed \/ bi\.planned, 1\) ELSE 0 END\) AS installed_qty/,
    );
    expect(fn()).toMatch(/PERFORM assert_project_access\(p_project_id\)/);
    expect(fn()).toMatch(/\bSTABLE\b/);
    expect(fn()).toMatch(/\bSECURITY INVOKER\b/);
    expect(fn()).not.toMatch(/\bSECURITY DEFINER\b/);
  });

  it('re-grants execute after the DROP (a DROP takes the ACL with it)', () => {
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION get_workgroup_envelope\(UUID, UUID, UUID\[\]\) TO authenticated/,
    );
  });
});

describe('migration 094 §4 — documentation that has to survive edits', () => {
  it('records the incident this migration exists for', () => {
    expect(SQL).toMatch(/THE INCIDENT \(2026-08-31\)/);
    expect(SQL).toMatch(/Sisa untuk di-PO/);
    expect(SQL).toMatch(/SBY-001/);
  });

  it('records 069:73-80 as KNOWN-DEFERRED rather than silently fixed', () => {
    expect(SQL).toMatch(/KNOWN-DEFERRED/);
    expect(SQL).toMatch(/069:73-80/);
    expect(SQL).toMatch(/OLD-quantity self-count|OLD quantity/);
  });

  it('ships a verification block with the empty-scope precondition', () => {
    expect(SQL).toMatch(/VERIFICATION/);
    expect(SQL).toMatch(/PRECONDITION/);
    expect(SQL).toMatch(/vacuous/i);
    // The RLS lesson from migration 040: never verify only as service role.
    expect(SQL).toMatch(/AUTHENTICATED role/);
  });
});

describe('migration 094 — lockstep with the TS that reads these columns', () => {
  it('the canonical TS semantic for this column is still the unfloored one', () => {
    // tools/envelopeMath.ts owns the two "sisa" meanings. Its remainingToOrder
    // is planned − ordered and returns the negative as information — the same
    // formula the server gates use (071, 088:671). The view column must keep
    // matching it; flooring the column would make the view disagree with the
    // module every screen now reads. This is the evidence behind §1's
    // "DELIBERATELY NOT CHANGED" note, asserted rather than merely asserted-to.
    const math = fs.readFileSync(path.join(ROOT, 'tools/envelopeMath.ts'), 'utf8');
    expect(math).toMatch(/export function remainingToOrder/);
    expect(math).toMatch(/return leg\(l\.planned\) - leg\(l\.ordered\);/);
    expect(math).toMatch(/May be NEGATIVE/);
    // …and remainingFree is the floored twin, matching §1's new column.
    expect(math).toMatch(
      /return Math\.max\(0, leg\(l\.planned\) - leg\(l\.ordered\) - leg\(l\.requested\)\);/,
    );
  });

  it('the PO gate twin still treats remaining as possibly negative', () => {
    const gate = fs.readFileSync(path.join(ROOT, 'tools/poQuantityGate.ts'), 'utf8');
    expect(gate).toMatch(/can be negative if already over-ordered/);
    expect(gate).toMatch(/remainingToOrder/);
  });

  it('getWorkGroupEnvelope no longer trusts the rotten column names', () => {
    const envelopes = fs.readFileSync(path.join(ROOT, 'tools/envelopes.ts'), 'utf8');
    const start = envelopes.indexOf('export async function getWorkGroupEnvelope(');
    const end = envelopes.indexOf('export interface WorkGroupMaterialEnvelope', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = envelopes.slice(start, end);
    // It calls the RPC…
    expect(body).toMatch(/rpc\('get_workgroup_envelope'/);
    // …but destructures ONLY the version-stable columns from its row.
    expect(body).toMatch(
      /const row = meta\.data as \{\s*\n\s*material_name: string;\s*\n\s*unit: string;\s*\n\s*total_installed: number;\s*\n\s*boq_item_count: number;\s*\n\s*\}/,
    );
    expect(body).not.toMatch(/row\.total_ordered/);
    expect(body).not.toMatch(/row\.remaining_to_order/);
    expect(body).not.toMatch(/row\.burn_pct/);
    expect(body).not.toMatch(/row\.total_planned/);
    // And it takes the burn legs from 086.
    expect(body).toMatch(/getWorkGroupMaterialEnvelopes\(projectId, boqItemIds\)/);
  });

  it('the dead pre-069 gate helpers are gone and stay gone', () => {
    const envelopes = fs.readFileSync(path.join(ROOT, 'tools/envelopes.ts'), 'utf8');
    expect(envelopes).not.toMatch(/export async function checkTier2Envelope/);
    expect(envelopes).not.toMatch(/export async function checkMaterialRequest/);
    expect(envelopes).not.toMatch(/async function checkTier1Direct/);
    // Their uncapped bands went with them.
    expect(envelopes).not.toMatch(/ENVELOPE_CRITICAL_PCT/);
  });
});
