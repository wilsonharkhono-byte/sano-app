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

### C2 — Tests mutate the LIVE prod DB with RLS bypassed ☐
`tools/__tests__/_serverGateHarness.ts` builds a service-role client from `.env`
against the same `EXPO_PUBLIC_SUPABASE_URL` used in prod, and **throws at import**
when keys are missing instead of skipping. 5 suites do real insert/update/delete;
cleanup is best-effort `afterAll`. Any dev running `npm test` with a normal `.env`
writes to prod. **Fix:** dedicated staging project; assert URL ≠ prod before any
mutation; `describe.skip` when test-env vars unset; add a standalone purge script.

---

## 🟠 High

### H1 — Swallowed Supabase write errors in money/provenance paths ☐
Failed writes flow on silently. Worst offenders:
- [Gate2Screen.tsx](../../../workflows/screens/Gate2Screen.tsx) PO creation — 7 unchecked writes → half-committed POs.
- [TerimaScreen.tsx](../../../workflows/screens/TerimaScreen.tsx) receipts — PO status can desync from goods received.
- [audit.ts](../../../tools/audit.ts) — the audit trail itself can silently drop events.
- ~34 `const { data } = await supabase…` reads drop `error`, masking RLS failures as empty results.

**Fix:** a `{ data, error }` helper that throws; check `error` on every write; wrap multi-write PO flow in one RPC/transaction.

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
- **M2 — `ahs_lines` dual-column trap still loaded.** v2 writes `coefficient`, leaves `usage_rate=0`; readers fall back today, but a new reader using `usage_rate` alone silently gets 0. → Have v2 also write `usage_rate = coefficient`, or drop the column. ☐
- **M3 — Migration drift risk.** Functions redefined across migrations (`get_workgroup_envelope` 039→041, `approve_opname` 3×) with manual apply + no checksum ledger; no CI runs tests. → Adopt `supabase db push`/ledger; add a CI job (prod-DB suites excluded). ☐
- **M4 — 6 app-read tables never had RLS enabled.** `approval_tasks`, `audit_cases`, `anomaly_events`, `material_receipts`, `vendor_scorecards`, `performance_scores` (002). → Enable RLS + project-scoped policies. ☐
- **M5 — `xlsx@0.18.5` is the known-vulnerable SheetJS npm build** + `exceljs` also bundled (two XLSX libs). → Consolidate on one; move off the vulnerable build. ☐
- **M6 — No tests on `derivation.ts` or `baseline.ts`;** the ±1 Rp reconciliation integration tests `describe.skip` on a clean checkout (fixtures gitignored). → Add derivation unit tests; commit one small fixture or fail loudly in CI. ☐

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
