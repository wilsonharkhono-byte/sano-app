# SAN Developer Brief

## 1. Document Purpose

This document is the implementation brief for the SAN software system.

It combines:
- business intent from the SAN design direction,
- software recommendations from evaluation of the current codebase,
- workflow corrections and additional requirements from stakeholder comments.

This brief is intended to be fed directly into an engineering workflow, including use with tools such as Claude Code or ChatGPT Codex.

The target outcome is a production-grade, role-based construction control system, not just a field supervisor form app.

## 2. Executive Summary

SAN should be built as a role-based construction control platform for:
- material control,
- request validation,
- procurement validation,
- delivery verification,
- installed progress capture,
- VO and rework tracking,
- punch list and quality control,
- weekly reconciliation,
- reporting,
- performance evaluation of supervisors and estimators.

The current application direction is useful as a field capture prototype, but it must evolve into:
- a multi-project system,
- a multi-role system,
- a backend-driven rules engine,
- a project-specific AHS-aware data system,
- a unified reporting and reconciliation platform.

The core principle is:

`simple input on the field, strong logic in the backend`

## 3. Product Goals

### 3.1 Primary Goals

- Make SAN the system of record for money, materials, progress evidence, VO capture, rework, and reconciliation.
- Let supervisors submit data quickly from mobile without requiring them to interpret deeper control logic.
- Let estimators, admin, and principals review high-signal issues through role-specific interfaces.
- Use project-specific BoQ and AHS structures, not generic assumptions.
- Enable multi-line material requests, partial receipts, append-only progress logs, and centralized Gate 5 reconciliation.
- Create a data foundation for future AI benchmarking, anomaly detection, and performance scoring.

### 3.2 Secondary Goals

- Generate exportable reports for internal review, payroll support, reconciliation, and client charge support.
- Maintain strong auditability for approvals, overrides, revisions, and exceptions.
- Allow gradual expansion into AI-assisted benchmarking and workflow intelligence.

### 3.3 Non-Goals

- Do not include `absensi kerja` in this application.
- Do not build SAN as a full Gantt or scheduling application.
- Do not rely on frontend-only calculations for critical controls.
- Do not let AI become the primary source of truth for cost-sensitive logic.

## 4. Product Scope

### 4.1 In Scope

- Multi-project assignment and project switching
- Role-based interfaces
- BoQ and AHS import
- Material request workflow
- Gate 1 validation
- Gate 2 price validation
- Gate 3 delivery verification
- Gate 4 progress hub
- Defect capture inside progress
- VO and rework capture
- Gate 5 weekly reconciliation and reporting
- Export center
- Hidden performance scoring
- AI-assisted mapping and benchmarking support

### 4.2 Out of Scope

- Separate workforce attendance application
- Full accounting system
- Full project task management tool
- Full scheduling/Gantt replacement

## 5. Product Philosophy

The system should follow these product principles:

- Traceability over trust
- Centralized validation over client-side heuristics
- Append-only event logging over destructive editing
- Project-specific baseline over generic template assumptions
- Role separation over shared unrestricted access
- Hidden complexity in backend, low-friction input in mobile UI

## 6. User Roles and Device Strategy

| Role | Main Device | Main Responsibilities | Access Pattern |
| --- | --- | --- | --- |
| Supervisor | Mobile | Submit requests, receipts, progress, defects, VO notes, rework, MTN | Only assigned projects |
| Estimator | Desktop first, mobile secondary | Maintain baseline, validate exceptions, manage schedule links, analyze defects and VO/rework | Broad project visibility as assigned |
| Admin / Purchasing | Desktop | Vendor selection, PO entry, price entry, procurement operations | Procurement-focused |
| Principal | Mobile first, desktop optional | Review high-signal issues, approve/reject/hold/override, view weekly digest | Exception-based visibility |

### 6.1 Device Behavior

- Supervisor UI should be mobile-first and task-oriented.
- Estimator UI should be desktop-first with richer data exploration.
- Estimator mobile view should be simplified and suitable for quick checks only.
- Admin UI should be desktop-first and optimized for table-heavy work.
- Principal UI should be mobile-first and show only compressed, actionable summaries.

## 7. Project Access and Multi-Project Logic

### 7.1 Requirements

- One supervisor may handle multiple projects.
- Each user may only access projects explicitly assigned to them.
- A user must never be able to browse or guess access to non-assigned projects.
- The current application header must include a project switcher.

### 7.2 Backend Rules

- Store project assignment per user.
- Load all active assigned projects for the signed-in user.
- Enforce project-level access in the database and API, not only in the frontend.
- All queries must resolve through the active project context unless the role is allowed multi-project analysis.

### 7.3 Frontend UI

The overall header should contain:
- application name,
- role label,
- active project selector,
- optionally a compact account/settings icon.

Supervisor profile should not appear inside `Lainnya`.

## 8. Recommended App Structure

### 8.1 Supervisor Navigation

Recommended mobile navigation:

- `Beranda`
- `Permintaan`
- `Terima`
- `Progres`
- `Laporan`

### 8.2 Structural Changes

- Remove standalone `Cacat` tab.
- Move all defect capture and monitoring into `Progres`.
- Replace the miscellaneous `Lainnya` concept with a clearer reporting/control area such as `Laporan` or `Kontrol`.

## 9. Home Screen Requirements

The home screen should be control-oriented, not just activity-oriented.

### 9.1 Supervisor Home

Show:
- active project,
- pending delivery confirmations,
- blocked or held requests,
- upcoming milestone-related priorities,
- unresolved important quality issues,
- shortcuts into `Permintaan`, `Terima`, and `Progres`.

### 9.2 Estimator Home

Show:
- requests needing review,
- price exceptions,
- milestone risk,
- unresolved major defects,
- recent VO and rework signals,
- weekly digest summary.

### 9.3 Principal Home

Show:
- high and critical exceptions,
- audit triggers,
- projects at risk,
- weekly digest,
- major open defects,
- approvals waiting.

## 10. Core System Architecture

### 10.1 Architecture Direction

Use one shared backend with separate role-focused frontends or views.

Recommended stack:
- React Native / Expo for mobile
- React web app or Next.js for office desktop views
- PostgreSQL backend via Supabase or equivalent
- server functions / edge functions for rules and workflows
- object storage for photos, report files, imports, and exports
- scheduled jobs for weekly and daily routines

### 10.2 Core Rule

The mobile client should submit events.

The backend should determine:
- gate results,
- derived totals,
- milestone completion,
- material balances,
- scoring,
- approval routing,
- weekly reconciliation.

### 10.3 Data Strategy

Prefer:
- append-only event tables,
- derived summary tables or materialized views,
- strong audit logs,
- baseline versioning.

Avoid:
- direct frontend mutation of truth tables,
- destructive edits of history,
- hidden business logic in the client only.

## 11. Baseline Data Model

The system must support project-specific truth, not only generic catalog data.

### 11.1 High-Level Entities

Recommended entities:

- `projects`
- `project_assignments`
- `profiles`
- `roles`
- `boq_items`
- `boq_item_versions`
- `ahs_versions`
- `ahs_lines`
- `material_catalog`
- `material_aliases`
- `material_specs`
- `project_material_master`
- `project_material_master_lines`
- `milestones`
- `milestone_links`
- `milestone_change_log`
- `material_request_headers`
- `material_request_lines`
- `approval_tasks`
- `purchase_orders`
- `purchase_order_lines`
- `receipts`
- `receipt_lines`
- `receipt_photos`
- `progress_entries`
- `progress_photos`
- `defects`
- `vo_entries`
- `formal_vos`
- `rework_entries`
- `mtn_requests`
- `audit_cases`
- `weekly_digests`
- `report_exports`
- `performance_scores`
- `vendor_scorecards`
- `price_history`
- `anomaly_events`

### 11.2 Why This Matters

A BoQ item like `Kolom tipe K24` is only a visible work label.

It does not itself tell the system:
- concrete grade,
- rebar specification,
- formwork type,
- film or non-film formwork,
- hidden material composition,
- project-specific quantity recipe.

That truth must come from AHS and project-specific mappings.

## 12. BoQ, AHS, and Material Mapping Logic

### 12.1 Project-Specific Truth

Each project must maintain a frozen baseline composed of:
- BoQ structure,
- AHS decomposition,
- material specifications,
- milestone schedule,
- price baseline.

### 12.2 AHS Logic

Each BoQ item may map to multiple AHS component rows.

Each AHS row should define:
- linked BoQ item,
- material reference,
- material spec,
- tier,
- theoretical usage rate,
- unit,
- waste or adjustment assumptions,
- baseline source version.

### 12.3 Material Master

The system should generate a per-project Material Master from the AHS baseline.

This Material Master will support:
- request validation,
- procurement planning,
- envelope logic,
- progress cross-checking,
- waste reconciliation.

## 13. Excel and Import Pipeline

### 13.1 Import Principle

Do not expect AI to understand arbitrary Excel files without structure.

Build a staged import pipeline:

1. upload source Excel
2. preserve original file
3. parse into staging rows
4. map into normalized entities
5. route low-confidence mapping for human review
6. publish frozen project baseline

### 13.2 Import Targets

The import pipeline should extract:
- BoQ items
- AHS lines
- material names
- aliases
- units
- specs
- baseline pricing
- project type mappings

### 13.3 AI Role in Import

AI should be used only as an assistant for:
- alias matching,
- spec normalization,
- proposed mapping suggestions,
- missing-link detection,
- confidence scoring.

AI should not silently publish live baseline changes.

### 13.4 Manual Review Queue

The estimator should review:
- low-confidence material matches,
- spec mismatches,
- ambiguous units,
- missing quantity conversions,
- unclear BoQ-to-AHS mapping.

## 14. Role-Based Access Model

### 14.1 General Rule

Do not expose identical interfaces to admin, estimator, principal, and supervisor.

Use the same data backbone, but expose different workflows and fields by role.

### 14.2 Supervisor Permissions

Can:
- submit material requests
- submit delivery confirmations
- submit progress entries
- submit defects
- submit VO / Micro-VO notes
- submit rework tags
- submit MTN requests

Cannot:
- edit pricing baseline
- edit frozen BoQ / AHS
- edit schedule baseline
- approve holds or overrides
- view non-assigned projects

### 14.3 Estimator Permissions

Can:
- maintain BoQ-AHS-material mapping
- maintain schedule milestones
- review Gate 1 exceptions
- review Gate 2 price deviations
- validate defects
- assign responsible party
- classify VO causes
- analyze rework

Cannot:
- act as unrestricted procurement admin if that is separated by role
- freely delete supervisor raw submissions

### 14.4 Admin Permissions

Can:
- create and maintain POs
- enter prices
- manage vendor comparisons
- coordinate procurement operations

Cannot:
- override strategic approvals outside role policy

### 14.5 Principal Permissions

Can:
- approve
- reject
- hold
- override
- trigger audits
- review weekly digest
- review project health

Should mainly see:
- exception summaries
- not all raw field-entry noise

## 15. Gate 1: Material Request Module

### 15.1 Business Requirement

For one BoQ item, a supervisor may need to request several materials in one request.

This must be supported directly by the data structure and UI.

### 15.2 Data Structure

Use:

`material_request_header`
- `id`
- `project_id`
- `boq_item_id`
- `requested_by`
- `target_date`
- `urgency`
- `common_note`
- `overall_flag`
- `overall_status`
- `created_at`

`material_request_line`
- `id`
- `request_header_id`
- `material_id`
- `custom_material_name`
- `tier`
- `material_spec_reference`
- `quantity`
- `unit`
- `line_flag`
- `line_check_details`
- `created_at`

### 15.3 Why Header + Lines Is Required

This is better than one-record-per-material because:
- one work package usually needs several materials together,
- the request should be reviewed as one operational bundle,
- schedule and urgency are often shared across the bundle,
- the system can still validate each material row individually.

### 15.4 Gate 1 UI

Recommended supervisor flow:

1. select project
2. select BoQ item
3. show BoQ summary
4. show suggested materials based on AHS / Material Master
5. allow multiple material lines
6. allow `Custom Material` for uncommon Tier 2 and Tier 3 cases
7. set target date and urgency
8. submit one bundled request

Suggested screen layout:

```text
[Project Selector]
[BoQ Dropdown]
[BoQ Summary Card]
[Suggested Materials List]
[Material Line 1]
[Material Line 2]
[+ Add Material]
[Target Date]
[Urgency]
[Common Note]
[Submit]
```

### 15.5 Gate 1 Validation Rules

Implement all of the following:

- Check 1a: remaining theoretical requirement for Tier 1
- Check 1a: budget envelope logic for Tier 2
- Check 1a: spend cap for Tier 3
- Check 1b: pace anomaly over time
- Check 1c: cross-project benchmark
- Check 1d: schedule pace / milestone timing
- AI benchmark placeholder for average material usage per BoQ-material pattern

### 15.6 Visibility Rules

- Supervisors should not see deep warning diagnostics or high-level risk interpretation.
- Supervisors should see simplified status only:
- `submitted`
- `under review`
- `blocked`
- `approved`
- Estimators and principals should see the full logic and detailed flags.

## 16. Gate 2: Price Validation Module

### 16.1 Purpose

Gate 2 is the admin / estimator / principal pricing validation workflow.

### 16.2 Checks

Implement:

- AHS baseline deviation
- historical price deviation
- vendor self-consistency
- optional market trend reference

### 16.3 Severity Ladder

Use:
- `OK`
- `INFO`
- `WARNING`
- `HIGH`
- `CRITICAL`

The backend must support `HIGH` even if the supervisor interface never sees it.

### 16.4 Role-Specific UI

Admin desktop should focus on:
- PO creation
- vendor comparison
- entering actual pricing
- writing justifications

Estimator desktop should focus on:
- historical analysis
- benchmark comparison
- price pattern review

Principal mobile should focus on:
- high-signal cards
- approve / reject / hold / override

## 17. Gate 3: Delivery Verification Module

### 17.1 Core Requirement

POs must support partial receipts.

One PO may be fulfilled by:
- multiple deliveries,
- multiple vehicles,
- different timestamps,
- different receipt sessions.

### 17.2 Data Structure

Use:

`purchase_orders`
- order-level state

`purchase_order_lines`
- line items if a PO covers more than one material line

`receipts`
- receipt session header

`receipt_lines`
- actual quantities per receipt line

`receipt_photos`
- evidentiary files

### 17.3 PO Status Logic

Backend should auto-maintain:
- `OPEN`
- `PARTIAL_RECEIVED`
- `FULLY_RECEIVED`
- `CLOSED`

### 17.4 Gate 3 Checks

Implement:
- quantity match
- required photo evidence
- higher-control handling for high-risk Tier 1 deliveries
- accumulation check
- random audit selection
- consistency anomaly detection

### 17.5 Random Audit and Anomaly Layer

Include:
- weekly random audit selection
- suspiciously perfect match pattern detection
- repeated same vendor-supervisor consistency pattern
- repeated shortages or overages
- auto-trigger audit on critical flags

### 17.6 Gate 3 UI

Recommended layout:

```text
[PO List]
[PO Detail]
[Received So Far]
[Remaining Quantity]
[Receipt History]
[New Receipt Session]
[Shipment Quantity]
[Vehicle / Shipment Ref]
[Required Photos]
[Note]
[Save Partial Receipt]
[Save Final Receipt]
```

## 18. Gate 4: Progress Hub

### 18.1 Structural Decision

`Progres` should become the main operational work hub.

It should contain:
- progress entry
- defect entry
- VO / Micro-VO entry
- rework entry
- payroll-support tagging
- client-charge support tagging

### 18.2 Remove Standalone Defect Tab

The `Cacat` tab is redundant and should be removed.

Defect workflows should be integrated into `Progres`.

### 18.3 Data Principle

Progress should be append-only.

Do not directly overwrite derived BoQ totals from the frontend.

Use:

`progress_entries`
- per event

Derived server-side:
- installed total
- percent progress
- milestone completion
- payroll-support summary
- client-charge support summary

### 18.4 Progress Photo Logic

For Gate 4:
- photos are required
- before/after distinction is not necessary
- GPS is not necessary

Timestamp should still be retained automatically.

### 18.5 Gate 4 UI Structure

Recommended screen:

```text
[Progress Home]
- Add Progress
- Add Defect
- Add VO / Micro-VO
- Add Rework
- View Recent Entries
```

Every submodule must support:
- `Back`
- `Cancel`
- safe navigation between modules

### 18.6 Progress Entry UI

```text
[BoQ Dropdown]
[Quantity]
[Work Status]
[Photo Upload]
[Optional Note]
[Tag as Payroll Support]
[Tag as Client Charge Support]
[Link to VO if relevant]
[Link to Rework if relevant]
[Submit]
```

### 18.7 Report Extraction Rule

If report extraction duplicates Gate 5 functionality, remove it from Gate 4.

Gate 4 should focus on field capture.

Gate 5 should be the single reporting and export center.

## 19. Defect Management

### 19.1 Defect Placement

Defects should live inside the `Progres` module, not as a separate top-level tab.

### 19.2 Defect Data Structure

Each defect should track:
- project
- linked BoQ item
- location
- description
- severity
- responsible party
- target resolution date
- report photos
- repair photos
- verifier
- handover impact

### 19.3 Defect Lifecycle

Recommended states:
- `OPEN`
- `VALIDATED`
- `IN_REPAIR`
- `RESOLVED`
- `VERIFIED`
- `ACCEPTED_BY_PRINCIPAL` for non-blocking minor acceptance

### 19.4 Role Logic

- Supervisor creates defect entry.
- Estimator validates severity and assigns responsible party.
- Supervisor confirms repair evidence.
- Estimator or designated reviewer verifies completion.
- Principal sees blocking issues and handover summary.

## 20. VO and Rework Handling

### 20.1 Placement

VO entry should be inside `Progres`.

### 20.2 Quick Capture

Support quick `Micro-VO` capture for site changes.

### 20.3 VO Cause Classification

Every VO should be classifiable by cause:
- client request
- design revision
- estimator assumption error
- supervisor/site execution issue
- unforeseen condition
- owner-supplied issue
- contractor rework

### 20.4 VO Grade

Add impact grade:
- low
- medium
- high
- critical margin impact

### 20.5 Rework Rules

Rework must be separate from normal VO.

Rework should:
- count internally for cost,
- impact performance evaluation,
- not automatically count as billable client work.

## 21. Gate 5: Reconciliation, Analytics, and Export Center

### 21.1 Placement

Gate 5 should be accessible through the reporting area such as `Laporan`.

### 21.2 Responsibilities

Gate 5 should handle:
- weekly reconciliation
- material status
- Tier 1 material balance
- Tier 2 burn-rate
- schedule variance
- VO report
- rework report
- quality summary
- performance summary
- export center

### 21.3 Export Center

Gate 5 should be the single place to extract reports such as:
- weekly digest PDF
- material balance report
- receipt log
- progress summary
- payroll-support summary
- client additional-charge support report
- VO report
- handover punch list
- audit list

### 21.4 Gate 5 UI

Suggested layout:

```text
[Laporan / Kontrol]
- Weekly Reconciliation
- Material Status
- VO Report
- Rework Report
- Project Health
- Export Center
```

## 22. Schedule Logic

### 22.1 Principle

SAN should support lightweight schedule-aware control, not full schedule authoring.

### 22.2 Milestone Model

Milestones should include:
- planned date
- revised date
- reason for revision
- linked BoQ items
- revision log

### 22.3 Derived Status

Milestone status should be derived from progress entries and date logic.

Use:
- `ON_TRACK`
- `AT_RISK`
- `DELAYED`
- `AHEAD`

### 22.4 Visibility by Role

- Supervisors see immediate work priorities.
- Estimators see schedule variance and linked material/progress mismatch.
- Principals see condensed project health.

## 23. Reporting Strategy

### 23.1 Gate 4 vs Gate 5

Gate 4 is for data capture.

Gate 5 is for derived reporting and extraction.

Do not duplicate report export UI across both modules unless a specific business need is proven.

### 23.2 Report Filter Requirements

All exported reports should support filters such as:
- project
- date range
- BoQ range
- vendor
- responsible party
- severity
- VO cause
- payroll tag
- client-charge tag

## 24. Photo Handling and Storage Rules

### 24.1 Progress Photos

Progress photos:
- required
- no before/after distinction required
- no GPS required
- must retain timestamp

### 24.2 Delivery Photos

Delivery evidence remains stricter and more structured.

### 24.3 Compression Strategy

Images should be downscaled to reduce load without harming reporting value.

Recommended approach:
- resize long edge to approximately 1600-2000 px
- use JPEG compression around 0.75-0.85
- generate thumbnails for list browsing
- retain medium-quality originals for report export

Do not blur or over-compress images to the point that they become weak evidence.

## 25. Hidden Performance Evaluation Layer

This layer should be driven by backend logic.

It may remain invisible or partially visible to end users depending on role.

### 25.1 Supervisor Evaluation Metrics

Evaluate:
- request accuracy
- receipt compliance
- receipt variance pattern
- photo compliance
- progress accuracy
- audit outcomes
- defect frequency
- rework frequency
- VO capture discipline
- handover blocking issues

### 25.2 Estimator Evaluation Metrics

Evaluate:
- AHS assumption accuracy
- BoQ-material mapping quality
- schedule baseline realism
- review turnaround time
- defect validation quality
- VO leakage
- rework attribution quality
- false positive / false negative review behavior

### 25.3 VO Performance Layer

Track:
- VO count
- VO value
- cause distribution
- absorb vs bill ratio
- estimator-caused vs client-caused ratio
- margin impact

## 26. AI Layer Recommendations

### 26.1 Allowed AI Use Cases

AI may assist with:
- Excel import mapping
- alias normalization
- spec suggestion
- benchmark suggestion
- anomaly clustering
- vendor pattern analysis
- performance trend analysis

### 26.2 AI Restrictions

AI must not:
- silently approve cost-sensitive actions
- overwrite project baselines automatically
- bypass deterministic business rules

### 26.3 AI Output Style

All AI-generated suggestions should include:
- confidence score
- explanation
- required reviewer if below threshold

## 27. Audit and Security Requirements

### 27.1 Security Principles

- enforce role-based access at database and API layer
- enforce project-assignment filtering at every boundary
- do not rely on frontend-only hiding

### 27.2 Audit Principles

Persist audit trails for:
- approvals
- rejections
- holds
- overrides
- PO changes
- baseline revisions
- milestone revisions
- report generation
- manual data corrections

### 27.3 Data Editing Rule

Prefer:
- append-only events
- derived summaries

Avoid:
- rewriting historic records without audit reason

## 28. Frontend UX Requirements by Role

### 28.1 Supervisor Mobile

Must be:
- fast
- simple
- form-oriented
- low-noise
- focused on assigned projects only

Should include:
- project switcher in header
- task-oriented home
- bundled material request flow
- partial receipt flow
- integrated progress hub
- back/cancel safety for submodules

### 28.2 Estimator Desktop

Must support:
- baseline builder
- import review queue
- exception review
- defect validation
- VO and rework analysis
- schedule maintenance
- performance analysis

### 28.3 Admin Desktop

Must support:
- vendor comparison
- PO creation
- price validation workflow
- procurement status management

### 28.4 Principal Mobile

Must support:
- concise exception inbox
- weekly digest
- project health cards
- approvals and overrides
- audit triggers

## 29. Recommended Delivery Sequence

Build in this order:

1. multi-project assignment and project switcher
2. role-based access and role-specific UI surfaces
3. BoQ / AHS / material / spec import and frozen baseline versioning
4. Gate 1 bundled request model with multiple material lines
5. Gate 2 office workflow for admin, estimator, and principal
6. Gate 3 partial receipt architecture and audit logic
7. Gate 4 redesign into the main progress hub
8. Gate 5 reconciliation, reports, export center, and weekly digest
9. hidden performance evaluation layer
10. AI-assisted mapping and benchmarking enhancement

## 30. Final Direction

The system should evolve from a field form app into a full control platform.

The key structural direction is:
- multi-project,
- role-based,
- AHS-aware,
- backend-governed,
- report-centered,
- audit-safe.

The most important UI direction is:
- keep supervisor input simple,
- move hidden control logic to the backend,
- centralize defect, VO, and rework into `Progres`,
- centralize reporting and export into `Laporan`.

The most important data direction is:
- freeze project-specific baselines,
- allow one BoQ item to reference multiple materials,
- allow one bundled request to contain multiple material lines,
- support partial receipts,
- treat progress as append-only events,
- derive summaries and reports server-side.

This document should be treated as the implementation baseline for the next development phase.
