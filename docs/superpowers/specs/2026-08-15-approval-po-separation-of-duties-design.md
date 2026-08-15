# Approval / PO Separation of Duties — Design Spec

*Date: 2026-08-15 · Status: approved, ready for implementation planning*

## 1. Context and goal

Julius (estimator) and Ikha (admin/purchasing) reported that their approval
screens are "tumpang tindih" — identical. They are: `workflows/App.tsx:71-74`
routes supervisors to the field app and principals to their own navigator, then
falls through, so **estimator and admin receive the same `OfficeNavigation`** —
same tabs, same Approvals screen, same buttons. The database agrees: migration
002's `request_headers_office_update` lets `admin`, `estimator` and `principal`
all write the approval verdict, and migration 036's `purchase_orders_office_all`
lets any office role — including the estimator — write purchase orders.

This is not a new requirement. The July spec
`2026-07-10-two-signal-overallocation-design.md` §6 already assigns the columns:

| Moment | Supervisor | Estimator | Admin | Principal |
|---|---|---|---|---|
| Approval | — | overage panel | — | — |
| PO creation | — | — | hard quantity gate | Gate-2 override |

The intent — estimator approves, admin orders — was documented and never
enforced. Migration 069 then removed the request-time hard block on the
explicit grounds that "approval (estimator) and PO creation (admin, Gate-2) are
the control points", and deferred the replacement PO-time gate to "Task 2.5,
migration TBD". Task 2.5 was never built.

**Goal:** enforce the two layers that were already designed, and build the
PO-time hard gate that migration 069 assumed would exist.

## 2. Locked decisions

1. **Two layers, plus escalation.** Estimator approves/rejects material
   requests. Admin creates purchase orders. Neither does the other's job. The
   principal retains both powers as the escape hatch above them.
2. **The request→PO link stays OPTIONAL.** The July spec's §2.6 and §7
   ("optional request→PO link, manual, non-blocking"; "no automated request→PO
   conversion") **remain in force and are NOT superseded.** Mandatory linking
   was considered and explicitly rejected during this design.
3. **The money control is the PO-time quantity gate, not the link.** Because
   the link stays optional, control over spend lives in the hard gate of §5.3.
4. **Partial linking is supported where used.** When the admin does link a PO
   line to an approved request line, one request line may be linked by more
   than one PO line, and the picker shows the remaining unlinked quantity
   rather than hiding a line the moment it is touched once. This is a
   traceability improvement, never a requirement.
5. **Returned requests, never silent stalls.** An admin who cannot fulfil an
   approved request returns it to the estimator with a mandatory written
   reason.
6. **Full visibility, restricted action.** Both roles keep the whole navigator
   and full read access. Only action affordances differ.
7. **AUTO_HOLD is cleared by estimator or principal — never admin.**
8. **Enforcement is three-layered** (UI, RLS, trigger) per §5.

## 3. Role capability matrix

| Action | Supervisor | Estimator | Admin | Principal |
|---|---|---|---|---|
| Create material request | ✅ | — | — | — |
| Approve / reject request | — | ✅ | 👁 | ✅ |
| Clear AUTO_HOLD (approve/reject a held request) | — | ✅ | ❌ | ✅ |
| Manually hold a request ("Tahan") | — | ❌ | ❌ | ✅ *(unchanged)* |
| Return an approved request to the estimator | — | — | ✅ | ✅ |
| Create / edit purchase orders | — | 👁 | ✅ | ✅ |
| Receive goods | ✅ | — | — | — |
| Plafon / Gate-2 verdict | — | — | — | ✅ *(unchanged, migration 060)* |

👁 = read-only. Existing behaviour marked *(unchanged)* is listed for
completeness and must not be modified by this work.

## 4. Request state machine

`RETURNED` is the single new value added to `MRStatus`
(`tools/constants.ts`) and to the `overall_status` CHECK constraint
(migration 002:214, currently `PENDING, UNDER_REVIEW, APPROVED, REJECTED,
AUTO_HOLD`).

```
PENDING ─────approve (estimator)─────> APPROVED ──> [admin creates PO]
   │                                      │
   │                                      └──return + reason (admin)──> RETURNED
   ├─────reject (estimator)─────> REJECTED                                  │
   │                                                                        │
   └<──────re-open (estimator, optional)────────────────────────────────────┤
                                                                            │
        APPROVED | REJECTED <───re-decide (estimator, direct)───────────────┘

AUTO_HOLD ───approve / reject (estimator or principal)───> APPROVED | REJECTED
```

### 4.1 Fulfilment is derived, never stored

No `PARTIALLY_ORDERED` / `FULLY_ORDERED` status is added. `overall_status`
remains purely the approval verdict. How much of a linked request line has been
ordered is computed:

```
remaining = approved_qty − Σ(linked non-cancelled PO line qty)
```

A stored fulfilment status would drift the moment a PO is cancelled or edited,
producing a screen that confidently shows a number that is not true — the exact
failure class CLAUDE.md §1.1 forbids. Deriving it makes the figure arithmetic
over real rows.

Consistent with §2.4, this arithmetic governs only the optional link picker. It
is *not* a gate: an unlinked PO is legal.

## 5. Enforcement

| Layer | Enforces | Rationale |
|---|---|---|
| UI | Action affordances per role | Immediate clarity; fixes the reported symptom |
| RLS | Estimator cannot write POs | Survives direct REST access |
| Trigger | Legal status transitions; PO qty vs plan | Cannot be bypassed by any write path |

### 5.1 RLS — the PO side

Migration 036's `purchase_orders_office_all` (predicate `is_office_role()` =
admin/principal/estimator) is replaced with policies admitting `admin` and
`principal` only, and migration 002's office insert/update policies for
`purchase_orders` are narrowed to match.

Migration 060 established this pattern for `approval_tasks` and documented the
trap that must be avoided here: if the blanket office policy is left in place,
the excluded role "would keep FOR ALL and could still write the verdict,
defeating the principal-only intent." The blanket policy must be dropped, not
merely supplemented.

**Implementation must verify** the policy set on `purchase_order_lines`
(and any other PO child tables) and apply the same narrowing. This spec does
not assume their current shape.

Supervisors keep SELECT and keep receiving via the `submit_receipt`
`SECURITY DEFINER` RPC (migration 060) — untouched.

### 5.2 Trigger — the approval side

RLS cannot restrict by column or by value, and the admin legitimately needs
UPDATE on `material_request_headers` in order to return a request. Enforcement
is therefore a transition-guard trigger, following the pattern migration 059
used for supervisor writes on `boq_items`
(`SECURITY DEFINER` plpgsql, `SET search_path = public`).

Legal transitions by actor role:

| From → To | Estimator | Admin | Principal |
|---|---|---|---|
| PENDING / UNDER_REVIEW → APPROVED / REJECTED | ✅ | ❌ | ✅ |
| AUTO_HOLD → APPROVED / REJECTED | ✅ | ❌ | ✅ |
| APPROVED → RETURNED | ❌ | ✅ | ✅ |
| RETURNED → APPROVED / REJECTED / PENDING | ✅ | ❌ | ✅ |
| * → AUTO_HOLD (manual "Tahan") | ❌ | ❌ | ✅ |

A returned request may be re-approved directly once the estimator has amended
or accepted it; sending it back to `PENDING` is available but not required, so
the round trip never costs an extra click.

Everything else raises an exception with a message naming the actor's role and
the attempted transition. `auth.uid() IS NULL` (service-role key / Dashboard SQL
editor) is let through the actor check, consistent with the house style of
migrations 057/059/060.

`APPROVED → RETURNED` additionally requires a non-empty return reason.

**Interaction with migration 033's AUTO_HOLD promotion trigger:** 033 promotes
`PENDING`/`AUTO_HOLD` headers to `AUTO_HOLD` on a HIGH/CRITICAL line flag, and
treats reviewer statuses as sticky. `RETURNED` must be added to the sticky set,
so a returned request cannot be silently re-promoted out from under the
estimator.

### 5.3 The hard PO quantity gate (Task 2.5)

The client half already exists — `tools/poQuantityGate.ts`, plus the
`approval_tasks` Gate-2 escalation and the "approved override task" retry
picker in `Gate2Screen`. Migration 069 deferred the server half; this spec
builds it as a trigger on `purchase_order_lines` (INSERT/UPDATE):

```
existing_non_cancelled_PO_qty + this_line_qty > current_planned
   → reject, unless an APPROVED po_qty_gate override task exists
     for this project + material
```

Per the July spec §3: cancelled POs do not count, and `CLOSED_SHORT` POs count
`LEAST(po_line_qty, received)`.

This creates a dual-layer gate (TS + DB). Per project memory, **the TS and DB
halves must change in lockstep** — the same constraint that governs migrations
033/048/049. The spec for any future change to either half must say so.

### 5.4 Notifying the estimator that a request was returned

A returned request that notifies nobody is a silent stall by another name, and
locked decision §2.5 exists precisely to abolish that. The existing path does
**not** carry it: migration 085's `notify_header_status_change` early-returns
unless the new status is `AUTO_HOLD`, `APPROVED` or `REJECTED`, and the
`notifications.type` CHECK (migration 067) has no `RETURNED` value. Adding a
branch without widening the CHECK would fail *silently*, because the enqueue is
wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING`.

Migration 088 therefore must also:

1. Widen the `notifications.type` CHECK to admit `RETURNED`.
2. `CREATE OR REPLACE` `notify_header_status_change` to emit on `RETURNED`,
   targeting the estimator role (the actor who must act next), carrying the
   return reason in the detail payload so the notification is self-explanatory.
3. Add `RETURNED` to the notification routing map (`tools/notificationRouting.ts`)
   so the notification deeplinks to the Approvals screen like its siblings.

Both SQL changes are `CREATE OR REPLACE` / `DROP CONSTRAINT IF EXISTS` and ship
inside 088, so there is one paste, not two.

### 5.5 Is a returned request still open demand?

Yes — it is live work parked with the estimator, exactly like `PENDING`. Two
surfaces currently disagree and must be aligned to that answer: migration 072's
`v_material_envelope_status.total_requested` already counts it (it excludes only
`REJECTED`), while migration 069's `compute_tier2_flag` uses an explicit
whitelist that omits it. 069's whitelist gains `RETURNED`. Both are advisory
signals, so this changes no gate — but a request must not read as demand on one
screen and not another.

Every "outstanding work" counter must likewise treat `RETURNED` as open:
`office/screens/OfficeHomeScreen.tsx`, `tools/reports.ts`, and
`supabase/functions/ai-assist/index.ts` all filter on
`('PENDING','UNDER_REVIEW','AUTO_HOLD')` today.

## 6. UI changes

Both roles keep `OfficeNavigation` unchanged — no navigator split, per §2.6.

**`office/screens/ApprovalsScreen.tsx`**
- Approve/reject actions render for estimator and principal only.
- Admin sees, on `APPROVED` requests, a **"Kembalikan ke estimator"** action
  opening a mandatory-reason input.
- Where an action is withheld, render a short explanatory line
  (e.g. *"Persetujuan dilakukan estimator"*) rather than an empty space, so a
  missing button never reads as a bug.
- `RETURNED` requests appear in the estimator's queue with the admin's reason
  and who wrote it; a new filter chip covers the state.

**`workflows/screens/Gate2Screen.tsx`**
- PO create/edit controls render for admin and principal only; estimator sees
  the screen read-only with the same style of explanatory line.
- The request-line link picker offers lines with remaining > 0 (rather than
  excluding any line already linked once, `Gate2Screen.tsx:510`) and displays
  the remaining quantity.

**Role-derived, not screen-derived:** the capability checks belong in one pure
helper in `tools/` (e.g. `tools/rolePermissions.ts`) consumed by both screens,
so the matrix in §3 has exactly one implementation. Screens stay thin.

## 7. Rollout and back-compat

- **Existing rows are grandfathered.** Both triggers judge new writes only. No
  historical PO or request is invalidated, and no backfill is required.
- **In-flight requests** keep their current status. An `APPROVED` request is
  orderable exactly as before.
- **Existing unlinked POs** remain valid — the link is optional (§2.2).
- **Migration 088**, idempotent and Dashboard-pasteable: `DROP POLICY IF
  EXISTS` before `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER
  IF EXISTS` before `CREATE TRIGGER`. The remote migration history is diverged;
  migrations are pasted into the Dashboard SQL editor, so re-paste safety is
  mandatory.
- **Deploy order:** apply migration 088 before shipping the app build. The
  narrowed policies are compatible with the current build (which simply shows
  buttons that will now fail server-side), so there is no window in which the
  app breaks.

## 8. Testing

- **Pure unit tests** for `tools/rolePermissions.ts` — the full §3 matrix,
  all four roles.
- **Transition-guard tests** covering every cell of §5.2, including the
  rejected transitions, and the `RETURNED` stickiness against 033's promotion.
- **PO gate tests** for the §5.3 arithmetic: within plan, over plan, over plan
  with an approved override, cancelled PO excluded, `CLOSED_SHORT` partial
  counting.
- **RLS tests must run under the authenticated role for each of the four
  roles — not the service role.** Service-role tests are what hid the
  `material_aliases` RLS gap; a service-role key bypasses RLS entirely and
  would pass against a completely open policy set.
- **Regression:** an estimator approving and an admin creating a PO must still
  work end-to-end; supervisor receiving via `submit_receipt` must be unaffected.

## 9. Out of scope / known limits

- **The external accounting PO remains invisible to SANO** (July spec §7). This
  design makes SANO's own record coherent; it cannot police ordering that
  happens outside SANO. Office copy should continue to say "berdasarkan PO
  SANO".
- **AUTO_HOLD remains largely unreachable.** Migration 069 capped the
  quantity/budget flags at WARNING by design; only the legacy Tier-1
  DIRECT-allocation path still promotes. This spec fixes *who may clear* a
  hold; it deliberately does not revive the hold itself. Once §5.3 is live,
  whether request-time holds should return is a separate decision.
- **No automated request→PO conversion** (July spec §7, unchanged).
- **No navigator split** — deliberately rejected in favour of full visibility.
*(The original draft of this spec claimed the `RETURNED` state could reuse the
existing notification path with no new type. That was wrong — see §5.4, which
supersedes it.)*

## 10. Acceptance criteria

1. An estimator cannot create or edit a purchase order — the UI offers no
   control, and a direct REST write is refused by RLS.
2. An admin cannot approve, reject, or clear a hold on a material request —
   the UI offers no control, and a direct REST write is refused by the
   transition guard.
3. An admin can return an `APPROVED` request with a reason; it reaches the
   estimator's queue showing that reason and its author; the estimator can
   re-approve, amend, or reject it.
4. A returned request is not re-promoted to `AUTO_HOLD` by migration 033's
   trigger.
5. A PO line that would push cumulative non-cancelled ordered quantity past the
   current plan is refused server-side unless an approved `po_qty_gate`
   override exists.
6. Both estimator and admin still see the full Approvals and Procurement
   screens; withheld actions carry a one-line explanation.
7. A PO with no linked request line is still valid to create.
8. Every existing PO and request predating the migration remains valid, and
   supervisor receiving is unaffected.
