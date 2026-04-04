# SAN Product Requirements

## 1. Document Purpose

This document translates the SAN developer brief into a product requirements specification.

It is intended for:
- product planning,
- engineering implementation,
- backend and frontend alignment,
- AI-assisted coding workflows using Claude Code or ChatGPT Codex.

This document defines:
- product scope,
- system behavior,
- user roles,
- entity and state logic,
- functional requirements,
- acceptance criteria,
- non-functional requirements.

This document should be read together with:
- [SAN_DEVELOPER_BRIEF.md](/Users/carissatjondro/Dropbox/AI/Claude Code/SAN_DEVELOPER_BRIEF.md)

## 2. Product Vision

SAN is a role-based construction control platform for:
- material control,
- procurement checks,
- delivery verification,
- progress capture,
- defect and punch list tracking,
- VO and rework capture,
- weekly reconciliation,
- report extraction,
- performance evaluation.

The platform must support:
- multiple projects,
- multiple user roles,
- project-specific BoQ and AHS baselines,
- centralized backend validation,
- simplified field input,
- stronger office-side review and principal exception handling.

## 3. Product Goals

### 3.1 Primary Goals

- Make SAN the system of record for project materials, progress, VO, rework, and reconciliation.
- Allow supervisors to submit field data quickly from mobile.
- Move gate logic from the frontend into the backend.
- Support project-specific BoQ-to-AHS-to-material mapping.
- Support one BoQ item requesting multiple materials in one bundled request.
- Support partial receipt flows for one PO across multiple deliveries.
- Consolidate defects, VO, and rework inside the `Progres` workflow.
- Centralize reporting and export inside the Gate 5 reporting area.

### 3.2 Secondary Goals

- Provide role-specific UI for supervisor, estimator, admin, and principal.
- Generate internal and client-facing support reports.
- Build a data structure suitable for future AI benchmarking and anomaly detection.
- Create hidden scoring layers for supervisor and estimator performance.

### 3.3 Non-Goals

- Do not build workforce attendance in this application.
- Do not replace Trello or a full Gantt chart / scheduling system.
- Do not allow AI to override deterministic business controls.
- Do not keep critical gate logic solely in the mobile client.

## 4. Personas and Roles

### 4.1 Supervisor

Primary device:
- mobile

Responsibilities:
- material requests
- receipt confirmations
- progress entry
- defect capture
- VO / Micro-VO capture
- rework tagging
- MTN submission

Restrictions:
- assigned projects only
- cannot edit BoQ baseline
- cannot edit AHS baseline
- cannot edit pricing baseline
- cannot approve overrides

### 4.2 Estimator

Primary device:
- desktop

Secondary device:
- mobile for review

Responsibilities:
- BoQ and AHS baseline setup
- schedule milestone setup
- Gate 1 review
- Gate 2 review
- defect validation
- responsible party assignment
- VO analysis
- rework analysis
- project-level material and schedule evaluation

### 4.3 Admin / Purchasing

Primary device:
- desktop

Responsibilities:
- PO creation
- vendor comparison
- price entry
- procurement coordination

### 4.4 Principal

Primary device:
- mobile

Secondary device:
- desktop for deep review

Responsibilities:
- review high-signal items
- approve / reject / hold / override
- review weekly digest
- trigger audits
- review project health

## 5. Scope Boundaries

### 5.1 In Scope

- auth and role-aware project access
- multi-project assignment
- project switcher in header
- BoQ / AHS / material import
- project-specific material master
- Gate 1 request workflow
- Gate 2 price validation
- Gate 3 delivery verification
- Gate 4 progress hub
- defect lifecycle
- VO and rework handling
- Gate 5 reconciliation and reporting
- export center
- hidden scoring layer
- AI-assisted suggestions

### 5.2 Out of Scope

- workforce attendance module
- full accounting system
- full task assignment board
- full project scheduling suite

## 6. System Surfaces

### 6.1 Supervisor Mobile App

Navigation:
- `Beranda`
- `Permintaan`
- `Terima`
- `Progres`
- `Laporan`

### 6.2 Estimator Workspace

Desktop-first workspace with access to:
- baseline builder
- import review queue
- request review
- price review
- milestone management
- defect validation
- VO and rework analysis
- reporting

### 6.3 Admin Workspace

Desktop-first workspace with access to:
- vendors
- PO creation
- price entry
- delivery coordination
- procurement reports

### 6.4 Principal Dashboard

Mobile-first dashboard focused on:
- approvals
- exceptions
- weekly digest
- project health
- audit triggers

## 7. Product Navigation Requirements

### 7.1 Header

The header must include:
- application title
- role label
- active project selector
- optional account/settings icon

Requirements:
- one user can switch among assigned projects
- one user cannot access non-assigned projects
- project switching must update all screen data

### 7.2 Removal of Redundant Tabs

Requirements:
- remove the standalone `Cacat` tab
- defect logic must move into `Progres`
- supervisor profile must not appear in `Lainnya`

### 7.3 Reporting Area

Requirements:
- `Lainnya` should be replaced or repurposed into `Laporan` or `Kontrol`
- Gate 5 and exports should live there

## 8. Core Product Data Model

The backend must support project-specific truth.

### 8.1 Required Entity Groups

#### Identity and Access

- `profiles`
- `roles`
- `projects`
- `project_assignments`

#### Baseline and Planning

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

#### Transactional Workflows

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

#### Derived and Reporting

- `audit_cases`
- `weekly_digests`
- `report_exports`
- `performance_scores`
- `vendor_scorecards`
- `price_history`
- `anomaly_events`

### 8.2 Core Modeling Rules

- One project baseline must be versioned and frozen.
- One BoQ item may map to multiple AHS lines.
- One BoQ item may suggest multiple materials.
- One material request may contain multiple material lines.
- One PO may receive multiple partial receipts.
- Progress must be append-only, not destructive.
- Derived totals must be server-calculated.

## 9. Baseline Import Requirements

### 9.1 Source Files

The system must support importing Excel-based BoQ and AHS files.

### 9.2 Import Flow

Required flow:

1. upload original file
2. preserve original file in storage
3. parse into staging rows
4. map into normalized entities
5. route ambiguous mappings for human review
6. publish a frozen project baseline version

### 9.3 Required Extracted Fields

The import pipeline must attempt to extract:
- BoQ item code
- BoQ item label
- BoQ unit
- AHS component rows
- material names
- material units
- specifications
- baseline pricing references
- work type mappings

### 9.4 AI-Assisted Mapping

The AI layer may:
- suggest material aliases
- suggest spec normalization
- suggest BoQ to material mappings
- suggest missing links

The AI layer must not:
- silently publish baseline changes
- overwrite estimator-reviewed mappings

### 9.5 Acceptance Criteria

- uploaded file is preserved in original form
- baseline can be versioned and re-opened for review
- ambiguous mappings are flagged for manual review
- low-confidence suggestions are not auto-approved

## 10. Gate 1: Material Request Requirements

### 10.1 Business Logic

One BoQ item may require several materials in one request.

This must be handled as:
- one request header
- many request lines

### 10.2 Data Structure

#### Request Header

Must include:
- project
- BoQ item
- requester
- target date
- urgency
- common note
- overall flag
- overall status

#### Request Line

Must include:
- linked request header
- material reference
- optional custom material name
- tier
- spec reference
- quantity
- unit
- line-level flag
- line-level check details

### 10.3 UI Requirements

Supervisor must be able to:
- select one BoQ item
- see suggested materials from the baseline recipe
- add multiple material rows
- choose from common materials
- use `Custom Material` when needed
- submit all rows together in one request

### 10.4 Validation Rules

The backend must support:
- Tier 1 planned-vs-request logic
- Tier 2 envelope logic
- Tier 3 spend-cap logic
- pace anomaly logic
- cross-project benchmark logic
- schedule timing logic
- AI benchmark placeholder logic

### 10.5 Visibility Rules

Supervisors should see:
- simplified result state
- clear submit/block messaging

Supervisors should not see:
- full anomaly reasoning
- cost-sensitive comparison details
- benchmark diagnostics

Estimators and principals should see detailed evaluation output.

### 10.6 Acceptance Criteria

- one request can include multiple material rows
- rows can include baseline materials or custom materials
- request header stores shared request context
- backend evaluates lines separately
- overall request inherits worst line severity
- supervisor cannot browse non-assigned project BoQ items

## 11. Gate 2: Price Validation Requirements

### 11.1 Scope

Gate 2 is primarily used by:
- admin
- estimator
- principal

### 11.2 Required Checks

The backend must support:
- baseline deviation check
- historical market reference
- vendor consistency check
- severity routing

### 11.3 Severity Ladder

Required severities:
- `OK`
- `INFO`
- `WARNING`
- `HIGH`
- `CRITICAL`

### 11.4 UI Rules

Admin desktop must support:
- vendor comparison
- PO candidate entry
- justification capture

Estimator desktop must support:
- benchmark and historical review
- explanation review

Principal mobile must support:
- high-signal approval cards
- approve / reject / hold / override

### 11.5 Acceptance Criteria

- price entries are validated server-side
- `HIGH` and `CRITICAL` trigger principal review
- justifications are stored and auditable
- admin, estimator, and principal do not share identical screens

## 12. Gate 3: Delivery Verification Requirements

### 12.1 Partial Receipt Support

One PO must support many receipt sessions.

Each session may have:
- different time
- different vehicle
- different quantity
- different evidence set

### 12.2 Data Rules

- receipt sessions must not overwrite previous receipt sessions
- PO status must be derived from total received vs ordered
- receipt evidence must be linked to the receipt session

### 12.3 Required Checks

Implement:
- quantity match check
- photo compliance check
- accumulation check
- anomaly check
- random audit selection

### 12.4 Required Anomaly Logic

The backend should detect:
- suspiciously perfect receipt consistency
- repeated abnormal shortage/overage pattern
- suspicious vendor-supervisor pairing patterns
- critical-triggered audit events

### 12.5 UI Requirements

The supervisor receipt screen must show:
- PO ordered quantity
- received so far
- remaining quantity
- receipt history
- option to save partial receipt
- option to close final receipt

### 12.6 Acceptance Criteria

- one PO can have multiple partial receipts
- receipt history is preserved
- PO status updates automatically
- receipt evidence is tied to each session
- audit selection can be generated from backend rules

## 13. Gate 4: Progress Hub Requirements

### 13.1 Structural Rule

The `Progres` tab must become the main field operations hub.

It must include:
- progress entry
- defect entry
- VO / Micro-VO entry
- rework entry
- optional payroll-support tagging
- optional client-charge support tagging

### 13.2 Progress Entry Data Rules

Each progress event must support:
- project
- BoQ item
- date
- quantity
- work status
- note
- linked photos
- payroll-support flag
- client-charge support flag
- linked VO or rework reference if relevant

### 13.3 Progress UI Rules

The UI must:
- support repeated entries on the same BoQ item across many days
- support multiple submodules with `Back` and `Cancel`
- require report photos
- not require before/after distinction
- not require GPS

### 13.4 Derived Logic

The backend must derive:
- installed total
- percent progress
- milestone completion
- support summaries for payroll and client-charge reporting

### 13.5 Reporting Duplication Rule

If Gate 5 already handles report extraction, Gate 4 must not duplicate the same export UI.

### 13.6 Acceptance Criteria

- defects can be created inside `Progres`
- VO / Micro-VO can be created inside `Progres`
- rework can be tagged inside `Progres`
- multiple entries on one BoQ item accumulate correctly
- no requirement for before/after labeling in progress photos
- no requirement for GPS in progress photos

## 14. Defect Management Requirements

### 14.1 Placement

Defects are part of `Progres`, not a standalone top-level tab.

### 14.2 Required Fields

Each defect must include:
- project
- linked BoQ item
- location
- description
- severity
- responsible party
- target resolution date
- defect photo evidence
- repair photo evidence
- verifier
- handover impact

### 14.3 Required States

Recommended defect states:
- `OPEN`
- `VALIDATED`
- `IN_REPAIR`
- `RESOLVED`
- `VERIFIED`
- `ACCEPTED_BY_PRINCIPAL`

### 14.4 Role Logic

- supervisor creates defect
- estimator validates severity
- estimator assigns responsible party and target date
- supervisor records repair evidence
- estimator or designated reviewer verifies
- principal sees blocking summary

### 14.5 Acceptance Criteria

- standalone defect tab is not required
- defects are manageable within `Progres`
- lifecycle supports more than only open/resolved
- handover blockers can be identified by severity and status

## 15. VO and Rework Requirements

### 15.1 VO Placement

VO capture must exist in `Progres`.

### 15.2 VO Types

The system must distinguish:
- quick field capture (`Micro-VO`)
- formal VO where needed

### 15.3 VO Cause Classification

Every VO should support cause tags:
- client request
- design revision
- estimator assumption error
- supervisor / site error
- unforeseen condition
- owner-supplied issue
- contractor rework

### 15.4 VO Impact Grading

VOs should support impact grading such as:
- low
- medium
- high
- critical margin impact

### 15.5 Rework Rules

Rework must be tagged separately from standard VO.

### 15.6 Acceptance Criteria

- VO capture exists inside `Progres`
- Micro-VO capture is quick and low friction
- rework is explicitly classified
- VO cause is reportable
- VO and rework can be separated in reporting

## 16. Gate 5: Reconciliation and Reporting Requirements

### 16.1 Scope

Gate 5 must be the system reporting and reconciliation center.

### 16.2 Required Outputs

Gate 5 must support:
- weekly reconciliation
- material balance
- Tier 2 burn-rate
- schedule variance
- VO summary
- rework summary
- quality summary
- project health summary
- export center

### 16.3 Export Center

The export center should generate:
- weekly digest PDF
- material balance report
- receipt report
- progress summary
- payroll-support summary
- client-charge support report
- VO report
- handover punch list
- audit list

### 16.4 Acceptance Criteria

- Gate 5 is the single report extraction center
- report export supports filters
- Gate 4 does not duplicate Gate 5 exports without explicit need

## 17. Schedule Requirements

### 17.1 Schedule Model

Milestones must include:
- planned date
- revised date
- revision reason
- linked BoQ items
- revision history

### 17.2 Derived Status

The backend must derive milestone status:
- `ON_TRACK`
- `AT_RISK`
- `DELAYED`
- `AHEAD`

### 17.3 Acceptance Criteria

- milestones can be linked to BoQ items
- revisions are logged
- milestone status is derived from progress and date
- principal can view simplified milestone health

## 18. Report and Export Requirements

### 18.1 Server-Side Generation

All exports must be generated server-side.

### 18.2 Supported Filters

Reports should support:
- project
- date range
- BoQ range
- vendor
- responsible party
- severity
- VO cause
- payroll tag
- client-charge tag

### 18.3 Acceptance Criteria

- exports are reproducible
- exports are auditable
- exports do not depend on a single frontend calculation path

## 19. Photo and Storage Requirements

### 19.1 Progress Photo Rules

Progress photos:
- are required
- do not require before/after distinction
- do not require GPS
- must retain timestamp

### 19.2 Receipt Photo Rules

Receipt evidence:
- remains stricter than progress evidence
- must support structured photo categories where required

### 19.3 Compression Rules

Images must be compressed and resized to reduce storage and bandwidth while preserving report quality.

Recommended behavior:
- resize to reasonable reporting dimensions
- preserve clarity
- generate thumbnails for lists
- keep export-friendly image size for reports

### 19.4 Acceptance Criteria

- uploaded images are smaller than raw originals
- exported reports remain legible
- images are not excessively blurred

## 20. Performance Scoring Requirements

### 20.1 Supervisor Scoring

The backend should evaluate:
- request accuracy
- receipt compliance
- progress accuracy
- audit outcomes
- defect frequency
- rework frequency
- VO discipline
- photo compliance

### 20.2 Estimator Scoring

The backend should evaluate:
- AHS assumption quality
- schedule baseline quality
- mapping quality
- review turnaround time
- defect validation quality
- VO leakage
- rework attribution quality

### 20.3 Acceptance Criteria

- scores are generated from data, not manually typed
- supervisor and estimator scoring are separate
- VO cause and rework data feed performance metrics

## 21. AI Requirements

### 21.1 Allowed AI Functions

AI may support:
- import mapping
- alias normalization
- anomaly grouping
- benchmark suggestions
- vendor pattern analysis
- trend summaries

### 21.2 Restricted AI Functions

AI must not:
- auto-approve cost-sensitive transactions
- override deterministic validation rules
- silently modify project baselines

### 21.3 Acceptance Criteria

- AI suggestions carry confidence
- low-confidence suggestions require human review
- AI decisions are explainable and auditable

## 22. Security Requirements

### 22.1 Access Control

Must enforce:
- role-based access
- project assignment filtering
- least privilege

### 22.2 Auditability

Must log:
- approvals
- rejections
- holds
- overrides
- baseline changes
- schedule changes
- report generation
- manual corrections

### 22.3 Acceptance Criteria

- unauthorized users cannot query other projects
- important actions are auditable
- role restrictions are enforced in backend, not only hidden in UI

## 23. Non-Functional Requirements

### 23.1 Performance

- mobile forms should feel fast
- project switching should be responsive
- report generation should be asynchronous if heavy

### 23.2 Reliability

- progress, request, and receipt submissions must be durable
- baseline versioning must be recoverable

### 23.3 Maintainability

- business rules should be modular and testable
- frontend should not contain the only copy of gate logic

### 23.4 Extensibility

- system should support future AI layer growth
- system should support more projects and more roles over time

## 24. Global Acceptance Criteria

The product is considered aligned with this requirements document when:

- users can switch among assigned projects only
- project baselines can be imported and versioned
- one BoQ item can request multiple materials in one request
- Gate 1 through Gate 5 logic is backend-driven
- one PO can support many receipt sessions
- progress, defects, VO, and rework live within the `Progres` workflow
- Gate 5 acts as the reporting and export center
- supervisor UI remains simple
- office roles have deeper review surfaces
- principal mobile experience is exception-driven
- all critical workflows are auditable

## 25. Implementation Readiness Note

This document is intended to be implementation-ready.

The next companion document should be:
- a task breakdown with phases, dependencies, and deliverables.
