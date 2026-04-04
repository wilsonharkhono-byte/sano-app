# SAN Agent Prompt

## Purpose

This file is a copy-ready prompt for an implementation agent such as Claude Code or ChatGPT Codex.

It is designed to:
- load the SAN planning documents,
- inspect the current repo,
- follow the intended software architecture,
- implement the system incrementally without drifting from requirements.

Use this prompt as the starting instruction for the coding agent.

---

## Copy-Ready Prompt

```md
You are implementing SAN, a role-based construction control platform.

Work in the current repository and use the following documents as the primary source of truth:

1. SAN_DEVELOPER_BRIEF.md
2. SAN_PRODUCT_REQUIREMENTS.md
3. SAN_TASK_BREAKDOWN.md

These files are located in the current workspace and must be read before implementation.

Your job is to inspect the current codebase, compare it against those documents, and implement the system incrementally with strong backend logic and role-based UI.

## High-Level Product Direction

SAN is not just a field form app.

It must evolve into a multi-project, multi-role construction control system with:
- project-specific BoQ and AHS baseline logic
- backend-driven gates
- role-based access control
- supervisor mobile input
- estimator/admin/principal review surfaces
- Gate 5 reporting and reconciliation
- hidden scoring and AI-assisted support later

## Primary Documents to Follow

Treat the following as the requirements baseline:
- `SAN_DEVELOPER_BRIEF.md`
- `SAN_PRODUCT_REQUIREMENTS.md`
- `SAN_TASK_BREAKDOWN.md`

If the current code conflicts with these documents, prefer the documents unless the repo contains a better implementation that still satisfies the requirements.

## Current Intent

You should not attempt a full rewrite in one pass.

Implement in phases.

Follow the task sequence in `SAN_TASK_BREAKDOWN.md`.

Start with the earliest unfinished foundational phase unless explicitly instructed otherwise.

## Mandatory Product Rules

Follow these rules exactly:

1. Support multiple assigned projects per user.
2. Add a project switcher in the main header.
3. Enforce project visibility by assignment and role.
4. Keep supervisor mobile UI simple.
5. Move business-critical validation logic to backend/server functions where practical.
6. Build around project-specific BoQ, AHS, material mapping, and frozen baseline versions.
7. Allow one BoQ item to request multiple materials in one bundled request.
8. Support partial receipts across multiple delivery sessions for a single PO.
9. Make `Progres` the main field operations hub.
10. Fold defects into `Progres`; do not keep a separate top-level `Cacat` tab.
11. Put Gate 5 reconciliation, reports, and exports under `Laporan` or equivalent reporting area.
12. Do not implement attendance / `absensi kerja`.
13. Do not keep supervisor profile inside `Lainnya`.
14. Do not require before/after or GPS for Gate 4 progress photos.
15. Keep reporting extraction centralized in Gate 5 if Gate 4 extraction would be redundant.

## Architecture Rules

Prefer:
- append-only event data
- derived totals computed server-side
- explicit approval tasks
- auditable state transitions
- modular backend business rules

Avoid:
- frontend-only truth calculations
- destructive history edits
- embedding the only copy of business rules in React screens
- silently using AI to approve sensitive decisions

## Role Model

Implement role-aware behavior for:
- supervisor
- estimator
- admin
- principal

Behavior expectations:
- supervisor: mobile-first, simple forms, assigned projects only
- estimator: desktop-first, deeper review and baseline management
- admin: desktop-first, procurement and pricing operations
- principal: mobile-first, exception-driven review and approvals

## Repo Behavior Expectations

When you start:

1. Inspect the current codebase structure.
2. Read the three SAN planning documents.
3. Compare current implementation against the first unfinished phase in `SAN_TASK_BREAKDOWN.md`.
4. Make code changes incrementally.
5. Verify each step.
6. Summarize what changed, what remains, and any assumptions.

## Required Working Style

Use this implementation approach:

1. Start by reviewing the current schema, data flow, and screen structure.
2. Identify the smallest meaningful implementation slice for the current phase.
3. Implement end-to-end for that slice:
- schema or model changes
- backend logic
- frontend wiring
- verification
4. Avoid partially implemented UI without supporting data structure unless the task explicitly requires scaffolding.

## Required Output Behavior

For each implementation session:

- explain what phase you are working on
- explain what repo areas you are changing
- explain any assumptions you make
- keep changes aligned to the SAN documents
- note any follow-up tasks created by your implementation

## Suggested Initial Execution Order

If no narrower task is given, start here:

### Phase 1
- multi-project assignment support
- active project switcher in header
- project-aware app context
- role-safe project filtering

Then continue to:

### Phase 2
- baseline import / BoQ-AHS backbone design

Do not jump to advanced AI, scoring, or dashboard work before the baseline model is stable.

## UI Guidance

Supervisor mobile navigation target:
- Beranda
- Permintaan
- Terima
- Progres
- Laporan

Planned structural changes:
- remove standalone `Cacat` tab
- move defect and VO workflows into `Progres`
- convert `Lainnya` into a reporting/control area

## Gate Requirements Summary

### Gate 1
- one bundled request per BoQ with multiple material lines
- suggested materials from project baseline
- custom material option for uncommon Tier 2 / Tier 3 cases
- hidden detailed validation for office roles

### Gate 2
- admin / estimator / principal workflow
- price validation, history, vendor consistency
- severity ladder includes `HIGH`

### Gate 3
- partial receipt support
- multi-session receiving
- stronger anomaly and audit logic

### Gate 4
- main field operations hub
- progress
- defects
- VO / Micro-VO
- rework
- payroll support tags
- client charge support tags
- no required before/after split
- no required GPS

### Gate 5
- reconciliation
- material status
- VO report
- rework report
- export center
- weekly digest

## Data Modeling Guidance

You should expect to implement or prepare for these entity groups:
- access and project assignment
- project baselines
- BoQ items
- AHS lines
- material catalog and specs
- material master
- request headers and lines
- POs and receipt sessions
- progress entries
- defects
- VO and rework entries
- reports and exports
- anomaly and scoring tables

## AI Guidance

AI should be used only for:
- import mapping suggestions
- alias normalization
- benchmark suggestions
- anomaly clustering

AI must not:
- auto-approve sensitive financial decisions
- silently rewrite project truth

## Safety Rules

- preserve existing useful behavior unless it conflicts with the SAN requirements
- do not revert unrelated user changes
- do not delete working code unless replacing it with a better aligned implementation
- maintain a clear migration path where current screens or schema are being replaced

## Definition of Good Progress

A good implementation step should:
- improve the real data model
- improve access control
- move logic from frontend to backend
- reduce architectural mismatch with the SAN planning documents
- keep the app usable while evolving the system

## Deliverable Expectation

At the end of your work session, provide:
- what phase or slice was implemented
- which files changed
- what backend logic was added or moved
- what UI behavior changed
- what remains for the next phase
```

---

## Suggested Use Variants

### Variant A: Open-Ended Implementation

Use the copy-ready prompt above as-is when you want the coding agent to inspect the repo and begin implementing from the earliest unfinished phase.

### Variant B: Focused Phase Prompt

Add this after the main prompt when you want the agent to work on one phase only:

```md
Focus only on Phase X from SAN_TASK_BREAKDOWN.md.
Do not move to later phases.
Complete the selected phase end-to-end as far as practical in this repository.
```

### Variant C: Review-Only Prompt

Add this after the main prompt when you want the agent to review before changing code:

```md
Do not write code yet.
Inspect the current repository against the SAN documents and produce:
- current status by phase
- blockers
- implementation risks
- recommended first code changes
```

## Suggested First Invocation

If you want a practical starting command for the next agent session, use this:

```md
Read SAN_DEVELOPER_BRIEF.md, SAN_PRODUCT_REQUIREMENTS.md, and SAN_TASK_BREAKDOWN.md.
Inspect the current repo.
Implement Phase 1 from SAN_TASK_BREAKDOWN.md:
- multi-project assignment support
- active project switcher in the header
- project-aware app context
- role-safe project filtering

Do the work end-to-end in code.
After implementation, summarize changed files, any schema implications, and what remains for Phase 2.
```

## Current Revision Prompt For Claude Code

Use this when you want the next Claude Code pass to focus on the current repo gaps rather than restart from a generic phase summary:

```md
You are revising the current SAN/SANO repository.

Before changing code, read:
1. `SAN_DEVELOPER_BRIEF.md`
2. `SAN_PRODUCT_REQUIREMENTS.md`
3. `SAN_TASK_BREAKDOWN.md`
4. `SAN_AGENT_PROMPT.md`

Work in the existing repository. Do not rewrite from scratch.

## Product Naming / Branding

The product brand is now `SANO`.
Interpret the acronym as:
`Structured Approval Network & Operations`

Preserve the existing repository structure, but use the `SANO` brand in user-facing shell surfaces where appropriate.

## Current Situation

The repo already contains partial implementations of:
- multi-project context
- baseline import scaffolding
- bundled Gate 1 request header/line model
- Gate 2 role-specific screen scaffolding
- Gate 3 receipt flow scaffolding
- unified `Progres`
- Gate 5 report/export scaffolding

However, there are important architectural and workflow gaps that must now be fixed.

## Revision Priorities

Implement in this order unless a safer dependency order is discovered during inspection:

### Priority 1: Material Master As The Source Of Truth

Replace fragile string-based material suggestions with a proper linked baseline flow:
- BoQ -> AHS lines -> project material master -> request lines
- ensure request lines carry a real `material_id` when the material is from the baseline
- keep `custom_material_name` only for true custom rows
- support multiple material variants per BoQ item, including multiple steel/spec rows for structural work like `sloof`
- preserve unit correctness per material

Business corrections to respect:
- `Bata MRH` must not be treated as `m3`; it should use the correct material unit
- structural items like `sloof` must support linked steel materials and multiple steel variants/specs

### Priority 2: Baseline Import Quality

Strengthen the import/baseline publish logic so it can become the backbone for Gate 1 and MTN:
- Excel import must remain the target source format
- ambiguous mappings must be reviewable
- AHS publish must correctly link to material records
- generated project material master rows must be reliable enough for downstream dropdowns and validation

### Priority 3: MTN Workflow Rebuild

Refactor MTN under `Laporan` so it is controlled by live material balance:
- material must be a dropdown derived from current project material balance / received-minus-used logic
- unit must auto-fill from the selected material
- destination project must be a dropdown from assigned/known projects
- if requested MTN quantity exceeds available balance, warn but still allow submission
- record this as an estimator-visible flag/anomaly
- once approved, the destination project must see it under `Terima` as inbound `MTN`, distinct from `PO`

### Priority 4: Supervisor vs Office Role Separation

Tighten role behavior instead of showing the same fields to everyone:
- supervisors should capture field facts simply
- estimator/admin should handle deeper pricing, review, and reporting controls
- for VO in `Progres`, add structured material selection and labor input
- hide supervisor-facing cost-estimation fields like estimated cost where those should belong to office-side review
- review the meaning and placement of payroll/client-charge tags; if retained in supervisor flow, make them clear and low-friction, otherwise move final classification to office roles

### Priority 5: Navigation / UX Corrections

Fix the currently confusing navigation behaviors:
- milestone alert on `Beranda` should deep-link straight to `Laporan` -> `Jadwal`
- project switching must be obvious and reliable in the header
- Gate 5 exports should be previewable in a more usable way than a truncated alert when practical

## Non-Negotiable Rules

- Do not reintroduce attendance / `absensi kerja`
- Do not keep business-critical truth only in frontend strings or React screen state
- Do not weaken role separation
- Do not break append-only event history
- Do not silently use AI to approve sensitive decisions
- Prefer backend/server-derived logic over client-only calculations where practical

## Review And Repair Requirements

While implementing, also fix obvious correctness issues you encounter if they are low-risk and directly related, including:
- typecheck failures
- broken approval routing
- schema/publish issues that prevent material master correctness
- navigation mismatches that confuse the intended flow

## Deliverable Expectations

In the final response:
- state which priority slice(s) you completed
- list changed files
- explain any schema or data migration implications
- call out any assumptions that still need product confirmation
- state clearly what remains for the next Claude Code pass
```

## Final Note

This prompt is intentionally structured to keep the coding agent aligned with the SAN planning documents and to reduce the chance of premature UI work, shallow scaffolding, or architecture drift.
