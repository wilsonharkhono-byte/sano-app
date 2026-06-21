# SANO Tech-Debt Register

> Snapshot audit, 2026-06-21. ~50k LOC, 232 source files, 40 migrations, 87 test
> files. The reconciliation/gate/publish/parser core is healthy (well-typed,
> tested, no committed secrets, RLS mostly clean). Debt is concentrated in a
> security hole, swallowed DB errors, a large dead v1 path, and repo/test hygiene.
>
> Status legend: ☐ open · ⧗ in progress · ☑ done

---

## 🔴 Critical

### C1 — Cross-tenant financial leak via SECURITY DEFINER RPCs ⧗
`get_unsettled_kasbon_total` ([014:243](../../../supabase/migrations/014_kasbon_ledger.sql)),
`get_unsettled_attendance_total` ([015:274](../../../supabase/migrations/015_attendance_hok.sql)),
`get_unsettled_worker_attendance_total` ([017:724](../../../supabase/migrations/017_mandor_workers.sql)).
All DEFINER, granted to `authenticated`, took a user-supplied `contract_id` with
**no authz check** → any logged-in user could read any tenant's unsettled total.
**Fix shipped:** migration `042_secure_contract_totals.sql` adds
`assert_contract_access()` (office-role OR project-assignment; raises, not a fake 0)
and wires it into all three. **Action:** apply 042 to Supabase.

### C2 — Tests mutate the LIVE prod DB with RLS bypassed ☑ (code) / ☐ (staging)
`tools/__tests__/_serverGateHarness.ts` built a service-role client from `.env`
against the prod URL and **threw at import** when keys were missing. **Done:**
harness no longer throws at import (lazy `adminClient` Proxy + `harnessAvailable`);
mutations are refused at use-time unless `ALLOW_PROD_DB_TESTS=1` is explicitly set;
a single `prodDbTestsEnabled` flag gates all 5 suites (they now **skip cleanly** —
verified: 30 skipped, 0 prod writes). **Still open:** stand up a disposable
staging Supabase project and point `SUPABASE_URL` there so the suites can actually
run in CI; add a standalone prefix-purge script (cleanup is still `afterAll`-only).

---

## 🟠 High

### H1 — Swallowed Supabase write errors in money/provenance paths ☑ (per-write) / ☐ (atomicity)
Failed writes flow on silently. Worst offenders:
- [Gate2Screen.tsx](../../../workflows/screens/Gate2Screen.tsx) PO creation — 7 unchecked writes → half-committed POs.
- [TerimaScreen.tsx](../../../workflows/screens/TerimaScreen.tsx) receipts — PO status can desync from goods received.
- [audit.ts](../../../tools/audit.ts) — the audit trail itself can silently drop events.
- ~34 `const { data } = await supabase…` reads drop `error`, masking RLS failures as empty results.

**Done:** every flagged write in `audit.ts`, `Gate2Screen.tsx`, `TerimaScreen.tsx`, `ProgresScreen.tsx` now captures `{ error }` and surfaces it (toast / re-throw) instead of continuing silently. **Still open:** the PO-create and receipt-submit flows are multi-write with no DB transaction — a mid-flow failure leaves committed partial rows (now visible to the user, but not atomic). Wrap each in a single RPC/transaction.

### H2 — Dead v1 code path (~2,500+ lines) ☐
UI hardcodes `parserVersion='v2'` ([BaselineScreen.tsx:221](../../../workflows/screens/BaselineScreen.tsx)),
so the v1 publish branch ([baseline.ts:679-882](../../../tools/baseline.ts)) and most
of [excelParser.ts](../../../tools/excelParser.ts) (2,380 lines) are unreachable.
**Fix:** confirm no legacy v1 import sessions remain in the DB, then delete; keep
`publishBaseline` only as the status-marking wrapper. Biggest single cleanup win.

### H3 — 212 MB of binaries committed to git (`.git` = 127 MB) ☐
31 tracked `.xlsx`/`.pdf` (up to 23 MB), **201 tracked files in `tmp/`** incl. 13 MB
output workbooks. `.gitignore` misses `tmp/`, `*.zip`, `*.log`, kit dirs.
**Fix:** `git rm --cached` fixtures + `tmp/`; extend `.gitignore`; move samples to
Git LFS/external. (Untracking is low-risk; history rewrite is optional/separate.)

---

## 🟡 Medium

- **M1 — UI reimplements envelope/gate math.** [PermintaanScreen.tsx:117-249](../../../workflows/screens/PermintaanScreen.tsx) has its own Tier-2 allocation instead of calling [envelopes.ts](../../../tools/envelopes.ts). Two copies = the "double-count on re-publish" bug class. → Route the screen to the tools functions. ☐
- **M2 — `ahs_lines` dual-column trap.** ☑ publishBaselineV2 now writes `usage_rate = coefficient` (same value) so the columns can't disagree. **Note:** existing rows are unchanged — a re-publish backfills them; consider a one-off `UPDATE ahs_lines SET usage_rate = coefficient WHERE usage_rate = 0`.
- **M3 — Migration drift risk / no CI.** ☑ (CI) added `.github/workflows/ci.yml` — runs typecheck + jest (prod-DB suites excluded) on PR/push. ☐ (drift) still adopt `supabase db push`/checksum ledger for migration apply order.
- **M4 — 6 app-read tables never had RLS enabled.** ⧗ migration `043_enable_rls_unprotected_tables.sql` written — enables RLS + project-scoped + office policies on all 7 (direct `project_id` for 6; `milestone_revisions` via `milestone_id→milestones.project_id`). **Needs:** review the `milestone_revisions` linkage + manual apply (hard cutover — confirm app reads run in a project-assigned/office context).
- **M5 — `xlsx@0.18.5` vulnerable SheetJS** + `exceljs` also bundled. ☐ deferred (needs import audit; risk of breaking the parser).
- **M6 — No tests on `derivation.ts`.** ☑ added `tools/__tests__/derivation.test.ts` (10 tests, supabase mocked, no DB): coefficient-over-usage_rate, material_spec fallback, line_type filter, aggregation, received/on_site, tier fallbacks. ☐ `baseline.ts` still untested; the ±1 Rp integration tests still `describe.skip` without committed fixtures.

---

## 🟢 Low / cleanup

- **L1** — God files to split eventually: [reports.ts](../../../tools/reports.ts) (13 report generators), [opname.ts](../../../tools/opname.ts) (4 concerns), [AuditTraceScreen.tsx](../../../workflows/screens/AuditTraceScreen.tsx) (screen + many inline subcomponents).
- **L2** — 116 `: any` / 58 `as any`, concentrated in UI (ReportPreview 31, useOpname 11), **not** the math core. `useNavigation<any>()` defeats route typing.
- **L3** — `normalizeMaterialKey`/material-name normalization duplicated 5+ ways (baseline.ts, derivation.ts, materialMatch.ts, publishBaselineV2.ts, materialNaming.ts). Consolidate.
- **L4** — Repo strays: byte-identical `sano-normalizer-kit 2/` Finder-dupe, `sano-normalizer-kit.zip`, stray `zi4xPTUO`, `(1).xlsx` copies → delete.
- **L5** — 70 `console.log/warn` in production source (worst: `useProject.tsx` ×7); route through a logger. `Gate2Screen.tsx:204` swallows a load error to console only.
- **L6** — `supabase/functions/boq-normalize/index.ts` is a permanent stub (`EDGE_PORT_IN_PROGRESS`); finish or delete.
- **L7** — Consider `noUncheckedIndexedAccess` in tsconfig (relevant to REKAP/Analisa row indexing in the parser).

---

## Healthy (no action)
No committed secrets (the eas.json JWT is the public anon key). Gate/publish/parser
are well-typed and tested. The v2 version/`is_current` bookkeeping bug is fixed.
SECURITY DEFINER search_path hygiene is clean. RLS missing-authenticated-SELECT
bug class is otherwise resolved (040 was the last instance).
