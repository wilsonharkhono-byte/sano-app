-- 063 — Scope get_envelope_boq_breakdown to the latest project_material_master
--        (Task 1.3, Tier-2 + work-group allocation double-counting — HIGH)
--
-- Supersedes 061's definition of get_envelope_boq_breakdown ONLY. The other
-- three RPCs 061 re-created (get_material_envelope, get_workgroup_envelope,
-- get_material_budget) are untouched here and keep their 061 bodies. This
-- migration builds on 061's version of the function (guard included), not
-- 004's original — paste it AFTER 061.
--
-- Bug: get_envelope_boq_breakdown (originally 004_boq_parser_extensions.sql:
-- 153-180; re-created by 061_envelope_views_security_invoker.sql:186-221 to
-- prepend the assert_project_access guard, body otherwise verbatim) joins
--   project_material_master_lines pmml
--   JOIN project_material_master pmm ON pmm.id = pmml.master_id
-- filtered only by `pmm.project_id = p_project_id` — no latest-master filter.
-- publishBaselineV2 (tools/publishBaselineV2.ts:699-704) inserts a NEW
-- project_material_master header on every publish and never deletes or
-- supersedes prior generations, so after N publishes this RPC returns N rows
-- per boq_item (one per generation) instead of one. This RPC reads
-- project_material_master_lines directly rather than through
-- v_material_envelopes, so it is the one project_material_master consumer
-- 054_envelope_latest_master.sql missed when it fixed the view.
--
-- Blast radius — both call sites treat this RPC's rows as "the" per-BoQ
-- breakdown for a material and silently absorb the duplication:
--   - workflows/screens/PermintaanScreen.tsx:372-388 caches the rows verbatim
--     as EnvelopeBoqBreakdown[] for the Tier-2 allocation-preview UI — a
--     re-published boq_item shows up once per generation in the list.
--   - tools/envelopes.ts:107-119 (getEnvelopeBreakdown) feeds
--     allocateTier2Order (:191-209), which sums planned_quantity across ALL
--     returned rows as the proportional-split denominator (totalPlanned) and
--     allocates the order across every row returned — duplicate rows both
--     inflate that denominator and split real order quantity across ghost
--     line items from stale generations.
--
-- Fix: add the same correlated latest-master subquery 054 established for
-- v_material_envelopes, with 054's deterministic tiebreaker
-- (ORDER BY created_at DESC, id DESC LIMIT 1 — id DESC breaks ties when a
-- republish batch inserts two project_material_master rows within the same
-- wall-clock second). Expressed here as `pmm.id = (...)` since the function
-- already joins pmm and filters by project_id; equivalent in effect to
-- filtering `pmml.master_id = (...)` directly, the shape get_workgroup_envelope
-- uses (it has no pmm join to begin with).
--
-- 061's guard (PERFORM assert_project_access(p_project_id)) is preserved
-- byte-faithfully as the function's first statement. Signature and
-- RETURNS TABLE shape are unchanged (boq_item_id, boq_code, boq_label,
-- planned_quantity, pct_of_total) — pct_of_total's SUM(...) OVER () window
-- now computes its 100% denominator over the latest-master rows only, which
-- is the correct fix (previously it silently summed stale-generation rows
-- into the same denominator). Existing callers resolve unchanged, no edits
-- needed:
--   - workflows/screens/PermintaanScreen.tsx:375 (get_envelope_boq_breakdown RPC)
--   - tools/envelopes.ts:112 (getEnvelopeBreakdown) → allocateTier2Order:191-209
--
-- No new GRANT: neither 004 nor 061 issued an explicit GRANT EXECUTE for this
-- function (unlike get_material_budget, which 061:339 grants explicitly) — it
-- is not SECURITY DEFINER and was never REVOKEd from PUBLIC, so it runs under
-- the default PostgreSQL EXECUTE-to-PUBLIC grant, which CREATE OR REPLACE
-- does not reset.
--
-- Idempotent / re-paste-safe: CREATE OR REPLACE FUNCTION only.
-- Apply via Dashboard SQL Editor, AFTER 061 (remote migration history diverged).

CREATE OR REPLACE FUNCTION get_envelope_boq_breakdown(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  boq_item_id UUID,
  boq_code TEXT,
  boq_label TEXT,
  planned_quantity NUMERIC,
  pct_of_total NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  SELECT
    pmml.boq_item_id,
    bi.code,
    bi.label,
    pmml.planned_quantity,
    CASE
      WHEN SUM(pmml.planned_quantity) OVER () > 0
      THEN ROUND((pmml.planned_quantity / SUM(pmml.planned_quantity) OVER ()) * 100, 1)
      ELSE 0
    END AS pct_of_total
  FROM project_material_master_lines pmml
  JOIN project_material_master pmm ON pmm.id = pmml.master_id
  JOIN boq_items bi ON bi.id = pmml.boq_item_id
  WHERE pmm.project_id = p_project_id
    AND pmml.material_id = p_material_id
    AND pmm.id = (
      SELECT id FROM project_material_master
      WHERE project_id = p_project_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
  ORDER BY pmml.planned_quantity DESC;
END;
$$;
