-- 068 — Envelope re-model: "ordered" = SANO purchase orders, add total_requested
-- (Task 2.3; design docs/superpowers/specs/2026-07-10-two-signal-overallocation-design.md §2-3)
--
-- Paste order: AFTER 061 (which flipped the envelope views to security_invoker)
--   and AFTER 067 (latest applied migration). Apply via Dashboard SQL Editor
--   (remote migration history diverged — see project memory). Idempotent /
--   re-paste-safe throughout (CREATE OR REPLACE VIEW/FUNCTION, DROP ... IF EXISTS).
--
-- Problem (confirmed two-signal ordering model, spec §2.1):
--   v_material_envelope_status.total_ordered (055:296-305) sums
--   material_request_lines.quantity — i.e. REQUESTS, not orders. Under the
--   locked model "ordered" = admin-created SANO purchase orders; requests are
--   demand awaiting approval and must surface as a SEPARATE figure.
--
-- What this migration does:
--   1. v_material_envelope_status.total_ordered now sums purchase_order_lines
--      (joined to purchase_orders on project_id), excluding CANCELLED POs; the
--      NEW column total_requested carries the OLD request-based body verbatim.
--      remaining_to_order / burn_pct now key off the PO-based total_ordered.
--   2. get_material_envelope RETURNS TABLE gains total_requested (appended).
--   3. compute_tier2_flag (033) is re-pointed from total_ordered → total_requested
--      so the SERVER Tier-2 soft gate KEEPS burning on requests exactly as before
--      (zero behavior change — same numbers, new column name). See note below.
--
-- ⚠ security_invoker (MANDATORY): 061 flipped this view to security_invoker via
--   ALTER VIEW ... SET. CREATE OR REPLACE VIEW *resets reloptions*, so the flag
--   MUST be restated here or the cross-tenant leak 061 closed silently reopens
--   (061 header documents this dependency explicitly). Restated below.
--
-- ⚠ Task 2.7 forward-compatibility: the CANCELLED / CLOSED_SHORT arms below are
--   no-ops TODAY. purchase_orders.status CHECK (001:197-198) currently allows
--   only ('OPEN','PARTIAL_RECEIVED','FULLY_RECEIVED','CANCELLED') — no row can be
--   CLOSED_SHORT until Task 2.7 adds that status and its writers. The CLOSED_SHORT
--   CASE arm is written now so it "just works" when 2.7 lands, but exercises no
--   rows in the current schema.
--
-- Column ORDER: every existing column keeps its current position; total_requested
--   is APPENDED. CREATE OR REPLACE VIEW requires existing columns to keep the same
--   name/type/order, and view consumers may read positionally — appending is the
--   only safe shape change.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. v_material_envelope_status — total_ordered from POs, add total_requested.
--    Body from 055:279-316 with the total_ordered lateral re-pointed and a new
--    total_requested lateral. The `received` lateral is copied VERBATIM from 055
--    (prefers the material_id link, falls back to the legacy name match).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_material_envelope_status
WITH (security_invoker = on) AS
SELECT
  env.material_id,
  env.project_id,
  env.material_code,
  env.material_name,
  env.tier,
  env.unit,
  env.total_planned,
  env.boq_item_count,
  COALESCE(ordered.total_ordered, 0) AS total_ordered,
  COALESCE(received.total_received, 0) AS total_received,
  env.total_planned - COALESCE(ordered.total_ordered, 0) AS remaining_to_order,
  CASE
    WHEN env.total_planned > 0
    THEN ROUND((COALESCE(ordered.total_ordered, 0) / env.total_planned) * 100, 1)
    ELSE 0
  END AS burn_pct,
  -- APPENDED: request-side demand (the OLD total_ordered body, unchanged).
  COALESCE(requested.total_requested, 0) AS total_requested
FROM v_material_envelopes env
LEFT JOIN LATERAL (
  -- ORDERED = SANO purchase order lines. A PO line with NULL material_id
  -- (free-text line) never equals env.material_id, so it never matches —
  -- deliberately excluded. CANCELLED POs excluded. For CLOSED_SHORT POs
  -- (forward-compat, Task 2.7) the ordered contribution is capped at the
  -- PO's received quantity via a correlated sub-select over receipt_lines,
  -- so a short-closed order stops inflating the total once it is short-closed.
  --
  -- Cost/limitation of the CLOSED_SHORT arm: the received sub-select is
  -- per-PO, not per-line. For a single-material PO (the norm) LEAST(line_qty,
  -- po_received) is exact; for a multi-line CLOSED_SHORT PO each line would be
  -- capped by the WHOLE PO's received total (a documented over-estimate).
  -- Acceptable because no row can be CLOSED_SHORT until Task 2.7, which owns
  -- the precise per-line semantics.
  SELECT SUM(
    CASE
      WHEN po.status = 'CLOSED_SHORT' THEN
        LEAST(
          pol.quantity,
          COALESCE((
            SELECT SUM(rl2.quantity_actual)
            FROM receipt_lines rl2
            JOIN receipts r2 ON r2.id = rl2.receipt_id
            WHERE r2.po_id = po.id
          ), 0)
        )
      ELSE pol.quantity
    END
  ) AS total_ordered
  FROM purchase_order_lines pol
  JOIN purchase_orders po ON po.id = pol.po_id
  WHERE po.project_id = env.project_id
    AND pol.material_id = env.material_id
    AND po.status <> 'CANCELLED'
) ordered ON true
LEFT JOIN LATERAL (
  -- REQUESTED = the OLD total_ordered body (055:298-305), byte-similar. Sums
  -- non-REJECTED material request lines. A free-text request line with NULL
  -- material_id never equals env.material_id, so it never matches — same as
  -- the old lateral (behavior preserved verbatim).
  SELECT SUM(mrl.quantity) AS total_requested
  FROM material_request_lines mrl
  JOIN material_request_headers mrh ON mrh.id = mrl.request_header_id
  WHERE mrh.project_id = env.project_id
    AND mrl.material_id = env.material_id
    AND mrh.overall_status NOT IN ('REJECTED')
) requested ON true
LEFT JOIN LATERAL (
  -- RECEIVED — copied verbatim from 055 (id link preferred, name fallback).
  SELECT SUM(rl.quantity_actual) AS total_received
  FROM receipt_lines rl
  JOIN receipts r ON r.id = rl.receipt_id
  JOIN material_catalog mc2 ON mc2.id = env.material_id
  WHERE r.project_id = env.project_id
    AND (
      rl.material_id = env.material_id
      OR (rl.material_id IS NULL AND rl.material_name = mc2.name)
    )
) received ON true;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. get_material_envelope — RETURNS TABLE gains total_requested (appended).
--    A RETURNS TABLE change requires DROP FUNCTION first (mirrors 055/062/066
--    overload hygiene): CREATE OR REPLACE cannot alter the OUT-column shape.
--    Guard (assert_project_access) from 061 kept. GRANT re-issued after the
--    drop — 061 relied on the default PUBLIC EXECUTE for this RPC (it granted
--    the other three explicitly but never this one); we make it explicit to
--    authenticated now so the drop cannot narrow access.
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_material_envelope(UUID, UUID);

CREATE FUNCTION get_material_envelope(
  p_project_id UUID,
  p_material_id UUID
)
RETURNS TABLE (
  material_id UUID,
  material_name TEXT,
  tier SMALLINT,
  unit TEXT,
  total_planned NUMERIC,
  total_ordered NUMERIC,
  total_received NUMERIC,
  remaining_to_order NUMERIC,
  burn_pct NUMERIC,
  boq_item_count BIGINT,
  total_requested NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  PERFORM assert_project_access(p_project_id);

  RETURN QUERY
  SELECT
    v.material_id, v.material_name, v.tier, v.unit,
    v.total_planned, v.total_ordered, v.total_received,
    v.remaining_to_order, v.burn_pct, v.boq_item_count,
    v.total_requested
  FROM v_material_envelope_status v
  WHERE v.project_id = p_project_id
    AND v.material_id = p_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_material_envelope(UUID, UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. compute_tier2_flag — re-point to total_requested (server gate invariant).
--
--    compute_tier2_flag (033:35-71) is the ONLY server-side reader of this
--    view's ordered figure (048's compute_tier3_flag reads v_material_budget_
--    status, whose committed_rupiah has its own lateral over material_request_
--    lines — untouched here). Before 068 it read total_ordered, which WAS
--    request-based; after 068 total_ordered means PO. Left unchanged, the server
--    Tier-2 soft gate would silently flip from request-burn to PO-burn.
--
--    Task 2.4 (069) will re-derive the full soft-gate (planned − PO − other
--    requests). Until then the server gate must KEEP burning on requests, so we
--    re-point it to total_requested — identical numbers, new column. Signature
--    and thresholds unchanged; CREATE OR REPLACE introduces no overload.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION compute_tier2_flag(
  p_material_id UUID,
  p_project_id UUID,
  p_requested_qty NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_planned NUMERIC;
  v_total_requested NUMERIC;
  v_burn_pct NUMERIC;
BEGIN
  IF p_material_id IS NULL THEN
    RETURN 'OK';
  END IF;

  -- total_requested preserves the pre-068 total_ordered semantics (requests).
  SELECT total_planned, total_requested
    INTO v_total_planned, v_total_requested
  FROM v_material_envelope_status
  WHERE project_id = p_project_id AND material_id = p_material_id;

  -- No envelope built yet (no boq link via ahs).
  IF v_total_planned IS NULL OR v_total_planned <= 0 THEN
    RETURN 'INFO';
  END IF;

  v_burn_pct := ((COALESCE(v_total_requested, 0) + p_requested_qty) / v_total_planned) * 100;

  IF v_burn_pct > 120 THEN RETURN 'CRITICAL'; END IF;
  IF v_burn_pct > 100 THEN RETURN 'HIGH'; END IF;
  IF v_burn_pct > 80  THEN RETURN 'WARNING'; END IF;
  IF v_burn_pct > 50  THEN RETURN 'INFO'; END IF;
  RETURN 'OK';
END;
$$;
