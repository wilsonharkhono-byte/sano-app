# SANO — App Flow Audit, Report Evaluation & Improvement Plan

**Date:** 2026-03-28
**Scope:** Full codebase review against SAN_DEVELOPER_BRIEF.md, SAN_PRODUCT_REQUIREMENTS.md, SAN_TASK_BREAKDOWN.md
**Perspectives:** Supervisor (field), Admin (procurement), Estimator (technical review), Principal (executive oversight)

---

## 1. Executive Summary

The SANO codebase is structurally well-aligned with the SAN briefs for the **supervisor mobile experience**. Navigation, gate flows (1, 3, 4), the defect-in-Progres merge, MTN workflow, and the Export Center are all correct. The design system is clean and consistent.

The major gaps are architectural, not cosmetic:

1. **All gate logic is client-side** — violates the core brief principle of "simple input on field, strong logic in backend."
2. **Baseline import pipeline is incomplete** — blocks accurate Gate 1 material suggestions and all downstream validation.
3. **Office roles share one identical dashboard** — estimator, admin, and principal each require distinct interfaces per brief; currently they see the same 5-tab navigation.
4. **Reports lack filters** — no date range, BoQ scope, or cause filters; unusable for partial billing cycles or client invoicing.
5. **Two critical report types are missing** — payroll support summary and client additional-charge report.

---

## 2. What Is Adequate — Matches the Brief

The following areas are correctly implemented and match the SAN brief specifications:

### 2.1 Supervisor Mobile Navigation
- Five-tab structure (Beranda, Permintaan, Terima, Progres, Laporan) matches brief §8.1 exactly.
- `CacatScreen` deprecated; defects integrated into `Progres` — correct per brief §18.2.
- Header includes project switcher, role label, and user name — correct per brief §7.3.

### 2.2 Multi-Project Context
- `useProject` hook manages multi-project loading, filtering, and active project switching.
- All queries filtered by `project_id` — correct enforcement direction.
- Project switcher modal in Header component works.

### 2.3 Gate 1 — Bundled Material Requests
- `material_request_headers` + `material_request_lines` model implemented — matches brief §15.2.
- Multi-line request builder in `PermintaanScreen` is correct.
- `overall_flag` inherits worst line flag — correct propagation.
- Supervisor sees simplified status only — correct per brief §15.6.

### 2.4 Gate 3 — Partial Receipts
- Multiple receipt sessions per PO is supported.
- Receipt history table shows previous receipts.
- Partial vs Final receipt save options are available.
- Gate 3 checks (qty match, accumulation, photo compliance) are implemented.
- Inbound MTN list visible in `TerimaScreen`.

### 2.5 Gate 4 — Unified Progress Hub
- `ProgresScreen` includes: Add Progress, Add Defect, Add VO/Micro-VO, Add Rework.
- Back/Cancel navigation on all submodules — correct per brief §18.5.
- No before/after distinction, no GPS for progress photos — correct per brief §18.4.
- Payroll-support tag and client-charge tag exist on progress entries — correct.
- VO cause classification (7 options) and grade (low/medium/high/critical) implemented.

### 2.6 Defect Lifecycle
- States: OPEN → VALIDATED → IN_REPAIR → RESOLVED → VERIFIED → ACCEPTED_BY_PRINCIPAL — exact match to brief §19.3.
- Severity: Minor, Major, Critical — present.
- Handover eligibility logic: correct (critOpen === 0 && majorOpen === 0).

### 2.7 Gate 5 — Laporan as Reporting Center
- `LaporanScreen` is the single reporting center — correct per brief §21.1.
- Export Center with 7 report types available.
- Excel export functional via `exportReportToExcel()`.
- In-app preview modal implemented.
- MTN workflow in Laporan tab — balance-driven, destination project from assigned projects list.
- Milestone panel embedded in Jadwal tab.

### 2.8 Office Approval Workflow
- `ApprovalsScreen` covers MTN, VO, and Material Request approvals with status filter chips.
- Approve/Reject/Review actions with `reviewed_by` and `reviewed_at` audit fields — correct.
- `OfficeHomeScreen` shows pending action counts and quick-navigation grid.
- Pending counts: MTN (AWAITING), VO (AWAITING/REVIEWED), requests (PENDING/UNDER_REVIEW/AUTO_HOLD).

### 2.9 Activity Log & Alerts
- Activity log shows 20 most recent entries with type, flag level, and relative timestamps.
- Alert banner on Beranda deep-links to Laporan → Jadwal tab.
- StatTiles on Beranda show: progress %, pending deliveries, open defects, critical defects, at-risk milestones.

---

## 3. What Needs Improvement — Gaps Against the Brief

### 3.1 CRITICAL — Gate Logic Is Entirely Client-Side

**Files:** `workflows/gates/gate1.ts`, `gate2.ts`, `gate3.ts`, `gate4.ts`
**Brief violation:** §10.2 — "The backend must determine gate results, derived totals, milestone completion, material balances, scoring, approval routing, weekly reconciliation."

**Impact:**
- Any client with network access can submit data that bypasses gate checks entirely.
- Derived totals (installed qty, material balance, milestone status) computed client-side are unreliable.
- When a supervisor submits a receipt or progress entry, gate outcomes are computed in JavaScript on their phone — not on the server.

**What needs to happen:**
- Move all gate logic to Supabase Edge Functions or PostgreSQL functions.
- Client submits raw event data; backend returns gate result and persists it.
- Frontend reads the persisted result, not a locally computed one.
- Priority order: Gate 1 backend (request validation), Gate 3 backend (receipt accumulation), Gate 4 backend (progress derivation).

---

### 3.2 CRITICAL — Baseline Import Pipeline Is Incomplete

**Files:** `workflows/screens/BaselineScreen.tsx` (import UI exists), `tools/baseline.ts` (import logic partial)
**Brief violation:** §13.1 — "Build a staged import pipeline: upload → preserve → parse → map → review → publish frozen baseline."

**Impact:**
- Gate 1 cannot suggest materials from AHS (falls back to free text input — "baseline belum tersedia").
- Project material master is not generated from AHS.
- Tier 1/2/3 material assignment based on AHS unavailable.
- Gate 1 envelope logic (Tier 2) cannot function without project_material_master.
- All subsequent gates have weaker validation because they don't know the canonical material set.

**What needs to happen:**
- Complete the staging table pipeline: upload Excel → parse into `import_staging_rows` → estimator reviews → publish to `boq_items` + `ahs_lines` + `project_material_master`.
- Estimator review queue must flag low-confidence material mappings.
- Baseline versioning: once published, freeze the version and only allow new version for revisions.

---

### 3.3 HIGH — Office Dashboard Does Not Separate Roles

**File:** `office/navigation.tsx` — all office roles use identical 5-tab navigation (Home, Approvals, Procurement, Materials, Reports).
**Brief violation:** §14.1 — "Do not expose identical interfaces to admin, estimator, principal, and supervisor."

**Current state:**
- Estimator, admin, and principal all land in `OfficeNavigation` with the same 5 tabs.
- `OfficeHomeScreen` shows role label ("ESTIMATOR DASHBOARD") but same layout for all.
- Principal sees the same procurement and materials tabs as the admin.

**Required per brief:**

| Role | Required Experience |
|------|-------------------|
| **Principal** | Exception inbox (HIGH/CRITICAL only), weekly digest, project health cards, approve/reject/hold/override, audit triggers — mobile-first |
| **Estimator** | Baseline builder, import review, request exception review, defect validation, VO analysis, schedule management, price benchmark — desktop-first |
| **Admin** | PO creation, vendor management, price entry, procurement coordination, delivery status — desktop-first |

**What needs to happen:**
- Add role-aware branching inside `RoleRouter`: `supervisor` → AppNavigation, `principal` → PrincipalNavigation, `estimator` → EstimatorNavigation, `admin` → AdminNavigation.
- Or: keep one OfficeNavigation but dynamically show/hide tabs and content by role.
- Principal home should filter ApprovalsScreen to show HIGH/CRITICAL flags first, with a weekly digest section.

---

### 3.4 HIGH — Principal Exception-Driven View Is Missing

**Brief requirement:** §9.3 — Principal Home shows: high/critical exceptions, audit triggers, projects at risk, weekly digest, major open defects, approvals waiting.
**Brief §28.4:** Principal mobile must support exception inbox, weekly digest, project health cards, approve/reject/hold/override, audit triggers.

**Current state:**
- Principal sees the same `ApprovalsScreen` as estimator/admin with all statuses visible.
- No severity filter — LOW flag MTNs appear alongside CRITICAL material requests.
- No "Hold" action on material requests (only Approve/Reject).
- No audit trigger button anywhere.
- No weekly digest summary view.

**What needs to happen:**
- In `ApprovalsScreen`, filter default view for principal to HIGH/CRITICAL flags only.
- Add "Hold" action for material requests in principal view.
- Add "Trigger Audit" action on anomaly events or critical requests.
- Create a weekly digest summary card on principal home.

---

### 3.5 HIGH — Defect Management Fields Incomplete

**Brief §19.2 requires each defect to include:**
- `responsible_party` — who is responsible for the fix
- `target_resolution_date` — deadline
- `verifier` — who will verify completion
- `handover_impact` — does this block handover?

**Current state:**
- Defects are created in `ProgresScreen` with: BoQ ref, location, description, severity, photos.
- Missing fields: responsible_party, target_resolution_date, verifier, handover_impact.
- Estimator has no dedicated screen to validate severity and assign responsible party.
- The defect lifecycle states exist but the transitions (supervisor creates → estimator validates → supervisor repairs → estimator verifies) are not UI-enforced.

**What needs to happen:**
- Add defect assignment fields to the schema.
- Estimator needs a dedicated "Defect Validation" tab or panel in the office view.
- When estimator validates a defect: assign responsible_party, set target_resolution_date, confirm severity.
- Track verifier at VERIFIED state transition.

---

### 3.6 MEDIUM — Gate 2 Not Role-Differentiated

**File:** `workflows/screens/Gate2Screen.tsx` — shared across all roles
**Brief §16.4:** Admin desktop = PO creation + vendor comparison + justification. Estimator = benchmark analysis + price history. Principal = high-signal approval cards + approve/reject/hold/override.

**Current state:**
- Gate2Screen is embedded in `LaporanScreen` (supervisor's Laporan tab) and accessible to estimator/admin/principal.
- One shared interface for all roles.

**What needs to happen:**
- Gate2Screen should render different content based on `profile.role`.
- Admin view: PO candidate entry, vendor comparison, justification capture.
- Estimator view: price benchmark, AHS baseline deviation, historical price graph.
- Principal view: HIGH/CRITICAL price deviations only, with approve/reject/hold buttons.

---

### 3.7 MEDIUM — Supervisor Home Missing Action Shortcuts

**Brief §9.1:** Supervisor Beranda should show shortcuts into Permintaan, Terima, and Progres.

**Current state:**
- Beranda has StatTiles and activity log — good.
- Alert banner deep-links to Laporan/Jadwal.
- No quick-action buttons to start a new request, confirm a delivery, or input progress.

**What needs to happen:**
- Add 3 quick-action shortcut buttons below the StatTiles on Beranda:
  - "Buat Permintaan" → navigate to Permintaan tab
  - "Konfirmasi Penerimaan" → navigate to Terima tab
  - "Input Progres" → navigate to Progres tab
- Add a "Blocked/Held Requests" section showing requests the supervisor submitted that are AUTO_HOLD or REJECTED.

---

### 3.8 MEDIUM — Approval Actions Missing "Hold" Option

**Brief §14.5:** Principal can "approve, reject, hold, override."

**Current state:**
- `ApprovalsScreen.handleRequest()` only supports APPROVED and REJECTED.
- No HOLD action visible.
- Brief requires HOLD as a distinct state (different from REJECTED — hold means pending more information, not permanently blocked).

**What needs to happen:**
- Add `HELD` as a valid `overall_status` for material request headers.
- Add "Hold" action button in principal view of ApprovalsScreen.
- HOLD should trigger a note/reason field (why is it held).
- Supervisor should see "HELD" status on their request.

---

## 4. Dashboard Evaluation — What to Display and How

### 4.1 Supervisor Beranda — What to Add

**Current:** Progress %, pending deliveries, open defects, critical defects, at-risk milestones, activity log.
**Add for completeness:**

| Widget | Data Source | Priority |
|--------|------------|----------|
| Quick-action shortcuts (Permintaan, Terima, Progres) | Navigation only | HIGH |
| "My Blocked Requests" card | `material_request_headers` where `requested_by = me` and `overall_status IN (AUTO_HOLD, REJECTED)` | HIGH |
| "Expected deliveries this week" | `purchase_orders` where status=OPEN/PARTIAL and `target_date` within 7 days | MEDIUM |
| Payroll-tagged entries this week count | `progress_entries` where `payroll_tag = true` this week | LOW |

---

### 4.2 Office Home — Role-Specific Enhancements

**For Estimator home, add:**
- "Requests needing exception review" (overall_flag = WARNING/HIGH/CRITICAL, overall_status = AUTO_HOLD)
- "Unvalidated defects" count (status = OPEN, no responsible_party)
- "VO entries awaiting cause classification" count
- "Price deviations this week" summary

**For Admin home, add:**
- "Open POs by vendor" breakdown (which vendor has the most pending deliveries)
- "Overdue POs" — POs where expected delivery date has passed
- "Price entries awaiting" (materials with POs but no price entry)
- Quick access to "New PO" creation form

**For Principal home, add:**
- HIGH/CRITICAL exception inbox at the top (not buried in tabs)
- Weekly digest card (auto-generated Monday summary)
- "Projects at risk" — projects with DELAYED milestones or CRITICAL defects across all assigned projects
- "Pending approvals" count with direct action buttons (approve/reject/hold without going to ApprovalsScreen)
- Audit trigger button visible on any flagged item

---

### 4.3 OfficeReportsScreen — Additions Needed

The office reports screen is clean and functional. Add:
- Defect breakdown by severity and responsible party
- VO summary by cause category (how many are client-caused vs estimator-caused)
- At-risk milestone count with days-to-deadline
- Material balance summary (per-material, not just aggregated count)

---

## 5. Report Evaluation — Gaps and Required Additions

### 5.1 Missing Report Types (vs Brief §21.3)

| Report Type | Brief Requirement | Current Status | Impact |
|-------------|-------------------|----------------|--------|
| `payroll_support_summary` | §21.3 — payroll support report | **MISSING** | Admin cannot process payroll without this |
| `client_charge_report` | §21.3 — client additional-charge support report | **MISSING** | Cannot invoice clients for additional work |
| `audit_list` | §21.3 — audit list report | **MISSING** | Cannot track audit findings |

**Add these 3 report types to both `LaporanScreen` and `OfficeReportsScreen`:**

```
payroll_support_summary:
  - All progress_entries where payroll_tag = true
  - Grouped by: BoQ item, date, supervisor, work_status
  - Shows: qty, note, photo reference
  - Filter: date range, BoQ item, supervisor

client_charge_report:
  - All VO entries where cause = 'client_request' or 'owner_supplied_material'
  - All progress entries where client_charge_tag = true
  - All rework entries linked to client-caused VOs
  - Shows: location, description, est_cost, approved_by, date
  - Groups: billable vs absorbed
  - Filter: date range, cause category, approval status

audit_list:
  - All anomaly_events + audit_cases
  - Shows: type, trigger, flag level, status, assigned reviewer, resolution
  - Filter: date range, flag level, status
```

---

### 5.2 Critical — Reports Have No Filters

**Current behavior:** Clicking any report in Export Center generates it for the entire project, all time, no scope.
**Brief §23.2:** All reports must support — project, date range, BoQ range, vendor, responsible party, severity, VO cause, payroll tag, client-charge tag.

**Impact on invoicing:**
- An admin cannot generate a material receipt log for just the current billing period.
- An estimator cannot generate a progress summary for just specific BoQ items.
- A client-charge report for the month is impossible without date filtering.

**Solution — Add Filter Sheet to Export Center:**

Before generating any report, show a bottom sheet with relevant filters:

```
[Date Range]      From: [____] To: [____]
[BoQ Items]       All / Select specific items
[Responsible]     All / [Person name]
[Severity]        All / Minor / Major / Critical
[VO Cause]        All / Client Request / Design Revision / ...
[Vendor]          All / [Vendor name]
[Tag]             All / Payroll / Client Charge / Both
```

Not all filters apply to all reports. Show only relevant filters per report type.

---

### 5.3 Material Balance Report — Depth Required for Admin Invoicing

**Current:** Shows totals only (total materials tracked, low stock count, deficit count).
**Required for admin/estimator use:**

| Column | Source |
|--------|--------|
| Material name | material_catalog |
| Tier | ahs_lines |
| Planned qty (from AHS baseline) | project_material_master |
| Total ordered (all PO lines) | purchase_order_lines SUM |
| Total received (all receipts) | receipt_lines SUM |
| Total installed (derived from progress) | progress_entries SUM |
| On-site balance | received − installed |
| MTN transferred out | mtn_requests SUM |
| MTN received in | mtn_requests SUM from other projects |
| Variance (received vs planned) | % deviation |
| Status flag | OK / LOW_STOCK / DEFICIT |

This level of detail allows an admin to reconcile exactly what was ordered, received, used, and remains — essential for supplier invoicing and project accounting.

---

### 5.4 Receipt Log — Add Fields for Invoicing

**Current:** Shows receipt date, material name, qty, vehicle ref, partial/final flag.
**Required for admin invoicing:**

| Missing Field | Source | Why Needed |
|--------------|--------|------------|
| Vendor/supplier name | purchase_orders.vendor | Invoice matching |
| Unit price (at time of PO) | purchase_order_lines.unit_price | Cost verification |
| PO reference number | purchase_orders.po_number | Cross-reference |
| Total line value (qty × price) | Calculated | Invoice total |
| Cumulative received vs PO total | Calculated | Delivery progress |
| Delivery note number | receipts.vehicle_ref or note | Document tracing |

---

### 5.5 Progress Summary — Add Invoicing Columns

**Required by admin/estimator for billing:**

| Field | Purpose |
|-------|---------|
| BoQ item code + label | Identifies what was done |
| Planned qty | Baseline |
| Installed qty to date | Billable work |
| % complete | Progress benchmark |
| Billable entries count | Progress entries tagged client_charge |
| Work status breakdown | IN_PROGRESS vs COMPLETE vs COMPLETE_DEFECT |
| Payroll-tagged entries | Internal cost allocation |
| Open defects on this BoQ item | Quality status |

---

### 5.6 VO Summary — Add Cause Distribution for Client Reports

**Current:** Lists VO entries with description, location, cost estimate.
**Required:**

| Field | Purpose |
|-------|---------|
| Cause category | Client request / Design revision / Estimator error / ... |
| Billable to client? | Yes (client_request, owner_supplied) / No (contractor, estimator) |
| Approval status | APPROVED / AWAITING / REJECTED |
| Margin impact grade | low / medium / high / critical |
| Total estimated value by cause | Cost accountability |
| Absorb vs bill ratio | Internal performance metric |

---

## 6. Data Flow Evaluation by User Perspective

### 6.1 Supervisor Flow — Adequate, Minor Gaps

**✅ Works well:**
- Submit request → bundled header+lines → gate validation → status shown
- Confirm delivery → partial/final receipt → photo evidence → accumulation check
- Input progress → append-only → qty + work status + photos
- Submit defect → location + description + severity + photos
- Submit VO/Micro-VO → cause + grade + cost estimate
- Tag payroll/client-charge on progress entries

**🔴 Gaps:**
1. No visibility into request status history (submitted requests are not listed anywhere in the supervisor's Permintaan tab — only submit new ones).
2. No notification when a request is approved, rejected, or held (supervisor must refresh Beranda to see).
3. Beranda doesn't show "Your requests awaiting review" — supervisor has no signal that their request is stuck.
4. Blocked requests (AUTO_HOLD) are not prominently surfaced on Beranda.
5. If Gate 1 check returns WARNING, supervisor sees "⚠ Under review" but doesn't know when it will resolve.

**Request:** Add a "My Requests" history list in `PermintaanScreen` showing submitted requests with status badges and dates.

---

### 6.2 Admin Flow — Functional But Incomplete

**✅ Works well:**
- Office home shows pending counts (requests, MTN, VO) with quick navigation.
- ApprovalsScreen allows approve/reject on MTN, VO, and material requests.
- Filter chips per approval type help manage volume.

**🔴 Gaps:**
1. No PO creation UI visible — `OfficeProcurementScreen` exists but unclear if it supports full PO creation workflow.
2. No vendor management screen — vendor comparison required by brief §28.3.
3. No price entry flow — admin should be able to enter actual prices for PO lines; currently Gate2Screen handles this but role separation is missing.
4. No overdue PO tracking — admin cannot see which POs are past expected delivery date.
5. Receipt log not directly accessible to admin — they need to verify deliveries matched POs.
6. Admin cannot trigger a delivery follow-up or send a reminder to a vendor.

---

### 6.3 Estimator Flow — Missing Core Functions

**✅ Works well:**
- Can view and approve/reject material requests in ApprovalsScreen.
- Can access Gate2Screen via Laporan for price review.
- Can manage milestones via Jadwal tab in Laporan.
- Can manage baseline import (BaselineScreen via Laporan tab).

**🔴 Gaps:**
1. **No dedicated defect validation screen.** Estimator is supposed to: validate severity, assign responsible party, set target date, assign verifier. None of this is accessible from current screens.
2. **No VO/rework analysis view.** Estimator should be able to see all VOs grouped by cause, identify estimator-assumption errors, and flag rework patterns. Currently VO entries are only visible in ApprovalsScreen as a flat list.
3. **No detailed Gate 1 diagnostics.** When a material request is AUTO_HOLD, estimator sees the flag but not the detailed check output (which check, what the actual vs planned quantities were). The `line_check_details` field exists in the schema but isn't displayed.
4. **No performance analysis view.** Estimator should be able to see pace anomalies, cross-BoQ progress patterns, and material consumption vs AHS baseline.
5. **No schedule-progress linkage view.** Estimator needs to see: which BoQ items are behind schedule, which milestones are at risk, and what the material situation is for those items.

---

### 6.4 Principal Flow — Critically Underserved

**✅ Works well:**
- Can see office home with pending counts.
- Can approve/reject items in ApprovalsScreen.
- Can see milestone status on office home.

**🔴 Gaps:**
1. **No exception inbox.** Principal sees all MTN/VO/requests regardless of severity. A HIGH-flag material request looks the same as a routine one.
2. **No Hold action.** Only Approve/Reject available.
3. **No Override mechanism.** Brief requires principal can override — not visible in current UI.
4. **No audit trigger.** Principal should be able to flag a transaction for audit directly from the approval card.
5. **No weekly digest.** No auto-generated weekly summary card. Weekly digest report exists but only as on-demand generate, not auto-populated.
6. **No cross-project view.** If principal manages multiple projects, they need a dashboard showing which projects have critical issues across all projects — not just one active project.
7. **Handover eligibility visible on OfficeReportsScreen** — but principal needs a clear "Approve Handover" action button when all defects are resolved.

---

## 7. Suggested Plugins and Architecture Improvements

### 7.1 Supabase Edge Functions (Backend Gates)

**Why:** The single most important architectural change. All gate logic must move server-side.

**Suggested edge functions:**
```
POST /functions/v1/submit-request      → runs gate1 validation, persists result
POST /functions/v1/submit-receipt      → runs gate3 validation, updates PO status
POST /functions/v1/submit-progress     → runs gate4 validation, derives installed totals
POST /functions/v1/generate-report     → runs report generation server-side
GET  /functions/v1/material-balance    → derives live material balance from DB
POST /functions/v1/trigger-audit       → creates anomaly_event → audit_case
```

---

### 7.2 Supabase Scheduled Jobs (pg_cron or Edge Function Crons)

**Why:** Weekly digest cannot be manually triggered — it needs to auto-generate every Monday for principal review.

**Suggested scheduled jobs:**
```
Every Monday 06:00 WIB  → generate_weekly_digest(all active projects)
Every day    00:00 WIB  → refresh_material_balance_view(all projects)
Every day    00:00 WIB  → update_milestone_status(all projects)
Every week              → random_audit_selection(gate3 receipts)
```

---

### 7.3 Supabase Realtime / Push Notifications

**Why:** Supervisors and principals need to know when something requires their attention without polling.

**Plugin:** Expo Push Notifications (already in Expo ecosystem)

**Trigger events:**
- Supervisor's request approved/rejected/held → notify supervisor
- HIGH/CRITICAL flag fired on any submission → notify principal + estimator
- Milestone status changes to AT_RISK or DELAYED → notify estimator + principal
- MTN approved → notify requesting supervisor

---

### 7.4 PDF Generation Service

**Why:** Client invoicing and handover documents require PDF, not Excel.
**Brief §21.3** explicitly mentions "weekly digest PDF."

**Options:**
- `react-native-html-to-pdf` (client-side, works for simple reports)
- Supabase Edge Function + `puppeteer` or `@react-pdf/renderer` (server-side, better for complex reports)
- External service: **DocRaptor** or **PDFco** via Edge Function API call

**Priority reports needing PDF:**
1. Weekly digest PDF (for principal)
2. Handover punch list PDF (for client)
3. Client additional-charge report PDF (for invoicing)
4. Material balance report PDF (for admin reconciliation)

---

### 7.5 Google Sheets / Excel Integration via MCP

**Why:** Admin and estimator work primarily in spreadsheets for invoicing. Reports should push directly to their existing tools.

**Options:**
- **Google Sheets MCP** — push report data directly to a shared spreadsheet
- Current: `exportReportToExcel()` saves locally on device — inadequate for sharing
- Needed: Sharing/upload to cloud (Google Drive, Dropbox, or WhatsApp)

**Improvement:** After Excel export, offer "Share via WhatsApp" / "Upload to Drive" — critical for Indonesian construction teams.

---

### 7.6 WhatsApp Business API / Notification MCP

**Why:** In Indonesia, the primary communication channel in construction teams is WhatsApp. Push notifications in the app will be missed; WhatsApp messages will not.

**Integration point:**
- When a HIGH/CRITICAL flag fires, send a WhatsApp message to the principal's registered phone number.
- When a weekly digest is ready, send a summary to the principal's WhatsApp.
- When a request is approved/rejected, notify the supervisor via WhatsApp.

**Tool:** Fonnte, WA-Gateway, or official WhatsApp Business API via a Supabase Edge Function.

---

### 7.7 AI-Assisted Baseline Import (Phase 11)

**Why:** The baseline import pipeline needs AI to map Excel rows to normalized material catalog entries with confidence scoring.

**Architecture:**
- Supabase Edge Function calls Anthropic API (Claude claude-haiku-4-5-20251001 for cost efficiency)
- Input: raw Excel row (material name string from contractor's BoQ)
- Output: `{ material_id, confidence, alternatives, spec_match }`
- Low-confidence mappings routed to estimator review queue

---

## 8. Report Architecture for Admin/Estimator/Client Invoicing

### 8.1 Required Report Matrix

| Report | Who Uses It | Frequency | Format | Key Filters |
|--------|------------|-----------|--------|-------------|
| Weekly Digest | Principal | Weekly (auto) | PDF + in-app | Auto (current week) |
| Progress Summary | Estimator, Admin | Per billing cycle | Excel + PDF | Date range, BoQ range |
| Material Balance | Admin, Estimator | On demand | Excel | — |
| Receipt Log | Admin | Per billing cycle | Excel | Date range, vendor |
| Payroll Support Summary | Admin | Per payroll period | Excel | Date range, supervisor |
| **Client Additional-Charge Report** | Admin, Estimator | Per billing | Excel + PDF | Date range, cause |
| VO Summary | Estimator, Principal | Monthly | Excel | Date range, cause, status |
| Punch List | Principal, Estimator | Pre-handover | PDF | Severity, status |
| Schedule Variance | Estimator, Principal | Weekly | In-app | — |
| Audit List | Principal, Estimator | On demand | Excel | Date range, flag level |

---

### 8.2 Client Invoice Support Flow

For a client to be invoiced for work completed and additional charges, the following data must be easily extractable:

```
Step 1: Generate Progress Summary (filtered to billing period)
   → Shows: BoQ items, qty installed, % complete, work status
   → Billable items = entries with work_status = COMPLETE or COMPLETE_DEFECT

Step 2: Generate Client Additional-Charge Report
   → Shows: All VOs with cause = 'client_request' or 'owner_supplied_material'
   → Shows: All progress entries with client_charge_tag = true
   → Shows: est_cost, approval status, approver name

Step 3: Generate Receipt Log (filtered to billing period)
   → Shows: Materials received, quantities, vendor, PO reference
   → Cross-reference with material balance to validate quantities

Step 4: Combine into invoice package:
   → Progress Summary (work completed)
   → Client Charge Report (additional work)
   → Punch List if partial handover (defects status)
   → Material Balance (accountability)
```

The Export Center should have a "Generate Invoice Package" button that runs all 4 reports with one date range input and packages them together.

---

## 9. Implementation Priority Order

Following the SAN_TASK_BREAKDOWN.md phase logic, prioritized by business impact:

### Immediate (Required for production use)

| # | Task | Impact |
|---|------|--------|
| 1 | Move Gate 1 validation to Supabase Edge Function | Security + reliability |
| 2 | Add "My Requests" history to PermintaanScreen | Supervisor UX |
| 3 | Add payroll_support_summary and client_charge_report to Export Center | Admin invoicing |
| 4 | Add date range + BoQ filters to all reports | Admin/estimator usability |
| 5 | Add Receipt Log missing fields (vendor, unit price, PO ref) | Admin invoicing |

### Near-term (Within next 2 development sprints)

| # | Task | Impact |
|---|------|--------|
| 6 | Complete baseline import pipeline (staging → review → publish) | All gates unblocked |
| 7 | Add role-aware branching: PrincipalNavigation separate from EstimatorNavigation/AdminNavigation | Brief compliance |
| 8 | Add defect validation screen to estimator view (assign responsible, target date, verifier) | Defect lifecycle |
| 9 | Add "Hold" action to ApprovalsScreen for material requests | Principal workflow |
| 10 | Add audit trigger button to principal view | Brief compliance |

### Medium-term (Phase 4–8 per task breakdown)

| # | Task | Impact |
|---|------|--------|
| 11 | Move Gate 3 and Gate 4 to backend edge functions | Architecture |
| 12 | Build scheduled weekly digest job (auto-generate every Monday) | Principal UX |
| 13 | Add PDF export for weekly digest and client charge report | Professionalism |
| 14 | Implement WhatsApp notification for HIGH/CRITICAL flags | Field ops |
| 15 | Add estimator VO/rework analysis view (cause distribution) | Estimator workflow |
| 16 | Build vendor management and PO creation UI for admin | Admin completeness |
| 17 | "Generate Invoice Package" — combined 4-report export button | Client invoicing |

---

## 10. Analyst Review Findings — Hidden Requirements & Edge Cases

*Added after Analyst (Opus) consultation on the plan draft.*

### 10.1 Concurrency & Data Consistency (CRITICAL)

**Concurrent receipt submissions:** If two supervisors submit partial receipts for the same PO within seconds, both will pass Gate 3 quantity checks independently but could together exceed the PO total. The backend edge function for Gate 3 must use a database transaction with row-level locking on the PO record before accepting a receipt.

**Optimistic locking required:** `MaterialRequest`, `Defect`, `PO`, and `BoQ` records must include a `version` integer field. Before any update, check that `version` matches; if not, reject with a conflict error. This prevents two estimators overwriting each other when simultaneously reviewing the same request.

**Duplicate request prevention:** No unique constraint prevents a supervisor from submitting 5 material requests for the same BoQ item on the same day. Add a deduplication check before insert: if a PENDING/UNDER_REVIEW request for the same `(project_id, boq_item_id, requested_by)` exists in the last 24 hours, warn the supervisor rather than silently creating a duplicate.

### 10.2 Gate Validation Edge Cases (HIGH)

**Partial receipt followed by new material request:** If 60 units of a 100-unit PO are received, and a supervisor submits a new request for 50 more units, Gate 1 must subtract already-received quantities before checking against BoQ planned. Without this, the request gets incorrectly rejected (60 received + 50 requested = 110, flagged as exceeding 100 planned).

**Progress entry accumulation cap:** A supervisor can submit progress entries indefinitely for the same BoQ item — the derivation currently sums all entries without checking against `boq_items.planned`. The backend must enforce: `total_installed ≤ planned × 1.05` (5% tolerance). Above this, Gate 4 must return a WARNING or CRITICAL flag.

**BoQ revision during active requests:** If an estimator changes a BoQ item's planned quantity while a supervisor has a PENDING request, the gate validation must reference the baseline version active at the time of the request submission, not the current version. All request lines must store `baseline_version_id` at submission time.

### 10.3 Data Integrity Gaps (HIGH)

**VO → Formal VO lifecycle undefined:** `VOEntry` records can be APPROVED but no specification exists for when a `FormalVO` is created. Must define: Is FormalVO auto-created on approval, or manually batched by admin? Can one VOEntry be in two FormalVOs? A FormalVO must not be invoiced if any linked defect is not in ACCEPTED_BY_PRINCIPAL state.

**Payroll + Client Charge double-tagging:** A `ProgressEntry` can have both `payroll_tag = true` and `client_charge_tag = true` simultaneously. No rule specifies behavior. Define: both can be true (internal cost allocation ≠ client billing). The payroll summary counts by `payroll_tag`; the client charge report counts by `client_charge_tag`. No double-billing occurs as these are separate report dimensions.

**Receipt with no unit price:** If a PO exists but the admin hasn't entered `unit_price` on PO lines yet, the Receipt Log cannot compute line totals. Define behavior: Receipt Log shows "Harga belum diisi" for missing prices. Admin cannot export a client invoice PDF until all PO line items have a unit_price.

### 10.4 Operational Gaps (MEDIUM)

**Weekly digest timezone:** Scheduled job must run at a fixed WIB (UTC+7) time — e.g., Monday 00:00 WIB = Sunday 17:00 UTC. The job must use database transactions: if any step in digest generation fails, roll back entirely. Retry logic must not create duplicate digests.

**Report data freshness:** Material Balance and Receipt Log must display a `generated_at` timestamp. If derived data is older than 1 hour (RPC failed, fallback used), show a warning banner: "Data mungkin tidak terkini — di-generate ulang sebelum digunakan untuk invoice."

**Hold action scope:** Principal "Hold" applies to `MaterialRequest` headers only (not PO or ProgressEntry). A HELD request can only be un-held by the principal who applied it or a higher-authority principal. HELD requests appear on the supervisor's Beranda as "Menunggu klarifikasi dari Prinsipal."

**Defect SLA:** Define maximum defect age: OPEN defects > 30 days without status change escalate to estimator inbox. VALIDATED defects > 14 days without IN_REPAIR escalate to principal. These thresholds must be configurable per project.

### 10.5 Open Questions for Wilson to Decide

Before implementation begins, these must be answered:

- [ ] **Baseline import format:** Do all supplier AHS files follow a consistent Excel structure? Provide 3–5 real AHS files to validate before coding the parser. Decide: Does Anthropic API do fuzzy matching for material names, or only flag mismatches for estimator manual review?
- [ ] **Receipt variance threshold:** What is the maximum acceptable variance between PO quantity and received quantity before Gate 3 returns CRITICAL? (Suggested: Tier 1 = 0%, Tier 2 = 10%, Tier 3 = 15%)
- [ ] **Progress accumulation tolerance:** Can total installed exceed BoQ planned? If yes, by what %? (Suggested: warning at 95%, CRITICAL flag at 105%)
- [ ] **Filter scope for report dates:** Should Material Balance filter by `created_at` of the receipt/request, or by `target_date`/`delivery_date`? Affects invoicing cutoff accuracy.
- [ ] **Subcontractor as responsible party:** When an estimator assigns `responsible_party` on a defect, can this be a subcontractor outside the project team? If yes, how is their contact stored?

---

## 11. Acceptance Criteria

The platform is considered production-ready when:

- [ ] Gate logic runs server-side for all 5 gates; client cannot bypass validation
- [ ] Baseline can be imported, reviewed, and frozen per project
- [ ] Supervisor can see history of their submitted requests with status
- [ ] Principal sees only HIGH/CRITICAL items by default; can Hold requests; can trigger audits
- [ ] Estimator has dedicated defect validation screen with responsible party assignment
- [ ] All reports have date range and BoQ scope filters
- [ ] Payroll support summary and client additional-charge report are in Export Center
- [ ] Material Balance report shows per-material breakdown (planned / ordered / received / installed / on-site)
- [ ] Receipt Log shows vendor, unit price, PO reference
- [ ] Weekly digest auto-generates every Monday
- [ ] Excel reports can be shared via native share sheet (WhatsApp, email, Drive)
- [ ] Admin has PO creation and vendor comparison screens
- [ ] Principal has an "Approve Handover" button when all blocking defects are resolved

---

## 11. Verification Steps

How to confirm each improvement area is correctly implemented before marking complete.

### 11.1 Gate Logic — Backend Migration Verified When:
- Submit a material request from the supervisor mobile app while the network is connected but the gate1.ts client file is deleted or emptied — the request must still be validated and flagged correctly by the server.
- Submit a quantity exceeding 130% of remaining BoQ. The server must return `flag: CRITICAL` and persist `overall_flag = 'CRITICAL'` in `material_request_headers` — not computed by the client.
- Query `material_request_headers` directly via Supabase dashboard. The `overall_flag` and `line_check_details` columns must be populated by the backend, not null.

### 11.2 Baseline Import Pipeline Verified When:
- Upload a real project Excel file with BoQ and AHS rows. After processing, `boq_items`, `ahs_lines`, and `project_material_master_lines` tables in Supabase are populated with the correct extracted values.
- In `PermintaanScreen`, after selecting a BoQ item, a list of suggested materials appears based on AHS lines (not a blank form). The text "baseline belum tersedia" must not appear for any project with a published baseline.
- Mark a baseline as published. Attempt to re-import — the system must create a new version rather than overwriting the existing frozen baseline.

### 11.3 Role Separation Verified When:
- Log in as a principal account. Confirm that the ApprovalsScreen default view shows only HIGH and CRITICAL flag items. Manually verify no WARNING or INFO flag items appear at the top of the list.
- Log in as a principal account. Confirm that a "Hold" button is present on material request cards alongside Approve and Reject.
- Log in as an estimator account. Confirm that a defect with status = OPEN has an accessible "Validate" action that allows entering: responsible_party, target_resolution_date, and verifier. After saving, the defect status must update to VALIDATED in Supabase.
- Log in as an admin account. Confirm that a PO creation form is accessible, allows entering vendor, line items, and pricing, and persists a record to `purchase_orders` and `purchase_order_lines`.

### 11.4 Report Filters Verified When:
- Open Export Center and click "Ringkasan Progres" (Progress Summary). A filter sheet must appear before the report generates — at minimum: date range (From / To), BoQ item selector.
- Generate a progress summary for a date range of exactly one week. The resulting Excel file must only contain progress entries with `created_at` within that range — not all-time entries.
- Generate a receipt log filtered to a specific vendor. The Excel output must only contain receipt sessions for purchase orders from that vendor.

### 11.5 Missing Report Types Verified When:
- In Export Center, a "Payroll Support Summary" option appears. Clicking it (with a date range filter) generates an Excel file containing all `progress_entries` where `payroll_tag = true`, grouped by supervisor and BoQ item, with dates and quantities.
- In Export Center, a "Client Additional-Charge Report" option appears. Clicking it generates an Excel file containing all `vo_entries` where cause = 'client_request' or 'owner_supplied_material', plus all `progress_entries` where `client_charge_tag = true`, with estimated costs and approval status.
- Both new reports record an entry in `report_exports` table (audit trail), confirming server-side generation.

### 11.6 Material Balance Report Depth Verified When:
- Generate a Material Balance report. Open the Excel file. For each row/material, the following columns must all be present and non-null: material name, tier, planned qty, total ordered (PO), total received, total installed, on-site balance, MTN transferred out, variance %.
- Confirm that the "on-site balance" column equals: total_received − total_installed − mtn_transferred_out, verifiable by manual calculation against Supabase data.

### 11.7 Receipt Log Invoicing Fields Verified When:
- Generate a Receipt Log report. Open the Excel file. Each row must include: vendor/supplier name, PO reference number, unit price (from PO line), total line value (qty × unit price), and delivery note reference.
- Cross-reference one receipt row with the corresponding `purchase_orders` and `purchase_order_lines` records in Supabase — the vendor name and unit price must match exactly.

### 11.8 Supervisor Request History Verified When:
- Log in as a supervisor. Navigate to `PermintaanScreen`. A list of previously submitted requests is visible showing: BoQ item, date submitted, status (PENDING / AUTO_HOLD / APPROVED / REJECTED), and urgency.
- Submit a new request. Navigate away and return to `PermintaanScreen`. The new request appears in the history list immediately.
- When a request is set to AUTO_HOLD by the gate engine, the supervisor's Beranda screen shows an alert card "Permintaan Ditahan" referencing that request.

### 11.9 WhatsApp / Push Notification Verified When:
- Submit a material request that triggers a CRITICAL flag. Within 60 seconds, the principal's registered phone number receives a WhatsApp message (or Expo push notification) containing the project name, BoQ item, flag level, and a direct link to the ApprovalsScreen.
- When a request is approved in ApprovalsScreen, the submitting supervisor receives a push notification within 60 seconds.

### 11.10 PDF Export Verified When:
- Click "Rangkuman Mingguan" (Weekly Digest) and choose PDF format. A PDF file is generated containing: project name, week range, overall progress %, pending actions count, open defects summary, milestone status, and VO count.
- The PDF is legible (text not blurred, tables not overflowing), shareable via native share sheet, and viewable on both iOS and Android.

---

## 12. Appendix — Key File References

| Concern | File |
|---------|------|
| Supervisor navigation | `workflows/navigation.tsx` |
| Office navigation (all roles) | `office/navigation.tsx` |
| Gate 1 client logic (must move to backend) | `workflows/gates/gate1.ts` |
| Gate 3 client logic (must move to backend) | `workflows/gates/gate3.ts` |
| Gate 4 client logic (must move to backend) | `workflows/gates/gate4.ts` |
| Report generation | `tools/reports.ts` |
| Excel export | `tools/excel.ts` |
| Material balance derivation | `tools/derivation.ts` |
| Baseline import | `tools/baseline.ts` |
| Scoring engine (not yet integrated) | `tools/scoring.ts` |
| Supervisor home | `workflows/screens/BerandaScreen.tsx` |
| Request screen | `workflows/screens/PermintaanScreen.tsx` |
| Delivery screen | `workflows/screens/TerimaScreen.tsx` |
| Progress hub | `workflows/screens/ProgresScreen.tsx` |
| Report/reconciliation screen | `workflows/screens/LaporanScreen.tsx` |
| Office home | `office/screens/OfficeHomeScreen.tsx` |
| Office approvals | `office/screens/ApprovalsScreen.tsx` |
| Office reports | `office/screens/OfficeReportsScreen.tsx` |
| Multi-project context | `workflows/hooks/useProject.tsx` |
| Auth & role routing | `workflows/App.tsx` |

---

*Plan version 1.0 — Generated 2026-03-28 from full codebase review of SANO construction control platform*
