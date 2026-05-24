# Server-Side Gate 1 Enforcement — Design Spec

**Date:** 2026-05-04
**Status:** Design approved, pending implementation plan
**Touches:** PostgreSQL triggers + functions on `material_request_lines` and `material_request_line_allocations`. Side-effect updates on `material_request_headers`.

## Problem

Gate 1 logic (the "is this material request OK / WARNING / CRITICAL?" check) lives entirely in the React Native app at `workflows/gates/gate1.ts`. The Supabase server stores whatever flag the client sends without re-validating. This creates three real bypass paths:

1. **Direct API insert** — A supervisor with a valid JWT can `POST /rest/v1/material_request_headers` via curl/Postman with `overall_flag: 'OK'` even when server-side recomputation would yield `CRITICAL`. RLS policies (migration 005) only check project assignment, not flag rules. Server accepts the bad value as-is.

2. **Old app version** — A supervisor running an older build of the app uses out-of-date Gate 1 logic. The flag they send is "OK by old rules." Server stores that without checking against current rules.

3. **Logic divergence** — Two phones running different builds compute different flags for identical inputs. Whichever submits first wins; the other one's contradictory flag is just stored.

Plus a fourth path that's NOT a bypass but is functionally equivalent: `tools/envelopes.ts` has a `checkMaterialRequest` function intended for server-side enforcement, but it has **zero callers anywhere in the codebase**. It's dead code. The intent was there; the wiring isn't.

The result is that Gate 1 is **advisory at the app layer**, not enforced anywhere durable. For a construction control platform with budget envelopes that estimators rely on, this is a real integrity gap.

## Goals

- Make the server the source of truth for `material_request_lines.line_flag` and `material_request_headers.overall_flag`. The client's submitted value is overwritten on insert/update.
- When the server-recomputed flag is CRITICAL or HIGH, **automatically promote** `overall_status` to `AUTO_HOLD` (an existing enum value already used in the workflow) so the request can't be approved without explicit principal override.
- Preserve reviewer decisions: once a request has been APPROVED, REJECTED, or moved to UNDER_REVIEW manually, server flag recomputation must NOT clobber that status.
- Keep the existing client-side `gate1.ts` for instant UI feedback during data entry — only the *persisted* flag becomes server-truth.
- No app rebuild required. This is a database-only change deployable via Supabase migration.
- Match the existing codebase pattern: business logic enforcement via PL/pgSQL triggers (consistent with `derive_boq_installed`, `sync_milestone_statuses`, `get_material_envelope`).

## Non-goals

- Server-side enforcement of Gate 2 (purchase order price checks), Gate 3, or Gate 4. Each gate has different shape and stakeholders. Gate 1 first; others can use the same pattern later in separate specs.
- Server-side enforcement of MTN approvals. MTN flow is structurally simpler (status-only state machine, no flag computation) and not part of the bypass surface area Gate 1 has.
- Reimplementing Gate 1 in the app. Client-side `gate1.ts` is preserved verbatim for UI responsiveness — it just stops being authoritative on persisted data.
- New RLS policies. Existing project-assignment policies stay; triggers add to security, don't replace it.
- Changes to the materialized view `v_material_envelope_status` or any other view. Triggers consume existing views.

## Core principle

Server is the only place that can decide what flag is stored. Anything the client sends gets overwritten. Reviewer overrides are sticky.

---

## Section 1 — Architecture

The enforcement runs as **three** PostgreSQL triggers — two on `material_request_lines` and one on `material_request_line_allocations`. There's no trigger on `material_request_headers` directly — the header is updated as a side effect of the line/allocation triggers.

The third trigger exists because `material_request_lines` does NOT carry `boq_item_id` directly — that link lives in `material_request_line_allocations` (migration 005). The app submits in the order:
1. Insert `material_request_headers`
2. Insert `material_request_lines` (no allocations yet)
3. Insert `material_request_line_allocations` (1:1 for DIRECT, 1:N for envelope)

So at the moment a Tier 1 line is inserted, its allocations don't exist yet — the BEFORE INSERT trigger on lines can't compute Tier 1's flag from non-existent rows. That gets resolved when the allocation trigger fires immediately after.

```
Client INSERT material_request_headers (initial header, no lines yet)
   │
   ▼
[no trigger fires, header stored as-is — flag stays default]
   │
Client INSERT material_request_lines (one or more)
   │
   ▼
Trigger 1 (BEFORE INSERT/UPDATE on lines):
   compute line_flag from server-side data via dispatch_line_flag(NEW)
   ↓ Tier 2 / Tier 3: full computation possible (only needs line columns + project)
   ↓ Tier 1: no allocations exist yet at INSERT time → returns 'WARNING' placeholder
   ↓ overwrite NEW.line_flag with server value
   │
Trigger 2 (AFTER INSERT/UPDATE/DELETE on lines):
   re-aggregate header.overall_flag = worst flag across all lines
   ↓ if worst flag is CRITICAL/HIGH AND header.overall_status is still pending:
      promote overall_status = AUTO_HOLD
   │
Client INSERT material_request_line_allocations (after lines)
   │
   ▼
Trigger 3 (AFTER INSERT/UPDATE/DELETE on allocations):
   look up parent line; recompute its line_flag via dispatch_line_flag(line)
   ↓ now Tier 1 has allocations → resolves to real OK/INFO/WARNING/HIGH/CRITICAL
   ↓ Tier 2/3 unchanged (their flag doesn't depend on allocations)
   ↓ UPDATE material_request_lines SET line_flag = ... (this fires Trigger 2 → header re-aggregates)
```

### Why three triggers (not one)

- **Trigger 1 is BEFORE** because we mutate `NEW.line_flag` directly — that only works in BEFORE triggers.
- **Trigger 2 is AFTER** because we need the line row to be visible in queries (for the worst-flag aggregation) — that requires the row to be committed to the table from the trigger's perspective, which happens AFTER.
- **Trigger 3 is AFTER** on allocations because the allocation row needs to be queryable when we recompute the parent line's flag, and we want to drive a downstream UPDATE on the line.

### Why on lines AND allocations

- Per-line flag computation depends on tier:
  - Tier 1 needs `boq_item_id` + `allocated_quantity` — only available via allocations.
  - Tier 2 / Tier 3 need only `material_id` + `quantity` (line columns).
- Putting BEFORE triggers on lines covers Tier 2/3 immediately. Putting AFTER triggers on allocations covers Tier 1 once allocations are committed.
- Header flag automatically follows because Trigger 3's `UPDATE` on the line cascades into Trigger 2.

### Avoiding infinite loops

Trigger 3 issues `UPDATE material_request_lines SET line_flag = ...`. Trigger 1 is restricted to `BEFORE INSERT OR UPDATE OF tier, quantity, material_id` — it does NOT fire on changes to `line_flag`. So Trigger 3's update does not retrigger Trigger 1; only Trigger 2 (AFTER UPDATE) fires, which is what we want for header re-aggregation.

---

## Section 2 — Helper Functions

Four PL/pgSQL helper functions: three tier-specific computers and one dispatch wrapper. Each tier function takes the inputs needed for that tier's gate logic and returns a flag string. The dispatcher branches on `tier` and routes to the right tier function. All run as `SECURITY DEFINER` so they can read views/tables regardless of the caller's RLS.

### `compute_tier1_flag(p_boq_item_id UUID, p_requested_qty NUMERIC) RETURNS TEXT`

Logic mirrors `gate1.ts:128-138` (Tier 1 BoQ direct check):

```
1. Read boq_items.planned, boq_items.installed for p_boq_item_id
2. Read existing approved+pending allocations for this boq_item to compute already_ordered
3. remaining = planned - installed - already_ordered
4. If requested > remaining * 1.3 → CRITICAL
5. If requested > remaining * 1.15 → HIGH
6. If requested > remaining * 1.05 → WARNING
7. If requested > remaining * 0.5 → INFO
8. Else → OK
```

Returns one of: `'OK' | 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL'`. Returns `'WARNING'` if `p_boq_item_id` is null (Tier 1 needs BoQ context).

**Source of `p_boq_item_id` and `p_requested_qty`:** these come from the line's first DIRECT allocation row (`material_request_line_allocations` where `request_line_id = line.id AND allocation_basis = 'DIRECT'`, ordered by `id`). This matches the client-side `firstAllocation` heuristic in `office/screens/ApprovalsScreen.tsx`. Multiple DIRECT allocations on a single line are rare; using the first is the documented behavior.

### `compute_tier2_flag(p_material_id UUID, p_project_id UUID, p_requested_qty NUMERIC) RETURNS TEXT`

Logic mirrors `gate1.ts:66-100` (Tier 2 envelope check):

```
1. SELECT total_planned, total_ordered FROM v_material_envelope_status
   WHERE project_id = p_project_id AND material_id = p_material_id
2. If view returns no row → INFO (no envelope built yet, can't enforce)
3. newTotal = total_ordered + p_requested_qty
4. burnPct = newTotal / total_planned * 100
5. If burnPct > 120 → CRITICAL
6. If burnPct > 100 → HIGH
7. If burnPct > 80 → WARNING
8. If burnPct > 50 → INFO
9. Else → OK
```

Returns `'OK'` if `p_material_id` is null (Tier 2 needs material catalog link).

### `compute_tier3_flag(p_material_id UUID, p_project_id UUID, p_requested_qty NUMERIC) RETURNS TEXT`

Logic mirrors `tools/envelopes.ts:308-334` (Tier 3 spend cap):

```
1. SELECT median ahs_lines.unit_price for p_material_id from current ahs_version
   (mirrors summarizeAhsBaselinePrices)
2. estimated_spend = p_requested_qty * unit_price
3. If estimated_spend > 5,000,000 → WARNING
4. Else → OK
```

Returns `'OK'` if either input is null.

### `dispatch_line_flag(line_row material_request_lines) RETURNS TEXT`

Branches by `line_row.tier`:
- `1` → look up first DIRECT allocation:
  ```sql
  SELECT boq_item_id, allocated_quantity
  FROM material_request_line_allocations
  WHERE request_line_id = line_row.id AND allocation_basis = 'DIRECT'
  ORDER BY id LIMIT 1
  ```
  - If no row found → `'WARNING'` (placeholder until allocations arrive — Trigger 3 will overwrite)
  - Else → `compute_tier1_flag(boq_item_id, allocated_quantity)`
- `2` → `compute_tier2_flag(line_row.material_id, header.project_id, line_row.quantity)`
- `3` → `compute_tier3_flag(line_row.material_id, header.project_id, line_row.quantity)`
- else → `'OK'` (defensive, shouldn't happen given tier CHECK constraint)

The header's `project_id` is fetched via subquery from `material_request_headers`.

**Why allocated_quantity (not line.quantity) for Tier 1:** when a line is split across multiple allocations (rare), `allocated_quantity` is what was actually requested against this specific BoQ item. Using `line.quantity` would over-count if the line has multiple allocations.

---

## Section 3 — Triggers

### Trigger 1: `material_request_lines_set_flag_trg`

```sql
CREATE OR REPLACE FUNCTION recompute_line_flag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.line_flag := dispatch_line_flag(NEW);
  RETURN NEW;
END $$;

CREATE TRIGGER material_request_lines_set_flag_trg
  BEFORE INSERT OR UPDATE OF tier, quantity, material_id
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag();
```

Fires on:
- INSERT: every new line gets server-truth flag (Tier 1 → 'WARNING' placeholder; Tier 2/3 → real value).
- UPDATE OF specific columns: only flag-relevant changes trigger. UPDATE of unrelated columns (e.g., `line_flag`, `line_check_details`, `material_spec_reference`) does NOT fire — avoids spurious recomputation and prevents infinite loop with Trigger 3.

Critical: `line_flag` is **not** in the column filter. Trigger 3 issues `UPDATE … SET line_flag = …`, and that update must NOT refire Trigger 1.

### Trigger 2: `material_request_lines_aggregate_header_trg`

```sql
CREATE OR REPLACE FUNCTION recompute_header_flag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_header_id UUID;
  v_worst_flag TEXT;
  v_current_status TEXT;
  v_should_promote BOOLEAN;
BEGIN
  -- Pick header_id from NEW or OLD depending on operation
  v_header_id := COALESCE(NEW.request_header_id, OLD.request_header_id);

  -- Compute worst flag across all lines for this header
  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE line_flag = 'CRITICAL') > 0 THEN 'CRITICAL'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'HIGH') > 0 THEN 'HIGH'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'WARNING') > 0 THEN 'WARNING'
      WHEN COUNT(*) FILTER (WHERE line_flag = 'INFO') > 0 THEN 'INFO'
      ELSE 'OK'
    END INTO v_worst_flag
  FROM material_request_lines
  WHERE request_header_id = v_header_id;

  -- Read current status to decide whether to auto-promote
  SELECT overall_status INTO v_current_status
  FROM material_request_headers
  WHERE id = v_header_id;

  -- Auto-promote to AUTO_HOLD only when:
  -- - worst flag is CRITICAL or HIGH
  -- - AND status is in a "still pending review" state
  v_should_promote :=
    v_worst_flag IN ('CRITICAL', 'HIGH')
    AND v_current_status IN ('PENDING', 'AUTO_HOLD');

  UPDATE material_request_headers
  SET
    overall_flag = v_worst_flag,
    overall_status = CASE
      WHEN v_should_promote THEN 'AUTO_HOLD'
      ELSE overall_status  -- preserve manual reviewer decision
    END
  WHERE id = v_header_id;

  RETURN NULL;  -- AFTER triggers ignore return value
END $$;

CREATE TRIGGER material_request_lines_aggregate_header_trg
  AFTER INSERT OR UPDATE OR DELETE
  ON material_request_lines
  FOR EACH ROW
  EXECUTE FUNCTION recompute_header_flag();
```

Status promotion logic:
- `worst_flag` ∈ {`CRITICAL`, `HIGH`} AND `overall_status` ∈ {`PENDING`, `AUTO_HOLD`} → set `AUTO_HOLD`
- `worst_flag` ∈ {`CRITICAL`, `HIGH`} AND `overall_status` ∈ {`APPROVED`, `REJECTED`, `UNDER_REVIEW`} → preserve reviewer decision (no change)
- `worst_flag` ∈ {`OK`, `INFO`, `WARNING`} → preserve `overall_status` (don't undo a previous AUTO_HOLD via this path; reviewer must explicitly transition)

### Trigger 3: `material_request_line_allocations_recompute_line_trg`

```sql
CREATE OR REPLACE FUNCTION recompute_line_flag_from_allocation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_line_id UUID;
  v_line material_request_lines%ROWTYPE;
  v_new_flag TEXT;
BEGIN
  v_line_id := COALESCE(NEW.request_line_id, OLD.request_line_id);

  SELECT * INTO v_line FROM material_request_lines WHERE id = v_line_id;

  -- Line may already be deleted (CASCADE delete from header) — nothing to do.
  IF v_line.id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_flag := dispatch_line_flag(v_line);

  -- Only update if changed (avoids unnecessary cascading Trigger 2 fire).
  IF v_line.line_flag IS DISTINCT FROM v_new_flag THEN
    UPDATE material_request_lines
    SET line_flag = v_new_flag
    WHERE id = v_line.id;
    -- This UPDATE fires Trigger 2 (header re-aggregate). Does NOT fire Trigger 1
    -- because line_flag is excluded from Trigger 1's column filter.
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER material_request_line_allocations_recompute_line_trg
  AFTER INSERT OR UPDATE OR DELETE
  ON material_request_line_allocations
  FOR EACH ROW
  EXECUTE FUNCTION recompute_line_flag_from_allocation();
```

This trigger is what makes Tier 1 enforcement work end-to-end. Sequence on a fresh insert:
1. Line inserted with tier=1 → Trigger 1 sets `line_flag='WARNING'` (no allocations yet)
2. Trigger 2 sees the new line → header `overall_flag='WARNING'`
3. Allocation inserted for that line → Trigger 3 fires
4. Trigger 3 calls `dispatch_line_flag(line)` → now finds DIRECT allocation → real Tier 1 flag (e.g., `CRITICAL`)
5. Trigger 3 issues `UPDATE line SET line_flag='CRITICAL'`
6. That UPDATE fires Trigger 2 → header re-aggregates to `CRITICAL` and auto-promotes to `AUTO_HOLD`

For Tier 2/3 lines, Trigger 3's recomputation is essentially a no-op (their flag doesn't depend on allocations) — safe but wasted work. Acceptable: allocation INSERTs happen at most a few times per submit.

---

## Section 4 — Edge Cases

| Case | Handling |
|---|---|
| Header inserted with 0 lines (empty submit) | No trigger fires. Header keeps client-supplied `overall_flag` (initially `OK` from PermintaanScreen submit). Estimator review manual. Acceptable since empty submit is a degenerate case. |
| Lines inserted one-at-a-time within same transaction | Each insert fires both triggers. Final state after all inserts = correct aggregate. Slight redundancy but correctness guaranteed. |
| Estimator UPDATEs `quantity` on an existing line | Trigger 1 recomputes `line_flag`. Trigger 2 re-aggregates header. If new aggregate is CRITICAL/HIGH and header was PENDING → auto-promote AUTO_HOLD. If header was APPROVED, keep APPROVED. |
| Reviewer UPDATEs `overall_status` to APPROVED via UI | Direct table update on `material_request_headers`. Triggers are on `material_request_lines`, so no fire. Status preserved. |
| Reviewer APPROVES, then estimator UPDATEs a line | Trigger 1 + 2 fire. Aggregate may be CRITICAL but `v_should_promote` is FALSE (status is APPROVED, not in {PENDING, AUTO_HOLD}). Status stays APPROVED. Flag updates to current truth. |
| Race: envelope changes while trigger is running | Trigger reads view at trigger fire time within current transaction. Result reflects database state as of that instant. Acceptable — flag represents "situation at submit." |
| Custom material with `material_id = null` | `compute_tier2_flag` and `compute_tier3_flag` return `'OK'` early. Manual estimator review still applies. |
| Tier 1 line with `boq_item_id = null` | `compute_tier1_flag` returns `'WARNING'`. Auto-flagged for review. |
| Multiple DIRECT allocations on a Tier 1 line (rare) | Trigger 3 calls `dispatch_line_flag` which uses the FIRST DIRECT allocation (by `id` ordering). Documented limitation; matches the client-side `firstAllocation` heuristic. |
| Tier 1 line inserted, allocation never follows (orphan) | Trigger 1 set placeholder `'WARNING'`. Header is `WARNING`. No auto-promote (only CRITICAL/HIGH triggers AUTO_HOLD). Reviewer sees flagged-for-review state — correct outcome. |
| Allocation inserted for a non-existent line | FK `request_line_id REFERENCES material_request_lines(id)` blocks this. Insert fails before Trigger 3 fires. |
| Allocation deleted (e.g., user revises line) | Trigger 3 fires AFTER DELETE. Recomputes parent line (now possibly back to `'WARNING'` placeholder if no DIRECT allocations remain). Cascades to header. |
| Header DELETE cascades to lines, lines cascade to allocations | Cascade order: allocations delete first → Trigger 3 sees parent line still exists, but line is about to die. The `IF v_line.id IS NULL THEN RETURN` guard handles the case where line is already gone. After all allocations gone, lines delete → Trigger 2 sees header still exists; recomputes empty aggregate. After lines gone, header delete completes. No spurious updates left behind. |
| Direct API bypass via curl with `line_flag: 'OK'` | Trigger 1 fires regardless of caller. Server overwrites `NEW.line_flag` with computed value. Bypass closed. |
| Old app version submitting outdated flag | Same as above. Server overwrites. |
| Trigger function errors (envelope view temporarily inaccessible) | Insert fails. Transaction rolled back. App receives error and can retry. Better than silent bad-flag persistence. |
| Migration applied but app still on old version | App reads `overall_flag` from DB just like before. Server-truth value returned. App displays correctly. No client change required. |

---

## Section 5 — RLS & Security

No new RLS policies. The triggers add to existing security; they don't replace it.

**`SECURITY DEFINER`** on all helper functions and trigger functions. Reasons:
- `v_material_envelope_status` may have RLS that limits visibility per user. Triggers need to see all data for the project being modified.
- `boq_items` may have RLS. Same reason.
- `ahs_lines` may have RLS. Same reason.
- `material_request_line_allocations` may have RLS (project-assignment based). `dispatch_line_flag` reads this table for Tier 1 — must succeed regardless of the calling user's row visibility.

**Bypass surfaces closed:**

| Path | Closed by |
|---|---|
| Direct INSERT via curl/Postman | Trigger fires regardless of caller |
| Old app version | Trigger overwrites the stale flag |
| Logic divergence between phones | Server is single source of truth |
| Estimator client overrides flag manually | Trigger overwrites on save |
| Two competing phone submits | Both go through trigger; both store server-truth |

**Bypass surfaces NOT closed (intentionally out of scope):**

| Path | Why out of scope |
|---|---|
| Reviewer manually changes `overall_status` to APPROVED bypassing AUTO_HOLD | This IS the override path. Principal/admin role audit applies via existing `reviewed_by`/`reviewed_at` fields. |
| Direct UPDATE on `material_request_headers.overall_status` | RLS already restricts who can update. The trigger is on lines, not headers. By design. |
| Server-side admin bypass via service-role JWT | Service role legitimately bypasses RLS. Not a user-facing concern. |

---

## Section 6 — Testing

### Integration tests via Supabase JS client

Test file: `tools/__tests__/serverGateEnforcement.test.ts`

Pre-test setup creates a project, BoQ item, material catalog row, and AHS version + lines for baseline price. Each test inserts material_request_headers, then lines, then `material_request_line_allocations` (in that order, mirroring `PermintaanScreen.tsx:533-565`), and asserts the resulting stored flag matches expected. For Tier 1, tests must also assert intermediate state: line_flag is `'WARNING'` after line insert (placeholder) and the real value after allocation insert.

Cases:

```
✓ Tier 2 over envelope → CRITICAL flag stored, header status = AUTO_HOLD
✓ Tier 1 within BoQ remaining → after allocation insert: OK flag stored, header status = PENDING
✓ Tier 1 over BoQ by 35% → after allocation insert: CRITICAL flag, header status = AUTO_HOLD
✓ Tier 1 line WITHOUT allocation insert → flag stays at 'WARNING' placeholder, header WARNING
✓ Tier 1 placeholder transition: insert line (flag=WARNING) → insert DIRECT allocation pointing
  to over-budget BoQ item → trigger 3 fires → line flag becomes CRITICAL → header AUTO_HOLD
✓ Tier 3 spend exceeds Rp 5jt cap → WARNING flag, header status = PENDING (no auto-hold for Tier 3)
✓ Client sends line_flag='OK' for actually-CRITICAL Tier 2 line → DB stores 'CRITICAL', header AUTO_HOLD
✓ Insert header with overall_flag='OK' but lines actually CRITICAL → header recomputes to CRITICAL after lines insert
✓ Header with status=APPROVED, then line update → status stays APPROVED, flag updates
✓ Header with status=REJECTED, then line update → status stays REJECTED
✓ UPDATE line quantity (estimator edit) → flag re-computed, header re-aggregated
✓ DELETE allocation → parent line recomputes (Tier 1 reverts to WARNING placeholder if no DIRECT
  allocations remain) → header re-aggregates
✓ DELETE last line → header re-aggregated to OK (no lines means no risk flags)
✓ Insert with material_id=null on Tier 2 → flag = OK (graceful degradation)
```

### Migration smoke check

```bash
# Apply migration to local Supabase or via dashboard
# Then run:
psql -c "INSERT INTO material_request_lines (...) VALUES (...);"
psql -c "SELECT line_flag FROM material_request_lines WHERE id = '...';"
# Expect: server-computed value, not the inserted value
```

### Existing tests must still pass

All app-level tests (`tools/boqParserV2/__tests__/*`, `office/screens/components/__tests__/*`) should be unaffected — no app code changes. Run `npx jest` after migration applied to local DB; expect no regressions.

---

## Section 7 — File Layout & Effort

**Create:**
- `supabase/migrations/033_server_gate_enforcement.sql` — 4 helper/dispatch functions (`compute_tier1_flag`, `compute_tier2_flag`, `compute_tier3_flag`, `dispatch_line_flag`) + 3 trigger functions + 3 triggers + comments. ~200 LOC.
- `tools/__tests__/serverGateEnforcement.test.ts` — integration tests (14 cases, including the placeholder→real-flag transition). ~280 LOC.

**No changes to:**
- `workflows/gates/gate1.ts` — kept verbatim for instant UI feedback (no longer source of truth on persisted data, but still valuable for pre-submit display).
- `workflows/screens/PermintaanScreen.tsx` — submit flow unchanged. Client-computed flag goes in; server-computed flag comes back on read.
- `office/screens/ApprovalsScreen.tsx` — read flow unchanged. Reads `overall_flag` from DB; now it's server-truth.

**Effort estimate:**

| Task | Effort |
|---|---|
| Migration: 4 helper functions + 3 triggers + verification | 1 day |
| Integration tests (14 cases) | 0.5 day |
| Migration apply + smoke test on staging | 0.25 day |
| Documentation (commit messages, migration notes) | 0.25 day |
| **Total** | **~2 days** |

**Deployment:**
- Apply migration to production Supabase via dashboard SQL editor (consistent with PR #5 deployment pattern).
- No app rebuild. Backend-only change.
- Vercel deploy NOT required (DB-only migration).
- Verification post-apply: insert a known-CRITICAL request via curl → confirm DB stores CRITICAL + AUTO_HOLD.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| PL/pgSQL Tier 2/3 logic drifts from TS `gate1.ts` over time | Both files documented as "must stay in sync"; integration tests assert flag values match. Future rule changes update both in same PR. |
| Trigger overhead per line insert | Trigger 1 is O(1). Trigger 2 is O(N) over lines for one header (typically 1-5 lines). Acceptable for human-paced submits. |
| Migration locks `material_request_lines` during deploy | `CREATE TRIGGER` is fast (no table rewrite). Negligible lock window. |
| Server flag computation reads stale view data during high-write contention | View `v_material_envelope_status` is computed at query time from underlying tables; no stale state. Sees committed-data-as-of-trigger-time within the transaction. |
| Reviewer can still bypass AUTO_HOLD via direct status update | Out of scope. RLS limits who can update headers; principal override is intended use. |

---

## Open questions

None blocking.
