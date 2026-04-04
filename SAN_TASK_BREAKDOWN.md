# SAN Task Breakdown

## 1. Document Purpose

This document turns the SAN product requirements into an implementation plan.

It is intended for:
- engineering sequencing,
- team planning,
- AI-assisted execution with Claude Code or Codex,
- backend/frontend coordination.

Read together with:
- [SAN_DEVELOPER_BRIEF.md](/Users/carissatjondro/Dropbox/AI/Claude Code/SAN_DEVELOPER_BRIEF.md)
- [SAN_PRODUCT_REQUIREMENTS.md](/Users/carissatjondro/Dropbox/AI/Claude Code/SAN_PRODUCT_REQUIREMENTS.md)

## 2. Execution Strategy

The correct build order is:

1. fix core access and project model
2. build baseline import and project truth
3. rebuild transactional modules on top of that baseline
4. centralize backend validation and derived logic
5. build reporting and reconciliation
6. add scoring and AI-assisted layers

This ordering matters because Gate 1 through Gate 5 cannot behave correctly without the project-specific baseline.

## 3. Delivery Principles

- Prefer backend-first implementation for business rules.
- Treat frontend as event submission and review UI.
- Do not over-invest in visual polish before role logic and data structure are stable.
- Keep supervisor flows simple.
- Build office workflows as separate views or apps rather than forcing one shared UI for all roles.

## 4. Suggested Workstreams

Use these workstreams in planning:

- `WS-A`: Access, auth, and project switching
- `WS-B`: Baseline import and project data model
- `WS-C`: Gate 1 request workflow
- `WS-D`: Gate 2 pricing workflow
- `WS-E`: Gate 3 delivery verification
- `WS-F`: Gate 4 progress hub
- `WS-G`: Gate 5 reconciliation and reporting
- `WS-H`: Scoring, anomaly detection, and AI support
- `WS-I`: Security, audits, and infrastructure

## 5. Phase Plan

## Phase 0: Architecture Reset

### Objectives

- confirm target architecture
- confirm frontend split strategy
- confirm database migration direction

### Tasks

- decide whether office roles will use:
- a separate web app,
- or a role-aware web layer in the same repo
- document final entity list
- document API boundaries
- document where server rules will live
- identify which current mobile client logic must move to backend

### Deliverables

- architecture decision note
- initial entity map
- API boundary outline

### Dependencies

- none

### Exit Criteria

- engineering agrees on one technical direction
- role surfaces are clearly separated

## Phase 1: Access, Role Model, and Multi-Project Context

### Objectives

- support multiple assigned projects per user
- add project switcher
- enforce project-level visibility

### Backend Tasks

- update `project_assignments` handling to support multi-project loading
- add role-aware access guards
- define project context resolution strategy
- update RLS or API policies accordingly

### Frontend Tasks

- add project switcher to header
- update app state to support active project selection
- ensure screen data reloads by active project
- remove profile placement from miscellaneous area

### Suggested Current Repo Areas

- [useProject.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/hooks/useProject.tsx)
- [Header.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/components/Header.tsx)
- [navigation.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/navigation.tsx)

### Deliverables

- multi-project project context
- project switcher UI
- role-aware access layer

### Exit Criteria

- one supervisor can switch across assigned projects
- users cannot access non-assigned projects

## Phase 2: Baseline Import and Project Truth

### Objectives

- create project-specific BoQ and AHS backbone
- support Excel import and review flow
- establish frozen baseline versioning

### Backend Tasks

- add baseline entities:
- `boq_item_versions`
- `ahs_versions`
- `ahs_lines`
- `material_catalog`
- `material_specs`
- `project_material_master`
- build staging import tables
- build file upload and preservation flow
- build mapping review queue
- build baseline publish action

### AI Support Tasks

- implement optional mapping suggestion layer
- emit confidence scores
- route low-confidence mappings for estimator review

### Frontend Tasks

- estimator desktop import screen
- import review queue
- baseline publish UI

### Deliverables

- import pipeline
- review queue
- versioned project baseline

### Dependencies

- Phase 1 access layer

### Exit Criteria

- one project can be fully initialized from imported BoQ/AHS data
- ambiguous mappings are reviewable
- a baseline can be frozen and versioned

## Phase 3: Gate 1 Rebuild - Bundled Material Requests

### Objectives

- replace one-material-per-request logic
- support one BoQ item requesting many materials
- move Gate 1 validation server-side

### Backend Tasks

- create `material_request_headers`
- create `material_request_lines`
- implement line-level validation logic
- implement request-level aggregate status logic
- implement hidden detailed diagnostics

Gate 1 rules to implement:
- Tier 1 planned requirement check
- Tier 2 envelope check
- Tier 3 spend-cap check
- pace anomaly
- cross-project benchmark
- schedule timing
- AI benchmark placeholder

### Frontend Tasks

- redesign `Permintaan` screen
- add AHS-based suggested materials
- add multi-line material request rows
- add `Custom Material`
- simplify supervisor-facing status messaging

### Suggested Current Repo Areas

- [PermintaanScreen.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/screens/PermintaanScreen.tsx)
- [gate1.ts](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/gates/gate1.ts)

### Deliverables

- bundled request UI
- line-aware request data model
- backend Gate 1 engine

### Exit Criteria

- one BoQ request can include multiple materials
- supervisors see simplified status only
- detailed warning logic is visible only to office roles

## Phase 4: Gate 2 Office Workflow

### Objectives

- create a real pricing workflow
- support admin, estimator, and principal review

### Backend Tasks

- add price history store
- add vendor scorecard inputs
- add baseline comparison logic
- add severity ladder including `HIGH`
- add approval routing

### Frontend Tasks

- admin desktop price-entry screen
- estimator review screen
- principal exception cards

### Deliverables

- role-specific Gate 2 interface
- auditable pricing checks
- approval routing

### Dependencies

- baseline import
- role model

### Exit Criteria

- price deviations are checked server-side
- `HIGH` and `CRITICAL` items can be escalated
- users see role-appropriate screens

## Phase 5: Gate 3 Rebuild - Partial Receipts and Audit Logic

### Objectives

- support multi-session receipt tracking per PO
- implement stronger receipt auditing

### Backend Tasks

- create `receipt_headers` or `receipts`
- create `receipt_lines`
- support PO state derivation
- implement accumulation logic
- implement anomaly event generation
- implement random audit selection

### Frontend Tasks

- redesign `Terima` screen
- show:
- PO ordered quantity
- received so far
- remaining quantity
- receipt history
- partial receipt action
- final receipt action

### Suggested Current Repo Areas

- [TerimaScreen.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/screens/TerimaScreen.tsx)
- [gate3.ts](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/gates/gate3.ts)

### Deliverables

- partial receipt workflow
- receipt history
- audit selection logic

### Exit Criteria

- one PO can receive many times
- PO state updates correctly
- anomaly events are created

## Phase 6: Gate 4 Rebuild - Unified Progress Hub

### Objectives

- make `Progres` the main field operations module
- merge defects and VO/rework into the same area

### Backend Tasks

- create append-only `progress_entries`
- create `progress_photos`
- create or expand `vo_entries`
- create or expand `rework_entries`
- link progress to payroll-support and client-charge support tags
- derive installed totals server-side

### Frontend Tasks

- redesign `Progres` landing page
- add submodules:
- add progress
- add defect
- add VO / Micro-VO
- add rework
- add recent entry history
- add `Back` and `Cancel` navigation flow
- remove before/after distinction from progress UI
- remove GPS requirement from progress UI

### Suggested Current Repo Areas

- [ProgresScreen.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/screens/ProgresScreen.tsx)
- [CacatScreen.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/screens/CacatScreen.tsx)
- [gate4.ts](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/gates/gate4.ts)

### Deliverables

- consolidated progress hub
- integrated defect workflow
- integrated VO / rework workflow

### Exit Criteria

- standalone defect tab is no longer required
- one BoQ can accumulate many progress entries over time
- progress data supports downstream reporting

## Phase 7: Defect Lifecycle Completion

### Objectives

- move from simple defect logging to a full lifecycle

### Backend Tasks

- expand defect schema to include:
- responsible party
- target resolution date
- verifier
- handover blocker
- richer state machine
- add lifecycle transition rules

### Frontend Tasks

- estimator validation interface
- responsible-party assignment UI
- repair verification flow
- blocking issue summary

### Deliverables

- full defect lifecycle
- handover blocker support

### Exit Criteria

- defects can move through full lifecycle states
- handover-blocking defects are identifiable

## Phase 8: Gate 5 Reporting and Export Center

### Objectives

- centralize reports and reconciliation
- remove reporting duplication from Gate 4 where unnecessary

### Backend Tasks

- build weekly reconciliation job
- build material balance logic
- build Tier 2 burn-rate logic
- build schedule variance logic
- build VO and rework summaries
- build report export generator
- build weekly digest generator

### Frontend Tasks

- replace `Lainnya` with `Laporan` or `Kontrol`
- create report list
- create export center
- create project health screen

### Deliverables

- Gate 5 report center
- weekly digest
- export generation

### Exit Criteria

- reports are extractable from one central place
- Gate 4 no longer duplicates Gate 5 exports unless explicitly needed

## Phase 9: Schedule Layer Completion

### Objectives

- connect progress to milestone status
- support milestone revision logs

### Backend Tasks

- build milestone completion derivation
- build status engine:
- `ON_TRACK`
- `AT_RISK`
- `DELAYED`
- `AHEAD`
- build milestone revision log

### Frontend Tasks

- estimator milestone management screen
- project health summary widgets
- principal milestone health cards

### Deliverables

- schedule-aware status layer
- milestone revision log

### Exit Criteria

- milestone status updates from real progress data
- milestone revisions are auditable

## Phase 10: Hidden Scoring and Performance Layer

### Objectives

- evaluate supervisor and estimator performance from real system behavior

### Backend Tasks

- define scoring formulas
- build scoring job
- create metrics by role
- create VO cause analytics
- create rework influence analytics

### Deliverables

- scoring engine
- performance snapshots

### Exit Criteria

- scores are generated automatically
- scores can be reviewed by authorized office roles

## Phase 11: AI Assistance Layer

### Objectives

- add AI only after structured data is stable

### Backend Tasks

- add AI-assisted import suggestions
- add anomaly clustering
- add benchmark suggestion layer
- add confidence scoring and review queue integration

### Deliverables

- AI suggestion services
- confidence-based review flow

### Exit Criteria

- AI outputs are explainable
- no AI suggestion can silently override deterministic controls

## Phase 12: Hardening, Audit, and Non-Functional Improvements

### Objectives

- improve reliability
- improve auditability
- improve performance

### Tasks

- add full audit event logging
- add report generation history
- add override logs
- optimize image compression pipeline
- add thumbnails
- optimize list loading
- add background job monitoring

### Deliverables

- hardened audit layer
- improved media pipeline
- operations readiness

### Exit Criteria

- major actions are fully auditable
- images are optimized but legible
- report generation and background jobs are monitorable

## 6. Suggested Team Split

## Team A: Backend and Data

Own:
- schema design
- imports
- gate engines
- derived summaries
- scheduled jobs
- audit layer

## Team B: Supervisor Mobile

Own:
- project switcher
- request UI
- receipt UI
- progress hub
- report navigation entry points

## Team C: Office Web

Own:
- estimator workspace
- admin pricing desk
- principal review dashboard
- export center UI

## Team D: Intelligence and Scoring

Own:
- anomaly logic
- scoring jobs
- AI-assisted suggestions

## 7. Critical Dependencies

These dependency rules must be respected:

- Gate 1 should not be finalized before baseline import exists.
- Gate 2 should not be finalized before pricing baseline and role model exist.
- Gate 3 should not be finalized before PO and receipt state model is redesigned.
- Gate 4 should not derive truth client-side.
- Gate 5 should not depend on manually maintained summaries.
- AI should not be prioritized before baseline data quality is stable.

## 8. Current Repo Refactor Notes

If continuing from the current codebase:

- current client-side gate logic in:
- [gate1.ts](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/gates/gate1.ts)
- [gate3.ts](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/gates/gate3.ts)
- [gate4.ts](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/gates/gate4.ts)

should be progressively moved into backend functions or a shared server-side rules engine.

- current project context loading in:
- [useProject.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/hooks/useProject.tsx)

must be redesigned for multi-project support.

- current standalone defect flow in:
- [CacatScreen.tsx](/Users/carissatjondro/Dropbox/AI/Claude Code/workflows/screens/CacatScreen.tsx)

should be folded into the new progress hub.

## 9. Recommended Milestone Definitions for Engineering

### Milestone A

Access and project switching complete

### Milestone B

Project baseline import and publish complete

### Milestone C

Gate 1 and Gate 2 production-ready

### Milestone D

Gate 3 and Gate 4 production-ready

### Milestone E

Gate 5 reporting and exports production-ready

### Milestone F

Scoring and AI assistance layer enabled

## 10. Validation Checklist for Each Phase

For every phase, validate:
- backend access rules
- role visibility
- audit logging
- derived data correctness
- no duplicate source-of-truth logic in frontend
- mobile usability
- report consistency

## 11. Final Delivery Rule

Do not treat this as a simple UI enhancement project.

This is a workflow and control-system rebuild.

The team should prioritize:
- data structure,
- role logic,
- backend control,
- report integrity,
- only then UI refinement.
