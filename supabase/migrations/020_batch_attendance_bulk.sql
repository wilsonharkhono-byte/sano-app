-- 020_batch_attendance_bulk.sql
-- Replace record_worker_attendance_batch with a bulk INSERT implementation.
--
-- Why: Migration 020 relaxed the outer date guard but the inner
-- record_worker_attendance() still has today/yesterday restriction →
-- 5 of 7 weekly days were rejected every time.
--
-- Additionally, the 020 loop called record_worker_attendance(contract_id, worker_id)
-- but migration 019 flipped the signature to (worker_id, contract_id) →
-- wrong argument order caused "Worker not found" for every entry.
--
-- Performance fix: replaces N×4 individual queries (N+1 pattern) with a
-- single bulk INSERT...SELECT using CTEs.

CREATE OR REPLACE FUNCTION record_worker_attendance_batch(
  p_contract_id   UUID,
  p_attendance_date DATE,
  p_entries       JSONB
  -- Expected: [{"worker_id":"...","is_present":true,"overtime_hours":2,"work_description":"..."},...]
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id UUID;
  v_user_id    UUID;
  v_count      INT;
BEGIN
  -- 1. Resolve project (single lookup)
  SELECT mc.project_id INTO v_project_id
  FROM mandor_contracts mc WHERE mc.id = p_contract_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kontrak tidak ditemukan';
  END IF;

  -- 2. Auth: one check for the entire batch
  PERFORM assert_project_role(v_project_id, ARRAY['supervisor', 'estimator', 'admin', 'principal']);
  SELECT auth.uid() INTO v_user_id;

  -- 3. Date window: 14 days retroactive, 7 days ahead for weekly planning
  IF p_attendance_date < CURRENT_DATE - 14 OR p_attendance_date > CURRENT_DATE + 7 THEN
    RAISE EXCEPTION 'Tanggal kehadiran di luar batas yang diizinkan (14 hari lalu hingga 7 hari ke depan)';
  END IF;

  -- 4. Bulk upsert in a single query
  WITH
    -- Parse JSON input once
    entries AS (
      SELECT
        (e->>'worker_id')::UUID                             AS worker_id,
        COALESCE((e->>'is_present')::BOOLEAN, true)        AS is_present,
        GREATEST(0, COALESCE((e->>'overtime_hours')::NUMERIC, 0)) AS overtime_hours,
        e->>'work_description'                             AS work_description
      FROM jsonb_array_elements(p_entries) AS e
    ),

    -- Effective daily rate per worker (latest effective_from on or before the date)
    rates AS (
      SELECT DISTINCT ON (wr.worker_id)
        wr.worker_id,
        wr.daily_rate
      FROM worker_rates wr
      WHERE wr.worker_id IN (SELECT worker_id FROM entries)
        AND wr.effective_from <= p_attendance_date
        AND (wr.effective_to IS NULL OR wr.effective_to > p_attendance_date)
      ORDER BY wr.worker_id, wr.effective_from DESC
    ),

    -- Worker-specific OT rules (highest priority)
    worker_ot AS (
      SELECT DISTINCT ON (wor.worker_id)
        wor.worker_id,
        wor.tier1_hourly_rate,
        wor.tier2_threshold_hours,
        wor.tier2_hourly_rate
      FROM worker_overtime_rules wor
      WHERE wor.worker_id IN (SELECT worker_id FROM entries)
        AND wor.effective_from <= p_attendance_date
        AND (wor.effective_to IS NULL OR wor.effective_to > p_attendance_date)
      ORDER BY wor.worker_id, wor.effective_from DESC
    ),

    -- Effective OT rules per worker: worker-specific first, then contract fallback
    effective_ot AS (
      SELECT
        en.worker_id,
        COALESCE(wot.tier1_hourly_rate,    cot.tier1_hourly_rate)    AS tier1_rate,
        COALESCE(wot.tier2_threshold_hours, cot.tier2_threshold_hours) AS tier2_threshold,
        COALESCE(wot.tier2_hourly_rate,    cot.tier2_hourly_rate)    AS tier2_rate
      FROM entries en
      LEFT JOIN worker_ot wot ON wot.worker_id = en.worker_id
      LEFT JOIN LATERAL (
        SELECT tier1_hourly_rate, tier2_threshold_hours, tier2_hourly_rate
        FROM mandor_overtime_rules
        WHERE contract_id = p_contract_id
          AND effective_from <= p_attendance_date
        ORDER BY effective_from DESC
        LIMIT 1
      ) cot ON true
    )

  INSERT INTO worker_attendance_entries (
    worker_id, contract_id, attendance_date,
    is_present, overtime_hours, work_description,
    daily_rate_snapshot,
    tier1_rate_snapshot, tier2_rate_snapshot,
    tier1_threshold_snapshot, tier2_threshold_snapshot,
    status, created_by
  )
  SELECT
    en.worker_id,
    p_contract_id,
    p_attendance_date,
    en.is_present,
    en.overtime_hours,
    en.work_description,
    r.daily_rate,
    ot.tier1_rate,
    ot.tier2_rate,
    7,                  -- normal_hours convention (always 7)
    ot.tier2_threshold,
    'DRAFT',
    v_user_id
  FROM entries en
  -- Only workers confirmed to belong to this contract
  JOIN mandor_workers mw ON mw.id = en.worker_id AND mw.contract_id = p_contract_id
  JOIN rates r           ON r.worker_id = en.worker_id
  JOIN effective_ot ot   ON ot.worker_id = en.worker_id
  ON CONFLICT (worker_id, attendance_date)
  DO UPDATE SET
    is_present               = EXCLUDED.is_present,
    overtime_hours           = EXCLUDED.overtime_hours,
    work_description         = EXCLUDED.work_description,
    daily_rate_snapshot      = EXCLUDED.daily_rate_snapshot,
    tier1_rate_snapshot      = EXCLUDED.tier1_rate_snapshot,
    tier2_rate_snapshot      = EXCLUDED.tier2_rate_snapshot,
    tier1_threshold_snapshot = EXCLUDED.tier1_threshold_snapshot,
    tier2_threshold_snapshot = EXCLUDED.tier2_threshold_snapshot,
    updated_at               = now()
  -- Never overwrite entries that have already been confirmed or settled
  WHERE worker_attendance_entries.status = 'DRAFT';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION record_worker_attendance_batch TO authenticated;
