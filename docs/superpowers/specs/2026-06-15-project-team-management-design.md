# In-App Project Team Management — Design

*2026-06-15*

## Problem

Project membership (`project_assignments`) gates row-level access to a project's
data: a user only sees a project's `boq_items`, `ahs_lines`, progress, etc. if
they're assigned to it. Today assignments can only be created at project
creation (creator auto-assigned) — there is **no in-app way** for an estimator,
admin, or principal to add a field supervisor (pengawas lapangan) to a project
after the fact. The symptom: a supervisor opens a project and sees an empty
dashboard (0%, 0 items) because RLS hides everything from a non-member, even
though the baseline is published.

The backend already exists in `tools/projectManagement.ts`
(`getProjectTeam`, `listAllProfiles`, `addUserToProject`, `removeUserFromProject`,
with friendly duplicate handling). The "Tim Proyek" card in `LaporanScreen` already
*lists* members. Two gaps remain: (1) the card has no add/remove controls, and
(2) RLS only lets `admin`/`principal` manage assignments — `estimator` is excluded.

## Goal

Let estimator / admin / principal add and remove project members from inside the
app, so they can assign a supervisor to a project without a manual DB edit.

## Decisions (from brainstorming)

- **Estimator scope:** widen the existing `is_project_assignment_manager()` to
  include `estimator`. This function is *also* reused by the project UPDATE and
  DELETE policies, so estimators additionally gain project edit/delete rights.
  This is accepted (chosen over a narrower, team-only function).
- **Placement:** extend the existing read-only "Tim Proyek" card in
  `LaporanScreen` (Reports tab) — no new screen/nav.
- **Add scope:** managers may add/remove **any** user; the picker shows each
  user's role label.

## Components

### 1. RLS migration — `supabase/migrations/037_estimator_team_management.sql`

`CREATE OR REPLACE FUNCTION is_project_assignment_manager(p_project_id UUID)`
identical to migration 023's body except the role check becomes
`pr.role IN ('admin', 'principal', 'estimator')`.

- No policy statements change — `assignments_insert_managers`,
  `assignments_delete_managers`, `assignments_project_managers`,
  `projects_update_assigned`, and the project DELETE policy all call this
  function and widen automatically.
- The function still requires the caller to *already be assigned* to the project
  (`pa.user_id = auth.uid() AND pa.project_id = p_project_id`). Estimators
  auto-assign on project creation, so a project's creating estimator can manage
  its team. (A consequence: an estimator who is **not** assigned to a project
  cannot manage it — acceptable; matches the "must be on the project" model.)
- Migration comment explicitly documents the project edit/delete side effect.

### 2. UI — `workflows/screens/LaporanScreen.tsx`, "Tim Proyek" card

Imports added from `projectManagement`: `addUserToProject`,
`removeUserFromProject`, `listAllProfiles`, `type ProfileOption`.

Manager-only (`isEstimatorOrAdmin`, already computed in the screen):

- **"+ Tambah anggota"** button at the bottom of the card. Tapping it toggles an
  **inline** picker rendered *directly under the card* (not a modal — matches the
  project's inline-edit anchoring convention).
- Picker contents: `listAllProfiles()` (loaded lazily on first open), filtered to
  exclude already-assigned `user_id`s, each row showing `full_name` +
  `ROLE_LABELS[role]`. Tapping a row calls `addUserToProject(project.id, userId)`,
  then refreshes the team, collapses the picker, and toasts success or the
  returned error (e.g. the duplicate message).
- Each member row gets a **✕ remove** control. Tapping it confirms, then calls
  `removeUserFromProject(assignment_id)`, refreshes, and toasts.

Non-managers: the card renders exactly as today (read-only list).

### 3. Pure helper — `availableProfiles(all, team)`

Extract the "all profiles minus those already on the team" computation as a pure,
exported function (in `tools/projectManagement.ts`) so it is unit-testable:

```
availableProfiles(all: ProfileOption[], team: TeamMember[]): ProfileOption[]
```

Returns `all` with any profile whose `id` appears in `team` (by `user_id`)
removed. Used to populate the picker.

## Data flow

1. Card mounts → `getProjectTeam(project.id)` → `projectTeam` state (existing).
2. Picker opens → `listAllProfiles()` → `allProfiles` state; picker shows
   `availableProfiles(allProfiles, projectTeam)`.
3. Add/remove → await the backend call → on success re-run `getProjectTeam` →
   state updates → picker list recomputes.

## Cross-platform

The app runs on Expo **web**, where `Alert.alert` does not fire button
callbacks. The remove confirmation uses the established pattern: `window.confirm`
on web, `Alert.alert` on native. (Add does not need confirmation.)

## Error handling

- Duplicate add → `addUserToProject` already returns
  `"Pengguna sudah terdaftar di proyek ini"`; surface via toast.
- `listAllProfiles` / `getProjectTeam` errors → empty list, card still renders;
  toast on add/remove failures.
- RLS rejection (non-manager somehow calling) → supabase error surfaced in toast.

## Testing

- **Unit:** `availableProfiles` — excludes assigned users, returns all when team
  empty, handles empty inputs. (Pure function, in `tools/__tests__/`.)
- The supabase wrappers and RN UI are verified manually (no new harness).

## Out of scope

- Per-project role overrides (a user's role comes from their `profiles.role`).
- Inviting brand-new users (separate existing `inviteUser` edge-function flow).
- Restricting *which* roles a manager may add (decided: any user).
