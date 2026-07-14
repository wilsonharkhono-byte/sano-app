# Deploy Checklist — SANO Flow Remediation (migrations 057–081)

> Order matters. The remote migration history is divergent, so everything is
> pasted by hand into **Supabase Dashboard → SQL Editor**. Every file is
> idempotent and re-paste-safe, but the SEQUENCE rules below must be honored.

## 0. Pre-flight (once)

- [ ] Confirm the PREVIOUS batch is live: `053, 054, 055, 056` (several new
      migrations build on them). Quick check — run in SQL Editor:
      `SELECT proname FROM pg_proc WHERE proname IN ('submit_receipt','compute_tier1_workgroup_flag');`
      Both must exist. If not, paste 053→056 first.
- [ ] Optional sanity: `SELECT count(*) FROM project_assignments pa LEFT JOIN profiles p ON p.id = pa.user_id WHERE p.id IS NULL;`
      → must be 0 (orphaned assignments would be silently dropped from notifications).

## 1. Paste migrations IN THIS ORDER (one file at a time, top to bottom)

Phase 0 — security:
- [ ] 057_lock_profile_role.sql
- [ ] 058_price_book_office_write.sql
- [ ] 059_boq_items_write_split.sql
- [ ] 060_po_and_approval_write_gating.sql
- [ ] 061_envelope_views_security_invoker.sql

Phase 1 — data fixes:
- [ ] 062_receipt_idempotency.sql
- [ ] 063_breakdown_latest_master.sql
- [ ] 064_boq_items_subchapter.sql
- [ ] 065_ahs_lines_prelim.sql

Phase 2 — flow:
- [ ] 066_enqueue_notification_role_target.sql
- [ ] 067_flow_notifications.sql
- [ ] 068_envelope_ordered_from_po.sql
- [ ] 069_soft_request_gate.sql
- [ ] 070_receipt_line_po_link.sql
- [ ] 071_po_quantity_gate.sql
- [ ] 072_po_close_cancel.sql
- [ ] 073_submit_material_request_rpc.sql
- [ ] 074_boq_items_supersede.sql
- [ ] 075_client_report_no_unique.sql  (RAISES loudly if duplicate report numbers exist — resolve per its message, then re-paste)
- [ ] 076_request_overage_reason.sql
- [ ] 077_material_baseline_snapshots.sql  (backfills baselines from each project's EARLIEST master)
- [ ] 078_plan_revisions.sql
- [ ] 079_plan_ceiling_raise_gate.sql
- [ ] 080_anomaly_events_columns.sql

Independent (attendance work, renamed from 069):
- [ ] 081_attendance_payroll_audit_fixes.sql — then run `node tmp/smoke-attendance-fixes.mjs`

## 2. Deploy the app build

Only AFTER all of section 1 is green. The app hard-depends on: 062 (receipt
idempotency param), 064 (sub_chapter column — publish quarantines every row
without it), 070/072 (submit_receipt_lines), 071 (13-arg create_purchase_order),
073 (submit_material_request RPC), 076 (overage columns), 079 (re-publish fails
closed without it), 080 (audit events vanish silently without it).

Merging the PR to `main` auto-deploys the web app via Vercel.

## 3. Re-paste rules (if you ever re-paste an OLD migration later)

- Re-pasting 060 → re-paste 071 after it (071 pins the approval-forge hole 060's version reopens).
- Re-pasting 047, 054, or 055 → re-paste 061 after (CREATE OR REPLACE VIEW resets security_invoker).
- Re-pasting 068 → re-paste 072 after (per-line CLOSED_SHORT cap).

## 4. Post-deploy notes / behavior changes users will notice

- All historical daily-log photos are currently "featured" and stay in client
  reports until manually un-starred (new photos default to un-starred).
- Existing projects need ONE re-publish to populate chapter/sub_chapter
  (work-group grouping) and to establish supersede tracking.
- The first re-publish after deploy will show the new diff-and-acknowledge
  checklist — that is expected, not an error.
