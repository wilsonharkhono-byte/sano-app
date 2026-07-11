-- 076_request_overage_reason.sql
--
-- Task 2.4 — Signal-1 reason capture (spec §3). When a material request's
-- projected cumulative crosses 100% of plan, the supervisor must pick a reason
-- before submit; this turns overage data into estimator feedback instead of
-- noise the team clicks past. The reason is stored on the request LINE and shown
-- (as evidence) on the estimator's ApprovalsScreen card.
--
-- NUMBERING: intentionally 076, out of sequence with 069 (this task's server-gate
-- migration). 074 and 075 are RESERVED for Phase 3 of the remediation plan; this
-- column change is logically independent of 069 and can be pasted before or after
-- it. Apply via the Dashboard SQL Editor (remote history diverged — project memory).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded CHECK add (Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so the constraint is added inside a DO block that
-- first checks pg_constraint). Safe to re-run.
--
-- CLIENT WRITER: workflows/screens/PermintaanScreen.tsx (line insert) writes
--   overage_reason (required when the line's projected cumulative > 100%) and the
--   optional overage_note. TS enum: tools/types.ts OverageReason; labels:
--   tools/requestOverage.ts OVERAGE_REASON_LABELS. Keep the CHECK below in lockstep
--   with that enum.

ALTER TABLE material_request_lines
  ADD COLUMN IF NOT EXISTS overage_reason TEXT;

ALTER TABLE material_request_lines
  ADD COLUMN IF NOT EXISTS overage_note TEXT;

-- Constrain overage_reason to the five spec §3 codes (NULL allowed — most lines
-- carry no overage). Guarded so re-running the migration does not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'material_request_lines_overage_reason_check'
  ) THEN
    ALTER TABLE material_request_lines
      ADD CONSTRAINT material_request_lines_overage_reason_check
      CHECK (overage_reason IS NULL OR overage_reason IN
        ('WASTE', 'REWORK', 'PLAN_UNDERESTIMATE', 'VARIATION', 'OTHER'));
  END IF;
END;
$$;
